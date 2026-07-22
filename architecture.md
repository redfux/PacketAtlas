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
- **IEEE 802.11 mit Radiotap-Header** (LinkType 127) und **reines IEEE 802.11** (LinkType 105): siehe eigener Abschnitt unten.
- **Ethertype** bestimmt die weitere Verarbeitung: `0x0800` → IPv4, `0x86DD` → IPv6, `0x0806` → ARP.
- **IPv4**: Header-Länge aus IHL, Protokollfeld (TCP=6, UDP=17, ICMP=1) bestimmt L4-Parsing, Quell-/Ziel-Adresse.
- **IPv6**: Fixed Header (40 Byte), Next-Header-Feld (vereinfachte Behandlung, keine vollständige Extension-Header-Kette), Quell-/Ziel-Adresse.
- **ARP**: kein IP-Layer im eigentlichen Sinn, aber Sender-/Target-Protocol-Address (IP) und Sender-/Target-Hardware-Address (MAC) stehen im ARP-Payload und werden für die Geräteerkennung genutzt.
- **TCP/UDP**: erste 4 Byte des Payloads = Quell-/Zielport.
- **ICMP/ICMPv6**: keine Ports, nur als Protokoll-Tag in der Aggregation vermerkt.

### WLAN-Captures (IEEE 802.11 / Radiotap)

Reine WLAN-Mitschnitte (z. B. von Access Points) nutzen üblicherweise LinkType 127 (Radiotap-gekapseltes 802.11) oder seltener 105 (rohes 802.11 ohne Radiotap). Verarbeitung in `packet-decoder.js`:

- **Radiotap-Header** (nur bei LinkType 127): Die Gesamtlänge steht bereits explizit im Header selbst (`it_len`, Offset 2–3, immer Little-Endian). Die einzelnen Radio-Metadaten (Signalstärke, Kanal, Datenrate, …) werden nicht ausgewertet – für die Kommunikationsmatrix genügt es, den Header anhand von `it_len` zu überspringen.
- **802.11-MAC-Header**: Nur **Datenframes** (Type 2) werden weiterverarbeitet; Management-Frames (Beacons, Probe-Requests, …) und Control-Frames (ACK, RTS/CTS) tragen keine IP-Nutzlast und werden ignoriert, ebenso Null-/QoS-Null-Datenframes (Subtype 4/12/14/15), die keinen Frame-Body besitzen.
- **Adress-Interpretation nach ToDS/FromDS-Flags**: Je nach Übertragungsrichtung (Client→AP, AP→Client, IBSS oder WDS mit 4 Adressen) stehen Quell-/Ziel-MAC an unterschiedlichen der bis zu vier Adressfelder. PacketAtlas ordnet die eigentlichen Endgeräte (Stationen) als Kommunikationspartner zu, nicht den Access Point als Relais – die Matrix zeigt also „Client A ↔ Client B", nicht bei jedem Hop „Client ↔ AP".
- **QoS-Control-Feld**: Bei QoS-Datenframes (Subtype ≥ 8) liegen zusätzliche 2 Byte zwischen Adressfeldern/Sequenznummer und der Nutzlast, die entsprechend übersprungen werden.
- **LLC/SNAP-Kapselung**: IP-Verkehr über 802.11 ist praktisch immer per 802.2-LLC/SNAP gekapselt (`AA AA 03` + 3 Byte OUI + 2 Byte Ethertype, RFC 1042). Danach folgt dieselbe IPv4/IPv6/ARP-Verarbeitung wie bei Ethernet. Nicht-SNAP-gekapselte Payloads werden nicht interpretiert.

### DNS-Hostnamen (optional)

`dns-resolver.js` erkennt UDP-Pakete auf Port 53, parst A-/AAAA-Resource-Records aus DNS-Antworten und baut daraus eine IP→Hostname-Zuordnung, die in Tooltips angezeigt wird, falls vorhanden. Fehlt DNS im Capture, bleibt die Funktion einfach ungenutzt.

### Fehlerbehandlung

Jede Block-/Record-Iteration steht unter Längen-Validierung (Blocklänge/Record-Länge darf nicht über das Ende des Buffers hinausgehen). Bei Inkonsistenzen wird das betroffene Segment übersprungen bzw. das Parsing sauber mit einer verständlichen Fehlermeldung an die UI abgebrochen – kein unbehandelter Exception-Crash.

## Visualisierung

Beide Ansichten rendern **natives SVG** (kein Canvas):

- Vereinfacht den Bild-Export erheblich: SVG lässt sich direkt serialisieren (`.svg`-Download) und für PNG einfach auf einen Offscreen-Canvas zeichnen (`drawImage` + `toBlob`).
- Passt idiomatisch zu d3 (d3-force liefert nur Positionsdaten, d3-selection übernimmt DOM-Bindung).
- Für die Zielszenarien (bis zu einigen hundert Geräten/Kanten) ist SVG-DOM performant genug.

**Matrix** (`matrix-view.js`): SVG-Grid, sequenzielle Farbskala (log-skaliert, da Traffic-Volumen typischerweise stark schief verteilt ist). Der Container ist scrollbar; bei mehr als 50 ausgewählten Geräten weist ein Warnhinweis auf die eingeschränkte Lesbarkeit hin und empfiehlt Filterung (echte sticky Zeilen-/Spaltenköpfe sind für eine spätere Version denkbar, da sie bei reinem SVG-Rendering einen separaten HTML-Overlay erfordern würden). Die linke Zeilen-Beschriftungsbreite, die Höhe der um -45° rotierten Spaltenköpfe sowie ein zusätzlicher rechter Rand werden aus der tatsächlich längsten Geräte-Bezeichnung (bis zu 40 Zeichen) berechnet statt aus einer festen Konstante – eine fixe Höhe/Breite hätte bei langen IPv6-Adressen bzw. IP+Hostname-Kombinationen dazu geführt, dass die diagonale Textausdehnung über den oberen bzw. (bei den letzten Spalten) rechten Rand des SVG-`viewBox` hinausragt und dort abgeschnitten wird – die rotierten Köpfe wachsen bei -45° gleichermaßen nach oben wie nach rechts, weshalb beide Ränder denselben Diagonal-Extent-Wert (`maxLabelLen * CHAR_WIDTH * sin(45°)`) berücksichtigen müssen.

### Direktionale Matrix-Zellen: Verbindungsaufbau vs. Antwort

Ein Geräte-Paar belegt in der Matrix zwei symmetrische Zellen (Zeile A/Spalte B und Zeile B/Spalte A). Da `pair.packets`/`pair.bytes`/`portsA`/`portsB` beide Richtungen zusammen aggregieren, hätten beide Zellen ohne weitere Maßnahme denselben Wert, dieselbe Farbe und dieselben (identischen) Ports angezeigt – unabhängig davon, wie viel Traffic tatsächlich in welche Richtung floss. `parser.worker.js` hält deshalb pro Paar zusätzlich zwei gerichtete Sub-Aggregate `aToB`/`bToA` (`packets`, `bytes`, `srcPorts`, `dstPorts`, `firstSeen`, `lastSeen`), befüllt je nachdem, ob das sendende Gerät eines Pakets `pair.a` oder `pair.b` ist. Eine Richtung, die nie Traffic trägt (z. B. eine ARP-Anfrage ohne Antwort oder ein rein einseitiges UDP-Fire-and-forget), wird explizit als Null-Eintrag serialisiert statt `null`, damit `matrix-view.js`/`app.js` nie auf Existenz prüfen müssen.

`matrix-view.js` berechnet Zellfarbe/-wert jeder der beiden Zellen jetzt aus dem zur Zeile passenden Sub-Aggregat (`directionalDataFor()`: Zeile === `pair.a` → `aToB`, sonst `bToA`) statt aus den kombinierten Paar-Werten. Zusätzlich zeichnet jede nicht-leere Zelle einen kleinen, klickunempfindlichen (`pointer-events: none`) Marker: ein gefülltes Dreieck, wenn die Zeile die Verbindung tatsächlich initiiert hat (`pair.a`), ein Ring, wenn die Zeile nur die Antwortrichtung zeigt (`pair.b`) – erkennbar auch ohne Hover, relevant z. B. für Firewall-/ACL-Regeln, bei denen nur die initiierende Richtung eine explizite Freigabe braucht. Eine kurze Legende oberhalb der Matrix (`index.html`) erklärt beide Symbole.

Tooltip/Kachel für eine Matrixzelle (`matrixCellDetailsHtml()` in `app.js`, getrennt von `pairDetailsHtml()`) zeigt entsprechend „Zeilen-Gerät → Spalten-Gerät" mit den direktionalen Ports/Paketen/Bytes des jeweiligen Sub-Aggregats sowie dem Zusatz „Verbindungsaufbau"/„Antwort". Da zwei Zellen desselben Paares jetzt unterschiedliche Informationen zeigen können, erhält jede beim Anheften eine eigene, zeilen-/spaltenspezifische ID (`pinPair(pair, deviceA, deviceB, directional)` in `app.js`) statt der paar-weiten ID, die der Graph für seine (weiterhin kombinierte, nicht-direktionale) Kanten-Ansicht verwendet – so erzeugt das Anheften beider Zellen eines Paares zwei getrennte Kacheln statt eines No-ops beim zweiten Klick. `exportSelectionToExcel()` (`export-excel.js`) exportiert einen direktional angehefteten Eintrag entsprechend mit einer zusätzlichen Spalte „Richtung" statt der protokollweisen Aufspaltung, die für nicht-direktionale (Graph-)Paare gilt.

### Adressfamilie: getrennte IPv4-/IPv6-/MAC-Ansichten

Matrix und Graph zeigen immer nur **eine** Adressfamilie gleichzeitig – umschaltbar über einen Segmented-Control „IPv4 / IPv6 / Sonstige" in der Toolbar (analog zum Pakete/Bytes-Metrik-Umschalter). Begründung: IPv4- und IPv6-Geräte in derselben Matrix zu mischen ergibt keine sinnvollen Zellen (ein Gerät kommuniziert nie gleichzeitig über beide Familien mit demselben Nachbarn in einem Zellwert), und getrennte Ansichten sind deutlich übersichtlicher als eine gemeinsame, dünn besetzte Matrix. „Sonstige" bündelt Geräte, die nur über ihre MAC-Adresse bekannt sind (z. B. aus nicht-IPv4-ARP) – in der Praxis ein seltener Randfall. Buttons ohne passende Geräte werden deaktiviert; nach dem Parsen wird automatisch die erste nicht-leere Familie (Präferenz IPv4 → IPv6 → Sonstige) vorausgewählt. Die Geräteliste im Seitenpanel bleibt davon unabhängig und zeigt weiterhin alle Geräte aller Familien zur Auswahl an.

Innerhalb der aktuell gewählten Familie werden die Geräte für Matrix-Zeilen/-Spalten und die XLSX-„Matrix"-Tabelle aufsteigend nach Adresse sortiert (`compareDevicesByAddress` in `data-model.js`): IPv4 numerisch pro Oktett, IPv6 numerisch pro Gruppe (mit Expansion der „::"-Kurzschreibweise vor dem Vergleich), MAC-Geräte alphabetisch nach MAC-Adresse. Eine reine String-Sortierung würde bei IP-Adressen falsche Ergebnisse liefern (z. B. „192.168.1.10" vor „192.168.1.5").

**Graph** (`graph-view.js`): d3-force-Simulation (Charge, Link-Distance, Collision), Kantendicke proportional zum gewählten Metrik-Wert, Zoom/Pan über d3-zoom, einstellbare Kräfte-Parameter für Lesbarkeit bei vielen Knoten. Das Layout wird nach jedem Rendern synchron über 300 manuelle `simulation.tick()`-Aufrufe vorkonvergiert und der Viewport per Zoom-to-Fit auf die resultierende Knotenausdehnung angepasst – dadurch ist der Graph sofort vollständig sichtbar, unabhängig davon, ob der rAF-getriebene Simulationstimer im aktuellen Tab-Zustand ungedrosselt läuft.

Beide Ansichten lesen denselben abgeleiteten Zustand aus `data-model.js` (gefilterte Geräteauswahl + gewählte Metrik) und bleiben dadurch synchron.

**Verbindungen** (`connections-view.js`): drittes Tab neben Matrix und Graph, eine korrelierte (nicht-zeitliche) Verbindungsübersicht: pro ausgewähltem Gerät eine senkrechte Lebenslinie mit Kopfbox, pro eindeutiger Kombination aus Geräte-Paar, Protokoll und Port ein waagerechter Pfeil, beschriftet mit Protokoll/Port und Paketanzahl (z. B. „TCP 443 — 25×"), sortiert nach Paketanzahl absteigend (die auffälligsten Verbindungen zuerst). Eine frühere Version zeigte stattdessen einen chronologisch pro Einzelpaket angeordneten Pfeil (echtes Ablauf-/Sequenzdiagramm wie bei Wiresharks „Flow Graph"); auf Nutzerwunsch wurde die zeitliche Anordnung zugunsten dieser korrelierten Übersicht zurückgestellt (siehe [features.md](features.md#backlog-nicht-bestandteil-dieser-version)). Da dies nicht mit der gewählten Metrik (Pakete/Bytes) arbeitet, sondern immer die Paketanzahl je Verbindung zeigt, ist die Metrik-Umschaltung für dieses Tab ausgeblendet. Um die Lesbarkeit auch bei sehr vielen unterschiedlichen Verbindungen zu begrenzen, werden höchstens `MAX_CONNECTIONS_RENDER` (400) Verbindungen gleichzeitig gezeichnet; wird diese Grenze überschritten, erscheint ein Warnhinweis mit der Empfehlung, weiter zu filtern.

Bei vielen ausgewählten Geräten wird das eigentliche Diagramm (feste Lebenslinien-Abstände × Zeilenhöhe pro Verbindung) schnell deutlich größer als der sichtbare Ansichtsbereich. Analog zum Graphen wird das SVG-Element selbst auf die Containergröße gesetzt und der Diagramminhalt in einer Zoom-Layer-Gruppe untergebracht, die per `d3.zoom()` initial per Zoom-to-Fit auf die volle Diagrammausdehnung skaliert wird (Faktor ≤ 1, nie vergrößert) – ohne diesen Schritt wäre beim Öffnen des Tabs oft nur ein leerer Ausschnitt zu sehen. Zoom/Pan bleiben danach interaktiv nutzbar, um Details bei vielen Geräten/Verbindungen zu untersuchen.

Der Worker aggregiert die Verbindungen **vollständig und unbegrenzt**, genau wie die Geräte-Paare – anders als ein Log einzelner Pakete braucht diese Aggregation keine Obergrenze, da pro Paket nur ein O(1)-Map-Lookup auf den Schlüssel `Geräte-Paar|Protokoll|Service-Port` anfällt (`Aggregator.connections` in `parser.worker.js`). Der „Service-Port" einer Verbindung ist der kleinere der beiden beteiligten Portnummern (`servicePortOf()`) – ein einfacher, aber in der Praxis fast immer zutreffender Kniff, um Client-seitige, wechselnde Ephemeral-Ports und Server-Port in einer Zeile zusammenzuführen, statt für jede neue Client-Verbindung eine eigene Zeile zu erzeugen.

**Zeitleiste** (`timeline-view.js`): viertes Tab, ein Gantt-Diagramm derselben Verbindungen (Geräte-Paar + Protokoll + Port). Anders als bei Matrix/Graph/Verbindungen ist hier nicht die Geräteliste die Zeilenachse, sondern jede Verbindung selbst eine Zeile mit einem waagerechten Balken von `firstSeen` bis `lastSeen`; Zeilen sind aufsteigend nach `firstSeen` sortiert (früheste Verbindung oben, späteste unten), statt nach Volumen wie im Verbindungen-Tab. Da eine einzelne Verbindung nur Anfang/Ende kennt (keine Einzelpaket-Zeitstempel dazwischen, siehe Backlog-Hinweis in [features.md](features.md#backlog-nicht-bestandteil-dieser-version)), ist der Balken eine reine Aktivitätsspanne, keine Aussage über die tatsächliche Paketverteilung innerhalb dieser Spanne. Sehr kurze (Einzelpaket-)Verbindungen erhalten eine Mindestbreite, damit sie sichtbar bleiben.

Der Zeitachsen-Bereich ist – anders als bei Graph/Verbindungen – **nicht** per Zoom-to-Fit-Transform auf eine Gruppe gelöst, sondern klassisch über eine `d3.scaleTime()`-Skala, die den gesamten Zeitraum von vornherein auf die Breite des Plot-Bereichs abbildet (das Darstellungsproblem bei Graph/Verbindungen – „natürliche" Diagrammgröße kann den Container weit überschreiten – existiert hier für die Zeitachse nicht, da die Skala den Zeitraum immer exakt auf die verfügbare Breite passt). `d3.zoom()` wird stattdessen für interaktives Hinein-/Herauszoomen und Verschieben entlang der Zeitachse verwendet: bei jedem Zoom-Event wird die Skala über `transform.rescaleX()` neu berechnet und sowohl die Achsen-Ticks als auch alle Balken-Positionen/-Breiten direkt neu gezeichnet (nicht per CSS-Transform auf eine Gruppe) – so bleiben Balkenhöhe und Beschriftungsgröße unabhängig vom Zoomfaktor lesbar. Die Geräte-/Verbindungs-Beschriftungsspalte links ist fix positioniert und nimmt am horizontalen Zoom/Pan nicht teil (per `<clipPath>` auf den Plot-Bereich begrenzt); vertikal scrollt das gesamte Diagramm bei vielen Zeilen normal über den Container, ohne eigenen Zoom. Wie beim Verbindungen-Tab werden höchstens `MAX_TIMELINE_RENDER` (300) Zeilen gezeichnet, mit Warnhinweis bei Überschreitung.

Jede Zeilenbeschriftung besteht aus Source-IP und „→ Destination-IP · Protokoll Port" (siehe nächster Abschnitt). Passt das komplett in eine Zeile (bis 36 Zeichen), wird ein einzeiliges `<text>` gerendert; darüber hinaus – vor allem bei IPv6-Adressen, die auch mit Hostname-Zusatz regelmäßig länger sind als IPv4 – wird die Beschriftung über zwei `<tspan>`-Zeilen (Source-IP oben, Rest darunter) verteilt statt sie mit „…" abzuschneiden. `ROW_HEIGHT` ist entsprechend groß genug für beide Fälle bemessen.

### Initiator-Richtung, Source/Destination-Terminologie in Tooltips und Kacheln

`pair.a`/`pair.b` bzw. `connection.a`/`connection.b` werden in `parser.worker.js` immer vom **ersten** Paket gesetzt, das dieses Paar/diese Connection anlegt – `a` ist also stets das Gerät, das die Kommunikation zuerst initiiert hat. Tooltips und angeheftete Kacheln (`pairDetailsHtml()`/`connectionDetailsHtml()` in `app.js`) nutzen das aus, um immer „Source IP → Destination IP" mit genau einem Pfeil anzuzeigen (statt eines richtungslosen „↔") – unabhängig davon, in welcher Zeilen-/Spaltenreihenfolge z. B. eine Matrixzelle gehovert wurde: `pairDetailsHtml()` löst Source/Destination stets über `pair.a`/`pair.b` und `state.deviceIndex` auf, nicht über die von der jeweiligen Ansicht übergebenen Geräte.

Ein **Geräte-Paar** aggregiert Datenverkehr in beide Richtungen – ein einzelnes, paketweise wechselndes „Source-Port"/„Destination-Port"-Paar ist auf dieser Ebene nicht sinnvoll definierbar. Statt eines einzigen, richtungsunabhängig vermischten `ports`-Sets hält `parser.worker.js` deshalb pro Paar zwei getrennte Sets: `portsA` (alle Ports, die das Source-Gerät jemals genutzt hat, unabhängig von Sende-/Empfangsrichtung) und `portsB` (entsprechend für das Destination-Gerät). Tooltips/Kacheln zeigen dies als „Source Port" / „Destination Port".

Eine einzelne **Connection** (Geräte-Paar + Protokoll + Service-Port) repräsentiert dagegen einen weitgehend richtungsstabilen Fluss, da die Service-Port-Gruppierung ohnehin beide Richtungen zusammenführt. Hier ist ein echtes „Source-Port/Destination-Port"-Paar sinnvoll und wird direkt vom ersten Paket übernommen, das diese Connection eröffnet hat (`connection.srcPort`/`connection.dstPort` in `parser.worker.js`, zusätzlich zum gruppierenden `connection.port`).

Für den Excel-Rohdaten-Export reicht die reine Paar-Aggregation nicht aus, da `portsA`/`portsB` Ports über alle Protokolle hinweg vermischen (TCP- und UDP-Ports eines Paares wären sonst nicht unterscheidbar). `parser.worker.js` hält deshalb zusätzlich pro Paar eine `byProtocol`-Map (serialisiert als `pair.protocolBreakdown`) mit denselben Feldern (`packets`, `bytes`, `portsA`, `portsB`, `firstSeen`, `lastSeen`) getrennt je Protokoll, wodurch `export-excel.js` eine dedizierte Zeile pro (Paar, Protokoll)-Kombination statt einer Zeile pro Paar erzeugen kann.

### Angeheftete Auswahl (persistente Detail-Kacheln)

Klick auf eine Matrixzelle, eine Graph-Kante/einen Graph-Knoten, einen Verbindungen-Pfeil oder einen Zeitleiste-Balken heftet dieselben Informationen, die der Hover-Tooltip zeigen würde, dauerhaft als Kachel im rechten Panel an (`state.pinnedItems` in `app.js`). Die HTML-Bausteine (`pairDetailsHtml()`, `connectionDetailsHtml()`, `deviceDetailsHtml()`) sind bewusst von den Tooltip-Aufrufen getrennt und werden von beiden – transientem Tooltip und persistenter Kachel – gemeinsam genutzt, um Duplikation zu vermeiden. Jede Kachel hat eine stabile ID (`pair:…`, `connection:…`, `device:…|` jeweils basierend auf `pairKey()`/Geräte-ID), wodurch erneutes Klicken desselben Elements keine doppelte Kachel erzeugt. Kacheln werden nur explizit über ihr „×" oder „Alle entfernen" geschlossen, nie automatisch (auch nicht bei Filter-/Tab-Wechsel) – einzig ein neuer Datei-Import setzt die Auswahl zurück, da sich die zugrunde liegenden Objekte dann ändern.

Der Export-Menüpunkt „Nur angeheftete Auswahl (.xlsx)" (deaktiviert, solange keine Kachel angeheftet ist) exportiert ausschließlich die aktuell angehefteten Elemente als eigenes Sheet „Auswahl" (`exportSelectionToExcel()` in `export-excel.js`), mit einheitlichen Spalten über alle drei Kachel-Typen hinweg (Typ, Source IP/Destination IP, Protokoll, Source Port/Destination Port, Pakete, Bytes, Zeitraum) – unabhängig von der aktuellen Tab-/Filteransicht. Angeheftete Geräte-Paare werden dabei wie im Haupt-Rohdaten-Sheet über `pair.protocolBreakdown` in eine Zeile je Protokoll aufgespalten.

### Geräteliste: angeheftete Auswahl und automatische Nachbarschaftsauswahl

Die Geräteliste im Seitenpanel (`renderDeviceList()` in `app.js`) ist in zwei Gruppen geteilt, jeweils aufsteigend nach Adresse sortiert (`compareDevicesByAddress`): ausgewählte Geräte oben (optisch abgesetzt durch Hintergrundfarbe und eine Trennlinie), alle übrigen darunter. Wird eine Checkbox deaktiviert, verschwindet das Gerät aus der oberen Gruppe und erscheint einsortiert in der unteren.

Ist die Auswahl leer (`state.selectedIds.size === 0`) und wird ein einzelnes Gerät angehakt, werden zusätzlich automatisch alle Geräte ausgewählt, mit denen dieses Gerät mindestens einmal kommuniziert hat (`relatedDeviceIds()` in `data-model.js`, direkte Nachbarschaft über die Paar-Liste, nicht transitiv). So zeigt die Matrix sofort einen sinnvollen Ausschnitt statt eines isolierten Einzelgeräts. Die automatisch mit ausgewählten Geräte sind danach normale, unabhängig abwählbare Checkboxen – die Kaskade greift nur beim Übergang von „keine Auswahl" zu „eine Auswahl", nicht bei weiteren Klicks auf eine bereits nicht-leere Auswahl.

## Web Worker

`parser.worker.js` kapselt den gesamten rechenintensiven Teil (Parsing + Decoding + Aggregation) und kommuniziert über `postMessage`:

- `progress`-Nachrichten (Anteil verarbeiteter Bytes) für die Fortschrittsanzeige.
- Eine abschließende `result`-Nachricht mit dem vollständig aggregierten Datenmodell (Devices + Pairs + Connections).
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
