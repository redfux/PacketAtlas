// Web Worker: rebuilds a classic .pcap file containing only the packets that
// match the currently selected devices/protocol filter/multicast toggle,
// optionally truncating each kept frame right after its L4 header to strip
// payload data. Re-uses the same parser/decoder scripts as parser.worker.js
// (classic worker, importScripts() - see that file for why) so filtering
// logic never drifts from how the file was originally interpreted.
// thought up by human, created by ai

// Bumped alongside APP_VERSION/WORKER_VERSION - see parser.worker.js for why
// these importScripts() URLs need a cache-busting query string.
const PCAP_EXPORT_WORKER_VERSION = '0.15.0';
importScripts(
  `pcap-parser.js?v=${PCAP_EXPORT_WORKER_VERSION}`,
  `pcapng-parser.js?v=${PCAP_EXPORT_WORKER_VERSION}`,
  `packet-decoder.js?v=${PCAP_EXPORT_WORKER_VERSION}`,
);

// Mirrors PROTOCOL_GROUPS in data-model.js - duplicated rather than imported
// because this is a classic (non-module) worker script, same rationale as
// pairKey() being duplicated in parser.worker.js.
const PROTOCOL_GROUPS = {
  TCP: ['TCP'],
  UDP: ['UDP'],
  ICMP: ['ICMP', 'ICMPv6'],
  OTHER: ['ARP', 'OTHER'],
};

function protocolGroupOf(protocol) {
  for (const [group, members] of Object.entries(PROTOCOL_GROUPS)) {
    if (members.includes(protocol)) return group;
  }
  return 'OTHER';
}

const OUT_GLOBAL_HEADER_LEN = 24;
const OUT_RECORD_HEADER_LEN = 16;
const PCAP_MAGIC_MICRO = 0xa1b2c3d4;
const OUTPUT_SNAPLEN = 262144; // conventional "effectively unlimited" value (matches dumpcap/tshark defaults)

self.onmessage = (event) => {
  try {
    buildFilteredPcap(event.data);
  } catch (err) {
    self.postMessage({ type: 'error', message: (err && (err.message || String(err))) || 'Unbekannter Fehler beim PCAP-Export.' });
  }
};

/**
 * Filtering happens per packet (not per aggregated pair): a packet is kept
 * only if BOTH endpoints are currently selected, its own protocol's group is
 * active, and (if hideMulticast) it isn't itself multicast/broadcast. This is
 * deliberately finer-grained than the Matrix/Graph's per-pair show/hide (a
 * pair there is visible if ANY of its protocols match the filter) - for an
 * export, unchecking e.g. "ARP" should drop the ARP packets themselves, not
 * just hide a pair whose ARP traffic happened to be its only traffic.
 */
function buildFilteredPcap({ buffer, selectedIds, activeGroups, hideMulticast, payloadMode }) {
  const selectedIdSet = new Set(selectedIds);
  const activeGroupSet = new Set(activeGroups);

  let frames;
  if (isPcapng(buffer)) {
    frames = parsePcapng(buffer);
  } else if (isClassicPcap(buffer)) {
    frames = parsePcap(buffer);
  } else {
    throw new Error('Datei ist weder ein gültiges pcap- noch pcapng-Format (Magic Number nicht erkannt) - ist das wirklich die ursprüngliche Capture-Datei?');
  }

  const totalBytes = buffer.byteLength || 1;
  let processedBytes = 0;
  let packetCount = 0;
  let lastProgressPost = 0;

  const matched = [];
  const linkTypeCounts = new Map();

  for (const frame of frames) {
    const decoded = decodeFrame(buffer, frame.offset, frame.length, frame.linkType, frame.timestamp, frame.origLen);
    if (decoded) {
      const srcId = decoded.srcIp || decoded.srcMac;
      const dstId = decoded.dstIp || decoded.dstMac;
      const inScope = srcId && dstId && srcId !== dstId && selectedIdSet.has(srcId) && selectedIdSet.has(dstId);
      const passesProtocol = inScope && activeGroupSet.has(protocolGroupOf(decoded.protocol));
      const passesMulticast = passesProtocol && !(hideMulticast && decoded.multicastOrBroadcast);
      if (passesMulticast) {
        let dataLength = frame.length;
        if (payloadMode === 'headers-only' && decoded.headerEndOffset != null) {
          const clampedEnd = Math.min(Math.max(decoded.headerEndOffset, frame.offset), frame.offset + frame.length);
          dataLength = clampedEnd - frame.offset;
        }
        matched.push({ timestamp: frame.timestamp, origLen: frame.origLen, dataOffset: frame.offset, dataLength, linkType: frame.linkType });
        linkTypeCounts.set(frame.linkType, (linkTypeCounts.get(frame.linkType) || 0) + 1);
      }
    }

    packetCount++;
    processedBytes += frame.bytesConsumed;
    if (processedBytes - lastProgressPost > totalBytes / 100 || packetCount % 5000 === 0) {
      lastProgressPost = processedBytes;
      self.postMessage({ type: 'progress', percent: Math.min(100, Math.round((processedBytes / totalBytes) * 100)) });
    }
  }

  if (matched.length === 0) {
    throw new Error('Keine Pakete entsprechen der aktuellen Auswahl/Filterung - nichts zu exportieren.');
  }

  // Classic pcap has exactly one link-type for the whole file. Real captures
  // are virtually always single-interface/single-link-type, but a pcapng
  // source could in principle mix them - keep only the dominant one and
  // report how many matched packets had to be dropped for this reason.
  let dominantLinkType = matched[0].linkType;
  const linkTypeTally = new Map();
  for (const m of matched) linkTypeTally.set(m.linkType, (linkTypeTally.get(m.linkType) || 0) + 1);
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

  self.postMessage({
    type: 'result',
    buffer: outBuffer,
    packetCount: included.length,
    skippedLinkTypeCount,
  }, [outBuffer]);
}
