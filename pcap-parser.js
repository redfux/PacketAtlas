// Classic (libpcap) capture file format parser.
// Spec: https://www.tcpdump.org/manpages/pcap-savefile.5.txt
// thought up by human, created by ai

const MAGIC_MICRO = 0xa1b2c3d4;
const MAGIC_NANO = 0xa1b23c4d;
const GLOBAL_HEADER_LEN = 24;
const RECORD_HEADER_LEN = 16;

export function isClassicPcap(buffer) {
  if (buffer.byteLength < 4) return false;
  const view = new DataView(buffer);
  const be = view.getUint32(0, false);
  const le = view.getUint32(0, true);
  return be === MAGIC_MICRO || be === MAGIC_NANO || le === MAGIC_MICRO || le === MAGIC_NANO;
}

/**
 * Generator yielding one entry per captured frame:
 * { offset, length, origLen, timestamp, linkType, bytesConsumed }
 * `offset`/`length` describe the raw frame payload within `buffer` (still
 * link-layer encoded - decoding happens separately in packet-decoder.js).
 * Throws a descriptive Error on structural corruption.
 */
export function* parsePcap(buffer) {
  if (buffer.byteLength < GLOBAL_HEADER_LEN) {
    throw new Error('Datei ist zu klein für einen gültigen pcap-Header.');
  }
  const headerView = new DataView(buffer, 0, GLOBAL_HEADER_LEN);
  const be = headerView.getUint32(0, false);
  const le = headerView.getUint32(0, true);
  let littleEndian;
  let nano;
  if (be === MAGIC_MICRO || be === MAGIC_NANO) {
    littleEndian = false;
    nano = be === MAGIC_NANO;
  } else if (le === MAGIC_MICRO || le === MAGIC_NANO) {
    littleEndian = true;
    nano = le === MAGIC_NANO;
  } else {
    throw new Error('Unbekannte Magic Number – keine gültige pcap-Datei.');
  }

  const linkType = headerView.getUint32(20, littleEndian);

  let offset = GLOBAL_HEADER_LEN;
  while (offset + RECORD_HEADER_LEN <= buffer.byteLength) {
    const recordView = new DataView(buffer, offset, RECORD_HEADER_LEN);
    const tsSec = recordView.getUint32(0, littleEndian);
    const tsFrac = recordView.getUint32(4, littleEndian);
    const inclLen = recordView.getUint32(8, littleEndian);
    const origLen = recordView.getUint32(12, littleEndian);

    const dataOffset = offset + RECORD_HEADER_LEN;
    if (inclLen > buffer.byteLength - dataOffset) {
      throw new Error('Beschädigter Record: angegebene Paketlänge übersteigt die Dateigröße.');
    }

    yield {
      offset: dataOffset,
      length: inclLen,
      origLen,
      timestamp: tsSec + tsFrac / (nano ? 1e9 : 1e6),
      linkType,
      bytesConsumed: RECORD_HEADER_LEN + inclLen,
    };

    offset = dataOffset + inclLen;
  }
}
