// Correlated connections view: one lifeline per selected device, one arrow
// per distinct (device pair, protocol, port) connection - which ports two
// devices talk over, and how much, without a chronological/per-packet
// timeline (that's backlogged for a possible future version, see readme.md).
// `d3` (vendor/d3.min.js) is loaded as a classic script before this module and
// provides d3-zoom for panning/zooming large diagrams.
// thought up by human, created by ai

import { deviceLabel } from './data-model.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

const LANE_SPACING = 180;
const MARGIN_X = 100;
const HEADER_HEIGHT = 56;
const ROW_HEIGHT = 34;
const FOOTER_MARGIN = 24;

function connectionLabel(connection) {
  const portPart = connection.port != null ? ` ${connection.port}` : '';
  return `${connection.protocol || 'IP'}${portPart} — ${connection.packets.toLocaleString('de-DE')}×`;
}

/**
 * Renders the connections diagram for the given (already filtered/selected,
 * address-sorted) devices and connections (sorted by descending packet count,
 * heaviest first) into `container`. Returns the root <svg> element (used for
 * image export).
 */
export function renderConnections(container, { devices, connections, onHover, onLeave, onClick }) {
  const laneX = new Map(devices.map((d, i) => [d.id, MARGIN_X + i * LANE_SPACING]));

  const diagramWidth = MARGIN_X * 2 + Math.max(0, devices.length - 1) * LANE_SPACING;
  const diagramHeight = HEADER_HEIGHT + Math.max(1, connections.length) * ROW_HEIGHT + FOOTER_MARGIN;

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

  // One arrow per distinct connection, heaviest (most packets) first.
  connections.forEach((connection, i) => {
    const y = HEADER_HEIGHT + (i + 0.5) * ROW_HEIGHT;
    const x1 = laneX.get(connection.a);
    const x2 = laneX.get(connection.b);
    if (x1 == null || x2 == null) return;

    const group = document.createElementNS(SVG_NS, 'g');
    group.classList.add('sequence-event');

    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', x1);
    line.setAttribute('y1', y);
    line.setAttribute('x2', x2);
    line.setAttribute('y2', y);
    line.setAttribute('marker-end', 'url(#sequence-arrowhead)');
    line.classList.add('sequence-arrow');
    group.appendChild(line);

    const text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('x', (x1 + x2) / 2);
    text.setAttribute('y', y - 6);
    text.setAttribute('text-anchor', 'middle');
    text.classList.add('sequence-event-label');
    text.textContent = connectionLabel(connection);
    group.appendChild(text);

    // A transparent, wider hit-area line makes hovering a thin arrow easier.
    const hitArea = document.createElementNS(SVG_NS, 'line');
    hitArea.setAttribute('x1', x1);
    hitArea.setAttribute('y1', y);
    hitArea.setAttribute('x2', x2);
    hitArea.setAttribute('y2', y);
    hitArea.classList.add('sequence-hit-area');
    hitArea.addEventListener('mousemove', (e) => onHover(e, connection));
    hitArea.addEventListener('mouseleave', onLeave);
    hitArea.addEventListener('click', (e) => onClick(e, connection));
    group.appendChild(hitArea);

    zoomLayer.appendChild(group);
  });

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
