// Web Worker: owns the entire parse -> decode -> aggregate pipeline so the
// main thread (and the UI) stays responsive even for very large captures.
// thought up by human, created by ai

import { isClassicPcap, parsePcap } from './pcap-parser.js';
import { isPcapng, parsePcapng } from './pcapng-parser.js';
import { decodeFrame } from './packet-decoder.js';
import { extractDnsHostnames, DNS_PORT } from './dns-resolver.js';
import { Aggregator } from './data-model.js';

self.onmessage = (event) => {
  try {
    processBuffer(event.data.buffer);
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message || 'Unbekannter Parsing-Fehler.' });
  }
};

function processBuffer(buffer) {
  let frames;
  if (isPcapng(buffer)) {
    frames = parsePcapng(buffer);
  } else if (isClassicPcap(buffer)) {
    frames = parsePcap(buffer);
  } else {
    throw new Error('Datei ist weder ein gültiges pcap- noch pcapng-Format (Magic Number nicht erkannt).');
  }

  const aggregator = new Aggregator();
  const totalBytes = buffer.byteLength || 1;
  let processedBytes = 0;
  let packetCount = 0;
  let lastProgressPost = 0;

  for (const frame of frames) {
    const decoded = decodeFrame(buffer, frame.offset, frame.length, frame.linkType, frame.timestamp, frame.origLen);
    if (decoded) {
      aggregator.addPacket(decoded);
      if (decoded.udpPayloadOffset != null && (decoded.srcPort === DNS_PORT || decoded.dstPort === DNS_PORT)) {
        for (const { ip, hostname } of extractDnsHostnames(buffer, decoded.udpPayloadOffset, decoded.udpPayloadLength)) {
          aggregator.addHostname(ip, hostname);
        }
      }
    }

    packetCount++;
    processedBytes += frame.bytesConsumed;
    if (processedBytes - lastProgressPost > totalBytes / 200 || packetCount % 5000 === 0) {
      lastProgressPost = processedBytes;
      self.postMessage({
        type: 'progress',
        percent: Math.min(100, Math.round((processedBytes / totalBytes) * 100)),
        packetCount,
      });
    }
  }

  const result = aggregator.toResult();
  self.postMessage({ type: 'result', devices: result.devices, pairs: result.pairs, packetCount });
}
