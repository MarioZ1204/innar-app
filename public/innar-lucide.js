/**
 * Inicialización de iconos Lucide (local /libs/lucide.min.js).
 * Reintenta tras contenido dinámico (tablas PDX, modales) por si el script llega tarde.
 */
(function () {
  'use strict';

  const MAX_ATTEMPTS = 50;
  const INTERVAL_MS = 40;

  function applyIcons(root) {
    if (typeof lucide === 'undefined' || typeof lucide.createIcons !== 'function') {
      return false;
    }
    const opts = { attrs: { 'stroke-width': 2 }, nameAttr: 'data-lucide' };
    if (root) opts.root = root;
    try {
      lucide.createIcons(opts);
    } catch (_) {
      try { lucide.createIcons(); } catch (__) { return false; }
    }
    return true;
  }

  function scheduleIcons(root) {
    const target = root || document;
    if (applyIcons(target)) return;
    let attempts = 0;
    const timer = setInterval(() => {
      if (applyIcons(target) || ++attempts >= MAX_ATTEMPTS) {
        clearInterval(timer);
      }
    }, INTERVAL_MS);
  }

  window.innarLucideIcons = scheduleIcons;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => scheduleIcons(document));
  } else {
    scheduleIcons(document);
  }
})();
