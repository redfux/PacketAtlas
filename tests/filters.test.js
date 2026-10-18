// Filter facets (filters.js) and the shared visibility rules (data-model.js).
// thought up by human, created by ai

import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { FIXTURES } from './fixtures.js';
import { runWorker, ROOT } from './lib/run-worker.js';

const filters = await import(pathToFileURL(path.join(ROOT, 'filters.js')).href);
const dataModel = await import(pathToFileURL(path.join(ROOT, 'data-model.js')).href);

const keysOf = (connections) => connections.map((c) => c.key).sort();
const matching = (connections, facets) => connections.filter((c) => filters.connectionMatchesFacets(c, facets));
const facetsOf = (...entries) => {
  const facets = filters.createFacetState();
  for (const [dimension, value] of entries) filters.toggleFacet(facets, dimension, value);
  return facets;
};

export function register(test) {
  test('Optionen: jede Dimension nennt ihre Werte mit Anzahl und Klartext-Beschriftung', () => {
    const { connections } = runWorker(FIXTURES.services());
    const groups = Object.fromEntries(filters.collectFacetOptions(connections).map((g) => [g.dimension, g]));
    assert.deepStrictEqual(groups.tlsVersion.options.map((o) => o.label).sort(), ['TLS 1.0', 'TLS 1.2', 'TLS 1.3']);
    assert.ok(groups.dnsRcode.options.some((o) => o.value === '3' && o.label === 'NXDOMAIN'));
    assert.ok(groups.dnsProvider.options.some((o) => o.label === 'Cisco Umbrella / OpenDNS' && o.count === 2));
    assert.ok(groups.relay.options.some((o) => o.value === 'blockpage' && o.label === 'Blockseiten-Antwort'));
    assert.ok(groups.apple.options.some((o) => o.label === 'Push (APNs)'));
    assert.ok(groups.port.options.some((o) => o.label === 'TCP 443 (HTTPS)'));
    assert.ok(!groups.fragments, 'Dimensionen ohne Wert erscheinen nicht');
  });

  test('ein Wert filtert genau die Verbindungen, die ihn haben', () => {
    const { connections } = runWorker(FIXTURES.services());
    assert.deepStrictEqual(keysOf(matching(connections, facetsOf(['tlsVersion', 'TLS 1.0']))), ['10.0.0.1|10.0.0.22|TCP|8443']);
    assert.deepStrictEqual(keysOf(matching(connections, facetsOf(['relay', 'blockpage']))), ['10.0.0.1|208.67.222.222|UDP|53', '10.0.0.2|208.67.222.222|UDP|53']);
  });

  test('gleiche Dimension = ODER, verschiedene Dimensionen = UND', () => {
    const { connections } = runWorker(FIXTURES.services());
    assert.equal(matching(connections, facetsOf(['tlsVersion', 'TLS 1.0'], ['tlsVersion', 'TLS 1.2'])).length, 2);
    assert.equal(matching(connections, facetsOf(['tlsVersion', 'TLS 1.2'], ['port', 'TCP|8443'])).length, 0);
    assert.equal(matching(connections, facetsOf(['tlsVersion', 'TLS 1.0'], ['port', 'TCP|8443'])).length, 1);
  });

  test('Problem-Facetten folgen den Zählern der Verbindung', () => {
    const { connections } = runWorker(FIXTURES.quality());
    assert.deepStrictEqual(keysOf(matching(connections, facetsOf(['problem', 'retransmits']))), ['10.0.0.1|10.0.0.3|TCP|5001']);
    assert.deepStrictEqual(keysOf(matching(connections, facetsOf(['problem', 'resets']))), ['10.0.0.1|10.0.0.4|TCP|22']);
    assert.deepStrictEqual(keysOf(matching(connections, facetsOf(['problem', 'icmpError']))), ['10.0.0.1|10.0.0.2|ICMP|null']);
  });

  test('ICMP-Typ und Fragmentierung', () => {
    const quality = runWorker(FIXTURES.quality()).connections;
    assert.equal(matching(quality, facetsOf(['icmp', 'ICMP|3|3'])).length, 1);
    const fragments = runWorker(FIXTURES.fragments()).connections;
    assert.equal(matching(fragments, facetsOf(['fragments', 'fragmentiert'])).length, 2);
  });

  test('toggleFacet schaltet um und räumt leere Dimensionen auf; facetEntries beschriftet für die Chips', () => {
    const facets = filters.createFacetState();
    assert.equal(filters.toggleFacet(facets, 'tlsVersion', 'TLS 1.0'), true);
    assert.equal(filters.isFacetActive(facets, 'tlsVersion', 'TLS 1.0'), true);
    assert.deepStrictEqual(filters.facetEntries(facets), [{ dimension: 'tlsVersion', value: 'TLS 1.0', dimensionLabel: 'TLS-Version', valueLabel: 'TLS 1.0' }]);
    assert.equal(filters.toggleFacet(facets, 'tlsVersion', 'TLS 1.0'), false);
    assert.equal(filters.hasFacets(facets), false);
    assert.equal(filters.facetPredicate(facets), null);
  });

  test('computeVisibleConnections: Auswahl, Protokolle, Multicast und Facetten wirken zusammen', () => {
    const { connections } = runWorker(FIXTURES.services());
    const all = new Set(connections.flatMap((c) => [c.a, c.b]));
    const groups = new Set(['TCP', 'UDP', 'ICMP', 'OTHER']);
    assert.equal(dataModel.computeVisibleConnections(connections, all, groups, false).length, connections.length);
    const tcpOnly = dataModel.computeVisibleConnections(connections, all, new Set(['TCP']), false);
    assert.ok(tcpOnly.length > 0 && tcpOnly.every((c) => c.protocol === 'TCP'));
    const withoutMulticast = dataModel.computeVisibleConnections(connections, all, groups, true);
    assert.ok(withoutMulticast.length < connections.length && withoutMulticast.every((c) => !c.multicastOrBroadcast));
    const oneDevice = new Set(['10.0.0.1', '10.0.0.20']);
    assert.deepStrictEqual(keysOf(dataModel.computeVisibleConnections(connections, oneDevice, groups, false)), ['10.0.0.1|10.0.0.20|TCP|443']);
    const predicate = filters.facetPredicate(facetsOf(['dnsProvider', 'Google Public DNS']));
    assert.deepStrictEqual(keysOf(dataModel.computeVisibleConnections(connections, all, groups, false, predicate)), ['10.0.0.1|8.8.8.8|UDP|53']);
  });

  test('Facette Problem „Auffällig“ entspricht dem früheren „Nur Probleme“: Verbindungen mit problems > 0', () => {
    const { connections } = runWorker(FIXTURES.quality());
    const all = new Set(connections.flatMap((c) => [c.a, c.b]));
    const groups = new Set(['TCP', 'UDP', 'ICMP', 'OTHER']);
    const expected = connections.filter((c) => c.problems > 0).map((c) => c.key).sort();
    assert.ok(expected.length > 0 && expected.length < connections.length);
    const facets = facetsOf(['problem', 'any']);
    assert.deepStrictEqual(keysOf(dataModel.computeVisibleConnections(connections, all, groups, false, filters.facetPredicate(facets))).sort(), expected);
    const options = filters.collectFacetOptions(connections).find((g) => g.dimension === 'problem').options;
    assert.equal(options.find((o) => o.value === 'any').count, expected.length);
    assert.equal(options.find((o) => o.value === 'any').label, 'Auffällig (beliebiges Problem)');
    assert.equal(filters.isFacetActive(filters.facetsWithoutValue(facets, 'problem', 'any'), 'problem', 'any'), false);
    assert.equal(filters.hasFacets(filters.facetsWithoutValue(facets, 'problem', 'any')), false);
  });
}
