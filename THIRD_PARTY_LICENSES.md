# Lizenzen von Drittkomponenten

PacketAtlas vendort alle Drittkomponenten lokal (`vendor/`), es werden keine CDN-Links zur Laufzeit verwendet. Diese Datei listet die verwendeten Komponenten mit Version und Lizenz.

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

## Icons

### Material Symbols / Material Icons

- **Ort:** Inline-SVG-Sprite in `index.html` (Quelle: `icons/icon-sprite.svg` des Design Systems)
- **Lizenz:** Apache License 2.0
- **Zweck:** UI-Symbole (Datei öffnen, Export, Ansichten, Menü, Hell/Dunkel …), als SVG-Pfade statt Icon-Schrift.
- **Quelle:** Google (https://fonts.google.com/icons)
