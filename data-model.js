// Communication-matrix filtering/derivation helpers, used on the main thread
// by app.js and the views. The aggregation logic that builds this data lives
// in parser.worker.js (a classic worker, so it cannot import this ES module).
// thought up by human, created by ai

export const PROTOCOL_GROUPS = {
  TCP: ['TCP'],
  UDP: ['UDP'],
  ICMP: ['ICMP', 'ICMPv6'],
  OTHER: ['ARP', 'OTHER'],
};

export function pairKey(idA, idB) {
  return idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`;
}

export function deviceLabel(device) {
  return device.hostname ? `${device.ip || device.mac} (${device.hostname})` : device.ip || device.mac;
}

// IANA ICMP/ICMPv6 type numbers, common subset (RFC 792 / RFC 4443) -
// covers everything likely to show up in a typical capture; anything else
// falls back to a generic "Typ N" label rather than being silently dropped.
const ICMP_TYPE_NAMES = {
  ICMP: {
    0: 'Echo Reply', 3: 'Destination Unreachable', 4: 'Source Quench', 5: 'Redirect',
    8: 'Echo Request', 9: 'Router Advertisement', 10: 'Router Solicitation',
    11: 'Time Exceeded', 12: 'Parameter Problem', 13: 'Timestamp', 14: 'Timestamp Reply',
  },
  ICMPv6: {
    1: 'Destination Unreachable', 2: 'Packet Too Big', 3: 'Time Exceeded', 4: 'Parameter Problem',
    128: 'Echo Request', 129: 'Echo Reply', 133: 'Router Solicitation', 134: 'Router Advertisement',
    135: 'Neighbor Solicitation', 136: 'Neighbor Advertisement', 137: 'Redirect',
  },
};

/** Human-readable name(s) for the distinct ICMP/ICMPv6 types seen in one direction, or null if none apply (e.g. non-ICMP protocols). */
export function icmpTypeLabel(protocol, types) {
  const names = protocol === 'ICMP' || protocol === 'ICMPv6' ? ICMP_TYPE_NAMES[protocol] : null;
  if (!names || !types || !types.length) return null;
  return [...new Set(types.map((t) => names[t] || `Typ ${t}`))].join(', ');
}

// Codes worth naming for "Destination Unreachable" - the other types' codes are rare enough to just show as "Code N".
const ICMP_UNREACHABLE_CODES = {
  ICMP: { 0: 'Netz', 1: 'Host', 2: 'Protokoll', 3: 'Port', 4: 'Fragmentierung nötig', 9: 'Netz gesperrt', 10: 'Host gesperrt', 13: 'Administrativ gefiltert' },
  ICMPv6: { 0: 'Keine Route', 1: 'Administrativ gefiltert', 3: 'Adresse', 4: 'Port' },
};

/** "Destination Unreachable (Port)" / "Echo Request" - one specific ICMP type + code, for the statistics view. */
export function icmpTypeCodeLabel(protocol, type, code) {
  const typeName = (ICMP_TYPE_NAMES[protocol] || {})[type] || `Typ ${type}`;
  const unreachableType = protocol === 'ICMPv6' ? 1 : 3;
  if (type === unreachableType) {
    const codeName = ICMP_UNREACHABLE_CODES[protocol][code];
    return `${typeName} (${codeName || `Code ${code}`})`;
  }
  return typeName;
}

const DNS_RCODE_NAMES = { 0: 'NOERROR', 1: 'FORMERR', 2: 'SERVFAIL', 3: 'NXDOMAIN', 4: 'NOTIMP', 5: 'REFUSED' };

export function dnsRcodeName(code) {
  return DNS_RCODE_NAMES[code] || `RCODE ${code}`;
}

/**
 * Escapes text that comes out of a capture file (DNS hostnames in particular
 * are raw bytes chosen by whoever sent the packet) before it is put into an
 * innerHTML string. The CSP already blocks script execution, but without
 * escaping a crafted hostname could still inject markup into tooltips.
 */
export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// Health level -> design-system severity badge. The symbol keeps the level
// readable without colour (print, colour blindness).
const SEVERITY_BADGE = { ok: ['s1', '✓'], warn: ['s2', '◆'], bad: ['s4', '✖'] };

/** Status badge (`.sev` of the design system) for a health level ok/warn/bad; any other level gets a neutral pill. */
export function healthBadge(level, text) {
  const badge = SEVERITY_BADGE[level];
  if (!badge) return `<span class="pill">${escapeHtml(text)}</span>`;
  return `<span class="sev ${badge[0]}">${badge[1]} ${escapeHtml(text)}</span>`;
}

/** 'ipv4' | 'ipv6' | 'mac' (device known only by MAC address, e.g. from malformed ARP). */
export function addressFamilyOf(device) {
  if (device.kind !== 'ip' || !device.ip) return 'mac';
  return device.ip.includes(':') ? 'ipv6' : 'ipv4';
}

function ipv4SortKey(ip) {
  return ip.split('.').map(Number);
}

function ipv6SortKey(ip) {
  const [head, tail] = ip.split('::');
  const headGroups = head ? head.split(':') : [];
  const tailGroups = tail ? tail.split(':') : [];
  const missing = 8 - headGroups.length - tailGroups.length;
  const groups = ip.includes('::')
    ? [...headGroups, ...Array(Math.max(0, missing)).fill('0'), ...tailGroups]
    : ip.split(':');
  return groups.map((g) => parseInt(g, 16));
}

function compareNumericArrays(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Ascending comparator for the matrix/graph device order: numeric per address family, MAC devices last (by MAC string). */
export function compareDevicesByAddress(a, b) {
  const familyA = addressFamilyOf(a);
  const familyB = addressFamilyOf(b);
  if (familyA !== familyB) return familyA === 'mac' ? 1 : familyB === 'mac' ? -1 : familyA.localeCompare(familyB);
  if (familyA === 'mac') return (a.mac || '').localeCompare(b.mac || '');
  const keyFn = familyA === 'ipv4' ? ipv4SortKey : ipv6SortKey;
  return compareNumericArrays(keyFn(a.ip), keyFn(b.ip));
}

// Common IANA-registered service ports, purely for a human-readable hint in
// the port filter list (e.g. "22 (SSH)") - not exhaustive, unknown ports
// simply show without a parenthetical instead of being hidden or guessed at.
export const WELL_KNOWN_PORTS = {
  20: 'FTP-Data', 21: 'FTP', 22: 'SSH', 23: 'Telnet', 25: 'SMTP', 53: 'DNS',
  67: 'DHCP-Server', 68: 'DHCP-Client', 69: 'TFTP', 80: 'HTTP', 110: 'POP3',
  111: 'RPCbind', 119: 'NNTP', 123: 'NTP', 137: 'NetBIOS-NS', 138: 'NetBIOS-DGM',
  139: 'NetBIOS-SSN', 143: 'IMAP', 161: 'SNMP', 162: 'SNMP-Trap', 179: 'BGP',
  194: 'IRC', 389: 'LDAP', 443: 'HTTPS', 445: 'SMB', 465: 'SMTPS', 514: 'Syslog',
  515: 'LPD', 587: 'SMTP-Submission', 631: 'IPP', 636: 'LDAPS', 993: 'IMAPS',
  995: 'POP3S', 1194: 'OpenVPN', 1433: 'MSSQL', 1521: 'Oracle-DB', 1723: 'PPTP',
  1883: 'MQTT', 1900: 'SSDP', 2049: 'NFS', 3128: 'HTTP-Proxy', 3306: 'MySQL',
  3389: 'RDP', 5060: 'SIP', 5061: 'SIP-TLS', 5222: 'XMPP', 5353: 'mDNS',
  5432: 'PostgreSQL', 5683: 'CoAP', 5900: 'VNC', 6379: 'Redis', 6667: 'IRC',
  8080: 'HTTP-Alt', 8443: 'HTTPS-Alt', 8883: 'MQTT(S)', 9200: 'Elasticsearch',
  27017: 'MongoDB',
};

export function wellKnownPortName(port) {
  return WELL_KNOWN_PORTS[port] || null;
}

/** "22 (SSH)" if the port is a recognized well-known service, otherwise just "22". */
export function portListLabel(port) {
  const name = wellKnownPortName(port);
  return name ? `${port} (${name})` : String(port);
}

/**
 * Ports actually used in the capture (grouped by TCP/UDP, ICMP/ARP have no
 * ports so are never included), one entry per distinct (protocol, port)
 * combination, each carrying every device involved in a connection over it -
 * used to drive the sidebar's port filter list (see app.js), where selecting
 * a port selects all of its participating devices in one step.
 */
export function computePortEntries(connections) {
  const byKey = new Map();
  for (const connection of connections) {
    if (connection.port == null) continue;
    const group = protocolGroupOf(connection.protocol);
    if (group !== 'TCP' && group !== 'UDP') continue;
    const key = `${group}|${connection.port}`;
    let entry = byKey.get(key);
    if (!entry) {
      entry = { port: connection.port, protocolGroup: group, deviceIds: new Set(), packets: 0, bytes: 0 };
      byKey.set(key, entry);
    }
    entry.deviceIds.add(connection.a);
    entry.deviceIds.add(connection.b);
    entry.packets += connection.packets;
    entry.bytes += connection.bytes;
  }
  return Array.from(byKey.values()).sort((a, b) => a.port - b.port || a.protocolGroup.localeCompare(b.protocolGroup));
}

export function protocolGroupOf(protocol) {
  for (const [group, members] of Object.entries(PROTOCOL_GROUPS)) {
    if (members.includes(protocol)) return group;
  }
  return 'OTHER';
}

/**
 * The connections (device pair + protocol + service port) that pass the sidebar
 * selection (both endpoints selected), the protocol chips, "Multicast/Broadcast
 * ausblenden", "Nur Probleme" and - via `extraPredicate`, built from the filter
 * chips in filters.js - any further criterion. Every view takes its data from
 * this one list (matrix and graph via derivePairs()), so they never disagree.
 */
export function computeVisibleConnections(connections, selectedIds, activeGroups, hideMulticast, onlyProblems = false, extraPredicate = null) {
  return connections.filter((connection) => {
    if (!selectedIds.has(connection.a) || !selectedIds.has(connection.b)) return false;
    if (hideMulticast && connection.multicastOrBroadcast) return false;
    if (onlyProblems && !(connection.problems > 0)) return false;
    if (!activeGroups.has(protocolGroupOf(connection.protocol))) return false;
    if (extraPredicate && !extraPredicate(connection)) return false;
    return true;
  });
}

const TCP_SUMMARY_SUM_FIELDS = ['dataSegments', 'retransmissions', 'fastRetransmissions', 'duplicateAcks', 'outOfOrder', 'lostSegments', 'zeroWindow', 'resets', 'fins', 'handshakeCount', 'handshakeSum'];

function emptyDirection() {
  return { packets: 0, bytes: 0, problems: 0, srcPorts: new Set(), dstPorts: new Set(), firstSeen: null, lastSeen: null };
}

function addToDirection(target, direction) {
  if (!direction || direction.packets === 0) return;
  target.packets += direction.packets;
  target.bytes += direction.bytes;
  target.problems += direction.problems;
  for (const port of direction.srcPorts) target.srcPorts.add(port);
  for (const port of direction.dstPorts) target.dstPorts.add(port);
  if (target.firstSeen === null || direction.firstSeen < target.firstSeen) target.firstSeen = direction.firstSeen;
  if (target.lastSeen === null || direction.lastSeen > target.lastSeen) target.lastSeen = direction.lastSeen;
}

function finishDirection(direction) {
  return { ...direction, srcPorts: Array.from(direction.srcPorts), dstPorts: Array.from(direction.dstPorts) };
}

/**
 * One entry per device pair, built from a list of connections: the pair's totals,
 * per-direction totals, per-device ports and per-protocol breakdown are sums over
 * its connections. With the full connection list this is the whole capture; with
 * the visible connections it is exactly what the matrix, graph and Excel export
 * should show for the current filters (so e.g. a protocol chip also reduces the
 * packet counts of a pair, not just hides pairs).
 *
 * `a`/`b` are the sender of the pair's first connection (by first-seen time), like
 * "who spoke first" everywhere else; port lists and the protocol list are in
 * order of first appearance.
 */
export function derivePairs(connections) {
  const ordered = connections.length > 1 ? [...connections].sort((x, y) => x.firstSeen - y.firstSeen) : connections;
  const byKey = new Map();

  for (const c of ordered) {
    const key = pairKey(c.a, c.b);
    let pair = byKey.get(key);
    if (!pair) {
      pair = {
        a: c.a,
        b: c.b,
        packets: 0,
        bytes: 0,
        problems: 0,
        tcp: null,
        protocols: [],
        portsA: new Set(),
        portsB: new Set(),
        firstSeen: c.firstSeen,
        lastSeen: c.lastSeen,
        multicastOrBroadcast: false,
        aToB: emptyDirection(),
        bToA: emptyDirection(),
        byProtocol: new Map(),
      };
      byKey.set(key, pair);
    }

    pair.packets += c.packets;
    pair.bytes += c.bytes;
    pair.problems += c.problems || 0;
    if (c.firstSeen < pair.firstSeen) pair.firstSeen = c.firstSeen;
    if (c.lastSeen > pair.lastSeen) pair.lastSeen = c.lastSeen;
    if (c.multicastOrBroadcast) pair.multicastOrBroadcast = true;
    if (c.protocol && !pair.protocols.includes(c.protocol)) pair.protocols.push(c.protocol);

    if (c.tcp) {
      if (!pair.tcp) pair.tcp = { ...Object.fromEntries(TCP_SUMMARY_SUM_FIELDS.map((field) => [field, 0])), handshakeMax: 0, problemTimes: null };
      for (const field of TCP_SUMMARY_SUM_FIELDS) pair.tcp[field] += c.tcp[field];
      pair.tcp.handshakeMax = Math.max(pair.tcp.handshakeMax, c.tcp.handshakeMax);
    }

    // The connection's own directions are a->b / b->a of ITS first sender; map them onto the pair's a/b.
    const sentByA = c.a === pair.a ? c.aToB : c.bToA;
    const sentByB = c.a === pair.a ? c.bToA : c.aToB;
    addToDirection(pair.aToB, sentByA);
    addToDirection(pair.bToA, sentByB);
    for (const port of sentByA.srcPorts) pair.portsA.add(port);
    for (const port of sentByA.dstPorts) pair.portsB.add(port);
    for (const port of sentByB.srcPorts) pair.portsB.add(port);
    for (const port of sentByB.dstPorts) pair.portsA.add(port);

    const protocolKey = c.protocol || 'OTHER';
    let entry = pair.byProtocol.get(protocolKey);
    if (!entry) {
      entry = { protocol: protocolKey, packets: 0, bytes: 0, portsA: new Set(), portsB: new Set(), firstSeen: c.firstSeen, lastSeen: c.lastSeen, multicastOrBroadcast: false };
      pair.byProtocol.set(protocolKey, entry);
    }
    entry.packets += c.packets;
    entry.bytes += c.bytes;
    if (c.firstSeen < entry.firstSeen) entry.firstSeen = c.firstSeen;
    if (c.lastSeen > entry.lastSeen) entry.lastSeen = c.lastSeen;
    if (c.multicastOrBroadcast) entry.multicastOrBroadcast = true;
    for (const port of sentByA.srcPorts) entry.portsA.add(port);
    for (const port of sentByA.dstPorts) entry.portsB.add(port);
    for (const port of sentByB.srcPorts) entry.portsB.add(port);
    for (const port of sentByB.dstPorts) entry.portsA.add(port);
  }

  return Array.from(byKey.values()).map((pair) => {
    const { byProtocol, ...rest } = pair;
    return {
      ...rest,
      portsA: Array.from(pair.portsA),
      portsB: Array.from(pair.portsB),
      aToB: finishDirection(pair.aToB),
      bToA: finishDirection(pair.bToA),
      protocolBreakdown: Array.from(byProtocol.values()).map((entry) => ({ ...entry, portsA: Array.from(entry.portsA), portsB: Array.from(entry.portsB) })),
    };
  });
}

/** IDs of `deviceId` itself plus every device it has at least one pair with (direct communication partners only, not transitive). */
export function relatedDeviceIds(pairs, deviceId) {
  const related = new Set([deviceId]);
  for (const pair of pairs) {
    if (pair.a === deviceId) related.add(pair.b);
    else if (pair.b === deviceId) related.add(pair.a);
  }
  return related;
}

/** 'problems' = retransmits + sequence gaps + resets + zero-window events + ICMP errors (see problemCountOf() in parser.worker.js). */
/**
 * Per-device sent/received totals over ALL pairs (the statistics view covers the
 * whole capture, independent of the sidebar filters). A pair's aToB traffic was
 * sent by pair.a and received by pair.b, bToA the other way round.
 */
export function computeDeviceTraffic(pairs) {
  const byId = new Map();
  const entry = (id) => {
    let e = byId.get(id);
    if (!e) {
      e = { id, sentPackets: 0, sentBytes: 0, receivedPackets: 0, receivedBytes: 0 };
      byId.set(id, e);
    }
    return e;
  };
  for (const pair of pairs) {
    for (const [sender, receiver, directional] of [[pair.a, pair.b, pair.aToB], [pair.b, pair.a, pair.bToA]]) {
      if (!directional || directional.packets === 0) continue;
      const s = entry(sender);
      const r = entry(receiver);
      s.sentPackets += directional.packets;
      s.sentBytes += directional.bytes;
      r.receivedPackets += directional.packets;
      r.receivedBytes += directional.bytes;
    }
  }
  return Array.from(byId.values());
}

export function metricValue(pair, metric) {
  if (metric === 'bytes') return pair.bytes;
  if (metric === 'problems') return pair.problems || 0;
  return pair.packets;
}

/**
 * Traffic-quality verdict for a pair or connection (anything carrying
 * `problems` and, for TCP, a `tcp` summary): 'ok' without any problem event,
 * 'bad' ("Instabil") once retransmits are frequent (>= 3 and >= 2 % of the
 * data segments - an unanswered, endlessly retried SYN counts as 100 %), 'warn'
 * ("Auffällig") for anything else that produced a problem event.
 */
export function healthOf(entry) {
  const problems = entry.problems || 0;
  if (problems === 0) return { level: 'ok', label: 'OK', retransmitRate: 0 };
  const tcp = entry.tcp;
  if (!tcp) return { level: 'warn', label: 'ICMP-Fehler', retransmitRate: 0 };
  const retransmitRate = tcp.retransmissions / Math.max(tcp.dataSegments, tcp.retransmissions, 1);
  if (tcp.retransmissions >= 3 && retransmitRate >= 0.02) return { level: 'bad', label: 'Instabil', retransmitRate };
  let label = 'Auffällig';
  if (tcp.retransmissions > 0) label = 'Retransmits';
  else if (tcp.resets > 0) label = 'Reset';
  else if (tcp.lostSegments > 0) label = 'Lücken';
  else if (tcp.zeroWindow > 0) label = 'Zero-Window';
  return { level: 'warn', label, retransmitRate };
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

const secondsFormat = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });

/** "84 ms" below one second, otherwise "1,5 s" - for handshake times and similar short intervals. */
export function formatSeconds(seconds) {
  if (seconds < 1) return `${secondsFormat.format(seconds * 1000)} ms`;
  return `${secondsFormat.format(seconds)} s`;
}

export function formatTimestamp(seconds) {
  if (!Number.isFinite(seconds)) return '–';
  return new Date(seconds * 1000).toLocaleString('de-DE');
}
