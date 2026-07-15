// pcapng capture file format parser (block-based).
// Spec: https://www.ietf.org/archive/id/draft-ietf-opsawg-pcapng-03.html
// Supports the block types that actually occur in Wireshark-generated captures:
// Section Header Block, Interface Description Block, Enhanced Packet Block,
// and the legacy (obsolete) Packet Block.
// thought up by human, created by ai

const BLOCK_TYPE_SHB = 0x0a0d0d0a;
const BLOCK_TYPE_IDB = 0x00000001;
const BLOCK_TYPE_PB = 0x00000002; // obsolete, but still seen in older captures
const BLOCK_TYPE_EPB = 0x00000006;
const BYTE_ORDER_MAGIC = 0x1a2b3c4d;
const OPTION_IF_TSRESOL = 9;
const MIN_BLOCK_LEN = 12;

export function isPcapng(buffer) {
  if (buffer.byteLength < 4) return false;
  return new DataView(buffer).getUint32(0, false) === BLOCK_TYPE_SHB;
}

function readTsResolFromOptions(view, optionsStart, optionsEnd, littleEndian) {
  let pos = optionsStart;
  while (pos + 4 <= optionsEnd) {
    const optCode = view.getUint16(pos, littleEndian);
    const optLen = view.getUint16(pos + 2, littleEndian);
    if (optCode === 0 && optLen === 0) break; // opt_endofopt
    const valueStart = pos + 4;
    if (optCode === OPTION_IF_TSRESOL && optLen >= 1 && valueStart < optionsEnd) {
      const raw = view.getUint8(valueStart);
      const negative = (raw & 0x80) !== 0;
      const exponent = raw & 0x7f;
      return negative ? Math.pow(2, exponent) : Math.pow(10, exponent);
    }
    pos = valueStart + optLen + ((4 - (optLen % 4)) % 4); // options are padded to 32 bits
  }
  return 1e6; // default: microsecond resolution
}

/**
 * Generator yielding one entry per captured frame, same shape as parsePcap():
 * { offset, length, origLen, timestamp, linkType, bytesConsumed }
 * Throws a descriptive Error on structural corruption.
 */
export function* parsePcapng(buffer) {
  let offset = 0;
  let littleEndian = true;
  const interfaces = []; // { linkType, tsResol }

  while (offset + MIN_BLOCK_LEN <= buffer.byteLength) {
    // Block type is endianness-agnostic to read initially (checked against SHB magic directly).
    const typeView = new DataView(buffer, offset, 4);
    const blockType = typeView.getUint32(0, false) === BLOCK_TYPE_SHB ? BLOCK_TYPE_SHB : typeView.getUint32(0, littleEndian);

    if (blockType === BLOCK_TYPE_SHB) {
      const shbView = new DataView(buffer, offset, Math.min(16, buffer.byteLength - offset));
      const be = shbView.getUint32(8, false);
      const le = shbView.getUint32(8, true);
      if (be === BYTE_ORDER_MAGIC) littleEndian = false;
      else if (le === BYTE_ORDER_MAGIC) littleEndian = true;
      else throw new Error('Ungültiges Byte-Order-Magic im Section Header Block.');
      interfaces.length = 0; // a new section resets the interface list
    }

    const blockLenView = new DataView(buffer, offset, MIN_BLOCK_LEN);
    const blockTotalLength = blockLenView.getUint32(4, littleEndian);
    if (blockTotalLength < MIN_BLOCK_LEN || blockTotalLength % 4 !== 0) {
      throw new Error('Beschädigter Block: ungültige Blocklänge.');
    }
    if (offset + blockTotalLength > buffer.byteLength) {
      throw new Error('Beschädigter Block: Blocklänge übersteigt die Dateigröße.');
    }
    const trailingLength = new DataView(buffer, offset + blockTotalLength - 4, 4).getUint32(0, littleEndian);
    if (trailingLength !== blockTotalLength) {
      throw new Error('Beschädigter Block: Längenangaben am Blockanfang/-ende stimmen nicht überein.');
    }

    const bodyEnd = offset + blockTotalLength - 4;

    if (blockType === BLOCK_TYPE_IDB) {
      const idbView = new DataView(buffer, offset, blockTotalLength);
      const linkType = idbView.getUint16(8, littleEndian);
      const tsResol = readTsResolFromOptions(idbView, 8 + 8, blockTotalLength - 4, littleEndian);
      interfaces.push({ linkType, tsResol });
    } else if (blockType === BLOCK_TYPE_EPB) {
      const view = new DataView(buffer, offset, blockTotalLength);
      const interfaceId = view.getUint32(8, littleEndian);
      const tsHigh = view.getUint32(12, littleEndian);
      const tsLow = view.getUint32(16, littleEndian);
      const capturedLen = view.getUint32(20, littleEndian);
      const origLen = view.getUint32(24, littleEndian);
      const dataOffset = offset + 28;
      if (dataOffset + capturedLen > bodyEnd) {
        throw new Error('Beschädigter Enhanced Packet Block: Paketdaten übersteigen die Blockgrenze.');
      }
      const iface = interfaces[interfaceId] || { linkType: 1, tsResol: 1e6 };
      const ts64 = (BigInt(tsHigh) << 32n) | BigInt(tsLow >>> 0);
      yield {
        offset: dataOffset,
        length: capturedLen,
        origLen,
        timestamp: Number(ts64) / iface.tsResol,
        linkType: iface.linkType,
        bytesConsumed: blockTotalLength,
      };
    } else if (blockType === BLOCK_TYPE_PB) {
      const view = new DataView(buffer, offset, blockTotalLength);
      const interfaceId = view.getUint16(8, littleEndian);
      const tsHigh = view.getUint32(12, littleEndian);
      const tsLow = view.getUint32(16, littleEndian);
      const capturedLen = view.getUint32(20, littleEndian);
      const origLen = view.getUint32(24, littleEndian);
      const dataOffset = offset + 28;
      if (dataOffset + capturedLen > bodyEnd) {
        throw new Error('Beschädigter Packet Block: Paketdaten übersteigen die Blockgrenze.');
      }
      const iface = interfaces[interfaceId] || { linkType: 1, tsResol: 1e6 };
      const ts64 = (BigInt(tsHigh) << 32n) | BigInt(tsLow >>> 0);
      yield {
        offset: dataOffset,
        length: capturedLen,
        origLen,
        timestamp: Number(ts64) / iface.tsResol,
        linkType: iface.linkType,
        bytesConsumed: blockTotalLength,
      };
    }
    // Other block types (Name Resolution, Interface Statistics, custom blocks, ...)
    // are intentionally skipped - only their length is used to advance `offset`.

    offset += blockTotalLength;
  }
}
