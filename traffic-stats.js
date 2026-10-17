// Capture-wide traffic statistics (protocol / cast / IP-version shares, TCP
// health, ICMP types, ports, packet sizes, traffic over time), accumulated
// frame by frame in the parser worker next to the device/pair Aggregator.
// Loaded via importScripts() as a classic (non-module) script, so no
// import/export syntax here.
//
// TCP analysis (retransmissions, duplicate ACKs, ...) follows the same
// heuristics as Wireshark's "TCP Analysis" and is purely sequence-number
// based, so it is an estimate: a capture that starts mid-connection, a
// capture point that sits between sender and the actual loss, or a capture
// that dropped packets itself will all skew it.
// thought up by human, created by ai

const TCP_FIN = 0x01;
const TCP_SYN = 0x02;
const TCP_RST = 0x04;
const TCP_PSH = 0x08;
const TCP_ACK = 0x10;
const TCP_URG = 0x20;
const TCP_ECE = 0x40;
const TCP_CWR = 0x80;

// A "late" segment arriving this soon after the data it overtook is treated
// as reordering by the network, not as a retransmission by the sender
// (same threshold Wireshark uses).
const OUT_OF_ORDER_WINDOW_SECONDS = 0.003;
const TOP_PORTS_LIMIT = 50;
const TOP_STREAMS_LIMIT = 15;
const TIME_BUCKETS_MAX = 120;
// Bounds for the DNS bookkeeping so a huge capture can't blow up memory.
const DNS_MAX_PENDING_QUERIES = 50000;
const DNS_MAX_TRACKED_NAMES = 5000;
const DNS_TOP_LIMIT = 10;
const TLS_MAX_TRACKED_SERVERS = 2000;
// Bounds for the layer-2 / Apple / resolver / Private Relay bookkeeping.
const L2_MAX_MACS_PER_PROTOCOL = 200;
const L2_MAX_NEIGHBORS = 500;
const APPLE_MAX_NAMES = 2000;
const MAX_TRACKED_CLIENTS = 5000;
const MAX_TRACKED_RESOLVERS = 500;
const RELAY_MAX_PENDING = 5000;
const RELAY_MAX_IPS = 500;
// A DNS answer that takes at least this long counts as "slow" (a client gives up and retries after a few seconds).
const SLOW_DNS_SECONDS = 1;

// Upper bounds (inclusive, bytes on the wire) of the packet-size histogram buckets.
const SIZE_BUCKET_LIMITS = [64, 127, 255, 511, 1023, 1518];

function tcpFlagsLabel(flags) {
  const parts = [];
  if (flags & TCP_SYN) parts.push('SYN');
  if (flags & TCP_FIN) parts.push('FIN');
  if (flags & TCP_RST) parts.push('RST');
  if (flags & TCP_PSH) parts.push('PSH');
  if (flags & TCP_ACK) parts.push('ACK');
  if (flags & TCP_URG) parts.push('URG');
  if (flags & TCP_ECE) parts.push('ECE');
  if (flags & TCP_CWR) parts.push('CWR');
  return parts.length ? parts.join(', ') : '(keine Flags)';
}

function statsProtocolGroup(protocol) {
  if (protocol === 'TCP' || protocol === 'UDP' || protocol === 'ARP' || protocol === 'L2') return protocol;
  if (protocol === 'ICMP' || protocol === 'ICMPv6') return 'ICMP';
  return 'OTHER';
}

function bump(entry, bytes) {
  entry.packets++;
  entry.bytes += bytes;
}

function createCounter() {
  return { packets: 0, bytes: 0 };
}

/** What the TCP analysis found for ONE packet; handed to the Aggregator so issues can be attributed to pairs/connections. */
function createTcpEvents(payload) {
  return {
    dataSegment: payload > 0,
    retransmission: false,
    fastRetransmission: false,
    duplicateAck: false,
    outOfOrder: false,
    lostSegment: false,
    zeroWindow: false,
    reset: false,
    fin: false,
    keepAlive: false,
    handshakeRtt: null, // seconds, set on the SYN/ACK that completes a SYN -> SYN/ACK exchange
  };
}

function createTcpDirection() {
  return { init: false, nextSeq: 0, lastAck: null, lastWindow: null, dupAcks: 0, lastDataTs: 0 };
}

/** Adds `value` to the array `hints[field]` (created on first use). */
function pushHint(hints, field, value) {
  if (!hints[field]) hints[field] = [];
  if (hints[field].indexOf(value) === -1) hints[field].push(value);
}

class TrafficStats {
  constructor() {
    this.decodedPackets = 0;
    this.decodedBytes = 0;
    this.firstTimestamp = null;
    this.lastTimestamp = null;
    this.byProtocol = { TCP: createCounter(), UDP: createCounter(), ICMP: createCounter(), ARP: createCounter(), L2: createCounter(), OTHER: createCounter() };
    this.byCast = { unicast: createCounter(), multicast: createCounter(), broadcast: createCounter() };
    this.byIpVersion = { ipv4: createCounter(), ipv6: createCounter(), none: createCounter() };
    this.sizeBuckets = SIZE_BUCKET_LIMITS.map(() => createCounter());
    this.sizeBuckets.push(createCounter()); // everything above the last limit (jumbo / offloaded frames)
    this.perSecond = new Map(); // whole second -> [packets, bytes]
    this.ports = new Map(); // `${protocol}|${port}` -> { protocol, port, packets, bytes }
    this.icmp = new Map(); // `${protocol}|${type}|${code}` -> { protocol, type, code, packets }
    this.tcpFlagCombos = new Map(); // label -> packets
    this.tcp = {
      packets: 0,
      dataSegments: 0,
      retransmissions: 0,
      fastRetransmissions: 0,
      outOfOrder: 0,
      duplicateAcks: 0,
      zeroWindow: 0,
      resets: 0,
      lostSegments: 0,
      keepAlives: 0,
    };
    this.streams = new Map();
    this.handshakes = { count: 0, sum: 0, min: null, max: null };
    this.tls = {
      clientHellos: 0,
      serverHellos: 0,
      versions: new Map(), // negotiated version (number) -> ServerHellos
      ciphers: new Map(), // cipher suite id -> ServerHellos
      outdatedServers: new Map(), // `${ip}:${port}|${version}` -> ServerHellos that negotiated a deprecated version
    };
    this.vlans = new Map(); // VLAN ID -> { packets, bytes } (tagged frames only)
    this.l2 = {
      protocols: new Map(), // name -> { packets, bytes, macs: Set }
      bpdus: 0,
      tcnBpdus: 0,
      tcFlagBpdus: 0,
      roots: new Map(), // `${vlan}|${rootId}` -> { vlan, rootId, count, senders: Set, bridges: Set }
      tcSenders: new Map(), // sender MAC -> topology change BPDUs
      neighbors: new Map(), // `${protocol}|${mac}` -> neighbour announcement (latest values)
      lacpPdus: 0,
      lacpOutOfSync: 0,
      lacpDefaultedOrExpired: 0,
    };
    this.apple = {
      groups: new Map(), // traffic group -> { packets, bytes, generic }
      clients: new Map(), // client address -> { packets, bytes }
      dnsGroups: new Map(), // group -> DNS queries for names of that group
      dnsNames: new Map(), // name -> { group, count }
      sniGroups: new Map(), // group -> TLS ClientHellos with an SNI of that group
      mdnsServices: new Map(), // service type -> { count, apple }
      mdnsHosts: new Map(), // host name (*.local) -> count
    };
    this.resolvers = {
      byIp: new Map(), // server address -> { category, label, queries, responses, failures, clients: Set }
      clientCategories: new Map(), // client address -> Map(category -> queries)
      dot: new Map(), // `${client}|${server}` -> { client, server, category, label, packets }
      doh: new Map(), // same, for port 443 towards well-known public resolver addresses
    };
    this.relay = {
      names: new Map(), // watched name -> outcome counters
      clients: new Map(), // client address -> evidence
      ips: new Map(), // address learned from a DNS answer for a watched name -> name
      pending: new Map(), // `${client}|${server}|${id}` -> { client, name, ts }
    };
    this.dns = {
      queries: 0,
      responses: 0,
      rcodes: new Map(), // response code -> count
      pending: new Map(), // `${client}|${server}|${id}` -> true, queries still waiting for their response
      failingNames: new Map(), // `${rcode}|${name}` -> count
      resolvers: new Map(), // server ip -> { responses, failures }
      clients: new Map(), // client ip -> failures
      pendingCapped: false,
    };
    this.fragmentation = {
      ipv4Packets: 0,
      ipv4Fragments: 0,
      ipv6Packets: 0,
      ipv6Fragments: 0,
      fragmentedDatagrams: 0,
      dontFragment: 0,
    };
    this.maxIpPacketLength = 0;
    this.maxFrameLength = 0;
    this.mssValues = new Map(); // `${ipVersion}|${mss}` -> SYN packets announcing it
    this.icmpMtuValues = new Map(); // `${protocol}|${mtu}` -> packets reporting it
  }

  /**
   * Returns the TCP analysis events for this packet (null for non-TCP packets).
   * `hints` (optional) collects what this packet says about its connection -
   * Apple group, ICMP type/code, fragmentation, DNS provider, relay traffic -
   * for the Aggregator, which stores it as per-connection facets (the
   * attributes the filter chips work on).
   */
  add(decoded, hints = {}) {
    const size = decoded.frameLength;
    this.decodedPackets++;
    this.decodedBytes += size;
    if (this.firstTimestamp === null || decoded.timestamp < this.firstTimestamp) this.firstTimestamp = decoded.timestamp;
    if (this.lastTimestamp === null || decoded.timestamp > this.lastTimestamp) this.lastTimestamp = decoded.timestamp;

    bump(this.byProtocol[statsProtocolGroup(decoded.protocol)], size);
    bump(this.byCast[decoded.castType || 'unicast'], size);
    bump(this.byIpVersion[decoded.ipVersion === 4 ? 'ipv4' : decoded.ipVersion === 6 ? 'ipv6' : 'none'], size);

    let bucketIndex = SIZE_BUCKET_LIMITS.findIndex((limit) => size <= limit);
    if (bucketIndex === -1) bucketIndex = SIZE_BUCKET_LIMITS.length;
    bump(this.sizeBuckets[bucketIndex], size);

    const second = Math.floor(decoded.timestamp);
    const slot = this.perSecond.get(second);
    if (slot) {
      slot[0]++;
      slot[1] += size;
    } else {
      this.perSecond.set(second, [1, size]);
    }

    if (decoded.vlanId !== null && decoded.vlanId !== undefined) {
      let vlan = this.vlans.get(decoded.vlanId);
      if (!vlan) {
        vlan = createCounter();
        this.vlans.set(decoded.vlanId, vlan);
      }
      bump(vlan, size);
    }

    this.addSizeAndFragmentation(decoded, size);
    if (decoded.isFragment) hints.fragment = true;
    if (decoded.protocol === 'L2') return null; // layer-2 control frame: detail comes via addL2()
    const appleGroup = this.addApplePacket(decoded, size);
    if (appleGroup) pushHint(hints, 'apple', appleGroup);
    if (decoded.protocol === 'TCP' || decoded.protocol === 'UDP') {
      this.addPort(decoded, size);
      const resolver = this.addResolverTraffic(decoded);
      if (resolver) hints.dnsProvider = resolver;
      if (this.addRelayTraffic(decoded, size)) pushHint(hints, 'relay', 'traffic');
    }
    if (decoded.protocol === 'ICMP' || decoded.protocol === 'ICMPv6') {
      const icmp = this.addIcmp(decoded);
      if (icmp) hints.icmp = icmp;
    }
    if (decoded.protocol === 'TCP' && decoded.tcpSeq !== null) return this.addTcp(decoded);
    return null;
  }

  // ------------------------------------------------------------ layer 2

  /** One layer-2 control frame (STP, CDP, LLDP, LACP, ...); `details` from parseL2Details() or null. */
  addL2(decoded, details) {
    const l2 = this.l2;
    const name = decoded.l2.name;
    let entry = l2.protocols.get(name);
    if (!entry) {
      entry = { packets: 0, bytes: 0, macs: new Set() };
      l2.protocols.set(name, entry);
    }
    bump(entry, decoded.frameLength);
    if (decoded.srcMac && entry.macs.size < L2_MAX_MACS_PER_PROTOCOL) entry.macs.add(decoded.srcMac);
    if (!details) return;

    if (details.kind === 'stp') {
      l2.bpdus++;
      if (details.bpdu === 'tcn') l2.tcnBpdus++;
      if (details.topologyChange) {
        if (details.bpdu !== 'tcn') l2.tcFlagBpdus++;
        l2.tcSenders.set(decoded.srcMac, (l2.tcSenders.get(decoded.srcMac) || 0) + 1);
      }
      if (details.rootId) {
        const key = `${details.vlan === null ? '-' : details.vlan}|${details.rootId}`;
        let root = l2.roots.get(key);
        if (!root) {
          root = { vlan: details.vlan, rootId: details.rootId, count: 0, senders: new Set(), bridges: new Set() };
          l2.roots.set(key, root);
        }
        root.count++;
        if (decoded.srcMac) root.senders.add(decoded.srcMac);
        if (details.bridgeId) root.bridges.add(details.bridgeId);
      }
    } else if (details.kind === 'neighbor') {
      const key = `${details.protocol}|${decoded.srcMac}`;
      let neighbor = l2.neighbors.get(key);
      if (!neighbor && l2.neighbors.size < L2_MAX_NEIGHBORS) {
        neighbor = { protocol: details.protocol, mac: decoded.srcMac, frames: 0, firstSeen: decoded.timestamp };
        l2.neighbors.set(key, neighbor);
      }
      if (neighbor) {
        neighbor.frames++;
        neighbor.lastSeen = decoded.timestamp;
        // Latest announcement wins; fields a frame did not carry keep their previous value.
        for (const field of ['deviceId', 'portId', 'portDescription', 'platform', 'software', 'mgmtIp', 'vlan', 'ttl']) {
          if (details[field] !== null && details[field] !== undefined && details[field] !== '') neighbor[field] = details[field];
        }
        if (details.capabilities && details.capabilities.length) neighbor.capabilities = details.capabilities;
      }
    } else if (details.kind === 'lacp') {
      l2.lacpPdus++;
      if (!details.synchronized) l2.lacpOutOfSync++;
      if (details.defaulted || details.expired) l2.lacpDefaultedOrExpired++;
    }
  }

  l2Result() {
    const l2 = this.l2;
    if (l2.protocols.size === 0 && this.vlans.size === 0) return null;
    return {
      protocols: Array.from(l2.protocols, ([name, e]) => ({ name, packets: e.packets, bytes: e.bytes, devices: e.macs.size })).sort((x, y) => y.packets - x.packets),
      stp: {
        bpdus: l2.bpdus,
        tcnBpdus: l2.tcnBpdus,
        tcFlagBpdus: l2.tcFlagBpdus,
        roots: Array.from(l2.roots.values())
          .map((r) => ({ vlan: r.vlan, rootId: r.rootId, count: r.count, senders: r.senders.size, bridges: r.bridges.size }))
          .sort((x, y) => y.count - x.count)
          .slice(0, 12),
        tcSenders: Array.from(l2.tcSenders, ([mac, count]) => ({ mac, count })).sort((x, y) => y.count - x.count).slice(0, 5),
      },
      neighbors: Array.from(l2.neighbors.values())
        .sort((x, y) => String(x.deviceId || x.mac).localeCompare(String(y.deviceId || y.mac)))
        .slice(0, 60)
        .map((n) => ({
          protocol: n.protocol,
          mac: n.mac,
          deviceId: n.deviceId || null,
          portId: n.portId || null,
          portDescription: n.portDescription || null,
          platform: n.platform || null,
          software: n.software || null,
          mgmtIp: n.mgmtIp || null,
          vlan: n.vlan === undefined ? null : n.vlan,
          capabilities: n.capabilities || [],
          frames: n.frames,
        })),
      neighborCount: l2.neighbors.size,
      lacp: { pdus: l2.lacpPdus, outOfSync: l2.lacpOutOfSync, defaultedOrExpired: l2.lacpDefaultedOrExpired },
      vlans: Array.from(this.vlans, ([id, c]) => ({ id, packets: c.packets, bytes: c.bytes })).sort((x, y) => y.packets - x.packets).slice(0, 12),
      vlanCount: this.vlans.size,
    };
  }

  /** Neighbour announcements as MAC / management-IP -> name, so the matrix can label switches by their CDP/LLDP name. */
  l2DeviceNames() {
    const names = [];
    for (const n of this.l2.neighbors.values()) {
      if (!n.deviceId) continue;
      names.push({ mac: n.mac, ip: n.mgmtIp || null, name: n.deviceId });
    }
    return names;
  }

  // ------------------------------------------------------------- Apple

  /** Counts the packet towards its Apple traffic group; returns the group name or null. */
  addApplePacket(decoded, size) {
    const hit = classifyApplePacket(decoded);
    if (!hit) return null;
    const a = this.apple;
    let group = a.groups.get(hit.group);
    if (!group) {
      group = { packets: 0, bytes: 0, generic: hit.group === 'Bonjour / mDNS' };
      a.groups.set(hit.group, group);
    }
    bump(group, size);
    if (group.generic) return hit.group; // Bonjour is vendor-neutral: counted as a group, not as "Apple traffic" per client
    let client = a.clients.get(hit.client);
    if (!client && a.clients.size < MAX_TRACKED_CLIENTS) {
      client = createCounter();
      a.clients.set(hit.client, client);
    }
    if (client) bump(client, size);
    return hit.group;
  }

  /** Counts a DNS / SNI name towards its Apple service group; returns the group name or null. */
  addAppleName(name, kind) {
    const group = classifyAppleName(name);
    if (!group) return null;
    const a = this.apple;
    const target = kind === 'sni' ? a.sniGroups : a.dnsGroups;
    target.set(group, (target.get(group) || 0) + 1);
    if (kind === 'dns') {
      const known = a.dnsNames.get(name);
      if (known) known.count++;
      else if (a.dnsNames.size < APPLE_MAX_NAMES) a.dnsNames.set(name, { group, count: 1 });
    }
    return group;
  }

  /** One parsed mDNS message (see parseMdnsNames() in dns-resolver.js). */
  addMdns(decoded, mdns) {
    const a = this.apple;
    const seen = new Set();
    for (const name of mdns.names) {
      if (seen.has(name)) continue;
      seen.add(name);
      const service = /(_[a-z0-9-]+\._(?:tcp|udp))\.local$/.exec(name);
      if (service && service[1].indexOf('_dns-sd') === -1) {
        const entry = a.mdnsServices.get(service[1]) || { count: 0, apple: APPLE_MDNS_SERVICES.has(service[1]) };
        entry.count++;
        a.mdnsServices.set(service[1], entry);
      } else if (/^[^._][^.]*\.local$/.test(name) && a.mdnsHosts.size < MAX_TRACKED_CLIENTS) {
        a.mdnsHosts.set(name, (a.mdnsHosts.get(name) || 0) + 1);
      }
    }
  }

  appleResult() {
    const a = this.apple;
    const totalOf = (generic) => Array.from(a.groups.values()).filter((g) => g.generic === generic).reduce((sum, g) => ({ packets: sum.packets + g.packets, bytes: sum.bytes + g.bytes }), { packets: 0, bytes: 0 });
    const apple = totalOf(false);
    const empty = a.groups.size === 0 && a.dnsGroups.size === 0 && a.sniGroups.size === 0 && a.mdnsServices.size === 0;
    if (empty) return null;
    return {
      packets: apple.packets,
      bytes: apple.bytes,
      groups: Array.from(a.groups, ([name, g]) => ({ name, packets: g.packets, bytes: g.bytes, generic: g.generic })).sort((x, y) => y.packets - x.packets),
      clients: Array.from(a.clients, ([address, c]) => ({ address, packets: c.packets, bytes: c.bytes })).sort((x, y) => y.packets - x.packets).slice(0, 10),
      clientCount: a.clients.size,
      dnsGroups: Array.from(a.dnsGroups, ([name, count]) => ({ name, count })).sort((x, y) => y.count - x.count),
      dnsNames: Array.from(a.dnsNames, ([name, e]) => ({ name, group: e.group, count: e.count })).sort((x, y) => y.count - x.count).slice(0, 10),
      sniGroups: Array.from(a.sniGroups, ([name, count]) => ({ name, count })).sort((x, y) => y.count - x.count),
      mdnsServices: Array.from(a.mdnsServices, ([service, e]) => ({ service, count: e.count, apple: e.apple })).sort((x, y) => y.count - x.count).slice(0, 12),
      mdnsHosts: Array.from(a.mdnsHosts, ([name, count]) => ({ name, count })).sort((x, y) => y.count - x.count).slice(0, 10),
      mdnsHostCount: a.mdnsHosts.size,
    };
  }

  // ------------------------------------------------------- DNS servers

  getResolver(ip) {
    const r = this.resolvers;
    let entry = r.byIp.get(ip);
    if (!entry && r.byIp.size < MAX_TRACKED_RESOLVERS) {
      const { category, label } = classifyResolver(ip);
      entry = { category, label, queries: 0, responses: 0, failures: 0, clients: new Set() };
      r.byIp.set(ip, entry);
    }
    return entry || null;
  }

  /** DoT (port 853) and traffic to well-known public resolver addresses on 443 (possible DoH / DoQ). */
  addResolverTraffic(decoded) {
    const r = this.resolvers;
    let target = null;
    let suffix = '';
    if (decoded.dstPort === 853) {
      target = r.dot;
      suffix = ' (DoT)';
    } else if (decoded.dstPort === 443 && DNS_PROVIDER_BY_IP.has(decoded.dstIp)) {
      target = r.doh;
      suffix = ' (Port 443)';
    }
    if (!target) return null;
    const key = `${decoded.srcIp}|${decoded.dstIp}`;
    let entry = target.get(key);
    if (!entry && target.size < MAX_TRACKED_RESOLVERS) {
      const { category, label } = classifyResolver(decoded.dstIp);
      entry = { client: decoded.srcIp, server: decoded.dstIp, category, label, packets: 0 };
      target.set(key, entry);
    }
    if (entry) entry.packets++;
    return `${classifyResolver(decoded.dstIp).label}${suffix}`; // filter facet value: provider + how it was reached
  }

  resolversResult() {
    const r = this.resolvers;
    if (r.byIp.size === 0 && r.dot.size === 0 && r.doh.size === 0) return null;
    const byCategory = new Map();
    for (const [ip, e] of r.byIp) {
      let c = byCategory.get(e.category);
      if (!c) {
        c = { category: e.category, label: e.label, queries: 0, resolvers: 0, clients: new Set() };
        byCategory.set(e.category, c);
      }
      c.queries += e.queries;
      c.resolvers++;
      for (const client of e.clients) c.clients.add(client);
    }
    const mixedClients = [];
    for (const [client, categories] of r.clientCategories) {
      if (categories.size < 2) continue;
      const list = Array.from(categories, ([category, queries]) => ({ category, label: DNS_CATEGORY_LABELS[category], queries })).sort((x, y) => y.queries - x.queries);
      const hasManaged = list.some((c) => !isAlternativeResolverCategory(c.category));
      const hasAlternative = list.some((c) => isAlternativeResolverCategory(c.category));
      mixedClients.push({ client, categories: list, bypassHint: hasManaged && hasAlternative, queries: list.reduce((s, c) => s + c.queries, 0) });
    }
    mixedClients.sort((x, y) => Number(y.bypassHint) - Number(x.bypassHint) || y.queries - x.queries);
    const encrypted = (map) => Array.from(map.values()).sort((x, y) => y.packets - x.packets).slice(0, 8);
    return {
      listVersion: CLASSIFICATION_VERSION,
      resolvers: Array.from(r.byIp, ([ip, e]) => ({ ip, category: e.category, label: e.label, queries: e.queries, responses: e.responses, failures: e.failures, clients: e.clients.size }))
        .sort((x, y) => y.queries - x.queries)
        .slice(0, 12),
      resolverCount: r.byIp.size,
      categories: Array.from(byCategory.values()).map((c) => ({ category: c.category, label: c.label, queries: c.queries, resolvers: c.resolvers, clients: c.clients.size })).sort((x, y) => y.queries - x.queries),
      mixedClients: mixedClients.slice(0, 10),
      mixedClientCount: mixedClients.length,
      dot: encrypted(r.dot),
      doh: encrypted(r.doh),
    };
  }

  // ----------------------------------------------------- iCloud Private Relay

  getRelayClient(ip) {
    const clients = this.relay.clients;
    let client = clients.get(ip);
    if (!client && clients.size < MAX_TRACKED_CLIENTS) {
      client = { queries: 0, firstTs: null, lastTs: null, nodata: 0, nxdomain: 0, addresses: 0, blockpage: 0, servfail: 0, refused: 0, other: 0, slow: 0, sniHits: 0, packets: 0, bytes: 0, quicPackets: 0 };
      clients.set(ip, client);
    }
    return client || null;
  }

  getRelayName(name) {
    const names = this.relay.names;
    let entry = names.get(name);
    if (!entry && names.size < 50) {
      entry = { queries: 0, nodata: 0, nxdomain: 0, addresses: 0, blockpage: 0, servfail: 0, refused: 0, other: 0, latencySum: 0, latencyCount: 0, latencyMax: 0, slow: 0 };
      names.set(name, entry);
    }
    return entry || null;
  }

  /** A query for a watched name (mask.icloud.com, mask-h2.icloud.com, mask-api.icloud.com, mask.apple-dns.net, ...). */
  noteRelayQuery(decoded, message, key) {
    const relay = this.relay;
    const nameEntry = this.getRelayName(message.name);
    if (nameEntry) nameEntry.queries++;
    const client = this.getRelayClient(decoded.srcIp);
    if (client) {
      client.queries++;
      if (client.firstTs === null || decoded.timestamp < client.firstTs) client.firstTs = decoded.timestamp;
      if (client.lastTs === null || decoded.timestamp > client.lastTs) client.lastTs = decoded.timestamp;
    }
    if (relay.pending.size < RELAY_MAX_PENDING) relay.pending.set(key, { client: decoded.srcIp, name: message.name, ts: decoded.timestamp });
  }

  /** The response to a watched name: how did the network answer, and how long did it take? */
  noteRelayResponse(decoded, message, key) {
    const relay = this.relay;
    let outcome;
    if (message.rcode === 3) outcome = 'nxdomain';
    else if (message.rcode === 2) outcome = 'servfail';
    else if (message.rcode === 5) outcome = 'refused';
    else if (message.rcode !== 0) outcome = 'other';
    else if (message.addresses.length === 0) outcome = 'nodata';
    else if (message.addresses.some(isUmbrellaBlockPageAddress)) outcome = 'blockpage';
    else outcome = 'addresses';

    if (outcome === 'addresses') {
      for (const ip of message.addresses) {
        if (relay.ips.size < RELAY_MAX_IPS) relay.ips.set(ip, message.name);
      }
    }
    const nameEntry = this.getRelayName(message.name);
    const client = this.getRelayClient(decoded.dstIp);
    if (nameEntry) nameEntry[outcome]++;
    if (client) client[outcome]++;

    const pending = relay.pending.get(key);
    if (pending) {
      relay.pending.delete(key);
      const latency = decoded.timestamp - pending.ts;
      if (latency >= 0 && nameEntry) {
        nameEntry.latencySum += latency;
        nameEntry.latencyCount++;
        if (latency > nameEntry.latencyMax) nameEntry.latencyMax = latency;
        if (latency >= SLOW_DNS_SECONDS) {
          nameEntry.slow++;
          if (client) client.slow++;
        }
      }
    }
    return outcome;
  }

  /** TCP/UDP 443 to or from an address a watched name resolved to: the relay in use. */
  /** Returns true if the packet was counted as relay traffic. */
  addRelayTraffic(decoded, size) {
    const relay = this.relay;
    if (relay.ips.size === 0 || (decoded.srcPort !== 443 && decoded.dstPort !== 443)) return false;
    let clientIp = null;
    if (relay.ips.has(decoded.dstIp)) clientIp = decoded.srcIp;
    else if (relay.ips.has(decoded.srcIp)) clientIp = decoded.dstIp;
    if (!clientIp) return false;
    const client = this.getRelayClient(clientIp);
    if (!client) return false;
    bump(client, size);
    if (decoded.protocol === 'UDP') client.quicPackets++;
    return true;
  }

  relayResult() {
    const relay = this.relay;
    if (relay.names.size === 0 && relay.clients.size === 0) return null;

    const unansweredByClient = new Map();
    const unansweredByName = new Map();
    for (const p of relay.pending.values()) {
      unansweredByClient.set(p.client, (unansweredByClient.get(p.client) || 0) + 1);
      unansweredByName.set(p.name, (unansweredByName.get(p.name) || 0) + 1);
    }
    const clients = Array.from(relay.clients, ([address, c]) => {
      const unanswered = unansweredByClient.get(address) || 0;
      const errors = c.servfail + c.refused + c.other;
      const problems = [];
      if (c.blockpage > 0) problems.push('blockpage');
      if (errors > 0) problems.push('errors');
      if (unanswered > 0) problems.push('unanswered');
      if (c.slow > 0) problems.push('slow');
      let state;
      if (c.packets > 0 || c.sniHits > 0) state = 'active';
      else if (c.addresses > 0) state = 'allowed';
      else if (problems.length > 0) state = 'broken';
      else state = 'blocked';
      const span = c.firstTs !== null ? c.lastTs - c.firstTs : 0;
      return {
        address,
        state,
        problems,
        queries: c.queries,
        perMinute: span >= 30 ? (c.queries / span) * 60 : null,
        nodata: c.nodata,
        nxdomain: c.nxdomain,
        addresses: c.addresses,
        blockpage: c.blockpage,
        errors,
        unanswered,
        slow: c.slow,
        sniHits: c.sniHits,
        packets: c.packets,
        bytes: c.bytes,
        quicPackets: c.quicPackets,
      };
    }).sort((x, y) => y.problems.length - x.problems.length || y.queries - x.queries);

    return {
      listVersion: CLASSIFICATION_VERSION,
      names: Array.from(relay.names, ([name, n]) => ({
        name,
        queries: n.queries,
        nodata: n.nodata,
        nxdomain: n.nxdomain,
        addresses: n.addresses,
        blockpage: n.blockpage,
        errors: n.servfail + n.refused + n.other,
        unanswered: unansweredByName.get(name) || 0,
        avgLatency: n.latencyCount ? n.latencySum / n.latencyCount : null,
        maxLatency: n.latencyCount ? n.latencyMax : null,
        slow: n.slow,
      })).sort((x, y) => y.queries - x.queries),
      clients: clients.slice(0, 15),
      clientCount: clients.length,
      learnedAddresses: relay.ips.size,
    };
  }

  /** One TLS ClientHello / ServerHello found at the start of a TCP payload (see parseTlsHello() in tls-parser.js). */
  addTls(decoded, hello, hints = {}) {
    const t = this.tls;
    if (hello.kind === 'client') {
      t.clientHellos++;
      if (hello.sni) {
        const appleGroup = this.addAppleName(hello.sni, 'sni');
        if (appleGroup) pushHint(hints, 'apple', appleGroup);
        if (isPrivateRelayName(hello.sni)) {
          const client = this.getRelayClient(decoded.srcIp);
          if (client) client.sniHits++;
          pushHint(hints, 'relay', 'sni');
        }
      }
      return;
    }
    hints.tlsVersion = tlsVersionName(hello.version);
    if (hello.cipher !== null) hints.tlsCipher = tlsCipherInfo(hello.cipher).name;
    t.serverHellos++;
    t.versions.set(hello.version, (t.versions.get(hello.version) || 0) + 1);
    if (hello.cipher !== null) t.ciphers.set(hello.cipher, (t.ciphers.get(hello.cipher) || 0) + 1);
    if (isOutdatedTlsVersion(hello.version)) {
      const key = `${decoded.srcIp}:${decoded.srcPort}|${hello.version}`;
      if (t.outdatedServers.has(key) || t.outdatedServers.size < TLS_MAX_TRACKED_SERVERS) {
        t.outdatedServers.set(key, (t.outdatedServers.get(key) || 0) + 1);
      }
    }
  }

  tlsResult() {
    const t = this.tls;
    if (t.clientHellos === 0 && t.serverHellos === 0) return null;
    return {
      clientHellos: t.clientHellos,
      serverHellos: t.serverHellos,
      versions: Array.from(t.versions, ([version, count]) => ({ version, name: tlsVersionName(version), outdated: isOutdatedTlsVersion(version), count })).sort((x, y) => y.version - x.version),
      ciphers: Array.from(t.ciphers, ([id, count]) => ({ ...tlsCipherInfo(id), count })).sort((x, y) => y.count - x.count).slice(0, 8),
      outdatedServers: Array.from(t.outdatedServers, ([key, count]) => {
        const sep = key.lastIndexOf('|');
        return { server: key.slice(0, sep), name: tlsVersionName(Number(key.slice(sep + 1))), count };
      }).sort((x, y) => y.count - x.count).slice(0, 8),
    };
  }

  /** One parsed DNS message on UDP port 53 (see parseDnsMessage() in dns-resolver.js). */
  addDns(decoded, message, hints = {}) {
    const d = this.dns;
    if (!message.isResponse) {
      if (decoded.dstPort !== 53) return;
      d.queries++;
      const queryKey = `${decoded.srcIp}|${decoded.dstIp}|${message.id}`;
      if (d.pending.size < DNS_MAX_PENDING_QUERIES) d.pending.set(queryKey, true);
      else d.pendingCapped = true;

      const server = this.getResolver(decoded.dstIp);
      if (server) {
        hints.dnsProvider = server.label;
        server.queries++;
        if (server.clients.size < 200) server.clients.add(decoded.srcIp);
        const categories = this.resolvers.clientCategories;
        let perClient = categories.get(decoded.srcIp);
        if (!perClient && categories.size < MAX_TRACKED_CLIENTS) {
          perClient = new Map();
          categories.set(decoded.srcIp, perClient);
        }
        if (perClient) perClient.set(server.category, (perClient.get(server.category) || 0) + 1);
      }
      if (message.name) {
        const appleGroup = this.addAppleName(message.name, 'dns');
        if (appleGroup) pushHint(hints, 'apple', appleGroup);
        if (isPrivateRelayName(message.name)) {
          this.noteRelayQuery(decoded, message, queryKey);
          pushHint(hints, 'relay', 'queried');
        }
      }
      return;
    }
    if (decoded.srcPort !== 53) return;
    d.responses++;
    const responseKey = `${decoded.dstIp}|${decoded.srcIp}|${message.id}`;
    d.pending.delete(responseKey);
    d.rcodes.set(message.rcode, (d.rcodes.get(message.rcode) || 0) + 1);
    hints.dnsRcode = message.rcode;
    if (message.name && isPrivateRelayName(message.name)) {
      const outcome = this.noteRelayResponse(decoded, message, responseKey);
      pushHint(hints, 'relay', outcome === 'servfail' || outcome === 'refused' || outcome === 'other' ? 'errors' : outcome);
    }

    const resolver = d.resolvers.get(decoded.srcIp) || { responses: 0, failures: 0 };
    resolver.responses++;
    d.resolvers.set(decoded.srcIp, resolver);
    const serverEntry = this.getResolver(decoded.srcIp);
    if (serverEntry) {
      hints.dnsProvider = serverEntry.label;
      serverEntry.responses++;
      if (message.rcode !== 0) serverEntry.failures++;
    }
    if (message.rcode === 0) return;

    resolver.failures++;
    d.clients.set(decoded.dstIp, (d.clients.get(decoded.dstIp) || 0) + 1);
    const nameKey = `${message.rcode}|${message.name || '?'}`;
    if (d.failingNames.has(nameKey) || d.failingNames.size < DNS_MAX_TRACKED_NAMES) {
      d.failingNames.set(nameKey, (d.failingNames.get(nameKey) || 0) + 1);
    }
  }

  addSizeAndFragmentation(decoded, size) {
    if (size > this.maxFrameLength) this.maxFrameLength = size;
    if (decoded.ipPacketLength !== null && decoded.ipPacketLength > this.maxIpPacketLength) this.maxIpPacketLength = decoded.ipPacketLength;

    const f = this.fragmentation;
    if (decoded.ipVersion === 4) {
      f.ipv4Packets++;
      if (decoded.isFragment) f.ipv4Fragments++;
      if (decoded.dontFragment) f.dontFragment++;
    } else if (decoded.ipVersion === 6) {
      f.ipv6Packets++;
      if (decoded.isFragment) f.ipv6Fragments++;
    }
    if (decoded.isFirstFragment) f.fragmentedDatagrams++;

    if (decoded.tcpMss !== null) {
      const key = `${decoded.ipVersion}|${decoded.tcpMss}`;
      this.mssValues.set(key, (this.mssValues.get(key) || 0) + 1);
    }
    if (decoded.icmpMtu !== null) {
      const key = `${decoded.protocol}|${decoded.icmpMtu}`;
      this.icmpMtuValues.set(key, (this.icmpMtuValues.get(key) || 0) + 1);
    }
  }

  addPort(decoded, size) {
    if (decoded.srcPort === null || decoded.dstPort === null) return;
    // Same "lower port is the service side" heuristic as the connection grouping in parser.worker.js.
    const port = Math.min(decoded.srcPort, decoded.dstPort);
    const key = `${decoded.protocol}|${port}`;
    let entry = this.ports.get(key);
    if (!entry) {
      entry = { protocol: decoded.protocol, port, packets: 0, bytes: 0 };
      this.ports.set(key, entry);
    }
    bump(entry, size);
  }

  /** Counts the message; returns its `protocol|type|code` key (also the filter facet value), or null. */
  addIcmp(decoded) {
    if (decoded.icmpType === null) return null;
    const code = decoded.icmpCode === null ? 0 : decoded.icmpCode;
    const key = `${decoded.protocol}|${decoded.icmpType}|${code}`;
    let entry = this.icmp.get(key);
    if (!entry) {
      entry = { protocol: decoded.protocol, type: decoded.icmpType, code, packets: 0 };
      this.icmp.set(key, entry);
    }
    entry.packets++;
    return key;
  }

  getStream(decoded) {
    const srcEndpoint = `${decoded.srcIp}|${decoded.srcPort}`;
    const dstEndpoint = `${decoded.dstIp}|${decoded.dstPort}`;
    const srcIsA = srcEndpoint < dstEndpoint;
    const key = srcIsA ? `${srcEndpoint}>${dstEndpoint}` : `${dstEndpoint}>${srcEndpoint}`;
    let stream = this.streams.get(key);
    if (!stream) {
      stream = {
        // Endpoints as first seen, i.e. src is usually the client.
        src: `${decoded.srcIp}:${decoded.srcPort}`,
        dst: `${decoded.dstIp}:${decoded.dstPort}`,
        packets: 0,
        retransmissions: 0,
        duplicateAcks: 0,
        outOfOrder: 0,
        lostSegments: 0,
        zeroWindow: 0,
        resets: 0,
        synTs: null,
        handshakeDone: false,
        a: createTcpDirection(),
        b: createTcpDirection(),
      };
      this.streams.set(key, stream);
    }
    return { stream, me: srcIsA ? stream.a : stream.b, other: srcIsA ? stream.b : stream.a };
  }

  addTcp(decoded) {
    const flags = decoded.tcpFlags;
    const seq = decoded.tcpSeq;
    const ts = decoded.timestamp;
    const syn = (flags & TCP_SYN) !== 0;
    const fin = (flags & TCP_FIN) !== 0;
    const rst = (flags & TCP_RST) !== 0;
    const hasAck = (flags & TCP_ACK) !== 0;
    const payload = decoded.tcpPayloadLength;
    const segmentLength = payload + (syn ? 1 : 0) + (fin ? 1 : 0);

    const events = createTcpEvents(payload);
    events.fin = fin;
    const t = this.tcp;
    t.packets++;
    const flagsLabel = tcpFlagsLabel(flags);
    this.tcpFlagCombos.set(flagsLabel, (this.tcpFlagCombos.get(flagsLabel) || 0) + 1);
    if (payload > 0) t.dataSegments++;

    const { stream, me, other } = this.getStream(decoded);
    stream.packets++;

    if (rst) {
      t.resets++;
      stream.resets++;
      events.reset = true;
      return events; // a reset carries no meaningful sequence/ack state for the checks below
    }

    // A fresh SYN that isn't a retransmission of the previous one starts a new
    // connection on a re-used 4-tuple - forget the old connection's state.
    if (syn && !hasAck && me.init && ((seq - me.nextSeq) | 0) !== -1) {
      this.resetStreamState(stream);
    }

    // Handshake time: first SYN of the stream until the matching SYN/ACK.
    if (syn && !hasAck && stream.synTs === null) {
      stream.synTs = ts;
    } else if (syn && hasAck && stream.synTs !== null && !stream.handshakeDone) {
      const rtt = ts - stream.synTs;
      if (rtt >= 0) {
        stream.handshakeDone = true;
        events.handshakeRtt = rtt;
        const h = this.handshakes;
        h.count++;
        h.sum += rtt;
        h.min = h.min === null ? rtt : Math.min(h.min, rtt);
        h.max = h.max === null ? rtt : Math.max(h.max, rtt);
      }
    }

    if (decoded.tcpWindow === 0 && !syn && !fin) {
      t.zeroWindow++;
      stream.zeroWindow++;
      events.zeroWindow = true;
    }

    // Duplicate ACK: a pure ACK that repeats the previous ack/window while the
    // other side still has unacknowledged data outstanding.
    if (hasAck) {
      const isPureAck = segmentLength === 0;
      if (
        isPureAck &&
        me.lastAck === decoded.tcpAck &&
        me.lastWindow === decoded.tcpWindow &&
        other.init &&
        ((decoded.tcpAck - other.nextSeq) | 0) < 0
      ) {
        me.dupAcks++;
        t.duplicateAcks++;
        stream.duplicateAcks++;
        events.duplicateAck = true;
      } else if (me.lastAck !== decoded.tcpAck) {
        me.dupAcks = 0;
      }
      me.lastAck = decoded.tcpAck;
      me.lastWindow = decoded.tcpWindow;
    }

    if (segmentLength === 0) {
      if (me.init && ((seq - me.nextSeq) | 0) === -1) t.keepAlives++; // zero-length keep-alive probe
      if (!me.init) {
        me.init = true;
        me.nextSeq = seq;
        me.lastDataTs = ts;
      }
      return events;
    }

    const end = (seq + segmentLength) >>> 0;
    if (!me.init) {
      me.init = true;
      me.nextSeq = end;
      me.lastDataTs = ts;
      return events;
    }

    const diff = (seq - me.nextSeq) | 0;
    if (diff === 0) {
      me.nextSeq = end;
      me.lastDataTs = ts;
    } else if (diff > 0) {
      // Sequence jumped ahead: the segment(s) in between were never seen in this capture.
      t.lostSegments++;
      stream.lostSegments++;
      events.lostSegment = true;
      me.nextSeq = end;
      me.lastDataTs = ts;
    } else if (payload <= 1 && !syn && !fin && diff === -1) {
      t.keepAlives++; // keep-alive probe (one garbage byte at nextSeq-1), not a real retransmission
      events.keepAlive = true;
    } else if (ts - me.lastDataTs < OUT_OF_ORDER_WINDOW_SECONDS) {
      t.outOfOrder++;
      stream.outOfOrder++;
      events.outOfOrder = true;
    } else {
      t.retransmissions++;
      stream.retransmissions++;
      events.retransmission = true;
      if (other.dupAcks >= 3 && other.lastAck === seq) {
        t.fastRetransmissions++;
        events.fastRetransmission = true;
      }
      if (((end - me.nextSeq) | 0) > 0) me.nextSeq = end; // retransmission that also carries new bytes
    }
    return events;
  }

  resetStreamState(stream) {
    stream.a = createTcpDirection();
    stream.b = createTcpDirection();
    stream.synTs = null;
    stream.handshakeDone = false;
  }

  /** Plain, structured-clone-friendly snapshot for postMessage. */
  toResult() {
    const duration = this.firstTimestamp === null ? 0 : this.lastTimestamp - this.firstTimestamp;

    const topPorts = Array.from(this.ports.values())
      .sort((x, y) => y.packets - x.packets)
      .slice(0, TOP_PORTS_LIMIT);

    const problemStreams = Array.from(this.streams.values())
      .map((s) => ({ ...s, issues: s.retransmissions + s.duplicateAcks + s.outOfOrder + s.lostSegments + s.zeroWindow + s.resets }))
      .filter((s) => s.issues > 0)
      .sort((x, y) => y.issues - x.issues)
      .slice(0, TOP_STREAMS_LIMIT)
      .map(({ src, dst, packets, retransmissions, duplicateAcks, outOfOrder, lostSegments, zeroWindow, resets }) => ({
        src, dst, packets, retransmissions, duplicateAcks, outOfOrder, lostSegments, zeroWindow, resets,
      }));

    return {
      decodedPackets: this.decodedPackets,
      decodedBytes: this.decodedBytes,
      firstTimestamp: this.firstTimestamp,
      lastTimestamp: this.lastTimestamp,
      duration,
      byProtocol: this.byProtocol,
      byCast: this.byCast,
      byIpVersion: this.byIpVersion,
      sizeBuckets: this.sizeBuckets.map((counter, i) => ({
        upTo: i < SIZE_BUCKET_LIMITS.length ? SIZE_BUCKET_LIMITS[i] : null,
        ...counter,
      })),
      timeline: this.buildTimeline(),
      topPorts,
      icmp: Array.from(this.icmp.values()).sort((x, y) => y.packets - x.packets),
      tcpFlags: Array.from(this.tcpFlagCombos, ([label, packets]) => ({ label, packets })).sort((x, y) => y.packets - x.packets),
      tcp: { ...this.tcp, streams: this.streams.size },
      handshakes: { ...this.handshakes },
      dns: this.dnsResult(),
      tls: this.tlsResult(),
      l2: this.l2Result(),
      apple: this.appleResult(),
      dnsServers: this.resolversResult(),
      relay: this.relayResult(),
      classificationVersion: CLASSIFICATION_VERSION,
      fragmentation: { ...this.fragmentation },
      mtu: {
        maxIpPacketLength: this.maxIpPacketLength,
        maxFrameLength: this.maxFrameLength,
        // IPv4 adds 20 bytes IP + 20 bytes TCP header to the MSS, IPv6 40 + 20.
        mss: Array.from(this.mssValues, ([key, packets]) => {
          const [ipVersion, mss] = key.split('|').map(Number);
          return { ipVersion, mss, impliedMtu: mss + (ipVersion === 6 ? 60 : 40), packets };
        }).sort((x, y) => y.packets - x.packets),
        icmpReported: Array.from(this.icmpMtuValues, ([key, packets]) => {
          const [protocol, mtu] = key.split('|');
          return { protocol, mtu: Number(mtu), packets };
        }).sort((x, y) => y.packets - x.packets),
      },
      problemStreams,
    };
  }

  dnsResult() {
    const d = this.dns;
    if (d.queries === 0 && d.responses === 0) return null;
    const top = (entries, limit) => entries.sort((x, y) => y.count - x.count).slice(0, limit);
    return {
      queries: d.queries,
      responses: d.responses,
      unanswered: d.pending.size,
      unansweredCapped: d.pendingCapped,
      rcodes: Array.from(d.rcodes, ([code, count]) => ({ code, count })).sort((x, y) => y.count - x.count),
      failingNames: top(Array.from(d.failingNames, ([key, count]) => {
        const sep = key.indexOf('|');
        return { rcode: Number(key.slice(0, sep)), name: key.slice(sep + 1), count };
      }), DNS_TOP_LIMIT),
      resolvers: Array.from(d.resolvers, ([ip, r]) => ({ ip, responses: r.responses, failures: r.failures }))
        .filter((r) => r.failures > 0)
        .sort((x, y) => y.failures - x.failures)
        .slice(0, 5),
      clients: top(Array.from(d.clients, ([ip, count]) => ({ ip, count })), 5),
    };
  }

  /** Per-second counters downsampled to at most TIME_BUCKETS_MAX equally wide buckets. */
  buildTimeline() {
    if (this.perSecond.size === 0) return { start: null, bucketSeconds: 1, packets: [], bytes: [] };
    const startSecond = Math.floor(this.firstTimestamp);
    const endSecond = Math.floor(this.lastTimestamp);
    const span = endSecond - startSecond + 1;
    const bucketSeconds = Math.max(1, Math.ceil(span / TIME_BUCKETS_MAX));
    const bucketCount = Math.ceil(span / bucketSeconds);
    const packets = new Array(bucketCount).fill(0);
    const bytes = new Array(bucketCount).fill(0);
    for (const [second, [p, b]] of this.perSecond) {
      const index = Math.min(bucketCount - 1, Math.floor((second - startSecond) / bucketSeconds));
      packets[index] += p;
      bytes[index] += b;
    }
    return { start: startSecond, bucketSeconds, packets, bytes };
  }
}
