// UI controller: file import, worker wiring, filter panel, tabs, tooltips, export menu.
// thought up by human, created by ai

import {
  PROTOCOL_GROUPS,
  addressFamilyOf,
  compareDevicesByAddress,
  computePortEntries,
  computeVisibleConnections,
  computeVisiblePairs,
  deviceLabel,
  formatBytes,
  formatTimestamp,
  metricValue,
  pairKey,
  portListLabel,
  relatedDeviceIds,
} from './data-model.js';
import { renderMatrix } from './matrix-view.js';
import { renderGraph, updateForces } from './graph-view.js';
import { renderConnections } from './connections-view.js';
import { renderTimeline } from './timeline-view.js';
import { exportActiveViewAsImage } from './export-image.js';
import { exportToExcel, exportSelectionToExcel } from './export-excel.js';

const LARGE_SELECTION_THRESHOLD = 50;
const MAX_CONNECTIONS_RENDER = 400;
const MAX_TIMELINE_RENDER = 300;
// Bumped alongside the footer version in index.html. parser.worker.js (and
// the scripts it loads via importScripts()) is fetched as a plain classic
// script, which browsers can cache independently of the main page - a normal
// (or even hard) page reload doesn't reliably bust that cache in every
// browser. Appending the version as a query string changes the request URL
// whenever the app updates, forcing a fresh fetch instead of silently
// running old worker code after an update.
const APP_VERSION = '0.13.1';

const state = {
  devices: [],
  pairs: [],
  connections: [],
  deviceIndex: new Map(),
  selectedIds: new Set(),
  search: '',
  activeGroups: new Set(Object.keys(PROTOCOL_GROUPS)),
  hideMulticast: false,
  sidebarTab: 'devices', // 'devices' | 'ports'
  activeTab: 'matrix',
  metric: 'packets',
  addressFamily: 'ipv4',
  forceCharge: 300,
  forceDistance: 120,
  graphSimulation: null,
  activeSvg: null,
  pinnedItems: [], // { id, type: 'pair'|'connection'|'device', data, deviceA, deviceB }
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
  deviceListSection: document.getElementById('device-list-section'),
  deviceFilterExtras: document.getElementById('device-filter-extras'),
  btnSelectAll: document.getElementById('btn-select-all'),
  btnSelectNone: document.getElementById('btn-select-none'),
  protocolFilters: document.getElementById('protocol-filters'),
  toggleHideBroadcast: document.getElementById('toggle-hide-broadcast'),
  subtabDevices: document.getElementById('subtab-devices'),
  subtabPorts: document.getElementById('subtab-ports'),
  portListSection: document.getElementById('port-list-section'),
  portList: document.getElementById('port-list'),
  portCount: document.getElementById('port-count'),
  tabMatrix: document.getElementById('tab-matrix'),
  tabGraph: document.getElementById('tab-graph'),
  tabConnections: document.getElementById('tab-connections'),
  tabTimeline: document.getElementById('tab-timeline'),
  viewMatrix: document.getElementById('view-matrix'),
  viewGraph: document.getElementById('view-graph'),
  viewConnections: document.getElementById('view-connections'),
  viewTimeline: document.getElementById('view-timeline'),
  matrixContainer: document.getElementById('matrix-container'),
  graphContainer: document.getElementById('graph-container'),
  connectionsContainer: document.getElementById('connections-container'),
  timelineContainer: document.getElementById('timeline-container'),
  graphControls: document.getElementById('graph-controls'),
  forceCharge: document.getElementById('force-charge'),
  forceDistance: document.getElementById('force-distance'),
  metricGroup: document.getElementById('metric-group'),
  metricPackets: document.getElementById('metric-packets'),
  metricBytes: document.getElementById('metric-bytes'),
  connectionsTruncatedWarning: document.getElementById('connections-truncated-warning'),
  connectionsTruncatedMessage: document.getElementById('connections-truncated-message'),
  timelineTruncatedWarning: document.getElementById('timeline-truncated-warning'),
  timelineTruncatedMessage: document.getElementById('timeline-truncated-message'),
  familyIpv4: document.getElementById('family-ipv4'),
  familyIpv6: document.getElementById('family-ipv6'),
  familyMac: document.getElementById('family-mac'),
  largeSelectionWarning: document.getElementById('large-selection-warning'),
  btnExport: document.getElementById('btn-export'),
  exportMenu: document.getElementById('export-menu'),
  exportPng: document.getElementById('export-png'),
  exportSvg: document.getElementById('export-svg'),
  exportXlsx: document.getElementById('export-xlsx'),
  exportPinnedXlsx: document.getElementById('export-pinned-xlsx'),
  tooltip: document.getElementById('tooltip'),
  pinnedPanel: document.getElementById('pinned-panel'),
  pinnedList: document.getElementById('pinned-list'),
  pinnedCount: document.getElementById('pinned-count'),
  btnClearPinned: document.getElementById('btn-clear-pinned'),
};

let worker = null;

function startParsing(file) {
  showProgress(0, 'Datei wird gelesen …');
  el.errorBanner.hidden = true;

  const reader = new FileReader();
  reader.onerror = () => showError('Die Datei konnte nicht gelesen werden.');
  reader.onload = () => {
    if (worker) worker.terminate();
    worker = new Worker(`parser.worker.js?v=${APP_VERSION}`);
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
  state.connections = msg.connections;
  state.deviceIndex = new Map(state.devices.map((d) => [d.id, d]));
  state.selectedIds = new Set(state.devices.map((d) => d.id));
  state.search = '';
  el.deviceSearch.value = '';
  state.pinnedItems = [];
  renderPinnedPanel();

  el.dropZone.hidden = true;
  el.workspace.hidden = false;

  setupAddressFamilyToggle();
  setSidebarTab('devices');
  renderDeviceList();
  renderPortList();
  renderActiveView();
}

/** Enables/disables the IPv4/IPv6/Sonstige buttons based on what the capture actually contains, and picks a sensible default. */
function setupAddressFamilyToggle() {
  const counts = { ipv4: 0, ipv6: 0, mac: 0 };
  for (const device of state.devices) counts[addressFamilyOf(device)]++;

  el.familyIpv4.disabled = counts.ipv4 === 0;
  el.familyIpv6.disabled = counts.ipv6 === 0;
  el.familyMac.disabled = counts.mac === 0;

  const preferredOrder = ['ipv4', 'ipv6', 'mac'];
  const defaultFamily = preferredOrder.find((f) => counts[f] > 0) || 'ipv4';
  setAddressFamily(defaultFamily);
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

function createDeviceListItem(device, isSelected) {
  const label = deviceLabel(device);
  const li = document.createElement('li');
  li.className = isSelected ? 'device-list__item device-list__item--selected' : 'device-list__item';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = isSelected;
  checkbox.addEventListener('change', () => {
    if (checkbox.checked) {
      const wasEmpty = state.selectedIds.size === 0;
      state.selectedIds.add(device.id);
      // Starting a fresh selection from nothing: pull in everything this
      // device actually talks to, so the matrix isn't just a single isolated
      // node. Each of those stays individually uncheckable afterward.
      if (wasEmpty) {
        for (const relatedId of relatedDeviceIds(state.pairs, device.id)) state.selectedIds.add(relatedId);
      }
    } else {
      state.selectedIds.delete(device.id);
    }
    renderDeviceList();
    renderPortList();
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
  return li;
}

function renderDeviceList() {
  const search = state.search.toLowerCase();
  const filtered = state.devices.filter((d) => !search || deviceLabel(d).toLowerCase().includes(search));
  const selected = filtered.filter((d) => state.selectedIds.has(d.id)).sort(compareDevicesByAddress);
  const rest = filtered.filter((d) => !state.selectedIds.has(d.id)).sort(compareDevicesByAddress);

  el.deviceList.innerHTML = '';
  for (const device of selected) el.deviceList.appendChild(createDeviceListItem(device, true));
  if (selected.length > 0 && rest.length > 0) {
    const divider = document.createElement('li');
    divider.className = 'device-list__divider';
    el.deviceList.appendChild(divider);
  }
  for (const device of rest) el.deviceList.appendChild(createDeviceListItem(device, false));

  el.deviceCount.textContent = filtered.length.toLocaleString('de-DE');
}

// --- Port list / filtering ----------------------------------------------------
//
// A second sidebar tab listing every (protocol, service port) combination
// actually used in the capture (see computePortEntries() in data-model.js),
// so e.g. all SSH traffic can be shown with one click instead of having to
// know and manually select every involved IP first. Checking a port selects
// every device that has at least one connection over it, on top of whatever
// devices are already selected; unchecking removes exactly those devices
// again. Reuses the same search field and TCP/UDP protocol chips as the
// device list rather than introducing separate controls.

function createPortListItem(entry, isSelected) {
  const li = document.createElement('li');
  li.className = isSelected ? 'device-list__item device-list__item--selected' : 'device-list__item';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = isSelected;
  checkbox.addEventListener('change', () => {
    if (checkbox.checked) {
      for (const id of entry.deviceIds) state.selectedIds.add(id);
    } else {
      for (const id of entry.deviceIds) state.selectedIds.delete(id);
    }
    renderDeviceList();
    renderPortList();
    renderActiveView();
  });

  const fullLabel = `${portListLabel(entry.port)} · ${entry.protocolGroup}`;
  const labelSpan = document.createElement('span');
  labelSpan.className = 'device-list__label';
  labelSpan.textContent = fullLabel;
  labelSpan.title = fullLabel;

  const meta = document.createElement('span');
  meta.className = 'device-list__meta';
  meta.textContent = entry.packets.toLocaleString('de-DE');

  li.append(checkbox, labelSpan, meta);
  return li;
}

function isPortEntryFullySelected(entry) {
  return entry.deviceIds.size > 0 && [...entry.deviceIds].every((id) => state.selectedIds.has(id));
}

function renderPortList() {
  const search = state.search.toLowerCase();
  const entries = computePortEntries(state.connections)
    .filter((entry) => state.activeGroups.has(entry.protocolGroup))
    .filter((entry) => !search || portListLabel(entry.port).toLowerCase().includes(search));
  const selected = entries.filter(isPortEntryFullySelected);
  const rest = entries.filter((entry) => !isPortEntryFullySelected(entry));

  el.portList.innerHTML = '';
  for (const entry of selected) el.portList.appendChild(createPortListItem(entry, true));
  if (selected.length > 0 && rest.length > 0) {
    const divider = document.createElement('li');
    divider.className = 'device-list__divider';
    el.portList.appendChild(divider);
  }
  for (const entry of rest) el.portList.appendChild(createPortListItem(entry, false));

  el.portCount.textContent = entries.length.toLocaleString('de-DE');
}

function setSidebarTab(tab) {
  state.sidebarTab = tab;
  const isPorts = tab === 'ports';
  el.subtabDevices.classList.toggle('is-active', !isPorts);
  el.subtabDevices.setAttribute('aria-selected', String(!isPorts));
  el.subtabPorts.classList.toggle('is-active', isPorts);
  el.subtabPorts.setAttribute('aria-selected', String(isPorts));
  el.deviceListSection.hidden = isPorts;
  el.deviceFilterExtras.hidden = isPorts;
  el.portListSection.hidden = !isPorts;
  el.deviceSearch.placeholder = isPorts ? 'Port oder Dienst …' : 'IP-Teilstring …';
}

el.subtabDevices.addEventListener('click', () => setSidebarTab('devices'));
el.subtabPorts.addEventListener('click', () => setSidebarTab('ports'));

el.deviceSearch.addEventListener('input', () => {
  state.search = el.deviceSearch.value;
  renderDeviceList();
  renderPortList();
});

el.btnSelectAll.addEventListener('click', () => {
  state.selectedIds = new Set(state.devices.map((d) => d.id));
  renderDeviceList();
  renderPortList();
  renderActiveView();
});
el.btnSelectNone.addEventListener('click', () => {
  state.selectedIds.clear();
  renderDeviceList();
  renderPortList();
  renderActiveView();
});

el.protocolFilters.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  const group = chip.dataset.protocol;
  if (state.activeGroups.has(group)) state.activeGroups.delete(group);
  else state.activeGroups.add(group);
  chip.classList.toggle('is-active');
  renderPortList();
  renderActiveView();
});

el.toggleHideBroadcast.addEventListener('change', () => {
  state.hideMulticast = el.toggleHideBroadcast.checked;
  renderActiveView();
});

// --- Tabs / metric ------------------------------------------------------------

const TABS = {
  matrix: { tabButton: () => el.tabMatrix, view: () => el.viewMatrix },
  graph: { tabButton: () => el.tabGraph, view: () => el.viewGraph },
  connections: { tabButton: () => el.tabConnections, view: () => el.viewConnections },
  timeline: { tabButton: () => el.tabTimeline, view: () => el.viewTimeline },
};
const TABS_WITHOUT_METRIC = new Set(['connections', 'timeline']);

function setActiveTab(tab) {
  state.activeTab = tab;
  for (const [key, { tabButton, view }] of Object.entries(TABS)) {
    const isActive = key === tab;
    tabButton().classList.toggle('is-active', isActive);
    tabButton().setAttribute('aria-selected', String(isActive));
    view().hidden = !isActive;
  }
  el.graphControls.hidden = tab !== 'graph';
  el.metricGroup.hidden = TABS_WITHOUT_METRIC.has(tab);
  renderActiveView();
}

el.tabMatrix.addEventListener('click', () => setActiveTab('matrix'));
el.tabGraph.addEventListener('click', () => setActiveTab('graph'));
el.tabConnections.addEventListener('click', () => setActiveTab('connections'));
el.tabTimeline.addEventListener('click', () => setActiveTab('timeline'));

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

function setAddressFamily(family) {
  state.addressFamily = family;
  const buttons = { ipv4: el.familyIpv4, ipv6: el.familyIpv6, mac: el.familyMac };
  for (const [key, button] of Object.entries(buttons)) {
    button.classList.toggle('is-active', key === family);
    button.setAttribute('aria-checked', String(key === family));
  }
  renderActiveView();
}

el.familyIpv4.addEventListener('click', () => setAddressFamily('ipv4'));
el.familyIpv6.addEventListener('click', () => setAddressFamily('ipv6'));
el.familyMac.addEventListener('click', () => setAddressFamily('mac'));

el.forceCharge.addEventListener('input', () => {
  state.forceCharge = Number(el.forceCharge.value);
  if (state.graphSimulation) updateForces(state.graphSimulation, { charge: state.forceCharge, distance: state.forceDistance });
});
el.forceDistance.addEventListener('input', () => {
  state.forceDistance = Number(el.forceDistance.value);
  if (state.graphSimulation) updateForces(state.graphSimulation, { charge: state.forceCharge, distance: state.forceDistance });
});

// --- Rendering -----------------------------------------------------------------

/**
 * Devices/pairs for the current selection, protocol filter and address-family
 * toggle, with devices sorted ascending by address - shared by both views and
 * by the export handlers so they always show/export exactly what's on screen.
 */
function getVisibleDevicesAndPairs() {
  const familyDevices = state.devices.filter((d) => state.selectedIds.has(d.id) && addressFamilyOf(d) === state.addressFamily);
  const familyIds = new Set(familyDevices.map((d) => d.id));
  const devices = [...familyDevices].sort(compareDevicesByAddress);
  const pairs = computeVisiblePairs(state.pairs, familyIds, state.activeGroups, state.hideMulticast);
  return { devices, pairs, familyIds };
}

/**
 * Per-connection (device pair + protocol + port) breakdown, filtered like
 * getVisibleDevicesAndPairs(). `order` picks the sort appropriate for each
 * view: 'packets' (connections view, heaviest first) or 'timeline' (earliest
 * start time first, so the Gantt chart reads top-to-bottom by when each
 * connection began).
 */
function getVisibleConnections(familyIds, order) {
  const filtered = computeVisibleConnections(state.connections, familyIds, state.activeGroups, state.hideMulticast);
  if (order === 'timeline') {
    return filtered.sort((a, b) => a.firstSeen - b.firstSeen);
  }
  return filtered.sort((a, b) => b.packets - a.packets);
}

function renderActiveView() {
  if (state.devices.length === 0) return;

  const { devices: selectedDevices, pairs: visiblePairs, familyIds } = getVisibleDevicesAndPairs();

  el.largeSelectionWarning.hidden = selectedDevices.length <= LARGE_SELECTION_THRESHOLD;
  el.connectionsTruncatedWarning.hidden = true;
  el.timelineTruncatedWarning.hidden = true;

  if (state.activeTab === 'matrix') {
    state.activeSvg = renderMatrix(el.matrixContainer, {
      devices: selectedDevices,
      pairs: visiblePairs,
      metric: state.metric,
      onHover: (event, pair, rowDevice, colDevice) => showMatrixCellTooltip(event, pair, rowDevice, colDevice),
      onLeave: hideTooltip,
      onClick: (event, pair, rowDevice, colDevice) => { if (pair) pinPair(pair, rowDevice, colDevice, true); },
    });
    state.graphSimulation = null;
  } else if (state.activeTab === 'graph') {
    const { svg, simulation } = renderGraph(el.graphContainer, {
      devices: selectedDevices,
      pairs: visiblePairs,
      metric: state.metric,
      forceCharge: state.forceCharge,
      forceDistance: state.forceDistance,
      onHoverEdge: (event, pair, deviceA, deviceB) => showPairTooltip(event, pair, deviceA, deviceB),
      onHoverNode: (event, device) => showDeviceTooltip(event, device),
      onLeave: hideTooltip,
      onClickEdge: (event, pair, deviceA, deviceB) => pinPair(pair, deviceA, deviceB),
      onClickNode: (event, device) => pinDevice(device),
    });
    state.activeSvg = svg;
    state.graphSimulation = simulation;
  } else if (state.activeTab === 'connections') {
    const allConnections = getVisibleConnections(familyIds, 'packets');
    const renderedConnections = allConnections.slice(0, MAX_CONNECTIONS_RENDER);
    const isTruncated = allConnections.length > renderedConnections.length;
    el.connectionsTruncatedWarning.hidden = !isTruncated;
    if (isTruncated) {
      el.connectionsTruncatedMessage.textContent = `Zeige die größten ${renderedConnections.length.toLocaleString('de-DE')} von ${allConnections.length.toLocaleString('de-DE')} Verbindungen. Für eine vollständige Ansicht bitte weiter filtern.`;
    }
    state.activeSvg = renderConnections(el.connectionsContainer, {
      devices: selectedDevices,
      connections: renderedConnections,
      onHover: (event, connection) => showConnectionTooltip(event, connection),
      onLeave: hideTooltip,
      onClick: (event, connection) => pinConnection(connection),
    });
    state.graphSimulation = null;
  } else {
    const allConnections = getVisibleConnections(familyIds, 'timeline');
    const renderedConnections = allConnections.slice(0, MAX_TIMELINE_RENDER);
    const isTruncated = allConnections.length > renderedConnections.length;
    el.timelineTruncatedWarning.hidden = !isTruncated;
    if (isTruncated) {
      el.timelineTruncatedMessage.textContent = `Zeige ${renderedConnections.length.toLocaleString('de-DE')} von ${allConnections.length.toLocaleString('de-DE')} Verbindungen. Für eine vollständige Ansicht bitte weiter filtern.`;
    }
    state.activeSvg = renderTimeline(el.timelineContainer, {
      connections: renderedConnections,
      deviceIndex: state.deviceIndex,
      onHover: (event, connection) => showConnectionTooltip(event, connection),
      onLeave: hideTooltip,
      onClick: (event, connection) => pinConnection(connection),
    });
    state.graphSimulation = null;
  }
}

// --- Detail content (shared by hover tooltips and pinned cards) ------------------

/**
 * `pair.a`/`pair.b` are set from whichever device sent the very first packet
 * of that pair (see parser.worker.js), so they already encode who initiated
 * the communication - shown here as Source IP -> Destination IP regardless of
 * the row/column order a caller (e.g. the matrix) happened to hover over.
 */
function pairDetailsHtml(pair, fallbackDeviceA, fallbackDeviceB) {
  if (!pair) {
    return `<div><strong>${deviceLabel(fallbackDeviceA)}</strong> → <strong>${deviceLabel(fallbackDeviceB)}</strong></div><div>Keine Kommunikation</div>`;
  }
  const sourceDevice = state.deviceIndex.get(pair.a) || fallbackDeviceA;
  const destDevice = state.deviceIndex.get(pair.b) || fallbackDeviceB;
  const value = metricValue(pair, state.metric);
  const sourcePorts = pair.portsA.length ? pair.portsA.slice(0, 12).join(', ') : '–';
  const destPorts = pair.portsB.length ? pair.portsB.slice(0, 12).join(', ') : '–';
  return `<div><strong>${deviceLabel(sourceDevice)}</strong> → <strong>${deviceLabel(destDevice)}</strong></div>
    <div>Protokolle: ${pair.protocols.join(', ') || '–'}</div>
    <div>Source Port: ${sourcePorts}</div>
    <div>Destination Port: ${destPorts}</div>
    <div>Pakete: ${pair.packets.toLocaleString('de-DE')} · Bytes: ${formatBytes(pair.bytes)}</div>
    <div>Zeitraum: ${formatTimestamp(pair.firstSeen)} – ${formatTimestamp(pair.lastSeen)}</div>
    <div>Metrik (${state.metric}): ${value.toLocaleString('de-DE')}</div>`;
}

/**
 * Unlike pairDetailsHtml() (used by the Graph, which draws a single edge per
 * pair), the Matrix draws TWO mirrored cells per pair - one per direction -
 * so this always shows rowDevice -> colDevice using the matching directional
 * sub-aggregate (pair.aToB/pair.bToA, see parser.worker.js), never the
 * combined totals, plus which of the two directions actually opened the
 * communication (relevant e.g. for stateless firewall/ACL rules, where only
 * the initiating direction needs an explicit allow entry).
 */
function matrixCellDetailsHtml(pair, rowDevice, colDevice) {
  if (!pair) {
    return `<div><strong>${deviceLabel(rowDevice)}</strong> → <strong>${deviceLabel(colDevice)}</strong></div><div>Keine Kommunikation</div>`;
  }
  const isInitiatorDirection = rowDevice.id === pair.a;
  const directional = isInitiatorDirection ? pair.aToB : pair.bToA;
  const directionLabel = isInitiatorDirection ? 'Verbindungsaufbau' : 'Antwort';
  const value = metricValue(directional, state.metric);
  const sourcePorts = directional.srcPorts.length ? directional.srcPorts.slice(0, 12).join(', ') : '–';
  const destPorts = directional.dstPorts.length ? directional.dstPorts.slice(0, 12).join(', ') : '–';
  const zeitraum = directional.firstSeen != null
    ? `${formatTimestamp(directional.firstSeen)} – ${formatTimestamp(directional.lastSeen)}`
    : '–';
  return `<div><strong>${deviceLabel(rowDevice)}</strong> → <strong>${deviceLabel(colDevice)}</strong> · ${directionLabel}</div>
    <div>Protokolle: ${pair.protocols.join(', ') || '–'}</div>
    <div>Source Port: ${sourcePorts}</div>
    <div>Destination Port: ${destPorts}</div>
    <div>Pakete: ${directional.packets.toLocaleString('de-DE')} · Bytes: ${formatBytes(directional.bytes)}</div>
    <div>Zeitraum: ${zeitraum}</div>
    <div>Metrik (${state.metric}): ${value.toLocaleString('de-DE')}</div>`;
}

function deviceDetailsHtml(device) {
  return `<div><strong>${deviceLabel(device)}</strong></div>
    <div>MAC: ${device.mac || '–'}</div>
    <div>Pakete: ${device.packetCount.toLocaleString('de-DE')} · Bytes: ${formatBytes(device.byteCount)}</div>`;
}

/**
 * Unlike a pair, a single connection represents one direction-stable flow
 * (grouped by service port, see servicePortOf() in parser.worker.js), so a
 * literal source/destination port pair - taken from the packet that first
 * opened this connection entry - is meaningful here.
 */
function connectionDetailsHtml(connection) {
  const deviceA = state.deviceIndex.get(connection.a);
  const deviceB = state.deviceIndex.get(connection.b);
  const ports = connection.srcPort != null
    ? `<div>Source Port: ${connection.srcPort} · Destination Port: ${connection.dstPort}</div>`
    : '';
  return `<div><strong>${deviceLabel(deviceA)}</strong> → <strong>${deviceLabel(deviceB)}</strong></div>
    <div>Protokoll: ${connection.protocol || '–'}</div>
    ${ports}
    <div>Pakete: ${connection.packets.toLocaleString('de-DE')} · Bytes: ${formatBytes(connection.bytes)}</div>
    <div>Zeitraum: ${formatTimestamp(connection.firstSeen)} – ${formatTimestamp(connection.lastSeen)}</div>`;
}

// --- Tooltip ---------------------------------------------------------------------

function showPairTooltip(event, pair, deviceA, deviceB) {
  showTooltip(event, pairDetailsHtml(pair, deviceA, deviceB));
}

function showMatrixCellTooltip(event, pair, rowDevice, colDevice) {
  showTooltip(event, matrixCellDetailsHtml(pair, rowDevice, colDevice));
}

function showDeviceTooltip(event, device) {
  showTooltip(event, deviceDetailsHtml(device));
}

function showConnectionTooltip(event, connection) {
  showTooltip(event, connectionDetailsHtml(connection));
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

// --- Pinned selection --------------------------------------------------------------
//
// Clicking a cell/edge/arrow/bar pins its details as a persistent card in the
// right-hand panel, so comparing e.g. several connections from one client to
// multiple servers doesn't require re-hovering each one. Cards stay until
// explicitly closed via their "×" button or "Alle entfernen".

/**
 * Ordered (not pairKey-sorted) on purpose: the Connections view now pins
 * initiator and reply arrows of the same underlying connection separately
 * (they're direction-shaped views with swapped a/b, see connections-view.js),
 * and a pairKey-sorted ID would collide between the two, making the second
 * pin a no-op.
 */
function connectionId(connection) {
  return `connection:${connection.a}->${connection.b}|${connection.protocol}|${connection.port}`;
}

function pinItem(item) {
  if (state.pinnedItems.some((existing) => existing.id === item.id)) return;
  state.pinnedItems.push(item);
  renderPinnedPanel();
}

/**
 * `directional` distinguishes a Matrix-originated pin (one specific mirrored
 * cell, e.g. rowDevice -> colDevice) from a Graph-originated one (the pair's
 * combined, direction-agnostic totals) - they need different IDs so pinning
 * BOTH of a pair's matrix cells creates two separate cards instead of the
 * second click being a no-op, and different rendering (matrixCellDetailsHtml
 * vs. pairDetailsHtml, see renderPinnedPanel()).
 */
function pinPair(pair, deviceA, deviceB, directional = false) {
  const id = directional ? `pair-dir:${deviceA.id}->${deviceB.id}` : `pair:${pairKey(pair.a, pair.b)}`;
  pinItem({ id, type: 'pair', data: pair, deviceA, deviceB, directional });
}

function pinConnection(connection) {
  pinItem({ id: connectionId(connection), type: 'connection', data: connection });
}

function pinDevice(device) {
  pinItem({ id: `device:${device.id}`, type: 'device', data: device });
}

function unpinItem(id) {
  state.pinnedItems = state.pinnedItems.filter((item) => item.id !== id);
  renderPinnedPanel();
}

const PINNED_TYPE_LABEL = { pair: 'Paar', connection: 'Verbindung', device: 'Gerät' };

function renderPinnedPanel() {
  el.pinnedPanel.hidden = state.pinnedItems.length === 0;
  el.pinnedCount.textContent = state.pinnedItems.length.toLocaleString('de-DE');
  el.exportPinnedXlsx.disabled = state.pinnedItems.length === 0;

  el.pinnedList.innerHTML = '';
  for (const item of state.pinnedItems) {
    const card = document.createElement('div');
    card.className = 'pinned-card';

    const header = document.createElement('div');
    header.className = 'pinned-card__header';
    const type = document.createElement('span');
    type.className = 'pinned-card__type';
    type.textContent = PINNED_TYPE_LABEL[item.type];
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'pinned-card__close';
    closeBtn.setAttribute('aria-label', 'Kachel schließen');
    closeBtn.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true" style="font-size:16px">close</span>';
    closeBtn.addEventListener('click', () => unpinItem(item.id));
    header.append(type, closeBtn);

    const body = document.createElement('div');
    body.className = 'pinned-card__body';
    if (item.type === 'pair') {
      body.innerHTML = item.directional
        ? matrixCellDetailsHtml(item.data, item.deviceA, item.deviceB)
        : pairDetailsHtml(item.data, item.deviceA, item.deviceB);
    } else if (item.type === 'connection') body.innerHTML = connectionDetailsHtml(item.data);
    else body.innerHTML = deviceDetailsHtml(item.data);

    card.append(header, body);
    el.pinnedList.appendChild(card);
  }
}

el.btnClearPinned.addEventListener('click', () => {
  state.pinnedItems = [];
  renderPinnedPanel();
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
  const { devices: selectedDevices, pairs: visiblePairs } = getVisibleDevicesAndPairs();
  exportToExcel({ devices: selectedDevices, pairs: visiblePairs, metric: state.metric, filenameBase: `packetatlas-kommunikationsmatrix-${state.addressFamily}` });
});
el.exportPinnedXlsx.addEventListener('click', () => {
  el.exportMenu.hidden = true;
  if (state.pinnedItems.length === 0) return;
  exportSelectionToExcel({ items: state.pinnedItems, deviceIndex: state.deviceIndex, filenameBase: 'packetatlas-angeheftete-auswahl' });
});
