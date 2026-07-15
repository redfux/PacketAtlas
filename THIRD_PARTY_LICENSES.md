# Lizenzen von Drittkomponenten

PacketAtlas vendort alle Drittkomponenten lokal (`vendor/`, `fonts/`), es werden keine CDN-Links zur Laufzeit verwendet. Diese Datei listet die verwendeten Komponenten mit Version und Lizenz.

## JavaScript-Bibliotheken (`vendor/`)

### d3.js

- **Version:** 7.9.0
- **Datei:** `vendor/d3.min.js`
- **Lizenz:** ISC (siehe `vendor/d3.LICENSE`)
- **Zweck:** `d3-force` für die Kräfte-Simulation des Netzwerkgraphen, `d3-zoom`/`d3-drag` für Zoom/Pan/Dragging der Knoten, `d3-selection`/`d3-scale` für Rendering und Farbskalen.
- **Quelle:** https://d3js.org

### SheetJS (xlsx)

- **Version:** 0.18.5 (Community Edition)
- **Datei:** `vendor/xlsx.full.min.js`
- **Lizenz:** Apache License 2.0 (siehe `vendor/xlsx.LICENSE`)
- **Zweck:** Erzeugung der `.xlsx`-Exportdatei (Sheets „Matrix" und „Rohdaten").
- **Quelle:** https://sheetjs.com

## Schriften (`fonts/`)

### Roboto

- **Datei:** `fonts/roboto-latin-variable.woff2`
- **Lizenz:** Apache License 2.0 (siehe `fonts/roboto.LICENSE`)
- **Zweck:** Haupt-Schriftart gemäß Material Design.
- **Quelle:** Google Fonts (https://fonts.google.com/specimen/Roboto)
- Hinweis: Variable-Font-Datei (Latin-Subset), deckt die verwendeten Schriftschnitte (400/500/700) über die Gewichts-Achse ab.

### Material Symbols Outlined

- **Datei:** `fonts/material-symbols-outlined.woff2`
- **Lizenz:** Apache License 2.0 (siehe `fonts/material-symbols.LICENSE`)
- **Zweck:** Icon-Font für UI-Symbole (Import, Filter, Export, Tabs).
- **Quelle:** Google Fonts (https://fonts.google.com/icons)
