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

/**
 * Derives the filtered per-connection (device pair + protocol + port) breakdown
 * visible in the connections view, using the same selection/protocol/multicast
 * filters as computeVisiblePairs() so all views stay consistent with each other.
 */
export function computeVisibleConnections(connections, selectedIds, activeGroups, hideMulticast) {
  return connections.filter((connection) => {
    if (!selectedIds.has(connection.a) || !selectedIds.has(connection.b)) return false;
    if (hideMulticast && connection.multicastOrBroadcast) return false;
    if (!activeGroups.has(protocolGroupOf(connection.protocol))) return false;
    return true;
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
