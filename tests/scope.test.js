// Scoped statistics: the worker keeps the capture and recomputes the statistics for a subset of
// connections. For "everything" it must equal the full pass; for a subset it must count only
// that subset; a newer request must silence an older one.
// thought up by human, created by ai

import assert from 'node:assert/strict';
import { CaptureBuilder } from './lib/pcap-builder.js';
import { FIXTURES } from './fixtures.js';
import { createWorkerSession } from './lib/run-worker.js';

async function parsedWithScope(build, keysOf) {
  const session = createWorkerSession();
  const result = session.parse(build());
  const keys = keysOf ? keysOf(result.connections) : result.connections.map((c) => c.key);
  const reply = await session.scope(keys);
  return { session, result, reply };
}

export function register(test) {
  test('Scope = alle Verbindungen ergibt dieselbe Statistik wie der Gesamtdurchlauf (ohne L2-Frames im Capture)', async () => {
    for (const name of ['quality', 'fragments']) {
      const { result, reply } = await parsedWithScope(FIXTURES[name]);
      assert.equal(reply.type, 'scopedStats');
      assert.deepStrictEqual(reply.stats, result.stats, `Fixture ${name}`);
    }
  });

  test('Scope = alle Verbindungen: Abschnitte der Dienste stimmen überein; Layer-2-Frames gehören zu keiner Verbindung', async () => {
    const { result, reply } = await parsedWithScope(FIXTURES.services);
    const full = result.stats;
    const scoped = reply.stats;
    for (const section of ['tcp', 'tcpFlags', 'icmp', 'dns', 'dnsServers', 'relay', 'apple', 'tls', 'topPorts', 'fragmentation']) {
      assert.deepStrictEqual(scoped[section], full[section], `Abschnitt ${section}`);
    }
    assert.equal(scoped.l2, null);
    assert.equal(scoped.byProtocol.L2.packets, 0);
    assert.equal(full.decodedPackets - scoped.decodedPackets, 8, 'die acht Layer-2-Frames fehlen im Scope');
    assert.equal(scoped.totalPackets, scoped.decodedPackets);
  });

  test('eine Teilmenge zählt nur ihre Pakete', async () => {
    const { result, reply } = await parsedWithScope(FIXTURES.quality, (connections) => connections.filter((c) => c.key === '10.0.0.1|10.0.0.3|TCP|5001').map((c) => c.key));
    const flow = result.connections.find((c) => c.key === '10.0.0.1|10.0.0.3|TCP|5001');
    assert.equal(reply.stats.decodedPackets, flow.packets);
    assert.equal(reply.stats.byProtocol.TCP.packets, flow.packets);
    assert.equal(reply.stats.tcp.retransmissions, 10);
    assert.equal(reply.stats.tcp.streams, 1);
    assert.equal(reply.stats.tcp.resets, 0);
    assert.equal(reply.stats.dns, null);
    assert.equal(reply.stats.icmp.length, 0);
  });

  test('ein leerer Scope liefert eine leere Statistik statt eines Fehlers', async () => {
    const { reply } = await parsedWithScope(FIXTURES.quality, () => []);
    assert.equal(reply.type, 'scopedStats');
    assert.equal(reply.stats.decodedPackets, 0);
    assert.equal(reply.stats.totalPackets, 0);
  });

  test('ohne geladene Datei antwortet der Worker mit einem Fehler', async () => {
    const reply = await createWorkerSession().scope(['x']);
    assert.equal(reply.type, 'scopeError');
  });

  test('der Worker meldet, dass die Datei für Scopes verfügbar ist', () => {
    assert.equal(createWorkerSession().parse(FIXTURES.fragments()).scopeAvailable, true);
  });

  test('eine neuere Anfrage lässt die ältere verstummen', async () => {
    const b = new CaptureBuilder({ start: 3_000_000 });
    for (let i = 0; i < 12000; i++) b.udp('10.1.0.1', `10.2.0.${(i % 200) + 1}`, 40000, 9000, Buffer.alloc(10), { dt: 0.001 });
    const session = createWorkerSession();
    const result = session.parse(b.build());
    const all = result.connections.map((c) => c.key);
    const first = session.startScope(all);
    const second = session.startScope(all.slice(0, 10));
    const reply = await second.promise;
    assert.equal(reply.type, 'scopedStats');
    assert.equal(reply.stats.decodedPackets, result.connections.slice(0, 10).reduce((n, c) => n + c.packets, 0));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(!session.allMessages().some((m) => m.requestId === first.requestId), 'die ältere Anfrage darf nicht mehr antworten');
  });
}
