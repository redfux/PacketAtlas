# PacketAtlas

PacketAtlas ist eine rein clientseitige Web-App zur Analyse von Wireshark-Capture-Dateien (`.pcap`/`.pcapng`). Sie liest die Datei direkt im Browser ein, ermittelt alle beteiligten Netzwerk-Geräte und stellt deren Kommunikation als interaktive **Kommunikationsmatrix** und als **Netzwerkgraph** dar. Die Ergebnisse lassen sich als Bild (PNG/SVG) oder als Excel-Datei (XLSX) exportieren.

**Datenschutz:** PacketAtlas baut zu keinem Zeitpunkt eine Netzwerkverbindung auf – kein Upload der Capture-Datei, keine Telemetrie, keine externen Schriften/Icons/Bibliotheken. Die gesamte Verarbeitung (Parsing, Aggregation, Rendering, Export) läuft ausschließlich lokal im Browser. Eine Content-Security-Policy unterbindet externe Verbindungen zusätzlich technisch.

## Setup

Keine Installation, kein Build-Schritt nötig. PacketAtlas ist eine statische Web-App:

1. Repository klonen bzw. Dateien herunterladen.
2. `index.html` über einen lokalen Webserver ausliefern (z. B. `npx serve .` oder `python3 -m http.server`), da Web Worker und ES-Module bei manchen Browsern nicht direkt von `file://` funktionieren.
3. Im Browser öffnen (aktuelle Version von Chrome, Firefox, Edge oder Safari).

## Nutzung

1. **Datei laden:** Capture-Datei per Drag & Drop auf die markierte Fläche ziehen oder über den Datei-Auswahl-Dialog öffnen. Während des Parsens zeigt ein Fortschrittsbalken den aktuellen Stand.
2. **Ansicht wählen:** Über die Tabs oben zwischen **Matrix** (Adjazenzmatrix) und **Graph** (Force-Directed-Netzwerkgraph) wechseln. Beide Ansichten zeigen dieselbe gefilterte Geräteauswahl.
3. **Metrik wählen:** Umschalter „Pakete / Bytes" bestimmt, welche Größe für Zellfarbe bzw. Kantenstärke verwendet wird.
4. **Filtern:** Im linken Seitenpanel Geräte über Checkboxen ein-/ausblenden, per Suchfeld nach IP-Teilstring filtern, nach Protokoll filtern oder Multicast-/Broadcast-Verkehr ausblenden. „Alle auswählen" / „Alle abwählen" für schnellen Reset.
5. **Details ansehen:** Beim Überfahren einer Matrixzelle bzw. einer Kante/eines Knotens im Graphen erscheint ein Tooltip mit Protokollen, Ports, Paket-/Bytezahl und Zeitraum der Kommunikation.
6. **Exportieren:**
   - **Bild:** Export-Button exportiert die aktuell aktive, gefilterte Ansicht als PNG oder SVG.
   - **Excel:** Export-Button erzeugt eine `.xlsx`-Datei mit den Sheets „Matrix" und „Rohdaten" auf Basis der aktuellen Filterung.

## Grenzen

- Bei sehr großen Captures (mehrere hunderttausend Pakete) kann das Parsen je nach Rechner einige Sekunden dauern; die UI bleibt dabei responsiv (Web Worker).
- Beschädigte oder unvollständige Capture-Dateien werden erkannt und mit einer verständlichen Fehlermeldung quittiert, statt die App abstürzen zu lassen.
- Bei sehr vielen Geräten (> 50) empfiehlt sich eine Filterung, damit Matrix und Graph lesbar bleiben.

Weitere technische Details siehe [architecture.md](architecture.md).

---

*thought up by human, created by ai*
