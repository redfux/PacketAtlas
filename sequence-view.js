// Sequence-diagram ("call flow" / ladder diagram) view: one lifeline per
// selected device, one arrow per individual packet, ordered chronologically -
// the same style Wireshark's "Flow Graph" uses for signaling traces.
// thought up by human, created by ai

import { deviceLabel } from './data-model.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

const LANE_SPACING = 180;
const MARGIN_X = 100;
const HEADER_HEIGHT = 56;
const ROW_HEIGHT = 34;
const FOOTER_MARGIN = 24;

function eventLabel(event) {
  if (event.srcPort != null && event.dstPort != null) {
    return `${event.protocol || 'IP'} ${event.srcPort} → ${event.dstPort}`;
  }
  return event.protocol || 'IP';
}

/**
 * Renders the ladder diagram for the given (already filtered/selected, address-
 * sorted) devices and chronologically-ordered packet events into `container`.
 * Returns the root <svg> element (used for image export).
 */
export function renderSequence(container, { devices, events, onHover, onLeave }) {
  const laneX = new Map(devices.map((d, i) => [d.id, MARGIN_X + i * LANE_SPACING]));

  const width = MARGIN_X * 2 + Math.max(0, devices.length - 1) * LANE_SPACING;
  const height = HEADER_HEIGHT + Math.max(1, events.length) * ROW_HEIGHT + FOOTER_MARGIN;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
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

  // Lifelines + device header boxes.
  for (const device of devices) {
    const x = laneX.get(device.id);

    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', x);
    line.setAttribute('y1', HEADER_HEIGHT);
    line.setAttribute('x2', x);
    line.setAttribute('y2', height - FOOTER_MARGIN / 2);
    line.classList.add('sequence-lifeline');
    svg.appendChild(line);

    const label = deviceLabel(device);
    const box = document.createElementNS(SVG_NS, 'rect');
    const boxWidth = Math.min(LANE_SPACING - 20, Math.max(70, label.length * 6.5 + 16));
    box.setAttribute('x', x - boxWidth / 2);
    box.setAttribute('y', 8);
    box.setAttribute('width', boxWidth);
    box.setAttribute('height', 28);
    box.setAttribute('rx', 6);
    box.classList.add('sequence-device-box');
    svg.appendChild(box);

    const text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('x', x);
    text.setAttribute('y', 26);
    text.setAttribute('text-anchor', 'middle');
    text.classList.add('sequence-device-label');
    text.textContent = label.length > 24 ? `${label.slice(0, 22)}…` : label;
    const title = document.createElementNS(SVG_NS, 'title');
    title.textContent = label;
    text.appendChild(title);
    svg.appendChild(text);
  }

  // One arrow per packet, top to bottom in chronological order.
  events.forEach((event, i) => {
    const y = HEADER_HEIGHT + (i + 0.5) * ROW_HEIGHT;
    const x1 = laneX.get(event.a);
    const x2 = laneX.get(event.b);
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
    text.textContent = eventLabel(event);
    group.appendChild(text);

    // A transparent, wider hit-area line makes hovering a thin arrow easier.
    const hitArea = document.createElementNS(SVG_NS, 'line');
    hitArea.setAttribute('x1', x1);
    hitArea.setAttribute('y1', y);
    hitArea.setAttribute('x2', x2);
    hitArea.setAttribute('y2', y);
    hitArea.classList.add('sequence-hit-area');
    hitArea.addEventListener('mousemove', (e) => onHover(e, event));
    hitArea.addEventListener('mouseleave', onLeave);
    group.appendChild(hitArea);

    svg.appendChild(group);
  });

  container.innerHTML = '';
  container.appendChild(svg);
  return svg;
}
