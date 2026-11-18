/* ==========================================================================
   Design System — File hint
   Version: 26.11-build.11
   Stand: 17.11.2026

   For apps that need a web server (code as ES modules, own files loaded by
   fetch): opened by double-click (file://) the browser loads no modules, so
   such an app would stay half empty without a word. Load this classic
   script in <head> next to js/design-system.js. On any protocol other than
   http(s) it
   - shows every [data-file-hint] element (the markup ships it hidden),
   - disables every [data-needs-server] control (button, input, fieldset).
   Over http(s) it does nothing. No dependencies: works without the rest of
   the Design System as well.

   thought up by human, coded by ai
   ========================================================================== */
(function () {
  'use strict';
  if (location.protocol === 'http:' || location.protocol === 'https:') return;

  function apply() {
    document.querySelectorAll('[data-file-hint]').forEach(function (el) { el.hidden = false; });
    document.querySelectorAll('[data-needs-server]').forEach(function (el) { el.disabled = true; });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply);
  else apply();
}());
