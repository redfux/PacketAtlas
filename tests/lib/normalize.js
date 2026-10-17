// Turns pair objects into a canonical, order-independent form so two ways of building
// them (the worker's per-packet aggregation vs. deriving them from connections) can be
// compared with deepStrictEqual.
// thought up by human, created by ai

const numbers = (list) => [...list].sort((x, y) => x - y);

function direction(d) {
  return {
    packets: d.packets,
    bytes: d.bytes,
    problems: d.problems,
    srcPorts: numbers(d.srcPorts),
    dstPorts: numbers(d.dstPorts),
    firstSeen: d.firstSeen,
    lastSeen: d.lastSeen,
  };
}

function tcpSummary(tcp) {
  if (!tcp) return null;
  const { problemTimes, ...totals } = tcp; // pair level never carries the per-event timestamps
  return totals;
}

export function normalizePair(pair) {
  return {
    a: pair.a,
    b: pair.b,
    packets: pair.packets,
    bytes: pair.bytes,
    problems: pair.problems,
    tcp: tcpSummary(pair.tcp),
    protocols: [...pair.protocols].sort(),
    portsA: numbers(pair.portsA),
    portsB: numbers(pair.portsB),
    firstSeen: pair.firstSeen,
    lastSeen: pair.lastSeen,
    multicastOrBroadcast: pair.multicastOrBroadcast,
    aToB: direction(pair.aToB),
    bToA: direction(pair.bToA),
    protocolBreakdown: pair.protocolBreakdown
      .map((entry) => ({
        protocol: entry.protocol,
        packets: entry.packets,
        bytes: entry.bytes,
        portsA: numbers(entry.portsA),
        portsB: numbers(entry.portsB),
        firstSeen: entry.firstSeen,
        lastSeen: entry.lastSeen,
        multicastOrBroadcast: entry.multicastOrBroadcast,
      }))
      .sort((x, y) => x.protocol.localeCompare(y.protocol)),
  };
}

export function normalizePairs(pairs) {
  return pairs.map(normalizePair).sort((x, y) => `${x.a}|${x.b}`.localeCompare(`${y.a}|${y.b}`));
}
