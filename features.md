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

- [x] Ansicht A – Adjazenzmatrix (Zellfarbe = Kommunikationsvolumen); die beiden Zellen eines Geräte-Paares zeigen jeweils nur ihre eigene Richtung, mit Symbol für Verbindungsaufbau vs. Antwort (nachträglich ergänzt, über ursprünglichen Anforderungsumfang hinaus)
- [x] Ansicht B – Force-Directed-Graph (Kantenstärke = Kommunikationsvolumen)
- [x] Beide Ansichten synchron auf derselben gefilterten Geräte-Selektion
- [x] Umschaltbare Metrik (Pakete vs. Bytes) für beide Ansichten
- [x] Tooltip bei Hover (Source IP → Destination IP mit einem Pfeil, der zeigt, wer initiiert hat; Protokolle, Source Port/Destination Port, Pakete/Bytes, Zeitraum)
- [x] Zoom/Pan und einstellbare Kräfte-Parameter für den Graphen (>20–30 Geräte)
- [x] Getrennte Matrix/Graph je Adressfamilie (IPv4 / IPv6 / Sonstige) mit Umschalter, Geräte aufsteigend nach Adresse sortiert (nachträglich ergänzt, über ursprünglichen Anforderungsumfang hinaus)
- [x] Ansicht C – Verbindungen (korrelierte Ansicht: eine Lebenslinie pro Gerät, ein Pfeil pro Kombination aus Geräte-Paar/Protokoll/Port mit Paket-/Byte-Summe, sortiert nach Paketanzahl; Antwort-Traffic erhält einen eigenen, eng gruppierten und optisch abgesetzten zweiten Pfeil statt in der Summe zu verschwinden) (nachträglich ergänzt, über ursprünglichen Anforderungsumfang hinaus)
- [x] Ansicht D – Zeitleiste (Gantt-Diagramm: ein Balken pro Verbindung von erstem bis letztem Zeitpunkt, aufsteigend nach Startzeitpunkt sortiert, zoombare/verschiebbare Zeitachse) (nachträglich ergänzt, über ursprünglichen Anforderungsumfang hinaus)
- [x] Klick auf Zelle/Kante/Knoten/Pfeil/Balken heftet die Detail-Informationen dauerhaft als schließbare Kachel im rechten Panel an, über alle vier Ansichten hinweg (nachträglich ergänzt, über ursprünglichen Anforderungsumfang hinaus)

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

- [x] `.xlsx` mit Sheet „Matrix" und Sheet „Rohdaten" (Rohdaten mit Source IP/Destination IP-Spalten, eine Zeile je Geräte-Paar und Protokoll)
- [x] Export berücksichtigt aktuelle Selektion/Filterung
- [x] Zusätzlicher Export „Nur angeheftete Auswahl": exportiert ausschließlich die aktuell angehefteten Kacheln als eigenes Sheet, unabhängig von Tab/Filter (nachträglich ergänzt, über ursprünglichen Anforderungsumfang hinaus)

## Backlog (nicht Bestandteil dieser Version)

- **Zeitlicher Verlauf auf Einzelpaket-Ebene:** Eine erste Version der Verbindungen-Ansicht zeigte pro Einzelpaket einen chronologisch angeordneten Pfeil (echtes Ablauf-/Sequenzdiagramm wie bei Wiresharks „Flow Graph" bzw. H.225-Signalisierungsdiagrammen). Auf Nutzerwunsch wurde dies zugunsten der korrelierten, nicht-zeitlichen Verbindungsübersicht zurückgestellt. Die später ergänzte Zeitleiste (Ansicht D) bringt zwar wieder eine Zeitachse zurück, aber nur auf Ebene „erster/letzter Zeitpunkt je Verbindung" (Gantt-Balken) – eine Einzelpaket-genaue Chronologie (einzelne Pakete als Punkte/Marker auf der Zeitleiste, nicht nur Start/Ende) bleibt weiterhin zurückgestellt, für eine mögliche spätere Version denkbar.

- **Meraki-Import (Packet Capture / „Intelligent Capture" direkt aus der Cloud laden):** Recherchiert am 2026-07-16, noch nicht umgesetzt.

  Die Meraki Dashboard API stellt eine dedizierte Endpunkt-Familie unter `/organizations/{organizationId}/devices/packetCapture/...` bereit: gespeicherte Captures aus „Packet Capture" (klassisch, MX/MS) bzw. „Intelligent Capture" (MR-APs, MS 17.1+, inkl. Anzeige über den dashboard-eigenen „Packet Viewer") auflisten (`GET .../packetCapture/captures`), neue Aufnahmen starten (`POST .../packetCapture/captures`, Bulk-Variante für mehrere Geräte), eine Aufnahme stoppen sowie eine presigned Download-URL für eine gespeicherte Aufnahme erzeugen (`POST .../captures/{captureId}/downloadUrl/generate`). Dateien liegen im Standard-PCAP-Format vor; Cloud-Retention ist zeitlich begrenzt (APs i. d. R. 90 Tage, „Proactive PCAP" 7 Tage, Switches zusätzlich auf max. 1.200 s/20 MB pro Datei gedeckelt). Offen und vor einer Umsetzung zu verifizieren: ob WLAN-Aufnahmen als entschlüsselte Ethernet-Frames oder als rohe 802.11-Frames (mit/ohne Radiotap) geliefert werden.

  **Kernproblem ist nicht die API, sondern die Architektur:** (1) Die Meraki-API unterstützt kein CORS für direkte Browser-Aufrufe – ein Aufruf direkt aus PacketAtlas scheitert am `Access-Control-Allow-Origin`-Header. (2) Der Meraki-API-Key hängt an den Rechten des zugehörigen Dashboard-Admin-Accounts (kein granulares Scoping, selbst „Read-only" erlaubt noch Port-Cycling) und dürfte niemals im Client-JS von PacketAtlas landen, da dort für jeden im Seitenquelltext sichtbar. Beides zusammen erfordert zwingend eine Server-Komponente (Proxy, der den Key hält) – ein direkter „Von Meraki laden"-Button aus dem Browser heraus ist ohne Backend nicht möglich und würde dem bisherigen Kernversprechen von PacketAtlas („baut zu keinem Zeitpunkt eine Netzwerkverbindung auf", durchgesetzt per CSP `connect-src 'none'`) widersprechen.

  **Lösungsoptionen (Bewertung, keine davon umgesetzt):**
  - **A – Rein manuell:** Nutzer lädt die `.pcap` selbst im Meraki-Dashboard/per eigenem API-Aufruf herunter und zieht sie wie bisher per Drag & Drop in PacketAtlas. Kein Code-Aufwand, ändert nichts an der App, löst aber nicht den Wunsch nach „direkt laden".
  - **B – Optionaler lokaler Bridge-Helper (empfohlener Kompromiss):** Ein kleines, separates Skript (Node/Python), das der Nutzer selbst lokal startet und dort den API-Key hält; stellt PacketAtlas darüber Capture-Listen + Downloads bereit. PacketAtlas bekäme einen klar als „experimentell/optional" gekennzeichneten Menüpunkt „Von Meraki laden", der ausschließlich mit gelockerter CSP (`connect-src` nur für `localhost` freigegeben) funktioniert; der Standard-Build ohne diesen Helfer bliebe unverändert privat/offline.
  - **C – Genereller CORS-Proxy/Cloud-Backend:** Nicht empfohlen – voller Architekturbruch, zusätzliche Angriffsfläche, passt am wenigsten zum „keine Server-Abhängigkeit"-Ansatz von PacketAtlas.

  Bei Umsetzung: Option B, aber explizit als optionalen, deutlich gekennzeichneten Modus mit eigenem Hinweis in der UI und eigenem Abschnitt in `architecture.md`/`THIRD_PARTY_LICENSES.md`, dass dieser Modus die „keine Netzwerkverbindung"-Garantie nur in diesem Fall aufhebt.

## Edge Cases & Performance

- [x] Sehr große Capture-Dateien (mehrere hunderttausend Pakete)
- [x] Beschädigte/unvollständige Capture-Dateien (Fehler abfangen, kein Absturz)
- [x] Reine Layer-2-Captures (Fallback MAC-basierte Geräteerkennung)
- [x] IPv6-Link-Local/Multicast/Broadcast optional ausblendbar
- [x] Sehr viele Geräte (>50): Matrix bleibt lesbar (Scroll/Zoom, Warnhinweis)
