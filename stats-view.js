// Statistics view: capture-wide numbers (protocol / cast / IP-version shares,
// TCP health, ICMP types, flags, ports, sizes, traffic over time). Rendered as
// plain HTML cards, unlike the SVG-based views - there is nothing to pan/zoom
// here, and it keeps text selectable. The data comes ready-aggregated from
// parser.worker.js (traffic-stats.js), so this only formats and lays it out.
// thought up by human, created by ai

import { deviceLabel, dnsRcodeName, formatBytes, healthBadge, icmpTypeCodeLabel, portListLabel } from './data-model.js?v=2.1.5';
import { isFacetActive } from './filters.js?v=2.1.5';

const percentFormat = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });
const countFormat = new Intl.NumberFormat('de-DE');

function esc(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function formatPercent(part, total) {
  if (!total) return '0 %';
  const value = (part / total) * 100;
  if (value > 0 && value < 0.1) return '< 0,1 %';
  return `${percentFormat.format(value)} %`;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '< 1 s';
  if (seconds < 60) return `${percentFormat.format(seconds)} s`;
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h} h ${m} min`;
  return `${m} min ${s} s`;
}

function formatMs(seconds) {
  return seconds < 1 ? `${percentFormat.format(seconds * 1000)} ms` : `${percentFormat.format(seconds)} s`;
}

function formatClock(epochSeconds) {
  return new Date(epochSeconds * 1000).toLocaleTimeString('de-DE');
}

/**
 * The page's CSP (`style-src 'self'`) blocks inline `style="..."` attributes,
 * including ones inside innerHTML. Dynamic widths/heights/colors are therefore
 * emitted as data-* attributes and applied here through the CSSOM, which the
 * CSP allows.
 */
function applyDynamicStyles(container) {
  for (const node of container.querySelectorAll('[data-w]')) node.style.width = `${node.dataset.w}%`;
  for (const node of container.querySelectorAll('[data-h]')) node.style.height = `${node.dataset.h}%`;
  for (const node of container.querySelectorAll('[data-bg]')) node.style.background = `var(${node.dataset.bg})`;
}

function valueOf(counter, metric) {
  return metric === 'bytes' ? counter.bytes : counter.packets;
}

function formatValue(value, metric) {
  return metric === 'bytes' ? formatBytes(value) : countFormat.format(value);
}

/** One stacked share bar plus a legend row per non-empty segment. `segments`: [{ label, counter, color }]. */
function shareBlock(title, segments, metric) {
  const total = segments.reduce((sum, seg) => sum + valueOf(seg.counter, metric), 0);
  const visible = segments.filter((seg) => valueOf(seg.counter, metric) > 0);
  const bar = visible
    .map((seg) => {
      const value = valueOf(seg.counter, metric);
      return `<i data-w="${(value / total) * 100}" data-bg="${seg.color}" title="${esc(seg.label)}: ${formatPercent(value, total)}"></i>`;
    })
    .join('');
  const legend = visible
    .map((seg) => {
      const value = valueOf(seg.counter, metric);
      return `<li><span class="stats-swatch" data-bg="${seg.color}"></span><span class="stats-legend__label">${esc(seg.label)}</span><span class="stats-legend__pct">${formatPercent(value, total)}</span><span class="stats-legend__value">${formatValue(value, metric)}</span></li>`;
    })
    .join('');
  return `<div class="stats-share">
    <div class="stats-share__title">${esc(title)}</div>
    <div class="stats-stack">${bar}</div>
    <ul class="stats-legend">${legend}</ul>
  </div>`;
}

// The facets currently active, so rows that stand for a filter value show whether it is on.
// Set at the start of every renderStats() call.
let activeFacets = new Map();

const ACTION_HINT_FACET = 'Klicken: nur Verbindungen mit diesem Wert zeigen (erneut klicken: aufheben)';

/**
 * Click behaviour of a row, as attributes read by app.js: `{ facet: [dimension, value] }` toggles
 * that filter facet, `{ devices: [a, b?] }` sets the sidebar selection (one device: it and its
 * communication partners, two: just that pair).
 */
function actionAttrs(action, hint) {
  if (!action) return { attrs: hint ? ` title="${esc(hint)}"` : '', cls: '' };
  let attrs;
  let actionHint;
  if (action.facet) {
    const [dimension, value] = action.facet;
    const active = isFacetActive(activeFacets, dimension, value);
    attrs = ` data-facet-dimension="${esc(dimension)}" data-facet-value="${esc(value)}" aria-pressed="${active}"`;
    actionHint = ACTION_HINT_FACET;
  } else {
    const [a, b] = action.devices;
    attrs = ` data-select-a="${esc(a)}"${b ? ` data-select-b="${esc(b)}"` : ''}`;
    actionHint = b ? 'Klicken: Auswahl auf dieses Gerätepaar setzen' : 'Klicken: Auswahl auf dieses Gerät und seine Kommunikationspartner setzen';
  }
  const title = hint ? `${hint}\n${actionHint}` : actionHint;
  return { attrs: ` role="button" tabindex="0"${attrs} title="${esc(title)}"`, cls: ' is-action' };
}

/** Horizontal bar rows: rows = [{ label, value, display, color, hint?, action? }], bars scaled to the largest value. */
function barRows(rows, emptyText) {
  if (!rows.length) return `<p class="stats-empty">${esc(emptyText)}</p>`;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return rows
    .map((r) => {
      const { attrs, cls } = actionAttrs(r.action, r.hint);
      return `<div class="stats-row${cls}"${attrs}>
      <span class="stats-row__label">${esc(r.label)}</span>
      <span class="stats-bar"><i data-w="${Math.max(r.value > 0 ? 2 : 0, (r.value / max) * 100)}" data-bg="${r.color}"></i></span>
      <span class="stats-row__value">${esc(r.display)}</span>
    </div>`;
    })
    .join('');
}

/** Like barRows(), but each bar is split in two parts: rows = [{ label, first, second, display, action? }], colors fixed (sent / received). */
function splitBarRows(rows, emptyText) {
  if (!rows.length) return `<p class="stats-empty">${esc(emptyText)}</p>`;
  const max = Math.max(...rows.map((r) => r.first + r.second), 1);
  return rows
    .map((r) => {
      const { attrs, cls } = actionAttrs(r.action);
      return `<div class="stats-row stats-row--wide${cls}"${attrs}>
      <span class="stats-row__label" title="${esc(r.label)}">${esc(r.label)}</span>
      <span class="stats-bar stats-bar--split"><i data-w="${(r.first / max) * 100}" data-bg="--md-cat-1"></i><i data-w="${(r.second / max) * 100}" data-bg="--md-cat-2"></i></span>
      <span class="stats-row__value">${esc(r.display)}</span>
    </div>`;
    })
    .join('');
}

function card(title, body, extraClass = '', note = '') {
  return `<section class="stats-card ${extraClass}"><h3 class="stats-card__title">${esc(title)}</h3>${body}${note ? `<p class="stats-card__note">${esc(note)}</p>` : ''}</section>`;
}

function kpi(label, value, sub = '', tone = '') {
  return `<div class="stats-kpi${tone ? ` stats-kpi--${tone}` : ''}"><span class="stats-kpi__label">${esc(label)}</span><span class="stats-kpi__value">${esc(value)}</span>${sub ? `<span class="stats-kpi__sub">${esc(sub)}</span>` : ''}</div>`;
}

function tcpHealthCard(stats) {
  const t = stats.tcp;
  if (t.packets === 0) return card('TCP-Gesundheit', '<p class="stats-empty">Keine TCP-Pakete im Capture.</p>');
  const row = (label, value, color, hint, problem) => ({
    label,
    value,
    color,
    hint,
    action: problem && value > 0 ? { facet: ['problem', problem] } : null,
    display: `${countFormat.format(value)} (${formatPercent(value, t.packets)})`,
  });
  const rows = [
    row('Retransmits', t.retransmissions, '--pa-bad', `Segment mit bereits gesehener Sequenznummer erneut gesendet. Davon Fast Retransmits (nach 3 Dup-ACKs): ${countFormat.format(t.fastRetransmissions)}.`, 'retransmits'),
    row('Dup-ACKs', t.duplicateAcks, '--pa-warn', 'Wiederholte ACKs auf dieselbe Sequenznummer – deutet auf ein fehlendes oder verspätetes Segment hin.', 'dupAcks'),
    row('Lücken', t.lostSegments, '--pa-bad', 'Sequenznummer springt nach vorn: Segmente dazwischen fehlen im Capture (verloren oder am Messpunkt nicht gesehen).', 'gaps'),
    row('Out-of-Order', t.outOfOrder, '--pa-warn', 'Segment traf kurz nach späteren Daten ein (< 3 ms) – Umsortierung im Netz statt erneutem Senden.', 'outOfOrder'),
    row('RST', t.resets, '--pa-bad', 'Verbindung wurde per Reset abgebrochen.', 'resets'),
    row('Zero-Window', t.zeroWindow, '--pa-warn', 'Empfänger meldet Fenstergröße 0 – er kommt mit der Datenmenge nicht hinterher.', 'zeroWindow'),
    row('Keep-Alives', t.keepAlives, '--md-outline', 'Keep-Alive-Probes, keine Fehler.'),
  ];
  const h = stats.handshakes;
  const handshake = h && h.count ? ` · Handshake (SYN → SYN/ACK): Ø ${formatMs(h.sum / h.count)}, ${formatMs(h.min)}–${formatMs(h.max)} bei ${countFormat.format(h.count)} Verbindungen` : '';
  const rate = t.dataSegments ? formatPercent(t.retransmissions, t.dataSegments) : '–';
  const summary = `<p class="stats-card__summary">Retransmit-Rate: <strong>${rate}</strong> der ${countFormat.format(t.dataSegments)} Datensegmente · ${countFormat.format(t.streams)} TCP-Streams${handshake} · Prozentwerte beziehen sich auf alle ${countFormat.format(t.packets)} TCP-Pakete</p>`;
  return card('TCP-Gesundheit', summary + barRows(rows, ''), '', 'Heuristik auf Sequenznummern (wie Wireshark „TCP Analysis“). Beginnt der Capture mitten in einer Verbindung oder liegt der Messpunkt abseits des Verlusts, kann das Ergebnis abweichen.');
}

function icmpCard(stats) {
  const dangerTypes = new Set(['ICMP|3', 'ICMP|11', 'ICMP|12', 'ICMPv6|1', 'ICMPv6|3', 'ICMPv6|4']);
  const rows = stats.icmp.slice(0, 10).map((entry) => ({
    label: icmpTypeCodeLabel(entry.protocol, entry.type, entry.code),
    value: entry.packets,
    color: dangerTypes.has(`${entry.protocol}|${entry.type}`) ? '--pa-bad' : '--md-cat-3',
    display: countFormat.format(entry.packets),
    action: { facet: ['icmp', `${entry.protocol}|${entry.type}|${entry.code}`] },
  }));
  const more = stats.icmp.length > rows.length ? `${stats.icmp.length - rows.length} weitere Typen nicht angezeigt.` : '';
  return card('ICMP-Typen', barRows(rows, 'Keine ICMP-Pakete im Capture.'), '', more);
}

function flagsCard(stats) {
  const rows = stats.tcpFlags.slice(0, 10).map((entry) => ({
    label: entry.label,
    value: entry.packets,
    color: entry.label.includes('RST') ? '--pa-bad' : '--md-cat-1',
    display: countFormat.format(entry.packets),
  }));
  return card('TCP-Flag-Kombinationen', barRows(rows, 'Keine TCP-Pakete im Capture.'));
}

function portsCard(stats, metric) {
  const sorted = [...stats.topPorts].sort((a, b) => (metric === 'bytes' ? b.bytes - a.bytes : b.packets - a.packets)).slice(0, 10);
  const rows = sorted.map((entry) => ({
    label: `${entry.protocol} ${portListLabel(entry.port)}`,
    value: valueOf(entry, metric),
    color: entry.protocol === 'TCP' ? '--md-cat-1' : '--md-cat-2',
    display: formatValue(valueOf(entry, metric), metric),
    action: { facet: ['port', `${entry.protocol}|${entry.port}`] },
  }));
  return card('Häufigste Ports', barRows(rows, 'Keine TCP-/UDP-Pakete im Capture.'), '', 'Als Dienst-Port gilt der jeweils niedrigere der beiden Ports.');
}

function talkersCard(talkers, deviceIndex, metric) {
  const labelOf = (id) => {
    const device = deviceIndex.get(id);
    return device ? deviceLabel(device) : id;
  };
  const sentOf = (d) => (metric === 'bytes' ? d.sentBytes : d.sentPackets);
  const receivedOf = (d) => (metric === 'bytes' ? d.receivedBytes : d.receivedPackets);
  const deviceRows = [...talkers.devices]
    .sort((x, y) => sentOf(y) + receivedOf(y) - (sentOf(x) + receivedOf(x)))
    .slice(0, 10)
    .map((d) => ({
      label: labelOf(d.id),
      first: sentOf(d),
      second: receivedOf(d),
      action: { devices: [d.id] },
      display: `${formatValue(sentOf(d) + receivedOf(d), metric)} (↑ ${formatValue(sentOf(d), metric)} · ↓ ${formatValue(receivedOf(d), metric)})`,
    }));
  const pairRows = [...talkers.pairs]
    .sort((x, y) => valueOf(y, metric) - valueOf(x, metric))
    .slice(0, 10)
    .map((p) => ({
      label: `${labelOf(p.a)} ⇄ ${labelOf(p.b)}`,
      value: valueOf(p, metric),
      color: '--md-outline',
      action: { devices: [p.a, p.b] },
      display: formatValue(valueOf(p, metric), metric),
    }));
  const legend = `<p class="stats-card__summary"><span class="stats-swatch stats-swatch--inline" data-bg="--md-cat-1"></span> gesendet &nbsp; <span class="stats-swatch stats-swatch--inline" data-bg="--md-cat-2"></span> empfangen · Rangfolge nach ${metric === 'bytes' ? 'Datenvolumen' : 'Paketanzahl'} (Umschalter oben)</p>`;
  const body = `${legend}<div class="stats-columns">
    <div><div class="stats-subtitle">Top-Talker (Geräte)</div>${splitBarRows(deviceRows, 'Keine Geräte im Capture.')}</div>
    <div><div class="stats-subtitle">Aktivste Gerätepaare</div>${barRows(pairRows, 'Keine Kommunikation im Capture.').replace(/class="stats-row"/g, 'class="stats-row stats-row--wide"')}</div>
  </div>`;
  return card('Top-Talker', body, 'stats-card--wide', 'Geräte, die nur als Ziel von Broadcast/Multicast auftauchen (z. B. 224.0.0.251), erscheinen ebenfalls – sie zählen als Empfänger.');
}

/** `versionStats` / `cipherStats`: the same statistics without the TLS-version / cipher filter, so a filtered value can be joined by the others. */
function tlsCard(stats, versionStats = stats, cipherStats = stats) {
  const tls = stats.tls;
  if (!tls) return '';
  const versionTls = versionStats.tls || tls;
  const cipherTls = cipherStats.tls || tls;
  const versionRows = versionTls.versions.map((v) => ({
    label: v.name,
    action: { facet: ['tlsVersion', v.name] },
    value: v.count,
    color: v.outdated ? '--pa-bad' : v.name === 'TLS 1.3' ? '--md-cat-2' : '--md-cat-1',
    hint: v.outdated ? 'Veraltet (RFC 8996): TLS 1.0/1.1 und SSL 3.0 sollten nicht mehr ausgehandelt werden.' : '',
    display: `${countFormat.format(v.count)} (${formatPercent(v.count, versionTls.serverHellos)})`,
  }));
  const qualityColor = { ok: '--md-cat-2', nopfs: '--pa-warn', weak: '--pa-bad' };
  const qualityHint = { ok: '', nopfs: 'Statischer RSA-Schlüsselaustausch: kein Forward Secrecy – mitgeschnittener Verkehr ist später entschlüsselbar, wenn der Server-Schlüssel bekannt wird.', weak: 'Kryptographisch gebrochen oder veraltet (RC4, 3DES).' };
  const cipherRows = cipherTls.ciphers.map((c) => ({
    label: c.name,
    action: { facet: ['tlsCipher', c.name] },
    value: c.count,
    color: qualityColor[c.quality],
    hint: qualityHint[c.quality],
    display: countFormat.format(c.count),
  }));
  const outdatedRows = versionTls.outdatedServers.map((s) => ({
    label: `${s.server} · ${s.name}`,
    value: s.count,
    color: '--pa-bad',
    display: countFormat.format(s.count),
  }));
  const summary = `<p class="stats-card__summary">${countFormat.format(tls.serverHellos)} ServerHellos (ausgehandelte Version) · ${countFormat.format(tls.clientHellos)} ClientHellos im Capture</p>`;
  const body =
    summary +
    barRows(versionRows, 'Keine TLS-ServerHellos im Capture.') +
    (outdatedRows.length ? '<div class="stats-subtitle">Server mit veralteter Version</div>' + barRows(outdatedRows, '') : '') +
    (cipherRows.length ? '<div class="stats-subtitle">Ausgehandelte Cipher Suites</div>' + barRows(cipherRows, '') : '');
  return card('TLS-Versionen', body, '', 'Erkannt am Anfang des TCP-Payloads, unabhängig vom Port. Nur TLS über TCP; Handshakes, die vor dem Capture-Start liefen, fehlen.');
}

/** Plain table for the statistics cards: headers = [{ label, num }], rows = arrays of ready (escaped) cell HTML. */
function statsTable(headers, rows) {
  const head = headers.map((h) => `<th${h.num ? ' class="num"' : ''}>${esc(h.label)}</th>`).join('');
  const body = rows.map((cells) => `<tr>${cells.map((cell, i) => `<td${headers[i] && headers[i].num ? ' class="num"' : ''}>${cell}</td>`).join('')}</tr>`).join('');
  return `<div class="stats-table-wrap"><table class="stats-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function chip(level, text) {
  return healthBadge(level, text);
}

function l2Card(stats, metric, scoped = false) {
  const l2 = stats.l2;
  if (!l2) return '';
  const protocolRows = l2.protocols.map((p) => ({
    label: p.name,
    value: valueOf(p, metric),
    color: '--md-cat-5',
    display: `${formatValue(valueOf(p, metric), metric)} · ${countFormat.format(p.devices)} ${p.devices === 1 ? 'Gerät' : 'Geräte'}`,
  }));
  let body = l2.protocols.length ? barRows(protocolRows, '') : '<p class="stats-empty">Keine Layer-2-Steuerframes im Capture.</p>';

  const stp = l2.stp;
  if (stp.bpdus > 0) {
    const changes = stp.tcnBpdus + stp.tcFlagBpdus;
    const byVlan = new Map();
    for (const root of stp.roots) {
      const key = root.vlan === null ? '–' : String(root.vlan);
      if (!byVlan.has(key)) byVlan.set(key, new Set());
      byVlan.get(key).add(root.rootId);
    }
    const multiRoot = Array.from(byVlan).filter(([, ids]) => ids.size > 1).map(([vlan]) => (vlan === '–' ? 'ohne VLAN-Angabe' : `VLAN ${vlan}`));
    const flags = [
      changes > 0 ? chip('warn', `${countFormat.format(changes)} Topologieänderung${changes === 1 ? '' : 'en'} (${countFormat.format(stp.tcnBpdus)} TCN, ${countFormat.format(stp.tcFlagBpdus)} mit TC-Flag)`) : chip('ok', 'keine Topologieänderungen'),
      multiRoot.length ? chip('bad', `mehrere Root-Bridges: ${multiRoot.join(', ')}`) : '',
    ].filter(Boolean).join(' ');
    body += '<div class="stats-subtitle">Spanning Tree</div>';
    body += `<p class="stats-card__summary">${countFormat.format(stp.bpdus)} BPDUs ${flags}</p>`;
    body += statsTable(
      [{ label: 'Root-Bridge (Priorität.MAC)' }, { label: 'VLAN' }, { label: 'BPDUs', num: true }, { label: 'Sender', num: true }],
      stp.roots.map((r) => [esc(r.rootId), r.vlan === null ? '–' : esc(r.vlan), countFormat.format(r.count), countFormat.format(r.senders)]),
    );
    if (stp.tcSenders.length) {
      body += `<p class="stats-card__note">Topologieänderungen gemeldet von: ${stp.tcSenders.map((s) => `${esc(s.mac)} (${countFormat.format(s.count)}×)`).join(', ')}</p>`;
    }
  }

  if (l2.neighbors.length) {
    body += '<div class="stats-subtitle">Nachbarn (CDP / LLDP)</div>';
    body += statsTable(
      [{ label: 'Protokoll' }, { label: 'Gerät' }, { label: 'Port' }, { label: 'Plattform' }, { label: 'Management-IP' }, { label: 'Fähigkeiten' }],
      l2.neighbors.map((n) => [
        esc(n.protocol),
        esc(n.deviceId || n.mac),
        esc(n.portId || n.portDescription || '–'),
        esc(n.platform || '–'),
        esc(n.mgmtIp || '–'),
        esc(n.capabilities.length ? n.capabilities.join(', ') : '–'),
      ]),
    );
    if (l2.neighborCount > l2.neighbors.length) body += `<p class="stats-card__note">${countFormat.format(l2.neighborCount - l2.neighbors.length)} weitere Nachbarn nicht angezeigt.</p>`;
  }

  if (l2.lacp.pdus > 0) {
    const trouble = l2.lacp.outOfSync + l2.lacp.defaultedOrExpired;
    body += '<div class="stats-subtitle">Link Aggregation (LACP)</div>';
    body += `<p class="stats-card__summary">${countFormat.format(l2.lacp.pdus)} LACPDUs ${trouble > 0 ? chip('warn', `${countFormat.format(l2.lacp.outOfSync)} nicht synchron, ${countFormat.format(l2.lacp.defaultedOrExpired)} defaulted/expired`) : chip('ok', 'alle synchron')}</p>`;
  }

  if (l2.vlans.length) {
    body += `<div class="stats-subtitle">VLANs (getaggte Frames)${l2.vlanCount > l2.vlans.length ? ` – ${countFormat.format(l2.vlanCount)} gesehen` : ''}</div>`;
    body += barRows(l2.vlans.map((v) => ({ label: `VLAN ${v.id}`, value: valueOf(v, metric), color: '--md-cat-1', display: formatValue(valueOf(v, metric), metric) })), '');
  }
  return card('Layer-2-Protokolle', body, 'stats-card--wide', `${scoped ? 'Gilt für den gesamten Capture, nicht für die gefilterte Auswahl: Layer-2-Frames gehören zu keiner Verbindung. ' : ''}Nur was der Messpunkt sieht: Mirror-Ports und manche Netzwerkkarten filtern Steuerframes (STP, CDP, LLDP, LACP) heraus. Die Namen aus CDP/LLDP erscheinen zusätzlich als Beschriftung der Geräte, sofern deren Management-IP im Capture vorkommt.`);
}

/** `groupStats`: the same statistics without the Apple-service filter, for the group lists. */
function appleCard(stats, metric, groupStats = stats) {
  const a = stats.apple;
  if (!a) return '';
  const groupApple = groupStats.apple || a;
  const total = metric === 'bytes' ? stats.decodedBytes : stats.decodedPackets;
  const appleValue = metric === 'bytes' ? a.bytes : a.packets;
  const summary = `<p class="stats-card__summary">Apple-Verkehr: <strong>${formatValue(appleValue, metric)}</strong> (${formatPercent(appleValue, total)} des Captures) · ${countFormat.format(a.clientCount)} ${a.clientCount === 1 ? 'Client' : 'Clients'}</p>`;
  const groupRows = groupApple.groups.map((g) => ({
    label: g.generic ? `${g.name} (herstellerübergreifend)` : g.name,
    action: { facet: ['apple', g.name] },
    value: valueOf(g, metric),
    color: g.generic ? '--md-outline' : '--md-cat-1',
    hint: g.generic ? 'Bonjour/mDNS nutzen auch Drucker, Chromecast u. a.; nicht im Apple-Anteil enthalten.' : '',
    display: formatValue(valueOf(g, metric), metric),
  }));
  let body = summary + (groupRows.length ? barRows(groupRows, '') : '');

  if (groupApple.dnsGroups.length) {
    body += '<div class="stats-subtitle">DNS-Anfragen nach Apple-Dienst</div>';
    body += barRows(groupApple.dnsGroups.map((g) => ({ label: g.name, action: { facet: ['apple', g.name] }, value: g.count, color: g.name === 'iCloud Private Relay' ? '--pa-warn' : '--md-cat-1', display: countFormat.format(g.count) })), '');
  }
  if (a.mdnsServices.length) {
    body += '<div class="stats-subtitle">Bonjour-Dienste</div>';
    body += barRows(a.mdnsServices.map((s) => ({
      label: s.apple ? `${s.service} (Apple-typisch)` : s.service,
      value: s.count,
      color: s.apple ? '--md-cat-1' : '--md-outline',
      display: countFormat.format(s.count),
    })), '');
  }
  if (a.mdnsHosts.length) {
    body += `<p class="stats-card__note">Bonjour-Hostnamen (${countFormat.format(a.mdnsHostCount)}): ${a.mdnsHosts.map((h) => esc(h.name)).join(', ')}${a.mdnsHostCount > a.mdnsHosts.length ? ' …' : ''}</p>`;
  }
  if (a.clients.length) {
    body += '<div class="stats-subtitle">Clients mit dem meisten Apple-Verkehr</div>';
    body += barRows(a.clients.map((c) => ({ label: c.address, value: valueOf(c, metric), color: '--md-cat-1', display: formatValue(valueOf(c, metric), metric) })), '');
  }
  return card('Apple-Protokolle', body, '', `Erkennung über Adressbereich 17.0.0.0/8, Ports, DNS-Namen und TLS-Servernamen (SNI) – Heuristik, Listenstand ${stats.classificationVersion}. Verkehr über Fremd-CDNs (z. B. Akamai) ohne sichtbares DNS wird nicht erkannt.`);
}

const RESOLVER_COLORS = { umbrella: '--md-cat-3', private: '--md-cat-1', google: '--pa-bad', cloudflare: '--pa-warn', quad9: '--pa-warn', adguard: '--pa-warn', cleanbrowsing: '--pa-warn', apple: '--md-cat-4', public: '--pa-warn' };

/** `providerStats`: the same statistics without the provider filter, for the list of providers. */
function dnsServersCard(stats, providerStats = stats) {
  const r = stats.dnsServers;
  if (!r) return '';
  const categories = (providerStats.dnsServers || r).categories;
  let body = '';
  if (r.categories.length) {
    body += '<div class="stats-subtitle">Genutzte DNS-Server nach Anbieter</div>';
    body += barRows(categories.map((c) => ({
      label: c.label,
      action: { facet: ['dnsProvider', c.label] },
      value: c.queries,
      color: RESOLVER_COLORS[c.category] || '--md-outline',
      display: `${countFormat.format(c.queries)} Anfragen · ${countFormat.format(c.clients)} ${c.clients === 1 ? 'Client' : 'Clients'}`,
    })), '');
    body += '<div class="stats-subtitle">Einzelne Server</div>';
    body += statsTable(
      [{ label: 'Adresse' }, { label: 'Anbieter' }, { label: 'Anfragen', num: true }, { label: 'Antworten', num: true }, { label: 'Fehlercodes', num: true }, { label: 'Clients', num: true }],
      r.resolvers.map((s) => [esc(s.ip), esc(s.label), countFormat.format(s.queries), countFormat.format(s.responses), s.failures ? `<span class="is-bad">${countFormat.format(s.failures)}</span>` : '0', countFormat.format(s.clients)]),
    );
    if (r.resolverCount > r.resolvers.length) body += `<p class="stats-card__note">${countFormat.format(r.resolverCount - r.resolvers.length)} weitere Server nicht angezeigt.</p>`;
  }
  if (r.mixedClients.length) {
    body += `<div class="stats-subtitle">Clients mit mehreren DNS-Anbietern (${countFormat.format(r.mixedClientCount)})</div>`;
    body += statsTable(
      [{ label: 'Client' }, { label: 'Genutzte Anbieter (Anfragen)' }, { label: 'Hinweis' }],
      r.mixedClients.map((c) => [
        esc(c.client),
        c.categories.map((k) => `${esc(k.label)} (${countFormat.format(k.queries)})`).join(', '),
        c.bypassHint ? chip('warn', 'fragt zusätzlich einen anderen Anbieter – DNS-Filter wird ggf. umgangen') : '',
      ]),
    );
  }
  const encrypted = (title, list, hint) => {
    if (!list.length) return '';
    return `<div class="stats-subtitle">${esc(title)}</div>` +
      statsTable(
        [{ label: 'Client' }, { label: 'Server' }, { label: 'Anbieter' }, { label: 'Pakete', num: true }],
        list.map((e) => [esc(e.client), esc(e.server), esc(e.label), countFormat.format(e.packets)]),
      ) + `<p class="stats-card__note">${esc(hint)}</p>`;
  };
  body += encrypted('DNS über TLS (Port 853)', r.dot, 'Verschlüsseltes DNS an einen Resolver – am DNS-Filter vorbei, sofern dieser nicht selbst DoT anbietet.');
  body += encrypted('Verkehr zu bekannten DNS-Anbietern auf Port 443', r.doh, 'Möglicherweise DNS über HTTPS/QUIC (DoH/DoQ) oder der Verwaltungszugriff eines Anbieters (z. B. Umbrella-Roaming-Client) – nicht eindeutig.');
  return card('DNS-Server', body || '<p class="stats-empty">Keine DNS-Anfragen im Capture.</p>', 'stats-card--wide', `Zuordnung anhand der Serveradresse, Listenstand ${stats.classificationVersion}. Interne Resolver (z. B. Active Directory oder ein Umbrella-Forwarder) erscheinen als „privat“ – ob dahinter Umbrella steht, ist aus dem Capture nicht erkennbar.`);
}

const RELAY_STATE = {
  active: { level: 'warn', text: 'Relay aktiv (Verkehr/SNI gesehen)' },
  allowed: { level: 'neutral', text: 'erlaubt (Adressen geliefert)' },
  broken: { level: 'bad', text: 'gestört (Blockseite/Fehler/Timeout)' },
  blocked: { level: 'ok', text: 'abgeschaltet (NXDOMAIN/NODATA)' },
};
const RELAY_PROBLEM = { blockpage: 'Blockseiten-Antwort', errors: 'SERVFAIL/REFUSED', unanswered: 'ohne Antwort', slow: 'langsam (≥ 1 s)' };

/** `outcomeStats`: the same statistics without the Private-Relay filter, for the list of answer kinds. */
function relayCard(stats, outcomeStats = stats) {
  const relay = stats.relay;
  if (!relay) return '';
  const outcomeNames = (outcomeStats.relay || relay).names;
  const outcomeSum = (field) => outcomeNames.reduce((sum, n) => sum + n[field], 0);
  const outcomeRows = [
    ['Antwort NODATA', outcomeSum('nodata'), '--md-cat-2', 'nodata'],
    ['Antwort NXDOMAIN', outcomeSum('nxdomain'), '--md-cat-2', 'nxdomain'],
    ['Adressen geliefert', outcomeSum('addresses'), '--md-cat-1', 'addresses'],
    ['Blockseiten-Antwort', outcomeSum('blockpage'), '--pa-bad', 'blockpage'],
    ['SERVFAIL / REFUSED', outcomeSum('errors'), '--pa-bad', 'errors'],
  ].map(([label, value, color, kind]) => ({ label, value, color, display: countFormat.format(value), action: value > 0 ? { facet: ['relay', kind] } : null }));
  const blockpages = relay.names.reduce((sum, n) => sum + n.blockpage, 0);
  const clientsBroken = relay.clients.filter((c) => c.state === 'broken' || c.problems.length > 0).length;
  const active = relay.clients.filter((c) => c.state === 'active').length;
  let verdict = '';
  if (blockpages > 0) {
    verdict = `<p class="stats-card__summary">${chip('bad', 'Blockseite statt NXDOMAIN/NODATA')} ${countFormat.format(blockpages)} Antworten auf Relay-Namen enthalten eine Adresse aus dem Umbrella-Adressraum (146.112.x.x). Apple und Cisco sehen für diese Namen NXDOMAIN oder NODATA vor; eine Blockseiten-Adresse lässt iOS/macOS wiederholt versuchen und führt zu Verzögerungen und Timeouts.</p>`;
  } else if (relay.names.length && relay.names.every((n) => n.addresses === 0 && n.blockpage === 0 && n.errors === 0 && n.unanswered === 0)) {
    verdict = `<p class="stats-card__summary">${chip('ok', 'Relay wird sauber abgeschaltet')} Alle Antworten auf Relay-Namen sind NXDOMAIN oder NODATA.</p>`;
  }
  const summary = `<p class="stats-card__summary">${countFormat.format(relay.clientCount)} ${relay.clientCount === 1 ? 'Client fragt' : 'Clients fragen'} Relay-Namen ab · ${countFormat.format(active)} mit sichtbarem Relay-Verkehr · ${countFormat.format(clientsBroken)} mit Auffälligkeiten · ${countFormat.format(relay.learnedAddresses)} Relay-Adressen aus DNS gelernt</p>`;

  const nameTable = statsTable(
    [{ label: 'Name' }, { label: 'Anfragen', num: true }, { label: 'NODATA', num: true }, { label: 'NXDOMAIN', num: true }, { label: 'Adressen', num: true }, { label: 'Blockseite', num: true }, { label: 'Fehler', num: true }, { label: 'ohne Antwort', num: true }, { label: 'Antwortzeit Ø / max', num: true }],
    relay.names.map((n) => [
      esc(n.name),
      countFormat.format(n.queries),
      countFormat.format(n.nodata),
      countFormat.format(n.nxdomain),
      countFormat.format(n.addresses),
      n.blockpage ? `<span class="is-bad">${countFormat.format(n.blockpage)}</span>` : '0',
      n.errors ? `<span class="is-bad">${countFormat.format(n.errors)}</span>` : '0',
      n.unanswered ? `<span class="is-bad">${countFormat.format(n.unanswered)}</span>` : '0',
      n.avgLatency === null ? '–' : `${formatMs(n.avgLatency)} / ${formatMs(n.maxLatency)}`,
    ]),
  );

  const clientTable = statsTable(
    [{ label: 'Client' }, { label: 'Status' }, { label: 'Abfragen' }, { label: 'Auffälligkeiten' }, { label: 'Relay-Verkehr', num: true }],
    relay.clients.map((c) => {
      const state = RELAY_STATE[c.state];
      const rate = c.perMinute === null ? '' : ` (${percentFormat.format(c.perMinute)}/min)`;
      const traffic = c.packets ? `${countFormat.format(c.packets)} Pakete · ${formatBytes(c.bytes)}${c.quicPackets ? ' · QUIC' : ''}` : c.sniHits ? `SNI ×${countFormat.format(c.sniHits)}` : '–';
      return [
        esc(c.address),
        chip(state.level, state.text),
        `${countFormat.format(c.queries)}${rate}`,
        c.problems.length ? c.problems.map((p) => chip('bad', `${RELAY_PROBLEM[p]}${p === 'blockpage' ? ` ×${countFormat.format(c.blockpage)}` : p === 'unanswered' ? ` ×${countFormat.format(c.unanswered)}` : p === 'slow' ? ` ×${countFormat.format(c.slow)}` : ''}`)).join(' ') : '–',
        traffic,
      ];
    }),
  );
  const body = `${verdict}${summary}<div class="stats-subtitle">Antworten auf Relay-Namen</div>${barRows(outcomeRows, '')}<div class="stats-subtitle">Abgefragte Relay-Namen</div>${nameTable}<div class="stats-subtitle">Clients</div>${clientTable}`;
  return card('iCloud Private Relay', body, 'stats-card--wide', `Beobachtet werden mask.icloud.com, mask-h2.icloud.com, mask-api.icloud.com und mask.apple-dns.net (Quelle: Apple- und Cisco-Dokumentation sowie Problemanalyse vom 22.07.2026). „Relay aktiv“ heißt: Verkehr zu einer Adresse, die ein Relay-Name aufgelöst hat, oder TLS-ClientHello mit Relay-SNI – nur sichtbar, wenn die DNS-Antwort im Capture liegt. Die Blockseiten-Erkennung (146.112.0.0/16) ist eine Heuristik, Listenstand ${stats.classificationVersion}.`);
}

/** `rcodeStats`: the same statistics without the answer-code filter, for the list of codes. */
function dnsCard(stats, rcodeStats = stats) {
  const dns = stats.dns;
  if (!dns) return '';
  const codeDns = rcodeStats.dns || dns;
  const failed = dns.rcodes.filter((r) => r.code !== 0).reduce((sum, r) => sum + r.count, 0);
  const rcodeColor = (code) => (code === 0 ? '--md-cat-2' : code === 3 ? '--pa-warn' : '--pa-bad');
  const rcodeRows = codeDns.rcodes.slice(0, 8).map((r) => ({
    label: dnsRcodeName(r.code),
    action: { facet: ['dnsRcode', String(r.code)] },
    value: r.count,
    color: rcodeColor(r.code),
    hint: r.code === 3 ? 'Der Name existiert nicht. Nicht immer ein Fehler, z. B. bei Suchdomain-Versuchen oder Reverse-Lookups.' : r.code === 2 ? 'Der Server konnte die Anfrage nicht beantworten (z. B. Upstream nicht erreichbar, DNSSEC-Fehler).' : r.code === 5 ? 'Der Server verweigert die Anfrage (ACL oder falscher Resolver).' : '',
    display: `${countFormat.format(r.count)} (${formatPercent(r.count, codeDns.responses)})`,
  }));
  const nameRows = dns.failingNames.map((n) => ({
    label: `${n.name} · ${dnsRcodeName(n.rcode)}`,
    value: n.count,
    color: rcodeColor(n.rcode),
    display: countFormat.format(n.count),
  }));
  const resolverRows = dns.resolvers.map((r) => ({
    label: r.ip,
    value: r.failures,
    color: '--pa-bad',
    display: `${countFormat.format(r.failures)} von ${countFormat.format(r.responses)} (${formatPercent(r.failures, r.responses)})`,
  }));
  const clientRows = dns.clients.map((c) => ({
    label: c.ip,
    value: c.count,
    color: '--pa-warn',
    display: countFormat.format(c.count),
  }));

  const unansweredNote = dns.unanswered > 0 ? ` · <strong>${countFormat.format(dns.unanswered)}</strong> Anfragen ohne Antwort im Capture${dns.unansweredCapped ? ' (Zählung begrenzt)' : ''}` : '';
  const summary = `<p class="stats-card__summary">${countFormat.format(dns.queries)} Anfragen · ${countFormat.format(dns.responses)} Antworten, davon <strong>${countFormat.format(failed)}</strong> mit Fehlercode (${formatPercent(failed, dns.responses)})${unansweredNote}</p>`;
  const body =
    summary +
    barRows(rcodeRows, 'Keine DNS-Antworten im Capture.') +
    (nameRows.length ? '<div class="stats-subtitle">Häufigste fehlgeschlagene Namen</div>' + barRows(nameRows, '') : '') +
    (resolverRows.length ? '<div class="stats-subtitle">Resolver mit Fehlern</div>' + barRows(resolverRows, '') : '') +
    (clientRows.length ? '<div class="stats-subtitle">Clients mit den meisten Fehlern</div>' + barRows(clientRows, '') : '');
  return card('DNS', body, '', 'Nur DNS über UDP/53. Anfragen ohne Antwort können auch Antworten sein, die der Messpunkt nicht gesehen hat.');
}

function sizesCard(stats, metric) {
  const labels = ['≤ 64 B', '65–127 B', '128–255 B', '256–511 B', '512–1023 B', '1024–1518 B', '> 1518 B'];
  const rows = stats.sizeBuckets.map((bucket, i) => ({
    label: labels[i],
    value: valueOf(bucket, metric),
    color: '--md-outline',
    display: formatValue(valueOf(bucket, metric), metric),
  }));
  const avg = stats.decodedPackets ? Math.round(stats.decodedBytes / stats.decodedPackets) : 0;
  return card('Paketgrößen', `<p class="stats-card__summary">Durchschnitt: <strong>${countFormat.format(avg)} B</strong> pro Paket</p>${barRows(rows, '')}`);
}

function timelineCard(stats, metric) {
  const tl = stats.timeline;
  if (!tl.packets.length) return '';
  const values = metric === 'bytes' ? tl.bytes : tl.packets;
  const max = Math.max(...values, 1);
  const bars = values
    .map((v, i) => {
      const from = formatClock(tl.start + i * tl.bucketSeconds);
      return `<i data-h="${Math.max(v > 0 ? 2 : 0, (v / max) * 100)}" title="${esc(from)} · ${formatValue(v, metric)}"></i>`;
    })
    .join('');
  const end = formatClock(stats.lastTimestamp);
  const unit = tl.bucketSeconds === 1 ? '1 Sekunde' : `${countFormat.format(tl.bucketSeconds)} Sekunden`;
  return card(
    metric === 'bytes' ? 'Datenvolumen über die Zeit' : 'Pakete über die Zeit',
    `<div class="stats-timeline">${bars}</div><div class="stats-timeline__axis"><span>${esc(formatClock(stats.firstTimestamp))}</span><span>1 Balken = ${esc(unit)} · Spitze ${formatValue(max, metric)}</span><span>${esc(end)}</span></div>`,
    'stats-card--wide',
  );
}

function mtuFragmentationCard(stats) {
  const f = stats.fragmentation;
  const m = stats.mtu;
  const countRow = (label, value, total, color, hint, fragments = false) => ({
    label,
    value,
    color,
    hint,
    action: fragments && value > 0 ? { facet: ['fragments', 'fragmentiert'] } : null,
    display: total ? `${countFormat.format(value)} (${formatPercent(value, total)})` : countFormat.format(value),
  });
  const fragRows = [
    countRow('IPv4-Fragmente', f.ipv4Fragments, f.ipv4Packets, '--pa-bad', 'IPv4-Pakete, die Teil eines fragmentierten Datagramms sind (More-Fragments-Flag oder Fragment-Offset > 0). Prozentwert: Anteil an allen IPv4-Paketen.', true),
    countRow('IPv6-Fragmente', f.ipv6Fragments, f.ipv6Packets, '--pa-bad', 'IPv6-Pakete mit Fragment-Extension-Header. Prozentwert: Anteil an allen IPv6-Paketen.', true),
    countRow('Fragmentierte Datagramme', f.fragmentedDatagrams, 0, '--pa-warn', 'Anzahl der ersten Fragmente = Anzahl der fragmentierten Datagramme.', true),
    countRow('DF-Bit gesetzt (IPv4)', f.dontFragment, f.ipv4Packets, '--md-outline', '„Don\'t Fragment“: Router dürfen das Paket nicht fragmentieren und müssen bei zu großen Paketen ICMP „Fragmentation needed“ senden (Path-MTU-Discovery).'),
  ];

  const mssRows = m.mss.slice(0, 6).map((entry) => ({
    label: `MSS ${entry.mss} (IPv${entry.ipVersion})`,
    value: entry.packets,
    color: '--md-cat-1',
    hint: `Im SYN angekündigte Maximum Segment Size; entspricht einer MTU von ca. ${entry.impliedMtu} B (MSS + IP- und TCP-Header).`,
    display: `≈ MTU ${countFormat.format(entry.impliedMtu)} · ${countFormat.format(entry.packets)}×`,
  }));
  const icmpRows = m.icmpReported.slice(0, 6).map((entry) => ({
    label: entry.protocol === 'ICMPv6' ? 'Packet Too Big' : 'Fragmentation needed',
    value: entry.packets,
    color: '--pa-bad',
    hint: 'Ein Router meldet, dass ein Paket größer als die MTU seines nächsten Hops war.',
    display: `MTU ${countFormat.format(entry.mtu)} · ${countFormat.format(entry.packets)}×`,
  }));

  const summary = `<p class="stats-card__summary">Größtes IP-Paket: <strong>${m.maxIpPacketLength ? `${countFormat.format(m.maxIpPacketLength)} B` : '–'}</strong> (untere Schranke für die MTU) · größter Frame: <strong>${countFormat.format(m.maxFrameLength)} B</strong> inkl. Link-Layer-Header</p>`;
  const body =
    summary +
    '<div class="stats-subtitle">Fragmentierung</div>' +
    barRows(fragRows, '') +
    '<div class="stats-subtitle">Angekündigte TCP-MSS (SYN)</div>' +
    barRows(mssRows, 'Keine SYN-Pakete mit MSS-Option im Capture.') +
    (icmpRows.length ? '<div class="stats-subtitle">Von Routern gemeldete MTU (ICMP)</div>' + barRows(icmpRows, '') : '');
  return card('MTU und Fragmentierung', body, '', 'Die Pfad-MTU ist im Capture nicht direkt sichtbar – die Werte sind Anhaltspunkte. Pakete größer als die MTU (z. B. bei TSO/GSO am Messpunkt) können das größte IP-Paket über die echte MTU hinaus anheben.');
}

function streamsCard(stats) {
  if (!stats.problemStreams.length) return '';
  const head = '<tr><th>Verbindung</th><th class="num">Pakete</th><th class="num">Retransmits</th><th class="num">Dup-ACKs</th><th class="num">Lücken</th><th class="num">Out-of-Order</th><th class="num">Zero-Window</th><th class="num">RST</th></tr>';
  const cell = (v, bad) => `<td class="num${v > 0 && bad ? ' is-bad' : ''}">${v > 0 ? countFormat.format(v) : '–'}</td>`;
  const body = stats.problemStreams
    .map(
      (s) => `<tr><td>${esc(s.src)} → ${esc(s.dst)}</td><td class="num">${countFormat.format(s.packets)}</td>${cell(s.retransmissions, true)}${cell(s.duplicateAcks, false)}${cell(s.lostSegments, true)}${cell(s.outOfOrder, false)}${cell(s.zeroWindow, false)}${cell(s.resets, true)}</tr>`,
    )
    .join('');
  return card('Auffälligste TCP-Streams', `<div class="stats-table-wrap"><table class="stats-table">${head}${body}</table></div>`, 'stats-card--wide', 'Sortiert nach Summe aller erkannten Auffälligkeiten.');
}

/** Renders the whole statistics tab into `container`. `metric` is 'packets' | 'bytes'. */
/** One line above the cards saying what the numbers cover. */
function scopeNote(scope) {
  if (scope && scope.unavailable) {
    return 'Die Datei ist zu groß, um für gefilterte Auswertungen im Speicher gehalten zu werden – die Statistik zeigt immer den gesamten Capture, die Filter wirken hier nicht.';
  }
  if (scope && scope.filtered) {
    return `Umfang: ${countFormat.format(scope.shown)} von ${countFormat.format(scope.total)} Verbindungen nach den aktuellen Filtern (Geräteauswahl, Protokolle, weitere Filter).`;
  }
  return 'Umfang: alle Verbindungen des Captures (keine Filter aktiv).';
}

/**
 * `stats` are the numbers to show (for the whole capture or for the filtered connections),
 * `globalStats` always those of the whole capture (layer-2 frames belong to no connection),
 * `scope` = { filtered, shown, total, unavailable }, `talkers` = { devices, pairs } for the same
 * connections as `stats`.
 */
export function renderStats(container, { stats, globalStats, scope, metric, talkers, deviceIndex, facets, extras }) {
  activeFacets = facets || new Map();
  // The statistics a filtered card shows: without the filter of its own dimension (when there is one).
  const without = (dimension) => (extras && extras[dimension]) || stats;
  if (!stats) {
    container.innerHTML = '<p class="stats-empty">Keine Statistikdaten vorhanden.</p>';
    return;
  }
  const retransmitRate = stats.tcp.dataSegments ? stats.tcp.retransmissions / stats.tcp.dataSegments : 0;
  const undecoded = stats.totalPackets - stats.decodedPackets;
  const kpis = [
    kpi('Pakete', countFormat.format(stats.totalPackets), undecoded > 0 ? `${countFormat.format(undecoded)} nicht auswertbar` : ''),
    kpi('Datenmenge', formatBytes(stats.decodedBytes)),
    kpi('Dauer', formatDuration(stats.duration)),
    kpi('TCP-Retransmits', stats.tcp.dataSegments ? formatPercent(stats.tcp.retransmissions, stats.tcp.dataSegments) : '–', 'der TCP-Datensegmente', retransmitRate >= 0.02 ? 'bad' : retransmitRate >= 0.005 ? 'warn' : ''),
  ].join('');

  const distribution = card(
    'Protokollverteilung',
    shareBlock('Transportprotokoll', [
      { label: 'TCP', counter: stats.byProtocol.TCP, color: '--md-cat-1' },
      { label: 'UDP', counter: stats.byProtocol.UDP, color: '--md-cat-2' },
      { label: 'ICMP / ICMPv6', counter: stats.byProtocol.ICMP, color: '--md-cat-3' },
      { label: 'ARP', counter: stats.byProtocol.ARP, color: '--md-cat-4' },
      { label: 'Layer 2 (STP, CDP, LLDP …)', counter: stats.byProtocol.L2, color: '--md-cat-5' },
      { label: 'Sonstige', counter: stats.byProtocol.OTHER, color: '--md-outline' },
    ], metric) +
      shareBlock('Adressierung', [
        { label: 'Unicast', counter: stats.byCast.unicast, color: '--md-cat-1' },
        { label: 'Multicast', counter: stats.byCast.multicast, color: '--md-cat-2' },
        { label: 'Broadcast', counter: stats.byCast.broadcast, color: '--md-cat-3' },
      ], metric) +
      shareBlock('IP-Version', [
        { label: 'IPv4', counter: stats.byIpVersion.ipv4, color: '--md-cat-1' },
        { label: 'IPv6', counter: stats.byIpVersion.ipv6, color: '--md-cat-2' },
        { label: 'Kein IP (z. B. ARP)', counter: stats.byIpVersion.none, color: '--md-outline' },
      ], metric),
    'stats-card--wide stats-card--shares',
    undecoded > 0 ? `${countFormat.format(undecoded)} Pakete (z. B. 802.11-Management) wurden nicht ausgewertet und fehlen in den Anteilen.` : '',
  );

  container.innerHTML = `
    <p class="stats-scope">${esc(scopeNote(scope))} Ein Klick auf eine Zeile setzt den passenden Filter, bei Top-Talkern die Geräteauswahl.</p>
    <div class="stats-kpis">${kpis}</div>
    <div class="stats-grid">
      ${distribution}
      ${talkers ? talkersCard(talkers, deviceIndex, metric) : ''}
      ${tcpHealthCard(without('problem'))}
      ${icmpCard(without('icmp'))}
      ${flagsCard(stats)}
      ${portsCard(without('port'), metric)}
      ${dnsCard(stats, without('dnsRcode'))}
      ${dnsServersCard(stats, without('dnsProvider'))}
      ${relayCard(stats, without('relay'))}
      ${appleCard(stats, metric, without('apple'))}
      ${tlsCard(stats, without('tlsVersion'), without('tlsCipher'))}
      ${l2Card(globalStats || stats, metric, Boolean(scope && scope.filtered))}
      ${sizesCard(stats, metric)}
      ${mtuFragmentationCard(stats)}
      ${timelineCard(stats, metric)}
      ${streamsCard(stats)}
    </div>`;
  applyDynamicStyles(container);
}
