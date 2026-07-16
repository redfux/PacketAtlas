# PacketAtlas

PacketAtlas ist eine rein clientseitige Web-App zur Analyse von Wireshark-Capture-Dateien (`.pcap`/`.pcapng`). Sie liest die Datei direkt im Browser ein, ermittelt alle beteiligten Netzwerk-Geräte und stellt deren Kommunikation als interaktive **Kommunikationsmatrix** und als **Netzwerkgraph** dar. Die Ergebnisse lassen sich als Bild (PNG/SVG) oder als Excel-Datei (XLSX) exportieren.

**Datenschutz:** PacketAtlas baut zu keinem Zeitpunkt eine Netzwerkverbindung auf – kein Upload der Capture-Datei, keine Telemetrie, keine externen Schriften/Icons/Bibliotheken. Die gesamte Verarbeitung (Parsing, Aggregation, Rendering, Export) läuft ausschließlich lokal im Browser. Eine Content-Security-Policy unterbindet externe Verbindungen zusätzlich technisch.

## Setup

Keine Installation, kein Build-Schritt nötig. PacketAtlas ist eine statische Web-App – **`index.html` darf aber nicht direkt per Doppelklick (`file://`) geöffnet werden**: Browser blockieren aus Sicherheitsgründen ES-Module und Web Worker auf `file://`-Seiten, wodurch Datei-Auswahl und Drag & Drop wirkungslos blieben. Stattdessen über einen lokalen Webserver ausliefern:

1. Repository klonen bzw. Dateien herunterladen.
2. Lokalen Webserver starten:
   - **macOS, am einfachsten:** Doppelklick auf [`start-local-server.command`](start-local-server.command) – startet einen Server auf Port 8080 und öffnet PacketAtlas automatisch im Standardbrowser.
   - **Alternativ per Terminal** (z. B. `npx serve .` oder `python3 -m http.server` im Projektordner), danach `http://localhost:<port>` manuell öffnen.
3. Aktuelle Version von Chrome, Firefox, Edge oder Safari verwenden.

## Nutzung

1. **Datei laden:** Capture-Datei per Drag & Drop auf die markierte Fläche ziehen oder über den Datei-Auswahl-Dialog öffnen. Während des Parsens zeigt ein Fortschrittsbalken den aktuellen Stand.
2. **Ansicht wählen:** Über die Tabs oben zwischen **Matrix** (Adjazenzmatrix) und **Graph** (Force-Directed-Netzwerkgraph) wechseln. Beide Ansichten zeigen dieselbe gefilterte Geräteauswahl.
3. **Adressfamilie wählen:** Umschalter „IPv4 / IPv6 / Sonstige" zeigt jeweils nur die Geräte und Kommunikation einer Adressfamilie – IPv4 und IPv6 werden nie gemeinsam in einer Matrix dargestellt. Nach dem Laden wird automatisch die erste vorhandene Familie ausgewählt; Optionen ohne passende Geräte sind ausgegraut. Innerhalb der gewählten Familie sind Geräte in Matrix und Excel-Export aufsteigend nach Adresse sortiert.
4. **Metrik wählen:** Umschalter „Pakete / Bytes" bestimmt, welche Größe für Zellfarbe bzw. Kantenstärke verwendet wird.
5. **Filtern:** Im linken Seitenpanel Geräte über Checkboxen ein-/ausblenden, per Suchfeld nach IP-Teilstring filtern, nach Protokoll filtern oder Multicast-/Broadcast-Verkehr ausblenden. „Alle auswählen" / „Alle abwählen" für schnellen Reset. Ausgewählte Geräte stehen dauerhaft oben in der Liste (optisch abgesetzt, durch eine Trennlinie von den restlichen Einträgen getrennt); wird ein Häkchen entfernt, wandert das Gerät zurück in die restliche, ebenfalls aufsteigend sortierte Liste. Sind alle Geräte abgewählt, wählt ein Klick auf ein einzelnes Gerät automatisch auch alle Geräte mit aus, mit denen es tatsächlich kommuniziert hat – einzelne davon lassen sich danach jederzeit wieder abwählen.
6. **Details ansehen:** Beim Überfahren einer Matrixzelle bzw. einer Kante/eines Knotens im Graphen erscheint ein Tooltip mit Protokollen, Ports, Paket-/Bytezahl und Zeitraum der Kommunikation.
7. **Exportieren:**
   - **Bild:** Export-Button exportiert die aktuell aktive, gefilterte Ansicht als PNG oder SVG.
   - **Excel:** Export-Button erzeugt eine `.xlsx`-Datei mit den Sheets „Matrix" und „Rohdaten" auf Basis der aktuellen Filterung.

## Grenzen

- Bei sehr großen Captures (mehrere hunderttausend Pakete) kann das Parsen je nach Rechner einige Sekunden dauern; die UI bleibt dabei responsiv (Web Worker).
- Beschädigte oder unvollständige Capture-Dateien werden erkannt und mit einer verständlichen Fehlermeldung quittiert, statt die App abstürzen zu lassen.
- Bei sehr vielen Geräten (> 50) empfiehlt sich eine Filterung, damit Matrix und Graph lesbar bleiben.
- Unterstützte Link-Layer: Ethernet II, Linux Cooked Capture (SLL) sowie IEEE-802.11-WLAN (mit/ohne Radiotap-Header, nur Datenframes). Andere Link-Layer-Typen werden nicht dekodiert – die App meldet dann „Es konnten keine Geräte erkannt werden".

Weitere technische Details siehe [architecture.md](architecture.md).

---

*thought up by human, created by ai*
