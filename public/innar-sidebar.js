/**
 * Innar — Sidebar unificado (chrome, pin, tooltips, móvil, badges)
 */
(function () {
  'use strict';

  const LS_PINNED = 'innar_sidebar_pinned';
  const LS_HINT = 'innar_sidebar_hint_seen';
  const DESKTOP_MQ = window.matchMedia('(min-width: 769px)');

  const PIN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1z"/></svg>';
  const HOME_ICON = '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>';
  const MENU_PRINCIPAL_LABEL = 'Menú principal';
  const MENU_PRINCIPAL_TITLE = 'Salir del módulo y volver al menú principal';

  function isPinned() {
    try {
      return localStorage.getItem(LS_PINNED) === '1';
    } catch (_) {
      return false;
    }
  }

  function setPinned(value) {
    const on = !!value;
    try {
      localStorage.setItem(LS_PINNED, on ? '1' : '0');
    } catch (_) { /* ignore */ }
    document.querySelectorAll('.sidebar').forEach((sb) => {
      sb.classList.toggle('is-pinned', on);
    });
    document.querySelectorAll('.sidebar-pin-btn').forEach((btn) => {
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.title = on ? 'Desfijar menú (colapsar al salir)' : 'Fijar menú expandido';
    });
    if (on) dismissHint();
  }

  function normalizeMenuPrincipalBtn(btn) {
    if (!btn || btn.dataset.menuPrincipalNormalized === '1') return;
    btn.dataset.menuPrincipalNormalized = '1';
    btn.classList.add('btn-volver-menu-principal');
    if (!btn.getAttribute('title')) btn.setAttribute('title', MENU_PRINCIPAL_TITLE);
    const svg = btn.querySelector('svg');
    if (svg) svg.outerHTML = HOME_ICON;
    let labelEl = btn.querySelector('.btn-volver-label');
    if (!labelEl) {
      labelEl = document.createElement('span');
      labelEl.className = 'btn-volver-label';
      const textNode = Array.from(btn.childNodes).find((n) => n.nodeType === 3 && n.textContent.trim());
      if (textNode) {
        labelEl.textContent = MENU_PRINCIPAL_LABEL;
        btn.replaceChild(labelEl, textNode);
      } else {
        labelEl.textContent = MENU_PRINCIPAL_LABEL;
        btn.appendChild(labelEl);
      }
    } else {
      labelEl.textContent = MENU_PRINCIPAL_LABEL;
    }
    const spanOnly = btn.querySelector(':scope > span:not(.btn-volver-label)');
    if (spanOnly && !spanOnly.classList.contains('btn-volver-label')) {
      spanOnly.textContent = MENU_PRINCIPAL_LABEL;
      spanOnly.classList.add('btn-volver-label');
    }
    btn.setAttribute('data-sidebar-tooltip', MENU_PRINCIPAL_LABEL);
    btn.setAttribute('aria-label', MENU_PRINCIPAL_LABEL);
  }

  function normalizeAllMenuPrincipalButtons(root) {
    const scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll('.btn-volver').forEach(normalizeMenuPrincipalBtn);
    const llamado = document.getElementById('btnVolverLlamadoPacientes');
    if (llamado) normalizeMenuPrincipalBtn(llamado);
  }

  function getLabelFromBtn(btn) {
    const volverLbl = btn.querySelector('.btn-volver-label');
    if (volverLbl) return (volverLbl.textContent || '').trim();
    const spans = btn.querySelectorAll('span');
    for (let i = spans.length - 1; i >= 0; i--) {
      const sp = spans[i];
      if (sp.classList.contains('sb-icon') || sp.classList.contains('sidebar-badge')) continue;
      const t = (sp.textContent || '').trim();
      if (t) return t;
    }
    return (btn.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function syncTooltips(root) {
    const scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll('.sidebar-btn, .btn-volver').forEach((btn) => {
      const label = getLabelFromBtn(btn);
      if (!label) return;
      btn.setAttribute('data-sidebar-tooltip', label);
      if (!btn.getAttribute('aria-label')) btn.setAttribute('aria-label', label);
    });
    scope.querySelectorAll('.btn-volver').forEach((btn) => {
      const label = getLabelFromBtn(btn) || MENU_PRINCIPAL_LABEL;
      btn.setAttribute('data-sidebar-tooltip', label);
      if (!btn.getAttribute('aria-label')) btn.setAttribute('aria-label', label);
      if (!btn.querySelector('.btn-volver-label')) {
        Array.from(btn.childNodes).forEach((n) => {
          if (n.nodeType === 3 && n.textContent.trim()) {
            const span = document.createElement('span');
            span.className = 'btn-volver-label';
            span.textContent = n.textContent.trim();
            btn.replaceChild(span, n);
          }
        });
      }
    });
  }

  function syncBadges(root) {
    root.querySelectorAll('.sidebar-btn[data-sidebar-badge]').forEach((btn) => {
      let badge = btn.querySelector('.sidebar-badge');
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'sidebar-badge';
        btn.appendChild(badge);
      }
      const raw = btn.getAttribute('data-sidebar-badge') || '';
      const n = parseInt(raw, 10);
      if (raw && n > 0) {
        badge.textContent = n > 99 ? '99+' : String(n);
        btn.classList.add('has-sidebar-badge');
      } else if (raw && raw !== '0') {
        badge.textContent = '';
        btn.classList.add('has-sidebar-badge');
      } else {
        badge.textContent = '';
        btn.classList.remove('has-sidebar-badge');
      }
    });
  }

  function bindPinButton(pinBtn) {
    if (!pinBtn || pinBtn.dataset.bound) return;
    pinBtn.dataset.bound = '1';
    pinBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      setPinned(!isPinned());
    });
  }

  function createPinToolbar() {
    const toolbar = document.createElement('div');
    toolbar.className = 'sidebar-toolbar';
    toolbar.innerHTML = `<button type="button" class="sidebar-pin-btn" aria-pressed="false" aria-label="Fijar menú expandido" title="Fijar menú expandido" data-sidebar-tooltip="Fijar menú">${PIN_ICON}</button>`;
    bindPinButton(toolbar.querySelector('.sidebar-pin-btn'));
    return toolbar;
  }

  function injectBrandFromTemplate(container) {
    const tpl = document.getElementById('tplInnarSidebarBrand');
    if (!tpl || !tpl.content) return;
    if (!container.querySelector('.sidebar-logo-mini')) {
      const mini = tpl.content.querySelector('.sidebar-logo-mini');
      if (mini) container.insertBefore(mini.cloneNode(true), container.firstChild);
    }
    if (!container.querySelector('.sidebar-logo')) {
      const full = tpl.content.querySelector('.sidebar-logo');
      if (full) {
        const mini = container.querySelector('.sidebar-logo-mini');
        if (mini) mini.insertAdjacentElement('afterend', full.cloneNode(true));
        else container.insertBefore(full.cloneNode(true), container.firstChild);
      }
    }
  }

  /** Cabecera: logo + pin en contenedor (sidebar-inner o panel de módulo) */
  function ensureNavChrome(container) {
    if (!container) return;

    injectBrandFromTemplate(container);

    const logoMini = container.querySelector('.sidebar-logo-mini');
    const logoFull = container.querySelector('.sidebar-logo');
    const volver = container.querySelector('.btn-volver');

    let head = container.querySelector('.sidebar-head');
    if (!head) {
      head = document.createElement('div');
      head.className = 'sidebar-head';
      const brand = document.createElement('div');
      brand.className = 'sidebar-brand';
      if (logoMini) brand.appendChild(logoMini);
      if (logoFull) brand.appendChild(logoFull);
      head.appendChild(brand);
      head.appendChild(createPinToolbar());
      container.insertBefore(head, container.firstChild);
    } else {
      let toolbar = head.querySelector('.sidebar-toolbar');
      if (!toolbar) {
        head.appendChild(createPinToolbar());
      } else {
        bindPinButton(toolbar.querySelector('.sidebar-pin-btn'));
      }
      const brand = head.querySelector('.sidebar-brand');
      if (brand) {
        if (logoMini && logoMini.parentElement !== brand) brand.prepend(logoMini);
        if (logoFull && logoFull.parentElement !== brand) brand.appendChild(logoFull);
      }
    }

    container.querySelectorAll(':scope > .sidebar-toolbar').forEach((el) => el.remove());

    if (volver && volver.previousElementSibling !== head) {
      head.insertAdjacentElement('afterend', volver);
    }
  }

  function ensureSidebarHead(sidebar) {
    const inner = sidebar.querySelector('.sidebar-inner');
    if (!inner) return;
    ensureNavChrome(inner);
  }

  function cleanupSopArmNavChrome() {
    const panel = document.getElementById('sopArmNavPanel');
    if (!panel) return;
    panel.querySelectorAll('.sidebar-head, .sidebar-toolbar').forEach((el) => el.remove());
    panel.classList.remove('is-pinned', 'innar-module-nav', 'sop-panel', 'sop-arm-nav-panel');
  }

  function enhanceTopbarBrands() {
    document.querySelectorAll('.sop-topbar-left, .meq-topbar-left').forEach((el) => {
      el.classList.add('innar-topbar-brand');
      const img = el.querySelector('img');
      if (img && !img.closest('.innar-topbar-logo-wrap')) {
        const wrap = document.createElement('div');
        wrap.className = 'innar-topbar-logo-wrap';
        img.parentNode.insertBefore(wrap, img);
        wrap.appendChild(img);
      }
    });
  }

  function ensureFooter(sidebar) {
    if (sidebar.querySelector('.sidebar-footer')) return;
    const tpl = document.getElementById('tplInnarSidebarFooter');
    if (tpl && tpl.content) {
      sidebar.appendChild(tpl.content.cloneNode(true));
      return;
    }
    const footer = document.createElement('div');
    footer.className = 'sidebar-footer';
    footer.innerHTML = `
      <div class="sidebar-user">
        <div class="sidebar-user-avatar">--</div>
        <div>
          <div class="sidebar-user-name">Cargando...</div>
          <div class="sidebar-user-role">-</div>
        </div>
      </div>`;
    sidebar.appendChild(footer);
  }

  function dismissHint() {
    const el = document.getElementById('innarSidebarHint');
    if (el) el.remove();
    try {
      localStorage.setItem(LS_HINT, '1');
    } catch (_) { /* ignore */ }
  }

  function maybeShowHint() {
    if (!DESKTOP_MQ.matches || isPinned()) return;
    try {
      if (localStorage.getItem(LS_HINT) === '1') return;
    } catch (_) { return; }

    if (document.getElementById('innarSidebarHint')) return;
    const hint = document.createElement('div');
    hint.id = 'innarSidebarHint';
    hint.className = 'sidebar-expand-hint';
    hint.setAttribute('role', 'status');
    hint.innerHTML = `
      <p>Pase el cursor sobre el menú o pulse <strong>📌</strong> para fijarlo expandido. El contenido usa todo el ancho disponible.</p>
      <button type="button" class="sidebar-hint-dismiss">Entendido</button>`;
    document.body.appendChild(hint);
    hint.querySelector('.sidebar-hint-dismiss').addEventListener('click', dismissHint);
    window.setTimeout(dismissHint, 12000);
  }

  function enhanceAllSidebars() {
    document.querySelectorAll('.view-module .sidebar, .sidebar').forEach((sidebar) => {
      ensureSidebarHead(sidebar);
      ensureFooter(sidebar);
      syncTooltips(sidebar);
      syncBadges(sidebar);
    });
    cleanupSopArmNavChrome();
    enhanceTopbarBrands();
    normalizeAllMenuPrincipalButtons();
    setPinned(isPinned());
    maybeShowHint();
  }

  /* ── Móvil (antes en app.js) ───────────────────────────────────────────── */
  function setupMobileSidebars() {
    if (window._innarMobileSidebarSetup) return;
    window._innarMobileSidebarSetup = true;

    function openSidebar(sidebar, backdrop) {
      sidebar.classList.add('mobile-open');
      backdrop.classList.add('active');
      document.body.classList.add('innar-sidebar-drawer-open');
      /* iOS: el rail colapsado dependía de :hover; mobile-open fuerza UI expandida vía CSS */
      sidebar.scrollTop = 0;
    }

    function closeSidebar(sidebar, backdrop) {
      sidebar.classList.remove('mobile-open');
      backdrop.classList.remove('active');
      if (!document.querySelector('.sidebar.mobile-open')) {
        document.body.classList.remove('innar-sidebar-drawer-open');
      }
    }

    function closeAll() {
      document.querySelectorAll('.sidebar.mobile-open').forEach((s) => {
        const layout = s.closest('.main-layout');
        const bd = layout && layout.querySelector('.mobile-sidebar-backdrop');
        closeSidebar(s, bd || { classList: { remove: () => {} } });
      });
    }

    document.querySelectorAll('.view-module .main-layout, .main-layout').forEach((layout) => {
      const sidebar = layout.querySelector(':scope > .sidebar');
      const mainContent = layout.querySelector(':scope > .main-content');
      if (!sidebar || !mainContent) return;

      let backdrop = layout.querySelector('.mobile-sidebar-backdrop');
      if (!backdrop) {
        backdrop = document.createElement('div');
        backdrop.className = 'mobile-sidebar-backdrop';
        layout.appendChild(backdrop);
      }
      backdrop.addEventListener('click', () => closeSidebar(sidebar, backdrop));

      let btn = layout.querySelector(':scope > .mobile-menu-btn');
      if (!btn) {
        btn = document.createElement('button');
        btn.className = 'mobile-menu-btn no-print';
        btn.setAttribute('aria-label', 'Abrir navegación');
        btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>';
        layout.insertBefore(btn, mainContent);
      }
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (sidebar.classList.contains('mobile-open')) {
          closeSidebar(sidebar, backdrop);
        } else {
          openSidebar(sidebar, backdrop);
        }
      });
    });

    DESKTOP_MQ.addEventListener('change', () => {
      if (DESKTOP_MQ.matches) closeAll();
    });

    document.addEventListener('click', (e) => {
      if (e.target.closest('.btn-volver') || e.target.closest('.sidebar-btn')) closeAll();
    }, true);

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeAll();
    });
  }

  let _sidebarInitDone = false;

  function applyShellLight() {
    document.documentElement.classList.add('innar-shell-light');
  }

  function innarSidebarInit() {
    applyShellLight();
    enhanceAllSidebars();
    setupMobileSidebars();
    _sidebarInitDone = true;
  }

  /** Actualizar badge de un botón por selector dentro de un módulo */
  window.innarSidebarSetBadge = function innarSidebarSetBadge(selector, value) {
    document.querySelectorAll(selector).forEach((btn) => {
      if (!btn.classList.contains('sidebar-btn')) return;
      btn.setAttribute('data-sidebar-badge', value == null ? '' : String(value));
      syncBadges(btn.closest('.sidebar') || document);
    });
  };

  window.innarSidebarRefresh = function innarSidebarRefresh() {
    enhanceAllSidebars();
  };

  window.innarSidebarInit = innarSidebarInit;

  applyShellLight();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', innarSidebarInit);
  } else {
    innarSidebarInit();
  }

  DESKTOP_MQ.addEventListener('change', () => {
    if (!DESKTOP_MQ.matches) dismissHint();
  });
})();
