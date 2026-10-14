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
  if (protocol === 'TCP' || protocol === 'UDP' || protocol === 'ARP') return protocol;
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

class TrafficStats {
  constructor() {
    this.decodedPackets = 0;
    this.decodedBytes = 0;
    this.firstTimestamp = null;
    this.lastTimestamp = null;
    this.byProtocol = { TCP: createCounter(), UDP: createCounter(), ICMP: createCounter(), ARP: createCounter(), OTHER: createCounter() };
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

  /** Returns the TCP analysis events for this packet (null for non-TCP packets). */
  add(decoded) {
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

    this.addSizeAndFragmentation(decoded, size);
    if (decoded.protocol === 'TCP' || decoded.protocol === 'UDP') this.addPort(decoded, size);
    if (decoded.protocol === 'ICMP' || decoded.protocol === 'ICMPv6') this.addIcmp(decoded);
    if (decoded.protocol === 'TCP' && decoded.tcpSeq !== null) return this.addTcp(decoded);
    return null;
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

  addIcmp(decoded) {
    if (decoded.icmpType === null) return;
    const code = decoded.icmpCode === null ? 0 : decoded.icmpCode;
    const key = `${decoded.protocol}|${decoded.icmpType}|${code}`;
    let entry = this.icmp.get(key);
    if (!entry) {
      entry = { protocol: decoded.protocol, type: decoded.icmpType, code, packets: 0 };
      this.icmp.set(key, entry);
    }
    entry.packets++;
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
