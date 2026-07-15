// Link-layer / L3 / L4 packet decoding shared by the pcap and pcapng parsers.
// thought up by human, created by ai

export const LINKTYPE_ETHERNET = 1;
export const LINKTYPE_LINUX_SLL = 113;

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

function isMacMulticast(view, offset) {
  return (view.getUint8(offset) & 0x01) === 1;
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
export function decodeFrame(buffer, offset, length, linkType, timestamp, origLen) {
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
    multicastOrBroadcast: dstMac === BROADCAST_MAC || (dstMac !== null && isMacMulticast(view, 0)),
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
  result.srcIp = formatIPv4(view, offset + 12);
  result.dstIp = formatIPv4(view, offset + 16);
  if (isIPv4MulticastOrBroadcast(view, offset + 16)) result.multicastOrBroadcast = true;

  const l4Offset = offset + ihl;
  applyL4(view, l4Offset, length, proto, result, false, baseOffset);
  return result;
}

function decodeIPv6(view, offset, length, result, baseOffset) {
  if (length < offset + 40) return null;
  const nextHeader = view.getUint8(offset + 6);
  result.srcIp = formatIPv6(view, offset + 8);
  result.dstIp = formatIPv6(view, offset + 24);
  if (isIPv6MulticastOrLinkLocal(view, offset + 24)) result.multicastOrBroadcast = true;

  const l4Offset = offset + 40;
  applyL4(view, l4Offset, length, nextHeader, result, true, baseOffset);
  return result;
}

function applyL4(view, offset, length, proto, result, isV6, baseOffset) {
  if (proto === IP_PROTO_TCP && length >= offset + 4) {
    result.protocol = 'TCP';
    result.srcPort = view.getUint16(offset);
    result.dstPort = view.getUint16(offset + 2);
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
  } else if (proto === IP_PROTO_ICMP && !isV6) {
    result.protocol = 'ICMP';
  } else if (proto === IP_PROTO_ICMPV6 && isV6) {
    result.protocol = 'ICMPv6';
  } else {
    result.protocol = 'OTHER';
  }
}
