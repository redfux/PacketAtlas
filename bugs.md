# Bugs – PacketAtlas

Bekannte Bugs und deren Lösung. Format: Datum, Beschreibung, Ursache, Fix, betroffene Version.

## Behoben vor Erstveröffentlichung (0.1.0)

- **pcapng: falsches Byte-Order-Magic gelesen.** `pcapng-parser.js` las das Byte-Order-Magic des Section Header Blocks an Offset 4 statt 8 (Offset 4 ist die Blocklänge). Dadurch schlug das Parsen jeder gültigen pcapng-Datei mit „Ungültiges Byte-Order-Magic" fehl. Fix: Offset auf 8 korrigiert.
- **Graph-Ansicht blieb bei Neu-Rendern leer.** Nach einem Wechsel von Metrik/Filter/Kräfte-Parametern wurde eine neue d3-force-Simulation erzeugt und synchron per `simulation.tick()` vorkonvergiert – diese manuelle API aktualisiert Knotenpositionen, löst aber (anders als die intern timergesteuerten Ticks) kein `'tick'`-Event aus, wodurch die DOM-Positionen nie gesetzt wurden. Fix: Positions-Sync nach der Vorkonvergenz einmal explizit aufgerufen, zusätzlich Zoom-to-Fit ergänzt, damit auch weit auseinanderliegende Knoten initial sichtbar sind.
- **`hidden`-Attribut ohne Wirkung.** Mehrere CSS-Klassenregeln (`.progress-banner`, `.error-banner`, `.workspace`, `.menu`, `.warning-banner`, `.graph-controls` u. a.) setzten `display: flex`/`grid` uneingeschränkt und überschrieben damit die Browser-Standardregel `[hidden] { display: none }` bei gleicher Spezifität. Banner, Menüs und Warnhinweise blieben dadurch dauerhaft sichtbar. Fix: globale Regel `[hidden] { display: none !important; }` ergänzt.
- **PNG-Export schlug lautlos fehl.** Die CSP (`img-src 'self' data:`) erlaubte kein Laden von `blob:`-URLs als `<img>`, wodurch das für den Canvas-Export nötige Zwischenbild nie lud. Fix: `blob:` zu `img-src` ergänzt – rein lokale In-Memory-Referenzen, keine Netzwerkverbindung, daher ohne Auswirkung auf das Datenschutzziel.
