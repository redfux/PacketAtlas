// Correlated connections view: one lifeline per selected device, one arrow
// per distinct (device pair, protocol, port) connection - which ports two
// devices talk over, and how much, without a chronological/per-packet
// timeline (that's backlogged for a possible future version, see readme.md).
// `d3` (vendor/d3.min.js) is loaded as a classic script before this module and
// provides d3-zoom for panning/zooming large diagrams.
// thought up by human, created by ai

import { deviceLabel, icmpTypeLabel } from './data-model.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

const LANE_SPACING = 180;
const MARGIN_X = 100;
const HEADER_HEIGHT = 56;
const ARROW_ROW_HEIGHT = 34; // vertical space for a connection with no reply traffic
const GROUPED_ARROW_GAP = 18; // spacing between the initiator/reply arrows of a grouped pair
const GROUP_MARGIN = 12; // extra breathing room after a grouped pair before the next connection
const FOOTER_MARGIN = 24;

/**
 * A connection currently merges both directions into one combined total
 * (see parser.worker.js), which used to hide the reply traffic of a
 * request/response exchange entirely. This builds a connection-shaped "view"
 * object for just one direction (from connection.aToB/bToA), reusing the same
 * shape (a/b/protocol/port/srcPort/dstPort/packets/bytes/firstSeen/lastSeen)
 * so it plugs directly into the existing tooltip/pin code in app.js without
 * any changes there.
 */
function directionView(connection, reversed) {
  const directional = reversed ? connection.bToA : connection.aToB;
  return {
    a: reversed ? connection.b : connection.a,
    b: reversed ? connection.a : connection.b,
    protocol: connection.protocol,
    port: connection.port,
    srcPort: directional.srcPort,
    dstPort: directional.dstPort,
    icmpTypes: directional.icmpTypes,
    packets: directional.packets,
    bytes: directional.bytes,
    firstSeen: directional.firstSeen,
    lastSeen: directional.lastSeen,
    multicastOrBroadcast: connection.multicastOrBroadcast,
    isReply: reversed,
  };
}

/**
 * Shows only the destination port of THIS direction (not source+destination):
 * with both the initiator and reply arrow visible right next to each other,
 * which two ports are involved is already obvious from the pair of arrows,
 * and the full source/destination breakdown remains available in the hover
 * tooltip - repeating both ports on the label itself was more than needed.
 * For ICMP/ICMPv6 (no ports at all), the actual message type(s) seen in this
 * direction (e.g. "Echo Request") are shown instead, since otherwise both the
 * initiator and reply arrow of a ping exchange would just read "ICMP".
 */
function connectionLabel(view) {
  const icmpLabel = icmpTypeLabel(view.protocol, view.icmpTypes);
  const protocolPart = icmpLabel ? `${view.protocol} (${icmpLabel})` : (view.protocol || 'IP');
  const portPart = view.dstPort != null ? ` ${view.dstPort}` : (icmpLabel ? '' : (view.port != null ? ` ${view.port}` : ''));
  const icon = view.isReply ? '○' : '▲';
  return `${icon} ${protocolPart}${portPart} — ${view.packets.toLocaleString('de-DE')}×`;
}

/**
 * Renders the connections diagram for the given (already filtered/selected,
 * address-sorted) devices and connections (sorted by descending packet count,
 * heaviest first) into `container`. Returns the root <svg> element (used for
 * image export). Each connection with reply traffic (connection.bToA.packets
 * > 0) draws two closely-spaced arrows - initiator and reply - with a shared
 * background band, so it's visually obvious which two arrows belong to the
 * same exchange; a one-way connection (e.g. an unanswered ARP request or a
 * fire-and-forget UDP packet) still draws just the one arrow it always did.
 */
export function renderConnections(container, { devices, connections, onHover, onLeave, onClick }) {
  const laneX = new Map(devices.map((d, i) => [d.id, MARGIN_X + i * LANE_SPACING]));

  // Lay out groups first (one or two arrows each) so the total diagram height
  // reflects the actual number of arrows, not just the number of connections.
  const groups = [];
  let cursorY = HEADER_HEIGHT;
  for (const connection of connections) {
    const hasReply = connection.bToA.packets > 0;
    if (hasReply) {
      const top = cursorY;
      const bottom = cursorY + GROUPED_ARROW_GAP * 2;
      groups.push({
        top,
        bottom,
        arrows: [
          { view: directionView(connection, false), y: top + GROUPED_ARROW_GAP / 2 },
          { view: directionView(connection, true), y: top + GROUPED_ARROW_GAP * 1.5 },
        ],
      });
      cursorY = bottom + GROUP_MARGIN;
    } else {
      groups.push({
        top: cursorY,
        bottom: cursorY + ARROW_ROW_HEIGHT,
        arrows: [{ view: directionView(connection, false), y: cursorY + ARROW_ROW_HEIGHT / 2 }],
      });
      cursorY += ARROW_ROW_HEIGHT;
    }
  }

  const diagramWidth = MARGIN_X * 2 + Math.max(0, devices.length - 1) * LANE_SPACING;
  const diagramHeight = cursorY + FOOTER_MARGIN;

  // The SVG element itself is sized to the visible container (not to the full
  // diagram): with many devices/connections the diagram can grow far larger
  // than the viewport, and without an explicit zoom-to-fit the visible
  // top-left sliver could easily show no lifelines/arrows at all, looking
  // like an empty view even though the data is there.
  const width = container.clientWidth || 800;
  const height = Math.max(container.clientHeight || 0, 400);

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.classList.add('sequence-svg');

  const defs = document.createElementNS(SVG_NS, 'defs');
  const marker = document.createElementNS(SVG_NS, 'marker');
  marker.setAttribute('id', 'sequence-arrowhead');
  marker.setAttribute('viewBox', '0 0 10 10');
  marker.setAttribute('refX', '9');
  marker.setAttribute('refY', '5');
  marker.setAttribute('markerWidth', '7');
  marker.setAttribute('markerHeight', '7');
  marker.setAttribute('orient', 'auto-start-reverse');
  const arrowPath = document.createElementNS(SVG_NS, 'path');
  arrowPath.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
  arrowPath.classList.add('sequence-arrowhead-fill');
  marker.appendChild(arrowPath);
  defs.appendChild(marker);

  const replyMarker = document.createElementNS(SVG_NS, 'marker');
  replyMarker.setAttribute('id', 'sequence-arrowhead-reply');
  replyMarker.setAttribute('viewBox', '0 0 10 10');
  replyMarker.setAttribute('refX', '9');
  replyMarker.setAttribute('refY', '5');
  replyMarker.setAttribute('markerWidth', '7');
  replyMarker.setAttribute('markerHeight', '7');
  replyMarker.setAttribute('orient', 'auto-start-reverse');
  const replyArrowPath = document.createElementNS(SVG_NS, 'path');
  replyArrowPath.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
  replyArrowPath.classList.add('sequence-arrowhead-fill--reply');
  replyMarker.appendChild(replyArrowPath);
  defs.appendChild(replyMarker);
  svg.appendChild(defs);

  const zoomLayer = document.createElementNS(SVG_NS, 'g');
  svg.appendChild(zoomLayer);

  // Lifelines + device header boxes.
  for (const device of devices) {
    const x = laneX.get(device.id);

    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', x);
    line.setAttribute('y1', HEADER_HEIGHT);
    line.setAttribute('x2', x);
    line.setAttribute('y2', diagramHeight - FOOTER_MARGIN / 2);
    line.classList.add('sequence-lifeline');
    zoomLayer.appendChild(line);

    const label = deviceLabel(device);
    const box = document.createElementNS(SVG_NS, 'rect');
    const boxWidth = Math.min(LANE_SPACING - 20, Math.max(70, label.length * 6.5 + 16));
    box.setAttribute('x', x - boxWidth / 2);
    box.setAttribute('y', 8);
    box.setAttribute('width', boxWidth);
    box.setAttribute('height', 28);
    box.setAttribute('rx', 6);
    box.classList.add('sequence-device-box');
    zoomLayer.appendChild(box);

    const text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('x', x);
    text.setAttribute('y', 26);
    text.setAttribute('text-anchor', 'middle');
    text.classList.add('sequence-device-label');
    text.textContent = label.length > 24 ? `${label.slice(0, 22)}…` : label;
    const title = document.createElementNS(SVG_NS, 'title');
    title.textContent = label;
    text.appendChild(title);
    zoomLayer.appendChild(text);
  }

  for (const group of groups) {
    const [firstArrow] = group.arrows;
    const x1 = laneX.get(firstArrow.view.a);
    const x2 = laneX.get(firstArrow.view.b);
    if (x1 == null || x2 == null) continue;

    // Shared background band tying the initiator/reply arrows of one exchange
    // together visually, so it's obvious at a glance which two arrows belong
    // to the same connection instead of looking like two unrelated rows.
    if (group.arrows.length > 1) {
      const band = document.createElementNS(SVG_NS, 'rect');
      band.setAttribute('x', Math.min(x1, x2) - 12);
      band.setAttribute('y', group.top);
      band.setAttribute('width', Math.abs(x2 - x1) + 24);
      band.setAttribute('height', group.bottom - group.top);
      band.setAttribute('rx', 6);
      band.classList.add('sequence-group-band');
      zoomLayer.appendChild(band);
    }

    for (const { view, y } of group.arrows) {
      const ax1 = laneX.get(view.a);
      const ax2 = laneX.get(view.b);
      if (ax1 == null || ax2 == null) continue;

      const arrowGroup = document.createElementNS(SVG_NS, 'g');
      arrowGroup.classList.add('sequence-event');

      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('x1', ax1);
      line.setAttribute('y1', y);
      line.setAttribute('x2', ax2);
      line.setAttribute('y2', y);
      line.setAttribute('marker-end', view.isReply ? 'url(#sequence-arrowhead-reply)' : 'url(#sequence-arrowhead)');
      line.classList.add('sequence-arrow');
      if (view.isReply) line.classList.add('sequence-arrow--reply');
      arrowGroup.appendChild(line);

      const text = document.createElementNS(SVG_NS, 'text');
      text.setAttribute('x', (ax1 + ax2) / 2);
      text.setAttribute('y', y - 5);
      text.setAttribute('text-anchor', 'middle');
      text.classList.add('sequence-event-label');
      if (view.isReply) text.classList.add('sequence-event-label--reply');
      text.textContent = connectionLabel(view);
      arrowGroup.appendChild(text);

      // A transparent, wider hit-area line makes hovering a thin arrow easier.
      const hitArea = document.createElementNS(SVG_NS, 'line');
      hitArea.setAttribute('x1', ax1);
      hitArea.setAttribute('y1', y);
      hitArea.setAttribute('x2', ax2);
      hitArea.setAttribute('y2', y);
      hitArea.classList.add('sequence-hit-area');
      hitArea.addEventListener('mousemove', (e) => onHover(e, view));
      hitArea.addEventListener('mouseleave', onLeave);
      hitArea.addEventListener('click', (e) => onClick(e, view));
      arrowGroup.appendChild(hitArea);

      zoomLayer.appendChild(arrowGroup);
    }
  }

  const zoom = d3.zoom()
    .scaleExtent([0.05, 8])
    .on('zoom', (zoomEvent) => zoomLayer.setAttribute('transform', zoomEvent.transform));
  d3.select(svg).call(zoom);

  // Fit the whole diagram into the visible viewport initially - with many
  // devices/connections it easily grows far beyond the container, and the user
  // would otherwise have to guess which direction to scroll to find any content.
  const padding = 24;
  const fitScale = Math.min(1, (width - padding * 2) / diagramWidth, (height - padding * 2) / diagramHeight);
  const initialTransform = d3.zoomIdentity
    .translate((width - diagramWidth * fitScale) / 2, padding)
    .scale(fitScale);
  d3.select(svg).call(zoom.transform, initialTransform);

  container.innerHTML = '';
  container.appendChild(svg);
  return svg;
}
