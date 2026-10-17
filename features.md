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
- [x] Link-Layer: Raw IP (LinkType 101/12/228/229, ohne Link-Layer-Header, z. B. VPN-/Tunnel-Interfaces) – nachträglich ergänzt
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
- [x] Ansicht C – Verbindungen (korrelierte Ansicht: eine Lebenslinie pro Gerät, ein Pfeil pro Kombination aus Geräte-Paar/Protokoll/Port mit Paket-/Byte-Summe, sortiert nach Paketanzahl; Antwort-Traffic erhält einen eigenen, eng gruppierten und optisch abgesetzten zweiten Pfeil statt in der Summe zu verschwinden; bei ICMP/ICMPv6 wird der Nachrichtentyp (z. B. Echo Request/Reply) statt eines Ports angezeigt) (nachträglich ergänzt, über ursprünglichen Anforderungsumfang hinaus)
- [x] Statistik-Kachel **Layer-2-Protokolle** (nachträglich ergänzt): STP/RSTP/MSTP, PVST+, CDP, VTP, DTP, UDLD, LLDP, LACP, EAPOL, Pause, CFM, PTP u. a. mit Anzahl und Geräten; STP-Root-Bridges je VLAN (Warnung bei mehreren), Topologieänderungen (TCN / TC-Flag) mit Absendern, CDP/LLDP-Nachbartabelle (Gerät, Port, Plattform, Management-IP, Fähigkeiten), LACP-Zustand, VLAN-Verteilung (802.1Q und Q-in-Q). Die Namen aus CDP/LLDP beschriften zusätzlich Geräte (über die Management-IP, bei reinen MAC-Geräten über die MAC). L2-Frames erzeugen keine Geräte/Paare in Matrix und Graph.
- [x] Statistik-Kachel **Apple-Protokolle** (nachträglich ergänzt): Apple-Anteil am Verkehr, Gruppen (Push/APNs, FaceTime/iMessage, QUIC/HTTPS zu 17.0.0.0/8, Zeitdienst, AirPlay-Ports), DNS-Anfragen und TLS-SNI nach Apple-Dienst (iCloud, Software-Updates, App Store, Captive Portal, OCSP, CDN, Private Relay), Bonjour/mDNS-Dienste (Apple-typische markiert) und -Hostnamen, Clients mit dem meisten Apple-Verkehr. Listen als versionierte Daten in `classification.js`.
- [x] Statistik-Kachel **DNS-Server** (nachträglich ergänzt): Anbieter-Zuordnung der genutzten Resolver (Cisco Umbrella/OpenDNS, Google, Cloudflare, Quad9, AdGuard, CleanBrowsing, Apple, privat, sonstiger öffentlicher), Anfragen/Fehlercodes je Server, Clients mit mehreren Anbietern (Hinweis auf umgangenen DNS-Filter), DNS über TLS (Port 853) und Verkehr zu bekannten Anbieteradressen auf 443.
- [x] Statistik-Kachel **iCloud Private Relay** (nachträglich ergänzt, Grundlage: Problemanalyse vom 22.07.2026, Apple- und Cisco-Dokumentation): beobachtet mask.icloud.com, mask-h2.icloud.com, mask-api.icloud.com, mask.apple-dns.net; zeigt je Name und je Client, wie das Netz antwortet (NODATA, NXDOMAIN, Adressen, Blockseiten-Adresse aus 146.112.0.0/16, SERVFAIL/REFUSED, ohne Antwort), Antwortzeiten, Abfragehäufigkeit pro Minute und ob Relay-Verkehr (Adressen aus DNS gelernt, QUIC) bzw. Relay-SNI zu sehen ist. Der Status je Client unterscheidet abgeschaltet / erlaubt / aktiv / gestört.
- [x] Statistik-Kacheln Top-Talker (Geräte und Geräte-Paare, gesendet/empfangen) und TLS-Versionen (ausgehandelte Version, veraltete Server, Cipher Suites mit Bewertung) (nachträglich ergänzt)
- [x] Statistik-Kachel DNS (UDP/53): Antwortcodes inkl. NXDOMAIN/SERVFAIL/REFUSED, fehlgeschlagene Namen, Resolver und Clients mit Fehlern, Anfragen ohne Antwort (nachträglich ergänzt)
- [x] Verbindungen-Tab auch als sortierbare Tabelle (Umschalter Diagramm/Tabelle): Qualitätsspalten, Status-Chip, aufklappbare Details mit Problem-Zeitleiste, Filter über die gemeinsame Filterleiste (nachträglich ergänzt)
- [x] Qualität pro Verbindung (nachträglich ergänzt): Status OK/Auffällig/Instabil aus TCP-Retransmits, Lücken, RST, Zero-Window und ICMP-Fehlern; farbige Markierung und Ursache im Verbindungen-Tab, Qualitätsblock mit Handshake-Zeit, Beendigungsart und Problem-Zeitleiste in Tooltip/Kachel, Filter „Nur Probleme anzeigen“ und Metrik „Probleme“ für Matrix/Graph
- [x] Ansicht E – Statistik (Tab über den gesamten Capture, unabhängig von Geräteauswahl und Filterleiste): Protokollverteilung mit Anteilen für Transportprotokoll, Unicast/Multicast/Broadcast und IPv4/IPv6 (umschaltbar Pakete/Bytes), TCP-Gesundheit (Retransmits, Dup-ACKs, Lücken, Out-of-Order, RST, Zero-Window), ICMP-Typen, TCP-Flag-Kombinationen, häufigste Ports, Paketgrößen, MTU-Anhaltspunkte (größtes IP-Paket, TCP-MSS, ICMP-gemeldete MTU) und Fragmentierung (IPv4/IPv6-Fragmente, DF-Bit), Verkehr über die Zeit und auffälligste TCP-Streams (nachträglich ergänzt, über ursprünglichen Anforderungsumfang hinaus)
- [x] Ansicht D – Zeitleiste (Gantt-Diagramm: ein Balken pro Verbindung von erstem bis letztem Zeitpunkt, aufsteigend nach Startzeitpunkt sortiert, zoombare/verschiebbare Zeitachse) (nachträglich ergänzt, über ursprünglichen Anforderungsumfang hinaus)
- [x] Klick auf Zelle/Kante/Knoten/Pfeil/Balken heftet die Detail-Informationen dauerhaft als schließbare Kachel im rechten Panel an, über alle vier Ansichten hinweg (nachträglich ergänzt, über ursprünglichen Anforderungsumfang hinaus)

## 5. Filterung / Teilnehmer-Selektion

- [x] Geräteliste mit Checkboxen (IP, Hostname, Paketanzahl)
- [x] Live-Update von Matrix/Graph bei Auswahländerung
- [x] „Alle“-Checkbox über der Liste (ausgewählt / keins / Zwischenzustand), ersetzt „Alle auswählen“ / „Alle abwählen“ (2.0.0)
- [x] Freitext-Suche über Geräteliste, mit „×"-Button und Escape zum schnellen Leeren
- [x] Filter nach Protokoll (TCP/UDP/ICMP/Sonstige)
- [x] Einheitliche Oberfläche nach „Wer / Was / Wie“ (2.0.0): Seitenleiste = Auswahl der Geräte/Ports, Filterleiste über allen Ansichten = Protokolle, „Nur Probleme“, Multicast/Broadcast (mit Zähler „x von y Verbindungen“), Werkzeugleiste = Ansicht, Adressfamilie, Metrik; Appbar = Datei öffnen/Export; Hell/Auto/Dunkel im Menü; volle Fensterfläche, Seitenleiste einklappbar
- [x] Geräteliste aufsteigend nach Adresse sortiert, ausgewählte Geräte dauerhaft oben und optisch abgesetzt (nachträglich ergänzt)
- [x] Bei leerer Auswahl wählt ein einzelnes Gerät automatisch auch alle direkten Kommunikationspartner mit aus; einzeln wieder abwählbar (nachträglich ergänzt)
- [x] Zweiter Seitenpanel-Reiter „Ports": listet alle im Capture genutzten TCP-/UDP-Ports numerisch aufsteigend, mit bekanntem Dienstnamen in Klammern (z. B. „22 (SSH)"), gefiltert über dieselbe Suche/Protokoll-Chips wie die Geräteliste; ein Häkchen wählt automatisch alle Geräte mit Verbindungen über diesen Port aus (nachträglich ergänzt, über ursprünglichen Anforderungsumfang hinaus)

## 6. Export – Bild

- [x] PNG-Export der aktiven, gefilterten Ansicht
- [x] SVG-Export zusätzlich

## 7. Export – Excel

- [x] `.xlsx` mit Sheet „Matrix" und Sheet „Rohdaten" (Rohdaten mit Source IP/Destination IP-Spalten, eine Zeile je Geräte-Paar und Protokoll)
- [x] Export berücksichtigt aktuelle Selektion/Filterung
- [x] Zusätzlicher Export „Nur angeheftete Auswahl": exportiert ausschließlich die aktuell angehefteten Kacheln als eigenes Sheet, unabhängig von Tab/Filter (nachträglich ergänzt, über ursprünglichen Anforderungsumfang hinaus)

## 8. Export – PCAP (gefiltert)

- [x] Export der Pakete der aktuell sichtbaren Verbindungen (Auswahl und alle Filter, wie die Statistik) als neue `.pcap`-Datei, wahlweise mit vollständigem Payload oder gekürzt auf die Protokoll-Header (nachträglich ergänzt, über ursprünglichen Anforderungsumfang hinaus)
- [x] Der Parse-Worker behält die Datei (bis 1 GiB) und baut den Export daraus – kein erneutes Auswählen nötig; der Dialog nennt vorab Paket- und Verbindungsanzahl
- [x] Fallback für Captures über 1 GiB: Re-Upload der Original-Datei, per SHA-256-Hash gegen die beim Import geladene verifiziert und für die restliche Sitzung gecacht

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

- **Antwortzeit (RTT) in der Verbindungen-Ansicht anzeigen:** In Ansicht C wird pro Pfeil (Geräte-Paar/Protokoll/Port) bisher nur die Paket-/Byte-Summe von Anfrage und zugehöriger Antwort angezeigt, nicht aber der zeitliche Abstand dazwischen. Idee: zusätzlich die Round-Trip-Zeit zwischen einer Anfrage und ihrer korrelierten Antwort ausweisen – naheliegendstes Beispiel ist ICMP Echo Request/Reply (eindeutig korrelierbar über Identifier + Sequenznummer), aber auch der TCP-Drei-Wege-Handshake (SYN → SYN-ACK) käme infrage. Offene Fragen vor einer Umsetzung: welche Protokolle zuerst unterstützt werden (ICMP zuerst, da die Korrelation dort eindeutig und ohne Stream-Tracking möglich ist), ob bei mehreren Anfrage/Antwort-Paaren pro Verbindung ein Einzelwert (z. B. erster Request) oder eine Aggregation (Mittelwert/Min/Max, ggf. auch Jitter als Streuung) sinnvoller ist, und wo der Wert in der UI erscheint (Tooltip vs. zusätzliche Beschriftung am Pfeil). Hängt inhaltlich mit dem Backlog-Punkt „Problematische Verbindungen farblich markieren" zusammen, da eine hohe/schwankende Antwortzeit dort als ein Kriterium einfließen könnte.

- **Syslog-Daten als zusätzliche Import-Option:** Wunsch, neben `.pcap`/`.pcapng` auch Syslog-Daten (z. B. RFC 3164/5424, als `.log`-Datei exportiert) importieren und auswerten zu können. Zentrale offene Frage vor einer Architekturentscheidung: Syslog-Nachrichten sind Einzelereignisse mit einem Absender-Host, aber keine bidirektionale Geräte-Kommunikation wie ein TCP/UDP-Fluss – das bisherige Kernmodell „Kommunikationsmatrix zwischen Geräte-Paaren" passt darauf nicht direkt. Zwei denkbare Stoßrichtungen: (a) ein eigener, von Matrix/Graph/Verbindungen/Zeitleiste unabhängiger neuer Anzeigemodus für Syslog-Einträge (z. B. Liste/Zeitleiste pro Absender-Gerät, filterbar nach Severity/Facility/Hostname), oder (b) sofern Syslog bereits als UDP/TCP-Payload (Port 514) innerhalb eines regulären Captures mitgeschnitten wurde, eine tiefere Dekodierung dieses Protokolls innerhalb des bestehenden Datenmodells (Anzeige der geparsten Syslog-Meldung z. B. im Tooltip). Vor einer Umsetzung zu klären: ob primär eigenständige Log-Dateien oder in Captures enthaltener Syslog-Traffic im Vordergrund steht, da beides sehr unterschiedliche Parser-/UI-Anforderungen hat.

- ~~**UI-Umbau auf ein einheitliches Design System**~~ – umgesetzt in 2.0.0 (siehe Abschnitt 5 und `releases.md`).

- **Statistik nach Auswahl/Filter (abhängig vom UI-Umbau; Plan in Phasen, Stand: Phase 0 bis 4 im Branch `feature/filter-facets` umgesetzt – Facetten, Chips, abgeleitete Paare, Tests, Statistik nach Auswahl, PCAP-Export mit Filtern, Klick-Filter aus der Statistik; offen: Phase 5 Feinschliff):** Der Statistik-Tab soll nicht mehr fix den ganzen Capture zeigen, sondern dynamisch die aktuell sichtbaren Verbindungen. Entschieden: „gefiltert“ heißt weiterhin „beide Endpunkte ausgewählt“ (wie in den übrigen Tabs, zusätzlich Protokoll-Chips, Multicast/Broadcast und „Nur Probleme“). Umsetzungsidee: Statistik-Zähler pro Verbindung im Parse-Worker mitführen (Paketgrößen, TCP-Flags, ICMP-Typen/-Codes, Unicast/Multicast/Broadcast, DNS, TLS, MTU/Fragmentierung, Zeitverlauf auf festem Raster), im Browser die Blöcke der sichtbaren Verbindungen aufsummieren (kein Neuparsen, keine Wartezeit). Schon ohne Worker-Änderung aus vorhandenen Verbindungsdaten ableitbar: Kennzahlen, Transportprotokoll-Verteilung, IPv4/IPv6, TCP-Gesundheit, Ports, Top-Talker. Nur global angebbar: Anzahl nicht auswertbarer Pakete, TCP-Stream-Zähler (im gefilterten Zustand ausblenden). Zu beachten: Speicherbedarf bei Captures mit sehr vielen Verbindungen (Portscans), sparsame Strukturen nötig; Matrix/Graph zeigen bei Protokollfilter bisher die Gesamtsummen der Paare – eine Neuaufbereitung der Paare aus den gefilterten Verbindungen würde beides angleichen.

- **Klick-Filter aus der Statistik (Verbindungsfilter-Chips, abhängig vom vorigen Punkt; umgesetzt in Phase 4 – offen bleiben Zeitfenster-Filter und die Zeilen ohne Facette: TCP-Flags, Keep-Alives, Paketgrößen, MSS, Layer 2, Streams):** Ein Klick auf einen Statistikwert setzt einen Filter, danach zeigen alle Tabs nur noch die passenden Verbindungen. Entschieden: Ein Klick auf ein **Top-Talker-Gerät (bzw. Top-Paar) ändert die Geräteauswahl in der Seitenleiste** (bestehendes Verhalten, dort sichtbar), alle anderen Werte (TLS-Version, Cipher Suite, Port, TCP-Flag, ICMP-Typ, DNS-Antwortcode, Problemtyp, Fragmentierung, MSS) erzeugen einen **Verbindungsfilter-Chip** in einer Chip-Leiste über allen Tabs (mit „×“ und „Alle zurücksetzen“; Chips derselben Gruppe verknüpfen mit ODER, verschiedene Gruppen mit UND). Die angeklickte Kachel zeigt weiterhin die vollständige Verteilung (ohne ihren eigenen Filter) und hebt die gewählten Balken hervor. Protokoll-Chips und „Nur Probleme“ werden dabei zu gewöhnlichen Verbindungsfiltern (einheitliches Filtermodell). Entschieden: **Der PCAP-Export nimmt die Chip-Filter mit** – dazu bekommt der Export-Worker die Liste der sichtbaren Verbindungen (Schlüssel Paar|Protokoll|Service-Port) statt sie selbst aus Geräteauswahl/Protokollen abzuleiten (dann entfällt auch die heutige Lücke bei „Nur Probleme“). Nicht über Verbindungsblöcke exakt möglich: Zeitfenster-Filter und Paketgrößen-Balken (eine Verbindung mischt viele Größen). Vorab ein kleines Node-Testskript für Filter- und Summenlogik anlegen (das Projekt hat bisher keine automatischen Tests).

- **Statistik: Reste zu L2 / Apple / DNS-Server / Private Relay (nach 1.8.0):** (a) „Verbindungen ohne zugehörige DNS-Auflösung“ je Client als zusätzliches Relay-Indiz (braucht je Client eine begrenzte Menge aufgelöster Adressen; Fehlalarme durch DNS-Caches und feste Adressen); (b) Apple-Geräte an den OUIs der MAC-Adressen erkennen (benötigt eine gepflegte, vollständige OUI-Liste; MACs hinter einem Router sind nicht aussagekräftig, zufällige WLAN-MACs ebenfalls nicht); (c) benutzerdefinierte Zuordnung privater Resolver-Adressen zu einem Anbieter (z. B. interner Umbrella-Forwarder/Virtual Appliance), damit „privat“ nicht alles verdeckt; (d) DNS über TCP/53 auswerten und DoH über TLS-SNI erkennen (Adresslisten sehen DoH nur bei bekannten Anbieteradressen); (e) CDP/LLDP: weitere TLVs (PoE, VLAN-Zuordnung, Duplex), Namen auch für reine MAC-Geräte, MSTP-Regionen/Instanzen; (f) QUIC-Erkennung am Paketkopf (Long Header, Version) statt nur über UDP 443.

- **Weitere Statistik-Ideen:** TTL-/Hop-Verteilung, TLS-Server-Namen (SNI), Fragmentierung/MTU pro Verbindung statt nur capture-weit.

- **Problematische Verbindungen farblich markieren (Graph) – teilweise umgesetzt in 1.3.0:** Retransmits, Lücken, RST, Zero-Window und ICMP-Fehler sind inzwischen als Metrik „Probleme“ und als Status in den Ansichten umgesetzt (siehe Ansicht E und releases.md). Auch die Zeitleiste färbt Balken nach Status und markiert einzelne Problem-Zeitpunkte (1.4.0). Offen aus der ursprünglichen Idee: Fragmentierung und Jitter als zusätzliche Kriterien, eine kombinierte „Problem-Ampel“ mit konfigurierbaren Schwellenwerten. Ursprüngliche Beschreibung: Die Graph-Ansicht kodiert Kantenstärke bisher ausschließlich über das Kommunikationsvolumen (Pakete/Bytes). Idee: eine zusätzliche bzw. alternative Färbung von Kanten, die auf mögliche Netzwerkprobleme hinweist – etwa eine hohe Anzahl an TCP-Retransmissions, ein hoher Anteil fragmentierter IP-Pakete, oder eine hohe/stark schwankende Latenz (Jitter, siehe Backlog-Punkt zur RTT-Anzeige). Jedes dieser Kriterien erfordert eigene Vorarbeit im Datenmodell: Retransmit-Erkennung braucht Sequenznummer-Tracking pro TCP-Stream (bereits gesehene Sequenznummern erkennen), Fragmentierung ließe sich über IP-Header-Flags/Fragment-Offset pro Geräte-Paar aufsummieren, Jitter setzt mehrere RTT-Messungen (s. o.) voraus, aus denen eine Streuung berechnet wird. Offene Fragen vor einer Umsetzung: welche(s) Kriterium/Kriterien zuerst umgesetzt werden, ob eine einzelne kombinierte „Problem-Ampel" oder mehrere getrennt umschaltbare Färbungsmodi sinnvoller sind, wie die Farbskala/Schwellenwerte gestaltet werden (analog zum bestehenden Umschalter Pakete/Bytes), und ob bzw. wie sich das performant auch für sehr große Captures berechnen lässt.

## Edge Cases & Performance

- [x] Sehr große Capture-Dateien (mehrere hunderttausend Pakete)
- [x] Beschädigte/unvollständige Capture-Dateien (Fehler abfangen, kein Absturz)
- [x] Reine Layer-2-Captures (Fallback MAC-basierte Geräteerkennung)
- [x] IPv6-Link-Local/Multicast/Broadcast optional ausblendbar
- [x] Sehr viele Geräte (>50): Matrix bleibt lesbar (Scroll/Zoom, Warnhinweis)
