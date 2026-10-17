// Runs the real parser worker (parser.worker.js and everything it importScripts()) inside a
// Node vm context, so the tests exercise exactly the code the browser runs.
// thought up by human, created by ai

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Objects made inside the vm have foreign prototypes; a JSON round trip gives plain ones assert can compare.
const plain = (value) => JSON.parse(JSON.stringify(value));

/**
 * One worker instance. `parse(capture)` is the first message the page sends; `scope(keys)` the
 * later request for statistics of a subset of connections (resolves with the worker's reply).
 */
export function createWorkerSession() {
  const messages = [];
  const waiters = [];
  const self = {
    location: { href: 'http://test.invalid/parser.worker.js?v=test' },
    postMessage(message) {
      messages.push(message);
      for (const waiter of [...waiters]) {
        if (waiter.predicate(message)) {
          waiters.splice(waiters.indexOf(waiter), 1);
          waiter.resolve(message);
        }
      }
    },
  };
  const context = {
    self, URL, console, DataView, Uint8Array, ArrayBuffer, TextDecoder, Map, Set, Math, Array, Number, Object, Error, Promise, setTimeout,
    importScripts: (...files) => {
      for (const file of files) {
        const name = file.split('?')[0];
        vm.runInContext(fs.readFileSync(path.join(ROOT, name), 'utf8'), context, { filename: name });
      }
    },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'parser.worker.js'), 'utf8'), context, { filename: 'parser.worker.js' });

  const waitFor = (predicate) => {
    const existing = messages.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve) => waiters.push({ predicate, resolve }));
  };
  let nextRequestId = 1;

  return {
    allMessages: () => messages,
    parse(capture) {
      const buffer = capture.buffer.slice(capture.byteOffset, capture.byteOffset + capture.byteLength);
      self.onmessage({ data: { buffer } });
      const failure = messages.find((m) => m.type === 'error');
      if (failure) throw new Error(failure.message);
      return plain(messages.find((m) => m.type === 'result'));
    },
    /** Sends a scope request; `promise` resolves with the reply, `requestId` identifies it. */
    startScope(keys) {
      const requestId = nextRequestId++;
      self.onmessage({ data: { type: 'scope', requestId, keys } });
      const promise = waitFor((m) => (m.type === 'scopedStats' || m.type === 'scopeError') && m.requestId === requestId).then(plain);
      return { requestId, promise };
    },
    scope(keys) {
      return this.startScope(keys).promise;
    },
  };
}

/** Parses `capture` (Buffer) like the worker does and returns its result message as plain JSON data. */
export function runWorker(capture) {
  return createWorkerSession().parse(capture);
}
