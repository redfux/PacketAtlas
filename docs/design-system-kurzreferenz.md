# Design System – Kurzreferenz

Design System 26.11-build.11. Diese Datei ist der **erste und meist einzige Lesestoff** fuer UI-Arbeit an
einer App. Sie ist bewusst knapp, damit beim Bauen wenig Kontext (Tokens) verbraucht wird.

**Lesereihenfolge:**

1. Diese Datei.
2. Nur bei einer konkreten Luecke: `README.md` des Design Systems **gezielt** per `grep` nach dem
   Abschnitt durchsuchen, nicht komplett lesen.
3. **Nicht lesen:**
   - `css/design-tokens.css`, `css/design-components.css`, `js/design-system.js`,
     `js/design-pick.js`, `js/file-hint.js` und `icons/icon-sprite-inline.html` im Projekt. Das sind Kopien aus dem Design System; sie werden
     per `sync-design.sh` ueberschrieben und nie von Hand geaendert.
   - `index.html` des Design Systems (Vorschau, ca. 47.000 Tokens), hoechstens per `grep`.

**Sync auf eine neuere Version:** nur die Abschnitte oberhalb der bisherigen Version der App lesen,
und nur in der Datei ihrer Reihe: 26.x → `MIGRATION.md` des Design Systems; 3.x →
`docs/migration-3x-auf-26x.md`, danach `MIGRATION.md`. 2.x wird nicht mehr beschrieben.

**Neue App:** `app-skeleton.html` aus dem Design-System-Klon als `index.html` ins Projekt kopieren
(`cp`, nicht lesen und neu schreiben), dann nur die markierten Stellen anpassen. Darin sind
Appbar, Menue mit Farbe/Modus, Seitenleiste, Toolbar, Footer, AI-Label und alle 37 Icons fertig.

## Grundregeln

- Erst Klassen des Design Systems nutzen, **kein eigenes CSS** fuer etwas, das es schon gibt.
  Eigene Regeln nur fuer App-Eigenes, mit Tokens (`var(--md-…)`), nie mit rohen Farbwerten.
- Bausteine nutzen nur `--md-*`-Tokens, nie `--palette-*`.
- Kein `style="…"` und kein Inline-`<script>` (strenge CSP); Skripte in eigene Dateien.
- Icons: `<svg class="i"><use href="#ic-name"></use></svg>`, Sprite inline nach `<body>`,
  nie per Dateipfad (`icons/icon-sprite.svg#…` scheitert unter `file://`).
- `js/design-system.js` im `<head>` ohne `defer`. Es verdrahtet Hell/Auto/Dunkel, Farbpalette,
  Seitenleiste, Anpinnen und Suchfeld – dafuer **keinen eigenen Code** schreiben.
  Auswahlliste mit Suche: `js/design-pick.js` danach laden, `DesignSystem.createPick(…)` (Tabelle unten).
  Eigener Code: `DesignSystem.setTheme('dark')`, `DesignSystem.setPalette('dark-green')`.
- Version des Design Systems erscheint automatisch im Menue unter dem Schalter. Footer: App-Version,
  Signatur, AI-Label (nur im Marken-Theme; im Theme Neutral entfaellt es).
- Breakpoints: Mobile < 768, Tablet 768–1023, Desktop ≥ 1024, Wide ≥ 1400.
  Hilfsklassen `.hide-mobile`, `.hide-tablet`, `.hide-desktop`, `.sr-only`.

## Startweg

Steht in `architecture.md` der App (wird vor dem ersten Code festgelegt). Das Geruest ist auf **Webserver**
eingestellt:

- Webserver (`http(s)://`): eigener Code als ES-Module, `<script type="module" src="js/app.js">`.
  `js/file-hint.js` im `<head>` zeigt bei Doppelklick (`file://`) den Block
  `.status.warn[data-file-hint][hidden]` an und sperrt alles mit `data-needs-server`.
  `js/design-system.js` bleibt klassisches Skript, nicht importieren.
- Doppelklick (`file://`): `<script src="js/app.js" defer>`, `js/file-hint.js` und den
  Hinweis-Block aus dem Geruest entfernen.

## Versionierung

Schema `<JJ>.<MM>-build.<N><b>` fuer Design System und Apps (statt SemVer, alte Nummern bleiben
im Aenderungsverlauf):

- `JJ`/`MM` zweistellig; `N` beginnt jeden Monat bei 0 und steigt mit jeder Version um 1.
- `b` = Beta, von Beginn an; entfaellt nur auf ausdrueckliche Anweisung, danach ohne `b`
  weiterzaehlen. Im Branch immer mit `b`, beim Merge nach `main` fragen.
- Beispiel: `26.11-build.0b` → `26.11-build.1b`, im Dezember `26.12-build.0b`.
- App-Version an genau einer Stelle im Code, im Footer als „Version …“ (vollstaendig, mit `b`);
  jede Version, auch ein reiner Sync des Design Systems, mit Eintrag in `docs/releases.md`.
- Version des Design Systems nicht selbst anzeigen oder pflegen: kommt per Sync ins Menue.

## Pruefen im Browser (sparsam)

- Zuerst Text und Struktur (`read_page`, `get_page_text`) und Werte per JavaScript
  (`getComputedStyle`), Konsole auf Fehler.
- Screenshots erst am Ende und verkleinert (`scale: 0.5`); fuer Zustaende (Hover, Dunkel,
  Mobil) gezielt einzelne Screenshots statt Serien.

## Seitengeruest

`appbar` → optional `app-shell` (`sidebar` + Spalte mit `toolbar`/`pin-group` und `main`) → `footer`.
`app-shell fill` (direkt im `<body>`): Seite scrollt nicht, Seitenleiste und Inhalt scrollen
einzeln, `main` volle Breite. Ohne `fill`: Dokumentseite, Inhalt max. 1100 px.

## Klassen

| Bereich | Klassen / Markup | Hinweis |
|---|---|---|
| Appbar | `header.appbar` > `h1.app-title` (`.app-mark` + `.app-name` + `.app-claim`), `.spacer`, `.badge`, `button.menu-toggle[popovertarget=app-menu]`, `img.brand-mark.on-light` + `.on-dark` | Signet-Paar nur im Marken-Theme; kein Landscape-Logo |
| Menue | `div.app-menu#app-menu[popover]` > `.app-menu-head`, `a/button.app-menu-item` (`aria-current="page"`), `hr.app-menu-sep`, am Ende `.app-menu-group` > `.app-menu-row` (`.app-menu-row-label` + Umschalter) | ohne Farbauswahl reicht `.app-menu-foot` mit `.theme-toggle` |
| Farbe | `.palette-picker[role=group]` > `button[data-palette][aria-pressed]` (leer, Name in `aria-label`/`title`) | Marken-Theme: `default`, `dark-green`; Neutral: `steel`, `material`, `petrol`; Standard der App: `<html data-palette="…">` |
| Modus | `.theme-toggle[role=group]` > `button[data-theme=light/auto/dark][aria-pressed]` mit `ic-light-mode`/`ic-auto-mode`/`ic-dark-mode` | |
| Seitenleiste | `div.app-shell` > `nav.sidebar#sidebar` > `button.sidebar-toggle[aria-controls=sidebar][aria-expanded=true]` (`ic-sidebar-close`), `a.sidebar-link` mit `<svg class="i">` als erstem Kind | eingeklappt: nur Icons; alle Eintraege mit Icon oder keiner |
| Toolbar | `.toolbar` mit `label.hint`, `select.sel`, `button.chip[aria-pressed]`, `.grow`, `.tab-bar`; letztes Element `button.toolbar-pin[aria-pressed=false]` (`ic-push-pin`) | mehrere Baender gemeinsam anpinnen: in `.pin-group` |
| Auswahlliste mit Suche | **nicht von Hand bauen:** `js/design-pick.js` (nach `design-system.js` laden) → `DesignSystem.createPick({ mount, term: ['Standort','Standorte'], multi, items: () => [{ id, label, sub?, tag?, search? }], selected: () => ids, onChange: (ids) => … })` hängt eine `.pick` an `mount` (meist `.pick-bar`) | `onChange` liefert IDs im Typ aus `items`. Methoden `render()` (Daten/Auswahl geändert), `open()`/`close()`/`reset()` (**erst** Daten und Auswahl der App leeren, dann `reset()`), `setDisabled(text\|null)` (abhängige Auswahl, „erst Organisation wählen“; während einer laufenden Aktion „Abruf läuft …“, im `finally` `null`), `setStatus(text\|null)` (Laden/Fehler statt Liste), `destroy()`; optional `label`, `placeholder`, `searchPlaceholder`, `emptyText`, `triggerText(items)`. Alle Regeln (Suche wortweise, Gewählte oben, Enter nur anhaken, Zähler, Sammelknöpfe, Tastatur, Escape, ARIA) setzt das Skript um; Einzelheiten README „Auswahlliste mit Suche“ |
| Filterleiste | `.filter-bar` > `.label`, `.chip.removable` (mit `button` + `ic-close`), `.none[hidden]`, `button.text`, `.grow`, `.count` | |
| Tabs | `.tab-bar` > `button` (aktiv `.active`), Zaehler `<span class="n">` | keine eigenen `button.active`-Regeln |
| Modus einer Ansicht | `.seg[role=group]` > `button[aria-pressed]` | Tabs = Ansicht, Chips = mehrere Filter, `.seg` = genau ein Modus |
| Buttons | `button` (gefuellt), `.outlined`, `.text`, `.danger`, `.danger.outlined`, `.icon` (+`aria-label`), `.link`, `disabled`; Reihe `.btn-row` | |
| Ausklappen | `button.caret-toggle[aria-expanded]` > `svg.caret` (`ic-chevron-right`); feste Richtung `.caret.up`/`.down` | auch `details.adv` > `summary` + `.body` |
| Karten | `.card` > `h2` (`.step` fuer Nummer), `p.hint`; Kopf mit Aktion `.card-head`; Akzent `.card.accent.s1…s4` | |
| Raster | `.grid` > `.col-3/4/5/6/8/12` | unter 768 px volle Breite |
| Felder | `label.field` > `input[placeholder=" "]`/`select`/`textarea` + `label`; Fehler `.field.invalid` + `span.field-error.is-error`; Checkbox `label.check`; Suche `.search-field` > `input.sel[type=search]` + `button.icon.clear-btn[hidden]` (`ic-close`) | Suchfeld verdrahtet das Skript, auch später eingefügte; Wert per Code gesetzt → `DesignSystem.syncSearch()` |
| Status | `.status.info/ok/warn/err` > `svg.i` + `div` | Icons `ic-info`, `ic-check-circle`, `ic-warning`, `ic-error` |
| Zaehler, Pillen | `.n` (`.zero`, `.warn`), `.pill` (`.ok/.warn/.err/.info`), `.dot.ok/.busy/.err` | |
| Kennzahlen | `.kpis` > `.kpi` (`.s1…s4`) > `span.v` + `span.k` | |
| Schweregrad | `.sev.s1…s4` mit Symbol + Name (`✓ Gering`, `◆ Mittel`, `▲ Hoch`, `✖ Kritisch`) | Bedeutung legt die App fest |
| Fortschritt | `.progress-bar` > `i`, Fuellstand per JS `style.setProperty('--w','62%')` | |
| Tabelle | `.table-wrap` (`.scroll` = Kopf bleibt stehen) > `table`; `th/td.num`, `td.mono`, `td.actions` > `.btn-row` | Hoehe `--table-max-height` |
| Datei-Ablage | `.file-dropzone[tabindex=0][role=button]` (`.compact`), App setzt `.over` | nicht `.dropzone` |
| Dialog | `dialog` > `h3`, `p`, `.dlg-actions` > Buttons; oeffnen per `showModal()` | |
| Laden, Meldung | `.busy` > `.spinner`; `.toast` (+`.show`, `.err`) | |
| Diagramme | Kategorienfarben `--md-cat-1…5` | immer mit Beschriftung |

## Icons

`menu sidebar-close sidebar-open push-pin push-pin-filled close search arrow-back arrow-forward
chevron-right add edit delete save copy info warning error check-circle link refresh upload
download settings lock visibility print light-mode dark-mode auto-mode lan folder-open grid hub
swap-horiz timeline bar-chart` (jeweils mit Praefix `ic-`).

Fehlt ein Icon: als `<symbol id="ic-name" viewBox="0 0 24 24">` (Material Symbols) in den
eingebetteten Sprite der App einfuegen, nicht in die synchronisierten Dateien.

## Wichtige Tokens

Farben: `--md-primary`, `--md-on-primary`, `--md-surface`, `--md-surface-1…3`, `--md-on-surface`,
`--md-on-surface-variant`, `--md-outline`, `--md-outline-variant`, `--md-error`,
`--md-attention`, `--md-sev1…4-bg/-on/-mark`, `--md-cat-1…5`.
Form: `--radius-xs/-s/-m/-l/-xl/-full`, Schrift `--fs-2xs … --fs-xl`, `--mono`,
Layout `--appbar-height`, `--sidebar-width`, `--content-max-width`.
Bei Unsicherheit ueber einen Tokennamen: `grep -o -- '--md-[a-z0-9-]*' css/design-tokens.css | sort -u`.
