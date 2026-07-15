// UI controller: file import, worker wiring, filter panel, tabs, tooltips, export menu.
// thought up by human, created by ai

import {
  PROTOCOL_GROUPS,
  computeVisiblePairs,
  deviceLabel,
  formatBytes,
  formatTimestamp,
  metricValue,
} from './data-model.js';
import { renderMatrix } from './matrix-view.js';
import { renderGraph, updateForces } from './graph-view.js';
import { exportActiveViewAsImage } from './export-image.js';
import { exportToExcel } from './export-excel.js';

const LARGE_SELECTION_THRESHOLD = 50;

const state = {
  devices: [],
  pairs: [],
  deviceIndex: new Map(),
  selectedIds: new Set(),
  search: '',
  activeGroups: new Set(Object.keys(PROTOCOL_GROUPS)),
  hideMulticast: false,
  activeTab: 'matrix',
  metric: 'packets',
  forceCharge: 300,
  forceDistance: 120,
  graphSimulation: null,
  activeSvg: null,
};

const el = {
  fileInput: document.getElementById('file-input'),
  btnOpenFile: document.getElementById('btn-open-file'),
  dropZone: document.getElementById('drop-zone'),
  workspace: document.getElementById('workspace'),
  progressBanner: document.getElementById('progress-banner'),
  progressLabel: document.getElementById('progress-label'),
  progressFill: document.getElementById('progress-bar-fill'),
  errorBanner: document.getElementById('error-banner'),
  errorMessage: document.getElementById('error-message'),
  btnDismissError: document.getElementById('btn-dismiss-error'),
  deviceSearch: document.getElementById('device-search'),
  deviceList: document.getElementById('device-list'),
  deviceCount: document.getElementById('device-count'),
  btnSelectAll: document.getElementById('btn-select-all'),
  btnSelectNone: document.getElementById('btn-select-none'),
  protocolFilters: document.getElementById('protocol-filters'),
  toggleHideBroadcast: document.getElementById('toggle-hide-broadcast'),
  tabMatrix: document.getElementById('tab-matrix'),
  tabGraph: document.getElementById('tab-graph'),
  viewMatrix: document.getElementById('view-matrix'),
  viewGraph: document.getElementById('view-graph'),
  matrixContainer: document.getElementById('matrix-container'),
  graphContainer: document.getElementById('graph-container'),
  graphControls: document.getElementById('graph-controls'),
  forceCharge: document.getElementById('force-charge'),
  forceDistance: document.getElementById('force-distance'),
  metricPackets: document.getElementById('metric-packets'),
  metricBytes: document.getElementById('metric-bytes'),
  largeSelectionWarning: document.getElementById('large-selection-warning'),
  btnExport: document.getElementById('btn-export'),
  exportMenu: document.getElementById('export-menu'),
  exportPng: document.getElementById('export-png'),
  exportSvg: document.getElementById('export-svg'),
  exportXlsx: document.getElementById('export-xlsx'),
  tooltip: document.getElementById('tooltip'),
};

let worker = null;

function startParsing(file) {
  showProgress(0, 'Datei wird gelesen …');
  el.errorBanner.hidden = true;

  const reader = new FileReader();
  reader.onerror = () => showError('Die Datei konnte nicht gelesen werden.');
  reader.onload = () => {
    if (worker) worker.terminate();
    worker = new Worker('parser.worker.js');
    worker.onmessage = handleWorkerMessage;
    worker.onerror = (event) => {
      const detail = event.message || (event.filename ? `${event.filename}:${event.lineno}` : null);
      showError(`Fehler beim Parsen: ${detail || 'Unbekannter Fehler beim Ausführen des Parsers.'}`);
    };
    showProgress(0, 'Datei wird geparst …');
    worker.postMessage({ buffer: reader.result }, [reader.result]);
  };
  reader.readAsArrayBuffer(file);
}

function handleWorkerMessage(event) {
  const msg = event.data;
  if (msg.type === 'progress') {
    showProgress(msg.percent, `Datei wird geparst … (${msg.packetCount.toLocaleString('de-DE')} Pakete)`);
  } else if (msg.type === 'error') {
    showError(msg.message);
  } else if (msg.type === 'result') {
    onParseComplete(msg);
  }
}

function onParseComplete(msg) {
  el.progressBanner.hidden = true;
  if (msg.devices.length === 0) {
    showError('Es konnten keine Geräte erkannt werden. Enthält die Datei unterstützte Pakete (Ethernet/SLL, IPv4/IPv6/ARP)?');
    return;
  }

  state.devices = msg.devices;
  state.pairs = msg.pairs;
  state.deviceIndex = new Map(state.devices.map((d) => [d.id, d]));
  state.selectedIds = new Set(state.devices.map((d) => d.id));
  state.search = '';
  el.deviceSearch.value = '';

  el.dropZone.hidden = true;
  el.workspace.hidden = false;

  renderDeviceList();
  renderActiveView();
}

function showProgress(percent, label) {
  el.progressBanner.hidden = false;
  el.progressFill.style.width = `${percent}%`;
  el.progressLabel.textContent = label;
}

function showError(message) {
  el.progressBanner.hidden = true;
  el.errorMessage.textContent = message;
  el.errorBanner.hidden = false;
}

el.btnDismissError.addEventListener('click', () => { el.errorBanner.hidden = true; });

el.btnOpenFile.addEventListener('click', () => el.fileInput.click());
el.fileInput.addEventListener('change', () => {
  if (el.fileInput.files[0]) startParsing(el.fileInput.files[0]);
  el.fileInput.value = '';
});

['dragenter', 'dragover'].forEach((evt) => {
  el.dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    el.dropZone.classList.add('is-dragover');
  });
});
['dragleave', 'drop'].forEach((evt) => {
  el.dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    el.dropZone.classList.remove('is-dragover');
  });
});
el.dropZone.addEventListener('drop', (e) => {
  const file = e.dataTransfer.files[0];
  if (file) startParsing(file);
});

// --- Device list / filtering -------------------------------------------------

function renderDeviceList() {
  const search = state.search.toLowerCase();
  const sorted = [...state.devices].sort((a, b) => b.packetCount - a.packetCount);
  el.deviceList.innerHTML = '';
  let visibleCount = 0;

  for (const device of sorted) {
    const label = deviceLabel(device);
    if (search && !label.toLowerCase().includes(search)) continue;
    visibleCount++;

    const li = document.createElement('li');
    li.className = 'device-list__item';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = state.selectedIds.has(device.id);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) state.selectedIds.add(device.id);
      else state.selectedIds.delete(device.id);
      renderActiveView();
    });

    const labelSpan = document.createElement('span');
    labelSpan.className = 'device-list__label';
    labelSpan.textContent = label;
    labelSpan.title = label;

    const meta = document.createElement('span');
    meta.className = 'device-list__meta';
    meta.textContent = device.packetCount.toLocaleString('de-DE');

    li.append(checkbox, labelSpan, meta);
    el.deviceList.appendChild(li);
  }

  el.deviceCount.textContent = visibleCount.toLocaleString('de-DE');
}

el.deviceSearch.addEventListener('input', () => {
  state.search = el.deviceSearch.value;
  renderDeviceList();
});

el.btnSelectAll.addEventListener('click', () => {
  state.selectedIds = new Set(state.devices.map((d) => d.id));
  renderDeviceList();
  renderActiveView();
});
el.btnSelectNone.addEventListener('click', () => {
  state.selectedIds.clear();
  renderDeviceList();
  renderActiveView();
});

el.protocolFilters.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  const group = chip.dataset.protocol;
  if (state.activeGroups.has(group)) state.activeGroups.delete(group);
  else state.activeGroups.add(group);
  chip.classList.toggle('is-active');
  renderActiveView();
});

el.toggleHideBroadcast.addEventListener('change', () => {
  state.hideMulticast = el.toggleHideBroadcast.checked;
  renderActiveView();
});

// --- Tabs / metric ------------------------------------------------------------

function setActiveTab(tab) {
  state.activeTab = tab;
  const isMatrix = tab === 'matrix';
  el.tabMatrix.classList.toggle('is-active', isMatrix);
  el.tabMatrix.setAttribute('aria-selected', String(isMatrix));
  el.tabGraph.classList.toggle('is-active', !isMatrix);
  el.tabGraph.setAttribute('aria-selected', String(!isMatrix));
  el.viewMatrix.hidden = !isMatrix;
  el.viewGraph.hidden = isMatrix;
  el.graphControls.hidden = isMatrix;
  renderActiveView();
}

el.tabMatrix.addEventListener('click', () => setActiveTab('matrix'));
el.tabGraph.addEventListener('click', () => setActiveTab('graph'));

function setMetric(metric) {
  state.metric = metric;
  el.metricPackets.classList.toggle('is-active', metric === 'packets');
  el.metricPackets.setAttribute('aria-checked', String(metric === 'packets'));
  el.metricBytes.classList.toggle('is-active', metric === 'bytes');
  el.metricBytes.setAttribute('aria-checked', String(metric === 'bytes'));
  renderActiveView();
}

el.metricPackets.addEventListener('click', () => setMetric('packets'));
el.metricBytes.addEventListener('click', () => setMetric('bytes'));

el.forceCharge.addEventListener('input', () => {
  state.forceCharge = Number(el.forceCharge.value);
  if (state.graphSimulation) updateForces(state.graphSimulation, { charge: state.forceCharge, distance: state.forceDistance });
});
el.forceDistance.addEventListener('input', () => {
  state.forceDistance = Number(el.forceDistance.value);
  if (state.graphSimulation) updateForces(state.graphSimulation, { charge: state.forceCharge, distance: state.forceDistance });
});

// --- Rendering -----------------------------------------------------------------

function renderActiveView() {
  if (state.devices.length === 0) return;

  const selectedDevices = state.devices.filter((d) => state.selectedIds.has(d.id));
  const visiblePairs = computeVisiblePairs(state.pairs, state.selectedIds, state.activeGroups, state.hideMulticast);

  el.largeSelectionWarning.hidden = selectedDevices.length <= LARGE_SELECTION_THRESHOLD;

  if (state.activeTab === 'matrix') {
    state.activeSvg = renderMatrix(el.matrixContainer, {
      devices: selectedDevices,
      pairs: visiblePairs,
      metric: state.metric,
      onHover: (event, pair, deviceA, deviceB) => showPairTooltip(event, pair, deviceA, deviceB),
      onLeave: hideTooltip,
    });
    state.graphSimulation = null;
  } else {
    const { svg, simulation } = renderGraph(el.graphContainer, {
      devices: selectedDevices,
      pairs: visiblePairs,
      metric: state.metric,
      forceCharge: state.forceCharge,
      forceDistance: state.forceDistance,
      onHoverEdge: (event, pair, deviceA, deviceB) => showPairTooltip(event, pair, deviceA, deviceB),
      onHoverNode: (event, device) => showDeviceTooltip(event, device),
      onLeave: hideTooltip,
    });
    state.activeSvg = svg;
    state.graphSimulation = simulation;
  }
}

// --- Tooltip ---------------------------------------------------------------------

function showPairTooltip(event, pair, deviceA, deviceB) {
  const value = pair ? metricValue(pair, state.metric) : 0;
  const html = pair
    ? `<div><strong>${deviceLabel(deviceA)}</strong> ↔ <strong>${deviceLabel(deviceB)}</strong></div>
       <div>Protokolle: ${pair.protocols.join(', ') || '–'}</div>
       <div>Ports: ${pair.ports.slice(0, 12).join(', ') || '–'}</div>
       <div>Pakete: ${pair.packets.toLocaleString('de-DE')} · Bytes: ${formatBytes(pair.bytes)}</div>
       <div>Zeitraum: ${formatTimestamp(pair.firstSeen)} – ${formatTimestamp(pair.lastSeen)}</div>
       <div>Metrik (${state.metric}): ${value.toLocaleString('de-DE')}</div>`
    : `<div><strong>${deviceLabel(deviceA)}</strong> ↔ <strong>${deviceLabel(deviceB)}</strong></div><div>Keine Kommunikation</div>`;
  showTooltip(event, html);
}

function showDeviceTooltip(event, device) {
  const html = `<div><strong>${deviceLabel(device)}</strong></div>
    <div>MAC: ${device.mac || '–'}</div>
    <div>Pakete: ${device.packetCount.toLocaleString('de-DE')} · Bytes: ${formatBytes(device.byteCount)}</div>`;
  showTooltip(event, html);
}

function showTooltip(event, html) {
  el.tooltip.innerHTML = html;
  el.tooltip.hidden = false;
  positionTooltip(event);
}

function positionTooltip(event) {
  const margin = 16;
  const rect = el.tooltip.getBoundingClientRect();
  let x = event.clientX + margin;
  let y = event.clientY + margin;
  if (x + rect.width > window.innerWidth) x = event.clientX - rect.width - margin;
  if (y + rect.height > window.innerHeight) y = event.clientY - rect.height - margin;
  el.tooltip.style.left = `${Math.max(0, x)}px`;
  el.tooltip.style.top = `${Math.max(0, y)}px`;
}

function hideTooltip() {
  el.tooltip.hidden = true;
}

document.addEventListener('mousemove', (event) => {
  if (!el.tooltip.hidden) positionTooltip(event);
});

// --- Export ------------------------------------------------------------------------

el.btnExport.addEventListener('click', (e) => {
  e.stopPropagation();
  el.exportMenu.hidden = !el.exportMenu.hidden;
});
document.addEventListener('click', () => { el.exportMenu.hidden = true; });

el.exportPng.addEventListener('click', () => {
  el.exportMenu.hidden = true;
  if (state.activeSvg) exportActiveViewAsImage(state.activeSvg, 'png', `packetatlas-${state.activeTab}`);
});
el.exportSvg.addEventListener('click', () => {
  el.exportMenu.hidden = true;
  if (state.activeSvg) exportActiveViewAsImage(state.activeSvg, 'svg', `packetatlas-${state.activeTab}`);
});
el.exportXlsx.addEventListener('click', () => {
  el.exportMenu.hidden = true;
  const selectedDevices = state.devices.filter((d) => state.selectedIds.has(d.id));
  const visiblePairs = computeVisiblePairs(state.pairs, state.selectedIds, state.activeGroups, state.hideMulticast);
  exportToExcel({ devices: selectedDevices, pairs: visiblePairs, metric: state.metric, filenameBase: 'packetatlas-kommunikationsmatrix' });
});
