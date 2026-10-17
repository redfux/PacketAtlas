// Everything that picks packets out of a capture by the connection they belong to: the
// connection key, frame parsing and the filtered .pcap rebuild. Shared (classic script,
// importScripts()) by parser.worker.js - which keeps the capture and serves statistics and
// export for the visible connections from it - and pcap-export.worker.js, the fallback for
// captures too large to keep in memory. Needs pcap-parser.js, pcapng-parser.js and
// packet-decoder.js loaded first.
// thought up by human, created by ai

function pairKey(idA, idB) {
  return idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`;
}

/**
 * The "service port" of a packet, used to correlate both directions of a
 * connection (client's ephemeral source port vs. the server's port) into one
 * entry: the lower of the two port numbers is almost always the server side.
 * Not a perfect heuristic, but correct for the vast majority of real traffic
 * and good enough for a human-facing "which ports do these devices talk
 * over" breakdown rather than an exact per-flow reconstruction.
 */
function servicePortOf(decoded) {
  if (decoded.srcPort == null || decoded.dstPort == null) return null;
  return Math.min(decoded.srcPort, decoded.dstPort);
}

/**
 * Identity of the connection a packet belongs to (device pair + protocol + service
 * port), or null for frames that belong to none: layer-2 control frames, frames
 * without addresses and self-talk. The Aggregator files packets under exactly this
 * key; the scoped statistics and the PCAP export select packets by it.
 */
function connectionKeyOf(decoded) {
  if (decoded.protocol === 'L2') return null;
  const srcId = decoded.srcIp || decoded.srcMac;
  const dstId = decoded.dstIp || decoded.dstMac;
  if (!srcId || !dstId || srcId === dstId) return null;
  return `${pairKey(srcId, dstId)}|${decoded.protocol}|${servicePortOf(decoded)}`;
}

function parseFrames(buffer) {
  if (isPcapng(buffer)) return parsePcapng(buffer);
  if (isClassicPcap(buffer)) return parsePcap(buffer);
  throw new Error('Datei ist weder ein gültiges pcap- noch pcapng-Format (Magic Number nicht erkannt) - ist das wirklich die ursprüngliche Capture-Datei?');
}

const OUT_GLOBAL_HEADER_LEN = 24;
const OUT_RECORD_HEADER_LEN = 16;
const PCAP_MAGIC_MICRO = 0xa1b2c3d4;
const OUTPUT_SNAPLEN = 262144; // conventional "effectively unlimited" value (matches dumpcap/tshark defaults)

/**
 * Rebuilds a classic .pcap holding only the packets of the given connections (`keys`, see
 * connectionKeyOf()), optionally cut right after the L4 header (`payloadMode` 'headers-only').
 * Layer-2 control frames and frames without addresses belong to no connection and are
 * therefore never exported. `onProgress(percent)` is called while scanning.
 * Returns { buffer, packetCount, skippedLinkTypeCount }; throws if nothing matches.
 */
function buildFilteredPcap(buffer, keys, payloadMode, onProgress) {
  const scope = new Set(keys);
  const frames = parseFrames(buffer);

  const totalBytes = buffer.byteLength || 1;
  let processedBytes = 0;
  let scanned = 0;
  let lastProgressPost = 0;
  const matched = [];

  for (const frame of frames) {
    const decoded = decodeFrame(buffer, frame.offset, frame.length, frame.linkType, frame.timestamp, frame.origLen);
    if (decoded) {
      const key = connectionKeyOf(decoded);
      if (key !== null && scope.has(key)) {
        let dataLength = frame.length;
        if (payloadMode === 'headers-only' && decoded.headerEndOffset != null) {
          const clampedEnd = Math.min(Math.max(decoded.headerEndOffset, frame.offset), frame.offset + frame.length);
          dataLength = clampedEnd - frame.offset;
        }
        matched.push({ timestamp: frame.timestamp, origLen: frame.origLen, dataOffset: frame.offset, dataLength, linkType: frame.linkType });
      }
    }

    scanned++;
    processedBytes += frame.bytesConsumed;
    if (onProgress && (processedBytes - lastProgressPost > totalBytes / 100 || scanned % 5000 === 0)) {
      lastProgressPost = processedBytes;
      onProgress(Math.min(100, Math.round((processedBytes / totalBytes) * 100)));
    }
  }

  if (matched.length === 0) {
    throw new Error('Keine Pakete entsprechen der aktuellen Auswahl/Filterung - nichts zu exportieren.');
  }

  // Classic pcap has exactly one link-type for the whole file. Real captures
  // are virtually always single-interface/single-link-type, but a pcapng
  // source could in principle mix them - keep only the dominant one and
  // report how many matched packets had to be dropped for this reason.
  const linkTypeTally = new Map();
  for (const m of matched) linkTypeTally.set(m.linkType, (linkTypeTally.get(m.linkType) || 0) + 1);
  let dominantLinkType = matched[0].linkType;
  let dominantCount = 0;
  for (const [linkType, count] of linkTypeTally) {
    if (count > dominantCount) { dominantCount = count; dominantLinkType = linkType; }
  }
  const included = matched.filter((m) => m.linkType === dominantLinkType);
  const skippedLinkTypeCount = matched.length - included.length;

  let outLength = OUT_GLOBAL_HEADER_LEN;
  for (const m of included) outLength += OUT_RECORD_HEADER_LEN + m.dataLength;

  const outBuffer = new ArrayBuffer(outLength);
  const outView = new DataView(outBuffer);
  const outBytes = new Uint8Array(outBuffer);
  const srcBytes = new Uint8Array(buffer);

  outView.setUint32(0, PCAP_MAGIC_MICRO, true);
  outView.setUint16(4, 2, true); // version_major
  outView.setUint16(6, 4, true); // version_minor
  outView.setInt32(8, 0, true); // thiszone
  outView.setUint32(12, 0, true); // sigfigs
  outView.setUint32(16, OUTPUT_SNAPLEN, true);
  outView.setUint32(20, dominantLinkType, true);

  let pos = OUT_GLOBAL_HEADER_LEN;
  for (const m of included) {
    const tsSec = Math.floor(m.timestamp);
    const tsUsec = Math.max(0, Math.round((m.timestamp - tsSec) * 1e6));
    outView.setUint32(pos, tsSec, true);
    outView.setUint32(pos + 4, tsUsec, true);
    outView.setUint32(pos + 8, m.dataLength, true);
    outView.setUint32(pos + 12, m.origLen, true);
    pos += OUT_RECORD_HEADER_LEN;
    outBytes.set(srcBytes.subarray(m.dataOffset, m.dataOffset + m.dataLength), pos);
    pos += m.dataLength;
  }

  return { buffer: outBuffer, packetCount: included.length, skippedLinkTypeCount };
}
