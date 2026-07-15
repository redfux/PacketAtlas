# Changelog

Alle nennenswerten Änderungen an PacketAtlas werden in dieser Datei dokumentiert.

Das Format orientiert sich an [Keep a Changelog](https://keepachangelog.com/de/1.0.0/),
die Versionierung folgt [Semantic Versioning](https://semver.org/lang/de/).

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
