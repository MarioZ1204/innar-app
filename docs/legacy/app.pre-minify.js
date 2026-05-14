// public/app.js
const $ = id => document.getElementById(id);
const lsKey = 'recibos_sencillo_v1';
const lsKeyServicios = 'servicios_list_v1';
const lsKeyCurrentModule = 'current_module_v1';

// ========== GLOBAL ERROR HANDLER ==========
window.addEventListener('unhandledrejection', (e) => {
  console.error('[Unhandled Promise]', e.reason);
});
window.onerror = function(msg, src, line, col, err) {
  console.error('[Global Error]', msg, src + ':' + line + ':' + col, err);
};

// ========== ESCAPE KEY: CERRAR MODAL VISIBLE ==========
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const modals = document.querySelectorAll('.modal-overlay:not(.hidden), .modal:not(.hidden)');
  if (modals.length === 0) return;
  // Cerrar el de mayor z-index (├║ltimo abierto)
  let top = null, maxZ = -1;
  modals.forEach(m => {
    const z = parseInt(getComputedStyle(m).zIndex) || 0;
    if (z >= maxZ) { maxZ = z; top = m; }
  });
  if (top) top.classList.add('hidden');
});

// ========== FUNCI├ôN DE HASHING SHA512 ==========
function hashPassword(password) {
  if (!password) return '';
  return CryptoJS.SHA512(password).toString();
}

// ========== FUNCI├ôN AUXILIAR PARA ACTUALIZAR REQUISITOS ==========
function updateRequirementItem(elementId, isMet, text) {
  const element = $(elementId);
  if (element) {
    element.textContent = (isMet ? '[Ô£ô]' : '[Ô£ù]') + ' ' + text;
    element.style.color = isMet ? '#059669' : '#dc2626';
  }
}

const lsKeySelectedDoctor = 'selected_doctor_v1';
let lastReciboId = null;

// Usuario actual (rol: admin, recepcion, electro, doctor)
let currentUser = null;
let currentModule = null;
let selectedDoctorId = null;
/** Token CSRF (tambi├®n viene en JSON de /api/sesion y login; la cookie puede no leerse en document.cookie) */
let innarCsrfToken = '';
let citaElectroSeleccionada = null;
let isInitializingElectroModal = false; // Flag para evitar cambios autom├íticos al cargar modal
let citaReprogramarAdelantarActual = null; // Almacena la cita cuando se abre modal de reprogramaci├│n/adelanto
let selectedDoctorEspecialidad = null;
let selectedDiagnosticoElectroId = null;
let selectedEquipoElectroId = null;
let selectedEstudioDuracion = null; // Duraci├│n en minutos del estudio seleccionado
let filtroEstudioElectro = 'todas'; // Filtro de estudio en tabla de citas
let filtroEquipoSeleccionado = null; // Filtro de equipo en tabla de citas
let intervaloProgreso = null; // Intervalo para actualizar barra de progreso del estudio
let intervaloProgresoPanel = null; // Intervalo para mini-barras en panel de equipos
let intervaloAutoSyncElectro = null; // Intervalo para refresco/sincronizaci├│n autom├ítica

// Mapeo de especialidades a tipos de consulta
const ESPECIALIDAD_TIPOS_CONSULTA = {
  'Neurolog├¡a': [
    'Consulta de Primera Vez por Neurolog├¡a',
    'Consulta de Control por Neurolog├¡a',
    'Consulta Virtual de Primera Vez por Neurolog├¡a',
    'Consulta Virtual de Control por Neurolog├¡a',
    'Aplicaci├│n de Toxina Botul├¡nica (Botox)',
    'Control de Toxina Botul├¡nica (Botox)',
    'Actigraf├¡a',
    'Rev. Neuroestimulador',
    'Agente Anest├®sico',
    'Particular',
    'Otra'
  ],
  'Epileptolog├¡a': [
    'Consulta de Primera Vez por Epileptolog├¡a',
    'Consulta de Control por Epileptolog├¡a',
    'Consulta Virtual de Primera Vez por Epileptolog├¡a',
    'Consulta Virtual de Control por Epileptolog├¡a',
    'Consulta de Primera Vez por Neurolog├¡a',
    'Consulta de Control por Neurolog├¡a',
    'Consulta Virtual de Primera Vez por Neurolog├¡a',
    'Consulta Virtual de Control por Neurolog├¡a',
    'Aplicaci├│n de Toxina Botul├¡nica (Botox)',
    'Control de Toxina Botul├¡nica (Botox)',
    'Actigraf├¡a',
    'Rev. Neuroestimulador',
    'Bloqueo Mioneural',
    'Particular',
    'Otra'
  ],
  'Psicolog├¡a': [
    'Consulta de Primera Vez por Psicolog├¡a',
    'Consulta de Control por Psicolog├¡a',
    'Otra'
  ],
  'Neuropsicolog├¡a': [
    'Consulta de Primera Vez por Neuropsicolog├¡a',
    'Consulta de Control por Neuropsicolog├¡a',
    'Otra'
  ],
  'Psiquiatr├¡a': [
    'Consulta de Primera Vez por Psiquiatr├¡a',
    'Consulta de Control por Psiquiatr├¡a',
    'Otra'
  ]
};

// Intervalo de auto-refresh para Agenda M├®dica
let agendaMedicaInterval = null;
let originalHoraTHHtml = null;
let originalAccionesTHHtml = null;
let lastAnimatedTurnoId = null;
let lastAnimatedAt = 0;
let lastTurnoNumber1Id = null;
let globalHayEnAtencion = false;
let _cargandoTurnosMedica = false;
let _pendienteTurnosMedica = false;
let _cargandoCitasElectro = false;
let _pendienteCitasElectro = false;
let _citasElectroReqId = 0;

function normalizarTextoBase(str) {
  return (str || '')
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function esMonitorizacionVideoRadio(estudioNombre) {
  const s = normalizarTextoBase(estudioNombre);
  return s.includes('monitorizacion') && s.includes('video') && s.includes('radio');
}

// ========= POL├ìTICA CENTRAL: AGENDA M├ëDICA =========
// Objetivo: evitar reglas duplicadas entre tabla / panel / modal.
function agendaMedicaEsEstadoFinal(estado) {
  return ['ATENDIDO', 'NO_ASISTIO', 'CANCELADO', 'REPROGRAMADO'].includes(estado);
}

function agendaMedicaPolicy(turno, opts = {}) {
  const estado = turno?.estado || 'EN_ESPERA';
  const hayEnAtencion = Boolean(opts.hayEnAtencion ?? globalHayEnAtencion);

  const rol = currentUser?.rol || '';
  const esDoctorRol = rol === 'doctor';
  const esAdminRol = rol === 'admin' || rol === 'superadmin';

  const perms = {
    ver: tienePermiso('agenda.ver') || tienePermiso('agenda.editar') || tienePermiso('agenda.cambiar_estado'),
    editar: tienePermiso('agenda.editar'),
    eliminar: tienePermiso('agenda.eliminar'),
    cambiarEstado: tienePermiso('agenda.cambiar_estado'),
    llamarSiguiente: tienePermiso('agenda.llamar_siguiente') || tienePermiso('agenda.cambiar_estado'),
    marcarAtendido: tienePermiso('agenda.marcar_atendido') || tienePermiso('agenda.cambiar_estado'),
  };

  const esFinal = agendaMedicaEsEstadoFinal(estado);
  const esEnAtencion = estado === 'EN_ATENCION';
  const esEnSala = estado === 'EN_SALA';
  const esPendiente = estado === 'PENDIENTE' || estado === 'EN_ESPERA';

  // Regla de negocio/UI: la existencia de un turno EN_ATENCION s├│lo ÔÇ£bloqueaÔÇØ otras filas para el doctor.
  const bloqueadoPorAtencionGlobal = esDoctorRol && hayEnAtencion && !esEnAtencion;

  // Tabla: acciones por fila (editar/eliminar/prioridad)
  // - Admin no se bloquea por EN_ATENCION global
  // - Cualquiera se bloquea si est├í FINAL
  const rowBloqueada = esFinal || (!esAdminRol && bloqueadoPorAtencionGlobal);
  const row = {
    puedeVerDetalle: perms.ver,
    puedeEditar: perms.editar && !rowBloqueada,
    puedeEliminar: perms.eliminar && !rowBloqueada,
    puedePrioridad: perms.cambiarEstado && !rowBloqueada, // la prioridad se maneja como ÔÇ£cambiar estadoÔÇØ hoy
    deshabilitarBotones: !(perms.editar || perms.cambiarEstado) || rowBloqueada,
  };

  // Panel de edici├│n lateral (guardar nombre)
  // Mantener simple y coherente: se puede editar si tiene permiso y el turno NO est├í FINAL.
  const panel = {
    puedeEditarNombre: perms.editar && !esFinal,
  };

  // Modal: matriz expl├¡cita de visibilidad por estado/rol para evitar inconsistencias.
  const puedeGestionarComoRecepcion = !esDoctorRol && perms.cambiarEstado;
  const puedeGestionarComoDoctor = esDoctorRol && (perms.llamarSiguiente || perms.marcarAtendido || perms.cambiarEstado);

  const modal = {
    // Edici├│n de datos dentro del modal
    bloquearEdicion: esDoctorRol && esEnAtencion,

    // Footer
    // RECEPCI├ôN/ADMIN:
    // - PENDIENTE -> EN SALA, NO ASISTIO
    // - EN_SALA   -> LLAMAR, EN_ATENCION, ATENDIDO
    // - EN_ATENCION -> ATENDIDO
    showEnSala: puedeGestionarComoRecepcion && esPendiente,
    showReprogramarNoAsistio: puedeGestionarComoRecepcion && estado === 'NO_ASISTIO',

    // LLAMAR solo cuando est├í EN_SALA (doctor o recepci├│n con permisos)
    showLlamar: !esFinal && esEnSala && (
      (esDoctorRol && perms.llamarSiguiente) ||
      puedeGestionarComoRecepcion
    ),
    llamarDisabled: esFinal,

    // EN_ATENCION:
    // - Doctor: solo cuando est├í EN_SALA
    // - Recepci├│n/Admin: solo cuando est├í EN_SALA
    showEnAtencion: !esFinal && esEnSala && (
      (esDoctorRol && perms.marcarAtendido) ||
      puedeGestionarComoRecepcion
    ),
    enAtencionDisabled: esFinal || esEnAtencion,

    // ATENDIDO:
    // - Doctor: solo cuando est├í EN_ATENCION
    // - Recepci├│n/Admin: cuando est├í EN_SALA o EN_ATENCION
    showAtendido: !esFinal && (
      (esDoctorRol && perms.marcarAtendido && esEnAtencion) ||
      (puedeGestionarComoRecepcion && (esEnSala || esEnAtencion))
    ),
    atendidoDisabled: esFinal || (!esEnAtencion && !puedeGestionarComoRecepcion),

    // NO_ASISTIO:
    // - Doctor: solo en PENDIENTE
    // - Recepci├│n/Admin: solo en PENDIENTE
    showNoAsistio: !esFinal && esPendiente && (
      puedeGestionarComoDoctor || puedeGestionarComoRecepcion
    ),
    noAsistioDisabled: esFinal,

    // Men├║ 3 puntos (recepci├│n/admin)
    showMenu3Puntos: (perms.cambiarEstado || perms.llamarSiguiente || perms.marcarAtendido) && !esDoctorRol && !esFinal,
  };

  return { perms, row, panel, modal, meta: { rol, esFinal, esEnAtencion, esEnSala, hayEnAtencion } };
}

function getCookie(name) {
  const parts = (`; ${document.cookie}`).split(`; ${name}=`);
  if (parts.length === 2) return parts.pop().split(';').shift() || '';
  return '';
}

function getCsrfForRequest() {
  return getCookie('csrf_token') || innarCsrfToken || '';
}

function normalizeFetchHeaders(input) {
  if (input === undefined || input === null) return new Headers();
  if (input instanceof Headers) return new Headers(input);
  if (Array.isArray(input)) return new Headers(input);
  if (typeof input === 'object') {
    const h = new Headers();
    for (const [k, v] of Object.entries(input)) {
      if (v === undefined || v === null) continue;
      h.set(k, String(v));
    }
    return h;
  }
  return new Headers();
}

// Fetch con credenciales para sesi├│n
function apiFetch(url, opts = {}) {
  return (async () => {
    const method = ((opts.method || 'GET') + '').toUpperCase();
    const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

    async function parseJsonSafe(res) {
      try { return await res.clone().json(); } catch (_) { return null; }
    }

    async function oneFetch() {
      const headers = normalizeFetchHeaders(opts.headers);
      if (mutating && typeof url === 'string' && url.startsWith('/api/')) {
        const csrf = getCsrfForRequest();
        if (csrf) headers.set('x-csrf-token', csrf);
      }
      return fetch(url, { ...opts, headers, credentials: 'include' });
    }

    try {
      let res = await oneFetch();
      let didCsrfRefresh = false;

      // Reintento: cookie CSRF ausente o sesi├│n previa al despliegue ÔåÆ GET /api/sesion emite token
      if (res.status === 403 && mutating && typeof url === 'string' && url.startsWith('/api/')) {
        const data403 = await parseJsonSafe(res);
        if (data403 && data403.code === 'CSRF_INVALID') {
          const rs = await fetch('/api/sesion', { credentials: 'include' });
          try {
            const sd = await rs.json();
            if (sd && sd.csrfToken) innarCsrfToken = sd.csrfToken;
          } catch (_) { /* ignore */ }
          didCsrfRefresh = true;
          res = await oneFetch();
        }
      }

      if (res.status === 401 && typeof url === 'string' && !url.includes('/api/login')) {
        showSessionExpiredBanner();
      }
      if (res.status === 403) {
        const data = await parseJsonSafe(res);
        if (data && data.code === 'CSRF_INVALID' && !didCsrfRefresh) {
          showToast('Sesi├│n de seguridad desactualizada. Intenta de nuevo.', 'warning');
        } else if (data && data.code === 'CSRF_INVALID' && didCsrfRefresh) {
          showToast('No se pudo validar la solicitud (CSRF). Recarga la p├ígina.', 'error');
        } else {
          showToast('Acceso denegado o bloqueado por seguridad del servidor.', 'error');
        }
      }
      if (res.status === 429) {
        showToast('Demasiadas solicitudes. Espera un momento.', 'warning');
      }
      return res;
    } catch (err) {
      if (!navigator.onLine) {
        showToast('Sin conexi├│n a internet.', 'error');
      } else {
        showToast('Error de red. Intenta nuevamente.', 'error');
      }
      throw err;
    }
  })();
}

function isAdmin() { return currentUser && (currentUser.rol === 'admin' || currentUser.rol === 'superadmin'); }
function isRecepcion() { return currentUser && (currentUser.rol === 'recepcion' || currentUser.rol === 'auxiliar_recepcion' || currentUser.rol === 'admin_recepcion'); }
function isElectro() { return currentUser && (currentUser.rol === 'electro' || currentUser.rol === 'admin_electro' || currentUser.rol === 'tecnico_electro'); }
function isDoctor() { return currentUser && currentUser.rol === 'doctor'; }
function isContabilidad() { return currentUser && currentUser.rol === 'contabilidad'; }
function canDeleteRecibos() { return tienePermiso('recibos.eliminar'); }

// Mostrar saludo para doctores
function mostrarSaludoDoctor() {
  const greeting = $('doctorGreeting');
  if (!greeting) return;
  
  if (currentUser?.rol === 'doctor') {
    const nombre = currentUser?.nombre || currentUser?.usuario || 'Doctor';
    greeting.textContent = `┬íHola Dr. ${nombre}!`;
    greeting.classList.remove('hidden');
  } else {
    greeting.classList.add('hidden');
  }
}

// ========== LOGIN Y NAVEGACI├ôN ==========
function showView(id) {
  document.querySelectorAll('[id^="view-"]').forEach(v => v.classList.add('hidden'));
  const el = document.getElementById(id);
  if (el) el.classList.remove('hidden');
}

function updateSidebarUser(user) {
  if (!user) return;
  const name = user.nombre || user.usuario || '';
  const words = name.trim().split(/\s+/);
  const initials = (words.length >= 2
    ? words[0][0] + words[words.length - 1][0]
    : name.substring(0, 2)).toUpperCase();
  const roleMap = { superadmin: 'Super Admin', admin: 'Administrador', admin_recepcion: 'Admin Recepci├│n', recepcion: 'Recepci├│n', admin_electro: 'Admin Electro', electro: 'Electrodiagn├│stico', tecnico_electro: 'T├®cnico Electro', auxiliar_recepcion: 'Auxiliar Recepci├│n', doctor: 'Doctor', contabilidad: 'Contabilidad' };
  const roleLabel = roleMap[user.rol] || user.rol || '-';
  document.querySelectorAll('.sidebar-user-avatar').forEach(el => el.textContent = initials);
  document.querySelectorAll('.sidebar-user-name').forEach(el => el.textContent = name);
  document.querySelectorAll('.sidebar-user-role').forEach(el => el.textContent = roleLabel);
}

function updateMenuByRole() {
  const rol = currentUser?.rol || '';
  // Resolve custom permisos (may come as JSON string from mysql2)
  let perms = currentUser?.permisos ?? null;
  if (typeof perms === 'string') { try { perms = JSON.parse(perms); } catch(_) { perms = null; } }
  if (!Array.isArray(perms)) perms = null;

  // Helper global: verifica si el usuario tiene un permiso granular
  window.tienePermiso = function(permKey) {
    const r = currentUser?.rol || '';
    if (r === 'superadmin' || r === 'admin') return true;
    const p = perms;
    if (Array.isArray(p)) return p.includes(permKey);
    // Sin permisos personalizados ÔåÆ verificar defaults del rol
    const defaults = typeof PERMISOS_ROL_DEFAULTS !== 'undefined' ? PERMISOS_ROL_DEFAULTS[r] : null;
    if (defaults === null || defaults === undefined) return true; // rol sin restricciones
    return Array.isArray(defaults) && defaults.includes(permKey);
  };

  // Maps data-module HTML attribute ÔåÆ modulo.* permission key
  const MODULE_PERM_MAP = {
    'recibos':        'modulo.recibos',
    'agenda-medica':  'modulo.agenda_medica',
    'electro':        'modulo.electrodiag',
    'ucqn':           'modulo.ucqn',
    'usuarios':       'modulo.usuarios',
    'diagnosticos':   'modulo.diagnosticos',
    'dashboard-citas':'modulo.dashboard',
    'gestion-datos':  'modulo.gestion_datos',
    'monitor-equipos':'modulo.monitor_equipos',
  };

  document.querySelectorAll('.menu-card').forEach(card => {
    const moduleKey = card.dataset.module || '';
    const permKey = MODULE_PERM_MAP[moduleKey];
    let allowed = permKey ? tienePermiso(permKey) : (card.dataset.rol || '').split(' ').includes(rol);
    card.style.display = allowed ? '' : 'none';
  });
  // Sidebar recibos: mostrar/ocultar seg├║n permisos
  document.querySelectorAll('[data-perm-recibos]').forEach(btn => {
    const permKey = btn.dataset.permRecibos || '';
    btn.style.display = tienePermiso(permKey) ? '' : 'none';
  });
}

async function checkSession() {
  try {
    const res = await apiFetch('/api/sesion');
    const data = await res.json();
    if (data.autenticado) {
      if (data.csrfToken) innarCsrfToken = data.csrfToken;
      currentUser = data.usuario;
      $('menuUserName').textContent = currentUser?.nombre || currentUser?.usuario || 'Usuario';
      sessionStorage.setItem('nombre_usuario', currentUser?.nombre || '');
      updateSidebarUser(currentUser);
      updateMenuByRole();
      mostrarSaludoDoctor();
      initSocket();        // Inicializar socket al restaurar sesi├│n (recarga de p├ígina)
      setupMenuHandlers(); // Configurar handlers (incluyendo mobile sidebar)
      _initAudioStatusBtn(); // Mostrar bot├│n de audio (requiere clic manual al recargar)
      // Restaurar m├│dulo anterior si existe (sessionStorage = solo esta pesta├▒a)
      const savedModule = sessionStorage.getItem(lsKeyCurrentModule);
      // Restaurar doctor seleccionado si existe (para RECEPCIONISTA)
      const savedDoctor = sessionStorage.getItem(lsKeySelectedDoctor);
      if (savedDoctor) {
        selectedDoctorId = parseInt(savedDoctor);
      }
      if (savedModule) {
        goToModule(savedModule);
      } else {
        showView('view-menu');
        history.pushState({view: 'menu'}, '', '#menu');
      }
      return true;
    }
  } catch (e) { console.error(e); }
  currentUser = null;
  showView('view-login');
  return false;
}

async function doLogin(usuario, password) {
  try {
    // Hashear contrase├▒a con SHA512
    const hashedPassword = hashPassword(password);
    
    const res = await apiFetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario, password: hashedPassword })
    });
    const data = await res.json();
    if (data.ok) {
      if (data.csrfToken) innarCsrfToken = data.csrfToken;
      currentUser = data.usuario;
      // Limpiar cualquier flag de sesi├│n expirada residual
      sessionStorage.removeItem('session_expired');
      _sessionBannerShown = false;
      const expiredToast = document.getElementById('session-expired-toast');
      if (expiredToast) expiredToast.remove();
      $('loginError').classList.add('hidden');
      $('loginErrorText').textContent = '';
      $('loginErrorRetry').textContent = '';
      showView('view-menu');
      $('menuUserName').textContent = currentUser?.nombre || currentUser?.usuario || 'Usuario';
      sessionStorage.setItem('nombre_usuario', currentUser?.nombre || '');
      updateSidebarUser(currentUser);
      updateMenuByRole();
      mostrarSaludoDoctor();
      initSocket();
      setupMenuHandlers();
      // El clic del login desbloquea el motor de voz
      _unlockSpeech();
      _initAudioStatusBtn();
      history.pushState({view: 'menu'}, '', '#menu');
      return true;
    }
    
    // Mostrar error de login
    const errorText = $('loginErrorText');
    const errorRetry = $('loginErrorRetry');
    errorText.textContent = data.error || 'Error al iniciar sesi├│n';
    
    // Si est├í bloqueado por rate limiting
    if (res.status === 429 && data.bloqueado_hasta) {
      const tiempoBloqueoSegundos = data.bloqueado_hasta;
      const tiempoBloqueoMs = tiempoBloqueoSegundos * 1000; // Convertir de segundos a milisegundos
      const ahora = Date.now();
      const minutos = Math.ceil((tiempoBloqueoMs - ahora) / 60000);
      errorRetry.innerHTML = `<strong>­ƒöÆ Cuenta bloqueada</strong><br/>Intenta de nuevo en ${Math.max(minutos, 1)} minuto${Math.max(minutos, 1) !== 1 ? 's' : ''}`;
      errorRetry.style.marginTop = '8px';
    } else if (res.status === 401) {
      errorRetry.textContent = '';
    }
    
    $('loginError').classList.remove('hidden');
    return false;
  } catch (e) {
    $('loginErrorText').textContent = 'Error de conexi├│n';
    $('loginErrorRetry').textContent = '';
    $('loginError').classList.remove('hidden');
    return false;
  }
}

async function doLogout() {
  innarCsrfToken = '';
  try {
    await apiFetch('/api/logout', { method: 'POST' });
  } catch (e) { console.warn('[doLogout] Logout API failed:', e.message); }
  // Resetear flag de listeners de socket-electro
  window.listenersConfigured = false;
  window.socketElectroListenerAdded = false;
  closeSocket();
  sessionStorage.removeItem(lsKeyCurrentModule);
  sessionStorage.removeItem(lsKeySelectedDoctor);
  currentModule = null;
  window.currentModule = null;
  _hideAudioStatusBtn();
  showView('view-login');
  history.pushState({view: 'login'}, '', '#login');
  // Limpiar campos de login despu├®s del cambio de vista
  const formLogin = document.getElementById('formLogin');
  if (formLogin) formLogin.reset();
  const u = $('loginUsuario'), p = $('loginPassword');
  if (u) { u.value = ''; u.setAttribute('value', ''); }
  if (p) { p.value = ''; p.setAttribute('value', ''); }
}

let initRecibosDone = false, initAgendaDone = false, initElectroDone = false, initUsuariosDone = false, initDiagnosticosDone = false, initDashboardCitasDone = false, initGestionDatosDone = false, initUcqnDone = false;
function goToModule(moduleId) {
  showView(`view-${moduleId}`);
  currentModule = moduleId;
  window.currentModule = moduleId;  // Exponer para sockets
  sessionStorage.setItem(lsKeyCurrentModule, moduleId);
  history.pushState({view: moduleId}, '', `#${moduleId}`);
  if (moduleId === 'recibos') { if (!initRecibosDone) initRecibos(); else cargarLista(_recibosLastParams || ''); }
  if (moduleId === 'agenda-medica') { 
    if (!initAgendaDone) {
      initAgendaMedica();
      initAgendaDone = true;
    } else {
      // Al reingresar al m├│dulo, refrescar contra el doctor actualmente seleccionado
      // y volver a la subvista principal de citas.
      document.querySelectorAll('.agenda-page-btn').forEach(b => b.classList.remove('active'));
      const citasBtn = document.querySelector('.agenda-page-btn[data-page="citas"]');
      if (citasBtn) citasBtn.classList.add('active');
      document.querySelectorAll('.agenda-page').forEach(p => p.classList.remove('active'));
      const citasPage = document.querySelector('.agenda-page[data-agenda-page="citas"]');
      if (citasPage) citasPage.classList.add('active');
      const progSection = $('agendaProgramarSection');
      if (progSection) progSection.style.display = 'none';
      if (typeof calDoctorIdForCal !== 'undefined') {
        calDoctorIdForCal = selectedDoctorId || currentUser?.id || null;
      }
      if (typeof loadCalendarData === 'function' && (selectedDoctorId || currentUser?.id)) loadCalendarData();
      if (typeof cargarTurnosMedica === 'function') cargarTurnosMedica();
      if (typeof actualizarHorasDisponibles === 'function') actualizarHorasDisponibles();
    }
    // Socket.IO maneja los cambios en tiempo real, no necesitamos auto-refresh
  } else {
    stopAgendaMedicaAutoRefresh();
  }
  if (moduleId === 'electro') { if (!initElectroDone) initElectro(); initElectroDone = true; }
  if (moduleId === 'usuarios') { if (!initUsuariosDone) initUsuarios(); initUsuariosDone = true; }
  if (moduleId === 'diagnosticos') { if (!initDiagnosticosDone) initDiagnosticos(); initDiagnosticosDone = true; }
  if (moduleId === 'dashboard-citas') { if (!initDashboardCitasDone) initDashboardCitas(); initDashboardCitasDone = true; }
  if (moduleId === 'gestion-datos') { if (!initGestionDatosDone) initGestionDatos(); initGestionDatosDone = true; }
  if (moduleId === 'ucqn') { if (!initUcqnDone) initUcqn(); initUcqnDone = true; }
  if (moduleId === 'monitor-equipos') { initMonitorEquipos(); }
}

function goToMenu() {
  showView('view-menu');
  currentModule = null;
  window.currentModule = null;  // Limpiar para sockets
  sessionStorage.removeItem(lsKeyCurrentModule);
  stopAgendaMedicaAutoRefresh();
  // Resetear flags de inicializaci├│n para permitir reinicializaci├│n
  initAgendaDone = false;
  initElectroDone = false;
  initDashboardCitasDone = false;
  // initRecibosDone: NO resetear ÔÇö initRecibos usa addEventListener (acumular├¡a duplicados)
  // el m├│dulo recibos maneja refresh via el branch `else cargarLista()` en goToModule
  initUsuariosDone = false;
  initDiagnosticosDone = false;
  initGestionDatosDone = false;
  initUcqnDone = false;
  // Resetear calendario de citas integrado
  if (typeof _citasCalIniciado !== 'undefined') _citasCalIniciado = false;
  // Resetear cach├® de cat├ílogos para recargar al volver a entrar
  invalidarCacheEntidades();
  invalidarCacheEstudios();
  // Resetear flag de listeners de socket-electro
  window.listenersConfigured = false;
  // Limpiar selectedDoctorId cuando se vuelve al men├║
  selectedDoctorId = null;
  sessionStorage.removeItem(lsKeySelectedDoctor);
  history.pushState({view: 'menu'}, '', '#menu');
}

function setupMenuHandlers() {
  if (window._menuHandlersSetup) return;
  window._menuHandlersSetup = true;
  $('btnLogout').addEventListener('click', doLogout);
  $('btnCambiarContrasena').addEventListener('click', openCambiarContrasenaModal);
  document.querySelectorAll('.menu-card').forEach(card => {
    card.addEventListener('click', () => {
      // Si NO es doctor y hace clic en AGENDA M├ëDICA, mostrar selecci├│n de doctor
      if (card.dataset.module === 'agenda-medica' && currentUser?.rol !== 'doctor') {
        showDoctorSelectionModal();
      } else {
        goToModule(card.dataset.module);
      }
    });
  });
  $('btnVolverRecibos').addEventListener('click', goToMenu);
  $('btnVolverAgenda').addEventListener('click', goToMenu);
  $('btnVolverElectro').addEventListener('click', goToMenu);
  if ($('btnVolverUsuarios')) $('btnVolverUsuarios').addEventListener('click', goToMenu);
  if ($('btnVolverDashboardCitas')) $('btnVolverDashboardCitas').addEventListener('click', goToMenu);
  if ($('btnVolverGestionDatos')) $('btnVolverGestionDatos').addEventListener('click', goToMenu);
  if ($('btnVolverUcqn')) $('btnVolverUcqn').addEventListener('click', goToMenu);

  // Manejar bot├│n atr├ís del navegador (solo una vez)
  if (!window._popstateSetup) {
    window._popstateSetup = true;
    window.addEventListener('popstate', (e) => {
      if (!currentUser) return;
      const state = e.state || {};
      if (state.view === 'menu') {
        goToMenu();
      } else if (state.view) {
        goToModule(state.view);
      }
    });
  }

  // ÔöÇÔöÇ Swipe derecha en m├│vil = bot├│n Volver ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  // Solo interceptamos si el gesto empieza desde el borde izquierdo (<50px),
  // es predominantemente horizontal y ocurre dentro de un m├│dulo activo.
  if (!window._swipeBackSetup) {
    window._swipeBackSetup = true;
    let _swipeStartX = 0, _swipeStartY = 0, _swipeTracking = false;
    const EDGE_ZONE   = 50;   // px desde el borde izquierdo para activar
    const MIN_DIST    = 80;   // desplazamiento horizontal m├¡nimo para disparar
    const MAX_VER     = 60;   // m├íximo vertical permitido (evita confundir con scroll)

    document.addEventListener('touchstart', (e) => {
      const touch = e.touches[0];
      // Solo activar si el dedo empieza cerca del borde izquierdo
      // y el usuario est├í en un m├│dulo (no en men├║ ni login)
      if (touch.clientX <= EDGE_ZONE && currentModule) {
        _swipeStartX = touch.clientX;
        _swipeStartY = touch.clientY;
        _swipeTracking = true;
      } else {
        _swipeTracking = false;
      }
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
      if (!_swipeTracking) return;
      const touch = e.touches[0];
      const dx = touch.clientX - _swipeStartX;
      const dy = Math.abs(touch.clientY - _swipeStartY);
      // Si el movimiento vertical supera el l├¡mite, cancelar ÔÇö es un scroll
      if (dy > MAX_VER) { _swipeTracking = false; return; }
      // Si ya alcanz├│ el umbral horizontal, prevenir navegaci├│n nativa del browser
      if (dx > MIN_DIST) e.preventDefault();
    }, { passive: false });

    document.addEventListener('touchend', (e) => {
      if (!_swipeTracking) return;
      _swipeTracking = false;
      const touch = e.changedTouches[0];
      const dx = touch.clientX - _swipeStartX;
      const dy = Math.abs(touch.clientY - _swipeStartY);
      if (dx >= MIN_DIST && dy <= MAX_VER && currentModule) {
        goToMenu();
      }
    }, { passive: true });
  }
  // ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  // Sidebar recibos
  document.querySelectorAll('#view-recibos .sidebar-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      const page = this.dataset.page;
      document.querySelectorAll('#view-recibos .sidebar-btn').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      document.querySelectorAll('#view-recibos .page').forEach(p => p.classList.remove('active'));
      const pg = document.getElementById(`page-${page}`);
      if (pg) pg.classList.add('active');
      if (page === 'recibos') { cargarLista(_recibosLastParams || ''); cargarFiltrosUsuarios(); if ($('resetAll')) $('resetAll').style.display = canDeleteRecibos() ? 'inline-block' : 'none'; }
      if (page === 'servicios') renderServiciosList();
    });
  });

  setupMobileSidebars();
}

function setupMobileSidebars() {
  if (window._mobileSidebarSetup) return;
  window._mobileSidebarSetup = true;

  function openSidebar(sidebar, backdrop) {
    sidebar.classList.add('mobile-open');
    backdrop.classList.add('active');
  }

  function closeSidebar(sidebar, backdrop) {
    sidebar.classList.remove('mobile-open');
    backdrop.classList.remove('active');
  }

  function closeAll() {
    document.querySelectorAll('.sidebar.mobile-open').forEach(s => {
      const layout = s.closest('.main-layout');
      const bd = layout && layout.querySelector('.mobile-sidebar-backdrop');
      closeSidebar(s, bd || { classList: { remove: () => {} } });
    });
  }

  // Inyectar backdrop y bot├│n en cada m├│dulo
  document.querySelectorAll('.main-layout').forEach(layout => {
    const sidebar = layout.querySelector(':scope > .sidebar');
    const mainContent = layout.querySelector(':scope > .main-content');
    if (!sidebar || !mainContent) return;

    // Backdrop dentro del mismo layout (mismo stacking context que el sidebar)
    const backdrop = document.createElement('div');
    backdrop.className = 'mobile-sidebar-backdrop';
    layout.appendChild(backdrop);
    backdrop.addEventListener('click', () => closeSidebar(sidebar, backdrop));

    // Bot├│n hamburguesa antes del main-content
    const btn = document.createElement('button');
    btn.className = 'mobile-menu-btn no-print';
    btn.setAttribute('aria-label', 'Abrir navegaci├│n');
    btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>`;
    layout.insertBefore(btn, mainContent);
    btn.addEventListener('click', () => openSidebar(sidebar, backdrop));
  });

  // Cerrar sidebar al elegir opci├│n o volver
  document.addEventListener('click', e => {
    if (e.target.closest('.btn-volver') || e.target.closest('.sidebar-btn')) {
      closeAll();
    }
  }, true);
}

// Escapar HTML para evitar XSS al insertar en innerHTML
function escapeHtml(str) {
  if (str == null) return '';
  const s = String(str);
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

// Abreviar nombres largos de estudios para la tabla
function abreviarEstudio(nombre) {
  if (!nombre) return '-';
  const abreviaturas = {
    'Monitorizaci├│n Electroencefalografica por Video y Radio': 'Monit. EEG Video',
    'POLISOMNOGRAFIA': 'PSG',
    'PSG B├ísica': 'PSG B├ísica',
    'PSG CPAP': 'PSG CPAP',
    'POLISOMNOGRAFIA CPAP': 'PSG CPAP',
    'VTM': 'VTM',
  };
  // Coincidencia exacta
  if (abreviaturas[nombre]) return abreviaturas[nombre];
  // Coincidencia parcial (inicio)
  for (const [key, val] of Object.entries(abreviaturas)) {
    if (nombre.toUpperCase().startsWith(key.toUpperCase())) return val;
  }
  // Si es muy largo, truncar
  return nombre.length > 22 ? nombre.substring(0, 20) + 'ÔÇª' : nombre;
}

// Genera un badge de color seg├║n el estado de la cita electro
function normalizarEstadoElectro(estado) {
  const raw = String(estado || '').trim();
  if (!raw) return 'Programado';
  const key = raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_\s]+/g, ' ')
    .trim();

  const map = {
    'programado': 'Programado',
    'confirmado': 'Confirmado',
    'en sala': 'En Sala',
    'en estudio': 'En Estudio',
    'pausado': 'Pausado',
    'completado': 'Completado',
    'cancelado': 'Cancelado',
    'no asistio': 'No Asisti├│',
    'reprogramado': 'Reprogramado',
    'adelantado': 'Adelantado'
  };
  return map[key] || raw;
}

function estadoBadge(estado) {
  const map = {
    'Programado':   { bg: '#dbeafe', color: '#1d4ed8', border: '#93c5fd' },
    'Confirmado':   { bg: '#e0f2fe', color: '#0c4a6e', border: '#7dd3fc' },
    'En Sala':      { bg: '#fef9c3', color: '#92400e', border: '#fde047' },
    'En Estudio':   { bg: '#ffedd5', color: '#c2410c', border: '#fdba74' },
    'Completado':   { bg: '#dcfce7', color: '#15803d', border: '#86efac' },
    'Cancelado':    { bg: '#fee2e2', color: '#991b1b', border: '#fca5a5' },
    'No Asisti├│':   { bg: '#f3e8ff', color: '#6b21a8', border: '#d8b4fe' },
    'Reprogramado': { bg: '#e0f2fe', color: '#0369a1', border: '#7dd3fc' },
    'Adelantado':   { bg: '#ecfdf5', color: '#047857', border: '#6ee7b7' },
    'Pausado':      { bg: '#fef3c7', color: '#92400e', border: '#fcd34d' },
  };
  const e = normalizarEstadoElectro(estado);
  const s = map[e] || { bg: '#f3f4f6', color: '#374151', border: '#d1d5db' };
  return `<span style="display:inline-block;padding:5px 14px;border-radius:14px;font-size:0.85rem;font-weight:700;background:${s.bg};color:${s.color};border:1px solid ${s.border};white-space:nowrap;letter-spacing:0.01em">${escapeHtml(e)}</span>`;
}

/**
 * Formatea una hora al formato HH:MM AM/PM (12 horas)
 * Maneja: null, undefined, '', 'null', HH:MM, HH:MM:SS
 * @param {string|null} valor - La hora a formatear
 * @returns {string} Hora en formato H:MM AM/PM o '-' si es inv├ílida
 */
/**
 * Formatea una fecha ISO (ej: 2026-03-03T05:00:00.000Z) a formato DD/MM/YYYY
 * @param {string} fecha - Fecha en formato ISO
 * @returns {string} Fecha en formato DD/MM/YYYY o la fecha original si no es ISO
 */
function formatearFecha(fecha) {
  if (!fecha) return '-';
  try {
    const date = new Date(fecha);
    if (isNaN(date)) return fecha; // Si no es una fecha v├ílida, devuelve original
    const dia = String(date.getDate()).padStart(2, '0');
    const mes = String(date.getMonth() + 1).padStart(2, '0');
    const anio = date.getFullYear();
    return `${dia}/${mes}/${anio}`;
  } catch (e) {
    return fecha;
  }
}

function formatearHora(valor) {
  if (valor === null || valor === undefined || valor === '' || valor === 'null') {
    return '-';
  }
  const strValor = String(valor).trim();
  if (strValor.length >= 5) {
    const timeStr = strValor.substring(0, 5); // Obtiene HH:MM
    const [horas, minutos] = timeStr.split(':').map(Number);
    
    let periodo = 'AM';
    let horasFormato = horas;
    
    if (horas >= 12) {
      periodo = 'PM';
      if (horas > 12) {
        horasFormato = horas - 12;
      }
    } else if (horas === 0) {
      horasFormato = 12;
    }
    
    return `${horasFormato}:${String(minutos).padStart(2, '0')} ${periodo}`;
  }
  return strValor || '-';
}

// Convierte una cadena de hora "HH:MM" o "HH:MM:SS" a minutos totales desde medianoche.
// Retorna null si el valor no es v├ílido.
function horaAMinutos(h) {
  if (!h || typeof h !== 'string') return null;
  const parts = h.slice(0, 5).split(':').map(Number);
  if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) return null;
  return parts[0] * 60 + parts[1];
}

// Parsea una hora en formato "H:MM AM/PM" o "HH:MM" (24h) a "HH:MM" (24h).
function parseHora12a24(str) {
  if (!str) return '';
  str = str.trim().toUpperCase();
  // Formato 12h: "10:30 AM", "2:00 PM"
  const m12 = str.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
  if (m12) {
    let h = parseInt(m12[1], 10);
    const m = parseInt(m12[2], 10);
    if (h < 1 || h > 12 || m < 0 || m > 59) return '';
    if (m12[3] === 'AM') { if (h === 12) h = 0; }
    else { if (h !== 12) h += 12; }
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
  }
  // Formato 24h: "14:30", "7:00"
  const m24 = str.match(/^(\d{1,2}):(\d{2})$/);
  if (m24) {
    const h = parseInt(m24[1], 10);
    const m = parseInt(m24[2], 10);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59)
      return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
  }
  return '';
}

/**
 * Formatea una fecha ISO (2026-03-03T05:00:00.000Z) a YYYY-MM-DD
 * @param {string} fecha - Fecha en formato ISO o YYYY-MM-DD
 * @returns {string} Fecha en formato YYYY-MM-DD o la fecha original si es v├ílida
 */
function formatearFechaISO(fecha) {
  if (!fecha) return '';
  const strFecha = String(fecha).trim();
  
  // Si ya est├í en formato YYYY-MM-DD, devolverlo tal cual
  if (/^\d{4}-\d{2}-\d{2}$/.test(strFecha)) {
    return strFecha;
  }
  
  // Si es un ISO string, extraer la parte de la fecha
  if (strFecha.includes('T')) {
    return strFecha.split('T')[0];
  }
  
  return strFecha;
}

function hoyColombiaISO() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const y = parts.find(p => p.type === 'year')?.value;
  const m = parts.find(p => p.type === 'month')?.value;
  const d = parts.find(p => p.type === 'day')?.value;
  return `${y}-${m}-${d}`;
}

// Servicios por defecto
const serviciosDefault = [
  { id: null, nombre: 'Electroencefalograma Computarizado' },
  { id: null, nombre: 'Electroencefalograma Convencional'},
  { id: null, nombre: 'Monitorizaci├│n Electroencefalogr├ífica por video y radio'},
  { id: null, nombre: 'Polisomnograf├¡a'},
  { id: null, nombre: 'Polisomnograma en Titulaci├│n de CPAP/BPAP' },
  { id: null, nombre: 'Test de Latencia M├║ltiple'},
  { id: null, nombre: 'Polisomnograma Noche Dividida' }
];

// Cach├® en memoria de servicios (se carga desde el servidor)
let _serviciosCache = null;

async function getServicios() {
  if (_serviciosCache) return _serviciosCache;
  try {
    const res = await apiFetch('/api/servicios');
    if (res.ok) {
      _serviciosCache = await res.json();
      return _serviciosCache;
    }
  } catch(_) { console.warn('[getServicios] Failed to load services from API'); }
  return serviciosDefault;
}

function invalidarCacheServicios() {
  _serviciosCache = null;
}

function editServicio(id, nombreActual) {
  const modal = document.getElementById('modalEditarServicio');
  const input = document.getElementById('editarServicioInput');
  if (!modal || !input) return;
  input.value = nombreActual;
  modal.style.display = 'flex';
  modal.dataset.editId = id;
  input.focus();
  input.select();
}

function cerrarModalEditarServicio() {
  const modal = document.getElementById('modalEditarServicio');
  if (modal) modal.style.display = 'none';
}

async function confirmarEditarServicio() {
  const modal = document.getElementById('modalEditarServicio');
  const input = document.getElementById('editarServicioInput');
  if (!modal || !input) return;
  const id = modal.dataset.editId;
  const nuevoNombre = input.value.trim();
  if (!nuevoNombre) return;
  try {
    const res = await apiFetch(`/api/servicios/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre: nuevoNombre })
    });
    const data = await res.json();
    if (data.ok) {
      invalidarCacheServicios();
      await renderServiciosList();
      await updateServiciosSelects();
      showToast('Servicio actualizado', 'success');
    } else {
      showToast(data.error || 'Error al editar', 'error');
    }
  } catch(_) { showToast('Error de conexi├│n', 'error'); }
  cerrarModalEditarServicio();
}

// ============================================
// SISTEMA GEN├ëRICO DE PAGINACI├ôN
// ============================================

// Almacenar estado de paginaci├│n de cada tabla
window.paginationState = {};

/**
 * Configura paginaci├│n para una tabla
 * @param {string} tableId - ID ├║nico para la tabla (ej: 'usuarios', 'citasElectro', etc)
 * @param {Array} data - Array de datos a paginar
 * @param {Function} renderFunction - Funci├│n que renderiza una fila (recibe el tbody y un elemento de data)
 * @param {Object} options - Opciones de configuraci├│n
 */
function setupPagination(tableId, data, renderFunction, options = {}) {
  const {
    itemsPerPageDefault = 20,
    itemsPerPageOptions = [5, 10, 15, 20, 50],
    tbodyId = null,
    containerSelector = null,
    keepCurrentPage = true
  } = options;

  // Inicializar estado
  if (!window.paginationState[tableId]) {
    window.paginationState[tableId] = {
      currentPage: 1,
      itemsPerPage: itemsPerPageDefault,
      data: data,
      totalPages: Math.ceil(data.length / itemsPerPageDefault)
    };
  } else {
    // Actualizar datos y recalcular
    window.paginationState[tableId].data = data;
    window.paginationState[tableId].totalPages = Math.ceil(data.length / window.paginationState[tableId].itemsPerPage);
    if (!keepCurrentPage) {
      window.paginationState[tableId].currentPage = 1;
    } else {
      const maxPage = Math.max(1, window.paginationState[tableId].totalPages || 1);
      window.paginationState[tableId].currentPage = Math.min(window.paginationState[tableId].currentPage || 1, maxPage);
    }
  }

  const state = window.paginationState[tableId];

  // Renderizar tabla
  renderPaginatedTable(tableId, renderFunction, tbodyId);

  // Crear controles de paginaci├│n si el contenedor existe
  if (containerSelector) {
    createPaginationControls(tableId, containerSelector, itemsPerPageOptions, renderFunction, tbodyId);
  }
}

/**
 * Renderiza una p├ígina de la tabla paginada
 */
function _getScrollSnapshot(el) {
  if (!el) return { winX: window.scrollX, winY: window.scrollY, parent: null, top: 0, left: 0 };
  let p = el.parentElement;
  while (p) {
    const style = window.getComputedStyle(p);
    const canScrollY = /(auto|scroll)/.test(style.overflowY || '');
    const canScrollX = /(auto|scroll)/.test(style.overflowX || '');
    if (canScrollY || canScrollX) {
      return { winX: window.scrollX, winY: window.scrollY, parent: p, top: p.scrollTop, left: p.scrollLeft };
    }
    p = p.parentElement;
  }
  return { winX: window.scrollX, winY: window.scrollY, parent: null, top: 0, left: 0 };
}

function _restoreScrollSnapshot(snapshot) {
  if (!snapshot) return;
  if (snapshot.parent) {
    snapshot.parent.scrollTop = snapshot.top;
    snapshot.parent.scrollLeft = snapshot.left;
  }
  window.scrollTo(snapshot.winX, snapshot.winY);
}

function renderPaginatedTable(tableId, renderFunction, tbodyId) {
  const state = window.paginationState[tableId];
  if (!state) return;

  const tbody = tbodyId ? document.getElementById(tbodyId) : null;
  if (!tbody) return;
  const scrollSnapshot = _getScrollSnapshot(tbody);

  tbody.innerHTML = '';

  // Calcular ├¡ndices de items a mostrar
  const startIdx = (state.currentPage - 1) * state.itemsPerPage;
  const endIdx = startIdx + state.itemsPerPage;
  const paginatedData = state.data.slice(startIdx, endIdx);

  if (paginatedData.length === 0) {
    const colCount = 6; // Ajustar seg├║n la tabla
    tbody.innerHTML = `<tr><td colspan="${colCount}" style="padding:20px;text-align:center;color:#999">No hay datos para mostrar</td></tr>`;
    return;
  }

  // Renderizar cada fila
  paginatedData.forEach(item => {
    try {
      renderFunction(tbody, item);
    } catch (e) {
      console.error('[PAGINATION ERROR]', e);
    }
  });
  requestAnimationFrame(() => _restoreScrollSnapshot(scrollSnapshot));
}

/**
 * Crea controles de paginaci├│n (selector de items por p├ígina + navegaci├│n)
 */
function createPaginationControls(tableId, containerSelector, itemsPerPageOptions, renderFunction, tbodyId) {
  const container = document.querySelector(containerSelector) || document.getElementById(containerSelector);
  if (!container) return;

  const state = window.paginationState[tableId];
  if (!state) return;

  // Limpiar controles anteriores
  const existingControls = container.querySelector(`[data-pagination-id="${tableId}"]`);
  if (existingControls) {
    existingControls.remove();
  }

  // Crear contenedor de controles
  const controlsDiv = document.createElement('div');
  controlsDiv.setAttribute('data-pagination-id', tableId);
  controlsDiv.style.cssText = `
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 15px 14px;
    gap: 15px;
    flex-wrap: wrap;
  `;

  // Selector de items por p├ígina
  const itemsSelectDiv = document.createElement('div');
  itemsSelectDiv.style.cssText = 'display: flex; align-items: center; gap: 8px;';
  itemsSelectDiv.innerHTML = `<label>Mostrar:</label><select></select>`;
  
  const selectEl = itemsSelectDiv.querySelector('select');
  itemsPerPageOptions.forEach(opt => {
    const option = document.createElement('option');
    option.value = opt;
    option.textContent = opt;
    if (opt === state.itemsPerPage) option.selected = true;
    selectEl.appendChild(option);
  });
  
  selectEl.addEventListener('change', (e) => {
    state.itemsPerPage = parseInt(e.target.value);
    state.totalPages = Math.ceil(state.data.length / state.itemsPerPage);
    state.currentPage = 1;
    renderPaginatedTable(tableId, renderFunction, tbodyId);
    createPaginationControls(tableId, containerSelector, itemsPerPageOptions, renderFunction, tbodyId);
  });

  // Info de p├ígina y total de registros
  const infoDiv = document.createElement('div');
  infoDiv.style.cssText = 'font-size: 13px; color: #6b7280; text-align: center; flex-grow: 1; white-space: nowrap;';
  infoDiv.textContent = `P├ígina ${state.currentPage} de ${state.totalPages} | Total: ${state.data.length} registros`;

  // N├║meros de p├ígina
  const pageNumbersDiv = document.createElement('div');
  pageNumbersDiv.style.cssText = 'display: flex; gap: 4px; flex-wrap: wrap; justify-content: flex-end;';
  
  // Bot├│n "Primera"
  if (state.currentPage > 1) {
    const firstBtn = document.createElement('button');
    firstBtn.textContent = '┬½';
    firstBtn.className = 'pg-nav';
    firstBtn.addEventListener('click', () => {
      state.currentPage = 1;
      renderPaginatedTable(tableId, renderFunction, tbodyId);
      createPaginationControls(tableId, containerSelector, itemsPerPageOptions, renderFunction, tbodyId);
    });
    pageNumbersDiv.appendChild(firstBtn);
  }

  // Bot├│n "Anterior"
  if (state.currentPage > 1) {
    const prevBtn = document.createElement('button');
    prevBtn.textContent = 'ÔÇ╣';
    prevBtn.className = 'pg-nav';
    prevBtn.addEventListener('click', () => {
      state.currentPage--;
      renderPaginatedTable(tableId, renderFunction, tbodyId);
      createPaginationControls(tableId, containerSelector, itemsPerPageOptions, renderFunction, tbodyId);
    });
    pageNumbersDiv.appendChild(prevBtn);
  }

  // N├║meros de p├ígina (mostrar hasta 5 n├║meros)
  const maxPageButtons = 5;
  const startPage = Math.max(1, state.currentPage - Math.floor(maxPageButtons / 2));
  const endPage = Math.min(state.totalPages, startPage + maxPageButtons - 1);
  
  for (let i = startPage; i <= endPage; i++) {
    const pageBtn = document.createElement('button');
    pageBtn.textContent = i;
    const isActive = i === state.currentPage;
    if (isActive) {
      pageBtn.className = 'pg-active';
      pageBtn.disabled = true;
    } else {
      pageBtn.className = 'pg-page';
      pageBtn.addEventListener('click', () => {
        state.currentPage = i;
        renderPaginatedTable(tableId, renderFunction, tbodyId);
        createPaginationControls(tableId, containerSelector, itemsPerPageOptions, renderFunction, tbodyId);
      });
    }
    pageNumbersDiv.appendChild(pageBtn);
  }

  // Bot├│n "Siguiente"
  if (state.currentPage < state.totalPages) {
    const nextBtn = document.createElement('button');
    nextBtn.textContent = 'ÔÇ║';
    nextBtn.className = 'pg-nav';
    nextBtn.addEventListener('click', () => {
      state.currentPage++;
      renderPaginatedTable(tableId, renderFunction, tbodyId);
      createPaginationControls(tableId, containerSelector, itemsPerPageOptions, renderFunction, tbodyId);
    });
    pageNumbersDiv.appendChild(nextBtn);
  }

  // Bot├│n "├Ültima"
  if (state.currentPage < state.totalPages) {
    const lastBtn = document.createElement('button');
    lastBtn.textContent = '┬╗';
    lastBtn.className = 'pg-nav';
    lastBtn.addEventListener('click', () => {
      state.currentPage = state.totalPages;
      renderPaginatedTable(tableId, renderFunction, tbodyId);
      createPaginationControls(tableId, containerSelector, itemsPerPageOptions, renderFunction, tbodyId);
    });
    pageNumbersDiv.appendChild(lastBtn);
  }

  // Agregar componentes al contenedor de controles
  controlsDiv.appendChild(itemsSelectDiv);
  controlsDiv.appendChild(infoDiv);
  controlsDiv.appendChild(pageNumbersDiv);

  // Insertar controles en el contenedor
  container.appendChild(controlsDiv);
}

async function renderServiciosList() {
  const servicios = await getServicios();
  const list = $('serviciosList');
  list.innerHTML = '';
  servicios.forEach((s) => {
    const div = document.createElement('div');
    div.className = 'servicio-item';
    const span = document.createElement('span');
    span.textContent = s.nombre;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Editar';
    btn.addEventListener('click', () => editServicio(s.id, s.nombre));
    const btnDel = document.createElement('button');
    btnDel.type = 'button';
    btnDel.textContent = 'Eliminar';
    btnDel.className = 'btn-danger btn-sm';
    btnDel.style.marginLeft = '6px';
    btnDel.addEventListener('click', () => {
      showConfirm(`┬┐Eliminar el servicio "${s.nombre}"?`, async () => {
        try {
          const res = await apiFetch(`/api/servicios/${s.id}`, { method: 'DELETE' });
          const data = await res.json();
          if (data.ok) {
            invalidarCacheServicios();
            await renderServiciosList();
            await updateServiciosSelects();
            showToast('Servicio eliminado', 'success');
          }
        } catch(_) { showToast('Error eliminando', 'error'); }
      });
    });
    div.appendChild(span);
    div.appendChild(btn);
    div.appendChild(btnDel);
    list.appendChild(div);
  });
}

async function updateServiciosSelects() {
  const servicios = await getServicios();
  document.querySelectorAll('.item-desc:not(.item-desc-input)').forEach(select => {
    const currentVal = select.value;
    select.innerHTML = `<option value="">Seleccionar servicio</option>`;
    servicios.forEach(s => {
      const option = document.createElement('option');
      option.value = s.nombre;
      option.textContent = s.nombre;
      if(currentVal === s.nombre) option.selected = true;
      select.appendChild(option);
    });
    const option = document.createElement('option');
    option.value = 'custom';
    option.textContent = 'Personalizado...';
    select.appendChild(option);
  });
}

// Mostrar/ocultar loader
function showLoader(show = true, msg = 'Procesando...') {
  let loader = document.getElementById('loader');
  if (!loader) {
    loader = document.createElement('div');
    loader.id = 'loader';
    loader.className = 'app-loader-overlay';
    loader.innerHTML = '<div class="app-loader-box"><div class="app-loader-spinner"></div><div class="loader-msg">Procesando...</div></div>';
    document.body.appendChild(loader);
  }
  if (show) {
    const msgEl = loader.querySelector('.loader-msg');
    if (msgEl) msgEl.textContent = msg;
    loader.style.display = 'flex';
  } else {
    loader.style.display = 'none';
  }
}

// Iconos por tipo de toast
const _TOAST_ICONS = { success: 'Ô£ô', error: 'Ô£ò', warning: 'ÔÜá', info: 'Ôä╣' };

// Mostrar toast apilado con icono y bot├│n de cierre
function showToast(msg, type = 'info', duration = 4000) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `app-toast app-toast-${type}`;
  const icon = _TOAST_ICONS[type] || 'Ôä╣';
  toast.innerHTML =
    `<span class="toast-icon">${icon}</span>` +
    `<span class="toast-body">${msg}</span>` +
    `<button class="toast-close" aria-label="Cerrar">├ù</button>`;
  toast.querySelector('.toast-close').addEventListener('click', () => _removeToast(toast));
  container.appendChild(toast);
  setTimeout(() => _removeToast(toast), duration);
}

function _removeToast(toast) {
  if (!toast || toast.classList.contains('removing')) return;
  toast.classList.add('removing');
  setTimeout(() => toast.remove(), 280);
}

// Bot├│n con estado de carga
function setLoading(btn, loading, loadingText = 'Guardando...') {
  if (!btn) return;
  if (loading) {
    btn._origText = btn.textContent;
    btn._origDisabled = btn.disabled;
    btn.disabled = true;
    btn.textContent = loadingText;
    btn.classList.add('btn-loading');
  } else {
    btn.disabled = btn._origDisabled || false;
    btn.textContent = btn._origText || btn.textContent;
    btn.classList.remove('btn-loading');
  }
}

// ========== VOZ LATINOAMERICANA ==========
let _voiceCache = null;
let _speechUnlocked = false;
if ('speechSynthesis' in window) {
  window.speechSynthesis.onvoiceschanged = () => { _voiceCache = null; };
}

// Desbloquea speechSynthesis con un silencio (requiere gesto del usuario)
function _unlockSpeech() {
  if (_speechUnlocked || !('speechSynthesis' in window)) return;
  _speechUnlocked = true;
  const silent = new SpeechSynthesisUtterance(' ');
  silent.volume = 0;
  silent.lang = 'es-CO';
  window.speechSynthesis.speak(silent);
  const btn = document.getElementById('btnAudioStatus');
  if (btn) { btn.title = 'Audio habilitado'; btn.textContent = '\uD83D\uDD0A'; }
}

function _initAudioStatusBtn() {
  // Audio button removed
}

function _hideAudioStatusBtn() {
  const btn = document.getElementById('btnAudioStatus');
  if (btn) btn.remove();
}

function _pickLatAmVoice() {
  if (_voiceCache) return _voiceCache;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  const priority = ['es-CO', 'es-419', 'es-MX', 'es-AR', 'es-CL', 'es-PE', 'es-US', 'es-ES'];
  for (const lang of priority) {
    const v = voices.find(v => v.lang === lang || v.lang.startsWith(lang + '-'));
    if (v) { _voiceCache = v; return v; }
  }
  const fallback = voices.find(v => v.lang.startsWith('es')) || null;
  _voiceCache = fallback;
  return fallback;
}
function _speak(text, rate = 1, onEnd = null) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = rate;
  utter.volume = 1;
  const voice = _pickLatAmVoice();
  if (voice) { utter.voice = voice; utter.lang = voice.lang; }
  else { utter.lang = 'es-CO'; }
  if (onEnd) utter.onend = onEnd;
  utter.onerror = ev => console.error('Speech error:', ev.error);
  window.speechSynthesis.speak(utter);
}

// Reproducir n├║mero de consultorio por voz
function speakConsultorio(numero) {
  _speak(`Consultorio n├║mero ${numero}`, 1, () => showToast(`Consultorio ${numero} anunciado`, 'success'));
}

// ========== SESSION EXPIRADA ==========
let _sessionBannerShown = false;
function showSessionExpiredBanner() {
  if (_sessionBannerShown || document.getElementById('session-expired-toast')) return;
  _sessionBannerShown = true;
  sessionStorage.setItem('session_expired', '1');
  const toast = document.createElement('div');
  toast.id = 'session-expired-toast';
  toast.innerHTML = `
    <div class="session-expired-toast-content">
      <span class="session-expired-toast-icon">­ƒöÆ</span>
      <div class="session-expired-toast-text">
        <strong>Sesi├│n expirada</strong>
        <span>Tu sesi├│n ha terminado</span>
      </div>
      <button class="session-expired-toast-btn" id="btnGoLogin">Iniciar sesi├│n</button>
      <button class="session-expired-toast-close" aria-label="Cerrar">&times;</button>
    </div>`;
  document.body.appendChild(toast);
  const goLogin = async () => {
    try { await fetch('/api/logout', { method: 'POST', credentials: 'include' }); } catch(_) {}
    toast.remove();
    _sessionBannerShown = false;
    sessionStorage.removeItem('session_expired');
    if (window.socket) { window.socket.disconnect(); window.socket = null; }
    currentUser = null;
    showView('view-login');
  };
  toast.querySelector('#btnGoLogin').addEventListener('click', goLogin);
  toast.querySelector('.session-expired-toast-close').addEventListener('click', () => {
    toast.remove();
    _sessionBannerShown = false;
    sessionStorage.removeItem('session_expired');
  });
}

// ========== CONFIRM MODAL ==========
function showConfirm(msg, onOk, { okText = 'Eliminar', cancelText = 'Cancelar', danger = true, icon = 'ÔÜá´©Å' } = {}) {
  const backdrop = document.createElement('div');
  backdrop.className = 'confirm-backdrop';
  backdrop.innerHTML = `
    <div class="confirm-box">
      <div class="confirm-icon">${icon}</div>
      <div class="confirm-msg">${msg}</div>
      <div class="confirm-actions">
        <button class="btn-cancel">${cancelText}</button>
        <button class="btn-ok${danger ? ' danger' : ''}">${okText}</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);
  backdrop.querySelector('.btn-cancel').addEventListener('click', () => backdrop.remove());
  backdrop.querySelector('.btn-ok').addEventListener('click', () => { backdrop.remove(); onOk(); });
  backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });
}

function showPrompt(msg, onOk, { okText = 'Confirmar', cancelText = 'Cancelar', danger = true, icon = 'ÔÜá´©Å', placeholder = '' } = {}) {
  const backdrop = document.createElement('div');
  backdrop.className = 'confirm-backdrop';
  backdrop.innerHTML = `
    <div class="confirm-box">
      <div class="confirm-icon">${icon}</div>
      <div class="confirm-msg">${msg}</div>
      <textarea class="prompt-input" rows="3" placeholder="${escapeHtml(placeholder)}" style="width:100%;margin:10px 0;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-family:inherit;font-size:0.9rem;resize:vertical"></textarea>
      <div class="confirm-actions">
        <button class="btn-cancel">${cancelText}</button>
        <button class="btn-ok${danger ? ' danger' : ''}">${okText}</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);
  const input = backdrop.querySelector('.prompt-input');
  input.focus();
  backdrop.querySelector('.btn-cancel').addEventListener('click', () => backdrop.remove());
  backdrop.querySelector('.btn-ok').addEventListener('click', () => {
    const val = input.value.trim();
    if (!val) { input.style.borderColor = '#ef4444'; input.focus(); return; }
    backdrop.remove(); onOk(val);
  });
  backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });
}

// ========== SKELETON ROWS ==========
function showSkeletonRows(tbody, cols, count = 5) {
  if (!tbody) return;
  tbody.innerHTML = Array.from({ length: count }, (_, r) =>
    `<tr class="skeleton-row">${Array.from({ length: cols }, (_, i) =>
      `<td><div class="skeleton-cell" style="width:${55 + ((r + i * 3) % 4) * 10}%"></div></td>`
    ).join('')}</tr>`
  ).join('');
}

// ========== FIELD ERROR (validaci├│n inline) ==========
function markFieldError(input, msg) {
  if (!input) return;
  input.classList.add('field-error-input');
  let span = input.nextElementSibling;
  if (!span || !span.classList.contains('field-error-msg')) {
    span = document.createElement('span');
    span.className = 'field-error-msg';
    input.parentNode.insertBefore(span, input.nextSibling);
  }
  span.textContent = msg;
  const clear = () => { clearFieldError(input); input.removeEventListener('input', clear); input.removeEventListener('change', clear); };
  input.addEventListener('input', clear);
  input.addEventListener('change', clear);
}
function clearFieldError(input) {
  if (!input) return;
  input.classList.remove('field-error-input');
  const span = input.nextElementSibling;
  if (span && span.classList.contains('field-error-msg')) span.remove();
}

let _loginFormSetup = false;
function setupLoginForm() {
  if (_loginFormSetup) return;
  _loginFormSetup = true;

  const passwordInput = $('loginPassword');
  const toggleBtn = $('togglePassword');
  const capsWarning = $('capsLockWarning');

  // Toggle mostrar/ocultar contrase├▒a
  if (toggleBtn) {
    toggleBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const type = passwordInput.type === 'password' ? 'text' : 'password';
      passwordInput.type = type;
    });
  }

  // Detector de Caps Lock (tiempo real)
  if (passwordInput && capsWarning) {
    const checkCapsLock = (e) => {
      if (e.type.includes('key')) {
        try {
          const isCapsLockOn = e.getModifierState('CapsLock');
          capsWarning.style.display = isCapsLockOn ? 'block' : 'none';
        } catch (err) {
          capsWarning.style.display = 'none';
        }
      }
    };
    passwordInput.addEventListener('keydown', checkCapsLock);
    passwordInput.addEventListener('keyup', checkCapsLock);
  }

  // Login form submit
  $('formLogin').addEventListener('submit', async (e) => {
    e.preventDefault();
    const usuario = $('loginUsuario').value.trim();
    const password = $('loginPassword').value;
    if (!usuario || !password) return;
    $('btnLogin').disabled = true;
    await doLogin(usuario, password);
    $('btnLogin').disabled = false;
  });
}

// init
document.addEventListener('DOMContentLoaded', async ()=>{
  // SIEMPRE registrar el handler del formulario de login (antes de cualquier return)
  setupLoginForm();
  
  // Si la p├ígina se refresca con sesi├│n expirada pendiente, hacer logout en servidor
  if (sessionStorage.getItem('session_expired')) {
    sessionStorage.removeItem('session_expired');
    try { await fetch('/api/logout', { method: 'POST', credentials: 'include' }); } catch(_) {}
    showView('view-login');
    return;
  }
  // Verificar sesi├│n al cargar
  const autenticado = await checkSession();
  if (!autenticado) {
    return;
  }

  setupMenuHandlers();
  // initRecibos() solo al entrar al m├│dulo Recibos (goToModule) ÔÇö evita GET /api/recibos y 403 en usuarios sin recibos.ver
});

// ========== MODAL SELECCI├ôN DE DOCTOR ==========
async function showDoctorSelectionModal() {
  const medicos = await apiFetch('/api/medicos').then(r=>r.json()).catch(()=>[]);
  const container = $('medicosListContainer');
  container.innerHTML = '';
  
  if (medicos.length === 0) {
    container.innerHTML = '<p style="color:#999;text-align:center">No hay m├®dicos disponibles</p>';
  } else {
    medicos.forEach(med => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.style.cssText = 'padding:12px;text-align:left;border:1px solid #ddd;border-radius:6px;background:white;cursor:pointer;transition:all 0.2s;color:#627371;font-weight:500';
      btn.textContent = med.nombre;
      btn.onmouseover = () => btn.style.background = '#f3f4f6';
      btn.onmouseout = () => btn.style.background = 'white';
      btn.addEventListener('click', () => selectDoctor(med.id, med.nombre, med.especialidad));
      container.appendChild(btn);
    });
  }
  
  $('modalSelectDoctor').classList.remove('hidden');
  $('btnCerrarSelectDoctor').onclick = closeDoctorSelectionModal;
  $('btnCancelarSelectDoctor').onclick = closeDoctorSelectionModal;
}

function selectDoctor(doctorId, doctorName, especialidad) {
  selectedDoctorId = doctorId;
  selectedDoctorEspecialidad = especialidad;
  sessionStorage.setItem(lsKeySelectedDoctor, doctorId);
  sessionStorage.setItem('selected_doctor_especialidad', especialidad || '');
  closeDoctorSelectionModal();
  // Resetear estado visual interno de Agenda para evitar arrastrar el doctor/p├ígina anterior
  if (typeof calSelectedDate !== 'undefined') calSelectedDate = null;
  if (typeof calLoadReqId !== 'undefined') calLoadReqId++;
  if (typeof window !== 'undefined') window._agendaCalendarSetup = false;
  // Actualizar horas disponibles con el nuevo doctor
  actualizarHorasDisponibles();
  // Cargar tipos de consulta seg├║n especialidad
  cargarTiposConsultaSegunEspecialidad(especialidad);
  // Forzar reinicializaci├│n del m├│dulo agenda m├®dica cuando se cambiadel doctor
  initAgendaDone = false;
  goToModule('agenda-medica');
}

async function cargarTiposConsultaSegunEspecialidad(especialidad) {
  const selectTipo = $('nuevoTurnoTipoMedica');
  if (!selectTipo) return;
  selectTipo.innerHTML = '<option value="">Seleccionar</option>';
  if (!especialidad) return;

  try {
    let tipos = [];
    if (_tiposConsultaCache[especialidad]) {
      tipos = _tiposConsultaCache[especialidad];
    } else {
      const res = await apiFetch(`/api/tipos-consulta?especialidad_nombre=${encodeURIComponent(especialidad)}`);
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        tipos = data;
        _tiposConsultaCache[especialidad] = tipos;
      }
    }
    if (tipos.length > 0) {
      tipos.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.nombre;
        opt.textContent = t.nombre;
        selectTipo.appendChild(opt);
      });
    } else {
      // Fallback a datos hardcodeados si la API no devuelve nada
      (ESPECIALIDAD_TIPOS_CONSULTA[especialidad] || []).forEach(tipo => {
        const opt = document.createElement('option');
        opt.value = tipo;
        opt.textContent = tipo;
        selectTipo.appendChild(opt);
      });
    }
  } catch {
    // Fallback completo si la API falla
    (ESPECIALIDAD_TIPOS_CONSULTA[especialidad] || []).forEach(tipo => {
      const opt = document.createElement('option');
      opt.value = tipo;
      opt.textContent = tipo;
      selectTipo.appendChild(opt);
    });
  }

  selectTipo.removeEventListener('change', manejarCambioTipoConsulta);
  selectTipo.addEventListener('change', manejarCambioTipoConsulta);
}

function manejarCambioTipoConsulta(e) {
  manejarOtraConsulta(e.target.value);
}

function manejarOtraConsulta(tipoSeleccionado) {
  const otraConsultaRow = $('otraConsultaRow');
  const otraConsultaInput = $('otraConsultaInput');
  const agregarBtn = $('agregarOtraConsulta');
  
  if (tipoSeleccionado === 'Otra') {
    // Mostrar campo para agregar consulta personalizada
    otraConsultaRow.style.display = '';
    otraConsultaInput.value = '';
    otraConsultaInput.focus();
    
    // Remover listener anterior si existe
    agregarBtn.removeEventListener('click', agregarConsultaPersonalizada);
    // Agregar nuevo listener
    agregarBtn.addEventListener('click', agregarConsultaPersonalizada);
    
    // Permitir Enter en el input
    otraConsultaInput.removeEventListener('keypress', manejarEnterConsulta);
    otraConsultaInput.addEventListener('keypress', manejarEnterConsulta);
  } else {
    // Ocultar campo
    otraConsultaRow.style.display = 'none';
    otraConsultaInput.value = '';
  }
}

function agregarConsultaPersonalizada() {
  const selectTipo = $('nuevoTurnoTipoMedica');
  const otraConsultaInput = $('otraConsultaInput');
  const nuevaConsulta = otraConsultaInput.value.trim();
  
  if (!nuevaConsulta) {
    showToast('Por favor escribe el tipo de consulta', 'warning');
    otraConsultaInput.focus();
    return;
  }
  
  // Agregar la nueva opci├│n al select
  const option = document.createElement('option');
  option.value = nuevaConsulta;
  option.textContent = nuevaConsulta;
  selectTipo.appendChild(option);
  
  // Seleccionar la nueva opci├│n
  selectTipo.value = nuevaConsulta;
  
  // Limpiar input y ocultar fila
  otraConsultaInput.value = '';
  $('otraConsultaRow').style.display = 'none';
  
  // Mostrar confirmaci├│n
  showToast(`Consulta agregada: ${nuevaConsulta}`, 'success');
}

function manejarEnterConsulta(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    agregarConsultaPersonalizada();
  }
}

function closeDoctorSelectionModal() {
  $('modalSelectDoctor').classList.add('hidden');
  // NO limpiar selectedDoctorId aqu├¡ - debe persistir mientras se usa la agenda
}

function initRecibos() {
  initItemsTable();
  setDefaultDate();
  const puedeCrearRecibos = tienePermiso('recibos.crear');

  // Si el usuario NO tiene permiso de crear recibos: ir directo a Ver Recibos, ocultar tab crear
  if (!puedeCrearRecibos) {
    const crearBtn = document.querySelector('#view-recibos .sidebar-btn[data-page="crear"]');
    const crearPage = document.getElementById('page-crear');
    const recibosBtn = document.querySelector('#view-recibos .sidebar-btn[data-page="recibos"]');
    const recibosPage = document.getElementById('page-recibos');
    if (crearBtn)  { crearBtn.classList.remove('active'); crearBtn.style.display = 'none'; }
    if (crearPage) { crearPage.classList.remove('active'); }
    if (recibosBtn)  { recibosBtn.classList.add('active'); }
    if (recibosPage) { recibosPage.classList.add('active'); }
    cargarLista();
  } else {
    // Solo usuarios con permiso de creaci├│n necesitan el consecutivo
    nextNumber();
  }

  // Cargar m├®dicos en el select
  cargarMedicosEnRecibo();
  // Cargar servicios en el select de tipo estudio
  cargarServiciosEnRecibo();
  // Mostrar usuario actual como "generado por"
  const gpEl = $('reciboGeneradoPorDisplay');
  if (gpEl) {
    const nombre = sessionStorage.getItem('nombre_usuario') || currentUser?.nombre || currentUser?.usuario || 'ÔÇö';
    gpEl.textContent = nombre;
  }

  // Radios tipo de pago
  document.querySelectorAll('input[name="tipoPago"]').forEach(radio => {
    radio.addEventListener('change', function() {
      const pCard  = document.getElementById('radioPagoPCard');
      const tCard  = document.getElementById('radioPagoTCard');
      if (pCard) pCard.classList.toggle('selected', this.value === 'Efectivo');
      if (tCard) tCard.classList.toggle('selected', this.value === 'Transferencia');
    });
  });

  // Radios tipo de recibo: Doctor / Estudio
  document.querySelectorAll('input[name="reciboTipo"]').forEach(radio => {
    radio.addEventListener('change', function() {
      const docCard  = document.getElementById('reciboTipoDocCard');
      const estCard  = document.getElementById('reciboTipoEstCard');
      const docPanel = document.getElementById('reciboTipoDocPanel');
      const estPanel = document.getElementById('reciboTipoEstPanel');
      if (docCard) docCard.classList.toggle('selected', this.value === 'doctor');
      if (estCard) estCard.classList.toggle('selected', this.value === 'estudio');
      if (docPanel) docPanel.classList.toggle('hidden', this.value !== 'doctor');
      if (estPanel) estPanel.classList.toggle('hidden', this.value !== 'estudio');
      // Al cambiar a doctor, limpiar estudio y viceversa
      if (this.value === 'doctor') {
        if ($('reciboTipoServicio')) $('reciboTipoServicio').value = '';
        const medicoSel = $('reciboMedico');
        let medicoId = medicoSel ? medicoSel.value : '';
        // Auto-seleccionar el primer m├®dico disponible si ninguno est├í elegido
        if (!medicoId && medicoSel && medicoSel.options.length > 1) {
          const firstOpt = Array.from(medicoSel.options).find(o => o.value !== '');
          if (firstOpt) { medicoSel.value = firstOpt.value; medicoId = firstOpt.value; }
        }
        if (medicoId) {
          cargarTiposConsultaEnRecibo(medicoId);
        } else {
          window._reciboCurrentTipos = [];
          refreshConceptosRows();
        }
      } else {
        if ($('reciboMedico')) $('reciboMedico').value = '';
        if ($('reciboTipoConsulta')) $('reciboTipoConsulta').innerHTML = '<option value="">Seleccionar tipo</option>';
        getServicios().then(servicios => {
          window._reciboCurrentTipos = servicios.map(s => ({ nombre: s.nombre }));
          refreshConceptosRows();
        });
      }
    });
  });

  // Al cambiar m├®dico en el formulario de recibo, cargar tipos de consulta
  const reciboMedicoSel = $('reciboMedico');
  if (reciboMedicoSel) {
    reciboMedicoSel.addEventListener('change', async function() {
      await cargarTiposConsultaEnRecibo(this.value);
    });
  }

  // Buscar cita del d├¡a
  const btnBuscar = $('btnReciboBuscar');
  if (btnBuscar) btnBuscar.onclick = buscarCitaParaRecibo;
  const buscarInput = $('reciboBuscarInput');
  if (buscarInput) buscarInput.addEventListener('keydown', e => { if (e.key === 'Enter') buscarCitaParaRecibo(); });

  // Botones del formulario
  const addItem = document.getElementById('addItem');
  if (addItem) addItem.addEventListener('click', () => addRow());
  if ($('generate')) $('generate').addEventListener('click', generatePreview);
  if ($('btnNuevoRecibo')) $('btnNuevoRecibo').addEventListener('click', resetFormulario);
  if ($('print')) $('print').addEventListener('click', abrirPDF);
  // Bot├│n sidebar: resetear consecutivos (solo admin)
  const btnResetCons = document.getElementById('btnResetarConsecutivos');
  if (btnResetCons) btnResetCons.addEventListener('click', resetAllRecibos);

  if ($('resetAll')) $('resetAll').addEventListener('click', resetAllRecibos);

  // Filtros + exportar (p├ígina Ver Recibos)
  if ($('btnAplicarFiltros')) $('btnAplicarFiltros').onclick = aplicarFiltrosRecibos;
  if ($('btnLimpiarFiltros')) $('btnLimpiarFiltros').onclick = limpiarFiltrosRecibos;
  if ($('filtroPalabraClave')) $('filtroPalabraClave').addEventListener('keydown', e => { if (e.key === 'Enter') aplicarFiltrosRecibos(); });
  if ($('btnExportarCSV')) $('btnExportarCSV').onclick = exportarReciboCSV;
  if ($('btnExportarPDF')) $('btnExportarPDF').onclick = exportarReciboPDF;

  ['filtroFechaDesde', 'filtroFechaHasta', 'filtroEstadoPago', 'filtroAnulado'].forEach(id => {
    const el = $(id);
    if (el) el.addEventListener('change', () => aplicarFiltrosRecibos());
  });

  // Servicios
  const addServ = document.getElementById('addServicio');
  if (addServ) addServ.addEventListener('click', async () => {
    const nombre = $('newServicioNombre').value.trim();
    if (!nombre) { showToast('Ingresa el nombre del servicio', 'error'); return; }
    try {
      const res = await apiFetch('/api/servicios', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre })
      });
      const data = await res.json();
      if (data.ok) {
        invalidarCacheServicios();
        $('newServicioNombre').value = '';
        await renderServiciosList();
        await updateServiciosSelects();
        await cargarServiciosEnRecibo();
        showToast('Servicio agregado', 'success');
      } else {
        showToast(data.error || 'Error al agregar', 'error');
      }
    } catch (_) { showToast('Error de conexi├│n', 'error'); }
  });

  // S├│lo n├║meros en documento
  const docCliente = document.getElementById('docCliente');
  if (docCliente) docCliente.addEventListener('input', function() { this.value = this.value.replace(/[^0-9]/g, ''); });

  // Precargar filtros e inicializar multi-selects
  cargarFiltrosMedicos().then(() => {
    const el = $('filtroMedico');
    if (el) {
      initMultiSelect(el, { placeholder: 'Todos los m├®dicos', onChange: async (vals) => {
        // Cargar tipos de consulta si hay exactamente 1 m├®dico (no Electro)
        const wrap = $('filtroTipoConsultaWrap');
        const sel  = $('filtroTipoConsulta');
        if (wrap && sel) {
          if (vals.length === 1 && vals[0] !== 'ELECTRODIAGNOSTICOS') {
            sel.innerHTML = '<option value="">Todos</option>';
            try {
              const tipos = await apiFetch(`/api/tipos-consulta?medico_id=${encodeURIComponent(vals[0])}`).then(r => r.json()).catch(() => []);
              tipos.forEach(t => { const opt = document.createElement('option'); opt.value = t.nombre; opt.textContent = t.nombre; sel.appendChild(opt); });
            } catch (e) { console.warn('[filtroTipoConsulta] Error cargando tipos:', e.message); }
            if (!sel._ms) initMultiSelect(sel, { placeholder: 'Todos', onChange: () => { clearMultiSelect($('filtroEstudio')); aplicarFiltrosRecibos(); } });
            else sel._ms.refresh();
            wrap.style.display = '';
          } else {
            wrap.style.display = 'none';
            clearMultiSelect(sel);
          }
        }
        aplicarFiltrosRecibos();
      }});
      observeSelectForMulti(el);
    }
  });
  cargarFiltrosUsuarios().then(() => {
    const el = $('filtroGeneradoPor');
    if (el) { initMultiSelect(el, { placeholder: 'Todos', onChange: () => aplicarFiltrosRecibos() }); observeSelectForMulti(el); }
  });
  cargarFiltrosOpciones().then(() => {
    const elEnt = $('filtroEntidad');
    if (elEnt) { initMultiSelect(elEnt, { placeholder: 'Todas', onChange: () => aplicarFiltrosRecibos() }); observeSelectForMulti(elEnt); }
    const elEst = $('filtroEstudio');
    if (elEst) {
      initMultiSelect(elEst, { placeholder: 'Todos', onChange: () => { clearMultiSelect($('filtroTipoConsulta')); aplicarFiltrosRecibos(); } });
      observeSelectForMulti(elEst);
    }
  });
  // Tipo de pago (opciones est├íticas)
  const elTP = $('filtroTipoPago');
  if (elTP) initMultiSelect(elTP, { placeholder: 'Todos', onChange: () => aplicarFiltrosRecibos() });

  // Socket: cuando admin modifica tipos de consulta, refrescar el dropdown activo
  if (window.socket && !window.socketRecibosTiposListenerAdded) {
    window.socket.on('tipos-consulta:actualizado', () => {
      _tiposConsultaCache = {};                     // invalidar cach├® de agenda/turnos
      window._reciboCurrentTipos = [];              // invalidar cach├® del formulario
      const medicoId = $('reciboMedico')?.value;
      if (medicoId) cargarTiposConsultaEnRecibo(medicoId);
    });
    window.socketRecibosTiposListenerAdded = true;
  }

  initRecibosDone = true;
}

// ---- Cargar m├®dicos en el select del formulario ----
async function cargarMedicosEnRecibo() {
  const sel = $('reciboMedico');
  const filtro = $('filtroMedico');
  if (!sel) return;
  try {
    const medicos = await apiFetch('/api/medicos').then(r => r.json()).catch(() => []);
    // guardar lista para lookup de especialidad
    window._reciboMedicos = medicos;
    const first = sel.querySelector('option');
    sel.innerHTML = '';
    if (first) sel.appendChild(first.cloneNode(true));
    medicos.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.nombre || m.usuario;
      sel.appendChild(opt);
    });
    if (filtro) {
      filtro.innerHTML = '<option value="">Todos los m├®dicos</option>';
      medicos.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.nombre || m.usuario;
        filtro.appendChild(opt);
      });
    }
  } catch (e) { console.warn('[cargarMedicos] Error cargando m├®dicos:', e.message); }
}

// ---- Cargar tipos de consulta seg├║n el m├®dico seleccionado (formulario recibo) ----
async function cargarTiposConsultaEnRecibo(medicoId) {
  const sel = $('reciboTipoConsulta');
  if (!sel) return;
  sel.innerHTML = '<option value="">Seleccionar tipo</option>';
  if (!medicoId) return;
  try {
    // El servidor resuelve la especialidad del m├®dico y devuelve tipos de la BD
    const res = await apiFetch(`/api/tipos-consulta?medico_id=${encodeURIComponent(medicoId)}`);
    const tipos = await res.json().catch(() => []);

    // Confiar 100% en la BD ÔÇö si est├í vac├¡o es porque no hay tipos configurados
    tipos.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.nombre;
      opt.textContent = t.nombre;
      sel.appendChild(opt);
    });
    window._reciboCurrentTipos = Array.isArray(tipos) ? tipos.map(t => ({ nombre: t.nombre })) : [];
    refreshConceptosRows();
  } catch (e) { console.warn('[cargarTiposConsultaEnRecibo] Error:', e.message); }
}

// ---- Cargar servicios en el select del formulario ----
async function cargarServiciosEnRecibo() {
  const sel = $('reciboTipoServicio');
  if (!sel) return;
  try {
    const servicios = await getServicios();
    sel.innerHTML = '<option value="">Seleccionar estudio</option>';
    servicios.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.nombre;
      opt.textContent = s.nombre;
      sel.appendChild(opt);
    });
  } catch (e) { console.warn('[cargarServiciosEnRecibo] Error:', e.message); }
}

// ---- Cargar m├®dicos en filtro ----
async function cargarFiltrosMedicos() {
  const sel = $('filtroMedico');
  if (!sel) return;
  try {
    const res = await apiFetch('/api/medicos');
    const medicos = res.ok ? await res.json() : [];
    if (!Array.isArray(medicos)) { console.warn('[cargarFiltrosMedicos] Respuesta no es array'); return; }
    sel.innerHTML = '<option value="">Todos los m├®dicos</option>';
    medicos.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.nombre || m.usuario;
      sel.appendChild(opt);
    });
    // Opci├│n especial para filtrar recibos de electrodiagn├│sticos
    const optElectro = document.createElement('option');
    optElectro.value = 'ELECTRODIAGNOSTICOS';
    optElectro.textContent = 'ELECTRODIAGN├ôSTICOS';
    sel.appendChild(optElectro);
  } catch (e) { console.warn('[cargarFiltrosMedicos] Error:', e.message); }
}

// ---- Cargar usuarios que han generado recibos en filtro ----
async function cargarFiltrosUsuarios() {
  const sel = $('filtroGeneradoPor');
  if (!sel) return;
  try {
    const res = await apiFetch('/api/recibos/generadores');
    const generadores = res.ok ? await res.json() : [];
    if (!Array.isArray(generadores)) { console.warn('[cargarFiltrosUsuarios] Respuesta no es array'); return; }
    sel.innerHTML = '<option value="">Todos</option>';
    generadores.forEach(u => {
      const opt = document.createElement('option');
      opt.value = u.id;
      opt.textContent = u.nombre || String(u.id);
      sel.appendChild(opt);
    });
  } catch (e) { console.warn('[cargarFiltrosUsuarios] Error:', e.message); }
}

// ---- Cargar entidades y tipos de servicio/estudio usados en recibos ----
async function cargarFiltrosOpciones() {
  try {
    const res = await apiFetch('/api/recibos/opciones');
    const data = res.ok ? await res.json() : { entidades: [], estudios: [] };
    const selEnt = $('filtroEntidad');
    if (selEnt) {
      selEnt.innerHTML = '<option value="">Todas</option>';
      (Array.isArray(data.entidades) ? data.entidades : []).forEach(v => {
        const opt = document.createElement('option');
        opt.value = v; opt.textContent = v;
        selEnt.appendChild(opt);
      });
    }
    const selEstudio = $('filtroEstudio');
    if (selEstudio) {
      selEstudio.innerHTML = '<option value="">Todos</option>';
      (Array.isArray(data.estudios) ? data.estudios : []).forEach(v => {
        const opt = document.createElement('option');
        opt.value = v; opt.textContent = v;
        selEstudio.appendChild(opt);
      });
    }
  } catch (e) { console.warn('[cargarFiltrosOpciones] Error:', e.message); }
}
async function buscarCitaParaRecibo() {
  const q = ($('reciboBuscarInput')?.value || '').trim();
  if (q.length < 2) { showToast('Escribe al menos 2 caracteres', 'error'); return; }
  const contenedor = document.getElementById('reciboBuscarResultados');
  if (!contenedor) return;
  contenedor.classList.remove('hidden');
  contenedor.innerHTML = '<div style="padding:12px;color:#6b7280;text-align:center">Buscando...</div>';
  try {
    const resultados = await apiFetch(`/api/recibos/buscar-cita?q=${encodeURIComponent(q)}`).then(r => r.json());
    if (!resultados.length) {
      contenedor.innerHTML = '<div style="padding:12px;color:#6b7280;text-align:center">No se encontraron citas completadas en los ├║ltimos 7 d├¡as.</div>';
      return;
    }
    contenedor.innerHTML = resultados.map((c, i) => {
      const esTarjeta = c.entidad && c.entidad !== 'Particular';
      const badgeClass = c.origen === 'electro' ? 'electro' : '';
      const badgeText = c.origen === 'electro' ? 'Electro' : 'Consulta';
      return `<div class="recibo-buscar-item" data-idx="${i}">
        <div>
          <div class="rci-nombre">${escapeHtml(c.paciente_nombre || '-')}</div>
          <div class="rci-meta">Doc: ${escapeHtml(c.paciente_documento || '-')} ┬À ${escapeHtml(String(c.fecha||'').slice(0,10))} ┬À ${escapeHtml(c.hora||'')}
            ${c.medico_nombre ? ` ┬À Dr. ${escapeHtml(c.medico_nombre)}` : ''}
            ${c.tipo_consulta ? ` ┬À ${escapeHtml(c.tipo_consulta)}` : ''}
            ${c.entidad ? ` ┬À ${escapeHtml(c.entidad)}` : ''}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:6px">
          <span class="rci-badge ${badgeClass}">${badgeText}</span>
          <span class="recibo-buscar-accion">Ôåæ Usar</span>
        </div>
      </div>`;
    }).join('');
    // Event listeners
    contenedor.querySelectorAll('.recibo-buscar-item').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.idx, 10);
        const cita = resultados[idx];
        preLlenarReciboDesdeCita(cita);
        contenedor.classList.add('hidden');
        $('reciboBuscarInput').value = '';
      });
    });
  } catch (e) {
    contenedor.innerHTML = '<div style="padding:12px;color:#dc2626">Error al buscar citas.</div>';
  }
}

// ---- Pre-llenar formulario desde una cita seleccionada ----
async function preLlenarReciboDesdeCita(cita) {
  const _partesNombre = (cita.paciente_nombre || '').trim().split(/\s+/);
  const _mitad = Math.ceil(_partesNombre.length / 2);
  if ($('clienteNombres')) $('clienteNombres').value = _partesNombre.slice(0, _mitad).join(' ');
  if ($('clienteApellidos')) $('clienteApellidos').value = _partesNombre.slice(_mitad).join(' ');
  if ($('docCliente')) $('docCliente').value = cita.paciente_documento || '';

  // Entidad: pre-seleccionar si existe en el select
  if ($('reciboEntidad') && cita.entidad) {
    $('reciboEntidad').value = cita.entidad; // intentar├í coincidir con la opci├│n
  }

  // Tipo de recibo: si hay m├®dico -> seleccionar 'doctor', si hay tipo de estudio -> 'estudio'
  if (cita.medico_id) {
    const docRadio = document.querySelector('input[name="reciboTipo"][value="doctor"]');
    if (docRadio) { docRadio.checked = true; docRadio.dispatchEvent(new Event('change')); }
    if ($('reciboMedico')) {
      $('reciboMedico').value = String(cita.medico_id);
      await cargarTiposConsultaEnRecibo(cita.medico_id);
    }
    if (cita.tipo_consulta && $('reciboTipoConsulta')) {
      $('reciboTipoConsulta').value = cita.tipo_consulta;
    }
  } else if (cita.tipo_consulta) {
    const estRadio = document.querySelector('input[name="reciboTipo"][value="estudio"]');
    if (estRadio) { estRadio.checked = true; estRadio.dispatchEvent(new Event('change')); }
    if ($('reciboTipoServicio')) $('reciboTipoServicio').value = cita.tipo_consulta;
  }

  // Turno / cita vinculada
  if ($('reciboTurnoId')) $('reciboTurnoId').value = cita.origen === 'turno' ? (cita.id || '') : '';
  if ($('reciboCitaElectroId')) $('reciboCitaElectroId').value = cita.origen === 'electro' ? (cita.id || '') : '';

  showToast('Formulario pre-llenado con datos de la cita', 'success');
}

// ========== CARGA DIN├üMICA DE CAT├üLOGOS ==========
let _entidadesCache = null;
let _estudiosCache = null;

async function cargarEntidadesEnSelect(selectId) {
  const sel = $(selectId);
  if (!sel) return;
  try {
    if (!_entidadesCache) {
      const res = await apiFetch('/api/entidades');
      _entidadesCache = await res.json();
    }
    sel.innerHTML = '<option value="">Seleccionar</option>';
    (_entidadesCache || []).forEach(e => {
      const opt = document.createElement('option');
      opt.value = e.nombre;
      opt.textContent = e.nombre;
      sel.appendChild(opt);
    });
  } catch (err) {
    console.warn('[cargarEntidadesEnSelect] Error:', err.message);
  }
}

async function cargarEstudiosEnSelect(selectId) {
  const sel = $(selectId);
  if (!sel) return;
  try {
    if (!_estudiosCache) {
      const res = await apiFetch('/api/estudios/lista');
      const data = await res.json();
      _estudiosCache = (Array.isArray(data) ? data : (data.registros || data.estudios || [])).map(e => e.nombre || e);
    }
    sel.innerHTML = '<option value="">Seleccionar estudio</option>';
    (_estudiosCache || []).forEach(nombre => {
      const opt = document.createElement('option');
      opt.value = nombre;
      opt.textContent = nombre;
      sel.appendChild(opt);
    });
  } catch (err) {
    console.warn('[cargarEstudiosEnSelect] Error:', err.message);
  }
}

function generarTabsElectro(estudios) {
  const container = $('tabsElectroContainer');
  if (!container) return;
  // Mantener solo el bot├│n "Todas"
  container.innerHTML = '';
  // Bot├│n "Todas" con su listener
  const btnTodas = document.createElement('button');
  btnTodas.className = 'tab-electro-btn active';
  btnTodas.dataset.estudio = 'todas';
  btnTodas.textContent = 'Todas';
  btnTodas.addEventListener('click', (e) => {
    filtroEstudioElectro = 'todas';
    container.querySelectorAll('.tab-electro-btn').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
    cargarCitasElectro();
  });
  container.appendChild(btnTodas);
  // Etiquetas cortas para tabs
  const labelCorto = (nombre) => {
    if (!nombre) return nombre;
    if (nombre.toLowerCase().includes('monitorizaci├│n') || nombre.toLowerCase().includes('monitorizacion')) return 'Monit. EEG';
    if (nombre.toLowerCase().includes('titulaci├│n') || nombre.toLowerCase().includes('titulacion') || nombre.toLowerCase().includes('cpap')) return 'PSG CPAP/BPAP';
    if (nombre.toLowerCase().includes('electroencefalograma')) return 'EEG';
    if (nombre.toLowerCase().includes('test de latencia')) return 'Test Latencia';
    // Para nombres cortos, usar tal cual; para largos, abreviar
    return nombre.length > 15 ? nombre.substring(0, 15) + 'ÔÇª' : nombre;
  };
  (estudios || []).forEach(nombre => {
    const btn = document.createElement('button');
    btn.className = 'tab-electro-btn';
    btn.dataset.estudio = nombre;
    btn.textContent = labelCorto(nombre);
    btn.addEventListener('click', (e) => {
      filtroEstudioElectro = e.target.dataset.estudio;
      container.querySelectorAll('.tab-electro-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      cargarCitasElectro();
    });
    container.appendChild(btn);
  });
}

function invalidarCacheEntidades() { _entidadesCache = null; }
function invalidarCacheEstudios() { _estudiosCache = null; }

// ========== AGENDA M├ëDICA (Citas) ==========
async function initAgendaMedica() {
  const hoy = new Date().toISOString().slice(0,10);
  $('agendaMedicaFecha').value = hoy;
  updateAgendaFechaDisplay();
  
  // Cargar entidades desde la base de datos
  await cargarEntidadesEnSelect('nuevoTurnoEntidadMedica');
  
  // Cargar lista de m├®dicos
  const medicos = await apiFetch('/api/medicos').then(r=>r.json()).catch(()=>[]);
  
  // Mostrar m├®dico seleccionado
  if (selectedDoctorId) {
    const medico = medicos.find(m => m.id == selectedDoctorId);
    if (medico) {
      $('agendaMedicaDoctorDisplay').textContent = medico.nombre;
      selectedDoctorEspecialidad = medico.especialidad;
      sessionStorage.setItem('selected_doctor_especialidad', medico.especialidad || '');
      // Cargar tipos de consulta seg├║n especialidad
      cargarTiposConsultaSegunEspecialidad(medico.especialidad);
    } else {
      $('agendaMedicaDoctorDisplay').textContent = '-';
    }
  } else if (currentUser?.rol === 'doctor') {
    // Si es un DOCTOR, mostrar su propio nombre
    selectedDoctorId = currentUser?.id;
    selectedDoctorEspecialidad = currentUser?.especialidad;
    $('agendaMedicaDoctorDisplay').textContent = currentUser?.nombre || currentUser?.usuario || '-';
    cargarTiposConsultaSegunEspecialidad(currentUser?.especialidad);
  } else {
    // Sin doctor seleccionado (roles no doctor): mantener vac├¡o hasta seleccionar uno desde men├║
    $('agendaMedicaDoctorDisplay').textContent = '-';
  }

  // Sincronizar el calendario de programaci├│n con el doctor activo actual
  // incluso si ya hab├¡a sido inicializado antes.
  if (typeof calDoctorIdForCal !== 'undefined') {
    calDoctorIdForCal = selectedDoctorId || currentUser?.id || null;
  }
  
  // Validar disponibilidad del doctor cuando se selecciona una fecha
  // SIEMPRE aplicar validaci├│n si hay un doctor seleccionado
  if (typeof crearDatepickerConDisponibilidad === 'function' && selectedDoctorId) {
    crearDatepickerConDisponibilidad($('agendaMedicaFecha'), selectedDoctorId);
  }
  
  $('agendaMedicaFecha').addEventListener('change', () => {
    updateAgendaFechaDisplay();
    actualizarHorasDisponibles();
    cargarTurnosMedica();
  });
  if (tienePermiso('agenda.crear')) {
    $('nuevoPacienteNombresMedica')?.addEventListener('input', debounceBuscarPacientesMedica);
  }
  // Forzar solo d├¡gitos y m├íximo 10 en los tel├®fonos de cita m├®dica
  const limitarTelMedica = (e) => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 10);
  };
  $('nuevoPacienteTelefonoMedica')?.addEventListener('input', limitarTelMedica);
  $('nuevoPacienteTelefonoMedica2')?.addEventListener('input', limitarTelMedica);
  // (autocompletado por documento removido)
  // mostrar quien programa
  const prog = $('nuevoTurnoProgramadoPor');
  if (prog) prog.textContent = (currentUser && (currentUser.nombre || currentUser.usuario)) || '-';
  
  // Configurar listeners de socket para ver cambios en tiempo real
  if (window.socket && !window.socketAgendaMedicaListenerAdded) {
    window.socket.on('agenda:actualizar-lista', () => {
      cargarTurnosMedica();
    });
    window.socket.on('agenda:actualizar-consultorio', (consultorio) => {
      cargarTurnosMedica();
    });
    
    // ========= Listeners para Turnos M├®dicos (Agenda M├®dica) =========
    window.socket.on('turno-medico:estado-actualizado', (data) => {
      cargarTurnosMedica();
    });
    
    window.socket.on('turno-medico:reprogramado', (data) => {
      cargarTurnosMedica();
    });
    
    window.socket.on('turno-medico:creado', (data) => {
      cargarTurnosMedica();
    });
    
    window.socketAgendaMedicaListenerAdded = true;
  }
  // ajustar columnas seg├║n rol
  // guardar HTML original del TH de Hora para poder reinsertarlo si el rol cambia
  try {
    const headerRow = document.querySelector('#turnosTableMedica thead tr');
    const thHora = headerRow?.querySelector('.col-hora');
    const thAcciones = headerRow?.querySelector('th:last-child');
    if (thHora && !originalHoraTHHtml) originalHoraTHHtml = thHora.outerHTML;
    if (thAcciones && !originalAccionesTHHtml) originalAccionesTHHtml = thAcciones.outerHTML;
  } catch (e) { console.warn('[setupAgendaMedicaListeners] Failed to cache table headers:', e.message); }
  adjustColumnsForRole();
  
  // === PAGE NAVIGATION (Citas / Programar Agenda) ===
  // Mostrar/ocultar bot├│n "Programar Agenda" seg├║n rol
  const canAgendaProgram = tienePermiso('agenda.disponibilidad') || tienePermiso('agenda.crear');
  const btnProgramar = document.querySelector('[data-page="programar"]');
  if (btnProgramar) {
    btnProgramar.style.display = canAgendaProgram ? '' : 'none';
    // Cambiar texto del bot├│n seg├║n rol (preservar SVG)
    const btnProgramarText = btnProgramar.querySelector('span:last-child');
    if (btnProgramarText) btnProgramarText.textContent = currentUser?.rol === 'doctor' ? 'Programar Agenda' : 'Agenda';
  }
  
  // Pre-inicializar calendario de disponibilidad
  if (canAgendaProgram && !window._agendaCalendarSetup) {
    setupAgendaCalendar();
    window._agendaCalendarSetup = true;
  } else if (canAgendaProgram && typeof loadCalendarData === 'function' && (selectedDoctorId || currentUser?.id)) {
    // Si ya estaba inicializado, recargar con el doctor actualmente seleccionado.
    loadCalendarData();
  }
  
  // Sidebar button listeners para cambio de p├ígina
  document.querySelectorAll('.agenda-page-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      const page = this.dataset.page;
      // marcar bot├│n como activo
      document.querySelectorAll('.agenda-page-btn').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      // cambiar p├ígina visible
      document.querySelectorAll('.agenda-page').forEach(p => p.classList.remove('active'));
      const pgEl = document.querySelector(`.agenda-page[data-agenda-page="${page}"]`);
      if (pgEl) pgEl.classList.add('active');
      
      // mostrar/ocultar secciones dentro de p├ígina seg├║n rol
      if (page === 'citas') {
        // Recargar calendario al volver a la pesta├▒a de citas
        if (typeof cargarCitasCalendario === 'function') cargarCitasCalendario();
      } else if (page === 'programar') {
        const titleHeader = document.getElementById('agendaTitleHeader');
        if (titleHeader) titleHeader.textContent = currentUser?.rol === 'doctor' ? 'Programar Agenda' : 'Agenda';
        // Show PDF download section for roles that can upload
        const progSection = $('agendaProgramarSection');
        const canUpload = tienePermiso('agenda.crear');
        if (progSection) progSection.style.display = canUpload ? '' : 'none';
        // Reload calendar data when switching to this tab
        if (typeof loadCalendarData === 'function') loadCalendarData();
      }
    });
  });
  
  // Mostrar p├ígina inicial de citas (ya tienen clase active en HTML)
  // pero asegurar que el bot├│n de citas tenga clase active
  document.querySelectorAll('.agenda-page-btn').forEach(b => b.classList.remove('active'));
  const citasBtn = document.querySelector('.agenda-page-btn[data-page="citas"]');
  if (citasBtn) citasBtn.classList.add('active');

  // Resetear tambi├®n las p├íginas visibles para no conservar la vista anterior
  // cuando se cambia de doctor desde el men├║ principal.
  document.querySelectorAll('.agenda-page').forEach(p => p.classList.remove('active'));
  const citasPage = document.querySelector('.agenda-page[data-agenda-page="citas"]');
  if (citasPage) citasPage.classList.add('active');
  
  // Ocultar inicialmente las secciones de programar agenda
  const progSection = $('agendaProgramarSection');
  if (progSection) progSection.style.display = 'none';
  
  const doctorAcciones = $('agendaDoctorAcciones');
  if (doctorAcciones) doctorAcciones.style.display = 'none'; // removed ÔÇö acciones ahora en modal por fila

  // Bot├│n "Nueva Cita" y modal
  const btnNuevaCita = $('btnNuevaCitaMedica');
  const canCrearCita = tienePermiso('agenda.crear');
  if (btnNuevaCita) btnNuevaCita.style.display = canCrearCita ? 'inline-flex' : 'none';
  if (canCrearCita) {
    btnNuevaCita?.addEventListener('click', () => {
      const fechaModal = $('modalNuevaCitaFecha');
      if (fechaModal) fechaModal.value = $('agendaMedicaFecha')?.value || new Date().toISOString().slice(0, 10);
      const nomDiv = $('modalNuevaCitaDoctorNombre');
      if (nomDiv) nomDiv.textContent = $('agendaMedicaDoctorDisplay')?.textContent || '-';
      const prog = $('nuevoTurnoProgramadoPor');
      if (prog) prog.textContent = (currentUser && (currentUser.nombre || currentUser.usuario)) || '-';
      actualizarHorasDisponibles();
      $('modalNuevaCitaMedica')?.classList.remove('hidden');
    });
    $('btnCerrarNuevaCitaModal')?.addEventListener('click', () => $('modalNuevaCitaMedica')?.classList.add('hidden'));
    $('btnCancelarNuevaCitaModal')?.addEventListener('click', () => $('modalNuevaCitaMedica')?.classList.add('hidden'));
    $('modalNuevaCitaFecha')?.addEventListener('change', actualizarHorasDisponibles);
    $('crearTurnoMedica')?.addEventListener('click', crearTurnoMedica);
  }

  // Secci├│n de aviso al doctor (visible para admin_recepcion, aux_recepcion, admin_electro)
  const recepcionAcciones = $('agendaRecepcionAcciones');
  const canAvisar = tienePermiso('agenda.aviso_doctor');
  if (recepcionAcciones) recepcionAcciones.style.display = canAvisar ? '' : 'none';
  if (canAvisar) {
    $('btnAvisarDoctor')?.addEventListener('click', avisoDoctor);
  }
  
  $('btnDescargarAgendaPDF')?.addEventListener('click', descargarAgendaPDF);

  // Modal de edici├│n solo para admin/recepci├│n
  const editSection = $('agendaEditPacienteSection');
  if (editSection) {
    // Modal empieza oculto
    editSection.classList.add('hidden');
    if (tienePermiso('agenda.editar')) {
      $('btnGuardarNombreMedica').addEventListener('click', guardarNombrePacienteMedica);
      $('btnCerrarEditPaciente').addEventListener('click', () => {
        editSection.classList.add('hidden');
        selectedTurnoMedica = null;
        document.querySelectorAll('#turnosTableMedica tbody tr').forEach(row => row.classList.remove('turno-selected'));
      });
    } else {
      editSection.classList.add('hidden');
    }
  }
  // Bot├│n "Cargar Pacientes" (solo admin/recepci├│n)
  const btnCargarPacMedica = $('btnCargarPacientesMedica');
  if (btnCargarPacMedica && tienePermiso('agenda.crear')) {
    btnCargarPacMedica.style.display = '';
    btnCargarPacMedica.addEventListener('click', () => {
      const nomDiv = $('cargarPacientesMedicaDoctorNombre');
      if (nomDiv) nomDiv.textContent = $('agendaMedicaDoctorDisplay')?.textContent || '-';
      $('cargarPacientesMedicaFile').value = '';
      $('cargarPacientesMedicaPreview').style.display = 'none';
      $('cargarPacientesMedicaError').style.display = 'none';
      $('btnConfirmarCargarPacientesMedica').disabled = true;
      window._cargarPacientesMedicaData = null;
      $('modalCargarPacientesMedica')?.classList.remove('hidden');
    });
    $('btnCerrarCargarPacientesMedica')?.addEventListener('click', () => $('modalCargarPacientesMedica')?.classList.add('hidden'));
    $('btnCancelarCargarPacientesMedica')?.addEventListener('click', () => $('modalCargarPacientesMedica')?.classList.add('hidden'));
    $('cargarPacientesMedicaFile')?.addEventListener('change', (e) => procesarExcelPacientesMedica(e.target.files[0]));
    $('btnConfirmarCargarPacientesMedica')?.addEventListener('click', confirmarCargarPacientesMedica);
    $('btnDescargarPlantillaMedica')?.addEventListener('click', descargarPlantillaMedica);
  }

  // Inicializar calendario de citas (Ver Citas) - muestra el grid mensual primero
  if (typeof initCitasCalendario === 'function') initCitasCalendario();
  // Cargar disponibilidad programada (intervalos) desde el inicio
  await actualizarHorasDisponibles();
}

// Autocompletado por documento removido por solicitud del usuario

// hide Hora column for doctor view
function adjustColumnsForRole(){
  const headerRow = document.querySelector('#turnosTableMedica thead tr');
  if (!headerRow) return;
  
  if (currentUser?.rol === 'doctor') {
    // Para DOCTOR: mantener Hora visible, cambiar Acciones por "Quien Program├│"
    const colHora = document.querySelector('#turnosTableMedica colgroup .col-hora');
    if (colHora) colHora.style.display = '';
    
    const lastTh = headerRow.querySelector('th:last-child');
    if (lastTh && lastTh.textContent.includes('Acciones')) {
      lastTh.textContent = 'Quien Program├│';
    }
  } else {
    // Para RECEPCION/ADMIN: asegurar Hora visible, cambiar "Quien Program├│" por "Acciones"
    const colHora = document.querySelector('#turnosTableMedica colgroup .col-hora');
    if (colHora) colHora.style.display = '';
    
    if (!headerRow.querySelector('.col-hora') && originalHoraTHHtml) {
      const tpl = document.createElement('template');
      tpl.innerHTML = originalHoraTHHtml.trim();
      const newTh = tpl.content.firstChild;
      const ref = headerRow.children[1] || null;
      headerRow.insertBefore(newTh, ref);
    }
    
    const lastTh = headerRow.querySelector('th:last-child');
    if (lastTh && (lastTh.textContent.includes('Quien') || lastTh.textContent.includes('Program├│'))) {
      lastTh.textContent = 'Acciones';
    }
  }
}

function updateAgendaFechaDisplay(){
  const v = $('agendaMedicaFecha')?.value;
  const el = $('agendaMedicaFechaDisplay');
  if (!el) return;
  if (!v) { el.textContent = ''; return; }
  el.textContent = formatDateSpanish(v);
}

function formatDateSpanish(dateStr){
  try{
    const d = new Date(dateStr + 'T00:00:00');
    const dias = ['domingo','lunes','martes','mi├®rcoles','jueves','viernes','s├íbado'];
    const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
    const diaSemana = dias[d.getDay()];
    const dia = d.getDate();
    const mes = meses[d.getMonth()];
    const anio = d.getFullYear();
    return `${diaSemana} ${dia} DE ${mes.toUpperCase()} DE ${anio}`.toUpperCase();
  }catch(e){ return dateStr; }
}

function populateTurnoHoras(selectId, from='07:00', to='18:00', stepMinutes=20){
  const sel = document.getElementById(selectId);
  if (!sel) return;
  sel.innerHTML = '';
  const [fh, fm] = from.split(':').map(Number);
  const [th, tm] = to.split(':').map(Number);
  let start = fh*60 + fm;
  const end = th*60 + tm;
  while (start <= end) {
    const hh = String(Math.floor(start/60)).padStart(2,'0');
    const mm = String(start%60).padStart(2,'0');
    const val = `${hh}:${mm}`;
    const o = document.createElement('option');
    o.value = val;
    o.textContent = formatearHora(val);
    sel.appendChild(o);
    start += stepMinutes;
  }
}

// Actualizar horas disponibles seg├║n disponibilidad del doctor
async function actualizarHorasDisponibles() {
  const doctorId = selectedDoctorId;
  const fecha = $('modalNuevaCitaFecha')?.value || $('agendaMedicaFecha')?.value;
  const mensajeDiv = $('mensajeDisponibilidad');

  if (!doctorId || !fecha) {
    if (mensajeDiv) mensajeDiv.style.display = 'none';
    return;
  }

  try {
    const res = await apiFetch(`/api/doctor-disponibilidad?doctor_id=${doctorId}&fecha=${fecha}`);
    const data = await res.json();

    if (!data.ok) {
      if (mensajeDiv) mensajeDiv.style.display = 'none';
      return;
    }

    if (!mensajeDiv) return;

    const disponibleManana = data.disponible_manana;
    const disponibleTarde = data.disponible_tarde;

    if (!disponibleManana && !disponibleTarde) {
      mensajeDiv.innerHTML = 'ÔÜá´©Å El doctor no est├í disponible este d├¡a.';
      mensajeDiv.style.display = 'block';
      return;
    }

    const lineas = [];
    if (disponibleManana) lineas.push('Ma├▒ana: 8:00 AM ÔÇô 12:00 PM');
    if (disponibleTarde) lineas.push('Tarde: 2:00 PM ÔÇô 6:00 PM');
    if (!disponibleManana) lineas.push('ÔÜá´©Å No estar├í disponible en el horario de la ma├▒ana');
    if (!disponibleTarde) lineas.push('ÔÜá´©Å No estar├í disponible en el horario de la tarde');

    if (data.tiene_intervalos && data.intervalos && data.intervalos.length > 0) {
      const bloqueados = data.intervalos.map(i =>
        `${formatearHora(i.hora_inicio)}ÔÇô${formatearHora(i.hora_fin)}${i.razon ? ': ' + i.razon : ''}`
      );
      lineas.push('<strong>Bloqueados:</strong> ' + bloqueados.join(', '));
    }

    mensajeDiv.innerHTML = '<strong>Disponibilidad:</strong> ' + lineas.join(' &nbsp;|&nbsp; ');
    mensajeDiv.style.display = 'block';
  } catch (e) {
    console.error('Error en actualizarHorasDisponibles:', e);
    if (mensajeDiv) mensajeDiv.style.display = 'none';
  }
}

// --- Calendario interactivo de disponibilidad ---
let calCurrentYear = new Date().getFullYear();
let calCurrentMonth = new Date().getMonth(); // 0-based
let calSelectedDate = null; // 'YYYY-MM-DD'
let calDisponibilidad = {}; // { 'YYYY-MM-DD': { disponible, disponible_manana, disponible_tarde } }
let calSlots = []; // [{ fecha, hora_inicio, hora_fin, disponible }]
let calDoctorIdForCal = null;
let calModoTodoDia = false;
let calLoadReqId = 0;

function obtenerEstadoDiaAgenda(dateStr) {
  const disp = calDisponibilidad[dateStr];
  if (disp && (disp.disponible === false || disp.disponible === 0 || disp.disponible === '0' || disp.disponible === 'false')) return 'unavailable'; // Prioridad m├íxima

  const daySlots = calSlots.filter(s => (s.fecha || '').slice(0, 10) === dateStr && s.disponible);
  const normalizedSlots = daySlots
    .map(s => `${(s.hora_inicio || '').slice(0, 5)}-${(s.hora_fin || '').slice(0, 5)}`)
    .sort();

  const tieneJornadaCompleta = normalizedSlots.length === 2
    && normalizedSlots[0] === '08:00-12:00'
    && normalizedSlots[1] === '14:00-18:00';

  const tieneMediaJornada = normalizedSlots.length === 1
    && (normalizedSlots[0] === '08:00-12:00' || normalizedSlots[0] === '14:00-18:00');

  if (tieneJornadaCompleta) return 'full';
  if (tieneMediaJornada) return 'partial';

  // Fallback cuando no hay slots espec├¡ficos, usando disponibilidad mensual.
  if (disp) {
    if (disp.disponible_manana && disp.disponible_tarde) return 'full';
    if (disp.disponible_manana || disp.disponible_tarde) return 'partial';
    return 'unavailable';
  }

  if (daySlots.length > 0) return 'partial';
  return 'none';
}

function setupAgendaCalendar() {
  calDoctorIdForCal = selectedDoctorId || currentUser?.id;
  if (!calDoctorIdForCal) return;

  // El doctor se selecciona desde el men├║ principal para roles no doctor.
  // En esta vista solo se permite visualizar/editar la agenda del doctor ya seleccionado.
  const selectorDiv = $('agendaCalDoctorSelector');
  if (selectorDiv) {
    selectorDiv.style.display = 'none';
  }

  // Nav buttons - evitar listeners duplicados
  const prevBtn = $('calPrevMonth');
  const nextBtn = $('calNextMonth');
  if (prevBtn) {
    prevBtn.replaceWith(prevBtn.cloneNode(true));
    const newPrevBtn = $('calPrevMonth');
    newPrevBtn.addEventListener('click', () => {
      calCurrentMonth--;
      if (calCurrentMonth < 0) { calCurrentMonth = 11; calCurrentYear--; }
      calSelectedDate = null;
      loadCalendarData();
    });
  }
  if (nextBtn) {
    nextBtn.replaceWith(nextBtn.cloneNode(true));
    const newNextBtn = $('calNextMonth');
    newNextBtn.addEventListener('click', () => {
      calCurrentMonth++;
      if (calCurrentMonth > 11) { calCurrentMonth = 0; calCurrentYear++; }
      calSelectedDate = null;
      loadCalendarData();
    });
  }

  // Modal events
  $('calModalClose')?.addEventListener('click', closeCalModal);
  $('calDayModal')?.addEventListener('click', (e) => { if (e.target.id === 'calDayModal') closeCalModal(); });
  $('calToggleYes')?.addEventListener('click', () => setCalToggle(true));
  $('calToggleFullDay')?.addEventListener('click', () => setCalToggle(true, true));
  $('calToggleNo')?.addEventListener('click', () => setCalToggle(false));
  $('calModalAddHora')?.addEventListener('click', () => addCalHoraRow('', ''));
  $('calModalSave')?.addEventListener('click', saveCalDay);
  $('calModalClear')?.addEventListener('click', deleteCalDay);

  // Motivo de ausencia: mostrar/ocultar campo libre seg├║n selecci├│n
  $('calModalMotivoSelect')?.addEventListener('change', function() {
    const inputOtro = $('calModalMotivoOtro');
    if (inputOtro) inputOtro.style.display = this.value === 'Otro' ? '' : 'none';
  });

  // ESC to close modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('calDayModal')?.classList.contains('active')) closeCalModal();
  });

  loadCalendarData();
}

function setCalToggle(asistire, todoDia = false) {
  const btnYes = $('calToggleYes');
  const btnFullDay = $('calToggleFullDay');
  const btnNo = $('calToggleNo');
  const horasC = $('calModalHorasContainer');
  if (asistire) {
    calModoTodoDia = Boolean(todoDia);
    btnYes.classList.add('cal-toggle-active-yes');
    btnFullDay?.classList.toggle('cal-toggle-active-full', calModoTodoDia);
    btnNo.classList.remove('cal-toggle-active-no');
    if (horasC) horasC.style.display = calModoTodoDia ? 'none' : '';
  } else {
    calModoTodoDia = false;
    btnYes.classList.remove('cal-toggle-active-yes');
    btnFullDay?.classList.remove('cal-toggle-active-full');
    btnNo.classList.add('cal-toggle-active-no');
    if (horasC) horasC.style.display = 'none';
  }
}

function openCalModal(dateStr) {
  calSelectedDate = dateStr;
  const overlay = $('calDayModal');
  if (!overlay) return;

  // Title
  const d = new Date(dateStr + 'T12:00:00');
  const diasSemana = ['Domingo','Lunes','Martes','Mi├®rcoles','Jueves','Viernes','S├íbado'];
  const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const titulo = $('calModalTitle');
  const sub = $('calModalDateSub');
  if (titulo) titulo.textContent = `${diasSemana[d.getDay()]} ${d.getDate()} de ${meses[d.getMonth()]}`;
  if (sub) sub.textContent = `${calCurrentYear}`;

  // Load existing data
  const disp = calDisponibilidad[dateStr];
  const daySlots = calSlots.filter(s => (s.fecha || '').slice(0, 10) === dateStr && s.disponible);
  const normalizedSlots = daySlots
    .map(s => `${(s.hora_inicio || '').slice(0, 5)}-${(s.hora_fin || '').slice(0, 5)}`)
    .sort();
  const isFullDayConfigured = normalizedSlots.length === 2
    && normalizedSlots[0] === '08:00-12:00'
    && normalizedSlots[1] === '14:00-18:00';

  const horasList = $('calModalHorasList');
  if (horasList) horasList.innerHTML = '';

  if (disp && !disp.disponible) {
    setCalToggle(false);
  } else {
    setCalToggle(true, isFullDayConfigured);
    if (isFullDayConfigured) {
      // "Todo el d├¡a" se guarda como dos slots: 08:00-12:00 y 14:00-18:00.
    } else if (daySlots.length > 0) {
      daySlots.forEach(s => addCalHoraRow(s.hora_inicio?.slice(0, 5), s.hora_fin?.slice(0, 5)));
    } else if (disp) {
      if (disp.disponible_manana) addCalHoraRow('08:00', '12:00');
      if (disp.disponible_tarde) addCalHoraRow('14:00', '18:00');
      if (!disp.disponible_manana && !disp.disponible_tarde) addCalHoraRow('', '');
    } else {
      addCalHoraRow('', '');
    }
  }

  // Cargar observaci├│n existente (aplica para todos los estados)
  const selectMotivo = $('calModalMotivoSelect');
  const inputOtro = $('calModalMotivoOtro');
  if (selectMotivo) {
    const motivo = disp?.motivo_ausencia || '';
    const opciones = ['', 'UCQN', 'Hospital departamental', 'Cita m├®dica personal', 'Vacaciones', 'Capacitaci├│n'];
    if (opciones.includes(motivo)) {
      selectMotivo.value = motivo;
      if (inputOtro) inputOtro.style.display = 'none';
    } else if (motivo) {
      selectMotivo.value = 'Otro';
      if (inputOtro) { inputOtro.style.display = ''; inputOtro.value = motivo; }
    } else {
      selectMotivo.value = '';
      if (inputOtro) inputOtro.style.display = 'none';
    }
  }

  // Show with animation
  requestAnimationFrame(() => {
    overlay.classList.add('active');
  });
  renderCalendar();
}

function closeCalModal() {
  const overlay = $('calDayModal');
  if (overlay) overlay.classList.remove('active');
  calSelectedDate = null;
  renderCalendar();
}

async function loadCalendarData() {
  // Tomar siempre el doctor activo actual para evitar quedar pegado al anterior.
  calDoctorIdForCal = selectedDoctorId || currentUser?.id || calDoctorIdForCal;
  if (!calDoctorIdForCal) return;
  const reqId = ++calLoadReqId;
  const mes = `${calCurrentYear}-${String(calCurrentMonth + 1).padStart(2, '0')}`;

  try {
    // Cargar disponibilidad mensual
    const resDisp = await apiFetch(`/api/doctor-disponibilidad/${calDoctorIdForCal}?mes=${mes}&_t=${Date.now()}`, {
      cache: 'no-store'
    });
    const dataDisp = await resDisp.json();
    if (reqId !== calLoadReqId) return; // respuesta vieja
    calDisponibilidad = {};
    if (dataDisp.ok && Array.isArray(dataDisp.disponibilidad)) {
      dataDisp.disponibilidad.forEach(d => {
        const fecha = (d.fecha || '').slice(0, 10);
        let dispDia = false;
        if (d.disponible === true || d.disponible === 1 || d.disponible === '1') dispDia = true;
        if (d.disponible === false || d.disponible === 0 || d.disponible === '0' || d.disponible === 'false') dispDia = false;
        const dispManana = d.disponible_manana === true || d.disponible_manana === 1 || d.disponible_manana === '1';
        const dispTarde = d.disponible_tarde === true || d.disponible_tarde === 1 || d.disponible_tarde === '1';
        calDisponibilidad[fecha] = {
          ...d,
          disponible: dispDia,
          disponible_manana: dispManana,
          disponible_tarde: dispTarde
        };
      });
    }

    // Cargar slots de agenda
    const resSlots = await apiFetch(`/api/doctor-agenda?doctor_id=${calDoctorIdForCal}&_t=${Date.now()}`, {
      cache: 'no-store'
    });
    const slotsData = await resSlots.json();
    if (reqId !== calLoadReqId) return; // respuesta vieja
    calSlots = Array.isArray(slotsData) ? slotsData : [];
  } catch (e) {
    console.error('Error cargando datos del calendario:', e);
  }

  renderCalendar();
  renderCalResumen();
}

function renderCalendar() {
  const grid = $('calDaysGrid');
  const titleEl = $('calMonthTitle');
  if (!grid) return;

  const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  if (titleEl) titleEl.textContent = `${meses[calCurrentMonth]} ${calCurrentYear}`;

  grid.innerHTML = '';
  const firstDay = new Date(calCurrentYear, calCurrentMonth, 1);
  let startWeekday = firstDay.getDay(); // 0=Sun
  startWeekday = startWeekday === 0 ? 6 : startWeekday - 1; // convert to Mon=0

  const daysInMonth = new Date(calCurrentYear, calCurrentMonth + 1, 0).getDate();
  const today = new Date();
  today.setHours(0,0,0,0);

  // Empty cells before first day
  for (let i = 0; i < startWeekday; i++) {
    const empty = document.createElement('div');
    empty.className = 'cal-day cal-empty';
    grid.appendChild(empty);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateObj = new Date(calCurrentYear, calCurrentMonth, d);
    const dateStr = `${calCurrentYear}-${String(calCurrentMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const cell = document.createElement('div');
    cell.className = 'cal-day';
    cell.textContent = d;

    const isPast = dateObj < today;
    if (isPast) cell.classList.add('cal-past');
    if (dateObj.getTime() === today.getTime()) cell.classList.add('cal-today');
    if (dateStr === calSelectedDate) cell.classList.add('cal-selected');

    // Color por estado de jornada:
    // full (08:00-12:00 + 14:00-18:00)=verde, partial (media jornada)=azul, unavailable=no asiste=rojo.
    const estadoDia = obtenerEstadoDiaAgenda(dateStr);
    if (estadoDia === 'full') cell.classList.add('cal-available');
    if (estadoDia === 'partial') cell.classList.add('cal-partial');
    if (estadoDia === 'unavailable') cell.classList.add('cal-unavailable');

    if (!isPast) {
      cell.addEventListener('click', () => {
        calSelectedDate = dateStr;
        openCalModal(dateStr);
      });
    }

    grid.appendChild(cell);
  }
}

function addCalHoraRow(inicio, fin) {
  // If called from button click, inicio/fin are undefined
  if (inicio instanceof Event || inicio === undefined) { inicio = ''; fin = ''; }

  const horasList = $('calModalHorasList');
  if (!horasList) return;

  const row = document.createElement('div');
  row.className = 'cal-hora-row';
  row.innerHTML = `
    <span class="cal-hora-label">De</span>
    <input type="time" class="cal-hora-inicio" value="${escapeHtml(inicio || '')}" />
    <span class="cal-hora-label">a</span>
    <input type="time" class="cal-hora-fin" value="${escapeHtml(fin || '')}" />
    <button class="cal-hora-remove" title="Quitar">
      <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>
    </button>
  `;
  row.querySelector('.cal-hora-remove').addEventListener('click', () => row.remove());
  horasList.appendChild(row);
}

async function saveCalDay() {
  if (!calSelectedDate || !calDoctorIdForCal) return;

  // Detectar si el bot├│n "No asistir├®" est├í activo
  const noAsistireActivo = $('calToggleNo')?.classList.contains('cal-toggle-active-no');
  let disponible = true;
  let slots = [];
  let hasManana = false, hasTarde = false;
  let motivoAusencia = null;

  if (noAsistireActivo) {
    disponible = false;
    slots = [];
    hasManana = false;
    hasTarde = false;
    // Leer observaci├│n
    const selectMotivo = $('calModalMotivoSelect');
    const inputOtro = $('calModalMotivoOtro');
    if (selectMotivo) {
      const valSelect = selectMotivo.value;
      if (valSelect === 'Otro') {
        motivoAusencia = (inputOtro?.value || '').trim() || null;
      } else {
        motivoAusencia = valSelect || null;
      }
    }
  } else {
    disponible = Boolean(
      calModoTodoDia
      || $('calToggleYes')?.classList.contains('cal-toggle-active-yes')
      || $('calToggleFullDay')?.classList.contains('cal-toggle-active-full')
    );
    const horasRows = document.querySelectorAll('#calModalHorasList .cal-hora-row');
    if (disponible) {
      if (calModoTodoDia) {
        slots.push({ fecha: calSelectedDate, hora_inicio: '08:00', hora_fin: '12:00', disponible: 1 });
        slots.push({ fecha: calSelectedDate, hora_inicio: '14:00', hora_fin: '18:00', disponible: 1 });
        hasManana = true;
        hasTarde = true;
      } else {
        let valid = true;
        horasRows.forEach(row => {
          const hi = row.querySelector('.cal-hora-inicio')?.value;
          const hf = row.querySelector('.cal-hora-fin')?.value;
          if (!hi || !hf) { valid = false; return; }
          if (hi >= hf) { valid = false; return; }
          slots.push({ fecha: calSelectedDate, hora_inicio: hi, hora_fin: hf, disponible: 1 });
          const h = parseInt(hi.split(':')[0], 10);
          if (h < 12) hasManana = true;
          if (h >= 12) hasTarde = true;
        });
        if (!valid || slots.length === 0) {
          showToast('Completa todos los horarios correctamente (inicio < fin)', 'error');
          return;
        }
      }
    }
  }

  // Leer observaci├│n (aplica para todos los estados)
  if (motivoAusencia === null) {
    const selectMotivo = $('calModalMotivoSelect');
    const inputOtro = $('calModalMotivoOtro');
    if (selectMotivo) {
      const valSelect = selectMotivo.value;
      if (valSelect === 'Otro') {
        motivoAusencia = (inputOtro?.value || '').trim() || null;
      } else {
        motivoAusencia = valSelect || null;
      }
    }
  }

  const saveBtn = $('calModalSave');
  setLoading(saveBtn, true, 'Guardando...');

  try {
    // 1. Save availability in doctor_disponibilidad_mensual
    const r1 = await apiFetch('/api/doctor-disponibilidad/guardar-dia', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        doctor_id: calDoctorIdForCal,
        fecha: calSelectedDate,
        disponible,
        disponible_manana: disponible ? (hasManana || (!hasManana && !hasTarde)) : false,
        disponible_tarde: disponible ? (hasTarde || (!hasManana && !hasTarde)) : false,
        motivo_ausencia: motivoAusencia
      })
    });
    if (!r1.ok) {
      const errData = await r1.json().catch(() => ({}));
      throw new Error(errData.error || `Error ${r1.status} guardando disponibilidad`);
    }

    // 2. Save specific slots in doctor_agenda (replace day's slots)
    const r2 = await apiFetch('/api/doctor-agenda/guardar-dia', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        doctor_id: calDoctorIdForCal,
        fecha: calSelectedDate,
        slots
      })
    });
    if (!r2.ok) {
      const errData2 = await r2.json().catch(() => ({}));
      throw new Error(errData2.error || `Error ${r2.status} guardando horarios`);
    }

    // Actualizar cach├® local inmediatamente para que renderCalendar() refleje el cambio al cerrar modal
    const savedDate = calSelectedDate; // capturar antes de que closeCalModal lo anule
    calDisponibilidad[savedDate] = {
      disponible: disponible,
      disponible_manana: disponible ? (hasManana || (!hasManana && !hasTarde)) : false,
      disponible_tarde: disponible ? (hasTarde || (!hasManana && !hasTarde)) : false,
      motivo_ausencia: motivoAusencia
    };
    // Actualizar tambi├®n los slots locales
    calSlots = calSlots.filter(s => (s.fecha || '').slice(0, 10) !== savedDate);
    slots.forEach(s => calSlots.push(s));

    showToast('D├¡a guardado correctamente', 'success');
    closeCalModal();
    await loadCalendarData();
  } catch (e) {
    showToast('Error guardando: ' + e.message, 'error');
  } finally {
    setLoading(saveBtn, false);
  }
}

function deleteCalDay() {
  if (!calSelectedDate || !calDoctorIdForCal) return;
  showConfirm('┬┐Limpiar la configuraci├│n del d├¡a seleccionado?', async () => {
    try {
      const r = await apiFetch('/api/doctor-disponibilidad/eliminar-dia', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ doctor_id: calDoctorIdForCal, fecha: calSelectedDate })
    });
    if (!r.ok) {
      const errData = await r.json().catch(() => ({}));
      throw new Error(errData.error || `Error ${r.status} limpiando d├¡a`);
    }
    showToast('D├¡a limpiado', 'success');
    closeCalModal();
    await loadCalendarData();
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }
  }, { okText: 'Limpiar', icon: '­ƒùô´©Å' });
}

function renderCalResumen() {
  const cont = $('calResumenList');
  if (!cont) return;

  const daysInMonth = new Date(calCurrentYear, calCurrentMonth + 1, 0).getDate();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diasSemana = ['Dom','Lun','Mar','Mi├®','Jue','Vie','S├íb'];
  let html = '';
  let configured = 0;

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${calCurrentYear}-${String(calCurrentMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dateObj = new Date(calCurrentYear, calCurrentMonth, d);
    if (dateObj < today) continue;

    const disp = calDisponibilidad[dateStr];
    const daySlots = calSlots.filter(s => (s.fecha || '').slice(0, 10) === dateStr && s.disponible);
    const estadoDia = obtenerEstadoDiaAgenda(dateStr);

    if (!disp && daySlots.length === 0) continue;
    configured++;

    const dayName = diasSemana[dateObj.getDay()];
    let estadoHtml = '', horasHtml = '';

    if (estadoDia === 'unavailable') {
      estadoHtml = '<span class="cal-resumen-estado">No asiste</span>';
    } else if (estadoDia === 'full' || estadoDia === 'partial') {
      estadoHtml = `<span class="cal-resumen-estado">${estadoDia === 'full' ? 'Todo el d├¡a' : 'Medio d├¡a'}</span>`;
      if (daySlots.length > 0) {
        const normalizedSlots = daySlots
          .map(s => `${(s.hora_inicio || '').slice(0, 5)}-${(s.hora_fin || '').slice(0, 5)}`)
          .sort();
        const isFullDayConfigured = normalizedSlots.length === 2
          && normalizedSlots[0] === '08:00-12:00'
          && normalizedSlots[1] === '14:00-18:00';
        if (isFullDayConfigured) {
          horasHtml = '<span class="cal-resumen-horas">Todo el d├¡a</span>';
        } else {
          const horas = daySlots.map(s => `${(s.hora_inicio || '').slice(0, 5)}ÔÇô${(s.hora_fin || '').slice(0, 5)}`).join(', ');
          horasHtml = `<span class="cal-resumen-horas">${escapeHtml(horas)}</span>`;
        }
      } else if (disp) {
        const partes = [];
        if (disp.disponible_manana) partes.push('Ma├▒ana');
        if (disp.disponible_tarde) partes.push('Tarde');
        if (partes.length) horasHtml = `<span class="cal-resumen-horas">${partes.join(', ')}</span>`;
      }
    }

    html += `<div class="cal-resumen-dia cal-resumen-${estadoDia}">
      <span class="cal-resumen-fecha">${dayName} ${d}</span>
      ${estadoHtml}
      ${horasHtml}
    </div>`;
  }

  if (!configured) {
    cont.innerHTML = '<div style="color:#9ca3af;padding:8px 0">No hay d├¡as configurados este mes</div>';
  } else {
    cont.innerHTML = html;
  }
}

function showExcelViewer(workbook, filename) {
  // Crear modal
  const modal = document.createElement('div');
  modal.style.position = 'fixed';
  modal.style.top = '0';
  modal.style.left = '0';
  modal.style.right = '0';
  modal.style.bottom = '0';
  modal.style.background = 'rgba(0,0,0,0.5)';
  modal.style.zIndex = '9999';
  modal.style.display = 'flex';
  modal.style.alignItems = 'center';
  modal.style.justifyContent = 'center';
  
  const container = document.createElement('div');
  container.style.background = 'white';
  container.style.borderRadius = '8px';
  container.style.maxWidth = '90vw';
  container.style.maxHeight = '85vh';
  container.style.overflow = 'auto';
  container.style.padding = '20px';
  
  // Header con t├¡tulo y bot├│n cerrar
  const header = document.createElement('div');
  header.style.display = 'flex';
  header.style.justifyContent = 'space-between';
  header.style.alignItems = 'center';
  header.style.marginBottom = '16px';
  header.style.borderBottom = '2px solid #e5e7eb';
  header.style.paddingBottom = '12px';
  
  const titlePart = document.createElement('div');
  
  const title = document.createElement('h3');
  title.textContent = filename;
  title.style.margin = '0 0 8px 0';
  title.style.fontSize = '1.1rem';
  title.style.fontWeight = 'bold';
  titlePart.appendChild(title);
  
  // Selector de hojas
  const sheetNames = workbook.SheetNames;
  if (sheetNames.length > 1) {
    const sheetSelector = document.createElement('div');
    sheetSelector.style.display = 'flex';
    sheetSelector.style.gap = '8px';
    sheetSelector.style.flexWrap = 'wrap';
    
    sheetNames.forEach((sheetName, idx) => {
      const btn = document.createElement('button');
      btn.textContent = sheetName;
      btn.style.padding = '6px 12px';
      btn.style.fontSize = '0.85rem';
      btn.style.border = '1px solid #d1d5db';
      btn.style.background = idx === 0 ? '#0369a1' : '#f3f4f6';
      btn.style.color = idx === 0 ? 'white' : '#4b5563';
      btn.style.borderRadius = '4px';
      btn.style.cursor = 'pointer';
      btn.id = `sheet-btn-${idx}`;
      
      btn.addEventListener('click', () => {
        // Actualizar tabla
        const tableContainer = document.getElementById('excel-table-container');
        tableContainer.innerHTML = '';
        renderSheet(workbook, sheetName, tableContainer);
        
        // Actualizar botones
        document.querySelectorAll('[id^="sheet-btn-"]').forEach(b => {
          b.style.background = '#f3f4f6';
          b.style.color = '#4b5563';
        });
        btn.style.background = '#0369a1';
        btn.style.color = 'white';
      });
      sheetSelector.appendChild(btn);
    });
    titlePart.appendChild(sheetSelector);
  }
  
  header.appendChild(titlePart);
  
  const btnClose = document.createElement('button');
  btnClose.textContent = 'Ô£ò';
  btnClose.style.fontSize = '1.5rem';
  btnClose.style.background = 'none';
  btnClose.style.border = 'none';
  btnClose.style.cursor = 'pointer';
  btnClose.style.color = '#6b7280';
  btnClose.addEventListener('click', () => {
    modal.remove();
  });
  header.appendChild(btnClose);
  
  container.appendChild(header);
  
  // Contenedor de tabla
  const tableContainer = document.createElement('div');
  tableContainer.id = 'excel-table-container';
  tableContainer.style.overflowX = 'auto';
  
  // Renderizar primera hoja
  renderSheet(workbook, sheetNames[0], tableContainer);
  
  container.appendChild(tableContainer);
  modal.appendChild(container);
  document.body.appendChild(modal);
  
  // Cerrar con ESC
  const handleEsc = (e) => {
    if (e.key === 'Escape') {
      modal.remove();
      document.removeEventListener('keydown', handleEsc);
    }
  };
  document.addEventListener('keydown', handleEsc);
}

function renderSheet(workbook, sheetName, container) {
  const worksheet = workbook.Sheets[sheetName];
  
  // Usar sheet_to_html para renderizar la tabla exactamente como en Excel
  const html = XLSX.utils.sheet_to_html(worksheet);
  
  if (!html) {
    container.innerHTML = '<p style="color:#999;padding:20px">La hoja est├í vac├¡a</p>';
    return;
  }
  
  // Crear un div para el HTML
  const div = document.createElement('div');
  div.style.overflow = 'auto';
  
  // Insertar el HTML
  div.innerHTML = html;
  
  // Mejorar estilos de la tabla generada
  const table = div.querySelector('table');
  if (table) {
    table.style.borderCollapse = 'collapse';
    table.style.fontSize = '0.9rem';
    table.style.border = '1px solid #d1d5db';
    
    // Mejorar estilos de todas las celdas
    const tableCells = table.querySelectorAll('td, th');
    tableCells.forEach(cell => {
      cell.style.padding = '8px';
      cell.style.border = '1px solid #d1d5db';
      cell.style.textAlign = 'left';
    });
    
    // Header mejorado
    const headers = table.querySelectorAll('th');
    headers.forEach(header => {
      header.style.background = '#f3f4f6';
      header.style.fontWeight = 'bold';
    });
    
    // Alternancia de colores en filas
    const rows = table.querySelectorAll('tbody tr');
    rows.forEach((row, idx) => {
      row.style.background = idx % 2 === 0 ? '#f9fafb' : 'white';
    });
  }
  
  container.appendChild(div);
}

function setupAgendaVerMedicos() {
  const sel = $('agendaDoctorSelect');
  const cont = $('agendaDoctorSchedule');
  if (!sel || !cont) return;
  sel.innerHTML = '<option value="">Cargando...</option>';
  apiFetch('/api/medicos').then(r=>r.json()).then(list=>{
    sel.innerHTML = '<option value="">Seleccionar m├®dico</option>';
    list.forEach(m => { const o = document.createElement('option'); o.value = m.id; o.textContent = m.nombre || m.usuario; sel.appendChild(o); });
  }).catch(()=>{ sel.innerHTML = '<option value="">Error cargando</option>'; });
  
  sel.addEventListener('change', async (e)=>{
    const id = e.target.value; 
    if (!id) { cont.innerHTML=''; return; }
    cont.innerHTML = '<div style="padding:12px;color:#666">Cargando...</div>';
    
    try {
      // Obtener slots de agenda disponibles
      const resSlots = await apiFetch(`/api/doctor-agenda?doctor_id=${id}`);
      const slots = await resSlots.json();
      
      // Obtener archivos subidos
      const resFiles = await apiFetch(`/api/doctor-agenda-files?doctor_id=${id}`);
      const files = await resFiles.json();
      
      cont.innerHTML = '';
      
      // Mostrar slots si existen
      if (slots && slots.length > 0) {
        const tbl = document.createElement('table'); 
        tbl.style.width = '100%'; 
        tbl.style.borderCollapse = 'collapse';
        tbl.style.marginBottom = '20px';
        tbl.innerHTML = '<thead><tr style="background:#f3f4f6"><th style="padding:8px;border:1px solid #ddd">Fecha</th><th style="padding:8px;border:1px solid #ddd">Inicio</th><th style="padding:8px;border:1px solid #ddd">Fin</th><th style="padding:8px;border:1px solid #ddd">Disponible</th></tr></thead>';
        const tb = document.createElement('tbody');
        slots.forEach(r => { 
          const tr = document.createElement('tr'); 
          tr.innerHTML = `<td style="padding:8px;border:1px solid #ddd">${escapeHtml(r.fecha)}</td><td style="padding:8px;border:1px solid #ddd">${formatearHora(r.hora_inicio)}</td><td style="padding:8px;border:1px solid #ddd">${formatearHora(r.hora_fin)}</td><td style="padding:8px;border:1px solid #ddd">${r.disponible? 'S├¡':'No'}</td>`; 
          tb.appendChild(tr); 
        });
        tbl.appendChild(tb);
        cont.appendChild(tbl);
      } else {
        const noSlots = document.createElement('div');
        noSlots.style.padding = '12px';
        noSlots.style.color = '#999';
        noSlots.textContent = 'No hay programaci├│n de disponibilidad';
        cont.appendChild(noSlots);
      }
      
      // Mostrar archivos subidos (solo para recepci├│n)
      const filesSection = document.createElement('div');
      filesSection.style.marginTop = '16px';
      filesSection.style.paddingTop = '16px';
      filesSection.style.borderTop = '2px solid #e5e7eb';
      
      const filesTitle = document.createElement('h4');
      filesTitle.textContent = 'Archivos de Agenda';
      filesTitle.style.margin = '0 0 12px 0';
      filesTitle.style.color = '#374151';
      filesSection.appendChild(filesTitle);
      
      if (!files || files.length === 0) {
        const noFiles = document.createElement('div');
        noFiles.style.color = '#999';
        noFiles.textContent = 'No hay archivos subidos';
        filesSection.appendChild(noFiles);
      } else {
        const ul = document.createElement('ul');
        ul.style.margin = '0';
        ul.style.paddingLeft = '20px';
        files.forEach(f => { 
          const li = document.createElement('li');
          li.style.marginBottom = '8px';
          li.style.display = 'flex';
          li.style.justifyContent = 'space-between';
          li.style.alignItems = 'center';
          li.style.padding = '8px';
          li.style.background = '#f9fafb';
          li.style.borderRadius = '4px';
          
          const linkContainer = document.createElement('div');
          linkContainer.style.flex = '1';
          
          const link = document.createElement('a');
          link.href = f.url;
          link.target = '_blank';
          link.textContent = f.filename;
          link.style.color = '#0369a1';
          link.style.textDecoration = 'underline';
          linkContainer.appendChild(link);
          
          const meta = document.createElement('small');
          meta.textContent = ` (${f.creado_en || 'Sin fecha'})`;
          meta.style.color = '#999';
          meta.style.marginLeft = '8px';
          linkContainer.appendChild(meta);
          
          li.appendChild(linkContainer);
          
          // Bot├│n Ver para Excel
          const isExcel = /\.(xlsx?|xls)$/i.test(f.filename);
          if (isExcel) {
            const btnView = document.createElement('button');
            btnView.textContent = 'Ver';
            btnView.style.padding = '4px 12px';
            btnView.style.fontSize = '0.85rem';
            btnView.style.background = '#0369a1';
            btnView.style.color = 'white';
            btnView.style.border = 'none';
            btnView.style.borderRadius = '4px';
            btnView.style.cursor = 'pointer';
            btnView.style.marginLeft = '8px';
            btnView.addEventListener('click', async (e) => {
              e.preventDefault();
              e.stopPropagation();
              try {
                const response = await fetch(f.url);
                const arrayBuffer = await response.arrayBuffer();
                const workbook = XLSX.read(arrayBuffer, { type: 'array' });
                showExcelViewer(workbook, f.filename);
              } catch (err) {
                showToast('Error al leer el archivo Excel', 'error');
                console.error(err);
              }
            });
            li.appendChild(btnView);
          }
          
          ul.appendChild(li); 
        });
        filesSection.appendChild(ul);
      }
      cont.appendChild(filesSection);
      
    } catch (e) { 
      cont.innerHTML = '<div style="color:#dc2626;padding:12px">Error cargando datos: ' + escapeHtml(e.message) + '</div>'; 
      console.error(e);
    }
  });
}

function startAgendaMedicaAutoRefresh() {
  if (agendaMedicaInterval) return;
  agendaMedicaInterval = setInterval(() => {
    const view = document.getElementById('view-agenda-medica');
    if (view && !view.classList.contains('hidden')) {
      cargarTurnosMedica();
    }
  }, 2000);
}

function stopAgendaMedicaAutoRefresh() {
  if (agendaMedicaInterval) {
    clearInterval(agendaMedicaInterval);
    agendaMedicaInterval = null;
  }
}

function debounce(fn, ms) { let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; }
const debounceBuscarPacientesMedica = debounce(buscarPacientesMedica, 300);
async function buscarPacientesMedica() {
  const q = $('nuevoPacienteNombresMedica')?.value.trim() || '';
  if (q.length < 2) return;
  const res = await apiFetch(`/api/pacientes?buscar=${encodeURIComponent(q)}`);
  const pacientes = await res.json();
  const dl = $('pacientesListMedica');
  dl.innerHTML = '';
  pacientes.forEach(p => { const o = document.createElement('option'); o.value = p.nombre; o.dataset.id = p.id; o.dataset.doc = p.documento || ''; dl.appendChild(o); });
}

// Attach document input listener in init (added later)

async function cargarTurnosMedica() {
  if (_cargandoTurnosMedica) {
    _pendienteTurnosMedica = true;
    return;
  }
  _cargandoTurnosMedica = true;
  const fecha = $('agendaMedicaFecha').value;
  const doctorId = selectedDoctorId || ((currentUser?.rol === 'doctor' ? currentUser?.id : null));
  if (!fecha || !doctorId) {
    _cargandoTurnosMedica = false;
    if (window.currentModule === 'agenda-medica') {
      showToast('Selecciona fecha y m├®dico', 'error');
    }
    return;
  }
  showSkeletonRows($('turnosTableBodyMedica'), 8, 6);
  try {
    const res = await apiFetch(`/api/turnos?fecha=${fecha}&doctor_id=${doctorId}`);
    const turnos = await res.json();
    const tbody = $('turnosTableBodyMedica');

    // Todos los turnos ordenados por hora (mantener orden cronol├│gico siempre)
    const ESTADOS_FINALES = ['ATENDIDO', 'NO_ASISTIO', 'CANCELADO', 'REPROGRAMADO'];
    const turnosOrdenados = [...turnos].sort((a, b) => {
      const ma = horaAMinutos(a.hora) ?? 9999;
      const mb = horaAMinutos(b.hora) ?? 9999;
      return ma - mb;
    });

    // Si es doctor, asegurarnos de mostrar primero quien tenga numero_turno == 1
    if (currentUser?.rol === 'doctor') {
      const idx1 = turnosOrdenados.findIndex(x => x.numero_turno === 1 && !ESTADOS_FINALES.includes(x.estado));
      if (idx1 > 0) {
        const [one] = turnosOrdenados.splice(idx1, 1);
        turnosOrdenados.unshift(one);
      }
    }
    // Detectar si hay nuevo primer paciente con numero 1 para animar
    const firstWithNum1 = turnosOrdenados.find(t => t.numero_turno === 1 && !ESTADOS_FINALES.includes(t.estado));
    let animateTargetId = null;
    
    if (firstWithNum1 && firstWithNum1.id !== lastTurnoNumber1Id) {
      animateTargetId = firstWithNum1.id;
      lastTurnoNumber1Id = firstWithNum1.id;
    }

    tbody.innerHTML = '';
    const filasRequeridas = 25;
    const colspan = 9;
    
    const hayEnAtencion = turnosOrdenados.some(t => t.estado === 'EN_ATENCION');
    globalHayEnAtencion = hayEnAtencion;

    // Umbral de hueco din├ímico seg├║n especialidad del doctor
    const espLower = (selectedDoctorEspecialidad || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const es25min = espLower.includes('epileptolog') || espLower.includes('neurolog');
    const INTERVALO_MIN = es25min ? 25 : 40;

    // Obtener disponibilidad del doctor para la fecha seleccionada
    let dispManana = true, dispTarde = true, intervalosBloqueados = [];
    try {
      const dispRes = await apiFetch(`/api/doctor-disponibilidad?doctor_id=${doctorId}&fecha=${fecha}`);
      const dispData = await dispRes.json();
      if (dispData.ok) {
        dispManana = dispData.disponible_manana;
        dispTarde  = dispData.disponible_tarde;
        if (dispData.tiene_intervalos && dispData.intervalos) {
          intervalosBloqueados = dispData.intervalos.map(i => ({
            inicio: horaAMinutos(i.hora_inicio),
            fin:    horaAMinutos(i.hora_fin)
          }));
        }
      }
    } catch (e) { console.warn('Error obteniendo disponibilidad:', e.message); }

    // Construir rangos disponibles basados en la agenda del doctor
    const rangosDisponibles = [];
    if (dispManana) rangosDisponibles.push({ inicio: 8 * 60, fin: 12 * 60 }); // 8:00 - 12:00
    if (dispTarde)  rangosDisponibles.push({ inicio: 14 * 60, fin: 18 * 60 }); // 14:00 - 18:00

    // Funci├│n para verificar si un minuto est├í dentro de los rangos disponibles
    // y no est├í en un intervalo bloqueado
    function minutoDentroDeDisponibilidad(m) {
      const enRango = rangosDisponibles.some(r => m >= r.inicio && m < r.fin);
      if (!enRango) return false;
      const bloqueado = intervalosBloqueados.some(b => m >= b.inicio && m < b.fin);
      return !bloqueado;
    }

    // Construir lista de visualizaci├│n: insertar filas de slot vac├¡o con hora
    // tanto en los huecos entre citas como antes/despu├®s, respetando disponibilidad
    const displayList = [];

    // Helper: generar todos los slots disponibles en los rangos del doctor
    function generarSlotsEnRango(desdeMin, hastaMin) {
      const slots = [];
      let m = desdeMin;
      while (m < hastaMin) {
        if (minutoDentroDeDisponibilidad(m)) {
          const hh = String(Math.floor(m / 60)).padStart(2, '0');
          const mm = String(m % 60).padStart(2, '0');
          slots.push({ tipo: 'slot-vacio', hora: `${hh}:${mm}` });
        }
        m += INTERVALO_MIN;
      }
      return slots;
    }

    // Recopilar horas de TODOS los turnos para detectar huecos
    const horasTurnos = turnosOrdenados.map(t => horaAMinutos(t.hora)).filter(m => m !== null);

    if (horasTurnos.length === 0) {
      // Sin turnos: generar slots en todos los rangos disponibles
      for (const rango of rangosDisponibles) {
        displayList.push(...generarSlotsEnRango(rango.inicio, rango.fin));
      }
    } else {
      // (a) Slots antes del primer turno
      const primerTurno = Math.min(...horasTurnos);
      for (const rango of rangosDisponibles) {
        if (rango.fin <= primerTurno) {
          displayList.push(...generarSlotsEnRango(rango.inicio, rango.fin));
        } else if (rango.inicio < primerTurno) {
          displayList.push(...generarSlotsEnRango(rango.inicio, primerTurno));
        }
      }

      // (b) Turnos + slots entre TODAS las citas (incluidas atendidas)
      for (let i = 0; i < turnosOrdenados.length; i++) {
        displayList.push({ tipo: 'turno', data: turnosOrdenados[i] });
        if (i < turnosOrdenados.length - 1) {
          const mActual   = horaAMinutos(turnosOrdenados[i].hora);
          const mSiguiente = horaAMinutos(turnosOrdenados[i + 1].hora);
          if (mActual !== null && mSiguiente !== null) {
            displayList.push(...generarSlotsEnRango(mActual + INTERVALO_MIN, mSiguiente));
          }
        }
      }

      // (c) Slots despu├®s del ├║ltimo turno hasta fin de disponibilidad
      const ultimoTurno = Math.max(...horasTurnos);
      let inicio = ultimoTurno + INTERVALO_MIN;
      for (const rango of rangosDisponibles) {
        if (rango.fin <= inicio) continue;
        const desde = Math.max(rango.inicio, inicio);
        displayList.push(...generarSlotsEnRango(desde, rango.fin));
      }
    }

    const totalFilas = Math.max(displayList.length, filasRequeridas);
    for (let i = 0; i < totalFilas; i++) {
      if (i < displayList.length) {
        const item = displayList[i];
        if (item.tipo === 'turno') {
          renderTurnoRowMedica(tbody, item.data, animateTargetId, hayEnAtencion);
        } else if (item.tipo === 'slot-vacio') {
          crearFilaSlotVacio(tbody, colspan, item.hora);
        } else {
          crearFilaTurnoHueco(tbody, colspan);
        }
      } else {
        crearFilaTurnoVacia(tbody, colspan, currentUser?.rol === 'doctor');
      }
    }
    
    // Actualizar contador de citas en el header
    const countEl = $('citasTableCount');
    if (countEl) {
      const totalCitas = turnosOrdenados.filter(t => t.nombre_paciente).length;
      countEl.textContent = totalCitas > 0 ? totalCitas + ' cita' + (totalCitas !== 1 ? 's' : '') : '';
    }
    
    // Actualizar estado del bot├│n "Marcar como atendido"
    // (eliminado: ahora el cambio de estado se hace desde el modal al clickear el paciente)
    // adjustColumnsForRole
    // Ajustar columnas seg├║n rol (una sola vez despu├®s de renderizar todas las filas)
    adjustColumnsForRole();
  } catch (e) {
    showToast('Error cargando citas', 'error');
  } finally {
    _cargandoTurnosMedica = false;
    if (_pendienteTurnosMedica) {
      _pendienteTurnosMedica = false;
      setTimeout(() => cargarTurnosMedica(), 150);
    }
  }
}

// Funci├│n para crear una fila vac├¡a de turno
function crearFilaTurnoVacia(tbody, colspan, esDoctor) {
  const tr = document.createElement('tr');
  tr.className = 'turno-row estado-vacio';
  tr.style.opacity = '0.4';
  
  // Crear celdas vac├¡as seg├║n si es doctor o no
  const columnas = 9;
  let html = '';
  for (let i = 0; i < columnas; i++) {
    html += '<td style="padding:8px;border:none;background:transparent">&nbsp;</td>';
  }
  tr.innerHTML = html;
  tbody.appendChild(tr);
}

// Fila visual que indica un hueco de tiempo extendido entre citas
function crearFilaTurnoHueco(tbody, colspan) {
  const tr = document.createElement('tr');
  tr.className = 'turno-row turno-hueco';
  tr.style.cssText = 'opacity:0.55;background:repeating-linear-gradient(90deg,#f0f4f8 0px,#f0f4f8 8px,transparent 8px,transparent 16px)';
  tr.innerHTML = `<td colspan="${colspan}" style="padding:5px 12px;border:none;color:#9ca3af;font-size:0.78rem;font-style:italic;letter-spacing:0.02em">&#x2015; Consulta extendida &#x2015;</td>`;
  tbody.appendChild(tr);
}

// Fila visual de slot vac├¡o con hora tentativa (rojo claro suave)
function crearFilaSlotVacio(tbody, colspan, hora) {
  const tr = document.createElement('tr');
  tr.className = 'turno-row turno-slot-vacio';
  const horaDisplay = formatearHora(hora);
  if (currentUser?.rol === 'doctor') {
    tr.innerHTML = `
      <td style="padding:7px 10px;color:#e57373;font-size:0.82rem;font-style:italic">${horaDisplay}</td>
      <td colspan="${colspan - 1}" style="padding:7px 10px;color:#e57373;font-size:0.8rem;font-style:italic">Disponible</td>
    `;
  } else {
    tr.innerHTML = `
      <td style="padding:7px 10px;color:#b0b8b6;font-size:0.82rem"></td>
      <td class="col-hora col-mobile-hide" style="padding:7px 10px;color:#e57373;font-size:0.82rem;font-style:italic">${horaDisplay}</td>
      <td colspan="${colspan - 2}" style="padding:7px 10px;color:#e57373;font-size:0.8rem;font-style:italic">Disponible</td>
    `;
  }
  tbody.appendChild(tr);
}

function updateMarcarAtendidoButton(_turnos) { /* no-op: replaced by per-row modal buttons */ }

let selectedTurnoMedica = null;

function estadoBadgeMedica(estado) {
  const map = {
    'EN_ESPERA':    { bg: '#dbeafe', color: '#1d4ed8', border: '#93c5fd',  label: 'En Espera' },
    'EN_SALA':      { bg: '#fef9c3', color: '#92400e', border: '#fde047',  label: 'En Sala' },
    'EN_ATENCION':  { bg: '#ffedd5', color: '#c2410c', border: '#fdba74',  label: 'En Atenci├│n' },
    'ATENDIDO':     { bg: '#dcfce7', color: '#15803d', border: '#86efac',  label: 'Atendido' },
    'CANCELADO':    { bg: '#fee2e2', color: '#991b1b', border: '#fca5a5',  label: 'Cancelado' },
    'REPROGRAMADO': { bg: '#e0f2fe', color: '#0369a1', border: '#7dd3fc',  label: 'Reprogramado' },
    'NO_ASISTIO':   { bg: '#f3e8ff', color: '#6b21a8', border: '#d8b4fe',  label: 'No Asisti├│' },
  };
  const s = map[estado] || { bg: '#f3f4f6', color: '#374151', border: '#d1d5db', label: estado || '-' };
  return `<span style="display:inline-block;padding:3px 10px;border-radius:12px;font-size:0.78rem;font-weight:600;background:${s.bg};color:${s.color};border:1px solid ${s.border};white-space:nowrap">${escapeHtml(s.label)}</span>`;
}

function renderTurnoRowMedica(tbody, t, animateTargetId, hayEnAtencion) {
  // DEBUG: registra objeto turno para detectar desalineamientos en la tabla (remover cuando se confirme)
  if (window && window.location && window.location.search && window.location.search.indexOf('debugTurnos') !== -1) {
    console.debug('DEBUG turno object:', t);
  }
  const tr = document.createElement('tr');
  tr.className = 'turno-row';
  const pol = agendaMedicaPolicy(t, { hayEnAtencion });
  const puedeVerDetalle = pol.row.puedeVerDetalle;
  tr.style.cursor = puedeVerDetalle ? 'pointer' : 'default';

  if (t.id) {
    tr.setAttribute('data-turno-id', t.id);
  }

  const btnUpDisabled = pol.row.puedePrioridad ? '' : 'disabled';
  const btnDownDisabled = pol.row.puedePrioridad ? '' : 'disabled';
  const btnEditDisabled = pol.row.puedeEditar ? '' : 'disabled';
  const btnDeleteDisabled = pol.row.puedeEliminar ? '' : 'disabled';
  
  // Guardar estado de deshabilitaci├│n en data attributes para que los event listeners puedan acceder
  const dataDeshabilitado = (!pol.row.puedeEditar && !pol.row.puedeEliminar && !pol.row.puedePrioridad) ? 'data-deshabilitado="true"' : 'data-deshabilitado="false"';
  
  const prioridadBtns = pol.perms.cambiarEstado ? `<button class="btn-prioridad-up" data-up="${t.id}" title="Subir prioridad" ${btnUpDisabled} ${dataDeshabilitado}><img src="images/up.svg" alt="Ôåæ"/></button><button class="btn-prioridad-down" data-down="${t.id}" title="Bajar prioridad" ${btnDownDisabled} ${dataDeshabilitado}><img src="images/down.svg" alt="Ôåô"/></button>` : '';
  const accionesCell = (pol.perms.editar || pol.perms.eliminar)
    ? `<div class="table-actions">${prioridadBtns}${pol.perms.editar ? `<button class="btn-editar" data-edit="${t.id}" title="Editar" ${btnEditDisabled} ${dataDeshabilitado}><img src="images/edit.svg" alt="Editar"/></button>` : ''}${pol.perms.eliminar ? `<button class="btn-eliminar" data-delete="${t.id}" title="Eliminar" ${btnDeleteDisabled} ${dataDeshabilitado}><img src="images/delete.svg" alt="Eliminar"/></button>` : ''}</div>`
    : '-';
    const esEnSala = t.estado === 'EN_SALA';
    const tieneTurno = t.numero_turno != null;
    let numCellHtml = '';
    if (t.numero_turno === 1 && esEnSala) {
      numCellHtml = `<span class="badge-siguiente">Siguiente</span>`;
      tr.classList.add('turno-es-primero');
    } else if (t.numero_turno === 1 && t.estado === 'EN_ATENCION') {
      numCellHtml = `<span class="badge-en-atencion">En atenci\u00f3n</span>`;
      tr.classList.add('turno-es-primero');
    } else if (esEnSala && tieneTurno) {
      numCellHtml = t.numero_turno;
    } else {
      numCellHtml = '';
    }

    if (currentUser?.rol === 'doctor') {
      tr.innerHTML = `
        <td>${numCellHtml}</td>
        <td class="col-hora col-mobile-hide">${formatearHora(t.hora)}</td>
        <td>${escapeHtml(t.paciente_nombre)}</td>
        <td class="col-mobile-hide">${escapeHtml(t.tipo_consulta || '')}</td>
        <td class="col-mobile-hide">${escapeHtml(t.paciente_documento||'')}</td>
        <td class="col-mobile-hide">${escapeHtml(t.entidad||'')}</td>
        <td class="col-mobile-hide">${escapeHtml(t.notas || '')}</td>
        <td>${estadoBadgeMedica(t.estado)}</td>
        <td>${escapeHtml(t.programado_por || '-')}</td>
      `;
      if (animateTargetId && t.id === animateTargetId) {
        tr.classList.add('animate-nuevo-primero');
        setTimeout(() => tr.classList.remove('animate-nuevo-primero'), 1100);
      }
    } else {
      tr.innerHTML = `
        <td>${numCellHtml}</td>
        <td class="col-hora col-mobile-hide">${formatearHora(t.hora)}</td>
        <td>${escapeHtml(t.paciente_nombre)}</td>
        <td class="col-mobile-hide">${escapeHtml(t.tipo_consulta || '')}</td>
        <td class="col-mobile-hide">${escapeHtml(t.paciente_documento||'')}</td>
        <td class="col-mobile-hide">${escapeHtml(t.entidad||'')}</td>
        <td class="col-mobile-hide">${escapeHtml(t.notas || '')}</td>
        <td>${estadoBadgeMedica(t.estado)}</td>
        <td class="td-acciones">${accionesCell}</td>
      `;
    }
  // Abrir modal al hacer clic en la fila
  if (puedeVerDetalle) {
    tr.addEventListener('click', (e) => {
      // No activar si hace clic en botones
      if (e.target.closest('button') || e.target.closest('[data-delete]') || e.target.closest('[data-edit]') || e.target.closest('[data-up]') || e.target.closest('[data-down]')) {
        return;
      }
      abrirModalEstadoCitaMedica(t);
    });
    
    // Bot├│n de Editar
    const btnEdit = tr.querySelector('[data-edit]');
    btnEdit?.addEventListener('click', (e) => {
      e.stopPropagation();
      const btn = e.target.closest('[data-edit]');
      const deshabilitado = btn?.getAttribute('data-deshabilitado') === 'true';
      if (btn?.disabled || deshabilitado) return;
      seleccionarTurnoMedica(tr, t);
    });
  }

  // A├▒adir botones de prioridad
  if (pol.perms.cambiarEstado) {
    const upBtn = tr.querySelector('[data-up]');
    const downBtn = tr.querySelector('[data-down]');
    upBtn?.addEventListener('click', async (e)=>{
      e.stopPropagation();
      const btn = e.target.closest('[data-up]');
      const deshabilitado = btn?.getAttribute('data-deshabilitado') === 'true';
      if (btn?.disabled || deshabilitado) return;
      try {
        const id = btn?.dataset.up || e.target.dataset.up;
        const res = await apiFetch(`/api/turnos/${id}/numero`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ delta: -1 }) });
        const data = await res.json();
        if (data.ok) {
          showToast('Prioridad subida', 'success');
          cargarTurnosMedica();
        } else {
          showToast(data.error || 'Error al subir prioridad', 'error');
        }
      } catch(x){ showToast('Error al subir prioridad', 'error'); console.error(x); }
    });
    downBtn?.addEventListener('click', async (e)=>{
      e.stopPropagation();
      const btn = e.target.closest('[data-down]');
      const deshabilitado = btn?.getAttribute('data-deshabilitado') === 'true';
      if (btn?.disabled || deshabilitado) return;
      try {
        const id = btn?.dataset.down || e.target.dataset.down;
        const res = await apiFetch(`/api/turnos/${id}/numero`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ delta: 1 }) });
        const data = await res.json();
        if (data.ok) {
          showToast('Prioridad bajada', 'success');
          cargarTurnosMedica();
        } else {
          showToast(data.error || 'Error al bajar prioridad', 'error');
        }
      } catch(x){ showToast('Error al bajar prioridad', 'error'); console.error(x); }
    });
  }

  if (pol.perms.eliminar) {
    tr.querySelector('[data-delete]')?.addEventListener('click', async (e)=>{
      const btn = e.target.closest('[data-delete]');
      const deshabilitado = btn?.getAttribute('data-deshabilitado') === 'true';
      if (btn?.disabled || deshabilitado) return;
      showConfirm('┬┐Eliminar esta cita?', async () => {
      try {
        const deleteId = btn?.dataset.delete || e.target.dataset.delete;
        const res = await apiFetch(`/api/turnos/${deleteId}`, { method:'DELETE' });
        const data = await res.json();
        if (data.ok) {
          showToast('Cita eliminada', 'success');
          cargarTurnosMedica();
        } else {
          showToast(data.error || 'Error al eliminar', 'error');
        }
      } catch(x){ showToast('Error al eliminar', 'error'); console.error(x); }
      });
    });
  }
  tbody.appendChild(tr);
}

// Enviar aviso al doctor para que concluya su consulta
async function avisoDoctor(doctorIdParam) {
  const doctorId = doctorIdParam !== undefined ? doctorIdParam : (selectedDoctorId || null);
  const btn = doctorIdParam !== undefined ? $('btnAvisarDoctorElectro') : $('btnAvisarDoctor');
  if (btn) btn.disabled = true;
  try {
    const res = await apiFetch('/api/turnos/aviso-concluir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ doctor_id: doctorId })
    });
    const data = await res.json();
    if (data.ok) showToast('Aviso enviado al doctor', 'success');
    else showToast(data.error || 'Error al enviar aviso', 'error');
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  } finally {
    if (btn) setTimeout(() => { btn.disabled = false; }, 3000);
  }
}

async function llamarSiguientePaciente() {
  const fecha = $('agendaMedicaFecha').value;
  const doctorId = selectedDoctorId || ((currentUser?.rol === 'doctor' ? currentUser?.id : null));
  if (!fecha || !doctorId) { showToast('Selecciona fecha y m├®dico', 'error'); return; }
  try {
    const res = await apiFetch('/api/turnos/llamar-siguiente', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({fecha, doctor_id:doctorId}) });
    const data = await res.json();
    if (data.ok) { 
      const nombre = data.turno.paciente_nombre || '';
      const consultorio = data.turno.numero_consultorio;
      showToast('Paciente llamado: ' + nombre, 'success'); 
      // El anuncio de voz es recibido por recepci├│n/electro v├¡a socket (agenda:turno-llamar-siguiente)
      cargarTurnosMedica(); 
    } else {
      showToast(data.error||'Error', 'error');
    }
  } catch (e) { showToast('Error llamando paciente', 'error'); }
}

async function marcarAtendido() {
  const fecha = $('agendaMedicaFecha').value;
  const doctorId = selectedDoctorId || ((currentUser?.rol === 'doctor' ? currentUser?.id : null));
  
  try {
    // Buscar el turno en atenci├│n
    const res = await apiFetch(`/api/turnos?fecha=${fecha}&doctor_id=${doctorId}`);
    const turnos = await res.json();
    const turnoEnAtencion = turnos.find(t => t.estado === 'EN_ATENCION');
    
    if (!turnoEnAtencion) {
      showToast('No hay paciente en atenci├│n', 'error');
      return;
    }
    
    // Marcar como atendido
    const resMarcar = await apiFetch('/api/turnos/marcar-atendido', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ turno_id: turnoEnAtencion.id })
    });
    const dataMarcar = await resMarcar.json();
    if (dataMarcar.ok) {
      showToast('Paciente marcado como atendido', 'success');
      cargarTurnosMedica();
    } else {
      showToast(dataMarcar.error || 'Error', 'error');
    }
  } catch (e) {
    showToast('Error', 'error');
    console.error(e);
  }
}

async function descargarAgendaPDF() {
  try {
    const doctorId = selectedDoctorId;
    const fecha = $('reportDiaAgendaPDF').value;
    
    if (!doctorId) {
      showToast('Selecciona un doctor', 'error');
      return;
    }
    
    if (!fecha) {
      showToast('Selecciona una fecha', 'error');
      return;
    }
    
    // Mostrar indicador de carga
    const btnPDF = $('btnDescargarAgendaPDF');
    const textOriginal = btnPDF.textContent;
    btnPDF.disabled = true;
    btnPDF.textContent = 'Generando PDF...';
    
    const response = await apiFetch('/api/agenda/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        doctor_id: doctorId,
        fecha_inicio: fecha,
        fecha_fin: fecha
      })
    });
    
    if (!response.ok) {
      throw new Error(`Error ${response.status}`);
    }
    
    // Descargar el PDF
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `agenda_${doctorId}_${fecha}.pdf`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
    
    showToast('PDF descargado correctamente', 'success');
  } catch (e) {
    console.error('Error descargando PDF:', e);
    showToast('Error al descargar PDF: ' + e.message, 'error');
  } finally {
    const btnPDF = $('btnDescargarAgendaPDF');
    if (btnPDF) {
      btnPDF.disabled = false;
      btnPDF.textContent = 'Descargar PDF';
    }
  }
}

async function moverTurno(id, delta) {
  try {
    const res = await apiFetch(`/api/turnos/${id}/numero`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delta })
    });
    const data = await res.json();
    if (data.ok) {
      cargarTurnosMedica();
    } else {
      showToast(data.error || 'Error reordenando cita', 'error');
    }
  } catch (e) {
    showToast('Error reordenando cita', 'error');
  }
}

function seleccionarTurnoMedica(tr, t) {
  selectedTurnoMedica = t;
  document.querySelectorAll('#turnosTableMedica tbody tr').forEach(row => {
    row.classList.remove('turno-selected');
  });
  tr.classList.add('turno-selected');
  const info = $('agendaEditInfo');
  if (info) {
    info.textContent = `Cita actual: ${t.numero_turno || '-'} ┬À Estado: ${(t.estado || '').replace(/_/g,' ')} ┬À Consultorio: ${t.consultorio_nombre || ''}`;
  }
  const inputNombre = $('editPacienteNombreMedica');
  if (inputNombre) {
    inputNombre.value = t.paciente_nombre || '';
  }
  
  // Deshabilitar bot├│n de guardar nombre seg├║n rol:
  // ADMIN: puede editar si hay EN_ATENCION en otro turno, pero NO si est├í ATENDIDO
  // RECEPCION: no puede editar si est├í ATENDIDO o hay EN_ATENCION
  const btnGuardar = $('btnGuardarNombreMedica');
  if (btnGuardar) {
    const pol = agendaMedicaPolicy(t);
    btnGuardar.disabled = !pol.panel.puedeEditarNombre;
    btnGuardar.style.opacity = pol.panel.puedeEditarNombre ? '1' : '0.5';
    btnGuardar.style.cursor = pol.panel.puedeEditarNombre ? 'pointer' : 'not-allowed';
  }
  
  const modal = $('agendaEditPacienteSection');
  if (modal) {
    modal.classList.remove('hidden');
  }
}

async function guardarNombrePacienteMedica() {
  // Prevenir edici├│n seg├║n permisos y estado:
  if (!tienePermiso('agenda.editar')) {
    showToast('No tienes permiso para editar', 'error');
    return;
  }
  const pol = agendaMedicaPolicy(selectedTurnoMedica);
  if (!pol.panel.puedeEditarNombre) {
    showToast('No se pueden editar citas ya atendidas', 'error');
    return;
  }
  
  if (!selectedTurnoMedica) {
    showToast('Selecciona un paciente primero', 'error');
    return;
  }
  const nuevoNombre = $('editPacienteNombreMedica').value.trim();
  if (!nuevoNombre) {
    showToast('Escribe un nombre', 'error');
    return;
  }
  try {
    const res = await apiFetch(`/api/turnos/${selectedTurnoMedica.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paciente_nombre: nuevoNombre })
    });
    const data = await res.json();
    if (data.ok) {
      showToast('Nombre actualizado', 'success');
      cargarTurnosMedica();
    } else {
      showToast(data.error || 'Error actualizando nombre', 'error');
    }
  } catch (e) {
    showToast('Error actualizando nombre', 'error');
  }
}

async function guardarNumeroTurnoMedica() {
  if (!selectedTurnoMedica) {
    showToast('Selecciona un paciente primero', 'error');
    return;
  }
  const val = $('editTurnoNumeroMedica').value;
  const numero = parseInt(val, 10);
  if (!numero || numero < 1) {
    showToast('N├║mero de cita inv├ílido', 'error');
    return;
  }
  try {
    const res = await apiFetch(`/api/turnos/${selectedTurnoMedica.id}/numero`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ numero })
    });
    const data = await res.json();
    if (data.ok) {
      showToast('N├║mero de cita actualizado', 'success');
      cargarTurnosMedica();
    } else {
      showToast(data.error || 'Error actualizando cita', 'error');
    }
  } catch (e) {
    showToast('Error actualizando cita', 'error');
  }
}

async function crearTurnoMedica() {
  const nombresMedica = $('nuevoPacienteNombresMedica')?.value.trim() || '';
  const apellidosMedica = $('nuevoPacienteApellidosMedica')?.value.trim() || '';
  const nombre = [nombresMedica, apellidosMedica].filter(Boolean).join(' ');
  const doc = $('nuevoPacienteDocMedica').value.trim();
  const fecha = $('modalNuevaCitaFecha')?.value || $('agendaMedicaFecha').value;
  const doctorId = selectedDoctorId || ((currentUser?.rol === 'doctor' ? currentUser?.id : null));
  const hora = parseHora12a24($('nuevoTurnoHoraMedica')?.value || '');
  const telefono1 = $('nuevoPacienteTelefonoMedica')?.value.trim() || '';
  const telefono2 = $('nuevoPacienteTelefonoMedica2')?.value.trim() || '';
  const tipoConsulta = $('nuevoTurnoTipoMedica')?.value || '';
  const entidad = $('nuevoTurnoEntidadMedica')?.value || '';
  const notas = $('nuevoTurnoNotasMedica')?.value || '';
  const oportunidad = $('nuevoTurnoOportunidadMedica')?.value || '';

  // ========== VALIDACIONES ==========
  
  // 1. Validar campos obligatorios
  if (!nombresMedica) { showToast('Escribe los nombres del paciente', 'error'); return; }
  if (!apellidosMedica) { showToast('Escribe los apellidos del paciente', 'error'); return; }
  if (!hora) { showToast('Selecciona una hora', 'error'); $('nuevoTurnoHoraMedica')?.focus(); return; }
  if (!doc || !fecha || !doctorId || !entidad || !tipoConsulta) {
    showToast('Completa todos los campos obligatorios', 'error');
    return;
  }

  // 2. Validar nombre: m├¡nimo 3 caracteres
  if (nombre.length < 3) {
    showToast('El nombre debe tener al menos 3 caracteres', 'error');
    return;
  }

  // 3. Validar documento: solo n├║meros, 6-15 caracteres
  if (!/^\d{6,15}$/.test(doc)) {
    showToast('Documento inv├ílido. Solo n├║meros, 6-15 d├¡gitos', 'error');
    return;
  }

  // 4. Validar tel├®fono 1: exactamente 10 d├¡gitos
  if (!telefono1 || !/^\d{10}$/.test(telefono1)) {
    showToast('Tel├®fono 1 debe tener exactamente 10 d├¡gitos', 'error');
    $('nuevoPacienteTelefonoMedica')?.focus();
    return;
  }

  // 5. Validar tel├®fono 2: exactamente 10 d├¡gitos
  if (!telefono2 || !/^\d{10}$/.test(telefono2)) {
    showToast('Tel├®fono 2 debe tener exactamente 10 d├¡gitos', 'error');
    $('nuevoPacienteTelefonoMedica2')?.focus();
    return;
  }

  // 6. Tel├®fono 2 no puede ser igual al 1
  if (telefono1 === telefono2) {
    showToast('El Tel├®fono 2 no puede ser igual al Tel├®fono 1', 'error');
    $('nuevoPacienteTelefonoMedica2')?.focus();
    return;
  }

  try {
    // Validaci├│n r├ípida en cliente: si el d├¡a est├í marcado como NO ASISTE, no permitir crear.
    const dispRes = await apiFetch(`/api/doctor-disponibilidad?doctor_id=${doctorId}&fecha=${fecha}`);
    const dispData = await dispRes.json().catch(() => null);
    if (dispData?.ok && dispData.disponible_manana === false && dispData.disponible_tarde === false) {
      showToast('No se puede agendar: el doctor est├í marcado como no asistir├í ese d├¡a', 'error');
      return;
    }

    // Validaciones completadas - permitir m├║ltiples pacientes en la misma hora
    // (no hay validaci├│n de duplicados por hora, se permite hasta 20 pacientes)

    const body = {
      doctor_id: parseInt(doctorId, 10),
      paciente_nombre: nombre,
      paciente_documento: doc || null,
      paciente_telefono: telefono1,
      paciente_telefono2: telefono2,
      fecha,
      hora,
      tipo_consulta: tipoConsulta || null,
      entidad: entidad || null,
      notas: notas || null,
      oportunidad: oportunidad ? parseInt(oportunidad, 10) : null,
      programado_por: (currentUser && (currentUser.nombre || currentUser.usuario)) || null
    };

    const res = await apiFetch('/api/turnos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();

    if (data.ok) {
      showToast('Cita creada correctamente', 'success');
      $('modalNuevaCitaMedica')?.classList.add('hidden');
      $('nuevoPacienteNombresMedica').value = '';
      $('nuevoPacienteApellidosMedica').value = '';
      $('nuevoPacienteDocMedica').value = '';
      $('nuevoPacienteTelefonoMedica').value = '';
      $('nuevoPacienteTelefonoMedica2').value = '';
      $('nuevoTurnoNotasMedica').value = '';
      $('nuevoTurnoEntidadMedica').value = '';
      $('nuevoTurnoTipoMedica').value = '';
      cargarTurnosMedica();
    } else {
      showToast(data.error || 'Error al crear la cita', 'error');
    }
  } catch (e) {
    showToast('Error creando cita: ' + e.message, 'error');
    console.error(e);
  }
}

// ========== CARGAR PACIENTES DESDE EXCEL (Agenda M├®dica) ==========

function descargarPlantillaMedica() {
  const doctorId = selectedDoctorId || ((currentUser?.rol === 'doctor' ? currentUser?.id : null));
  const url = `/api/turnos/plantilla-excel${doctorId ? '?doctor_id=' + encodeURIComponent(doctorId) : ''}`;
  // Descargar del servidor (tiene dropdowns de entidad y tipo de consulta)
  apiFetch(url).then(res => {
    if (!res.ok) throw new Error('Error descargando plantilla');
    return res.blob();
  }).then(blob => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'plantilla_citas_medicas.xlsx';
    a.click();
    URL.revokeObjectURL(a.href);
  }).catch(e => {
    showToast('Error descargando plantilla: ' + e.message, 'error');
  });
}

function descargarPlantillaElectro() {
  apiFetch('/api/citas-electro/plantilla-excel').then(res => {
    if (!res.ok) throw new Error('Error descargando plantilla');
    return res.blob();
  }).then(blob => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'plantilla_estudios_electro.xlsx';
    a.click();
    URL.revokeObjectURL(a.href);
  }).catch(e => {
    showToast('Error descargando plantilla: ' + e.message, 'error');
  });
}
function splitNombreApellido(fullName) {
  const parts = (fullName || '').trim().split(/\s+/);
  if (parts.length <= 1) return { nombres: parts[0] || '', apellidos: '' };
  if (parts.length === 2) return { nombres: parts[0], apellidos: parts[1] };
  // 2+ partes: primeras mitad nombres, resto apellidos
  const mid = Math.ceil(parts.length / 2);
  return { nombres: parts.slice(0, mid).join(' '), apellidos: parts.slice(mid).join(' ') };
}

function encontrarColumnaExcel(headers, posibles) {
  const lower = headers.map(h => (h || '').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim());
  for (const p of posibles) {
    const pn = p.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const idx = lower.findIndex(h => h.includes(pn));
    if (idx >= 0) return headers[idx];
  }
  return null;
}

function excelDateToString(v) {
  if (!v) return '';
  if (typeof v === 'number') {
    // Serial date de Excel
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  // Intenta parsear dd/mm/yyyy o dd-mm-yyyy
  const match = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (match) return `${match[3]}-${match[2].padStart(2,'0')}-${match[1].padStart(2,'0')}`;
  // yyyy-mm-dd
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // Fecha textual en espa├▒ol: "Jueves: 02 de abril 2026" o "Viernes; 03 de abril de 2026"
  const mesesEs = { enero:1, febrero:2, marzo:3, abril:4, mayo:5, junio:6, julio:7, agosto:8, septiembre:9, octubre:10, noviembre:11, diciembre:12 };
  const matchEs = s.match(/(\d{1,2})\s+de\s+(\w+)\s+(?:de\s+)?(\d{4})/);
  if (matchEs) {
    const dia = matchEs[1].padStart(2, '0');
    const mes = mesesEs[matchEs[2].toLowerCase()];
    if (mes) return `${matchEs[3]}-${String(mes).padStart(2, '0')}-${dia}`;
  }
  return s;
}

function excelTimeToString(v) {
  if (!v) return '';
  if (typeof v === 'number') {
    // Fracci├│n de d├¡a
    const totalMin = Math.round(v * 24 * 60);
    const hh = String(Math.floor(totalMin / 60)).padStart(2, '0');
    const mm = String(totalMin % 60).padStart(2, '0');
    return `${hh}:${mm}`;
  }
  return String(v).trim();
}

function procesarExcelPacientesMedica(file) {
  const errorDiv = $('cargarPacientesMedicaError');
  const previewDiv = $('cargarPacientesMedicaPreview');
  const btnConfirm = $('btnConfirmarCargarPacientesMedica');
  errorDiv.style.display = 'none';
  previewDiv.style.display = 'none';
  btnConfirm.disabled = true;
  window._cargarPacientesMedicaData = null;

  if (!file) return;
  const reader = new FileReader();
  reader.onload = async function(e) {
    try {
      const workbook = XLSX.read(e.target.result, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet);
      if (!rows.length) { errorDiv.textContent = 'El archivo est├í vac├¡o'; errorDiv.style.display = 'block'; return; }

      const headers = Object.keys(rows[0]);
      const colFecha = encontrarColumnaExcel(headers, ['fecha', 'date']);
      const colHora = encontrarColumnaExcel(headers, ['hora', 'time', 'hour']);
      const colDoc = encontrarColumnaExcel(headers, ['documento', 'numero documento', 'num documento', 'cedula', 'identificacion', 'doc']);
      const colNombre = encontrarColumnaExcel(headers, ['nombres y apellidos', 'nombre', 'paciente', 'nombres', 'nombre completo']);
      const colEntidad = encontrarColumnaExcel(headers, ['entidad', 'eps', 'aseguradora']);
      const colTipo = encontrarColumnaExcel(headers, ['tipo de consulta', 'tipo consulta', 'consulta', 'tipo']);
      const colTel1 = encontrarColumnaExcel(headers, ['telefono1', 'telefono 1', 'tel1', 'tel 1', 'telefono', 'celular']);
      const colTel2 = encontrarColumnaExcel(headers, ['telefono2', 'telefono 2', 'tel2', 'tel 2']);
      const colNotas = encontrarColumnaExcel(headers, ['notas', 'nota', 'observaciones', 'observacion']);

      if (!colFecha || !colHora || !colDoc || !colNombre) {
        errorDiv.innerHTML = 'Columnas requeridas no encontradas. Se necesitan al menos: <strong>FECHA, HORA, DOCUMENTO, NOMBRES Y APELLIDOS</strong><br>Columnas encontradas: ' + headers.map(h => escapeHtml(h)).join(', ');
        errorDiv.style.display = 'block';
        return;
      }

      // Cargar opciones de entidad y tipo de consulta para dropdowns en preview
      let opcionesEntidad = [], opcionesTipo = [];
      try {
        const opcData = await apiFetch('/api/recibos/opciones').then(r => r.json()).catch(() => ({ entidades: [] }));
        opcionesEntidad = opcData.entidades || [];
      } catch (_) { console.warn('[cargarPacientesExcelData] Failed to load entity options'); }
      const doctorIdPlantilla = selectedDoctorId || ((currentUser?.rol === 'doctor' ? currentUser?.id : null));
      if (doctorIdPlantilla) {
        try {
          opcionesTipo = await apiFetch(`/api/tipos-consulta?medico_id=${encodeURIComponent(doctorIdPlantilla)}`).then(r => r.json()).catch(() => []);
        } catch (_) { console.warn('[cargarPacientesExcelData] Failed to load consultation types'); }
      }

      function crearSelectOpciones(opciones, valorActual, rowIdx, campo) {
        const normalizado = (valorActual || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        let optionsHtml = '<option value="">ÔÇö Seleccionar ÔÇö</option>';
        let encontrado = false;
        for (const opc of opciones) {
          const opcNorm = opc.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          const sel = (opcNorm === normalizado || opc === valorActual) ? ' selected' : '';
          if (sel) encontrado = true;
          optionsHtml += `<option value="${escapeHtml(opc)}"${sel}>${escapeHtml(opc)}</option>`;
        }
        // Si el valor del Excel no coincide con ninguna opci├│n, agregarlo como opci├│n extra
        if (valorActual && !encontrado) {
          optionsHtml += `<option value="${escapeHtml(valorActual)}" selected>${escapeHtml(valorActual)} ÔÜá´©Å</option>`;
        }
        return `<select data-row="${rowIdx}" data-campo="${campo}" style="width:100%;padding:4px 6px;border:1px solid #d1d5db;border-radius:6px;font-size:0.82rem">${optionsHtml}</select>`;
      }

      const parsed = [];
      const tbody = $('cargarPacientesMedicaBody');
      tbody.innerHTML = '';

      for (let ri = 0; ri < rows.length; ri++) {
        const row = rows[ri];
        const fecha = excelDateToString(row[colFecha]);
        const hora = excelTimeToString(row[colHora]);
        const documento = String(row[colDoc] || '').trim();
        const { nombres, apellidos } = splitNombreApellido(row[colNombre]);
        const entidad = colEntidad ? String(row[colEntidad] || '').trim() : '';
        const tipo = colTipo ? String(row[colTipo] || '').trim() : '';
        const tel1 = colTel1 ? String(row[colTel1] || '').replace(/\D/g, '') : '';
        const tel2 = colTel2 ? String(row[colTel2] || '').replace(/\D/g, '') : '';
        const notas = colNotas ? String(row[colNotas] || '').trim() : '';

        if (!fecha || !hora || !documento || !nombres) continue;

        parsed.push({ fecha, hora, documento, nombres, apellidos, entidad, tipo, tel1, tel2, notas });
        const idx = parsed.length - 1;
        const tr = document.createElement('tr');
        const entidadCell = opcionesEntidad.length ? crearSelectOpciones(opcionesEntidad, entidad, idx, 'entidad') : escapeHtml(entidad);
        const tipoCell = opcionesTipo.length ? crearSelectOpciones(opcionesTipo.map(t => t.nombre || t), tipo, idx, 'tipo') : escapeHtml(tipo);
        tr.innerHTML = `<td>${escapeHtml(fecha)}</td><td>${escapeHtml(hora)}</td><td>${escapeHtml(documento)}</td><td>${escapeHtml(nombres)}</td><td>${escapeHtml(apellidos)}</td><td>${entidadCell}</td><td>${tipoCell}</td><td>${escapeHtml(tel1)}</td><td>${escapeHtml(tel2)}</td><td>${escapeHtml(notas)}</td>`;
        tbody.appendChild(tr);
      }

      // Listeners para actualizar parsed cuando el usuario cambia un dropdown
      tbody.addEventListener('change', function(ev) {
        const sel = ev.target;
        if (sel.tagName !== 'SELECT') return;
        const ri = parseInt(sel.dataset.row, 10);
        const campo = sel.dataset.campo;
        if (!isNaN(ri) && window._cargarPacientesMedicaData && window._cargarPacientesMedicaData[ri]) {
          window._cargarPacientesMedicaData[ri][campo] = sel.value;
        }
      });

      if (!parsed.length) { errorDiv.textContent = 'No se encontraron filas v├ílidas con los datos requeridos'; errorDiv.style.display = 'block'; return; }

      $('cargarPacientesMedicaCount').textContent = parsed.length;
      previewDiv.style.display = 'block';
      btnConfirm.disabled = false;
      window._cargarPacientesMedicaData = parsed;
    } catch (err) {
      errorDiv.textContent = 'Error leyendo el archivo: ' + err.message;
      errorDiv.style.display = 'block';
    }
  };
  reader.readAsArrayBuffer(file);
}

async function confirmarCargarPacientesMedica() {
  const data = window._cargarPacientesMedicaData;
  if (!data || !data.length) return;

  const doctorId = selectedDoctorId;
  if (!doctorId) { showToast('No hay doctor seleccionado', 'error'); return; }

  const btn = $('btnConfirmarCargarPacientesMedica');
  setLoading(btn, true, 'Cargando...');
  const errorDiv = $('cargarPacientesMedicaError');
  errorDiv.style.display = 'none';

  let ok = 0, errores = [];
  for (let i = 0; i < data.length; i++) {
    const p = data[i];
    try {
      const body = {
        doctor_id: parseInt(doctorId, 10),
        paciente_nombre: [p.nombres, p.apellidos].filter(Boolean).join(' '),
        paciente_documento: p.documento || null,
        paciente_telefono: p.tel1 || null,
        paciente_telefono2: p.tel2 || null,
        fecha: p.fecha,
        hora: parseHora12a24(p.hora),
        tipo_consulta: p.tipo || null,
        entidad: p.entidad || null,
        notas: p.notas || null,
        programado_por: (currentUser && (currentUser.nombre || currentUser.usuario)) || 'Excel'
      };
      const res = await apiFetch('/api/turnos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await res.json();
      if (result.ok) ok++;
      else errores.push(`Fila ${i+1}: ${result.error || 'Error desconocido'}`);
    } catch (e) {
      errores.push(`Fila ${i+1}: ${e.message}`);
    }
  }

  setLoading(btn, false);

  if (ok > 0) {
    showToast(`${ok} cita(s) creada(s) correctamente`, 'success');
    cargarTurnosMedica();
  }
  if (errores.length) {
    errorDiv.innerHTML = `<strong>${errores.length} error(es):</strong><br>` + errores.slice(0, 10).join('<br>');
    errorDiv.style.display = 'block';
  } else {
    $('modalCargarPacientesMedica')?.classList.add('hidden');
  }
}

// ========== CARGAR PACIENTES DESDE EXCEL (Electrodiagn├│stico) ==========
async function procesarExcelPacientesElectro(file) {
  const errorDiv   = $('cargarPacientesElectroError');
  const previewDiv = $('cargarPacientesElectroPreview');
  const btnConfirm = $('btnConfirmarCargarPacientesElectro');
  errorDiv.style.display   = 'none';
  previewDiv.style.display = 'none';
  btnConfirm.disabled = true;
  window._cargarPacientesElectroData = null;
  if (!file) return;

  // 1. Cargar tipos de estudio para el dropdown
  let opcionesEstudio = [];
  // Cache de info de duraci├│n por estudio { [nombre]: { esVariable, duracion_minutos, duracion_min, duracion_max } }
  if (!window._duracionCacheElectro) window._duracionCacheElectro = {};
  const _duracionCache = window._duracionCacheElectro;
  try {
    const res = await apiFetch('/api/estudios/lista');
    const d = await res.json();
    opcionesEstudio = (Array.isArray(d) ? d : (d.registros || d.estudios || [])).map(e => e.nombre || e);
  } catch (_) { console.warn('[cargarPacientesElectro] Failed to load studies list'); }

  // Precargar duraci├│n de todos los estudios
  async function obtenerDuracionEstudio(nombre) {
    if (_duracionCache[nombre]) return _duracionCache[nombre];
    try {
      const res = await apiFetch(`/api/estudios/duracion?nombre=${encodeURIComponent(nombre)}`);
      const data = await res.json();
      if (data.ok) { _duracionCache[nombre] = data; return data; }
    } catch (_) { console.warn('[obtenerDuracionEstudio] Failed to fetch duration for:', nombre); }
    return null;
  }

  function crearCeldaDuracion(estudio, rowIdx) {
    // Se llena din├ímicamente despu├®s ÔÇö inicializar vac├¡o
    return `<td class="cell-duracion-${rowIdx}" style="min-width:80px"><span style="color:#6b7280;font-size:0.8rem">ÔÇö</span></td>`;
  }

  async function actualizarCeldaDuracion(rowIdx) {
    const allData = window._cargarPacientesElectroData;
    if (!allData || !allData[rowIdx]) return;
    const p = allData[rowIdx];
    const cell = document.querySelector(`.cell-duracion-${rowIdx}`);
    if (!cell) return;

    if (!p.estudio) {
      cell.innerHTML = '<span style="color:#6b7280;font-size:0.8rem">ÔÇö</span>';
      p.duracion_horas = null;
      return;
    }

    const info = await obtenerDuracionEstudio(p.estudio);
    if (!info) {
      cell.innerHTML = '<span style="color:#6b7280;font-size:0.8rem">ÔÇö</span>';
      p.duracion_horas = null;
      return;
    }

    if (info.esVariable) {
      const minH = Math.max(1, Math.round(info.duracion_min / 60));
      const maxH = Math.round(info.duracion_max / 60);
      cell.innerHTML = `<input type="number" data-row="${rowIdx}" data-campo="duracion" min="${minH}" max="${maxH}" step="0.5" placeholder="${minH}-${maxH}h" style="width:70px;padding:4px 6px;border:1px solid #d1d5db;border-radius:6px;font-size:0.82rem" value="${p.duracion_horas || ''}">`;
    } else {
      const horas = info.duracion_minutos ? (info.duracion_minutos / 60) : null;
      p.duracion_horas = horas;
      cell.innerHTML = horas ? `<span style="font-size:0.82rem;color:#374151">${horas}h</span>` : '<span style="color:#6b7280;font-size:0.8rem">ÔÇö</span>';
    }
  }

  function crearSelectEstudio(valorActual, rowIdx) {
    if (!opcionesEstudio.length) return escapeHtml(valorActual);
    const normalizado = (valorActual || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    let optHtml = '<option value="">ÔÇö Tipo de estudio ÔÇö</option>';
    let encontrado = false;
    for (const opc of opcionesEstudio) {
      const opcNorm = opc.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const sel = (opcNorm === normalizado || opc === valorActual) ? ' selected' : '';
      if (sel) encontrado = true;
      optHtml += `<option value="${escapeHtml(opc)}"${sel}>${escapeHtml(opc)}</option>`;
    }
    if (valorActual && !encontrado)
      optHtml += `<option value="${escapeHtml(valorActual)}" selected>${escapeHtml(valorActual)} ÔÜá´©Å</option>`;
    return `<select data-row="${rowIdx}" data-campo="estudio" style="width:100%;padding:4px 6px;border:1px solid #d1d5db;border-radius:6px;font-size:0.82rem">${optHtml}</select>`;
  }

  function crearInputDiagnostico(valorActual, rowIdx) {
    return `<div style="position:relative"><input type="text" data-row="${rowIdx}" data-campo="diagnostico" value="${escapeHtml(valorActual)}" placeholder="Buscar diagn├│stico..." autocomplete="off" style="width:100%;padding:4px 6px;border:1px solid #d1d5db;border-radius:6px;font-size:0.82rem"><div class="diag-suggestions-${rowIdx}" style="display:none;position:absolute;top:100%;left:0;right:0;z-index:100;background:#fff;border:1px solid #d1d5db;border-radius:0 0 6px 6px;max-height:150px;overflow-y:auto;box-shadow:0 4px 12px rgba(0,0,0,0.15)"></div></div>`;
  }

  async function validarDisponibilidadFila(ri) {
    const allData = window._cargarPacientesElectroData;
    if (!allData || !allData[ri]) return;
    const p = allData[ri];
    const cell = document.querySelector(`.cell-disp-${ri}`);
    if (!cell) return;
    if (!p.estudio || !p.fecha || !p.hora) {
      cell.innerHTML = '<span style="color:#6b7280;font-size:0.8rem">ÔÇö</span>';
      return;
    }
    cell.innerHTML = '<span style="color:#6b7280;font-size:0.8rem">ÔÅ│</span>';
    try {
      const params = new URLSearchParams({ fecha: p.fecha, hora: parseHora12a24(p.hora), estudio: p.estudio });
      // Si el estudio tiene duraci├│n variable, pasar la duraci├│n manual en minutos
      if (p.duracion_horas) {
        params.set('duracion_manual', Math.round(parseFloat(p.duracion_horas) * 60));
      }
      const res  = await apiFetch(`/api/equipos-electro/disponibilidad?${params}`);
      const info = await res.json();
      const cap  = info.capacidad || {};
      if (cap.hayDisponibilidad) {
        const cupos = cap.cuposaDisponibles ?? cap.cuposDisponibles ?? cap.cuposADisponibles ?? '';
        cell.innerHTML = `<span style="color:#16a34a;font-size:0.8rem" title="${cupos} cupo(s)">Ô£ô OK</span>`;
        p._equipoOk = true;
      } else {
        const prox = info.proximaDisponibilidad
          ? ` Pr├│x: ${escapeHtml(info.proximaDisponibilidad)}` : '';
        cell.innerHTML = `<span style="color:#dc2626;font-size:0.8rem" title="${escapeHtml(info.mensaje || 'Sin cupos')}">ÔÜá´©Å Sin cupo${prox ? '<br><small>' + prox + '</small>' : ''}</span>`;
        p._equipoOk = false;
      }
    } catch (_) {
      cell.innerHTML = '<span style="color:#6b7280;font-size:0.8rem" title="No se pudo verificar">? N/D</span>';
      p._equipoOk = null;
    }
  }

  function _parseDateTimeLocal(fecha, hora) {
    const h = parseHora12a24(hora || '') || hora || '00:00';
    return new Date(`${fecha}T${String(h).slice(0, 5)}:00`);
  }

  function _rangoSolapa(aInicio, aFin, bInicio, bFin) {
    return aInicio < bFin && aFin > bInicio;
  }

  async function validarDisponibilidadPreviewArchivo() {
    const allData = window._cargarPacientesElectroData;
    if (!Array.isArray(allData) || allData.length === 0) return;

    const reservasSimuladas = [];
    for (let ri = 0; ri < allData.length; ri++) {
      const p = allData[ri];
      const cell = document.querySelector(`.cell-disp-${ri}`);
      if (!cell || !p?.fecha || !p?.hora || !p?.estudio) continue;

      cell.innerHTML = '<span style="color:#6b7280;font-size:0.8rem">ÔÅ│</span>';
      try {
        const params = new URLSearchParams({ fecha: p.fecha, hora: parseHora12a24(p.hora), estudio: p.estudio });
        if (p.duracion_horas) params.set('duracion_manual', Math.round(parseFloat(p.duracion_horas) * 60));
        const res = await apiFetch(`/api/equipos-electro/disponibilidad?${params}`);
        const info = await res.json();
        const cap = info.capacidad || {};
        const cuposDisponiblesDb = cap.cuposaDisponibles ?? cap.cuposDisponibles ?? 0;
        const durMin = Number(info.duracionMinutos || 30);

        const inicio = _parseDateTimeLocal(p.fecha, p.hora);
        const fin = new Date(inicio.getTime() + (durMin * 60000));
        const choquesArchivo = reservasSimuladas.filter(r => _rangoSolapa(inicio, fin, r.inicio, r.fin)).length;
        const hayCupoReal = (cuposDisponiblesDb - choquesArchivo) > 0;

        if (hayCupoReal) {
          reservasSimuladas.push({ inicio, fin });
          cell.innerHTML = `<span style="color:#16a34a;font-size:0.8rem" title="Disponible considerando el archivo">Ô£ô OK</span>`;
          p._equipoOk = true;
        } else {
          cell.innerHTML = `<span style="color:#dc2626;font-size:0.8rem" title="Sin cupo real al cargar este archivo">ÔÜá´©Å Sin cupo</span>`;
          p._equipoOk = false;
        }
      } catch (_) {
        cell.innerHTML = '<span style="color:#6b7280;font-size:0.8rem" title="No se pudo verificar">? N/D</span>';
        p._equipoOk = null;
      }
    }
  }

  const reader = new FileReader();
  reader.onload = async function(ev) {
    try {
      const workbook = XLSX.read(ev.target.result, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows  = XLSX.utils.sheet_to_json(sheet);
      if (!rows.length) { errorDiv.textContent = 'El archivo est├í vac├¡o'; errorDiv.style.display = 'block'; return; }

      const headers  = Object.keys(rows[0]);
      const colFecha  = encontrarColumnaExcel(headers, ['fecha', 'date']);
      const colHora   = encontrarColumnaExcel(headers, ['hora', 'time', 'hour']);
      const colDoc    = encontrarColumnaExcel(headers, ['documento', 'numero documento', 'num documento', 'cedula', 'identificacion', 'doc']);
      const colNombre = encontrarColumnaExcel(headers, ['nombres y apellidos', 'nombre', 'paciente', 'nombres', 'nombre completo']);
      const colEstudio = encontrarColumnaExcel(headers, ['estudio', 'tipo estudio', 'examen']);
      const colEntidad = encontrarColumnaExcel(headers, ['entidad', 'eps', 'aseguradora']);
      const colDiag   = encontrarColumnaExcel(headers, ['diagnostico', 'dx', 'diag']);
      const colTel1   = encontrarColumnaExcel(headers, ['telefono1', 'telefono 1', 'tel1', 'tel 1', 'telefono', 'celular']);
      const colTel2   = encontrarColumnaExcel(headers, ['telefono2', 'telefono 2', 'tel2', 'tel 2']);

      if (!colFecha || !colHora || !colDoc || !colNombre) {
        errorDiv.innerHTML = 'Columnas requeridas no encontradas. Se necesitan: <strong>FECHA, HORA, DOCUMENTO, NOMBRES Y APELLIDOS</strong><br>Encontradas: ' + headers.map(h => escapeHtml(h)).join(', ');
        errorDiv.style.display = 'block';
        return;
      }

      const parsed = [];
      const tbody  = $('cargarPacientesElectroBody');
      tbody.innerHTML = '';

      for (let ri = 0; ri < rows.length; ri++) {
        const row = rows[ri];
        const fecha      = excelDateToString(row[colFecha]);
        const hora       = excelTimeToString(row[colHora]);
        const documento  = String(row[colDoc]    || '').trim();
        const { nombres, apellidos } = splitNombreApellido(row[colNombre]);
        const estudio    = colEstudio ? String(row[colEstudio] || '').trim() : '';
        const entidad    = colEntidad ? String(row[colEntidad] || '').trim() : '';
        const diagnostico = colDiag   ? String(row[colDiag]   || '').trim() : '';
        const tel1       = colTel1   ? String(row[colTel1]    || '').replace(/\D/g, '') : '';
        const tel2       = colTel2   ? String(row[colTel2]    || '').replace(/\D/g, '') : '';
        if (!fecha || !hora || !documento || !nombres) continue;

        parsed.push({ fecha, hora, documento, nombres, apellidos, estudio, entidad, diagnostico, diagnostico_id: null, tel1, tel2, _equipoOk: null, duracion_horas: null });
        const idx = parsed.length - 1;
        const tr  = document.createElement('tr');
        tr.dataset.rowIdx = idx;
        tr.innerHTML = `<td>${escapeHtml(fecha)}</td><td>${escapeHtml(hora)}</td><td>${escapeHtml(documento)}</td><td>${escapeHtml(nombres)}</td><td>${escapeHtml(apellidos)}</td><td>${crearSelectEstudio(estudio, idx)}</td>${crearCeldaDuracion(estudio, idx)}<td>${crearInputDiagnostico(diagnostico, idx)}</td><td>${escapeHtml(tel1)}</td><td>${escapeHtml(tel2)}</td><td class="cell-disp-${idx}"><span style="color:#6b7280;font-size:0.8rem">ÔÇö</span></td>`;
        tbody.appendChild(tr);
      }

      // Actualizar parsed + revalidar al cambiar dropdown
      tbody.addEventListener('change', async function(ev2) {
        const sel = ev2.target;
        if (sel.tagName === 'SELECT' && sel.dataset.campo === 'estudio') {
          const ri = parseInt(sel.dataset.row, 10);
          if (!isNaN(ri) && window._cargarPacientesElectroData?.[ri]) {
            window._cargarPacientesElectroData[ri].estudio = sel.value;
            window._cargarPacientesElectroData[ri].duracion_horas = null;
            await actualizarCeldaDuracion(ri);
            await validarDisponibilidadPreviewArchivo();
          }
        }
      });

      // Buscador de diagn├│sticos con debounce
      let _diagTimer = null;
      let _duracionTimer = null;
      tbody.addEventListener('input', function(ev2) {
        const inp = ev2.target;
        if (inp.tagName !== 'INPUT') return;
        
        // Handler para campo de duraci├│n
        if (inp.dataset.campo === 'duracion') {
          const ri = parseInt(inp.dataset.row, 10);
          if (isNaN(ri)) return;
          if (window._cargarPacientesElectroData?.[ri]) {
            const val = parseFloat(inp.value);
            window._cargarPacientesElectroData[ri].duracion_horas = isNaN(val) ? null : val;
          }
          // Revalidar disponibilidad con debounce
          clearTimeout(_duracionTimer);
          _duracionTimer = setTimeout(async () => {
            await validarDisponibilidadPreviewArchivo();
          }, 500);
          return;
        }
        
        if (inp.dataset.campo !== 'diagnostico') return;
        const ri = parseInt(inp.dataset.row, 10);
        if (isNaN(ri)) return;
        if (window._cargarPacientesElectroData?.[ri]) {
          window._cargarPacientesElectroData[ri].diagnostico = inp.value;
          window._cargarPacientesElectroData[ri].diagnostico_id = null;
        }
        clearTimeout(_diagTimer);
        _diagTimer = setTimeout(async () => {
          const q = inp.value.trim();
          const sugDiv = tbody.querySelector(`.diag-suggestions-${ri}`);
          if (!sugDiv) return;
          if (q.length < 2) { sugDiv.style.display = 'none'; sugDiv.innerHTML = ''; return; }
          try {
            const res = await apiFetch(`/api/diagnosticos/search?q=${encodeURIComponent(q)}`);
            const diags = await res.json();
            if (!diags.length) { sugDiv.style.display = 'none'; sugDiv.innerHTML = ''; return; }
            sugDiv.innerHTML = diags.map(d => {
              const label = d.codigo ? `[${escapeHtml(d.codigo)}] ${escapeHtml(d.nombre)}` : escapeHtml(d.nombre);
              return `<div data-id="${d.id}" data-nombre="${escapeHtml(d.nombre)}" data-codigo="${escapeHtml(d.codigo || '')}" style="padding:6px 10px;cursor:pointer;font-size:0.82rem;border-bottom:1px solid #f0f0f0" onmouseover="this.style.background='#e0edff'" onmouseout="this.style.background='#fff'">${label}</div>`;
            }).join('');
            sugDiv.style.display = 'block';
          } catch (_) { sugDiv.style.display = 'none'; }
        }, 300);
      });

      // Seleccionar diagn├│stico de las sugerencias
      tbody.addEventListener('click', function(ev2) {
        const item = ev2.target.closest('[data-id]');
        if (!item || !item.closest('[class^="diag-suggestions-"]')) return;
        const sugDiv = item.parentElement;
        const className = sugDiv.className;
        const riMatch = className.match(/diag-suggestions-(\d+)/);
        if (!riMatch) return;
        const ri = parseInt(riMatch[1], 10);
        const inp = tbody.querySelector(`input[data-row="${ri}"][data-campo="diagnostico"]`);
        if (!inp) return;
        const diagId = parseInt(item.dataset.id, 10);
        const codigo = item.dataset.codigo || '';
        const nombre = item.dataset.nombre || '';
        inp.value = codigo ? `[${codigo}] ${nombre}` : nombre;
        if (window._cargarPacientesElectroData?.[ri]) {
          window._cargarPacientesElectroData[ri].diagnostico = inp.value;
          window._cargarPacientesElectroData[ri].diagnostico_id = diagId;
        }
        sugDiv.style.display = 'none';
      });

      // Cerrar sugerencias al hacer clic fuera
      document.addEventListener('click', function(ev2) {
        if (!ev2.target.closest('[data-campo="diagnostico"]') && !ev2.target.closest('[class^="diag-suggestions-"]')) {
          tbody.querySelectorAll('[class^="diag-suggestions-"]').forEach(d => d.style.display = 'none');
        }
      });

      if (!parsed.length) {
        errorDiv.textContent = 'No se encontraron filas v├ílidas con los datos requeridos';
        errorDiv.style.display = 'block';
        return;
      }

      $('cargarPacientesElectroCount').textContent = parsed.length;
      previewDiv.style.display = 'block';
      btnConfirm.disabled = false;
      window._cargarPacientesElectroData = parsed;

      // 2. Auto-buscar diagn├│sticos del Excel para pre-asignar ID
      await Promise.all(parsed.map(async (p, ri) => {
        if (!p.diagnostico || p.diagnostico.length < 2) return;
        try {
          const res = await apiFetch(`/api/diagnosticos/search?q=${encodeURIComponent(p.diagnostico)}`);
          const diags = await res.json();
          if (diags.length > 0) {
            const exact = diags.find(d => d.nombre.toLowerCase() === p.diagnostico.toLowerCase() || d.codigo === p.diagnostico);
            const match = exact || diags[0];
            p.diagnostico_id = match.id;
            const label = match.codigo ? `[${match.codigo}] ${match.nombre}` : match.nombre;
            p.diagnostico = label;
            const inp = tbody.querySelector(`input[data-row="${ri}"][data-campo="diagnostico"]`);
            if (inp) inp.value = label;
          }
        } catch (_) { console.warn('[cargarPacientesExcelData] Failed to search diagnostico:', p.diagnostico); }
      }));

      // 2.5. Actualizar celdas de duraci├│n (muestra input para estudios variables)
      await Promise.all(parsed.map((_, ri) => actualizarCeldaDuracion(ri)));

      // 3. Validar disponibilidad de equipos en paralelo
      await validarDisponibilidadPreviewArchivo();

    } catch (err) {
      errorDiv.textContent = 'Error leyendo el archivo: ' + err.message;
      errorDiv.style.display = 'block';
    }
  };
  reader.readAsArrayBuffer(file);
}

async function confirmarCargarPacientesElectro() {
  const data = window._cargarPacientesElectroData;
  if (!data || !data.length) return;

  const btn = $('btnConfirmarCargarPacientesElectro');
  setLoading(btn, true, 'Cargando...');
  const errorDiv = $('cargarPacientesElectroError');
  errorDiv.style.display = 'none';

  let ok = 0, errores = [];
  for (let i = 0; i < data.length; i++) {
    const p = data[i];
    
    // Validar duraci├│n requerida para estudios variables
    const durInfo = window._duracionCacheElectro?.[p.estudio];
    if (durInfo && durInfo.esVariable && !p.duracion_horas) {
      errores.push(`Fila ${i+1}: Duraci├│n requerida para "${p.estudio}"`);
      continue;
    }
    
    try {
      const nombre = [p.nombres, p.apellidos].filter(Boolean).join(' ');
      // Crear paciente primero
      const resP = await apiFetch('/api/pacientes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre, documento: p.documento || null, telefono: p.tel1 || null, telefono2: p.tel2 || null }) });
      const dataP = await resP.json();
      if (!dataP.ok && !dataP.id) { errores.push(`Fila ${i+1}: Error creando paciente`); continue; }
      const pacienteId = dataP.id;

      // Calcular duraci├│n en minutos
      let duracionMinutos = null;
      if (p.duracion_horas) {
        duracionMinutos = Math.round(parseFloat(p.duracion_horas) * 60);
      } else if (durInfo && durInfo.duracion_minutos) {
        duracionMinutos = durInfo.duracion_minutos;
      }

      const body = {
        paciente_id: pacienteId,
        fecha: p.fecha,
        hora: parseHora12a24(p.hora),
        telefono: p.tel1 || null,
        telefono2: p.tel2 || null,
        estudio: p.estudio || 'PSG B├ísica',
        entidad: p.entidad || null,
        diagnostico_id: p.diagnostico_id || null,
        estado: 'Programado',
        programado_por_nombre: (currentUser ? (currentUser.nombre || currentUser.usuario) : 'Excel')
      };
      if (duracionMinutos) body.duracion = duracionMinutos;

      const res = await apiFetch('/api/citas-electro', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await res.json();
      if (result.ok) ok++;
      else errores.push(`Fila ${i+1}: ${result.error || 'Error desconocido'}`);
    } catch (e) {
      errores.push(`Fila ${i+1}: ${e.message}`);
    }
  }

  setLoading(btn, false);

  if (ok > 0) {
    showToast(`${ok} estudio(s) creado(s) correctamente`, 'success');
    cargarCitasElectro();
  }
  if (errores.length) {
    errorDiv.innerHTML = `<strong>${errores.length} error(es):</strong><br>` + errores.slice(0, 10).join('<br>');
    errorDiv.style.display = 'block';
  } else {
    $('modalCargarPacientesElectro')?.classList.add('hidden');
  }
}

async function cargarUcqn() {
  const desde = $('ucqnFechaDesde')?.value || '';
  const hasta = $('ucqnFechaHasta')?.value || '';
  const estado = $('ucqnEstadoFiltro')?.value || '';
  const params = new URLSearchParams();
  if (desde) params.set('fecha_desde', desde);
  if (hasta) params.set('fecha_hasta', hasta);
  if (estado) params.set('estado', estado);
  const res = await apiFetch(`/api/ucqn/estudios?${params.toString()}`);
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || 'Error cargando UCQN');
  const body = $('ucqnTableBody');
  if (!body) return;
  const canEdit = tienePermiso('ucqn.editar_estado') || tienePermiso('electro.editar');
  const regs = Array.isArray(data.registros) ? data.registros : [];
  if (!regs.length) {
    body.innerHTML = '<tr><td colspan="8" style="padding:20px;text-align:center;color:#999">Sin estudios UCQN</td></tr>';
    return;
  }
  body.innerHTML = regs.map(r => `
    <tr>
      <td>${escapeHtml(r.fecha_estudio || '-')}</td>
      <td>${escapeHtml((r.hora_estudio || '').substring(0,5) || '-')}</td>
      <td>${escapeHtml(r.paciente_nombres || '-')}</td>
      <td>${escapeHtml(r.paciente_apellidos || '-')}</td>
      <td>${escapeHtml(r.paciente_documento || '-')}</td>
      <td>${escapeHtml(r.tipo_estudio || '-')}</td>
      <td>${escapeHtml(r.entidad || '-')}</td>
      <td>
        <span class="estado-badge-ucqn estado-${String(r.estado || '').toLowerCase()}">${escapeHtml(r.estado || '-')}</span>
        ${canEdit ? (
          r.estado === 'PENDIENTE'
            ? `<button class="btn-primary btn-ucqn-estado" data-ucqn-id="${r.id}" data-next-estado="LEIDO" style="margin-left:8px;padding:4px 10px;font-size:0.78rem">Marcar le├¡do</button>`
            : r.estado === 'LEIDO'
              ? `<button class="btn-primary btn-ucqn-estado" data-ucqn-id="${r.id}" data-next-estado="FACTURADO" style="margin-left:8px;padding:4px 10px;font-size:0.78rem">Facturar</button>`
              : ''
        ) : ''}
      </td>
    </tr>
  `).join('');
}

async function initUcqn() {
  if ($('ucqnFechaDesde')) $('ucqnFechaDesde').value = '';
  if ($('ucqnFechaHasta')) $('ucqnFechaHasta').value = '';
  if ($('ucqnEstadoFiltro')) $('ucqnEstadoFiltro').value = '';
  const btnBuscarUcqn = $('btnUcqnBuscar');
  if (btnBuscarUcqn) btnBuscarUcqn.onclick = async () => {
    try { await cargarUcqn(); } catch (e) { showToast('Error UCQN: ' + e.message, 'error'); }
  };
  const bodyUcqn = $('ucqnTableBody');
  if (bodyUcqn) bodyUcqn.onclick = async (ev) => {
    const sel = ev.target;
    if (!sel || !sel.matches('.btn-ucqn-estado')) return;
    const id = parseInt(sel.dataset.ucqnId, 10);
    const estado = sel.dataset.nextEstado;
    try {
      const res = await apiFetch(`/api/ucqn/estudios/${id}/estado`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo actualizar estado');
      showToast('Estado UCQN actualizado', 'success');
      await cargarUcqn();
    } catch (e) {
      showToast(e.message, 'error');
      await cargarUcqn();
    }
  };
  try { await cargarUcqn(); } catch (e) { showToast('Error UCQN: ' + e.message, 'error'); }
}

// ========== DASHBOARD (Admin solo) ==========
// ========== AGENDA ELECTRODIAGN├ôSTICO =========
async function initElectro() {
  const hoy = hoyColombiaISO();
  $('electroFecha').value = hoy;
  
  // Cargar estudios desde BD para el select y las pesta├▒as
  await cargarEstudiosEnSelect('electroEstudio');
  generarTabsElectro(_estudiosCache || []);
  
  // Cargar entidades desde BD para pacientes en espera
  await cargarEntidadesEnSelect('esperaEntidad');
  await cargarEntidadesEnSelect('electroEntidad');
  
  // Generar intervalos de hora (texto libre con formato HH:MM AM/PM)
  // No se genera select, el usuario escribe la hora directamente
  
  // Mostrar usuario actual que programar├í
  if (currentUser) {
    $('electroProgramadoPor').textContent = currentUser.nombre || currentUser.usuario || '-';
  }
  
  // Cargar equipos SOLO para el modal (para seleccionar despu├®s)
  try {
    const res = await apiFetch('/api/equipos-electro');
    const equipos = await res.json();
    const equipoSelect = $('modalEquipo');
    equipoSelect.innerHTML = '<option value="">Seleccionar equipo</option>';
    equipos.forEach(e => {
      const opt = document.createElement('option');
      opt.value = e.id;
      opt.textContent = e.nombre;
      // Si el equipo est├í en uso (En Estudio), deshabilitarlo
      if (e.en_uso) {
        opt.disabled = true;
        opt.textContent += ' (En uso)';
      }
      equipoSelect.appendChild(opt);
    });
  } catch (e) {
    console.error('Error cargando equipos para modal:', e);
  }
  
  // Event listener para cambiar fecha y cargar citas autom├íticamente
  if ($('electroFecha')) $('electroFecha').onchange = async () => {
    await cargarCitasElectro();
    await checkEquiposDisponibilidad();
  };
  if ($('btnElectroFechaPrev')) $('btnElectroFechaPrev').onclick = async () => {
    const base = $('electroFecha')?.value || hoyColombiaISO();
    const d = new Date(`${base}T12:00:00`);
    d.setDate(d.getDate() - 1);
    const next = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    $('electroFecha').value = next;
    await cargarCitasElectro();
    await checkEquiposDisponibilidad();
  };
  if ($('btnElectroFechaNext')) $('btnElectroFechaNext').onclick = async () => {
    const base = $('electroFecha')?.value || hoyColombiaISO();
    const d = new Date(`${base}T12:00:00`);
    d.setDate(d.getDate() + 1);
    const next = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    $('electroFecha').value = next;
    await cargarCitasElectro();
    await checkEquiposDisponibilidad();
  };
  
  // Event listener para quitar el border rojo cuando se selecciona estudio y auto-completar duraci├│n
  $('electroEstudio')?.addEventListener('change', async (e) => {
    if (e.target.value) {
      e.target.style.borderColor = '';
      
      // Obtener duraci├│n del estudio
      try {
        const res = await apiFetch(`/api/estudios/duracion?nombre=${encodeURIComponent(e.target.value)}`);
        const data = await res.json();
        
        const duracionCol = $('electroDuracionCol');
        const durationInput = $('electroDuracion');
        
        if (data.ok) {
          if (data.esVariable) {
            // Estudio variable: mostrar campo para que usuario ingrese duraci├│n en HORAS
            duracionCol.style.display = '';
            durationInput.value = '';
            durationInput.min = Math.round(data.duracion_min / 60);  // Convertir a horas
            durationInput.max = Math.round(data.duracion_max / 60);  // Convertir a horas
            durationInput.placeholder = `ÔÜá´©Å REQUERIDO: Duraci├│n (${Math.round(data.duracion_min / 60)}-${Math.round(data.duracion_max / 60)} horas)`;
            durationInput.style.borderColor = ''; // Reset any previous error
            selectedEstudioDuracion = null; // No hay duraci├│n predeterminada
          } else {
            // Estudio fijo: guardar duraci├│n y ocultarla
            duracionCol.style.display = 'none';
            durationInput.value = '';
            selectedEstudioDuracion = data.duracion_minutos; // Guardar duraci├│n en minutos
          }
        } else if (esMonitorizacionVideoRadio(e.target.value)) {
          // Fallback: este estudio siempre debe pedir duraci├│n manual.
          duracionCol.style.display = '';
          durationInput.value = '';
          durationInput.min = 1;
          durationInput.max = 168;
          durationInput.placeholder = 'ÔÜá´©Å REQUERIDO: Duraci├│n (1-168 horas)';
          durationInput.style.borderColor = '';
          selectedEstudioDuracion = null;
        }
      } catch (e) {
        console.error('Error obteniendo duraci├│n:', e);
        if (esMonitorizacionVideoRadio(e.target.value)) {
          duracionCol.style.display = '';
          durationInput.value = '';
          durationInput.min = 1;
          durationInput.max = 168;
          durationInput.placeholder = 'ÔÜá´©Å REQUERIDO: Duraci├│n (1-168 horas)';
          durationInput.style.borderColor = '';
          selectedEstudioDuracion = null;
        } else {
          duracionCol.style.display = 'none';
          durationInput.value = '';
          selectedEstudioDuracion = null;
        }
      }
    }
    await checkEquiposDisponibilidad();
  });

  // Event listener para cambio en hora (type=time dispara 'change' al completar la selecci├│n)
  const _onElectroHoraChange = async () => {
    const v = $('electroHora').value;
    if (v) await checkEquiposDisponibilidad();
  };
  $('electroHora')?.addEventListener('change', _onElectroHoraChange);
  $('electroHora')?.addEventListener('input', _onElectroHoraChange);

  // Event listener para cambio en duraci├│n
  $('electroDuracion')?.addEventListener('change', async () => {
    await checkEquiposDisponibilidad();
  });
  
  // Event listener para autocompletado de diagn├│sticos (b├║squeda din├ímica, sin opciones iniciales)
  $('electroDiagnostico')?.addEventListener('input', debounce(buscarDiagnosticosElectro, 300));
  
  // Validadores en tiempo real
  // Nombre: Solo letras y espacios
  const _sanitizarNombreElectro = (e) => {
    const valor = e.target.value;
    if (valor && !/^[a-zA-Z├í├®├¡├│├║├ü├ë├ì├ô├Ü├▒├æ\s]*$/.test(valor)) {
      e.target.value = valor.replace(/[^a-zA-Z├í├®├¡├│├║├ü├ë├ì├ô├Ü├▒├æ\s]/g, '');
    }
    e.target.style.borderColor = '';
  };
  $('electroPacienteNombres')?.addEventListener('input', _sanitizarNombreElectro);
  $('electroPacienteApellidos')?.addEventListener('input', _sanitizarNombreElectro);
  
  // Documento: Solo n├║meros + buscar paciente
  $('electroDocumento')?.addEventListener('input', debounce((e) => {
    const valor = e.target.value;
    if (valor && !/^\d*$/.test(valor)) {
      // Remover caracteres no num├®ricos
      e.target.value = valor.replace(/\D/g, '');
    }
    // Buscar paciente por documento
    buscarPacientePorDocumento();
  }, 300));
  
  // Tel├®fono: Solo n├║meros, m├íximo 10 d├¡gitos
  const limitarTel = (e) => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 10);
  };
  $('electroTelefono')?.addEventListener('input', limitarTel);
  $('electroTelefono2')?.addEventListener('input', limitarTel);

  // tecnico_electro y doctor NO pueden crear citas
  const canCreateElectro = tienePermiso('electro.crear');

  // Bot├│n "Nuevo Estudio" y modal
  const btnNuevoEstudio = $('btnNuevoEstudioElectro');
  if (btnNuevoEstudio) btnNuevoEstudio.style.display = canCreateElectro ? 'inline-flex' : 'none';
  if (canCreateElectro) {
    btnNuevoEstudio?.addEventListener('click', () => {
      const fecha = $('electroFecha')?.value;
      const fechaInput = $('modalNuevoEstudioFecha');
      if (fechaInput) fechaInput.value = fecha || hoyColombiaISO();
      const progEl = $('electroProgramadoPor');
      if (progEl) progEl.textContent = currentUser ? (currentUser.nombre || currentUser.usuario || '-') : '-';
      checkEquiposDisponibilidad();
      $('modalNuevoEstudioElectro')?.classList.remove('hidden');
    });
    if ($('modalNuevoEstudioFecha')) $('modalNuevoEstudioFecha').onchange = checkEquiposDisponibilidad;
    $('btnCerrarNuevoEstudioModal')?.addEventListener('click', () => $('modalNuevoEstudioElectro')?.classList.add('hidden'));
    $('btnCancelarNuevoEstudioModal')?.addEventListener('click', () => $('modalNuevoEstudioElectro')?.classList.add('hidden'));
    $('crearCitaElectro')?.addEventListener('click', crearCitaElectro);
  }

  // Ocultar "Pacientes en Espera" para tecnico_electro y doctor
  const esperaBtnSidebar = document.querySelector('#view-electro .electro-page-btn[data-page="espera"]');
  if (esperaBtnSidebar && !tienePermiso('electro.crear')) {
    esperaBtnSidebar.style.display = 'none';
  }

  // Bot├│n aviso al doctor en m├│dulo electro (para admin_electro y tecnico_electro)
  const canAvisarElectro = tienePermiso('electro.aviso_doctor');
  const avisoBtnElectro = $('btnAvisarDoctorElectro');
  if (avisoBtnElectro) {
    avisoBtnElectro.style.display = canAvisarElectro ? 'inline-flex' : 'none';
    if (canAvisarElectro) {
      avisoBtnElectro.addEventListener('click', () => avisoDoctor(null));
    }
  }

  // Event listeners del modal
  $('cerrarModalDetallesCita')?.addEventListener('click', cerrarModalDetallesCita);
  $('btnCancelarModal')?.addEventListener('click', cerrarModalDetallesCita);
  $('btnGuardarCambios')?.addEventListener('click', guardarCambiosCitaElectro);
  $('btnIniciarEstudio')?.addEventListener('click', iniciarEstudioModal);
  $('btnFinalizarEstudio')?.addEventListener('click', finalizarEstudioModal);
  
  // Event listeners para cambios en el modal (equipo y estado)
  const modalEquipoEl = $('modalEquipo');
  if (modalEquipoEl && !modalEquipoEl.dataset.boundChange) modalEquipoEl.addEventListener('change', async (e) => {
    if (!citaElectroSeleccionada) return;
    
    // No procesar cambios si estamos inicializando el modal
    if (isInitializingElectroModal) {
      return;
    }
    
    const nuevoEquipoId = e.target.value;
    const equipoIdActual = citaElectroSeleccionada.equipo_id || '';
    const estadoActual = citaElectroSeleccionada.estado || '';

    if (estadoActual === 'En Estudio' || estadoActual === 'Pausado') {
      showToast('No puedes cambiar el equipo mientras el estudio est├í activo', 'error');
      e.target.value = equipoIdActual;
      return;
    }
    
    // Si el equipo no cambi├│, no hacer nada
    if (String(nuevoEquipoId) === String(equipoIdActual)) return;
    
    try {
      const cambios = { equipo_id: nuevoEquipoId ? parseInt(nuevoEquipoId) : null };
      
      const res = await apiFetch(`/api/citas-electro/${citaElectroSeleccionada.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cambios)
      });
      
      const data = await res.json();
      
      if (data && data.ok) {
        const equipoName = e.target.options[e.target.selectedIndex].text;
        showToast(`Equipo actualizado a "${equipoName}"`, 'success');
        
        // Actualizar el objeto de la cita
        citaElectroSeleccionada.equipo_id = nuevoEquipoId ? parseInt(nuevoEquipoId) : null;
        
        // Emitir socket
        if (window.socket && window.socket.connected) {
          window.socket.emit('electro:cambios-guardados', {
            id: citaElectroSeleccionada.id,
            cambios
          });
        }
        
        // Cargar citas para reflejar el cambio en la tabla
        cargarCitasElectro();
      } else {
        showToast(data?.error || 'Error actualizando equipo', 'error');
        // Revertir el cambio en el UI
        e.target.value = equipoIdActual;
      }
    } catch (error) {
      console.error('[MODAL_EQUIPO_CHANGE] Error:', error);
      showToast('Error actualizando equipo', 'error');
      e.target.value = equipoIdActual;
    }
  });
  if (modalEquipoEl) modalEquipoEl.dataset.boundChange = '1';
  const modalEstadoEl = $('modalEstado');
  if (modalEstadoEl && !modalEstadoEl.dataset.boundChange) modalEstadoEl.addEventListener('change', async (e) => {
  if (!citaElectroSeleccionada) return;
    // Estado se controla solo con botones de flujo. Ignorar este listener.
    return;
    
    // No procesar cambios si estamos inicializando el modal
    if (isInitializingElectroModal) {
      console.log('[MODAL_ESTADO_CHANGE] Ignorando cambio durante inicializaci├│n del modal');
      return;
    }
    
    const nuevoEstado = e.target.value;
    console.log('[MODAL_ESTADO_CHANGE] Cambio de estado a:', nuevoEstado);
    
    try {
      const cambios = { estado: nuevoEstado };
      
      const res = await apiFetch(`/api/citas-electro/${citaElectroSeleccionada.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cambios)
      });
      
      const data = await res.json();
      
      if (data && data.ok) {
        showToast(`Estado actualizado a "${nuevoEstado}"`, 'success');
        
        // Actualizar el objeto de la cita
        citaElectroSeleccionada.estado = nuevoEstado;
        
        // Si el estado es "En Sala" o "En Estudio", desabilitar el select
        if (nuevoEstado === 'En Sala' || nuevoEstado === 'En Estudio') {
          e.target.disabled = true;
          e.target.style.opacity = '0.5';
          e.target.style.cursor = 'not-allowed';
          console.log('[MODAL_ESTADO_CHANGE] Select deshabilitado - estado "' + nuevoEstado + '"');
        } else {
          e.target.disabled = false;
          e.target.style.opacity = '1';
          e.target.style.cursor = 'pointer';
          console.log('[MODAL_ESTADO_CHANGE] Select habilitado');
        }
        
        // Emitir socket
        if (window.socket && window.socket.connected) {
          window.socket.emit('electro:cambios-guardados', {
            id: citaElectroSeleccionada.id,
            cambios
          });
        }
        
        cargarCitasElectro();
      } else {
        showToast(data?.error || 'Error actualizando estado', 'error');
        // Revertir el cambio en el UI
        e.target.value = citaElectroSeleccionada.estado;
      }
    } catch (error) {
      console.error('[MODAL_ESTADO_CHANGE] Error:', error);
      showToast('Error actualizando estado', 'error');
      e.target.value = citaElectroSeleccionada.estado;
    }
  });
  if (modalEstadoEl) modalEstadoEl.dataset.boundChange = '1';
  $('btnEnviarRecomendaciones')?.addEventListener('click', () => {
    if (citaElectroSeleccionada) enviarRecomendacionesWhatsApp(citaElectroSeleccionada);
  });

  // Editar datos del paciente
  const btnEditarPaciente = $('btnEditarPacienteModal');
  const editPanel = $('editarPacientePanel');
  if (btnEditarPaciente && editPanel) {
    btnEditarPaciente.onclick = () => {
      const abierto = editPanel.style.display !== 'none';
      if (abierto) {
        editPanel.style.display = 'none';
      } else {
        $('editNombrePaciente').value = citaElectroSeleccionada?.paciente_nombre || '';
        $('editDocumentoPaciente').value = citaElectroSeleccionada?.paciente_documento || '';
        $('editTelefonoPaciente').value = citaElectroSeleccionada?.telefono || '';
        editPanel.style.display = 'block';
      }
    };
    $('btnCancelarEditarPaciente').onclick = () => { editPanel.style.display = 'none'; };
    $('btnGuardarEditarPaciente').onclick = () => guardarEdicionPaciente();
    // Solo d├¡gitos y max 10 en el tel├®fono del panel de edici├│n
    $('editTelefonoPaciente').addEventListener('input', (e) => {
      e.target.value = e.target.value.replace(/\D/g, '').slice(0, 10);
    });
  }
  $('btnEliminarCita')?.addEventListener('click', () => {
    if (!citaElectroSeleccionada) return;
    const nombre = (citaElectroSeleccionada.paciente_nombre || '').trim() || 'este paciente';
    $('modalEliminarNombrePaciente').textContent = nombre;
    const m = $('modalConfirmarEliminarCita');
    m.classList.remove('hidden');
    m.style.display = 'flex';
  });
  $('btnConfirmarEliminarCita')?.addEventListener('click', async () => {
    $('modalConfirmarEliminarCita').classList.add('hidden');
    await eliminarCitaElectro();
  });
  $('btnCancelarEliminarCita')?.addEventListener('click', () => {
    $('modalConfirmarEliminarCita').classList.add('hidden');
  });

  // Event listeners para modales de reprogramaci├│n y adelanto
  const btnConfRep = $('btnConfirmarReprogramar');
  const btnCancelRep = $('btnCancelarReprogramar');
  const cerrarRep = $('cerrarModalReprogramar');
  const btnConfAde = $('btnConfirmarAdelantarCita');
  const btnCancelAde = $('btnCancelarAdelantarCita');
  const cerrarAde = $('cerrarModalAdelantarCita');
  
  if (cerrarRep) cerrarRep.addEventListener('click', cerrarModalReprogramar);
  if (btnCancelRep) btnCancelRep.addEventListener('click', cerrarModalReprogramar);
  if (btnConfRep) btnConfRep.addEventListener('click', confirmarReprogramar);
  
  if (cerrarAde) cerrarAde.addEventListener('click', cerrarModalAdelantarCita);
  if (btnCancelAde) btnCancelAde.addEventListener('click', cerrarModalAdelantarCita);
  if (btnConfAde) btnConfAde.addEventListener('click', confirmarAdelantarCita);
  $('btnConfirmarAdelantarCita')?.addEventListener('click', confirmarAdelantarCita);
  
  // Cerrar modales con tecla Escape
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('modalDetallesCitaElectro').classList.contains('hidden')) {
      cerrarModalDetallesCita(); return;
    }
    const confirmEl = $('modalConfirmarEliminarCita');
    if (confirmEl && !confirmEl.classList.contains('hidden')) {
      confirmEl.classList.add('hidden'); return;
    }
    const buscarCitasEl = $('buscarCitaResultadosSection');
    if (buscarCitasEl && buscarCitasEl.style.display !== 'none') {
      buscarCitasEl.style.display = 'none'; return;
    }
    const buscarEstudiosEl = $('buscarEstudioResultadosSection');
    if (buscarEstudiosEl && buscarEstudiosEl.style.display !== 'none') {
      buscarEstudiosEl.style.display = 'none'; return;
    }
  });

  // Las pesta├▒as de estudios se generan din├ímicamente en generarTabsElectro() con sus propios event listeners

  // Configurar listeners de socket para ver cambios en tiempo real
  if (window.socket && !window.socketElectroListenerAdded) {
    window.socket.on('electro:actualizar-lista', () => {
      cargarCitasElectro();
    });
    window.socket.on('electro:nueva-cita', () => {
      cargarCitasElectro();
    });
    window.socket.on('electro:cita-cambio-estado', () => {
      cargarCitasElectro();
    });
    window.socket.on('electro:cita-removida', () => {
      cargarCitasElectro();
    });
    window.socketElectroListenerAdded = true;
  }

  // Bot├│n "Cargar Pacientes" (solo admin_electro, admin, recepcion)
  const btnCargarPacElectro = $('btnCargarPacientesElectro');
  if (btnCargarPacElectro && canCreateElectro) {
    btnCargarPacElectro.style.display = '';
    btnCargarPacElectro.addEventListener('click', () => {
      $('cargarPacientesElectroFile').value = '';
      $('cargarPacientesElectroPreview').style.display = 'none';
      $('cargarPacientesElectroError').style.display = 'none';
      $('btnConfirmarCargarPacientesElectro').disabled = true;
      window._cargarPacientesElectroData = null;
      $('modalCargarPacientesElectro')?.classList.remove('hidden');
    });
    $('btnCerrarCargarPacientesElectro')?.addEventListener('click', () => $('modalCargarPacientesElectro')?.classList.add('hidden'));
    $('btnCancelarCargarPacientesElectro')?.addEventListener('click', () => $('modalCargarPacientesElectro')?.classList.add('hidden'));
    $('cargarPacientesElectroFile')?.addEventListener('change', (e) => procesarExcelPacientesElectro(e.target.files[0]));
    $('btnConfirmarCargarPacientesElectro')?.addEventListener('click', confirmarCargarPacientesElectro);
    $('btnDescargarPlantillaElectro')?.addEventListener('click', descargarPlantillaElectro);
  }

  await cargarCitasElectro();

  if (intervaloAutoSyncElectro) {
    clearInterval(intervaloAutoSyncElectro);
    intervaloAutoSyncElectro = null;
  }
  intervaloAutoSyncElectro = setInterval(() => {
    const vistaElectro = document.querySelector('#view-electro');
    if (!vistaElectro || !vistaElectro.classList.contains('active')) return;
    cargarCitasElectro();
  }, 30000);

  // ÔöÇÔöÇ Sidebar navegaci├│n por p├íginas ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  document.querySelectorAll('#view-electro .electro-page-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      const page = this.dataset.page;
      document.querySelectorAll('#view-electro .electro-page-btn').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      document.querySelectorAll('#view-electro .electro-page').forEach(p => p.classList.remove('active'));
      const pgEl = document.querySelector(`#view-electro .electro-page[data-electro-page="${page}"]`);
      if (pgEl) pgEl.classList.add('active');
      if (page === 'espera') cargarEsperaElectro();
    });
  });

  initEsperaElectro();
  checkEquiposDisponibilidad();
}

// Verificar y mostrar disponibilidad de CUPOS
async function checkEquiposDisponibilidad() {
  const fecha = $('modalNuevoEstudioFecha')?.value || $('electroFecha').value;
  const hora = parseHora12a24($('electroHora').value);
  const estudio = $('electroEstudio').value;
  const duracionHoras = $('electroDuracion').value;

  if (!fecha || !hora) {
    const contenido = $('equiposDisponibilidadContenido');
    let html = `<div class="cupos-panel-empty">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
      Selecciona fecha y hora para ver disponibilidad de equipos
    </div>
    <div class="cupos-grid-empty">`;
    const maxCuposDefault = 4;
    for (let i = 1; i <= maxCuposDefault; i++) {
      html += `<div class="cupo-card vacio">
        <div class="cupo-card-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/></svg></div>
        <div class="cupo-card-label">Equipo ${i}</div>
      </div>`;
    }
    html += `</div>`;
    contenido.innerHTML = html;
    return;
  }

  try {
    // Determinar duraci├│n en MINUTOS
    let duracionMinutos = null;
    
    if (duracionHoras) {
      // Usuario ingres├│ duraci├│n (Monitorizaci├│n): convertir HORAS a MINUTOS
      duracionMinutos = Math.round(parseFloat(duracionHoras) * 60);
    } else if (selectedEstudioDuracion) {
      // Estudio fijo con duraci├│n predeterminada (ya en minutos)
      duracionMinutos = selectedEstudioDuracion;
    }

    const params = new URLSearchParams({
      fecha,
      hora,
      ...(estudio && { estudio }),
      ...(duracionMinutos && { duracion_manual: duracionMinutos })
    });

    const res = await apiFetch(`/api/equipos-electro/disponibilidad?${params}`);
    const data = await res.json();

    if (!res.ok) {
      console.error('Error:', data.error);
      return;
    }

    const contenido = $('equiposDisponibilidadContenido');
    const alerta = $('equiposDisponibilidadAlerta');

    const esDisponible = data.capacidad.hayDisponibilidad;
    const estado = esDisponible ? 'disponible' : 'ocupado';
    const titulo = esDisponible ? 'Equipos disponibles' : 'Sin disponibilidad';

    // Helpers
    const fmtFecha = (f) => {
      if (!f) return '';
      const [y, m, d] = f.substring(0, 10).split('-');
      return `${d}/${m}`;
    };
    const fmtHora = (h) => h ? h.substring(0, 5) : '';

    // Header
    let html = `
      <div class="cupos-panel-header ${estado}">
        <div class="cupos-panel-title ${estado}">
          <span class="cupos-dot ${estado}"></span>
          ${titulo}
        </div>
        <div class="cupos-panel-meta">
          <span><strong>${data.capacidad.cuposaDisponibles}/${data.capacidad.maxCupos}</strong> libres</span>
          <span><strong>${data.duracionMinutos >= 60 ? (data.duracionMinutos % 60 === 0 ? (data.duracionMinutos / 60) + 'h' : (data.duracionMinutos / 60).toFixed(1) + 'h') : data.duracionMinutos + 'min'}</strong></span>
          <span>fin <strong>${fmtHora(data.horaFin)}</strong></span>
        </div>
      </div>
      <div class="cupos-panel-body">
    `;

    // Citas "En Estudio" con hora_inicio real (para barra de progreso)
    const citasEnEstudio = data.citasEnRango.filter(c => c.estado === 'En Estudio' && c.horaInicioReal);

    // Grid de cupos
    html += `<div class="cupos-grid">`;
    const maxCupos = data?.capacidad?.maxCupos || 4;
    for (let i = 1; i <= maxCupos; i++) {
      const cita = data.citasEnRango[i - 1] || null;
      const ocupado = i <= data.capacidad.cuposOcupados;
      const enEstudio = ocupado && cita && cita.estado === 'En Estudio' && cita.horaInicioReal;
      const tipoCard = ocupado ? 'ocupado' : 'libre';
      const icono = ocupado
        ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/></svg>`
        : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>`;
      const estadoLabel = enEstudio ? 'En estudio'
        : ocupado
          ? (cita?.estado === 'Programado' ? 'Reservado'
            : cita?.estado === 'En Sala' ? 'En Sala'
            : cita?.estado === 'Pausado' ? 'Pausado'
            : 'Ocupado')
          : 'Libre';

      const barraId = enEstudio ? `cupo-barra-${i}` : '';
      const tiempoId = enEstudio ? `cupo-tiempo-${i}` : '';
      const barraHtml = enEstudio ? `
        <div class="cupo-mini-barra-wrap" title="${fmtHora(cita.horaInicioReal)} ÔåÆ ${fmtHora(cita.horaFin)}">
          <div class="cupo-mini-barra" id="${barraId}" style="width:0%"></div>
        </div>
        <div class="cupo-tiempo" id="${tiempoId}">00:00</div>` : (ocupado ? `<div class="cupo-mini-barra-wrap"><div class="cupo-mini-barra" style="width:100%;opacity:0.3"></div></div>` : '');

      html += `
        <div class="cupo-card ${tipoCard}">
          <div class="cupo-card-icon">${icono}</div>
          <div class="cupo-card-label">${estadoLabel}</div>
          ${barraHtml}
        </div>`;
    }
    html += `</div>`;

    // Iniciar actualizaci├│n de barras de progreso (cada segundo)
    if (intervaloProgresoPanel) clearInterval(intervaloProgresoPanel);
    if (citasEnEstudio.length > 0) {
      const actualizarBarras = () => {
        const ahora = new Date();
        const segsAhora = ahora.getHours() * 3600 + ahora.getMinutes() * 60 + ahora.getSeconds();
        data.citasEnRango.forEach((cita, idx) => {
          if (cita.estado !== 'En Estudio' || !cita.horaInicioReal) return;
          const barra = $(`cupo-barra-${idx + 1}`);
          const tiempoEl = $(`cupo-tiempo-${idx + 1}`);
          const parseHora = h => { const [hh, mm] = h.substring(0,5).split(':').map(Number); return hh * 3600 + mm * 60; };
          let segsInicio = parseHora(cita.horaInicioReal);
          let segsFin = parseHora(cita.horaFin);
          if (segsFin < segsInicio) segsFin += 86400;
          let segsActual = segsAhora < segsInicio ? segsAhora + 86400 : segsAhora;
          const segsTranscurridos = Math.max(0, segsActual - segsInicio);
          const pct = Math.min(100, Math.max(0, (segsTranscurridos / (segsFin - segsInicio)) * 100));
          if (barra) barra.style.width = pct + '%';
          if (tiempoEl) {
            const hh = String(Math.floor(segsTranscurridos / 3600)).padStart(2, '0');
            const mm = String(Math.floor((segsTranscurridos % 3600) / 60)).padStart(2, '0');
            const ss = String(segsTranscurridos % 60).padStart(2, '0');
            tiempoEl.textContent = `${hh}:${mm}:${ss}`;
          }
        });
      };
      actualizarBarras();
      intervaloProgresoPanel = setInterval(actualizarBarras, 1000);
    }

    // Equipos en uso
    if (data.capacidad.equiposEnUso && data.capacidad.equiposEnUso.length > 0) {
      html += `
        <div class="cupos-en-uso">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="flex-shrink:0;margin-top:1px"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
          <span><strong>En uso:</strong> ${data.capacidad.equiposEnUso.map(e => e.equipo_nombre).join(', ')}</span>
        </div>`;
    }

    // Estudios solapados
    if (data.citasEnRango && data.citasEnRango.length > 0) {
      html += `<div class="cupos-estudios"><div class="cupos-estudios-title">Estudios en este rango</div>`;
      data.citasEnRango.forEach(cita => {
        html += `<div class="cupos-estudio-item">${cita.estudio || 'Sin estudio'} &nbsp;<span style="color:#94a3b8">${fmtFecha(cita.fechaInicio)} ${fmtHora(cita.horaInicio)} ÔåÆ ${fmtFecha(cita.fechaFin)} ${fmtHora(cita.horaFin)}</span></div>`;
      });
      html += `</div>`;
    }

    // Pr├│xima disponibilidad
    if (!esDisponible && data.proximaDisponibilidad) {
      html += `
        <div class="cupos-proxima">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="flex-shrink:0"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm.5 5H11v6l5.25 3.15.75-1.23-4.5-2.67V7z"/></svg>
          <span>Pr├│xima disponibilidad: <strong>${data.proximaDisponibilidad}</strong></span>
        </div>`;
    }

    html += `</div>`; // cierra cupos-panel-body

    contenido.innerHTML = html;
  } catch (e) {
    console.error('Error checking disponibilidad:', e);
  }
}

// Buscar paciente por documento y auto-completar nombre y tel├®fono
async function buscarPacientePorDocumento() {
  // Eliminado autocompletado por documento. No hacer nada.
}

async function buscarDiagnosticosElectro() {
  const q = $('electroDiagnostico').value.trim();
  const dl = $('diagnosticosListElectro');
  
  if (q.length < 2) {
    dl.innerHTML = '';
    return;
  }
  
  try {
    const url = `/api/diagnosticos/search?q=${encodeURIComponent(q)}`;
    const res = await apiFetch(url);
    const diagnosticos = await res.json();
    dl.innerHTML = '';
    diagnosticos.forEach(d => { 
      const o = document.createElement('option'); 
      const displayText = d.codigo ? `[${d.codigo}] - ${d.nombre}` : d.nombre;
      o.value = displayText;
      o.dataset.id = d.id;
      o.dataset.codigo = d.codigo || '';
      o.dataset.nombre = d.nombre;
      dl.appendChild(o); 
    });
  } catch (e) {
  }
}

// Listener para cuando se selecciona un diagn├│stico del datalist
$('electroDiagnostico').addEventListener('input', function() {
  const selectedValue = this.value.trim();
  if (selectedValue) {
    const dl = $('diagnosticosListElectro');
    const opciones = dl.querySelectorAll('option');
    for (let opt of opciones) {
      if (opt.value === selectedValue) {
        selectedDiagnosticoElectroId = parseInt(opt.dataset.id, 10);
        break;
      }
    }
  } else {
    selectedDiagnosticoElectroId = null;
  }
});

function calcularFechaFinEstudio(cita) {
  if (!cita || cita.estado !== 'En Estudio' || !cita.hora_inicio || !cita.hora_fin) return null;
  const fechaRaw = cita.fecha || new Date().toISOString().slice(0, 10);
  const fechaBase = typeof fechaRaw === 'string' && fechaRaw.length > 10 ? fechaRaw.slice(0, 10) : String(fechaRaw);
  const [hiH, hiM] = cita.hora_inicio.split(':').map(Number);
  const dateInicio = new Date(`${fechaBase}T${String(hiH).padStart(2, '0')}:${String(hiM).padStart(2, '0')}:00`);

  const horaFinDateRaw = cita.hora_fin_date;
  const fechaFin = horaFinDateRaw
    ? (typeof horaFinDateRaw === 'string' && horaFinDateRaw.length > 10 ? horaFinDateRaw.slice(0, 10) : String(horaFinDateRaw))
    : null;
  const [hfH, hfM] = cita.hora_fin.split(':').map(Number);

  if (fechaFin && fechaFin !== fechaBase) {
    return new Date(`${fechaFin}T${String(hfH).padStart(2, '0')}:${String(hfM).padStart(2, '0')}:00`);
  }
  if (cita.duracion_minutos && cita.duracion_minutos > 0) {
    return new Date(dateInicio.getTime() + cita.duracion_minutos * 60000);
  }
  const dateFin = new Date(`${fechaBase}T${String(hfH).padStart(2, '0')}:${String(hfM).padStart(2, '0')}:00`);
  if (dateFin <= dateInicio) dateFin.setDate(dateFin.getDate() + 1);
  return dateFin;
}

async function sincronizarEstadosPorTiempo(citas = []) {
  if (!Array.isArray(citas) || citas.length === 0) return citas;

  const ahora = new Date();
  const hh = String(ahora.getHours()).padStart(2, '0');
  const mm = String(ahora.getMinutes()).padStart(2, '0');
  const horaActual = `${hh}:${mm}`;
  const vencidas = citas.filter((c) => c?.estado === 'En Estudio' && calcularFechaFinEstudio(c) && ahora >= calcularFechaFinEstudio(c));
  if (!vencidas.length) return citas;

  const actualizadas = [...citas];
  for (const cita of vencidas) {
    try {
      const res = await apiFetch(`/api/citas-electro/${cita.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado: 'Completado', hora_fin: cita.hora_fin || horaActual })
      });
      const data = await res.json();
      if (!data?.ok) continue;

      const idx = actualizadas.findIndex((x) => x.id === cita.id);
      if (idx >= 0) actualizadas[idx] = { ...actualizadas[idx], estado: 'Completado', hora_fin: cita.hora_fin || horaActual };

      if (window.socket && window.socket.connected) {
        window.socket.emit('electro:estudio-finalizado', { id: cita.id, hora_fin: cita.hora_fin || horaActual });
      }
    } catch (e) {
      console.error('[AUTO_SYNC_ELECTRO] Error actualizando estado por tiempo:', e);
    }
  }
  return actualizadas;
}

async function cargarCitasElectro() {
  if (_cargandoCitasElectro) {
    _pendienteCitasElectro = true;
    return;
  }
  const reqId = ++_citasElectroReqId;
  _cargandoCitasElectro = true;
  const fecha = $('electroFecha').value;
  if (!fecha) {
    _cargandoCitasElectro = false;
    showToast('Selecciona una fecha', 'error');
    return;
  }
  showSkeletonRows($('citasElectroBody'), 10, 6);
  try {
    const res = await apiFetch(`/api/citas-electro?fecha=${encodeURIComponent(fecha)}&_t=${Date.now()}`, {
      cache: 'no-store'
    });
    const citasRaw = await res.json();
    if (reqId !== _citasElectroReqId) return; // respuesta vieja pisa estado reciente
    const citas = Array.isArray(citasRaw) ? citasRaw : [];
    const citasNormalizadasEstado = citas.map((c) => ({
      ...c,
      estado: normalizarEstadoElectro(c.estado)
    }));
    const citasNormalizadas = await sincronizarEstadosPorTiempo(citasNormalizadasEstado);
    if (reqId !== _citasElectroReqId) return; // respuesta vieja
    
    // Filtrar por estudio si es necesario
    let citasFiltradas = citasNormalizadas;
    if (filtroEstudioElectro !== 'todas') {
      citasFiltradas = citasNormalizadas.filter(c => c.estudio === filtroEstudioElectro);
    }
    
    if (citasFiltradas.length === 0) {
      const tbody = $('citasElectroBody');
      const mensajeEstudio = filtroEstudioElectro === 'todas' ? '' : ` para ${filtroEstudioElectro}`;
      tbody.innerHTML = `<tr><td colspan="12"><div class="empty-state"><div class="empty-state-icon">­ƒôà</div><p class="empty-state-title">Sin citas</p><p class="empty-state-subtitle">No hay citas registradas para esta fecha${mensajeEstudio}</p></div></td></tr>`;
      const contador = $('citasElectroContador');
      if (contador) contador.textContent = '';
      $('electroUsuarioProgramo').textContent = '-';
      $('electroUsuarioEdito').textContent = '-';
      actualizarStatsElectro(citasNormalizadas);
      return;
    }

    // Actualizar stats cards (siempre con TODAS las citas, no filtradas)
    actualizarStatsElectro(citasNormalizadas);

    // Actualizar contador de citas
    const contador = $('citasElectroContador');
    if (contador) {
      const total = citasFiltradas.length;
      const completadas = citasFiltradas.filter(c => c.estado === 'Completado').length;
      const enEstudio = citasFiltradas.filter(c => c.estado === 'En Estudio').length;
      const partes = [`${total} cita${total !== 1 ? 's' : ''}`];
      if (enEstudio > 0) partes.push(`${enEstudio} en estudio`);
      if (completadas > 0) partes.push(`${completadas} completada${completadas !== 1 ? 's' : ''}`);
      contador.textContent = partes.join(' ┬À ');
    }

    // Usar setupPagination para renderizar con paginaci├│n
    setupPagination('citasElectro', citasFiltradas, renderCitaElectroRow, {
      itemsPerPageDefault: 20,
      tbodyId: 'citasElectroBody',
      containerSelector: '#citasElectroTableControls'
    });
    
    // Actualizar informaci├│n de usuario (del primer registro filtrado)
    if (citasFiltradas.length > 0) {
      $('electroUsuarioProgramo').textContent = citasFiltradas[0].programado_por_nombre || citasFiltradas[0].usuario_programo || '-';
      $('electroUsuarioEdito').textContent = citasFiltradas[0].editado_por_nombre || citasFiltradas[0].usuario_edito || citasFiltradas[0].programado_por_nombre || citasFiltradas[0].usuario_programo || 'Quien program├│';
    }
    
    // Refrescar panel de disponibilidad de equipos
    checkEquiposDisponibilidad();
  } catch (e) { 
    console.error('Error cargando citas:', e);
    showToast('Error cargando citas', 'error'); 
  } finally {
    _cargandoCitasElectro = false;
    if (_pendienteCitasElectro) {
      _pendienteCitasElectro = false;
      setTimeout(() => cargarCitasElectro(), 150);
    }
  }
}

function actualizarStatsElectro(citas) {
  const total = citas.length;
  const enEstudio = citas.filter(c => c.estado === 'En Estudio' || c.estado === 'Pausado').length;
  const completados = citas.filter(c => c.estado === 'Completado').length;
  const pendientes = citas.filter(c => c.estado === 'Programado' || c.estado === 'Confirmado' || c.estado === 'En Sala' || c.estado === 'Reprogramado' || c.estado === 'Adelantado').length;
  
  const elTotal = $('statTotalCitas');
  const elEstudio = $('statEnEstudio');
  const elComp = $('statCompletados');
  const elPend = $('statPendientes');
  if (elTotal) elTotal.textContent = total;
  if (elEstudio) elEstudio.textContent = enEstudio;
  if (elComp) elComp.textContent = completados;
  if (elPend) elPend.textContent = pendientes;
}

function renderCitaElectroRow(tbody, c) {
  const tr = document.createElement('tr');
  tr.className = 'turno-row';
  tr.style.cursor = 'pointer';
  tr.dataset.citaId = String(c.id || '');
  
  const equipoDisplay = c.equipo_nombre ? escapeHtml(c.equipo_nombre) : (c.equipo_id ? `Equipo ${c.equipo_id}` : '<span style="color:#9ca3af">ÔÇö</span>');
  
  // Mostrar hora_fin con fecha SOLO si cruza medianoche
  let horaFinDisplay = formatearHora(c.hora_fin);
  if (c.hora_fin_date && c.hora_fin_date !== c.fecha) {
    const fechaFormateada = formatearFechaISO(c.hora_fin_date);
    horaFinDisplay = `${formatearHora(c.hora_fin)} <span style="color:#dc2626;font-size:0.72rem;font-weight:600;">(${fechaFormateada})</span>`;
  }
  
  // Formatear duraci├│n
  let duracionDisplay = '<span style="color:#9ca3af">ÔÇö</span>';
  if (c.duracion_minutos) {
    const dHrs = Math.floor(c.duracion_minutos / 60);
    const dMin = c.duracion_minutos % 60;
    if (dHrs >= 24) {
      const dias = Math.floor(dHrs / 24);
      const hResto = dHrs % 24;
      duracionDisplay = `<span class="electro-dur-badge multi-day">${dias}d ${hResto}h</span>`;
    } else if (dHrs > 0 && dMin > 0) {
      duracionDisplay = `<span class="electro-dur-badge">${dHrs}h ${dMin}m</span>`;
    } else if (dHrs > 0) {
      duracionDisplay = `<span class="electro-dur-badge">${dHrs}h</span>`;
    } else {
      duracionDisplay = `<span class="electro-dur-badge">${dMin}m</span>`;
    }
  }
  
  // Colorear fila seg├║n estado
  const estadoClasses = {
    'En Sala': 'estado-en-sala',
    'En Estudio': 'estado-en-estudio',
    'Pausado': 'estado-pausado',
    'Completado': 'estado-completado',
    'Cancelado': 'estado-cancelado',
    'No Asisti├│': 'estado-no-asistio'
  };
  if (estadoClasses[c.estado]) tr.classList.add(estadoClasses[c.estado]);
  
  // Abreviar nombre del estudio para la tabla
  const estudioCorto = abreviarEstudio(c.estudio);

  tr.innerHTML = `
    <td><strong>${formatearHora(c.hora_agendamiento)}</strong></td>
    <td class="col-mobile-hide">${formatearHora(c.hora_inicio)}</td>
    <td class="col-mobile-hide">${equipoDisplay}</td>
    <td><span class="electro-paciente-cell">${escapeHtml(c.paciente_nombre || '-')}</span></td>
    <td>${escapeHtml(c.paciente_documento || '-')}</td>
    <td class="col-mobile-hide">${escapeHtml(c.telefono || '-')}</td>
    <td><span title="${escapeHtml(c.estudio || '')}">${escapeHtml(estudioCorto)}</span></td>
    <td class="col-mobile-hide">${escapeHtml(c.entidad || '-')}</td>
    <td class="col-mobile-hide">${duracionDisplay}</td>
    <td class="col-mobile-hide">${escapeHtml(c.diagnostico_codigo || '-')}</td>
    <td>${estadoBadge(c.estado || 'Programado')}</td>
    <td class="col-mobile-hide">${horaFinDisplay}</td>
  `;
  
  // Hacer la fila clickeable para abrir modal
  tr.addEventListener('click', (e) => {
    if (!tienePermiso('electro.editar') && !tienePermiso('electro.cambiar_estado')) return;
    if (c.estado === 'Completado') {
      if (!tienePermiso('electro.eliminar')) {
        showToast('Esta cita ya est├í completada - No se puede modificar', 'info');
        return;
      }
    }
    abrirModalDetallesCita(c);
  });
  
  // Cambiar apariencia visual si est├í completado
  if (c.estado === 'Completado') {
    tr.style.opacity = '0.55';
    tr.style.cursor = tienePermiso('electro.eliminar') ? 'pointer' : 'not-allowed';
  }
  
  tbody.appendChild(tr);
}

/**
 * Valida que un nombre solo contenga letras y espacios
 * @param {string} nombre - El nombre a validar
 * @returns {boolean} true si es v├ílido
 */
function validarNombre(nombre) {
  return /^[a-zA-Z├í├®├¡├│├║├ü├ë├ì├ô├Ü├▒├æ\s]+$/.test(nombre);
}

/**
 * Valida que un documento solo contenga n├║meros
 * @param {string} doc - El documento a validar
 * @returns {boolean} true si es v├ílido
 */
function validarDocumento(doc) {
  return /^\d+$/.test(doc);
}

/**
 * Valida que un tel├®fono tenga exactamente 10 d├¡gitos
 * @param {string} telefono - El tel├®fono a validar
 * @returns {boolean} true si es v├ílido
 */
function validarTelefono(telefono) {
  return /^\d{10}$/.test(telefono);
}

async function crearCitaElectro() {
  // Validar Estudio primero (obligatorio)
  const estudio = $('electroEstudio').value;
  if (!estudio) {
    showToast('Debes seleccionar un estudio para programar la cita', 'error');
    $('electroEstudio').focus();
    $('electroEstudio').style.borderColor = '#dc2626';
    return;
  }
  
  const electroNombres = $('electroPacienteNombres')?.value.trim() || '';
  const electroApellidos = $('electroPacienteApellidos')?.value.trim() || '';
  const nombre = [electroNombres, electroApellidos].filter(Boolean).join(' ');
  const doc = $('electroDocumento').value.trim();
  const telefono = $('electroTelefono').value.trim();
  const telefono2 = $('electroTelefono2').value.trim();
  const hora = parseHora12a24($('electroHora').value);
  const fecha = $('modalNuevoEstudioFecha')?.value || $('electroFecha').value;
  const duracion = $('electroDuracion').value.trim();
  const diagnostico = $('electroDiagnostico').value.trim();
  const entidad = $('electroEntidad')?.value || '';
  
  if (!electroNombres) { showToast('Escribe los nombres del paciente', 'error'); $('electroPacienteNombres').focus(); $('electroPacienteNombres').style.borderColor='#dc2626'; return; }
  if (!electroApellidos) { showToast('Escribe los apellidos del paciente', 'error'); $('electroPacienteApellidos').focus(); $('electroPacienteApellidos').style.borderColor='#dc2626'; return; }
  if (!hora) { showToast('Selecciona una hora', 'error'); $('electroHora').focus(); return; }
  if (!doc || !telefono || !telefono2 || !fecha || !entidad) { 
    showToast('Completa todos los campos obligatorios', 'error'); 
    return; 
  }
  
  // Validar nombre (solo letras y espacios)
  if (!validarNombre(electroNombres)) {
    showToast('Los nombres no pueden contener n├║meros o caracteres especiales', 'error');
    $('electroPacienteNombres').focus();
    $('electroPacienteNombres').style.borderColor = '#dc2626';
    return;
  }
  if (!validarNombre(electroApellidos)) {
    showToast('Los apellidos no pueden contener n├║meros o caracteres especiales', 'error');
    $('electroPacienteApellidos').focus();
    $('electroPacienteApellidos').style.borderColor = '#dc2626';
    return;
  }
  $('electroPacienteNombres').style.borderColor = '';
  $('electroPacienteApellidos').style.borderColor = '';
  
  // Validar documento (solo n├║meros)
  if (!validarDocumento(doc)) {
    showToast('El documento solo puede contener n├║meros', 'error');
    $('electroDocumento').focus();
    $('electroDocumento').style.borderColor = '#dc2626';
    return;
  }
  $('electroDocumento').style.borderColor = '';
  
  // Validar tel├®fono (exactamente 10 d├¡gitos)
  if (!validarTelefono(telefono)) {
    showToast('El tel├®fono debe tener exactamente 10 d├¡gitos', 'error');
    $('electroTelefono').focus();
    $('electroTelefono').style.borderColor = '#dc2626';
    return;
  }
  $('electroTelefono').style.borderColor = '';
  
  // Validar tel├®fono 2 (exactamente 10 d├¡gitos)
  if (!validarTelefono(telefono2)) {
    showToast('El tel├®fono 2 debe tener exactamente 10 d├¡gitos', 'error');
    $('electroTelefono2').focus();
    $('electroTelefono2').style.borderColor = '#dc2626';
    return;
  }
  $('electroTelefono2').style.borderColor = '';

  // Tel├®fono 2 no puede ser igual al 1
  if (telefono === telefono2) {
    showToast('El Tel├®fono 2 no puede ser igual al Tel├®fono 1', 'error');
    $('electroTelefono2').focus();
    $('electroTelefono2').style.borderColor = '#dc2626';
    return;
  }
  
  // Validar duraci├│n si es Monitorizaci├│n EEG por Video y Radio
  if (esMonitorizacionVideoRadio(estudio) && !duracion) {
    showToast('Debe especificar la duraci├│n del estudio (en horas)', 'error');
    $('electroDuracion').focus();
    $('electroDuracion').style.borderColor = '#dc2626';
    return;
  }
  
  // Validar que duraci├│n sea un n├║mero v├ílido si es Monitorizaci├│n
  if (esMonitorizacionVideoRadio(estudio) && duracion) {
    const duracionNum = parseFloat(duracion);
    if (isNaN(duracionNum) || duracionNum < 1 || duracionNum > 168) {
      showToast('La duraci├│n debe estar entre 1 y 168 horas', 'error');
      $('electroDuracion').focus();
      $('electroDuracion').style.borderColor = '#dc2626';
      return;
    }
  }
  
  // Restablecer color del border del estudio
  $('electroEstudio').style.borderColor = '';
  
  // Obtener pacienteId del buscador o crear nuevo
  let pacienteId = parseInt($('electroDocumento').dataset.pacienteId, 10) || null;
  
  if (!pacienteId) {
    // Si no existe paciente en base de datos, crear uno nuevo
    const resP = await apiFetch('/api/pacientes', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({nombre, documento:doc||null, telefono:telefono||null, telefono2:telefono2||null}) });
    const dataP = await resP.json();
    if (!dataP.ok) { showToast(dataP.error||'Error creando paciente', 'error'); return; }
    pacienteId = dataP.id;
  }
  
  // Buscar ID del diagn├│stico si fue seleccionado
  let diagnosticoId = selectedDiagnosticoElectroId;
  if (!diagnosticoId && diagnostico) {
    // Fallback: buscar la opci├│n que coincida con el valor ingresado
    const dl = $('diagnosticosListElectro');
    const opciones = dl.querySelectorAll('option');
    for (let opt of opciones) {
      // Buscar coincidia exacta o parcial con el value o el dataset.codigo
      if (opt.value === diagnostico || opt.dataset.codigo === diagnostico || opt.dataset.nombre === diagnostico) {
        diagnosticoId = parseInt(opt.dataset.id, 10);
        break;
      }
    }
  }
  
  // Nota: El equipo se selecciona despu├®s en el modal cuando se inicia el estudio
  let equipoId = null;

  // Mostrar spinner en el bot├│n
  const btnCrear = $('crearCitaElectro');
  setLoading(btnCrear, true, 'Guardando...');

  try {
    const body = {
      paciente_id: pacienteId,
      fecha,
      hora,
      telefono,
      telefono2,
      estudio,
      entidad,
      estado: 'Programado',
      programado_por_nombre: currentUser ? (currentUser.nombre || currentUser.usuario) : 'Sistema'
    };
    
    // Determinar duraci├│n en minutos
    let duracionMinutos = null;
    
    if (duracion) {
      // Usuario ingres├│ duraci├│n (es Monitorizaci├│n): convertir HORAS a MINUTOS
      duracionMinutos = Math.round(parseFloat(duracion) * 60);
    } else if (selectedEstudioDuracion) {
      // Estudio fijo con duraci├│n predeterminada (ya en minutos)
      duracionMinutos = selectedEstudioDuracion;
    }
    
    if (duracionMinutos) {
      body.duracion = duracionMinutos;
    }
    
    // Agregar diagn├│stico si fue seleccionado
    if (diagnosticoId) {
      body.diagnostico_id = diagnosticoId;
    }
    
    // Agregar equipo si fue seleccionado
    if (equipoId) {
      body.equipo_id = equipoId;
    }
    
    const res = await apiFetch('/api/citas-electro', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
    const data = await res.json();
    if (data.ok) { 
      showToast('Cita creada correctamente', 'success');
      
      // El servidor emite el socket event, no es necesario emitir desde el cliente
      
      // Limpiar formulario
      $('electroPacienteNombres').value = '';
      $('electroPacienteApellidos').value = '';
      $('electroDocumento').value = '';
      $('electroTelefono').value = '';
      $('electroTelefono2').value = '';
      $('electroHora').value = '';
      $('electroEstudio').value = '';
      $('electroDiagnostico').value = '';
      if ($('electroEntidad')) $('electroEntidad').value = '';
      selectedDiagnosticoElectroId = null;
      selectedEquipoElectroId = null;
      selectedEstudioDuracion = null;
      $('electroDuracion').value = '';
      $('electroDuracionCol').style.display = 'none';
      // Recargar tabla
      cargarCitasElectro();
      $('modalNuevoEstudioElectro')?.classList.add('hidden');
    } else {
      showToast(data.error || 'Error creando cita', 'error');
    }
  } catch (e) { 
    showToast('Error creando cita: ' + e.message, 'error'); 
  } finally {
    setLoading(btnCrear, false);
  }
}

// ========== M├ôDULO DE PERMISOS (solo superadmin) ==========

// Definici├│n completa de todos los permisos del sistema
const PERMISOS_DEFS = [
  // ÔöÇÔöÇ Acceso a M├│dulos ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  { key: 'modulo.recibos',          label: 'M├│dulo: Recibos',                     grupo: 'Acceso a M├│dulos' },
  { key: 'modulo.agenda_medica',    label: 'M├│dulo: Agenda M├®dica',               grupo: 'Acceso a M├│dulos' },
  { key: 'modulo.electrodiag',      label: 'M├│dulo: Electrodiagn├│stico',          grupo: 'Acceso a M├│dulos' },
  { key: 'modulo.ucqn',             label: 'M├│dulo: UCQN',                         grupo: 'Acceso a M├│dulos' },
  { key: 'modulo.dashboard',        label: 'M├│dulo: Dashboard de Citas',          grupo: 'Acceso a M├│dulos' },
  { key: 'modulo.usuarios',         label: 'M├│dulo: Gesti├│n de Usuarios',         grupo: 'Acceso a M├│dulos' },
  { key: 'modulo.diagnosticos',     label: 'M├│dulo: Diagn├│sticos',                grupo: 'Acceso a M├│dulos' },
  { key: 'modulo.gestion_datos',    label: 'M├│dulo: Gesti├│n de Datos',            grupo: 'Acceso a M├│dulos' },
  { key: 'modulo.monitor_equipos',  label: 'M├│dulo: Monitor de Equipos',           grupo: 'Acceso a M├│dulos' },
  // ÔöÇÔöÇ Recibos ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  { key: 'recibos.crear',           label: 'Recibos: Crear nuevo recibo',         grupo: 'Recibos' },
  { key: 'recibos.ver',             label: 'Recibos: Ver lista de recibos',       grupo: 'Recibos' },
  { key: 'recibos.editar',          label: 'Recibos: Editar recibo existente',    grupo: 'Recibos' },
  { key: 'recibos.anular',          label: 'Recibos: Anular recibo',              grupo: 'Recibos' },
  { key: 'recibos.eliminar',        label: 'Recibos: Eliminar recibos',           grupo: 'Recibos' },
  { key: 'recibos.exportar',        label: 'Recibos: Exportar Excel / PDF',       grupo: 'Recibos' },
  { key: 'recibos.gestionar_servicios', label: 'Recibos: Gestionar servicios',    grupo: 'Recibos' },
  { key: 'recibos.resetear',        label: 'Recibos: Resetear consecutivos',      grupo: 'Recibos' },
  // ÔöÇÔöÇ Agenda M├®dica ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  { key: 'agenda.ver',              label: 'Agenda: Ver turnos del d├¡a',          grupo: 'Agenda M├®dica' },
  { key: 'agenda.crear',            label: 'Agenda: Crear / Programar citas',     grupo: 'Agenda M├®dica' },
  { key: 'agenda.editar',           label: 'Agenda: Editar citas',                grupo: 'Agenda M├®dica' },
  { key: 'agenda.eliminar',         label: 'Agenda: Eliminar citas',              grupo: 'Agenda M├®dica' },
  { key: 'agenda.cambiar_estado',   label: 'Agenda: Cambiar estado de turno',     grupo: 'Agenda M├®dica' },
  { key: 'agenda.llamar_siguiente', label: 'Agenda: Llamar siguiente paciente',   grupo: 'Agenda M├®dica' },
  { key: 'agenda.marcar_atendido',  label: 'Agenda: Marcar como atendido',        grupo: 'Agenda M├®dica' },
  { key: 'agenda.aviso_doctor',     label: 'Agenda: Enviar aviso al doctor',      grupo: 'Agenda M├®dica' },
  { key: 'agenda.disponibilidad',   label: 'Agenda: Programar disponibilidad',    grupo: 'Agenda M├®dica' },
  // ÔöÇÔöÇ Electrodiagn├│stico ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  { key: 'electro.ver',             label: 'Electro: Ver citas',                  grupo: 'Electrodiagn├│stico' },
  { key: 'electro.crear',           label: 'Electro: Crear cita',                grupo: 'Electrodiagn├│stico' },
  { key: 'electro.editar',          label: 'Electro: Editar cita',                grupo: 'Electrodiagn├│stico' },
  { key: 'electro.eliminar',        label: 'Electro: Eliminar cita',              grupo: 'Electrodiagn├│stico' },
  { key: 'electro.cambiar_estado',  label: 'Electro: Cambiar estado de cita',     grupo: 'Electrodiagn├│stico' },
  { key: 'electro.subir_archivo',   label: 'Electro: Subir archivos de estudios', grupo: 'Electrodiagn├│stico' },
  { key: 'electro.ver_archivo',     label: 'Electro: Ver/descargar archivos',     grupo: 'Electrodiagn├│stico' },
  { key: 'electro.aviso_doctor',    label: 'Electro: Enviar aviso al doctor',     grupo: 'Electrodiagn├│stico' },
  // ÔöÇÔöÇ UCQN ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  { key: 'ucqn.ver',                label: 'UCQN: Ver estudios',                   grupo: 'UCQN' },
  { key: 'ucqn.editar_estado',      label: 'UCQN: Cambiar estado',                 grupo: 'UCQN' },
  // ÔöÇÔöÇ Usuarios ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  { key: 'usuarios.ver',            label: 'Usuarios: Ver lista de usuarios',     grupo: 'Gesti├│n de Usuarios' },
  { key: 'usuarios.crear',          label: 'Usuarios: Crear usuario',             grupo: 'Gesti├│n de Usuarios' },
  { key: 'usuarios.editar',         label: 'Usuarios: Editar usuario',            grupo: 'Gesti├│n de Usuarios' },
  { key: 'usuarios.cambiar_clave',  label: 'Usuarios: Cambiar contrase├▒a',        grupo: 'Gesti├│n de Usuarios' },
  { key: 'usuarios.eliminar',       label: 'Usuarios: Eliminar usuario',          grupo: 'Gesti├│n de Usuarios' },
  { key: 'usuarios.auditoria',      label: 'Usuarios: Ver auditor├¡a de accesos',  grupo: 'Gesti├│n de Usuarios' },
  { key: 'usuarios.permisos',       label: 'Usuarios: Gestionar permisos (superadmin)', grupo: 'Gesti├│n de Usuarios' },
  // ÔöÇÔöÇ Diagn├│sticos ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  { key: 'diagnosticos.ver',        label: 'Diagn├│sticos: Ver lista',             grupo: 'Diagn├│sticos' },
  { key: 'diagnosticos.crear',      label: 'Diagn├│sticos: Crear diagn├│stico',     grupo: 'Diagn├│sticos' },
  { key: 'diagnosticos.editar',     label: 'Diagn├│sticos: Editar diagn├│stico',    grupo: 'Diagn├│sticos' },
  { key: 'diagnosticos.eliminar',   label: 'Diagn├│sticos: Eliminar diagn├│stico',  grupo: 'Diagn├│sticos' },
  // ÔöÇÔöÇ Sistema ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  { key: 'sistema.backups',         label: 'Sistema: Gesti├│n de backups',         grupo: 'Sistema' },
  { key: 'sistema.exportar_datos',  label: 'Sistema: Exportar datos del sistema', grupo: 'Sistema' },
  { key: 'sistema.dashboard',       label: 'Sistema: Ver dashboard estad├¡sticas', grupo: 'Sistema' },
  { key: 'sistema.reportes',        label: 'Sistema: Ver reportes de recibos',    grupo: 'Sistema' },
];

// Permisos predeterminados por rol (null = sin restricciones / todo permitido)
// IMPORTANTE: Estos defaults DEBEN incluir todos los permisos que el rol obtiene
// por defecto en requireRoleOrPerm del servidor. Si un permiso falta aqu├¡,
// al guardar permisos personalizados el usuario perder├¡a acceso a esa acci├│n.
const PERMISOS_ROL_DEFAULTS = {
  superadmin: null,
  admin: null,
  admin_recepcion: [
    'modulo.recibos','modulo.agenda_medica','modulo.electrodiag','modulo.ucqn','modulo.dashboard','modulo.monitor_equipos',
    'recibos.crear','recibos.ver','recibos.exportar',
    'agenda.ver','agenda.crear','agenda.editar','agenda.eliminar','agenda.cambiar_estado',
    'agenda.llamar_siguiente','agenda.marcar_atendido','agenda.aviso_doctor','agenda.disponibilidad',
    'electro.ver','electro.crear','electro.editar','electro.cambiar_estado','electro.subir_archivo','electro.ver_archivo','electro.aviso_doctor',
    'ucqn.ver','ucqn.editar_estado',
    'sistema.dashboard',
  ],
  recepcion: [
    'modulo.recibos','modulo.agenda_medica','modulo.electrodiag','modulo.ucqn','modulo.dashboard','modulo.monitor_equipos',
    'recibos.crear','recibos.ver',
    'agenda.ver','agenda.crear','agenda.editar','agenda.eliminar','agenda.cambiar_estado',
    'agenda.llamar_siguiente','agenda.marcar_atendido','agenda.aviso_doctor',
    'electro.ver','electro.crear','electro.editar','electro.cambiar_estado',
    'ucqn.ver','ucqn.editar_estado',
    'sistema.dashboard',
  ],
  auxiliar_recepcion: [
    'modulo.recibos','modulo.agenda_medica','modulo.electrodiag',
    'recibos.crear','recibos.ver',
    'agenda.ver','agenda.crear','agenda.editar','agenda.cambiar_estado','agenda.aviso_doctor',
    'electro.ver','electro.crear',
  ],
  doctor: [
    'modulo.agenda_medica','modulo.electrodiag','modulo.dashboard',
    'agenda.ver','agenda.cambiar_estado','agenda.llamar_siguiente','agenda.marcar_atendido','agenda.disponibilidad',
    'electro.ver','electro.cambiar_estado','electro.subir_archivo','electro.ver_archivo',
    'sistema.dashboard',
  ],
  admin_electro: [
    'modulo.electrodiag','modulo.ucqn','modulo.agenda_medica','modulo.dashboard','modulo.monitor_equipos',
    'electro.ver','electro.crear','electro.editar','electro.eliminar','electro.cambiar_estado','electro.subir_archivo','electro.ver_archivo','electro.aviso_doctor',
    'agenda.ver','agenda.editar','agenda.aviso_doctor',
    'ucqn.ver','ucqn.editar_estado',
    'sistema.dashboard',
  ],
  electro: [
    'modulo.electrodiag','modulo.ucqn','modulo.agenda_medica','modulo.dashboard','modulo.monitor_equipos',
    'electro.ver','electro.crear','electro.editar','electro.eliminar','electro.cambiar_estado','electro.subir_archivo','electro.ver_archivo','electro.aviso_doctor',
    'agenda.ver','agenda.editar','agenda.aviso_doctor',
    'ucqn.ver','ucqn.editar_estado',
    'sistema.dashboard',
  ],
  tecnico_electro: [
    'modulo.electrodiag','modulo.agenda_medica','modulo.monitor_equipos',
    'electro.ver','electro.crear','electro.editar','electro.cambiar_estado','electro.subir_archivo','electro.ver_archivo',
    'agenda.ver','agenda.editar','agenda.aviso_doctor',
  ],
  contabilidad: [
    'modulo.recibos','modulo.ucqn','modulo.dashboard',
    'recibos.ver','recibos.exportar',
    'ucqn.ver','ucqn.editar_estado',
    'sistema.dashboard','sistema.reportes',
  ],
};

let _permisosUsuarioSeleccionado = null; // { id, usuario, nombre, rol, permisos }
let _permisosUsuariosCache = [];

function _bindPermisosPageUIOnce() {
  if (window._permisosPageUIBound) return;
  window._permisosPageUIBound = true;
  const uSearch = document.getElementById('permisosUserSearch');
  const pSearch = document.getElementById('permisosDefSearch');
  const list = document.getElementById('permisosUserList');
  uSearch?.addEventListener('input', _permisosFiltrarListaUsuarios);
  pSearch?.addEventListener('input', _permisosAplicarFiltroDefiniciones);
  list?.addEventListener('change', (e) => {
    const v = (e.target && e.target.value) || '';
    if (!v) { _permisosCerrarEditor(); return; }
    const id = parseInt(v, 10);
    if (id) _seleccionarUsuarioPermisos(id);
  });
  document.getElementById('permisosChecklistContainer')?.addEventListener('change', (e) => {
    const t = e.target;
    if (t && t.matches && t.matches('input[data-key]')) _permisosRefreshStats();
  });
}

function _permisosCerrarEditor() {
  _permisosUsuarioSeleccionado = null;
  const editor = document.getElementById('permisosEditorSection');
  const noSel = document.getElementById('permisosNoSeleccion');
  if (editor) editor.style.display = 'none';
  if (noSel) noSel.style.display = 'flex';
}

function _permisosFiltrarListaUsuarios() {
  const q = (document.getElementById('permisosUserSearch')?.value || '').trim().toLowerCase();
  const select = document.getElementById('permisosUserList');
  if (!select) return;
  for (const opt of select.options) {
    if (!opt.value) { opt.hidden = false; opt.disabled = false; continue; }
    const t = (opt.textContent || '').toLowerCase();
    const u = (opt.getAttribute('data-user-text') || t);
    const match = !q || u.includes(q) || (opt.value && String(opt.value).includes(q));
    opt.hidden = !match;
  }
}

function _permisosAplicarFiltroDefiniciones() {
  const q = (document.getElementById('permisosDefSearch')?.value || '').trim().toLowerCase();
  const groups = document.querySelectorAll('#permisosChecklistContainer .permisos-group');
  groups.forEach((det) => {
    const rows = det.querySelectorAll('.permisos-row');
    let shown = 0;
    rows.forEach((row) => {
      const hay = !q || (row.dataset.search || '').includes(q);
      row.classList.toggle('permisos-row--hidden', !hay);
      if (hay) shown++;
    });
    const hideGroup = q.length > 0 && shown === 0;
    det.classList.toggle('permisos-group--empty-filter', hideGroup);
  });
  const noMatch = document.getElementById('permisosFiltroSinResultados');
  if (noMatch) {
    const any = [...document.querySelectorAll('#permisosChecklistContainer .permisos-group')].some(d => !d.classList.contains('permisos-group--empty-filter'));
    noMatch.style.display = q && !any ? 'block' : 'none';
  }
}

function _permisosRefreshStats() {
  const line = document.getElementById('permisosStatsLine');
  if (!line) return;
  const chks = document.querySelectorAll('#permisosChecklistContainer input[type=checkbox][data-key]');
  if (!chks.length) { line.textContent = 'ÔÇö'; return; }
  const tot = chks.length;
  const c = document.querySelectorAll('#permisosChecklistContainer input[type=checkbox][data-key]:checked').length;
  line.textContent = `${c} de ${tot} permisos activos`;
  document.querySelectorAll('#permisosChecklistContainer .permisos-group').forEach((det) => {
    const inDet = det.querySelectorAll('input[type=checkbox][data-key]');
    const cG = [...inDet].filter(x => x.checked).length;
    const tG = inDet.length;
    const el = det.querySelector('.permisos-group-count');
    if (el) el.textContent = `${cG}/${tG}`;
    const gchk = det.querySelector('.permisos-chk-group');
    if (gchk && tG) {
      gchk.checked = cG === tG;
      gchk.indeterminate = cG > 0 && cG < tG;
    }
  });
}

async function initPermisosPage() {
  // Mostrar tab solo a superadmin
  const btnTab = document.getElementById('btnSidebarPermisos');
  if (btnTab && currentUser?.rol === 'superadmin') btnTab.style.display = '';

  _bindPermisosPageUIOnce();

  const btnGuardar = document.getElementById('btnPermisosGuardar');
  const btnRestablecer = document.getElementById('btnPermisosRestablecer');
  if (btnGuardar) btnGuardar.onclick = _guardarPermisos;
  if (btnRestablecer) btnRestablecer.onclick = _restablecerPermisos;

  await _cargarPermisosUserList();

  // Socket: refrescar sesi├│n del usuario actual si le cambiaron permisos
  if (window.socket && !window._socketPermisosListener) {
    window.socket.on('usuario:permisos-cambiados', (data) => {
      if (data?.userId === currentUser?.id) {
        checkSession(); // Refresca currentUser.permisos desde DB
      }
    });
    window._socketPermisosListener = true;
  }
}

async function _cargarPermisosUserList() {
  const container = document.getElementById('permisosUserList');
  if (!container) return;
  container.innerHTML = '<option value="" disabled selected>CargandoÔÇª</option>';
  try {
    const res = await apiFetch('/api/usuarios');
    const usuarios = await res.json();
    _permisosUsuariosCache = usuarios.filter(u => u.rol !== 'superadmin');
    container.removeAttribute('size');
    container.innerHTML = '<option value="">ÔÇö Seleccionar usuario ÔÇö</option>';
    _permisosUsuariosCache.forEach(u => {
      const opt = document.createElement('option');
      opt.value = u.id;
      const badge = u.permisos ? ' (personalizado)' : '';
      const label = `${u.nombre || u.usuario} ÔÇö ${_rolLabel(u.rol)}${badge}`;
      opt.textContent = label;
      opt.setAttribute('data-user-text', `${(u.nombre || '').toLowerCase()} ${(u.usuario || '').toLowerCase()} ${_rolLabel(u.rol).toLowerCase()}`);
      if (_permisosUsuarioSeleccionado && _permisosUsuarioSeleccionado.id === u.id) opt.selected = true;
      container.appendChild(opt);
    });
    if (_permisosUsuariosCache.length > 5) container.size = 8; else container.removeAttribute('size');
    _permisosFiltrarListaUsuarios();
  } catch (e) {
    container.removeAttribute('size');
    container.innerHTML = '<option value="" disabled>Error al cargar usuarios</option>';
  }
}

function _rolLabel(rol) {
  const map = { admin:'Administrador', admin_recepcion:'Admin Recepci├│n', recepcion:'Recepci├│n', auxiliar_recepcion:'Auxiliar Recepci├│n', admin_electro:'Admin Electro', electro:'Electrodiagn├│stico', tecnico_electro:'T├®cnico Electro', doctor:'Doctor', contabilidad:'Contabilidad' };
  return map[rol] || rol;
}

async function _seleccionarUsuarioPermisos(userId) {
  const editor = document.getElementById('permisosEditorSection');
  const noSel  = document.getElementById('permisosNoSeleccion');
  if (editor) editor.style.display = 'none';
  if (noSel)  noSel.style.display  = 'flex';

  try {
    const res = await apiFetch(`/api/usuarios/${userId}/permisos`);
    const data = await res.json();
    _permisosUsuarioSeleccionado = data;

    document.getElementById('permisosEditorTitle').textContent = data.nombre || data.usuario;
    document.getElementById('permisosEditorRol').textContent   = `Rol: ${_rolLabel(data.rol)}`;

    // Calcular permisos efectivos
    const rolDefaults = PERMISOS_ROL_DEFAULTS[data.rol] || null; // null = todos
    const tienePersonalizados = Array.isArray(data.permisos);
    const activos = tienePersonalizados ? new Set(data.permisos) : null;

    _renderPermisosChecklist(activos, rolDefaults);

    if (editor) editor.style.display = '';
    if (noSel)  noSel.style.display  = 'none';
  } catch (e) {
    showToast('Error al cargar permisos de usuario', 'error');
    if (editor) editor.style.display = 'none';
    if (noSel) noSel.style.display = 'flex';
  }
}

function _renderPermisosChecklist(activos, rolDefaults) {
  const container = document.getElementById('permisosChecklistContainer');
  if (!container) return;
  container.innerHTML = '';
  const sinRes = document.getElementById('permisosFiltroSinResultados');
  if (sinRes) sinRes.style.display = 'none';

  const grupos = {};
  PERMISOS_DEFS.forEach(p => {
    if (!grupos[p.grupo]) grupos[p.grupo] = [];
    grupos[p.grupo].push(p);
  });

  Object.entries(grupos).forEach(([grupo, perms]) => {
    const det = document.createElement('details');
    det.className = 'permisos-group';
    det.open = true;
    const sum = document.createElement('summary');
    sum.className = 'permisos-group-summary';
    const sumRow = document.createElement('div');
    sumRow.className = 'permisos-group-summary-row';

    const chkAll = document.createElement('input');
    chkAll.type = 'checkbox';
    chkAll.className = 'permisos-chk-group';
    chkAll.title = 'Marcar o desmarcar todo este bloque';
    chkAll.addEventListener('click', (e) => e.stopPropagation());
    chkAll.addEventListener('mousedown', (e) => e.stopPropagation());

    const title = document.createElement('span');
    title.className = 'permisos-group-title';
    title.textContent = grupo;
    const count = document.createElement('span');
    count.className = 'permisos-group-count';
    count.setAttribute('aria-label', 'Activos en este bloque');
    count.textContent = '0/0';

    sumRow.appendChild(chkAll);
    sumRow.appendChild(title);
    sumRow.appendChild(count);
    sum.appendChild(sumRow);
    det.appendChild(sum);

    const grid = document.createElement('div');
    grid.className = 'permisos-group-grid';

    perms.forEach(p => {
      const esRolDefault = rolDefaults === null || (Array.isArray(rolDefaults) && rolDefaults.includes(p.key));
      const estaActivo = activos !== null ? activos.has(p.key) : esRolDefault;
      const search = `${(p.key || '')} ${(p.label || '')}`.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

      const row = document.createElement('label');
      row.className = 'permisos-row';
      row.dataset.search = search;

      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.dataset.key = p.key;
      chk.checked = estaActivo;

      const txt = document.createElement('span');
      txt.className = 'permisos-row-text';
      txt.textContent = p.label;

      const badge = document.createElement('span');
      if (esRolDefault) {
        badge.className = 'permisos-badge-rol';
        badge.textContent = 'rol';
        badge.title = 'Incluido en el resumen de permisos del rol';
      }

      row.appendChild(chk);
      row.appendChild(txt);
      if (esRolDefault) row.appendChild(badge);
      grid.appendChild(row);
    });

    det.appendChild(grid);
    container.appendChild(det);

    const chks = grid.querySelectorAll('input[type=checkbox][data-key]');
    chkAll.addEventListener('change', () => {
      chks.forEach(c => { c.checked = chkAll.checked; });
      _permisosRefreshStats();
    });
  });

  _permisosRefreshStats();
  if (document.getElementById('permisosDefSearch')?.value) {
    _permisosAplicarFiltroDefiniciones();
  }
}

async function _guardarPermisos() {
  if (!_permisosUsuarioSeleccionado) return;
  const chks = document.querySelectorAll('#permisosChecklistContainer input[type=checkbox][data-key]');
  const permisos = Array.from(chks).filter(c => c.checked).map(c => c.dataset.key);
  const btn = document.getElementById('btnPermisosGuardar');
  setLoading(btn, true, 'Guardando...');
  try {
    const res = await apiFetch(`/api/usuarios/${_permisosUsuarioSeleccionado.id}/permisos`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permisos })
    });
    const data = await res.json();
    if (data.ok) {
      showToast('Permisos guardados correctamente', 'success');
      _permisosUsuarioSeleccionado.permisos = permisos;
      await _cargarPermisosUserList();
    } else {
      showToast(data.error || 'Error al guardar permisos', 'error');
    }
  } catch(e) { showToast('Error de conexi├│n', 'error'); }
  finally { setLoading(btn, false, 'Guardar cambios'); }
}

async function _restablecerPermisos() {
  if (!_permisosUsuarioSeleccionado) return;
  showConfirm(`┬┐Restablecer los permisos de "${_permisosUsuarioSeleccionado.nombre || _permisosUsuarioSeleccionado.usuario}" al predeterminado de su rol?\nSe eliminar├ín los permisos personalizados.`, async () => {
    const btn = document.getElementById('btnPermisosRestablecer');
    setLoading(btn, true, 'Restableciendo...');
    try {
      const res = await apiFetch(`/api/usuarios/${_permisosUsuarioSeleccionado.id}/permisos`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permisos: null })
      });
      const data = await res.json();
      if (data.ok) {
        showToast('Permisos restablecidos al rol por defecto', 'success');
        _permisosUsuarioSeleccionado.permisos = null;
        const rolDefaults = PERMISOS_ROL_DEFAULTS[_permisosUsuarioSeleccionado.rol] || null;
        _renderPermisosChecklist(null, rolDefaults);
        await _cargarPermisosUserList();
      } else {
        showToast(data.error || 'Error al restablecer', 'error');
      }
    } catch(e) { showToast('Error de conexi├│n', 'error'); }
    finally { setLoading(btn, false, 'Ôå║ Restablecer al rol'); }
  }, { okText: 'Restablecer', icon: 'Ôå║' });
}

// ========== GESTI├ôN DE USUARIOS (solo admin) ==========
async function initUsuarios() {
  $('crearUsuario').addEventListener('click', crearUsuario);

  // ÔöÇÔöÇ Navegaci├│n lateral por p├íginas ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  document.querySelectorAll('#view-usuarios .usuarios-page-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      const page = this.dataset.page;
      document.querySelectorAll('#view-usuarios .usuarios-page-btn').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      document.querySelectorAll('#view-usuarios .usuarios-page').forEach(p => p.classList.remove('active'));
      const pgEl = document.querySelector(`#view-usuarios .usuarios-page[data-usuarios-page="${page}"]`);
      if (pgEl) pgEl.classList.add('active');
      if (page === 'especialidades') initEspecialidades();
      if (page === 'permisos') initPermisosPage();
    });
  });

  // Mostrar tab de Permisos solo a superadmin
  const btnTabPermisos = document.getElementById('btnSidebarPermisos');
  if (btnTabPermisos && currentUser?.rol === 'superadmin') btnTabPermisos.style.display = '';

  // Cargar especialidades en los selects al abrir el m├│dulo
  await cargarOpcionesEspecialidad('newUserEspecialidad');
  await cargarOpcionesEspecialidad('editEspecialidad');

  // Validador de contrase├▒a en tiempo real
  const passwordInput = $('newUserPassword');
  const strengthBar = $('passwordStrengthBar');
  const strengthFill = $('passwordStrengthFill');
  const strengthText = $('passwordStrengthText');
  const requirements = $('passwordRequirements');
  
  if (passwordInput) {
    passwordInput.addEventListener('input', function() {
      const validation = validatePasswordStrength(this.value);
      
      if (this.value.length > 0) {
        // Mostrar elementos
        strengthBar.style.display = 'block';
        strengthText.style.display = 'block';
        requirements.style.display = 'block';
        
        // Actualizar barra de fortaleza
        strengthFill.style.width = validation.score + '%';
        strengthFill.style.backgroundColor = validation.strength.color;
        strengthText.textContent = `${validation.strength.icon} ${validation.strength.level} (${validation.score}%)`;
        
        // Actualizar requisitos
        const checks = {
          'length': validation.issues.includes('length') ? '[Ô£ù]' : '[Ô£ô]',
          'upper': validation.issues.includes('upper') ? '[Ô£ù]' : '[Ô£ô]',
          'lower': validation.issues.includes('lower') ? '[Ô£ù]' : '[Ô£ô]',
          'number': validation.issues.includes('number') ? '[Ô£ù]' : '[Ô£ô]',
          'special': validation.issues.includes('special') ? '[Ô£ù]' : '[Ô£ô]'
        };
        
        $('req-length')?.textContent  && ($('req-length').textContent  = checks.length  + ' M├¡nimo 8 caracteres');
        $('req-upper')?.textContent   && ($('req-upper').textContent   = checks.upper   + ' Al menos una may├║scula (A-Z)');
        $('req-lower')?.textContent   && ($('req-lower').textContent   = checks.lower   + ' Al menos una min├║scula (a-z)');
        $('req-number')?.textContent  && ($('req-number').textContent  = checks.number  + ' Al menos un n├║mero (0-9)');
        if ($('req-special')) $('req-special').textContent = checks.special + ' Al menos un s├¡mbolo (!@#$%^&* etc)';
      } else {
        strengthBar.style.display = 'none';
        strengthText.style.display = 'none';
        requirements.style.display = 'none';
      }
    });
  }
  
  // Mostrar/ocultar especialidad y consultorio seg├║n rol
  $('newUserRol').addEventListener('change', function() {
    const consultorioCol = $('consultorioCol');
    const especialidadCol = $('especialidadCol');
    const especialidadOtraCol = $('especialidadOtraCol');
    
    if (this.value === 'doctor') {
      consultorioCol.style.display = '';
      especialidadCol.style.display = '';
    } else {
      consultorioCol.style.display = 'none';
      especialidadCol.style.display = 'none';
      especialidadOtraCol.style.display = 'none';
      $('newUserConsultorio').value = '';
      $('newUserEspecialidad').value = '';
      $('newUserEspecialidadOtra').value = '';
    }
  });
  
  // Mostrar campo "Otra" si se selecciona "Otra" en especialidad
  $('newUserEspecialidad').addEventListener('change', function() {
    const especialidadOtraCol = $('especialidadOtraCol');
    if (this.value === 'Otra') {
      especialidadOtraCol.style.display = '';
      $('newUserEspecialidadOtra').focus();
    } else {
      especialidadOtraCol.style.display = 'none';
      $('newUserEspecialidadOtra').value = '';
    }
  });
  
  // Event listener para el bot├│n de Auditor├¡a
  const btnAuditoria = document.querySelector('button[onclick="abrirBusquedaAuditoria()"]');
  if (btnAuditoria) {
    btnAuditoria.addEventListener('click', function(e) {
      e.preventDefault();
      abrirBusquedaAuditoria();
    });
    console.log('[AUDIT] Event listener agregado al bot├│n de Auditor├¡a');
  } else {
    console.warn('[AUDIT] No se encontr├│ el bot├│n de Auditor├¡a');
  }
  
  // Socket: cuando cualquier usuario cambia su nombre, refrescar lista de usuarios (si est├í visible)
  if (window.socket && !window.socketUsuariosNombreListenerAdded) {
    window.socket.on('usuario:nombre-actualizado', () => {
      if ($('view-usuarios') && !$('view-usuarios').classList.contains('hidden')) cargarUsuarios();
    });
    window.socketUsuariosNombreListenerAdded = true;
  }

  await cargarUsuarios();
}

async function cargarUsuarios() {
  const tbody = $('usuariosTableBody');
  showSkeletonRows(tbody, 6, 5);
  try {
    const res = await apiFetch('/api/usuarios');
    if (res.status === 403) { showToast('No tienes permiso', 'error'); return; }
    const usuarios = await res.json();
    
    if (!usuarios.length) {
      tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state"><div class="empty-state-icon">­ƒæñ</div><p class="empty-state-title">Sin usuarios</p><p class="empty-state-subtitle">No hay usuarios registrados en el sistema</p></div></td></tr>';
      return;
    }

    // Usar setupPagination para renderizar con paginaci├│n
    setupPagination('usuarios', usuarios, renderUsuarioRow, {
      itemsPerPageDefault: 20,
      tbodyId: 'usuariosTableBody',
      containerSelector: '#usuariosTableControls'
    });
  } catch (e) { 
    showToast('Error cargando usuarios', 'error'); 
    console.error('[USUARIOS ERROR]', e);
  }
}

/**
 * Renderiza una fila de usuario en la tabla
 */
function renderUsuarioRow(tbody, u) {
  const tr = document.createElement('tr');
  const rolMap = {
    admin:     { label: 'Administrador',     bg: '#fef3c7', color: '#92400e', border: '#fde047' },
    recepcion: { label: 'Recepci\u00f3n',       bg: '#dbeafe', color: '#1d4ed8', border: '#93c5fd' },
    electro:   { label: 'Electrodiagn\u00f3stico', bg: '#ede9fe', color: '#5b21b6', border: '#c4b5fd' },
    doctor:    { label: 'Doctor',             bg: '#dcfce7', color: '#15803d', border: '#86efac' },
  };
  const rol = rolMap[u.rol] || { label: escapeHtml(u.rol), bg: '#f3f4f6', color: '#374151', border: '#d1d5db' };
  const rolBadge = `<span style="display:inline-block;padding:3px 10px;border-radius:12px;font-size:0.78rem;font-weight:600;background:${rol.bg};color:${rol.color};border:1px solid ${rol.border};white-space:nowrap">${rol.label}</span>`;
  const estadoBadgeHtml = u.activo
    ? `<span style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:12px;font-size:0.78rem;font-weight:600;background:#dcfce7;color:#15803d;border:1px solid #86efac"><span style="width:7px;height:7px;border-radius:50%;background:#16a34a;display:inline-block"></span>Activo</span>`
    : `<span style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:12px;font-size:0.78rem;font-weight:600;background:#fee2e2;color:#991b1b;border:1px solid #fca5a5"><span style="width:7px;height:7px;border-radius:50%;background:#dc2626;display:inline-block"></span>Inactivo</span>`;

  const toggleBtn = currentUser?.id !== u.id
    ? `<button class="btn-usr-toggle" data-toggle="${u.id}" data-activo="${u.activo ? 'true' : 'false'}" title="${u.activo ? 'Desactivar' : 'Activar'}"><img src="images/power.svg" alt="${u.activo ? 'Desactivar' : 'Activar'}"/></button>` : '';
  const delBtn = currentUser?.id !== u.id
    ? `<button class="btn-usr-del" data-del="${u.id}" title="Eliminar"><img src="images/delete.svg" alt="Eliminar"/></button>` : '';

  tr.innerHTML = `
    <td><span style="font-weight:500;color:#111827">${escapeHtml(u.usuario)}</span></td>
    <td>${escapeHtml(u.nombre || '-')}</td>
    <td>${rolBadge}</td>
    <td>${escapeHtml(String(u.numero_consultorio || '-'))}</td>
    <td>${estadoBadgeHtml}</td>
    <td>
      <div class="table-actions">
        <button class="btn-usr-edit" data-edit="${u.id}" title="Editar"><img src="images/edit.svg" alt="Editar"/></button>
        <button class="btn-usr-reset" data-reset="${u.id}" title="Resetear contrase\u00f1a"><img src="images/lock.svg" alt="Resetear"/></button>
        <button class="btn-usr-hist" data-historial="${u.id}" title="Ver historial"><img src="images/history.svg" alt="Historial"/></button>
        ${u.numero_consultorio ? `<button class="btn-usr-speak" data-speak="${u.numero_consultorio}" title="Reproducir consultorio ${u.numero_consultorio}"><img src="images/speaker.svg" alt="Hablar"/></button>` : ''}
        ${toggleBtn}
        ${delBtn}
      </div>
    </td>
  `;

  tr.querySelector('[data-edit]')?.addEventListener('click', () => editarUsuario(u));
  tr.querySelector('[data-speak]')?.addEventListener('click', (e) => speakConsultorio(e.target.closest('[data-speak]').dataset.speak));
  tr.querySelector('[data-historial]')?.addEventListener('click', () => verHistorialAuditoria(u.id, u.usuario));
  tr.querySelector('[data-reset]')?.addEventListener('click', (e) => {
    showConfirm(`┬┐Resetear contrase├▒a para ${u.usuario}?`, async () => {
      try {
        const r = await apiFetch(`/api/usuarios/${e.target.closest('[data-reset]').dataset.reset}/reset-password`, { method: 'PATCH' });
        const d = await r.json();
        if (d.ok) { verResetPassword(d); } else showToast(d.error||'Error', 'error');
      } catch (x) { showToast('Error', 'error'); }
    }, { okText: 'Resetear', icon: '­ƒöæ' });
  });
  tr.querySelector('[data-toggle]')?.addEventListener('click', (e) => {
    const newState = u.activo ? 'desactivar' : 'activar';
    const label = newState.charAt(0).toUpperCase() + newState.slice(1);
    showConfirm(`┬┐${label} este usuario?`, async () => {
      try {
        const r = await apiFetch(`/api/usuarios/${e.target.closest('[data-toggle]').dataset.toggle}/toggle-estado`, { method: 'PATCH' });
        const d = await r.json();
        if (d.ok) { showToast(`Usuario ${d.activo ? 'activado' : 'desactivado'}`, 'success'); cargarUsuarios(); }
        else showToast(d.error||'Error', 'error');
      } catch (x) { showToast('Error', 'error'); }
    }, { okText: label, danger: u.activo, icon: u.activo ? '­ƒÜ½' : 'Ô£à' });
  });
  tr.querySelector('[data-del]')?.addEventListener('click', (e) => {
    showConfirm('┬┐Eliminar este usuario permanentemente?', async () => {
      try {
        const r = await apiFetch(`/api/usuarios/${e.target.closest('[data-del]').dataset.del}`, { method: 'DELETE' });
        const d = await r.json();
        if (d.ok) { showToast('Usuario eliminado', 'success'); cargarUsuarios(); }
        else showToast(d.error||'Error', 'error');
      } catch (x) { showToast('Error', 'error'); }
    });
  });

  tbody.appendChild(tr);
}

// Variable global para guardar el usuario siendo editado
let usuarioEnEdicion = null;

// Abrir modal de edici├│n de usuario
function editarUsuario(u) {
  usuarioEnEdicion = u;
  $('editUsu').value = u.usuario;
  $('editNombre').value = u.nombre || '';
  $('editRol').value = u.rol || 'recepcion';
  $('editPassword').value = '';
  $('editarUsuarioError').classList.add('hidden');
  
  // Mostrar/ocultar consultorio y especialidad seg├║n rol
  mostrarConsultorioEdicion(u.rol);
  $('editConsultorio').value = u.numero_consultorio || '';
  
  // Mostrar/ocultar especialidad seg├║n rol
  mostrarEspecialidadEdicion(u.rol, u.especialidad);
  
  // Cambiar rol autom├íticamente muestra/oculta consultorio y especialidad
  // Usamos onchange (no addEventListener) para evitar acumulaci├│n de listeners al reabrir el modal
  $('editRol').onchange = function() {
    mostrarConsultorioEdicion(this.value);
    mostrarEspecialidadEdicion(this.value, null);
  };
  
  // Cambiar especialidad muestra/oculta el campo "Otra"
  const editEspSel = $('editEspecialidad');
  if (editEspSel) editEspSel.onchange = function() {
    if (this.value === 'Otra') {
      $('editEspecialidadOtraCol').style.display = '';
      $('editEspecialidadOtra').focus();
    } else {
      $('editEspecialidadOtraCol').style.display = 'none';
      $('editEspecialidadOtra').value = '';
    }
  };
  
  $('modalEditarUsuario').classList.remove('hidden');
  $('formEditarUsuario').onsubmit = guardarCambiosUsuario;
}

function mostrarConsultorioEdicion(rol) {
  const col = $('editConsultorioCol');
  if (rol === 'doctor') {
    col.style.display = '';
  } else {
    col.style.display = 'none';
    $('editConsultorio').value = '';
  }
}

function mostrarEspecialidadEdicion(rol, especialidadActual) {
  const colEspecialidad = $('editEspecialidadCol');
  const colOtra = $('editEspecialidadOtraCol');
  
  if (rol === 'doctor') {
    colEspecialidad.style.display = '';
    if (especialidadActual) {
      const sel = $('editEspecialidad');
      const optionExists = sel && Array.from(sel.options).some(o => o.value === especialidadActual);
      if (optionExists) {
        sel.value = especialidadActual;
        colOtra.style.display = 'none';
        $('editEspecialidadOtra').value = '';
      } else {
        sel.value = 'Otra';
        colOtra.style.display = '';
        $('editEspecialidadOtra').value = especialidadActual;
      }
    } else {
      $('editEspecialidad').value = '';
      colOtra.style.display = 'none';
      $('editEspecialidadOtra').value = '';
    }
  } else {
    colEspecialidad.style.display = 'none';
    colOtra.style.display = 'none';
    $('editEspecialidad').value = '';
    $('editEspecialidadOtra').value = '';
  }
}

function closeEditarUsuarioModal() {
  usuarioEnEdicion = null;
  $('modalEditarUsuario').classList.add('hidden');
}

async function verHistorialAuditoria(usuarioId, usuarioNombre) {
  try {
    const res = await apiFetch(`/api/usuarios/${usuarioId}/historial`);
    const historial = await res.json();
    
    const contenedor = $('historialContent');
    
    if (!historial || historial.length === 0) {
      contenedor.innerHTML = '<p style="padding:20px;text-align:center;color:#999">No hay cambios registrados</p>';
    } else {
      let html = `<h4 style="margin:0 0 16px 0;color:#374151">Usuario: <strong>${escapeHtml(usuarioNombre)}</strong></h4>`;
      html += '<table style="width:100%;border-collapse:collapse">';
      html += '<tr style="background:#f3f4f6"><th style="padding:12px;border:1px solid #e5e7eb;text-align:left;font-weight:600">Fecha</th><th style="padding:12px;border:1px solid #e5e7eb;text-align:left;font-weight:600">Acci├│n</th><th style="padding:12px;border:1px solid #e5e7eb;text-align:left;font-weight:600">Realizado por</th><th style="padding:12px;border:1px solid #e5e7eb;text-align:left;font-weight:600">Cambios</th></tr>';
      
      historial.forEach(h => {
        const iconos = {
          'CREAR': 'Ô£¿',
          'ACTUALIZAR': 'Ô£Å´©Å',
          'ELIMINAR': '­ƒùæ´©Å',
          'ACTIVAR': '­ƒƒó',
          'DESACTIVAR': '­ƒö┤'
        };
        const icon = iconos[h.accion] || 'ÔÇó';
        const cambios = h.cambios ? JSON.parse(h.cambios) : {};
        let cambiosHtml = '';
        
        Object.entries(cambios).forEach(([campo, valores]) => {
          const label = {
            'usuario': 'Usuario',
            'nombre': 'Nombre',
            'rol': 'Rol',
            'numero_consultorio': 'Consultorio',
            'especialidad': 'Especialidad',
            'activo': 'Estado',
            'password': 'Contrase├▒a'
          }[campo] || campo;
          
          cambiosHtml += `<div style="font-size:12px;margin:4px 0"><strong>${label}:</strong> ${valores.antes || '-'} ÔåÆ ${valores.despues || '-'}</div>`;
        });
        
        if (!cambiosHtml) cambiosHtml = '<div style="font-size:12px;color:#999">Sin detalles</div>';
        
        html += `<tr style="border-bottom:1px solid #e5e7eb;background:${h.id % 2 === 0 ? 'white' : '#f9fafb'}">
          <td style="padding:12px;border:1px solid #e5e7eb;font-size:12px">${h.fecha}</td>
          <td style="padding:12px;border:1px solid #e5e7eb;font-size:13px;font-weight:500">${icon} ${h.accion}</td>
          <td style="padding:12px;border:1px solid #e5e7eb;font-size:12px">${escapeHtml(h.usuario_admin || 'sistema')}</td>
          <td style="padding:12px;border:1px solid #e5e7eb;font-size:11px">${cambiosHtml}</td>
        </tr>`;
      });
      
      html += '</table>';
      contenedor.innerHTML = html;
    }
    
    $('modalHistorialAuditoria').classList.remove('hidden');
  } catch (e) {
    showToast('Error cargando historial', 'error');
    console.error(e);
  }
}

function closeHistorialModal() {
  $('modalHistorialAuditoria').classList.add('hidden');
}

// Mostrar contrase├▒a temporal de reset password
function verResetPassword(data) {
  const modal = $('modalResetPassword');
  $('resetPasswordUser').textContent = escapeHtml(data.usuario);
  $('resetPasswordName').textContent = escapeHtml(data.nombre || '-');
  $('resetPasswordValue').textContent = data.passwordTemporal;
  modal.classList.remove('hidden');
  
  // Copiar al portapapeles
  $('btnCopyPassword').addEventListener('click', () => {
    navigator.clipboard.writeText(data.passwordTemporal).then(() => {
      showToast('Contrase├▒a copiada al portapapeles', 'success');
    }).catch(() => {
      showToast('No se pudo copiar', 'error');
    });
  });
}

function closeResetPasswordModal() {
  $('modalResetPassword').classList.add('hidden');
}

// ========== B├ÜSQUEDA AVANZADA DE AUDITOR├ìA ==========
function abrirBusquedaAuditoria() {
  console.log('[AUDIT] Abriendo b├║squeda de auditor├¡a');
  
  // Asegurar que el modal existe
  const modal = document.getElementById('modalBusquedaAuditoria');
  console.log('[AUDIT] Modal encontrado:', !!modal);
  
  if (!modal) {
    console.error('[AUDIT] Modal de auditor├¡a NO encontrado en el DOM');
    alert('Error: No se encontr├│ el modal de auditor├¡a');
    return;
  }
  
  console.log('[AUDIT] Clases actuales del modal:', modal.className);
  
  // Remover clase hidden
  modal.classList.remove('hidden');
  
  console.log('[AUDIT] Clases despu├®s de remove:', modal.className);
  console.log('[AUDIT] Display style:', window.getComputedStyle(modal).display);
  
  // Configurar event listeners para botones del modal
  setTimeout(() => {
    console.log('[AUDIT] Configurando event listeners del modal');
    
    // Bot├│n de cerrar X
    const btnCerrar = modal.querySelector('.btn-close-modal');
    if (btnCerrar) {
      btnCerrar.removeEventListener('click', closeBusquedaAuditoriaModal);
      btnCerrar.addEventListener('click', closeBusquedaAuditoriaModal);
      console.log('[AUDIT] Event listener agregado al bot├│n de cerrar');
    } else {
      console.warn('[AUDIT] Bot├│n de cerrar no encontrado');
    }
    
    // Bot├│n Buscar
    const btnBuscar = modal.querySelector('.btn-buscar-auditoria');
    if (btnBuscar) {
      btnBuscar.removeEventListener('click', buscarAuditoria);
      btnBuscar.addEventListener('click', buscarAuditoria);
      console.log('[AUDIT] Event listener agregado al bot├│n Buscar');
    }
    
    // Bot├│n Limpiar
    const btnLimpiar = modal.querySelector('.btn-limpiar-auditoria');
    if (btnLimpiar) {
      btnLimpiar.removeEventListener('click', limpiarFiltrosAuditoria);
      btnLimpiar.addEventListener('click', limpiarFiltrosAuditoria);
      console.log('[AUDIT] Event listener agregado al bot├│n Limpiar');
    }
    
    // Bot├│n Exportar
    const btnExportar = modal.querySelector('.btn-exportar-auditoria');
    if (btnExportar) {
      btnExportar.removeEventListener('click', exportarAuditoriaCSV);
      btnExportar.addEventListener('click', exportarAuditoriaCSV);
      console.log('[AUDIT] Event listener agregado al bot├│n Exportar');
    }
    
    // Inicializar multi-select de acciones
    const elAccion = document.getElementById('filtroAccion');
    if (elAccion && !elAccion._ms && typeof initMultiSelect === 'function') {
      initMultiSelect(elAccion, { placeholder: 'Todas las acciones', onChange: () => buscarAuditoria() });
    }
    
    // Ejecutar limpieza de filtros
    limpiarFiltrosAuditoria();
    
  }, 100);
}

function closeBusquedaAuditoriaModal() {
  console.log('[AUDIT] Cerrando modal de auditor├¡a');
  const modal = document.getElementById('modalBusquedaAuditoria');
  if (modal) {
    modal.classList.add('hidden');
    console.log('[AUDIT] Modal cerrado correctamente');
  } else {
    console.error('[AUDIT] No se pudo cerrar el modal - no encontrado');
  }
}

async function buscarAuditoria() {
  try {
    console.log('[AUDIT SEARCH] Iniciando b├║squeda de auditor├¡a');
    
    // Obtener elementos del DOM
    const containerEl = document.getElementById('busquedaResultados');
    const accionEl = document.getElementById('filtroAccion');
    const desdeEl = document.getElementById('filtroDesde');
    const hastaEl = document.getElementById('filtroHasta');
    
    if (!containerEl) {
      console.error('[AUDIT SEARCH] Container no encontrado');
      showToast('Error: No se encontr├│ el contenedor de resultados', 'error');
      return;
    }
    
    containerEl.innerHTML = '<p style="text-align:center;color:#2d4a47;padding:20px">Cargando...</p>';
    
    const accion = typeof getMultiSelectValue === 'function' ? getMultiSelectValue(accionEl) : (accionEl?.value || '').trim();
    const desde = desdeEl?.value || '';
    const hasta = hastaEl?.value || '';
    
    // Construir URL con par├ímetros
    const params = new URLSearchParams();
    if (accion) params.append('accion', accion);
    if (desde) params.append('desde', desde);
    if (hasta) params.append('hasta', hasta);
    params.append('limit', 500);
    
    console.log('[AUDIT SEARCH] Par├ímetros:', {accion, desde, hasta});
    
    const res = await apiFetch(`/api/auditoria/buscar?${params.toString()}`);
    
    if (!res.ok) {
      const errorData = await res.json();
      throw new Error(errorData.error || 'Error en la b├║squeda');
    }
    
    const data = await res.json();
    
    console.log('[AUDIT SEARCH RESPONSE] Recibidos', data.results?.length || 0, 'registros');
    
    if (!data || !data.results) {
      showToast('Error: Respuesta inv├ílida del servidor', 'error');
      containerEl.innerHTML = '<p style="text-align:center;color:#dc2626;padding:20px">Error en la b├║squeda</p>';
      return;
    }
    
    const results = data.results || [];
    
    if (results.length === 0) {
      containerEl.innerHTML = '<p style="text-align:center;color:#6b7280;padding:20px">No se encontraron registros</p>';
      return;
    }

    // Crear estructura de tabla con tbody
    containerEl.innerHTML = `
      <table class="modern-table" style="font-size:0.85rem">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Acci├│n</th>
            <th>Usuario</th>
            <th>Admin</th>
            <th>Cambios</th>
          </tr>
        </thead>
        <tbody id="bodyAuditoriaTemporary">
        </tbody>
      </table>
    `;

    // Usar setupPagination para renderizar con paginaci├│n
    setupPagination('auditoria', results, renderAuditoriaRow, {
      itemsPerPageDefault: 20,
      tbodyId: 'bodyAuditoriaTemporary',
      containerSelector: '#busquedaAuditoriaControls'
    });
    
    // Guardar resultados para exportar
    window.ultimosBusquedasAuditoria = results;
    
    showToast(`Se encontraron ${results.length} registros`, 'success');
    
  } catch (e) {
    console.error('[AUDIT SEARCH ERROR]', e.message);
    showToast('Error buscando auditor├¡a: ' + e.message, 'error');
    const containerEl = document.getElementById('busquedaResultados');
    if (containerEl) {
      containerEl.innerHTML = `<p style="text-align:center;color:#dc2626;padding:20px">Error: ${escapeHtml(e.message)}</p>`;
    }
  }
}

/**
 * Renderiza una fila de auditor├¡a en la tabla
 */
function renderAuditoriaRow(tbody, r) {
  const tr = document.createElement('tr');
  
  const iconos = {
    'CREAR': 'Ô£¿',
    'ACTUALIZAR': 'Ô£Å´©Å',
    'ELIMINAR': '­ƒùæ´©Å',
    'ACTIVAR': '­ƒƒó',
    'DESACTIVAR': '­ƒö┤',
    'RESET_PASSWORD': '­ƒöæ',
    'LOGIN': '­ƒöô',
    'LOGOUT': '­ƒöÆ'
  };
  
  const icon = iconos[r.accion] || 'ÔÇó';
  const fecha = new Date(r.fecha_cambio).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });
  const cambiosHtml = formatearCambios(r.cambios);
  
  tr.innerHTML = `
    <td>${fecha}</td>
    <td><span style="font-weight:700">${icon} ${r.accion}</span></td>
    <td>${escapeHtml(r.usuario || '-')}</td>
    <td>${escapeHtml(r.usuario_admin || '-')}</td>
    <td style="max-width:200px;overflow:hidden">${cambiosHtml}</td>
  `;
  
  tbody.appendChild(tr);
}

function formatearCambios(cambios) {
  try {
    if (!cambios) return '<span style="color:#999">Sin cambios</span>';
    
    // Si es string, intentar parsear
    if (typeof cambios === 'string') {
      try {
        cambios = JSON.parse(cambios);
      } catch (e) {
        return `<span style="color:#999">${escapeHtml(cambios)}</span>`;
      }
    }
    
    // Si no hay propiedades, retornar vac├¡o
    if (!cambios || Object.keys(cambios).length === 0) {
      return '<span style="color:#999">Sin cambios</span>';
    }
    
    let html = '';
    for (const [field, changes] of Object.entries(cambios)) {
      if (changes && typeof changes === 'object') {
        const antes = escapeHtml(String(changes.antes || ''));
        const despues = escapeHtml(String(changes.despues || ''));
        html += `<div style="font-size:0.8rem;margin:4px 0;padding:4px;background:#f5f5f5;border-radius:3px"><strong>${escapeHtml(field)}:</strong> <span style="color:#999">${antes}</span> ÔåÆ <span style="color:#0369a1">${despues}</span></div>`;
      }
    }
    
    return html || '<span style="color:#999">Sin cambios</span>';
    
  } catch (e) {
    console.error('[AUDIT] Error formateando cambios:', e.message);
    return '<span style="color:#dc2626">Error al formatear</span>';
  }
}

function limpiarFiltrosAuditoria() {
  console.log('[AUDIT] Limpiando filtros de auditor├¡a');
  
  try {
    const filtroAccion = document.getElementById('filtroAccion');
    const filtroDesde = document.getElementById('filtroDesde');
    const filtroHasta = document.getElementById('filtroHasta');
    
    if (filtroAccion) {
      if (typeof clearMultiSelect === 'function') clearMultiSelect(filtroAccion);
      else filtroAccion.value = '';
      console.log('[AUDIT] Filter Acci├│n limpio');
    }
    if (filtroDesde) {
      filtroDesde.value = '';
      console.log('[AUDIT] Filter Desde limpio');
    }
    if (filtroHasta) {
      filtroHasta.value = '';
      console.log('[AUDIT] Filter Hasta limpio');
    }
    
    window.ultimosBusquedasAuditoria = [];
    
    console.log('[AUDIT] Esperando para ejecutar b├║squeda...');
    // Cargar ├║ltimos registros por defecto despu├®s de un peque├▒o delay
    setTimeout(() => {
      console.log('[AUDIT] Ejecutando b├║squeda despu├®s de limpiar filtros');
      buscarAuditoria();
    }, 200);
    
  } catch (e) {
    console.error('[AUDIT] Error limpiando filtros:', e.message);
    showToast('Error limpiando filtros: ' + e.message, 'error');
  }
}

function exportarAuditoriaCSV() {
  try {
    console.log('[AUDIT EXPORT] Iniciando exportaci├│n a CSV');
    
    const results = window.ultimosBusquedasAuditoria || [];
    if (results.length === 0) {
      showToast('No hay datos para exportar (ejecuta una b├║squeda primero)', 'warning');
      return;
    }
    
    console.log('[AUDIT EXPORT] Exportando', results.length, 'registros');
    
    // Headers del CSV
    const headers = ['Fecha', 'Acci├│n', 'Usuario Afectado', 'Admin', 'Cambios'];
    let csv = headers.join(',') + '\n';
    
    // Datos
    results.forEach(r => {
      const fecha = new Date(r.fecha_cambio).toLocaleString('es-CO');
      const usuario = (r.usuario || '-').replace(/"/g, '""').replace(/,/g, ' ');
      const admin = (r.usuario_admin || '-').replace(/"/g, '""').replace(/,/g, ' ');
      
      // Serializar cambios de manera m├ís legible
      let cambiosStr = '-';
      if (r.cambios && Object.keys(r.cambios).length > 0) {
        const cambiosParts = [];
        for (const [field, change] of Object.entries(r.cambios)) {
          cambiosParts.push(`${field}: ${change.antes} -> ${change.despues}`);
        }
        cambiosStr = cambiosParts.join('; ');
      }
      cambiosStr = cambiosStr.replace(/"/g, '""');
      
      csv += `"${fecha}","${r.accion}","${usuario}","${admin}","${cambiosStr}"\n`;
    });
    
    console.log('[AUDIT EXPORT] CSV generado, tama├▒o:', csv.length);
    
    // Crear descarga
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `auditoria_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    showToast('Auditor├¡a exportada a CSV - ' + results.length + ' registros', 'success');
    console.log('[AUDIT EXPORT] Exportaci├│n completada');
    
  } catch (e) {
    console.error('[AUDIT EXPORT ERROR]', e.message);
    showToast('Error exportando auditor├¡a: ' + e.message, 'error');
  }
}

async function guardarCambiosUsuario(e) {
  e.preventDefault();
  if (!usuarioEnEdicion) return;
  
  const nombre = $('editNombre').value.trim();
  const rol = $('editRol').value;
  const password = $('editPassword').value;
  const rol_actual = usuarioEnEdicion.rol;
  
  if (!nombre) {
    mostrarErrorEdicion('El nombre es requerido');
    return;
  }
  
  const rolesValidos = ['superadmin','admin','admin_recepcion','recepcion','admin_electro','electro','tecnico_electro','auxiliar_recepcion','doctor','contabilidad'];
  if (!rolesValidos.includes(rol)) {
    mostrarErrorEdicion('Rol inv├ílido');
    return;
  }
  
  const body = { nombre, rol };
  
  // Si el nuevo rol es doctor, pedir el n├║mero de consultorio
  if (rol === 'doctor') {
    const consultorio = $('editConsultorio').value.trim();
    if (!consultorio) {
      mostrarErrorEdicion('Consultorio es requerido para DOCTOR');
      return;
    }
    const numero = parseInt(consultorio, 10);
    if (isNaN(numero) || numero < 1) {
      mostrarErrorEdicion('Consultorio debe ser un n├║mero v├ílido');
      return;
    }
    body.numero_consultorio = numero;
    
    // Capturar especialidad
    const especialidadSelect = $('editEspecialidad').value;
    if (!especialidadSelect) {
      mostrarErrorEdicion('La especialidad es obligatoria para DOCTOR');
      return;
    }
    
    if (especialidadSelect === 'Otra') {
      const especialidadOtra = $('editEspecialidadOtra').value.trim();
      if (!especialidadOtra) {
        mostrarErrorEdicion('Por favor especifica la especialidad personalizada');
        return;
      }
      body.especialidad = especialidadOtra;
    } else {
      body.especialidad = especialidadSelect;
    }
  } else if (rol_actual === 'doctor') {
    // Si cambia de doctor a otro rol, limpiar consultorio y especialidad
    body.numero_consultorio = null;
    body.especialidad = null;
  }
  
  if (password && password.trim()) {
    body.password = hashPassword(password);
  }
  
  try {
    const res = await apiFetch(`/api/usuarios/${usuarioEnEdicion.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    
    if (data.ok) {
      showToast('Usuario actualizado', 'success');
      closeEditarUsuarioModal();
      cargarUsuarios();
    } else {
      mostrarErrorEdicion(data.error || 'Error al actualizar');
    }
  } catch (error) {
    console.error('Error editando usuario:', error);
    mostrarErrorEdicion('Error al actualizar usuario');
  }
}

function mostrarErrorEdicion(msg) {
  const err = $('editarUsuarioError');
  err.textContent = msg;
  err.classList.remove('hidden');
}

async function crearUsuario() {
  const usuario = $('newUserUsuario').value.trim();
  const password = $('newUserPassword').value;
  const nombre = $('newUserName').value.trim();
  const rol = $('newUserRol').value;
  let numero_consultorio = null;
  let especialidad = null;
  
  // Validar campos vac├¡os
  if (!usuario || !password || !nombre || !rol) { 
    showToast('Completa todos los campos', 'error'); 
    return; 
  }

  // Validar username
  const usernameValidation = validateUsername(usuario);
  if (!usernameValidation.isValid) {
    showToast('Usuario: ' + usernameValidation.messages[0], 'error');
    return;
  }

  // Validar contrase├▒a
  const passwordValidation = validatePasswordStrength(password);
  if (!passwordValidation.isValid) {
    const mensaje = passwordValidation.issues.length > 0 
      ? 'Contrase├▒a incompleta: ' + passwordValidation.issues.map(i => {
          const labels = { length: '8+ caracteres', upper: 'may├║scula', lower: 'min├║scula', number: 'n├║mero', special: 's├¡mbolo' };
          return labels[i];
        }).join(', ')
      : 'Contrase├▒a no v├ílida';
    showToast(mensaje, 'error');
    return;
  }
  
  if (rol === 'doctor') {
    const consultorioValue = $('newUserConsultorio').value.trim();
    if (!consultorioValue) {
      showToast('El n├║mero de consultorio es obligatorio para DOCTOR', 'error');
      return;
    }
    numero_consultorio = parseInt(consultorioValue, 10);
    if (isNaN(numero_consultorio) || numero_consultorio < 1) {
      showToast('El n├║mero de consultorio debe ser un n├║mero v├ílido', 'error');
      return;
    }
    
    // Obtener especialidad
    const especialidadSelect = $('newUserEspecialidad').value.trim();
    if (!especialidadSelect) {
      showToast('La especialidad es obligatoria para DOCTOR', 'error');
      return;
    }
    
    if (especialidadSelect === 'Otra') {
      especialidad = $('newUserEspecialidadOtra').value.trim();
      if (!especialidad) {
        showToast('Especifica la especialidad', 'error');
        return;
      }
    } else {
      especialidad = especialidadSelect;
    }
  }
  
  try {
    const body = { usuario, password: hashPassword(password), nombre, rol };
    if (numero_consultorio) body.numero_consultorio = numero_consultorio;
    if (especialidad) body.especialidad = especialidad;
    
    const res = await apiFetch('/api/usuarios', { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify(body) 
    });
    const data = await res.json();
    if (data.ok) { 
      showToast('Usuario creado exitosamente', 'success'); 
      $('newUserUsuario').value=''; 
      $('newUserPassword').value=''; 
      $('newUserName').value=''; 
      $('newUserConsultorio').value='';
      $('newUserEspecialidad').value='';
      $('newUserEspecialidadOtra').value='';
      $('passwordStrengthBar').style.display = 'none';
      $('passwordStrengthText').style.display = 'none';
      $('passwordRequirements').style.display = 'none';
      cargarUsuarios(); 
    } else if (data.details) {
      // Error con detalles de validaci├│n
      showToast(data.details[0] || data.error || 'Error', 'error');
    } else {
      showToast(data.error || 'Error al crear usuario', 'error');
    }
  } catch (e) { showToast('Error de conexi├│n', 'error'); }
}

function formatMoney(n){ 
  const formatted = Number(n||0).toFixed(2);
  return '$ ' + formatted.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// Devuelve los tipos de consulta cacheados para el m├®dico actualmente seleccionado.
// La BD es la ├║nica fuente de verdad; _reciboCurrentTipos se llena en cargarTiposConsultaEnRecibo.
function _getTiposParaDoctor(medicoId) {
  if (Array.isArray(window._reciboCurrentTipos) && window._reciboCurrentTipos.length > 0) {
    return window._reciboCurrentTipos;
  }
  return []; // sin cach├® ÔåÆ se esperar├í a que cargarTiposConsultaEnRecibo finalice
}

async function refreshConceptosRows() {
  const reciboTipoRadio = document.querySelector('input[name="reciboTipo"]:checked');
  const reciboTipo = reciboTipoRadio ? reciboTipoRadio.value : null;
  let opciones = [];
  let placeholderDesc = 'Seleccionar servicio';
  if (reciboTipo === 'doctor') {
    placeholderDesc = 'Seleccionar tipo de consulta';
    const medicoId = $('reciboMedico')?.value || '';
    if (Array.isArray(window._reciboCurrentTipos) && window._reciboCurrentTipos.length > 0) {
      opciones = window._reciboCurrentTipos;
    } else if (medicoId) {
      // _reciboCurrentTipos vac├¡o con m├®dico seleccionado: cargar y dejar que ese m├®todo llame refreshConceptosRows de nuevo
      await cargarTiposConsultaEnRecibo(medicoId);
      return;
    }
    // si no hay m├®dico a├║n, opciones queda vac├¡o (se mostrar├í solo el placeholder)
  } else {
    opciones = (Array.isArray(window._reciboCurrentTipos) && window._reciboCurrentTipos.length > 0)
      ? window._reciboCurrentTipos
      : await getServicios();
  }
  document.querySelectorAll('#itemsTable tbody tr').forEach(tr => {
    const tdDesc = tr.querySelector('td:first-child');
    const sel = tdDesc ? tdDesc.querySelector('.item-desc') : null;
    if (!sel) return;
    const currentVal = sel.value;
    sel.innerHTML = `<option value="">${placeholderDesc}</option>` +
      opciones.map(s => `<option value="${escapeHtml(s.nombre)}"${currentVal === s.nombre ? ' selected' : ''}>${escapeHtml(s.nombre)}</option>`).join('') +
      `<option value="custom">Personalizado...</option>`;
  });
}

async function addRow(desc='', price=0){
  const tbody = document.querySelector('#itemsTable tbody');
  const tr = document.createElement('tr');
  
  const reciboTipoRadio = document.querySelector('input[name="reciboTipo"]:checked');
  const reciboTipo = reciboTipoRadio ? reciboTipoRadio.value : null;
  let opciones, placeholderDesc;
  if (reciboTipo === 'doctor') {
    placeholderDesc = 'Seleccionar tipo de consulta';
    const medicoId = $('reciboMedico')?.value || '';
    opciones = _getTiposParaDoctor(medicoId);
    // Si no hay tipos a├║n y hay m├®dico, dispara la carga asincr├│nica
    if (opciones.length === 0 && medicoId) {
      cargarTiposConsultaEnRecibo(medicoId); // no await: actualizar├í la fila cuando termine
    }
  } else {
    opciones = await getServicios();
    placeholderDesc = 'Seleccionar servicio';
  }
  
  const descSelect = `<select class="item-desc">
    <option value="">${placeholderDesc}</option>
    ${opciones.map(s => `<option value="${escapeHtml(s.nombre).replace(/"/g, '&quot;')}" ${desc === s.nombre ? 'selected' : ''}>${escapeHtml(s.nombre)}</option>`).join('')}
    <option value="custom">Personalizado...</option>
  </select>`;
  
  const formattedPrice = price && price > 0 ? String(price).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : '';
  
  tr.innerHTML = `
    <td>${descSelect}</td>
    <td><input class="item-price" type="text" placeholder="0" value="${formattedPrice}"/></td>
    <td><button class="remove" type="button">Ô£ò</button></td>
  `;
  tbody.appendChild(tr);
  
  // Event listener para el input de precio con formateo de miles
  const priceInput = tr.querySelector('.item-price');
  priceInput.addEventListener('input', function(){
    // Remover caracteres que no sean d├¡gitos o punto decimal
    let value = this.value.replace(/[^\d.]/g, '');
    
    // Asegurar solo un punto decimal
    const parts = value.split('.');
    if(parts.length > 2) {
      value = parts[0] + '.' + parts.slice(1).join('');
    }
    
    // Limitar a 2 decimales
    if(parts[1] && parts[1].length > 2) {
      value = parts[0] + '.' + parts[1].substring(0, 2);
    }
    
    // Formatear con separador de miles
    const [integerPart, decimalPart] = value.split('.');
    const formatted = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    this.value = decimalPart ? formatted + '.' + decimalPart : formatted;
    
    recalc();
  });
  
  // Event listener para el select de descripci├│n
  const descSelect_el = tr.querySelector('.item-desc');
  descSelect_el.addEventListener('change', function(){
    const valor = this.value;
    if(valor === 'custom') {
      // Reemplazar select con input de texto personalizado
      const customDescInput = `<input class="item-desc-custom" type="text" placeholder="Descripci├│n personalizada" style="width:100%;padding:4px;border:1px solid #ccc;box-sizing:border-box" />`;
      tr.querySelector('td:first-child').innerHTML = customDescInput;
      tr.querySelector('.item-desc-custom').focus();
      // Dejar que el usuario ingrese la descripci├│n, el precio lo puede editar directamente en la columna de precio
    } else if(valor) {
      // Ya NO asignamos el precio autom├íticamente
      // El usuario debe ingresar el precio manualmente
    }
  });
  
  tr.querySelector('.remove').addEventListener('click', ()=>{ tr.remove(); recalc(); });
}

async function initItemsTable(){
  const tbody = document.querySelector('#itemsTable tbody');
  // si no hay filas, agrega una de ejemplo
  if(!tbody.children.length) await addRow();
}

function recalc(){
  const rows = document.querySelectorAll('#itemsTable tbody tr');
  let subtotal = 0;
  rows.forEach(r=>{
    const priceValue = r.querySelector('.item-price').value || '0';
    // Remover comas antes de convertir a n├║mero
    const price = Number(priceValue.replace(/,/g, ''));
    subtotal += price;
  });
  // por simplicidad IVA fijo 0% (ajusta si necesitas)
  const iva = 0;
  $('r_subtotal').textContent = formatMoney(subtotal);
  $('r_iva').textContent = formatMoney(iva);
  $('r_total').textContent = formatMoney(subtotal + iva);
}

function setDefaultDate(){
  const f = new Date().toISOString().slice(0,10);
  $('fecha').value = f;
}

async function nextNumber(){
  try {
    const res = await apiFetch('/api/recibos/next-number');
    const data = await res.json();
    $('numero').value = String(data.nextNumber).padStart(4,'0');
  } catch(e) {
    // fallback: buscar en lista del servidor
    try {
      const res2 = await apiFetch('/api/recibos');
      const arr = await res2.json();
      let maxNum = 0;
      arr.forEach(r => {
        const num = Number(r.numero);
        if(!isNaN(num) && num > maxNum && num < 10000) maxNum = num;
      });
      $('numero').value = String(maxNum + 1).padStart(4,'0');
    } catch(e2) {
      $('numero').value = '0001';
    }
  }
  updateSavedCount();
}

function collectFormData(){
  const items = [];
  document.querySelectorAll('#itemsTable tbody tr').forEach(r=>{
    const descEl = r.querySelector('.item-desc-custom') || r.querySelector('.item-desc');
    const priceValue = r.querySelector('.item-price').value || '0';
    items.push({ desc: descEl.value, price: Number(priceValue.replace(/,/g, '')) });
  });
  const subtotal = Number($('r_subtotal').textContent.replace(/[^\d.]/g, '') || 0);
  const iva     = Number($('r_iva').textContent.replace(/[^\d.]/g, '') || 0);
  const total   = Number($('r_total').textContent.replace(/[^\d.]/g, '') || 0);

  const tipoPagoRadio = document.querySelector('input[name="tipoPago"]:checked');
  const tipoPago = tipoPagoRadio ? tipoPagoRadio.value : null;
  const reciboEntidadEl = $('reciboEntidad');
  const nombreEntidad   = reciboEntidadEl ? (reciboEntidadEl.value || null) : null;

  const reciboTipoRadio = document.querySelector('input[name="reciboTipo"]:checked');
  const reciboTipo = reciboTipoRadio ? reciboTipoRadio.value : null; // 'doctor' | 'estudio'

  const medicoSel = $('reciboMedico');
  const medicoId  = (reciboTipo === 'doctor' && medicoSel && medicoSel.value) ? parseInt(medicoSel.value, 10) : null;
  const medicoNombre = (reciboTipo === 'doctor' && medicoSel && medicoSel.value)
    ? (medicoSel.options[medicoSel.selectedIndex]?.text || null)
    : (reciboTipo === 'estudio' ? 'ELECTRODIAGN├ôSTICOS' : null);

  const consultaSel = $('reciboTipoConsulta');
  const tipoConsulta = (reciboTipo === 'doctor' && consultaSel && consultaSel.value) ? consultaSel.value : null;

  const servSel = $('reciboTipoServicio');
  const tipoEstudio = (reciboTipo === 'estudio' && servSel && servSel.value) ? servSel.value : null;

  // tipoServicio unificado para guardar en BD.
  // Fallback: si ning├║n selector tiene valor, usar la descripci├│n del primer ├¡tem.
  const firstItemDesc = items.find(it => it.desc && it.desc.trim())?.desc?.trim() || null;
  const tipoServicio = tipoConsulta || tipoEstudio || firstItemDesc;

  return {
    numero: $('numero').value,
    fecha: $('fecha').value,
    cliente: [($('clienteNombres')?.value||'').trim(), ($('clienteApellidos')?.value||'').trim()].filter(Boolean).join(' '),
    doc: $('docCliente').value,
    tipoPago, nombreEntidad,
    medicoId, medicoNombre, tipoServicio,
    observ: $('observ').value,
    turnoId: $('reciboTurnoId')?.value || null,
    citaElectroId: $('reciboCitaElectroId')?.value || null,
    items, subtotal, iva, total
  };
}

function generatePreview(){
  if(!validarFormulario()) return;

  const payload = collectFormData();

  $('r_num').textContent = payload.numero;
  $('r_fecha').textContent = payload.fecha;
  $('r_cliente').textContent = payload.cliente;
  $('r_doc').textContent = payload.doc;
  $('r_observ').textContent = payload.observ;

  const rtpEl = document.getElementById('r_tipo_pago');
  if (rtpEl) rtpEl.textContent = payload.tipoPago || '-';

  const rentEl = document.getElementById('r_entidad_row');
  const rentSpan = document.getElementById('r_entidad');
  if (rentEl) rentEl.style.display = '';
  if (rentSpan) rentSpan.textContent = payload.nombreEntidad || '-';

  const tbody = document.querySelector('#r_table tbody');
  tbody.innerHTML = '';
  payload.items.forEach(it => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${escapeHtml(it.desc)}</td><td style="text-align:right">${escapeHtml(formatMoney(it.price))}</td>`;
    tbody.appendChild(tr);
  });

  recalc();

  const preview = document.getElementById('receiptPreview');
  if (preview) preview.style.display = '';

  saveToDatabase();
}

function validarFormulario(){
  const clienteNombres = $('clienteNombres')?.value.trim();
  const clienteApellidos = $('clienteApellidos')?.value.trim();
  const cliente = [clienteNombres, clienteApellidos].filter(Boolean).join(' ');
  const docCliente = $('docCliente')?.value.trim();
  const fecha = $('fecha')?.value.trim();

  if (!clienteNombres) { showToast('Por favor escribe los nombres del paciente', 'error'); return false; }
  if (!clienteApellidos) { showToast('Por favor escribe los apellidos del paciente', 'error'); return false; }
  if (!docCliente) { showToast('Por favor escribe el documento del paciente', 'error'); return false; }
  if (!fecha) { showToast('Por favor selecciona una fecha', 'error'); return false; }

  const tipoPago = document.querySelector('input[name="tipoPago"]:checked')?.value;
  if (!tipoPago) { showToast('Selecciona la forma de pago (Efectivo o Transferencia)', 'error'); return false; }

  const entidadVal = $('reciboEntidad')?.value;
  if (!entidadVal) { showToast('Selecciona la entidad de pago', 'error'); return false; }

  const reciboTipoVal = document.querySelector('input[name="reciboTipo"]:checked')?.value;
  if (!reciboTipoVal) { showToast('Selecciona el tipo de recibo (Doctor o Estudio)', 'error'); return false; }
  if (reciboTipoVal === 'doctor' && !$('reciboMedico')?.value) {
    showToast('Selecciona el m├®dico que realiz├│ la consulta', 'error'); return false;
  }
  // Para 'estudio' no se valida reciboTipoServicio (est├í oculto);
  // el servicio se elige directamente en los conceptos del cobro.

  const items = document.querySelectorAll('#itemsTable tbody tr');
  let hayItemValido = false;
  items.forEach(r => {
    const descEl = r.querySelector('.item-desc-custom') || r.querySelector('.item-desc');
    const priceValue = r.querySelector('.item-price')?.value || '0';
    const price = Number(priceValue.replace(/,/g, ''));
    if (descEl?.value.trim() && price > 0) hayItemValido = true;
  });
  if (!hayItemValido) { showToast('Agrega al menos un concepto con descripci├│n y valor', 'error'); return false; }
  return true;
}

async function saveToDatabase(){
  const payload = collectFormData();
  try {
    const body = {
      // numero no se env├¡a: el servidor lo asigna at├│micamente
      cliente: payload.cliente,
      fecha: payload.fecha,
      total: payload.total,
      data: payload,
      tipo_pago: payload.tipoPago || null,
      nombre_entidad: payload.nombreEntidad || null,
      medico_id: payload.medicoId || null,
      medico_nombre: payload.medicoNombre || (payload.citaElectroId ? 'ELECTRODIAGN├ôSTICOS' : null),
      tipo_servicio: payload.tipoServicio || null,
      turno_id: payload.turnoId ? parseInt(payload.turnoId, 10) : null,
      cita_electro_id: payload.citaElectroId ? parseInt(payload.citaElectroId, 10) : null,
      observaciones: payload.observ || null,
      estado_pago: $('reciboPendientePago')?.checked ? 'PENDIENTE' : 'PAGADO'
    };
    const res = await apiFetch('/api/recibos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const json = await res.json();
    if (json.ok) {
      // Actualizar el n├║mero con el asignado realmente por el servidor (evita duplicados concurrentes)
      if (json.numero) {
        $('numero').value = json.numero;
        const rNum = document.getElementById('r_num');
        if (rNum) rNum.textContent = json.numero;
      }
      showToast('Ô£ô Recibo guardado', 'success');
      updateSavedCount();
      nextNumber();
      cargarFiltrosUsuarios();
    } else {
      showToast('Error guardando: ' + (json.error || 'desconocido'), 'error');
    }
  } catch(e) {
    console.error(e);
    showToast('Error de conexi├│n al guardar recibo', 'error');
  }
}

function resetFormulario() {
  if ($('clienteNombres')) $('clienteNombres').value = '';
  if ($('clienteApellidos')) $('clienteApellidos').value = '';
  if ($('docCliente')) $('docCliente').value = '';
  if ($('observ')) $('observ').value = '';

  // Limpiar tipo de pago
  document.querySelectorAll('input[name="tipoPago"]').forEach(r => { r.checked = false; });
  document.getElementById('radioPagoPCard')?.classList.remove('selected');
  document.getElementById('radioPagoTCard')?.classList.remove('selected');
  if ($('reciboEntidad')) $('reciboEntidad').value = '';

  // Limpiar m├®dico, tipo de consulta y estudio
  document.querySelectorAll('input[name="reciboTipo"]').forEach(r => { r.checked = false; });
  document.getElementById('reciboTipoDocCard')?.classList.remove('selected');
  document.getElementById('reciboTipoEstCard')?.classList.remove('selected');
  document.getElementById('reciboTipoDocPanel')?.classList.add('hidden');
  document.getElementById('reciboTipoEstPanel')?.classList.add('hidden');
  if ($('reciboMedico')) $('reciboMedico').value = '';
  if ($('reciboTipoConsulta')) $('reciboTipoConsulta').innerHTML = '<option value="">Seleccionar tipo</option>';
  if ($('reciboTipoServicio')) $('reciboTipoServicio').value = '';

  // Limpiar vinculaci├│n
  if ($('reciboTurnoId')) $('reciboTurnoId').value = '';
  if ($('reciboCitaElectroId')) $('reciboCitaElectroId').value = '';

  // Limpiar tabla de items
  const tbody = document.querySelector('#itemsTable tbody');
  if (tbody) { tbody.innerHTML = ''; addRow(); }

  nextNumber();
  setDefaultDate();

  // Ocultar preview
  const preview = document.getElementById('receiptPreview');
  if (preview) preview.style.display = 'none';

  const rTbody = document.querySelector('#r_table tbody');
  if (rTbody) rTbody.innerHTML = '';
  if ($('r_cliente')) $('r_cliente').textContent = '';
  if ($('r_doc')) $('r_doc').textContent = '';
  if ($('r_observ')) $('r_observ').textContent = '';
  if ($('r_subtotal')) $('r_subtotal').textContent = '0.00';
  if ($('r_iva')) $('r_iva').textContent = '0.00';
  if ($('r_total')) $('r_total').textContent = '0.00';
}

async function abrirPDF(){
  showLoader(true);
  try {
    const res = await apiFetch('/api/recibos');
    const arr = await res.json();
    if(!arr || arr.length === 0) {
      showToast('Genera un recibo primero', 'error');
      return;
    }
    // Abrir el recibo con el ID m├ís alto (el m├ís reciente)
    let lastRecibo = arr[0];
    arr.forEach(r => {
      if(r.id > lastRecibo.id) {
        lastRecibo = r;
      }
    });
    lastReciboId = lastRecibo.id;
    
    const pdfWindow = window.open(`/api/recibos/${lastRecibo.id}/pdf`, '_blank');
    if (!pdfWindow) {
      showToast('El navegador bloque├│ la ventana emergente. Permite los popups para este sitio y vuelve a intentarlo.', 'warn');
      return;
    }
  } catch(e){
    showToast('Error al generar PDF', 'error');
  } finally {
    showLoader(false);
  }
}

// descargarPDFAnterior removed ÔÇö #downloadPDF button no longer exists in the new Recibos UI

// ---- Filtros activos para exportaci├│n ----
let _recibosLastParams = '';

async function aplicarFiltrosRecibos() {
  const btn = $('btnAplicarFiltros');
  try {
    if (btn) { btn.disabled = true; btn.textContent = 'Cargando...'; }
    const desde       = $('filtroFechaDesde')?.value     || '';
    const hasta       = $('filtroFechaHasta')?.value     || '';
    const tipoPago    = getMultiSelectValue($('filtroTipoPago'));
    const medicoId    = getMultiSelectValue($('filtroMedico'));
    const genPor      = getMultiSelectValue($('filtroGeneradoPor'));
    const entidad     = getMultiSelectValue($('filtroEntidad'));
    const tipoConsulta= getMultiSelectValue($('filtroTipoConsulta'));
    const tipoEstudio = getMultiSelectValue($('filtroEstudio'));
    const estadoPago  = $('filtroEstadoPago')?.value || '';
    const anulado     = $('filtroAnulado')?.value || '';
    const palabraClave= $('filtroPalabraClave')?.value?.trim() || '';

    const params = new URLSearchParams();
    if (desde)        params.set('fecha_desde',      desde);
    if (hasta)        params.set('fecha_hasta',      hasta);
    if (tipoPago)     params.set('tipo_pago',        tipoPago);
    if (medicoId && medicoId === 'ELECTRODIAGNOSTICOS') {
      params.set('medico_nombre', 'ELECTRODIAGN\u00d3STICOS');
    } else if (medicoId) {
      params.set('medico_id', medicoId);
    }
    if (genPor)       params.set('generado_por_id',  genPor);
    if (entidad)      params.set('nombre_entidad',   entidad);
    if (estadoPago)   params.set('estado_pago',      estadoPago);
    if (anulado)      params.set('anulado',           anulado);
    if (palabraClave) params.set('q',                palabraClave);
    const tipoServicio = tipoConsulta || tipoEstudio;
    if (tipoServicio) params.set('tipo_servicio',    tipoServicio);
    _recibosLastParams = params.toString();

    await cargarLista(_recibosLastParams);
  } catch (e) {
    console.error('[aplicarFiltrosRecibos] Error:', e);
    showToast('Error al aplicar filtros', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Aplicar filtros'; }
  }
}

function limpiarFiltrosRecibos() {
  if ($('filtroFechaDesde'))    $('filtroFechaDesde').value    = '';
  if ($('filtroFechaHasta'))    $('filtroFechaHasta').value    = '';
  clearMultiSelect($('filtroTipoPago'));
  clearMultiSelect($('filtroMedico'));
  clearMultiSelect($('filtroGeneradoPor'));
  clearMultiSelect($('filtroEntidad'));
  clearMultiSelect($('filtroTipoConsulta'));
  clearMultiSelect($('filtroEstudio'));
  if ($('filtroEstadoPago'))    $('filtroEstadoPago').value    = '';
  if ($('filtroAnulado'))       $('filtroAnulado').value       = '';
  if ($('filtroPalabraClave'))  $('filtroPalabraClave').value  = '';
  const wrap = $('filtroTipoConsultaWrap');
  if (wrap) wrap.style.display = 'none';
  _recibosLastParams = '';
  cargarLista();
}

function exportarReciboCSV() {
  const url = '/api/recibos/export/xlsx' + (_recibosLastParams ? '?' + _recibosLastParams : '');
  window.location.href = url;
}

function exportarReciboPDF() {
  const url = '/api/recibos/export/pdf-reporte' + (_recibosLastParams ? '?' + _recibosLastParams : '');
  window.open(url, '_blank');
}

async function cargarLista(queryString) {
  if (!tienePermiso('recibos.ver')) {
    updateStats([]);
    const tbody = document.getElementById('savedItems');
    if (tbody) tbody.innerHTML = '<tr><td colspan="11"><div class="empty-state"><p class="empty-state-title">Sin acceso</p><p class="empty-state-subtitle">Tu usuario no tiene permiso para ver recibos.</p></div></td></tr>';
    return;
  }
  try {
    const url = '/api/recibos' + (queryString ? '?' + queryString : '');
    const res = await apiFetch(url);
    if (!res.ok) {
      if (res.status === 401) { /* handled by apiFetch */ return; }
      if (res.status === 403) { updateStats([]); return; }
      showToast('Error al cargar recibos', 'error');
      updateStats([]);
      return;
    }
    const jsonResp = await res.json();
    const recibos = jsonResp.rows || (Array.isArray(jsonResp) ? jsonResp : []);
    const totalCount = jsonResp.totalCount || recibos.length;
    updateStats(recibos);
    const countInfo = $('recibosCountInfo');
    if (countInfo) {
      countInfo.textContent = totalCount > 0 ? `Mostrando ${recibos.length} de ${totalCount} recibos` : '';
    }
    const tbody = document.getElementById('savedItems');
    if (!tbody) return;
    tbody.innerHTML = '';

    const resumenCard = document.getElementById('reciboResumenCard');

    if (!recibos || !recibos.length) {
      tbody.innerHTML = '<tr><td colspan="11"><div class="empty-state"><div class="empty-state-icon">\uD83D\uDCCB</div><p class="empty-state-title">Sin resultados</p><p class="empty-state-subtitle">No hay recibos con los filtros aplicados</p></div></td></tr>';
      if (resumenCard) resumenCard.classList.add('hidden');
      return;
    }

    const recibosActivos = recibos.filter(r => r.anulado != 1);
    const totalMonto = recibosActivos.reduce((s, r) => s + Number(r.total||0), 0);
    const recibosPendientes = recibosActivos.filter(r => r.estado_pago === 'PENDIENTE');
    const totalPendiente = recibosPendientes.reduce((s, r) => s + Number(r.total||0), 0);
    if ($('resumenCantidad')) $('resumenCantidad').textContent = recibosActivos.length;
    if ($('resumenTotal')) $('resumenTotal').textContent = '$ ' + totalMonto.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if ($('resumenPendienteCant')) $('resumenPendienteCant').textContent = recibosPendientes.length;
    if ($('resumenPendienteTotal')) $('resumenPendienteTotal').textContent = '$ ' + totalPendiente.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const pendientesWrap = $('resumenPendientesWrap');
    if (pendientesWrap) pendientesWrap.style.display = recibosPendientes.length ? 'block' : 'none';
    if (resumenCard) resumenCard.classList.remove('hidden');

    recibos.forEach((r, idx) => {
      const tr = document.createElement('tr');
      const fecha = r.fecha ? String(r.fecha).slice(0,10) : '-';
      const total = Number(r.total||0).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const esAnulado = r.anulado == 1;
      const esPendiente = !esAnulado && r.estado_pago === 'PENDIENTE';
      const anulBadge = esAnulado
        ? `<span class="recibo-badge-anulado" title="${escapeHtml(r.anulado_razon||'')}">ANULADO</span>` : '';
      const estadoPagoBadge = esAnulado
        ? `<span class="recibo-badge-estado recibo-badge-anulado">ANULADO</span>`
        : esPendiente
          ? `<span class="recibo-badge-estado recibo-badge-pendiente">PENDIENTE</span>`
          : `<span class="recibo-badge-estado recibo-badge-pagado">PAGADO</span>`;
      if (esAnulado) {
        tr.classList.add('recibo-row-anulado');
      }

      // --- Botones de acci├│n (estilo agenda m├®dica) ---
      let acciones = `<div class="table-actions">`;
      acciones += `<a href="/api/recibos/${r.id}/pdf" target="_blank" class="btn-recibo-pdf" title="Ver PDF">
        <img src="images/pdf.svg" alt="PDF"/></a>`;
      if (tienePermiso('recibos.editar') && !esAnulado) {
        acciones += `<button class="btn-editar" data-id="${r.id}" data-medico="${escapeHtml(r.medico_nombre||'')}" data-servicio="${escapeHtml(r.tipo_servicio||'')}" data-entidad="${escapeHtml(r.nombre_entidad||'')}" data-cliente="${escapeHtml(r.cliente||'')}" title="Editar">
          <img src="images/edit.svg" alt="Editar"/></button>`;
      }
      if (tienePermiso('recibos.editar') && esPendiente) {
        acciones += `<button class="btn-recibo-pagar marcar-pagado" data-id="${r.id}" title="Marcar como pagado" aria-label="Marcar como pagado">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h13A2.5 2.5 0 0 1 21 7.5v9A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z"/>
            <path d="M3 9h18"/>
            <path d="m9 14 2 2 4-4"/>
          </svg>
        </button>`;
      }
      if (tienePermiso('recibos.anular') && !esAnulado) {
        acciones += `<button class="btn-recibo-anular anular-recibo" data-id="${r.id}" title="Anular">
          <img src="images/cancel.svg" alt="Anular"/></button>`;
      }
      if (canDeleteRecibos() && !esAnulado) {
        acciones += `<button class="btn-eliminar delete" data-id="${r.id}" title="Eliminar">
          <img src="images/delete.svg" alt="Eliminar"/></button>`;
      }
      acciones += `</div>`;

      tr.innerHTML = `
        <td>${escapeHtml(r.numero||'-')} ${anulBadge}</td>
        <td>${escapeHtml(fecha)}</td>
        <td>${escapeHtml(r.cliente||'-')}</td>
        <td>
          <span class="recibo-badge-pago ${r.tipo_pago==='Particular'?'pago-particular':r.tipo_pago?'pago-entidad':'pago-none'}">
            ${escapeHtml(r.tipo_pago||'-')}
          </span>
        </td>
        <td>${escapeHtml(r.nombre_entidad||'-')}</td>
        <td>${escapeHtml(r.medico_nombre || (r.cita_electro_id ? 'ELECTRODIAGN├ôSTICOS' : '-'))}</td>
        <td>${escapeHtml(r.tipo_servicio||'-')}</td>
        <td style="text-align:right;font-weight:600;color:${esAnulado ? '#991b1b' : '#2d4a47'}">$ ${escapeHtml(total)}</td>
        <td>${estadoPagoBadge}</td>
        <td>${escapeHtml(r.generado_por_nombre||'-')}</td>
        <td style="text-align:center">${acciones}</td>`;
      tbody.appendChild(tr);
    });

    // Listener: Editar recibo (superadmin)
    tbody.querySelectorAll('.btn-editar').forEach(b => b.addEventListener('click', e => {
      const btn = e.target.closest('.btn-editar');
      const reciboId = btn.dataset.id;
      const medico   = btn.dataset.medico   || '';
      const servicio = btn.dataset.servicio || '';
      const entidad  = btn.dataset.entidad  || '';
      const cliente  = btn.dataset.cliente  || '';
      showEditReciboModal({ id: reciboId, medico, servicio, entidad, cliente });
    }));

    // Listener: Marcar como pagado
    tbody.querySelectorAll('.marcar-pagado').forEach(b => b.addEventListener('click', e => {
      const reciboId = e.target.closest('.marcar-pagado').dataset.id;
      showConfirm('┬┐Marcar este recibo como pagado?', async () => {
        try {
          const jr = await apiFetch(`/api/recibos/${reciboId}/pagar`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' }
          }).then(r => r.json());
          if (jr.ok) {
            showToast('Recibo marcado como pagado', 'success');
            cargarLista(_recibosLastParams);
          } else {
            showToast(jr.error || 'Error al marcar como pagado', 'error');
          }
        } catch (_) { showToast('Error marcando como pagado', 'error'); }
      }, { okText: 'Pagado', cancelText: 'Cancelar', danger: false, icon: 'Ô£à' });
    }));

    // Listener: Anular recibo
    tbody.querySelectorAll('.anular-recibo').forEach(b => b.addEventListener('click', e => {
      const reciboId = e.target.closest('.anular-recibo').dataset.id;
      showPrompt('Ingrese la raz├│n de anulaci├│n de este recibo:', async (razon) => {
        try {
          const jr = await apiFetch(`/api/recibos/${reciboId}/anular`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ razon })
          }).then(r => r.json());
          if (jr.ok) { showToast('Recibo anulado correctamente', 'success'); cargarLista(_recibosLastParams); }
          else showToast(jr.error || 'Error al anular', 'error');
        } catch (_) { showToast('Error anulando recibo', 'error'); }
      }, { okText: 'Anular Recibo', cancelText: 'Cancelar', danger: true, icon: '­ƒÜ½', placeholder: 'Ej: Error en el monto, duplicado, etc.' });
    }));

    tbody.querySelectorAll('.btn-eliminar.delete').forEach(b => b.addEventListener('click', e => {
      showConfirm('┬┐Eliminar este recibo?', async () => {
        try {
          const jr = await apiFetch(`/api/recibos/${e.target.closest('.btn-eliminar').dataset.id}`, { method: 'DELETE' }).then(r => r.json());
          if (jr.ok) { showToast('Recibo eliminado', 'success'); cargarLista(_recibosLastParams); }
        } catch (_) { showToast('Error eliminando recibo', 'error'); }
      });
    }));
  } catch(e) {
    console.error(e);
    showToast('Error cargando lista', 'error');
  }
}

async function showEditReciboModal({ id, medico, servicio, entidad, cliente }) {
  // Cargar opciones en paralelo
  const [medicosRes, serviciosArr, entidadesRes] = await Promise.all([
    apiFetch('/api/medicos').then(r => r.json()).catch(() => []),
    getServicios().catch(() => []),
    apiFetch('/api/entidades').then(r => r.json()).catch(() => [])
  ]);
  const medicos = Array.isArray(medicosRes) ? medicosRes : [];
  const servicios = Array.isArray(serviciosArr) ? serviciosArr : [];
  const entidades = Array.isArray(entidadesRes) ? entidadesRes : [];

  const medicoOpts = medicos.map(m => `<option value="${escapeHtml(m.nombre)}"${m.nombre===medico?' selected':''}>${escapeHtml(m.nombre)}</option>`).join('');
  const servicioOpts = servicios.map(s => `<option value="${escapeHtml(s.nombre)}"${s.nombre===servicio?' selected':''}>${escapeHtml(s.nombre)}</option>`).join('');
  const entidadOpts = entidades.map(e => `<option value="${escapeHtml(e.nombre)}"${e.nombre===entidad?' selected':''}>${escapeHtml(e.nombre)}</option>`).join('');

  const inputStyle = 'width:100%;margin-top:4px;padding:9px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:0.9rem;background:#fff';
  const backdrop = document.createElement('div');
  backdrop.className = 'confirm-backdrop';
  backdrop.innerHTML = `
    <div class="confirm-box" style="max-width:480px;width:92%">
      <div class="confirm-icon">Ô£Å´©Å</div>
      <div class="confirm-msg" style="font-size:1rem;margin-bottom:14px">Editar Recibo</div>
      <div style="text-align:left;display:flex;flex-direction:column;gap:12px">
        <label style="font-size:0.85rem;font-weight:600;color:#374151">
          Paciente
          <input type="text" id="editReciboCliente" value="${escapeHtml(cliente)}" style="${inputStyle}" />
        </label>
        <label style="font-size:0.85rem;font-weight:600;color:#374151">
          M├®dico
          <select id="editReciboMedico" style="${inputStyle}">
            <option value="">-- Seleccionar --</option>
            ${medicoOpts}
            ${medico && !medicos.find(m=>m.nombre===medico) ? `<option value="${escapeHtml(medico)}" selected>${escapeHtml(medico)}</option>` : ''}
          </select>
        </label>
        <label style="font-size:0.85rem;font-weight:600;color:#374151">
          Servicio / Tipo consulta
          <select id="editReciboServicio" style="${inputStyle}">
            <option value="">-- Seleccionar --</option>
            ${servicioOpts}
            ${servicio && !servicios.find(s=>s.nombre===servicio) ? `<option value="${escapeHtml(servicio)}" selected>${escapeHtml(servicio)}</option>` : ''}
          </select>
        </label>
        <label style="font-size:0.85rem;font-weight:600;color:#374151">
          Entidad
          <select id="editReciboEntidad" style="${inputStyle}">
            <option value="">-- Seleccionar --</option>
            ${entidadOpts}
            ${entidad && !entidades.find(e=>e.nombre===entidad) ? `<option value="${escapeHtml(entidad)}" selected>${escapeHtml(entidad)}</option>` : ''}
          </select>
        </label>
      </div>
      <div class="confirm-actions" style="margin-top:18px">
        <button class="btn-cancel">Cancelar</button>
        <button class="btn-ok" style="background:#2d4a47">Guardar cambios</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);
  backdrop.querySelector('#editReciboCliente').focus();
  backdrop.querySelector('.btn-cancel').addEventListener('click', () => backdrop.remove());
  backdrop.querySelector('.btn-ok').addEventListener('click', async () => {
    const data = {
      cliente:        backdrop.querySelector('#editReciboCliente').value.trim(),
      medico_nombre:  backdrop.querySelector('#editReciboMedico').value,
      tipo_servicio:  backdrop.querySelector('#editReciboServicio').value,
      nombre_entidad: backdrop.querySelector('#editReciboEntidad').value
    };
    try {
      const jr = await apiFetch(`/api/recibos/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      }).then(r => r.json());
      if (jr.ok) { backdrop.remove(); showToast('Recibo actualizado', 'success'); cargarLista(_recibosLastParams); }
      else showToast(jr.error || 'Error al actualizar', 'error');
    } catch (_) { showToast('Error actualizando recibo', 'error'); }
  });
  backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });
}

function updateSavedCount() {
  const hoy = new Date().toISOString().slice(0,10);
  apiFetch(`/api/recibos?fecha_desde=${hoy}&fecha_hasta=${hoy}`)
    .then(r => r.ok ? r.json() : [])
    .then(arr => updateStats(Array.isArray(arr) ? arr : []))
    .catch(() => updateStats([]));
}

function updateStats(recibos) {
  if (!Array.isArray(recibos)) recibos = [];
  const totalHoy = recibos.reduce((sum, r) => sum + (Number(r.total)||0), 0);
  if ($('statsRecibosHoy')) $('statsRecibosHoy').textContent = recibos.length;
  if ($('statsTotalHoy')) $('statsTotalHoy').textContent = '$ ' + totalHoy.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function resetAllRecibos(){
  showConfirm('┬┐Eliminar TODOS los recibos guardados?\nEsta acci├│n no se puede deshacer.\nSolo los administradores pueden realizar esta operaci├│n.', async () => {
    showLoader(true, 'Eliminando todos los recibos...');
    try {
      const res = await apiFetch('/api/recibos/reset', { method: 'DELETE' });
      const json = await res.json();
      showLoader(false);
      if(json.ok) {
        showToast('Todos los recibos han sido eliminados', 'success');
        cargarLista();
        nextNumber();
      }
    } catch(e) {
      showLoader(false);
      showToast('Error al resetear', 'error');
      console.error(e);
    }
  }, { okText: 'Eliminar todo', icon: '­ƒùæ´©Å' });
}

// (setDefaultReportDates, generarReporteDiario, generarReporteMensual eliminados ÔÇö reemplazados por filtros en Ver Recibos)

// ============================================
// GESTIONAR CUENTA ÔÇö Mi Cuenta
// ============================================
const MC_ROL_LABELS = {
  admin: 'Administrador', recepcion: 'Recepci├│n', electro: 'Electro',
  doctor: 'Doctor', contabilidad: 'Contabilidad'
};

async function openCambiarContrasenaModal() {
  const modal = $('modalCambiarContrasena');
  if (!modal) return;

  // Reset ambos formularios y errores
  $('formCambiarNombre')?.reset();
  $('formCambiarContrasena')?.reset();
  $('cambiarNombreError')?.classList.add('hidden');
  $('cambiarContrasenaError')?.classList.add('hidden');
  if ($('cambiarContrasenaRequirements')) $('cambiarContrasenaRequirements').style.display = 'none';

  // Activar tab Perfil
  modal.querySelectorAll('.mc-tab').forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
  modal.querySelector('[data-mc-tab="perfil"]')?.classList.add('active');
  modal.querySelector('[data-mc-tab="perfil"]')?.setAttribute('aria-selected', 'true');
  modal.querySelectorAll('.mc-panel').forEach(p => p.classList.add('hidden'));
  $('mc-panel-perfil')?.classList.remove('hidden');

  modal.classList.remove('hidden');

  // Cargar perfil desde el servidor
  try {
    const res = await apiFetch('/api/mi-cuenta');
    if (!res.ok) return;
    const d = await res.json();

    // Avatar (iniciales del nombre)
    const iniciales = (d.nombre || d.usuario || '?')
      .split(' ').filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();
    if ($('mcAvatar')) $('mcAvatar').textContent = iniciales;

    // Header
    if ($('mcHeaderName')) $('mcHeaderName').textContent = d.nombre || d.usuario || 'ÔÇö';
    if ($('mcHeaderAt'))   $('mcHeaderAt').textContent   = '@' + (d.usuario || '');
    if ($('mcRolBadge'))   $('mcRolBadge').textContent   = MC_ROL_LABELS[d.rol] || d.rol || 'ÔÇö';

    // Info cards
    if ($('mcInfoUsuario')) $('mcInfoUsuario').textContent = '@' + (d.usuario || 'ÔÇö');
    if ($('mcInfoRol'))     $('mcInfoRol').textContent     = MC_ROL_LABELS[d.rol] || d.rol || 'ÔÇö';

    // Especialidad / consultorio ÔÇö solo doctores
    const espCard = $('mcInfoEspCard'), consCard = $('mcInfoConsCard');
    if (d.rol === 'doctor') {
      if (espCard)  { espCard.style.display  = ''; if ($('mcInfoEspecialidad')) $('mcInfoEspecialidad').textContent = d.especialidad || 'ÔÇö'; }
      if (consCard) { consCard.style.display = ''; if ($('mcInfoConsultorio'))  $('mcInfoConsultorio').textContent  = d.numero_consultorio ? 'N┬░ ' + d.numero_consultorio : 'ÔÇö'; }
    } else {
      if (espCard)  espCard.style.display  = 'none';
      if (consCard) consCard.style.display = 'none';
    }

    // Fechas formateadas
    const fmtDate = (iso) => {
      if (!iso) return 'ÔÇö';
      const dt = new Date(iso), hoy = new Date();
      if (dt.toDateString() === hoy.toDateString())
        return 'Hoy ' + dt.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
      return dt.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
    };
    if ($('mcInfoCreado')) $('mcInfoCreado').textContent = fmtDate(d.creado_en);
    if ($('mcInfoAcceso')) $('mcInfoAcceso').textContent = d.ultimo_acceso ? fmtDate(d.ultimo_acceso) : 'Esta sesi├│n';

    // Pre-llenar campo de nombre
    if ($('cuentaNombreActual')) $('cuentaNombreActual').value = d.nombre || '';
  } catch (_) {
    if ($('cuentaNombreActual')) $('cuentaNombreActual').value = sessionStorage.getItem('nombre_usuario') || '';
  }
}

function closeCambiarContrasenaModal() {
  const modal = $('modalCambiarContrasena');
  if (modal) modal.classList.add('hidden');
  $('formCambiarNombre')?.reset();
  $('formCambiarContrasena')?.reset();
}

// Event listeners para el modal Mi Cuenta y otros modales
document.addEventListener('DOMContentLoaded', () => {

  // ÔöÇÔöÇ Mi Cuenta: cerrar, cancelar, tabs ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  const modalCC = $('modalCambiarContrasena');
  if (modalCC) {
    modalCC.querySelector('button.btn-close-modal')?.addEventListener('click', closeCambiarContrasenaModal);
    modalCC.querySelectorAll('.mc-btn-cancelar').forEach(btn =>
      btn.addEventListener('click', closeCambiarContrasenaModal)
    );
    // Tabs
    modalCC.querySelectorAll('.mc-tab').forEach(tab => {
      tab.addEventListener('click', function () {
        modalCC.querySelectorAll('.mc-tab').forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
        this.classList.add('active'); this.setAttribute('aria-selected', 'true');
        const panelId = 'mc-panel-' + this.dataset.mcTab;
        modalCC.querySelectorAll('.mc-panel').forEach(p => p.classList.add('hidden'));
        $(panelId)?.classList.remove('hidden');
      });
    });
  }

  // ÔöÇÔöÇ Formulario: cambiar nombre ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  const formNombre = $('formCambiarNombre');
  if (formNombre) {
    formNombre.addEventListener('submit', async (e) => {
      e.preventDefault();
      const nombre = $('cuentaNombreActual')?.value.trim() || '';
      const errDiv = $('cambiarNombreError');
      const showErr = (msg) => { if (errDiv) { errDiv.textContent = msg; errDiv.classList.remove('hidden'); } };
      if (!nombre) return showErr('El nombre no puede estar vac├¡o');

      const btn = formNombre.querySelector('button[type="submit"]');
      setLoading(btn, true, 'Guardando...');
      try {
        const res = await apiFetch('/api/cambiar-contrasena', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nombre })
        });
        const data = await res.json();
        if (!res.ok) return showErr(data.error || 'Error al actualizar');

        showToast('Nombre actualizado', 'success');
        sessionStorage.setItem('nombre_usuario', nombre);
        if ($('menuUserName')) $('menuUserName').textContent = nombre;
        if ($('mcHeaderName')) $('mcHeaderName').textContent = nombre;
        const iniciales = nombre.split(' ').filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();
        if ($('mcAvatar')) $('mcAvatar').textContent = iniciales;
        if (errDiv) errDiv.classList.add('hidden');
        updateSidebarUser({ ...currentUser, nombre });
        if (currentUser) currentUser.nombre = nombre;
      } catch (_) { showErr('Error de conexi├│n'); }
      finally { setLoading(btn, false); }
    });
  }

  // ÔöÇÔöÇ Formulario: cambiar contrase├▒a ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  const formPwd = $('formCambiarContrasena');
  if (formPwd) {
    formPwd.addEventListener('submit', async (e) => {
      e.preventDefault();
      const contrasenaActual    = $('contrasenaActual')?.value    || '';
      const nuevaContrasena     = $('nuevaContrasena')?.value     || '';
      const confirmarContrasena = $('confirmarContrasena')?.value || '';
      const errDiv = $('cambiarContrasenaError');
      const showErr = (msg) => { if (errDiv) { errDiv.textContent = msg; errDiv.classList.remove('hidden'); } };

      if (!contrasenaActual)  return showErr('Ingresa tu contrase├▒a actual');
      if (!nuevaContrasena)   return showErr('Ingresa la nueva contrase├▒a');
      if (!confirmarContrasena) return showErr('Confirma la nueva contrase├▒a');
      if (nuevaContrasena !== confirmarContrasena) return showErr('Las contrase├▒as no coinciden');
      if (nuevaContrasena.length < 6) return showErr('La contrase├▒a debe tener al menos 6 caracteres');

      const btn = formPwd.querySelector('button[type="submit"]');
      setLoading(btn, true, 'Actualizando...');
      try {
        const res = await apiFetch('/api/cambiar-contrasena', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contrasenaActual:    hashPassword(contrasenaActual),
            nuevaContrasena:     hashPassword(nuevaContrasena),
            confirmarContrasena: hashPassword(confirmarContrasena)
          })
        });
        const data = await res.json();
        if (!res.ok) return showErr(data.error || 'Error al actualizar contrase├▒a');
        showToast('Contrase├▒a actualizada correctamente', 'success');
        formPwd.reset();
        if ($('cambiarContrasenaRequirements')) $('cambiarContrasenaRequirements').style.display = 'none';
        if (errDiv) errDiv.classList.add('hidden');
      } catch (_) { showErr('Error de conexi├│n'); }
      finally { setLoading(btn, false); }
    });
  }

  // ÔöÇÔöÇ Toggle contrase├▒as (Mi Cuenta) ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  [['toggleContrasenaActual', 'contrasenaActual'],
   ['toggleNuevaContrasena',  'nuevaContrasena'],
   ['toggleConfirmarContrasena', 'confirmarContrasena'],
  ].forEach(([btnId, inputId]) => {
    const btn = $(btnId), inp = $(inputId);
    if (btn && inp) {
      btn.addEventListener('click', (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        inp.type = inp.type === 'password' ? 'text' : 'password';
      });
    }
  });

  // ÔöÇÔöÇ Requisitos de contrase├▒a en tiempo real ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  const pwdInput = $('nuevaContrasena'), reqBox = $('cambiarContrasenaRequirements');
  if (pwdInput && reqBox) {
    pwdInput.addEventListener('input', () => {
      const p = pwdInput.value;
      reqBox.style.display = p ? 'block' : 'none';
      if (p) {
        updateRequirementItem('cambiar-req-length', p.length >= 8,   'M├¡nimo 8 caracteres');
        updateRequirementItem('cambiar-req-upper',  /[A-Z]/.test(p), 'Al menos una may├║scula (A-Z)');
        updateRequirementItem('cambiar-req-lower',  /[a-z]/.test(p), 'Al menos una min├║scula (a-z)');
        updateRequirementItem('cambiar-req-number', /[0-9]/.test(p), 'Al menos un n├║mero (0-9)');
      }
    });
  }

  // ÔöÇÔöÇ Modal Editar Usuario ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  const modalEditarUsuario = $('modalEditarUsuario');
  if (modalEditarUsuario) {
    modalEditarUsuario.querySelector('button.btn-close-modal')?.addEventListener('click', closeEditarUsuarioModal);
    modalEditarUsuario.querySelectorAll('button[type="button"]').forEach(btn => {
      if (btn.textContent.includes('Cancelar')) btn.addEventListener('click', closeEditarUsuarioModal);
    });
    const toggleEditBtn = $('toggleEditPassword'), editPasswordInput = $('editPassword');
    if (toggleEditBtn && editPasswordInput) {
      toggleEditBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        const t = editPasswordInput.type === 'password' ? 'text' : 'password';
        editPasswordInput.type = t;
        toggleEditBtn.textContent = t === 'password' ? 'Mostrar' : 'Ocultar';
      });
    }
  }

  // ÔöÇÔöÇ Modal Historial ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  const modalHistorial = $('modalHistorial');
  if (modalHistorial) {
    modalHistorial.querySelector('button.btn-close-modal')?.addEventListener('click', closeHistorialModal);
    modalHistorial.querySelectorAll('button[type="button"]').forEach(btn => {
      if (btn.textContent.includes('Cerrar')) btn.addEventListener('click', closeHistorialModal);
    });
  }

  // ÔöÇÔöÇ Modal Reset Password ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  const modalResetPassword = $('modalResetPassword');
  if (modalResetPassword) {
    modalResetPassword.querySelector('button.btn-close-modal')?.addEventListener('click', closeResetPasswordModal);
    modalResetPassword.querySelectorAll('button[type="button"]').forEach(btn => {
      if (btn.textContent.includes('Entendido')) btn.addEventListener('click', closeResetPasswordModal);
    });
  }
});


// ========== GESTI├ôN DE DIAGN├ôSTICOS (solo admin) ==========
async function initDiagnosticos() {
  $('btnVolverDiagnosticos')?.addEventListener('click', goToMenu);
  $('importarDiagnosticosBtn')?.addEventListener('click', importarDiagnosticosExcel);
  await cargarListaDiagnosticos();
}

async function importarDiagnosticosExcel() {
  const fileInput = $('diagnosticosFileInput');
  if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
    showToast('Selecciona un archivo Excel', 'error');
    return;
  }

  const file = fileInput.files[0];
  const formData = new FormData();
  formData.append('file', file);

  const progressDiv = $('importProgress');
  const status = $('importStatus');
  const progressBar = $('importProgressBar');

  try {
    progressDiv.style.display = 'block';
    progressBar.style.width = '30%';
    status.textContent = 'Enviando archivo...';

    const hdr = new Headers();
    const csrf = getCsrfForRequest();
    if (csrf) hdr.set('x-csrf-token', csrf);

    const res = await fetch('/api/diagnosticos/import-excel', {
      method: 'POST',
      headers: hdr,
      body: formData,
      credentials: 'include'
    });

    progressBar.style.width = '70%';
    const data = await res.json();

    if (!res.ok) {
      progressDiv.style.display = 'none';
      showToast(data.error || 'Error importando diagn├│sticos', 'error');
      return;
    }

    progressBar.style.width = '100%';
    status.textContent = data.mensaje;
    showToast(`${data.mensaje}`, 'success');

    // Limpiar input
    fileInput.value = '';

    // Esperar 1 segundo y recargar lista
    setTimeout(() => {
      progressDiv.style.display = 'none';
      cargarListaDiagnosticos();
    }, 1000);
  } catch (e) {
    progressDiv.style.display = 'none';
    showToast('Error: ' + e.message, 'error');
    console.error(e);
  }
}

async function cargarListaDiagnosticos() {
  const tbody = $('diagnosticosTableBody');
  showSkeletonRows(tbody, 5, 5);
  try {
    const res = await apiFetch('/api/diagnosticos');
    const diagnosticos = await res.json();

    if (diagnosticos.length === 0) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state"><div class="empty-state-icon">­ƒÆ¼</div><p class="empty-state-title">Sin diagn├│sticos</p><p class="empty-state-subtitle">No hay diagn├│sticos cargados en el sistema</p></div></td></tr>';
      return;
    }

    // Usar setupPagination para renderizar con paginaci├│n
    setupPagination('diagnosticos', diagnosticos, renderDiagnosticoRow, {
      itemsPerPageDefault: 20,
      tbodyId: 'diagnosticosTableBody',
      containerSelector: '#diagnosticosTableControls'
    });
  } catch (e) {
    console.error('Error cargando diagn├│sticos:', e);
    if (tbody) tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state"><div class="empty-state-icon">ÔÜá´©Å</div><p class="empty-state-title" style="color:#dc2626">Error cargando diagn├│sticos</p></div></td></tr>';
  }
}

/**
 * Renderiza una fila de diagn├│stico en la tabla
 */
function renderDiagnosticoRow(tbody, d) {
  const tr = document.createElement('tr');
  tr.className = 'turno-row';
  tr.innerHTML = `
    <td style="padding:12px">${escapeHtml(d.codigo || '-')}</td>
    <td style="padding:12px">${escapeHtml(d.nombre)}</td>
    <td style="padding:12px">${escapeHtml(d.descripcion || '-')}</td>
    <td style="padding:12px">${d.activo === 1 ? '<span style="background:#dcfce7;color:#15803d;padding:4px 8px;border-radius:4px;font-size:0.85rem">Activo</span>' : '<span style="background:#fee2e2;color:#991b1b;padding:4px 8px;border-radius:4px;font-size:0.85rem">Inactivo</span>'}</td>
    <td style="padding:12px">
      <button class="btn-eliminar-diag btn-danger btn-sm" data-id="${d.id}">Eliminar</button>
    </td>
  `;
  
  tr.querySelector('.btn-eliminar-diag')?.addEventListener('click', (e) => {
    const id = e.target.dataset.id;
    showConfirm('┬┐Eliminar este diagn├│stico?', async () => {
      try {
        await apiFetch(`/api/diagnosticos/${id}`, { method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({activo: 0}) });
        showToast('Diagn├│stico eliminado', 'success');
        cargarListaDiagnosticos();
      } catch (x) {
        showToast('Error eliminando diagn├│stico', 'error');
      }
    });
  });
  
  tbody.appendChild(tr);
}

// ========== FUNCIONES DEL MODAL DE DETALLES DE CITA ELECTRODIAGN├ôSTICO ==========
async function iniciarEstudioModal() {
  if (!citaElectroSeleccionada) return;
  
  // VALIDACI├ôN: usar FECHA+HORA real de la cita.
  const validInicio = validarInicioElectroSegunFechaHora(citaElectroSeleccionada);
  if (!validInicio.ok) {
    showToast(`ÔØî El estudio est├í agendado para las ${validInicio.horaAgendada}. Faltan ${validInicio.faltanMinutos} minutos para poder iniciarlo.`, 'error');
    return;
  }
  
  // Mostrar modal de confirmaci├│n
  abrirModalConfirmarDuracion();
}

async function finalizarEstudioModal() {
  if (!citaElectroSeleccionada) return;
  
  // Mostrar modal de confirmaci├│n
  const modal = $('modalConfirmarFinalizarEstudio');
  if (modal) {
    modal.classList.remove('hidden');
  }
}

async function confirmarFinalizarEstudio() {
  if (!citaElectroSeleccionada) return;
  
  // Cerrar modal de confirmaci├│n
  const modal = $('modalConfirmarFinalizarEstudio');
  if (modal) {
    modal.classList.add('hidden');
  }
  
  try {
    const ahora = new Date();
    const hh = String(ahora.getHours()).padStart(2, '0');
    const mm = String(ahora.getMinutes()).padStart(2, '0');
    const horaActual = `${hh}:${mm}`;
    
    // Si el estudio ya tiene hora_fin calculada (inicio + duración) y la hora actual
    // es posterior, conservar la hora_fin original en vez de usar la hora actual.
    const horaFinExistente = citaElectroSeleccionada?.hora_fin;
    let horaFinFinal = horaActual;
    if (horaFinExistente && /^\d{2}:\d{2}$/.test(horaFinExistente)) {
      const [efH, efM] = horaFinExistente.split(':').map(Number);
      if (ahora.getHours() * 60 + ahora.getMinutes() > efH * 60 + efM) {
        horaFinFinal = horaFinExistente;
      }
    }

    const cambios = {
      estado: 'Completado',
      hora_fin: horaFinFinal
    };
    
    // Actualizar en la base de datos
    const res = await apiFetch(`/api/citas-electro/${citaElectroSeleccionada.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cambios)
    });
    
    const data = await res.json();
    
    if (data && data.ok) {
      showToast(`Estudio finalizado a las ${horaFinFinal}`, 'success');
      
      // Actualizar el objeto de la cita localmente
      citaElectroSeleccionada.estado = 'Completado';
      citaElectroSeleccionada.hora_fin = horaFinFinal;
      
      // Habilitar el select de estado ahora que se cambi├│ a "Completado"
      const selectEstado = $('modalEstado');
      if (selectEstado) {
        selectEstado.disabled = false;
        selectEstado.style.opacity = '1';
        selectEstado.style.cursor = 'pointer';
        selectEstado.value = 'Completado';
        console.log('[FINALIZAR] Select habilitado - estado "Completado"');
      }
      
      // Habilitar selector de equipo cuando se finaliza el estudio
      const selectEquipo = $('modalEquipo');
      if (selectEquipo) {
        selectEquipo.disabled = false;
        selectEquipo.style.opacity = '1';
        selectEquipo.style.cursor = 'pointer';
        console.log('[FINALIZAR] Selector de equipo habilitado');
      }
      
      // Emitir evento de socket desde el cliente
      if (window.socket && window.socket.connected) {
        window.socket.emit('electro:estudio-finalizado', {
          id: citaElectroSeleccionada.id,
          hora_fin: horaActual
        });
      }
      
      // El servidor tambi├®n emitir├í el socket event
      cargarCitasElectro();
      cerrarModalDetallesCita();
    } else {
      showToast(data?.error || 'Error finalizando estudio', 'error');
    }
  } catch (e) {
    console.error('[FINALIZAR] Error:', e);
    showToast('Error finalizando estudio', 'error');
  }
}

function cancelarFinalizarEstudio() {
  const modal = $('modalConfirmarFinalizarEstudio');
  if (modal) {
    modal.classList.add('hidden');
  }
}

// ===== FUNCIONES PARA DURACI├ôN DEL ESTUDIO =====

function abrirModalConfirmarDuracion() {
  const modal = $('modalConfirmarDuracion');
  if (modal) {
    modal.classList.remove('hidden');
  }
}

function cerrarModalConfirmarDuracion() {
  const modal = $('modalConfirmarDuracion');
  if (modal) {
    modal.classList.add('hidden');
  }
}

function abrirModalDuracionEstudio() {
  const modal = $('modalDuracionEstudio');
  if (modal) {
    modal.classList.remove('hidden');
    
    // Hora inicio: hora agendada de la cita (fija, no editable)
    const horaAgendada = citaElectroSeleccionada && citaElectroSeleccionada.hora_agendamiento
      ? citaElectroSeleccionada.hora_agendamiento.substring(0, 5)
      : (() => {
          const a = new Date();
          return `${String(a.getHours()).padStart(2,'0')}:${String(a.getMinutes()).padStart(2,'0')}`;
        })();
    $('horaEstudioInicio').value = horaAgendada;
    
    // Duraci├│n predeterminada HH:MM desde duracion_minutos de la cita
    const durPredMin = (citaElectroSeleccionada && citaElectroSeleccionada.duracion_minutos)
      ? citaElectroSeleccionada.duracion_minutos
      : (selectedEstudioDuracion || 480);
    $('durEstudioHH').value = Math.floor(durPredMin / 60);
    $('durEstudioMM').value = durPredMin % 60;
    
    actualizarHoraFinCalculada();
  }
}

function cerrarModalDuracionEstudio() {
  const modal = $('modalDuracionEstudio');
  if (modal) {
    modal.classList.add('hidden');
  }
}

function actualizarHoraFinCalculada() {
  const horaInicio = $('horaEstudioInicio').value;
  const hhDur = parseInt($('durEstudioHH').value) || 0;
  const mmDur = parseInt($('durEstudioMM').value) || 0;
  const display = $('duracionCalculada');
  
  if (!horaInicio || (hhDur === 0 && mmDur === 0)) {
    if (display) display.textContent = '-';
    return;
  }
  
  const [hhI, mmI] = horaInicio.split(':').map(Number);
  const duracionMinutos = hhDur * 60 + mmDur;
  
  // Usar Date para calcular correctamente estudios multi-d├¡a
  const start = new Date(2000, 0, 1, hhI, mmI);
  start.setMinutes(start.getMinutes() + duracionMinutos);
  
  const hhFin = String(start.getHours()).padStart(2, '0');
  const mmFin = String(start.getMinutes()).padStart(2, '0');
  const diasExtra = Math.floor((hhI * 60 + mmI + duracionMinutos) / (24 * 60));
  // Restar el d├¡a base si no cruz├│ medianoche
  const diasCruce = diasExtra > 0 ? diasExtra : 0;
  
  if (display) {
    display.textContent = `${hhFin}:${mmFin}${diasCruce > 0 ? ` (+${diasCruce} d├¡a${diasCruce > 1 ? 's' : ''})` : ''}`;
  }
}

// Alias para compatibilidad con cualquier referencia vieja
function actualizarDuracionMostrada() { actualizarHoraFinCalculada(); }

function validarInicioElectroSegunFechaHora(cita) {
  const horaAgendadaRaw = String(cita?.hora_agendamiento || '').slice(0, 5);
  if (!/^\d{2}:\d{2}$/.test(horaAgendadaRaw)) {
    return { ok: true, horaAgendada: horaAgendadaRaw };
  }

  const fechaRaw = cita?.fecha ? String(cita.fecha).slice(0, 10) : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaRaw)) {
    return { ok: true, horaAgendada: horaAgendadaRaw };
  }

  const [hh, mm] = horaAgendadaRaw.split(':').map(Number);
  const agendada = new Date(`${fechaRaw}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`);
  const ahora = new Date();

  if (Number.isNaN(agendada.getTime())) {
    return { ok: true, horaAgendada: horaAgendadaRaw };
  }

  if (ahora < agendada) {
    const faltanMinutos = Math.ceil((agendada.getTime() - ahora.getTime()) / 60000);
    return { ok: false, horaAgendada: horaAgendadaRaw, faltanMinutos };
  }

  return { ok: true, horaAgendada: horaAgendadaRaw };
}

async function confirmarDuracionEstudio() {
  
  if (!citaElectroSeleccionada) {
    showToast('Error: No hay cita seleccionada', 'error');
    return;
  }
  
  // VALIDACI├ôN: usar FECHA+HORA real de la cita (evita falsos bloqueos de citas de d├¡as previos).
  const validInicio = validarInicioElectroSegunFechaHora(citaElectroSeleccionada);
  if (!validInicio.ok) {
    showToast(`ÔØî El estudio est├í agendado para las ${validInicio.horaAgendada}. Faltan ${validInicio.faltanMinutos} minutos para poder iniciarlo.`, 'error');
    return;
  }
  
  // VALIDAR QUE SE HAYA SELECCIONADO UN EQUIPO
  const equipoSelect = $('modalEquipo');
  if (!equipoSelect || !equipoSelect.value) {
    showToast('ÔØî Debes seleccionar un equipo antes de iniciar el estudio', 'error');
    return;
  }
  
  try {
    const horaInicio = $('horaEstudioInicio').value;
    const hhDur = parseInt($('durEstudioHH').value) || 0;
    const mmDur = parseInt($('durEstudioMM').value) || 0;
    const duracionMinutos = hhDur * 60 + mmDur;
    
    if (!horaInicio) {
      showToast('No se pudo determinar la hora de inicio', 'error');
      return;
    }
    if (duracionMinutos <= 0) {
      showToast('Ingresa una duraci├│n v├ílida (HH y/o MM)', 'error');
      return;
    }
    
    // Calcular hora_fin a partir de inicio + duraci├│n usando Date (soporta multi-d├¡a)
    const [hhI, mmI] = horaInicio.split(':').map(Number);
    const fechaCitaRaw = citaElectroSeleccionada.fecha || new Date().toISOString().slice(0, 10);
    const fechaCita = typeof fechaCitaRaw === 'string' && fechaCitaRaw.length > 10 ? fechaCitaRaw.slice(0, 10) : fechaCitaRaw;
    const startDate = new Date(`${fechaCita}T${String(hhI).padStart(2,'0')}:${String(mmI).padStart(2,'0')}:00`);
    startDate.setMinutes(startDate.getMinutes() + duracionMinutos);
    const horaFin = `${String(startDate.getHours()).padStart(2,'0')}:${String(startDate.getMinutes()).padStart(2,'0')}`;
    const horaFinDate = `${startDate.getFullYear()}-${String(startDate.getMonth()+1).padStart(2,'0')}-${String(startDate.getDate()).padStart(2,'0')}`;
    const cruceMedianoche = horaFinDate !== fechaCita;
    
    console.log(`[DURACION] Iniciando estudio: ${horaInicio} ÔåÆ ${horaFin} (${duracionMinutos} min${cruceMedianoche ? `, fin: ${horaFinDate}` : ''})`);
    
    const equipoId = equipoSelect.value;
    const cambios = {
      estado: 'En Estudio',
      hora_inicio: horaInicio,
      hora_fin: horaFin,
      hora_fin_date: horaFinDate,
      duracion_minutos: duracionMinutos,
      equipo_id: equipoId
    };
    
    // Actualizar en la base de datos
    const res = await apiFetch(`/api/citas-electro/${citaElectroSeleccionada.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cambios)
    });
    
    const data = await res.json();
    
    if (data && data.ok) {
      showToast(`Estudio iniciado: ${horaInicio} - ${horaFin}`, 'success');
      
      // Actualizar el objeto de la cita localmente
      citaElectroSeleccionada.estado = 'En Estudio';
      citaElectroSeleccionada.hora_inicio = horaInicio;
      citaElectroSeleccionada.hora_fin = horaFin;
      citaElectroSeleccionada.hora_fin_date = horaFinDate;
      citaElectroSeleccionada.duracion_minutos = duracionMinutos;
      
      // BLOQUEAR el select de estado mientras est├í en "En Estudio"
      const selectEstado = $('modalEstado');
      if (selectEstado) {
        selectEstado.disabled = true;
        selectEstado.style.opacity = '0.5';
        selectEstado.style.cursor = 'not-allowed';
        selectEstado.value = 'En Estudio';
      }
      
      // BLOQUEAR el men├║ de "M├ís opciones" mientras est├í en "En Estudio"
      const btnMasOpciones = $('btnMasOpciones');
      const menuMasOpciones = $('menuMasOpciones');
      if (btnMasOpciones) {
        btnMasOpciones.disabled = true;
        btnMasOpciones.style.opacity = '0.5';
        btnMasOpciones.style.cursor = 'not-allowed';
        if (menuMasOpciones) menuMasOpciones.style.display = 'none';
      }
      
      // Emitir evento de socket desde el cliente
      if (window.socket && window.socket.connected) {
        window.socket.emit('electro:estudio-iniciado', {
          id: citaElectroSeleccionada.id,
          hora_inicio: horaInicio,
          hora_fin: horaFin,
          duracion_minutos: duracionMinutos
        });
      }
      
      // El servidor tambi├®n emitir├í el socket event
      cargarCitasElectro();
      cerrarModalDetallesCita();
      cerrarModalDuracionEstudio();
    } else {
      showToast(data?.error || 'Error iniciando estudio', 'error');
    }
  } catch (e) {
    console.error('[DURACION] Error:', e);
    showToast('Error iniciando estudio', 'error');
  }
}

async function iniciarEstudioSinDuracion() {
  
  if (!citaElectroSeleccionada) return;
  
  // VALIDACI├ôN: usar FECHA+HORA real de la cita.
  const validInicio = validarInicioElectroSegunFechaHora(citaElectroSeleccionada);
  if (!validInicio.ok) {
    showToast(`ÔØî El estudio est├í agendado para las ${validInicio.horaAgendada}. Faltan ${validInicio.faltanMinutos} minutos para poder iniciarlo.`, 'error');
    return;
  }

  const horaAgendada = String(citaElectroSeleccionada.hora_agendamiento || '').slice(0, 5);
  
  // VALIDAR QUE SE HAYA SELECCIONADO UN EQUIPO
  const equipoSelect = $('modalEquipo');
  if (!equipoSelect || !equipoSelect.value) {
    showToast('ÔØî Debes seleccionar un equipo antes de iniciar el estudio', 'error');
    return;
  }
  
  try {
    // Obtener la duraci├│n predeterminada de la cita (en minutos)
    const duracionMinutos = citaElectroSeleccionada.duracion_minutos || 480;
    
    console.log(`[DURACION_SIN] Usando duraci├│n predeterminada: ${duracionMinutos} minutos`);
    
    // Calcular hora_fin usando Date (soporta multi-d├¡a)
    const horaInicio = horaAgendada;
    const [hh_inicio, mm_inicio] = horaInicio.split(':').map(Number);
    const fechaCitaRaw = citaElectroSeleccionada.fecha || new Date().toISOString().slice(0, 10);
    const fechaCita = typeof fechaCitaRaw === 'string' && fechaCitaRaw.length > 10 ? fechaCitaRaw.slice(0, 10) : String(fechaCitaRaw);
    const startDate = new Date(`${fechaCita}T${String(hh_inicio).padStart(2,'0')}:${String(mm_inicio).padStart(2,'0')}:00`);
    startDate.setMinutes(startDate.getMinutes() + duracionMinutos);
    const horaFin = `${String(startDate.getHours()).padStart(2,'0')}:${String(startDate.getMinutes()).padStart(2,'0')}`;
    const horaFinDate = `${startDate.getFullYear()}-${String(startDate.getMonth()+1).padStart(2,'0')}-${String(startDate.getDate()).padStart(2,'0')}`;
    
    console.log(`[DURACION_SIN] Hora inicio: ${horaInicio}, Hora fin: ${horaFin}, Fecha fin: ${horaFinDate}`);
    
    const equipoId = equipoSelect.value;
    const cambios = {
      estado: 'En Estudio',
      hora_inicio: horaInicio,
      hora_fin: horaFin,
      hora_fin_date: horaFinDate,
      duracion_minutos: duracionMinutos,
      equipo_id: equipoId
    };
    
    // Actualizar en la base de datos
    const res = await apiFetch(`/api/citas-electro/${citaElectroSeleccionada.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cambios)
    });
    
    const data = await res.json();
    
    if (data && data.ok) {
      const horas = Math.floor(duracionMinutos / 60);
      const mins = duracionMinutos % 60;
      let textoHora = '';
      if (horas > 0) textoHora += `${horas}h`;
      if (mins > 0) textoHora += `${mins}m`;
      
      showToast(`Estudio iniciado a las ${horaInicio} (duraci├│n: ${textoHora})`, 'success');
      
      // Actualizar el objeto de la cita localmente
      citaElectroSeleccionada.estado = 'En Estudio';
      citaElectroSeleccionada.hora_inicio = horaInicio;
      citaElectroSeleccionada.hora_fin = horaFin;
      citaElectroSeleccionada.hora_fin_date = horaFinDate;
      citaElectroSeleccionada.duracion_minutos = duracionMinutos;
      
      // BLOQUEAR el select de estado mientras est├í en "En Estudio"
      const selectEstado = $('modalEstado');
      if (selectEstado) {
        selectEstado.disabled = true;
        selectEstado.style.opacity = '0.5';
        selectEstado.style.cursor = 'not-allowed';
        selectEstado.value = 'En Estudio';
      }
      
      // BLOQUEAR el men├║ de "M├ís opciones" mientras est├í en "En Estudio"
      const btnMasOpciones = $('btnMasOpciones');
      const menuMasOpciones = $('menuMasOpciones');
      if (btnMasOpciones) {
        btnMasOpciones.disabled = true;
        btnMasOpciones.style.opacity = '0.5';
        btnMasOpciones.style.cursor = 'not-allowed';
        if (menuMasOpciones) menuMasOpciones.style.display = 'none';
      }
      
      // Emitir evento de socket desde el cliente
      if (window.socket && window.socket.connected) {
        window.socket.emit('electro:estudio-iniciado', {
          id: citaElectroSeleccionada.id,
          hora_inicio: horaInicio,
          hora_fin: horaFin,
          duracion_minutos: duracionMinutos
        });
      }
      
      // Llamar para actualizar progreso del estudio
      cargarCitasElectro();
      cerrarModalDetallesCita();
    } else {
      showToast(data?.error || 'Error iniciando estudio', 'error');
    }
  } catch (e) {
    showToast('Error iniciando estudio', 'error');
  }
}

// Funci├│n para actualizar progreso del estudio en tiempo real
function actualizarProgresoEstudio() {
  if (!citaElectroSeleccionada || citaElectroSeleccionada.estado !== 'En Estudio') {
    return;
  }
  
  // Detener intervalo anterior si existe
  if (intervaloProgreso) {
    clearInterval(intervaloProgreso);
    intervaloProgreso = null;
  }
  
  const horaInicio = citaElectroSeleccionada.hora_inicio; // "HH:MM"
  const horaFin = citaElectroSeleccionada.hora_fin; // "HH:MM"
  
  if (!horaInicio || !horaFin) {
    return;
  }
  
  // Construir fechas absolutas de inicio y fin
  const fechaRaw = citaElectroSeleccionada.fecha || new Date().toISOString().slice(0, 10);
  const fechaBase = typeof fechaRaw === 'string' && fechaRaw.length > 10 ? fechaRaw.slice(0, 10) : String(fechaRaw);
  const [hiH, hiM] = horaInicio.split(':').map(Number);
  const dateInicio = new Date(`${fechaBase}T${String(hiH).padStart(2,'0')}:${String(hiM).padStart(2,'0')}:00`);
  
  // Fecha de fin: usar hora_fin_date si existe, sino calcular con duracion_minutos
  let dateFin;
  const horaFinDateRaw = citaElectroSeleccionada.hora_fin_date;
  const fechaFin = horaFinDateRaw ? (typeof horaFinDateRaw === 'string' && horaFinDateRaw.length > 10 ? horaFinDateRaw.slice(0, 10) : String(horaFinDateRaw)) : null;
  const [hfH, hfM] = horaFin.split(':').map(Number);
  
  if (fechaFin && fechaFin !== fechaBase) {
    // Multi-d├¡a: tenemos la fecha de fin expl├¡cita
    dateFin = new Date(`${fechaFin}T${String(hfH).padStart(2,'0')}:${String(hfM).padStart(2,'0')}:00`);
  } else if (citaElectroSeleccionada.duracion_minutos && citaElectroSeleccionada.duracion_minutos > 0) {
    // Usar duraci├│n para calcular fin
    dateFin = new Date(dateInicio.getTime() + citaElectroSeleccionada.duracion_minutos * 60000);
  } else {
    // Mismo d├¡a, calcular normalmente
    dateFin = new Date(`${fechaBase}T${String(hfH).padStart(2,'0')}:${String(hfM).padStart(2,'0')}:00`);
    // Si hora_fin <= hora_inicio, asumir que cruza medianoche (+1 d├¡a)
    if (dateFin <= dateInicio) {
      dateFin.setDate(dateFin.getDate() + 1);
    }
  }
  
  const duracionTotalMs = dateFin.getTime() - dateInicio.getTime();
  
  if (duracionTotalMs <= 0) {
    console.warn('[PROGRESO] Duraci├│n <= 0, no se puede calcular progreso');
    return;
  }
  
  // Mostrar duraci├│n total formateada en la barra
  const durTotalMin = Math.round(duracionTotalMs / 60000);
  const durDias = Math.floor(durTotalMin / (24 * 60));
  const durHrs = Math.floor((durTotalMin % (24 * 60)) / 60);
  const durMin = durTotalMin % 60;
  let durLabel = '';
  if (durDias > 0) durLabel += `${durDias}d `;
  if (durHrs > 0) durLabel += `${durHrs}h `;
  if (durMin > 0 && durDias === 0) durLabel += `${durMin}m`;
  durLabel = durLabel.trim();
  
  const horaFinEl = $('estudioHoraFin');
  if (horaFinEl) {
    const finText = formatearHora(horaFin);
    horaFinEl.textContent = fechaFin && fechaFin !== fechaBase ? `${finText} (${fechaFin})` : finText;
  }
  const horaInicioEl = $('estudioHoraInicio');
  if (horaInicioEl) horaInicioEl.textContent = formatearHora(horaInicio);
  const restanteEl = $('estudioTiempoRestante');
  if (restanteEl) restanteEl.textContent = durLabel ? `Duraci├│n ${durLabel}` : '--';
  
  let _lastSocketEmit = 0;
  
  // Actualizar cada segundo
  intervaloProgreso = setInterval(async () => {
    const ahora = new Date();
    const transcurridoMs = ahora.getTime() - dateInicio.getTime();
    const restanteMs = dateFin.getTime() - ahora.getTime();
    
    let porcentaje = (transcurridoMs / duracionTotalMs) * 100;
    porcentaje = Math.min(Math.max(porcentaje, 0), 100);
    
    // Tiempo transcurrido
    const segTranscurridos = Math.max(0, Math.floor(transcurridoMs / 1000));
    const tDias = Math.floor(segTranscurridos / 86400);
    const tHoras = Math.floor((segTranscurridos % 86400) / 3600);
    const tMinutos = Math.floor((segTranscurridos % 3600) / 60);
    const tSegundos = segTranscurridos % 60;
    
    let tiempoFormato;
    if (tDias > 0) {
      tiempoFormato = `${tDias}d ${String(tHoras).padStart(2,'0')}:${String(tMinutos).padStart(2,'0')}:${String(tSegundos).padStart(2,'0')}`;
    } else {
      tiempoFormato = `${String(tHoras).padStart(2,'0')}:${String(tMinutos).padStart(2,'0')}:${String(tSegundos).padStart(2,'0')}`;
    }
    
    // Tiempo restante
    const segRestante = Math.max(0, Math.floor(restanteMs / 1000));
    const rDias = Math.floor(segRestante / 86400);
    const rHoras = Math.floor((segRestante % 86400) / 3600);
    const rMinutos = Math.floor((segRestante % 3600) / 60);
    let restoFormato;
    if (rDias > 0) {
      restoFormato = `${rDias}d ${rHoras}h ${rMinutos}m`;
    } else if (rHoras > 0) {
      restoFormato = `${rHoras}h ${rMinutos}m`;
    } else {
      restoFormato = `${rMinutos}m`;
    }
    
    // Actualizar barra visual
    const barraLlena = $('estudioBarraLlena');
    const progreso = $('estudioProgreso');
    const tiempoTranscurrido = $('estudioTiempoTranscurrido');
    const tiempoRestante = $('estudioTiempoRestante');
    
    if (barraLlena) barraLlena.style.width = porcentaje + '%';
    if (progreso) progreso.textContent = Math.round(porcentaje);
    if (tiempoTranscurrido) tiempoTranscurrido.textContent = `${tiempoFormato} ┬À Faltan: ${restoFormato}`;
    if (tiempoRestante) tiempoRestante.textContent = `Faltan ${restoFormato}`;
    
    // Emitir socket cada 15s
    const nowMs = Date.now();
    if (window.socket && window.socket.connected && (nowMs - _lastSocketEmit >= 15000)) {
      _lastSocketEmit = nowMs;
      window.socket.emit('electro:progreso-estudio', {
        citaId: citaElectroSeleccionada.id,
        porcentaje: porcentaje,
        tiempoTranscurrido: tiempoFormato
      });
    }
    
    // Si lleg├│ al 100%, finalizar autom├íticamente
    if (porcentaje >= 100) {
      clearInterval(intervaloProgreso);
      intervaloProgreso = null;
      
      try {
        const ahora = new Date();
        const hh = String(ahora.getHours()).padStart(2, '0');
        const mm = String(ahora.getMinutes()).padStart(2, '0');
        const horaActual = `${hh}:${mm}`;
        
        const cambios = {
          estado: 'Completado',
          hora_fin: horaActual
        };
        
        const res = await apiFetch(`/api/citas-electro/${citaElectroSeleccionada.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(cambios)
        });
        
        const data = await res.json();
        
        if (data && data.ok) {
          showToast(`Estudio completado autom├íticamente a las ${horaActual}`, 'success');
          citaElectroSeleccionada.estado = 'Completado';
          citaElectroSeleccionada.hora_fin = horaActual;
          
          const estudioBarra = $('estudioBarra');
          if (estudioBarra) estudioBarra.style.display = 'none';
          
          if (window.socket && window.socket.connected) {
            window.socket.emit('electro:estudio-finalizado', {
              id: citaElectroSeleccionada.id,
              hora_fin: horaActual
            });
          }
          
          cargarCitasElectro();
          cerrarModalDetallesCita();
        }
      } catch (error) {
        console.error('[PROGRESO] Error finalizando estudio:', error);
        showToast('Error finalizando estudio autom├íticamente', 'error');
      }
    }
  }, 1000);
}

// Funci├│n para guardar edici├│n de datos del paciente desde el modal
async function guardarEdicionPaciente() {
  if (!citaElectroSeleccionada?.paciente_id) {
    showToast('No se puede identificar al paciente', 'error');
    return;
  }
  const nombre = $('editNombrePaciente').value.trim();
  const documento = $('editDocumentoPaciente').value.trim();
  const telefono = $('editTelefonoPaciente').value.trim();

  if (!nombre) { showToast('El nombre no puede estar vac├¡o', 'error'); return; }
  if (documento && !/^\d+$/.test(documento)) { showToast('El documento solo puede contener n├║meros', 'error'); return; }
  if (telefono && !/^\d{10}$/.test(telefono)) { showToast('El tel├®fono debe tener exactamente 10 d├¡gitos', 'error'); return; }

  try {
    const res = await apiFetch(`/api/pacientes/${citaElectroSeleccionada.paciente_id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre, documento, telefono })
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Error desconocido');
    // Actualizar modal y objeto local
    citaElectroSeleccionada.paciente_nombre = nombre;
    citaElectroSeleccionada.paciente_documento = documento;
    citaElectroSeleccionada.telefono = telefono;
    $('modalPacienteNombre').textContent = nombre;
    $('modalPacienteDocumento').textContent = documento;
    $('modalTelefonoDisplay').textContent = telefono;
    $('editarPacientePanel').style.display = 'none';
    showToast('Datos del paciente actualizados', 'success');
    // Refrescar lista de citas
    cargarCitasElectro();
  } catch(e) {
    showToast('Error al guardar: ' + e.message, 'error');
  }
}

// Funci├│n para enviar recomendaciones por WhatsApp
function enviarRecomendacionesWhatsApp(cita) {
  if (!cita) { showToast('Error: No hay cita seleccionada', 'error'); return; }
  if (!cita.telefono) { showToast('El paciente no tiene tel├®fono registrado', 'error'); return; }
  mostrarModalEnviarWhatsApp(cita);
}

// Variable global para guardar la informaci├│n temporalmente
let citaParaWhatsApp = null;

// Funci├│n para mostrar modal de confirmaci├│n
function mostrarModalEnviarWhatsApp(cita) {
  citaParaWhatsApp = { cita };
  // Crear modal si no existe
  let modal = $('modalEnviarWhatsApp');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modalEnviarWhatsApp';
    modal.className = 'modal hidden';
    modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);align-items:center;justify-content:center;z-index:1000;padding:20px;display:none';
    modal.innerHTML = `
      <div class="modal-content" style="background:white;border-radius:12px;padding:32px;max-width:500px;width:100%;box-shadow:0 20px 25px -5px rgba(0,0,0,0.1)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px">
          <h2 style="margin:0;color:#1f2937">Enviar Recomendaciones por WhatsApp</h2>
          <button id="cerrarModalWhatsApp" style="background:none;border:none;font-size:24px;cursor:pointer;color:#6b7280;padding:0;width:32px;height:32px;display:flex;align-items:center;justify-content:center">&times;</button>
        </div>

        <div style="margin-bottom:20px;padding:16px;background:#f3f4f6;border-radius:8px">
          <p style="margin:0 0 12px 0;font-size:0.85rem;color:#6b7280;font-weight:600">INFORMACI├ôN DEL PACIENTE</p>
          <div style="display:grid;gap:8px;font-size:0.95rem">
            <div><strong>Nombre:</strong> <span id="whatsappNombrePaciente">-</span></div>
            <div><strong>Documento:</strong> <span id="whatsappDocumento">-</span></div>
            <div><strong>Tel├®fono:</strong> <span id="whatsappTelefono">-</span></div>
          </div>
        </div>

        <div style="margin-bottom:16px;padding:12px 16px;background:#fffbeb;border-left:4px solid #f59e0b;border-radius:0 8px 8px 0;font-size:0.88rem;color:#92400e">
          ÔÜá´©Å WhatsApp Web no permite adjuntar archivos por enlace. Despu├®s de abrir el chat, adjunta el PDF de recomendaciones manualmente.
        </div>

        <div style="margin-bottom:20px">
          <label style="display:block;font-size:0.85rem;color:#6b7280;font-weight:600;margin-bottom:8px">Mensaje personalizado (opcional):</label>
          <textarea id="whatsappMensajePersonalizado" placeholder="Agregar un mensaje personalizado..." style="width:100%;padding:12px;border:1px solid #d1d5db;border-radius:6px;font-size:0.95rem;font-family:Arial,sans-serif;resize:vertical;min-height:80px"></textarea>
        </div>

        <div style="display:flex;gap:12px;justify-content:flex-end">
          <button id="btnCancelarWhatsApp" class="btn-secondary">Cancelar</button>
          <button id="btnConfirmarWhatsApp" class="btn-success">Abrir WhatsApp</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    // Event listeners
    $('cerrarModalWhatsApp').addEventListener('click', () => { modal.classList.add('hidden'); modal.style.display = 'none'; });
    $('btnCancelarWhatsApp').addEventListener('click', () => { modal.classList.add('hidden'); modal.style.display = 'none'; });
    $('btnConfirmarWhatsApp').addEventListener('click', enviarPorWhatsApp);
  }

  // Llenar datos del modal
  $('whatsappNombrePaciente').textContent = escapeHtml(cita.paciente_nombre || '-');
  $('whatsappDocumento').textContent = escapeHtml(cita.paciente_documento || '-');
  $('whatsappTelefono').textContent = escapeHtml(cita.telefono || '-');
  $('whatsappMensajePersonalizado').value = '';

  // Mostrar modal
  modal.classList.remove('hidden');
  modal.style.display = 'flex';
}

// Funci├│n para enviar por WhatsApp
function enviarPorWhatsApp() {
  if (!citaParaWhatsApp) {
    showToast('Error: No hay informaci├│n para enviar', 'error');
    return;
  }

  const cita = citaParaWhatsApp.cita;
  const mensajePersonalizado = $('whatsappMensajePersonalizado').value.trim();

  // Construir el mensaje para WhatsApp con formato correcto de fecha
  let fechaObj;
  try {
    console.log('Fecha recibida:', cita.fecha, 'Tipo:', typeof cita.fecha);
    
    // Intentar parsear la fecha de diferentes formas
    if (typeof cita.fecha === 'string') {
      // Eliminar hora si est├í incluida (formato ISO: YYYY-MM-DD HH:MM:SS)
      const soloFecha = cita.fecha.split(' ')[0];
      
      if (soloFecha.includes('-')) {
        // Formato YYYY-MM-DD
        const [year, month, day] = soloFecha.split('-');
        fechaObj = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
      } else if (soloFecha.includes('/')) {
        // Formato DD/MM/YYYY
        const [day, month, year] = soloFecha.split('/');
        fechaObj = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
      } else {
        // Intentar parseo directo
        fechaObj = new Date(cita.fecha);
      }
    } else {
      // Si es un n├║mero (timestamp)
      fechaObj = new Date(cita.fecha);
    }
    
    // Validar que sea una fecha v├ílida
    if (isNaN(fechaObj.getTime())) {
      console.error('Fecha inv├ílida despu├®s del parseo:', cita.fecha);
      throw new Error('Fecha inv├ílida');
    }
    
    console.log('Fecha parseada correctamente:', fechaObj);
  } catch (e) {
    console.error('Error parsing fecha:', e);
    showToast('Error: Formato de fecha inv├ílido', 'error');
    return;
  }

  // Formato de fecha: DD de MMMM de YYYY
  const options = { day: 'numeric', month: 'long', year: 'numeric' };
  const fechaFormato = fechaObj.toLocaleDateString('es-ES', options);

  // Asegurarse de que la fecha sea capitalizada correctamente
  const fechaCapitalizada = fechaFormato.charAt(0).toUpperCase() + fechaFormato.slice(1);

  // Mensaje predeterminado del instituto
  let mensaje = `HOLA, ${(cita.paciente_nombre || '').toUpperCase()}, INSTITUTO NEUROCIENCIAS DE NARI├æO LE INFORMA QUE:\n\n`;
  mensaje += `Tiene programada su cita para la toma de su ${cita.estudio || 'ESTUDIO'}\n`;
  mensaje += `D├ìA:  ${fechaCapitalizada.toUpperCase()}\n`;
  mensaje += `HORA:  ${cita.hora_agendamiento || '-'}\n\n`;
  mensaje += `Le recordamos que ser├í atendido por una t├®cnica especializada en electrodiagnostico.\n`;
  mensaje += `Anexo a este mensaje le enviamos las recomendaciones que debe tener en cuenta, le recordamos la direcci├│n: Carrera 34 #13-80, Barrio San Ignacio.\n`;
  mensaje += `Tel├®fonos 3053560651- 6027238141\n\n`;
  mensaje += `NOTA: no olvide traer su orden de servicio, copia de su documento de identificaci├│n y epicrisis o historia cl├¡nica.\n\n`;
  mensaje += `Le solicitamos confirmar su asistencia.\n`;
  mensaje += `Recuerde acercarse al centro comercial Valle de Atriz 2do piso y hacer la respectiva facturaci├│n con sello. Muchas Gracias.`;

  if (mensajePersonalizado) {
    mensaje += `\n\n${mensajePersonalizado}`;
  }

  // Formatear el n├║mero de tel├®fono para WhatsApp
  let numeroWhatsApp = cita.telefono.replace(/\D/g, '');
  
  if (!numeroWhatsApp.startsWith('+')) {
    if (numeroWhatsApp.length === 10) {
      numeroWhatsApp = '57' + numeroWhatsApp;
    }
    numeroWhatsApp = '+' + numeroWhatsApp;
  }

  // Abrir WhatsApp con el mensaje
  const urlWhatsApp = `https://wa.me/${numeroWhatsApp}?text=${encodeURIComponent(mensaje)}`;
  
  // Cerrar modal
  const modal = $('modalEnviarWhatsApp');
  if (modal) {
    modal.classList.add('hidden');
    modal.style.display = 'none';
  }

  // Abrir WhatsApp
  window.open(urlWhatsApp, '_blank');

  showToast('WhatsApp abierto. Recuerda adjuntar el PDF de recomendaciones manualmente.', 'success');
}

function abrirModalDetallesCita(cita) {
  citaElectroSeleccionada = { ...cita, estado: normalizarEstadoElectro(cita?.estado) };
  const puedeEditarElectro = tienePermiso('electro.editar');
  const puedeCambiarEstadoElectro = tienePermiso('electro.cambiar_estado') || puedeEditarElectro;
  
  // Activar flag para evitar cambios autom├íticos
  isInitializingElectroModal = true;
  
  // Rellenar datos de paciente
  $('modalPacienteNombre').textContent = escapeHtml(cita.paciente_nombre || '-');
  $('modalPacienteDocumento').textContent = escapeHtml(cita.paciente_documento || '-');
  
  // Rellenar usuario que program├│ y edit├│
  $('modalUsuarioProgramo').textContent = escapeHtml(cita.programado_por_nombre || '-');
  $('modalUsuarioEdito').textContent = escapeHtml(cita.editado_por_nombre || cita.programado_por_nombre || '-');

  // Nuevos campos de informaci├│n de la cita
  const $estudioEl = document.getElementById('modalEstudioDisplay');
  if ($estudioEl) $estudioEl.textContent = cita.estudio || '-';
  const $fechaEl = document.getElementById('modalFechaDisplay');
  if ($fechaEl) $fechaEl.textContent = cita.fecha ? formatearFechaISO(cita.fecha) : '-';
  const $horaEl = document.getElementById('modalHoraDisplay');
  if ($horaEl) $horaEl.textContent = cita.hora_agendamiento ? formatearHora(cita.hora_agendamiento) : '-';
  const $diagEl = document.getElementById('modalDiagnosticoDisplay');
  if ($diagEl) $diagEl.textContent = cita.diagnostico_codigo ? `${cita.diagnostico_codigo}${cita.diagnostico_nombre ? ' ÔÇô ' + cita.diagnostico_nombre : ''}` : (cita.diagnostico_nombre || '-');
  const $telEl = document.getElementById('modalTelefonoDisplay');
  if ($telEl) $telEl.textContent = cita.telefono || '-';
  
  // Duraci├│n
  const $durEl = document.getElementById('modalDuracionDisplay');
  if ($durEl) {
    if (cita.duracion_minutos) {
      const dHrs = Math.floor(cita.duracion_minutos / 60);
      const dMin = cita.duracion_minutos % 60;
      if (dHrs >= 24) {
        const dias = Math.floor(dHrs / 24);
        const hResto = dHrs % 24;
        $durEl.innerHTML = `<span class="electro-dur-badge multi-day">${dias}d ${hResto}h</span>`;
      } else if (dHrs > 0 && dMin > 0) {
        $durEl.textContent = `${dHrs}h ${dMin}min`;
      } else if (dHrs > 0) {
        $durEl.textContent = `${dHrs} horas`;
      } else {
        $durEl.textContent = `${dMin} min`;
      }
    } else {
      $durEl.textContent = '-';
    }
  }
  
  // Hora fin info
  const $hfInfoEl = document.getElementById('modalHoraFinInfoDisplay');
  if ($hfInfoEl) {
    if (cita.hora_fin) {
      let hfText = formatearHora(cita.hora_fin);
      if (cita.hora_fin_date && cita.hora_fin_date !== cita.fecha) {
        hfText += ` (${formatearFechaISO(cita.hora_fin_date)})`;
      }
      $hfInfoEl.textContent = hfText;
    } else {
      $hfInfoEl.textContent = '-';
    }
  }

  // Badge de estado en el header
  const $badgeEl = document.getElementById('modalEstadoHeaderBadge');
  if ($badgeEl) $badgeEl.innerHTML = estadoBadge(citaElectroSeleccionada.estado || 'Programado');

  // Franja de horario real (cuando la cita ya tiene hora_inicio)
  const $horarios = document.getElementById('modalInfoHorarios');
  if ($horarios) {
    if (cita.hora_inicio) {
      $horarios.style.display = 'flex';
      const $hi = document.getElementById('modalHoraInicioDisplay');
      const $hf = document.getElementById('modalHoraFinDisplay');
      if ($hi) $hi.textContent = formatearHora(cita.hora_inicio);
      if ($hf) $hf.textContent = cita.hora_fin ? formatearHora(cita.hora_fin) : '-';
    } else {
      $horarios.style.display = 'none';
    }
  }
  
  // Rellenar selector de equipo
  $('modalEquipo').value = cita.equipo_id || '';
  // Equipo solo editable con permiso de edici├│n.
  if ($('modalEquipo')) {
    $('modalEquipo').disabled = !puedeEditarElectro;
    $('modalEquipo').style.opacity = !puedeEditarElectro ? '0.5' : '1';
    $('modalEquipo').style.cursor = !puedeEditarElectro ? 'not-allowed' : 'pointer';
  }
  
  // Actualizar selector de estado oculto
  $('modalEstado').value = citaElectroSeleccionada.estado || 'Programado';
  
  // Renderizar flujo contextual de estado
  renderFlujoEstado(citaElectroSeleccionada);
  
  // Eliminar se maneja desde men├║ de 3 puntos
  const btnEliminar = $('btnEliminarCita');
  if (btnEliminar) btnEliminar.style.display = 'none';
  const btnEliminarMenu = $('btnEliminarCitaMenu');
  const esCompletado = citaElectroSeleccionada.estado === 'Completado';
  if (currentUser) {
    const rol = currentUser.rol;
    const esAdminGlobal = rol === 'admin' || rol === 'administrador' || rol === 'superadmin';
    const esAdminElectro = rol === 'admin_electro';
    if (btnEliminarMenu) btnEliminarMenu.style.display = (esAdminGlobal || (esAdminElectro && !esCompletado)) ? 'flex' : 'none';
  } else {
    if (btnEliminarMenu) btnEliminarMenu.style.display = 'none';
  }
  
  // Agregar listeners para los botones de reprogramaci├│n y adelanto
  const btnRep = $('btnReprogramarCita');
  const btnAde = $('btnAdelantarCita');
  
  console.log('[MODAL_DETALLES] btnReprogramarCita existe:', !!btnRep);
  console.log('[MODAL_DETALLES] btnAdelantarCita existe:', !!btnAde);
  
  if (btnRep && puedeEditarElectro) {
    btnRep.addEventListener('click', abrirModalReprogramar);
    console.log('[MODAL_DETALLES] Listener agregado a btnReprogramarCita');
  } else if (btnRep) {
    btnRep.style.display = 'none';
  }
  
  if (btnAde && puedeEditarElectro) {
    btnAde.addEventListener('click', abrirModalAdelantarCita);
    console.log('[MODAL_DETALLES] Listener agregado a btnAdelantarCita');
  } else if (btnAde) {
    btnAde.style.display = 'none';
  }
  
  // Configurar el men├║ de "M├ís opciones"
  const btnMasOpciones = $('btnMasOpciones');
  const menuMasOpciones = $('menuMasOpciones');
  const btnRepProgramarMenu = $('btnReprogramarCitaMenu');
  const btnAdelantarMenu = $('btnAdelantarCitaMenu');
  const btnRecomendacionesMenu = $('btnEnviarRecomendacionesMenu');
  const btnEliminarMenuAction = $('btnEliminarCitaMenu');
  
  if (btnMasOpciones) {
    btnMasOpciones.onclick = (e) => {
      e.stopPropagation();
      if (menuMasOpciones.style.display === 'none' || menuMasOpciones.style.display === '') {
        menuMasOpciones.style.display = 'block';
      } else {
        menuMasOpciones.style.display = 'none';
      }
    };
  }
  
  // Cerrar men├║ al hacer click afuera (se registra una sola vez con flag)
  if (!document._menuMasOpcionesListener) {
    document._menuMasOpcionesListener = (e) => {
      const menu = $('menuMasOpciones');
      const btn = $('btnMasOpciones');
      if (menu && btn && !menu.contains(e.target) && e.target !== btn) {
        menu.style.display = 'none';
      }
    };
    document.addEventListener('click', document._menuMasOpcionesListener);
  }
  
  // Agregar listeners a los items del men├║ (onclick para evitar acumulaci├│n)
  if (btnRepProgramarMenu && puedeEditarElectro) {
    btnRepProgramarMenu.onclick = () => {
      menuMasOpciones.style.display = 'none';
      abrirModalReprogramar();
    };
  } else if (btnRepProgramarMenu) {
    btnRepProgramarMenu.style.display = 'none';
  }
  
  if (btnAdelantarMenu && puedeEditarElectro) {
    btnAdelantarMenu.onclick = () => {
      menuMasOpciones.style.display = 'none';
      abrirModalAdelantarCita();
    };
  } else if (btnAdelantarMenu) {
    btnAdelantarMenu.style.display = 'none';
  }
  
  if (btnRecomendacionesMenu) {
    btnRecomendacionesMenu.onclick = () => {
      menuMasOpciones.style.display = 'none';
      enviarRecomendacionesWhatsApp(citaElectroSeleccionada);
    };
  }

  if (btnEliminarMenuAction) {
    btnEliminarMenuAction.onclick = () => {
      menuMasOpciones.style.display = 'none';
      if (!citaElectroSeleccionada) return;
      const nombre = (citaElectroSeleccionada.paciente_nombre || '').trim() || 'este paciente';
      $('modalEliminarNombrePaciente').textContent = nombre;
      const m = $('modalConfirmarEliminarCita');
      if (m) {
        m.classList.remove('hidden');
        m.style.display = 'flex';
      }
    };
  }
  if (!puedeEditarElectro && btnMasOpciones) {
    btnMasOpciones.style.display = 'none';
  }
  
  // Bloquear men├║ si el estado es "En Estudio"
  if (cita.estado === 'En Estudio') {
    if (btnMasOpciones) {
      btnMasOpciones.disabled = true;
      btnMasOpciones.style.opacity = '0.5';
      btnMasOpciones.style.cursor = 'not-allowed';
    }
  } else {
    if (btnMasOpciones) {
      btnMasOpciones.disabled = false;
      btnMasOpciones.style.opacity = '1';
      btnMasOpciones.style.cursor = 'pointer';
    }
  }
  
  // Mostrar/Ocultar barra de progreso
  const estudioBarra = $('estudioBarra');
  if (cita.estado === 'En Estudio' && cita.hora_inicio && cita.hora_fin) {
    if (estudioBarra) {
      estudioBarra.style.display = 'block';
      $('estudioHoraInicio').textContent = cita.hora_inicio;
      $('estudioHoraFin').textContent = cita.hora_fin;
      $('estudioProgreso').textContent = '0';
      const restanteEl = $('estudioTiempoRestante');
      if (restanteEl) restanteEl.textContent = '--';
      $('estudioBarraLlena').style.width = '0%';
    }
    // Iniciar actualizaci├│n de progreso
    actualizarProgresoEstudio();
  } else {
    if (estudioBarra) {
      estudioBarra.style.display = 'none';
    }
    // Detener el intervalo si existe
    if (intervaloProgreso) {
      clearInterval(intervaloProgreso);
      intervaloProgreso = null;
    }
  }
  
  // Desactivar flag de inicializaci├│n - Ahora es seguro procesar cambios del usuario
  isInitializingElectroModal = false;
  
  // Mostrar modal
  $('modalDetallesCitaElectro').classList.remove('hidden');
}

// ===== FLUJO CONTEXTUAL DE ESTADO =====
function renderFlujoEstado(cita) {
  const estado = normalizarEstadoElectro(cita?.estado || 'Programado');
  const flujoEl = document.getElementById('modalFlujoEstudio');
  const accionesEl = document.getElementById('modalAccionesEstudio');
  const equipoSelect = $('modalEquipo');
  const btnGuardar = $('btnGuardarCambios');
  const puedeEditarElectro = tienePermiso('electro.editar');
  const puedeCambiarEstadoElectro = tienePermiso('electro.cambiar_estado') || puedeEditarElectro;

  // Ocultar botones Iniciar/Finalizar del bloque separado (se muestran dentro del flujo)
  if (accionesEl) accionesEl.style.display = 'none';

  // Control de equipo: bloqueado si En Estudio o Pausado
  const equipoBloqueado = estado === 'En Estudio' || estado === 'Pausado' || estado === 'Completado';
  if (equipoSelect) {
    equipoSelect.disabled = equipoBloqueado;
    equipoSelect.style.opacity = equipoBloqueado ? '0.5' : '1';
    equipoSelect.style.cursor = equipoBloqueado ? 'not-allowed' : 'pointer';
  }

  if (!flujoEl) return;
  if (!puedeCambiarEstadoElectro) {
    flujoEl.innerHTML = `<div class="flujo-estado-readonly">Sin permisos para cambiar estado.</div>`;
    if (btnGuardar) btnGuardar.style.display = 'none';
    return;
  }

  const svgCheck = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`;
  const svgPlay  = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
  const svgStop  = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`;

  // Reprogramado y Adelantado se tratan como Programado (con nota informativa)
  const esReprogramadoAdelantado = estado === 'Reprogramado' || estado === 'Adelantado';
  const estadoEfectivo = esReprogramadoAdelantado ? 'Programado' : estado;

  if (estadoEfectivo === 'Programado') {
    if (equipoSelect) { equipoSelect.disabled = true; equipoSelect.style.opacity = '0.45'; equipoSelect.style.cursor = 'not-allowed'; }
    const notaReprog = esReprogramadoAdelantado
      ? `<div style="font-size:0.8rem;color:#6b7280;margin-bottom:8px;padding:6px 10px;background:#f0f9ff;border-radius:6px;border-left:3px solid #3b82f6">
           \u2139\ufe0f Cita ${estado === 'Reprogramado' ? 'reprogramada' : 'adelantada'}
         </div>`
      : '';
    flujoEl.innerHTML = `
      <div class="flujo-estado-panel">
        ${notaReprog}
        <div class="flujo-estado-label">Acci\u00f3n</div>
        <div class="flujo-btn-secondary-row">
          <button class="flujo-btn-sm confirmado" id="flujo-btn-confirmado">${svgCheck} Confirmado</button>
          <button class="flujo-btn-sm cancelar" id="flujo-btn-cancelar">Cancelar cita</button>
        </div>
      </div>`;
    document.getElementById('flujo-btn-confirmado').onclick = (ev) => cambiarEstadoCita('Confirmado', ev.currentTarget);
    document.getElementById('flujo-btn-cancelar').onclick = () => confirmarCancelacionCitaElectro();

  } else if (estado === 'Confirmado') {
    if (equipoSelect) { equipoSelect.disabled = true; equipoSelect.style.opacity = '0.45'; equipoSelect.style.cursor = 'not-allowed'; }
    flujoEl.innerHTML = `
      <div class="flujo-estado-panel">
        <div class="flujo-estado-label">Acci\u00f3n</div>
        <div class="flujo-btn-secondary-row">
          <button class="flujo-btn-sm en-sala" id="flujo-btn-ensala">${svgCheck} En Sala</button>
          <button class="flujo-btn-sm no-asistio" id="flujo-btn-noasistio">No asisti\u00f3</button>
        </div>
      </div>`;
    document.getElementById('flujo-btn-ensala').onclick = (ev) => cambiarEstadoCita('En Sala', ev.currentTarget);
    document.getElementById('flujo-btn-noasistio').onclick = (ev) => cambiarEstadoCita('No Asisti├│', ev.currentTarget);

  } else if (estado === 'En Sala') {
    // Equipo habilitado
    if (equipoSelect) { equipoSelect.disabled = false; equipoSelect.style.opacity = '1'; equipoSelect.style.cursor = 'pointer'; }
    flujoEl.innerHTML = `
      <div class="flujo-estado-panel">
        <div class="flujo-estado-label">Acci\u00f3n</div>
        <div class="flujo-btn-secondary-row">
          <button class="flujo-btn-sm iniciar" id="flujo-btn-iniciar">${svgPlay} Iniciar estudio</button>
          <button class="flujo-btn-sm no-asistio" id="flujo-btn-noasistio2">No asisti\u00f3</button>
        </div>
      </div>`;
    document.getElementById('flujo-btn-iniciar').onclick = () => iniciarEstudioModal();
    document.getElementById('flujo-btn-noasistio2').onclick = (ev) => cambiarEstadoCita('No Asisti├│', ev.currentTarget);

  } else if (estado === 'En Estudio') {
    flujoEl.innerHTML = `
      <div class="flujo-estado-panel">
        <div class="flujo-estado-label">Acci\u00f3n</div>
        <button class="flujo-btn-primary" id="flujo-btn-finalizar" style="background:linear-gradient(135deg,#22c55e,#16a34a);color:white;">
          ${svgStop} Finalizar Estudio
        </button>
        <div class="flujo-btn-secondary-row">
          <button class="flujo-btn-sm pausar" id="flujo-btn-pausar" style="background:#f59e0b;color:#78350f;border:none;font-weight:600;">
            &#9646;&#9646; Pausar estudio
          </button>
        </div>
      </div>`;
    document.getElementById('flujo-btn-finalizar').onclick = () => finalizarEstudioModal();
    document.getElementById('flujo-btn-pausar').onclick = (ev) => cambiarEstadoCita('Pausado', ev.currentTarget);

  } else if (estado === 'Pausado') {
    flujoEl.innerHTML = `
      <div class="flujo-estado-panel">
        <div class="flujo-estado-label">Estudio Pausado</div>
        <div class="flujo-btn-secondary-row">
          <button class="flujo-btn-sm iniciar" id="flujo-btn-reanudar">&#9654; Reanudar Estudio</button>
          <button class="flujo-btn-sm cancelar" id="flujo-btn-finalizar-pausado">Finalizar estudio</button>
        </div>
      </div>`;
    document.getElementById('flujo-btn-reanudar').onclick = (ev) => cambiarEstadoCita('En Estudio', ev.currentTarget);
    document.getElementById('flujo-btn-finalizar-pausado').onclick = () => finalizarEstudioModal();

  } else {
    // Completado / Cancelado / No Asisti\u00f3
    flujoEl.innerHTML = `<div class="flujo-estado-readonly">Sin acciones disponibles para este estado.</div>`;
  }

  // Guardar: ocultar en estados finales Y durante En Estudio/Pausado
  const estadosOcultar = ['Completado','Cancelado','No Asisti\u00f3','En Estudio','Pausado'];
  if (btnGuardar) btnGuardar.style.display = estadosOcultar.includes(estado) ? 'none' : '';
}

function actualizarEstadoFilaTablaElectro(citaId, nuevoEstado) {
  const st = window.paginationState && window.paginationState.citasElectro;
  if (!st || !Array.isArray(st.data)) return;
  const idStr = String(citaId);
  const idx = st.data.findIndex((c) => String(c.id) === idStr);
  if (idx < 0) return;
  const norm = normalizarEstadoElectro(nuevoEstado);
  st.data[idx] = { ...st.data[idx], estado: norm };
  renderPaginatedTable('citasElectro', renderCitaElectroRow, 'citasElectroBody');
  const containerSel = '#citasElectroTableControls';
  const container = document.querySelector(containerSel);
  if (container) {
    createPaginationControls('citasElectro', containerSel, [5, 10, 15, 20, 50], renderCitaElectroRow, 'citasElectroBody');
  }
}

function aplicarCambioCitaElectroRealtime(payload = {}) {
  const st = window.paginationState && window.paginationState.citasElectro;
  if (!st || !Array.isArray(st.data)) return;
  const id = payload?.id;
  if (!id) return;
  const idStr = String(id);
  const idx = st.data.findIndex((c) => String(c.id) === idStr);

  if (payload.type === 'eliminada' || payload.type === 'eliminado') {
    if (idx >= 0) st.data.splice(idx, 1);
  } else {
    const cambios = payload.cambios || payload;
    const next = {
      ...(idx >= 0 ? st.data[idx] : { id }),
      ...cambios
    };
    if (next.estado !== undefined) next.estado = normalizarEstadoElectro(next.estado);
    if (idx >= 0) st.data[idx] = next;
    else st.data.push(next);
  }

  st.totalPages = Math.max(1, Math.ceil(st.data.length / st.itemsPerPage));
  st.currentPage = Math.min(st.currentPage || 1, st.totalPages);
  renderPaginatedTable('citasElectro', renderCitaElectroRow, 'citasElectroBody');
  const containerSel = '#citasElectroTableControls';
  if (document.querySelector(containerSel)) {
    createPaginationControls('citasElectro', containerSel, [5, 10, 15, 20, 50], renderCitaElectroRow, 'citasElectroBody');
  }
}

window.aplicarCambioCitaElectroRealtime = aplicarCambioCitaElectroRealtime;

async function cambiarEstadoCita(nuevoEstado, triggerBtn = null) {
  if (!citaElectroSeleccionada) return;
  const estadoObjetivo = normalizarEstadoElectro(nuevoEstado);
  const originalText = triggerBtn ? triggerBtn.textContent : '';
  if (triggerBtn) {
    triggerBtn.disabled = true;
    triggerBtn.dataset.loading = '1';
    triggerBtn.textContent = 'Cargando...';
  }
  try {
    // Usar endpoint general para unificar exactamente el mismo flujo que ya funciona
    // en el resto del m├│dulo (equipos, inicio/fin estudio, etc.).
    const res = await apiFetch(`/api/citas-electro/${citaElectroSeleccionada.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ estado: estadoObjetivo })
    });
    const data = await res.json();
    if (data && data.ok) {
      // Confirmar estado persistido en servidor para evitar "rebote" visual.
      const verRes = await apiFetch(`/api/citas-electro/${citaElectroSeleccionada.id}?_t=${Date.now()}`, { cache: 'no-store' });
      const verData = await verRes.json().catch(() => null);
      const estadoPersistido = normalizarEstadoElectro(verData?.estado || estadoObjetivo);

      citaElectroSeleccionada.estado = estadoPersistido;
      $('modalEstado').value = estadoPersistido;
      const $badgeEl = document.getElementById('modalEstadoHeaderBadge');
      if ($badgeEl) $badgeEl.innerHTML = estadoBadge(estadoPersistido);
      renderFlujoEstado(citaElectroSeleccionada);
      if (estadoPersistido !== estadoObjetivo) {
        showToast(`El servidor conserv├│ el estado "${estadoPersistido}"`, 'warning');
      } else {
        showToast(`Estado: ${estadoPersistido}`, 'success');
      }
      actualizarEstadoFilaTablaElectro(citaElectroSeleccionada.id, estadoPersistido);
      if (window.socket && window.socket.connected) {
        window.socket.emit('electro:cambios-guardados', { id: citaElectroSeleccionada.id, cambios: { estado: estadoPersistido } });
      }
      await cargarCitasElectro();
    } else {
      showToast(data?.error || 'Error actualizando estado', 'error');
    }
  } catch (e) {
    showToast('Error actualizando estado', 'error');
  } finally {
    if (triggerBtn) {
      triggerBtn.disabled = false;
      triggerBtn.dataset.loading = '';
      triggerBtn.textContent = originalText || triggerBtn.textContent;
    }
  }
}

function confirmarCancelacionCitaElectro() {
  if (!citaElectroSeleccionada) return;
  const nombre = (citaElectroSeleccionada.paciente_nombre || '').trim() || 'este paciente';
  showConfirm(
    `┬┐Seguro que deseas cancelar la cita de ${nombre}?`,
    async () => { await cambiarEstadoCita('Cancelado'); },
    { okText: 'S├¡, cancelar cita', cancelText: 'No', danger: true, icon: 'ÔÜá´©Å' }
  );
}

function cerrarModalDetallesCita() {
  $('modalDetallesCitaElectro').classList.add('hidden');
  citaElectroSeleccionada = null;
  isInitializingElectroModal = false; // Resetear flag al cerrar
  
  // Detener intervalo de progreso si existe
  if (intervaloProgreso) {
    clearInterval(intervaloProgreso);
    intervaloProgreso = null;
  }
}

async function eliminarCitaElectro() {
  if (!citaElectroSeleccionada) return;
  
  // Verificar permisos: admin/superadmin siempre; admin_electro solo si no est├í Completado
  const rol = currentUser?.rol;
  const esAdminGlobal = rol === 'admin' || rol === 'administrador' || rol === 'superadmin';
  const esAdminElectro = rol === 'admin_electro';

  if (!esAdminGlobal && !esAdminElectro) {
    showToast('No tienes permisos para eliminar citas', 'error');
    return;
  }
  if (esAdminElectro && citaElectroSeleccionada.estado === 'Completado') {
    showToast('No se puede eliminar un estudio ya completado', 'error');
    return;
  }
  
  try {
    const res = await apiFetch(`/api/citas-electro/${citaElectroSeleccionada.id}`, {
      method: 'DELETE'
    });
    
    if (res.ok) {
      showToast('Cita eliminada correctamente', 'success');
      
      // El servidor emite el socket event, no es necesario emitir desde el cliente
      cargarCitasElectro();
      cerrarModalDetallesCita();
    } else {
      const data = await res.json();
      showToast(data.error || 'Error eliminando cita', 'error');
    }
  } catch (e) {
    console.error('Error eliminando cita:', e);
    showToast('Error eliminando cita', 'error');
  }
}

async function guardarCambiosCitaElectro() {
  if (!citaElectroSeleccionada) return;
  
  try {
    const estadoActual = citaElectroSeleccionada.estado || '';
    if (estadoActual === 'En Estudio' || estadoActual === 'Pausado') {
      showToast('No puedes cambiar el equipo mientras el estudio est├í activo', 'error');
      return;
    }

    const equipoNuevo = $('modalEquipo').value;
    
    // Solo manejar cambio de equipo ÔÇö los cambios de estado se manejan
    // exclusivamente por los botones de flujo (cambiarEstadoCita, iniciarEstudioModal, etc.)
    const cambios = {};
    
    // Comparar equipo (convertir ambos a string para comparar)
    if (String(equipoNuevo) !== String(citaElectroSeleccionada.equipo_id || '')) {
      cambios.equipo_id = equipoNuevo ? parseInt(equipoNuevo) : null;
    }
    
    if (Object.keys(cambios).length > 0) {
      const res = await apiFetch(`/api/citas-electro/${citaElectroSeleccionada.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cambios)
      });
      
      const data = await res.json();
      
      if (data && data.ok) {
        showToast('Cambios guardados', 'success');
        
        // Emitir evento de socket desde el cliente
        if (window.socket && window.socket.connected) {
          window.socket.emit('electro:cambios-guardados', {
            id: citaElectroSeleccionada.id,
            cambios
          });
        }
        
        // El servidor tambi├®n emite el socket event
        cargarCitasElectro();
        cerrarModalDetallesCita();
      } else {
        showToast(data?.error || 'Error guardando cambios', 'error');
      }
    } else {
      showToast('No hay cambios para guardar', 'info');
      cerrarModalDetallesCita();
    }
  } catch (e) {
    showToast('Error guardando cambios: ' + e.message, 'error');
  }
}

// ========== FUNCIONES PARA REPROGRAMAR Y ADELANTAR CITAS ==========

function abrirModalReprogramar() {
  if (!citaElectroSeleccionada) {
    return;
  }
  
  // GUARDAR CITA ANTES DE CERRAR MODAL
  citaReprogramarAdelantarActual = citaElectroSeleccionada;
  
  // Rellenar datos actuales
  $('modalReprogramarFechaActual').textContent = 
    `${formatearFecha(citaElectroSeleccionada.fecha)} a las ${citaElectroSeleccionada.hora_agendamiento}`;
  
  // Precargar fecha y hora actual (extraer solo la fecha en formato YYYY-MM-DD)
  const fecha = citaElectroSeleccionada.fecha;
  const fechaFormato = fecha ? fecha.split('T')[0] : '';
  $('modalReprogramarFecha').value = fechaFormato;
  $('modalReprogramarHora').value = citaElectroSeleccionada.hora_agendamiento || '';
  
  // Cerrar modal de detalles
  cerrarModalDetallesCita();
  
  // Abrir modal de reprogramaci├│n
  $('modalReprogramarCita').classList.remove('hidden');
}

function cerrarModalReprogramar() {
  $('modalReprogramarCita').classList.add('hidden');
}

async function confirmarReprogramar() {
  if (!citaReprogramarAdelantarActual) {
    return;
  }
  
  try {
    const fechaNueva = $('modalReprogramarFecha').value;
    const horaNueva = $('modalReprogramarHora').value;
    
    if (!fechaNueva || !horaNueva) {
      showToast('Debes completar fecha y hora', 'error');
      return;
    }
    
    const cambios = {
      estado: 'Reprogramado',
      fecha: fechaNueva,
      hora_agendamiento: horaNueva
    };
    
    const res = await apiFetch(`/api/citas-electro/${citaReprogramarAdelantarActual.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cambios)
    });
    
    const data = await res.json();
    
    if (data && data.ok) {
      showToast('Cita reprogramada exitosamente', 'success');
      
      // Emitir evento de socket
      if (window.socket && window.socket.connected) {
        window.socket.emit('electro:cambios-guardados', {
          id: citaReprogramarAdelantarActual.id,
          cambios
        });
      }
      
      cargarCitasElectro();
      cerrarModalReprogramar();
      citaReprogramarAdelantarActual = null; // Limpiar referencia
    } else {
      showToast(data?.error || 'Error reprogramando cita', 'error');
    }
  } catch (e) {
    console.error('[CONFIRMAR_REPROGRAMAR] Error:', e);
    showToast('Error reprogramando cita: ' + e.message, 'error');
  }
}

function abrirModalAdelantarCita() {
  console.log('[ADELANTAR] Llamando abrirModalAdelantarCita');
  if (!citaElectroSeleccionada) {
    console.log('[ADELANTAR] Sin cita seleccionada');
    return;
  }
  
  console.log('[ADELANTAR] Cita seleccionada:', citaElectroSeleccionada);
  
  // GUARDAR CITA ANTES DE CERRAR MODAL
  citaReprogramarAdelantarActual = citaElectroSeleccionada;
  console.log('[ADELANTAR] Guardada en variable temporal');
  
  // Rellenar datos actuales
  $('modalAdelantarHoraActual').textContent = citaElectroSeleccionada.hora_agendamiento || '-';
  
  // Precargar hora actual
  $('modalAdelantarHora').value = citaElectroSeleccionada.hora_agendamiento || '';
  
  // Cerrar modal de detalles
  cerrarModalDetallesCita();
  
  // Abrir modal de adelanto
  $('modalAdelantarCita').classList.remove('hidden');
}

function cerrarModalAdelantarCita() {
  $('modalAdelantarCita').classList.add('hidden');
}

async function confirmarAdelantarCita() {
  if (!citaReprogramarAdelantarActual) {
    return;
  }
  
  try {
    const horaNueva = $('modalAdelantarHora').value;
    
    if (!horaNueva) {
      showToast('Debes completar la hora', 'error');
      return;
    }
    
    const cambios = {
      estado: 'Adelantado',
      hora_agendamiento: horaNueva
    };
    
    const res = await apiFetch(`/api/citas-electro/${citaReprogramarAdelantarActual.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cambios)
    });
    
    const data = await res.json();
    
    if (data && data.ok) {
      showToast('Cita adelantada exitosamente', 'success');
      
      // Emitir evento de socket
      if (window.socket && window.socket.connected) {
        window.socket.emit('electro:cambios-guardados', {
          id: citaReprogramarAdelantarActual.id,
          cambios
        });
      }
      
      cargarCitasElectro();
      cerrarModalAdelantarCita();
      citaReprogramarAdelantarActual = null; // Limpiar referencia
    } else {
      showToast(data?.error || 'Error adelantando cita', 'error');
    }
  } catch (e) {
    console.error('[CONFIRMAR_ADELANTAR] Error:', e);
    showToast('Error adelantando cita: ' + e.message, 'error');
  }
}

// ===== Event Listeners para Modal de Duraci├│n =====
$('btnConfirmarDuracionSi')?.addEventListener('click', () => {
  cerrarModalConfirmarDuracion();
  abrirModalDuracionEstudio();
});

$('btnConfirmarDuracionNo')?.addEventListener('click', () => {
  cerrarModalConfirmarDuracion();
  iniciarEstudioSinDuracion();
});

$('cerrarModalDuracion')?.addEventListener('click', cerrarModalDuracionEstudio);
$('btnCancelarDuracion')?.addEventListener('click', cerrarModalDuracionEstudio);
$('btnConfirmarDuracion')?.addEventListener('click', confirmarDuracionEstudio);

// Event listeners para confirmaci├│n de finalizar estudio
$('btnConfirmarFinalizarSi')?.addEventListener('click', confirmarFinalizarEstudio);
$('btnConfirmarFinalizarNo')?.addEventListener('click', cancelarFinalizarEstudio);

// ========== FUNCIONES PARA MODAL DE ESTADO DE CITAS M├ëDICAS ==========

let currentTurnoMedicaData = null;
let currentEstadoAction = null;

function esEspecialidadRecordatorio(especialidad) {
  const v = String(especialidad || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return (
    v.includes('neuropsicolog') ||
    v.includes('psicolog') ||
    v.includes('neurolog') ||
    v.includes('epileptolog') ||
    v.includes('psiquiatr')
  );
}

function especialidadIncluyeEspecialista(especialidad) {
  const v = String(especialidad || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return v.includes('neurolog') || v.includes('epileptolog') || v.includes('psiquiatr');
}

function obtenerNombreEspecialistaRecordatorio() {
  const desdeDisplay = (document.getElementById('agendaMedicaDoctorDisplay')?.textContent || '').trim();
  if (desdeDisplay && desdeDisplay !== '-') return desdeDisplay;
  return (currentUser?.nombre || currentUser?.usuario || '').trim();
}

function construirMensajeRecordatorioMedica(turno, especialidadDoctor) {
  const nombre = turno?.paciente_nombre || '';
  const fecha = turno?.fecha ? formatearFechaISO(turno.fecha) : '-';
  const hora = turno?.hora ? formatearHora(turno.hora) : '-';
  const especialidadTexto = especialidadDoctor || 'Neuropsicolog├¡a';
  const nombreEspecialista = obtenerNombreEspecialistaRecordatorio();
  const lineaEspecialista = especialidadIncluyeEspecialista(especialidadTexto)
    ? `\nÔùë Especialista: ${nombreEspecialista || 'Por confirmar'}`
    : '';
  return `┬íHola, buen d├¡a!. Le recordamos su cita de ${especialidadTexto} en el Instituto Neurociencias de Nari├▒o IPS S.A.S:
Ôùë Paciente: ${nombre}
Ôùë Fecha: ${fecha}
Ôùë Hora: ${hora}
${lineaEspecialista}
Ôùë Ubicaci├│n: Carrera 33 #13 - 84 "Casa Verde" (https://maps.app.goo.gl/YU5GheUmVMDAHFbq8)
Cualquier novedad, no dude en comunicarse con nosotros.

NOTA: Por favor confirmar su asistencia lo antes posible. Muchas gracias.`;
}

function enviarRecordatorioWhatsAppMedica(turno) {
  if (!turno) return;
  const telefono = String(turno.paciente_telefono || '').replace(/\D/g, '');
  if (!telefono || telefono.length < 7) {
    showToast('La cita no tiene un tel├®fono #1 v├ílido para enviar recordatorio', 'error');
    return;
  }
  const numeroWhatsApp = telefono.startsWith('57') ? telefono : `57${telefono}`;
  const especialidadActual = selectedDoctorEspecialidad || currentUser?.especialidad || '';
  const mensaje = construirMensajeRecordatorioMedica(turno, especialidadActual);
  window.open(`https://wa.me/${numeroWhatsApp}?text=${encodeURIComponent(mensaje)}`, '_blank');
  showToast('Recordatorio listo para enviar por WhatsApp', 'success');
}

function abrirModalEstadoCitaMedica(turno) {
  currentTurnoMedicaData = turno;

  // Cerrar men├║ y panel de edici├│n si estaban abiertos
  const menuMed = document.getElementById('menuMasOpcionesMedica');
  if (menuMed) menuMed.style.display = 'none';
  const editPanelMed = document.getElementById('editarMedicaPanel');
  if (editPanelMed) editPanelMed.style.display = 'none';

  // Llenar datos de la tarjeta
  const el = (id) => document.getElementById(id);
  const badge = el('detMedicaBadge');
  if (badge) badge.innerHTML = estadoBadgeMedica(turno.estado || 'EN_ESPERA');
  if (el('detMedicaPaciente')) el('detMedicaPaciente').textContent = escapeHtml(turno.paciente_nombre || '-');
  if (el('detMedicaDocumento')) el('detMedicaDocumento').textContent = escapeHtml(turno.paciente_documento || '-');
  if (el('detMedicaTelefono')) el('detMedicaTelefono').textContent = turno.paciente_telefono || '-';
  if (el('detMedicaTipo')) el('detMedicaTipo').textContent = turno.tipo_consulta || '-';
  if (el('detMedicaEntidad')) el('detMedicaEntidad').textContent = turno.entidad || '-';
  if (el('detMedicaFecha')) el('detMedicaFecha').textContent = turno.fecha ? formatearFechaISO(turno.fecha) : '-';
  if (el('detMedicaHora')) el('detMedicaHora').textContent = turno.hora ? formatearHora(turno.hora) : '-';
  if (el('detMedicaProgramadoPor')) el('detMedicaProgramadoPor').textContent = escapeHtml(turno.programado_por || '-');
  if (el('detMedicaNotas')) el('detMedicaNotas').textContent = turno.notas || '';
  $('modalReprogramarMedicaFechaActual').innerHTML = `<strong>${formatearFecha(turno.fecha)}</strong> a las <strong>${formatearHora(turno.hora)}</strong>`;

  const pol = agendaMedicaPolicy(turno);
  const btnRecordatorio = el('btnEnviarRecordatorioMedica');
  if (btnRecordatorio) {
    const especialidadActual = selectedDoctorEspecialidad || currentUser?.especialidad || '';
    const visible = esEspecialidadRecordatorio(especialidadActual);
    btnRecordatorio.style.display = visible ? '' : 'none';
    btnRecordatorio.disabled = !visible;
    btnRecordatorio.onclick = () => enviarRecordatorioWhatsAppMedica(currentTurnoMedicaData);
  }

  // Bloquear edici├│n en modal seg├║n pol├¡tica
  const editBtnMed = el('btnEditarMedicaModal');
  if (editBtnMed) {
    editBtnMed.disabled = pol.modal.bloquearEdicion;
    editBtnMed.style.opacity = pol.modal.bloquearEdicion ? '0.4' : '';
    editBtnMed.title = pol.modal.bloquearEdicion
      ? 'No es posible editar mientras el paciente est├í en atenci├│n'
      : 'Editar datos del paciente';
  }

  // --- RESET footer para evitar estados residuales ---
  const footerBtnIds = [
    'btnEstadoEnSala',
    'btnModalLlamarPaciente',
    'btnModalEnAtencion',
    'btnModalAtendido',
    'btnModalNoAsistio',
    'btnModalReprogramarNoAsistio',
  ];
  footerBtnIds.forEach((id) => {
    const b = el(id);
    if (b) b.style.display = 'none';
  });

  // --- BOTONES FOOTER (desde pol├¡tica) ---
  const btnEnSala = el('btnEstadoEnSala');
  if (btnEnSala) btnEnSala.style.display = pol.modal.showEnSala ? '' : 'none';

  const btnReprogramarNA = el('btnModalReprogramarNoAsistio');
  if (btnReprogramarNA) btnReprogramarNA.style.display = pol.modal.showReprogramarNoAsistio ? '' : 'none';

  const btnLlamarMod = el('btnModalLlamarPaciente');
  if (btnLlamarMod) {
    btnLlamarMod.style.display = pol.modal.showLlamar ? '' : 'none';
    btnLlamarMod.disabled = pol.modal.llamarDisabled;
    btnLlamarMod.style.opacity = btnLlamarMod.disabled ? '0.4' : '';
  }

  const btnEnAtencionMod = el('btnModalEnAtencion');
  if (btnEnAtencionMod) {
    btnEnAtencionMod.style.display = pol.modal.showEnAtencion ? '' : 'none';
    btnEnAtencionMod.disabled = pol.modal.enAtencionDisabled;
    btnEnAtencionMod.style.opacity = btnEnAtencionMod.disabled ? '0.4' : '';
  }

  const btnAtendidoMod = el('btnModalAtendido');
  if (btnAtendidoMod) {
    btnAtendidoMod.style.display = pol.modal.showAtendido ? '' : 'none';
    btnAtendidoMod.disabled = pol.modal.atendidoDisabled;
    btnAtendidoMod.style.opacity = btnAtendidoMod.disabled ? '0.4' : '';
  }

  const btnNoAsistioMod = el('btnModalNoAsistio');
  if (btnNoAsistioMod) {
    btnNoAsistioMod.style.display = pol.modal.showNoAsistio ? '' : 'none';
    btnNoAsistioMod.disabled = pol.modal.noAsistioDisabled;
    btnNoAsistioMod.style.opacity = btnNoAsistioMod.disabled ? '0.4' : '';
  }

  // --- MEN├Ü 3 PUNTOS + EDITAR (desde pol├¡tica) ---
  const btn3dots = el('btnMasOpcionesMedica');
  if (btn3dots) btn3dots.style.display = pol.modal.showMenu3Puntos ? '' : 'none';

  if (editBtnMed) {
    // Editar: solo recepci├│n/admin (NO doctor), y no en estados finales
    editBtnMed.style.display = (pol.perms.editar && currentUser?.rol !== 'doctor' && !pol.meta.esFinal) ? '' : 'none';
  }

  // Editar tipo consulta en citas atendidas: SOLO superadmin
  const btnEditTipo = el('btnEditTipoConsultaAtendida');
  const editTipoWrap = el('editTipoConsultaAtendidaWrap');
  if (btnEditTipo) {
    btnEditTipo.style.display = (currentUser?.rol === 'superadmin' && turno.estado === 'ATENDIDO') ? '' : 'none';
  }
  if (editTipoWrap) editTipoWrap.style.display = 'none';

  // Mostrar modal
  $('modalEstadoCitaMedica').classList.remove('hidden');
}

function cerrarModalEstadoCitaMedica() {
  $('modalEstadoCitaMedica').classList.add('hidden');
  // NO limpiar currentTurnoMedicaData ni currentEstadoAction aqu├¡ 
  // Se necesitan para el modal de confirmaci├│n
  // currentTurnoMedicaData = null;
  // currentEstadoAction = null;
}

function cerrarModalReprogramarMedica() {
  $('modalReprogramarMedica').classList.add('hidden');
  // Limpiar datos despu├®s de reprogramar
  currentTurnoMedicaData = null;
  currentEstadoAction = null;
}

function cerrarModalConfirmReprogramacion() {
  $('modalConfirmReprogramacion').classList.add('hidden');
  // Limpiar datos despu├®s de cerrar confirmaci├│n
  currentTurnoMedicaData = null;
  currentEstadoAction = null;
}

// Bot├│n: En Sala (admin/recepcion)
$('btnEstadoEnSala')?.addEventListener('click', async (e) => {
  e.preventDefault(); e.stopPropagation();
  if (!currentTurnoMedicaData) return;
  try {
    const res = await apiFetch(`/api/turnos/${currentTurnoMedicaData.id}/estado`, {
      method: 'PATCH', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ estado: 'EN_SALA' })
    });
    const data = await res.json();
    if (data.ok) { showToast('Paciente marcado como En Sala', 'success'); cerrarModalEstadoCitaMedica(); cargarTurnosMedica(); }
    else showToast(data.error || 'Error al actualizar', 'error');
  } catch (err) { showToast('Error al actualizar estado', 'error'); console.error(err); }
});

// Bot├│n: LLAMAR AL PACIENTE ÔåÆ Emitir anuncio por socket (solo recepci├│n escucha)
$('btnModalLlamarPaciente')?.addEventListener('click', async (e) => {
  e.preventDefault(); e.stopPropagation();
  if (!currentTurnoMedicaData) return;
  
  const nombrePaciente = currentTurnoMedicaData.paciente_nombre || 'el paciente';
  const consultorio = currentUser?.numero_consultorio;
  
  // 1) Emitir anuncio por socket (solo recepci├│n reproduce la voz)
  if (typeof socket !== 'undefined' && socket) {
    socket.emit('agenda:anunciar-paciente', {
      paciente_nombre: nombrePaciente,
      numero_consultorio: consultorio
    });
  }
  showToast('Paciente llamado: ' + nombrePaciente, 'success');
});

// Bot├│n: EN ATENCI├ôN ÔÇö equivalente a "S├¡, lleg├│"
$('btnModalEnAtencion')?.addEventListener('click', async (e) => {
  e.preventDefault(); e.stopPropagation();
  if (!currentTurnoMedicaData) return;
  const nombrePaciente = currentTurnoMedicaData.paciente_nombre || 'el paciente';
  try {
    const res = await apiFetch(`/api/turnos/${currentTurnoMedicaData.id}/estado`, {
      method: 'PATCH', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ estado: 'EN_ATENCION' })
    });
    const data = await res.json();
    if (data.ok) { showToast('Paciente en atenci├│n: ' + nombrePaciente, 'success'); cerrarModalEstadoCitaMedica(); cargarTurnosMedica(); }
    else showToast(data.error || 'Error al actualizar', 'error');
  } catch (err) { showToast('Error al actualizar estado', 'error'); console.error(err); }
});

// Bot├│n: ATENDIDO ÔÇö usa marcar-atendido para renumerar turnos (el siguiente pasa a ser #1)
$('btnModalAtendido')?.addEventListener('click', async (e) => {
  e.preventDefault(); e.stopPropagation();
  if (!currentTurnoMedicaData) return;
  try {
    const enAtencionActual = currentTurnoMedicaData.estado === 'EN_ATENCION';
    const res = enAtencionActual
      ? await apiFetch('/api/turnos/marcar-atendido', {
          method: 'POST', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ turno_id: currentTurnoMedicaData.id })
        })
      : await apiFetch(`/api/turnos/${currentTurnoMedicaData.id}/estado`, {
          method: 'PATCH', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ estado: 'ATENDIDO' })
        });
    const data = await res.json();
    if (data.ok) { showToast('Paciente marcado como atendido', 'success'); cerrarModalEstadoCitaMedica(); cargarTurnosMedica(); }
    else showToast(data.error || 'Error al actualizar', 'error');
  } catch (err) { showToast('Error al actualizar estado', 'error'); console.error(err); }
});

// Bot├│n: NO ASISTI├ô
$('btnModalNoAsistio')?.addEventListener('click', (e) => {
  e.preventDefault(); e.stopPropagation();
  if (!currentTurnoMedicaData) return;
  const menu = document.getElementById('menuMasOpcionesMedica');
  if (menu) menu.style.display = 'none';
  currentEstadoAction = 'no-asistio';
  cerrarModalEstadoCitaMedica();
  $('modalConfirmReprogramacionTitle').textContent = '┬┐Desea reprogramar esta cita?';
  $('modalConfirmReprogramacionMessage').textContent = 'El paciente no asisti├│. ┬┐Desea reprogramarla para otro d├¡a?';
  $('modalConfirmReprogramacion').classList.remove('hidden');
});

// Men├║ 3 puntos: abrir/cerrar
document.getElementById('btnMasOpcionesMedica')?.addEventListener('click', (e) => {
  e.stopPropagation();
  const menu = document.getElementById('menuMasOpcionesMedica');
  if (menu) menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
});

// Men├║: Reprogramar
document.getElementById('btnReprogramarMedicaMenu')?.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (!currentTurnoMedicaData) return;
  document.getElementById('menuMasOpcionesMedica').style.display = 'none';
  currentEstadoAction = 'reprogramar';
  cerrarModalEstadoCitaMedica();
  $('modalReprogramarMedica').classList.remove('hidden');
  $('modalReprogramarMedicaFecha').value = currentTurnoMedicaData.fecha || '';
  $('modalReprogramarMedicaHora').value = (currentTurnoMedicaData.hora || '').substring(0, 5);
});

// Bot├│n Reprogramar (admin/recepcion) para NO_ASISTIO
document.getElementById('btnModalReprogramarNoAsistio')?.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (!currentTurnoMedicaData) return;
  currentEstadoAction = 'no-asistio'; // El turno original ya era NO_ASISTIO
  cerrarModalEstadoCitaMedica();
  $('modalReprogramarMedica').classList.remove('hidden');
  $('modalReprogramarMedicaFecha').value = currentTurnoMedicaData.fecha || '';
  $('modalReprogramarMedicaHora').value = (currentTurnoMedicaData.hora || '').substring(0, 5);
});

// Men├║: Cancelado por Paciente
document.getElementById('btnCanceladoPacienteMedicaMenu')?.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (!currentTurnoMedicaData) return;
  document.getElementById('menuMasOpcionesMedica').style.display = 'none';
  currentEstadoAction = 'cancelado-paciente';
  cerrarModalEstadoCitaMedica();
  $('modalConfirmReprogramacionTitle').textContent = '┬┐Desea reprogramar esta cita?';
  $('modalConfirmReprogramacionMessage').textContent = 'El paciente cancel├│ la cita. ┬┐Desea reprogramarla para otro d├¡a?';
  $('modalConfirmReprogramacion').classList.remove('hidden');
});

// Men├║: No Asisti├│
document.getElementById('btnNoAsistioMedicaMenu')?.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (!currentTurnoMedicaData) return;
  document.getElementById('menuMasOpcionesMedica').style.display = 'none';
  currentEstadoAction = 'no-asistio';
  cerrarModalEstadoCitaMedica();
  $('modalConfirmReprogramacionTitle').textContent = '┬┐Desea reprogramar esta cita?';
  $('modalConfirmReprogramacionMessage').textContent = 'El paciente no asisti├│. ┬┐Desea reprogramarla para otro d├¡a?';
  $('modalConfirmReprogramacion').classList.remove('hidden');
});

// Delegaci├│n de eventos para los botones del modal de confirmaci├│n de reprogramaci├│n
document.addEventListener('click', async (e) => {
  const btnSi = e.target.closest('#btnConfirmReprogramacionSi');
  const btnNo = e.target.closest('#btnConfirmReprogramacionNo');
  
  // Bot├│n: Confirmar Reprogramaci├│n - S├ì
  if (btnSi) {
    e.preventDefault();
    e.stopPropagation();
    console.log('[CONFIRM_SI] Bot├│n clickeado');
    // Guardar datos antes de cerrar (cerrarModalConfirmReprogramacion los limpia)
    const savedTurnoData = currentTurnoMedicaData;
    cerrarModalConfirmReprogramacion();
    // Restaurar datos para el modal de reprogramaci├│n
    currentTurnoMedicaData = savedTurnoData;
    
    // Abrir modal de reprogramaci├│n
    $('modalReprogramarMedica').classList.remove('hidden');
    // Pre-llenar con la fecha/hora actuales de la cita como punto de partida
    $('modalReprogramarMedicaFecha').value = savedTurnoData?.fecha || '';
    $('modalReprogramarMedicaHora').value = (savedTurnoData?.hora || '').substring(0, 5);
  }
  
  // Bot├│n: Confirmar Reprogramaci├│n - NO
  if (btnNo) {
    e.preventDefault();
    e.stopPropagation();
    console.log('[CONFIRM_NO] Bot├│n clickeado');
    
    if (!currentTurnoMedicaData) {
      console.log('[CONFIRM_NO] No hay turno seleccionado');
      return;
    }
    
    // Guardar datos ANTES de limpiar modal
    const turnoData = currentTurnoMedicaData;
    const accion = currentEstadoAction;
    
    console.log('[CONFIRM_NO] Acci├│n:', accion);
    console.log('[CONFIRM_NO] Turno ID:', turnoData?.id);
    
    cerrarModalConfirmReprogramacion();
    
    // Actualizar estado sin reprogramar
    try {
      let estadoFinal = '';
      
      if (accion === 'cancelado-paciente') {
        estadoFinal = 'CANCELADO';
      } else if (accion === 'no-asistio') {
        estadoFinal = 'NO_ASISTIO';
      }
      
      if (!estadoFinal) {
        console.error('[CONFIRM_NO] Acci├│n desconocida:', accion);
        showToast('Error: no se especific├│ acci├│n v├ílida', 'error');
        return;
      }
      
      console.log('[CONFIRM_NO] Actualizando estado a:', estadoFinal);
      
      const res = await apiFetch(`/api/turnos/${turnoData.id}/estado`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado: estadoFinal })
      });
      
      const data = await res.json();
      if (data.ok) {
        console.log('[CONFIRM_NO] Respuesta OK del servidor');
        showToast(`Estado actualizado a ${estadoFinal.replace(/_/g, ' ')}`, 'success');
        
        // Emitir socket para actualizar otros usuarios en tiempo real
        if (window.socket && window.socket.connected) {
          window.socket.emit('turno-medico:estado-actualizado', {
            turnoId: turnoData.id,
            estadoAnterior: turnoData.estado,
            estadoNuevo: estadoFinal
          });
          console.log('[CONFIRM_NO] Socket emitido');
        }
        
        // Actualizar la fila en la tabla con el nuevo color
        if (turnoData && turnoData.id) {
          const turnoRow = document.querySelector(`[data-turno-id="${turnoData.id}"]`);
          if (turnoRow) {
            // Remover todas las clases de estado anteriores
            turnoRow.classList.remove('estado-en-sala', 'estado-reprogramado', 'estado-cancelado-paciente', 'estado-no-asistio');
            
            // Agregar la nueva clase de estado
            if (estadoFinal === 'CANCELADO') {
              turnoRow.classList.add('estado-cancelado-paciente');
            } else if (estadoFinal === 'NO_ASISTIO') {
              turnoRow.classList.add('estado-no-asistio');
            }
            console.log('[CONFIRM_NO] Fila actualizada con nuevo color');
          }
        }
        
        // Recargar para asegurar que todo est├í sincronizado
        cargarTurnosMedica();
      } else {
        console.error('[CONFIRM_NO] Error en respuesta:', data.error);
        showToast(data.error || 'Error al actualizar', 'error');
      }
    } catch (e) {
      console.error('[CONFIRM_NO] Error:', e);
      showToast('Error al actualizar estado', 'error');
    }
  }
});

// Modal: Confirmar Reprogramaci├│n
$('btnConfirmarReprogramarMedica')?.addEventListener('click', async (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (!currentTurnoMedicaData) return;
  
  const fechaNew = $('modalReprogramarMedicaFecha').value;
  const horaNew = $('modalReprogramarMedicaHora').value;
  
  if (!fechaNew || !horaNew) {
    showToast('Por favor selecciona fecha y hora', 'error');
    return;
  }
  
  try {
    // Determinar el estado final del turno original seg├║n la acci├│n
    let estadoOriginal = 'REPROGRAMADO';
    if (currentEstadoAction === 'no-asistio') estadoOriginal = 'NO_ASISTIO';
    else if (currentEstadoAction === 'cancelado-paciente') estadoOriginal = 'CANCELADO';

    // 1) Marcar el turno original con su estado correspondiente (se queda en su fecha original)
    await apiFetch(`/api/turnos/${currentTurnoMedicaData.id}/estado`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ estado: estadoOriginal })
    });

    // 2) Crear un NUEVO turno con estado PENDIENTE en la fecha/hora nueva
    const body = {
      doctor_id: currentTurnoMedicaData.doctor_id,
      paciente_nombre: currentTurnoMedicaData.paciente_nombre,
      paciente_documento: currentTurnoMedicaData.paciente_documento || null,
      paciente_telefono: currentTurnoMedicaData.paciente_telefono || null,
      paciente_telefono2: currentTurnoMedicaData.paciente_telefono2 || null,
      fecha: fechaNew,
      hora: horaNew,
      tipo_consulta: currentTurnoMedicaData.tipo_consulta || null,
      entidad: currentTurnoMedicaData.entidad || null,
      notas: currentTurnoMedicaData.notas ? `[Reprogramado] ${currentTurnoMedicaData.notas}` : '[Reprogramado]',
      programado_por: (currentUser && (currentUser.nombre || currentUser.usuario)) || 'Sistema'
    };

    const res = await apiFetch('/api/turnos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    
    const data = await res.json();
    if (data.ok) {
      showToast('Cita reprogramada correctamente', 'success');
      
      // Emitir socket para actualizar otros usuarios en tiempo real
      if (window.socket && window.socket.connected) {
        window.socket.emit('turno-medico:reprogramado', {
          turnoId: currentTurnoMedicaData.id,
          fechaNueva: fechaNew,
          horaNueva: horaNew
        });
      }
      
      cerrarModalReprogramarMedica();
      cargarTurnosMedica();
    } else {
      showToast(data.error || 'Error al reprogramar', 'error');
    }
  } catch (e) {
    showToast('Error al reprogramar cita', 'error');
    console.error(e);
  }
});

// Cierres de modales
$('btnCerrarEstadoMedica')?.addEventListener('click', cerrarModalEstadoCitaMedica);
$('btnCancelarEstadoMedica')?.addEventListener('click', cerrarModalEstadoCitaMedica);
$('btnCerrarReprogramarMedica')?.addEventListener('click', cerrarModalReprogramarMedica);
$('btnCancelarReprogramarMedica')?.addEventListener('click', cerrarModalReprogramarMedica);
$('modalConfirmReprogramacion')?.addEventListener('click', (e) => {
  if (e.target === $('modalConfirmReprogramacion')) {
    cerrarModalConfirmReprogramacion();
  }
});
$('modalEstadoCitaMedica')?.addEventListener('click', (e) => {
  if (e.target === $('modalEstadoCitaMedica')) {
    cerrarModalEstadoCitaMedica();
  }
  // Cerrar men├║ desplegable si se hace clic fuera de ├®l
  if (!e.target.closest('#btnMasOpcionesMedica') && !e.target.closest('#menuMasOpcionesMedica')) {
    const menu = document.getElementById('menuMasOpcionesMedica');
    if (menu) menu.style.display = 'none';
  }
});
$('modalReprogramarMedica')?.addEventListener('click', (e) => {
  if (e.target === $('modalReprogramarMedica')) {
    cerrarModalReprogramarMedica();
  }
});

// ÔöÇÔöÇ Editar paciente en modal m├®dica ÔöÇÔöÇ
document.getElementById('btnEditarMedicaModal')?.addEventListener('click', () => {
  const panel = document.getElementById('editarMedicaPanel');
  if (!panel) return;
  if (panel.style.display !== 'none') {
    panel.style.display = 'none';
    return;
  }
  document.getElementById('editMedicaNombre').value = currentTurnoMedicaData?.paciente_nombre || '';
  document.getElementById('editMedicaTelefono').value = currentTurnoMedicaData?.paciente_telefono || '';
  // Poblar tipos de consulta desde el selector del formulario de nueva cita
  const selectSrc = $('nuevoTurnoTipoMedica');
  const selectDst = document.getElementById('editMedicaTipoConsulta');
  if (selectSrc && selectDst) {
    selectDst.innerHTML = '<option value="">Seleccionar</option>';
    Array.from(selectSrc.options).slice(1).forEach(opt => {
      selectDst.add(new Option(opt.text, opt.value));
    });
    selectDst.value = currentTurnoMedicaData?.tipo_consulta || '';
  }
  panel.style.display = 'block';
});
document.getElementById('btnCancelarEditarMedica')?.addEventListener('click', () => {
  const panel = document.getElementById('editarMedicaPanel');
  if (panel) panel.style.display = 'none';
});
document.getElementById('editMedicaTelefono')?.addEventListener('input', (e) => {
  e.target.value = e.target.value.replace(/\D/g, '').slice(0, 10);
});
document.getElementById('btnGuardarEditarMedica')?.addEventListener('click', async () => {
  if (!currentTurnoMedicaData) return;
  const nombre = document.getElementById('editMedicaNombre')?.value.trim();
  const telefono = document.getElementById('editMedicaTelefono')?.value.trim();
  const tipoConsulta = document.getElementById('editMedicaTipoConsulta')?.value;
  if (!nombre) { showToast('El nombre es obligatorio', 'error'); return; }
  try {
    const res = await apiFetch(`/api/turnos/${currentTurnoMedicaData.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paciente_nombre: nombre, paciente_telefono: telefono, tipo_consulta: tipoConsulta })
    });
    const data = await res.json();
    if (data.ok) {
      currentTurnoMedicaData.paciente_nombre = nombre;
      currentTurnoMedicaData.paciente_telefono = telefono;
      currentTurnoMedicaData.tipo_consulta = tipoConsulta;
      const el = (id) => document.getElementById(id);
      if (el('detMedicaPaciente')) el('detMedicaPaciente').textContent = escapeHtml(nombre);
      if (el('detMedicaTelefono')) el('detMedicaTelefono').textContent = telefono || '-';
      if (el('detMedicaTipo')) el('detMedicaTipo').textContent = tipoConsulta || '-';
      document.getElementById('editarMedicaPanel').style.display = 'none';
      showToast('Datos actualizados correctamente', 'success');
      cargarTurnosMedica();
    } else {
      showToast(data.error || 'Error al guardar', 'error');
    }
  } catch (err) {
    showToast('Error al guardar cambios', 'error');
    console.error(err);
  }
});

// ÔöÇÔöÇ Editar tipo de consulta en citas ATENDIDAS (solo superadmin) ÔöÇÔöÇ
document.getElementById('btnEditTipoConsultaAtendida')?.addEventListener('click', async () => {
  const wrap = document.getElementById('editTipoConsultaAtendidaWrap');
  const sel = document.getElementById('editTipoConsultaAtendidaSel');
  if (!wrap || !sel || !currentTurnoMedicaData) return;

  // Poblar tipos de consulta
  sel.innerHTML = '<option value="">Seleccionar</option>';
  try {
    // Cargar tipos de consulta del doctor de la cita
    const doctorId = currentTurnoMedicaData.doctor_id;
    if (doctorId) {
      const tipos = await apiFetch(`/api/tipos-consulta?medico_id=${encodeURIComponent(doctorId)}`).then(r => r.json()).catch(() => []);
      tipos.forEach(t => { sel.add(new Option(t.nombre, t.nombre)); });
    }
    // Fallback: cargar del select de nueva cita
    if (sel.options.length <= 1) {
      const selectSrc = $('nuevoTurnoTipoMedica');
      if (selectSrc) {
        Array.from(selectSrc.options).slice(1).forEach(opt => { sel.add(new Option(opt.text, opt.value)); });
      }
    }
  } catch (e) { console.warn('Error cargando tipos de consulta:', e.message); }

  sel.value = currentTurnoMedicaData.tipo_consulta || '';
  wrap.style.display = 'block';
});

document.getElementById('btnCancelEditTipoAtendida')?.addEventListener('click', () => {
  const wrap = document.getElementById('editTipoConsultaAtendidaWrap');
  if (wrap) wrap.style.display = 'none';
});

document.getElementById('btnSaveEditTipoAtendida')?.addEventListener('click', async () => {
  if (!currentTurnoMedicaData) return;
  const sel = document.getElementById('editTipoConsultaAtendidaSel');
  const tipoConsulta = sel?.value || '';
  if (!tipoConsulta) { showToast('Selecciona un tipo de consulta', 'error'); return; }

  try {
    const res = await apiFetch(`/api/turnos/${currentTurnoMedicaData.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipo_consulta: tipoConsulta })
    });
    const data = await res.json();
    if (data.ok) {
      currentTurnoMedicaData.tipo_consulta = tipoConsulta;
      if (document.getElementById('detMedicaTipo')) document.getElementById('detMedicaTipo').textContent = tipoConsulta;
      document.getElementById('editTipoConsultaAtendidaWrap').style.display = 'none';
      showToast('Tipo de consulta actualizado', 'success');
      cargarTurnosMedica();
    } else {
      showToast(data.error || 'Error al guardar', 'error');
    }
  } catch (err) {
    showToast('Error al guardar cambios', 'error');
    console.error(err);
  }
});

$('horaEstudioInicio')?.addEventListener('change', actualizarDuracionMostrada);
$('horaEstudioFin')?.addEventListener('change', actualizarDuracionMostrada);

// ========== BUSCADORES POR DOCUMENTO ==========

async function buscarCitasPorDocumento() {
  const documento = $('buscarCitaDocumento').value.trim();
  
  if (!documento) {
    return;
  }

  const seccion = $('buscarCitaResultadosSection');
  const tbody = $('buscarCitaBody');
  const conteo = $('buscarCitaConteo');

  if (seccion) seccion.style.display = '';
  if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="padding:20px;text-align:center;color:#999">Cargando...</td></tr>';

  try {
    const res = await apiFetch(`/api/turnos?buscar=${encodeURIComponent(documento)}`);
    const citas = await res.json();
    
    if (!citas || citas.length === 0) {
      if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="padding:20px;text-align:center;color:#7f1d1d">ÔØî No se encontraron citas para el documento "<strong>${escapeHtml(documento)}</strong>"</td></tr>`;
      if (conteo) conteo.textContent = '0 resultados';
      return;
    }

    if (conteo) conteo.textContent = `${citas.length} resultado${citas.length !== 1 ? 's' : ''}`;

    if (tbody) tbody.innerHTML = '';
    citas.forEach((cita, idx) => {
      const rawFecha = cita.fecha ? String(cita.fecha).slice(0, 10) : '';
      const [y, m, d] = rawFecha.split('-');
      const fecha = y ? new Date(parseInt(y), parseInt(m) - 1, parseInt(d)).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '-';
      const hora = escapeHtml(cita.hora || '-');
      const docPaciente = escapeHtml(cita.paciente_documento || '-');
      const nombre = escapeHtml(cita.paciente_nombre || '-');
      const tipoConsulta = escapeHtml(cita.tipo_consulta || '-');
      const estadoHtml = estadoBadgeMedica(cita.estado || 'EN_ESPERA');

      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid #e5e7eb';
      tr.innerHTML = `
        <td style="padding:12px;color:#374151">${fecha}</td>
        <td style="padding:12px;color:#374151">${hora}</td>
        <td style="padding:12px;color:#374151;font-weight:500">${docPaciente}</td>
        <td style="padding:12px;color:#1f2937;font-weight:500">${nombre}</td>
        <td style="padding:12px;color:#374151">${tipoConsulta}</td>
        <td style="padding:12px">${estadoHtml}</td>
        <td style="padding:12px"><button class="btn-primary btn-sm" data-idx="${idx}">Ver / Editar</button></td>
      `;
      tr.querySelector('button').addEventListener('click', () => {
        abrirModalEstadoCitaMedica(cita);
      });
      tbody.appendChild(tr);
    });
  } catch (e) {
    console.error('Error buscando citas:', e);
    if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="padding:20px;text-align:center;color:#dc2626">Error al buscar citas</td></tr>';
  }
}

async function buscarEstudiosPorDocumento() {
  const documento = $('buscarEstudioDocumento').value.trim();
  if (!documento) return;

  const seccion = $('buscarEstudioResultadosSection');
  const tbody = $('buscarEstudioBody');
  const conteo = $('buscarEstudioConteo');

  if (seccion) seccion.style.display = '';
  if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="padding:20px;text-align:center;color:#999">Cargando...</td></tr>';

  try {
    const res = await apiFetch(`/api/citas-electro?buscar=${encodeURIComponent(documento)}`);
    const citas = await res.json();

    if (!citas || citas.length === 0) {
      if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="padding:20px;text-align:center;color:#7f1d1d">ÔØî No se encontraron estudios para el documento "<strong>${escapeHtml(documento)}</strong>"</td></tr>`;
      if (conteo) conteo.textContent = '0 resultados';
      return;
    }

    if (conteo) conteo.textContent = `${citas.length} resultado${citas.length !== 1 ? 's' : ''}`;
    if (tbody) tbody.innerHTML = '';

    citas.forEach((cita) => {
      const [y,m,d] = (cita.fecha || '').split('-');
      const fecha = y ? new Date(parseInt(y), parseInt(m)-1, parseInt(d)).toLocaleDateString('es-ES', {day:'2-digit',month:'2-digit',year:'numeric'}) : '-';

      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid #e5e7eb';
      tr.innerHTML = `
        <td style="padding:12px;color:#374151">${fecha}</td>
        <td style="padding:12px;color:#374151">${escapeHtml(cita.hora_agendamiento || '-')}</td>
        <td style="padding:12px;color:#374151;font-weight:500">${escapeHtml(cita.paciente_documento || '-')}</td>
        <td style="padding:12px;color:#1f2937;font-weight:500">${escapeHtml(cita.paciente_nombre || '-')}</td>
        <td style="padding:12px;color:#374151">${escapeHtml(cita.estudio || '-')}</td>
        <td style="padding:12px">${estadoBadge(cita.estado)}</td>
        <td style="padding:12px"><button class="btn-primary btn-sm">Ver / Editar</button></td>
      `;
      tr.querySelector('button').addEventListener('click', () => {
        abrirModalDetallesCita(cita);
      });
      tbody.appendChild(tr);
    });
  } catch (e) {
    console.error('Error buscando estudios:', e);
    if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="padding:20px;text-align:center;color:#dc2626">Error al buscar estudios</td></tr>';
  }
}

// buscarRecibosPorDocumento removed ÔÇö replaced by buscarCitaParaRecibo in new Recibos UI

// Event listeners para buscadores (p├íginas dedicadas en sidebar)
$('btnBuscarCitaDocumento')?.addEventListener('click', buscarCitasPorDocumento);
$('buscarCitaDocumento')?.addEventListener('keydown', e => { if (e.key === 'Enter') buscarCitasPorDocumento(); });
$('btnLimpiarCitaDocumento')?.addEventListener('click', () => {
  const input = $('buscarCitaDocumento');
  if (input) input.value = '';
  const sec = $('buscarCitaResultadosSection');
  if (sec) sec.style.display = 'none';
});

$('btnBuscarEstudioDocumento')?.addEventListener('click', buscarEstudiosPorDocumento);
$('buscarEstudioDocumento')?.addEventListener('keydown', e => { if (e.key === 'Enter') buscarEstudiosPorDocumento(); });
$('btnLimpiarEstudioDocumento')?.addEventListener('click', () => {
  const input = $('buscarEstudioDocumento');
  if (input) input.value = '';
  const sec = $('buscarEstudioResultadosSection');
  if (sec) sec.style.display = 'none';
});

// Old recibo document search listeners removed ÔÇö those IDs no longer exist in the new HTML

// ============================================================
// PACIENTES EN ESPERA ÔÇö ELECTRODIAGN├ôSTICO
// ============================================================

let esperaData = [];   // cach├® local de registros

let _esperaPendienteId = null;  // id esperando confirmaci├│n de eliminaci├│n

function initEsperaElectro() {
  $('btnAgregarEspera')?.addEventListener('click', agregarPacienteEspera);

  // Cargar entidades din├ímicamente
  (async () => {
    try {
      const el = $('esperaFiltroEntidad');
      if (el) {
        el.innerHTML = '<option value="">Todas</option>';
        const resp = await apiFetch('/api/entidades');
        if (resp.ok) {
          const data = await resp.json();
          const entidades = Array.isArray(data) ? data : (data.registros || []);
          entidades.filter(e => e.activo !== 0).forEach(e => {
            const o = document.createElement('option');
            o.value = e.nombre;
            o.textContent = e.nombre;
            el.appendChild(o);
          });
        }
        // Inicializar multi-select
        if (typeof initMultiSelect === 'function') {
          initMultiSelect(el, { placeholder: 'Todas', onChange: () => renderEsperaTable() });
          if (typeof observeSelectForMulti === 'function') observeSelectForMulti(el);
        }
      }
    } catch (e) { console.warn('No se pudieron cargar entidades para espera:', e.message); }
  })();

  // Inicializar multi-select de prioridad (opciones est├íticas)
  const elPrio = $('esperaFiltroPrioridad');
  if (elPrio && typeof initMultiSelect === 'function') {
    initMultiSelect(elPrio, { placeholder: 'Todas', onChange: () => renderEsperaTable() });
  }

  // Filtros en tiempo real
  ['esperaFiltroTexto'].forEach(id => {
    $(id)?.addEventListener('input', renderEsperaTable);
    $(id)?.addEventListener('change', renderEsperaTable);
  });

  // Botones del modal de confirmaci├│n de eliminaci├│n
  $('btnConfirmarEliminarEspera')?.addEventListener('click', async () => {
    cerrarModalEliminarEspera();
    if (!_esperaPendienteId) return;
    try {
      const res = await apiFetch(`/api/pacientes-espera/${_esperaPendienteId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!data.ok) { showToast(data.error || 'Error al eliminar', 'error'); return; }
      showToast('Paciente eliminado de la lista', 'success');
      await cargarEsperaElectro();
    } catch (e) {
      showToast('Error: ' + e.message, 'error');
    } finally {
      _esperaPendienteId = null;
    }
  });
  $('btnCancelarEliminarEspera')?.addEventListener('click', cerrarModalEliminarEspera);
}

function cerrarModalEliminarEspera() {
  const m = $('modalConfirmarEliminarEspera');
  if (m) { m.classList.add('hidden'); m.style.display = 'none'; }
  _esperaPendienteId = null;
}

async function cargarEsperaElectro() {
  try {
    const res = await apiFetch('/api/pacientes-espera');
    esperaData = await res.json();
    renderEsperaTable();
  } catch (e) {
    console.error('Error cargando lista de espera:', e);
  }
}

function renderEsperaTable() {
  const texto = ($('esperaFiltroTexto')?.value || '').toLowerCase().trim();
  const entidadRaw = typeof getMultiSelectValue === 'function' ? getMultiSelectValue($('esperaFiltroEntidad')) : ($('esperaFiltroEntidad')?.value || '');
  const prioridadRaw = typeof getMultiSelectValue === 'function' ? getMultiSelectValue($('esperaFiltroPrioridad')) : ($('esperaFiltroPrioridad')?.value || '');
  const entidades = entidadRaw ? entidadRaw.split(',') : [];
  const prioridades = prioridadRaw ? prioridadRaw.split(',') : [];

  let lista = esperaData.filter(p => {
    const matchTexto = !texto || (
      (p.nombres || '').toLowerCase().includes(texto) ||
      (p.apellidos || '').toLowerCase().includes(texto) ||
      (p.documento || '').toLowerCase().includes(texto)
    );
    const matchEntidad = entidades.length === 0 || entidades.includes(p.entidad);
    const matchPrioridad = prioridades.length === 0 || prioridades.includes(p.prioridad);
    return matchTexto && matchEntidad && matchPrioridad;
  });

  // Orden: ALTA primero, luego MEDIA, luego BAJA
  const orden = { ALTA: 0, MEDIA: 1, BAJA: 2 };
  lista.sort((a, b) => (orden[a.prioridad] ?? 9) - (orden[b.prioridad] ?? 9));

  const tbody = $('esperaTableBody');
  const contador = $('esperaContador');
  if (!tbody) return;

  if (lista.length === 0) {
    tbody.innerHTML = '<tr><td colspan="11" style="padding:20px;text-align:center;color:#999">No hay pacientes que coincidan con los filtros</td></tr>';
    if (contador) contador.textContent = '0 pacientes';
    return;
  }

  if (contador) contador.textContent = `${lista.length} paciente${lista.length !== 1 ? 's' : ''}`;

  tbody.innerHTML = lista.map(p => {
    const prioMap = {
      ALTA:  { label: 'ALTA',  cls: 'alta'  },
      MEDIA: { label: 'MEDIA', cls: 'media' },
      BAJA:  { label: 'BAJA',  cls: 'baja'  },
    };
    const prio = prioMap[p.prioridad] || { label: p.prioridad, cls: '' };
    const fecha = p.creado_en
      ? new Date(p.creado_en).toLocaleDateString('es-CO', { day:'2-digit', month:'2-digit', year:'numeric' })
      : '-';
    return `<tr>
      <td><span class="badge-prioridad ${prio.cls}">${escapeHtml(prio.label)}</span></td>
      <td>${escapeHtml(p.documento || '-')}</td>
      <td>${escapeHtml(p.nombres || '')}</td>
      <td>${escapeHtml(p.apellidos || '')}</td>
      <td>${escapeHtml(p.entidad || '-')}</td>
      <td>${escapeHtml(p.telefono1 || '-')}</td>
      <td>${escapeHtml(p.telefono2 || '-')}</td>
      <td>${escapeHtml(p.tipo_estudio || '-')}</td>
      <td>${fecha}</td>
      <td>${escapeHtml(p.ingresado_por || '-')}</td>
      <td>
        <div class="table-actions">
          <button class="btn-eliminar" title="Eliminar" onclick="eliminarPacienteEspera(${p.id})">
            <img src="images/delete.svg" alt="Eliminar" />
          </button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

async function agregarPacienteEspera() {
  const documento   = $('esperaDocumento').value.trim();
  const nombres     = $('esperaNombres').value.trim();
  const apellidos   = $('esperaApellidos').value.trim();
  const entidad     = $('esperaEntidad').value;
  const prioridad   = $('esperaPrioridad').value;
  const telefono1   = $('esperaTelefono1')?.value.trim() || '';
  const telefono2   = $('esperaTelefono2')?.value.trim() || '';
  const tipo_estudio = $('esperaTipoEstudio')?.value.trim() || '';

  if (!documento || !nombres || !apellidos || !entidad || !prioridad) {
    showToast('Completa todos los campos obligatorios', 'error');
    return;
  }
  if (!/^\d{4,15}$/.test(documento)) {
    showToast('El documento debe tener entre 4 y 15 d├¡gitos num├®ricos', 'error');
    $('esperaDocumento').focus();
    return;
  }

  const btn = $('btnAgregarEspera');
  setLoading(btn, true, 'Guardando...');

  try {
    const res = await apiFetch('/api/pacientes-espera', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        documento, nombres, apellidos, entidad, prioridad,
        telefono1, telefono2, tipo_estudio,
        ingresado_por: currentUser ? (currentUser.nombre || currentUser.usuario) : 'Sistema'
      })
    });
    const data = await res.json();
    if (!data.ok) { showToast(data.error || 'Error al agregar paciente', 'error'); return; }

    showToast('Paciente agregado a la lista de espera', 'success');
    $('esperaDocumento').value = '';
    $('esperaNombres').value = '';
    $('esperaApellidos').value = '';
    $('esperaEntidad').value = '';
    $('esperaPrioridad').value = '';
    if ($('esperaTelefono1')) $('esperaTelefono1').value = '';
    if ($('esperaTelefono2')) $('esperaTelefono2').value = '';
    if ($('esperaTipoEstudio')) $('esperaTipoEstudio').value = '';
    await cargarEsperaElectro();
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  } finally {
    setLoading(btn, false);
  }
}

function eliminarPacienteEspera(id) {
  // Buscar nombre del paciente en cach├® para mostrarlo en el modal
  const paciente = esperaData.find(p => p.id === id);
  const nombre = paciente
    ? `${paciente.nombres || ''} ${paciente.apellidos || ''}`.trim() || 'este paciente'
    : 'este paciente';

  _esperaPendienteId = id;
  const m = $('modalConfirmarEliminarEspera');
  if (m) {
    $('modalEsperaNombrePaciente').textContent = nombre;
    m.classList.remove('hidden');
    m.style.display = 'flex';
  }
}

// ============================================================
// ESPECIALIDADES Y TIPOS DE CONSULTA ÔÇö M├ôDULO USUARIOS
// ============================================================

// Cach├® para evitar re-fetches innecesarios
let _especialidadesCache = null;
let _tiposConsultaCache  = {};   // clave: nombre de especialidad
let _especialidadSelId   = null; // id de especialidad abierta en el panel de tipos
let _especialidadesInitialized = false;

// Popula un <select> con las especialidades cargadas de la API
async function cargarOpcionesEspecialidad(selectId) {
  const sel = $(selectId);
  if (!sel) return;
  try {
    if (!_especialidadesCache) {
      const res = await apiFetch('/api/especialidades');
      _especialidadesCache = await res.json();
    }
    // Conservar primera opci├│n (vac├¡a) y "Otra" al final
    const primeraOpcion = sel.options[0];
    sel.innerHTML = '';
    sel.appendChild(primeraOpcion);
    _especialidadesCache.forEach(e => {
      const opt = document.createElement('option');
      opt.value = e.nombre;
      opt.textContent = e.nombre;
      sel.appendChild(opt);
    });
    const otraOpt = document.createElement('option');
    otraOpt.value = 'Otra';
    otraOpt.textContent = 'Otra';
    sel.appendChild(otraOpt);
  } catch (e) {
    console.error('Error cargando especialidades en select:', e);
  }
}

function initEspecialidades() {
  if (_especialidadesInitialized) { cargarEspecialidades(); return; }
  _especialidadesInitialized = true;

  $('btnCrearEspecialidad')?.addEventListener('click', crearEspecialidad);
  $('espNombreNuevo')?.addEventListener('keydown', e => { if (e.key === 'Enter') crearEspecialidad(); });
  $('btnCrearTipoConsulta')?.addEventListener('click', crearTipoConsulta);
  $('tipoConsultaNuevoNombre')?.addEventListener('keydown', e => { if (e.key === 'Enter') crearTipoConsulta(); });

  cargarEspecialidades();
}

async function cargarEspecialidades() {
  try {
    const res = await apiFetch('/api/especialidades');
    const data = await res.json();
    _especialidadesCache = data;   // actualizar cach├®
    _tiposConsultaCache  = {};     // invalidar cach├® de tipos
    renderEspecialidadesTable(data);
  } catch (e) {
    showToast('Error cargando especialidades', 'error');
  }
}

function renderEspecialidadesTable(lista) {
  const tbody = $('especialidadesTableBody');
  if (!tbody) return;
  if (!lista || lista.length === 0) {
    tbody.innerHTML = '<tr><td colspan="2" style="padding:20px;text-align:center;color:#999">No hay especialidades. Agrega la primera.</td></tr>';
    return;
  }
  tbody.innerHTML = lista.map(e => {
    const n = escapeHtml(e.nombre).replace(/'/g, "\\'");
    return `<tr>
      <td style="font-weight:500">${escapeHtml(e.nombre)}</td>
      <td>
        <div class="table-actions">
          <button class="btn-secondary btn-sm" title="Gestionar tipos de consulta" onclick="abrirTiposConsulta(${e.id},'${n}')">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:3px"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>Tipos
          </button>
          <button class="btn-editar" title="Renombrar" onclick="editarEspecialidad(${e.id},'${n}')">
            <img src="images/edit.svg" alt="Editar" />
          </button>
          <button class="btn-eliminar" title="Eliminar" onclick="eliminarEspecialidad(${e.id},'${n}')">
            <img src="images/delete.svg" alt="Eliminar" />
          </button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

async function crearEspecialidad() {
  const nombre = $('espNombreNuevo').value.trim();
  if (!nombre) { showToast('Escribe el nombre de la especialidad', 'error'); return; }
  const btn = $('btnCrearEspecialidad');
  setLoading(btn, true, 'Guardando...');
  try {
    const res = await apiFetch('/api/especialidades', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre })
    });
    const data = await res.json();
    if (!data.ok) { showToast(data.error || 'Error al crear', 'error'); return; }
    showToast('Especialidad creada', 'success');
    $('espNombreNuevo').value = '';
    _especialidadesCache = null;
    await cargarEspecialidades();
    await cargarOpcionesEspecialidad('newUserEspecialidad');
    await cargarOpcionesEspecialidad('editEspecialidad');
  } catch (e) { showToast('Error: ' + e.message, 'error'); }
  finally { setLoading(btn, false); }
}

async function editarEspecialidad(id, nombreActual) {
  const nuevoNombre = prompt('Renombrar especialidad:', nombreActual);
  if (!nuevoNombre || nuevoNombre.trim() === nombreActual) return;
  try {
    const res = await apiFetch(`/api/especialidades/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre: nuevoNombre.trim() })
    });
    const data = await res.json();
    if (!data.ok) { showToast(data.error || 'Error', 'error'); return; }
    showToast('Especialidad actualizada', 'success');
    _especialidadesCache = null;
    _tiposConsultaCache = {};
    await cargarEspecialidades();
    await cargarOpcionesEspecialidad('newUserEspecialidad');
    await cargarOpcionesEspecialidad('editEspecialidad');
  } catch (e) { showToast('Error: ' + e.message, 'error'); }
}

function eliminarEspecialidad(id, nombre) {
  showConfirm(`┬┐Eliminar la especialidad "${nombre}" y todos sus tipos de consulta?\nEsta acci├│n no se puede deshacer.`, async () => {
  try {
    const res = await apiFetch(`/api/especialidades/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!data.ok) { showToast(data.error || 'Error', 'error'); return; }
    showToast('Especialidad eliminada', 'success');
    if (_especialidadSelId === id) cerrarTiposConsultaPanel();
    _especialidadesCache = null;
    _tiposConsultaCache = {};
    await cargarEspecialidades();
    await cargarOpcionesEspecialidad('newUserEspecialidad');
    await cargarOpcionesEspecialidad('editEspecialidad');
  } catch (e) { showToast('Error: ' + e.message, 'error'); }
  });
}

async function abrirTiposConsulta(id, nombre) {
  _especialidadSelId = id;
  $('tiposConsultaEspNombre').textContent = nombre;
  const panel = $('tiposConsultaPanel');
  if (panel) {
    panel.style.display = '';
    setTimeout(() => panel.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }
  $('tipoConsultaNuevoNombre').value = '';
  await cargarTiposConsultaPanel();
}

function cerrarTiposConsultaPanel() {
  _especialidadSelId = null;
  const panel = $('tiposConsultaPanel');
  if (panel) panel.style.display = 'none';
}

async function cargarTiposConsultaPanel() {
  if (!_especialidadSelId) return;
  const tbody = $('tiposConsultaTableBody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="2" style="padding:16px;text-align:center;color:#999">Cargando...</td></tr>';
  try {
    const res = await apiFetch(`/api/tipos-consulta?especialidad_id=${_especialidadSelId}`);
    const data = await res.json();
    renderTiposConsultaPanel(data);
    // Invalidar cach├® de agenda para esta especialidad
    if (_especialidadesCache) {
      const esp = _especialidadesCache.find(e => e.id === _especialidadSelId);
      if (esp) delete _tiposConsultaCache[esp.nombre];
    }
  } catch (e) { showToast('Error cargando tipos', 'error'); }
}

function renderTiposConsultaPanel(lista) {
  const tbody = $('tiposConsultaTableBody');
  if (!tbody) return;
  if (!lista || lista.length === 0) {
    tbody.innerHTML = '<tr><td colspan="2" style="padding:16px;text-align:center;color:#999">Sin tipos de consulta. Agrega el primero.</td></tr>';
    return;
  }
  tbody.innerHTML = lista.map(t => {
    const n = escapeHtml(t.nombre).replace(/'/g, "\\'");
    return `<tr>
      <td>${escapeHtml(t.nombre)}</td>
      <td>
        <div class="table-actions">
          <button class="btn-editar" title="Editar" onclick="editarTipoConsulta(${t.id},'${n}')">
            <img src="images/edit.svg" alt="Editar" />
          </button>
          <button class="btn-eliminar" title="Eliminar" onclick="eliminarTipoConsulta(${t.id})">
            <img src="images/delete.svg" alt="Eliminar" />
          </button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

async function crearTipoConsulta() {
  const nombre = $('tipoConsultaNuevoNombre').value.trim();
  if (!nombre) { showToast('Escribe el nombre del tipo de consulta', 'error'); return; }
  if (!_especialidadSelId) return;
  const btn = $('btnCrearTipoConsulta');
  setLoading(btn, true, 'Guardando...');
  try {
    const res = await apiFetch('/api/tipos-consulta', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ especialidad_id: _especialidadSelId, nombre })
    });
    const data = await res.json();
    if (!data.ok) { showToast(data.error || 'Error', 'error'); return; }
    showToast('Tipo de consulta agregado', 'success');
    $('tipoConsultaNuevoNombre').value = '';
    await cargarTiposConsultaPanel();
  } catch (e) { showToast('Error: ' + e.message, 'error'); }
  finally { setLoading(btn, false); }
}

async function editarTipoConsulta(id, nombreActual) {
  const nuevoNombre = prompt('Editar tipo de consulta:', nombreActual);
  if (!nuevoNombre || nuevoNombre.trim() === nombreActual) return;
  try {
    const res = await apiFetch(`/api/tipos-consulta/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre: nuevoNombre.trim() })
    });
    const data = await res.json();
    if (!data.ok) { showToast(data.error || 'Error', 'error'); return; }
    showToast('Tipo actualizado', 'success');
    await cargarTiposConsultaPanel();
  } catch (e) { showToast('Error: ' + e.message, 'error'); }
}

function eliminarTipoConsulta(id) {
  showConfirm('┬┐Eliminar este tipo de consulta?', async () => {
    try {
      const res = await apiFetch(`/api/tipos-consulta/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!data.ok) { showToast(data.error || 'Error', 'error'); return; }
      showToast('Tipo eliminado', 'success');
      await cargarTiposConsultaPanel();
    } catch (e) { showToast('Error: ' + e.message, 'error'); }
  });
}

// ========== M├ôDULO GESTI├ôN DE DATOS ==========

let _gestionTipoActual = 'citas_electro';

const _gestionTitulos = {
  citas_electro:     'Citas Electrodiagn├│stico',
  turnos:            'Turnos M├®dicos',
  recibos:           'Recibos',
  estudio_duraciones:'Tipos de Estudio',
  especialidades:    'Especialidades',
  tipos_consulta:    'Tipos de Consulta',
  diagnosticos:      'Diagn├│sticos',
  entidades:         'Entidades'
};

const _gestionColumnas = {
  citas_electro: [
    { key: 'id',              label: 'ID' },
    { key: 'paciente_nombre', label: 'Paciente' },
    { key: 'documento',       label: 'Documento' },
    { key: 'fecha',           label: 'Fecha' },
    { key: 'hora',            label: 'Hora' },
    { key: 'estudio',         label: 'Estudio' },
    { key: 'estado',          label: 'Estado' }
  ],
  turnos: [
    { key: 'id',              label: 'ID' },
    { key: 'paciente_nombre', label: 'Paciente' },
    { key: 'documento',       label: 'Documento' },
    { key: 'fecha',           label: 'Fecha' },
    { key: 'hora',            label: 'Hora' },
    { key: 'tipo',            label: 'Tipo consulta' },
    { key: 'estado',          label: 'Estado' }
  ],
  recibos: [
    { key: 'id',         label: 'ID' },
    { key: 'numero',     label: 'N┬░' },
    { key: 'cliente',    label: 'Cliente' },
    { key: 'fecha',      label: 'Fecha' },
    { key: 'total',      label: 'Total' },
    { key: 'tipo_pago',  label: 'Pago' },
    { key: 'creado_por', label: 'Creado por' }
  ],
  estudio_duraciones: [
    { key: 'id',                label: 'ID' },
    { key: 'nombre',            label: 'Nombre' },
    { key: 'duracion_minutos',  label: 'Duraci├│n (min)' }
  ],
  especialidades: [
    { key: 'id',     label: 'ID' },
    { key: 'nombre', label: 'Nombre' },
    { key: 'activo', label: 'Activo', format: v => v ? 'S├¡' : 'No' }
  ],
  tipos_consulta: [
    { key: 'id',          label: 'ID' },
    { key: 'nombre',      label: 'Nombre' },
    { key: 'especialidad',label: 'Especialidad' },
    { key: 'activo',      label: 'Activo', format: v => v ? 'S├¡' : 'No' }
  ],
  diagnosticos: [
    { key: 'id',     label: 'ID' },
    { key: 'nombre', label: 'Nombre' },
    { key: 'codigo', label: 'C├│digo' },
    { key: 'activo', label: 'Activo', format: v => v ? 'S├¡' : 'No' }
  ],
  entidades: [
    { key: 'id',     label: 'ID' },
    { key: 'nombre', label: 'Nombre' },
    { key: 'activo', label: 'Activo', format: v => v ? 'S├¡' : 'No' }
  ]
};

let _gestionSeleccionados = new Set();
let _gestionRegistrosAll  = [];
let _gestionPaginaActual  = 1;
const _GESTION_POR_PAGINA = 20;
const _GESTION_TIPOS_AGREGAR = ['estudio_duraciones', 'especialidades', 'tipos_consulta', 'diagnosticos', 'entidades'];

function _actualizarConteoGestion() {
  const n = _gestionSeleccionados.size;
  const span = $('gestionSeleccionados');
  if (span) span.textContent = `${n} seleccionado${n !== 1 ? 's' : ''}`;
  const btn = $('btnEliminarSeleccionados');
  if (btn) btn.disabled = n === 0;
}

function _gestionActualizarFiltros() {
  const tipo = _gestionTipoActual;
  const hayFechas   = ['citas_electro', 'turnos', 'recibos'].includes(tipo);
  const hayBusqueda = ['citas_electro', 'turnos', 'recibos', 'diagnosticos', 'entidades'].includes(tipo);
  const colBusqueda = $('gestionBusqueda')?.closest('.col');
  const colDesde    = $('gestionFechaDesde')?.closest('.col');
  const colHasta    = $('gestionFechaHasta')?.closest('.col');
  if (colBusqueda) colBusqueda.style.display = hayBusqueda ? '' : 'none';
  if (colDesde)    colDesde.style.display    = hayFechas   ? '' : 'none';
  if (colHasta)    colHasta.style.display    = hayFechas   ? '' : 'none';
}

function initGestionDatos() {
  // Sidebar: cambio de tab
  document.querySelectorAll('#view-gestion-datos [data-gestion-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#view-gestion-datos [data-gestion-tab]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _gestionTipoActual = btn.dataset.gestionTab;
      const titulo = $('gestionDatosTitulo');
      if (titulo) titulo.textContent = _gestionTitulos[_gestionTipoActual] || _gestionTipoActual;
      if ($('gestionBusqueda')) $('gestionBusqueda').value = '';
      if ($('gestionFechaDesde')) $('gestionFechaDesde').value = '';
      if ($('gestionFechaHasta')) $('gestionFechaHasta').value = '';
      _gestionSeleccionados = new Set();
      _actualizarConteoGestion();
      _gestionActualizarFiltros();
      // Mostrar/ocultar bot├│n Agregar seg├║n tipo
      const btnAgregar = $('btnAgregarGestion');
      if (btnAgregar) btnAgregar.style.display = _GESTION_TIPOS_AGREGAR.includes(_gestionTipoActual) ? '' : 'none';
      buscarGestionDatos();
    });
  });

  $('btnBuscarGestion')?.addEventListener('click', buscarGestionDatos);
  $('btnLimpiarGestion')?.addEventListener('click', () => {
    if ($('gestionBusqueda'))   $('gestionBusqueda').value   = '';
    if ($('gestionFechaDesde')) $('gestionFechaDesde').value = '';
    if ($('gestionFechaHasta')) $('gestionFechaHasta').value = '';
    buscarGestionDatos();
  });
  $('gestionBusqueda')?.addEventListener('keydown', e => { if (e.key === 'Enter') buscarGestionDatos(); });
  $('btnAgregarGestion')?.addEventListener('click', abrirModalAgregarGestion);

  // Socket: recargar cuando se crea un estudio, especialidad, etc.
  if (window.socket) {
    window.socket.off('estudio:creado');
    window.socket.off('tipos-consulta:actualizado');
    window.socket.on('estudio:creado',           () => { if (_gestionTipoActual === 'estudio_duraciones') buscarGestionDatos(); });
    window.socket.on('tipos-consulta:actualizado',() => { if (_gestionTipoActual === 'tipos_consulta')    buscarGestionDatos(); });
  }

  _gestionActualizarFiltros();
  // Visibilidad inicial del bot├│n Agregar
  const btnAgregar = $('btnAgregarGestion');
  if (btnAgregar) btnAgregar.style.display = _GESTION_TIPOS_AGREGAR.includes(_gestionTipoActual) ? '' : 'none';
  buscarGestionDatos();
}

function _gestionRenderThead(tipo) {
  const cols  = _gestionColumnas[tipo] || [];
  const thead = $('gestionThead');
  if (!thead) return;
  const colHeaders = cols.map(c => `<th>${c.label}</th>`).join('');
  thead.innerHTML = `<tr>
    <th><input type="checkbox" id="chkSelectAll" title="Seleccionar todos" /></th>
    ${colHeaders}
    <th>Acciones</th>
  </tr>`;
  $('chkSelectAll')?.addEventListener('change', function () {
    document.querySelectorAll('#bodyGestionDatos .chk-row').forEach(chk => {
      chk.checked = this.checked;
      const id = parseInt(chk.dataset.id);
      if (this.checked) _gestionSeleccionados.add(id);
      else _gestionSeleccionados.delete(id);
    });
    _actualizarConteoGestion();
  });
}

function _gestionRenderRows(tipo, registros) {
  const cols  = _gestionColumnas[tipo] || [];
  const tbody = $('bodyGestionDatos');
  if (!tbody) return;
  if (!registros.length) {
    tbody.innerHTML = `<tr><td colspan="${cols.length + 2}" style="padding:20px;text-align:center;color:#999">No se encontraron registros</td></tr>`;
    return;
  }
  tbody.innerHTML = registros.map(r => {
    const cells = cols.map(c => {
      const val = r[c.key];
      const display = (val === null || val === undefined) ? '-' : (c.format ? c.format(val) : escapeHtml(String(val)));
      return `<td>${display}</td>`;
    }).join('');
    return `<tr>
      <td><input type="checkbox" class="chk-row" data-id="${r.id}" /></td>
      ${cells}
      <td>
        <button class="btn-eliminar" title="Eliminar" onclick="confirmarEliminarGestion('${tipo}',${r.id})">
          <img src="images/delete.svg" alt="Eliminar" />
        </button>
      </td>
    </tr>`;
  }).join('');
  tbody.querySelectorAll('.chk-row').forEach(chk => {
    chk.addEventListener('change', function () {
      const id = parseInt(this.dataset.id);
      if (this.checked) _gestionSeleccionados.add(id);
      else _gestionSeleccionados.delete(id);
      _actualizarConteoGestion();
    });
  });
}

async function buscarGestionDatos() {
  const tipo  = _gestionTipoActual;
  const q     = $('gestionBusqueda')?.value.trim() || '';
  const desde = $('gestionFechaDesde')?.value || '';
  const hasta = $('gestionFechaHasta')?.value || '';
  const params = new URLSearchParams({ limit: 500 });
  if (q)     params.set('q',           q);
  if (desde) params.set('fecha_desde', desde);
  if (hasta) params.set('fecha_hasta', hasta);

  const tbody = $('bodyGestionDatos');
  if (tbody) tbody.innerHTML = `<tr><td colspan="10" style="padding:20px;text-align:center;color:#999">Cargando...</td></tr>`;
  _gestionSeleccionados = new Set();
  _actualizarConteoGestion();
  const chkAll = $('chkSelectAll');
  if (chkAll) chkAll.checked = false;

  try {
    const res = await apiFetch(`/api/admin/datos/${tipo}?${params}`);
    if (res.status === 403) {
      if (tbody) tbody.innerHTML = `<tr><td colspan="10" style="padding:20px;text-align:center;color:#dc2626">Sin permisos para realizar esta acci├│n</td></tr>`;
      return;
    }
    const data = await res.json();
    if (!data.ok) {
      if (tbody) tbody.innerHTML = `<tr><td colspan="10" style="padding:20px;text-align:center;color:#dc2626">${escapeHtml(data.error || 'Error')}</td></tr>`;
      return;
    }
    _gestionRegistrosAll = data.registros || [];
    _gestionPaginaActual = 1;
    _gestionRenderThead(tipo);
    _gestionRenderPagina();
    _gestionRenderPaginacion();
  } catch (e) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="10" style="padding:20px;text-align:center;color:#dc2626">Error: ${escapeHtml(e.message)}</td></tr>`;
  }
}

function _gestionRenderPagina() {
  const inicio = (_gestionPaginaActual - 1) * _GESTION_POR_PAGINA;
  const pagina = _gestionRegistrosAll.slice(inicio, inicio + _GESTION_POR_PAGINA);
  _gestionRenderRows(_gestionTipoActual, pagina);
}

function _gestionRenderPaginacion() {
  const ctrl = $('gestionDatosControls');
  if (!ctrl) return;
  const total   = _gestionRegistrosAll.length;
  const pages   = Math.ceil(total / _GESTION_POR_PAGINA);
  const pag     = _gestionPaginaActual;
  const inicio  = ((pag - 1) * _GESTION_POR_PAGINA) + 1;
  const fin     = Math.min(pag * _GESTION_POR_PAGINA, total);

  if (total === 0) { ctrl.textContent = '0 registros'; return; }

  let html = `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 0">
    <span style="font-size:13px;color:#627371">${total} registro${total !== 1 ? 's' : ''} ÔÇö mostrando ${inicio}ÔÇô${fin}</span>`;
  if (pages > 1) {
    html += `<div style="display:flex;gap:4px;align-items:center">`;
    html += `<button onclick="_gestionIrPagina(${pag - 1})" ${pag <= 1 ? 'disabled' : ''} style="padding:4px 10px;border:1px solid #d1d5db;border-radius:4px;background:#fff;cursor:pointer;font-size:13px">ÔÇ╣</button>`;
    const start = Math.max(1, pag - 2), end = Math.min(pages, pag + 2);
    if (start > 1) html += `<button onclick="_gestionIrPagina(1)" style="padding:4px 8px;border:1px solid #d1d5db;border-radius:4px;background:#fff;cursor:pointer;font-size:13px">1</button>${start > 2 ? '<span style="padding:0 4px">ÔÇª</span>' : ''}`;
    for (let i = start; i <= end; i++) {
      const active = i === pag ? 'background:#627371;color:#fff;border-color:#627371' : 'background:#fff';
      html += `<button onclick="_gestionIrPagina(${i})" style="padding:4px 8px;border:1px solid #d1d5db;border-radius:4px;cursor:pointer;font-size:13px;${active}">${i}</button>`;
    }
    if (end < pages) html += `${end < pages - 1 ? '<span style="padding:0 4px">ÔÇª</span>' : ''}<button onclick="_gestionIrPagina(${pages})" style="padding:4px 8px;border:1px solid #d1d5db;border-radius:4px;background:#fff;cursor:pointer;font-size:13px">${pages}</button>`;
    html += `<button onclick="_gestionIrPagina(${pag + 1})" ${pag >= pages ? 'disabled' : ''} style="padding:4px 10px;border:1px solid #d1d5db;border-radius:4px;background:#fff;cursor:pointer;font-size:13px">ÔÇ║</button>`;
    html += `</div>`;
  }
  html += `</div>`;
  ctrl.innerHTML = html;
}

function _gestionIrPagina(n) {
  const pages = Math.ceil(_gestionRegistrosAll.length / _GESTION_POR_PAGINA);
  if (n < 1 || n > pages) return;
  _gestionPaginaActual = n;
  _gestionSeleccionados = new Set();
  _actualizarConteoGestion();
  const chkAll = $('chkSelectAll');
  if (chkAll) chkAll.checked = false;
  _gestionRenderPagina();
  _gestionRenderPaginacion();
}

async function abrirModalAgregarGestion() {
  const tipo = _gestionTipoActual;
  if (!_GESTION_TIPOS_AGREGAR.includes(tipo)) return;
  const modal = $('modalAgregarGestion');
  if (!modal) return;

  const titulo = $('modalAgregarGestionTitulo');
  if (titulo) titulo.textContent = `Agregar ÔÇö ${_gestionTitulos[tipo] || tipo}`;

  // Construir formulario din├ímico
  const form = $('formAgregarGestion');
  if (!form) return;
  let camposHtml = '';
  if (tipo === 'estudio_duraciones') {
    camposHtml = `
      <div style="margin-bottom:14px">
        <label style="display:block;margin-bottom:6px;font-weight:500;font-size:14px">Nombre del estudio *</label>
        <input id="agrGestionNombre" type="text" required maxlength="120" placeholder="Ej: Electromiograf├¡a" style="width:100%;padding:9px 12px;border:1px solid #d1d5db;border-radius:6px;box-sizing:border-box;font-size:14px" />
      </div>
      <div style="margin-bottom:14px">
        <label style="display:block;margin-bottom:6px;font-weight:500;font-size:14px">Duraci├│n en minutos *</label>
        <input id="agrGestionDuracion" type="number" required min="1" max="480" placeholder="Ej: 45" style="width:100%;padding:9px 12px;border:1px solid #d1d5db;border-radius:6px;box-sizing:border-box;font-size:14px" />
      </div>`;
  } else if (tipo === 'especialidades') {
    camposHtml = `
      <div style="margin-bottom:14px">
        <label style="display:block;margin-bottom:6px;font-weight:500;font-size:14px">Nombre de la especialidad *</label>
        <input id="agrGestionNombre" type="text" required maxlength="120" placeholder="Ej: Cardiolog├¡a" style="width:100%;padding:9px 12px;border:1px solid #d1d5db;border-radius:6px;box-sizing:border-box;font-size:14px" />
      </div>`;
  } else if (tipo === 'tipos_consulta') {
    // Cargar especialidades para el select
    let espOptions = '<option value="">Seleccionar especialidadÔÇª</option>';
    try {
      const res = await apiFetch('/api/especialidades');
      if (res.ok) {
        const lista = await res.json();
        espOptions += lista.map(e => `<option value="${e.id}">${escapeHtml(e.nombre)}</option>`).join('');
      }
    } catch(_) { console.warn('[showModal] Failed to load specialties'); }
    camposHtml = `
      <div style="margin-bottom:14px">
        <label style="display:block;margin-bottom:6px;font-weight:500;font-size:14px">Especialidad *</label>
        <select id="agrGestionEspecialidad" required style="width:100%;padding:9px 12px;border:1px solid #d1d5db;border-radius:6px;box-sizing:border-box;font-size:14px;background:#fff">${espOptions}</select>
      </div>
      <div style="margin-bottom:14px">
        <label style="display:block;margin-bottom:6px;font-weight:500;font-size:14px">Nombre del tipo de consulta *</label>
        <input id="agrGestionNombre" type="text" required maxlength="120" placeholder="Ej: Consulta de control" style="width:100%;padding:9px 12px;border:1px solid #d1d5db;border-radius:6px;box-sizing:border-box;font-size:14px" />
      </div>`;
  } else if (tipo === 'diagnosticos') {
    camposHtml = `
      <div style="margin-bottom:14px">
        <label style="display:block;margin-bottom:6px;font-weight:500;font-size:14px">Nombre *</label>
        <input id="agrGestionNombre" type="text" required maxlength="200" placeholder="Nombre del diagn├│stico" style="width:100%;padding:9px 12px;border:1px solid #d1d5db;border-radius:6px;box-sizing:border-box;font-size:14px" />
      </div>
      <div style="margin-bottom:14px">
        <label style="display:block;margin-bottom:6px;font-weight:500;font-size:14px">C├│digo (opcional)</label>
        <input id="agrGestionCodigo" type="text" maxlength="20" placeholder="Ej: A00.1" style="width:100%;padding:9px 12px;border:1px solid #d1d5db;border-radius:6px;box-sizing:border-box;font-size:14px" />
      </div>
      <div style="margin-bottom:14px">
        <label style="display:block;margin-bottom:6px;font-weight:500;font-size:14px">Descripci├│n (opcional)</label>
        <textarea id="agrGestionDescripcion" rows="3" maxlength="500" placeholder="Descripci├│n adicionalÔÇª" style="width:100%;padding:9px 12px;border:1px solid #d1d5db;border-radius:6px;box-sizing:border-box;font-size:14px;resize:vertical"></textarea>
      </div>`;
  } else if (tipo === 'entidades') {
    camposHtml = `
      <div style="margin-bottom:14px">
        <label style="display:block;margin-bottom:6px;font-weight:500;font-size:14px">Nombre de la entidad *</label>
        <input id="agrGestionNombre" type="text" required maxlength="200" placeholder="Ej: NUEVA EPS" style="width:100%;padding:9px 12px;border:1px solid #d1d5db;border-radius:6px;box-sizing:border-box;font-size:14px" />
        <span style="font-size:0.78rem;color:#6b7280;margin-top:4px;display:block">Se guardar├í en may├║sculas autom├íticamente</span>
      </div>`;
  }
  form.innerHTML = camposHtml +
    `<div style="display:flex;justify-content:flex-end;gap:10px;margin-top:20px">
       <button type="button" class="btn-secondary btn-sm" onclick="$('modalAgregarGestion').classList.add('hidden')">Cancelar</button>
       <button type="submit" class="btn-primary btn-sm">Guardar</button>
     </div>`;
  form.onsubmit = guardarAgregarGestion;
  modal.classList.remove('hidden');
  setTimeout(() => { const inp = form.querySelector('input,select'); if (inp) inp.focus(); }, 80);
}

async function guardarAgregarGestion(e) {
  e.preventDefault();
  const tipo  = _gestionTipoActual;
  const nombre = $('agrGestionNombre')?.value.trim() || '';
  const body  = { nombre };
  if (tipo === 'estudio_duraciones') body.duracion_minutos = parseInt($('agrGestionDuracion')?.value || '0', 10);
  if (tipo === 'tipos_consulta')     body.especialidad_id  = $('agrGestionEspecialidad')?.value;
  if (tipo === 'diagnosticos') {
    body.codigo      = $('agrGestionCodigo')?.value.trim() || undefined;
    body.descripcion = $('agrGestionDescripcion')?.value.trim() || undefined;
  }
  try {
    const res  = await apiFetch(`/api/admin/datos/${tipo}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!data.ok) { showToast(data.error || 'Error al guardar', 'error'); return; }
    showToast('Registro agregado exitosamente', 'success');
    $('modalAgregarGestion').classList.add('hidden');
    // Invalidar cach├® para que otros m├│dulos recarguen datos actualizados
    if (tipo === 'entidades') invalidarCacheEntidades();
    if (tipo === 'estudio_duraciones') invalidarCacheEstudios();
    buscarGestionDatos();
  } catch (err) { showToast('Error: ' + err.message, 'error'); }
}

function confirmarEliminarGestion(tipo, id) {
  const titulo = _gestionTitulos[tipo] || tipo;
  showConfirm(`┬┐Eliminar este registro de "${titulo}"?\nEsta acci├│n es permanente e irreversible.`, async () => {
  try {
    const res  = await apiFetch(`/api/admin/datos/${tipo}/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!data.ok) { showToast(data.error || 'Error al eliminar', 'error'); return; }
    showToast('Registro eliminado', 'success');
    // Invalidar cach├® para que otros m├│dulos recarguen datos actualizados
    if (tipo === 'entidades') invalidarCacheEntidades();
    if (tipo === 'estudio_duraciones') invalidarCacheEstudios();
    buscarGestionDatos();
  } catch (e) { showToast('Error: ' + e.message, 'error'); }
  });
}

function eliminarSeleccionadosGestion() {
  const ids = Array.from(_gestionSeleccionados);
  if (!ids.length) return;
  const tipo   = _gestionTipoActual;
  const titulo = _gestionTitulos[tipo] || tipo;
  const n      = ids.length;
  showConfirm(`┬┐Eliminar ${n} registro${n !== 1 ? 's' : ''} de "${titulo}"?\nEsta acci├│n es permanente e irreversible.`, async () => {
  try {
    const res  = await apiFetch(`/api/admin/datos/${tipo}/bulk`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids })
    });
    const data = await res.json();
    if (!data.ok) { showToast(data.error || 'Error al eliminar', 'error'); return; }
    const eliminados = data.eliminados ?? n;
    showToast(`${eliminados} registro${eliminados !== 1 ? 's' : ''} eliminado${eliminados !== 1 ? 's' : ''}`, 'success');
    // Invalidar cach├® para que otros m├│dulos recarguen datos actualizados
    if (tipo === 'entidades') invalidarCacheEntidades();
    if (tipo === 'estudio_duraciones') invalidarCacheEstudios();
    buscarGestionDatos();
  } catch (e) { showToast('Error: ' + e.message, 'error'); }
  });
}


// ========== MONITOR DE EQUIPOS ==========
let initMonitorEquiposDone = false;
let _monitorRefreshTimer = null;
let _monitorFechaActual = null; // null = hoy

function _monitorGetHoy() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

function _monitorEsHoy() {
  return !_monitorFechaActual || _monitorFechaActual === _monitorGetHoy();
}

function _monitorFormatDateLabel(fecha) {
  if (!fecha) return 'Hoy';
  const hoy = _monitorGetHoy();
  if (fecha === hoy) return 'Hoy';
  const DIAS = ['Domingo','Lunes','Martes','Mi\u00e9rcoles','Jueves','Viernes','S\u00e1bado'];
  const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const parts = fecha.split('-').map(Number);
  const d = new Date(parts[0], parts[1]-1, parts[2]);
  return DIAS[d.getDay()] + ' ' + parts[2] + ' ' + MESES[parts[1]-1] + ' ' + parts[0];
}

function _monitorCambiarFecha(offset) {
  const base = _monitorFechaActual || _monitorGetHoy();
  const parts = base.split('-').map(Number);
  const d = new Date(parts[0], parts[1]-1, parts[2] + offset);
  _monitorFechaActual = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  _monitorSyncDateUI();
  cargarMonitorEquipos();
}

function _monitorIrAHoy() {
  _monitorFechaActual = null;
  _monitorSyncDateUI();
  cargarMonitorEquipos();
}

function _monitorSyncDateUI() {
  const picker = $('monitorDatePicker');
  const label = $('monitorDateLabel');
  const btnHoy = $('monitorDateHoy');
  const fecha = _monitorFechaActual || _monitorGetHoy();
  if (picker) picker.value = fecha;
  if (label) label.textContent = _monitorFormatDateLabel(fecha);
  if (btnHoy) btnHoy.style.display = _monitorEsHoy() ? 'none' : '';
  const badge = $('monitorHistBadge');
  if (badge) badge.style.display = _monitorEsHoy() ? 'none' : '';
}

function initMonitorEquipos() {
  if (initMonitorEquiposDone) { cargarMonitorEquipos(); return; }
  initMonitorEquiposDone = true;

  $('btnVolverMonitorEquipos')?.addEventListener('click', goToMenu);
  $('btnRefreshMonitor')?.addEventListener('click', () => cargarMonitorEquipos());
  $('monitorDatePrev')?.addEventListener('click', () => _monitorCambiarFecha(-1));
  $('monitorDateNext')?.addEventListener('click', () => _monitorCambiarFecha(1));
  $('monitorDateHoy')?.addEventListener('click', _monitorIrAHoy);
  const picker = $('monitorDatePicker');
  if (picker) picker.addEventListener('change', function() {
    _monitorFechaActual = this.value || null;
    _monitorSyncDateUI();
    cargarMonitorEquipos();
  });

  if (window.socket) {
    window.socket.on('electro:cita-actualizada', () => {
      if (window.currentModule === 'monitor-equipos') cargarMonitorEquipos();
    });
    window.socket.on('electro:actualizar-lista', () => {
      if (window.currentModule === 'monitor-equipos') cargarMonitorEquipos();
    });
  }

  _monitorSyncDateUI();
  cargarMonitorEquipos();

  if (_monitorRefreshTimer) clearInterval(_monitorRefreshTimer);
  _monitorRefreshTimer = setInterval(() => {
    if (window.currentModule === 'monitor-equipos' && _monitorEsHoy()) cargarMonitorEquipos();
  }, 30000);
}

async function cargarMonitorEquipos() {
  try {
    let url = '/api/equipos-electro/monitor';
    if (_monitorFechaActual && _monitorFechaActual !== _monitorGetHoy()) {
      url += '?fecha=' + encodeURIComponent(_monitorFechaActual);
    }
    const res = await apiFetch(url);
    const data = await res.json();
    if (data && data.equipos) {
      renderMonitorEquipos(data);
    }
    const ts = $('monitorLastUpdate');
    if (ts) {
      const now = new Date();
      ts.textContent = 'Actualizado ' + String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0') + ':' + String(now.getSeconds()).padStart(2,'0');
    }
  } catch (e) {
    console.error('[MONITOR] Error:', e);
    const grid = $('monitorEquiposGrid');
    if (grid) grid.innerHTML = '<div class="meq-empty-cell" style="text-align:center;padding:60px 20px">Error cargando equipos</div>';
  }
}

function renderMonitorEquipos(data) {
  const equipos = data.equipos || [];
  const sinEquipo = data.sin_equipo || [];
  const esHoy = data.es_hoy !== false;
  const resumen = data.resumen || {};
  const grid = $('monitorEquiposGrid');
  if (!grid) return;

  let activos = 0, ocupados = 0, libres = 0, inactivos = 0;
  const svgMonitor = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>';
  const svgBrain = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9.5 2A5.5 5.5 0 005 7.5c0 .68.12 1.33.34 1.93a4.5 4.5 0 00.16 7.07A4.5 4.5 0 009.5 22h1V2h-1z"/><path d="M14.5 2A5.5 5.5 0 0120 7.5c0 .68-.12 1.33-.34 1.93a4.5 4.5 0 00-.16 7.07A4.5 4.5 0 0114.5 22h-1V2h1z"/></svg>';
  const svgSleep = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>';
  const svgActivity = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>';
  const svgUser = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
  const svgClock = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
  const svgDoc = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';

  function getEquipIcon(nombre) {
    const n = (nombre || '').toLowerCase();
    if (n.includes('psg') || n.includes('polisomno') || n.includes('sue\u00f1o') || n.includes('sleep')) return svgSleep;
    if (n.includes('eeg') || n.includes('electro') || n.includes('cerebr') || n.includes('neuro')) return svgBrain;
    if (n.includes('emg') || n.includes('conducci') || n.includes('nerve') || n.includes('electrom')) return svgActivity;
    return svgMonitor;
  }

  function histEstadoClass(estado) {
    const s = (estado || '').toLowerCase();
    if (s === 'completado') return 'st-completado';
    if (s === 'en estudio') return 'st-en-estudio';
    if (s.includes('programa') || s.includes('confirma') || s.includes('sala')) return 'st-programado';
    if (s.includes('cancel') || s.includes('no asis')) return 'st-cancelado';
    return 'st-other';
  }

  let html = '<div class="meq-list-wrap">';
  if (esHoy) {
    html += '<div class="meq-header-row"><div class="meq-col meq-col-equipo">Equipo</div><div class="meq-col meq-col-actual">Estudio Actual</div><div class="meq-col meq-col-sep"></div><div class="meq-col meq-col-next">Siguiente Estudio</div></div>';
  } else {
    html += '<div class="meq-header-row"><div class="meq-col meq-col-equipo">Equipo</div><div class="meq-col" style="grid-column:2/5">Estudios del d\u00eda</div></div>';
  }

  equipos.forEach(function(eq) {
    if (!eq.activo) {
      inactivos++;
      html += '<div class="meq-row meq-inactivo meq-st-inactivo">';
      html += '<div class="meq-col meq-col-equipo"><div class="meq-eq-icon">' + getEquipIcon(eq.nombre) + '</div><span>' + escapeHtml(eq.nombre) + '</span></div>';
      if (esHoy) {
        html += '<div class="meq-col meq-col-actual"><span class="meq-inactivo-cell"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg> Desactivado temporalmente</span></div>';
        html += '<div class="meq-col meq-col-sep">&middot;</div>';
        html += '<div class="meq-col meq-col-next"><span class="meq-inactivo-cell">\u2014</span></div>';
      } else {
        html += '<div class="meq-col" style="grid-column:2/5"><span class="meq-inactivo-cell"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg> Desactivado</span></div>';
      }
      html += '</div>';
      return;
    }

    activos++;

    if (esHoy) {
      var actual = eq.estudio_actual;
      var proximo = eq.proximo_estudio;
      var stClass = actual ? 'meq-st-ocupado' : (proximo ? 'meq-st-pendiente' : 'meq-st-libre');
      if (actual) ocupados++; else libres++;

      html += '<div class="meq-row ' + stClass + '">';
      html += '<div class="meq-col meq-col-equipo"><div class="meq-eq-icon">' + getEquipIcon(eq.nombre) + '</div><div><span>' + escapeHtml(eq.nombre) + '</span>';
      if (eq.descripcion) html += '<div style="font-size:.68rem;color:#94a3b8;font-weight:400;margin-top:1px">' + escapeHtml(eq.descripcion) + '</div>';
      html += '</div></div>';

      // Actual column
      html += '<div class="meq-col meq-col-actual">';
      if (actual) {
        var pct = actual.progreso_pct || 0;
        var entTag = actual.entidad ? ' <span class="meq-entidad-tag">' + escapeHtml(actual.entidad) + '</span>' : '';
        var durTag = actual.duracion_minutos ? ' <span class="meq-dur-tag">' + svgClock + ' ' + actual.duracion_minutos + 'min</span>' : '';
        html += '<div class="meq-study-block"><div class="meq-study-label meq-sl-actual"><span class="meq-pulse-dot"></span>EN ESTUDIO</div>';
        html += '<div class="meq-study-title">' + escapeHtml(actual.estudio || 'Sin tipo') + entTag + '</div>';
        html += '<div class="meq-study-meta">' + svgUser + ' ' + escapeHtml(actual.paciente_nombre || '-');
        if (actual.paciente_documento) html += ' <span class="meq-doc-tag">' + svgDoc + ' ' + escapeHtml(actual.paciente_documento) + '</span>';
        html += '</div>';
        html += '<div class="meq-study-meta"><span class="meq-time-pill meq-tp-active">' + svgClock + ' ' + formatearHora(actual.hora_inicio || '') + ' \u2013 ' + formatearHora(actual.hora_fin || '') + '</span>' + durTag;
        html += ' <div class="meq-progress-inline"><div class="meq-pf' + (pct >= 90 ? ' meq-ph' : '') + '" style="width:' + pct + '%"></div></div> <span class="meq-pct-label">' + pct + '%</span>';
        html += '</div></div>';
      } else {
        html += '<span class="meq-empty-cell">Sin estudio activo</span>';
      }
      html += '</div>';
      html += '<div class="meq-col meq-col-sep"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg></div>';

      // Next column
      html += '<div class="meq-col meq-col-next">';
      if (proximo) {
        var hoy = _monitorGetHoy();
        var fechaLabel = (proximo.fecha || '') === hoy ? 'Hoy' : (proximo.fecha || '');
        html += '<div class="meq-study-block"><div class="meq-study-label meq-sl-next">SIGUIENTE</div>';
        html += '<div class="meq-study-title">' + escapeHtml(proximo.estudio || 'Sin tipo') + '</div>';
        html += '<div class="meq-study-meta">' + svgUser + ' ' + escapeHtml(proximo.paciente_nombre || '-') + '</div>';
        html += '<div class="meq-study-meta"><span class="meq-time-pill meq-tp-next">' + svgClock + ' ' + fechaLabel + ' ' + formatearHora(proximo.hora_agendamiento || '') + '</span></div>';
        html += '</div>';
      } else {
        html += '<span class="meq-empty-cell">Sin estudios pendientes</span>';
      }
      html += '</div></div>';

    } else {
      // Historical view: show all studies for the day
      var estudios = eq.estudios_dia || [];
      var stClass2 = estudios.length > 0 ? 'meq-st-completado' : 'meq-st-libre';
      if (estudios.some(function(s) { return s.estado === 'En Estudio'; })) stClass2 = 'meq-st-ocupado';
      if (estudios.length > 0) ocupados++; else libres++;

      html += '<div class="meq-row ' + stClass2 + '">';
      html += '<div class="meq-col meq-col-equipo"><div class="meq-eq-icon">' + getEquipIcon(eq.nombre) + '</div><div><span>' + escapeHtml(eq.nombre) + '</span>';
      if (eq.descripcion) html += '<div style="font-size:.68rem;color:#94a3b8;font-weight:400;margin-top:1px">' + escapeHtml(eq.descripcion) + '</div>';
      html += '</div></div>';
      html += '<div class="meq-col" style="grid-column:2/5">';
      if (estudios.length === 0) {
        html += '<span class="meq-empty-cell">Sin estudios este d\u00eda</span>';
      } else {
        html += '<div class="meq-hist-studies">';
        estudios.forEach(function(s) {
          var entTag2 = s.entidad ? ' <span class="meq-entidad-tag">' + escapeHtml(s.entidad) + '</span>' : '';
          html += '<div class="meq-hist-item">';
          html += '<span class="meq-hist-estado ' + histEstadoClass(s.estado) + '">' + escapeHtml(s.estado || '-') + '</span>';
          html += '<span class="meq-study-title" style="max-width:200px">' + escapeHtml(s.estudio || 'Sin tipo') + entTag2 + '</span>';
          html += '<span class="meq-study-meta" style="margin:0">' + svgUser + ' ' + escapeHtml(s.paciente_nombre || '-') + '</span>';
          html += '<span class="meq-time-pill meq-tp-hist">' + svgClock + ' ' + formatearHora(s.hora_inicio || '') + ' \u2013 ' + formatearHora(s.hora_fin || '') + '</span>';
          if (s.duracion_minutos) html += '<span class="meq-dur-tag">' + s.duracion_minutos + 'min</span>';
          html += '</div>';
        });
        html += '</div>';
      }
      html += '</div></div>';
    }
  });
  html += '</div>';
  grid.innerHTML = html;

  // Update stats
  var cA = $('monitorCountActivos'), cO = $('monitorCountOcupados'), cL = $('monitorCountLibres'), cI = $('monitorCountInactivos');
  var cT = $('monitorCountTotal'), cComp = $('monitorCountCompletados');
  if (cA) cA.textContent = activos;
  if (cO) cO.textContent = esHoy ? ocupados : (resumen.en_estudio || 0);
  if (cL) cL.textContent = libres;
  if (cI) cI.textContent = inactivos;
  if (cT) cT.textContent = resumen.total_estudios || 0;
  if (cComp) cComp.textContent = resumen.completados || 0;

  // Sin equipo section
  var sinEqC = $('monitorSinEquipo'), sinEqL = $('monitorSinEquipoList');
  if (sinEquipo && sinEquipo.length > 0 && sinEqC && sinEqL) {
    sinEqC.style.display = '';
    sinEqL.innerHTML = sinEquipo.map(function(c) {
      return '<div class="meq-sin-equipo-card">' +
        '<div class="meq-study-block"><div class="meq-study-title">' + escapeHtml(c.estudio || 'Sin tipo') + '</div>' +
        '<div class="meq-study-meta">' + svgUser + ' ' + escapeHtml(c.paciente_nombre || '-') + '</div></div>' +
        '<div class="meq-study-meta" style="color:#a16207">' + svgClock + ' ' + (c.fecha || '') + ' ' + formatearHora(c.hora_agendamiento || '') + ' &middot; ' + escapeHtml(c.estado || '') + '</div>' +
      '</div>';
    }).join('');
  } else if (sinEqC) { sinEqC.style.display = 'none'; }
}
