// XLSX export (Matrix + Rohdaten sheets) via the vendored SheetJS library.
// `XLSX` (vendor/xlsx.full.min.js) is loaded as a classic script before this module.
// thought up by human, created by ai

import { pairKey, metricValue, deviceLabel, formatBytes, formatTimestamp } from './data-model.js';

/** Exports the given (already filtered/selected) devices and pairs as a .xlsx file. */
export function exportToExcel({ devices, pairs, metric, filenameBase }) {
  const pairIndex = new Map();
  for (const pair of pairs) pairIndex.set(pairKey(pair.a, pair.b), pair);

  const header = ['', ...devices.map(deviceLabel)];
  const matrixRows = devices.map((rowDevice) => {
    const row = [deviceLabel(rowDevice)];
    devices.forEach((colDevice) => {
      if (rowDevice.id === colDevice.id) {
        row.push(0);
        return;
      }
      const pair = pairIndex.get(pairKey(rowDevice.id, colDevice.id));
      row.push(pair ? metricValue(pair, metric) : 0);
    });
    return row;
  });
  const matrixSheet = XLSX.utils.aoa_to_sheet([header, ...matrixRows]);

  const deviceById = new Map(devices.map((d) => [d.id, d]));
  const rawRows = pairs.map((pair) => ({
    Quelle: deviceLabel(deviceById.get(pair.a) || { id: pair.a }),
    Ziel: deviceLabel(deviceById.get(pair.b) || { id: pair.b }),
    Protokolle: pair.protocols.join(', '),
    'Ports (Quelle)': pair.portsA.join(', '),
    'Ports (Ziel)': pair.portsB.join(', '),
    Pakete: pair.packets,
    Bytes: pair.bytes,
    'Bytes (lesbar)': formatBytes(pair.bytes),
    'Erster Zeitstempel': formatTimestamp(pair.firstSeen),
    'Letzter Zeitstempel': formatTimestamp(pair.lastSeen),
  }));
  const rawSheet = XLSX.utils.json_to_sheet(rawRows);

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, matrixSheet, 'Matrix');
  XLSX.utils.book_append_sheet(workbook, rawSheet, 'Rohdaten');
  XLSX.writeFile(workbook, `${filenameBase}.xlsx`);
}

const PINNED_TYPE_LABEL = { pair: 'Paar', connection: 'Verbindung', device: 'Gerät' };

/** Exports the user's pinned selection (mix of pairs/connections/devices) as a single-sheet .xlsx file. */
export function exportSelectionToExcel({ items, deviceIndex, filenameBase }) {
  const rows = items.map((item) => {
    if (item.type === 'pair') {
      const pair = item.data;
      return {
        Typ: PINNED_TYPE_LABEL.pair,
        'Gerät A': deviceLabel(item.deviceA),
        'Gerät B': deviceLabel(item.deviceB),
        Protokolle: pair.protocols.join(', '),
        'Ports (Gerät A)': pair.portsA.join(', '),
        'Ports (Gerät B)': pair.portsB.join(', '),
        Pakete: pair.packets,
        Bytes: pair.bytes,
        'Bytes (lesbar)': formatBytes(pair.bytes),
        'Erster Zeitstempel': formatTimestamp(pair.firstSeen),
        'Letzter Zeitstempel': formatTimestamp(pair.lastSeen),
      };
    }
    if (item.type === 'connection') {
      const c = item.data;
      return {
        Typ: PINNED_TYPE_LABEL.connection,
        'Gerät A': deviceLabel(deviceIndex.get(c.a) || { id: c.a }),
        'Gerät B': deviceLabel(deviceIndex.get(c.b) || { id: c.b }),
        Protokolle: c.protocol || '',
        'Quell-Port': c.srcPort ?? '',
        'Ziel-Port': c.dstPort ?? '',
        Pakete: c.packets,
        Bytes: c.bytes,
        'Bytes (lesbar)': formatBytes(c.bytes),
        'Erster Zeitstempel': formatTimestamp(c.firstSeen),
        'Letzter Zeitstempel': formatTimestamp(c.lastSeen),
      };
    }
    const device = item.data;
    return {
      Typ: PINNED_TYPE_LABEL.device,
      'Gerät A': deviceLabel(device),
      'Gerät B': '',
      Protokolle: '',
      'Quell-Port': '',
      'Ziel-Port': '',
      Pakete: device.packetCount,
      Bytes: device.byteCount,
      'Bytes (lesbar)': formatBytes(device.byteCount),
      'Erster Zeitstempel': '',
      'Letzter Zeitstempel': '',
    };
  });

  const sheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Auswahl');
  XLSX.writeFile(workbook, `${filenameBase}.xlsx`);
}
