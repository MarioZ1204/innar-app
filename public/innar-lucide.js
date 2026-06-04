/**
 * Inicialización de iconos Lucide (local /libs/lucide.min.js).
 * Reintenta tras contenido dinámico (tablas PDX, modales).
 */
(function () {
  'use strict';

  const MAX_ATTEMPTS = 80;
  const INTERVAL_MS = 50;

  function getLucide() {
    if (typeof lucide !== 'undefined' && lucide.createIcons) return lucide;
    if (typeof window !== 'undefined' && window.lucide && window.lucide.createIcons) {
      return window.lucide;
    }
    return null;
  }

  function applyIcons(root) {
    const lib = getLucide();
    if (!lib) return false;
    const opts = { attrs: { 'stroke-width': 2 }, nameAttr: 'data-lucide' };
    if (root) opts.root = root;
    try {
      lib.createIcons(opts);
    } catch (_) {
      try { lib.createIcons(); } catch (__) { return false; }
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
        if (attempts >= MAX_ATTEMPTS && !getLucide()) {
          console.warn('[innar-lucide] No se pudo cargar Lucide. Revise /libs/lucide.min.js en el servidor.');
        }
      }
    }, INTERVAL_MS);
  }

  window.innarLucideIcons = scheduleIcons;

  function boot() {
    scheduleIcons(document);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
