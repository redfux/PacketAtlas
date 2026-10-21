// Filter facets: criteria on a connection's content that go beyond the sidebar
// selection and the protocol chips - "TLS 1.0", "Port TCP 443", "DNS NXDOMAIN", ...
// Each facet dimension knows how to read its values off a connection (from the
// fields the worker stores, see `connection.facets` in parser.worker.js) and how
// to label them. The active facets are a Map(dimension -> Set(values)):
// values of ONE dimension combine with OR, different dimensions with AND.
// thought up by human, created by ai

import { dnsRcodeName, icmpTypeCodeLabel, portListLabel, protocolGroupOf } from './data-model.js?v=2.1.5';

const PROBLEM_LABELS = {
  any: 'Auffällig (beliebiges Problem)',
  retransmits: 'Retransmits',
  gaps: 'Lücken',
  resets: 'RST',
  zeroWindow: 'Zero-Window',
  dupAcks: 'Dup-ACKs',
  outOfOrder: 'Out-of-Order',
  icmpError: 'ICMP-Fehlermeldung',
};

const RELAY_LABELS = {
  queried: 'Relay-Namen abgefragt',
  nodata: 'Antwort NODATA',
  nxdomain: 'Antwort NXDOMAIN',
  addresses: 'Adressen geliefert',
  blockpage: 'Blockseiten-Antwort',
  errors: 'SERVFAIL / REFUSED',
  traffic: 'Verkehr zum Relay',
  sni: 'Relay-SNI im ClientHello',
};

const FACETS_OF = (connection) => connection.facets || {};

/**
 * id: key in the active-facet map; label: shown in chips and the menu;
 * valuesOf(connection): the (string) values this connection has in the dimension;
 * labelOf(value): how a value reads.
 */
export const FACET_DIMENSIONS = [
  {
    id: 'port',
    label: 'Port',
    valuesOf: (c) => (c.port == null || !['TCP', 'UDP'].includes(protocolGroupOf(c.protocol)) ? [] : [`${protocolGroupOf(c.protocol)}|${c.port}`]),
    labelOf: (value) => {
      const [group, port] = value.split('|');
      return `${group} ${portListLabel(Number(port))}`;
    },
  },
  {
    id: 'problem',
    label: 'Problem',
    valuesOf: (c) => {
      const t = c.tcp;
      const values = [];
      // "Auffällig": the connection counts as problematic (the same rule as the metric "Probleme").
      if (c.problems > 0) values.push('any');
      if (t) {
        if (t.retransmissions) values.push('retransmits');
        if (t.lostSegments) values.push('gaps');
        if (t.resets) values.push('resets');
        if (t.zeroWindow) values.push('zeroWindow');
        if (t.duplicateAcks) values.push('dupAcks');
        if (t.outOfOrder) values.push('outOfOrder');
      } else if (c.problems > 0) {
        values.push('icmpError');
      }
      return values;
    },
    labelOf: (value) => PROBLEM_LABELS[value] || value,
  },
  { id: 'tlsVersion', label: 'TLS-Version', valuesOf: (c) => FACETS_OF(c).tlsVersions || [], labelOf: (value) => value },
  { id: 'tlsCipher', label: 'Cipher Suite', valuesOf: (c) => FACETS_OF(c).tlsCiphers || [], labelOf: (value) => value },
  {
    id: 'icmp',
    label: 'ICMP-Typ',
    valuesOf: (c) => FACETS_OF(c).icmp || [],
    labelOf: (value) => {
      const [protocol, type, code] = value.split('|');
      return icmpTypeCodeLabel(protocol, Number(type), Number(code));
    },
  },
  {
    id: 'dnsRcode',
    label: 'DNS-Antwortcode',
    valuesOf: (c) => (FACETS_OF(c).dnsRcodes || []).map(String),
    labelOf: (value) => dnsRcodeName(Number(value)),
  },
  { id: 'dnsProvider', label: 'DNS-Anbieter', valuesOf: (c) => FACETS_OF(c).dnsProviders || [], labelOf: (value) => value },
  { id: 'relay', label: 'Private Relay', valuesOf: (c) => FACETS_OF(c).relay || [], labelOf: (value) => RELAY_LABELS[value] || value },
  { id: 'apple', label: 'Apple-Dienst', valuesOf: (c) => FACETS_OF(c).apple || [], labelOf: (value) => value },
  { id: 'fragments', label: 'Fragmentierung', valuesOf: (c) => (FACETS_OF(c).fragments ? ['fragmentiert'] : []), labelOf: () => 'IP-Fragmente' },
];

const DIMENSION_BY_ID = new Map(FACET_DIMENSIONS.map((dimension) => [dimension.id, dimension]));

export function createFacetState() {
  return new Map();
}

export function isFacetActive(facets, dimension, value) {
  return Boolean(facets.get(dimension) && facets.get(dimension).has(value));
}

/** Switches a facet value on or off; returns true if it is now active. */
export function toggleFacet(facets, dimension, value) {
  let values = facets.get(dimension);
  if (!values) {
    values = new Set();
    facets.set(dimension, values);
  }
  if (values.has(value)) {
    values.delete(value);
    if (values.size === 0) facets.delete(dimension);
    return false;
  }
  values.add(value);
  return true;
}

export function hasFacets(facets) {
  return facets.size > 0;
}

/** Active facets as a flat list for the chip bar: { dimension, value, dimensionLabel, valueLabel }. */
export function facetEntries(facets) {
  const entries = [];
  for (const dimension of FACET_DIMENSIONS) {
    const values = facets.get(dimension.id);
    if (!values) continue;
    for (const value of values) {
      entries.push({ dimension: dimension.id, value, dimensionLabel: dimension.label, valueLabel: dimension.labelOf(value) });
    }
  }
  return entries;
}

export function connectionMatchesFacets(connection, facets) {
  for (const [dimensionId, wanted] of facets) {
    const dimension = DIMENSION_BY_ID.get(dimensionId);
    if (!dimension) continue;
    const have = dimension.valuesOf(connection);
    if (!have.some((value) => wanted.has(value))) return false;
  }
  return true;
}

/** A copy of the active facets without one value of a dimension (the dimension goes when it was the last one). */
export function facetsWithoutValue(facets, dimension, value) {
  const copy = new Map(facets);
  const values = new Set(copy.get(dimension) || []);
  values.delete(value);
  if (values.size > 0) copy.set(dimension, values);
  else copy.delete(dimension);
  return copy;
}

/** A copy of the active facets without one dimension - "everything except this card's own filter". */
export function facetsWithout(facets, dimension) {
  const copy = new Map(facets);
  copy.delete(dimension);
  return copy;
}

/** Predicate for computeVisibleConnections(), or null when no facet is active. */
export function facetPredicate(facets) {
  return hasFacets(facets) ? (connection) => connectionMatchesFacets(connection, facets) : null;
}

/**
 * Every value the capture offers per dimension with the number of connections that
 * have it, most frequent first - what the "+ Filter" menu lists. Dimensions without
 * any value are left out.
 */
export function collectFacetOptions(connections) {
  const counts = new Map(FACET_DIMENSIONS.map((dimension) => [dimension.id, new Map()]));
  for (const connection of connections) {
    for (const dimension of FACET_DIMENSIONS) {
      const target = counts.get(dimension.id);
      for (const value of dimension.valuesOf(connection)) target.set(value, (target.get(value) || 0) + 1);
    }
  }
  return FACET_DIMENSIONS
    .map((dimension) => ({
      dimension: dimension.id,
      label: dimension.label,
      options: Array.from(counts.get(dimension.id), ([value, count]) => ({ value, label: dimension.labelOf(value), count }))
        .sort((x, y) => y.count - x.count || x.label.localeCompare(y.label, 'de')),
    }))
    .filter((group) => group.options.length > 0);
}
