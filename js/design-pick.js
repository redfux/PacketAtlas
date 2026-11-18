/* ==========================================================================
   Design System — List picker ("Auswahlliste mit Suche")
   Version: 26.11-build.11
   Stand: 17.11.2026

   Builds a .pick (trigger, panel with search field, count line, bulk
   buttons and list) into a given element and reports the choice back. The
   app keeps data and selection; this script only builds the UI and its
   behaviour, for any kind of entry (organisations, sites, devices …).
   Rules: README, section "Auswahlliste mit Suche".

   Classic script (no module): load it after js/design-system.js, in <head>
   or at the end of <body>. Works under file:// and with a CSP of
   script-src 'self' / style-src 'self' (no inline style, no innerHTML).

     const pick = DesignSystem.createPick({
       mount,                   // element the .pick is appended to
       term: ['Standort', 'Standorte'],   // singular, plural
       multi: true,             // checkboxes (true) or radios (false)
       items: () => [{ id, label, sub, tag, search }],
       selected: () => ids,     // ids chosen right now (the app's state)
       onChange: (ids) => {},   // store the new choice (synchronously)
       // optional: label, placeholder, searchPlaceholder, emptyText,
       //           triggerText(chosenItems), sprite
     });
     pick.render(); pick.open(); pick.close(); pick.reset();
     // onChange gets every id in its type from items (selected may hold text).
     // reset(): clear the app's data and choice FIRST, then call reset().
     pick.setDisabled('erst Organisation wählen'); pick.setDisabled(null);
     pick.setStatus('Netzwerke werden geladen …'); pick.setStatus(null);
     pick.destroy();

   thought up by human, coded by ai
   ========================================================================== */
(function () {
  'use strict';

  const SVG = 'http://www.w3.org/2000/svg';
  const live = new Set();   // every picker on the page
  let current = null;       // the one whose panel is open
  let seq = 0;

  /* ------------------------------------------------------------- helpers */
  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }
  function icon(sprite, id, cls) {
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('class', cls);
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS(SVG, 'use');
    use.setAttribute('href', sprite + '#' + id);
    svg.appendChild(use);
    return svg;
  }
  // Options may be a function or a plain value.
  function value(x) { return typeof x === 'function' ? x() : x; }
  function words(text) { return text.trim().toLowerCase().split(/\s+/).filter(Boolean); }
  function haystack(item) {
    const extra = Array.isArray(item.search) ? item.search.join(' ') : item.search;
    return [item.label, item.sub, item.tag, extra].filter((x) => x != null && x !== '').join('\n').toLowerCase();
  }

  /* ---------------------------------------------- shared document listeners */
  // One set for all pickers, added with the first and removed with the last.
  function onDocClick(e) {
    // Capture phase (see listen): sees every click, even when app code calls
    // stopPropagation() on it. composedPath: right even if the click later
    // removes its own target.
    if (current && e.composedPath().indexOf(current.root) === -1) current.close();
  }
  function onDocKey(e) {
    // A filled search field takes the first Escape (design-system.js empties
    // it and calls preventDefault); only the next one closes the panel.
    if (e.key !== 'Escape' || e.defaultPrevented || !current) return;
    e.preventDefault();   // inside a <dialog>: close the panel, not the dialog
    current.close(true);
  }
  function onDocFocus(e) {
    // Focus came back from outside the document (e.g. Tab past the last
    // element went to the browser UI and wrapped to the top): focusout saw no
    // relatedTarget, so close here. No refocus - the focus is outside already.
    if (current && e.composedPath().indexOf(current.root) === -1) current.close();
  }
  function listen(on) {
    const fn = on ? 'addEventListener' : 'removeEventListener';
    document[fn]('click', onDocClick, true);   // capture: before any stopPropagation
    document[fn]('keydown', onDocKey);
    document[fn]('focusin', onDocFocus);
  }

  /* -------------------------------------------------------------- picker */
  function Pick(o) {
    if (!o || !o.mount) throw new Error('DesignSystem.createPick: mount fehlt');
    const term = o.term || ['Eintrag', 'Einträge'];
    this.o = o;
    this.multi = o.multi !== false;
    this.one = term[0];
    this.many = term[1] || term[0];
    this.sprite = o.sprite || '';
    this.emptyText = o.emptyText || 'Keine Treffer';
    this.placeholder = o.placeholder || this.one + ' wählen …';
    this.id = 'ds-pick-' + (++seq);
    this.rows = [];           // [{ item, li, input }] of the list on screen
    this.status = null;       // loading / error text instead of the list
    this.disabledText = null;
    this.changing = false;    // inside our own onChange call
    this.build();
    o.mount.appendChild(this.root);
    if (!live.size) listen(true);
    live.add(this);
    this.renderTrigger();
  }

  Pick.prototype.build = function () {
    const self = this;
    const o = this.o;
    const root = this.root = el('div', 'pick');

    const label = el('span', 'pick-label', o.label || (this.multi ? this.many : this.one));
    label.id = this.id + '-label';
    this.triggerText = el('span');
    this.triggerText.id = this.id + '-value';
    const trigger = this.trigger = el('button', 'pick-trigger');
    trigger.type = 'button';
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', this.id + '-panel');
    trigger.setAttribute('aria-labelledby', label.id + ' ' + this.triggerText.id);
    trigger.append(this.triggerText, icon(this.sprite, 'ic-chevron-right', 'caret'));

    const search = this.search = el('input', 'sel');
    search.type = 'search';
    search.placeholder = o.searchPlaceholder || this.one + ' suchen …';
    search.setAttribute('aria-label', search.placeholder.replace(/\s*…$/, ''));
    search.setAttribute('aria-controls', this.id + '-list');
    search.autocomplete = 'off';
    search.spellcheck = false;
    const clear = this.clearBtn = el('button', 'icon clear-btn');
    clear.type = 'button';
    clear.hidden = true;
    clear.setAttribute('aria-label', 'Suche löschen');
    clear.title = 'Suche löschen';
    clear.appendChild(icon(this.sprite, 'ic-close', 'i'));
    const field = el('div', 'search-field');
    field.append(search, clear);

    this.count = el('span');
    this.count.setAttribute('aria-live', 'polite');
    this.allBtn = el('button', 'text');
    this.allBtn.type = 'button';
    this.noneBtn = el('button', 'text', 'Auswahl entfernen');
    this.noneBtn.type = 'button';
    const bulk = el('span', 'pick-bulk');
    bulk.append(this.allBtn, this.noneBtn);
    const meta = el('div', 'pick-meta');
    meta.append(this.count, bulk);

    // Native checkboxes/radios: the list is a labelled group, not a listbox.
    const list = this.list = el('ul', 'pick-list');
    list.id = this.id + '-list';
    list.setAttribute('role', this.multi ? 'group' : 'radiogroup');
    list.setAttribute('aria-label', this.many);

    const panel = this.panel = el('div', 'pick-panel');
    panel.id = this.id + '-panel';
    panel.hidden = true;
    panel.append(field, meta, list);
    root.append(label, trigger, panel);

    trigger.addEventListener('click', () => (panel.hidden ? self.open() : self.close()));
    // Every input rebuilds the list (chosen ones on top). The "×" and Escape
    // of design-system.js fire an input event as well.
    search.addEventListener('input', () => self.renderList());
    // Without design-system.js the "×" still works.
    if (!(window.DesignSystem && window.DesignSystem.syncSearch)) {
      search.addEventListener('input', () => { clear.hidden = search.value === ''; });
      clear.addEventListener('click', () => { search.value = ''; clear.hidden = true; self.renderList(); search.focus(); });
    }
    search.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        if (self.rows.length) { e.preventDefault(); self.rows[0].input.focus(); }
      } else if (e.key === 'Enter') {
        e.preventDefault();   // never submit a surrounding form
        const hit = self.hit();
        if (hit) self.choose(hit);
      }
    });
    list.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const i = self.rows.findIndex((r) => r.input === e.target);
      if (i === -1) return;
      e.preventDefault();   // radios: move the focus, do not change the choice
      if (e.key === 'ArrowDown') { if (i < self.rows.length - 1) self.rows[i + 1].input.focus(); }
      else (i > 0 ? self.rows[i - 1].input : search).focus();
    });
    // Single choice: a click on the entry that is already chosen closes too
    // (it fires no change event).
    list.addEventListener('click', (e) => {
      if (self.multi || e.target.tagName !== 'INPUT') return;
      const row = self.rows.find((r) => r.input === e.target);
      if (row && self.chosenSet().has(String(row.item.id))) self.close(true);
    });
    list.addEventListener('change', (e) => {
      const row = self.rows.find((r) => r.input === e.target);
      if (row) self.choose(row, e.target.checked);
    });
    this.allBtn.addEventListener('click', () => self.bulk(true));
    this.noneBtn.addEventListener('click', () => self.bulk(false));
    // Tabbing out of the picker closes the panel (a click outside does too).
    // Tab out of the picker closes at once. Without relatedTarget (focus left
    // the document: browser UI, other window) the panel stays open; if the
    // focus then lands elsewhere in the document, onDocFocus closes it.
    root.addEventListener('focusout', (e) => {
      if (!panel.hidden && e.relatedTarget && !root.contains(e.relatedTarget)) self.close();
    });
  };

  /* ------------------------------------------------------------ state */
  Pick.prototype.items = function () { return value(this.o.items) || []; };
  Pick.prototype.ids = function () { return (value(this.o.selected) || []).slice(); };
  Pick.prototype.chosenSet = function () { return new Set(this.ids().map(String)); };

  // Hands the new choice to the app. Every id comes back in the type it has
  // in items (selected may hold "104" for an item id 104); ids without an
  // item stay as they are, duplicates (by text) are dropped. A render() the
  // app calls from inside onChange must not rebuild the list (no row may
  // jump on a single tick).
  Pick.prototype.emit = function (ids) {
    const byKey = new Map(this.items().map((it) => [String(it.id), it.id]));
    const seen = new Set();
    const out = [];
    ids.forEach((id) => {
      const key = String(id);
      if (seen.has(key)) return;
      seen.add(key);
      out.push(byKey.has(key) ? byKey.get(key) : id);
    });
    this.changing = true;
    try { if (this.o.onChange) this.o.onChange(out); } finally { this.changing = false; }
  };

  /** The row Enter takes: multi - first hit not chosen yet, single - first hit; only with search text. */
  Pick.prototype.hit = function () {
    if (this.status || !words(this.search.value).length) return null;
    if (!this.multi) return this.rows[0] || null;
    const chosen = this.chosenSet();
    return this.rows.find((r) => !chosen.has(String(r.item.id))) || null;
  };

  // A tick, a click on a radio or Enter in the search field.
  Pick.prototype.choose = function (row, on) {
    const key = String(row.item.id);
    if (!this.multi) {
      this.emit([row.item.id]);
      this.renderTrigger();
      this.close(true);
      return;
    }
    if (on === undefined) on = true;   // Enter only ticks, never unticks
    const ids = this.ids();
    const has = ids.some((id) => String(id) === key);
    if (on && !has) this.emit(ids.concat([row.item.id]));
    else if (!on && has) this.emit(ids.filter((id) => String(id) !== key));
    this.refresh();
  };

  // Bulk buttons: rebuild the list (chosen ones to the top), keep the focus.
  Pick.prototype.bulk = function (all) {
    const btn = all ? this.allBtn : this.noneBtn;
    const other = all ? this.noneBtn : this.allBtn;
    if (all) {
      const ids = this.ids();
      const have = new Set(ids.map(String));
      this.rows.forEach((r) => { if (!have.has(String(r.item.id))) ids.push(r.item.id); });
      this.emit(ids);
    } else {
      this.emit([]);
    }
    this.renderList();
    this.renderTrigger();
    (!btn.hidden ? btn : !other.hidden ? other : this.search).focus();
  };

  /* ------------------------------------------------------------ render */
  // Builds the list as a whole: search, chosen ones on top, divider, hit.
  Pick.prototype.renderList = function () {
    const self = this;
    const list = this.list;
    list.textContent = '';
    this.rows = [];
    if (this.status) {
      list.appendChild(el('li', 'none', this.status));
      this.renderMeta([]);
      return;
    }
    const ws = words(this.search.value);
    const all = this.items();
    const hits = ws.length ? all.filter((it) => { const h = haystack(it); return ws.every((w) => h.indexOf(w) !== -1); }) : all;
    const chosen = this.chosenSet();
    let shown = hits;
    let pinned = 0;
    if (this.multi) {
      const on = hits.filter((it) => chosen.has(String(it.id)));
      pinned = on.length;
      shown = on.concat(hits.filter((it) => !chosen.has(String(it.id))));
    }
    const frag = document.createDocumentFragment();
    const name = this.id + '-r';
    shown.forEach((item, i) => {
      const on = chosen.has(String(item.id));
      const li = el('li');
      if (on) li.classList.add('active');
      if (pinned && i === pinned - 1 && pinned < shown.length) li.classList.add('pinned-last');
      const input = el('input');
      input.type = self.multi ? 'checkbox' : 'radio';
      if (!self.multi) input.name = name;
      input.checked = on;
      const lab = el('label');
      lab.append(input, el('span', null, item.label));
      if (item.tag) lab.appendChild(el('span', 'pill pick-tag', item.tag));
      if (item.sub != null && item.sub !== '') {
        const sub = el('span', 'pick-sub', item.sub);
        sub.title = String(item.sub);   // readable on hover when cut with "…"
        lab.appendChild(sub);
      }
      li.appendChild(lab);
      frag.appendChild(li);
      self.rows.push({ item, li, input });
    });
    if (!shown.length) frag.appendChild(el('li', 'none', this.emptyText));
    list.appendChild(frag);
    this.renderMeta(all);
  };

  // After a single tick: only rows, count, buttons and trigger - no new order.
  Pick.prototype.refresh = function () {
    const chosen = this.chosenSet();
    this.rows.forEach((r) => {
      const on = chosen.has(String(r.item.id));
      r.input.checked = on;
      r.li.classList.toggle('active', on);
    });
    this.renderMeta(this.items());
    this.renderTrigger();
  };

  Pick.prototype.renderMeta = function (all) {
    const chosen = this.chosenSet();
    const k = this.status ? 0 : all.filter((it) => chosen.has(String(it.id))).length;
    this.count.textContent = this.status ? '' : this.rows.length + ' von ' + all.length + (k ? ' · ' + k + ' gewählt' : '');
    const searching = words(this.search.value).length > 0;
    this.allBtn.textContent = searching ? 'Alle Treffer auswählen' : 'Alle auswählen';
    this.allBtn.hidden = !this.multi || !this.rows.length || this.rows.every((r) => chosen.has(String(r.item.id)));
    this.noneBtn.hidden = this.status != null || !k;
    const hit = this.hit();
    this.rows.forEach((r) => r.li.classList.toggle('is-hit', r === hit));
  };

  Pick.prototype.renderTrigger = function () {
    const t = this.trigger;
    t.disabled = this.disabledText != null;
    if (t.disabled) { this.triggerText.textContent = this.disabledText; return; }
    const chosen = this.chosenSet();
    const items = this.items().filter((it) => chosen.has(String(it.id)));
    let text = this.o.triggerText ? this.o.triggerText(items) : null;
    if (text == null) {
      text = !items.length ? this.placeholder
        : items.length === 1 ? items[0].label
        : items.length + ' ' + this.many + ' gewählt';
    }
    this.triggerText.textContent = text;
  };

  /* ------------------------------------------------------------ public */
  /** Data or choice changed in the app: rebuild what is on screen. */
  Pick.prototype.render = function () {
    if (!this.root) return;
    if (this.changing) return;   // our own onChange: refresh() follows
    if (!this.panel.hidden) this.renderList();
    this.renderTrigger();
  };

  Pick.prototype.open = function () {
    if (!this.root || this.trigger.disabled || !this.panel.hidden) return;
    if (current && current !== this) current.close();
    // Every opening starts with an empty search and the chosen ones on top.
    this.search.value = '';
    this.clearBtn.hidden = true;
    this.renderList();
    this.panel.hidden = false;
    this.trigger.setAttribute('aria-expanded', 'true');
    current = this;
    this.search.focus();
  };

  /** focus=true (Escape, single choice): the focus goes back to the trigger. */
  Pick.prototype.close = function (focus) {
    if (!this.root || this.panel.hidden) return;
    const inside = this.root.contains(document.activeElement);
    this.panel.hidden = true;
    this.trigger.setAttribute('aria-expanded', 'false');
    if (current === this) current = null;
    if (focus === true || inside) this.trigger.focus();
  };

  /** Empties the search and closes; the app clears the choice itself - first,
      because the trigger is rebuilt from items()/selected() right here. */
  Pick.prototype.reset = function () {
    if (!this.root) return;
    this.search.value = '';
    this.clearBtn.hidden = true;
    this.close();
    this.renderTrigger();
  };

  /** text: trigger locked, the text says why; null unlocks. */
  Pick.prototype.setDisabled = function (text) {
    if (!this.root) return;
    this.disabledText = text == null || text === false ? null : String(text);
    if (this.disabledText != null) this.close();
    this.renderTrigger();
  };

  /** text: loading/error line instead of the list; null shows the list. */
  Pick.prototype.setStatus = function (text) {
    if (!this.root) return;
    this.status = text == null || text === false ? null : String(text);
    if (!this.panel.hidden) this.renderList();
  };

  Pick.prototype.isOpen = function () { return !!this.root && !this.panel.hidden; };

  Pick.prototype.destroy = function () {
    if (!this.root) return;
    if (current === this) current = null;
    this.root.remove();
    this.root = null;
    this.rows = [];
    live.delete(this);
    if (!live.size) listen(false);
  };

  function createPick(options) {
    const p = new Pick(options);
    return {
      get element() { return p.root; },
      render: () => p.render(),
      open: () => p.open(),
      close: () => p.close(),
      reset: () => p.reset(),
      setDisabled: (text) => p.setDisabled(text),
      setStatus: (text) => p.setStatus(text),
      isOpen: () => p.isOpen(),
      destroy: () => p.destroy()
    };
  }

  // Adds to the namespace: the load order of the two DS scripts does not matter.
  window.DesignSystem = Object.assign(window.DesignSystem || {}, { createPick });
})();
