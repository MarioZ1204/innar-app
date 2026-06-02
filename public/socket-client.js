/**
 * Tiempo real vía GET /api/eventos/poll (sin Socket.IO / sin WebSocket).
 * Expone window.socket compatible: .on(...), .emit(...) → POST /api/eventos/push
 */

let socket = null;
window.socketReady = false;
let updateCheckTimer = null;
let updateBannerShown = false;
const UPDATE_CHECK_INTERVAL_MS = 60000;

const POLL_MS = typeof window.INNAR_REALTIME_POLL_MS === 'number'
  ? window.INNAR_REALTIME_POLL_MS
  : 4000;

/** @type {ReturnType<typeof setInterval>|null} */
let socketPollTimer = null;
let pollInFlight = false;

/** @type {Record<string, ReturnType<typeof setTimeout>|null>} */
const _socketRefreshTimers = {};

function scheduleSocketRefresh(key, callback, delayMs = 120) {
  if (typeof callback !== 'function') return;
  if (_socketRefreshTimers[key]) clearTimeout(_socketRefreshTimers[key]);
  _socketRefreshTimers[key] = setTimeout(() => {
    _socketRefreshTimers[key] = null;
    try {
      callback();
    } catch (e) { /* noop */ }
  }, delayMs);
}

function refreshActiveModuleData() {
  const module = window.currentModule;
  if (module === 'recibos' && typeof cargarLista === 'function') {
    scheduleSocketRefresh('recibos:lista', () => cargarLista());
  }
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

async function checkServerVersion() {
  if (!window.APP_VERSION) return;
  try {
    const r = await fetch(`/api/version?t=${Date.now()}`, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store'
    });
    if (!r.ok) return;
    const body = await r.json();
    if (body?.version && body.version !== window.APP_VERSION) {
      showUpdateBanner(body.version);
    }
  } catch (e) { /* noop */ }
}

function startVersionWatcher() {
  if (updateCheckTimer) return;
  checkServerVersion();
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

function dispatchRealtime(event, payload) {
  const cbs = listeners.get(event);
  if (!cbs) return;
  for (let i = 0; i < cbs.length; i++) {
    try {
      cbs[i](payload);
    } catch (e) {
      console.error('[Realtime]', event, e);
    }
  }
}

function readCsrfToken() {
  const m = document.cookie.match(/(?:^|; )csrf_token=([^;]*)/);
  return m ? decodeURIComponent(m[1]) : null;
}

async function pushToServer(event, data) {
  const csrf = readCsrfToken();
  /** @type {Record<string,string>} */
  const headers = { 'Content-Type': 'application/json' };
  if (csrf) headers['x-csrf-token'] = csrf;
  try {
    await fetch('/api/eventos/push', {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      headers,
      body: JSON.stringify({ event, data })
    });
  } catch (e) { /* noop */ }
}

function registerDefaultRealtimeHandlers() {
  subscribe('recibo:actualizar-lista', () => {
    if (typeof cargarLista === 'function') {
      scheduleSocketRefresh('recibos:lista', () => {
        const q = typeof window._recibosLastParams === 'string' ? window._recibosLastParams : '';
        cargarLista(q);
      });
    }
    if (typeof updateSavedCount === 'function') updateSavedCount();
    if (typeof scheduleBuscarCitasAuditoria === 'function') {
      scheduleSocketRefresh('dashboard:citas', () => scheduleBuscarCitasAuditoria(120));
    }
  });
  subscribe('recibo:creado', () => {
    if (typeof cargarLista === 'function') {
      scheduleSocketRefresh('recibos:lista', () => {
        const q = typeof window._recibosLastParams === 'string' ? window._recibosLastParams : '';
        cargarLista(q);
      });
    }
    if (typeof updateSavedCount === 'function') updateSavedCount();
    if (typeof scheduleBuscarCitasAuditoria === 'function') {
      scheduleSocketRefresh('dashboard:citas', () => scheduleBuscarCitasAuditoria(120));
    }
  });
  subscribe('recibo:eliminado', () => {
    if (typeof cargarLista === 'function') {
      scheduleSocketRefresh('recibos:lista', () => {
        const q = typeof window._recibosLastParams === 'string' ? window._recibosLastParams : '';
        cargarLista(q);
      });
    }
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
    if (typeof buscarGestionDatos === 'function' && typeof _gestionTipoActual !== 'undefined' && _gestionTipoActual === 'tipos_consulta') {
      buscarGestionDatos();
    }
  });
  subscribe('estudio:creado', () => {
    if (typeof buscarGestionDatos === 'function' && typeof _gestionTipoActual !== 'undefined' && _gestionTipoActual === 'estudio_duraciones') {
      buscarGestionDatos();
    }
  });

  subscribe('sistema:version', (e) => {
    if (e?.version && window.APP_VERSION && e.version !== window.APP_VERSION) {
      showUpdateBanner(e.version);
    }
  });

  subscribe('agenda:turno-creado', () => refreshActiveModuleData());
  subscribe('agenda:turno-eliminado', () => refreshActiveModuleData());
  subscribe('agenda:turno-estado-cambio', (e) => {
    refreshActiveModuleData();
    if (e && e.estado === 'EN_SALA' && typeof currentUser !== 'undefined' && currentUser && currentUser.rol === 'doctor') {
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
  subscribe('agenda:anunciar-paciente', (e) => {
    if (typeof tienePermiso !== 'function' || !tienePermiso('agenda.cambiar_estado')) return;
    if (!('speechSynthesis' in window)) return;
    const text = `Paciente ${e.paciente_nombre || 'siguiente paciente'}, pasar al ${e.numero_consultorio ? `consultorio ${e.numero_consultorio}` : 'consultorio'}`;
    if (typeof showToast === 'function') showToast(text, 'info');
    if (typeof _speak === 'function') {
      _speak(text, 0.9);
    } else {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'es-CO';
      u.rate = 0.9;
      u.volume = 1;
      window.speechSynthesis.speak(u);
    }
  });
  subscribe('agenda:turno-llamar-siguiente', (e) => {
    refreshActiveModuleData();
    if (typeof tienePermiso !== 'function' || !tienePermiso('agenda.cambiar_estado')) return;
    if (!('speechSynthesis' in window)) return;
    const text = `Paciente ${e.paciente_nombre || 'siguiente paciente'}, pasar al ${e.numero_consultorio ? `consultorio ${e.numero_consultorio}` : 'consultorio'}`;
    if (typeof _speak === 'function') {
      _speak(text, 0.9);
    } else {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'es-CO';
      u.rate = 0.9;
      u.volume = 1;
      window.speechSynthesis.speak(u);
    }
  });
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

async function runPollIteration() {
  if (pollInFlight) return;
  pollInFlight = true;
  try {
    const r = await fetch('/api/eventos/poll', { credentials: 'include', cache: 'no-store' });
    if (r.status === 401) {
      document.dispatchEvent(new CustomEvent('app:no-autenticado'));
      closeSocket();
      return;
    }
    if (!r.ok) return;
    const body = await r.json();
    const events = Array.isArray(body.events) ? body.events : [];
    for (let i = 0; i < events.length; i++) {
      const row = events[i];
      if (row?.event) dispatchRealtime(row.event, row.data);
    }
  } catch (e) { /* noop */
  } finally {
    pollInFlight = false;
  }
}

function initSocket() {
  if (socketPollTimer !== null) return;

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

  socket.connected = true;
  console.info('Tiempo real: HTTP polling', { intervalMs: POLL_MS });

  socketPollTimer = setInterval(runPollIteration, POLL_MS);
  void runPollIteration();

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
        void runPollIteration();
      }
      const module = window.currentModule;
      if (module === 'recibos' && typeof cargarLista === 'function') cargarLista();
      if (module === 'agenda-medica' && typeof cargarTurnosMedica === 'function') cargarTurnosMedica();
      if (module === 'electro' && typeof cargarCitasElectro === 'function') cargarCitasElectro();
      if (module === 'usuarios' && typeof cargarUsuarios === 'function') cargarUsuarios();
      if (typeof updateStats === 'function') updateStats();
      checkServerVersion();
    });
  }
}

function closeSocket() {
  window.dispatchEvent(new CustomEvent('socketClosed'));

  if (socketPollTimer) {
    clearInterval(socketPollTimer);
    socketPollTimer = null;
  }
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
