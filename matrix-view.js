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
 * A pair aggregates both directions together, but each of the two mirrored
 * cells for a pair (row->col and col->row) represents only ONE direction of
 * traffic - so the cell has to read from the matching directional
 * sub-aggregate (`pair.aToB`/`pair.bToA`, see parser.worker.js), not the
 * combined pair totals, or both cells would show identical values/colors
 * regardless of which one you're actually looking at.
 */
function directionalDataFor(pair, rowDevice) {
  if (!pair) return null;
  const isInitiatorDirection = rowDevice.id === pair.a;
  return { data: isInitiatorDirection ? pair.aToB : pair.bToA, isInitiatorDirection };
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
  // headers are rotated -45°, so their extent both above AND to the right of
  // the grid grows with label length (a fixed margin clips longer IPs/
  // hostnames - previously only the top margin accounted for this, leaving
  // the rightmost columns' labels clipped against the right edge); row
  // headers are unrotated and just need that same length horizontally.
  const maxLabelLen = devices.reduce((max, d) => Math.max(max, truncatedLabel(d).length), 6);
  const diagonalExtent = maxLabelLen * CHAR_WIDTH * Math.sin(Math.PI / 4);
  const leftLabelWidth = MIN_LABEL_SPACE + maxLabelLen * CHAR_WIDTH;
  const topHeaderHeight = MIN_LABEL_SPACE + diagonalExtent;
  const rightMargin = diagonalExtent + 10;
  const width = leftLabelWidth + Math.max(n, 1) * CELL_SIZE + rightMargin;
  const height = topHeaderHeight + Math.max(n, 1) * CELL_SIZE;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  svg.classList.add('matrix-svg');

  let maxValue = 0;
  for (const pair of pairs) {
    maxValue = Math.max(maxValue, metricValue(pair.aToB, metric), metricValue(pair.bToA, metric));
  }

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
      const direction = directionalDataFor(pair, rowDevice);
      const value = direction ? metricValue(direction.data, metric) : 0;
      const cellX = leftLabelWidth + j * CELL_SIZE;
      const cellY = topHeaderHeight + i * CELL_SIZE;

      const rect = document.createElementNS(SVG_NS, 'rect');
      rect.setAttribute('x', cellX);
      rect.setAttribute('y', cellY);
      rect.setAttribute('width', CELL_SIZE - 1);
      rect.setAttribute('height', CELL_SIZE - 1);
      rect.setAttribute('fill', value > 0 ? colorForValue(value, maxValue) : 'var(--md-surface-container)');
      rect.classList.add('matrix-cell');
      rect.addEventListener('mousemove', (e) => onHover(e, pair, rowDevice, colDevice));
      rect.addEventListener('mouseleave', onLeave);
      rect.addEventListener('click', (e) => onClick(e, pair, rowDevice, colDevice));
      svg.appendChild(rect);

      // Small always-visible marker distinguishing which of the two mirrored
      // cells is the direction that actually opened the communication versus
      // the one that's just the reply - relevant e.g. for deriving stateless
      // firewall/ACL rules, where only the initiating direction needs an
      // explicit allow entry.
      if (value > 0) {
        const iconX = cellX + 4;
        const iconY = cellY + 4;
        if (direction.isInitiatorDirection) {
          const triangle = document.createElementNS(SVG_NS, 'polygon');
          triangle.setAttribute('points', `${iconX},${iconY} ${iconX + 6},${iconY + 3} ${iconX},${iconY + 6}`);
          triangle.classList.add('matrix-direction-icon', 'matrix-direction-icon--initiator');
          triangle.setAttribute('pointer-events', 'none');
          svg.appendChild(triangle);
        } else {
          const circle = document.createElementNS(SVG_NS, 'circle');
          circle.setAttribute('cx', iconX + 3);
          circle.setAttribute('cy', iconY + 3);
          circle.setAttribute('r', 3);
          circle.classList.add('matrix-direction-icon', 'matrix-direction-icon--responder');
          circle.setAttribute('pointer-events', 'none');
          svg.appendChild(circle);
        }
      }
    });
  });

  container.innerHTML = '';
  container.appendChild(svg);
  return svg;
}
