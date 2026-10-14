// Statistics view: capture-wide numbers (protocol / cast / IP-version shares,
// TCP health, ICMP types, flags, ports, sizes, traffic over time). Rendered as
// plain HTML cards, unlike the SVG-based views - there is nothing to pan/zoom
// here, and it keeps text selectable. The data comes ready-aggregated from
// parser.worker.js (traffic-stats.js), so this only formats and lays it out.
// thought up by human, created by ai

import { formatBytes, icmpTypeCodeLabel, portListLabel } from './data-model.js?v=1.5.0';

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

/** Horizontal bar rows: rows = [{ label, value, display, color, hint? }], bars scaled to the largest value. */
function barRows(rows, emptyText) {
  if (!rows.length) return `<p class="stats-empty">${esc(emptyText)}</p>`;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return rows
    .map(
      (r) => `<div class="stats-row"${r.hint ? ` title="${esc(r.hint)}"` : ''}>
      <span class="stats-row__label">${esc(r.label)}</span>
      <span class="stats-bar"><i data-w="${Math.max(r.value > 0 ? 2 : 0, (r.value / max) * 100)}" data-bg="${r.color}"></i></span>
      <span class="stats-row__value">${esc(r.display)}</span>
    </div>`,
    )
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
  const row = (label, value, color, hint) => ({
    label,
    value,
    color,
    hint,
    display: `${countFormat.format(value)} (${formatPercent(value, t.packets)})`,
  });
  const rows = [
    row('Retransmits', t.retransmissions, '--stats-bad', `Segment mit bereits gesehener Sequenznummer erneut gesendet. Davon Fast Retransmits (nach 3 Dup-ACKs): ${countFormat.format(t.fastRetransmissions)}.`),
    row('Dup-ACKs', t.duplicateAcks, '--stats-warn', 'Wiederholte ACKs auf dieselbe Sequenznummer – deutet auf ein fehlendes oder verspätetes Segment hin.'),
    row('Lücken', t.lostSegments, '--stats-bad', 'Sequenznummer springt nach vorn: Segmente dazwischen fehlen im Capture (verloren oder am Messpunkt nicht gesehen).'),
    row('Out-of-Order', t.outOfOrder, '--stats-warn', 'Segment traf kurz nach späteren Daten ein (< 3 ms) – Umsortierung im Netz statt erneutem Senden.'),
    row('RST', t.resets, '--stats-bad', 'Verbindung wurde per Reset abgebrochen.'),
    row('Zero-Window', t.zeroWindow, '--stats-warn', 'Empfänger meldet Fenstergröße 0 – er kommt mit der Datenmenge nicht hinterher.'),
    row('Keep-Alives', t.keepAlives, '--stats-neutral', 'Keep-Alive-Probes, keine Fehler.'),
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
    color: dangerTypes.has(`${entry.protocol}|${entry.type}`) ? '--stats-bad' : '--stats-icmp',
    display: countFormat.format(entry.packets),
  }));
  const more = stats.icmp.length > rows.length ? `${stats.icmp.length - rows.length} weitere Typen nicht angezeigt.` : '';
  return card('ICMP-Typen', barRows(rows, 'Keine ICMP-Pakete im Capture.'), '', more);
}

function flagsCard(stats) {
  const rows = stats.tcpFlags.slice(0, 10).map((entry) => ({
    label: entry.label,
    value: entry.packets,
    color: entry.label.includes('RST') ? '--stats-bad' : '--stats-tcp',
    display: countFormat.format(entry.packets),
  }));
  return card('TCP-Flag-Kombinationen', barRows(rows, 'Keine TCP-Pakete im Capture.'));
}

function portsCard(stats, metric) {
  const sorted = [...stats.topPorts].sort((a, b) => (metric === 'bytes' ? b.bytes - a.bytes : b.packets - a.packets)).slice(0, 10);
  const rows = sorted.map((entry) => ({
    label: `${entry.protocol} ${portListLabel(entry.port)}`,
    value: valueOf(entry, metric),
    color: entry.protocol === 'TCP' ? '--stats-tcp' : '--stats-udp',
    display: formatValue(valueOf(entry, metric), metric),
  }));
  return card('Häufigste Ports', barRows(rows, 'Keine TCP-/UDP-Pakete im Capture.'), '', 'Als Dienst-Port gilt der jeweils niedrigere der beiden Ports.');
}

function sizesCard(stats, metric) {
  const labels = ['≤ 64 B', '65–127 B', '128–255 B', '256–511 B', '512–1023 B', '1024–1518 B', '> 1518 B'];
  const rows = stats.sizeBuckets.map((bucket, i) => ({
    label: labels[i],
    value: valueOf(bucket, metric),
    color: '--stats-neutral',
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
  const countRow = (label, value, total, color, hint) => ({
    label,
    value,
    color,
    hint,
    display: total ? `${countFormat.format(value)} (${formatPercent(value, total)})` : countFormat.format(value),
  });
  const fragRows = [
    countRow('IPv4-Fragmente', f.ipv4Fragments, f.ipv4Packets, '--stats-bad', 'IPv4-Pakete, die Teil eines fragmentierten Datagramms sind (More-Fragments-Flag oder Fragment-Offset > 0). Prozentwert: Anteil an allen IPv4-Paketen.'),
    countRow('IPv6-Fragmente', f.ipv6Fragments, f.ipv6Packets, '--stats-bad', 'IPv6-Pakete mit Fragment-Extension-Header. Prozentwert: Anteil an allen IPv6-Paketen.'),
    countRow('Fragmentierte Datagramme', f.fragmentedDatagrams, 0, '--stats-warn', 'Anzahl der ersten Fragmente = Anzahl der fragmentierten Datagramme.'),
    countRow('DF-Bit gesetzt (IPv4)', f.dontFragment, f.ipv4Packets, '--stats-neutral', '„Don\'t Fragment“: Router dürfen das Paket nicht fragmentieren und müssen bei zu großen Paketen ICMP „Fragmentation needed“ senden (Path-MTU-Discovery).'),
  ];

  const mssRows = m.mss.slice(0, 6).map((entry) => ({
    label: `MSS ${entry.mss} (IPv${entry.ipVersion})`,
    value: entry.packets,
    color: '--stats-tcp',
    hint: `Im SYN angekündigte Maximum Segment Size; entspricht einer MTU von ca. ${entry.impliedMtu} B (MSS + IP- und TCP-Header).`,
    display: `≈ MTU ${countFormat.format(entry.impliedMtu)} · ${countFormat.format(entry.packets)}×`,
  }));
  const icmpRows = m.icmpReported.slice(0, 6).map((entry) => ({
    label: entry.protocol === 'ICMPv6' ? 'Packet Too Big' : 'Fragmentation needed',
    value: entry.packets,
    color: '--stats-bad',
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
export function renderStats(container, { stats, metric }) {
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
      { label: 'TCP', counter: stats.byProtocol.TCP, color: '--stats-tcp' },
      { label: 'UDP', counter: stats.byProtocol.UDP, color: '--stats-udp' },
      { label: 'ICMP / ICMPv6', counter: stats.byProtocol.ICMP, color: '--stats-icmp' },
      { label: 'ARP', counter: stats.byProtocol.ARP, color: '--stats-arp' },
      { label: 'Sonstige', counter: stats.byProtocol.OTHER, color: '--stats-neutral' },
    ], metric) +
      shareBlock('Adressierung', [
        { label: 'Unicast', counter: stats.byCast.unicast, color: '--stats-tcp' },
        { label: 'Multicast', counter: stats.byCast.multicast, color: '--stats-udp' },
        { label: 'Broadcast', counter: stats.byCast.broadcast, color: '--stats-icmp' },
      ], metric) +
      shareBlock('IP-Version', [
        { label: 'IPv4', counter: stats.byIpVersion.ipv4, color: '--stats-tcp' },
        { label: 'IPv6', counter: stats.byIpVersion.ipv6, color: '--stats-udp' },
        { label: 'Kein IP (z. B. ARP)', counter: stats.byIpVersion.none, color: '--stats-neutral' },
      ], metric),
    'stats-card--wide stats-card--shares',
    undecoded > 0 ? `${countFormat.format(undecoded)} Pakete (z. B. LLDP, STP, 802.11-Management) wurden nicht ausgewertet und fehlen in den Anteilen.` : '',
  );

  container.innerHTML = `
    <p class="stats-scope">Statistik über den gesamten Capture – die Filter in der Seitenleiste wirken hier nicht.</p>
    <div class="stats-kpis">${kpis}</div>
    <div class="stats-grid">
      ${distribution}
      ${tcpHealthCard(stats)}
      ${icmpCard(stats)}
      ${flagsCard(stats)}
      ${portsCard(stats, metric)}
      ${sizesCard(stats, metric)}
      ${mtuFragmentationCard(stats)}
      ${timelineCard(stats, metric)}
      ${streamsCard(stats)}
    </div>`;
  applyDynamicStyles(container);
}
