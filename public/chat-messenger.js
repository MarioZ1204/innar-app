/**
 * Chat Messenger — dock + ventanas flotantes (recepción ↔ doctores).
 * Avisos (toast/sonido/título/Notification), móvil y leídos.
 */
(function () {
  'use strict';

  const MAX_WINDOWS_DESKTOP = 3;
  const LS_NOTIF = 'innar_chat_notif';
  const ICON_CHAT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 11.5a8.5 8.5 0 01-12.4 7.5L3 21l2.1-5.1A8.5 8.5 0 1121 11.5z"/></svg>';
  const ICON_SEND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>';
  const ICON_BELL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M18 8A6 6 0 106 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>';

  const state = {
    contactos: [],
    windows: new Map(),
    dockOpen: false,
    totalUnread: 0,
    pendingPrefill: null,
    loaded: false,
    search: '',
    titleBase: null,
    audioUnlocked: false,
    audioCtx: null,
    viewportBound: false
  };

  function maxWindows() {
    return (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width: 720px)').matches)
      ? 1
      : MAX_WINDOWS_DESKTOP;
  }

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

  function ensureTitleBase() {
    if (state.titleBase == null) {
      state.titleBase = document.title.replace(/^\(\d+\)\s*/, '') || 'INNAR';
    }
    return state.titleBase;
  }

  function updateDocumentTitle(unread) {
    const base = ensureTitleBase();
    const n = Math.max(0, unread | 0);
    document.title = n > 0 ? `(${n > 99 ? '99+' : n}) ${base}` : base;
  }

  function unlockChatAudio() {
    if (state.audioUnlocked) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!state.audioCtx) state.audioCtx = new Ctx();
      if (state.audioCtx.state === 'suspended') void state.audioCtx.resume();
      state.audioUnlocked = true;
    } catch (_) { /* noop */ }
  }

  function playChatSound() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!state.audioCtx) state.audioCtx = new Ctx();
      const ctx = state.audioCtx;
      if (ctx.state === 'suspended') {
        void ctx.resume().then(() => playChatSound());
        return;
      }
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.setValueAtTime(1175, now + 0.08);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.24);
      state.audioUnlocked = true;
    } catch (_) { /* noop */ }
  }

  function notifPrefEnabled() {
    try {
      return localStorage.getItem(LS_NOTIF) === '1';
    } catch (_) {
      return false;
    }
  }

  function setNotifPref(on) {
    try {
      localStorage.setItem(LS_NOTIF, on ? '1' : '0');
    } catch (_) { /* noop */ }
    syncNotifButton();
  }

  function syncNotifButton() {
    const btn = document.getElementById('chatMsgrNotifBtn');
    if (!btn) return;
    const supported = typeof Notification !== 'undefined';
    if (!supported) {
      btn.style.display = 'none';
      return;
    }
    btn.style.display = '';
    const perm = Notification.permission;
    if (perm === 'granted' && notifPrefEnabled()) {
      btn.classList.add('is-on');
      btn.title = 'Notificaciones activadas';
      btn.setAttribute('aria-label', 'Notificaciones activadas');
    } else if (perm === 'denied') {
      btn.classList.remove('is-on');
      btn.title = 'Notificaciones bloqueadas en el navegador';
      btn.setAttribute('aria-label', 'Notificaciones bloqueadas');
    } else {
      btn.classList.remove('is-on');
      btn.title = 'Activar notificaciones';
      btn.setAttribute('aria-label', 'Activar notificaciones');
    }
  }

  async function requestChatNotifications() {
    if (typeof Notification === 'undefined') {
      if (typeof showToast === 'function') showToast('Este navegador no soporta notificaciones', 'info');
      return;
    }
    unlockChatAudio();
    if (Notification.permission === 'granted') {
      setNotifPref(true);
      if (typeof showToast === 'function') showToast('Notificaciones de chat activadas', 'success');
      return;
    }
    if (Notification.permission === 'denied') {
      if (typeof showToast === 'function') showToast('Activa las notificaciones en la configuración del navegador', 'info');
      return;
    }
    try {
      const perm = await Notification.requestPermission();
      if (perm === 'granted') {
        setNotifPref(true);
        if (typeof showToast === 'function') showToast('Notificaciones de chat activadas', 'success');
      } else {
        setNotifPref(false);
        if (typeof showToast === 'function') showToast('No se activaron las notificaciones', 'info');
      }
    } catch (_) {
      setNotifPref(false);
    }
    syncNotifButton();
  }

  function notifyBrowser(peerName, body, peerId) {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission !== 'granted') return;
    if (!notifPrefEnabled()) return;
    const win = peerId != null ? state.windows.get(Number(peerId)) : null;
    const shouldOs = document.hidden || document.visibilityState !== 'visible' || !!(win && win.minimized);
    if (!shouldOs) return;
    try {
      const n = new Notification(peerName || 'Chat INNAR', {
        body: String(body || '').slice(0, 120),
        tag: `innar-chat-${peerId || 'x'}`,
        renotify: true
      });
      n.onclick = () => {
        try { window.focus(); } catch (_) { /* noop */ }
        if (peerId) {
          const c = state.contactos.find((x) => Number(x.id) === Number(peerId));
          if (c) void openChatWithPeer(c);
          else void openChatWithPeer({ id: peerId, nombre: peerName || 'Chat' });
        }
        n.close();
      };
    } catch (_) { /* noop */ }
  }

  function ventanaActivaParaLeer(win) {
    return !!(win && !win.minimized && document.visibilityState === 'visible' && !document.hidden);
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
            <div class="chat-msgr-dock-head-actions">
              <button type="button" class="chat-msgr-notif-btn" id="chatMsgrNotifBtn" title="Activar notificaciones" aria-label="Activar notificaciones">${ICON_BELL}</button>
              <button type="button" class="chat-msgr-dock-close" id="chatMsgrDockClose" aria-label="Cerrar">×</button>
            </div>
          </div>
          <input type="search" class="chat-msgr-search" id="chatMsgrSearch" placeholder="Buscar contacto…" autocomplete="off" />
          <div class="chat-msgr-list" id="chatMsgrList"></div>
        </div>
        <div class="chat-msgr-windows" id="chatMsgrWindows"></div>
      </div>`;
    document.body.appendChild(root);

    document.getElementById('chatMsgrToggle')?.addEventListener('click', () => {
      unlockChatAudio();
      state.dockOpen = !state.dockOpen;
      syncDockVisibility();
      if (state.dockOpen) void refreshContactos();
    });
    document.getElementById('chatMsgrDockClose')?.addEventListener('click', () => {
      state.dockOpen = false;
      syncDockVisibility();
    });
    document.getElementById('chatMsgrNotifBtn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      void requestChatNotifications();
    });
    document.getElementById('chatMsgrSearch')?.addEventListener('input', (e) => {
      state.search = String(e.target.value || '').trim().toLowerCase();
      renderContactList();
    });
    document.getElementById('chatMsgrWindows')?.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) {
        // Overlay móvil: cerrar ventana activa
        if (maxWindows() === 1 && state.windows.size) {
          const lastKey = [...state.windows.keys()].pop();
          closeWindow(lastKey);
        }
      }
    });

    syncNotifButton();
    bindVisualViewport();
    return root;
  }

  function bindVisualViewport() {
    if (state.viewportBound || !window.visualViewport) return;
    state.viewportBound = true;
    const apply = () => {
      const root = document.getElementById('chatMessengerRoot');
      if (!root) return;
      const vv = window.visualViewport;
      const keyboardPad = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      root.style.setProperty('--chat-vv-offset', `${Math.round(keyboardPad)}px`);
      root.style.setProperty('--chat-vv-height', `${Math.round(vv.height)}px`);
    };
    window.visualViewport.addEventListener('resize', apply);
    window.visualViewport.addEventListener('scroll', apply);
    apply();
  }

  function syncDockVisibility() {
    const dock = document.getElementById('chatMsgrDock');
    if (!dock) return;
    dock.classList.toggle('is-open', state.dockOpen);
  }

  function setBadge(n) {
    state.totalUnread = Math.max(0, n | 0);
    const badge = document.getElementById('chatMsgrBadge');
    if (badge) {
      if (state.totalUnread > 0) {
        badge.textContent = state.totalUnread > 99 ? '99+' : String(state.totalUnread);
        badge.classList.add('is-visible');
      } else {
        badge.classList.remove('is-visible');
      }
    }
    updateDocumentTitle(state.totalUnread);
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
        unlockChatAudio();
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
      if (ventanaActivaParaLeer(w)) void markRead(w);
      return;
    }
    while (state.windows.size >= maxWindows()) {
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
        <span class="chat-msgr-win-unread" hidden aria-label="Mensajes sin leer">0</span>
        <div class="chat-msgr-win-actions">
          <button type="button" data-act="min" title="Minimizar" aria-label="Minimizar">–</button>
          <button type="button" data-act="close" title="Cerrar" aria-label="Cerrar">×</button>
        </div>
      </div>
      <div class="chat-msgr-body"></div>
      <div class="chat-msgr-compose">
        <textarea rows="1" placeholder="Escribe un mensaje…" maxlength="2000" enterkeyhint="send"></textarea>
        <button type="button" class="chat-msgr-send" title="Enviar" aria-label="Enviar" disabled>${ICON_SEND}</button>
      </div>`;
    wrap.appendChild(el);

    const win = {
      peer,
      conversacionId,
      el,
      minimized: false,
      unreadWhileMin: 0,
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
      if (!win.minimized) {
        clearWindowUnread(win);
        if (ventanaActivaParaLeer(win)) void markRead(win);
      }
    });
    el.querySelector('.chat-msgr-win-head')?.addEventListener('click', (e) => {
      if (e.target.closest('[data-act]')) return;
      if (win.minimized) {
        win.minimized = false;
        el.classList.remove('is-minimized');
        clearWindowUnread(win);
        if (ventanaActivaParaLeer(win)) void markRead(win);
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
    ta.addEventListener('focus', () => bindVisualViewport());
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

  function closeAllWindows() {
    [...state.windows.keys()].forEach((id) => closeWindow(id));
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
      if (ventanaActivaParaLeer(win)) await markRead(win);
    } catch (_) { /* noop */ }
    finally {
      win.loading = false;
    }
  }

  function lastMineSeenStatus(messages, me) {
    if (me == null) return null;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (Number(messages[i].autor_id) === me) {
        return messages[i].leido_at ? 'seen' : 'sent';
      }
    }
    return null;
  }

  function renderMessages(win) {
    const body = win.el.querySelector('.chat-msgr-body');
    if (!body) return;
    const me = (typeof currentUser !== 'undefined' && currentUser?.id) ? Number(currentUser.id) : null;
    const lastStatus = lastMineSeenStatus(win.messages, me);
    let html = '';
    let lastDay = '';
    let lastMineId = null;
    if (me != null) {
      for (let i = win.messages.length - 1; i >= 0; i -= 1) {
        if (Number(win.messages[i].autor_id) === me) {
          lastMineId = Number(win.messages[i].id);
          break;
        }
      }
    }
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
      let status = '';
      if (mine && Number(m.id) === lastMineId) {
        if (lastStatus === 'seen' || m.leido_at) {
          status = '<span class="chat-msgr-read">Visto</span>';
        } else {
          status = '<span class="chat-msgr-read chat-msgr-read--sent">Enviado</span>';
        }
      }
      html += `<div class="chat-msgr-bubble ${mine ? 'mine' : 'theirs'}" data-msg-id="${m.id || ''}">
        ${chip}
        <div>${escapeHtml(m.cuerpo)}</div>
        <span class="chat-msgr-bubble-time">${escapeHtml(formatHora(m.creado_en))}${status}</span>
      </div>`;
    });
    body.innerHTML = html || '<div class="chat-msgr-empty" style="padding:16px">Sin mensajes aún. ¡Saluda!</div>';
    body.scrollTop = body.scrollHeight;
  }

  function handleLeido(payload) {
    if (!payload || !payload.conversacion_id) return;
    const convId = Number(payload.conversacion_id);
    for (const win of state.windows.values()) {
      if (Number(win.conversacionId) !== convId) continue;
      const me = (typeof currentUser !== 'undefined' && currentUser?.id) ? Number(currentUser.id) : null;
      let changed = false;
      win.messages.forEach((m) => {
        if (me != null && Number(m.autor_id) === me && !m.leido_at) {
          m.leido_at = new Date().toISOString();
          changed = true;
        }
      });
      if (changed) renderMessages(win);
    }
  }

  async function markRead(win) {
    if (!ventanaActivaParaLeer(win)) return;
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

  function syncWindowUnreadBadge(win) {
    if (!win?.el) return;
    const badge = win.el.querySelector('.chat-msgr-win-unread');
    if (!badge) return;
    const n = Math.max(0, win.unreadWhileMin | 0);
    if (n > 0 && win.minimized) {
      badge.hidden = false;
      badge.textContent = n > 99 ? '99+' : String(n);
      win.el.classList.add('has-unread');
    } else {
      badge.hidden = true;
      badge.textContent = '0';
      win.el.classList.remove('has-unread');
    }
  }

  function bumpWindowUnread(win) {
    if (!win) return;
    win.unreadWhileMin = (win.unreadWhileMin | 0) + 1;
    syncWindowUnreadBadge(win);
  }

  function clearWindowUnread(win) {
    if (!win) return;
    win.unreadWhileMin = 0;
    syncWindowUnreadBadge(win);
  }

  function alertIncoming(payload) {
    const name = payload.from?.nombre || 'Chat';
    const body = String(payload.mensaje?.cuerpo || '');
    if (typeof showToast === 'function') {
      showToast(`${name}: ${body.slice(0, 60)}`, 'info');
    }
    playChatSound();
    notifyBrowser(name, body, payload.from?.id);

    if (payload.from?.id != null) {
      const c = state.contactos.find((x) => Number(x.id) === Number(payload.from.id));
      if (c) {
        c.no_leidos = (parseInt(c.no_leidos, 10) || 0) + 1;
        c.preview = body;
        c.conversacion_id = payload.conversacion_id;
      }
    }
    if (state.dockOpen) {
      void refreshContactos();
    } else {
      void refreshUnread().then(() => {
        // si el GET falló, al menos reflejar +1 local
        if (state.totalUnread === 0 && payload.from?.id != null) {
          const c = state.contactos.find((x) => Number(x.id) === Number(payload.from.id));
          if (c) setBadge(parseInt(c.no_leidos, 10) || 1);
        }
      });
      renderContactList();
    }
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
      if (!isEcho) {
        if (ventanaActivaParaLeer(win)) {
          clearWindowUnread(win);
          void markRead(win);
        } else {
          if (win.minimized) bumpWindowUnread(win);
          alertIncoming(payload);
        }
      }
      return;
    }

    if (isEcho) return;
    alertIncoming(payload);
  }

  function bindRealtime() {
    const sock = window.socket;
    if (!sock || typeof sock.on !== 'function') return;
    if (window._chatMsgrRealtimeBound) return;
    window._chatMsgrRealtimeBound = true;
    sock.on('chat:mensaje', (data) => handleIncoming(data, false));
    sock.on('chat:mensaje_echo', (data) => handleIncoming(data, true));
    sock.on('chat:leido', (data) => handleLeido(data));
  }

  function resetChatMessenger() {
    window._chatMsgrRealtimeBound = false;
    closeAllWindows();
    state.contactos = [];
    state.dockOpen = false;
    state.totalUnread = 0;
    state.pendingPrefill = null;
    state.loaded = false;
    state.search = '';
    syncDockVisibility();
    setBadge(0);
    const search = document.getElementById('chatMsgrSearch');
    if (search) search.value = '';
    const list = document.getElementById('chatMsgrList');
    if (list) list.innerHTML = '';
    const root = document.getElementById('chatMessengerRoot');
    if (root) root.classList.add('chat-msgr-hidden');
    if (state.titleBase != null) {
      document.title = state.titleBase;
    }
  }

  function showUiIfAllowed() {
    const root = ensureRoot();
    if (!puedeUsarChat()) {
      root.classList.add('chat-msgr-hidden');
      return;
    }
    root.classList.remove('chat-msgr-hidden');
    bindRealtime();
    syncNotifButton();
    if (!state.loaded) {
      state.loaded = true;
      void refreshUnread();
    }
  }

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
    ensureTitleBase();
    showUiIfAllowed();
  }

  window.innarChatMessenger = {
    refresh: () => { showUiIfAllowed(); void refreshContactos(); void refreshUnread(); },
    refreshUnread: () => void refreshUnread(),
    reset: resetChatMessenger,
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
    window._chatMsgrRealtimeBound = false;
    bindRealtime();
    showUiIfAllowed();
  });

  window.addEventListener('socketClosed', () => {
    resetChatMessenger();
  });

  document.addEventListener('visibilitychange', () => {
    if (!puedeUsarChat()) return;
    if (document.visibilityState === 'visible') {
      void refreshUnread();
      for (const win of state.windows.values()) {
        if (ventanaActivaParaLeer(win)) void markRead(win);
      }
    }
  });

  let tries = 0;
  const bootTimer = setInterval(() => {
    tries += 1;
    showUiIfAllowed();
    if (puedeUsarChat() || tries > 40) clearInterval(bootTimer);
  }, 500);
})();
