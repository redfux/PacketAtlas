// Force-directed network graph view, rendered as pure SVG.
// `d3` (vendor/d3.min.js) is loaded as a classic script before this module
// and provides d3-force, d3-drag and d3-zoom.
// thought up by human, created by ai

import { metricValue, deviceLabel } from './data-model.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function nodeRadius(device) {
  return 5 + Math.min(15, Math.sqrt(device.packetCount || 1));
}

/**
 * Renders the force-directed graph for the given (already filtered/selected)
 * devices and pairs into `container`, replacing its previous content.
 * Returns { svg, simulation } - the caller keeps `simulation` to live-update
 * force parameters via updateForces() without a full re-render.
 */
export function renderGraph(container, {
  devices, pairs, metric, forceCharge, forceDistance, onHoverEdge, onHoverNode, onLeave,
}) {
  container.innerHTML = '';
  const width = container.clientWidth || 800;
  const height = Math.max(container.clientHeight || 0, 500);

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.classList.add('graph-svg');
  container.appendChild(svg);

  const zoomLayer = document.createElementNS(SVG_NS, 'g');
  const edgeLayer = document.createElementNS(SVG_NS, 'g');
  const nodeLayer = document.createElementNS(SVG_NS, 'g');
  zoomLayer.append(edgeLayer, nodeLayer);
  svg.appendChild(zoomLayer);

  const nodes = devices.map((d) => ({ ...d }));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const maxValue = pairs.reduce((max, p) => Math.max(max, metricValue(p, metric)), 0);
  const links = pairs
    .filter((p) => nodeById.has(p.a) && nodeById.has(p.b))
    .map((p) => ({ source: p.a, target: p.b, pair: p }));

  const edgeWidth = (pair) => 1 + (maxValue > 0 ? (metricValue(pair, metric) / maxValue) * 6 : 0);

  const edgeElements = links.map((link) => {
    const line = document.createElementNS(SVG_NS, 'line');
    line.classList.add('graph-edge');
    line.setAttribute('stroke-width', edgeWidth(link.pair));
    line.addEventListener('mousemove', (e) => onHoverEdge(e, link.pair, nodeById.get(link.pair.a), nodeById.get(link.pair.b)));
    line.addEventListener('mouseleave', onLeave);
    edgeLayer.appendChild(line);
    return line;
  });

  const nodeElements = nodes.map((node) => {
    const g = document.createElementNS(SVG_NS, 'g');
    g.classList.add('graph-node');
    const circle = document.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('r', nodeRadius(node));
    circle.setAttribute('fill', node.kind === 'mac' ? 'var(--md-outline)' : 'var(--md-primary)');
    const label = document.createElementNS(SVG_NS, 'text');
    label.textContent = deviceLabel(node);
    label.setAttribute('dy', -(nodeRadius(node) + 4));
    label.setAttribute('text-anchor', 'middle');
    g.append(circle, label);
    g.addEventListener('mousemove', (e) => onHoverNode(e, node));
    g.addEventListener('mouseleave', onLeave);
    nodeLayer.appendChild(g);
    return g;
  });

  const simulation = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(links).id((d) => d.id).distance(forceDistance).strength(0.4))
    .force('charge', d3.forceManyBody().strength(-forceCharge))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('collide', d3.forceCollide((d) => nodeRadius(d) + 4));

  function syncPositions() {
    links.forEach((link, i) => {
      edgeElements[i].setAttribute('x1', link.source.x);
      edgeElements[i].setAttribute('y1', link.source.y);
      edgeElements[i].setAttribute('x2', link.target.x);
      edgeElements[i].setAttribute('y2', link.target.y);
    });
    nodes.forEach((node, i) => {
      nodeElements[i].setAttribute('transform', `translate(${node.x},${node.y})`);
    });
  }
  simulation.on('tick', syncPositions);

  // d3's internal timer relies on requestAnimationFrame, which browsers throttle
  // or pause entirely in background/inactive tabs. Pre-converge synchronously so
  // the layout is immediately visible regardless of tab visibility, then hand
  // off to the animated timer for any further interactive adjustments (drag).
  // Note: the public simulation.tick() call updates node positions but - unlike
  // the internal timer-driven ticks - does not dispatch the 'tick' event, so the
  // DOM has to be synced explicitly once after the loop.
  simulation.stop();
  for (let i = 0; i < 300; i++) simulation.tick();
  syncPositions();
  simulation.alpha(0.3).restart();

  const drag = d3.drag()
    .on('start', (event, d) => {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    })
    .on('drag', (event, d) => {
      d.fx = event.x;
      d.fy = event.y;
    })
    .on('end', (event, d) => {
      if (!event.active) simulation.alphaTarget(0);
      d.fx = null;
      d.fy = null;
    });

  d3.select(svg).selectAll('.graph-node').data(nodes).call(drag);

  const zoom = d3.zoom()
    .scaleExtent([0.1, 8])
    .on('zoom', (event) => zoomLayer.setAttribute('transform', event.transform));
  d3.select(svg).call(zoom);

  // The pre-converged layout can extend beyond the initial viewBox (forceCenter
  // pulls toward the middle, but nothing constrains the overall extent) - fit it
  // into view so no node starts out hidden until the user manually pans/zooms.
  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  const graphWidth = Math.max(1, Math.max(...xs) - Math.min(...xs));
  const graphHeight = Math.max(1, Math.max(...ys) - Math.min(...ys));
  const padding = 60;
  const fitScale = Math.min(1, (width - padding * 2) / graphWidth, (height - padding * 2) / graphHeight);
  const centerX = (Math.max(...xs) + Math.min(...xs)) / 2;
  const centerY = (Math.max(...ys) + Math.min(...ys)) / 2;
  const initialTransform = d3.zoomIdentity
    .translate(width / 2 - fitScale * centerX, height / 2 - fitScale * centerY)
    .scale(fitScale);
  d3.select(svg).call(zoom.transform, initialTransform);

  return { svg, simulation };
}

/** Live-updates charge/link-distance without rebuilding the DOM (used while dragging sliders). */
export function updateForces(simulation, { charge, distance }) {
  simulation.force('charge', d3.forceManyBody().strength(-charge));
  const linkForce = simulation.force('link');
  if (linkForce) linkForce.distance(distance);
  simulation.alpha(0.5).restart();
}
