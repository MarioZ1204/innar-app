/**
 * Tiempo real: canal SSE (GET /api/eventos/stream) con poll HTTP de respaldo.
 * Expone window.socket compatible: .on(...), .emit(...) → POST /api/eventos/push
 *
 * Long-poll (~6.5 s): el servidor responde apenas hay un evento (En atención, En sala…).
 * Solo 1 pestaña por navegador hace poll (líder); el resto recibe por BroadcastChannel.
 * Pestaña oculta: pausa. /api/version va embebido en la respuesta del poll.
 */

let socket = null;
window.socketReady = false;
let updateCheckTimer = null;
let updateBannerShown = false;
const UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000; // fallback raro si el poll no trae version

const POLL_MS = typeof window.INNAR_REALTIME_POLL_MS === 'number'
  ? window.INNAR_REALTIME_POLL_MS
  : 1500;

/**
 * Long-poll: el servidor responde en cuanto hay un evento (En atención, En sala, etc.).
 * Solo 1 pestaña por navegador mantiene la conexión (líder). El servidor limita wait a 8s.
 */
const LONG_POLL_WAIT_MS = typeof window.INNAR_REALTIME_LONG_POLL_MS === 'number'
  ? window.INNAR_REALTIME_LONG_POLL_MS
  : 6500;

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
/** Cursor de eventos persistidos (MySQL) para no perder avisos entre workers. */
let pollSinceId = 0;
let sseSource = null;
let sseHelloTimer = null;
let sseFailed = false;
/** AbortController del long-poll en curso (para reabrir al volver a la pestaña). */
let pollAbort = null;

/** @type {Record<string, ReturnType<typeof setTimeout>|null>} */
const _socketRefreshTimers = {};
const _moduleDirty = Object.create(null);

function markModuleDirty(moduleId) {
  if (moduleId) _moduleDirty[moduleId] = 1;
}

function consumeModuleDirty(moduleId) {
  if (!_moduleDirty[moduleId]) return false;
  delete _moduleDirty[moduleId];
  return true;
}

window.innarMarkModuleDirty = markModuleDirty;
window.innarConsumeModuleDirty = consumeModuleDirty;

function refreshModuleIfActive(moduleId, fn) {
  markModuleDirty(moduleId);
  if (window.currentModule === moduleId && typeof fn === 'function') {
    scheduleSocketRefresh(moduleId, fn);
  }
}

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

function invalidarCachesEstudiosCliente() {
  if (typeof invalidarCacheEstudios === 'function') invalidarCacheEstudios();
  if (typeof invalidarCacheServicios === 'function') invalidarCacheServicios();
  if (window.innarSoportesCatalogo?.invalidarEstudios) window.innarSoportesCatalogo.invalidarEstudios();
  if (window.innarComprobantePdx?.invalidarEstudios) window.innarComprobantePdx.invalidarEstudios();
  if (typeof scheduleBuscarGestionDatos === 'function' && typeof _gestionTipoActual !== 'undefined' && _gestionTipoActual === 'estudio_duraciones') {
    scheduleBuscarGestionDatos(200);
  }
}

/** Marca el módulo dueño del evento para no refrescar pantallas ajenas. */
function withEventModulo(payload, modulo) {
  const base = payload && typeof payload === 'object' ? payload : {};
  return Object.assign({}, base, { modulo });
}

function refreshActiveModuleData(payload) {
  const module = window.currentModule;
  // Si el evento declara módulo, solo refresca ese ámbito (p. ej. agenda no toca Anexo FIDU).
  if (payload && payload.modulo != null && String(payload.modulo) !== '') {
    if (!mutationTouchesCurrentModule(payload.modulo)) return;
  }
  // No recargar recibos aquí: eventos de agenda/electro no deben vaciar filtros del reporte.
  // Solo los eventos recibo:* llaman refreshRecibosListaPreservandoFiltros().
  if (module === 'agenda-medica') {
    if (
      payload
      && typeof window.innarAgendaMedicaAceptaEvento === 'function'
      && !window.innarAgendaMedicaAceptaEvento(payload)
    ) {
      /* Evento de otro médico: esta agenda no cambia. */
    } else {
      if (typeof window.innarAplicarCambioTurnoMedicaRealtime === 'function') {
        window.innarAplicarCambioTurnoMedicaRealtime(payload);
      }
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
    const archivoFromPath = String(payload?.path || '').match(/\/anexo-fidu\/archivos\/(\d+)/i);
    const carpetaFromPath = String(payload?.path || '').match(/\/anexo-fidu\/carpetas\/(\d+)/i);
    const archivoId = parseInt(payload?.archivoId || payload?.archivo_id || (archivoFromPath && archivoFromPath[1]), 10);
    const carpetaId = parseInt(payload?.carpetaId || payload?.carpeta_id || (carpetaFromPath && carpetaFromPath[1]), 10);
    scheduleSocketRefresh('anexo-fidu', () => window.refreshAnexoFidu({
      soft: true,
      archivoId: Number.isFinite(archivoId) && archivoId > 0 ? archivoId : null,
      carpetaId: Number.isFinite(carpetaId) && carpetaId > 0 ? carpetaId : null,
      path: payload?.path || null,
      accion: payload?.accion || null
    }), 180);
  }
  if (module === 'backup' && typeof window.refreshBackupModule === 'function') {
    scheduleSocketRefresh('backup', () => window.refreshBackupModule());
  }
  if (module === 'reportes-pdx' && typeof window.refreshReportesPdx === 'function') {
    const carpetaFromPath = String(payload?.path || '').match(/\/soportes\/pdx\/carpetas\/(\d+)/i);
    const carpetaId = parseInt(payload?.carpetaId || payload?.carpeta_id || (carpetaFromPath && carpetaFromPath[1]), 10);
    scheduleSocketRefresh('reportes-pdx', () => window.refreshReportesPdx({
      soft: true,
      carpetaId: Number.isFinite(carpetaId) && carpetaId > 0 ? carpetaId : null,
      carpetaIds: Array.isArray(payload?.carpetaIds) ? payload.carpetaIds : null,
      path: payload?.path || null,
      accion: payload?.accion || null
    }), 500);
  }
  if (module === 'reportes-historico' && typeof window.refreshReportesHistorico === 'function') {
    const carpetaFromPath = String(payload?.path || '').match(/\/soportes\/pdx\/carpetas\/(\d+)/i);
    const carpetaId = parseInt(payload?.carpetaId || payload?.carpeta_id || (carpetaFromPath && carpetaFromPath[1]), 10);
    scheduleSocketRefresh('reportes-historico', () => window.refreshReportesHistorico({
      soft: true,
      carpetaId: Number.isFinite(carpetaId) && carpetaId > 0 ? carpetaId : null,
      carpetaIds: Array.isArray(payload?.carpetaIds) ? payload.carpetaIds : null,
      accion: payload?.accion || null
    }), 500);
  }
  if (module === 'armado-soportes' && typeof window.refreshArmadoSoportes === 'function') {
    const expFromPath = String(payload?.path || '').match(/\/soportes\/armado\/expedientes\/(\d+)/i);
    const expedienteId = parseInt(payload?.expedienteId || payload?.expediente_id || (expFromPath && expFromPath[1]), 10);
    scheduleSocketRefresh('armado-soportes', () => window.refreshArmadoSoportes({
      soft: true,
      expedienteId: Number.isFinite(expedienteId) && expedienteId > 0 ? expedienteId : null,
      periodoIds: Array.isArray(payload?.periodoIds) ? payload.periodoIds : null,
      path: payload?.path || null,
      accion: payload?.accion || null
    }), 500);
  }
  if (module === 'recibos') {
    refreshRecibosListaPreservandoFiltros();
    if (typeof updateSavedCount === 'function') updateSavedCount();
  }
  if (module === 'gestion-datos' && typeof scheduleBuscarGestionDatos === 'function') {
    scheduleSocketRefresh('gestion:datos', () => scheduleBuscarGestionDatos(120));
  }
  if (module === 'diagnosticos' && typeof cargarListaDiagnosticos === 'function') {
    scheduleSocketRefresh('diagnosticos', () => cargarListaDiagnosticos());
  }
  if (module === 'monitor-equipos' && typeof cargarMonitorEquipos === 'function') {
    scheduleSocketRefresh('monitor-equipos', () => cargarMonitorEquipos());
  }
  if (module === 'papelera-pdx' && typeof window.refreshPapeleraPdx === 'function') {
    scheduleSocketRefresh('papelera-pdx', () => window.refreshPapeleraPdx());
  }
  if (module === 'documentos-cita' && typeof window.refreshDocumentosCita === 'function') {
    scheduleSocketRefresh('documentos-cita', () => window.refreshDocumentosCita());
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

function mutationTouchesCurrentModule(modulo) {
  const cur = window.currentModule;
  if (!cur) return false;
  if (modulo === 'chat') return false;
  // Mutaciones genéricas / desconocidas: no refrescar nada (evita saltos entre módulos).
  if (!modulo || modulo === 'app') return false;
  if (modulo === cur) return true;
  // Solo espejos clínicos explícitos (tablero / llamado). Soportes y Anexo no se cruzan.
  const relatedExtra = {
    'agenda-medica': ['dashboard-citas', 'llamado-pacientes', 'documentos-cita'],
    'electro': ['dashboard-citas', 'monitor-equipos', 'documentos-cita'],
    'recibos': ['dashboard-citas'],
    'reportes-pdx': ['reportes-historico', 'papelera-pdx'],
    'papelera-pdx': ['reportes-pdx']
  };
  const extra = relatedExtra[modulo];
  return Array.isArray(extra) && extra.includes(cur);
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
    if (typeof invalidarCacheMedicosAgenda === 'function') invalidarCacheMedicosAgenda();
    if (typeof cargarUsuarios === 'function') {
      scheduleSocketRefresh('usuarios:lista', () => cargarUsuarios());
    }
  });
  subscribe('usuario:actualizado', () => {
    if (typeof invalidarCacheMedicosAgenda === 'function') invalidarCacheMedicosAgenda();
    if (typeof cargarUsuarios === 'function') {
      scheduleSocketRefresh('usuarios:lista', () => cargarUsuarios());
    }
  });
  subscribe('usuario:eliminado', () => {
    if (typeof invalidarCacheMedicosAgenda === 'function') invalidarCacheMedicosAgenda();
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
    if (typeof invalidarCacheEspecialidades === 'function') invalidarCacheEspecialidades();
    else if (typeof _tiposConsultaCache !== 'undefined') _tiposConsultaCache = {};
    if (typeof window._reciboCurrentTipos !== 'undefined') window._reciboCurrentTipos = [];
    if (window.innarServicioCombo?.invalidarCache) window.innarServicioCombo.invalidarCache();
    if (window.innarSoportesCatalogo?.invalidarTipos) window.innarSoportesCatalogo.invalidarTipos();
    if (window.innarComprobantePdx?.invalidarTipos) window.innarComprobantePdx.invalidarTipos();
    const medicoId = document.getElementById('reciboMedico')?.value;
    if (medicoId && typeof cargarTiposConsultaEnRecibo === 'function') {
      cargarTiposConsultaEnRecibo(medicoId);
    }
    if (typeof scheduleBuscarGestionDatos === 'function' && typeof _gestionTipoActual !== 'undefined' && _gestionTipoActual === 'tipos_consulta') {
      scheduleBuscarGestionDatos(200);
    }
  });
  subscribe('especialidades:actualizado', () => {
    if (typeof invalidarCacheEspecialidades === 'function') invalidarCacheEspecialidades();
    if (window.innarSoportesCatalogo?.invalidarEspecialidades) window.innarSoportesCatalogo.invalidarEspecialidades();
    if (window.innarComprobantePdx?.invalidarEspecialidades) window.innarComprobantePdx.invalidarEspecialidades();
    if (typeof cargarEspecialidadesFiltro === 'function') {
      scheduleSocketRefresh('dashboard:especialidades', () => cargarEspecialidadesFiltro());
    }
    if (typeof scheduleBuscarGestionDatos === 'function' && typeof _gestionTipoActual !== 'undefined' && _gestionTipoActual === 'especialidades') {
      scheduleBuscarGestionDatos(200);
    }
  });
  subscribe('entidades:actualizado', () => {
    if (typeof invalidarCacheEntidades === 'function') invalidarCacheEntidades();
    if (typeof scheduleBuscarGestionDatos === 'function' && typeof _gestionTipoActual !== 'undefined' && _gestionTipoActual === 'entidades') {
      scheduleBuscarGestionDatos(200);
    }
  });
  subscribe('estudio:creado', () => invalidarCachesEstudiosCliente());
  subscribe('estudio:actualizado', () => invalidarCachesEstudiosCliente());
  subscribe('diagnosticos:actualizado', () => {
    if (typeof scheduleBuscarGestionDatos === 'function' && typeof _gestionTipoActual !== 'undefined' && _gestionTipoActual === 'diagnosticos') {
      scheduleBuscarGestionDatos(200);
    }
  });
  subscribe('anexo-fidu:servicios-actualizado', () => {
    if (typeof window._invalidarServiciosAnexoFidu === 'function') window._invalidarServiciosAnexoFidu();
    if (typeof scheduleBuscarGestionDatos === 'function' && typeof _gestionTipoActual !== 'undefined' && _gestionTipoActual === 'anexo_fidu_servicios') {
      scheduleBuscarGestionDatos(200);
    }
  });

  subscribe('sistema:version', (e) => {
    if (e?.version && window.APP_VERSION && e.version !== window.APP_VERSION) {
      showUpdateBanner(e.version);
    }
  });

  subscribe('soportes:pdx-actualizado', (e) => {
    const softOpts = {
      soft: true,
      carpetaId: e?.carpetaId || e?.carpeta_id || null,
      carpetaIds: Array.isArray(e?.carpetaIds) ? e.carpetaIds : null,
      accion: e?.accion || null
    };
    if (window.currentModule === 'reportes-pdx' && typeof window.refreshReportesPdx === 'function') {
      scheduleSocketRefresh('reportes-pdx', () => window.refreshReportesPdx(softOpts), 500);
    } else {
      markModuleDirty('reportes-pdx');
    }
    if (window.currentModule === 'reportes-historico' && typeof window.refreshReportesHistorico === 'function') {
      scheduleSocketRefresh('reportes-historico', () => window.refreshReportesHistorico(softOpts), 500);
    } else {
      markModuleDirty('reportes-historico');
    }
  });
  subscribe('soportes:armado-actualizado', (e) => {
    if (window.currentModule === 'armado-soportes' && typeof window.refreshArmadoSoportes === 'function') {
      scheduleSocketRefresh('armado-soportes', () => window.refreshArmadoSoportes({
        soft: true,
        expedienteId: e?.expedienteId || e?.expediente_id || null,
        periodoIds: Array.isArray(e?.periodoIds) ? e.periodoIds : null,
        accion: e?.accion || null
      }), 500);
    } else {
      markModuleDirty('armado-soportes');
    }
  });
  subscribe('anexo-fidu:actualizado', (e) => {
    if (window.currentModule === 'anexo-fidu' && typeof window.refreshAnexoFidu === 'function') {
      scheduleSocketRefresh('anexo-fidu', () => window.refreshAnexoFidu({
        soft: true,
        archivoId: e?.archivoId || e?.archivo_id || null,
        carpetaId: e?.carpetaId || e?.carpeta_id || null,
        path: e?.path || null,
        accion: e?.accion || null
      }), 180);
    } else {
      markModuleDirty('anexo-fidu');
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

  subscribe('agenda:turno-creado', (e) => refreshActiveModuleData(withEventModulo(e, 'agenda-medica')));
  subscribe('agenda:turno-eliminado', (e) => refreshActiveModuleData(withEventModulo(e, 'agenda-medica')));
  subscribe('agenda:turno-estado-cambio', (e) => {
    refreshActiveModuleData(withEventModulo(e, 'agenda-medica'));
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
  subscribe('agenda:turno-numero-cambio', (e) => refreshActiveModuleData(withEventModulo(e, 'agenda-medica')));
  subscribe('agenda:disponibilidad-actualizada', (e) => {
    if (typeof actualizarDisponibilidad === 'function') {
      actualizarDisponibilidad(e.doctor_id);
    }
    if (window.currentModule === 'agenda-medica') {
      refreshActiveModuleData(withEventModulo(e, 'agenda-medica'));
      const feAg = document.getElementById('agendaMedicaFecha');
      if (feAg?.value) feAg.dispatchEvent(new Event('change'));
      const feModal = document.getElementById('modalNuevaCitaFecha');
      if (feModal?.value) feModal.dispatchEvent(new Event('change'));
    }
  });
  subscribe('agenda:turno-llamar-siguiente', (e) => refreshActiveModuleData(withEventModulo(e, 'agenda-medica')));
  subscribe('agenda:turno-marcar-atendido', (e) => refreshActiveModuleData(withEventModulo(e, 'agenda-medica')));
  subscribe('agenda:turno-cambio-paciente', (e) => refreshActiveModuleData(withEventModulo(e, 'agenda-medica')));
  subscribe('agenda:turno-doctor-cambio', (e) => refreshActiveModuleData(withEventModulo(e, 'agenda-medica')));
  subscribe('agenda:actualizar-lista', (e) => refreshActiveModuleData(withEventModulo(e, 'agenda-medica')));
  subscribe('agenda:actualizar-consultorio', (e) => refreshActiveModuleData(withEventModulo(e, 'agenda-medica')));

  subscribe('turno-medico:estado-actualizado', (e) => refreshActiveModuleData(withEventModulo(e, 'agenda-medica')));
  subscribe('turno-medico:reprogramado', (e) => refreshActiveModuleData(withEventModulo(e, 'agenda-medica')));
  subscribe('turno-medico:creado', (e) => refreshActiveModuleData(withEventModulo(e, 'agenda-medica')));

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
      refreshActiveModuleData(withEventModulo(e, 'electro'));
    } else {
      window.aplicarCambioCitaElectroRealtime({ ...(e || {}), type: 'creada' });
    }
  });
  subscribe('electro:cita-eliminada', (e) => {
    if (window.currentModule !== 'electro' || typeof window.aplicarCambioCitaElectroRealtime !== 'function') {
      refreshActiveModuleData(withEventModulo(e, 'electro'));
    } else {
      window.aplicarCambioCitaElectroRealtime({ ...(e || {}), type: 'eliminada' });
    }
  });
  subscribe('electro:cita-actualizada', (e) => {
    if (window.currentModule !== 'electro' || typeof window.aplicarCambioCitaElectroRealtime !== 'function') {
      refreshActiveModuleData(withEventModulo(e, 'electro'));
    } else {
      window.aplicarCambioCitaElectroRealtime({ ...(e || {}), type: 'actualizada' });
    }
  });
  subscribe('electro:actualizar-lista', (e) => {
    if (window.currentModule === 'electro' && typeof window.aplicarCambioCitaElectroRealtime === 'function' && e?.id) {
      window.aplicarCambioCitaElectroRealtime(e);
    } else {
      refreshActiveModuleData(withEventModulo(e, 'electro'));
    }
  });
  subscribe('electro:nueva-cita', (e) => refreshActiveModuleData(withEventModulo(e, 'electro')));
  subscribe('electro:cita-cambio-estado', (e) => refreshActiveModuleData(withEventModulo(e, 'electro')));
  subscribe('electro:cita-removida', (e) => refreshActiveModuleData(withEventModulo(e, 'electro')));

  subscribe('stats:actualizar', () => {
    if (typeof updateSavedCount === 'function') updateSavedCount();
  });

  subscribe('app:datos-actualizados', (e) => {
    if (!mutationTouchesCurrentModule(e?.modulo)) return;
    refreshActiveModuleData(e);
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
    const params = new URLSearchParams();
    if (waitMs > 0) params.set('wait', String(waitMs));
    if (pollSinceId > 0) params.set('since', String(pollSinceId));
    const q = params.toString() ? `?${params.toString()}` : '';
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
    ingestRealtimePayload(body);
    return Array.isArray(body.events) ? body.events.length : 0;
  } catch (e) {
    if (e && e.name === 'AbortError') return 0;
    return 0;
  } finally {
    pollInFlight = false;
  }
}

function ingestRealtimePayload(body) {
  if (!body || typeof body !== 'object') return;
  if (body.version) applyRemoteVersion(body.version);
  const nextId = Number(body.lastId);
  if (Number.isFinite(nextId) && nextId > pollSinceId) pollSinceId = nextId;
  const events = Array.isArray(body.events) ? body.events : [];
  if (events.length) noteRealtimeActivity();
  for (let i = 0; i < events.length; i++) {
    const row = events[i];
    if (row?.event) dispatchRealtime(row.event, row.data);
  }
}

function stopSse() {
  if (sseHelloTimer) {
    clearTimeout(sseHelloTimer);
    sseHelloTimer = null;
  }
  if (sseSource) {
    try { sseSource.close(); } catch (_) { /* noop */ }
    sseSource = null;
  }
}

function startSseStream() {
  if (!pollLoopActive || sseFailed || typeof EventSource === 'undefined') return false;
  if (sseSource && sseSource.readyState !== EventSource.CLOSED) return true;
  stopSse();
  const params = new URLSearchParams();
  if (pollSinceId > 0) params.set('since', String(pollSinceId));
  const url = '/api/eventos/stream' + (params.toString() ? `?${params.toString()}` : '');
  let gotHello = false;
  const es = new EventSource(url, { withCredentials: true });
  sseSource = es;
  sseHelloTimer = setTimeout(() => {
    if (gotHello) return;
    sseFailed = true;
    stopSse();
    console.info('Tiempo real: SSE no disponible, usando poll HTTP');
    void pollLoopTick();
  }, 5000);
  es.onmessage = (ev) => {
    try {
      const body = JSON.parse(ev.data);
      gotHello = true;
      if (sseHelloTimer) {
        clearTimeout(sseHelloTimer);
        sseHelloTimer = null;
      }
      if (socket) {
        socket.connected = true;
        socket.id = 'sse';
      }
      ingestRealtimePayload(body);
    } catch (_) { /* ignore */ }
  };
  es.onerror = () => {
    if (!gotHello) return;
    if (es.readyState === EventSource.CLOSED && pollLoopActive && !sseFailed) {
      stopSse();
      scheduleNextPoll(600);
    }
  };
  return true;
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

  if (hidden && HIDDEN_POLL_MS <= 0) {
    stopSse();
    scheduleNextPoll(15000);
    return;
  }

  refreshRealtimeLeadership();
  if (!isRealtimeLeader) {
    stopSse();
    scheduleNextPoll(Math.max(1200, Math.min(currentPollGapMs(), 2500)));
    return;
  }

  if (!sseFailed && typeof EventSource !== 'undefined') {
    startSseStream();
    scheduleNextPoll(4000);
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
    id: 'sse',
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
  console.info('Tiempo real: SSE (canal persistente); poll HTTP como respaldo', {
    sse: typeof EventSource !== 'undefined',
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
        stopSse();
        sseFailed = false;
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
      if (module === 'anexo-fidu' && typeof window.refreshAnexoFidu === 'function') {
        window.refreshAnexoFidu({ soft: true, reason: 'visibility' });
      }
      if (module === 'backup' && typeof window.refreshBackupModule === 'function') window.refreshBackupModule();
      if (module === 'reportes-pdx' && typeof window.refreshReportesPdx === 'function') {
        window.refreshReportesPdx({ soft: true, reason: 'visibility' });
      }
      if (module === 'reportes-historico' && typeof window.refreshReportesHistorico === 'function') {
        window.refreshReportesHistorico({ soft: true, reason: 'visibility' });
      }
      if (module === 'armado-soportes' && typeof window.refreshArmadoSoportes === 'function') {
        window.refreshArmadoSoportes({ soft: true, reason: 'visibility' });
      }
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
  pollSinceId = 0;
  sseFailed = false;
  stopSse();
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
