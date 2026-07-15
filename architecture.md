# Architektur – PacketAtlas

## Überblick

PacketAtlas ist eine buildfreie, rein clientseitige Web-App aus nativen ES-Modulen. Es gibt keinen Server-Anteil, keinen Bundler und keinen Build-Schritt – alle Dateien liegen flach im Projekt-Root (Ausnahmen: `vendor/`, `fonts/`, `assets/`, `docs/`).

```
Datei-Import (app.js)
        │  ArrayBuffer
        ▼
parser.worker.js  ──►  pcap-parser.js / pcapng-parser.js  ──►  packet-decoder.js  ──►  data-model.js (Aggregation)
        │  postMessage: progress / result
        ▼
app.js (UI-Controller)
        │
        ├─► matrix-view.js   (SVG-Adjazenzmatrix)
        ├─► graph-view.js    (SVG + d3-force)
        ├─► export-image.js  (PNG/SVG)
        └─► export-excel.js  (XLSX via SheetJS)
```

## Warum kein Framework

Der Masterprompt fordert eine flache, buildfreie Struktur (GitHub/Gitea-Pages-kompatibel). Ein UI-Framework (React/Vue/…) würde einen Build-Schritt und `node_modules` voraussetzen. Native ES-Module reichen für den Umfang dieser App aus; die Modultrennung (Parser/Datenmodell/Visualisierung/Export) übernimmt dieselbe Aufgabe wie Framework-Komponenten, ohne zusätzliche Abhängigkeit.

## Datenmodell

```js
// Device
{
  id,            // Primärschlüssel: IP-Adresse, oder MAC wenn keine IP bekannt ist
  kind,          // 'ip' | 'mac'
  ip,            // optional
  mac,           // optional (mehrere MACs können auf dieselbe IP zeigen -> letzte gewinnt)
  hostname,      // optional, aus DNS-Antworten
  packetCount,
  byteCount,
}

// Pair (Map<pairKey, Pair>), pairKey = [idA, idB].sort().join('|')
{
  a, b,                     // Device-IDs (unsortiert original, Anzeige)
  packets, bytes,
  protocols,                 // Set<string>, z. B. {"TCP","UDP","ARP"}
  ports,                      // Set<number>, Vereinigung aus Quell-/Zielports beider Richtungen
  firstSeen, lastSeen,         // Unix-Timestamp (Sekunden, Fließkomma)
  multicastOrBroadcast,        // boolean – für Filter „Multicast/Broadcast ausblenden"
}
```

Die Aggregation läuft während des Parsens **inline** über eine `Map`-Struktur (Schlüssel = sortiertes Geräte-Paar), sodass pro Paket nur ein O(1)-Lookup + Update nötig ist – kein nachträgliches Scannen eines Pakete-Arrays. Einzelpakete werden nach der Aggregation verworfen; der Worker sendet ausschließlich das aggregierte Ergebnis (Device-Liste + Pair-Liste) an den Main-Thread zurück. Das hält den Speicherbedarf und die Nachrichtengröße auch bei Captures mit mehreren hunderttausend Paketen klein.

## Parsing-Strategie

### Formaterkennung

Die ersten 4 Bytes des `ArrayBuffer` werden gegen bekannte Magic Numbers geprüft (nicht die Dateiendung):

| Bytes (little/big endian) | Format |
|---|---|
| `A1 B2 C3 D4` / `D4 C3 B2 A1` | klassisches pcap (Mikrosekunden) |
| `A1 B2 3C 4D` / `4D 3C B2 A1` | klassisches pcap (Nanosekunden) |
| `0A 0D 0D 0A` | pcapng (Section Header Block) |

### Klassisches pcap

Globaler Header (24 Byte) liefert Byte-Order, Zeitauflösung und den Link-Layer-Typ (`network`-Feld). Danach folgt eine Sequenz aus Record-Headern (`ts_sec`, `ts_usec`, `incl_len`, `orig_len`) + Payload von je `incl_len` Byte.

### pcapng

Blockbasiertes Format. Relevante Blocktypen:

- **Section Header Block (SHB, `0x0A0D0D0A`)** – enthält das Byte-Order-Magic `0x1A2B3C4D`, mit dem die Endianness der Sektion erkannt wird.
- **Interface Description Block (IDB, `0x00000001`)** – ein Block pro Interface, enthält dessen `LinkType`; wird für spätere Enhanced-Packet-Blocks per Interface-ID nachgeschlagen.
- **Enhanced Packet Block (EPB, `0x00000006`)** – der Regelfall für Paketdaten: Interface-ID, High/Low-Timestamp, Captured/Original Length, Payload.
- **(veraltet) Packet Block (PB, `0x00000002`)** – Fallback für ältere Captures.

Jeder Block trägt seine Gesamtlänge doppelt (Anfang und Ende), was Validierung und robustes Überspringen unbekannter/fehlerhafter Blocktypen erlaubt.

### Warum ein eigener Parser statt einer Bibliothek

Beide Formate sind offen spezifiziert und im hier benötigten Umfang (nur die oben genannten Blocktypen/Records, keine Kommentar-Blocks, keine Namensauflösungs-Blocks etc.) kompakt genug für eine Eigenimplementierung. Das vermeidet Lizenzfragen von Drittbibliotheken, hält den Footprint minimal und erlaubt eine exakt auf die geforderten Layer/Protokolle zugeschnittene Fehlerbehandlung. Für den Force-Directed-Graph wird dagegen bewusst **d3-force** vendort (siehe unten) – ein performanter, interaktiver Kräfte-Simulationsalgorithmus mit Zoom/Pan wäre als Eigenbau unverhältnismäßig aufwändig gegenüber dem Nutzen.

### Link-Layer / L3 / L4

- **Ethernet II** (LinkType 1): 6 Byte Ziel-MAC, 6 Byte Quell-MAC, 2 Byte Ethertype.
- **Linux Cooked Capture / SLL** (LinkType 113): 16-Byte-Header, Protokollfeld an Offset 14.
- **Ethertype** bestimmt die weitere Verarbeitung: `0x0800` → IPv4, `0x86DD` → IPv6, `0x0806` → ARP.
- **IPv4**: Header-Länge aus IHL, Protokollfeld (TCP=6, UDP=17, ICMP=1) bestimmt L4-Parsing, Quell-/Ziel-Adresse.
- **IPv6**: Fixed Header (40 Byte), Next-Header-Feld (vereinfachte Behandlung, keine vollständige Extension-Header-Kette), Quell-/Ziel-Adresse.
- **ARP**: kein IP-Layer im eigentlichen Sinn, aber Sender-/Target-Protocol-Address (IP) und Sender-/Target-Hardware-Address (MAC) stehen im ARP-Payload und werden für die Geräteerkennung genutzt.
- **TCP/UDP**: erste 4 Byte des Payloads = Quell-/Zielport.
- **ICMP/ICMPv6**: keine Ports, nur als Protokoll-Tag in der Aggregation vermerkt.

### DNS-Hostnamen (optional)

`dns-resolver.js` erkennt UDP-Pakete auf Port 53, parst A-/AAAA-Resource-Records aus DNS-Antworten und baut daraus eine IP→Hostname-Zuordnung, die in Tooltips angezeigt wird, falls vorhanden. Fehlt DNS im Capture, bleibt die Funktion einfach ungenutzt.

### Fehlerbehandlung

Jede Block-/Record-Iteration steht unter Längen-Validierung (Blocklänge/Record-Länge darf nicht über das Ende des Buffers hinausgehen). Bei Inkonsistenzen wird das betroffene Segment übersprungen bzw. das Parsing sauber mit einer verständlichen Fehlermeldung an die UI abgebrochen – kein unbehandelter Exception-Crash.

## Visualisierung

Beide Ansichten rendern **natives SVG** (kein Canvas):

- Vereinfacht den Bild-Export erheblich: SVG lässt sich direkt serialisieren (`.svg`-Download) und für PNG einfach auf einen Offscreen-Canvas zeichnen (`drawImage` + `toBlob`).
- Passt idiomatisch zu d3 (d3-force liefert nur Positionsdaten, d3-selection übernimmt DOM-Bindung).
- Für die Zielszenarien (bis zu einigen hundert Geräten/Kanten) ist SVG-DOM performant genug.

**Matrix** (`matrix-view.js`): SVG-Grid, sequenzielle Farbskala (log-skaliert, da Traffic-Volumen typischerweise stark schief verteilt ist). Der Container ist scrollbar; bei mehr als 50 ausgewählten Geräten weist ein Warnhinweis auf die eingeschränkte Lesbarkeit hin und empfiehlt Filterung (echte sticky Zeilen-/Spaltenköpfe sind für eine spätere Version denkbar, da sie bei reinem SVG-Rendering einen separaten HTML-Overlay erfordern würden).

**Graph** (`graph-view.js`): d3-force-Simulation (Charge, Link-Distance, Collision), Kantendicke proportional zum gewählten Metrik-Wert, Zoom/Pan über d3-zoom, einstellbare Kräfte-Parameter für Lesbarkeit bei vielen Knoten. Das Layout wird nach jedem Rendern synchron über 300 manuelle `simulation.tick()`-Aufrufe vorkonvergiert und der Viewport per Zoom-to-Fit auf die resultierende Knotenausdehnung angepasst – dadurch ist der Graph sofort vollständig sichtbar, unabhängig davon, ob der rAF-getriebene Simulationstimer im aktuellen Tab-Zustand ungedrosselt läuft.

Beide Ansichten lesen denselben abgeleiteten Zustand aus `data-model.js` (gefilterte Geräteauswahl + gewählte Metrik) und bleiben dadurch synchron.

## Web Worker

`parser.worker.js` kapselt den gesamten rechenintensiven Teil (Parsing + Decoding + Aggregation) und kommuniziert über `postMessage`:

- `progress`-Nachrichten (Anteil verarbeiteter Bytes) für die Fortschrittsanzeige.
- Eine abschließende `result`-Nachricht mit dem aggregierten Datenmodell (Devices + Pairs).
- Eine `error`-Nachricht bei nicht behebbaren Parsing-Fehlern.

Der Main-Thread bleibt während des Parsens vollständig responsiv.

### Klassischer Worker statt Modul-Worker

`parser.worker.js` wird bewusst als **klassischer Worker** (`new Worker('parser.worker.js')`, ohne `{ type: 'module' }`) erzeugt und lädt `pcap-parser.js`, `pcapng-parser.js`, `packet-decoder.js` und `dns-resolver.js` per `importScripts()` nach – nicht über ES-`import`. Modul-Worker sind eine vergleichsweise junge Web-Plattform-Funktion (Firefox unterstützt sie erst seit Version 114, Mitte 2023) und schlagen in nicht unterstützten Browsern mit einer kryptischen, inhaltsunabhängigen Fehlermeldung fehl. `importScripts()` wird dagegen seit weit über einem Jahrzehnt von allen Browsern unterstützt. Da klassische Scripts (anders als Module) keinen eigenen Datei-Scope haben, teilen sich alle per `importScripts()` geladenen Dateien denselben globalen Scope wie `parser.worker.js` – die Funktionen aus den vier Parser-Dateien sind dort daher ohne Import direkt als globale Bezeichner nutzbar. Der `Aggregator` (Geräte-/Paar-Aggregation) ist deshalb direkt in `parser.worker.js` definiert statt in `data-model.js`, das als ES-Modul weiterhin ausschließlich vom Main-Thread (`app.js` und die Views) importiert wird.

## Sicherheit / Datenschutz

- Content-Security-Policy (Meta-Tag in `index.html`) unterbindet jede externe Verbindung: `default-src 'none'` mit gezielten Ausnahmen nur für `'self'` (Skripte, Styles, Fonts, Worker) sowie `data:`/`blob:` bei Bildern (letzteres ausschließlich für den clientseitigen PNG-Export benötigt – eine reine In-Memory-Referenz auf zuvor selbst erzeugte Daten, keine Netzwerkverbindung).
- Keine CDN-Referenzen; alle Bibliotheken und Schriften liegen lokal in `vendor/` bzw. `fonts/`.
- Keine Analytics-/Tracking-Skripte.
- Datei-Inhalt verlässt zu keinem Zeitpunkt den Browser-Kontext (kein `fetch`, kein `XMLHttpRequest` im gesamten Code; `connect-src 'none'` erzwingt dies zusätzlich technisch).

## Vendorte Bibliotheken

Siehe [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) für Versionen und Lizenztexte.
