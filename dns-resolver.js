// Best-effort DNS response parsing to build an IP -> hostname map for tooltips.
// This is a nice-to-have: any parsing failure is swallowed, never surfaced to the user.
// Loaded into the worker via importScripts() as a classic (non-module) script
// for maximum browser compatibility, so no import/export syntax here.
// thought up by human, created by ai

const DNS_PORT = 53;
const TYPE_A = 1;
const TYPE_AAAA = 28;
const CLASS_IN = 1;

function readName(view, start) {
  const labels = [];
  let pos = start;
  let advancedPastPointer = false;
  let firstPointerEnd = -1;
  let guard = 0;

  while (pos < view.byteLength && guard < 128) {
    guard++;
    const len = view.getUint8(pos);
    if (len === 0) {
      pos += 1;
      if (!advancedPastPointer) firstPointerEnd = pos;
      break;
    }
    if ((len & 0xc0) === 0xc0) {
      if (pos + 1 >= view.byteLength) break;
      const pointer = ((len & 0x3f) << 8) | view.getUint8(pos + 1);
      if (!advancedPastPointer) {
        firstPointerEnd = pos + 2;
        advancedPastPointer = true;
      }
      pos = pointer;
      continue;
    }
    let label = '';
    for (let i = 0; i < len; i++) {
      label += String.fromCharCode(view.getUint8(pos + 1 + i));
    }
    labels.push(label);
    pos += len + 1;
  }

  return {
    name: labels.join('.'),
    nextPos: advancedPastPointer ? firstPointerEnd : pos,
  };
}

/**
 * Extracts IP -> hostname mappings from a UDP/53 payload, if it looks like a
 * DNS response containing A/AAAA answers. Returns an empty array on anything
 * unexpected (truncated data, non-DNS payload, query without answers, ...).
 */
function extractDnsHostnames(buffer, offset, length) {
  if (length < 12) return [];
  const view = new DataView(buffer, offset, length);
  const flags = view.getUint16(2);
  const isResponse = (flags & 0x8000) !== 0;
  if (!isResponse) return [];

  const qdCount = view.getUint16(4);
  const anCount = view.getUint16(6);
  if (anCount === 0) return [];

  let pos = 12;
  try {
    for (let i = 0; i < qdCount; i++) {
      const { nextPos } = readName(view, pos);
      pos = nextPos + 4; // QTYPE + QCLASS
    }

    const results = [];
    for (let i = 0; i < anCount; i++) {
      const { name: recordName, nextPos } = readName(view, pos);
      pos = nextPos;
      if (pos + 10 > view.byteLength) break;
      const type = view.getUint16(pos);
      const cls = view.getUint16(pos + 2);
      const rdLength = view.getUint16(pos + 8);
      const rdataOffset = pos + 10;
      if (rdataOffset + rdLength > view.byteLength) break;

      if (cls === CLASS_IN && type === TYPE_A && rdLength === 4) {
        const ip = `${view.getUint8(rdataOffset)}.${view.getUint8(rdataOffset + 1)}.${view.getUint8(rdataOffset + 2)}.${view.getUint8(rdataOffset + 3)}`;
        results.push({ ip, hostname: recordName || null });
      } else if (cls === CLASS_IN && type === TYPE_AAAA && rdLength === 16) {
        const groups = [];
        for (let g = 0; g < 8; g++) groups.push(view.getUint16(rdataOffset + g * 2).toString(16));
        results.push({ ip: groups.join(':'), hostname: recordName || null });
      }
      pos = rdataOffset + rdLength;
    }
    return results.filter((r) => r.hostname);
  } catch {
    return [];
  }
}
