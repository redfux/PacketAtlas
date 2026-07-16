# Anforderungen – PacketAtlas

Diese Datei dokumentiert die Anforderungen an PacketAtlas. Quelle: `prompt_pcap_kommunikationsmatrix.md` sowie Abstimmung im Architekturplan.

## Projektziel

Rein clientseitige Web-App, die Wireshark-Capture-Dateien (`.pcap`/`.pcapng`) im Browser einliest, parst und daraus eine interaktive Kommunikationsmatrix aller beteiligten Netzwerk-Geräte darstellt. Export als Bild (PNG/SVG) und als Excel-Datei (XLSX) mit den zugrunde liegenden Daten.

**Datenschutz:** Zu keinem Zeitpunkt wird eine Netzwerkverbindung zu einem Server aufgebaut – weder zum Hochladen der Datei noch für Telemetrie, Fonts, Icons o. ä. Die gesamte Verarbeitung läuft ausschließlich im Browser.

## 1. Datei-Import

- [x] Drag & Drop sowie klassischer File-Picker für `.pcap` und `.pcapng`
- [x] Formaterkennung anhand der Magic Number, nicht der Dateiendung
- [x] Verarbeitung in einem Web Worker (UI blockiert nicht bei großen Dateien)
- [x] Fortschrittsanzeige beim Parsen

## 2. Parsing-Anforderungen

- [x] Klassisches libpcap-Format und pcapng (Block-Struktur)
- [x] Link-Layer: Ethernet II und Linux Cooked Capture (SLL)
- [x] Link-Layer: IEEE 802.11 (WLAN), mit und ohne Radiotap-Header – nur Datenframes, Endgeräte statt Access Point als Kommunikationspartner (nachträglich ergänzt, über ursprünglichen Anforderungsumfang hinaus)
- [x] Layer 3: IPv4 und IPv6
- [x] Layer 4: TCP, UDP, ICMP/ICMPv6
- [x] ARP-Sonderfall (Geräteerkennung über MAC-Adressen)
- [x] Pro Paket: Zeitstempel, Quell-/Ziel-MAC, Quell-/Ziel-IP, Ports, Protokoll, Frame-Länge
- [x] Optional: DNS-Hostnamen-Auflösung als Tooltip (nice-to-have)

## 3. Datenmodell „Kommunikationsmatrix"

- [x] Geräte-Erkennung über IP, Fallback MAC (reine ARP-/L2-Geräte)
- [x] Aggregation pro Geräte-Paar (richtungsunabhängig): Pakete, Bytes, Protokolle, Ports, erster/letzter Zeitpunkt
- [x] Aggregation über Map/Dictionary (O(1) Lookup), kein wiederholtes Array-Scannen

## 4. Visualisierung

- [x] Ansicht A – Adjazenzmatrix (Zellfarbe = Kommunikationsvolumen)
- [x] Ansicht B – Force-Directed-Graph (Kantenstärke = Kommunikationsvolumen)
- [x] Beide Ansichten synchron auf derselben gefilterten Geräte-Selektion
- [x] Umschaltbare Metrik (Pakete vs. Bytes) für beide Ansichten
- [x] Tooltip bei Hover (Protokolle, Ports, Pakete/Bytes, Zeitraum)
- [x] Zoom/Pan und einstellbare Kräfte-Parameter für den Graphen (>20–30 Geräte)
- [x] Getrennte Matrix/Graph je Adressfamilie (IPv4 / IPv6 / Sonstige) mit Umschalter, Geräte aufsteigend nach Adresse sortiert (nachträglich ergänzt, über ursprünglichen Anforderungsumfang hinaus)
- [x] Ansicht C – Verbindungen (korrelierte Ansicht: eine Lebenslinie pro Gerät, ein Pfeil pro Kombination aus Geräte-Paar/Protokoll/Port mit Paket-/Byte-Summe, sortiert nach Paketanzahl) (nachträglich ergänzt, über ursprünglichen Anforderungsumfang hinaus)

## 5. Filterung / Teilnehmer-Selektion

- [x] Geräteliste mit Checkboxen (IP, Hostname, Paketanzahl)
- [x] Live-Update von Matrix/Graph bei Auswahländerung
- [x] „Alle auswählen" / „Alle abwählen"
- [x] Freitext-Suche über Geräteliste
- [x] Filter nach Protokoll (TCP/UDP/ICMP/Sonstige)
- [x] Geräteliste aufsteigend nach Adresse sortiert, ausgewählte Geräte dauerhaft oben und optisch abgesetzt (nachträglich ergänzt)
- [x] Bei leerer Auswahl wählt ein einzelnes Gerät automatisch auch alle direkten Kommunikationspartner mit aus; einzeln wieder abwählbar (nachträglich ergänzt)

## 6. Export – Bild

- [x] PNG-Export der aktiven, gefilterten Ansicht
- [x] SVG-Export zusätzlich

## 7. Export – Excel

- [x] `.xlsx` mit Sheet „Matrix" und Sheet „Rohdaten"
- [x] Export berücksichtigt aktuelle Selektion/Filterung

## Backlog (nicht Bestandteil dieser Version)

- **Zeitlicher Verlauf in der Verbindungen-Ansicht:** Eine erste Version zeigte pro Einzelpaket einen chronologisch angeordneten Pfeil (echtes Ablauf-/Sequenzdiagramm wie bei Wiresharks „Flow Graph" bzw. H.225-Signalisierungsdiagrammen). Auf Nutzerwunsch wurde dies zugunsten der korrelierten, nicht-zeitlichen Verbindungsübersicht zurückgestellt – für eine mögliche spätere Version denkbar, ggf. als zuschaltbare Option innerhalb desselben Tabs.

## Edge Cases & Performance

- [x] Sehr große Capture-Dateien (mehrere hunderttausend Pakete)
- [x] Beschädigte/unvollständige Capture-Dateien (Fehler abfangen, kein Absturz)
- [x] Reine Layer-2-Captures (Fallback MAC-basierte Geräteerkennung)
- [x] IPv6-Link-Local/Multicast/Broadcast optional ausblendbar
- [x] Sehr viele Geräte (>50): Matrix bleibt lesbar (Scroll/Zoom, Warnhinweis)
