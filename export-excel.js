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

  // One row per (pair, protocol): a pair's merged ports would otherwise mix
  // e.g. TCP and UDP port numbers together in the same cell, making it
  // impossible to tell which port belongs to which protocol.
  const deviceById = new Map(devices.map((d) => [d.id, d]));
  const rawRows = pairs.flatMap((pair) => {
    const sourceLabel = deviceLabel(deviceById.get(pair.a) || { id: pair.a });
    const destLabel = deviceLabel(deviceById.get(pair.b) || { id: pair.b });
    return pair.protocolBreakdown.map((pb) => ({
      'Source IP': sourceLabel,
      'Destination IP': destLabel,
      Protokoll: pb.protocol,
      'Source Port': pb.portsA.join(', '),
      'Destination Port': pb.portsB.join(', '),
      Pakete: pb.packets,
      Bytes: pb.bytes,
      'Bytes (lesbar)': formatBytes(pb.bytes),
      'Erster Zeitstempel': formatTimestamp(pb.firstSeen),
      'Letzter Zeitstempel': formatTimestamp(pb.lastSeen),
    }));
  });
  const rawSheet = XLSX.utils.json_to_sheet(rawRows);

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, matrixSheet, 'Matrix');
  XLSX.utils.book_append_sheet(workbook, rawSheet, 'Rohdaten');
  XLSX.writeFile(workbook, `${filenameBase}.xlsx`);
}

const PINNED_TYPE_LABEL = { pair: 'Paar', connection: 'Verbindung', device: 'Gerät' };

/**
 * Exports the user's pinned selection (mix of pairs/connections/devices) as a
 * single-sheet .xlsx file. A pair pinned from the Graph (item.directional
 * false) expands into one row per protocol, same as the main Rohdaten sheet,
 * using pair.a/pair.b (the true initiator) for Source IP/Destination IP. A
 * pair pinned from the Matrix (item.directional true) instead exports the one
 * specific mirrored cell the user pinned - Source IP/Destination IP as
 * item.deviceA/deviceB, with packets/bytes/ports from that direction's
 * aToB/bToA sub-aggregate and an explicit "Richtung" column, since the two
 * mirrored cells of a pair can now carry different values (see
 * matrix-view.js/parser.worker.js).
 */
export function exportSelectionToExcel({ items, deviceIndex, filenameBase }) {
  const rows = items.flatMap((item) => {
    if (item.type === 'pair') {
      const pair = item.data;
      if (item.directional) {
        const isInitiatorDirection = item.deviceA.id === pair.a;
        const directional = isInitiatorDirection ? pair.aToB : pair.bToA;
        return [{
          Typ: PINNED_TYPE_LABEL.pair,
          'Source IP': deviceLabel(item.deviceA),
          'Destination IP': deviceLabel(item.deviceB),
          Protokoll: pair.protocols.join(', '),
          Richtung: isInitiatorDirection ? 'Verbindungsaufbau' : 'Antwort',
          'Source Port': directional.srcPorts.join(', '),
          'Destination Port': directional.dstPorts.join(', '),
          Pakete: directional.packets,
          Bytes: directional.bytes,
          'Bytes (lesbar)': formatBytes(directional.bytes),
          'Erster Zeitstempel': directional.firstSeen != null ? formatTimestamp(directional.firstSeen) : '',
          'Letzter Zeitstempel': directional.lastSeen != null ? formatTimestamp(directional.lastSeen) : '',
        }];
      }
      const sourceLabel = deviceLabel(deviceIndex.get(pair.a) || item.deviceA);
      const destLabel = deviceLabel(deviceIndex.get(pair.b) || item.deviceB);
      return pair.protocolBreakdown.map((pb) => ({
        Typ: PINNED_TYPE_LABEL.pair,
        'Source IP': sourceLabel,
        'Destination IP': destLabel,
        Protokoll: pb.protocol,
        Richtung: '',
        'Source Port': pb.portsA.join(', '),
        'Destination Port': pb.portsB.join(', '),
        Pakete: pb.packets,
        Bytes: pb.bytes,
        'Bytes (lesbar)': formatBytes(pb.bytes),
        'Erster Zeitstempel': formatTimestamp(pb.firstSeen),
        'Letzter Zeitstempel': formatTimestamp(pb.lastSeen),
      }));
    }
    if (item.type === 'connection') {
      const c = item.data;
      return [{
        Typ: PINNED_TYPE_LABEL.connection,
        'Source IP': deviceLabel(deviceIndex.get(c.a) || { id: c.a }),
        'Destination IP': deviceLabel(deviceIndex.get(c.b) || { id: c.b }),
        Protokoll: c.protocol || '',
        Richtung: '',
        'Source Port': c.srcPort ?? '',
        'Destination Port': c.dstPort ?? '',
        Pakete: c.packets,
        Bytes: c.bytes,
        'Bytes (lesbar)': formatBytes(c.bytes),
        'Erster Zeitstempel': formatTimestamp(c.firstSeen),
        'Letzter Zeitstempel': formatTimestamp(c.lastSeen),
      }];
    }
    const device = item.data;
    return [{
      Typ: PINNED_TYPE_LABEL.device,
      'Source IP': deviceLabel(device),
      'Destination IP': '',
      Protokoll: '',
      Richtung: '',
      'Source Port': '',
      'Destination Port': '',
      Pakete: device.packetCount,
      Bytes: device.byteCount,
      'Bytes (lesbar)': formatBytes(device.byteCount),
      'Erster Zeitstempel': '',
      'Letzter Zeitstempel': '',
    }];
  });

  const sheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Auswahl');
  XLSX.writeFile(workbook, `${filenameBase}.xlsx`);
}
