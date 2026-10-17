// Pins what the analyses (traffic-stats.js and friends) report for the synthetic captures,
// so later refactoring - e.g. the scoped statistics - can prove it changed nothing.
// thought up by human, created by ai

import assert from 'node:assert/strict';
import { FIXTURES } from './fixtures.js';
import { runWorker } from './lib/run-worker.js';

export function register(test) {
  test('Qualität: Retransmits, RST und ICMP-Fehler werden erkannt und den Verbindungen zugeordnet', () => {
    const { stats, connections } = runWorker(FIXTURES.quality());
    assert.equal(stats.totalPackets, 120);
    assert.equal(stats.tcp.retransmissions, 10);
    assert.equal(stats.tcp.resets, 1);
    assert.equal(stats.tcp.streams, 3);
    assert.deepStrictEqual(stats.icmp.map((i) => [i.type, i.code, i.packets]), [[3, 3, 2], [8, 0, 1], [0, 0, 1]]);
    const problems = Object.fromEntries(connections.map((c) => [c.key, c.problems]));
    assert.equal(problems['10.0.0.1|10.0.0.3|TCP|5001'], 10);
    assert.equal(problems['10.0.0.1|10.0.0.4|TCP|22'], 1);
    assert.equal(problems['10.0.0.1|10.0.0.2|ICMP|null'], 2);
    assert.equal(problems['10.0.0.1|10.0.0.2|TCP|443'], 0);
    assert.equal(connections.reduce((n, c) => n + c.problems, 0), 13, 'Summe der Probleme je Verbindung = Retransmits + RST + ICMP-Fehler');
  });

  test('Layer 2: STP, PVST+, CDP, LLDP, LACP, EAPOL und unbekannter Ethertype; keine Geräte aus L2-Frames', () => {
    const { stats, devices } = runWorker(FIXTURES.services());
    assert.deepStrictEqual(stats.l2.protocols.map((p) => [p.name, p.packets]), [
      ['STP', 2], ['PVST+ / Rapid-PVST+', 1], ['CDP', 1], ['LLDP', 1], ['LACP', 1], ['EAPOL (802.1X)', 1], ['Ethertyp 0x1234', 1],
    ]);
    assert.equal(stats.l2.stp.bpdus, 3);
    assert.equal(stats.l2.stp.tcnBpdus, 1);
    assert.equal(stats.l2.stp.tcFlagBpdus, 1);
    assert.deepStrictEqual(stats.l2.stp.roots.map((r) => [r.vlan, r.rootId]), [[null, '8000.00:aa:bb:cc:dd:01'], [20, '8014.00:aa:bb:cc:dd:01']]);
    assert.deepStrictEqual(stats.l2.neighbors.map((n) => `${n.protocol}:${n.deviceId}:${n.mgmtIp}`), ['LLDP:AP-Flur-2:10.0.0.251', 'CDP:SW1.lab:10.0.0.250']);
    assert.deepStrictEqual(stats.l2.lacp, { pdus: 1, outOfSync: 1, defaultedOrExpired: 1 });
    assert.deepStrictEqual(stats.l2.vlans.map((v) => v.id), [30]);
    assert.ok(devices.every((d) => !d.id.startsWith('01:')), 'Multicast-Ziel-MACs der Steuerframes dürfen keine Geräte werden');
  });

  test('Private Relay: Antwortformen je Name und Zustand je Client', () => {
    const { stats } = runWorker(FIXTURES.services());
    const byName = Object.fromEntries(stats.relay.names.map((n) => [n.name, n]));
    assert.equal(byName['mask.icloud.com'].queries, 7);
    assert.equal(byName['mask.icloud.com'].blockpage, 7);
    assert.equal(byName['mask-h2.icloud.com'].nxdomain, 1);
    assert.equal(byName['mask-h2.icloud.com'].unanswered, 1);
    assert.equal(byName['mask-api.icloud.com'].nodata, 1);
    assert.equal(byName['mask.apple-dns.net'].addresses, 1);
    const states = Object.fromEntries(stats.relay.clients.map((c) => [c.address, c.state]));
    assert.deepStrictEqual(states, { '10.0.0.2': 'broken', '10.0.0.1': 'active', '10.0.0.3': 'active' });
  });

  test('DNS-Server: Anbieter-Zuordnung, Mehrfachnutzung, DoT und Port-443-Verdacht', () => {
    const { stats } = runWorker(FIXTURES.services());
    assert.deepStrictEqual(stats.dnsServers.categories.map((c) => [c.category, c.queries, c.clients]), [['umbrella', 12, 2], ['private', 4, 1], ['google', 1, 1]]);
    assert.deepStrictEqual(stats.dnsServers.mixedClients.map((m) => [m.client, m.bypassHint]), [['10.0.0.1', true]]);
    assert.equal(stats.dnsServers.dot.length, 1);
    assert.equal(stats.dnsServers.doh.length, 1);
  });

  test('TLS und Apple: Versionen, veraltete Server, Apple-Gruppen', () => {
    const { stats } = runWorker(FIXTURES.services());
    assert.deepStrictEqual(stats.tls.versions.map((v) => [v.name, v.count, v.outdated]), [['TLS 1.3', 1, false], ['TLS 1.2', 1, false], ['TLS 1.0', 1, true]]);
    assert.deepStrictEqual(stats.apple.groups.map((g) => [g.name, g.packets]), [
      ['QUIC zu Apple (UDP 443)', 2], ['HTTPS zu Apple (TCP 443)', 2], ['Push (APNs)', 1], ['Zeitdienst (NTP)', 1], ['Bonjour / mDNS', 1],
    ]);
  });

  test('Fragmentierung wird gezählt', () => {
    const { stats } = runWorker(FIXTURES.fragments());
    assert.equal(stats.fragmentation.ipv4Fragments, 2);
    assert.equal(stats.fragmentation.fragmentedDatagrams, 1);
  });

  test('jede Verbindung trägt einen Schlüssel und Port-Mengen je Richtung', () => {
    const { connections } = runWorker(FIXTURES.quality());
    const keys = new Set(connections.map((c) => c.key));
    assert.equal(keys.size, connections.length, 'Schlüssel sind eindeutig');
    const tcp = connections.find((c) => c.key === '10.0.0.1|10.0.0.2|TCP|443');
    assert.deepStrictEqual(tcp.aToB.srcPorts, [5000]);
    assert.deepStrictEqual(tcp.aToB.dstPorts, [443]);
  });
}
