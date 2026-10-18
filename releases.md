# Changelog

Alle nennenswerten Änderungen an PacketAtlas werden in dieser Datei dokumentiert.

Das Format orientiert sich an [Keep a Changelog](https://keepachangelog.com/de/1.0.0/),
die Versionierung folgt [Semantic Versioning](https://semver.org/lang/de/).

## [2.1.0] – 2026-10-18

Filter, Facetten und Statistik nach Auswahl (Plan siehe `features.md`): weitere Filter in der Filterleiste, Statistik und PCAP-Export folgen den Filtern, Klick-Filter aus der Statistik. Ohne aktive Zusatzfilter sieht die Anwendung wie 2.0.0 aus.

### Added

- **Weitere Filter (Facetten)** in der Filterleiste: Menü „+ Filter“ listet, was der Capture hergibt – Port, Problem (Retransmits, Lücken, RST, Zero-Window, Dup-ACKs, Out-of-Order, ICMP-Fehler), TLS-Version, Cipher Suite, ICMP-Typ, DNS-Antwortcode, DNS-Anbieter, Private-Relay-Zustand (abgefragt, NODATA, NXDOMAIN, Adressen, Blockseite, Fehler, Relay-Verkehr, Relay-SNI), Apple-Dienst und IP-Fragmentierung – jeweils mit der Anzahl betroffener Verbindungen. Gewählte Werte erscheinen als entfernbare Chips („TLS-Version: TLS 1.0 ×“); Werte einer Gruppe gelten als „oder“, verschiedene Gruppen als „und“. „Alle zurücksetzen“ setzt zusätzlich Protokoll-Chips, „Nur Probleme“ und „Multicast/Broadcast ausblenden“ zurück. Die Filter wirken in Matrix, Graph, Verbindungen (Diagramm und Tabelle), Zeitleiste, Statistik und beim Excel-Export; der Zähler „x von y Verbindungen“ folgt ihnen. Der PCAP-Export berücksichtigt sie noch nicht (nächste Phase).
- **Tests:** `node tests/run.js` (20 Fälle) prüft Analysen, abgeleitete Paare und Filter gegen synthetische, per Skript erzeugte Captures.

- **Statistik nach Auswahl (Phase 2):** Der Statistik-Tab folgt jetzt der Geräteauswahl, den Protokoll-Chips, „Nur Probleme“, „Multicast/Broadcast ausblenden“ und den weiteren Filtern. Der Parse-Worker behält dafür die Capture-Datei im Speicher (bis 1 GiB; bei größeren Dateien zeigt die Statistik wie bisher den gesamten Capture und sagt das) und berechnet die Statistik auf Anfrage nur aus den Paketen der sichtbaren Verbindungen – mit denselben Auswertungen wie im ersten Durchlauf, also exakt, nicht geschätzt. Ohne aktiven Filter werden die Zahlen des ersten Durchlaufs verwendet. Eine Zeile über den Kacheln nennt den Umfang („8 von 15 Verbindungen nach den aktuellen Filtern“); Top-Talker und Gerätepaare rechnen ebenfalls auf der Auswahl. Ergebnisse werden je Auswahl zwischengespeichert, während einer Berechnung bleibt die alte Anzeige abgedunkelt stehen, und eine neuere Anfrage beendet eine ältere. Der IPv4/IPv6-Umschalter gilt in der Statistik nicht. Layer-2-Protokolle und VLAN-Frames gehören zu keiner Verbindung: die Kachel zeigt immer den gesamten Capture und sagt das.
- **Tests:** `tests/scope.test.js` (7 weitere Fälle, zusammen 27) prüft: Scope „alle Verbindungen“ = Gesamtdurchlauf, Teilmengen zählen nur ihre Pakete, leerer Scope, Fehlerfall ohne Datei, ältere Anfragen verstummen.
- **PCAP-Export mit Filtern (Phase 3):** Der Export enthält die Pakete der aktuell sichtbaren Verbindungen – Geräteauswahl, Protokoll-Chips, „Auffällige Verbindungen“, Multicast/Broadcast und weitere Filter (die Adressfamilie gilt wie bei der Statistik nicht). Der Dialog nennt vorab Paket- und Verbindungsanzahl und sperrt „Exportieren“, wenn nichts passt.
- **Tests:** `tests/export.test.js` (6 weitere Fälle, zusammen 33) prüft: Export aller Verbindungen = alle Pakete mit Verbindung, Teilmengen, Layer-2-Frames fehlen, „Ohne Payload“ kürzt, leerer Scope, Fehlerfall ohne Datei.

- **Klick-Filter aus der Statistik (Phase 4):** Zeilen der Statistik-Karten setzen Filter-Chips (Problemarten, ICMP-Typen, Ports, DNS-Antwortcodes, DNS-Anbieter, Antworten auf Relay-Namen, Apple-Dienste, TLS-Versionen, Cipher Suites, Fragmente); aktive Werte sind mit ✓ markiert, auch per Tastatur (Tab, Enter/Leertaste) bedienbar. Top-Talker-Geräte setzen die Geräteauswahl (Gerät und Kommunikationspartner), Gerätepaare genau die zwei Geräte. Die Karte eines aktiven Filters zeigt die Werte ohne ihren eigenen Filter – dafür berechnet der Worker im selben Durchlauf zusätzliche Statistiken (`extras` in der `scope`-Nachricht).
- **Tests:** ein weiterer Fall in `tests/scope.test.js` (zusammen 34): Zusatz-Scopes im selben Durchlauf = eigene Anfragen.

### Fixed

- Das „+ Filter“-Menü ragte auf kleinen Bildschirmen über den unteren Rand hinaus und ließ sich nicht scrollen; die Höhe richtet sich jetzt nach dem Platz unterhalb der Schaltfläche.

### Changed

- **„Nur Probleme“ heißt „Auffällige Verbindungen“ und ist jetzt eine Filter-Facette:** Der Chip in der Filterleiste bleibt als Schnellzugriff, setzt aber denselben Filter wie „+ Filter → Problem → Auffällig (beliebiges Problem)“ (Verbindungen mit Retransmits, Lücken, RST, Zero-Window oder ICMP-Fehlern, wie bisher). Er erscheint damit auch als Chip in der Leiste und lässt sich mit den Problemarten kombinieren. Der Sonderweg `state.onlyProblems` entfällt.
- **PCAP-Export ohne erneutes Auswählen der Datei:** Der Parse-Worker baut die Datei aus der von ihm behaltenen Capture (`{type:'export'}`); Upload und Prüfsummen-Schritt entfallen. Nur Captures über 1 GiB nutzen weiter den bisherigen Weg (Original-Datei erneut wählen, Prüfsumme, `pcap-export.worker.js`).
- **Export arbeitet auf Verbindungsebene statt je Paket:** Maßgeblich ist, ob die Verbindung (Geräte-Paar + Protokoll + Dienst-Port) sichtbar ist – wie in allen Ansichten. „Auffällige Verbindungen“ und die weiteren Filter wirken jetzt auch auf den Export; Layer-2-Steuerframes sind wie bisher nicht enthalten.
- Neues gemeinsames Skript `capture-scope.js` (Verbindungsschlüssel, Frame-Parsing, PCAP-Aufbau) für `parser.worker.js` und `pcap-export.worker.js`; `pairKey()`/`servicePortOf()`/`connectionKeyOf()` sind dorthin umgezogen, die duplizierte Protokollgruppen-Logik im Export-Worker entfällt.
- **Matrix, Graph und Excel-Export rechnen aus den sichtbaren Verbindungen.** Der Worker liefert keine Paare mehr; sie werden im Browser aus den Verbindungen abgeleitet (`derivePairs()`). Sichtbare Folge: Ein Protokoll-Chip oder „Auffällige Verbindungen“ verkleinert jetzt auch die Paket-/Byte-Summen und Port-Listen eines Paares (bisher blieben die Gesamtsummen stehen und es wurden nur Paare ausgeblendet), und „Multicast/Broadcast ausblenden“ blendet nur die betroffenen Verbindungen aus, nicht jedes Paar, das irgendwann ein Multicast-Paket hatte. Ohne aktive Filter sind die abgeleiteten Paare identisch zu den bisherigen (geprüft an den synthetischen Captures und drei echten Captures).
- Verbindungen tragen zusätzlich einen Schlüssel (`key`), vollständige Port-Mengen je Richtung und ihre Facetten; die Worker-Nachricht enthält dafür keine Paare mehr.

## [2.0.0] – 2026-10-17

Neue Oberfläche auf Basis eines gemeinsamen Design Systems (Material-Design-3-Grundlage, Theme „Neutral“ in Stahlblau). Funktionen, Datenmodell und Exporte bleiben unverändert; geändert haben sich Aufbau, Bedienelemente und Aussehen – daher Hauptversion.

### Changed

- **Aufteilung nach „Wer / Was / Wie“:** Seitenleiste = Auswahl der Geräte/Ports; neue **Filterleiste** über allen Ansichten = Protokoll-Chips, „Nur Probleme“, „Multicast/Broadcast ausblenden“ und Zähler „x von y Verbindungen“; Werkzeugleiste = Ansicht (Tabs), Adressfamilie, Metrik; Kopfleiste = „Capture öffnen“ und „Export“. Bisher waren die Filter auf Seitenleiste und Verbindungstabelle verteilt.
- „Nur Probleme“ und „Multicast/Broadcast ausblenden“ sind Chips statt Schalter und gelten für alle Ansichten; die Verbindungstabelle hat keine eigenen Filter-Chips mehr.
- „Alle auswählen“ / „Alle abwählen“ ersetzt eine **„Alle“-Checkbox** mit Zwischenzustand und Zähler „x von y“. Ein Klick auf die Adresse eines Listeneintrags schaltet ihn jetzt ebenfalls um.
- Die App nutzt die **volle Fensterfläche**: Seite scrollt nicht mehr, Seitenleiste, Ansicht und angeheftete Kacheln scrollen jeweils für sich. Die Seitenleiste ist einklappbar; unter 1100 px Breite liegen die angehefteten Kacheln unter der Ansicht.
- **Hell / Auto / Dunkel** ist jetzt im Menü (☰) umschaltbar und wird gespeichert (bisher nur Systemeinstellung).
- **Farbpalette** wählbar im Menü (☰), Zeilen „Farbe“ und „Modus“ (Umschalter rechtsbündig): Stahlblau (Standard), Material-Blau (die Farben bis Version 1.8) oder Petrol; die aktive Farbe hat einen Ring in ihrer Farbe, Namen im Tooltip. Wird gespeichert. Signal- und Diagrammfarben sind in allen Paletten gleich.
- Status OK / Auffällig / Instabil als Badges mit Symbol (✓ ◆ ✖), auch ohne Farbe lesbar; angeheftete Kacheln problematischer Verbindungen haben einen farbigen Rand.
- Matrix-Farbskala folgt dem Theme (Mischung aus Grundfarbe bzw. Rot mit der Oberfläche) statt fester d3-Skalen; die Richtungssymbole sind auf hellen und kräftigen Zellen lesbar.
- Export-Menü und PCAP-Dialog nutzen native Browser-Elemente (Popover, `<dialog>`): Escape und Klick daneben schließen sie; ein laufender PCAP-Export wird beim Schließen beendet.
- Projektdateien: `style.css` → `css/app.css` (nur noch PacketAtlas-Eigenes, ausschließlich Design-Tokens); neu `css/design-tokens.css`, `css/design-components.css`, `js/design-system.js`, `icons/`. `bump-version.sh` versieht auch diese Dateien mit `?v=`.

### Fixed

- Protokoll- und Filter-Chips sahen nach dem Wiedereinschalten noch aus wie ausgeschaltet, solange der Zeiger darauf stand (am Handy bis zum nächsten Tippen) – behoben im Design System 3.1.1 (Hover hellt gedrückte Chips nicht mehr auf).
- Statistik auf dem Handy (hochkant): Die Balken der Top-Talker und anderer Ranglisten verschwanden, Werte ragten aus der Kachel. Unter 640 px stehen Name und Wert jetzt in einer Zeile, der Balken darunter in voller Breite; das Kachelraster verlangt keine 420 px Mindestbreite mehr.

### Removed

- Selbst gehostete Schriften (`fonts/`: Roboto, Material Symbols). Text nutzt die Systemschrift, Icons sind ein Inline-SVG-Sprite.

### Notes

- Content-Security-Policy unverändert streng (`script-src 'self'; style-src 'self'`, `connect-src 'none'`); `font-src` entfällt.
- Geprüft mit einer echten Capture (4.146 Pakete, 76 Geräte): alle fünf Ansichten, Tabelle mit Details, Anheften, Filter-Chips, „Alle“-Checkbox, Suche, Export-Menü, PCAP-Export (Prüfsumme, Aufbau, Download) in hell und dunkel, 1440 px und 375 px.

## [1.8.0] – 2026-10-16

### Added

- Statistik-Tab: neue Kachel **iCloud Private Relay**. Beobachtet die Namen `mask.icloud.com`, `mask-h2.icloud.com`, `mask-api.icloud.com` und `mask.apple-dns.net` (Quellen: Apple „Prepare your network or content filter for iCloud Private Relay“, Cisco „Enable Cisco Umbrella with iCloud Private Relay“, Problemanalyse „Verzögerungen bei der Mail-Synchronisation auf iPhones/iPads“ vom 22.07.2026). Je Name und je Client: Anzahl Abfragen (und pro Minute), Antwortform (NODATA, NXDOMAIN, Adressen, **Blockseiten-Adresse** aus dem Umbrella-Adressraum 146.112.0.0/16, SERVFAIL/REFUSED, ohne Antwort), Antwortzeiten (Ø/max, „langsam“ ab 1 s) und Relay-Nutzung (Verkehr zu einer aus DNS gelernten Relay-Adresse, QUIC, TLS-ClientHello mit Relay-SNI). Ein Hinweis erscheint, wenn Antworten auf Relay-Namen eine Blockseiten-Adresse statt NXDOMAIN/NODATA enthalten – genau die Konstellation, die laut Analyse zu Wiederholversuchen und Timeouts führt.
- Statistik-Tab: neue Kachel **DNS-Server**. Ordnet jeden genutzten Resolver einem Anbieter zu (Cisco Umbrella/OpenDNS, Google, Cloudflare, Quad9, AdGuard, CleanBrowsing, Apple 17.0.0.0/8, privat, sonstiger öffentlicher DNS) mit Anfragen, Antworten und Fehlercodes je Server, zeigt Clients, die mehrere Anbieter nutzen (mit Hinweis, wenn zusätzlich zu einem verwalteten Resolver ein anderer Anbieter befragt wird), DNS über TLS (Port 853) und Verkehr zu bekannten Anbieteradressen auf Port 443 (möglicherweise DoH/DoQ).
- Statistik-Tab: neue Kachel **Apple-Protokolle** (Apple-Anteil, Dienstgruppen, DNS-/SNI-Namen nach Apple-Dienst, Bonjour-Dienste und -Hostnamen, Clients) und neue Kachel **Layer-2-Protokolle** (STP/RSTP/MSTP, PVST+, CDP, VTP, DTP, UDLD, LLDP, LACP, EAPOL u. a.; STP-Root-Bridges, Topologieänderungen, Nachbartabelle aus CDP/LLDP, LACP-Zustand, VLAN-Verteilung). In der Protokollverteilung erscheint „Layer 2“ als eigener Anteil.
- Geräte erhalten, sofern sie keinen DNS-Namen haben, ihren in CDP/LLDP angekündigten Namen als Beschriftung (über die Management-IP; reine MAC-Geräte über ihre MAC). Namen von IP-Geräten werden bewusst nicht über deren MAC vergeben, weil das bei Verkehr hinter einem Router den Router-Namen auf viele Adressen übertragen würde.
- Neue Dateien: `classification.js` (versionierte Listen: DNS-Anbieter-Adressen, Apple-Namensregeln und -Ports, Relay-Namen; Stand im Kopf und in der Oberfläche), `l2-parser.js` (BPDU-, CDP-, LLDP-, LACP-Details). Der Decoder erkennt jetzt Layer-2-Protokolle (802.3-LLC/SNAP und Ethertypes), liest bis zu zwei VLAN-Tags und das SNI aus dem TLS-ClientHello.

### Changed

- Layer-2-Frames, die bisher nur als „nicht auswertbar“ gezählt wurden, sind jetzt dekodiert (`protocol: 'L2'`). Sie fließen nur in die Statistik ein und erzeugen keine Geräte, Paare oder Verbindungen; das Verhalten von Matrix, Graph und PCAP-Export ändert sich dadurch nicht.
- Gelernte IPv6-Adressen aus DNS-Antworten werden jetzt in derselben verkürzten Schreibweise abgelegt wie die Geräte-IDs, sodass Hostnamen auch für IPv6-Geräte angezeigt werden.

## [1.7.0] – 2026-10-15

### Added

- Statistik-Tab: neue Kachel **Top-Talker** mit den zehn Geräten, die den meisten Verkehr erzeugen bzw. empfangen (gestapelter Balken gesendet/empfangen, Summe und Aufschlüsselung als Text), und den zehn aktivsten Geräte-Paaren. Die Rangfolge folgt dem Umschalter Pakete/Bytes. Die Auswertung läuft über alle Paare des Captures, unabhängig von den Sidebar-Filtern, und nutzt die vorhandenen Richtungsdaten der Paare (`computeDeviceTraffic()` in `data-model.js`).
- Statistik-Tab: neue Kachel **TLS-Versionen**. Neue Datei `tls-parser.js` liest am Anfang jedes TCP-Payloads (portunabhängig) ClientHello/ServerHello und zeigt die ausgehandelte Version je ServerHello (TLS 1.3 per `supported_versions`-Extension, sonst Legacy-Feld), Server mit veralteter Version (SSL 3.0, TLS 1.0/1.1, rot), die ausgehandelten Cipher Suites mit Bewertung (grün = ok, gelb = kein Forward Secrecy durch statischen RSA-Schlüsselaustausch, rot = RC4/3DES) und die Anzahl gesehener Hellos. Retransmittierte Segmente werden nicht doppelt gezählt; die Erkennung gilt nur für TLS über TCP und für Handshakes, die im Capture beginnen.

### Fixed

- Inline-`style`-Attribute (Fortschrittsbalken, Icon-Größen im Export-Dialog und in den angehefteten Kacheln, Absatzränder im Export-Dialog) wurden von der CSP (`style-src 'self'`) geblockt und erzeugten Konsolenfehler; die Darstellung war an diesen Stellen unbeabsichtigt anders (z. B. zu große Icons). Sie sind jetzt CSS-Klassen in `style.css`.

### Changed

- Der Pre-Commit-Hook stellt jetzt auch Dateien in den Commit, deren einzige ungespeicherte Änderung die `?v=`-Versionsstrings sind (etwa nach einem manuellen `./bump-version.sh`); Dateien mit anderen Änderungen bleiben unberührt. Der erste 1.7.0-Commit enthielt wegen genau dieser Lücke noch Imports mit `?v=1.6.0` in den Ansichts-Modulen.

## [1.6.0] – 2026-10-14

### Added

- Statistik-Tab: neue Kachel **DNS** (UDP/53) mit Anzahl Anfragen und Antworten, Anteil der Antworten mit Fehlercode, Verteilung der Antwortcodes (NOERROR, NXDOMAIN, SERVFAIL, REFUSED, …), Anfragen ohne Antwort im Capture, den häufigsten fehlgeschlagenen Namen, den Resolvern mit Fehlern (Fehler von Antworten) und den Clients mit den meisten Fehlern. NXDOMAIN ist nicht immer ein Fehler (z. B. Suchdomain-Versuche), deshalb nur gelb, SERVFAIL/REFUSED rot.
- Git-Hook `.githooks/pre-commit`: gleicht beim Commit die `?v=`-Versionsstrings automatisch mit `APP_VERSION` ab und fügt die angepassten Dateien dem Commit hinzu. Ein Release besteht damit nur noch aus der Änderung von `APP_VERSION` in `app.js`; `bump-version.sh` muss nicht mehr von Hand ausgeführt werden. Einmalig pro Clone aktivieren: `git config core.hooksPath .githooks`.

### Security

- Hostnamen aus DNS-Antworten (rohe Bytes, vom Absender frei wählbar) wurden bisher ungeprüft in die Tooltips und angehefteten Kacheln geschrieben. Die CSP verhinderte zwar die Ausführung von Skripten, aber eine präparierte Capture-Datei konnte damit Markup in die Oberfläche einschleusen. Alle Geräte-Beschriftungen in den HTML-Bausteinen werden jetzt escaped (`escapeHtml()` in `data-model.js`).

## [1.5.0] – 2026-10-14

### Added

- **Verbindungen als Tabelle:** Der Verbindungen-Tab hat einen Umschalter „Diagramm / Tabelle“. Die Tabelle zeigt pro Verbindung Verbindung (Quelle → Ziel:Port), Protokoll, Pakete, Retransmits (mit Anteil), Dup-ACKs, RST und einen Status-Chip (OK / Auffällig / Instabil, bei ICMP „n× ICMP-Fehler“). Spaltenköpfe sortieren (Standard: schlechtester Status zuerst), ein Klick auf eine Zeile klappt Details auf: Retransmit-Rate, Handshake-Zeit, Beendet durch, Lücken/Zero-Window/Out-of-Order, Pakete und Bytes, Zeitraum und eine Zeitleiste der Problem-Ereignisse. Über der Tabelle stehen die Filter-Chips „Nur Probleme“, TCP, UDP, ICMP und Sonstige (synchron mit der Seitenleiste) sowie der Zähler „12 von 148 Verbindungen“. Es werden höchstens 500 Zeilen gezeichnet (Hinweis darunter). PNG-/SVG-Export ist in der Tabellenansicht deaktiviert.

### Fixed

- **Veraltete Module nach einem Update:** Browser cachen jedes ES-Modul einzeln (GitHub Pages sendet `max-age=600`), sodass nach einem Update kurzzeitig eine neue `app.js` mit einer alten `data-model.js` laufen konnte und die App mit „does not provide an export named …“ gar nicht startete. Alle Modul-Importe, `style.css` und `app.js` im HTML tragen jetzt die Version als Query-String (`…?v=1.5.0`), sodass der gesamte Dateisatz gemeinsam umschaltet.

### Changed

- Neues Skript `bump-version.sh` setzt die Version an allen Stellen in einem Schritt (`./bump-version.sh 1.5.1`): `APP_VERSION` in `app.js`, alle `import … from './x.js?v=…'` und die Tags in `index.html`. Statische Imports lassen sich nicht aus einer Konstante zusammensetzen, und die CSP verbietet Inline-Skripte/Import-Maps, deshalb steht die Version dort im Klartext und wird per Skript gepflegt. `releases.md` bleibt manuell.

## [1.4.0] – 2026-10-14

### Added

- Zeitleiste: Balken werden wie im Verbindungen-Tab nach Qualität eingefärbt (blau = unauffällig, gelb = auffällig, rot = instabil). Innerhalb eines Balkens markieren helle Striche die einzelnen Probleme (Retransmit, Lücke, RST, Zero-Window) an ihrem Zeitpunkt und bleiben beim Zoomen/Verschieben exakt an ihrer Position. Eine Legende über dem Diagramm erklärt Farben und Striche.

## [1.3.0] – 2026-10-14

### Added

- **Qualität pro Verbindung (Verbindungen-Tab):** Der TCP-Analyse-Kern aus der Statistik ordnet Retransmits, Lücken (fehlende Segmente), RST, Zero-Window, Dup-ACKs und Out-of-Order jetzt den einzelnen Verbindungen (Geräte-Paar + Protokoll + Port) und Geräte-Paaren zu. Auffällige Verbindungen werden im Diagramm farbig markiert (gelb = auffällig, rot = instabil, d. h. mindestens 3 Retransmits und mindestens 2 % der Datensegmente), die Beschriftung des Pfeils nennt die Ursache, z. B. „⚠ 187 Retrans., 3× RST“. ICMP-Fehlermeldungen (Destination Unreachable, Time Exceeded, Parameter Problem, Packet Too Big) zählen ebenfalls als Problem.
- **Tooltip und angeheftete Kachel:** Neuer Block „Qualität“ mit Status-Chip (OK / Auffällig / Instabil), Zählern für Retransmits (mit Anteil), Dup-ACKs, Lücken, RST, Zero-Window und Out-of-Order, Handshake-Zeit (SYN → SYN/ACK, Ø und Maximum), „Beendet durch“ (FIN / RST / offen) und – bei Verbindungen – einer kleinen Zeitleiste, wann die Probleme auftraten. In Graph-Kanten und Matrix-Zellen erscheint dieselbe Auswertung auf Paar-Ebene (Matrix zusätzlich „Probleme in dieser Richtung“).
- **Neuer Filter „Nur Probleme anzeigen“** (Seitenleiste): blendet in Matrix, Graph, Verbindungen und Zeitleiste alle Paare/Verbindungen ohne Problem-Ereignis aus. Er wirkt nicht auf den PCAP-Export.
- **Neue Metrik „Probleme“** (Umschalter Pakete / Bytes / Probleme) für Matrix und Graph: Matrixzellen werden je Richtung rot nach Anzahl der Probleme eingefärbt; im Graph werden Kanten mit Problemen rot und umso dicker, je mehr es sind, Kanten ohne Problem verblassen. Als „Problem“ zählen Retransmits, Lücken, RST, Zero-Window und ICMP-Fehlermeldungen (Dup-ACKs und Out-of-Order bewusst nicht, da sie Folgen desselben Verlusts sind und ihn doppelt zählen würden). Die Metrik gilt auch für den Excel-Export der Matrix.
- Statistik-Tab: TCP-Gesundheit zeigt zusätzlich die Handshake-Zeit (Ø, Minimum, Maximum) über alle TCP-Verbindungen mit sichtbarem SYN/SYN-ACK.

### Changed

- Tooltips nennen die Metrik jetzt auf Deutsch („Pakete“, „Bytes“, „Probleme“) statt mit dem internen Schlüssel.

## [1.2.0] – 2026-10-14

### Added

- Statistik-Tab: neue Kachel **MTU und Fragmentierung**.
  - Fragmentierung: IPv4-Fragmente und IPv6-Fragmente (jeweils mit Anteil an allen Paketen der Adressfamilie), Anzahl fragmentierter Datagramme (= erste Fragmente) und Anzahl IPv4-Pakete mit gesetztem DF-Bit.
  - MTU-Anhaltspunkte: größtes beobachtetes IP-Paket (untere Schranke für die MTU) und größter Frame, die in SYN-/SYN-ACK-Paketen angekündigte TCP-MSS (mit daraus abgeleiteter MTU, getrennt nach IPv4/IPv6) sowie die von Routern per ICMP „Fragmentation needed" bzw. ICMPv6 „Packet Too Big" gemeldete Next-Hop-MTU. Die Pfad-MTU selbst ist im Capture nicht direkt sichtbar, die Werte sind Anhaltspunkte (z. B. MSS 1394 → MTU 1434 deutet auf einen VPN-/Tunnel-Pfad hin).
- Der Decoder liefert dafür zusätzlich IP-Paketlänge, DF-Bit, Fragment-Kennzeichnung (IPv4 und IPv6-Fragment-Header), TCP-MSS-Option und die in ICMP gemeldete MTU.

## [1.1.0] – 2026-10-14

### Added

- Neuer Tab **Statistik** mit Kennzahlen über den gesamten Capture (die Filter der Seitenleiste wirken dort bewusst nicht):
  - Kennzahlen-Kacheln: Pakete, Datenmenge, Dauer, TCP-Retransmit-Rate.
  - **Protokollverteilung** mit drei gestapelten Anteilsbalken: Transportprotokoll (TCP/UDP/ICMP/ARP/Sonstige), Adressierung (Unicast/Multicast/Broadcast) und IP-Version (IPv4/IPv6/kein IP). Der Umschalter „Pakete / Bytes" bestimmt, ob nach Paketanzahl oder Datenvolumen gerechnet wird.
  - **TCP-Gesundheit**: Retransmits (inkl. Fast Retransmits), Dup-ACKs, Lücken (fehlende Segmente), Out-of-Order, RST, Zero-Window und Keep-Alives – ermittelt per Sequenznummern-Tracking pro TCP-Stream nach den Heuristiken von Wiresharks „TCP Analysis".
  - **ICMP-Typen** (inkl. Code bei „Destination Unreachable"), **TCP-Flag-Kombinationen**, **häufigste Ports**, **Paketgrößen-Verteilung**, **Pakete/Datenvolumen über die Zeit** und eine Tabelle der **auffälligsten TCP-Streams**.
- Der Decoder liefert zusätzlich TCP-Flags, Sequenz-/ACK-Nummer, Fenstergröße, TCP-Nutzdatenlänge, ICMP-Code, IP-Version und die Adressierungsart (Unicast/Multicast/Broadcast). Die Auswertung selbst liegt in der neuen Datei `traffic-stats.js` (läuft im Parse-Worker), die Darstellung in `stats-view.js`.

### Fixed

- Nicht-erste IPv4-Fragmente (Fragment-Offset > 0) wurden bisher so behandelt, als stünde an der Stelle des L4-Headers ein TCP-/UDP-Header, und erzeugten dadurch Verbindungen mit zufälligen „Ports". Sie werden jetzt als Protokoll „Sonstige" ohne Ports eingeordnet.

## [1.0.3] – 2026-10-14

### Added

- Suchfeld in der Seitenleiste: Sobald Text im Feld steht, erscheint rechts ein „×"-Button, der das Feld leert (Geräte- und Portliste werden sofort wieder ungefiltert angezeigt, der Fokus bleibt im Feld). Zusätzlich leert die Escape-Taste das Feld. Das native Such-„×" des Browsers ist ausgeblendet, damit es nicht doppelt erscheint.

## [1.0.2] – 2026-10-14

### Fixed

- Captures mit Raw-IP-Link-Type (LinkType 101, sowie 12/228/229), wie sie typischerweise auf VPN-/Tunnel-Interfaces entstehen, wurden bisher komplett verworfen und führten zur Meldung „Es konnten keine Geräte erkannt werden". Pakete ohne Link-Layer-Header werden jetzt direkt ab dem IPv4-/IPv6-Header dekodiert; Geräte werden dabei rein über ihre IP identifiziert (keine MAC-Adressen verfügbar).

## [1.0.1] – 2026-07-23

### Changed

- Erste 1.0-Version: Versionsnummer von 0.15.1 auf 1.0.1 angehoben.
- Versionsnummer intern vereinheitlicht: `APP_VERSION` in `app.js` ist jetzt die einzige Stelle, die bei einem Release-Bump geändert werden muss. Der Footer-Text in `index.html` wird nun zur Laufzeit aus `APP_VERSION` gesetzt statt hartkodiert gepflegt, und `parser.worker.js`/`pcap-export.worker.js` leiten ihre eigene Worker-Version aus dem `?v=`-Query-String ihrer eigenen Worker-URL ab statt aus einer zweiten, separat zu pflegenden Konstante. Keine funktionalen Änderungen am Verhalten der App.

## [0.15.1] – 2026-07-22

### Fixed

- PCAP-Export-Dialog: Bei erfolgreichem Export schloss sich der Dialog sofort automatisch, was wie ein Abbruch/Absturz wirkte. Er zeigt jetzt zwei einzelne Fortschrittsschritte (Prüfsumme, Datei-Erstellung), die bei Erfolg grün mit Häkchen markiert werden, gefolgt von einer expliziten „Export erfolgreich"-Meldung. Der Dialog bleibt offen, bis er über „×" oder Klick außerhalb bzw. den nun „Schließen" beschrifteten Button aktiv geschlossen wird.

## [0.15.0] – 2026-07-22

### Added

- Neuer Export-Menüpunkt „Als PCAP (gefiltert) …": erzeugt aus der Original-Capture-Datei eine neue `.pcap`-Datei mit ausschließlich den aktuell ausgewählten/gefilterten Paketen, wahlweise mit vollständigem Payload oder auf die Protokoll-Header gekürzt (Snaplen-Prinzip, wie `tcpdump -s`/`editcap -s`). Da die Original-Datei nach dem Import nicht dauerhaft im Speicher gehalten wird, fragt der Dialog beim ersten Export einer Sitzung nach der Original-Datei und vergleicht deren SHA-256-Prüfsumme mit der ursprünglich geladenen Datei, um eine versehentliche Verwechslung auszuschließen; danach bleibt sie für weitere Exporte in derselben Sitzung im Speicher.

## [0.14.0] – 2026-07-22

### Added

- Matrix: Beim Überfahren einer Zelle wird jetzt automatisch auch die gegenüberliegende Zelle desselben Geräte-Paares (Zeile↔Spalte vertauscht) hervorgehoben, gekennzeichnet durch einen gestrichelten Rahmen – auch wenn sie an einer ganz anderen Stelle der Matrix liegt, lassen sich so beide Richtungen einer Verbindung auf einen Blick finden.

## [0.13.1] – 2026-07-22

### Fixed

- „Alle auswählen"/„Alle abwählen" saßen unterhalb des Geräte-/Ports-Reiterumschalters und waren dadurch im Ports-Tab unsichtbar. Beide Buttons stehen jetzt oberhalb des Umschalters und sind in beiden Tabs sichtbar.

## [0.13.0] – 2026-07-22

### Added

- Neuer zweiter Seitenpanel-Reiter „Ports" neben „Geräte": listet jeden im Capture genutzten TCP-/UDP-Port numerisch aufsteigend sortiert, mit bekanntem Dienstnamen in Klammern sofern erkannt (z. B. „22 (SSH)", „443 (HTTPS)"). Nutzt dieselbe Suche und dieselben TCP/UDP-Protokoll-Chips wie die Geräteliste. Ein Häkchen bei einem Port wählt automatisch alle Geräte aus, die mindestens eine Verbindung darüber haben – z. B. zeigt ein Klick auf „22 (SSH)" mit einem Schritt die komplette SSH-Kommunikation in Matrix, Graph, Verbindungen und Zeitleiste.

## [0.12.1] – 2026-07-22

### Fixed

- `parser.worker.js` und die darin per `importScripts()` geladenen Dateien (`pcap-parser.js`, `pcapng-parser.js`, `packet-decoder.js`, `dns-resolver.js`) wurden vom Browser unabhängig vom Haupt-Dokument gecacht – ein normaler oder sogar harter Seiten-Reload garantierte in manchen Browsern nicht, dass nach einem Update auch tatsächlich der neue Worker-Code läuft (beobachtet: ICMP-Typen aus 0.12.0 erschienen bei einem Nutzer trotz Reload nicht). Worker-URL und alle `importScripts()`-Aufrufe tragen jetzt einen Versions-Query-String, der bei jedem Versions-Bump automatisch einen frischen Fetch erzwingt.

## [0.12.0] – 2026-07-22

### Changed

- Verbindungen-Ansicht: Pfeil-Beschriftung zeigt jetzt nur noch den Destination-Port der jeweiligen Richtung statt Source→Destination – welche beiden Ports beteiligt sind, ist durch die beiden gruppierten Pfeile ohnehin ersichtlich, der volle Source-/Destination-Port-Umfang bleibt im Hover-Tooltip verfügbar.

### Added

- Verbindungen-Ansicht: Bei ICMP/ICMPv6 zeigt die Beschriftung jetzt den tatsächlichen Nachrichtentyp (z. B. „ICMP (Echo Request)" / „ICMP (Echo Reply)") statt nur „ICMP" – dafür trackt der Worker pro Verbindungsrichtung die beobachteten ICMP-Typen zusätzlich zu Paketen/Bytes.

## [0.11.1] – 2026-07-22

### Fixed

- Verbindungen-Ansicht: Die Beschriftung von Aufbau- und Antwort-Pfeil zeigte nur den gemeinsamen Service-Port (z. B. „TCP 80"), nicht die tatsächlichen, vertauschten Source-/Destination-Ports der jeweiligen Richtung – bei zufällig gleicher Paketanzahl in beiden Richtungen (z. B. symmetrischer ICMP-Echo/Reply-Verkehr) sahen dadurch beide Pfeile im Diagramm identisch aus, obwohl die zugrunde liegenden Daten bereits korrekt getrennt waren. Die Beschriftung zeigt jetzt „Source→Destination" der jeweiligen Richtung (z. B. „▲ TCP 40142→80 — 59×" / „○ TCP 80→40142 — 59×").

## [0.11.0] – 2026-07-22

### Changed

- Verbindungen-Ansicht: Ein Pfeil zeigte bisher nur die kombinierte Summe beider Richtungen und blendete Antwort-Traffic (z. B. die TCP-Antwortpakete eines Servers) komplett aus. Gibt es Traffic in die Gegenrichtung, wird jetzt direkt darunter ein zweiter, gestrichelter Antwort-Pfeil mit eigener Paketanzahl/eigenen Ports gezeichnet, beide eng gruppiert mit gemeinsamem Hintergrundband und „▲"/„○"-Symbolen (konsistent zur Matrix-Legende), damit erkennbar bleibt, welche zwei Pfeile zusammengehören. Angeheftete Pfeile lassen sich jetzt unabhängig für beide Richtungen anheften und exportieren.

## [0.10.0] – 2026-07-22

### Fixed

- Matrix: die schrägen Spaltenüberschriften der letzten Spalten wurden am rechten Rand abgeschnitten, weil nur ein oberer Rand für die diagonale Textausdehnung reserviert war, nicht aber der symmetrisch dazu benötigte rechte Rand.

### Changed

- Matrix: die beiden Zellen eines Geräte-Paares (Zeile→Spalte und Spalte→Zeile) zeigen jetzt jeweils nur den tatsächlichen Traffic dieser einen Richtung (Farbe, Pakete/Bytes, Source-/Destination-Port) statt zweimal denselben kombinierten Wert. Ein kleines Symbol in jeder nicht-leeren Zelle (gefülltes Dreieck = hat die Verbindung initiiert, Ring = ist nur die Antwort, erklärt in einer neuen Legende oberhalb der Matrix) macht auch ohne Hover erkennbar, welche Richtung den Verbindungsaufbau darstellt – relevant z. B. für Firewall-/ACL-Regelwerke. Angeheftete Matrixzellen-Kacheln und deren Excel-Export („Auswahl"-Sheet, neue Spalte „Richtung") berücksichtigen das entsprechend; der Graph zeigt für seine Kanten weiterhin die kombinierte, richtungsunabhängige Gesamtsumme des Paares.

## [0.9.0] – 2026-07-22

### Changed

- Tooltips und angeheftete Kacheln zeigen bei Geräte-Paaren und Verbindungen jetzt immer einen einzelnen Pfeil („Source IP → Destination IP") statt eines richtungslosen „↔", basierend auf dem Gerät, das die Kommunikation nachweislich zuerst initiiert hat (erstes beobachtetes Paket des Paares/der Verbindung) – unabhängig davon, in welcher Zeilen-/Spaltenreihenfolge z. B. eine Matrixzelle gehovert wurde.
- Deutsche Quell-/Ziel-Begriffe wurden durchgängig durch „Source IP", „Destination IP", „Source Port" und „Destination Port" ersetzt – in Tooltips, angehefteten Kacheln und allen Excel-Exporten.
- Excel-Export „Rohdaten": Spalten „Quelle"/„Ziel" heißen jetzt „Source IP"/„Destination IP"; zusätzlich erzeugt jedes Geräte-Paar eine eigene Zeile pro Protokoll (TCP/UDP/ICMP/ARP/…) statt einer einzigen Zeile mit über alle Protokolle vermischten Ports – TCP- und UDP-Ports desselben Paares sind dadurch nicht mehr ununterscheidbar. Der Export „Nur angeheftete Auswahl" wurde entsprechend angepasst (Geräte-Paare werden ebenfalls je Protokoll aufgeteilt).
- Matrix: Zeilen-/Spaltenbeschriftungsbereich wird jetzt aus der tatsächlich längsten Geräte-Bezeichnung berechnet statt aus einer festen Breite/Höhe – lange IPv6-Adressen bzw. IP+Hostname-Kombinationen wurden dadurch am oberen Rand der rotierten Spaltenköpfe abgeschnitten.
- Zeitleiste: Zeilenbeschriftungen werden bei zu langer Source-/Destination-Kombination (v. a. IPv6) jetzt zweizeilig dargestellt statt mit „…" abgeschnitten.

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
