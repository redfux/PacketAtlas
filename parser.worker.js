// Web Worker: owns the entire parse -> decode -> aggregate pipeline so the
// main thread (and the UI) stays responsive even for very large captures.
//
// This is deliberately a CLASSIC (non-module) worker using importScripts(),
// not `new Worker(url, { type: 'module' })`: module workers are a relatively
// recent addition and are unsupported or unreliable in some browsers (e.g.
// Firefox only added support in version 114, mid-2023), which manifests as a
// cryptic, content-independent "undefined" error on worker construction.
// importScripts() has been supported everywhere for well over a decade.
// thought up by human, created by ai

// Derived from this worker's own URL rather than a hardcoded constant:
// app.js constructs `new Worker('parser.worker.js?v=' + APP_VERSION)`, so the
// same version string is already sitting in self.location's query string.
// importScripts() fetches are plain classic-script requests the browser can
// cache independently of whatever cache-busting the worker's own URL got -
// without reusing that same query string here, these could still be served
// stale after an update even though parser.worker.js itself was freshly
// fetched. Reusing it (instead of a second hardcoded constant) means
// APP_VERSION in app.js is the only place a release bump has to happen.
const WORKER_VERSION = new URL(self.location.href).searchParams.get('v') || '0';
importScripts(
  `pcap-parser.js?v=${WORKER_VERSION}`,
  `pcapng-parser.js?v=${WORKER_VERSION}`,
  `packet-decoder.js?v=${WORKER_VERSION}`,
  `dns-resolver.js?v=${WORKER_VERSION}`,
  `traffic-stats.js?v=${WORKER_VERSION}`,
  `tls-parser.js?v=${WORKER_VERSION}`,
  `l2-parser.js?v=${WORKER_VERSION}`,
  `classification.js?v=${WORKER_VERSION}`,
  `capture-scope.js?v=${WORKER_VERSION}`,
);

// Per pair / connection TCP quality counters (see traffic-stats.js for how the
// events are detected). `problemTimes` (timestamps of retransmits/gaps/resets/
// zero-window events, capped) is only kept on connections, where the detail
// view draws it as a mini timeline; pair-level summaries only need the totals.
const MAX_PROBLEM_TIMES = 200;

function createTcpSummary(withTimes) {
  return {
    dataSegments: 0,
    retransmissions: 0,
    fastRetransmissions: 0,
    duplicateAcks: 0,
    outOfOrder: 0,
    lostSegments: 0,
    zeroWindow: 0,
    resets: 0,
    fins: 0,
    handshakeCount: 0,
    handshakeSum: 0,
    handshakeMax: 0,
    problemTimes: withTimes ? [] : null,
  };
}

function accumulateTcpEvents(summary, events, timestamp) {
  if (events.dataSegment) summary.dataSegments++;
  if (events.retransmission) summary.retransmissions++;
  if (events.fastRetransmission) summary.fastRetransmissions++;
  if (events.duplicateAck) summary.duplicateAcks++;
  if (events.outOfOrder) summary.outOfOrder++;
  if (events.lostSegment) summary.lostSegments++;
  if (events.zeroWindow) summary.zeroWindow++;
  if (events.reset) summary.resets++;
  if (events.fin) summary.fins++;
  if (events.handshakeRtt !== null) {
    summary.handshakeCount++;
    summary.handshakeSum += events.handshakeRtt;
    summary.handshakeMax = Math.max(summary.handshakeMax, events.handshakeRtt);
  }
  if (
    summary.problemTimes &&
    summary.problemTimes.length < MAX_PROBLEM_TIMES &&
    (events.retransmission || events.lostSegment || events.reset || events.zeroWindow)
  ) {
    summary.problemTimes.push(timestamp);
  }
}

/** ICMP/ICMPv6 error messages (unreachable, time exceeded, parameter problem, packet too big) count as problems too. */
function isIcmpError(decoded) {
  if (decoded.protocol === 'ICMP') return decoded.icmpType === 3 || decoded.icmpType === 11 || decoded.icmpType === 12;
  if (decoded.protocol === 'ICMPv6') return decoded.icmpType >= 1 && decoded.icmpType <= 4;
  return false;
}

/**
 * How many "problem events" one packet represents: TCP retransmission, missing
 * segment (sequence gap), reset, zero window, or an ICMP error message. Dup-ACKs
 * and reordering are deliberately NOT counted - they are symptoms of the same
 * loss/reordering and would double count it.
 */
function problemCountOf(decoded, tcpEvents) {
  let count = isIcmpError(decoded) ? 1 : 0;
  if (tcpEvents) {
    if (tcpEvents.retransmission) count++;
    if (tcpEvents.lostSegment) count++;
    if (tcpEvents.reset) count++;
    if (tcpEvents.zeroWindow) count++;
  }
  return count;
}

function createConnectionDirectional(decoded) {
  // Unlike a Pair's directional entry, a Connection is already scoped to one
  // protocol + service port, so a single representative srcPort/dstPort (from
  // the first packet seen in this direction) is enough - no need for a Set.
  // ICMP/ICMPv6 have no ports at all, so a connection groups ALL of a pair's
  // ICMP traffic together regardless of type (echo request, echo reply, ...);
  // icmpTypes tracks the distinct types actually seen in this direction so
  // the Connections view can show e.g. "Echo Request" instead of just "ICMP".
  // srcPorts/dstPorts hold EVERY port seen in this direction (not just the representative one above):
  // the pair-level port lists are derived from them (see derivePairs() in data-model.js).
  return { packets: 0, bytes: 0, problems: 0, srcPort: decoded.srcPort, dstPort: decoded.dstPort, srcPorts: new Set(), dstPorts: new Set(), icmpTypes: new Set(), firstSeen: decoded.timestamp, lastSeen: decoded.timestamp };
}

function serializeConnectionDirectional(entry) {
  if (!entry) return { packets: 0, bytes: 0, problems: 0, srcPort: null, dstPort: null, srcPorts: [], dstPorts: [], icmpTypes: [], firstSeen: null, lastSeen: null };
  return { ...entry, icmpTypes: Array.from(entry.icmpTypes), srcPorts: Array.from(entry.srcPorts), dstPorts: Array.from(entry.dstPorts) };
}

/**
 * Attributes a connection carries for the filter chips (see filters.js): what the
 * packets on it revealed about TLS, DNS, Private Relay, Apple services, ICMP and
 * fragmentation. Created lazily - most connections never get one.
 */
function createConnectionFacets() {
  return {
    tlsVersions: new Set(),
    tlsCiphers: new Set(),
    icmp: new Set(),
    dnsRcodes: new Set(),
    dnsProviders: new Set(),
    relay: new Set(),
    apple: new Set(),
    fragments: false,
  };
}

function accumulateFacets(facets, hints) {
  if (hints.tlsVersion) facets.tlsVersions.add(hints.tlsVersion);
  if (hints.tlsCipher) facets.tlsCiphers.add(hints.tlsCipher);
  if (hints.icmp) facets.icmp.add(hints.icmp);
  if (hints.dnsRcode !== undefined) facets.dnsRcodes.add(hints.dnsRcode);
  if (hints.dnsProvider) facets.dnsProviders.add(hints.dnsProvider);
  if (hints.relay) for (const value of hints.relay) facets.relay.add(value);
  if (hints.apple) for (const value of hints.apple) facets.apple.add(value);
  if (hints.fragment) facets.fragments = true;
}

function serializeFacets(facets) {
  return {
    tlsVersions: Array.from(facets.tlsVersions),
    tlsCiphers: Array.from(facets.tlsCiphers),
    icmp: Array.from(facets.icmp),
    dnsRcodes: Array.from(facets.dnsRcodes),
    dnsProviders: Array.from(facets.dnsProviders),
    relay: Array.from(facets.relay),
    apple: Array.from(facets.apple),
    fragments: facets.fragments,
  };
}

/**
 * Accumulates decoded frames into device, pair, and connection aggregates
 * using Map structures, so each frame only costs O(1) lookups/updates
 * regardless of total packet count - true for all three, unlike a per-packet
 * log would be, so nothing here needs a size cap independent of capture size.
 */
class Aggregator {
  constructor() {
    this.devices = new Map();
    this.connections = new Map();
    this.hostnames = new Map();
    this.macNames = new Map(); // MAC -> name announced via CDP/LLDP
  }

  getOrCreateDevice(id, kind, ip, mac) {
    let device = this.devices.get(id);
    if (!device) {
      device = { id, kind, ip: ip || null, mac: mac || null, hostname: this.hostnames.get(ip) || null, packetCount: 0, byteCount: 0 };
      this.devices.set(id, device);
    } else if (mac && !device.mac) {
      device.mac = mac;
    }
    return device;
  }

  addPacket(decoded, tcpEvents, hints) {
    // Layer-2 control frames (STP, CDP, LLDP, ...) only feed the statistics: their
    // multicast destination MACs must not become "devices" in the matrix.
    const connectionKey = connectionKeyOf(decoded);
    if (connectionKey === null) return;

    const srcId = decoded.srcIp || decoded.srcMac;
    const dstId = decoded.dstIp || decoded.dstMac;

    const srcDevice = this.getOrCreateDevice(srcId, decoded.srcIp ? 'ip' : 'mac', decoded.srcIp, decoded.srcMac);
    const dstDevice = this.getOrCreateDevice(dstId, decoded.dstIp ? 'ip' : 'mac', decoded.dstIp, decoded.dstMac);
    srcDevice.packetCount++;
    srcDevice.byteCount += decoded.frameLength;
    dstDevice.packetCount++;
    dstDevice.byteCount += decoded.frameLength;

    const problems = problemCountOf(decoded, tcpEvents);

    const servicePort = servicePortOf(decoded);
    let connection = this.connections.get(connectionKey);
    if (!connection) {
      connection = {
        key: connectionKey, // also what the PCAP export and the scoped statistics use to refer to this connection
        a: srcId,
        b: dstId,
        protocol: decoded.protocol,
        port: servicePort,
        // Source/destination port of the packet that first opened this
        // connection entry - representative of the flow's direction, since
        // service-port grouping otherwise merges both directions together.
        srcPort: decoded.srcPort,
        dstPort: decoded.dstPort,
        packets: 0,
        bytes: 0,
        problems: 0,
        tcp: null,
        facets: null,
        firstSeen: decoded.timestamp,
        lastSeen: decoded.timestamp,
        multicastOrBroadcast: false,
        // Per-direction sub-aggregates, same rationale as pair.aToB/bToA:
        // a connection currently merges both directions into one combined
        // total, which hides e.g. a TCP reply entirely. The Connections view
        // uses these to draw a separate, grouped reply arrow when present.
        aToB: null,
        bToA: null,
      };
      this.connections.set(connectionKey, connection);
    }
    connection.packets++;
    connection.bytes += decoded.frameLength;
    connection.problems += problems;
    if (tcpEvents) {
      if (!connection.tcp) connection.tcp = createTcpSummary(true);
      accumulateTcpEvents(connection.tcp, tcpEvents, decoded.timestamp);
    }
    if (hints && Object.keys(hints).length > 0) {
      if (!connection.facets) connection.facets = createConnectionFacets();
      accumulateFacets(connection.facets, hints);
    }
    if (decoded.timestamp < connection.firstSeen) connection.firstSeen = decoded.timestamp;
    if (decoded.timestamp > connection.lastSeen) connection.lastSeen = decoded.timestamp;
    if (decoded.multicastOrBroadcast) connection.multicastOrBroadcast = true;

    const connectionDirectionKey = srcId === connection.a ? 'aToB' : 'bToA';
    if (!connection[connectionDirectionKey]) connection[connectionDirectionKey] = createConnectionDirectional(decoded);
    const connectionDirectional = connection[connectionDirectionKey];
    connectionDirectional.packets++;
    connectionDirectional.bytes += decoded.frameLength;
    connectionDirectional.problems += problems;
    if (decoded.srcPort != null) connectionDirectional.srcPorts.add(decoded.srcPort);
    if (decoded.dstPort != null) connectionDirectional.dstPorts.add(decoded.dstPort);
    if (decoded.icmpType != null) connectionDirectional.icmpTypes.add(decoded.icmpType);
    if (decoded.timestamp < connectionDirectional.firstSeen) connectionDirectional.firstSeen = decoded.timestamp;
    if (decoded.timestamp > connectionDirectional.lastSeen) connectionDirectional.lastSeen = decoded.timestamp;
  }

  /** Names switches/APs announce about themselves (CDP/LLDP) as fallback labels; DNS names win. */
  addAnnouncedNames(list) {
    for (const { mac, ip, name } of list) {
      if (mac && !this.macNames.has(mac)) this.macNames.set(mac, name);
      if (ip && !this.hostnames.has(ip)) this.addHostname(ip, name);
    }
  }

  addHostname(ip, hostname) {
    if (!ip || !hostname) return;
    this.hostnames.set(ip, hostname);
    const device = this.devices.get(ip);
    if (device && !device.hostname) device.hostname = hostname;
  }

  /** Serializes Maps/Sets into plain, structured-clone-friendly data. */
  toResult() {
    for (const device of this.devices.values()) {
      if (!device.hostname && device.ip) device.hostname = this.hostnames.get(device.ip) || null;
      // Only for devices known by MAC alone: an IP device's `mac` is whatever frame was seen first
      // (usually the router's), so naming it after that MAC would label whole subnets wrongly.
      if (!device.hostname && device.kind === 'mac') device.hostname = this.macNames.get(device.id) || null;
    }
    return {
      devices: Array.from(this.devices.values()),
      connections: Array.from(this.connections.values()).map((c) => {
        const { aToB, bToA, facets, ...rest } = c;
        return { ...rest, facets: facets ? serializeFacets(facets) : null, aToB: serializeConnectionDirectional(aToB), bToA: serializeConnectionDirectional(bToA) };
      }),
    };
  }
}

// The capture itself stays in the worker after parsing (up to this size) so statistics can be
// recomputed for any subset of connections without the page holding the file. While a capture
// is open this costs its size in memory - the same amount reading it needed at its peak.
const MAX_RETAINED_BYTES = 1024 * 1024 * 1024;
let retainedBuffer = null;
let latestScopeRequest = 0;
// How many packets a scoped recomputation processes before it lets a newer request in.
const SCOPE_YIELD_EVERY = 5000;

self.onmessage = (event) => {
  const data = event.data;
  if (data.type === 'scope') {
    computeScopedStats(data).catch((err) => {
      self.postMessage({ type: 'scopeError', requestId: data.requestId, message: (err && (err.message || String(err))) || 'Unbekannter Fehler bei der Auswertung.' });
    });
    return;
  }
  if (data.type === 'export') {
    exportScope(data);
    return;
  }
  try {
    processBuffer(data.buffer);
  } catch (err) {
    self.postMessage({ type: 'error', message: (err && (err.message || String(err))) || 'Unbekannter Parsing-Fehler.' });
  }
};

/**
 * Everything the analysers take from one decoded packet: TrafficStats counters, TLS
 * hello, mDNS/DNS names, layer-2 details. Used by the full pass and the scoped pass, so
 * both produce identical numbers for the same packets. `hints` collects what the packet
 * reveals about its connection; `aggregator` (full pass only) also learns host names.
 * Returns the TCP analysis events (null for non-TCP packets).
 */
function analysePacket(buffer, frame, decoded, stats, hints, aggregator) {
  const tcpEvents = stats.add(decoded, hints);
  // TLS handshake sniffing: a TCP payload that starts with a ClientHello/ServerHello record.
  // Retransmitted segments are skipped so one handshake isn't counted twice.
  if (tcpEvents && tcpEvents.dataSegment && !tcpEvents.retransmission && decoded.headerEndOffset != null) {
    const available = Math.min(decoded.tcpPayloadLength, frame.offset + frame.length - decoded.headerEndOffset);
    const tls = available > 0 ? parseTlsHello(buffer, decoded.headerEndOffset, available) : null;
    if (tls) stats.addTls(decoded, tls, hints);
  }
  if (decoded.protocol === 'L2') stats.addL2(decoded, parseL2Details(buffer, decoded));
  if (decoded.udpPayloadOffset != null && (decoded.srcPort === 5353 || decoded.dstPort === 5353)) {
    const mdns = parseMdnsNames(buffer, decoded.udpPayloadOffset, decoded.udpPayloadLength);
    if (mdns) stats.addMdns(decoded, mdns);
  }
  if (decoded.udpPayloadOffset != null && (decoded.srcPort === DNS_PORT || decoded.dstPort === DNS_PORT)) {
    const dnsMessage = parseDnsMessage(buffer, decoded.udpPayloadOffset, decoded.udpPayloadLength);
    if (dnsMessage) stats.addDns(decoded, dnsMessage, hints);
    if (aggregator) {
      for (const { ip, hostname } of extractDnsHostnames(buffer, decoded.udpPayloadOffset, decoded.udpPayloadLength)) {
        aggregator.addHostname(ip, hostname);
      }
    }
  }
  return tcpEvents;
}

function processBuffer(buffer) {
  retainedBuffer = null;
  const frames = parseFrames(buffer);

  const aggregator = new Aggregator();
  const trafficStats = new TrafficStats();
  const totalBytes = buffer.byteLength || 1;
  let processedBytes = 0;
  let packetCount = 0;
  let lastProgressPost = 0;

  for (const frame of frames) {
    const decoded = decodeFrame(buffer, frame.offset, frame.length, frame.linkType, frame.timestamp, frame.origLen);
    if (decoded) {
      // What this packet reveals about its connection (TLS, DNS, relay, Apple, ...); the
      // analysers fill it, the Aggregator stores it as the connection's filter facets.
      const hints = {};
      const tcpEvents = analysePacket(buffer, frame, decoded, trafficStats, hints, aggregator);
      aggregator.addPacket(decoded, tcpEvents, hints);
    }

    packetCount++;
    processedBytes += frame.bytesConsumed;
    if (processedBytes - lastProgressPost > totalBytes / 200 || packetCount % 5000 === 0) {
      lastProgressPost = processedBytes;
      self.postMessage({
        type: 'progress',
        percent: Math.min(100, Math.round((processedBytes / totalBytes) * 100)),
        packetCount,
      });
    }
  }

  aggregator.addAnnouncedNames(trafficStats.l2DeviceNames());
  const result = aggregator.toResult();
  if (buffer.byteLength <= MAX_RETAINED_BYTES) retainedBuffer = buffer;
  self.postMessage({
    type: 'result',
    devices: result.devices,
    connections: result.connections,
    stats: { ...trafficStats.toResult(), totalPackets: packetCount },
    packetCount,
    scopeAvailable: retainedBuffer !== null,
  });
}

/**
 * Statistics for just the packets of the given connections (`keys`, see connectionKeyOf()),
 * exactly as the full pass would have computed them had the capture contained nothing else.
 * Layer-2 control frames belong to no connection and are therefore never part of a scope.
 * A newer request makes an older one stop at its next yield - the user has already moved on.
 */
async function computeScopedStats({ requestId, keys }) {
  latestScopeRequest = requestId;
  const buffer = retainedBuffer;
  if (!buffer) throw new Error('Die Datei wird nicht mehr im Speicher gehalten.');
  const scope = new Set(keys);
  const stats = new TrafficStats();
  let processed = 0;
  for (const frame of parseFrames(buffer)) {
    const decoded = decodeFrame(buffer, frame.offset, frame.length, frame.linkType, frame.timestamp, frame.origLen);
    if (decoded) {
      const key = connectionKeyOf(decoded);
      if (key !== null && scope.has(key)) analysePacket(buffer, frame, decoded, stats, {}, null);
    }
    if (++processed % SCOPE_YIELD_EVERY === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (latestScopeRequest !== requestId) return;
    }
  }
  if (latestScopeRequest !== requestId) return;
  const result = stats.toResult();
  self.postMessage({ type: 'scopedStats', requestId, stats: { ...result, totalPackets: result.decodedPackets } });
}

/**
 * Builds the filtered .pcap for the packets of the given connections (`keys`) from the kept
 * capture. Runs in one go - an export is a deliberate, one-off action and takes a moment
 * even for large captures (progress is reported).
 */
function exportScope({ requestId, keys, payloadMode }) {
  try {
    const buffer = retainedBuffer;
    if (!buffer) throw new Error('Die Datei wird nicht mehr im Speicher gehalten.');
    const result = buildFilteredPcap(buffer, keys, payloadMode, (percent) => self.postMessage({ type: 'exportProgress', requestId, percent }));
    self.postMessage({ type: 'exportResult', requestId, ...result }, [result.buffer]);
  } catch (err) {
    self.postMessage({ type: 'exportError', requestId, message: (err && (err.message || String(err))) || 'Unbekannter Fehler beim PCAP-Export.' });
  }
}
