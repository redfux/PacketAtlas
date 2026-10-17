// Table form of the Connections view: one sortable row per connection (device
// pair + protocol + port) with its traffic-quality figures, a status chip, and
// an expandable detail row (retransmit rate, handshake time, how it ended, when
// the problems happened). Plain HTML - the diagram form lives in
// connections-view.js; both show the same, already filtered connection list.
// thought up by human, created by ai

import { deviceLabel, formatBytes, formatSeconds, formatTimestamp, healthBadge, healthOf, icmpTypeLabel } from './data-model.js?v=2.1.0';

const MAX_ROWS = 500;

const numberFormat = new Intl.NumberFormat('de-DE');
const percentFormat = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });

function esc(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const LEVEL_RANK = { ok: 0, warn: 1, bad: 2 };

function buildRow(connection, deviceIndex, idOf) {
  const t = connection.tcp;
  const health = healthOf(connection);
  const deviceA = deviceIndex.get(connection.a);
  const deviceB = deviceIndex.get(connection.b);
  const portPart = connection.port != null ? `:${connection.port}` : '';
  return {
    connection,
    id: idOf(connection),
    health,
    name: `${deviceLabel(deviceA)} → ${deviceLabel(deviceB)}${portPart}`,
    retrans: t ? t.retransmissions : null,
    dupAcks: t ? t.duplicateAcks : null,
    resets: t ? t.resets : null,
  };
}

const SORTERS = {
  status: (x, y) => LEVEL_RANK[x.health.level] - LEVEL_RANK[y.health.level] || x.connection.problems - y.connection.problems || x.connection.packets - y.connection.packets,
  name: (x, y) => x.name.localeCompare(y.name, 'de'),
  protocol: (x, y) => (x.connection.protocol || '').localeCompare(y.connection.protocol || ''),
  packets: (x, y) => x.connection.packets - y.connection.packets,
  retrans: (x, y) => (x.retrans ?? -1) - (y.retrans ?? -1),
  dupAcks: (x, y) => (x.dupAcks ?? -1) - (y.dupAcks ?? -1),
  resets: (x, y) => (x.resets ?? -1) - (y.resets ?? -1),
};

const COLUMNS = [
  { key: 'name', label: 'Verbindung', numeric: false },
  { key: 'protocol', label: 'Proto', numeric: false },
  { key: 'packets', label: 'Pakete', numeric: true },
  { key: 'retrans', label: 'Retrans.', numeric: true },
  { key: 'dupAcks', label: 'Dup-ACK', numeric: true },
  { key: 'resets', label: 'RST', numeric: true },
  { key: 'status', label: 'Status', numeric: false },
];

function statusChip(row) {
  const { health, connection } = row;
  const label = !connection.tcp && connection.problems ? `${numberFormat.format(connection.problems)}× ICMP-Fehler` : health.label;
  return healthBadge(health.level, label);
}

function dashOr(value) {
  return value === null ? '–' : numberFormat.format(value);
}

function rowHtml(row, expanded) {
  const c = row.connection;
  const t = c.tcp;
  const levelClass = row.health.level !== 'ok' ? ` ctable__row--${row.health.level}` : '';
  let retransCell = '–';
  let retransClass = '';
  if (t) {
    const rate = t.dataSegments ? ` (${percentFormat.format((t.retransmissions / t.dataSegments) * 100)} %)` : '';
    retransCell = `${numberFormat.format(t.retransmissions)}${t.retransmissions ? rate : ''}`;
    if (t.retransmissions) retransClass = row.health.level === 'bad' ? ' is-bad' : ' is-warn';
  }
  const rstClass = t && t.resets ? ' is-bad' : '';
  return `<tr class="ctable__row${levelClass}${expanded ? ' is-expanded' : ''}" data-id="${esc(row.id)}" tabindex="0" aria-expanded="${expanded}">
    <td>${esc(row.name)}</td>
    <td>${esc(c.protocol || '–')}</td>
    <td class="num">${numberFormat.format(c.packets)}</td>
    <td class="num${retransClass}">${retransCell}</td>
    <td class="num">${dashOr(row.dupAcks)}</td>
    <td class="num${rstClass}">${dashOr(row.resets)}</td>
    <td>${statusChip(row)}</td>
  </tr>`;
}

function clock(seconds) {
  return new Date(seconds * 1000).toLocaleTimeString('de-DE');
}

function timelineHtml(connection) {
  const times = connection.tcp && connection.tcp.problemTimes ? connection.tcp.problemTimes : [];
  if (times.length === 0) return '';
  const span = Math.max(connection.lastSeen - connection.firstSeen, 1e-6);
  const marks = times
    .map((time) => {
      const x = (((time - connection.firstSeen) / span) * 200).toFixed(1);
      return `<line class="mini-timeline__mark" x1="${x}" x2="${x}" y1="3" y2="25"/>`;
    })
    .join('');
  const capped = times.length >= 200 ? 'erste 200 ' : '';
  return `<svg class="ctable__timeline" viewBox="0 0 200 28" preserveAspectRatio="none" role="img" aria-label="Probleme über die Zeit"><rect class="mini-timeline__bg" x="0" y="0" width="200" height="28" rx="6"/>${marks}</svg>
    <div class="ctable__timeline-axis"><span>Probleme über die Zeit (${capped}${numberFormat.format(times.length)} Ereignisse)</span><span>${esc(clock(connection.firstSeen))} – ${esc(clock(connection.lastSeen))}</span></div>`;
}

function detailHtml(row) {
  const c = row.connection;
  const t = c.tcp;
  const cards = [];
  if (t) {
    const rate = t.dataSegments ? `${percentFormat.format((t.retransmissions / t.dataSegments) * 100)} % (${numberFormat.format(t.retransmissions)} / ${numberFormat.format(t.dataSegments)} Datensegmente)` : '–';
    cards.push(['Retransmit-Rate', rate]);
    const handshake = t.handshakeCount
      ? t.handshakeCount === 1
        ? `SYN → SYN/ACK in ${formatSeconds(t.handshakeSum)}`
        : `Ø ${formatSeconds(t.handshakeSum / t.handshakeCount)} (max. ${formatSeconds(t.handshakeMax)}, ${numberFormat.format(t.handshakeCount)}×)`
      : 'nicht im Capture';
    cards.push(['Handshake', handshake]);
    cards.push(['Beendet durch', t.resets ? 'RST (abgebrochen)' : t.fins ? 'FIN (regulär)' : 'nicht beendet (im Capture offen)']);
    cards.push(['Weitere Ereignisse', `Lücken: ${numberFormat.format(t.lostSegments)} · Zero-Window: ${numberFormat.format(t.zeroWindow)} · Out-of-Order: ${numberFormat.format(t.outOfOrder)}`]);
  } else {
    const types = icmpTypeLabel(c.protocol, [...c.aToB.icmpTypes, ...c.bToA.icmpTypes]);
    if (types) cards.push(['Nachrichtentypen', types]);
    if (c.problems) cards.push(['Fehlermeldungen', numberFormat.format(c.problems)]);
  }
  cards.push(['Pakete · Bytes', `${numberFormat.format(c.packets)} · ${formatBytes(c.bytes)}`]);
  cards.push(['Zeitraum', `${formatTimestamp(c.firstSeen)} – ${formatTimestamp(c.lastSeen)}`]);
  const cardHtml = cards.map(([label, value]) => `<div class="ctable__card"><span class="ctable__card-label">${esc(label)}</span><span>${esc(value)}</span></div>`).join('');
  return `<tr class="ctable__detail"><td colspan="${COLUMNS.length}"><div class="ctable__cards">${cardHtml}</div>${timelineHtml(c)}</td></tr>`;
}

/**
 * Renders the connections table into `container`. `connections` is the filtered
 * list as shown on screen, `totalCount` how many connections there would be
 * without the "Nur Probleme" filter (for the "12 von 148" counter). All state
 * (sort, expanded rows) is owned by app.js and passed in; user actions are
 * reported back through `handlers`, after which app.js re-renders. The
 * protocol and problem filters live in the filter bar above all views.
 */
export function renderConnectionsTable(container, { connections, totalCount, deviceIndex, idOf, expandedIds, sort, handlers }) {
  const rows = connections.map((c) => buildRow(c, deviceIndex, idOf));
  const compare = SORTERS[sort.key] || SORTERS.status;
  const direction = sort.dir === 'asc' ? 1 : -1;
  rows.sort((x, y) => direction * compare(x, y) || y.connection.packets - x.connection.packets);
  const shown = rows.slice(0, MAX_ROWS);

  const head = COLUMNS.map((col) => {
    const active = sort.key === col.key;
    const arrow = active ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '';
    return `<th class="${col.numeric ? 'num' : ''}${active ? ' is-sorted' : ''}" data-sort="${col.key}" scope="col" aria-sort="${active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}">${col.label}${arrow}</th>`;
  }).join('');

  const body = shown.map((row) => rowHtml(row, expandedIds.has(row.id)) + (expandedIds.has(row.id) ? detailHtml(row) : '')).join('')
    || `<tr><td colspan="${COLUMNS.length}" class="ctable__empty">Keine Verbindungen für die aktuelle Auswahl.</td></tr>`;

  const truncated = rows.length > shown.length
    ? `<p class="ctable__note">Zeige ${numberFormat.format(shown.length)} von ${numberFormat.format(rows.length)} Verbindungen. Für eine vollständige Ansicht bitte weiter filtern.</p>`
    : '';

  container.innerHTML = `<div class="ctable">
    <p class="ctable__count">${numberFormat.format(connections.length)} von ${numberFormat.format(totalCount)} Verbindungen</p>
    <div class="ctable__scroll"><table class="ctable__table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>
    ${truncated}
  </div>`;

  // Assigned (not added) so repeated renders never stack up duplicate listeners.
  container.onclick = (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const header = target.closest('th[data-sort]');
    if (header) return handlers.onSort(header.dataset.sort);
    const row = target.closest('tr.ctable__row');
    if (row) handlers.onToggleRow(row.dataset.id);
  };
  container.onkeydown = (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const row = event.target instanceof Element ? event.target.closest('tr.ctable__row') : null;
    if (!row) return;
    event.preventDefault();
    handlers.onToggleRow(row.dataset.id);
  };
}
