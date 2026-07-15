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
 * Accumulates decoded frames into device and pair aggregates using Map
 * structures, so each frame only costs O(1) lookups/updates regardless of
 * total packet count.
 */
class Aggregator {
  constructor() {
    this.devices = new Map();
    this.pairs = new Map();
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
        ports: new Set(),
        firstSeen: decoded.timestamp,
        lastSeen: decoded.timestamp,
        multicastOrBroadcast: false,
      };
      this.pairs.set(key, pair);
    }
    pair.packets++;
    pair.bytes += decoded.frameLength;
    if (decoded.protocol) pair.protocols.add(decoded.protocol);
    if (decoded.srcPort != null) pair.ports.add(decoded.srcPort);
    if (decoded.dstPort != null) pair.ports.add(decoded.dstPort);
    if (decoded.timestamp < pair.firstSeen) pair.firstSeen = decoded.timestamp;
    if (decoded.timestamp > pair.lastSeen) pair.lastSeen = decoded.timestamp;
    if (decoded.multicastOrBroadcast) pair.multicastOrBroadcast = true;
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
      pairs: Array.from(this.pairs.values()).map((p) => ({
        ...p,
        protocols: Array.from(p.protocols),
        ports: Array.from(p.ports),
      })),
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
  self.postMessage({ type: 'result', devices: result.devices, pairs: result.pairs, packetCount });
}
