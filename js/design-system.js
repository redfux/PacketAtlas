/* ==========================================================================
   Design System — Behaviour
   Version: 3.4.2
   Stand: 17.10.2026

   Optional companion to the CSS. Load js/design-system.js in <head> as a
   classic script (no defer, no module) so the saved theme is applied before
   the first paint. The file contains no closing script tag, so it can also
   be pasted inline.

   - Theme: applies the saved light/dark choice at once, wires every
     .theme-toggle [data-theme] button (menu footer or appbar).
   - Palette: applies the saved colour palette at once (data-palette on
     <html>, only themes with palettes react to it), wires every
     .palette-picker [data-palette] button. An app may preset its own
     default with data-palette on <html>; it holds until the user chooses.
   - Sidebar: .sidebar-toggle[aria-controls] collapses/expands its .sidebar,
     keeps aria-expanded, label and icon in step, remembers the state on
     wide screens. On narrow screens it starts collapsed and closes on
     Escape or a click outside.
   - Toolbar pin: .toolbar-pin pins its .toolbar under the appbar; one
     remembered state for all pages of the app.
   - Search field: .search-field shows its .clear-btn only while there is
     text; click or Escape clear the field, fire an input event (so the
     project's own filter runs) and keep the focus in the field.
   - The .app-menu needs no script: it is a popover (popovertarget).

   Works under file:// and with a CSP of script-src 'self'.
   thought up by human, coded by ai
   ========================================================================== */
(function () {
  'use strict';

  const THEME_KEY = 'theme';
  const PALETTE_KEY = 'palette';
  // The first palette of a theme needs no attribute: 'steel' (Neutral), 'default' (Bechtle).
  const DEFAULT_PALETTES = ['steel', 'default'];
  const SIDEBAR_KEY = 'sidebar-collapsed';
  const TOOLBAR_KEY = 'toolbar-pinned';
  const NARROW = window.matchMedia('(max-width: 767px)');

  function read(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* private mode */ }
  }

  // Swaps only the #fragment of an icon reference, so it works with the
  // inline sprite (#ic-x) and with an external one (icons/icon-sprite.svg#ic-x).
  function setIcon(use, id) {
    if (!use) return;
    const href = use.getAttribute('href') || '';
    use.setAttribute('href', href.replace(/#.*$/, '') + '#' + id);
  }

  /* ------------------------------------------------------------------ theme */
  // 'system' is accepted as an older spelling of 'auto'.
  function normalise(mode) {
    return mode === 'light' || mode === 'dark' ? mode : 'auto';
  }

  function applyTheme(mode) {
    if (mode === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', mode);
  }

  function markButtons(mode) {
    document.querySelectorAll('.theme-toggle [data-theme]').forEach((btn) => {
      btn.setAttribute('aria-pressed', normalise(btn.dataset.theme) === mode ? 'true' : 'false');
    });
  }

  function setTheme(mode) {
    mode = normalise(mode);
    applyTheme(mode);
    write(THEME_KEY, mode);
    markButtons(mode);
  }

  // Runs while <head> is parsed: no flash of the wrong theme.
  applyTheme(normalise(read(THEME_KEY)));

  /* ---------------------------------------------------------------- palette */
  function applyPalette(name) {
    if (!name || DEFAULT_PALETTES.includes(name)) document.documentElement.removeAttribute('data-palette');
    else document.documentElement.setAttribute('data-palette', name);
  }

  // Nothing saved yet: the first button of each picker (the default) is pressed.
  function markPalette(name) {
    document.querySelectorAll('.palette-picker').forEach((picker) => {
      const buttons = [...picker.querySelectorAll('[data-palette]')];
      const known = buttons.some((btn) => btn.dataset.palette === name);
      buttons.forEach((btn, i) => {
        btn.setAttribute('aria-pressed', (known ? btn.dataset.palette === name : i === 0) ? 'true' : 'false');
      });
    });
  }

  function setPalette(name) {
    name = name || DEFAULT_PALETTES[0];
    applyPalette(name);
    write(PALETTE_KEY, name);
    markPalette(name);
  }

  // Only a saved choice overrides a data-palette the app put on <html>.
  const savedPalette = read(PALETTE_KEY);
  if (savedPalette) applyPalette(savedPalette);

  /* ---------------------------------------------------------------- sidebar */
  function setupSidebar(toggle) {
    const sidebar = document.getElementById(toggle.getAttribute('aria-controls'));
    if (!sidebar) return;
    const icon = toggle.querySelector('use');

    function render(collapsed) {
      sidebar.classList.toggle('collapsed', collapsed);
      toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      toggle.setAttribute('aria-label', collapsed ? 'Seitenleiste ausklappen' : 'Seitenleiste einklappen');
      toggle.title = toggle.getAttribute('aria-label');
      setIcon(icon, collapsed ? 'ic-sidebar-open' : 'ic-sidebar-close');
    }

    // Narrow screens always start collapsed; the saved state is for wide ones.
    render(NARROW.matches ? true : read(SIDEBAR_KEY) === '1');

    toggle.addEventListener('click', () => {
      const collapsed = !sidebar.classList.contains('collapsed');
      render(collapsed);
      if (!NARROW.matches) write(SIDEBAR_KEY, collapsed ? '1' : '0');
    });

    // On narrow screens the open sidebar is an overlay: Escape or a click
    // outside closes it, and focus returns to the toggle.
    function closeOverlay() {
      if (!NARROW.matches || sidebar.classList.contains('collapsed')) return;
      render(true);
      toggle.focus();
    }
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeOverlay(); });
    document.addEventListener('click', (e) => { if (!sidebar.contains(e.target)) closeOverlay(); });
    // A chosen entry closes the overlay too (matters for in-page links).
    sidebar.addEventListener('click', (e) => {
      if (NARROW.matches && e.target.closest('a')) render(true);
    });

    // Crossing the breakpoint: narrow → collapsed, wide → saved state.
    NARROW.addEventListener('change', () => {
      render(NARROW.matches ? true : read(SIDEBAR_KEY) === '1');
    });
  }

  /* ------------------------------------------------------------ toolbar pin */
  function setupToolbarPin(button) {
    const toolbar = button.closest('.toolbar');
    if (!toolbar) return;
    const icon = button.querySelector('use');
    // What actually sticks: the pin group around the toolbar, or the toolbar.
    const stuck = toolbar.closest('.pin-group') || toolbar;

    // Tells the CSS how much the pinned bars cover, so anchor jumps land
    // below them. Kept current while the bars wrap or change height.
    function updateOffset() {
      const on = toolbar.classList.contains('pinned') && !NARROW.matches;
      document.documentElement.style.setProperty('--pinned-height', on ? stuck.offsetHeight + 'px' : '0px');
    }
    if ('ResizeObserver' in window) new ResizeObserver(updateOffset).observe(stuck);
    NARROW.addEventListener('change', updateOffset);

    function render(pinned) {
      toolbar.classList.toggle('pinned', pinned);
      button.setAttribute('aria-pressed', pinned ? 'true' : 'false');
      button.setAttribute('aria-label', pinned ? 'Leiste lösen' : 'Leiste anpinnen');
      button.title = button.getAttribute('aria-label');
      setIcon(icon, pinned ? 'ic-push-pin-filled' : 'ic-push-pin');
      updateOffset();
    }

    render(read(TOOLBAR_KEY) === '1');
    button.addEventListener('click', () => {
      const pinned = !toolbar.classList.contains('pinned');
      render(pinned);
      write(TOOLBAR_KEY, pinned ? '1' : '0');
    });
  }

  /* ----------------------------------------------------------- search field */
  function setupSearchField(field) {
    const input = field.querySelector('input');
    const clear = field.querySelector('.clear-btn');
    if (!input || !clear) return;

    const sync = () => { clear.hidden = input.value === ''; };
    // No-op when already empty, so a project's own clear handler and this
    // one can coexist without filtering twice.
    function reset() {
      if (input.value === '') return;
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      sync();
    }

    input.addEventListener('input', sync);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && input.value !== '') { e.preventDefault(); reset(); }
    });
    clear.addEventListener('click', () => { reset(); input.focus(); });
    sync();
  }

  /* ------------------------------------------------------------------- init */
  function init() {
    markButtons(normalise(read(THEME_KEY)));
    document.querySelectorAll('.theme-toggle [data-theme]').forEach((btn) => {
      btn.addEventListener('click', () => setTheme(btn.dataset.theme));
    });
    markPalette(read(PALETTE_KEY) || document.documentElement.getAttribute('data-palette'));
    document.querySelectorAll('.palette-picker [data-palette]').forEach((btn) => {
      btn.addEventListener('click', () => setPalette(btn.dataset.palette));
    });
    document.querySelectorAll('.sidebar-toggle[aria-controls]').forEach(setupSidebar);
    document.querySelectorAll('.toolbar-pin').forEach(setupToolbarPin);
    document.querySelectorAll('.search-field').forEach(setupSearchField);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // Small API for apps that switch theme or palette from their own code.
  window.DesignSystem = { setTheme, setPalette };
})();
