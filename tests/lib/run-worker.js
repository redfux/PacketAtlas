// Runs the real parser worker (parser.worker.js and everything it importScripts()) inside a
// Node vm context, so the tests exercise exactly the code the browser runs.
// thought up by human, created by ai

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Parses `capture` (Buffer) like the worker does and returns its result message as plain JSON data. */
export function runWorker(capture) {
  let result = null;
  let failure = null;
  const self = {
    location: { href: 'http://test.invalid/parser.worker.js?v=test' },
    postMessage(message) {
      if (message.type === 'result') result = message;
      else if (message.type === 'error') failure = message.message;
    },
  };
  const context = {
    self, URL, console, DataView, Uint8Array, ArrayBuffer, TextDecoder, Map, Set, Math, Array, Number, Object, Error,
    importScripts: (...files) => {
      for (const file of files) {
        const name = file.split('?')[0];
        vm.runInContext(fs.readFileSync(path.join(ROOT, name), 'utf8'), context, { filename: name });
      }
    },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'parser.worker.js'), 'utf8'), context, { filename: 'parser.worker.js' });
  const buffer = capture.buffer.slice(capture.byteOffset, capture.byteOffset + capture.byteLength);
  self.onmessage({ data: { buffer } });
  if (failure) throw new Error(failure);
  // Objects made inside the vm have foreign prototypes; a JSON round trip gives plain ones assert can compare.
  return JSON.parse(JSON.stringify(result));
}
