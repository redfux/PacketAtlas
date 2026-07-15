// Communication-matrix data model: aggregation (used in the worker) and
// filtering/derivation helpers (used on the main thread by the views).
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

/**
 * Accumulates decoded frames into device and pair aggregates using Map
 * structures, so each frame only costs O(1) lookups/updates regardless of
 * total packet count.
 */
export class Aggregator {
  constructor() {
    this.devices = new Map();
    this.pairs = new Map();
    this.hostnames = new Map();
  }

  #getOrCreateDevice(id, kind, ip, mac) {
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

    const srcDevice = this.#getOrCreateDevice(srcId, decoded.srcIp ? 'ip' : 'mac', decoded.srcIp, decoded.srcMac);
    const dstDevice = this.#getOrCreateDevice(dstId, decoded.dstIp ? 'ip' : 'mac', decoded.dstIp, decoded.dstMac);
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

export function deviceLabel(device) {
  return device.hostname ? `${device.ip || device.mac} (${device.hostname})` : device.ip || device.mac;
}

export function protocolGroupOf(protocol) {
  for (const [group, members] of Object.entries(PROTOCOL_GROUPS)) {
    if (members.includes(protocol)) return group;
  }
  return 'OTHER';
}

export function pairMatchesProtocolFilter(pair, activeGroups) {
  return pair.protocols.some((proto) => activeGroups.has(protocolGroupOf(proto)));
}

/**
 * Derives the filtered set of pairs visible in both views from the full
 * result, the current device selection, protocol filter and metric.
 */
export function computeVisiblePairs(pairs, selectedIds, activeGroups, hideMulticast) {
  return pairs.filter((pair) => {
    if (!selectedIds.has(pair.a) || !selectedIds.has(pair.b)) return false;
    if (hideMulticast && pair.multicastOrBroadcast) return false;
    if (!pairMatchesProtocolFilter(pair, activeGroups)) return false;
    return true;
  });
}

export function metricValue(pair, metric) {
  return metric === 'bytes' ? pair.bytes : pair.packets;
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

export function formatTimestamp(seconds) {
  if (!Number.isFinite(seconds)) return '–';
  return new Date(seconds * 1000).toLocaleString('de-DE');
}
