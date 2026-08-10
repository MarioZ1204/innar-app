/**
 * Chat Messenger — dock + ventanas flotantes (recepción ↔ doctores).
 */
(function () {
  'use strict';

  const MAX_WINDOWS = 3;
  const ICON_CHAT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 11.5a8.5 8.5 0 01-12.4 7.5L3 21l2.1-5.1A8.5 8.5 0 1121 11.5z"/></svg>';
  const ICON_SEND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>';

  /** @type {{ contactos: any[], windows: Map<number, any>, dockOpen: boolean, totalUnread: number, draftCtx: any }} */
  const state = {
    contactos: [],
    windows: new Map(),
    dockOpen: false,
    totalUnread: 0,
    draftCtx: null,
    pendingPrefill: null,
    loaded: false,
    search: ''
  };

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function puedeUsarChat() {
    return typeof tienePermiso === 'function' && tienePermiso('chat.usar');
  }

  function apiFetchLocal(url, opts) {
    if (typeof apiFetch === 'function') return apiFetch(url, opts);
    return fetch(url, { credentials: 'same-origin', ...(opts || {}) });
  }

  function initials(nombre) {
    const words = String(nombre || '').trim().split(/\s+/).filter(Boolean);
    if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase();
    return String(nombre || '?').slice(0, 2).toUpperCase();
  }

  function formatHora(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
  }

  function formatDia(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const hoy = new Date();
    const ayer = new Date();
    ayer.setDate(hoy.getDate() - 1);
    const ymd = (x) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
    if (ymd(d) === ymd(hoy)) return 'Hoy';
    if (ymd(d) === ymd(ayer)) return 'Ayer';
    return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
  }

  function ensureRoot() {
    let root = document.getElementById('chatMessengerRoot');
    if (root) return root;
    root = document.createElement('div');
    root.id = 'chatMessengerRoot';
    root.innerHTML = `
      <div class="chat-msgr-layer">
        <button type="button" class="chat-msgr-toggle" id="chatMsgrToggle" title="Chat" aria-label="Abrir chat">
          ${ICON_CHAT}
          <span class="chat-msgr-badge" id="chatMsgrBadge">0</span>
        </button>
        <div class="chat-msgr-dock" id="chatMsgrDock" role="dialog" aria-label="Contactos del chat">
          <div class="chat-msgr-dock-head">
            <h3>Chat</h3>
            <button type="button" class="chat-msgr-dock-close" id="chatMsgrDockClose" aria-label="Cerrar">×</button>
          </div>
          <input type="search" class="chat-msgr-search" id="chatMsgrSearch" placeholder="Buscar contacto…" autocomplete="off" />
          <div class="chat-msgr-list" id="chatMsgrList"></div>
        </div>
        <div class="chat-msgr-windows" id="chatMsgrWindows"></div>
      </div>`;
    document.body.appendChild(root);
    document.getElementById('chatMsgrToggle')?.addEventListener('click', () => {
      state.dockOpen = !state.dockOpen;
      syncDockVisibility();
      if (state.dockOpen) void refreshContactos();
    });
    document.getElementById('chatMsgrDockClose')?.addEventListener('click', () => {
      state.dockOpen = false;
      syncDockVisibility();
    });
    document.getElementById('chatMsgrSearch')?.addEventListener('input', (e) => {
      state.search = String(e.target.value || '').trim().toLowerCase();
      renderContactList();
    });
    return root;
  }

  function syncDockVisibility() {
    const dock = document.getElementById('chatMsgrDock');
    if (!dock) return;
    dock.classList.toggle('is-open', state.dockOpen);
  }

  function setBadge(n) {
    state.totalUnread = Math.max(0, n | 0);
    const badge = document.getElementById('chatMsgrBadge');
    if (!badge) return;
    if (state.totalUnread > 0) {
      badge.textContent = state.totalUnread > 99 ? '99+' : String(state.totalUnread);
      badge.classList.add('is-visible');
    } else {
      badge.classList.remove('is-visible');
    }
  }

  async function refreshUnread() {
    if (!puedeUsarChat()) return;
    try {
      const res = await apiFetchLocal('/api/chat/no-leidos');
      const data = await res.json();
      if (data.ok) setBadge(data.total);
    } catch (_) { /* noop */ }
  }

  async function refreshContactos() {
    if (!puedeUsarChat()) return;
    try {
      const res = await apiFetchLocal('/api/chat/contactos');
      const data = await res.json();
      if (!data.ok) return;
      state.contactos = data.contactos || [];
      const total = state.contactos.reduce((s, c) => s + (parseInt(c.no_leidos, 10) || 0), 0);
      setBadge(total);
      renderContactList();
    } catch (_) { /* noop */ }
  }

  function renderContactList() {
    const list = document.getElementById('chatMsgrList');
    if (!list) return;
    const q = state.search;
    const items = state.contactos.filter((c) => {
      if (!q) return true;
      const hay = `${c.nombre} ${c.rol_label || ''} ${c.usuario || ''}`.toLowerCase();
      return hay.includes(q);
    });
    if (!items.length) {
      list.innerHTML = '<div class="chat-msgr-empty">Sin contactos disponibles</div>';
      return;
    }
    list.innerHTML = items.map((c) => {
      const unread = parseInt(c.no_leidos, 10) || 0;
      return `<button type="button" class="chat-msgr-contact" data-peer-id="${c.id}">
        <span class="chat-msgr-avatar">${escapeHtml(initials(c.nombre))}
          <span class="chat-msgr-dot${c.online ? ' is-online' : ''}"></span>
        </span>
        <span class="chat-msgr-contact-meta">
          <span class="chat-msgr-contact-name">${escapeHtml(c.nombre)}</span>
          <span class="chat-msgr-contact-sub">${escapeHtml(c.preview || c.rol_label || c.rol || '')}</span>
        </span>
        ${unread ? `<span class="chat-msgr-contact-unread">${unread > 99 ? '99+' : unread}</span>` : ''}
      </button>`;
    }).join('');
    list.querySelectorAll('.chat-msgr-contact').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = parseInt(btn.getAttribute('data-peer-id'), 10);
        const c = state.contactos.find((x) => Number(x.id) === id);
        if (c) {
          const prefill = state.pendingPrefill;
          state.pendingPrefill = null;
          void openChatWithPeer(c, prefill ? { prefill } : {});
        }
      });
    });
  }

  async function openChatWithPeer(peer, opts = {}) {
    if (!peer || !peer.id) return null;
    let convId = peer.conversacion_id || null;
    if (!convId) {
      const res = await apiFetchLocal('/api/chat/conversaciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ destinatario_id: peer.id })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        if (typeof showToast === 'function') showToast(data.error || 'No se pudo abrir el chat', 'error');
        return null;
      }
      convId = data.conversacion.id;
      peer = { ...peer, ...data.conversacion.peer, conversacion_id: convId };
    }
    openWindow(peer, convId, opts);
    return convId;
  }

  function openWindow(peer, conversacionId, opts = {}) {
    if (state.windows.has(Number(peer.id))) {
      const w = state.windows.get(Number(peer.id));
      w.minimized = false;
      w.el.classList.remove('is-minimized');
      if (opts.prefill) applyPrefill(w, opts.prefill);
      w.el.querySelector('textarea')?.focus();
      return;
    }
    while (state.windows.size >= MAX_WINDOWS) {
      const firstKey = state.windows.keys().next().value;
      closeWindow(firstKey);
    }
    const wrap = document.getElementById('chatMsgrWindows');
    if (!wrap) return;
    const el = document.createElement('div');
    el.className = 'chat-msgr-window';
    el.dataset.peerId = String(peer.id);
    el.innerHTML = `
      <div class="chat-msgr-win-head">
        <span class="chat-msgr-avatar">${escapeHtml(initials(peer.nombre))}
          <span class="chat-msgr-dot${peer.online ? ' is-online' : ''}"></span>
        </span>
        <div class="chat-msgr-win-titles">
          <div class="chat-msgr-win-name">${escapeHtml(peer.nombre)}</div>
          <div class="chat-msgr-win-status">${escapeHtml(peer.online ? 'En línea' : (peer.rol_label || peer.rol || ''))}</div>
        </div>
        <div class="chat-msgr-win-actions">
          <button type="button" data-act="min" title="Minimizar">–</button>
          <button type="button" data-act="close" title="Cerrar">×</button>
        </div>
      </div>
      <div class="chat-msgr-body"></div>
      <div class="chat-msgr-compose">
        <textarea rows="1" placeholder="Escribe un mensaje…" maxlength="2000"></textarea>
        <button type="button" class="chat-msgr-send" title="Enviar" disabled>${ICON_SEND}</button>
      </div>`;
    wrap.appendChild(el);

    const win = {
      peer,
      conversacionId,
      el,
      minimized: false,
      messages: [],
      loading: false,
      prefill: opts.prefill || null
    };
    state.windows.set(Number(peer.id), win);

    el.querySelector('[data-act="close"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      closeWindow(peer.id);
    });
    el.querySelector('[data-act="min"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      win.minimized = !win.minimized;
      el.classList.toggle('is-minimized', win.minimized);
    });
    el.querySelector('.chat-msgr-win-head')?.addEventListener('click', (e) => {
      if (e.target.closest('[data-act]')) return;
      if (win.minimized) {
        win.minimized = false;
        el.classList.remove('is-minimized');
      }
    });

    const ta = el.querySelector('textarea');
    const sendBtn = el.querySelector('.chat-msgr-send');
    const syncSend = () => {
      sendBtn.disabled = !String(ta.value || '').trim();
    };
    ta.addEventListener('input', () => {
      ta.style.height = 'auto';
      ta.style.height = Math.min(90, ta.scrollHeight) + 'px';
      syncSend();
    });
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void sendMessage(win);
      }
    });
    sendBtn.addEventListener('click', () => void sendMessage(win));

    if (opts.prefill) applyPrefill(win, opts.prefill);
    void loadMessages(win);
    ta.focus();
  }

  function applyPrefill(win, prefill) {
    if (!prefill) return;
    win.prefill = prefill;
    const ta = win.el.querySelector('textarea');
    if (ta && prefill.cuerpo && !ta.value) {
      ta.value = prefill.cuerpo;
      ta.dispatchEvent(new Event('input'));
    }
  }

  function closeWindow(peerId) {
    const win = state.windows.get(Number(peerId));
    if (!win) return;
    win.el.remove();
    state.windows.delete(Number(peerId));
  }

  async function loadMessages(win) {
    if (win.loading) return;
    win.loading = true;
    try {
      const res = await apiFetchLocal(`/api/chat/conversaciones/${win.conversacionId}/mensajes?limit=40`);
      const data = await res.json();
      if (!data.ok) return;
      win.messages = data.mensajes || [];
      renderMessages(win);
      await markRead(win);
    } catch (_) { /* noop */ }
    finally {
      win.loading = false;
    }
  }

  function renderMessages(win) {
    const body = win.el.querySelector('.chat-msgr-body');
    if (!body) return;
    const me = (typeof currentUser !== 'undefined' && currentUser?.id) ? Number(currentUser.id) : null;
    let html = '';
    let lastDay = '';
    win.messages.forEach((m) => {
      const day = formatDia(m.creado_en);
      if (day && day !== lastDay) {
        html += `<div class="chat-msgr-daysep">${escapeHtml(day)}</div>`;
        lastDay = day;
      }
      const mine = me != null && Number(m.autor_id) === me;
      let chip = '';
      if (m.contexto_label || m.paciente_nombre) {
        const label = m.contexto_label || m.paciente_nombre;
        chip = `<span class="chat-msgr-chip" title="Contexto de cita">📎 ${escapeHtml(label)}</span>`;
      }
      html += `<div class="chat-msgr-bubble ${mine ? 'mine' : 'theirs'}">
        ${chip}
        <div>${escapeHtml(m.cuerpo)}</div>
        <span class="chat-msgr-bubble-time">${escapeHtml(formatHora(m.creado_en))}</span>
      </div>`;
    });
    body.innerHTML = html || '<div class="chat-msgr-empty" style="padding:16px">Sin mensajes aún. ¡Saluda!</div>';
    body.scrollTop = body.scrollHeight;
  }

  async function markRead(win) {
    try {
      await apiFetchLocal(`/api/chat/conversaciones/${win.conversacionId}/leer`, { method: 'POST' });
      const c = state.contactos.find((x) => Number(x.id) === Number(win.peer.id));
      if (c) c.no_leidos = 0;
      renderContactList();
      await refreshUnread();
    } catch (_) { /* noop */ }
  }

  async function sendMessage(win) {
    const ta = win.el.querySelector('textarea');
    const cuerpo = String(ta?.value || '').trim();
    if (!cuerpo) return;
    const payload = { cuerpo };
    if (win.prefill) {
      if (win.prefill.paciente_id) payload.paciente_id = win.prefill.paciente_id;
      if (win.prefill.turno_id) payload.turno_id = win.prefill.turno_id;
      if (win.prefill.cita_electro_id) payload.cita_electro_id = win.prefill.cita_electro_id;
      if (win.prefill.paciente_nombre) payload.paciente_nombre = win.prefill.paciente_nombre;
      if (win.prefill.contexto_label) payload.contexto_label = win.prefill.contexto_label;
    }
    ta.value = '';
    ta.dispatchEvent(new Event('input'));
    try {
      const res = await apiFetchLocal(`/api/chat/conversaciones/${win.conversacionId}/mensajes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        if (typeof showToast === 'function') showToast(data.error || 'No se pudo enviar', 'error');
        ta.value = cuerpo;
        ta.dispatchEvent(new Event('input'));
        return;
      }
      win.prefill = null;
      appendMessageLocal(win, data.mensaje);
      const c = state.contactos.find((x) => Number(x.id) === Number(win.peer.id));
      if (c) {
        c.preview = data.mensaje.cuerpo;
        c.ultimo_mensaje_at = data.mensaje.creado_en;
        c.conversacion_id = win.conversacionId;
      }
      renderContactList();
    } catch (e) {
      if (typeof showToast === 'function') showToast('Error de red al enviar', 'error');
      ta.value = cuerpo;
      ta.dispatchEvent(new Event('input'));
    }
  }

  function appendMessageLocal(win, mensaje) {
    if (!mensaje) return;
    if (win.messages.some((m) => Number(m.id) === Number(mensaje.id))) return;
    win.messages.push(mensaje);
    renderMessages(win);
  }

  function handleIncoming(payload, isEcho) {
    if (!payload || !payload.mensaje) return;

    let peerKey = null;
    if (isEcho) {
      for (const [pid, w] of state.windows) {
        if (Number(w.conversacionId) === Number(payload.conversacion_id)) {
          peerKey = pid;
          break;
        }
      }
    } else if (payload.from?.id != null) {
      peerKey = Number(payload.from.id);
    }

    if (peerKey != null && state.windows.has(peerKey)) {
      const win = state.windows.get(peerKey);
      appendMessageLocal(win, payload.mensaje);
      if (!isEcho) void markRead(win);
      return;
    }

    if (isEcho) return;

    if (typeof showToast === 'function') {
      const name = payload.from?.nombre || 'Chat';
      showToast(`${name}: ${String(payload.mensaje.cuerpo || '').slice(0, 60)}`, 'info');
    }
    void refreshUnread();
    if (state.dockOpen) {
      void refreshContactos();
    } else if (payload.from?.id != null) {
      const c = state.contactos.find((x) => Number(x.id) === Number(payload.from.id));
      if (c) {
        c.no_leidos = (parseInt(c.no_leidos, 10) || 0) + 1;
        c.preview = payload.mensaje.cuerpo;
        c.conversacion_id = payload.conversacion_id;
      }
      setBadge(state.totalUnread + 1);
    }
  }

  function bindRealtime() {
    const sock = window.socket;
    if (!sock || typeof sock.on !== 'function') return;
    if (window._chatMsgrRealtimeBound) return;
    window._chatMsgrRealtimeBound = true;
    sock.on('chat:mensaje', (data) => handleIncoming(data, false));
    sock.on('chat:mensaje_echo', (data) => handleIncoming(data, true));
    sock.on('chat:leido', () => { /* UI de leídos fase 2 */ });
  }

  function showUiIfAllowed() {
    const root = ensureRoot();
    if (!puedeUsarChat()) {
      root.classList.add('chat-msgr-hidden');
      return;
    }
    root.classList.remove('chat-msgr-hidden');
    bindRealtime();
    if (!state.loaded) {
      state.loaded = true;
      void refreshUnread();
    }
  }

  /**
   * Abre chat con un doctor y precarga aviso de paciente/cita.
   * @param {{ doctorId: number, doctorNombre?: string, cuerpo?: string, paciente_nombre?: string, turno_id?: number, cita_electro_id?: number, paciente_id?: number, contexto_label?: string }} opts
   */
  async function avisarPorChat(opts) {
    if (!puedeUsarChat()) {
      if (typeof showToast === 'function') showToast('No tienes permiso de chat', 'error');
      return;
    }
    showUiIfAllowed();
    const doctorId = parseInt(opts.doctorId, 10);
    if (!doctorId) return;
    let peer = state.contactos.find((c) => Number(c.id) === doctorId);
    if (!peer) {
      await refreshContactos();
      peer = state.contactos.find((c) => Number(c.id) === doctorId);
    }
    if (!peer) {
      peer = {
        id: doctorId,
        nombre: opts.doctorNombre || 'Doctor',
        rol: 'doctor',
        rol_label: 'Doctor',
        online: false,
        no_leidos: 0
      };
    }
    state.dockOpen = false;
    syncDockVisibility();
    await openChatWithPeer(peer, {
      prefill: {
        cuerpo: opts.cuerpo || '',
        paciente_id: opts.paciente_id || null,
        turno_id: opts.turno_id || null,
        cita_electro_id: opts.cita_electro_id || null,
        paciente_nombre: opts.paciente_nombre || null,
        contexto_label: opts.contexto_label || null
      }
    });
  }

  /** Abre el dock con un mensaje precargado; el usuario elige el contacto (útil en Electro). */
  function prepararAviso(prefill) {
    if (!puedeUsarChat()) {
      if (typeof showToast === 'function') showToast('No tienes permiso de chat', 'error');
      return;
    }
    showUiIfAllowed();
    state.pendingPrefill = prefill || null;
    state.dockOpen = true;
    syncDockVisibility();
    void refreshContactos();
    if (typeof showToast === 'function') {
      showToast('Elige a quién avisar en el chat', 'info');
    }
  }

  function boot() {
    if (!document.body) return;
    showUiIfAllowed();
  }

  window.innarChatMessenger = {
    refresh: () => { showUiIfAllowed(); void refreshContactos(); void refreshUnread(); },
    avisarPorChat,
    prepararAviso,
    openWithUser: (peer) => openChatWithPeer(peer),
    show: showUiIfAllowed
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.addEventListener('socketReady', () => {
    bindRealtime();
    showUiIfAllowed();
  });

  // Tras login / cambio de usuario
  const _origUpdateMenu = window.updateMenuByRole;
  // Re-check when permisos se aplican: observer liviano
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && puedeUsarChat()) {
      void refreshUnread();
    }
  });

  // Exponer re-init tras login (app.js llama updateMenuByRole)
  const prev = window.tienePermiso;
  Object.defineProperty(window, '_chatMsgrWatchPerm', {
    configurable: true,
    set() { /* noop */ }
  });

  // Polling suave de visibilidad del dock tras autenticación
  let tries = 0;
  const bootTimer = setInterval(() => {
    tries += 1;
    showUiIfAllowed();
    if (puedeUsarChat() || tries > 40) clearInterval(bootTimer);
  }, 500);
})();
