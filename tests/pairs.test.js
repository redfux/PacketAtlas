// derivePairs() (data-model.js) must give exactly the pairs the worker used to aggregate per
// packet. The golden files in tests/golden/ were written from the worker's own pair
// aggregation before that code was removed; synthetic captures only (no customer data).
// thought up by human, created by ai

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FIXTURES } from './fixtures.js';
import { runWorker, ROOT } from './lib/run-worker.js';
import { normalizePairs } from './lib/normalize.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataModel = await import(pathToFileURL(path.join(ROOT, 'data-model.js')).href);

export function register(test) {
  for (const [name, build] of Object.entries(FIXTURES)) {
    test(`derivePairs(alle Verbindungen) entspricht dem Golden-Stand: ${name}`, () => {
      const result = runWorker(build());
      const golden = JSON.parse(fs.readFileSync(path.join(here, 'golden', `pairs-${name}.json`), 'utf8'));
      assert.deepStrictEqual(normalizePairs(dataModel.derivePairs(result.connections)), golden);
    });
  }

  test('derivePairs ist unabhängig von der Reihenfolge der Verbindungen', () => {
    const { connections } = runWorker(FIXTURES.services());
    const reversed = [...connections].reverse();
    assert.deepStrictEqual(normalizePairs(dataModel.derivePairs(reversed)), normalizePairs(dataModel.derivePairs(connections)));
  });

  test('ein Protokoll-Filter verkleinert auch die Summen eines Paares (nicht nur die Sichtbarkeit)', () => {
    const { connections } = runWorker(FIXTURES.quality());
    const pairOf = (list) => dataModel.derivePairs(list).find((p) => [p.a, p.b].includes('10.0.0.2') && [p.a, p.b].includes('10.0.0.1'));
    const all = pairOf(connections);
    const tcpOnly = pairOf(connections.filter((c) => c.protocol === 'TCP'));
    assert.ok(all.protocols.includes('ICMP'));
    assert.deepStrictEqual(tcpOnly.protocols, ['TCP']);
    assert.ok(tcpOnly.packets < all.packets);
    assert.equal(tcpOnly.packets, connections.filter((c) => c.protocol === 'TCP' && ['10.0.0.1|10.0.0.2'].includes([c.a, c.b].sort().join('|'))).reduce((n, c) => n + c.packets, 0));
  });

  test('leere Eingabe ergibt keine Paare', () => {
    assert.deepStrictEqual(dataModel.derivePairs([]), []);
  });
}
