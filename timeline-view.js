// Timeline ("Gantt chart") view: one row per connection (device pair +
// protocol + port), one horizontal bar spanning its first-to-last-seen
// timestamps, plotted against a shared, zoomable/pannable time axis.
// `d3` (vendor/d3.min.js) is loaded as a classic script before this module and
// provides the time scale, axis rendering and zoom/pan behavior.
// thought up by human, created by ai

import { deviceLabel } from './data-model.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

const LABEL_WIDTH = 240;
const HEADER_HEIGHT = 36;
const ROW_HEIGHT = 28;
const BAR_HEIGHT = 16;
const MIN_BAR_WIDTH = 3;
const FOOTER_MARGIN = 16;

function rowLabel(connection, deviceIndex) {
  const deviceA = deviceIndex.get(connection.a);
  const deviceB = deviceIndex.get(connection.b);
  const portPart = connection.port != null ? ` ${connection.port}` : '';
  return `${deviceLabel(deviceA)} ↔ ${deviceLabel(deviceB)} · ${connection.protocol || 'IP'}${portPart}`;
}

const timeTickFormat = (date) => date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/**
 * Renders the Gantt-style timeline for the given (already filtered, grouped-
 * by-device-pair) connections into `container`. Returns the root <svg>
 * element (used for image export).
 */
export function renderTimeline(container, { connections, deviceIndex, onHover, onLeave }) {
  const width = container.clientWidth || 800;
  const plotWidth = Math.max(100, width - LABEL_WIDTH);
  const plotHeight = Math.max(1, connections.length) * ROW_HEIGHT;
  const height = HEADER_HEIGHT + plotHeight + FOOTER_MARGIN;

  let minTime = Infinity;
  let maxTime = -Infinity;
  for (const c of connections) {
    if (c.firstSeen < minTime) minTime = c.firstSeen;
    if (c.lastSeen > maxTime) maxTime = c.lastSeen;
  }
  if (!Number.isFinite(minTime)) { minTime = 0; maxTime = 1; }
  if (minTime === maxTime) { minTime -= 1; maxTime += 1; }

  const baseScale = d3.scaleTime()
    .domain([new Date(minTime * 1000), new Date(maxTime * 1000)])
    .range([0, plotWidth])
    .nice();

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  svg.classList.add('timeline-svg');

  const clipId = `timeline-clip-${Math.random().toString(36).slice(2)}`;
  const defs = document.createElementNS(SVG_NS, 'defs');
  const clipPath = document.createElementNS(SVG_NS, 'clipPath');
  clipPath.setAttribute('id', clipId);
  const clipRect = document.createElementNS(SVG_NS, 'rect');
  clipRect.setAttribute('x', 0);
  clipRect.setAttribute('y', 0);
  clipRect.setAttribute('width', plotWidth);
  clipRect.setAttribute('height', height);
  clipPath.appendChild(clipRect);
  defs.appendChild(clipPath);
  svg.appendChild(defs);

  // Fixed (non-zooming) row label column on the left.
  const labelLayer = document.createElementNS(SVG_NS, 'g');
  svg.appendChild(labelLayer);
  connections.forEach((connection, i) => {
    const y = HEADER_HEIGHT + i * ROW_HEIGHT;
    if (i % 2 === 1) {
      const stripe = document.createElementNS(SVG_NS, 'rect');
      stripe.setAttribute('x', 0);
      stripe.setAttribute('y', y);
      stripe.setAttribute('width', width);
      stripe.setAttribute('height', ROW_HEIGHT);
      stripe.classList.add('timeline-row-stripe');
      labelLayer.appendChild(stripe);
    }
    const text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('x', 8);
    text.setAttribute('y', y + ROW_HEIGHT / 2 + 4);
    text.classList.add('timeline-row-label');
    const label = rowLabel(connection, deviceIndex);
    const maxChars = 34;
    text.textContent = label.length > maxChars ? `${label.slice(0, maxChars - 1)}…` : label;
    const title = document.createElementNS(SVG_NS, 'title');
    title.textContent = label;
    text.appendChild(title);
    labelLayer.appendChild(text);
  });

  // Zoomable/pannable plot area (axis + bars), clipped to its own width.
  const plotGroup = document.createElementNS(SVG_NS, 'g');
  plotGroup.setAttribute('transform', `translate(${LABEL_WIDTH},0)`);
  plotGroup.setAttribute('clip-path', `url(#${clipId})`);
  svg.appendChild(plotGroup);

  // Transparent full-area rect so drag-to-pan/wheel-to-zoom work anywhere in
  // the plot area, not just directly over a bar (SVG groups have no hit
  // region of their own between their children).
  const zoomCatcher = document.createElementNS(SVG_NS, 'rect');
  zoomCatcher.setAttribute('x', 0);
  zoomCatcher.setAttribute('y', 0);
  zoomCatcher.setAttribute('width', plotWidth);
  zoomCatcher.setAttribute('height', height);
  zoomCatcher.classList.add('timeline-zoom-catcher');
  plotGroup.appendChild(zoomCatcher);

  const axisGroup = document.createElementNS(SVG_NS, 'g');
  axisGroup.setAttribute('transform', `translate(0,${HEADER_HEIGHT})`);
  axisGroup.classList.add('timeline-axis');
  plotGroup.appendChild(axisGroup);

  const barGroup = document.createElementNS(SVG_NS, 'g');
  plotGroup.appendChild(barGroup);

  const bars = connections.map((connection, i) => {
    const y = HEADER_HEIGHT + i * ROW_HEIGHT + (ROW_HEIGHT - BAR_HEIGHT) / 2;
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('y', y);
    rect.setAttribute('height', BAR_HEIGHT);
    rect.setAttribute('rx', 3);
    rect.classList.add('timeline-bar');
    rect.addEventListener('mousemove', (e) => onHover(e, connection));
    rect.addEventListener('mouseleave', onLeave);
    barGroup.appendChild(rect);
    return { rect, connection };
  });

  function drawAxis(scale) {
    axisGroup.innerHTML = '';
    const ticks = scale.ticks(Math.max(2, Math.floor(plotWidth / 110)));
    for (const tick of ticks) {
      const x = scale(tick);
      const gridline = document.createElementNS(SVG_NS, 'line');
      gridline.setAttribute('x1', x);
      gridline.setAttribute('x2', x);
      gridline.setAttribute('y1', 0);
      gridline.setAttribute('y2', plotHeight);
      gridline.classList.add('timeline-gridline');
      axisGroup.appendChild(gridline);

      const label = document.createElementNS(SVG_NS, 'text');
      label.setAttribute('x', x);
      label.setAttribute('y', -10);
      label.setAttribute('text-anchor', 'middle');
      label.classList.add('timeline-axis-label');
      label.textContent = timeTickFormat(tick);
      axisGroup.appendChild(label);
    }
  }

  function drawBars(scale) {
    for (const { rect, connection } of bars) {
      const x1 = scale(new Date(connection.firstSeen * 1000));
      const x2 = scale(new Date(connection.lastSeen * 1000));
      const w = Math.max(MIN_BAR_WIDTH, x2 - x1);
      rect.setAttribute('x', x1);
      rect.setAttribute('width', w);
    }
  }

  drawAxis(baseScale);
  drawBars(baseScale);

  const zoom = d3.zoom()
    .scaleExtent([1, 200])
    .translateExtent([[0, 0], [plotWidth, 0]])
    .extent([[0, 0], [plotWidth, plotHeight]])
    .on('zoom', (event) => {
      const rescaled = event.transform.rescaleX(baseScale);
      drawAxis(rescaled);
      drawBars(rescaled);
    });
  d3.select(plotGroup).call(zoom);

  container.innerHTML = '';
  container.appendChild(svg);
  return svg;
}
