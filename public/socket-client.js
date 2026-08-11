/**
 * Tiempo real vía GET /api/eventos/poll (sin Socket.IO / sin WebSocket).
 * Expone window.socket compatible: .on(...), .emit(...) → POST /api/eventos/push
 *
 * Optimización Hostinger:
 * - Sin long-poll (no retiene conexiones)
 * - Solo 1 pestaña por navegador hace poll (líder); el resto recibe por BroadcastChannel
 * - Pestaña oculta: casi no pollea
 * - /api/version va embebido en la respuesta del poll
 */

let socket = null;
window.socketReady = false;
let updateCheckTimer = null;
let updateBannerShown = false;
const UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000; // fallback raro si el poll no trae version

const POLL_MS = typeof window.INNAR_REALTIME_POLL_MS === 'number'
  ? window.INNAR_REALTIME_POLL_MS
  : 2800;

/**
 * Long-poll DESACTIVADO por defecto (0).
 * En Hostinger compartido, wait>0 mantiene 1 conexión abierta por pestaña.
 */
const LONG_POLL_WAIT_MS = typeof window.INNAR_REALTIME_LONG_POLL_MS === 'number'
  ? window.INNAR_REALTIME_LONG_POLL_MS
  : 0;

/** Pestaña oculta: casi sin tráfico (0 = pausa total hasta volver). */
const HIDDEN_POLL_MS = typeof window.INNAR_REALTIME_HIDDEN_POLL_MS === 'number'
  ? window.INNAR_REALTIME_HIDDEN_POLL_MS
  : 0;

/** Tras un evento, pollear más rápido un rato (sin long-poll). */
const POLL_FAST_MS = typeof window.INNAR_REALTIME_POLL_FAST_MS === 'number'
  ? window.INNAR_REALTIME_POLL_FAST_MS
  : 1200;
const POLL_BURST_MS = typeof window.INNAR_REALTIME_POLL_BURST_MS === 'number'
  ? window.INNAR_REALTIME_POLL_BURST_MS
  : 10000;

const TAB_ID = `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const LEADER_LS_KEY = 'innar_rt_leader_v1';
const LEADER_TTL_MS = 8000;
let isRealtimeLeader = true;
/** @type {number} */
let pollBurstUntil = 0;

function noteRealtimeActivity() {
  pollBurstUntil = Date.now() + POLL_BURST_MS;
}

function currentPollGapMs() {
  return Date.now() < pollBurstUntil ? POLL_FAST_MS : POLL_MS;
}

/** @type {ReturnType<typeof setTimeout>|null} */
let socketPollTimer = null;
let pollInFlight = false;
let pollLoopActive = false;
/** AbortController del long-poll en curso (para reabrir al volver a la pestaña). */
let pollAbort = null;

/** @type {Record<string, ReturnType<typeof setTimeout>|null>} */
const _socketRefreshTimers = {};

function scheduleSocketRefresh(key, callback, delayMs = 120) {
  if (typeof callback !== 'function') return;
  if (_socketRefreshTimers[key]) clearTimeout(_socketRefreshTimers[key]);
  _socketRefreshTimers[key] = setTimeout(() => {
    _socketRefreshTimers[key] = null;
    const run = () => {
      try {
        callback();
      } catch (e) { /* noop */ }
    };
    if (typeof window.innarPreserveModuleScroll === 'function' && window.currentModule) {
      void window.innarPreserveModuleScroll(window.currentModule, run);
    } else {
      run();
    }
  }, delayMs);
}

/** Recarga Ver Recibos manteniendo query de filtros (_recibosLastParams). */
function refreshRecibosListaPreservandoFiltros() {
  if (window.currentModule !== 'recibos') return;
  if (typeof cargarLista !== 'function') return;
  scheduleSocketRefresh('recibos:lista', () => {
    const q = typeof window._recibosLastParams === 'string' ? window._recibosLastParams : '';
    cargarLista(q);
  });
}

function refreshActiveModuleData() {
  const module = window.currentModule;
  // No recargar recibos aquí: eventos de agenda/electro no deben vaciar filtros del reporte.
  // Solo los eventos recibo:* llaman refreshRecibosListaPreservandoFiltros().
  if (module === 'agenda-medica') {
    if (typeof cargarTurnosMedica === 'function') {
      scheduleSocketRefresh('agenda:turnos', () => cargarTurnosMedica());
    }
    if (typeof loadCalendarData === 'function') {
      scheduleSocketRefresh('agenda:programar', () => loadCalendarData());
    }
    if (typeof cargarCitasCalendario === 'function') {
      scheduleSocketRefresh('agenda:citas', () => cargarCitasCalendario());
    }
    if (typeof actualizarHorasDisponibles === 'function') {
      scheduleSocketRefresh('agenda:horas', () => actualizarHorasDisponibles());
    }
  }
  if (module === 'electro') {
    if (typeof cargarCitasElectro === 'function') {
      scheduleSocketRefresh('electro:citas', () => cargarCitasElectro());
    }
    if (typeof cargarEsperaElectro === 'function') {
      scheduleSocketRefresh('electro:espera', () => cargarEsperaElectro());
    }
  }
  if (module === 'usuarios' && typeof cargarUsuarios === 'function') {
    scheduleSocketRefresh('usuarios:lista', () => cargarUsuarios());
  }
  if (module === 'dashboard-citas' && typeof scheduleBuscarCitasAuditoria === 'function') {
    scheduleSocketRefresh('dashboard:citas', () => scheduleBuscarCitasAuditoria(120));
  }
  if (module === 'anexo-fidu' && typeof window.refreshAnexoFidu === 'function') {
    scheduleSocketRefresh('anexo-fidu', () => window.refreshAnexoFidu());
  }
  if (module === 'backup' && typeof window.refreshBackupModule === 'function') {
    scheduleSocketRefresh('backup', () => window.refreshBackupModule());
  }
  if (module === 'reportes-pdx' && typeof window.refreshReportesPdx === 'function') {
    scheduleSocketRefresh('reportes-pdx', () => window.refreshReportesPdx());
  }
  if (module === 'reportes-historico' && typeof window.refreshReportesHistorico === 'function') {
    scheduleSocketRefresh('reportes-historico', () => window.refreshReportesHistorico());
  }
  if (module === 'armado-soportes' && typeof window.refreshArmadoSoportes === 'function') {
    scheduleSocketRefresh('armado-soportes', () => window.refreshArmadoSoportes());
  }
}

function showUpdateBanner(remoteVersion) {
  if (updateBannerShown) return;
  updateBannerShown = true;
  const banner = document.getElementById('updateBanner');
  if (banner) banner.style.display = 'block';
  const btn = document.getElementById('btnReloadUpdateBanner');
  if (btn && !btn.dataset.bound) {
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => window.location.reload());
  }
  if (remoteVersion && console.warn) {
    console.warn('Nueva version detectada:', remoteVersion, 'actual:', window.APP_VERSION);
  }
}

function applyRemoteVersion(remoteVersion) {
  if (!window.APP_VERSION || !remoteVersion) return;
  if (remoteVersion !== window.APP_VERSION) showUpdateBanner(remoteVersion);
}

async function checkServerVersion() {
  if (!window.APP_VERSION) return;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  try {
    const r = await fetch(`/api/version?t=${Date.now()}`, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store'
    });
    if (!r.ok) return;
    const body = await r.json();
    if (body?.version) applyRemoteVersion(body.version);
  } catch (e) { /* noop */ }
}

function startVersionWatcher() {
  if (updateCheckTimer) return;
  // No pegar /api/version al arrancar: el poll ya trae version.
  updateCheckTimer = setInterval(checkServerVersion, UPDATE_CHECK_INTERVAL_MS);
}

/** @type {Map<string, Function[]>} */
const listeners = new Map();

function subscribe(event, cb) {
  if (!listeners.has(event)) listeners.set(event, []);
  listeners.get(event).push(cb);
}

function unsubscribe(event, cb) {
  if (!listeners.has(event)) return;
  if (typeof cb !== 'function') {
    listeners.delete(event);
    return;
  }
  const next = listeners.get(event).filter((fn) => fn !== cb);
  if (next.length) listeners.set(event, next);
  else listeners.delete(event);
}

/** Evita procesar el mismo evento dos veces (poll + BroadcastChannel en la misma sesión). */
const recentDispatched = new Map();
const DISPATCH_DEDUPE_MS = 4000;

function stablePayloadKey(payload) {
  if (payload == null || typeof payload !== 'object') return JSON.stringify(payload);
  const keys = Object.keys(payload).sort();
  const normalized = {};
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    let v = payload[k];
    if (k === 'doctor_id' || k === 'turno_id' || k === 'numero_turno') {
      const n = parseInt(v, 10);
      if (Number.isFinite(n)) v = n;
    } else if (k === 'numero_consultorio' && v != null && v !== '') {
      v = String(v);
    }
    normalized[k] = v;
  }
  return JSON.stringify(normalized);
}

function dispatchRealtime(event, payload, opts = {}) {
  const dedupeKey = `${event}|${stablePayloadKey(payload)}`;
  const now = Date.now();
  const last = recentDispatched.get(dedupeKey);
  if (last != null && now - last < DISPATCH_DEDUPE_MS) return;
  recentDispatched.set(dedupeKey, now);
  if (recentDispatched.size > 200) {
    for (const [k, t] of recentDispatched) {
      if (now - t > DISPATCH_DEDUPE_MS) recentDispatched.delete(k);
    }
  }

  const cbs = listeners.get(event);
  if (cbs) {
    for (let i = 0; i < cbs.length; i++) {
      try {
        cbs[i](payload);
      } catch (e) {
        console.error('[Realtime]', event, e);
      }
    }
  }

  // Solo el origen (poll/push local) replica a otras pestañas.
  if (!opts.fromPeerTab) fanOutRealtimeToTabs(event, payload);
}

const REALTIME_TAB_CHANNEL = 'innar-realtime-tab';
/** @type {BroadcastChannel|null} */
let realtimeTabChannel = null;

function initRealtimeTabChannel() {
  if (realtimeTabChannel || typeof BroadcastChannel === 'undefined') return;
  realtimeTabChannel = new BroadcastChannel(REALTIME_TAB_CHANNEL);
  realtimeTabChannel.onmessage = (ev) => {
    const msg = ev.data;
    if (msg && typeof msg.event === 'string') {
      dispatchRealtime(msg.event, msg.data, { fromPeerTab: true });
    }
  };
}

function fanOutRealtimeToTabs(event, data) {
  initRealtimeTabChannel();
  try {
    realtimeTabChannel?.postMessage({ event, data, ts: Date.now(), from: TAB_ID });
  } catch (_) { /* noop */ }
}

/** Solo 1 pestaña del mismo navegador hace GET /eventos/poll. */
function refreshRealtimeLeadership() {
  const now = Date.now();
  try {
    const raw = localStorage.getItem(LEADER_LS_KEY);
    const cur = raw ? JSON.parse(raw) : null;
    const stale = !cur || !cur.id || !cur.at || (now - Number(cur.at) > LEADER_TTL_MS);
    if (stale || cur.id === TAB_ID) {
      localStorage.setItem(LEADER_LS_KEY, JSON.stringify({ id: TAB_ID, at: now }));
      isRealtimeLeader = true;
    } else {
      isRealtimeLeader = false;
    }
  } catch (_) {
    isRealtimeLeader = true;
  }
  return isRealtimeLeader;
}

function releaseRealtimeLeadership() {
  try {
    const raw = localStorage.getItem(LEADER_LS_KEY);
    const cur = raw ? JSON.parse(raw) : null;
    if (cur && cur.id === TAB_ID) localStorage.removeItem(LEADER_LS_KEY);
  } catch (_) { /* noop */ }
}

function readCsrfToken() {
  const m = document.cookie.match(/(?:^|; )csrf_token=([^;]*)/);
  return m ? decodeURIComponent(m[1]) : null;
}

/** Aviso de voz «paciente en sala»: solo el médico asignado al turno. */
function debeEscucharAvisoPacienteEnSala(e) {
  if (typeof currentUser === 'undefined' || !currentUser) return false;
  if (String(currentUser.rol || '').toLowerCase() !== 'doctor') return false;
  const doctorId = parseInt(e?.doctor_id, 10);
  const myId = parseInt(currentUser.id, 10);
  return Number.isFinite(doctorId) && Number.isFinite(myId) && doctorId === myId;
}

async function pushToServer(event, data) {
  const csrf = readCsrfToken();
  /** @type {Record<string,string>} */
  const headers = { 'Content-Type': 'application/json' };
  if (csrf) headers['x-csrf-token'] = csrf;
  try {
    const r = await fetch('/api/eventos/push', {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      headers,
      body: JSON.stringify({ event, data })
    });
    if (r.ok) {
      noteRealtimeActivity();
      fanOutRealtimeToTabs(event, data);
    }
  } catch (e) { /* noop */ }
}

function registerDefaultRealtimeHandlers() {
  subscribe('recibo:actualizar-lista', () => {
    refreshRecibosListaPreservandoFiltros();
    if (typeof updateSavedCount === 'function') updateSavedCount();
    if (typeof scheduleBuscarCitasAuditoria === 'function') {
      scheduleSocketRefresh('dashboard:citas', () => scheduleBuscarCitasAuditoria(120));
    }
  });
  subscribe('recibo:creado', () => {
    refreshRecibosListaPreservandoFiltros();
    if (typeof updateSavedCount === 'function') updateSavedCount();
    if (typeof scheduleBuscarCitasAuditoria === 'function') {
      scheduleSocketRefresh('dashboard:citas', () => scheduleBuscarCitasAuditoria(120));
    }
  });
  subscribe('recibo:eliminado', () => {
    refreshRecibosListaPreservandoFiltros();
    if (typeof updateSavedCount === 'function') updateSavedCount();
    if (typeof scheduleBuscarCitasAuditoria === 'function') {
      scheduleSocketRefresh('dashboard:citas', () => scheduleBuscarCitasAuditoria(120));
    }
  });

  subscribe('usuario:creado', () => {
    if (typeof cargarUsuarios === 'function') {
      scheduleSocketRefresh('usuarios:lista', () => cargarUsuarios());
    }
  });
  subscribe('usuario:actualizado', () => {
    if (typeof cargarUsuarios === 'function') {
      scheduleSocketRefresh('usuarios:lista', () => cargarUsuarios());
    }
  });
  subscribe('usuario:eliminado', () => {
    if (typeof cargarUsuarios === 'function') {
      scheduleSocketRefresh('usuarios:lista', () => cargarUsuarios());
    }
  });
  subscribe('usuario:permisos-cambiados', (e) => {
    if (
      e?.userId != null &&
      typeof window.currentUser !== 'undefined' &&
      window.currentUser?.id === e.userId &&
      typeof checkSession === 'function'
    ) {
      checkSession();
    }
  });
  subscribe('usuario:nombre-actualizado', () => {
    if (typeof checkSession === 'function') checkSession();
  });
  subscribe('tipos-consulta:actualizado', () => {
    if (typeof _tiposConsultaCache !== 'undefined') _tiposConsultaCache = {};
    if (typeof window._reciboCurrentTipos !== 'undefined') window._reciboCurrentTipos = [];
    const medicoId = document.getElementById('reciboMedico')?.value;
    if (medicoId && typeof cargarTiposConsultaEnRecibo === 'function') {
      cargarTiposConsultaEnRecibo(medicoId);
    }
    if (typeof scheduleBuscarGestionDatos === 'function' && typeof _gestionTipoActual !== 'undefined' && _gestionTipoActual === 'tipos_consulta') {
      scheduleBuscarGestionDatos(200);
    }
  });
  subscribe('estudio:creado', () => {
    if (typeof scheduleBuscarGestionDatos === 'function' && typeof _gestionTipoActual !== 'undefined' && _gestionTipoActual === 'estudio_duraciones') {
      scheduleBuscarGestionDatos(200);
    }
  });
  subscribe('anexo-fidu:servicios-actualizado', () => {
    if (typeof scheduleBuscarGestionDatos === 'function' && typeof _gestionTipoActual !== 'undefined' && _gestionTipoActual === 'anexo_fidu_servicios') {
      scheduleBuscarGestionDatos(200);
    }
  });

  subscribe('sistema:version', (e) => {
    if (e?.version && window.APP_VERSION && e.version !== window.APP_VERSION) {
      showUpdateBanner(e.version);
    }
  });

  subscribe('soportes:pdx-actualizado', () => {
    if (window.currentModule === 'reportes-pdx' && typeof window.refreshReportesPdx === 'function') {
      scheduleSocketRefresh('reportes-pdx', () => window.refreshReportesPdx());
    }
    if (window.currentModule === 'reportes-historico' && typeof window.refreshReportesHistorico === 'function') {
      scheduleSocketRefresh('reportes-historico', () => window.refreshReportesHistorico());
    }
  });
  subscribe('soportes:armado-actualizado', () => {
    if (window.currentModule === 'armado-soportes' && typeof window.refreshArmadoSoportes === 'function') {
      scheduleSocketRefresh('armado-soportes', () => window.refreshArmadoSoportes());
    }
  });

  subscribe('chat:mensaje', () => {
    // Respaldo de badge si chat-messenger aún no reenganchó listeners
    if (window.innarChatMessenger && typeof window.innarChatMessenger.refreshUnread === 'function') {
      window.innarChatMessenger.refreshUnread();
    } else if (window.innarChatMessenger && typeof window.innarChatMessenger.refresh === 'function') {
      window.innarChatMessenger.refresh();
    }
  });
  subscribe('chat:mensaje_echo', () => { /* chat-messenger.js */ });
  subscribe('chat:leido', () => { /* chat-messenger.js */ });

  subscribe('agenda:turno-creado', () => refreshActiveModuleData());
  subscribe('agenda:turno-eliminado', () => refreshActiveModuleData());
  subscribe('agenda:turno-estado-cambio', (e) => {
    refreshActiveModuleData();
    if (e && e.estado === 'EN_SALA' && debeEscucharAvisoPacienteEnSala(e)) {
      const suffix = e.paciente_nombre ? ` - ${e.paciente_nombre}` : '';
      if (typeof showToast === 'function') showToast(`Paciente en sala${suffix}`, 'info');
      if (typeof _speak === 'function') {
        _speak('Paciente en sala', 1.05);
      } else if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance('Paciente en sala');
        u.lang = 'es-CO';
        u.rate = 1.05;
        u.volume = 1;
        window.speechSynthesis.speak(u);
      }
    }
  });
  subscribe('agenda:turno-numero-cambio', () => refreshActiveModuleData());
  subscribe('agenda:disponibilidad-actualizada', (e) => {
    if (typeof actualizarDisponibilidad === 'function') {
      actualizarDisponibilidad(e.doctor_id);
    }
    if (window.currentModule === 'agenda-medica') {
      refreshActiveModuleData();
      const feAg = document.getElementById('agendaMedicaFecha');
      if (feAg?.value) feAg.dispatchEvent(new Event('change'));
      const feModal = document.getElementById('modalNuevaCitaFecha');
      if (feModal?.value) feModal.dispatchEvent(new Event('change'));
    }
  });
  subscribe('agenda:turno-llamar-siguiente', () => refreshActiveModuleData());
  subscribe('agenda:turno-marcar-atendido', () => refreshActiveModuleData());
  subscribe('agenda:turno-cambio-paciente', () => refreshActiveModuleData());
  subscribe('agenda:turno-doctor-cambio', () => refreshActiveModuleData());
  subscribe('agenda:actualizar-lista', () => refreshActiveModuleData());
  subscribe('agenda:actualizar-consultorio', () => refreshActiveModuleData());

  subscribe('turno-medico:estado-actualizado', () => refreshActiveModuleData());
  subscribe('turno-medico:reprogramado', () => refreshActiveModuleData());
  subscribe('turno-medico:creado', () => refreshActiveModuleData());

  subscribe('agenda:aviso-concluir-consulta', (e) => {
    if (!(typeof currentUser !== 'undefined' && currentUser && currentUser.rol === 'doctor')) return;
    if (e.doctor_id && e.doctor_id !== currentUser.id) return;
    if (typeof showToast === 'function') {
      showToast('⏰ Recepción solicita que concluya la consulta', 'warning');
    }
    if (typeof _speak === 'function') {
      _speak('Doctor, puede concluir su consulta', 0.9);
    } else if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance('Doctor, puede concluir su consulta');
      u.lang = 'es-CO';
      u.rate = 0.9;
      u.volume = 1;
      window.speechSynthesis.speak(u);
    }
  });

  subscribe('electro:cita-creada', (e) => {
    if (window.currentModule !== 'electro' || typeof window.aplicarCambioCitaElectroRealtime !== 'function') {
      refreshActiveModuleData();
    } else {
      window.aplicarCambioCitaElectroRealtime({ ...(e || {}), type: 'creada' });
    }
  });
  subscribe('electro:cita-eliminada', (e) => {
    if (window.currentModule !== 'electro' || typeof window.aplicarCambioCitaElectroRealtime !== 'function') {
      refreshActiveModuleData();
    } else {
      window.aplicarCambioCitaElectroRealtime({ ...(e || {}), type: 'eliminada' });
    }
  });
  subscribe('electro:cita-actualizada', (e) => {
    if (window.currentModule !== 'electro' || typeof window.aplicarCambioCitaElectroRealtime !== 'function') {
      refreshActiveModuleData();
    } else {
      window.aplicarCambioCitaElectroRealtime({ ...(e || {}), type: 'actualizada' });
    }
  });
  subscribe('electro:actualizar-lista', (e) => {
    if (window.currentModule === 'electro' && typeof window.aplicarCambioCitaElectroRealtime === 'function' && e?.id) {
      window.aplicarCambioCitaElectroRealtime(e);
    } else {
      refreshActiveModuleData();
    }
  });
  subscribe('electro:nueva-cita', () => refreshActiveModuleData());
  subscribe('electro:cita-cambio-estado', () => refreshActiveModuleData());
  subscribe('electro:cita-removida', () => refreshActiveModuleData());

  subscribe('stats:actualizar', () => {
    if (typeof updateSavedCount === 'function') updateSavedCount();
  });
}

async function runPollIteration(waitMs = 0) {
  if (pollInFlight) return 0;
  pollInFlight = true;
  if (pollAbort) {
    try { pollAbort.abort(); } catch (_) { /* noop */ }
  }
  pollAbort = typeof AbortController !== 'undefined' ? new AbortController() : null;
  try {
    const q = waitMs > 0 ? `?wait=${encodeURIComponent(String(waitMs))}` : '';
    const r = await fetch(`/api/eventos/poll${q}`, {
      credentials: 'include',
      cache: 'no-store',
      signal: pollAbort ? pollAbort.signal : undefined
    });
    if (r.status === 401) {
      document.dispatchEvent(new CustomEvent('app:no-autenticado'));
      closeSocket();
      return 0;
    }
    if (!r.ok) return 0;
    const body = await r.json();
    if (body?.version) applyRemoteVersion(body.version);
    const events = Array.isArray(body.events) ? body.events : [];
    if (events.length) noteRealtimeActivity();
    for (let i = 0; i < events.length; i++) {
      const row = events[i];
      if (row?.event) dispatchRealtime(row.event, row.data);
    }
    return events.length;
  } catch (e) {
    if (e && e.name === 'AbortError') return 0;
    return 0;
  } finally {
    pollInFlight = false;
  }
}

function scheduleNextPoll(delayMs) {
  if (!pollLoopActive) return;
  if (socketPollTimer) clearTimeout(socketPollTimer);
  socketPollTimer = setTimeout(() => {
    socketPollTimer = null;
    void pollLoopTick();
  }, Math.max(0, delayMs | 0));
}

async function pollLoopTick() {
  if (!pollLoopActive) return;
  const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';

  // Pestaña oculta: pausa total (ahorra Hostinger). Al volver, visibilitychange reactiva.
  if (hidden && HIDDEN_POLL_MS <= 0) {
    scheduleNextPoll(15000);
    return;
  }

  refreshRealtimeLeadership();
  if (!isRealtimeLeader) {
    // Seguidor: no llama al servidor; espera eventos de la pestaña líder.
    scheduleNextPoll(Math.max(1200, Math.min(currentPollGapMs(), 2500)));
    return;
  }

  const waitMs = hidden ? 0 : LONG_POLL_WAIT_MS;
  await runPollIteration(waitMs);
  if (!pollLoopActive) return;
  const gap = hidden
    ? Math.max(HIDDEN_POLL_MS, 15000)
    : (waitMs > 0 ? 120 : currentPollGapMs());
  scheduleNextPoll(gap);
}

function initSocket() {
  if (pollLoopActive) return;

  listeners.clear();

  socket = {
    id: 'http-poll',
    connected: false,
    on(ev, cb) {
      subscribe(ev, cb);
    },
    off(ev, cb) {
      unsubscribe(ev, cb);
    },
    emit(ev, data) {
      void pushToServer(ev, data);
    },
    disconnect() {
      this.connected = false;
    }
  };

  window.socket = socket;
  registerDefaultRealtimeHandlers();
  initRealtimeTabChannel();
  refreshRealtimeLeadership();

  socket.connected = true;
  pollLoopActive = true;
  console.info('Tiempo real: HTTP poll adaptativo', {
    intervalMs: POLL_MS,
    fastMs: POLL_FAST_MS,
    burstMs: POLL_BURST_MS,
    longPollWaitMs: LONG_POLL_WAIT_MS,
    hiddenIntervalMs: HIDDEN_POLL_MS,
    leader: isRealtimeLeader,
    tabId: TAB_ID
  });

  void pollLoopTick();

  window.socketReady = true;
  window.dispatchEvent(new CustomEvent('socketReady', { detail: socket }));
  startVersionWatcher();
  refreshActiveModuleData();

  if (!window._visibilityHandlerAdded) {
    window._visibilityHandlerAdded = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      if (socket) {
        socket.connected = true;
        if (pollAbort) {
          try { pollAbort.abort(); } catch (_) { /* noop */ }
        }
        if (socketPollTimer) {
          clearTimeout(socketPollTimer);
          socketPollTimer = null;
        }
        pollInFlight = false;
        refreshRealtimeLeadership();
        void pollLoopTick();
      }
      const module = window.currentModule;
      if (module === 'recibos') refreshRecibosListaPreservandoFiltros();
      if (module === 'agenda-medica' && typeof cargarTurnosMedica === 'function') cargarTurnosMedica();
      if (module === 'electro' && typeof cargarCitasElectro === 'function') cargarCitasElectro();
      if (module === 'usuarios' && typeof cargarUsuarios === 'function') cargarUsuarios();
      if (module === 'anexo-fidu' && typeof window.refreshAnexoFidu === 'function') window.refreshAnexoFidu();
      if (module === 'backup' && typeof window.refreshBackupModule === 'function') window.refreshBackupModule();
      if (module === 'reportes-pdx' && typeof window.refreshReportesPdx === 'function') window.refreshReportesPdx();
      if (module === 'reportes-historico' && typeof window.refreshReportesHistorico === 'function') window.refreshReportesHistorico();
      if (module === 'armado-soportes' && typeof window.refreshArmadoSoportes === 'function') window.refreshArmadoSoportes();
      if (typeof updateStats === 'function') updateStats();
      // version ya viene en el poll; no hace falta checkServerVersion aquí
    });
    window.addEventListener('beforeunload', releaseRealtimeLeadership);
    window.addEventListener('pagehide', releaseRealtimeLeadership);
  }
}

function closeSocket() {
  window.dispatchEvent(new CustomEvent('socketClosed'));

  pollLoopActive = false;
  releaseRealtimeLeadership();
  if (pollAbort) {
    try { pollAbort.abort(); } catch (_) { /* noop */ }
    pollAbort = null;
  }
  if (socketPollTimer) {
    clearTimeout(socketPollTimer);
    socketPollTimer = null;
  }
  pollInFlight = false;
  if (socket) {
    socket.disconnect();
  }
  socket = null;
  window.socket = null;
  window.socketReady = false;
  listeners.clear();

  if (updateCheckTimer) {
    clearInterval(updateCheckTimer);
    updateCheckTimer = null;
  }
  Object.keys(_socketRefreshTimers).forEach((k) => {
    if (_socketRefreshTimers[k]) clearTimeout(_socketRefreshTimers[k]);
    _socketRefreshTimers[k] = null;
  });
}

function emitSocket(eventName, data) {
  if (socket && socket.connected) socket.emit(eventName, data);
}

function onSocket(eventName, cb) {
  if (socket) socket.on(eventName, cb);
}
