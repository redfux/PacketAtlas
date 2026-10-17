// PCAP export of the visible connections: the worker keeps the capture and rebuilds a classic pcap
// holding exactly the packets of the given connection keys. Checked by parsing the result again.
// thought up by human, created by ai

import assert from 'node:assert/strict';
import { FIXTURES } from './fixtures.js';
import { createWorkerSession } from './lib/run-worker.js';

const FLOW = '10.0.0.1|10.0.0.3|TCP|5001';

async function exportOf(build, keysOf, payloadMode = 'full') {
  const session = createWorkerSession();
  const result = session.parse(build());
  const keys = keysOf(result.connections);
  const reply = await session.exportPcap(keys, payloadMode);
  return { result, reply, keys };
}

/** Parses an exported pcap with a fresh worker, like the user opening it again. */
function reparse(reply) {
  return createWorkerSession().parse(Buffer.from(reply.buffer));
}

export function register(test) {
  test('Export aller Verbindungen enthält jedes Paket, das zu einer Verbindung gehört', async () => {
    for (const name of ['quality', 'fragments']) {
      const { result, reply } = await exportOf(FIXTURES[name], (connections) => connections.map((c) => c.key));
      assert.equal(reply.type, 'exportResult', `Fixture ${name}`);
      assert.equal(reply.packetCount, result.connections.reduce((sum, c) => sum + c.packets, 0));
      assert.equal(reply.skippedLinkTypeCount, 0);
      const again = reparse(reply);
      assert.equal(again.packetCount, reply.packetCount);
      assert.deepStrictEqual(again.connections.map((c) => [c.key, c.packets, c.bytes]), result.connections.map((c) => [c.key, c.packets, c.bytes]), `Fixture ${name}`);
    }
  });

  test('Export einer Teilmenge enthält nur deren Pakete', async () => {
    const { result, reply } = await exportOf(FIXTURES.quality, () => [FLOW]);
    const flow = result.connections.find((c) => c.key === FLOW);
    assert.equal(reply.packetCount, flow.packets);
    const again = reparse(reply);
    assert.equal(again.connections.length, 1);
    assert.equal(again.connections[0].key, FLOW);
    assert.equal(again.connections[0].bytes, flow.bytes);
    assert.equal(again.stats.tcp.retransmissions, 10);
  });

  test('Layer-2-Frames gehören zu keiner Verbindung und werden nie exportiert', async () => {
    const { result, reply } = await exportOf(FIXTURES.services, (connections) => connections.map((c) => c.key));
    assert.equal(result.packetCount - reply.packetCount, 8, 'die acht Layer-2-Frames fehlen im Export');
    assert.equal(reparse(reply).stats.byProtocol.L2.packets, 0);
  });

  test('„Ohne Payload“ schneidet hinter dem L4-Header ab, Paketzahl bleibt gleich', async () => {
    const full = await exportOf(FIXTURES.quality, () => [FLOW]);
    const headers = await exportOf(FIXTURES.quality, () => [FLOW], 'headers-only');
    assert.equal(headers.reply.packetCount, full.reply.packetCount);
    assert.ok(headers.reply.buffer.byteLength < full.reply.buffer.byteLength, 'kürzer als mit Payload');
    const again = reparse(headers.reply);
    assert.equal(again.connections[0].packets, full.result.connections.find((c) => c.key === FLOW).packets);
  });

  test('ein leerer Scope meldet „nichts zu exportieren“', async () => {
    const { reply } = await exportOf(FIXTURES.quality, () => []);
    assert.equal(reply.type, 'exportError');
    assert.match(reply.message, /nichts zu exportieren/);
  });

  test('ohne geladene Datei antwortet der Export mit einem Fehler', async () => {
    const reply = await createWorkerSession().exportPcap([FLOW]);
    assert.equal(reply.type, 'exportError');
  });
}
