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
