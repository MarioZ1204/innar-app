// socket-client.js - Manejo de conexión WebSocket global con soporte para TODO

let socket = null;
window.socketReady = false;  // Flag para indicar cuando socket está listo
let updateCheckTimer = null;
let updateBannerShown = false;
const UPDATE_CHECK_INTERVAL_MS = 60000;
const _socketRefreshTimers = {};

function scheduleSocketRefresh(key, fn, delayMs = 120) {
  if (typeof fn !== 'function') return;
  if (_socketRefreshTimers[key]) clearTimeout(_socketRefreshTimers[key]);
  _socketRefreshTimers[key] = setTimeout(() => {
    _socketRefreshTimers[key] = null;
    try { fn(); } catch (_) {}
  }, delayMs);
}

function refreshActiveModuleData() {
  const mod = window.currentModule;
  if (mod === 'recibos' && typeof cargarLista === 'function') {
    scheduleSocketRefresh('recibos:lista', () => cargarLista());
  }
  if (mod === 'agenda-medica') {
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
  if (mod === 'electro') {
    if (typeof cargarCitasElectro === 'function') {
      scheduleSocketRefresh('electro:citas', () => cargarCitasElectro());
    }
    if (typeof cargarEsperaElectro === 'function') {
      scheduleSocketRefresh('electro:espera', () => cargarEsperaElectro());
    }
  }
  if (mod === 'usuarios' && typeof cargarUsuarios === 'function') {
    scheduleSocketRefresh('usuarios:lista', () => cargarUsuarios());
  }
  if (mod === 'dashboard-citas' && typeof scheduleBuscarCitasAuditoria === 'function') {
    scheduleSocketRefresh('dashboard:citas', () => scheduleBuscarCitasAuditoria(120));
  }
}

function showUpdateBanner(serverVersion) {
  if (updateBannerShown) return;
  updateBannerShown = true;
  const banner = document.getElementById('updateBanner');
  if (banner) banner.style.display = 'block';
  const btnReload = document.getElementById('btnReloadUpdateBanner');
  if (btnReload && !btnReload.dataset.bound) {
    btnReload.dataset.bound = '1';
    btnReload.addEventListener('click', () => window.location.reload());
  }
  if (serverVersion) {
    console.warn('Nueva version detectada:', serverVersion, 'actual:', window.APP_VERSION);
  }
}

async function checkServerVersion() {
  if (!window.APP_VERSION) return;
  try {
    const response = await fetch(`/api/version?t=${Date.now()}`, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store'
    });
    if (!response.ok) return;
    const data = await response.json();
    if (data?.version && data.version !== window.APP_VERSION) {
      showUpdateBanner(data.version);
    }
  } catch (_) {
    // Silenciar: si falla red temporalmente, se reintenta en el siguiente ciclo
  }
}

function startVersionWatcher() {
  if (updateCheckTimer) return;
  checkServerVersion();
  updateCheckTimer = setInterval(checkServerVersion, UPDATE_CHECK_INTERVAL_MS);
}

// Detectar si es dispositivo móvil
function isMobile() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

// Inicializar WebSocket después de login (con soporte mejorado para móviles)
function initSocket() {
  if (socket) return;
  
  const isMobileDevice = isMobile();
  
  socket = io({
    reconnection: true,
    reconnectionDelay: isMobileDevice ? 3000 : 1000,
    reconnectionDelayMax: isMobileDevice ? 20000 : 5000,
    reconnectionAttempts: isMobileDevice ? 10 : 5,
    timeout: isMobileDevice ? 30000 : 20000,
    transports: ['websocket', 'polling'],
    path: '/socket.io/',
    withCredentials: true,
    forceNew: false,
    autoConnect: true
  });

  // Eventos de conexión
  socket.on('connect', () => {
    console.log('✓ Conectado al servidor WebSocket', {
      mobile: isMobileDevice,
      transport: socket.io.engine.transport.name,
      socketId: socket.id
    });
    window.socket = socket;  // Exponer globalmente
    window.socketReady = true;  // Marcar como listo
    // Disparar evento para módulos que esperan
    window.dispatchEvent(new CustomEvent('socketReady', { detail: socket }));
    // Verificación extra por polling para detectar despliegues aunque no llegue evento socket.
    startVersionWatcher();
    // Al reconectar, sincronizar inmediatamente la vista activa sin recargar página.
    refreshActiveModuleData();
  });

  // Al volver de segundo plano, reconectar y refrescar datos del módulo activo
  if (!window._visibilityHandlerAdded) {
    window._visibilityHandlerAdded = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && socket) {
        if (!socket.connected) {
          socket.connect();
        }
        // Refrescar datos del módulo activo para recuperar lo perdido durante la suspensión
        const mod = window.currentModule;
        if (mod === 'recibos' && typeof cargarLista === 'function') cargarLista();
        if (mod === 'agenda-medica' && typeof cargarTurnosMedica === 'function') cargarTurnosMedica();
        if (mod === 'electro' && typeof cargarCitasElectro === 'function') cargarCitasElectro();
        if (mod === 'usuarios' && typeof cargarUsuarios === 'function') cargarUsuarios();
        if (typeof updateStats === 'function') updateStats();
        checkServerVersion();
      }
    });
  }

  socket.on('disconnect', (reason) => {
    console.log('✗ Desconectado del servidor', { reason, mobile: isMobileDevice });
    window.socketReady = false;
  });

  socket.on('connect_error', (error) => {
    console.error('Error en conexión WebSocket:', {
      error: error.message || error,
      mobile: isMobileDevice,
      transport: socket?.io?.engine?.transport?.name
    });
  });

  // Recibos
  socket.on('recibo:actualizar-lista', () => {
    if (typeof cargarLista === 'function') scheduleSocketRefresh('recibos:lista', () => cargarLista());
    if (typeof scheduleBuscarCitasAuditoria === 'function') scheduleSocketRefresh('dashboard:citas', () => scheduleBuscarCitasAuditoria(120));
  });

  socket.on('recibo:creado', (data) => {
    if (typeof cargarLista === 'function') scheduleSocketRefresh('recibos:lista', () => cargarLista());
    if (typeof scheduleBuscarCitasAuditoria === 'function') scheduleSocketRefresh('dashboard:citas', () => scheduleBuscarCitasAuditoria(120));
  });

  socket.on('recibo:eliminado', (data) => {
    if (typeof cargarLista === 'function') scheduleSocketRefresh('recibos:lista', () => cargarLista());
    if (typeof scheduleBuscarCitasAuditoria === 'function') scheduleSocketRefresh('dashboard:citas', () => scheduleBuscarCitasAuditoria(120));
  });

  // Usuarios
  socket.on('usuario:creado', (data) => {
    if (typeof cargarUsuarios === 'function') scheduleSocketRefresh('usuarios:lista', () => cargarUsuarios());
  });

  socket.on('usuario:actualizado', (data) => {
    if (typeof cargarUsuarios === 'function') scheduleSocketRefresh('usuarios:lista', () => cargarUsuarios());
  });

  socket.on('usuario:eliminado', (data) => {
    if (typeof cargarUsuarios === 'function') scheduleSocketRefresh('usuarios:lista', () => cargarUsuarios());
  });

  // Permisos cambiados: refrescar sesión del usuario afectado
  socket.on('usuario:permisos-cambiados', (data) => {
    if (data?.userId && typeof window.currentUser !== 'undefined' && window.currentUser?.id === data.userId) {
      if (typeof checkSession === 'function') checkSession();
    }
  });

  // Detectar nueva versión del servidor (cache busting)
  socket.on('sistema:version', (data) => {
    if (data?.version && window.APP_VERSION && data.version !== window.APP_VERSION) {
      showUpdateBanner(data.version);
    }
  });

  // Agenda médica
  socket.on('agenda:turno-creado', (data) => {
    refreshActiveModuleData();
  });

  socket.on('agenda:turno-eliminado', (data) => {
    refreshActiveModuleData();
  });

  socket.on('agenda:turno-estado-cambio', (data) => {
    refreshActiveModuleData();
    // Alerta sonora al doctor cuando un paciente entra en sala
    if (data.estado === 'EN_SALA' && typeof currentUser !== 'undefined' && currentUser && currentUser.rol === 'doctor') {
      const nombre = data.paciente_nombre ? ` - ${data.paciente_nombre}` : '';
      if (typeof showToast === 'function') showToast(`Paciente en sala${nombre}`, 'info');
      if (typeof _speak === 'function') _speak('Paciente en sala', 1.05);
      else if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance('Paciente en sala');
        utter.lang = 'es-CO'; utter.rate = 1.05; utter.volume = 1;
        window.speechSynthesis.speak(utter);
      }
    }
    // EN_ATENCION: ya NO se reproduce voz aquí (se maneja vía agenda:anunciar-paciente y agenda:turno-llamar-siguiente)
  });

  socket.on('agenda:turno-numero-cambio', (data) => {
    refreshActiveModuleData();
  });

  socket.on('agenda:disponibilidad-actualizada', (data) => {
    if (typeof actualizarDisponibilidad === 'function') {
      actualizarDisponibilidad(data.doctor_id);
    }
    // Refresco en caliente del módulo Agenda Médica para evitar recargar página.
    if (window.currentModule === 'agenda-medica') {
      refreshActiveModuleData();
      // Re-disparar cambios de fecha para que validadores de disponibilidad
      // actualicen estilos/estados de inputs sin intervención manual.
      const agendaFecha = document.getElementById('agendaMedicaFecha');
      if (agendaFecha?.value) {
        agendaFecha.dispatchEvent(new Event('change'));
      }
      const modalFecha = document.getElementById('modalNuevaCitaFecha');
      if (modalFecha?.value) {
        modalFecha.dispatchEvent(new Event('change'));
      }
    }
  });

  // Anuncio de voz directo: doctor presiona "Llamar al paciente"
  socket.on('agenda:anunciar-paciente', (data) => {
    const esRecep = typeof tienePermiso === 'function' && tienePermiso('agenda.cambiar_estado');
    if (esRecep && 'speechSynthesis' in window) {
      const nombre = data.paciente_nombre || 'siguiente paciente';
      const consultorio = data.numero_consultorio ? `consultorio ${data.numero_consultorio}` : 'consultorio';
      const texto = `Paciente ${nombre}, pasar al ${consultorio}`;
      if (typeof showToast === 'function') showToast(texto, 'info');
      if (typeof _speak === 'function') _speak(texto, 0.9);
      else {
        window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(texto);
        utter.lang = 'es-CO'; utter.rate = 0.9; utter.volume = 1;
        window.speechSynthesis.speak(utter);
      }
    }
  });

  socket.on('agenda:turno-llamar-siguiente', (data) => {
    refreshActiveModuleData();
    // Anuncio de voz para recepción y electrodiagnóstico
    const esRecep = typeof tienePermiso === 'function' && tienePermiso('agenda.cambiar_estado');
    if (esRecep && 'speechSynthesis' in window) {
      const nombre = data.paciente_nombre || 'siguiente paciente';
      const consultorio = data.numero_consultorio ? `consultorio ${data.numero_consultorio}` : 'consultorio';
      const texto = `Paciente ${nombre}, pasar al ${consultorio}`;
      if (typeof _speak === 'function') _speak(texto, 0.9);
      else {
        window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(texto);
        utter.lang = 'es-CO'; utter.rate = 0.9; utter.volume = 1;
        window.speechSynthesis.speak(utter);
      }
    }
  });

  socket.on('agenda:turno-marcar-atendido', (data) => {
    refreshActiveModuleData();
  });

  socket.on('agenda:turno-cambio-paciente', (data) => {
    refreshActiveModuleData();
  });

  // Compatibilidad con eventos relay usados en app.js/socket server.
  socket.on('agenda:actualizar-lista', () => {
    refreshActiveModuleData();
  });

  socket.on('agenda:actualizar-consultorio', () => {
    refreshActiveModuleData();
  });

  socket.on('turno-medico:estado-actualizado', () => {
    refreshActiveModuleData();
  });

  socket.on('turno-medico:reprogramado', () => {
    refreshActiveModuleData();
  });

  socket.on('turno-medico:creado', () => {
    refreshActiveModuleData();
  });

  // Aviso al doctor para concluir consulta
  socket.on('agenda:aviso-concluir-consulta', (data) => {
    // Este aviso es para el doctor — solo actuar si es doctor y el aviso es para este doctor
    if (typeof currentUser !== 'undefined' && currentUser && currentUser.rol === 'doctor') {
      if (!data.doctor_id || data.doctor_id === currentUser.id) {
        if (typeof showToast === 'function') showToast('⏰ Recepción solicita que concluya la consulta', 'warning');
        if (typeof _speak === 'function') _speak('Doctor, puede concluir su consulta', 0.9);
        else if ('speechSynthesis' in window) {
          window.speechSynthesis.cancel();
          const utter = new SpeechSynthesisUtterance('Doctor, puede concluir su consulta');
          utter.lang = 'es-CO'; utter.rate = 0.9; utter.volume = 1;
          window.speechSynthesis.speak(utter);
        }
      }
    }
  });

  // ===== EVENTOS DE ELECTRODIAGNÓSTICO =====
  // Guard de módulo activo para evitar doble llamada con socket-electro.js
  socket.on('electro:cita-creada', (data) => {
    refreshActiveModuleData();
  });

  socket.on('electro:cita-eliminada', (data) => {
    refreshActiveModuleData();
  });

  // electro:cita-actualizada es el evento correcto (el servidor emite este, no electro:cita-estado-cambio)
  socket.on('electro:cita-actualizada', (data) => {
    refreshActiveModuleData();
  });

  socket.on('electro:actualizar-lista', (data) => {
    refreshActiveModuleData();
  });

  socket.on('electro:nueva-cita', () => {
    refreshActiveModuleData();
  });

  socket.on('electro:cita-cambio-estado', () => {
    refreshActiveModuleData();
  });

  socket.on('electro:cita-removida', () => {
    refreshActiveModuleData();
  });

  // Dashboard
  socket.on('stats:actualizar', () => {
    if (typeof updateStats === 'function') updateStats();
  });

  return socket;
}

// Cerrar conexión al logout
function closeSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
    window.socket = null;
    window.socketReady = false;
  }
  if (updateCheckTimer) {
    clearInterval(updateCheckTimer);
    updateCheckTimer = null;
  }
  Object.keys(_socketRefreshTimers).forEach((k) => {
    if (_socketRefreshTimers[k]) clearTimeout(_socketRefreshTimers[k]);
    _socketRefreshTimers[k] = null;
  });
}

// Función para emitir eventos
function emitSocket(event, data) {
  if (socket && socket.connected) {
    socket.emit(event, data);
  }
}

// Función para escuchar eventos custom
function onSocket(event, callback) {
  if (socket) {
    socket.on(event, callback);
  }
}
