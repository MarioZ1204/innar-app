/**
 * Innar — Utilidades de motion (Fases 1–3)
 * Modales, vistas, agenda, Kanban electro, badges y pausa temporal.
 */
(function () {
  'use strict';

  const PANEL_OUT_MS = 160;
  const OVERLAY_OUT_MS = 180;
  const VIEW_IN_MS = 320;
  const ROW_FLASH_MS = 700;
  const ELECTRO_FLASH_MS = 750;
  const STAGGER_STEP_MS = 45;
  const KANBAN_STAGGER_MS = 40;
  const KANBAN_STAGGER_MAX = 12;

  function motionExitMs() {
    try {
      const v = getComputedStyle(document.documentElement).getPropertyValue('--motion-toast-exit').trim();
      const n = parseInt(v, 10);
      return Number.isFinite(n) && n > 0 ? n : 220;
    } catch (_) {
      return 220;
    }
  }

  window.INNAR_TOAST_EXIT_MS = motionExitMs;

  window.innarMotionPause = function innarMotionPause(ms) {
    const dur = typeof ms === 'number' && ms > 0 ? ms : 450;
    document.documentElement.classList.add('innar-motion-off');
    window.setTimeout(() => document.documentElement.classList.remove('innar-motion-off'), dur);
  };

  function animateClose(el, after) {
    if (!el) {
      if (typeof after === 'function') after();
      return;
    }
    if (document.documentElement.classList.contains('innar-motion-off')) {
      if (typeof after === 'function') after();
      return;
    }
    el.classList.add('innar-modal-closing');
    window.setTimeout(() => {
      el.classList.remove('innar-modal-closing');
      if (typeof after === 'function') after();
    }, Math.max(PANEL_OUT_MS, OVERLAY_OUT_MS));
  }

  window.innarCloseModal = function innarCloseModal(el, onDone) {
    if (!el) return;
    animateClose(el, () => {
      el.classList.add('hidden');
      if (typeof onDone === 'function') onDone();
    });
  };

  window.innarOpenModal = function innarOpenModal(el) {
    if (!el) return;
    el.classList.remove('hidden', 'innar-modal-closing');
  };

  window.innarCloseConfirm = function innarCloseConfirm(backdrop, onDone) {
    if (!backdrop) return;
    animateClose(backdrop, () => {
      backdrop.remove();
      if (typeof onDone === 'function') onDone();
    });
  };

  /**
   * Cierra al hacer clic en el fondo solo si el pointerdown también fue en el fondo.
   * Evita cerrar el modal al seleccionar texto dentro y soltar fuera.
   */
  window.bindBackdropDismiss = function bindBackdropDismiss(backdrop, onDismiss) {
    if (!backdrop || typeof onDismiss !== 'function') return;
    let pressedOnBackdrop = false;
    backdrop.addEventListener('pointerdown', (e) => {
      pressedOnBackdrop = e.target === backdrop;
    });
    backdrop.addEventListener('pointercancel', () => {
      pressedOnBackdrop = false;
    });
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop && pressedOnBackdrop) onDismiss(e);
      pressedOnBackdrop = false;
    });
  };

  window.innarAnimateViewIn = function innarAnimateViewIn(viewEl) {
    if (!viewEl || document.documentElement.classList.contains('innar-motion-off')) return;
    viewEl.classList.remove('innar-view-enter');
    void viewEl.offsetWidth;
    viewEl.classList.add('innar-view-enter');
    window.setTimeout(() => viewEl.classList.remove('innar-view-enter'), VIEW_IN_MS);
  };

  /** True if the container already shows real UI (not an empty/skeleton placeholder). */
  window.innarHasPaintedContent = function innarHasPaintedContent(el) {
    if (!el) return false;
    if (el.querySelector('.electro-cita-card, .sop-folder-card, .sop-nav-item, .turno-row')) return true;
    if (el.tagName === 'TBODY') {
      if (el.querySelector('tr.skeleton-row, tr.sop-skeleton-table-row')) return false;
      const rows = el.querySelectorAll('tr');
      if (!rows.length) return false;
      const text = String(el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text || /^Cargando/i.test(text)) return false;
      return true;
    }
    const kids = el.children;
    if (!kids.length) return false;
    for (let i = 0; i < kids.length; i++) {
      const k = kids[i];
      if (
        k.classList.contains('sop-skeleton-grid') ||
        k.classList.contains('sop-skeleton-block') ||
        k.classList.contains('sop-skeleton-nav-item') ||
        k.classList.contains('skeleton-row')
      ) continue;
      return true;
    }
    return false;
  };

  window.innarHighlightTurnoRow = function innarHighlightTurnoRow(turnoId) {
    if (!turnoId || document.documentElement.classList.contains('innar-motion-off')) return;
    const idStr = String(turnoId).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const sel = `tr.turno-row[data-turno-id="${idStr}"]`;
    const rows = document.querySelectorAll(
      `#turnosTableMedica ${sel}, #turnosTableMedicaCompletados ${sel}`
    );
    rows.forEach((row) => {
      row.classList.remove('innar-row-updated');
      void row.offsetWidth;
      row.classList.add('innar-row-updated');
      window.setTimeout(() => row.classList.remove('innar-row-updated'), ROW_FLASH_MS);
    });
  };

  window.innarSupportsViewTransition = function innarSupportsViewTransition() {
    return typeof document.startViewTransition === 'function'
      && !document.documentElement.classList.contains('innar-motion-off');
  };

  let _innarViewTransitionActive = false;

  window.innarRunViewSwitch = function innarRunViewSwitch(applyFn) {
    if (typeof applyFn !== 'function') return false;
    if (window.innarSupportsViewTransition() && !_innarViewTransitionActive) {
      try {
        const transition = document.startViewTransition(() => {
          applyFn();
        });
        _innarViewTransitionActive = true;
        transition.finished
          .catch((err) => {
            if (err?.name !== 'InvalidStateError') {
              console.warn('[innar-motion] transición interrumpida:', err);
            }
          })
          .finally(() => { _innarViewTransitionActive = false; });
        return true;
      } catch (e) {
        _innarViewTransitionActive = false;
        console.warn('[innar-motion] startViewTransition falló:', e);
      }
    }
    applyFn();
    return false;
  };

  window.innarAnimateKanbanCards = function innarAnimateKanbanCards(root) {
    if (document.documentElement.classList.contains('innar-motion-off')) return;
    const scopeEl = root || document.getElementById('electroKanbanBoard') || document.getElementById('electroKanbanPsg') || document;
    const bodies = scopeEl.querySelectorAll
      ? scopeEl.querySelectorAll('.electro-kanban-body')
      : [];
    bodies.forEach((body) => {
      const cards = [...body.querySelectorAll('.electro-cita-card')];
      cards.forEach((card, index) => {
        card.classList.remove('innar-kanban-enter');
        const delay = Math.min(index, KANBAN_STAGGER_MAX) * KANBAN_STAGGER_MS;
        card.style.animationDelay = `${delay}ms`;
        void card.offsetWidth;
        card.classList.add('innar-kanban-enter');
      });
    });
    const maxMs = VIEW_IN_MS + KANBAN_STAGGER_MAX * KANBAN_STAGGER_MS;
    window.setTimeout(() => {
      (scopeEl.querySelectorAll ? scopeEl.querySelectorAll('.electro-cita-card.innar-kanban-enter') : []).forEach((card) => {
        card.classList.remove('innar-kanban-enter');
        card.style.removeProperty('animation-delay');
      });
    }, maxMs);
  };

  window.innarHighlightElectroCard = function innarHighlightElectroCard(citaId) {
    if (!citaId || document.documentElement.classList.contains('innar-motion-off')) return;
    const idStr = String(citaId).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const cards = document.querySelectorAll(`.electro-cita-card[data-cita-id="${idStr}"]`);
    const run = () => {
      cards.forEach((card) => {
        if (card.classList.contains('innar-kanban-enter')) return;
        card.classList.remove('innar-electro-updated');
        void card.offsetWidth;
        card.classList.add('innar-electro-updated');
        window.setTimeout(() => card.classList.remove('innar-electro-updated'), ELECTRO_FLASH_MS);
      });
    };
    const anyEntering = [...cards].some((c) => c.classList.contains('innar-kanban-enter'));
    if (anyEntering) {
      window.setTimeout(run, VIEW_IN_MS + KANBAN_STAGGER_MAX * KANBAN_STAGGER_MS + 40);
    } else {
      run();
    }
  };

  window.innarStaggerModalFooter = function innarStaggerModalFooter(modalEl) {
    if (!modalEl || document.documentElement.classList.contains('innar-motion-off')) return;
    const wrap = modalEl.querySelector('.cita-modal-footer-actions');
    if (!wrap) return;
    wrap.classList.remove('innar-footer-stagger-active');
    const btns = [...wrap.querySelectorAll('.cita-modal-footer-btn')].filter((b) => !b.hidden);
    btns.forEach((btn) => btn.classList.remove('innar-footer-stagger'));
    if (!btns.length) return;
    void wrap.offsetWidth;
    wrap.classList.add('innar-footer-stagger-active');
    btns.forEach((btn, index) => {
      btn.classList.add('innar-footer-stagger');
      btn.style.animationDelay = `${index * STAGGER_STEP_MS}ms`;
    });
    const totalMs = VIEW_IN_MS + btns.length * STAGGER_STEP_MS;
    window.setTimeout(() => {
      wrap.classList.remove('innar-footer-stagger-active');
      btns.forEach((btn) => {
        btn.classList.remove('innar-footer-stagger');
        btn.style.removeProperty('animation-delay');
      });
    }, totalMs);
  };

  document.addEventListener('click', (e) => {
    const closeSel = e.target.closest('[data-innar-close-modal]');
    if (!closeSel) return;
    const id = closeSel.getAttribute('data-innar-close-modal');
    const modal = id ? document.getElementById(id) : closeSel.closest('.modal-overlay, .modal');
    if (modal) {
      e.preventDefault();
      window.innarCloseModal(modal);
    }
  });
})();
