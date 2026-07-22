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

importScripts('pcap-parser.js', 'pcapng-parser.js', 'packet-decoder.js', 'dns-resolver.js');

function pairKey(idA, idB) {
  return idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`;
}

/**
 * The "service port" of a packet, used to correlate both directions of a
 * connection (client's ephemeral source port vs. the server's port) into one
 * entry: the lower of the two port numbers is almost always the server side.
 * Not a perfect heuristic, but correct for the vast majority of real traffic
 * and good enough for a human-facing "which ports do these devices talk
 * over" breakdown rather than an exact per-flow reconstruction.
 */
function servicePortOf(decoded) {
  if (decoded.srcPort == null || decoded.dstPort == null) return null;
  return Math.min(decoded.srcPort, decoded.dstPort);
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
    this.pairs = new Map();
    this.connections = new Map();
    this.hostnames = new Map();
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

  addPacket(decoded) {
    const hasSrc = Boolean(decoded.srcIp || decoded.srcMac);
    const hasDst = Boolean(decoded.dstIp || decoded.dstMac);
    if (!hasSrc || !hasDst) return;

    const srcId = decoded.srcIp || decoded.srcMac;
    const dstId = decoded.dstIp || decoded.dstMac;
    if (srcId === dstId) return; // ignore loopback/self-talk, not a meaningful "pair"

    const srcDevice = this.getOrCreateDevice(srcId, decoded.srcIp ? 'ip' : 'mac', decoded.srcIp, decoded.srcMac);
    const dstDevice = this.getOrCreateDevice(dstId, decoded.dstIp ? 'ip' : 'mac', decoded.dstIp, decoded.dstMac);
    srcDevice.packetCount++;
    srcDevice.byteCount += decoded.frameLength;
    dstDevice.packetCount++;
    dstDevice.byteCount += decoded.frameLength;

    const key = pairKey(srcId, dstId);
    let pair = this.pairs.get(key);
    if (!pair) {
      pair = {
        a: srcId,
        b: dstId,
        packets: 0,
        bytes: 0,
        protocols: new Set(),
        // Ports are tracked per device (not per src/dst direction): a pair
        // aggregates traffic both ways, so "source port" flips depending on
        // which side happens to be sending a given packet, but "which ports
        // does device X use" is stable regardless of direction.
        portsA: new Set(),
        portsB: new Set(),
        firstSeen: decoded.timestamp,
        lastSeen: decoded.timestamp,
        multicastOrBroadcast: false,
        // Per-protocol sub-aggregates, so the Excel export can emit one row
        // per protocol instead of merging e.g. TCP and UDP ports together.
        byProtocol: new Map(),
      };
      this.pairs.set(key, pair);
    }
    pair.packets++;
    pair.bytes += decoded.frameLength;
    if (decoded.protocol) pair.protocols.add(decoded.protocol);
    const [srcPortSet, dstPortSet] = srcId === pair.a ? [pair.portsA, pair.portsB] : [pair.portsB, pair.portsA];
    if (decoded.srcPort != null) srcPortSet.add(decoded.srcPort);
    if (decoded.dstPort != null) dstPortSet.add(decoded.dstPort);
    if (decoded.timestamp < pair.firstSeen) pair.firstSeen = decoded.timestamp;
    if (decoded.timestamp > pair.lastSeen) pair.lastSeen = decoded.timestamp;
    if (decoded.multicastOrBroadcast) pair.multicastOrBroadcast = true;

    const protocolKey = decoded.protocol || 'OTHER';
    let protoEntry = pair.byProtocol.get(protocolKey);
    if (!protoEntry) {
      protoEntry = {
        protocol: protocolKey,
        packets: 0,
        bytes: 0,
        portsA: new Set(),
        portsB: new Set(),
        firstSeen: decoded.timestamp,
        lastSeen: decoded.timestamp,
        multicastOrBroadcast: false,
      };
      pair.byProtocol.set(protocolKey, protoEntry);
    }
    protoEntry.packets++;
    protoEntry.bytes += decoded.frameLength;
    const [protoSrcPortSet, protoDstPortSet] = srcId === pair.a ? [protoEntry.portsA, protoEntry.portsB] : [protoEntry.portsB, protoEntry.portsA];
    if (decoded.srcPort != null) protoSrcPortSet.add(decoded.srcPort);
    if (decoded.dstPort != null) protoDstPortSet.add(decoded.dstPort);
    if (decoded.timestamp < protoEntry.firstSeen) protoEntry.firstSeen = decoded.timestamp;
    if (decoded.timestamp > protoEntry.lastSeen) protoEntry.lastSeen = decoded.timestamp;
    if (decoded.multicastOrBroadcast) protoEntry.multicastOrBroadcast = true;

    const servicePort = servicePortOf(decoded);
    const connectionKey = `${key}|${decoded.protocol}|${servicePort}`;
    let connection = this.connections.get(connectionKey);
    if (!connection) {
      connection = {
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
        firstSeen: decoded.timestamp,
        lastSeen: decoded.timestamp,
        multicastOrBroadcast: false,
      };
      this.connections.set(connectionKey, connection);
    }
    connection.packets++;
    connection.bytes += decoded.frameLength;
    if (decoded.timestamp < connection.firstSeen) connection.firstSeen = decoded.timestamp;
    if (decoded.timestamp > connection.lastSeen) connection.lastSeen = decoded.timestamp;
    if (decoded.multicastOrBroadcast) connection.multicastOrBroadcast = true;
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
    }
    return {
      devices: Array.from(this.devices.values()),
      pairs: Array.from(this.pairs.values()).map((p) => {
        const { byProtocol, ...rest } = p;
        return {
          ...rest,
          protocols: Array.from(p.protocols),
          portsA: Array.from(p.portsA),
          portsB: Array.from(p.portsB),
          protocolBreakdown: Array.from(byProtocol.values()).map((pe) => ({
            ...pe,
            portsA: Array.from(pe.portsA),
            portsB: Array.from(pe.portsB),
          })),
        };
      }),
      connections: Array.from(this.connections.values()),
    };
  }
}

self.onmessage = (event) => {
  try {
    processBuffer(event.data.buffer);
  } catch (err) {
    self.postMessage({ type: 'error', message: (err && (err.message || String(err))) || 'Unbekannter Parsing-Fehler.' });
  }
};

function processBuffer(buffer) {
  let frames;
  if (isPcapng(buffer)) {
    frames = parsePcapng(buffer);
  } else if (isClassicPcap(buffer)) {
    frames = parsePcap(buffer);
  } else {
    throw new Error('Datei ist weder ein gültiges pcap- noch pcapng-Format (Magic Number nicht erkannt).');
  }

  const aggregator = new Aggregator();
  const totalBytes = buffer.byteLength || 1;
  let processedBytes = 0;
  let packetCount = 0;
  let lastProgressPost = 0;

  for (const frame of frames) {
    const decoded = decodeFrame(buffer, frame.offset, frame.length, frame.linkType, frame.timestamp, frame.origLen);
    if (decoded) {
      aggregator.addPacket(decoded);
      if (decoded.udpPayloadOffset != null && (decoded.srcPort === DNS_PORT || decoded.dstPort === DNS_PORT)) {
        for (const { ip, hostname } of extractDnsHostnames(buffer, decoded.udpPayloadOffset, decoded.udpPayloadLength)) {
          aggregator.addHostname(ip, hostname);
        }
      }
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

  const result = aggregator.toResult();
  self.postMessage({
    type: 'result',
    devices: result.devices,
    pairs: result.pairs,
    connections: result.connections,
    packetCount,
  });
}
