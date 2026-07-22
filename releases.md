# Changelog

Alle nennenswerten Änderungen an PacketAtlas werden in dieser Datei dokumentiert.

Das Format orientiert sich an [Keep a Changelog](https://keepachangelog.com/de/1.0.0/),
die Versionierung folgt [Semantic Versioning](https://semver.org/lang/de/).

## [0.8.0] – 2026-07-16

### Added

- Klick auf eine Matrixzelle, Graph-Kante/-Knoten, einen Verbindungen-Pfeil oder einen Zeitleiste-Balken heftet die Tooltip-Informationen dauerhaft als schließbare Kachel im neuen rechten Panel an, über alle vier Ansichten hinweg. Nützlich, um z. B. mehrere Verbindungen eines Clients zu verschiedenen Servern gleichzeitig zu vergleichen.
- Neuer Export-Menüpunkt „Nur angeheftete Auswahl (.xlsx)" exportiert ausschließlich die aktuell angehefteten Kacheln als eigenes Sheet, unabhängig von der aktuellen Tab-/Filteransicht.

### Changed

- Zeitleiste: Zeilen sind jetzt aufsteigend nach Startzeitpunkt sortiert (früheste Verbindung oben, späteste unten) statt nach Geräte-Paar gruppiert.
- Tooltips/Kacheln zeigen Ports nicht mehr als vermischte Liste, sondern eindeutig zugeordnet: bei Geräte-Paaren „Ports bei ⟨Gerät A⟩" / „Ports bei ⟨Gerät B⟩" (da ein Paar beide Richtungen aggregiert), bei einzelnen Verbindungen „Quell-Port" / „Ziel-Port" (vom ersten Paket der jeweiligen Verbindung).

## [0.7.0] – 2026-07-16

### Added

- Neues viertes Tab „Zeitleiste": Gantt-Diagramm derselben Verbindungen (Geräte-Paar + Protokoll + Port) wie im Verbindungen-Tab, aber als Zeilen mit einem Balken von erstem bis letztem beobachteten Zeitpunkt statt als Pfeil-Diagramm. Zeilen sind nach Geräte-Paar gruppiert; die Zeitachse ist per Mausrad zoombar und per Ziehen verschiebbar, mit fix positionierter Beschriftungsspalte links. Bei sehr vielen Verbindungen werden nur die ersten 300 gezeichnet (Warnhinweis bei Überschreitung).

## [0.6.0] – 2026-07-16

### Changed

- Das „Sequenz"-Tab (chronologisches Ablauf-/Sequenzdiagramm je Einzelpaket) wurde durch ein „Verbindungen"-Tab ersetzt: eine korrelierte, nicht-zeitliche Übersicht mit einem Pfeil pro eindeutiger Kombination aus Geräte-Paar, Protokoll und Port, beschriftet mit Paketanzahl, sortiert nach Paketanzahl absteigend. Der zeitliche Verlauf ist als mögliche spätere Erweiterung im Backlog vorgemerkt (siehe features.md).
- Der Worker aggregiert dafür jetzt vollständig und unbegrenzt „Connections" (Geräte-Paar + Protokoll + Service-Port) anstelle eines auf 20.000 Einzelpakete begrenzten chronologischen Ereignis-Logs.

## [0.5.1] – 2026-07-16

### Fixed

- Sequenz-Ansicht erschien bei vielen ausgewählten Geräten leer, weil das Diagramm ungebremst in seiner vollen (bei vielen Geräten/Paketen sehr großen) natürlichen Größe gezeichnet wurde und der sichtbare Ausschnitt zufällig keine Linien enthalten konnte. Das Diagramm wird jetzt beim Öffnen automatisch per Zoom-to-Fit vollständig eingepasst; Zoom/Pan sind danach frei nutzbar.

## [0.5.0] – 2026-07-15

### Added

- Neues drittes Tab „Sequenz": Ablauf-/Sequenzdiagramm je Einzelpaket im Stil von Wiresharks „Flow Graph" (bzw. klassischer Signalisierungsdiagramme wie bei H.225/H.323) – eine Lebenslinie pro ausgewähltem Gerät, ein chronologisch angeordneter, mit Protokoll/Ports beschrifteter Pfeil pro Paket. Aus Performance-/Lesbarkeitsgründen werden höchstens 400 Pakete gleichzeitig gezeichnet (Warnhinweis bei mehr).
- Der Worker hält dafür zusätzlich ein begrenztes chronologisches Einzelpaket-Log (max. 20.000 Pakete, unabhängig von der Gesamtgröße der Datei); die Geräte-/Paar-Aggregation bleibt davon unberührt und weiterhin vollständig.

## [0.4.0] – 2026-07-15

### Added

- Geräteliste im Seitenpanel: ausgewählte Geräte werden dauerhaft oben in der Liste angezeigt, optisch von den übrigen Einträgen abgesetzt; wird ein Gerät abgewählt, wandert es zurück in die restliche Liste. Beide Gruppen sind aufsteigend nach Adresse sortiert.
- Bei komplett leerer Auswahl wählt ein Klick auf ein einzelnes Gerät automatisch auch alle Geräte mit aus, mit denen es tatsächlich kommuniziert hat – jedes davon lässt sich danach unabhängig wieder abwählen.

## [0.3.0] – 2026-07-15

### Added

- Matrix und Graph zeigen IPv4- und IPv6-Geräte nicht mehr gemeinsam, sondern getrennt, umschaltbar über einen neuen „IPv4 / IPv6 / Sonstige"-Umschalter in der Toolbar. „Sonstige" bündelt Geräte, die nur über ihre MAC-Adresse bekannt sind.
- Geräte werden innerhalb der gewählten Adressfamilie aufsteigend nach Adresse sortiert (IPv4 numerisch pro Oktett, IPv6 numerisch pro Gruppe, MAC alphabetisch) – sowohl in Matrix/Graph als auch im XLSX-Export.

## [0.2.0] – 2026-07-15

### Added

- Link-Layer-Unterstützung für IEEE-802.11-WLAN-Captures (LinkType 105 und 127 mit Radiotap-Header). Es werden nur Datenframes ausgewertet (Beacons, Probe-/Management- und Control-Frames sowie Null-/QoS-Null-Frames ohne Nutzlast werden übersprungen). Die Matrix zeigt die tatsächlich kommunizierenden Endgeräte, nicht den Access Point als Relais.

## [0.1.1] – 2026-07-15

### Fixed

- Parsing echter Capture-Dateien konnte in manchen Browsern mit „Fehler beim Parsen: undefined" fehlschlagen, weil der Web Worker als ES-Modul-Worker geladen wurde (unzuverlässig in manchen Browsern, z. B. Firefox < 114). `parser.worker.js` ist jetzt ein klassischer Worker mit `importScripts()`.
- Fehlermeldungen bei Worker-Abstürzen zeigen jetzt einen Fallback (Dateiname/Zeile), falls keine `message` vorliegt, statt „undefined" anzuzeigen.

## [0.1.0] – 2026-07-15

### Added

- Erste lauffähige Version von PacketAtlas.
- Import von `.pcap`- und `.pcapng`-Dateien per Drag & Drop oder File-Picker, Formaterkennung über Magic Number.
- Parsing im Web Worker für Ethernet II, Linux Cooked Capture (SLL), IPv4, IPv6, ARP, TCP, UDP, ICMP/ICMPv6.
- Kommunikationsmatrix-Datenmodell mit Map-basierter Aggregation pro Geräte-Paar.
- Adjazenzmatrix-Ansicht und Force-Directed-Graph-Ansicht (synchron, mit Metrik-Umschaltung Pakete/Bytes).
- Geräte-Filterpanel mit Suche, Protokollfilter und Multicast/Broadcast-Ausblendung.
- Export der aktiven Ansicht als PNG und SVG.
- Export der gefilterten Kommunikationsmatrix als XLSX (Sheets „Matrix" und „Rohdaten").
- Optionale DNS-Hostnamen-Auflösung für Tooltips.
