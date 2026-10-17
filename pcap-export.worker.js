// Web Worker: fallback for the PCAP export of captures too large for parser.worker.js to keep
// in memory (see MAX_RETAINED_BYTES there). The page then asks for the original file again and
// hands it over together with the keys of the visible connections; the rebuild itself is the
// shared buildFilteredPcap() from capture-scope.js, same as in parser.worker.js. Classic worker
// (importScripts) - see parser.worker.js for why.
// thought up by human, created by ai

// Derived from this worker's own URL - see parser.worker.js for the same
// pattern and the reasoning. app.js constructs
// `new Worker('pcap-export.worker.js?v=' + APP_VERSION)`, so reusing that
// query string here (instead of a second hardcoded constant) means
// APP_VERSION in app.js is the only place a release bump has to happen.
const PCAP_EXPORT_WORKER_VERSION = new URL(self.location.href).searchParams.get('v') || '0';
importScripts(
  `pcap-parser.js?v=${PCAP_EXPORT_WORKER_VERSION}`,
  `pcapng-parser.js?v=${PCAP_EXPORT_WORKER_VERSION}`,
  `packet-decoder.js?v=${PCAP_EXPORT_WORKER_VERSION}`,
  `capture-scope.js?v=${PCAP_EXPORT_WORKER_VERSION}`,
);

self.onmessage = (event) => {
  try {
    const { buffer, keys, payloadMode } = event.data;
    const result = buildFilteredPcap(buffer, keys, payloadMode, (percent) => self.postMessage({ type: 'progress', percent }));
    self.postMessage({ type: 'result', ...result }, [result.buffer]);
  } catch (err) {
    self.postMessage({ type: 'error', message: (err && (err.message || String(err))) || 'Unbekannter Fehler beim PCAP-Export.' });
  }
};
