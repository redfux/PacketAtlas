// UI controller: file import, worker wiring, filter panel, tabs, tooltips, export menu.
// thought up by human, created by ai

import {
  PROTOCOL_GROUPS,
  addressFamilyOf,
  compareDevicesByAddress,
  computeDeviceTraffic,
  computePortEntries,
  computeVisibleConnections,
  derivePairs,
  deviceLabel,
  escapeHtml,
  formatBytes,
  formatSeconds,
  healthOf,
  formatTimestamp,
  healthBadge,
  metricValue,
  pairKey,
  portListLabel,
  relatedDeviceIds,
} from './data-model.js?v=2.1.5';
import {
  collectFacetOptions,
  createFacetState,
  facetEntries,
  facetPredicate,
  facetsWithout,
  facetsWithoutValue,
  hasFacets,
  isFacetActive,
  toggleFacet,
} from './filters.js?v=2.1.5';
import { renderMatrix } from './matrix-view.js?v=2.1.5';
import { renderGraph, updateForces } from './graph-view.js?v=2.1.5';
import { renderConnections } from './connections-view.js?v=2.1.5';
import { renderConnectionsTable } from './connections-table-view.js?v=2.1.5';
import { renderTimeline } from './timeline-view.js?v=2.1.5';
import { renderStats } from './stats-view.js?v=2.1.5';
import { exportActiveViewAsImage } from './export-image.js?v=2.1.5';
import { exportToExcel, exportSelectionToExcel } from './export-excel.js?v=2.1.5';

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
const APP_VERSION = '2.1.5';

const state = {
  devices: [],
  pairs: [],
  connections: [],
  stats: null,
  deviceIndex: new Map(),
  selectedIds: new Set(),
  search: '',
  activeGroups: new Set(Object.keys(PROTOCOL_GROUPS)),
  hideMulticast: false,
  facets: createFacetState(), // extra filters from the chip bar, see filters.js
  facetOptions: [], // what the capture offers per facet dimension (for the "+ Filter" menu)
  // Statistics for the current filters come from the worker (it keeps the capture): the answers
  // are cached per set of visible connections, requests are numbered so stale ones can be told apart.
  scopeAvailable: false,
  scopeCache: new Map(), // scope signature -> stats
  scopeRequests: new Map(), // request id -> scope signature
  scopeRequestCounter: 0,
  latestScopeSignature: null,
  connectionsView: 'diagram', // 'diagram' | 'table'
  connectionSort: { key: 'status', dir: 'desc' },
  expandedConnectionIds: new Set(),
  sidebarTab: 'devices', // 'devices' | 'ports'
  activeTab: 'matrix',
  metric: 'packets',
  addressFamily: 'ipv4',
  forceCharge: 300,
  forceDistance: 120,
  graphSimulation: null,
  activeSvg: null,
  pinnedItems: [], // { id, type: 'pair'|'connection'|'device', data, deviceA, deviceB }
  // The main thread never keeps the capture bytes: the parse worker holds them (scopeAvailable)
  // and serves statistics and PCAP export from there. Only for captures too large for that does
  // the export fall back to a re-upload: originalFileHash lets it verify the re-uploaded file is
  // byte-identical before trusting it; originalFileBuffer caches that file once verified, so
  // re-exporting later in the same session doesn't need another re-upload. Reset on a new import.
  exportRequestCounter: 0,
  activeExportId: null,
  originalFileHash: null,
  originalFileName: null,
  originalFileBuffer: null,
};

const el = {
  fileInput: document.getElementById('file-input'),
  btnOpenFile: document.getElementById('btn-open-file'),
  dropZone: document.getElementById('drop-zone'),
  startScreen: document.getElementById('start-screen'),
  appClaim: document.getElementById('app-claim'),
  workspace: document.getElementById('workspace'),
  progressBanner: document.getElementById('progress-banner'),
  progressLabel: document.getElementById('progress-label'),
  progressFill: document.getElementById('progress-bar-fill'),
  errorBanner: document.getElementById('error-banner'),
  errorMessage: document.getElementById('error-message'),
  btnDismissError: document.getElementById('btn-dismiss-error'),
  deviceSearch: document.getElementById('device-search'),
  deviceSearchClear: document.getElementById('device-search-clear'),
  deviceList: document.getElementById('device-list'),
  deviceCount: document.getElementById('device-count'),
  deviceListSection: document.getElementById('device-list-section'),
  selectAll: document.getElementById('select-all'),
  selectionCount: document.getElementById('selection-count'),
  filterCount: document.getElementById('filter-count'),
  protocolFilters: document.getElementById('protocol-filters'),
  toggleHideBroadcast: document.getElementById('toggle-hide-broadcast'),
  toggleOnlyProblems: document.getElementById('toggle-only-problems'),
  facetChips: document.getElementById('facet-chips'),
  facetNone: document.getElementById('facet-none'),
  facetMenu: document.getElementById('facet-menu'),
  btnAddFilter: document.getElementById('btn-add-filter'),
  btnResetFilters: document.getElementById('btn-reset-filters'),
  subtabDevices: document.getElementById('subtab-devices'),
  subtabPorts: document.getElementById('subtab-ports'),
  portListSection: document.getElementById('port-list-section'),
  portList: document.getElementById('port-list'),
  portCount: document.getElementById('port-count'),
  tabMatrix: document.getElementById('tab-matrix'),
  tabGraph: document.getElementById('tab-graph'),
  tabConnections: document.getElementById('tab-connections'),
  tabTimeline: document.getElementById('tab-timeline'),
  tabStats: document.getElementById('tab-stats'),
  viewMatrix: document.getElementById('view-matrix'),
  viewGraph: document.getElementById('view-graph'),
  viewConnections: document.getElementById('view-connections'),
  viewTimeline: document.getElementById('view-timeline'),
  viewStats: document.getElementById('view-stats'),
  matrixContainer: document.getElementById('matrix-container'),
  graphContainer: document.getElementById('graph-container'),
  connectionsContainer: document.getElementById('connections-container'),
  connectionsTable: document.getElementById('connections-table'),
  connectionsViewDiagram: document.getElementById('connections-view-diagram'),
  connectionsViewTable: document.getElementById('connections-view-table'),
  timelineContainer: document.getElementById('timeline-container'),
  statsContainer: document.getElementById('stats-container'),
  graphControls: document.getElementById('graph-controls'),
  forceCharge: document.getElementById('force-charge'),
  forceDistance: document.getElementById('force-distance'),
  metricGroup: document.getElementById('metric-group'),
  metricPackets: document.getElementById('metric-packets'),
  metricBytes: document.getElementById('metric-bytes'),
  metricProblems: document.getElementById('metric-problems'),
  matrixProblemsNote: document.getElementById('matrix-problems-note'),
  graphProblemsNote: document.getElementById('graph-problems-note'),
  connectionsTruncatedWarning: document.getElementById('connections-truncated-warning'),
  connectionsTruncatedMessage: document.getElementById('connections-truncated-message'),
  timelineTruncatedWarning: document.getElementById('timeline-truncated-warning'),
  timelineTruncatedMessage: document.getElementById('timeline-truncated-message'),
  addressFamilyGroup: document.getElementById('address-family-group'),
  familyIpv4: document.getElementById('family-ipv4'),
  familyIpv6: document.getElementById('family-ipv6'),
  familyMac: document.getElementById('family-mac'),
  largeSelectionWarning: document.getElementById('large-selection-warning'),
  btnExport: document.getElementById('btn-export'),
  exportMenu: document.getElementById('export-menu'),
  exportPng: document.getElementById('export-png'),
  exportSvg: document.getElementById('export-svg'),
  exportXlsx: document.getElementById('export-xlsx'),
  exportPcap: document.getElementById('export-pcap'),
  exportPinnedXlsx: document.getElementById('export-pinned-xlsx'),
  tooltip: document.getElementById('tooltip'),
  pinnedPanel: document.getElementById('pinned-panel'),
  pinnedList: document.getElementById('pinned-list'),
  pinnedCount: document.getElementById('pinned-count'),
  btnClearPinned: document.getElementById('btn-clear-pinned'),
  pcapExportOverlay: document.getElementById('pcap-export-overlay'),
  pcapExportIntro: document.getElementById('pcap-export-intro'),
  pcapPayloadFull: document.getElementById('pcap-payload-full'),
  pcapPayloadHeaders: document.getElementById('pcap-payload-headers'),
  pcapExportError: document.getElementById('pcap-export-error'),
  pcapExportErrorMessage: document.getElementById('pcap-export-error-message'),
  pcapUploadSection: document.getElementById('pcap-upload-section'),
  pcapDropZone: document.getElementById('pcap-drop-zone'),
  pcapFileInput: document.getElementById('pcap-file-input'),
  pcapCachedSection: document.getElementById('pcap-cached-section'),
  pcapExportProgress: document.getElementById('pcap-export-progress'),
  pcapStepHash: document.getElementById('pcap-step-hash'),
  pcapStepHashLabel: document.getElementById('pcap-step-hash-label'),
  pcapStepHashFill: document.getElementById('pcap-step-hash-fill'),
  pcapStepHashCheck: document.getElementById('pcap-step-hash-check'),
  pcapStepBuild: document.getElementById('pcap-step-build'),
  pcapStepBuildLabel: document.getElementById('pcap-step-build-label'),
  pcapStepBuildFill: document.getElementById('pcap-step-build-fill'),
  pcapStepBuildCheck: document.getElementById('pcap-step-build-check'),
  pcapExportSuccess: document.getElementById('pcap-export-success'),
  pcapExportSuccessNote: document.getElementById('pcap-export-success-note'),
  pcapExportCancel: document.getElementById('pcap-export-cancel'),
  pcapExportConfirm: document.getElementById('pcap-export-confirm'),
  pcapExportClose: document.getElementById('pcap-export-close'),
  appVersion: document.getElementById('app-version'),
};

// Single source of truth for the version shown in the footer and passed as
// the cache-busting ?v= query string on both Worker() URLs below - the
// workers in turn derive their OWN internal importScripts() version from
// that same query string (see parser.worker.js/pcap-export.worker.js), so
// bumping a release only ever means editing APP_VERSION here.
el.appVersion.textContent = `v${APP_VERSION}`;

let worker = null;

/** Hex-encoded SHA-256, used only to verify a later PCAP-export re-upload is byte-identical to the original import - not a security boundary, just avoiding the user picking the wrong file. */
async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function startParsing(file) {
  showProgress(0, 'Datei wird gelesen …');
  el.errorBanner.hidden = true;
  // A new import invalidates any buffer cached from a previous PCAP export
  // re-upload in this session - it belonged to the previous capture file.
  state.originalFileBuffer = null;

  const reader = new FileReader();
  reader.onerror = () => showError('Die Datei konnte nicht gelesen werden.');
  reader.onload = async () => {
    state.originalFileName = file.name;
    state.originalFileHash = await sha256Hex(reader.result);

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
  } else if (msg.type === 'scopedStats') {
    onScopedStats(msg);
  } else if (msg.type === 'scopeError') {
    onScopeError(msg);
  } else if (msg.type === 'exportProgress' || msg.type === 'exportResult' || msg.type === 'exportError') {
    onExportMessage(msg);
  }
}

function onParseComplete(msg) {
  el.progressBanner.hidden = true;
  if (msg.devices.length === 0) {
    showError('Es konnten keine Geräte erkannt werden. Enthält die Datei unterstützte Pakete (Ethernet/SLL, IPv4/IPv6/ARP)?');
    return;
  }

  state.devices = msg.devices;
  state.connections = msg.connections;
  // Pairs are not delivered by the worker: they are always derived from connections (see derivePairs()).
  state.pairs = derivePairs(state.connections);
  state.facets = createFacetState();
  state.facetOptions = collectFacetOptions(state.connections);
  state.stats = msg.stats;
  state.scopeAvailable = Boolean(msg.scopeAvailable);
  state.activeExportId = null;
  state.scopeCache.clear();
  state.scopeRequests.clear();
  state.latestScopeSignature = null;
  state.expandedConnectionIds = new Set();
  state.deviceIndex = new Map(state.devices.map((d) => [d.id, d]));
  state.selectedIds = new Set(state.devices.map((d) => d.id));
  state.search = '';
  el.deviceSearch.value = '';
  el.deviceSearchClear.hidden = true;
  state.pinnedItems = [];
  renderPinnedPanel();

  el.startScreen.hidden = true;
  el.workspace.hidden = false;
  el.btnExport.disabled = false;
  el.appClaim.textContent = `${state.originalFileName} · ${state.stats.totalPackets.toLocaleString('de-DE')} Pakete`;
  el.appClaim.title = el.appClaim.textContent;

  setupAddressFamilyToggle();
  setSidebarTab('devices');
  buildFacetMenu();
  renderFacetBar();
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
  el.progressFill.style.setProperty('--w', `${percent}%`);
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

el.dropZone.addEventListener('click', () => el.fileInput.click());
el.dropZone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    el.fileInput.click();
  }
});
['dragenter', 'dragover'].forEach((evt) => {
  el.dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    el.dropZone.classList.add('over');
  });
});
['dragleave', 'drop'].forEach((evt) => {
  el.dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    el.dropZone.classList.remove('over');
  });
});
el.dropZone.addEventListener('drop', (e) => {
  const file = e.dataTransfer.files[0];
  if (file) startParsing(file);
});

// --- Device list / filtering -------------------------------------------------

function createDeviceListItem(device, isSelected) {
  const text = deviceLabel(device);
  const li = document.createElement('li');
  if (isSelected) li.className = 'is-selected';

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
  labelSpan.textContent = text;
  labelSpan.title = text;

  const meta = document.createElement('span');
  meta.className = 'n';
  meta.textContent = device.packetCount.toLocaleString('de-DE');

  // The whole row text is the checkbox label, so it can be clicked too.
  const label = document.createElement('label');
  label.className = 'check';
  label.append(checkbox, labelSpan);
  li.append(label, meta);
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
    divider.className = 'pa-divider';
    divider.setAttribute('aria-hidden', 'true');
    el.deviceList.appendChild(divider);
  }
  for (const device of rest) el.deviceList.appendChild(createDeviceListItem(device, false));

  el.deviceCount.textContent = filtered.length.toLocaleString('de-DE');
  updateSelectAll();
}

/** "Alle" checkbox above the lists: checked, unchecked or in between. */
function updateSelectAll() {
  const total = state.devices.length;
  const chosen = state.selectedIds.size;
  el.selectAll.checked = total > 0 && chosen === total;
  el.selectAll.indeterminate = chosen > 0 && chosen < total;
  el.selectionCount.textContent = `${chosen.toLocaleString('de-DE')} von ${total.toLocaleString('de-DE')}`;
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
  if (isSelected) li.className = 'is-selected';

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
  labelSpan.textContent = fullLabel;
  labelSpan.title = fullLabel;

  const meta = document.createElement('span');
  meta.className = 'n';
  meta.textContent = entry.packets.toLocaleString('de-DE');

  // The whole row text is the checkbox label, so it can be clicked too.
  const label = document.createElement('label');
  label.className = 'check';
  label.append(checkbox, labelSpan);
  li.append(label, meta);
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
    divider.className = 'pa-divider';
    divider.setAttribute('aria-hidden', 'true');
    el.portList.appendChild(divider);
  }
  for (const entry of rest) el.portList.appendChild(createPortListItem(entry, false));

  el.portCount.textContent = entries.length.toLocaleString('de-DE');
}

function setSidebarTab(tab) {
  state.sidebarTab = tab;
  const isPorts = tab === 'ports';
  el.subtabDevices.classList.toggle('active', !isPorts);
  el.subtabDevices.setAttribute('aria-selected', String(!isPorts));
  el.subtabPorts.classList.toggle('active', isPorts);
  el.subtabPorts.setAttribute('aria-selected', String(isPorts));
  el.deviceListSection.hidden = isPorts;
  el.portListSection.hidden = !isPorts;
  el.deviceSearch.placeholder = isPorts ? 'Port oder Dienst …' : 'IP-Teilstring …';
}

el.subtabDevices.addEventListener('click', () => setSidebarTab('devices'));
el.subtabPorts.addEventListener('click', () => setSidebarTab('ports'));

function applyDeviceSearch() {
  state.search = el.deviceSearch.value;
  el.deviceSearchClear.hidden = !el.deviceSearch.value;
  renderDeviceList();
  renderPortList();
}

// The clear button and Escape are handled by js/design-system.js (.search-field),
// which empties the field and fires an input event.
el.deviceSearch.addEventListener('input', applyDeviceSearch);

el.selectAll.addEventListener('change', () => {
  state.selectedIds = el.selectAll.checked ? new Set(state.devices.map((d) => d.id)) : new Set();
  renderDeviceList();
  renderPortList();
  renderActiveView();
});

/** Filter bar chips (protocols, multicast/broadcast) follow `state`; the "Auffällige Verbindungen" shortcut follows the facets (renderFacetBar). */
function syncFilterControls() {
  for (const chip of el.protocolFilters.querySelectorAll('.chip')) {
    chip.setAttribute('aria-pressed', String(state.activeGroups.has(chip.dataset.protocol)));
  }
  el.toggleHideBroadcast.setAttribute('aria-pressed', String(state.hideMulticast));
  el.btnResetFilters.hidden = !filtersDeviateFromDefault();
}

function toggleProtocolGroup(group) {
  if (state.activeGroups.has(group)) state.activeGroups.delete(group);
  else state.activeGroups.add(group);
  syncFilterControls();
  renderPortList();
  renderActiveView();
}

el.protocolFilters.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (chip) toggleProtocolGroup(chip.dataset.protocol);
});

el.toggleHideBroadcast.addEventListener('click', () => {
  state.hideMulticast = !state.hideMulticast;
  syncFilterControls();
  renderActiveView();
});

// Shortcut for the facet Problem: Auffällig (the same filter as in the "+ Filter" menu).
el.toggleOnlyProblems.addEventListener('click', () => toggleFacetValue('problem', 'any'));

// --- Extra filters (facets) ---------------------------------------------------
//
// Beside the protocol chips and the two switches there are "facets": criteria on
// what a connection contains (TLS version, port, DNS answer code, ...), see
// filters.js. Active ones show as removable chips in the filter bar; the "+ Filter"
// menu lists what the capture offers. Values of one dimension combine with OR,
// different dimensions with AND.

const FACET_MENU_MAX_OPTIONS = 40;

function filtersDeviateFromDefault() {
  return state.activeGroups.size !== Object.keys(PROTOCOL_GROUPS).length || state.hideMulticast || hasFacets(state.facets);
}

function renderFacetBar() {
  const entries = facetEntries(state.facets);
  el.facetChips.replaceChildren();
  for (const entry of entries) {
    const text = `${entry.dimensionLabel}: ${entry.valueLabel}`;
    const chip = document.createElement('span');
    chip.className = 'chip removable';
    chip.append(document.createTextNode(`${text} `));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.dataset.dimension = entry.dimension;
    remove.dataset.value = entry.value;
    remove.setAttribute('aria-label', `Filter „${text}“ entfernen`);
    remove.title = 'Filter entfernen';
    remove.innerHTML = '<svg class="i"><use href="#ic-close"></use></svg>';
    chip.append(remove);
    el.facetChips.append(chip);
  }
  el.facetNone.hidden = entries.length > 0;
  el.toggleOnlyProblems.setAttribute('aria-pressed', String(isFacetActive(state.facets, 'problem', 'any')));
  el.btnResetFilters.hidden = !filtersDeviateFromDefault();
  refreshFacetMenu();
}

function buildFacetMenu() {
  const menu = el.facetMenu;
  menu.replaceChildren();
  if (state.facetOptions.length === 0) {
    const none = document.createElement('div');
    none.className = 'app-menu-head';
    none.textContent = 'Dieser Capture bietet keine weiteren Filter an.';
    menu.append(none);
    return;
  }
  for (const group of state.facetOptions) {
    const head = document.createElement('div');
    head.className = 'app-menu-head';
    head.textContent = group.label;
    menu.append(head);
    for (const option of group.options.slice(0, FACET_MENU_MAX_OPTIONS)) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'app-menu-item pa-facet-item';
      item.dataset.dimension = group.dimension;
      item.dataset.value = option.value;
      const label = document.createElement('span');
      label.textContent = option.label;
      label.title = option.label;
      const count = document.createElement('span');
      count.className = 'n';
      count.textContent = option.count.toLocaleString('de-DE');
      item.append(label, count);
      menu.append(item);
    }
    if (group.options.length > FACET_MENU_MAX_OPTIONS) {
      const more = document.createElement('div');
      more.className = 'pa-facet-more';
      more.textContent = `${(group.options.length - FACET_MENU_MAX_OPTIONS).toLocaleString('de-DE')} weitere nicht angezeigt`;
      menu.append(more);
    }
  }
  const hint = document.createElement('div');
  hint.className = 'pa-facet-more';
  hint.textContent = 'Werte einer Gruppe gelten als „oder“, verschiedene Gruppen als „und“.';
  menu.append(hint);
  refreshFacetMenu();
}

/** Marks the menu entries that are currently active (also drives the ✓ in front of them). */
function refreshFacetMenu() {
  for (const item of el.facetMenu.querySelectorAll('.pa-facet-item')) {
    item.setAttribute('aria-pressed', String(isFacetActive(state.facets, item.dataset.dimension, item.dataset.value)));
  }
}

function toggleFacetValue(dimension, value) {
  toggleFacet(state.facets, dimension, value);
  renderFacetBar();
  renderActiveView();
}

function resetFilters() {
  state.activeGroups = new Set(Object.keys(PROTOCOL_GROUPS));
  state.hideMulticast = false;
  state.facets = createFacetState();
  syncFilterControls();
  renderFacetBar();
  renderPortList();
  renderActiveView();
}

el.facetChips.addEventListener('click', (e) => {
  const button = e.target.closest('button[data-dimension]');
  if (button) toggleFacetValue(button.dataset.dimension, button.dataset.value);
});
el.facetMenu.addEventListener('click', (e) => {
  const item = e.target.closest('.pa-facet-item');
  if (item) toggleFacetValue(item.dataset.dimension, item.dataset.value);
});
el.btnResetFilters.addEventListener('click', resetFilters);

// --- Clicks on the statistics ----------------------------------------------------------
//
// Rows of the statistics cards are controls (see actionAttrs() in stats-view.js): a value row
// toggles its filter facet, a Top-Talker row sets the sidebar selection - one device selects it
// together with its communication partners (like starting a fresh selection in the sidebar), a
// pair selects just those two devices.

let pendingStatsFocus = null;

function selectDevicesFromStats(a, b) {
  state.selectedIds = b ? new Set([a, b]) : new Set([a, ...relatedDeviceIds(state.pairs, a)]);
  renderDeviceList();
  renderPortList();
  renderActiveView();
}

function activateStatsRow(row, viaKeyboard) {
  if (row.dataset.facetDimension) {
    if (viaKeyboard) pendingStatsFocus = { dimension: row.dataset.facetDimension, value: row.dataset.facetValue };
    toggleFacetValue(row.dataset.facetDimension, row.dataset.facetValue);
  } else if (row.dataset.selectA) {
    if (viaKeyboard) pendingStatsFocus = { selectA: row.dataset.selectA, selectB: row.dataset.selectB || '' };
    selectDevicesFromStats(row.dataset.selectA, row.dataset.selectB || null);
  }
}

/** The statistics are redrawn after an action; a keyboard user keeps their place. */
function restoreStatsFocus() {
  const wanted = pendingStatsFocus;
  if (!wanted) return;
  pendingStatsFocus = null;
  for (const row of el.statsContainer.querySelectorAll('.stats-row.is-action')) {
    const same = wanted.dimension
      ? row.dataset.facetDimension === wanted.dimension && row.dataset.facetValue === wanted.value
      : row.dataset.selectA === wanted.selectA && (row.dataset.selectB || '') === wanted.selectB;
    if (same) {
      row.focus();
      return;
    }
  }
}

el.statsContainer.addEventListener('click', (e) => {
  const row = e.target.closest('.stats-row.is-action');
  if (row) activateStatsRow(row, false);
});
el.statsContainer.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const row = e.target.closest('.stats-row.is-action');
  if (!row) return;
  e.preventDefault();
  activateStatsRow(row, true);
});

// The menu hangs below the "+ Filter" button instead of the design system's default (top right).
el.facetMenu.addEventListener('beforetoggle', (e) => {
  if (e.newState !== 'open') return;
  const anchor = el.btnAddFilter.getBoundingClientRect();
  const width = Math.min(360, window.innerWidth - 16);
  const top = Math.round(anchor.bottom + 4);
  el.facetMenu.style.top = `${top}px`;
  // The design system's max-height assumes the menu hangs from the appbar; here it starts lower.
  el.facetMenu.style.maxHeight = `${Math.max(160, window.innerHeight - top - 8)}px`;
  el.facetMenu.style.left = `${Math.round(Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8)))}px`;
  el.facetMenu.style.right = 'auto';
});

// --- Tabs / metric ------------------------------------------------------------

const TABS = {
  matrix: { tabButton: () => el.tabMatrix, view: () => el.viewMatrix },
  graph: { tabButton: () => el.tabGraph, view: () => el.viewGraph },
  connections: { tabButton: () => el.tabConnections, view: () => el.viewConnections },
  timeline: { tabButton: () => el.tabTimeline, view: () => el.viewTimeline },
  stats: { tabButton: () => el.tabStats, view: () => el.viewStats },
};
const TABS_WITHOUT_METRIC = new Set(['connections', 'timeline']);
// The statistics cover the whole capture, so the device-address-family toggle has no meaning there.
const TABS_WITHOUT_ADDRESS_FAMILY = new Set(['stats']);

function setActiveTab(tab) {
  state.activeTab = tab;
  for (const [key, { tabButton, view }] of Object.entries(TABS)) {
    const isActive = key === tab;
    tabButton().classList.toggle('active', isActive);
    tabButton().setAttribute('aria-selected', String(isActive));
    view().hidden = !isActive;
  }
  el.graphControls.hidden = tab !== 'graph';
  el.metricGroup.hidden = TABS_WITHOUT_METRIC.has(tab);
  el.addressFamilyGroup.hidden = TABS_WITHOUT_ADDRESS_FAMILY.has(tab);
  // The statistics tab only knows packets/bytes (it always shows every problem type separately anyway).
  el.metricProblems.hidden = tab === 'stats';
  if (tab === 'stats' && state.metric === 'problems') setMetric('packets');
  updateImageExportAvailability();
  renderActiveView();
}

// The statistics tab and the connections table are HTML, not SVG, so there is nothing to export as an image there.
function updateImageExportAvailability() {
  const noSvg = state.activeTab === 'stats' || (state.activeTab === 'connections' && state.connectionsView === 'table');
  el.exportPng.disabled = noSvg;
  el.exportSvg.disabled = noSvg;
}

function setConnectionsView(mode) {
  state.connectionsView = mode;
  el.connectionsViewDiagram.setAttribute('aria-pressed', String(mode === 'diagram'));
  el.connectionsViewTable.setAttribute('aria-pressed', String(mode === 'table'));
  updateImageExportAvailability();
  renderActiveView();
}

el.connectionsViewDiagram.addEventListener('click', () => setConnectionsView('diagram'));
el.connectionsViewTable.addEventListener('click', () => setConnectionsView('table'));

el.tabMatrix.addEventListener('click', () => setActiveTab('matrix'));
el.tabGraph.addEventListener('click', () => setActiveTab('graph'));
el.tabConnections.addEventListener('click', () => setActiveTab('connections'));
el.tabTimeline.addEventListener('click', () => setActiveTab('timeline'));
el.tabStats.addEventListener('click', () => setActiveTab('stats'));

function setMetric(metric) {
  state.metric = metric;
  el.metricPackets.setAttribute('aria-pressed', String(metric === 'packets'));
  el.metricBytes.setAttribute('aria-pressed', String(metric === 'bytes'));
  el.metricProblems.setAttribute('aria-pressed', String(metric === 'problems'));
  el.matrixProblemsNote.hidden = metric !== 'problems';
  el.graphProblemsNote.hidden = metric !== 'problems';
  renderActiveView();
}

el.metricPackets.addEventListener('click', () => setMetric('packets'));
el.metricBytes.addEventListener('click', () => setMetric('bytes'));
el.metricProblems.addEventListener('click', () => setMetric('problems'));

function setAddressFamily(family) {
  state.addressFamily = family;
  const buttons = { ipv4: el.familyIpv4, ipv6: el.familyIpv6, mac: el.familyMac };
  for (const [key, button] of Object.entries(buttons)) {
    button.setAttribute('aria-pressed', String(key === family));
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
 * Devices, connections and pairs for the current selection, protocol chips,
 * extra filters and address-family toggle, devices sorted ascending by address.
 * The pairs of matrix, graph and Excel export are derived from exactly the
 * visible connections, so all views and the export show the same numbers.
 */
function getVisibleDevicesAndPairs() {
  const familyDevices = state.devices.filter((d) => state.selectedIds.has(d.id) && addressFamilyOf(d) === state.addressFamily);
  const familyIds = new Set(familyDevices.map((d) => d.id));
  const devices = [...familyDevices].sort(compareDevicesByAddress);
  const connections = computeVisibleConnections(state.connections, familyIds, state.activeGroups, state.hideMulticast, facetPredicate(state.facets));
  return { devices, pairs: derivePairs(connections), familyIds };
}

/**
 * Per-connection (device pair + protocol + port) breakdown, filtered like
 * getVisibleDevicesAndPairs(). `order` picks the sort appropriate for each
 * view: 'packets' (connections view, heaviest first) or 'timeline' (earliest
 * start time first, so the Gantt chart reads top-to-bottom by when each
 * connection began).
 */
function getVisibleConnections(familyIds, order, facets = state.facets) {
  const filtered = computeVisibleConnections(state.connections, familyIds, state.activeGroups, state.hideMulticast, facetPredicate(facets));
  if (order === 'timeline') {
    return filtered.sort((a, b) => a.firstSeen - b.firstSeen);
  }
  return filtered.sort((a, b) => b.packets - a.packets);
}

// --- Statistics for the current filters ----------------------------------------------------
//
// The statistics tab shows the connections that pass the selection and all filters (the address-
// family toggle does not apply: the statistics are not split by family). Without any restriction
// that is the whole capture and the numbers from the first pass are used. Otherwise the worker -
// which keeps the capture - recomputes them for exactly those connections; answers are cached per
// set of connections, and the previous numbers stay visible (dimmed) while a new request runs.

const SCOPE_CACHE_LIMIT = 8;
const SCOPE_LOADING_DELAY_MS = 150;

/** The connections that pass the selection and all filters - the scope of the statistics and of the PCAP export. */
function getScopeConnections(facets = state.facets) {
  return computeVisibleConnections(state.connections, state.selectedIds, state.activeGroups, state.hideMulticast, facetPredicate(facets));
}

// Dimensions whose statistics card lists the values of that dimension. While such a filter is
// active the card shows the numbers without it (computed in the same worker pass), so the other
// values stay visible and can be added to the filter.
const STATS_FACET_DIMENSIONS = new Set(['port', 'problem', 'tlsVersion', 'tlsCipher', 'icmp', 'dnsRcode', 'dnsProvider', 'relay', 'apple']);

/** For each active dimension with a card: the connections that pass everything except that dimension's filter (only when that differs from `connections`). */
function getExtraScopes(connections) {
  const extraScopes = {};
  for (const dimension of state.facets.keys()) {
    if (!STATS_FACET_DIMENSIONS.has(dimension)) continue;
    const widened = getScopeConnections(facetsWithout(state.facets, dimension));
    if (widened.length !== connections.length) extraScopes[dimension] = widened;
  }
  return extraScopes;
}

/** Cheap fingerprint of an ordered list of connections (count + FNV-1a over the keys). */
function scopeSignature(connections) {
  let hash = 0x811c9dc5;
  for (const connection of connections) {
    const key = connection.key;
    for (let i = 0; i < key.length; i++) {
      hash ^= key.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    hash ^= 124;
    hash = Math.imul(hash, 0x01000193);
  }
  return `${connections.length}:${(hash >>> 0).toString(16)}`;
}

function showStats(stats, scope, pairs, extras = {}) {
  el.statsContainer.classList.remove('is-loading');
  el.statsContainer.removeAttribute('aria-busy');
  renderStats(el.statsContainer, {
    stats,
    globalStats: state.stats,
    scope,
    metric: state.metric,
    talkers: { devices: computeDeviceTraffic(pairs), pairs },
    deviceIndex: state.deviceIndex,
    facets: state.facets,
    extras,
  });
  restoreStatsFocus();
}

function renderStatsTab() {
  const connections = getScopeConnections();
  const total = state.connections.length;
  el.filterCount.textContent = `${connections.length.toLocaleString('de-DE')} von ${total.toLocaleString('de-DE')} Verbindungen`;
  const scope = { filtered: connections.length !== total, shown: connections.length, total, unavailable: false };

  if (!scope.filtered) {
    showStats(state.stats, scope, state.pairs);
    return;
  }
  if (!state.scopeAvailable) {
    // Too large to keep in memory: fall back to the whole capture and say so.
    showStats(state.stats, { ...scope, filtered: false, unavailable: true }, state.pairs);
    return;
  }

  const extraScopes = getExtraScopes(connections);
  const signature = [scopeSignature(connections), ...Object.entries(extraScopes).map(([dimension, list]) => `${dimension}=${scopeSignature(list)}`)].join('+');
  state.latestScopeSignature = signature;
  const cached = state.scopeCache.get(signature);
  if (cached) {
    showStats(cached.stats, scope, derivePairs(connections), cached.extras);
    return;
  }

  const requestId = ++state.scopeRequestCounter;
  state.scopeRequests.set(requestId, signature);
  const extraKeys = {};
  for (const [dimension, list] of Object.entries(extraScopes)) extraKeys[dimension] = list.map((c) => c.key);
  worker.postMessage({ type: 'scope', requestId, keys: connections.map((c) => c.key), extras: extraKeys });
  el.statsContainer.setAttribute('aria-busy', 'true');
  if (el.statsContainer.childElementCount === 0) {
    el.statsContainer.innerHTML = '<div class="busy"><div class="spinner"></div> Statistik wird berechnet …</div>';
  } else {
    setTimeout(() => {
      if (state.latestScopeSignature === signature && !state.scopeCache.has(signature)) el.statsContainer.classList.add('is-loading');
    }, SCOPE_LOADING_DELAY_MS);
  }
}

function onScopedStats(msg) {
  const signature = state.scopeRequests.get(msg.requestId);
  state.scopeRequests.delete(msg.requestId);
  if (!signature) return;
  state.scopeCache.set(signature, { stats: msg.stats, extras: msg.extras || {} });
  while (state.scopeCache.size > SCOPE_CACHE_LIMIT) state.scopeCache.delete(state.scopeCache.keys().next().value);
  if (state.activeTab === 'stats' && signature === state.latestScopeSignature) renderActiveView();
}

function onScopeError(msg) {
  state.scopeRequests.delete(msg.requestId);
  el.statsContainer.classList.remove('is-loading');
  el.statsContainer.removeAttribute('aria-busy');
  const box = document.createElement('div');
  box.className = 'status err';
  box.setAttribute('role', 'alert');
  box.textContent = `Die Statistik für die gefilterte Auswahl konnte nicht berechnet werden: ${msg.message}`;
  el.statsContainer.replaceChildren(box);
}

function renderActiveView() {
  if (state.devices.length === 0) return;

  el.connectionsTruncatedWarning.hidden = true;
  el.timelineTruncatedWarning.hidden = true;
  if (state.activeTab === 'stats') {
    el.largeSelectionWarning.hidden = true;
    renderStatsTab();
    state.activeSvg = null;
    state.graphSimulation = null;
    return;
  }

  const { devices: selectedDevices, pairs: visiblePairs, familyIds } = getVisibleDevicesAndPairs();

  el.largeSelectionWarning.hidden = selectedDevices.length <= LARGE_SELECTION_THRESHOLD;
  const visibleCount = getVisibleConnections(familyIds, 'packets').length;
  el.filterCount.textContent = `${visibleCount.toLocaleString('de-DE')} von ${state.connections.length.toLocaleString('de-DE')} Verbindungen`;

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
  } else if (state.activeTab === 'connections' && state.connectionsView === 'table') {
    el.connectionsContainer.hidden = true;
    el.connectionsTable.hidden = false;
    const shown = getVisibleConnections(familyIds, 'packets');
    renderConnectionsTable(el.connectionsTable, {
      connections: shown,
      totalCount: isFacetActive(state.facets, 'problem', 'any') ? getVisibleConnections(familyIds, 'packets', facetsWithoutValue(state.facets, 'problem', 'any')).length : shown.length,
      deviceIndex: state.deviceIndex,
      idOf: connectionId,
      expandedIds: state.expandedConnectionIds,
      sort: state.connectionSort,
      handlers: {
        onSort: (key) => {
          const same = state.connectionSort.key === key;
          state.connectionSort = { key, dir: same ? (state.connectionSort.dir === 'asc' ? 'desc' : 'asc') : key === 'name' || key === 'protocol' ? 'asc' : 'desc' };
          renderActiveView();
        },
        onToggleRow: (id) => {
          if (state.expandedConnectionIds.has(id)) state.expandedConnectionIds.delete(id);
          else state.expandedConnectionIds.add(id);
          renderActiveView();
        },
      },
    });
    state.activeSvg = null;
    state.graphSimulation = null;
  } else if (state.activeTab === 'connections') {
    el.connectionsContainer.hidden = false;
    el.connectionsTable.hidden = true;
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

const METRIC_LABELS = { packets: 'Pakete', bytes: 'Bytes', problems: 'Probleme' };

const percentFormat = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });

/** Marks for every problem event on a plain-SVG strip spanning the connection's lifetime (attributes only - inline styles are blocked by the CSP). */
function problemTimelineHtml(times, from, to) {
  if (!times || times.length === 0 || from == null || !(to >= from)) return '';
  const span = Math.max(to - from, 1e-6);
  const marks = times
    .map((ts) => {
      const x = (((ts - from) / span) * 200).toFixed(1);
      return `<line class="mini-timeline__mark" x1="${x}" x2="${x}" y1="2" y2="12"/>`;
    })
    .join('');
  return `<svg class="mini-timeline" viewBox="0 0 200 14" preserveAspectRatio="none" role="img" aria-label="Probleme über die Zeit"><rect class="mini-timeline__bg" x="0" y="0" width="200" height="14" rx="3"/>${marks}</svg>
    <div class="quality__axis"><span>Probleme über die Zeit</span><span>${times.length >= 200 ? 'erste 200 ' : ''}${times.length.toLocaleString('de-DE')} Ereignisse</span></div>`;
}

/**
 * Traffic-quality block for a pair or connection (anything with `problems`
 * and, for TCP, a `tcp` summary - see parser.worker.js): verdict chip,
 * retransmit/dup-ACK/gap/RST/zero-window counts, handshake time and, on
 * connection level only, how it ended plus a strip of when problems occurred.
 */
function qualityHtml(entry, { connectionLevel = false } = {}) {
  const problems = entry.problems || 0;
  if (!problems && !entry.tcp) return '';
  const health = healthOf(entry);
  const t = entry.tcp;
  let lines = '';
  if (t) {
    const rate = t.dataSegments ? ` (${percentFormat.format((t.retransmissions / t.dataSegments) * 100)} %)` : '';
    lines += `<div>Retransmits: ${t.retransmissions.toLocaleString('de-DE')}${rate} · Dup-ACKs: ${t.duplicateAcks.toLocaleString('de-DE')} · Lücken: ${t.lostSegments.toLocaleString('de-DE')}</div>
      <div>RST: ${t.resets.toLocaleString('de-DE')} · Zero-Window: ${t.zeroWindow.toLocaleString('de-DE')} · Out-of-Order: ${t.outOfOrder.toLocaleString('de-DE')}</div>`;
    if (t.handshakeCount) {
      lines += `<div>Handshake: Ø ${formatSeconds(t.handshakeSum / t.handshakeCount)} (max. ${formatSeconds(t.handshakeMax)}, ${t.handshakeCount.toLocaleString('de-DE')}×)</div>`;
    }
    if (connectionLevel) {
      const ended = t.resets ? 'RST (abgebrochen)' : t.fins ? 'FIN (regulär)' : 'nicht beendet (im Capture offen)';
      lines += `<div>Beendet durch: ${ended}</div>`;
    }
  } else {
    lines += `<div>ICMP-Fehlermeldungen: ${problems.toLocaleString('de-DE')}</div>`;
  }
  const timeline = connectionLevel && t ? problemTimelineHtml(t.problemTimes, entry.firstSeen, entry.lastSeen) : '';
  return `<div class="quality"><div>Qualität: ${healthBadge(health.level, health.label)}</div>${lines}${timeline}</div>`;
}

/**
 * `pair.a`/`pair.b` are set from whichever device sent the very first packet
 * of that pair (see parser.worker.js), so they already encode who initiated
 * the communication - shown here as Source IP -> Destination IP regardless of
 * the row/column order a caller (e.g. the matrix) happened to hover over.
 */
function pairDetailsHtml(pair, fallbackDeviceA, fallbackDeviceB) {
  if (!pair) {
    return `<div><strong>${escapeHtml(deviceLabel(fallbackDeviceA))}</strong> → <strong>${escapeHtml(deviceLabel(fallbackDeviceB))}</strong></div><div>Keine Kommunikation</div>`;
  }
  const sourceDevice = state.deviceIndex.get(pair.a) || fallbackDeviceA;
  const destDevice = state.deviceIndex.get(pair.b) || fallbackDeviceB;
  const value = metricValue(pair, state.metric);
  const sourcePorts = pair.portsA.length ? pair.portsA.slice(0, 12).join(', ') : '–';
  const destPorts = pair.portsB.length ? pair.portsB.slice(0, 12).join(', ') : '–';
  return `<div><strong>${escapeHtml(deviceLabel(sourceDevice))}</strong> → <strong>${escapeHtml(deviceLabel(destDevice))}</strong></div>
    <div>Protokolle: ${pair.protocols.join(', ') || '–'}</div>
    <div>Source Port: ${sourcePorts}</div>
    <div>Destination Port: ${destPorts}</div>
    <div>Pakete: ${pair.packets.toLocaleString('de-DE')} · Bytes: ${formatBytes(pair.bytes)}</div>
    <div>Zeitraum: ${formatTimestamp(pair.firstSeen)} – ${formatTimestamp(pair.lastSeen)}</div>
    <div>Metrik (${METRIC_LABELS[state.metric]}): ${value.toLocaleString('de-DE')}</div>
    ${qualityHtml(pair)}`;
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
    return `<div><strong>${escapeHtml(deviceLabel(rowDevice))}</strong> → <strong>${escapeHtml(deviceLabel(colDevice))}</strong></div><div>Keine Kommunikation</div>`;
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
  return `<div><strong>${escapeHtml(deviceLabel(rowDevice))}</strong> → <strong>${escapeHtml(deviceLabel(colDevice))}</strong> · ${directionLabel}</div>
    <div>Protokolle: ${pair.protocols.join(', ') || '–'}</div>
    <div>Source Port: ${sourcePorts}</div>
    <div>Destination Port: ${destPorts}</div>
    <div>Pakete: ${directional.packets.toLocaleString('de-DE')} · Bytes: ${formatBytes(directional.bytes)}</div>
    <div>Zeitraum: ${zeitraum}</div>
    <div>Metrik (${METRIC_LABELS[state.metric]}): ${value.toLocaleString('de-DE')}</div>
    ${directional.problems ? `<div>Probleme in dieser Richtung: ${directional.problems.toLocaleString('de-DE')}</div>` : ''}
    ${qualityHtml(pair)}`;
}

function deviceDetailsHtml(device) {
  return `<div><strong>${escapeHtml(deviceLabel(device))}</strong></div>
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
  return `<div><strong>${escapeHtml(deviceLabel(deviceA))}</strong> → <strong>${escapeHtml(deviceLabel(deviceB))}</strong></div>
    <div>Protokoll: ${connection.protocol || '–'}</div>
    ${ports}
    <div>Pakete: ${connection.packets.toLocaleString('de-DE')} · Bytes: ${formatBytes(connection.bytes)}</div>
    <div>Zeitraum: ${formatTimestamp(connection.firstSeen)} – ${formatTimestamp(connection.lastSeen)}</div>
    ${qualityHtml(connection.connection || connection, { connectionLevel: true })}`;
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
    const card = document.createElement('section');
    card.className = 'card pa-pinned-card';
    if (item.type !== 'device') {
      const level = healthOf(item.type === 'connection' ? item.data.connection || item.data : item.data).level;
      if (level !== 'ok') card.classList.add('accent', level === 'bad' ? 's4' : 's2');
    }

    const header = document.createElement('div');
    header.className = 'pa-pinned-card__head';
    const type = document.createElement('span');
    type.className = 'pa-pinned-card__type';
    type.textContent = PINNED_TYPE_LABEL[item.type];
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'icon';
    closeBtn.setAttribute('aria-label', 'Kachel schließen');
    closeBtn.title = 'Kachel schließen';
    closeBtn.innerHTML = '<svg class="i" aria-hidden="true"><use href="#ic-close"></use></svg>';
    closeBtn.addEventListener('click', () => unpinItem(item.id));
    header.append(type, closeBtn);

    const body = document.createElement('div');

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

// The export menu is a popover (popovertarget on #btn-export): Escape and a
// click outside close it without any script; each entry closes it as well.
function closeExportMenu() {
  el.exportMenu.hidePopover();
}

el.exportPng.addEventListener('click', () => {
  closeExportMenu();
  if (state.activeSvg) exportActiveViewAsImage(state.activeSvg, 'png', `packetatlas-${state.activeTab}`);
});
el.exportSvg.addEventListener('click', () => {
  closeExportMenu();
  if (state.activeSvg) exportActiveViewAsImage(state.activeSvg, 'svg', `packetatlas-${state.activeTab}`);
});
el.exportXlsx.addEventListener('click', () => {
  closeExportMenu();
  const { devices: selectedDevices, pairs: visiblePairs } = getVisibleDevicesAndPairs();
  exportToExcel({ devices: selectedDevices, pairs: visiblePairs, metric: state.metric, filenameBase: `packetatlas-kommunikationsmatrix-${state.addressFamily}` });
});
el.exportPinnedXlsx.addEventListener('click', () => {
  closeExportMenu();
  if (state.pinnedItems.length === 0) return;
  exportSelectionToExcel({ items: state.pinnedItems, deviceIndex: state.deviceIndex, filenameBase: 'packetatlas-angeheftete-auswahl' });
});

// --- PCAP export (filtered re-export of the capture) ------------------------------
//
// The export holds the packets of the connections that pass the selection and all filters (the
// same scope as the statistics; Layer-2 control frames belong to no connection and are left
// out). Normally the parse worker rebuilds the file from the capture it keeps. Only for
// captures too large to be kept does the export fall back to the user providing the file again:
// its SHA-256 (computed at import time) is compared against the re-uploaded file to catch the
// wrong file being picked by mistake - NOT a security boundary, just user-error prevention,
// hence a fast native hash. Once verified, the buffer is cached for the rest of the session.

let pcapExportWorker = null;

function currentPcapPayloadMode() {
  return el.pcapPayloadHeaders.checked ? 'headers-only' : 'full';
}

function resetPcapStep(labelEl, fillEl, checkEl, label) {
  labelEl.textContent = label;
  fillEl.style.setProperty('--w', '0%');
  fillEl.parentElement.classList.remove('is-done');
  checkEl.hidden = true;
}

function completePcapStep(labelEl, fillEl, checkEl, label) {
  labelEl.textContent = label;
  fillEl.style.setProperty('--w', '100%');
  fillEl.parentElement.classList.add('is-done');
  checkEl.hidden = false;
}

/** What the export would contain right now: keys of the scope connections and their size. */
function currentExportScope() {
  const connections = getScopeConnections();
  return {
    keys: connections.map((connection) => connection.key),
    connections: connections.length,
    packets: connections.reduce((sum, connection) => sum + connection.packets, 0),
  };
}

function exportScopeSummary(scope) {
  if (scope.connections === 0) return 'Die aktuelle Auswahl enthält keine Verbindungen – es gibt nichts zu exportieren.';
  const connections = scope.connections.toLocaleString('de-DE');
  return `Exportiert werden ${scope.packets.toLocaleString('de-DE')} Pakete aus ${connections} ${scope.connections === 1 ? 'Verbindung' : 'Verbindungen'} – die aktuelle Auswahl mit allen Filtern.`;
}

/** Restores the dialog's "waiting for input" state: ready to export (capture kept by the worker, or file cached) or asking for the original file. Used when opening the dialog and after an error, so the user can retry right away. */
function showPcapAwaitingInput() {
  el.pcapExportProgress.hidden = true;
  el.pcapExportSuccess.hidden = true;
  const scope = currentExportScope();
  const hasCachedBuffer = !state.scopeAvailable && state.originalFileBuffer != null;
  const ready = state.scopeAvailable || hasCachedBuffer;
  el.pcapUploadSection.hidden = ready;
  el.pcapCachedSection.hidden = !hasCachedBuffer;
  el.pcapExportConfirm.hidden = !ready;
  el.pcapExportConfirm.disabled = scope.connections === 0;
  el.pcapExportIntro.hidden = false;
  el.pcapExportIntro.textContent = ready || scope.connections === 0
    ? exportScopeSummary(scope)
    : `${exportScopeSummary(scope)} Die Datei ist zu groß, um im Speicher gehalten zu werden – wähle die Original-Capture-Datei erneut aus.`;
}

function openPcapExportDialog() {
  el.pcapExportError.hidden = true;
  el.pcapDropZone.classList.remove('over');
  el.pcapExportCancel.textContent = 'Abbrechen';
  el.pcapStepHash.hidden = true;
  el.pcapStepBuild.hidden = true;
  resetPcapStep(el.pcapStepHashLabel, el.pcapStepHashFill, el.pcapStepHashCheck, 'Prüfsumme wird verglichen …');
  resetPcapStep(el.pcapStepBuildLabel, el.pcapStepBuildFill, el.pcapStepBuildCheck, 'PCAP-Datei wird erstellt …');
  showPcapAwaitingInput();
  el.pcapExportOverlay.showModal();
}

function closePcapExportDialog() {
  if (el.pcapExportOverlay.open) el.pcapExportOverlay.close();
}

// Runs for every way of closing (button, backdrop, Escape): stop a running export (the fallback
// worker is terminated; the parse worker finishes its run, the result is ignored).
el.pcapExportOverlay.addEventListener('close', () => {
  state.activeExportId = null;
  if (pcapExportWorker) {
    pcapExportWorker.terminate();
    pcapExportWorker = null;
  }
});

function showPcapExportError(message) {
  showPcapAwaitingInput();
  el.pcapExportErrorMessage.textContent = message;
  el.pcapExportError.hidden = false;
}

async function handlePcapReupload(file) {
  el.pcapExportError.hidden = true;
  el.pcapExportIntro.hidden = true;
  el.pcapUploadSection.hidden = true;
  el.pcapExportProgress.hidden = false;
  el.pcapStepHash.hidden = false;
  el.pcapStepHashFill.style.setProperty('--w', '40%');
  try {
    const buffer = await file.arrayBuffer();
    const hash = await sha256Hex(buffer);
    if (hash !== state.originalFileHash) {
      showPcapExportError('Diese Datei stimmt nicht mit der ursprünglich geladenen Capture-Datei überein. Bitte die richtige Datei auswählen.');
      return;
    }
    completePcapStep(el.pcapStepHashLabel, el.pcapStepHashFill, el.pcapStepHashCheck, 'Prüfsumme stimmt überein.');
    state.originalFileBuffer = buffer;
    runPcapExport();
  } catch {
    showPcapExportError('Die Datei konnte nicht gelesen werden.');
  }
}

function showPcapExportSuccess(msg) {
  completePcapStep(el.pcapStepBuildLabel, el.pcapStepBuildFill, el.pcapStepBuildCheck, 'PCAP-Datei erstellt.');
  downloadPcapResult(msg);
  el.pcapExportSuccess.hidden = false;
  el.pcapExportCancel.textContent = 'Schließen';
}

/** Replies of the parse worker to an export request; stale ones (dialog closed meanwhile) are ignored. */
function onExportMessage(msg) {
  if (msg.requestId !== state.activeExportId) return;
  if (msg.type === 'exportProgress') {
    el.pcapStepBuildFill.style.setProperty('--w', `${msg.percent}%`);
    return;
  }
  state.activeExportId = null;
  if (msg.type === 'exportError') showPcapExportError(msg.message);
  else showPcapExportSuccess(msg);
}

function runPcapExport() {
  el.pcapExportError.hidden = true;
  el.pcapUploadSection.hidden = true;
  el.pcapCachedSection.hidden = true;
  el.pcapExportConfirm.hidden = true;
  el.pcapExportIntro.hidden = true;
  el.pcapExportSuccess.hidden = true;
  el.pcapExportProgress.hidden = false;
  el.pcapStepBuild.hidden = false;
  resetPcapStep(el.pcapStepBuildLabel, el.pcapStepBuildFill, el.pcapStepBuildCheck, 'PCAP-Datei wird erstellt …');

  const { keys } = currentExportScope();
  const payloadMode = currentPcapPayloadMode();

  if (state.scopeAvailable) {
    state.activeExportId = ++state.exportRequestCounter;
    worker.postMessage({ type: 'export', requestId: state.activeExportId, keys, payloadMode });
    return;
  }

  if (pcapExportWorker) pcapExportWorker.terminate();
  pcapExportWorker = new Worker(`pcap-export.worker.js?v=${APP_VERSION}`);
  pcapExportWorker.onmessage = (event) => {
    const msg = event.data;
    if (msg.type === 'progress') {
      el.pcapStepBuildFill.style.setProperty('--w', `${msg.percent}%`);
    } else if (msg.type === 'error') {
      showPcapExportError(msg.message);
    } else if (msg.type === 'result') {
      showPcapExportSuccess(msg);
    }
  };
  pcapExportWorker.onerror = (event) => {
    const detail = event.message || (event.filename ? `${event.filename}:${event.lineno}` : null);
    showPcapExportError(`Fehler beim PCAP-Export: ${detail || 'Unbekannter Fehler.'}`);
  };

  // A fresh transferable copy each time - state.originalFileBuffer itself is
  // never handed over, so it stays usable for further exports this session.
  const bufferCopy = state.originalFileBuffer.slice(0);
  pcapExportWorker.postMessage({ buffer: bufferCopy, keys, payloadMode }, [bufferCopy]);
}

function downloadPcapResult(msg) {
  const blob = new Blob([msg.buffer], { type: 'application/vnd.tcpdump.pcap' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const suffix = currentPcapPayloadMode() === 'headers-only' ? 'ohne-payload' : 'mit-payload';
  a.href = url;
  a.download = `packetatlas-gefiltert-${suffix}.pcap`;
  a.click();
  URL.revokeObjectURL(url);
  if (msg.skippedLinkTypeCount > 0) {
    el.pcapExportSuccessNote.textContent = `${msg.skippedLinkTypeCount.toLocaleString('de-DE')} Pakete mit abweichendem Link-Type wurden ausgelassen (klassisches pcap unterstützt nur einen Link-Type pro Datei).`;
    el.pcapExportSuccessNote.hidden = false;
  } else {
    el.pcapExportSuccessNote.hidden = true;
  }
}

el.exportPcap.addEventListener('click', () => {
  closeExportMenu();
  openPcapExportDialog();
});
el.pcapExportCancel.addEventListener('click', closePcapExportDialog);
el.pcapExportClose.addEventListener('click', closePcapExportDialog);
el.pcapExportConfirm.addEventListener('click', runPcapExport);
// A click on the backdrop lands on the <dialog> element itself.
el.pcapExportOverlay.addEventListener('click', (e) => {
  if (e.target === el.pcapExportOverlay) closePcapExportDialog();
});
el.pcapDropZone.addEventListener('click', () => el.pcapFileInput.click());
el.pcapDropZone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    el.pcapFileInput.click();
  }
});
el.pcapFileInput.addEventListener('change', () => {
  if (el.pcapFileInput.files[0]) handlePcapReupload(el.pcapFileInput.files[0]);
  el.pcapFileInput.value = '';
});
['dragenter', 'dragover'].forEach((evt) => {
  el.pcapDropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    e.stopPropagation();
    el.pcapDropZone.classList.add('over');
  });
});
el.pcapDropZone.addEventListener('dragleave', (e) => {
  e.preventDefault();
  e.stopPropagation();
  el.pcapDropZone.classList.remove('over');
});
el.pcapDropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  e.stopPropagation();
  el.pcapDropZone.classList.remove('over');
  const file = e.dataTransfer.files[0];
  if (file) handlePcapReupload(file);
});
