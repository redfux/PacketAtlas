// Adjacency-matrix view: pure SVG grid, sequential log-scaled color per cell.
// `d3` (vendor/d3.min.js) is loaded as a classic script before this module and
// used here only for its color interpolator.
// thought up by human, created by ai

import { pairKey, metricValue, deviceLabel } from './data-model.js';

const CELL_SIZE = 26;
const LABEL_SPACE = 160;
const SVG_NS = 'http://www.w3.org/2000/svg';

function createLabel(device, x, y, rotate, anchor) {
  const text = document.createElementNS(SVG_NS, 'text');
  text.setAttribute('x', x);
  text.setAttribute('y', y);
  text.setAttribute('text-anchor', anchor);
  text.classList.add('matrix-label');
  if (rotate) text.setAttribute('transform', `rotate(${rotate} ${x} ${y})`);
  const label = deviceLabel(device);
  text.textContent = label.length > 24 ? `${label.slice(0, 22)}…` : label;
  const title = document.createElementNS(SVG_NS, 'title');
  title.textContent = label;
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
export function renderMatrix(container, { devices, pairs, metric, onHover, onLeave }) {
  const pairIndex = new Map();
  for (const pair of pairs) pairIndex.set(pairKey(pair.a, pair.b), pair);

  const n = devices.length;
  const size = LABEL_SPACE + Math.max(n, 1) * CELL_SIZE;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.classList.add('matrix-svg');

  let maxValue = 0;
  for (const pair of pairs) maxValue = Math.max(maxValue, metricValue(pair, metric));

  devices.forEach((device, j) => {
    svg.appendChild(createLabel(device, LABEL_SPACE + j * CELL_SIZE + CELL_SIZE / 2, LABEL_SPACE - 6, -45, 'start'));
  });
  devices.forEach((device, i) => {
    svg.appendChild(createLabel(device, LABEL_SPACE - 8, LABEL_SPACE + i * CELL_SIZE + CELL_SIZE / 2 + 3, 0, 'end'));
  });

  devices.forEach((rowDevice, i) => {
    devices.forEach((colDevice, j) => {
      if (i === j) return;
      const pair = pairIndex.get(pairKey(rowDevice.id, colDevice.id));
      const value = pair ? metricValue(pair, metric) : 0;

      const rect = document.createElementNS(SVG_NS, 'rect');
      rect.setAttribute('x', LABEL_SPACE + j * CELL_SIZE);
      rect.setAttribute('y', LABEL_SPACE + i * CELL_SIZE);
      rect.setAttribute('width', CELL_SIZE - 1);
      rect.setAttribute('height', CELL_SIZE - 1);
      rect.setAttribute('fill', value > 0 ? colorForValue(value, maxValue) : 'var(--md-surface-container)');
      rect.classList.add('matrix-cell');
      rect.addEventListener('mousemove', (e) => onHover(e, pair, rowDevice, colDevice));
      rect.addEventListener('mouseleave', onLeave);
      svg.appendChild(rect);
    });
  });

  container.innerHTML = '';
  container.appendChild(svg);
  return svg;
}
