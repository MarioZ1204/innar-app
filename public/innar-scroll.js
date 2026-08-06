/**
 * Conservación de scroll al refrescar listas + flechas ir arriba/abajo.
 */
(function () {
  'use strict';

  const NAV_MIN_OVERFLOW = 80;
  const NAV_SHOW_TOP_AFTER = 48;
  const SCROLL_SELECTORS = [
    '.main-content',
    '.table-wrapper',
    '.electro-kanban-body',
    '.sop-arm-files',
    '.sop-pdx-files',
    '.sop-list',
    '[data-innar-scroll-nav]'
  ].join(', ');

  const attachedNav = new WeakSet();
  const ICON_UP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>';
  const ICON_DOWN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg>';

  function findScrollContainer(el) {
    if (!el) {
      return { container: null, useWindow: true };
    }
    let node = el.nodeType === 1 ? el : el.parentElement;
    while (node && node !== document.body && node !== document.documentElement) {
      const style = window.getComputedStyle(node);
      const oy = style.overflowY;
      const ox = style.overflowX;
      const canScrollY = (oy === 'auto' || oy === 'scroll' || oy === 'overlay')
        && node.scrollHeight > node.clientHeight + 2;
      const canScrollX = (ox === 'auto' || ox === 'scroll' || ox === 'overlay')
        && node.scrollWidth > node.clientWidth + 2;
      if (canScrollY || canScrollX) {
        return { container: node, useWindow: false };
      }
      node = node.parentElement;
    }
    return { container: null, useWindow: true };
  }

  function getScrollSnapshot(anchor) {
    const { container } = findScrollContainer(anchor || document.body);
    if (container) {
      return {
        container,
        useWindow: false,
        top: container.scrollTop,
        left: container.scrollLeft,
        winX: window.scrollX,
        winY: window.scrollY
      };
    }
    return {
      container: null,
      useWindow: true,
      top: 0,
      left: 0,
      winX: window.scrollX,
      winY: window.scrollY
    };
  }

  function restoreScrollSnapshot(snapshot) {
    if (!snapshot) return;
    if (snapshot.container) {
      snapshot.container.scrollTop = snapshot.top;
      snapshot.container.scrollLeft = snapshot.left;
    }
    window.scrollTo(snapshot.winX, snapshot.winY);
  }

  function restoreScrollLater(snapshot) {
    requestAnimationFrame(() => {
      restoreScrollSnapshot(snapshot);
      requestAnimationFrame(() => restoreScrollSnapshot(snapshot));
    });
  }

  async function preserveScroll(anchor, fn, opts = {}) {
    if (opts.preserve === false || typeof fn !== 'function') {
      return typeof fn === 'function' ? fn() : undefined;
    }
    const snap = getScrollSnapshot(anchor || document.body);
    try {
      const result = fn();
      if (result && typeof result.then === 'function') {
        await result;
      }
      return result;
    } finally {
      restoreScrollLater(snap);
    }
  }

  function getModuleAnchor(moduleId) {
    if (!moduleId) return document.body;
    const view = document.getElementById('view-' + moduleId);
    if (!view) return document.body;
    return view.querySelector('.main-content') || view;
  }

  function preserveModuleScroll(moduleId, fn, opts) {
    return preserveScroll(getModuleAnchor(moduleId), fn, opts);
  }

  function isScrollableEnough(el) {
    if (!el) return false;
    return el.scrollHeight > el.clientHeight + NAV_MIN_OVERFLOW;
  }

  function updateNavButtons(host, navEl) {
    const topBtn = navEl.querySelector('.innar-scroll-nav-top');
    const bottomBtn = navEl.querySelector('.innar-scroll-nav-bottom');
    if (!topBtn || !bottomBtn) return;

    const overflow = isScrollableEnough(host);
    navEl.classList.toggle('is-visible', overflow);
    if (!overflow) return;

    const maxTop = Math.max(0, host.scrollHeight - host.clientHeight);
    const top = host.scrollTop;
    topBtn.classList.toggle('is-hidden', top <= NAV_SHOW_TOP_AFTER);
    bottomBtn.classList.toggle('is-hidden', top >= maxTop - NAV_SHOW_TOP_AFTER);
  }

  function attachScrollNav(host) {
    if (!host || attachedNav.has(host)) return;
    attachedNav.add(host);

    host.classList.add('innar-scroll-nav-host');

    const nav = document.createElement('div');
    nav.className = 'innar-scroll-nav';
    nav.setAttribute('aria-hidden', 'true');
    nav.innerHTML = `
      <button type="button" class="innar-scroll-nav-btn innar-scroll-nav-top" title="Ir al inicio" aria-label="Ir al inicio">${ICON_UP}</button>
      <button type="button" class="innar-scroll-nav-btn innar-scroll-nav-bottom" title="Ir al final" aria-label="Ir al final">${ICON_DOWN}</button>
    `;
    host.appendChild(nav);

    const topBtn = nav.querySelector('.innar-scroll-nav-top');
    const bottomBtn = nav.querySelector('.innar-scroll-nav-bottom');

    topBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      host.scrollTo({ top: 0, behavior: 'smooth' });
    });
    bottomBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      host.scrollTo({ top: host.scrollHeight, behavior: 'smooth' });
    });

    const onScroll = () => updateNavButtons(host, nav);
    host.addEventListener('scroll', onScroll, { passive: true });

    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(() => updateNavButtons(host, nav));
      ro.observe(host);
    }

    updateNavButtons(host, nav);
  }

  function scanView(root) {
    if (!root) return;
    const hosts = new Set();

    root.querySelectorAll(SCROLL_SELECTORS).forEach((el) => {
      if (isScrollableEnough(el) || el.classList.contains('main-content')) {
        hosts.add(el);
      }
    });

    hosts.forEach((host) => {
      if (isScrollableEnough(host) || host.classList.contains('main-content')) {
        attachScrollNav(host);
        const nav = host.querySelector('.innar-scroll-nav');
        if (nav) updateNavButtons(host, nav);
      }
    });
  }

  function observeView(root) {
    scanView(root);
    if (!root || typeof MutationObserver !== 'function') return;
    if (root._innarScrollObserved) return;
    root._innarScrollObserved = true;

    const mo = new MutationObserver(() => {
      scanView(root);
    });
    mo.observe(root, { childList: true, subtree: true });

    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(() => scanView(root));
      ro.observe(root);
    }
  }

  window.innarFindScrollContainer = findScrollContainer;
  window.innarGetScrollSnapshot = getScrollSnapshot;
  window.innarRestoreScrollSnapshot = restoreScrollSnapshot;
  window.innarPreserveScroll = preserveScroll;
  window.innarGetModuleAnchor = getModuleAnchor;
  window.innarPreserveModuleScroll = preserveModuleScroll;
  window.innarScrollNav = {
    attach: attachScrollNav,
    scanView,
    observeView,
    updateNavButtons
  };
})();
