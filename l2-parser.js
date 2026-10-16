// Detail parsing of layer-2 control protocols (STP/RSTP/PVST+, CDP, LLDP, LACP)
// for the statistics view: who is root bridge, whether topology changes are
// announced, which neighbours announce themselves and how, and whether link
// aggregation is in sync. The frame classification itself (which protocol is
// this?) happens in packet-decoder.js; this file only looks inside.
// Everything is best effort: a truncated or odd frame yields whatever was read
// up to that point (or null), never an exception.
// Loaded into the worker via importScripts() as a classic (non-module) script,
// so no import/export syntax here.
// thought up by human, created by ai

const CDP_CAPABILITIES = [
  [0x01, 'Router'],
  [0x02, 'Transparent Bridge'],
  [0x04, 'Source-Route Bridge'],
  [0x08, 'Switch'],
  [0x10, 'Host'],
  [0x20, 'IGMP'],
  [0x40, 'Repeater'],
  [0x80, 'VoIP-Telefon'],
  [0x100, 'Remote-Managed'],
  [0x200, 'CVTA/STP Dispute'],
  [0x400, 'Two-Port MAC Relay'],
];

const LLDP_CAPABILITIES = [
  [0x0001, 'Other'],
  [0x0002, 'Repeater'],
  [0x0004, 'Bridge'],
  [0x0008, 'WLAN-AP'],
  [0x0010, 'Router'],
  [0x0020, 'Telefon'],
  [0x0040, 'DOCSIS'],
  [0x0080, 'Station'],
];

function l2Mac(view, offset) {
  let out = '';
  for (let i = 0; i < 6; i++) {
    if (i > 0) out += ':';
    out += view.getUint8(offset + i).toString(16).padStart(2, '0');
  }
  return out;
}

/** Printable ASCII of a TLV value (control characters dropped, line breaks become spaces), capped at maxLength. */
function l2Text(view, offset, length, maxLength = 80) {
  let out = '';
  const end = Math.min(offset + length, offset + maxLength, view.byteLength);
  for (let i = offset; i < end; i++) {
    const c = view.getUint8(i);
    out += c >= 32 && c < 127 ? String.fromCharCode(c) : c === 10 || c === 13 ? ' ' : '';
  }
  return out.trim();
}

function capabilityNames(value, table) {
  return table.filter(([bit]) => (value & bit) !== 0).map(([, name]) => name);
}

/** "8000.00:11:22:33:44:55" - bridge priority (incl. system ID extension) and MAC. */
function bridgeIdString(view, offset) {
  const priority = view.getUint16(offset);
  return `${priority.toString(16).padStart(4, '0')}.${l2Mac(view, offset + 2)}`;
}

function parseBpdu(view, length) {
  if (length < 4) return null;
  if (view.getUint16(0) !== 0) return null; // protocol identifier is always 0
  const type = view.getUint8(3);
  if (type === 0x80) return { kind: 'stp', bpdu: 'tcn', topologyChange: true, topologyChangeAck: false, rootId: null, bridgeId: null, vlan: null };
  if (length < 35) return null; // config / RST / MST BPDUs carry at least 35 bytes
  const flags = view.getUint8(4);
  const result = {
    kind: 'stp',
    bpdu: type === 0x02 ? 'rst' : 'config',
    topologyChange: (flags & 0x01) !== 0,
    topologyChangeAck: (flags & 0x80) !== 0,
    rootId: bridgeIdString(view, 5),
    bridgeId: bridgeIdString(view, 17),
    vlan: null,
  };
  // PVST+: an "originating VLAN" TLV (type 0, length 2) follows the 35-byte BPDU (36 for RSTP).
  const tlvStart = type === 0x02 && length >= 36 ? 36 : 35;
  if (length >= tlvStart + 6 && view.getUint16(tlvStart) === 0 && view.getUint16(tlvStart + 2) === 2) {
    result.vlan = view.getUint16(tlvStart + 4);
  }
  return result;
}

function parseCdp(view, length) {
  if (length < 4) return null;
  const result = { kind: 'neighbor', protocol: 'CDP', deviceId: null, portId: null, platform: null, software: null, capabilities: [], mgmtIp: null, vlan: null, ttl: view.getUint8(1) };
  let pos = 4;
  while (pos + 4 <= length) {
    const type = view.getUint16(pos);
    const tlvLength = view.getUint16(pos + 2);
    if (tlvLength < 4 || pos + tlvLength > length) break;
    const value = pos + 4;
    const valueLength = tlvLength - 4;
    if (type === 0x0001) result.deviceId = l2Text(view, value, valueLength);
    else if (type === 0x0003) result.portId = l2Text(view, value, valueLength);
    else if (type === 0x0004 && valueLength >= 4) result.capabilities = capabilityNames(view.getUint32(value), CDP_CAPABILITIES);
    else if (type === 0x0005) result.software = l2Text(view, value, valueLength, 120).replace(/\s+/g, ' ');
    else if (type === 0x0006) result.platform = l2Text(view, value, valueLength);
    else if (type === 0x000a && valueLength >= 2) result.vlan = view.getUint16(value);
    else if (type === 0x0002 && valueLength >= 4) {
      // Address list: count, then { protocol type, protocol length, protocol, address length, address }.
      const end = value + valueLength;
      let p = value + 4;
      const count = view.getUint32(value);
      for (let i = 0; i < count && p + 2 <= end; i++) {
        const protocolType = view.getUint8(p);
        const protocolLength = view.getUint8(p + 1);
        const protocolValue = protocolLength === 1 && p + 2 < end ? view.getUint8(p + 2) : null;
        const lengthPos = p + 2 + protocolLength;
        if (lengthPos + 2 > end) break;
        const addressLength = view.getUint16(lengthPos);
        const addressPos = lengthPos + 2;
        if (protocolType === 1 && protocolValue === 0xcc && addressLength === 4 && addressPos + 4 <= end) {
          result.mgmtIp = `${view.getUint8(addressPos)}.${view.getUint8(addressPos + 1)}.${view.getUint8(addressPos + 2)}.${view.getUint8(addressPos + 3)}`;
          break;
        }
        p = addressPos + addressLength;
      }
    }
    pos += tlvLength;
  }
  return result;
}

/**
 * LLDP chassis/port ID value: MAC, network address or text depending on the
 * subtype (chassis: 4 = MAC, 5 = network address; port: 3 = MAC, 4 = network address).
 */
function lldpIdValue(view, offset, length, subtype, isChassis) {
  if (length < 1) return null;
  if (subtype === (isChassis ? 4 : 3) && length === 6) return l2Mac(view, offset);
  if (subtype === (isChassis ? 5 : 4) && length >= 5 && view.getUint8(offset) === 1) {
    return `${view.getUint8(offset + 1)}.${view.getUint8(offset + 2)}.${view.getUint8(offset + 3)}.${view.getUint8(offset + 4)}`;
  }
  const text = l2Text(view, offset, length);
  if (text.length === length) return text;
  return length === 6 ? l2Mac(view, offset) : text;
}

function parseLldp(view, length) {
  const result = { kind: 'neighbor', protocol: 'LLDP', deviceId: null, chassisId: null, portId: null, portDescription: null, platform: null, software: null, capabilities: [], mgmtIp: null, vlan: null, ttl: null };
  let pos = 0;
  while (pos + 2 <= length) {
    const header = view.getUint16(pos);
    const type = header >> 9;
    const tlvLength = header & 0x01ff;
    const value = pos + 2;
    if (type === 0 || value + tlvLength > length) break; // End of LLDPDU or truncated
    if (type === 1 && tlvLength >= 2) result.chassisId = lldpIdValue(view, value + 1, tlvLength - 1, view.getUint8(value), true);
    else if (type === 2 && tlvLength >= 2) result.portId = lldpIdValue(view, value + 1, tlvLength - 1, view.getUint8(value), false);
    else if (type === 3 && tlvLength >= 2) result.ttl = view.getUint16(value);
    else if (type === 4) result.portDescription = l2Text(view, value, tlvLength);
    else if (type === 5) result.deviceId = l2Text(view, value, tlvLength);
    else if (type === 6) result.platform = l2Text(view, value, tlvLength, 120).replace(/\s+/g, ' ');
    else if (type === 7 && tlvLength >= 4) result.capabilities = capabilityNames(view.getUint16(value + 2), LLDP_CAPABILITIES);
    else if (type === 8 && tlvLength >= 7) {
      // Management address: address string length (incl. subtype), subtype (1 = IPv4), address.
      if (view.getUint8(value) === 5 && view.getUint8(value + 1) === 1) {
        result.mgmtIp = `${view.getUint8(value + 2)}.${view.getUint8(value + 3)}.${view.getUint8(value + 4)}.${view.getUint8(value + 5)}`;
      }
    }
    pos = value + tlvLength;
  }
  if (!result.deviceId) result.deviceId = result.chassisId;
  return result;
}

/** LACPDU: actor system, key and state flags (activity, timeout, aggregation, synchronisation, ...). */
function parseLacp(view, length) {
  // Slow-protocols subtype (1 = LACP), version, then the Actor TLV (type 1, length 20):
  // system priority (2), system MAC (6), key (2), port priority (2), port (2), state (1).
  if (length < 19 || view.getUint8(0) !== 1 || view.getUint8(2) !== 1) return null;
  const state = view.getUint8(18);
  return {
    kind: 'lacp',
    systemId: `${view.getUint16(4).toString(16).padStart(4, '0')}.${l2Mac(view, 6)}`,
    key: view.getUint16(12),
    active: (state & 0x01) !== 0,
    shortTimeout: (state & 0x02) !== 0,
    aggregatable: (state & 0x04) !== 0,
    synchronized: (state & 0x08) !== 0,
    collecting: (state & 0x10) !== 0,
    distributing: (state & 0x20) !== 0,
    defaulted: (state & 0x40) !== 0,
    expired: (state & 0x80) !== 0,
  };
}

/**
 * `decoded.l2` is { name, offset, length } (see decodeFrame()). Returns a
 * details object ({ kind: 'stp' | 'neighbor' | 'lacp', ... }) or null when the
 * protocol has no detail parser (or the frame is too short).
 */
function parseL2Details(buffer, decoded) {
  const l2 = decoded.l2;
  if (!l2 || l2.length < 2) return null;
  try {
    const view = new DataView(buffer, l2.offset, l2.length);
    if (l2.name === 'STP' || l2.name === 'RSTP' || l2.name === 'MSTP' || l2.name === 'PVST+ / Rapid-PVST+' || l2.name === 'Cisco Spanning Tree') {
      const details = parseBpdu(view, l2.length);
      if (details && details.vlan === null) details.vlan = decoded.vlanId;
      return details;
    }
    if (l2.name === 'CDP') return parseCdp(view, l2.length);
    if (l2.name === 'LLDP') return parseLldp(view, l2.length);
    if (l2.name === 'LACP') return parseLacp(view, l2.length);
  } catch {
    // truncated by snaplen - ignore
  }
  return null;
}
