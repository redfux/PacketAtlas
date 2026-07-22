// Adjacency-matrix view: pure SVG grid, sequential log-scaled color per cell.
// `d3` (vendor/d3.min.js) is loaded as a classic script before this module and
// used here only for its color interpolator.
// thought up by human, created by ai

import { pairKey, metricValue, deviceLabel } from './data-model.js';

const CELL_SIZE = 26;
const MIN_LABEL_SPACE = 60;
const MAX_LABEL_CHARS = 40;
// Matches the 10px `.matrix-label` font (see style.css): a generous
// per-character estimate for Roboto at that size, so computed label areas
// stay big enough even for the widest characters rather than clipping them.
const CHAR_WIDTH = 6.2;
const SVG_NS = 'http://www.w3.org/2000/svg';

function truncatedLabel(device) {
  const label = deviceLabel(device);
  return label.length > MAX_LABEL_CHARS ? `${label.slice(0, MAX_LABEL_CHARS - 1)}…` : label;
}

function createLabel(device, x, y, rotate, anchor) {
  const text = document.createElementNS(SVG_NS, 'text');
  text.setAttribute('x', x);
  text.setAttribute('y', y);
  text.setAttribute('text-anchor', anchor);
  text.classList.add('matrix-label');
  if (rotate) text.setAttribute('transform', `rotate(${rotate} ${x} ${y})`);
  text.textContent = truncatedLabel(device);
  const title = document.createElementNS(SVG_NS, 'title');
  title.textContent = deviceLabel(device);
  text.appendChild(title);
  return text;
}

function colorForValue(value, maxValue) {
  const t = maxValue > 0 ? Math.log1p(value) / Math.log1p(maxValue) : 0;
  return d3.interpolateBlues(0.15 + t * 0.8);
}

/**
 * Renders the adjacency matrix for the given (already filtered/selected)
 * devices and pairs into `container`, replacing its previous content.
 * Returns the root <svg> element (used for image export).
 */
export function renderMatrix(container, { devices, pairs, metric, onHover, onLeave, onClick }) {
  const pairIndex = new Map();
  for (const pair of pairs) pairIndex.set(pairKey(pair.a, pair.b), pair);

  const n = devices.length;
  // Sized from the actual longest label rather than a fixed constant: column
  // headers are rotated -45°, so their vertical extent above the grid grows
  // with label length (a fixed margin clips longer IPs/hostnames at the top);
  // row headers are unrotated and just need that same length horizontally.
  const maxLabelLen = devices.reduce((max, d) => Math.max(max, truncatedLabel(d).length), 6);
  const leftLabelWidth = MIN_LABEL_SPACE + maxLabelLen * CHAR_WIDTH;
  const topHeaderHeight = MIN_LABEL_SPACE + maxLabelLen * CHAR_WIDTH * Math.sin(Math.PI / 4);
  const width = leftLabelWidth + Math.max(n, 1) * CELL_SIZE;
  const height = topHeaderHeight + Math.max(n, 1) * CELL_SIZE;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  svg.classList.add('matrix-svg');

  let maxValue = 0;
  for (const pair of pairs) maxValue = Math.max(maxValue, metricValue(pair, metric));

  devices.forEach((device, j) => {
    svg.appendChild(createLabel(device, leftLabelWidth + j * CELL_SIZE + CELL_SIZE / 2, topHeaderHeight - 6, -45, 'start'));
  });
  devices.forEach((device, i) => {
    svg.appendChild(createLabel(device, leftLabelWidth - 8, topHeaderHeight + i * CELL_SIZE + CELL_SIZE / 2 + 3, 0, 'end'));
  });

  devices.forEach((rowDevice, i) => {
    devices.forEach((colDevice, j) => {
      if (i === j) return;
      const pair = pairIndex.get(pairKey(rowDevice.id, colDevice.id));
      const value = pair ? metricValue(pair, metric) : 0;

      const rect = document.createElementNS(SVG_NS, 'rect');
      rect.setAttribute('x', leftLabelWidth + j * CELL_SIZE);
      rect.setAttribute('y', topHeaderHeight + i * CELL_SIZE);
      rect.setAttribute('width', CELL_SIZE - 1);
      rect.setAttribute('height', CELL_SIZE - 1);
      rect.setAttribute('fill', value > 0 ? colorForValue(value, maxValue) : 'var(--md-surface-container)');
      rect.classList.add('matrix-cell');
      rect.addEventListener('mousemove', (e) => onHover(e, pair, rowDevice, colDevice));
      rect.addEventListener('mouseleave', onLeave);
      rect.addEventListener('click', (e) => onClick(e, pair, rowDevice, colDevice));
      svg.appendChild(rect);
    });
  });

  container.innerHTML = '';
  container.appendChild(svg);
  return svg;
}
