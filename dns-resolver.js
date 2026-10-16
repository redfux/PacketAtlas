// Best-effort DNS response parsing to build an IP -> hostname map for tooltips.
// This is a nice-to-have: any parsing failure is swallowed, never surfaced to the user.
// Loaded into the worker via importScripts() as a classic (non-module) script
// for maximum browser compatibility, so no import/export syntax here.
// thought up by human, created by ai

const DNS_PORT = 53;
const TYPE_A = 1;
const TYPE_AAAA = 28;
const TYPE_CNAME = 5;
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
 * Parses header, first question and (for responses) the answer records of a
 * DNS message for the statistics view: response code, query/response flag,
 * queried name and type, and the addresses / CNAME targets of the answers.
 * Returns null for anything that does not look like DNS. Names are lower-cased;
 * labels are raw bytes from the capture, so they must be escaped before they
 * are put into HTML.
 */
function parseDnsMessage(buffer, offset, length) {
  if (length < 12) return null;
  try {
    const view = new DataView(buffer, offset, length);
    const flags = view.getUint16(2);
    const opcode = (flags >> 11) & 0x0f;
    if (opcode > 5) return null; // not a plausible DNS opcode - most likely some other protocol on port 53
    const qdCount = view.getUint16(4);
    const anCount = view.getUint16(6);
    const message = {
      id: view.getUint16(0),
      isResponse: (flags & 0x8000) !== 0,
      rcode: flags & 0x0f,
      name: null,
      qtype: null,
      answerCount: anCount,
      addresses: [],
      cnames: [],
    };
    let pos = 12;
    for (let i = 0; i < qdCount && i < 8; i++) {
      const question = readName(view, pos);
      if (i === 0) {
        message.name = question.name.toLowerCase() || '.';
        if (question.nextPos + 2 <= view.byteLength) message.qtype = view.getUint16(question.nextPos);
      }
      pos = question.nextPos + 4;
    }
    if (message.isResponse && anCount > 0) {
      for (let i = 0; i < anCount && i < 32; i++) {
        const record = readName(view, pos);
        pos = record.nextPos;
        if (pos + 10 > view.byteLength) break;
        const type = view.getUint16(pos);
        const rdLength = view.getUint16(pos + 8);
        const rdata = pos + 10;
        if (rdata + rdLength > view.byteLength) break;
        if (type === TYPE_A && rdLength === 4) {
          message.addresses.push(`${view.getUint8(rdata)}.${view.getUint8(rdata + 1)}.${view.getUint8(rdata + 2)}.${view.getUint8(rdata + 3)}`);
        } else if (type === TYPE_AAAA && rdLength === 16) {
          message.addresses.push(formatIPv6(view, rdata));
        } else if (type === TYPE_CNAME) {
          message.cnames.push(readName(view, rdata).name.toLowerCase());
        }
        pos = rdata + rdLength;
      }
    }
    return message;
  } catch {
    return null;
  }
}

/**
 * Names found in an mDNS (UDP 5353) message: the questions and the owner names
 * of all records (service types like `_airplay._tcp.local`, host names like
 * `hannes-iphone.local`). Returns null if it does not look like DNS.
 */
function parseMdnsNames(buffer, offset, length) {
  if (length < 12) return null;
  try {
    const view = new DataView(buffer, offset, length);
    const flags = view.getUint16(2);
    if (((flags >> 11) & 0x0f) !== 0) return null;
    const qdCount = Math.min(view.getUint16(4), 16);
    const recordCount = Math.min(view.getUint16(6) + view.getUint16(8) + view.getUint16(10), 48);
    const names = [];
    let pos = 12;
    for (let i = 0; i < qdCount; i++) {
      const question = readName(view, pos);
      names.push(question.name.toLowerCase());
      pos = question.nextPos + 4;
    }
    for (let i = 0; i < recordCount; i++) {
      const record = readName(view, pos);
      pos = record.nextPos;
      if (pos + 10 > view.byteLength) break;
      const rdLength = view.getUint16(pos + 8);
      if (pos + 10 + rdLength > view.byteLength) break;
      names.push(record.name.toLowerCase());
      pos += 10 + rdLength;
    }
    return { isResponse: (flags & 0x8000) !== 0, names };
  } catch {
    return null;
  }
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
        // Same compressed form the packet decoder uses, so the address matches a device ID.
        results.push({ ip: formatIPv6(view, rdataOffset), hostname: recordName || null });
      }
      pos = rdataOffset + rdLength;
    }
    return results.filter((r) => r.hostname);
  } catch {
    return [];
  }
}
