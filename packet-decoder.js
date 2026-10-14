// Link-layer / L3 / L4 packet decoding shared by the pcap and pcapng parsers.
// Loaded into the worker via importScripts() as a classic (non-module) script
// for maximum browser compatibility, so no import/export syntax here.
// thought up by human, created by ai

const LINKTYPE_ETHERNET = 1;
const LINKTYPE_RAW_BSD = 12; // DLT_RAW on most BSD/Linux libpcap builds - raw IP, same as 101
const LINKTYPE_RAW = 101;
const LINKTYPE_IEEE802_11 = 105;
const LINKTYPE_LINUX_SLL = 113;
const LINKTYPE_IEEE802_11_RADIOTAP = 127;
const LINKTYPE_IPV4 = 228;
const LINKTYPE_IPV6 = 229;

const ETHERTYPE_IPV4 = 0x0800;
const ETHERTYPE_IPV6 = 0x86dd;
const ETHERTYPE_ARP = 0x0806;
const ETHERTYPE_VLAN = 0x8100;

const IP_PROTO_ICMP = 1;
const IP_PROTO_TCP = 6;
const IP_PROTO_UDP = 17;
const IP_PROTO_ICMPV6 = 58;

const BROADCAST_MAC = 'ff:ff:ff:ff:ff:ff';

function formatMac(view, offset) {
  let out = '';
  for (let i = 0; i < 6; i++) {
    if (i > 0) out += ':';
    out += view.getUint8(offset + i).toString(16).padStart(2, '0');
  }
  return out;
}

function formatIPv4(view, offset) {
  return `${view.getUint8(offset)}.${view.getUint8(offset + 1)}.${view.getUint8(offset + 2)}.${view.getUint8(offset + 3)}`;
}

function formatIPv6(view, offset) {
  const groups = [];
  for (let i = 0; i < 8; i++) {
    groups.push(view.getUint16(offset + i * 2).toString(16));
  }
  // Collapse the longest run of consecutive zero groups into "::" (RFC 5952-ish, best-effort).
  let bestStart = -1;
  let bestLen = 0;
  let curStart = -1;
  let curLen = 0;
  for (let i = 0; i < groups.length; i++) {
    if (groups[i] === '0') {
      if (curStart === -1) curStart = i;
      curLen++;
      if (curLen > bestLen) { bestLen = curLen; bestStart = curStart; }
    } else {
      curStart = -1;
      curLen = 0;
    }
  }
  if (bestLen > 1) {
    const head = groups.slice(0, bestStart);
    const tail = groups.slice(bestStart + bestLen);
    return `${head.join(':')}::${tail.join(':')}`;
  }
  return groups.join(':');
}

function isMacMulticast(mac) {
  return (parseInt(mac.slice(0, 2), 16) & 0x01) === 1;
}

function classifyMacCast(mac) {
  if (mac === null) return 'unicast';
  if (mac === BROADCAST_MAC) return 'broadcast';
  return isMacMulticast(mac) ? 'multicast' : 'unicast';
}

function isIPv4MulticastOrBroadcast(view, offset) {
  const first = view.getUint8(offset);
  if (first >= 224 && first <= 239) return true;
  return (
    view.getUint8(offset) === 255 &&
    view.getUint8(offset + 1) === 255 &&
    view.getUint8(offset + 2) === 255 &&
    view.getUint8(offset + 3) === 255
  );
}

function isIPv6MulticastOrLinkLocal(view, offset) {
  const first = view.getUint8(offset);
  const second = view.getUint8(offset + 1);
  if (first === 0xff) return true; // multicast ff00::/8
  if (first === 0xfe && (second & 0xc0) === 0x80) return true; // link-local fe80::/10
  return false;
}

/**
 * Decodes a single captured frame (link-layer payload) into the fields needed
 * for device/pair aggregation. Returns null if the frame cannot be classified
 * (unsupported link type or truncated data) so the caller can skip it.
 */
function decodeFrame(buffer, offset, length, linkType, timestamp, origLen) {
  const view = new DataView(buffer, offset, length);
  const baseOffset = offset;
  let l3Offset;
  let ethertype;
  let srcMac = null;
  let dstMac = null;

  if (linkType === LINKTYPE_ETHERNET) {
    if (length < 14) return null;
    dstMac = formatMac(view, 0);
    srcMac = formatMac(view, 6);
    ethertype = view.getUint16(12);
    l3Offset = 14;
  } else if (linkType === LINKTYPE_LINUX_SLL) {
    if (length < 16) return null;
    const addrLen = view.getUint16(4);
    if (addrLen === 6) srcMac = formatMac(view, 6);
    ethertype = view.getUint16(14);
    l3Offset = 16;
  } else if (linkType === LINKTYPE_IEEE802_11_RADIOTAP || linkType === LINKTYPE_IEEE802_11) {
    const macOffset = linkType === LINKTYPE_IEEE802_11_RADIOTAP ? skipRadiotapHeader(view, length) : 0;
    if (macOffset == null) return null;
    const parsed = decode80211DataFrame(view, macOffset, length);
    if (!parsed) return null; // management/control/null-function frame - no payload to extract
    ({ srcMac, dstMac, l3Offset, ethertype } = parsed);
  } else if (
    linkType === LINKTYPE_RAW ||
    linkType === LINKTYPE_RAW_BSD ||
    linkType === LINKTYPE_IPV4 ||
    linkType === LINKTYPE_IPV6
  ) {
    // Raw IP: no link-layer header at all (typical for captures on VPN/tunnel
    // interfaces), the frame starts directly with the IPv4/IPv6 header. There
    // are no MAC addresses, so devices are identified purely by IP.
    if (length < 1) return null;
    const ipVersion = view.getUint8(0) >> 4;
    if (ipVersion === 4) ethertype = ETHERTYPE_IPV4;
    else if (ipVersion === 6) ethertype = ETHERTYPE_IPV6;
    else return null;
    l3Offset = 0;
  } else {
    return null; // unsupported link type
  }

  // Skip a single 802.1Q VLAN tag if present.
  if (ethertype === ETHERTYPE_VLAN && length >= l3Offset + 4) {
    ethertype = view.getUint16(l3Offset + 2);
    l3Offset += 4;
  }

  const result = {
    timestamp,
    frameLength: origLen,
    srcMac,
    dstMac,
    srcIp: null,
    dstIp: null,
    srcPort: null,
    dstPort: null,
    protocol: null,
    // 4 | 6 | null (null = no IP layer, i.e. ARP).
    ipVersion: null,
    // 'unicast' | 'multicast' | 'broadcast' - decided by the destination
    // address (L2 and L3), purely for the statistics view; unlike
    // multicastOrBroadcast below it does not count IPv6 link-local unicast.
    castType: classifyMacCast(dstMac),
    icmpType: null,
    icmpCode: null,
    // TCP details for the statistics view (null for everything else, or if
    // the capture's snaplen cut the frame off before the 20-byte fixed header).
    tcpFlags: null,
    tcpSeq: null,
    tcpAck: null,
    tcpWindow: null,
    tcpPayloadLength: null,
    // This packet is part of a fragmented IP datagram (IPv4 flags/offset, or an
    // IPv6 Fragment extension header); isFirstFragment marks the first piece of
    // such a datagram, so counting those counts fragmented datagrams.
    isFragment: false,
    isFirstFragment: false,
    // IPv4 "Don't Fragment" bit.
    dontFragment: false,
    // Total IP packet size in bytes (IP header + payload) as stated by the IP
    // header, i.e. without any link-layer header or padding. null if unknown.
    ipPacketLength: null,
    // TCP MSS option announced in a SYN / SYN-ACK, and the next-hop MTU reported
    // by ICMP "Fragmentation needed" / ICMPv6 "Packet Too Big" - both are the
    // only places a capture reveals anything about the path MTU.
    tcpMss: null,
    icmpMtu: null,
    // Absolute buffer offset where this frame's headers end and any payload
    // begins - used only by the "PCAP ohne Payload" export (pcap-export.worker.js)
    // to truncate a frame right after its L4 header. `null` means "don't
    // truncate this frame" (ARP has no payload concept, and a frame whose L3/L4
    // couldn't be decoded is excluded from export filtering entirely anyway).
    headerEndOffset: null,
    multicastOrBroadcast: dstMac === BROADCAST_MAC || (dstMac !== null && isMacMulticast(dstMac)),
  };

  if (ethertype === ETHERTYPE_ARP) {
    return decodeArp(view, l3Offset, length, result);
  }
  if (ethertype === ETHERTYPE_IPV4) {
    return decodeIPv4(view, l3Offset, length, result, baseOffset);
  }
  if (ethertype === ETHERTYPE_IPV6) {
    return decodeIPv6(view, l3Offset, length, result, baseOffset);
  }

  return null; // not a protocol we extract device/pair info from
}

/** Returns the offset of the 802.11 MAC header after the radiotap header, or null if malformed. */
function skipRadiotapHeader(view, length) {
  if (length < 8) return null;
  const radiotapLen = view.getUint16(2, true); // radiotap is always little-endian
  if (radiotapLen < 8 || radiotapLen > length) return null;
  return radiotapLen;
}

/**
 * Decodes an 802.11 MAC header starting at `offset`. Only Data frames (not
 * Null/QoS-Null, which carry no payload, and not Management/Control frames,
 * which carry no IP traffic) are decoded further. Station-to-station traffic
 * relayed through an access point is attributed to the two stations, not the
 * AP, so the matrix reflects actual communication partners rather than every
 * hop being "device <-> AP".
 */
function decode80211DataFrame(view, offset, length) {
  if (length < offset + 24) return null;
  const frameControl0 = view.getUint8(offset);
  const type = (frameControl0 >> 2) & 0x03;
  const subtype = (frameControl0 >> 4) & 0x0f;
  if (type !== 2) return null; // not a Data frame (0=Management, 1=Control, 2=Data)
  if (subtype === 4 || subtype === 12 || subtype === 14 || subtype === 15) return null; // Null/QoS-Null: no frame body

  const flags = view.getUint8(offset + 1);
  const toDs = (flags & 0x01) !== 0;
  const fromDs = (flags & 0x02) !== 0;
  const addr1 = formatMac(view, offset + 4);
  const addr2 = formatMac(view, offset + 10);
  const addr3 = formatMac(view, offset + 16);

  let srcMac;
  let dstMac;
  let headerLen = 24;
  if (toDs && fromDs) {
    if (length < offset + 30) return null;
    srcMac = formatMac(view, offset + 24); // Address 4
    dstMac = addr3;
    headerLen = 30;
  } else if (toDs) {
    srcMac = addr2;
    dstMac = addr3;
  } else if (fromDs) {
    srcMac = addr3;
    dstMac = addr1;
  } else {
    srcMac = addr2;
    dstMac = addr1;
  }

  const hasQos = subtype >= 8;
  if (hasQos) headerLen += 2;

  // IP traffic over 802.11 is virtually always 802.2 LLC/SNAP-encapsulated (RFC 1042):
  // AA AA 03 + 3-byte OUI + 2-byte Ethertype, mirroring the Ethernet II payload from here on.
  if (length < offset + headerLen + 8) return null;
  const llcOffset = offset + headerLen;
  if (view.getUint8(llcOffset) !== 0xaa || view.getUint8(llcOffset + 1) !== 0xaa || view.getUint8(llcOffset + 2) !== 0x03) {
    return null; // not SNAP-encapsulated - nothing we can interpret
  }
  const ethertype = view.getUint16(llcOffset + 6);
  return { srcMac, dstMac, ethertype, l3Offset: llcOffset + 8 };
}

function decodeArp(view, offset, length, result) {
  if (length < offset + 8) return null;
  const hlen = view.getUint8(offset + 4);
  const plen = view.getUint8(offset + 5);
  if (plen !== 4 || length < offset + 8 + 2 * hlen + 2 * plen) {
    // Only IPv4-over-Ethernet ARP is handled; anything else still counts as L2 traffic.
    result.protocol = 'ARP';
    return result;
  }
  const senderIpOffset = offset + 8 + hlen;
  const targetIpOffset = senderIpOffset + plen + hlen;
  result.protocol = 'ARP';
  result.srcIp = formatIPv4(view, senderIpOffset);
  result.dstIp = formatIPv4(view, targetIpOffset);
  return result;
}

function decodeIPv4(view, offset, length, result, baseOffset) {
  if (length < offset + 20) return null;
  const ihl = (view.getUint8(offset) & 0x0f) * 4;
  const proto = view.getUint8(offset + 9);
  result.ipVersion = 4;
  result.srcIp = formatIPv4(view, offset + 12);
  result.dstIp = formatIPv4(view, offset + 16);
  if (isIPv4MulticastOrBroadcast(view, offset + 16)) result.multicastOrBroadcast = true;
  const firstDstOctet = view.getUint8(offset + 16);
  if (firstDstOctet >= 224 && firstDstOctet <= 239) result.castType = 'multicast';
  else if (isIPv4MulticastOrBroadcast(view, offset + 16)) result.castType = 'broadcast';

  const totalLength = view.getUint16(offset + 2);
  // 0 happens with TCP segmentation offload on the capturing host - then the
  // captured length is the best available estimate.
  const ipPayloadLength = totalLength >= ihl ? totalLength - ihl : null;
  const fragmentField = view.getUint16(offset + 6);
  const moreFragments = (fragmentField & 0x2000) !== 0;
  const fragmentOffset = fragmentField & 0x1fff;
  if (moreFragments || fragmentOffset > 0) result.isFragment = true;
  if (moreFragments && fragmentOffset === 0) result.isFirstFragment = true;
  if ((fragmentField & 0x4000) !== 0) result.dontFragment = true;
  if (ipPayloadLength !== null) result.ipPacketLength = totalLength;

  const l4Offset = offset + ihl;
  if (fragmentOffset > 0) {
    // Non-first fragment: the bytes at l4Offset are mid-datagram payload, not an
    // L4 header, so reading "ports" from them would produce bogus connections.
    result.protocol = 'OTHER';
    result.headerEndOffset = baseOffset + l4Offset;
    return result;
  }
  applyL4(view, l4Offset, length, proto, result, false, baseOffset, ipPayloadLength);
  return result;
}

function decodeIPv6(view, offset, length, result, baseOffset) {
  if (length < offset + 40) return null;
  const nextHeader = view.getUint8(offset + 6);
  result.ipVersion = 6;
  result.srcIp = formatIPv6(view, offset + 8);
  result.dstIp = formatIPv6(view, offset + 24);
  if (isIPv6MulticastOrLinkLocal(view, offset + 24)) result.multicastOrBroadcast = true;
  if (view.getUint8(offset + 24) === 0xff) result.castType = 'multicast';

  const payloadLength = view.getUint16(offset + 4); // 0 = jumbogram / segmentation offload, fall back to captured length
  const l4Offset = offset + 40;
  if (payloadLength > 0) result.ipPacketLength = 40 + payloadLength;
  if (nextHeader === 44 && length >= l4Offset + 8) {
    // IPv6 Fragment extension header: next header, reserved, offset(13)+res(2)+M(1), identification.
    const fragmentField = view.getUint16(l4Offset + 2);
    result.isFragment = true;
    if ((fragmentField >> 3) === 0 && (fragmentField & 0x1) !== 0) result.isFirstFragment = true;
  }
  applyL4(view, l4Offset, length, nextHeader, result, true, baseOffset, payloadLength > 0 ? payloadLength : null);
  return result;
}

/** Walks TCP options in [start, end) and returns the MSS value (kind 2), or null if absent/malformed. */
function readTcpMss(view, start, end) {
  let pos = start;
  while (pos < end) {
    const kind = view.getUint8(pos);
    if (kind === 0) return null; // end of option list
    if (kind === 1) { pos++; continue; } // NOP padding
    if (pos + 1 >= end) return null;
    const optionLength = view.getUint8(pos + 1);
    if (optionLength < 2) return null;
    if (kind === 2 && optionLength === 4 && pos + 4 <= end) return view.getUint16(pos + 2);
    pos += optionLength;
  }
  return null;
}

function applyL4(view, offset, length, proto, result, isV6, baseOffset, ipPayloadLength) {
  if (proto === IP_PROTO_TCP && length >= offset + 4) {
    result.protocol = 'TCP';
    result.srcPort = view.getUint16(offset);
    result.dstPort = view.getUint16(offset + 2);
    // Data Offset: upper 4 bits of byte 12, header length in 32-bit words -
    // includes any TCP options, so this is genuinely where the payload starts.
    // Only computable if the frame wasn't itself snaplen-truncated to just the
    // port fields; otherwise leave headerEndOffset null (don't truncate further).
    if (length >= offset + 13) {
      const tcpHeaderLen = (view.getUint8(offset + 12) >> 4) * 4;
      result.headerEndOffset = baseOffset + offset + Math.max(20, tcpHeaderLen);
    }
    if (length >= offset + 20) {
      const tcpHeaderLen = Math.max(20, (view.getUint8(offset + 12) >> 4) * 4);
      result.tcpSeq = view.getUint32(offset + 4);
      result.tcpAck = view.getUint32(offset + 8);
      result.tcpFlags = view.getUint8(offset + 13);
      result.tcpWindow = view.getUint16(offset + 14);
      // Prefer the IP header's own length over the captured length: Ethernet
      // padding / trailers would otherwise count as TCP payload.
      const l4Length = ipPayloadLength != null ? ipPayloadLength : length - offset;
      result.tcpPayloadLength = Math.max(0, l4Length - tcpHeaderLen);
      if ((result.tcpFlags & 0x02) !== 0 && tcpHeaderLen > 20) {
        result.tcpMss = readTcpMss(view, offset + 20, Math.min(offset + tcpHeaderLen, length));
      }
    }
  } else if (proto === IP_PROTO_UDP && length >= offset + 4) {
    result.protocol = 'UDP';
    result.srcPort = view.getUint16(offset);
    result.dstPort = view.getUint16(offset + 2);
    // Expose the UDP payload location (absolute buffer offset) so the caller
    // can opportunistically run the DNS resolver without re-parsing headers.
    if (length > offset + 8) {
      result.udpPayloadOffset = baseOffset + offset + 8;
      result.udpPayloadLength = length - offset - 8;
    }
    result.headerEndOffset = baseOffset + offset + 8;
  } else if (proto === IP_PROTO_ICMP && !isV6) {
    result.protocol = 'ICMP';
    if (length >= offset + 1) result.icmpType = view.getUint8(offset);
    if (length >= offset + 2) result.icmpCode = view.getUint8(offset + 1);
    // Type 3 / code 4 = Fragmentation Needed: next-hop MTU in the low 16 bits of the "rest of header".
    if (result.icmpType === 3 && result.icmpCode === 4 && length >= offset + 8) result.icmpMtu = view.getUint16(offset + 6);
    result.headerEndOffset = baseOffset + offset + 8; // type/code/checksum + 4-byte rest-of-header (e.g. echo id/seq)
  } else if (proto === IP_PROTO_ICMPV6 && isV6) {
    result.protocol = 'ICMPv6';
    if (length >= offset + 1) result.icmpType = view.getUint8(offset);
    if (length >= offset + 2) result.icmpCode = view.getUint8(offset + 1);
    // Type 2 = Packet Too Big: MTU as a 32-bit value in the "rest of header".
    if (result.icmpType === 2 && length >= offset + 8) result.icmpMtu = view.getUint32(offset + 4);
    result.headerEndOffset = baseOffset + offset + 8;
  } else {
    result.protocol = 'OTHER';
    result.headerEndOffset = baseOffset + offset; // unknown L4 structure - keep only up through the L3 header
  }
}
