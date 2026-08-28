/**
 * Conservación de scroll al refrescar listas + flechas ir arriba/abajo.
 */
(function () {
  'use strict';

  const NAV_MIN_OVERFLOW = 80;
  const NAV_SHOW_TOP_AFTER = 48;
  const SCROLL_SELECTORS = [
    '.main-content',
    '.sop-arm-main',
    '.table-wrapper',
    '.electro-kanban-body',
    '.sop-arm-files',
    '.sop-pdx-files',
    '.sop-list',
    '[data-innar-scroll-root]',
    '[data-innar-scroll-nav]'
  ].join(', ');

  const SCROLL_ROOT_QUERY = '[data-innar-scroll-root], .sop-arm-main, .main-content, .table-wrapper';

  const attachedNav = new WeakSet();
  const ICON_UP = '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="18 15 12 9 6 15"/></svg>';
  const ICON_DOWN = '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';

  const navPositionHandlers = new WeakMap();

  function syncNavPosition(host, nav) {
    if (!host?.isConnected || !nav) return;
    const rect = host.getBoundingClientRect();
    const gapX = window.innerWidth <= 768 ? 8 : 12;
    const gapY = window.innerWidth <= 768 ? 10 : 14;
    const minVisible = 72;
    const visible = rect.bottom > minVisible
      && rect.top < window.innerHeight - minVisible
      && rect.width > 48
      && rect.height > minVisible;

    if (!visible) {
      nav.classList.remove('is-visible');
      return;
    }

    const right = Math.max(gapX, window.innerWidth - rect.right + gapX);
    const bottom = Math.max(gapY, window.innerHeight - rect.bottom + gapY);
    nav.style.right = `${Math.round(right)}px`;
    nav.style.bottom = `${Math.round(bottom)}px`;
  }

  function bindNavPosition(host, nav) {
    if (navPositionHandlers.has(host)) return;
    const onMove = () => syncNavPosition(host, nav);
    const onScroll = () => {
      if (nav._innarPosRaf) return;
      nav._innarPosRaf = requestAnimationFrame(() => {
        nav._innarPosRaf = 0;
        onMove();
      });
    };
    navPositionHandlers.set(host, { onMove, onScroll });
    host.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    onMove();
  }

  function isElementScrollable(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    const oy = style.overflowY;
    const ox = style.overflowX;
    const canScrollY = (oy === 'auto' || oy === 'scroll' || oy === 'overlay')
      && el.scrollHeight > el.clientHeight + 2;
    const canScrollX = (ox === 'auto' || ox === 'scroll' || ox === 'overlay')
      && el.scrollWidth > el.clientWidth + 2;
    return canScrollY || canScrollX;
  }

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

  /** Encuentra el contenedor que el usuario está scrolleando (incl. hijos del módulo). */
  function findBestScrollContainer(anchor) {
    let node = anchor?.nodeType === 1 ? anchor : null;
    while (node && node !== document.documentElement) {
      if (isElementScrollable(node) && node.scrollTop > 0) {
        return { container: node, useWindow: false };
      }
      node = node.parentElement;
    }

    const viewRoot = anchor?.closest?.('[id^="view-"]')
      || (anchor?.id?.startsWith('view-') ? anchor : null);
    if (viewRoot?.querySelectorAll) {
      const scrollables = [];
      viewRoot.querySelectorAll(SCROLL_ROOT_QUERY).forEach((el) => {
        if (isElementScrollable(el)) scrollables.push(el);
      });
      let best = null;
      let bestTop = -1;
      scrollables.forEach((el) => {
        if (el.scrollTop > bestTop) {
          bestTop = el.scrollTop;
          best = el;
        }
      });
      if (best && bestTop > 0) return { container: best, useWindow: false };
      const preferred = viewRoot.querySelector('[data-innar-scroll-root]')
        || viewRoot.querySelector('.sop-arm-main')
        || viewRoot.querySelector('.main-content');
      if (preferred && isElementScrollable(preferred)) {
        return { container: preferred, useWindow: false };
      }
      if (scrollables.length) return { container: scrollables[0], useWindow: false };
    }

    return findScrollContainer(anchor);
  }

  function getScrollSnapshot(anchor) {
    const { container } = findBestScrollContainer(anchor || document.body);
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

  let _innarRestoringScroll = 0;

  function liveSnapshotFrom(base) {
    if (base?.container && base.container.isConnected) {
      return {
        container: base.container,
        useWindow: false,
        top: base.container.scrollTop,
        left: base.container.scrollLeft,
        winX: window.scrollX,
        winY: window.scrollY
      };
    }
    return getScrollSnapshot(base?.container || document.body);
  }

  function restoreScrollSnapshot(snapshot) {
    if (!snapshot) return;
    _innarRestoringScroll += 1;
    try {
      if (snapshot.container && snapshot.container.isConnected) {
        snapshot.container.scrollTop = snapshot.top;
        snapshot.container.scrollLeft = snapshot.left;
      }
      window.scrollTo(snapshot.winX, snapshot.winY);
    } finally {
      requestAnimationFrame(() => {
        _innarRestoringScroll = Math.max(0, _innarRestoringScroll - 1);
      });
    }
  }

  function restoreScrollLater(snapshot) {
    if (!snapshot) return;
    let cancelled = false;
    const onUserScroll = () => {
      if (_innarRestoringScroll) return;
      cancelled = true;
    };
    window.addEventListener('scroll', onUserScroll, { passive: true, capture: true });
    if (snapshot.container) {
      snapshot.container.addEventListener('scroll', onUserScroll, { passive: true });
    }
    const run = () => {
      if (cancelled) return;
      restoreScrollSnapshot(snapshot);
    };
    const cleanup = () => {
      window.removeEventListener('scroll', onUserScroll, { capture: true });
      if (snapshot.container) {
        snapshot.container.removeEventListener('scroll', onUserScroll);
      }
    };
    requestAnimationFrame(() => {
      run();
      requestAnimationFrame(() => {
        run();
        setTimeout(() => {
          run();
          cleanup();
        }, 0);
      });
    });
  }

  async function preserveScroll(anchor, fn, opts = {}) {
    if (opts.preserve === false || typeof fn !== 'function') {
      return typeof fn === 'function' ? fn() : undefined;
    }
    const snap = getScrollSnapshot(anchor || document.body);
    let desired = snap;
    const originEl = snap.container ? snap.top : snap.winY;
    const originWin = snap.winY;

    const onScroll = () => {
      if (_innarRestoringScroll) return;
      const live = liveSnapshotFrom(snap);
      const prevEl = desired.container ? desired.top : desired.winY;
      const nextEl = live.container ? live.top : live.winY;
      // innerHTML al cargar suele resetear a 0; no tomar eso como scroll del usuario
      if (nextEl < 16 && prevEl > 40) return;
      desired = live;
    };

    const scrollEl = snap.container || window;
    scrollEl.addEventListener('scroll', onScroll, { passive: true });
    if (snap.container) window.addEventListener('scroll', onScroll, { passive: true });

    try {
      const result = fn();
      if (result && typeof result.then === 'function') {
        await result;
      }
      return result;
    } finally {
      scrollEl.removeEventListener('scroll', onScroll);
      if (snap.container) window.removeEventListener('scroll', onScroll);
      const destEl = desired.container ? desired.top : desired.winY;
      const userMoved = Math.abs(destEl - originEl) > 8 || Math.abs(desired.winY - originWin) > 8;
      if (userMoved) restoreScrollSnapshot(desired);
      else restoreScrollLater(snap);
    }
  }

  function getModuleAnchor(moduleId) {
    if (!moduleId) return document.body;
    const view = document.getElementById('view-' + moduleId);
    if (!view) return document.body;
    return view.querySelector('[data-innar-scroll-root]')
      || view.querySelector('.sop-arm-main')
      || view.querySelector('.main-content')
      || view;
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
    if (!overflow) {
      navEl.classList.remove('is-visible');
      return;
    }

    syncNavPosition(host, navEl);

    const maxTop = Math.max(0, host.scrollHeight - host.clientHeight);
    const top = host.scrollTop;
    topBtn.classList.toggle('is-hidden', top <= NAV_SHOW_TOP_AFTER);
    bottomBtn.classList.toggle('is-hidden', top >= maxTop - NAV_SHOW_TOP_AFTER);

    const anyVisible = !topBtn.classList.contains('is-hidden')
      || !bottomBtn.classList.contains('is-hidden');
    navEl.classList.toggle('is-visible', anyVisible);
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
    bindNavPosition(host, nav);

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
      if (root._innarScrollScanRaf) return;
      root._innarScrollScanRaf = requestAnimationFrame(() => {
        root._innarScrollScanRaf = 0;
        scanView(root);
      });
    });
    mo.observe(root, { childList: true, subtree: true });

    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(() => {
        if (root._innarScrollScanRaf) return;
        root._innarScrollScanRaf = requestAnimationFrame(() => {
          root._innarScrollScanRaf = 0;
          scanView(root);
        });
      });
      ro.observe(root);
    }
  }

  window.innarFindScrollContainer = findScrollContainer;
  window.innarGetScrollSnapshot = getScrollSnapshot;
  window.innarRestoreScrollSnapshot = restoreScrollSnapshot;
  window.innarRestoreScrollLater = restoreScrollLater;
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
