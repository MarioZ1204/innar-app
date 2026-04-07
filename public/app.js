// public/app.js
const $ = id => document.getElementById(id);
const lsKey = 'recibos_sencillo_v1';
const lsKeyServicios = 'servicios_list_v1';
const lsKeyCurrentModule = 'current_module_v1';

// ========== FUNCIÓN DE HASHING SHA512 ==========
function hashPassword(password) {
  if (!password) return '';
  return CryptoJS.SHA512(password).toString();
}

// ========== FUNCIÓN AUXILIAR PARA ACTUALIZAR REQUISITOS ==========
function updateRequirementItem(elementId, isMet, text) {
  const element = $(elementId);
  if (element) {
    element.textContent = (isMet ? '[✓]' : '[✗]') + ' ' + text;
    element.style.color = isMet ? '#059669' : '#dc2626';
  }
}

const lsKeySelectedDoctor = 'selected_doctor_v1';
let lastReciboId = null;

// Usuario actual (rol: admin, recepcion, electro, doctor)
let currentUser = null;
let currentModule = null;
let selectedDoctorId = null;
let citaElectroSeleccionada = null;
let isInitializingElectroModal = false; // Flag para evitar cambios automáticos al cargar modal
let citaReprogramarAdelantarActual = null; // Almacena la cita cuando se abre modal de reprogramación/adelanto
let selectedDoctorEspecialidad = null;
let selectedDiagnosticoElectroId = null;
let selectedEquipoElectroId = null;
let selectedEstudioDuracion = null; // Duración en minutos del estudio seleccionado
let filtroEstudioElectro = 'todas'; // Filtro de estudio en tabla de citas
let filtroEquipoSeleccionado = null; // Filtro de equipo en tabla de citas
let intervaloProgreso = null; // Intervalo para actualizar barra de progreso del estudio
let intervaloProgresoPanel = null; // Intervalo para mini-barras en panel de equipos

// Mapeo de especialidades a tipos de consulta
const ESPECIALIDAD_TIPOS_CONSULTA = {
  'Neurología': [
    'Consulta de Primera Vez por Neurología',
    'Consulta de Control por Neurología',
    'Consulta Virtual de Primera Vez por Neurología',
    'Consulta Virtual de Control por Neurología',
    'Aplicación de Toxina Botulínica (Botox)',
    'Control de Toxina Botulínica (Botox)',
    'Actigrafía',
    'Rev. Neuroestimulador',
    'Agente Anestésico',
    'Particular',
    'Otra'
  ],
  'Epileptología': [
    'Consulta de Primera Vez por Epileptología',
    'Consulta de Control por Epileptología',
    'Consulta Virtual de Primera Vez por Epileptología',
    'Consulta Virtual de Control por Epileptología',
    'Consulta de Primera Vez por Neurología',
    'Consulta de Control por Neurología',
    'Consulta Virtual de Primera Vez por Neurología',
    'Consulta Virtual de Control por Neurología',
    'Aplicación de Toxina Botulínica (Botox)',
    'Control de Toxina Botulínica (Botox)',
    'Actigrafía',
    'Rev. Neuroestimulador',
    'Bloqueo Mioneural',
    'Particular',
    'Otra'
  ],
  'Psicología': [
    'Consulta de Primera Vez por Psicología',
    'Consulta de Control por Psicología',
    'Otra'
  ],
  'Neuropsicología': [
    'Consulta de Primera Vez por Neuropsicología',
    'Consulta de Control por Neuropsicología',
    'Otra'
  ],
  'Psiquiatría': [
    'Consulta de Primera Vez por Psiquiatría',
    'Consulta de Control por Psiquiatría',
    'Otra'
  ]
};

// Intervalo de auto-refresh para Agenda Médica
let agendaMedicaInterval = null;
let originalHoraTHHtml = null;
let originalAccionesTHHtml = null;
let lastAnimatedTurnoId = null;
let lastAnimatedAt = 0;
let lastTurnoNumber1Id = null;
let globalHayEnAtencion = false;

// Fetch con credenciales para sesión
function apiFetch(url, opts = {}) {
  return fetch(url, { ...opts, credentials: 'include' }).then(res => {
    if (res.status === 401) {
      showSessionExpiredBanner();
    }
    if (res.status === 429) {
      showToast('Demasiadas solicitudes. Espera un momento.', 'warning');
    }
    return res;
  }).catch(err => {
    if (!navigator.onLine) {
      showToast('Sin conexión a internet.', 'error');
    } else {
      showToast('Error de red. Intenta nuevamente.', 'error');
    }
    throw err;
  });
}

function isAdmin() { return currentUser && (currentUser.rol === 'admin' || currentUser.rol === 'superadmin'); }
function isRecepcion() { return currentUser && (currentUser.rol === 'recepcion' || currentUser.rol === 'auxiliar_recepcion' || currentUser.rol === 'admin_recepcion'); }
function isElectro() { return currentUser && (currentUser.rol === 'electro' || currentUser.rol === 'admin_electro' || currentUser.rol === 'tecnico_electro'); }
function isDoctor() { return currentUser && currentUser.rol === 'doctor'; }
function isContabilidad() { return currentUser && currentUser.rol === 'contabilidad'; }
function canDeleteRecibos() { return isAdmin(); }

// Mostrar saludo para doctores
function mostrarSaludoDoctor() {
  const greeting = $('doctorGreeting');
  if (!greeting) return;
  
  if (isDoctor()) {
    const nombre = currentUser?.nombre || currentUser?.usuario || 'Doctor';
    greeting.textContent = `¡Hola Dr. ${nombre}!`;
    greeting.classList.remove('hidden');
  } else {
    greeting.classList.add('hidden');
  }
}

// ========== LOGIN Y NAVEGACIÓN ==========
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
  const roleMap = { superadmin: 'Super Admin', admin: 'Administrador', admin_recepcion: 'Admin Recepción', recepcion: 'Recepción', admin_electro: 'Admin Electro', electro: 'Electrodiagnóstico', tecnico_electro: 'Técnico Electro', auxiliar_recepcion: 'Auxiliar Recepción', doctor: 'Doctor', contabilidad: 'Contabilidad' };
  const roleLabel = roleMap[user.rol] || user.rol || '-';
  document.querySelectorAll('.sidebar-user-avatar').forEach(el => el.textContent = initials);
  document.querySelectorAll('.sidebar-user-name').forEach(el => el.textContent = name);
  document.querySelectorAll('.sidebar-user-role').forEach(el => el.textContent = roleLabel);
}

function updateMenuByRole() {
  const rol = currentUser?.rol || '';
  document.querySelectorAll('.menu-card').forEach(card => {
    const allowed = (card.dataset.rol || '').split(' ').includes(rol);
    card.style.display = allowed ? '' : 'none';
  });
  // Sidebar recibos: ocultar Gestionar Servicios para no-admin
  document.querySelectorAll('[data-rol-recibos]').forEach(btn => {
    const r = btn.dataset.rolRecibos || '';
    btn.style.display = r.split(' ').includes(rol) ? '' : 'none';
  });
}

async function checkSession() {
  try {
    const res = await apiFetch('/api/sesion');
    const data = await res.json();
    if (data.autenticado) {
      currentUser = data.usuario;
      $('menuUserName').textContent = currentUser?.nombre || currentUser?.usuario || 'Usuario';
      sessionStorage.setItem('nombre_usuario', currentUser?.nombre || '');
      updateSidebarUser(currentUser);
      updateMenuByRole();
      mostrarSaludoDoctor();
      initSocket();        // Inicializar socket al restaurar sesión (recarga de página)
      setupMenuHandlers(); // Configurar handlers (incluyendo mobile sidebar)
      _initAudioStatusBtn(); // Mostrar botón de audio (requiere clic manual al recargar)
      // Restaurar módulo anterior si existe (sessionStorage = solo esta pestaña)
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
    // Hashear contraseña con SHA512
    const hashedPassword = hashPassword(password);
    
    const res = await apiFetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario, password: hashedPassword })
    });
    const data = await res.json();
    if (data.ok) {
      currentUser = data.usuario;
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
    errorText.textContent = data.error || 'Error al iniciar sesión';
    
    // Si está bloqueado por rate limiting
    if (res.status === 429 && data.bloqueado_hasta) {
      const tiempoBloqueoSegundos = data.bloqueado_hasta;
      const tiempoBloqueoMs = tiempoBloqueoSegundos * 1000; // Convertir de segundos a milisegundos
      const ahora = Date.now();
      const minutos = Math.ceil((tiempoBloqueoMs - ahora) / 60000);
      errorRetry.innerHTML = `<strong>🔒 Cuenta bloqueada</strong><br/>Intenta de nuevo en ${Math.max(minutos, 1)} minuto${Math.max(minutos, 1) !== 1 ? 's' : ''}`;
      errorRetry.style.marginTop = '8px';
    } else if (res.status === 401) {
      errorRetry.textContent = '';
    }
    
    $('loginError').classList.remove('hidden');
    return false;
  } catch (e) {
    $('loginErrorText').textContent = 'Error de conexión';
    $('loginErrorRetry').textContent = '';
    $('loginError').classList.remove('hidden');
    return false;
  }
}

async function doLogout() {
  try {
    await apiFetch('/api/logout', { method: 'POST' });
  } catch (e) {}
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
  // Limpiar campos de login después del cambio de vista
  const formLogin = document.getElementById('formLogin');
  if (formLogin) formLogin.reset();
  const u = $('loginUsuario'), p = $('loginPassword');
  if (u) { u.value = ''; u.setAttribute('value', ''); }
  if (p) { p.value = ''; p.setAttribute('value', ''); }
}

let initRecibosDone = false, initAgendaDone = false, initElectroDone = false, initUsuariosDone = false, initDiagnosticosDone = false, initDashboardCitasDone = false, initGestionDatosDone = false;
function goToModule(moduleId) {
  showView(`view-${moduleId}`);
  currentModule = moduleId;
  window.currentModule = moduleId;  // Exponer para sockets
  sessionStorage.setItem(lsKeyCurrentModule, moduleId);
  history.pushState({view: moduleId}, '', `#${moduleId}`);
  if (moduleId === 'recibos') { if (!initRecibosDone) initRecibos(); else cargarLista(); }
  if (moduleId === 'agenda-medica') { 
    if (!initAgendaDone) initAgendaMedica(); 
    initAgendaDone = true; 
    // Socket.IO maneja los cambios en tiempo real, no necesitamos auto-refresh
  } else {
    stopAgendaMedicaAutoRefresh();
  }
  if (moduleId === 'electro') { if (!initElectroDone) initElectro(); initElectroDone = true; }
  if (moduleId === 'usuarios') { if (!initUsuariosDone) initUsuarios(); initUsuariosDone = true; }
  if (moduleId === 'diagnosticos') { if (!initDiagnosticosDone) initDiagnosticos(); initDiagnosticosDone = true; }
  if (moduleId === 'dashboard-citas') { if (!initDashboardCitasDone) initDashboardCitas(); initDashboardCitasDone = true; }
  if (moduleId === 'gestion-datos') { if (!initGestionDatosDone) initGestionDatos(); initGestionDatosDone = true; }
}

function goToMenu() {
  showView('view-menu');
  currentModule = null;
  window.currentModule = null;  // Limpiar para sockets
  sessionStorage.removeItem(lsKeyCurrentModule);
  stopAgendaMedicaAutoRefresh();
  // Resetear flags de inicialización para permitir reinicialización
  initAgendaDone = false;
  initElectroDone = false;
  initDashboardCitasDone = false;
  // initRecibosDone: NO resetear — initRecibos usa addEventListener (acumularía duplicados)
  // el módulo recibos maneja refresh via el branch `else cargarLista()` en goToModule
  initUsuariosDone = false;
  initDiagnosticosDone = false;
  initGestionDatosDone = false;
  // Resetear flag de listeners de socket-electro
  window.listenersConfigured = false;
  // Limpiar selectedDoctorId cuando se vuelve al menú
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
      // Si es RECEPCION/ELECTRO/ADMIN (no doctor) y hace clic en AGENDA MÉDICA, mostrar selección de doctor
      if (card.dataset.module === 'agenda-medica' && !isDoctor()) {
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
  // Manejar botón atrás del navegador (solo una vez)
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

  // ── Swipe derecha en móvil = botón Volver ────────────────────────────────
  // Solo interceptamos si el gesto empieza desde el borde izquierdo (<50px),
  // es predominantemente horizontal y ocurre dentro de un módulo activo.
  if (!window._swipeBackSetup) {
    window._swipeBackSetup = true;
    let _swipeStartX = 0, _swipeStartY = 0, _swipeTracking = false;
    const EDGE_ZONE   = 50;   // px desde el borde izquierdo para activar
    const MIN_DIST    = 80;   // desplazamiento horizontal mínimo para disparar
    const MAX_VER     = 60;   // máximo vertical permitido (evita confundir con scroll)

    document.addEventListener('touchstart', (e) => {
      const touch = e.touches[0];
      // Solo activar si el dedo empieza cerca del borde izquierdo
      // y el usuario está en un módulo (no en menú ni login)
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
      // Si el movimiento vertical supera el límite, cancelar — es un scroll
      if (dy > MAX_VER) { _swipeTracking = false; return; }
      // Si ya alcanzó el umbral horizontal, prevenir navegación nativa del browser
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
  // ────────────────────────────────────────────────────────────────────────
  // Sidebar recibos
  document.querySelectorAll('#view-recibos .sidebar-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      const page = this.dataset.page;
      document.querySelectorAll('#view-recibos .sidebar-btn').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      document.querySelectorAll('#view-recibos .page').forEach(p => p.classList.remove('active'));
      const pg = document.getElementById(`page-${page}`);
      if (pg) pg.classList.add('active');
      if (page === 'recibos') { cargarLista(); cargarFiltrosUsuarios(); if ($('resetAll')) $('resetAll').style.display = canDeleteRecibos() ? 'inline-block' : 'none'; }
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

  // Inyectar backdrop y botón en cada módulo
  document.querySelectorAll('.main-layout').forEach(layout => {
    const sidebar = layout.querySelector(':scope > .sidebar');
    const mainContent = layout.querySelector(':scope > .main-content');
    if (!sidebar || !mainContent) return;

    // Backdrop dentro del mismo layout (mismo stacking context que el sidebar)
    const backdrop = document.createElement('div');
    backdrop.className = 'mobile-sidebar-backdrop';
    layout.appendChild(backdrop);
    backdrop.addEventListener('click', () => closeSidebar(sidebar, backdrop));

    // Botón hamburguesa antes del main-content
    const btn = document.createElement('button');
    btn.className = 'mobile-menu-btn no-print';
    btn.setAttribute('aria-label', 'Abrir navegación');
    btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>`;
    layout.insertBefore(btn, mainContent);
    btn.addEventListener('click', () => openSidebar(sidebar, backdrop));
  });

  // Cerrar sidebar al elegir opción o volver
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

// Genera un badge de color según el estado de la cita electro
function estadoBadge(estado) {
  const map = {
    'Programado':   { bg: '#dbeafe', color: '#1d4ed8', border: '#93c5fd' },
    'En Sala':      { bg: '#fef9c3', color: '#92400e', border: '#fde047' },
    'En Estudio':   { bg: '#ffedd5', color: '#c2410c', border: '#fdba74' },
    'Completado':   { bg: '#dcfce7', color: '#15803d', border: '#86efac' },
    'Cancelado':    { bg: '#fee2e2', color: '#991b1b', border: '#fca5a5' },
    'No Asistió':   { bg: '#f3e8ff', color: '#6b21a8', border: '#d8b4fe' },
  };
  const e = estado || 'Programado';
  const s = map[e] || { bg: '#f3f4f6', color: '#374151', border: '#d1d5db' };
  return `<span style="display:inline-block;padding:3px 10px;border-radius:12px;font-size:0.78rem;font-weight:600;background:${s.bg};color:${s.color};border:1px solid ${s.border};white-space:nowrap">${escapeHtml(e)}</span>`;
}

/**
 * Formatea una hora al formato HH:MM AM/PM (12 horas)
 * Maneja: null, undefined, '', 'null', HH:MM, HH:MM:SS
 * @param {string|null} valor - La hora a formatear
 * @returns {string} Hora en formato H:MM AM/PM o '-' si es inválida
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
    if (isNaN(date)) return fecha; // Si no es una fecha válida, devuelve original
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
// Retorna null si el valor no es válido.
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
 * @returns {string} Fecha en formato YYYY-MM-DD o la fecha original si es válida
 */
function formatearFechaISO(fecha) {
  if (!fecha) return '';
  const strFecha = String(fecha).trim();
  
  // Si ya está en formato YYYY-MM-DD, devolverlo tal cual
  if (/^\d{4}-\d{2}-\d{2}$/.test(strFecha)) {
    return strFecha;
  }
  
  // Si es un ISO string, extraer la parte de la fecha
  if (strFecha.includes('T')) {
    return strFecha.split('T')[0];
  }
  
  return strFecha;
}

// Servicios por defecto
const serviciosDefault = [
  { id: null, nombre: 'Electroencefalograma Computarizado' },
  { id: null, nombre: 'Electroencefalograma Convencional'},
  { id: null, nombre: 'Monitorización Electroencefalográfica por video y radio'},
  { id: null, nombre: 'Polisomnografía'},
  { id: null, nombre: 'Polisomnograma en Titulación de CPAP/BPAP' },
  { id: null, nombre: 'Test de Latencia Múltiple'},
  { id: null, nombre: 'Polisomnograma Noche Dividida' }
];

// Caché en memoria de servicios (se carga desde el servidor)
let _serviciosCache = null;

async function getServicios() {
  if (_serviciosCache) return _serviciosCache;
  try {
    const res = await apiFetch('/api/servicios');
    if (res.ok) {
      _serviciosCache = await res.json();
      return _serviciosCache;
    }
  } catch(_) {}
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
  } catch(_) { showToast('Error de conexión', 'error'); }
  cerrarModalEditarServicio();
}

// ============================================
// SISTEMA GENÉRICO DE PAGINACIÓN
// ============================================

// Almacenar estado de paginación de cada tabla
window.paginationState = {};

/**
 * Configura paginación para una tabla
 * @param {string} tableId - ID único para la tabla (ej: 'usuarios', 'citasElectro', etc)
 * @param {Array} data - Array de datos a paginar
 * @param {Function} renderFunction - Función que renderiza una fila (recibe el tbody y un elemento de data)
 * @param {Object} options - Opciones de configuración
 */
function setupPagination(tableId, data, renderFunction, options = {}) {
  const {
    itemsPerPageDefault = 20,
    itemsPerPageOptions = [5, 10, 15, 20, 50],
    tbodyId = null,
    containerSelector = null
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
    window.paginationState[tableId].currentPage = 1;
  }

  const state = window.paginationState[tableId];

  // Renderizar tabla
  renderPaginatedTable(tableId, renderFunction, tbodyId);

  // Crear controles de paginación si el contenedor existe
  if (containerSelector) {
    createPaginationControls(tableId, containerSelector, itemsPerPageOptions, renderFunction, tbodyId);
  }
}

/**
 * Renderiza una página de la tabla paginada
 */
function renderPaginatedTable(tableId, renderFunction, tbodyId) {
  const state = window.paginationState[tableId];
  if (!state) return;

  const tbody = tbodyId ? document.getElementById(tbodyId) : null;
  if (!tbody) return;

  tbody.innerHTML = '';

  // Calcular índices de items a mostrar
  const startIdx = (state.currentPage - 1) * state.itemsPerPage;
  const endIdx = startIdx + state.itemsPerPage;
  const paginatedData = state.data.slice(startIdx, endIdx);

  if (paginatedData.length === 0) {
    const colCount = 6; // Ajustar según la tabla
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
}

/**
 * Crea controles de paginación (selector de items por página + navegación)
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

  // Selector de items por página
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

  // Info de página y total de registros
  const infoDiv = document.createElement('div');
  infoDiv.style.cssText = 'font-size: 13px; color: #6b7280; text-align: center; flex-grow: 1; white-space: nowrap;';
  infoDiv.textContent = `Página ${state.currentPage} de ${state.totalPages} | Total: ${state.data.length} registros`;

  // Números de página
  const pageNumbersDiv = document.createElement('div');
  pageNumbersDiv.style.cssText = 'display: flex; gap: 4px; flex-wrap: wrap; justify-content: flex-end;';
  
  // Botón "Primera"
  if (state.currentPage > 1) {
    const firstBtn = document.createElement('button');
    firstBtn.textContent = '«';
    firstBtn.className = 'pg-nav';
    firstBtn.addEventListener('click', () => {
      state.currentPage = 1;
      renderPaginatedTable(tableId, renderFunction, tbodyId);
      createPaginationControls(tableId, containerSelector, itemsPerPageOptions, renderFunction, tbodyId);
    });
    pageNumbersDiv.appendChild(firstBtn);
  }

  // Botón "Anterior"
  if (state.currentPage > 1) {
    const prevBtn = document.createElement('button');
    prevBtn.textContent = '‹';
    prevBtn.className = 'pg-nav';
    prevBtn.addEventListener('click', () => {
      state.currentPage--;
      renderPaginatedTable(tableId, renderFunction, tbodyId);
      createPaginationControls(tableId, containerSelector, itemsPerPageOptions, renderFunction, tbodyId);
    });
    pageNumbersDiv.appendChild(prevBtn);
  }

  // Números de página (mostrar hasta 5 números)
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

  // Botón "Siguiente"
  if (state.currentPage < state.totalPages) {
    const nextBtn = document.createElement('button');
    nextBtn.textContent = '›';
    nextBtn.className = 'pg-nav';
    nextBtn.addEventListener('click', () => {
      state.currentPage++;
      renderPaginatedTable(tableId, renderFunction, tbodyId);
      createPaginationControls(tableId, containerSelector, itemsPerPageOptions, renderFunction, tbodyId);
    });
    pageNumbersDiv.appendChild(nextBtn);
  }

  // Botón "Última"
  if (state.currentPage < state.totalPages) {
    const lastBtn = document.createElement('button');
    lastBtn.textContent = '»';
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
      showConfirm(`¿Eliminar el servicio "${s.nombre}"?`, async () => {
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
const _TOAST_ICONS = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };

// Mostrar toast apilado con icono y botón de cierre
function showToast(msg, type = 'info', duration = 4000) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `app-toast app-toast-${type}`;
  const icon = _TOAST_ICONS[type] || 'ℹ';
  toast.innerHTML =
    `<span class="toast-icon">${icon}</span>` +
    `<span class="toast-body">${msg}</span>` +
    `<button class="toast-close" aria-label="Cerrar">×</button>`;
  toast.querySelector('.toast-close').addEventListener('click', () => _removeToast(toast));
  container.appendChild(toast);
  setTimeout(() => _removeToast(toast), duration);
}

function _removeToast(toast) {
  if (!toast || toast.classList.contains('removing')) return;
  toast.classList.add('removing');
  setTimeout(() => toast.remove(), 280);
}

// Botón con estado de carga
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
  if (!('speechSynthesis' in window)) return;
  if (document.getElementById('btnAudioStatus')) return;
  const btn = document.createElement('button');
  btn.id = 'btnAudioStatus';
  btn.title = 'Clic para habilitar audio de voz';
  btn.textContent = '\uD83D\uDD07';
  btn.style.cssText = 'position:fixed;bottom:18px;right:18px;z-index:9000;width:40px;height:40px;border-radius:50%;background:#fff;border:2px solid #8AA6A1;font-size:1.1rem;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.18);padding:0;line-height:1;display:flex;align-items:center;justify-content:center;';
  btn.addEventListener('click', () => {
    _unlockSpeech();
    setTimeout(() => _speak('Audio habilitado', 1), 100);
  });
  document.body.appendChild(btn);
}

function _hideAudioStatusBtn() {
  const btn = document.getElementById('btnAudioStatus');
  if (btn) btn.remove();
  _speechUnlocked = false;
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

// Reproducir número de consultorio por voz
function speakConsultorio(numero) {
  _speak(`Consultorio número ${numero}`, 1, () => showToast(`Consultorio ${numero} anunciado`, 'success'));
}

// ========== SESSION EXPIRADA ==========
let _sessionBannerShown = false;
function showSessionExpiredBanner() {
  if (_sessionBannerShown || document.getElementById('session-expired-banner')) return;
  _sessionBannerShown = true;
  const banner = document.createElement('div');
  banner.id = 'session-expired-banner';
  banner.innerHTML = `
    <div class="session-expired-box">
      <div class="session-expired-icon">🔒</div>
      <h3 class="session-expired-title">Sesión expirada</h3>
      <p class="session-expired-sub">Tu sesión ha terminado.<br>Vuelve a iniciar sesión para continuar.</p>
      <button class="session-expired-btn" id="btnGoLogin">Iniciar sesión</button>
    </div>`;
  document.body.appendChild(banner);
  banner.querySelector('#btnGoLogin').addEventListener('click', () => {
    banner.remove();
    _sessionBannerShown = false;
    if (window.socket) { window.socket.disconnect(); window.socket = null; }
    currentUser = null;
    showView('view-login');
  });
}

// ========== CONFIRM MODAL ==========
function showConfirm(msg, onOk, { okText = 'Eliminar', cancelText = 'Cancelar', danger = true, icon = '⚠️' } = {}) {
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

// ========== SKELETON ROWS ==========
function showSkeletonRows(tbody, cols, count = 5) {
  if (!tbody) return;
  tbody.innerHTML = Array.from({ length: count }, (_, r) =>
    `<tr class="skeleton-row">${Array.from({ length: cols }, (_, i) =>
      `<td><div class="skeleton-cell" style="width:${55 + ((r + i * 3) % 4) * 10}%"></div></td>`
    ).join('')}</tr>`
  ).join('');
}

// ========== FIELD ERROR (validación inline) ==========
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

// init
document.addEventListener('DOMContentLoaded', async ()=>{
  // Verificar sesión al cargar
  const autenticado = await checkSession();
  if (!autenticado) {
    // Setup login form
    const passwordInput = $('loginPassword');
    const toggleBtn = $('togglePassword');
    const capsWarning = $('capsLockWarning');
    
    // Toggle mostrar/ocultar contraseña
    if (toggleBtn) {
      toggleBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const type = passwordInput.type === 'password' ? 'text' : 'password';
        passwordInput.type = type;
        // El emoji 👁 es el mismo para ambos estados - visualmente claro
      });
    }
    
    // Detector de Caps Lock (tiempo real)
    if (passwordInput && capsWarning) {
      const checkCapsLock = (e) => {
        // Solo verificar CapsLock en desktop (getModifierState no funciona bien en móviles)
        if (e.type.includes('key')) {
          try {
            const isCapsLockOn = e.getModifierState('CapsLock');
            capsWarning.style.display = isCapsLockOn ? 'block' : 'none';
          } catch (err) {
            capsWarning.style.display = 'none';
          }
        }
      };
      
      // Escuchar keydown y keyup (mejor compatibilidad en móviles que keypress)
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
    return;
  }

  setupMenuHandlers();
  initRecibos();
});

// ========== MODAL SELECCIÓN DE DOCTOR ==========
async function showDoctorSelectionModal() {
  const medicos = await apiFetch('/api/medicos').then(r=>r.json()).catch(()=>[]);
  const container = $('medicosListContainer');
  container.innerHTML = '';
  
  if (medicos.length === 0) {
    container.innerHTML = '<p style="color:#999;text-align:center">No hay médicos disponibles</p>';
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
  // Actualizar horas disponibles con el nuevo doctor
  actualizarHorasDisponibles();
  // Cargar tipos de consulta según especialidad
  cargarTiposConsultaSegunEspecialidad(especialidad);
  // Forzar reinicialización del módulo agenda médica cuando se cambiadel doctor
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
  
  // Agregar la nueva opción al select
  const option = document.createElement('option');
  option.value = nuevaConsulta;
  option.textContent = nuevaConsulta;
  selectTipo.appendChild(option);
  
  // Seleccionar la nueva opción
  selectTipo.value = nuevaConsulta;
  
  // Limpiar input y ocultar fila
  otraConsultaInput.value = '';
  $('otraConsultaRow').style.display = 'none';
  
  // Mostrar confirmación
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
  // NO limpiar selectedDoctorId aquí - debe persistir mientras se usa la agenda
}

function initRecibos() {
  initItemsTable();
  setDefaultDate();

  // Contabilidad: ir directo a Ver Recibos, ocultar tab crear
  if (isContabilidad()) {
    const crearBtn = document.querySelector('#view-recibos .sidebar-btn[data-page="crear"]');
    const crearPage = document.getElementById('page-crear');
    const recibosBtn = document.querySelector('#view-recibos .sidebar-btn[data-page="recibos"]');
    const recibosPage = document.getElementById('page-recibos');
    if (crearBtn)  { crearBtn.classList.remove('active'); crearBtn.style.display = 'none'; }
    if (crearPage) { crearPage.classList.remove('active'); }
    if (recibosBtn)  { recibosBtn.classList.add('active'); }
    if (recibosPage) { recibosPage.classList.add('active'); }
    cargarLista();
  }
  nextNumber();
  updateSavedCount();

  // Cargar médicos en el select
  cargarMedicosEnRecibo();
  // Cargar servicios en el select de tipo estudio
  cargarServiciosEnRecibo();
  // Mostrar usuario actual como "generado por"
  const gpEl = $('reciboGeneradoPorDisplay');
  if (gpEl) {
    const nombre = sessionStorage.getItem('nombre_usuario') || currentUser?.nombre || currentUser?.usuario || '—';
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
        // Auto-seleccionar el primer médico disponible si ninguno está elegido
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

  // Al cambiar médico en el formulario de recibo, cargar tipos de consulta
  const reciboMedicoSel = $('reciboMedico');
  if (reciboMedicoSel) {
    reciboMedicoSel.addEventListener('change', async function() {
      await cargarTiposConsultaEnRecibo(this.value);
    });
  }

  // Buscar cita del día
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
  // Botón sidebar: resetear consecutivos (solo admin)
  const btnResetCons = document.getElementById('btnResetarConsecutivos');
  if (btnResetCons) btnResetCons.addEventListener('click', resetAllRecibos);

  if ($('resetAll')) $('resetAll').addEventListener('click', resetAllRecibos);

  // Filtros + exportar (página Ver Recibos)
  if ($('btnAplicarFiltros')) $('btnAplicarFiltros').onclick = aplicarFiltrosRecibos;
  if ($('btnLimpiarFiltros')) $('btnLimpiarFiltros').onclick = limpiarFiltrosRecibos;
  if ($('btnExportarCSV')) $('btnExportarCSV').onclick = exportarReciboCSV;
  if ($('btnExportarPDF')) $('btnExportarPDF').onclick = exportarReciboPDF;

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
    } catch (_) { showToast('Error de conexión', 'error'); }
  });

  // Sólo números en documento
  const docCliente = document.getElementById('docCliente');
  if (docCliente) docCliente.addEventListener('input', function() { this.value = this.value.replace(/[^0-9]/g, ''); });

  // Precargar filtros médicos y usuarios en Ver Recibos
  cargarFiltrosMedicos();
  cargarFiltrosUsuarios();

  // Socket: cuando admin modifica tipos de consulta, refrescar el dropdown activo
  if (window.socket && !window.socketRecibosTiposListenerAdded) {
    window.socket.on('tipos-consulta:actualizado', () => {
      _tiposConsultaCache = {};                     // invalidar caché de agenda/turnos
      window._reciboCurrentTipos = [];              // invalidar caché del formulario
      const medicoId = $('reciboMedico')?.value;
      if (medicoId) cargarTiposConsultaEnRecibo(medicoId);
    });
    window.socketRecibosTiposListenerAdded = true;
  }

  initRecibosDone = true;
}

// ---- Cargar médicos en el select del formulario ----
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
      filtro.innerHTML = '<option value="">Todos los médicos</option>';
      medicos.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.nombre || m.usuario;
        filtro.appendChild(opt);
      });
    }
  } catch (e) { console.warn('[cargarMedicos] Error cargando médicos:', e.message); }
}

// ---- Cargar tipos de consulta según el médico seleccionado (formulario recibo) ----
async function cargarTiposConsultaEnRecibo(medicoId) {
  const sel = $('reciboTipoConsulta');
  if (!sel) return;
  sel.innerHTML = '<option value="">Seleccionar tipo</option>';
  if (!medicoId) return;
  try {
    // El servidor resuelve la especialidad del médico y devuelve tipos de la BD
    const res = await apiFetch(`/api/tipos-consulta?medico_id=${encodeURIComponent(medicoId)}`);
    const tipos = await res.json().catch(() => []);

    // Confiar 100% en la BD — si está vacío es porque no hay tipos configurados
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

// ---- Cargar médicos en filtro ----
async function cargarFiltrosMedicos() {
  const sel = $('filtroMedico');
  if (!sel) return;
  try {
    const medicos = await apiFetch('/api/medicos').then(r => r.json()).catch(() => []);
    sel.innerHTML = '<option value="">Todos los médicos</option>';
    medicos.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.nombre || m.usuario;
      sel.appendChild(opt);
    });
  } catch (e) { console.warn('[cargarFiltrosMedicos] Error:', e.message); }
}

// ---- Cargar usuarios que han generado recibos en filtro ----
async function cargarFiltrosUsuarios() {
  const sel = $('filtroGeneradoPor');
  if (!sel) return;
  try {
    const generadores = await apiFetch('/api/recibos/generadores').then(r => r.json()).catch(() => []);
    sel.innerHTML = '<option value="">Todos</option>';
    generadores.forEach(u => {
      const opt = document.createElement('option');
      opt.value = u.id;
      opt.textContent = u.nombre || String(u.id);
      sel.appendChild(opt);
    });
  } catch (e) { console.warn('[cargarFiltrosUsuarios] Error:', e.message); }
}

// ---- Buscar cita del día para pre-llenar formulario ----
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
      contenedor.innerHTML = '<div style="padding:12px;color:#6b7280;text-align:center">No se encontraron citas completadas en los últimos 7 días.</div>';
      return;
    }
    contenedor.innerHTML = resultados.map((c, i) => {
      const esTarjeta = c.entidad && c.entidad !== 'Particular';
      const badgeClass = c.origen === 'electro' ? 'electro' : '';
      const badgeText = c.origen === 'electro' ? 'Electro' : 'Consulta';
      return `<div class="recibo-buscar-item" data-idx="${i}">
        <div>
          <div class="rci-nombre">${escapeHtml(c.paciente_nombre || '-')}</div>
          <div class="rci-meta">Doc: ${escapeHtml(c.paciente_documento || '-')} · ${escapeHtml(String(c.fecha||'').slice(0,10))} · ${escapeHtml(c.hora||'')}
            ${c.medico_nombre ? ` · Dr. ${escapeHtml(c.medico_nombre)}` : ''}
            ${c.tipo_consulta ? ` · ${escapeHtml(c.tipo_consulta)}` : ''}
            ${c.entidad ? ` · ${escapeHtml(c.entidad)}` : ''}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:6px">
          <span class="rci-badge ${badgeClass}">${badgeText}</span>
          <span class="recibo-buscar-accion">↑ Usar</span>
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
    $('reciboEntidad').value = cita.entidad; // intentará coincidir con la opción
  }

  // Tipo de recibo: si hay médico -> seleccionar 'doctor', si hay tipo de estudio -> 'estudio'
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

// ========== AGENDA MÉDICA (Citas) ==========
async function initAgendaMedica() {
  const hoy = new Date().toISOString().slice(0,10);
  $('agendaMedicaFecha').value = hoy;
  updateAgendaFechaDisplay();
  
  // Cargar lista de médicos
  const medicos = await apiFetch('/api/medicos').then(r=>r.json()).catch(()=>[]);
  
  // Mostrar médico seleccionado
  if (selectedDoctorId) {
    const medico = medicos.find(m => m.id == selectedDoctorId);
    if (medico) {
      $('agendaMedicaDoctorDisplay').textContent = medico.nombre;
      selectedDoctorEspecialidad = medico.especialidad;
      sessionStorage.setItem('selected_doctor_especialidad', medico.especialidad || '');
      // Cargar tipos de consulta según especialidad
      cargarTiposConsultaSegunEspecialidad(medico.especialidad);
    } else {
      $('agendaMedicaDoctorDisplay').textContent = '-';
    }
  } else if (isDoctor()) {
    // Si es un DOCTOR, mostrar su propio nombre
    selectedDoctorId = currentUser?.id;
    selectedDoctorEspecialidad = currentUser?.especialidad;
    $('agendaMedicaDoctorDisplay').textContent = currentUser?.nombre || currentUser?.usuario || '-';
    cargarTiposConsultaSegunEspecialidad(currentUser?.especialidad);
  } else if (medicos.length) {
    // Otros roles: mostrar el primero disponible
    selectedDoctorId = medicos[0].id;
    selectedDoctorEspecialidad = medicos[0].especialidad;
    $('agendaMedicaDoctorDisplay').textContent = medicos[0].nombre;
    cargarTiposConsultaSegunEspecialidad(medicos[0].especialidad);
  } else {
    $('agendaMedicaDoctorDisplay').textContent = '-';
  }
  
  // Validar disponibilidad del doctor cuando se selecciona una fecha
  // SIEMPRE aplicar validación si hay un doctor seleccionado
  if (typeof crearDatepickerConDisponibilidad === 'function' && selectedDoctorId) {
    crearDatepickerConDisponibilidad($('agendaMedicaFecha'), selectedDoctorId);
  }
  
  $('agendaMedicaFecha').addEventListener('change', () => {
    updateAgendaFechaDisplay();
    actualizarHorasDisponibles();
    cargarTurnosMedica();
  });
  if (!isElectro() && !isDoctor()) {
    $('nuevoPacienteNombresMedica')?.addEventListener('input', debounceBuscarPacientesMedica);
  }
  // Forzar solo dígitos y máximo 10 en los teléfonos de cita médica
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
    
    // ========= Listeners para Turnos Médicos (Agenda Médica) =========
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
  // ajustar columnas según rol
  // guardar HTML original del TH de Hora para poder reinsertarlo si el rol cambia
  try {
    const headerRow = document.querySelector('#turnosTableMedica thead tr');
    const thHora = headerRow?.querySelector('.col-hora');
    const thAcciones = headerRow?.querySelector('th:last-child');
    if (thHora && !originalHoraTHHtml) originalHoraTHHtml = thHora.outerHTML;
    if (thAcciones && !originalAccionesTHHtml) originalAccionesTHHtml = thAcciones.outerHTML;
  } catch (e) {}
  adjustColumnsForRole();
  
  // === PAGE NAVIGATION (Citas / Programar Agenda) ===
  // Mostrar/ocultar botón "Programar Agenda" según rol
  const canAgendaProgram = isDoctor() || isRecepcion() || isAdmin() || currentUser?.rol === 'admin_electro';
  const btnProgramar = document.querySelector('[data-page="programar"]');
  if (btnProgramar) {
    btnProgramar.style.display = canAgendaProgram ? '' : 'none';
    // Cambiar texto del botón según rol (preservar SVG)
    const btnProgramarText = btnProgramar.querySelector('span:last-child');
    if (btnProgramarText) btnProgramarText.textContent = isDoctor() ? 'Programar Agenda' : 'Agenda';
  }
  
  // Pre-inicializar calendario de disponibilidad
  if (canAgendaProgram && !window._agendaCalendarSetup) {
    setupAgendaCalendar();
    window._agendaCalendarSetup = true;
  }
  
  // Sidebar button listeners para cambio de página
  document.querySelectorAll('.agenda-page-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      const page = this.dataset.page;
      // marcar botón como activo
      document.querySelectorAll('.agenda-page-btn').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      // cambiar página visible
      document.querySelectorAll('.agenda-page').forEach(p => p.classList.remove('active'));
      const pgEl = document.querySelector(`.agenda-page[data-agenda-page="${page}"]`);
      if (pgEl) pgEl.classList.add('active');
      
      // mostrar/ocultar secciones dentro de página según rol
      if (page === 'programar') {
        const titleHeader = document.getElementById('agendaTitleHeader');
        if (titleHeader) titleHeader.textContent = isDoctor() ? 'Programar Agenda' : 'Agenda';
        // Show PDF download section for roles that can upload
        const progSection = $('agendaProgramarSection');
        const canUpload = isDoctor() || isAdmin() || currentUser?.rol === 'admin_recepcion' || currentUser?.rol === 'admin_electro';
        if (progSection) progSection.style.display = canUpload ? '' : 'none';
        // Reload calendar data when switching to this tab
        if (typeof loadCalendarData === 'function') loadCalendarData();
      }
    });
  });
  
  // Mostrar página inicial de citas (ya tienen clase active en HTML)
  // pero asegurar que el botón de citas tenga clase active
  document.querySelectorAll('.agenda-page-btn').forEach(b => b.classList.remove('active'));
  const citasBtn = document.querySelector('.agenda-page-btn[data-page="citas"]');
  if (citasBtn) citasBtn.classList.add('active');
  
  // Ocultar inicialmente las secciones de programar agenda
  const progSection = $('agendaProgramarSection');
  if (progSection) progSection.style.display = 'none';
  
  const doctorAcciones = $('agendaDoctorAcciones');
  if (doctorAcciones) doctorAcciones.style.display = isDoctor() ? '' : 'none';

  // Botón "Nueva Cita" y modal
  const btnNuevaCita = $('btnNuevaCitaMedica');
  if (btnNuevaCita) btnNuevaCita.style.display = (!isElectro() && !isDoctor()) ? 'inline-flex' : 'none';
  if (!isElectro() && !isDoctor()) {
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

  // Sección de aviso al doctor (visible para admin_recepcion, aux_recepcion, admin_electro)
  const recepcionAcciones = $('agendaRecepcionAcciones');
  const canAvisar = ['admin_recepcion', 'auxiliar_recepcion', 'admin_electro'].includes(currentUser?.rol);
  if (recepcionAcciones) recepcionAcciones.style.display = canAvisar ? '' : 'none';
  if (canAvisar) {
    $('btnAvisarDoctor')?.addEventListener('click', avisoDoctor);
  }
  
  // Desactivar el botón "Marcar como atendido" inicialmente
  const btnMarcar = $('btnMarcarAtendido');
  if (btnMarcar) {
    btnMarcar.disabled = true;
    btnMarcar.title = 'No hay paciente en atención';
  }
  
  $('btnLlamarSiguiente')?.addEventListener('click', llamarSiguientePaciente);
  $('btnMarcarAtendido')?.addEventListener('click', marcarAtendido);
  $('btnDescargarAgendaPDF')?.addEventListener('click', descargarAgendaPDF);

  // Modal de edición solo para admin/recepción
  const editSection = $('agendaEditPacienteSection');
  if (editSection) {
    // Modal empieza oculto
    editSection.classList.add('hidden');
    if (isAdmin() || isRecepcion()) {
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
  // Botón "Cargar Pacientes" (solo admin/recepción)
  const btnCargarPacMedica = $('btnCargarPacientesMedica');
  if (btnCargarPacMedica && !isElectro() && !isDoctor()) {
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

  await cargarTurnosMedica();
  // Cargar disponibilidad programada (intervalos) desde el inicio
  await actualizarHorasDisponibles();
}

// Autocompletado por documento removido por solicitud del usuario

// hide Hora column for doctor view
function adjustColumnsForRole(){
  const headerRow = document.querySelector('#turnosTableMedica thead tr');
  if (!headerRow) return;
  
  if (isDoctor()) {
    // Para DOCTOR: remover Hora, cambiar Acciones por "Quien Programó"
    
    // Remover columna Hora si existe
    headerRow.querySelectorAll('.col-hora').forEach(th => th.remove());
    
    // Cambiar última columna de "Acciones" a "Quien Programó"
    const lastTh = headerRow.querySelector('th:last-child');
    if (lastTh && lastTh.textContent.includes('Acciones')) {
      lastTh.textContent = 'Quien Programó';
    }
  } else {
    // Para RECEPCION/ADMIN: agregar Hora, cambiar "Quien Programó" por "Acciones"
    
    // Insertar columna Hora si no existe
    if (!headerRow.querySelector('.col-hora') && originalHoraTHHtml) {
      const tpl = document.createElement('template');
      tpl.innerHTML = originalHoraTHHtml.trim();
      const newTh = tpl.content.firstChild;
      // insertar en segunda posición (después de Cita)
      const ref = headerRow.children[1] || null;
      headerRow.insertBefore(newTh, ref);
    }
    
    // Cambiar última columna de "Quien Programó" a "Acciones" si es necesario
    const lastTh = headerRow.querySelector('th:last-child');
    if (lastTh && (lastTh.textContent.includes('Quien') || lastTh.textContent.includes('Programó'))) {
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
    const dias = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
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

// Actualizar horas disponibles según disponibilidad del doctor
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
      mensajeDiv.innerHTML = '⚠️ El doctor no está disponible este día.';
      mensajeDiv.style.display = 'block';
      return;
    }

    const lineas = [];
    if (disponibleManana) lineas.push('Mañana: 7:00 AM – 12:00 PM');
    if (disponibleTarde) lineas.push('Tarde: 2:00 PM – 6:00 PM');
    if (!disponibleManana) lineas.push('⚠️ Sin disponibilidad matutina');
    if (!disponibleTarde) lineas.push('⚠️ Sin disponibilidad vespertina');

    if (data.tiene_intervalos && data.intervalos && data.intervalos.length > 0) {
      const bloqueados = data.intervalos.map(i =>
        `${formatearHora(i.hora_inicio)}–${formatearHora(i.hora_fin)}${i.razon ? ': ' + i.razon : ''}`
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

function setupAgendaCalendar() {
  calDoctorIdForCal = selectedDoctorId || currentUser?.id;
  if (!calDoctorIdForCal) return;

  // Selector de doctor para recepción/admin
  const selectorDiv = $('agendaCalDoctorSelector');
  if (selectorDiv && !isDoctor()) {
    selectorDiv.style.display = '';
    const sel = $('agendaCalDoctorSelect');
    if (sel && !sel.dataset.loaded) {
      sel.innerHTML = '<option value="">Cargando...</option>';
      apiFetch('/api/medicos').then(r => r.json()).then(list => {
        sel.innerHTML = '<option value="">Seleccionar médico</option>';
        list.forEach(m => {
          const o = document.createElement('option');
          o.value = m.id;
          o.textContent = m.nombre || m.usuario;
          if (m.id == calDoctorIdForCal) o.selected = true;
          sel.appendChild(o);
        });
        sel.dataset.loaded = '1';
      }).catch(() => { sel.innerHTML = '<option value="">Error</option>'; });

      sel.addEventListener('change', () => {
        const v = parseInt(sel.value, 10);
        if (v) {
          calDoctorIdForCal = v;
          calSelectedDate = null;
          loadCalendarData();
        }
      });
    }
  } else if (selectorDiv) {
    selectorDiv.style.display = 'none';
  }

  // Nav buttons
  $('calPrevMonth')?.addEventListener('click', () => { calCurrentMonth--; if (calCurrentMonth < 0) { calCurrentMonth = 11; calCurrentYear--; } calSelectedDate = null; loadCalendarData(); });
  $('calNextMonth')?.addEventListener('click', () => { calCurrentMonth++; if (calCurrentMonth > 11) { calCurrentMonth = 0; calCurrentYear++; } calSelectedDate = null; loadCalendarData(); });

  // Modal events
  $('calModalClose')?.addEventListener('click', closeCalModal);
  $('calDayModal')?.addEventListener('click', (e) => { if (e.target.id === 'calDayModal') closeCalModal(); });
  $('calToggleYes')?.addEventListener('click', () => setCalToggle(true));
  $('calToggleNo')?.addEventListener('click', () => setCalToggle(false));
  $('calModalAddHora')?.addEventListener('click', () => addCalHoraRow('', ''));
  $('calModalSave')?.addEventListener('click', saveCalDay);
  $('calModalClear')?.addEventListener('click', deleteCalDay);

  // ESC to close modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('calDayModal')?.classList.contains('active')) closeCalModal();
  });

  loadCalendarData();
}

function setCalToggle(asistire) {
  const btnYes = $('calToggleYes');
  const btnNo = $('calToggleNo');
  const horasC = $('calModalHorasContainer');
  if (asistire) {
    btnYes.classList.add('cal-toggle-active-yes');
    btnNo.classList.remove('cal-toggle-active-no');
    if (horasC) horasC.style.display = '';
  } else {
    btnYes.classList.remove('cal-toggle-active-yes');
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
  const diasSemana = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const titulo = $('calModalTitle');
  const sub = $('calModalDateSub');
  if (titulo) titulo.textContent = `${diasSemana[d.getDay()]} ${d.getDate()} de ${meses[d.getMonth()]}`;
  if (sub) sub.textContent = `${calCurrentYear}`;

  // Load existing data
  const disp = calDisponibilidad[dateStr];
  const daySlots = calSlots.filter(s => (s.fecha || '').slice(0, 10) === dateStr && s.disponible);

  const horasList = $('calModalHorasList');
  if (horasList) horasList.innerHTML = '';

  if (disp && !disp.disponible) {
    setCalToggle(false);
  } else {
    setCalToggle(true);
    if (daySlots.length > 0) {
      daySlots.forEach(s => addCalHoraRow(s.hora_inicio?.slice(0, 5), s.hora_fin?.slice(0, 5)));
    } else if (disp) {
      if (disp.disponible_manana) addCalHoraRow('07:00', '12:00');
      if (disp.disponible_tarde) addCalHoraRow('14:00', '18:00');
      if (!disp.disponible_manana && !disp.disponible_tarde) addCalHoraRow('', '');
    } else {
      addCalHoraRow('', '');
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
  if (!calDoctorIdForCal) return;
  const mes = `${calCurrentYear}-${String(calCurrentMonth + 1).padStart(2, '0')}`;

  try {
    // Cargar disponibilidad mensual
    const resDisp = await apiFetch(`/api/doctor-disponibilidad/${calDoctorIdForCal}?mes=${mes}`);
    const dataDisp = await resDisp.json();
    calDisponibilidad = {};
    if (dataDisp.ok && Array.isArray(dataDisp.disponibilidad)) {
      dataDisp.disponibilidad.forEach(d => {
        const fecha = (d.fecha || '').slice(0, 10);
        calDisponibilidad[fecha] = d;
      });
    }

    // Cargar slots de agenda
    const resSlots = await apiFetch(`/api/doctor-agenda?doctor_id=${calDoctorIdForCal}`);
    const slotsData = await resSlots.json();
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

    // Check status
    const disp = calDisponibilidad[dateStr];
    const daySlots = calSlots.filter(s => (s.fecha || '').slice(0, 10) === dateStr);

    if (disp) {
      if (!disp.disponible) {
        cell.classList.add('cal-unavailable');
      } else if (disp.disponible_manana && disp.disponible_tarde) {
        cell.classList.add('cal-available');
      } else if (disp.disponible_manana || disp.disponible_tarde) {
        cell.classList.add('cal-partial');
      } else {
        cell.classList.add('cal-available');
      }
    } else if (daySlots.length > 0) {
      const anyAvailable = daySlots.some(s => s.disponible);
      cell.classList.add(anyAvailable ? 'cal-available' : 'cal-unavailable');
    }

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

  const disponible = $('calToggleYes')?.classList.contains('cal-toggle-active-yes');
  const horasRows = document.querySelectorAll('#calModalHorasList .cal-hora-row');

  // Build slots
  const slots = [];
  let hasManana = false, hasTarde = false;

  if (disponible) {
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

  const saveBtn = $('calModalSave');
  setLoading(saveBtn, true, 'Guardando...');

  try {
    // 1. Save availability in doctor_disponibilidad_mensual
    await apiFetch('/api/doctor-disponibilidad/guardar-dia', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        doctor_id: calDoctorIdForCal,
        fecha: calSelectedDate,
        disponible,
        disponible_manana: disponible ? (hasManana || (!hasManana && !hasTarde)) : false,
        disponible_tarde: disponible ? (hasTarde || (!hasManana && !hasTarde)) : false
      })
    });

    // 2. Save specific slots in doctor_agenda (replace day's slots)
    await apiFetch('/api/doctor-agenda/guardar-dia', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        doctor_id: calDoctorIdForCal,
        fecha: calSelectedDate,
        slots
      })
    });

    showToast('Día guardado correctamente', 'success');
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
  showConfirm('¿Limpiar la configuración del día seleccionado?', async () => {
    try {
      await apiFetch('/api/doctor-disponibilidad/eliminar-dia', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ doctor_id: calDoctorIdForCal, fecha: calSelectedDate })
    });
    showToast('Día limpiado', 'success');
    closeCalModal();
    await loadCalendarData();
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }
  }, { okText: 'Limpiar', icon: '🗓️' });
}

function renderCalResumen() {
  const cont = $('calResumenList');
  if (!cont) return;

  const daysInMonth = new Date(calCurrentYear, calCurrentMonth + 1, 0).getDate();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diasSemana = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
  let html = '';
  let configured = 0;

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${calCurrentYear}-${String(calCurrentMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dateObj = new Date(calCurrentYear, calCurrentMonth, d);
    if (dateObj < today) continue;

    const disp = calDisponibilidad[dateStr];
    const daySlots = calSlots.filter(s => (s.fecha || '').slice(0, 10) === dateStr && s.disponible);

    if (!disp && daySlots.length === 0) continue;
    configured++;

    const dayName = diasSemana[dateObj.getDay()];
    let estadoHtml = '', horasHtml = '';

    if (disp && !disp.disponible) {
      estadoHtml = '<span class="cal-resumen-estado" style="background:#fee2e2;color:#991b1b">No asiste</span>';
    } else if (disp || daySlots.length > 0) {
      estadoHtml = '<span class="cal-resumen-estado" style="background:#dcfce7;color:#166534">Disponible</span>';
      if (daySlots.length > 0) {
        const horas = daySlots.map(s => `${(s.hora_inicio||'').slice(0,5)}–${(s.hora_fin||'').slice(0,5)}`).join(', ');
        horasHtml = `<span class="cal-resumen-horas">${escapeHtml(horas)}</span>`;
      } else if (disp) {
        const partes = [];
        if (disp.disponible_manana) partes.push('Mañana');
        if (disp.disponible_tarde) partes.push('Tarde');
        if (partes.length) horasHtml = `<span class="cal-resumen-horas">${partes.join(', ')}</span>`;
      }
    }

    html += `<div class="cal-resumen-dia">
      <span class="cal-resumen-fecha">${dayName} ${d}</span>
      ${estadoHtml}
      ${horasHtml}
    </div>`;
  }

  if (!configured) {
    cont.innerHTML = '<div style="color:#9ca3af;padding:8px 0">No hay días configurados este mes</div>';
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
  
  // Header con título y botón cerrar
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
  btnClose.textContent = '✕';
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
    container.innerHTML = '<p style="color:#999;padding:20px">La hoja está vacía</p>';
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
    sel.innerHTML = '<option value="">Seleccionar médico</option>';
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
          tr.innerHTML = `<td style="padding:8px;border:1px solid #ddd">${escapeHtml(r.fecha)}</td><td style="padding:8px;border:1px solid #ddd">${formatearHora(r.hora_inicio)}</td><td style="padding:8px;border:1px solid #ddd">${formatearHora(r.hora_fin)}</td><td style="padding:8px;border:1px solid #ddd">${r.disponible? 'Sí':'No'}</td>`; 
          tb.appendChild(tr); 
        });
        tbl.appendChild(tb);
        cont.appendChild(tbl);
      } else {
        const noSlots = document.createElement('div');
        noSlots.style.padding = '12px';
        noSlots.style.color = '#999';
        noSlots.textContent = 'No hay programación de disponibilidad';
        cont.appendChild(noSlots);
      }
      
      // Mostrar archivos subidos (solo para recepción)
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
          
          // Botón Ver para Excel
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
  const fecha = $('agendaMedicaFecha').value;
  const doctorId = selectedDoctorId || (isDoctor() ? currentUser?.id : null);
  if (!fecha || !doctorId) { showToast('Selecciona fecha y médico', 'error'); return; }
  showSkeletonRows($('turnosTableBodyMedica'), isDoctor() ? 7 : 8, 6);
  try {
    const res = await apiFetch(`/api/turnos?fecha=${fecha}&doctor_id=${doctorId}`);
    const turnos = await res.json();
    const tbody = $('turnosTableBodyMedica');
    // Si es doctor, asegurarnos de mostrar primero quien tenga numero_turno == 1
    if (isDoctor()) {
      const idx1 = turnos.findIndex(x => x.numero_turno === 1);
      if (idx1 > 0) {
        const [one] = turnos.splice(idx1, 1);
        turnos.unshift(one);
      }
    }
    // Detectar si hay nuevo primer paciente con numero 1 para animar
    const firstWithNum1 = turnos.find(t => t.numero_turno === 1);
    let animateTargetId = null;
    
    if (firstWithNum1 && firstWithNum1.id !== lastTurnoNumber1Id) {
      animateTargetId = firstWithNum1.id;
      lastTurnoNumber1Id = firstWithNum1.id;
    }

    tbody.innerHTML = '';
    const filasRequeridas = 25;
    const colspan = isDoctor() ? 7 : 8;
    
    const hayEnAtencion = turnos.some(t => t.estado === 'EN_ATENCION');
    globalHayEnAtencion = hayEnAtencion;

    // Construir lista de visualización: insertar fila "hueco" cuando el gap
    // entre citas consecutivas es >= 40 minutos (consulta extendida)
    const UMBRAL_HUECO_MIN = 40;
    const displayList = [];
    for (let i = 0; i < turnos.length; i++) {
      displayList.push({ tipo: 'turno', data: turnos[i] });
      if (i < turnos.length - 1) {
        const mActual   = horaAMinutos(turnos[i].hora);
        const mSiguiente = horaAMinutos(turnos[i + 1].hora);
        if (mActual !== null && mSiguiente !== null && (mSiguiente - mActual) >= UMBRAL_HUECO_MIN) {
          displayList.push({ tipo: 'hueco' });
        }
      }
    }

    for (let i = 0; i < filasRequeridas; i++) {
      if (i < displayList.length) {
        const item = displayList[i];
        if (item.tipo === 'turno') {
          renderTurnoRowMedica(tbody, item.data, animateTargetId, hayEnAtencion);
        } else {
          crearFilaTurnoHueco(tbody, colspan);
        }
      } else {
        crearFilaTurnoVacia(tbody, colspan, isDoctor());
      }
    }
    
    // Actualizar estado del botón "Marcar como atendido"
    updateMarcarAtendidoButton(turnos);
    // Ajustar columnas según rol (una sola vez después de renderizar todas las filas)
    adjustColumnsForRole();
  } catch (e) { showToast('Error cargando citas', 'error'); }
}

// Función para crear una fila vacía de turno
function crearFilaTurnoVacia(tbody, colspan, esDoctor) {
  const tr = document.createElement('tr');
  tr.className = 'turno-row estado-vacio';
  tr.style.opacity = '0.4';
  
  // Crear celdas vacías según si es doctor o no
  const columnas = esDoctor ? 8 : 9;
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

function updateMarcarAtendidoButton(turnos) {
  const btnMarcar = $('btnMarcarAtendido');
  if (!btnMarcar) return;
  
  // Verificar si hay algún turno EN_ATENCION
  const turnoEnAtencion = turnos.find(t => t.estado === 'EN_ATENCION');
  
  if (turnoEnAtencion) {
    btnMarcar.disabled = false;
    btnMarcar.title = `Paciente en atención: ${turnoEnAtencion.paciente_nombre}`;
  } else {
    btnMarcar.disabled = true;
    btnMarcar.title = 'No hay paciente en atención';
  }
}

let selectedTurnoMedica = null;

function estadoBadgeMedica(estado) {
  const map = {
    'EN_ESPERA':    { bg: '#dbeafe', color: '#1d4ed8', border: '#93c5fd',  label: 'En Espera' },
    'EN_SALA':      { bg: '#fef9c3', color: '#92400e', border: '#fde047',  label: 'En Sala' },
    'EN_ATENCION':  { bg: '#ffedd5', color: '#c2410c', border: '#fdba74',  label: 'En Atención' },
    'ATENDIDO':     { bg: '#dcfce7', color: '#15803d', border: '#86efac',  label: 'Atendido' },
    'CANCELADO':    { bg: '#fee2e2', color: '#991b1b', border: '#fca5a5',  label: 'Cancelado' },
    'REPROGRAMADO': { bg: '#e0f2fe', color: '#0369a1', border: '#7dd3fc',  label: 'Reprogramado' },
    'NO_ASISTIO':   { bg: '#f3e8ff', color: '#6b21a8', border: '#d8b4fe',  label: 'No Asistió' },
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
  tr.style.cursor = (isAdmin() || isRecepcion()) ? 'pointer' : 'default';

  if (t.id) {
    tr.setAttribute('data-turno-id', t.id);
  }

  const esAtendido = t.estado === 'ATENDIDO';
  const esEnAtencion = t.estado === 'EN_ATENCION';

  // Opciones generales para deshabilitación
  let deshabilitarBotones = false;
  
  if (isAdmin()) {
    // Admin: bloquear si hay algún turno EN_ATENCION (incluido el propio)
    deshabilitarBotones = hayEnAtencion;
  } else if (currentUser?.rol === 'admin_recepcion') {
    // Admin recepción: solo bloquear si este turno está ATENDIDO
    deshabilitarBotones = esAtendido;
  } else if (isRecepcion()) {
    // Recepción: bloquear si está ATENDIDO o hay EN_ATENCION
    deshabilitarBotones = esAtendido || hayEnAtencion;
  }
  
  const puedeEliminar = isAdmin() || isRecepcion();
  const btnUpDisabled = deshabilitarBotones ? 'disabled' : '';
  const btnDownDisabled = deshabilitarBotones ? 'disabled' : '';
  const btnEditDisabled = deshabilitarBotones ? 'disabled' : '';
  const btnDeleteDisabled = deshabilitarBotones ? 'disabled' : '';
  
  // Guardar estado de deshabilitación en data attributes para que los event listeners puedan acceder
  const dataDeshabilitado = deshabilitarBotones ? 'data-deshabilitado="true"' : 'data-deshabilitado="false"';
  
  const prioridadBtns = (isAdmin() || isRecepcion()) ? `<button class="btn-prioridad-up" data-up="${t.id}" title="Subir prioridad" ${btnUpDisabled} ${dataDeshabilitado}><img src="images/up.svg" alt="↑"/></button><button class="btn-prioridad-down" data-down="${t.id}" title="Bajar prioridad" ${btnDownDisabled} ${dataDeshabilitado}><img src="images/down.svg" alt="↓"/></button>` : '';
  const accionesCell = puedeEliminar
    ? `<div class="table-actions">${prioridadBtns}<button class="btn-editar" data-edit="${t.id}" title="Editar" ${btnEditDisabled} ${dataDeshabilitado}><img src="images/edit.svg" alt="Editar"/></button><button class="btn-eliminar" data-delete="${t.id}" title="Eliminar" ${btnDeleteDisabled} ${dataDeshabilitado}><img src="images/delete.svg" alt="Eliminar"/></button></div>`
    : '-';
    const numCellHtml = t.numero_turno === 1
      ? `<span class="badge-siguiente">Siguiente</span>`
      : (t.numero_turno || '');
    if (t.numero_turno === 1) tr.classList.add('turno-es-primero');

    if (isDoctor()) {
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
        <td>${accionesCell}</td>
      `;
    }
  // Abrir modal al hacer clic en la fila (como en electrodiagnóstico)
  if (isAdmin() || isRecepcion()) {
    tr.addEventListener('click', (e) => {
      // No activar si hace clic en botones
      if (e.target.closest('button') || e.target.closest('[data-delete]') || e.target.closest('[data-edit]') || e.target.closest('[data-up]') || e.target.closest('[data-down]')) {
        return;
      }
      abrirModalEstadoCitaMedica(t);
    });
    
    // Botón de Editar
    const btnEdit = tr.querySelector('[data-edit]');
    btnEdit?.addEventListener('click', (e) => {
      e.stopPropagation();
      const btn = e.target.closest('[data-edit]');
      const deshabilitado = btn?.getAttribute('data-deshabilitado') === 'true';
      if (btn?.disabled || deshabilitado) return;
      seleccionarTurnoMedica(tr, t);
    });
  }

  // Añadir botones de prioridad (solo recepcion/admin)
  if (isAdmin() || isRecepcion()) {
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

  if (puedeEliminar) {
    tr.querySelector('[data-delete]')?.addEventListener('click', async (e)=>{
      const btn = e.target.closest('[data-delete]');
      const deshabilitado = btn?.getAttribute('data-deshabilitado') === 'true';
      if (btn?.disabled || deshabilitado) return;
      showConfirm('¿Eliminar esta cita?', async () => {
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
  const doctorId = selectedDoctorId || (isDoctor() ? currentUser?.id : null);
  if (!fecha || !doctorId) { showToast('Selecciona fecha y médico', 'error'); return; }
  try {
    const res = await apiFetch('/api/turnos/llamar-siguiente', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({fecha, doctor_id:doctorId}) });
    const data = await res.json();
    if (data.ok) { 
      const nombre = data.turno.paciente_nombre || '';
      const consultorio = data.turno.numero_consultorio;
      showToast('Paciente llamado: ' + nombre, 'success'); 
      // El anuncio de voz es recibido por recepción/electro vía socket (agenda:turno-llamar-siguiente)
      cargarTurnosMedica(); 
    } else {
      showToast(data.error||'Error', 'error');
    }
  } catch (e) { showToast('Error llamando paciente', 'error'); }
}

async function marcarAtendido() {
  const fecha = $('agendaMedicaFecha').value;
  const doctorId = selectedDoctorId || (isDoctor() ? currentUser?.id : null);
  
  try {
    // Buscar el turno en atención
    const res = await apiFetch(`/api/turnos?fecha=${fecha}&doctor_id=${doctorId}`);
    const turnos = await res.json();
    const turnoEnAtencion = turnos.find(t => t.estado === 'EN_ATENCION');
    
    if (!turnoEnAtencion) {
      showToast('No hay paciente en atención', 'error');
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
    info.textContent = `Cita actual: ${t.numero_turno || '-'} · Estado: ${(t.estado || '').replace(/_/g,' ')} · Consultorio: ${t.consultorio_nombre || ''}`;
  }
  const inputNombre = $('editPacienteNombreMedica');
  if (inputNombre) {
    inputNombre.value = t.paciente_nombre || '';
  }
  
  // Deshabilitar botón de guardar nombre según rol:
  // ADMIN: puede editar si hay EN_ATENCION en otro turno, pero NO si está ATENDIDO
  // RECEPCION: no puede editar si está ATENDIDO o hay EN_ATENCION
  const btnGuardar = $('btnGuardarNombreMedica');
  if (btnGuardar) {
    const esAtendido = t.estado === 'ATENDIDO';
    let puedeEditar = true;
    
    if (isAdmin()) {
      // Admin: bloquear si hay EN_ATENCION en otro turno
      puedeEditar = !(globalHayEnAtencion && t.estado !== 'EN_ATENCION');
    } else if (currentUser?.rol === 'admin_recepcion') {
      // Admin recepción: solo bloquear si está ATENDIDO
      puedeEditar = !esAtendido;
    } else if (isRecepcion()) {
      // Recepción: bloquear si está ATENDIDO o hay EN_ATENCION
      puedeEditar = !(esAtendido || (globalHayEnAtencion && t.estado !== 'EN_ATENCION'));
    }
    
    btnGuardar.disabled = !puedeEditar;
    btnGuardar.style.opacity = puedeEditar ? '1' : '0.5';
    btnGuardar.style.cursor = puedeEditar ? 'pointer' : 'not-allowed';
  }
  
  const modal = $('agendaEditPacienteSection');
  if (modal) {
    modal.classList.remove('hidden');
  }
}

async function guardarNombrePacienteMedica() {
  // Prevenir edición según rol:
  // ADMIN: puede editar si hay EN_ATENCION en otro turno
  // RECEPCION: no puede editar si está ATENDIDO o hay EN_ATENCION
  if (currentUser?.rol === 'admin_recepcion') {
    if (selectedTurnoMedica?.estado === 'ATENDIDO') {
      showToast('No se pueden editar citas ya atendidas', 'error');
      return;
    }
  } else if (isRecepcion()) {
    if (selectedTurnoMedica?.estado === 'ATENDIDO') {
      showToast('No se pueden editar citas ya atendidas', 'error');
      return;
    }
    if (globalHayEnAtencion && selectedTurnoMedica?.estado !== 'EN_ATENCION') {
      showToast('No se pueden editar citas mientras hay un paciente en atención', 'error');
      return;
    }
  }
  // Admin no tiene restricciones basadas en estado
  
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
    showToast('Número de cita inválido', 'error');
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
      showToast('Número de cita actualizado', 'success');
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
  const doctorId = selectedDoctorId || (isDoctor() ? currentUser?.id : null);
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

  // 2. Validar nombre: mínimo 3 caracteres
  if (nombre.length < 3) {
    showToast('El nombre debe tener al menos 3 caracteres', 'error');
    return;
  }

  // 3. Validar documento: solo números, 6-15 caracteres
  if (!/^\d{6,15}$/.test(doc)) {
    showToast('Documento inválido. Solo números, 6-15 dígitos', 'error');
    return;
  }

  // 4. Validar teléfono 1: exactamente 10 dígitos
  if (!telefono1 || !/^\d{10}$/.test(telefono1)) {
    showToast('Teléfono 1 debe tener exactamente 10 dígitos', 'error');
    $('nuevoPacienteTelefonoMedica')?.focus();
    return;
  }

  // 5. Validar teléfono 2: exactamente 10 dígitos
  if (!telefono2 || !/^\d{10}$/.test(telefono2)) {
    showToast('Teléfono 2 debe tener exactamente 10 dígitos', 'error');
    $('nuevoPacienteTelefonoMedica2')?.focus();
    return;
  }

  // 6. Teléfono 2 no puede ser igual al 1
  if (telefono1 === telefono2) {
    showToast('El Teléfono 2 no puede ser igual al Teléfono 1', 'error');
    $('nuevoPacienteTelefonoMedica2')?.focus();
    return;
  }

  try {
    // Validaciones completadas - permitir múltiples pacientes en la misma hora
    // (no hay validación de duplicados por hora, se permite hasta 20 pacientes)

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

// ========== CARGAR PACIENTES DESDE EXCEL (Agenda Médica) ==========

function descargarPlantillaMedica() {
  const headers = ['FECHA', 'HORA', 'NUMERO DOCUMENTO', 'NOMBRES Y APELLIDOS', 'ENTIDAD', 'TIPO DE CONSULTA', 'TELEFONO1', 'TELEFONO2', 'NOTAS'];
  const ejemplo = ['2026-04-01', '08:00', '1234567890', 'Juan Carlos Pérez López', 'Particular', 'Consulta General', '3001234567', '3009876543', ''];
  const ws = XLSX.utils.aoa_to_sheet([headers, ejemplo]);
  ws['!cols'] = headers.map(() => ({ wch: 20 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Pacientes');
  XLSX.writeFile(wb, 'plantilla_citas_medicas.xlsx');
}

function descargarPlantillaElectro() {
  const headers = ['FECHA', 'HORA', 'NUMERO DOCUMENTO', 'NOMBRES Y APELLIDOS', 'ESTUDIO', 'DIAGNOSTICO', 'TELEFONO1', 'TELEFONO2'];
  const ejemplo = ['2026-04-01', '20:00', '1234567890', 'Juan Carlos Pérez López', 'PSG Básica', 'Apnea del sueño', '3001234567', '3009876543'];
  const ws = XLSX.utils.aoa_to_sheet([headers, ejemplo]);
  ws['!cols'] = headers.map(() => ({ wch: 20 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Estudios');
  XLSX.writeFile(wb, 'plantilla_estudios_electro.xlsx');
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
  return s;
}

function excelTimeToString(v) {
  if (!v) return '';
  if (typeof v === 'number') {
    // Fracción de día
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
  reader.onload = function(e) {
    try {
      const workbook = XLSX.read(e.target.result, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet);
      if (!rows.length) { errorDiv.textContent = 'El archivo está vacío'; errorDiv.style.display = 'block'; return; }

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

      const parsed = [];
      const tbody = $('cargarPacientesMedicaBody');
      tbody.innerHTML = '';

      for (const row of rows) {
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
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${escapeHtml(fecha)}</td><td>${escapeHtml(hora)}</td><td>${escapeHtml(documento)}</td><td>${escapeHtml(nombres)}</td><td>${escapeHtml(apellidos)}</td><td>${escapeHtml(entidad)}</td><td>${escapeHtml(tipo)}</td><td>${escapeHtml(tel1)}</td><td>${escapeHtml(tel2)}</td><td>${escapeHtml(notas)}</td>`;
        tbody.appendChild(tr);
      }

      if (!parsed.length) { errorDiv.textContent = 'No se encontraron filas válidas con los datos requeridos'; errorDiv.style.display = 'block'; return; }

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

// ========== CARGAR PACIENTES DESDE EXCEL (Electrodiagnóstico) ==========
function procesarExcelPacientesElectro(file) {
  const errorDiv = $('cargarPacientesElectroError');
  const previewDiv = $('cargarPacientesElectroPreview');
  const btnConfirm = $('btnConfirmarCargarPacientesElectro');
  errorDiv.style.display = 'none';
  previewDiv.style.display = 'none';
  btnConfirm.disabled = true;
  window._cargarPacientesElectroData = null;

  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const workbook = XLSX.read(e.target.result, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet);
      if (!rows.length) { errorDiv.textContent = 'El archivo está vacío'; errorDiv.style.display = 'block'; return; }

      const headers = Object.keys(rows[0]);
      const colFecha = encontrarColumnaExcel(headers, ['fecha', 'date']);
      const colHora = encontrarColumnaExcel(headers, ['hora', 'time', 'hour']);
      const colDoc = encontrarColumnaExcel(headers, ['documento', 'numero documento', 'num documento', 'cedula', 'identificacion', 'doc']);
      const colNombre = encontrarColumnaExcel(headers, ['nombres y apellidos', 'nombre', 'paciente', 'nombres', 'nombre completo']);
      const colEstudio = encontrarColumnaExcel(headers, ['estudio', 'tipo estudio', 'examen']);
      const colDiag = encontrarColumnaExcel(headers, ['diagnostico', 'dx', 'diag']);
      const colTel1 = encontrarColumnaExcel(headers, ['telefono1', 'telefono 1', 'tel1', 'tel 1', 'telefono', 'celular']);
      const colTel2 = encontrarColumnaExcel(headers, ['telefono2', 'telefono 2', 'tel2', 'tel 2']);

      if (!colFecha || !colHora || !colDoc || !colNombre) {
        errorDiv.innerHTML = 'Columnas requeridas no encontradas. Se necesitan al menos: <strong>FECHA, HORA, DOCUMENTO, NOMBRES Y APELLIDOS</strong><br>Columnas encontradas: ' + headers.map(h => escapeHtml(h)).join(', ');
        errorDiv.style.display = 'block';
        return;
      }

      const parsed = [];
      const tbody = $('cargarPacientesElectroBody');
      tbody.innerHTML = '';

      for (const row of rows) {
        const fecha = excelDateToString(row[colFecha]);
        const hora = excelTimeToString(row[colHora]);
        const documento = String(row[colDoc] || '').trim();
        const { nombres, apellidos } = splitNombreApellido(row[colNombre]);
        const estudio = colEstudio ? String(row[colEstudio] || '').trim() : '';
        const diagnostico = colDiag ? String(row[colDiag] || '').trim() : '';
        const tel1 = colTel1 ? String(row[colTel1] || '').replace(/\D/g, '') : '';
        const tel2 = colTel2 ? String(row[colTel2] || '').replace(/\D/g, '') : '';

        if (!fecha || !hora || !documento || !nombres) continue;

        parsed.push({ fecha, hora, documento, nombres, apellidos, estudio, diagnostico, tel1, tel2 });
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${escapeHtml(fecha)}</td><td>${escapeHtml(hora)}</td><td>${escapeHtml(documento)}</td><td>${escapeHtml(nombres)}</td><td>${escapeHtml(apellidos)}</td><td>${escapeHtml(estudio)}</td><td>${escapeHtml(diagnostico)}</td><td>${escapeHtml(tel1)}</td><td>${escapeHtml(tel2)}</td>`;
        tbody.appendChild(tr);
      }

      if (!parsed.length) { errorDiv.textContent = 'No se encontraron filas válidas con los datos requeridos'; errorDiv.style.display = 'block'; return; }

      $('cargarPacientesElectroCount').textContent = parsed.length;
      previewDiv.style.display = 'block';
      btnConfirm.disabled = false;
      window._cargarPacientesElectroData = parsed;
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
    try {
      const nombre = [p.nombres, p.apellidos].filter(Boolean).join(' ');
      // Crear paciente primero
      const resP = await apiFetch('/api/pacientes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre, documento: p.documento || null, telefono: p.tel1 || null, telefono2: p.tel2 || null }) });
      const dataP = await resP.json();
      if (!dataP.ok && !dataP.id) { errores.push(`Fila ${i+1}: Error creando paciente`); continue; }
      const pacienteId = dataP.id;

      const body = {
        paciente_id: pacienteId,
        fecha: p.fecha,
        hora: parseHora12a24(p.hora),
        telefono: p.tel1 || null,
        telefono2: p.tel2 || null,
        estudio: p.estudio || 'PSG Básica',
        estado: 'Programado',
        programado_por_nombre: (currentUser ? (currentUser.nombre || currentUser.usuario) : 'Excel')
      };

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

// ========== DASHBOARD (Admin solo) ==========
// ========== AGENDA ELECTRODIAGNÓSTICO =========
async function initElectro() {
  const hoy = new Date().toISOString().slice(0,10);
  $('electroFecha').value = hoy;
  
  // Generar intervalos de hora (texto libre con formato HH:MM AM/PM)
  // No se genera select, el usuario escribe la hora directamente
  
  // Mostrar usuario actual que programará
  if (currentUser) {
    $('electroProgramadoPor').textContent = currentUser.nombre || currentUser.usuario || '-';
  }
  
  // Cargar equipos SOLO para el modal (para seleccionar después)
  try {
    const res = await apiFetch('/api/equipos-electro');
    const equipos = await res.json();
    const equipoSelect = $('modalEquipo');
    equipoSelect.innerHTML = '<option value="">Seleccionar equipo</option>';
    equipos.forEach(e => {
      const opt = document.createElement('option');
      opt.value = e.id;
      opt.textContent = e.nombre;
      // Si el equipo está en uso (En Estudio), deshabilitarlo
      if (e.en_uso) {
        opt.disabled = true;
        opt.textContent += ' (En uso)';
      }
      equipoSelect.appendChild(opt);
    });
  } catch (e) {
    console.error('Error cargando equipos para modal:', e);
  }
  
  // Event listener para cambiar fecha y cargar citas automáticamente
  $('electroFecha')?.addEventListener('change', async () => {
    await cargarCitasElectro();
    await checkEquiposDisponibilidad();
  });
  
  // Event listener para quitar el border rojo cuando se selecciona estudio y auto-completar duración
  $('electroEstudio')?.addEventListener('change', async (e) => {
    if (e.target.value) {
      e.target.style.borderColor = '';
      
      // Obtener duración del estudio
      try {
        const res = await apiFetch(`/api/estudios/duracion?nombre=${encodeURIComponent(e.target.value)}`);
        const data = await res.json();
        
        const duracionCol = $('electroDuracionCol');
        const durationInput = $('electroDuracion');
        
        if (data.ok) {
          if (data.esVariable) {
            // Estudio variable: mostrar campo para que usuario ingrese duración en HORAS
            duracionCol.style.display = '';
            durationInput.value = '';
            durationInput.min = Math.round(data.duracion_min / 60);  // Convertir a horas
            durationInput.max = Math.round(data.duracion_max / 60);  // Convertir a horas
            durationInput.placeholder = `⚠️ REQUERIDO: Duración (${Math.round(data.duracion_min / 60)}-${Math.round(data.duracion_max / 60)} horas)`;
            durationInput.style.borderColor = ''; // Reset any previous error
            selectedEstudioDuracion = null; // No hay duración predeterminada
          } else {
            // Estudio fijo: guardar duración y ocultarla
            duracionCol.style.display = 'none';
            durationInput.value = '';
            selectedEstudioDuracion = data.duracion_minutos; // Guardar duración en minutos
          }
        }
      } catch (e) {
        console.error('Error obteniendo duración:', e);
        duracionCol.style.display = 'none';
        durationInput.value = '';
        selectedEstudioDuracion = null;
      }
    }
    await checkEquiposDisponibilidad();
  });

  // Event listener para cambio en hora (type=time dispara 'change' al completar la selección)
  const _onElectroHoraChange = async () => {
    const v = $('electroHora').value;
    if (v) await checkEquiposDisponibilidad();
  };
  $('electroHora')?.addEventListener('change', _onElectroHoraChange);
  $('electroHora')?.addEventListener('input', _onElectroHoraChange);

  // Event listener para cambio en duración
  $('electroDuracion')?.addEventListener('change', async () => {
    await checkEquiposDisponibilidad();
  });
  
  // Event listener para autocompletado de diagnósticos (búsqueda dinámica, sin opciones iniciales)
  $('electroDiagnostico')?.addEventListener('input', debounce(buscarDiagnosticosElectro, 300));
  
  // Validadores en tiempo real
  // Nombre: Solo letras y espacios
  const _sanitizarNombreElectro = (e) => {
    const valor = e.target.value;
    if (valor && !/^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s]*$/.test(valor)) {
      e.target.value = valor.replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑ\s]/g, '');
    }
    e.target.style.borderColor = '';
  };
  $('electroPacienteNombres')?.addEventListener('input', _sanitizarNombreElectro);
  $('electroPacienteApellidos')?.addEventListener('input', _sanitizarNombreElectro);
  
  // Documento: Solo números + buscar paciente
  $('electroDocumento')?.addEventListener('input', debounce((e) => {
    const valor = e.target.value;
    if (valor && !/^\d*$/.test(valor)) {
      // Remover caracteres no numéricos
      e.target.value = valor.replace(/\D/g, '');
    }
    // Buscar paciente por documento
    buscarPacientePorDocumento();
  }, 300));
  
  // Teléfono: Solo números, máximo 10 dígitos
  const limitarTel = (e) => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 10);
  };
  $('electroTelefono')?.addEventListener('input', limitarTel);
  $('electroTelefono2')?.addEventListener('input', limitarTel);

  // tecnico_electro y doctor NO pueden crear citas
  const canCreateElectro = !isDoctor() && currentUser?.rol !== 'tecnico_electro';

  // Botón "Nuevo Estudio" y modal
  const btnNuevoEstudio = $('btnNuevoEstudioElectro');
  if (btnNuevoEstudio) btnNuevoEstudio.style.display = canCreateElectro ? 'inline-flex' : 'none';
  if (canCreateElectro) {
    btnNuevoEstudio?.addEventListener('click', () => {
      const fecha = $('electroFecha')?.value;
      const fechaInput = $('modalNuevoEstudioFecha');
      if (fechaInput) fechaInput.value = fecha || new Date().toISOString().slice(0, 10);
      const progEl = $('electroProgramadoPor');
      if (progEl) progEl.textContent = currentUser ? (currentUser.nombre || currentUser.usuario || '-') : '-';
      checkEquiposDisponibilidad();
      $('modalNuevoEstudioElectro')?.classList.remove('hidden');
    });
    $('modalNuevoEstudioFecha')?.addEventListener('change', checkEquiposDisponibilidad);
    $('btnCerrarNuevoEstudioModal')?.addEventListener('click', () => $('modalNuevoEstudioElectro')?.classList.add('hidden'));
    $('btnCancelarNuevoEstudioModal')?.addEventListener('click', () => $('modalNuevoEstudioElectro')?.classList.add('hidden'));
    $('crearCitaElectro')?.addEventListener('click', crearCitaElectro);
  }

  // Ocultar "Pacientes en Espera" para tecnico_electro y doctor
  const esperaBtnSidebar = document.querySelector('#view-electro .electro-page-btn[data-page="espera"]');
  if (esperaBtnSidebar && (isDoctor() || currentUser?.rol === 'tecnico_electro')) {
    esperaBtnSidebar.style.display = 'none';
  }

  // Botón aviso al doctor en módulo electro (para admin_electro y tecnico_electro)
  const canAvisarElectro = ['admin_electro', 'tecnico_electro'].includes(currentUser?.rol);
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
  $('modalEquipo')?.addEventListener('change', async (e) => {
    if (!citaElectroSeleccionada) return;
    
    // No procesar cambios si estamos inicializando el modal
    if (isInitializingElectroModal) {
      console.log('[MODAL_EQUIPO_CHANGE] Ignorando cambio durante inicialización del modal');
      return;
    }
    
    const nuevoEquipoId = e.target.value;
    const equipoIdActual = citaElectroSeleccionada.equipo_id || '';
    
    // Si el equipo no cambió, no hacer nada
    if (String(nuevoEquipoId) === String(equipoIdActual)) return;
    
    console.log('[MODAL_EQUIPO_CHANGE] Cambio de equipo a:', nuevoEquipoId);
    
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
  $('modalEstado')?.addEventListener('change', async (e) => {
  if (!citaElectroSeleccionada) return;
    
    // No procesar cambios si estamos inicializando el modal
    if (isInitializingElectroModal) {
      console.log('[MODAL_ESTADO_CHANGE] Ignorando cambio durante inicialización del modal');
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
    // Solo dígitos y max 10 en el teléfono del panel de edición
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

  // Event listeners para modales de reprogramación y adelanto
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

  // Event listeners para pestañas de estudios
  document.querySelectorAll('.tab-electro-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      filtroEstudioElectro = e.target.dataset.estudio;
      
      // Actualizar clases de botones
      document.querySelectorAll('.tab-electro-btn').forEach(b => {
        b.classList.remove('active');
      });
      e.target.classList.add('active');
      
      // Recargar tabla filtrada
      cargarCitasElectro();
    });
  });

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

  // Botón "Cargar Pacientes" (solo admin_electro, admin, recepcion)
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

  // ── Sidebar navegación por páginas ──────────────────────────────────────
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
    for (let i = 1; i <= 4; i++) {
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
    // Determinar duración en MINUTOS
    let duracionMinutos = null;
    
    if (duracionHoras) {
      // Usuario ingresó duración (Monitorización): convertir HORAS a MINUTOS
      duracionMinutos = Math.round(parseFloat(duracionHoras) * 60);
    } else if (selectedEstudioDuracion) {
      // Estudio fijo con duración predeterminada (ya en minutos)
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
          <span><strong>${data.capacidad.cuposaDisponibles}/4</strong> libres</span>
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
    for (let i = 1; i <= 4; i++) {
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
        <div class="cupo-mini-barra-wrap" title="${fmtHora(cita.horaInicioReal)} → ${fmtHora(cita.horaFin)}">
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

    // Iniciar actualización de barras de progreso (cada segundo)
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
        html += `<div class="cupos-estudio-item">${cita.estudio || 'Sin estudio'} &nbsp;<span style="color:#94a3b8">${fmtFecha(cita.fechaInicio)} ${fmtHora(cita.horaInicio)} → ${fmtFecha(cita.fechaFin)} ${fmtHora(cita.horaFin)}</span></div>`;
      });
      html += `</div>`;
    }

    // Próxima disponibilidad
    if (!esDisponible && data.proximaDisponibilidad) {
      html += `
        <div class="cupos-proxima">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="flex-shrink:0"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm.5 5H11v6l5.25 3.15.75-1.23-4.5-2.67V7z"/></svg>
          <span>Próxima disponibilidad: <strong>${data.proximaDisponibilidad}</strong></span>
        </div>`;
    }

    html += `</div>`; // cierra cupos-panel-body

    contenido.innerHTML = html;
  } catch (e) {
    console.error('Error checking disponibilidad:', e);
  }
}

// Buscar paciente por documento y auto-completar nombre y teléfono
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

// Listener para cuando se selecciona un diagnóstico del datalist
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

async function cargarCitasElectro() {
  const fecha = $('electroFecha').value;
  if (!fecha) { showToast('Selecciona una fecha', 'error'); return; }
  showSkeletonRows($('citasElectroBody'), 10, 6);
  try {
    const res = await apiFetch(`/api/citas-electro?fecha=${fecha}`);
    const citas = await res.json();
    
    // Filtrar por estudio si es necesario
    let citasFiltradas = citas;
    if (filtroEstudioElectro !== 'todas') {
      citasFiltradas = citas.filter(c => c.estudio === filtroEstudioElectro);
    }
    
    if (citasFiltradas.length === 0) {
      const tbody = $('citasElectroBody');
      const mensajeEstudio = filtroEstudioElectro === 'todas' ? '' : ` para ${filtroEstudioElectro}`;
      tbody.innerHTML = `<tr><td colspan="10"><div class="empty-state"><div class="empty-state-icon">📅</div><p class="empty-state-title">Sin citas</p><p class="empty-state-subtitle">No hay citas registradas para esta fecha${mensajeEstudio}</p></div></td></tr>`;
      const contador = $('citasElectroContador');
      if (contador) contador.textContent = '';
      // Actualizar información de usuario
      $('electroUsuarioProgramo').textContent = '-';
      $('electroUsuarioEdito').textContent = '-';
      return;
    }

    // Actualizar contador de citas
    const contador = $('citasElectroContador');
    if (contador) {
      const total = citasFiltradas.length;
      const completadas = citasFiltradas.filter(c => c.estado === 'Completado').length;
      const enEstudio = citasFiltradas.filter(c => c.estado === 'En Estudio').length;
      const partes = [`${total} cita${total !== 1 ? 's' : ''}`];
      if (enEstudio > 0) partes.push(`${enEstudio} en estudio`);
      if (completadas > 0) partes.push(`${completadas} completada${completadas !== 1 ? 's' : ''}`);
      contador.textContent = partes.join(' · ');
    }

    // Usar setupPagination para renderizar con paginación
    setupPagination('citasElectro', citasFiltradas, renderCitaElectroRow, {
      itemsPerPageDefault: 20,
      tbodyId: 'citasElectroBody',
      containerSelector: '#citasElectroTableControls'
    });
    
    // Actualizar información de usuario (del primer registro filtrado)
    if (citasFiltradas.length > 0) {
      $('electroUsuarioProgramo').textContent = citasFiltradas[0].programado_por_nombre || citasFiltradas[0].usuario_programo || '-';
      $('electroUsuarioEdito').textContent = citasFiltradas[0].editado_por_nombre || citasFiltradas[0].usuario_edito || citasFiltradas[0].programado_por_nombre || citasFiltradas[0].usuario_programo || 'Quien programó';
    }
    
    // Refrescar panel de disponibilidad de equipos
    checkEquiposDisponibilidad();
  } catch (e) { 
    console.error('Error cargando citas:', e);
    showToast('Error cargando citas', 'error'); 
  }
}

function renderCitaElectroRow(tbody, c) {
  const tr = document.createElement('tr');
  tr.className = 'turno-row';
  tr.style.cursor = 'pointer';
  
  const equipoDisplay = c.equipo_nombre || c.equipo_id ? `${c.equipo_nombre || 'Equipo'} (ID: ${c.equipo_id})` : '-';
  
  // Mostrar hora_fin con fecha SOLO si cruza medianoche
  let horaFinDisplay = formatearHora(c.hora_fin);
  if (c.hora_fin_date && c.hora_fin_date !== c.fecha) {
    const fechaFormateada = formatearFechaISO(c.hora_fin_date);
    horaFinDisplay = `${formatearHora(c.hora_fin)} <span style="color:#dc2626;font-weight:600;">(${fechaFormateada})</span>`;
  }
  
  tr.innerHTML = `
    <td>${formatearHora(c.hora_agendamiento)}</td>
    <td class="col-mobile-hide">${formatearHora(c.hora_inicio)}</td>
    <td class="col-mobile-hide">${escapeHtml(equipoDisplay)}</td>
    <td>${escapeHtml(c.paciente_nombre || '-')}</td>
    <td>${escapeHtml(c.paciente_documento || '-')}</td>
    <td class="col-mobile-hide">${escapeHtml(c.telefono || '-')}</td>
    <td>${escapeHtml(c.estudio || '-')}</td>
    <td class="col-mobile-hide">${escapeHtml(c.diagnostico_codigo || '-')}</td>
    <td>${estadoBadge(c.estado || 'Programado')}</td>
    <td class="col-mobile-hide">${horaFinDisplay}</td>
  `;
  
  // Hacer la fila clickeable para abrir modal
  tr.addEventListener('click', (e) => {
    if (isDoctor()) return; // Doctor solo puede ver la lista, no los detalles
    if (c.estado === 'Completado') {
      // Permitir click si es admin (puede eliminar)
      const esAdmin = currentUser && (currentUser.rol === 'admin' || currentUser.rol === 'administrador');
      if (!esAdmin) {
        showToast('Esta cita ya está completada - No se puede modificar', 'info');
        return;
      }
    }
    abrirModalDetallesCita(c);
  });
  
  // Cambiar apariencia visual si está completado
  if (c.estado === 'Completado') {
    tr.style.opacity = '0.6';
    tr.style.backgroundColor = '#f0fdf4';
    // Cursor normal para admin, not-allowed para otros
    const esAdmin = currentUser && (currentUser.rol === 'admin' || currentUser.rol === 'administrador');
    tr.style.cursor = esAdmin ? 'pointer' : 'not-allowed';
  }
  
  tbody.appendChild(tr);
}

/**
 * Valida que un nombre solo contenga letras y espacios
 * @param {string} nombre - El nombre a validar
 * @returns {boolean} true si es válido
 */
function validarNombre(nombre) {
  return /^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+$/.test(nombre);
}

/**
 * Valida que un documento solo contenga números
 * @param {string} doc - El documento a validar
 * @returns {boolean} true si es válido
 */
function validarDocumento(doc) {
  return /^\d+$/.test(doc);
}

/**
 * Valida que un teléfono tenga exactamente 10 dígitos
 * @param {string} telefono - El teléfono a validar
 * @returns {boolean} true si es válido
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
  
  if (!electroNombres) { showToast('Escribe los nombres del paciente', 'error'); $('electroPacienteNombres').focus(); $('electroPacienteNombres').style.borderColor='#dc2626'; return; }
  if (!electroApellidos) { showToast('Escribe los apellidos del paciente', 'error'); $('electroPacienteApellidos').focus(); $('electroPacienteApellidos').style.borderColor='#dc2626'; return; }
  if (!hora) { showToast('Selecciona una hora', 'error'); $('electroHora').focus(); return; }
  if (!doc || !telefono || !telefono2 || !fecha || !diagnostico) { 
    showToast('Completa todos los campos obligatorios', 'error'); 
    return; 
  }
  
  // Validar nombre (solo letras y espacios)
  if (!validarNombre(electroNombres)) {
    showToast('Los nombres no pueden contener números o caracteres especiales', 'error');
    $('electroPacienteNombres').focus();
    $('electroPacienteNombres').style.borderColor = '#dc2626';
    return;
  }
  if (!validarNombre(electroApellidos)) {
    showToast('Los apellidos no pueden contener números o caracteres especiales', 'error');
    $('electroPacienteApellidos').focus();
    $('electroPacienteApellidos').style.borderColor = '#dc2626';
    return;
  }
  $('electroPacienteNombres').style.borderColor = '';
  $('electroPacienteApellidos').style.borderColor = '';
  
  // Validar documento (solo números)
  if (!validarDocumento(doc)) {
    showToast('El documento solo puede contener números', 'error');
    $('electroDocumento').focus();
    $('electroDocumento').style.borderColor = '#dc2626';
    return;
  }
  $('electroDocumento').style.borderColor = '';
  
  // Validar teléfono (exactamente 10 dígitos)
  if (!validarTelefono(telefono)) {
    showToast('El teléfono debe tener exactamente 10 dígitos', 'error');
    $('electroTelefono').focus();
    $('electroTelefono').style.borderColor = '#dc2626';
    return;
  }
  $('electroTelefono').style.borderColor = '';
  
  // Validar teléfono 2 (exactamente 10 dígitos)
  if (!validarTelefono(telefono2)) {
    showToast('El teléfono 2 debe tener exactamente 10 dígitos', 'error');
    $('electroTelefono2').focus();
    $('electroTelefono2').style.borderColor = '#dc2626';
    return;
  }
  $('electroTelefono2').style.borderColor = '';

  // Teléfono 2 no puede ser igual al 1
  if (telefono === telefono2) {
    showToast('El Teléfono 2 no puede ser igual al Teléfono 1', 'error');
    $('electroTelefono2').focus();
    $('electroTelefono2').style.borderColor = '#dc2626';
    return;
  }
  
  // Validar duración si es Monitorización EEG por Video y Radio
  if (estudio === 'Monitorización Electroencefalografica por Video y Radio' && !duracion) {
    showToast('Debe especificar la duración del estudio (en horas)', 'error');
    $('electroDuracion').focus();
    $('electroDuracion').style.borderColor = '#dc2626';
    return;
  }
  
  // Validar que duración sea un número válido si es Monitorización
  if (estudio === 'Monitorización Electroencefalografica por Video y Radio' && duracion) {
    const duracionNum = parseFloat(duracion);
    if (isNaN(duracionNum) || duracionNum < 1 || duracionNum > 168) {
      showToast('La duración debe estar entre 1 y 168 horas', 'error');
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
  
  // Buscar ID del diagnóstico si fue seleccionado
  let diagnosticoId = selectedDiagnosticoElectroId;
  if (!diagnosticoId && diagnostico) {
    // Fallback: buscar la opción que coincida con el valor ingresado
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
  
  // Nota: El equipo se selecciona después en el modal cuando se inicia el estudio
  let equipoId = null;

  // Mostrar spinner en el botón
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
      estado: 'Programado',
      programado_por_nombre: currentUser ? (currentUser.nombre || currentUser.usuario) : 'Sistema'
    };
    
    // Determinar duración en minutos
    let duracionMinutos = null;
    
    if (duracion) {
      // Usuario ingresó duración (es Monitorización): convertir HORAS a MINUTOS
      duracionMinutos = Math.round(parseFloat(duracion) * 60);
    } else if (selectedEstudioDuracion) {
      // Estudio fijo con duración predeterminada (ya en minutos)
      duracionMinutos = selectedEstudioDuracion;
    }
    
    if (duracionMinutos) {
      body.duracion = duracionMinutos;
    }
    
    // Agregar diagnóstico si fue seleccionado
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

// ========== MÓDULO DE PERMISOS (solo superadmin) ==========

// Definición completa de todos los permisos del sistema
const PERMISOS_DEFS = [
  // ── Acceso a Módulos ───────────────────────────────────────────────────────
  { key: 'modulo.recibos',          label: 'Módulo: Recibos',                     grupo: 'Acceso a Módulos' },
  { key: 'modulo.agenda_medica',    label: 'Módulo: Agenda Médica',               grupo: 'Acceso a Módulos' },
  { key: 'modulo.electrodiag',      label: 'Módulo: Electrodiagnóstico',          grupo: 'Acceso a Módulos' },
  { key: 'modulo.dashboard',        label: 'Módulo: Dashboard de Citas',          grupo: 'Acceso a Módulos' },
  { key: 'modulo.usuarios',         label: 'Módulo: Gestión de Usuarios',         grupo: 'Acceso a Módulos' },
  { key: 'modulo.diagnosticos',     label: 'Módulo: Diagnósticos',                grupo: 'Acceso a Módulos' },
  { key: 'modulo.gestion_datos',    label: 'Módulo: Gestión de Datos',            grupo: 'Acceso a Módulos' },
  // ── Recibos ───────────────────────────────────────────────────────────────
  { key: 'recibos.crear',           label: 'Recibos: Crear nuevo recibo',         grupo: 'Recibos' },
  { key: 'recibos.ver',             label: 'Recibos: Ver lista de recibos',       grupo: 'Recibos' },
  { key: 'recibos.eliminar',        label: 'Recibos: Eliminar recibos',           grupo: 'Recibos' },
  { key: 'recibos.exportar',        label: 'Recibos: Exportar Excel / PDF',       grupo: 'Recibos' },
  { key: 'recibos.gestionar_servicios', label: 'Recibos: Gestionar servicios',    grupo: 'Recibos' },
  { key: 'recibos.resetear',        label: 'Recibos: Resetear consecutivos',      grupo: 'Recibos' },
  // ── Agenda Médica ──────────────────────────────────────────────────────────
  { key: 'agenda.ver',              label: 'Agenda: Ver turnos del día',          grupo: 'Agenda Médica' },
  { key: 'agenda.crear',            label: 'Agenda: Crear / Programar citas',     grupo: 'Agenda Médica' },
  { key: 'agenda.editar',           label: 'Agenda: Editar citas',                grupo: 'Agenda Médica' },
  { key: 'agenda.eliminar',         label: 'Agenda: Eliminar citas',              grupo: 'Agenda Médica' },
  { key: 'agenda.cambiar_estado',   label: 'Agenda: Cambiar estado de turno',     grupo: 'Agenda Médica' },
  { key: 'agenda.llamar_siguiente', label: 'Agenda: Llamar siguiente paciente',   grupo: 'Agenda Médica' },
  { key: 'agenda.marcar_atendido',  label: 'Agenda: Marcar como atendido',        grupo: 'Agenda Médica' },
  { key: 'agenda.aviso_doctor',     label: 'Agenda: Enviar aviso al doctor',      grupo: 'Agenda Médica' },
  { key: 'agenda.disponibilidad',   label: 'Agenda: Programar disponibilidad',    grupo: 'Agenda Médica' },
  // ── Electrodiagnóstico ────────────────────────────────────────────────────
  { key: 'electro.ver',             label: 'Electro: Ver citas',                  grupo: 'Electrodiagnóstico' },
  { key: 'electro.crear',           label: 'Electro: Crear cita',                grupo: 'Electrodiagnóstico' },
  { key: 'electro.editar',          label: 'Electro: Editar cita',                grupo: 'Electrodiagnóstico' },
  { key: 'electro.eliminar',        label: 'Electro: Eliminar cita',              grupo: 'Electrodiagnóstico' },
  { key: 'electro.cambiar_estado',  label: 'Electro: Cambiar estado de cita',     grupo: 'Electrodiagnóstico' },
  { key: 'electro.subir_archivo',   label: 'Electro: Subir archivos de estudios', grupo: 'Electrodiagnóstico' },
  { key: 'electro.ver_archivo',     label: 'Electro: Ver/descargar archivos',     grupo: 'Electrodiagnóstico' },
  { key: 'electro.aviso_doctor',    label: 'Electro: Enviar aviso al doctor',     grupo: 'Electrodiagnóstico' },
  // ── Usuarios ─────────────────────────────────────────────────────────────
  { key: 'usuarios.ver',            label: 'Usuarios: Ver lista de usuarios',     grupo: 'Gestión de Usuarios' },
  { key: 'usuarios.crear',          label: 'Usuarios: Crear usuario',             grupo: 'Gestión de Usuarios' },
  { key: 'usuarios.editar',         label: 'Usuarios: Editar usuario',            grupo: 'Gestión de Usuarios' },
  { key: 'usuarios.cambiar_clave',  label: 'Usuarios: Cambiar contraseña',        grupo: 'Gestión de Usuarios' },
  { key: 'usuarios.eliminar',       label: 'Usuarios: Eliminar usuario',          grupo: 'Gestión de Usuarios' },
  { key: 'usuarios.auditoria',      label: 'Usuarios: Ver auditoría de accesos',  grupo: 'Gestión de Usuarios' },
  { key: 'usuarios.permisos',       label: 'Usuarios: Gestionar permisos (superadmin)', grupo: 'Gestión de Usuarios' },
  // ── Diagnósticos ──────────────────────────────────────────────────────────
  { key: 'diagnosticos.ver',        label: 'Diagnósticos: Ver lista',             grupo: 'Diagnósticos' },
  { key: 'diagnosticos.crear',      label: 'Diagnósticos: Crear diagnóstico',     grupo: 'Diagnósticos' },
  { key: 'diagnosticos.editar',     label: 'Diagnósticos: Editar diagnóstico',    grupo: 'Diagnósticos' },
  { key: 'diagnosticos.eliminar',   label: 'Diagnósticos: Eliminar diagnóstico',  grupo: 'Diagnósticos' },
  // ── Sistema ───────────────────────────────────────────────────────────────
  { key: 'sistema.backups',         label: 'Sistema: Gestión de backups',         grupo: 'Sistema' },
  { key: 'sistema.exportar_datos',  label: 'Sistema: Exportar datos del sistema', grupo: 'Sistema' },
  { key: 'sistema.dashboard',       label: 'Sistema: Ver dashboard estadísticas', grupo: 'Sistema' },
  { key: 'sistema.reportes',        label: 'Sistema: Ver reportes de recibos',    grupo: 'Sistema' },
];

// Permisos predeterminados por rol (null = sin restricciones / todo permitido)
const PERMISOS_ROL_DEFAULTS = {
  superadmin: null,
  admin: null,
  admin_recepcion: [
    'modulo.recibos','modulo.agenda_medica','modulo.electrodiag','modulo.dashboard',
    'recibos.crear','recibos.ver','recibos.exportar',
    'agenda.ver','agenda.crear','agenda.editar','agenda.eliminar','agenda.cambiar_estado',
    'agenda.llamar_siguiente','agenda.marcar_atendido','agenda.aviso_doctor','agenda.disponibilidad',
    'electro.ver','electro.crear','electro.editar','electro.cambiar_estado','electro.subir_archivo','electro.ver_archivo','electro.aviso_doctor',
    'sistema.dashboard',
  ],
  recepcion: [
    'modulo.recibos','modulo.agenda_medica','modulo.electrodiag','modulo.dashboard',
    'recibos.crear','recibos.ver',
    'agenda.ver','agenda.crear','agenda.editar','agenda.eliminar','agenda.cambiar_estado',
    'agenda.llamar_siguiente','agenda.marcar_atendido','agenda.aviso_doctor',
    'electro.ver','electro.crear','electro.editar','electro.cambiar_estado',
    'sistema.dashboard',
  ],
  auxiliar_recepcion: [
    'modulo.recibos','modulo.agenda_medica','modulo.electrodiag',
    'recibos.crear','recibos.ver',
    'agenda.ver','agenda.crear','agenda.editar','agenda.cambiar_estado',
    'electro.ver','electro.crear',
  ],
  doctor: [
    'modulo.agenda_medica','modulo.electrodiag','modulo.dashboard',
    'agenda.ver','agenda.disponibilidad',
    'electro.ver','electro.cambiar_estado','electro.subir_archivo','electro.ver_archivo',
    'sistema.dashboard',
  ],
  admin_electro: [
    'modulo.electrodiag','modulo.agenda_medica','modulo.dashboard',
    'electro.ver','electro.crear','electro.editar','electro.eliminar','electro.cambiar_estado','electro.subir_archivo','electro.ver_archivo','electro.aviso_doctor',
    'agenda.ver','agenda.aviso_doctor',
    'sistema.dashboard',
  ],
  electro: [
    'modulo.electrodiag','modulo.agenda_medica','modulo.dashboard',
    'electro.ver','electro.crear','electro.editar','electro.cambiar_estado','electro.subir_archivo','electro.ver_archivo','electro.aviso_doctor',
    'agenda.ver','agenda.aviso_doctor',
    'sistema.dashboard',
  ],
  tecnico_electro: [
    'modulo.electrodiag','modulo.agenda_medica',
    'electro.ver','electro.crear','electro.editar','electro.cambiar_estado','electro.subir_archivo','electro.ver_archivo',
    'agenda.ver',
  ],
  contabilidad: [
    'modulo.recibos','modulo.dashboard',
    'recibos.ver','recibos.exportar',
    'sistema.dashboard','sistema.reportes',
  ],
};

let _permisosUsuarioSeleccionado = null; // { id, usuario, nombre, rol, permisos }

async function initPermisosPage() {
  // Mostrar tab solo a superadmin
  const btnTab = document.getElementById('btnSidebarPermisos');
  if (btnTab && currentUser?.rol === 'superadmin') btnTab.style.display = '';

  await _cargarPermisosUserList();

  const btnGuardar = document.getElementById('btnPermisosGuardar');
  const btnRestablecer = document.getElementById('btnPermisosRestablecer');

  if (btnGuardar) btnGuardar.onclick = _guardarPermisos;
  if (btnRestablecer) btnRestablecer.onclick = _restablecerPermisos;
}

async function _cargarPermisosUserList() {
  const container = document.getElementById('permisosUserList');
  if (!container) return;
  container.innerHTML = '<div style="padding:12px;text-align:center;color:#9ca3af;font-size:0.9rem">Cargando...</div>';
  try {
    const res = await apiFetch('/api/usuarios');
    const usuarios = await res.json();
    container.innerHTML = '';
    usuarios
      .filter(u => u.rol !== 'superadmin')
      .forEach(u => {
        const btn = document.createElement('button');
        btn.className = 'permisos-user-btn';
        btn.dataset.id = u.id;
        btn.style.cssText = 'width:100%;text-align:left;padding:8px 10px;border:1px solid #e5e7eb;border-radius:6px;background:#fff;cursor:pointer;font-size:0.88rem;transition:background 0.15s';
        btn.innerHTML = `<div style="font-weight:600;color:#111827">${escapeHtml(u.nombre || u.usuario)}</div><div style="font-size:0.78rem;color:#6b7280">${escapeHtml(u.usuario)} &middot; ${escapeHtml(_rolLabel(u.rol))}${u.permisos ? ' &nbsp;<span style="color:#6366f1;font-size:0.73rem">✦ personalizado</span>' : ''}</div>`;
        btn.addEventListener('click', () => _seleccionarUsuarioPermisos(u.id));
        btn.addEventListener('mouseenter', () => { btn.style.background = '#f3f4f6'; });
        btn.addEventListener('mouseleave', () => { btn.style.background = _permisosUsuarioSeleccionado?.id === u.id ? '#eff6ff' : '#fff'; btn.style.borderColor = _permisosUsuarioSeleccionado?.id === u.id ? '#93c5fd' : '#e5e7eb'; });
        container.appendChild(btn);
      });
  } catch(e) { container.innerHTML = '<div style="padding:12px;color:#dc2626;font-size:0.85rem">Error al cargar usuarios</div>'; }
}

function _rolLabel(rol) {
  const map = { admin:'Administrador', admin_recepcion:'Admin Recepción', recepcion:'Recepción', auxiliar_recepcion:'Auxiliar Recepción', admin_electro:'Admin Electro', electro:'Electrodiagnóstico', tecnico_electro:'Técnico Electro', doctor:'Doctor', contabilidad:'Contabilidad' };
  return map[rol] || rol;
}

async function _seleccionarUsuarioPermisos(userId) {
  // Marcar botón activo
  document.querySelectorAll('.permisos-user-btn').forEach(b => {
    const activo = parseInt(b.dataset.id) === userId;
    b.style.background = activo ? '#eff6ff' : '#fff';
    b.style.borderColor = activo ? '#93c5fd' : '#e5e7eb';
    b.style.fontWeight  = activo ? '600' : 'normal';
  });

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
  } catch(e) { showToast('Error al cargar permisos de usuario', 'error'); }
}

function _renderPermisosChecklist(activos, rolDefaults) {
  const container = document.getElementById('permisosChecklistContainer');
  if (!container) return;
  container.innerHTML = '';

  // Agrupar
  const grupos = {};
  PERMISOS_DEFS.forEach(p => {
    if (!grupos[p.grupo]) grupos[p.grupo] = [];
    grupos[p.grupo].push(p);
  });

  Object.entries(grupos).forEach(([grupo, perms]) => {
    const section = document.createElement('div');
    section.style.cssText = 'margin-bottom:16px';

    // Encabezado de grupo con checkbox "marcar todos"
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px;padding:5px 8px;background:#f3f4f6;border-radius:6px';
    const chkAll = document.createElement('input');
    chkAll.type = 'checkbox';
    chkAll.title = 'Marcar/desmarcar todos';
    chkAll.style.cssText = 'width:15px;height:15px;cursor:pointer';
    const lbl = document.createElement('span');
    lbl.style.cssText = 'font-weight:700;font-size:0.88rem;color:#374151';
    lbl.textContent = grupo;
    header.appendChild(chkAll);
    header.appendChild(lbl);
    section.appendChild(header);

    // Grid de checkboxes
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:4px 12px;padding:0 4px';

    perms.forEach(p => {
      const esRolDefault = rolDefaults === null || (Array.isArray(rolDefaults) && rolDefaults.includes(p.key));
      const estaActivo   = activos !== null ? activos.has(p.key) : esRolDefault;

      const row = document.createElement('label');
      row.style.cssText = 'display:flex;align-items:center;gap:7px;padding:5px 6px;border-radius:5px;cursor:pointer;transition:background 0.12s;font-size:0.85rem';
      row.addEventListener('mouseenter', () => { row.style.background = '#f9fafb'; });
      row.addEventListener('mouseleave', () => { row.style.background = 'transparent'; });

      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.dataset.key = p.key;
      chk.checked = estaActivo;
      chk.style.cssText = 'width:15px;height:15px;flex-shrink:0;cursor:pointer';

      const txt = document.createElement('span');
      txt.style.color = '#374151';
      txt.textContent = p.label;

      const badge = document.createElement('span');
      if (esRolDefault) {
        badge.style.cssText = 'font-size:0.7rem;color:#6366f1;white-space:nowrap;margin-left:auto;flex-shrink:0';
        badge.textContent = '◈ rol';
      }

      row.appendChild(chk);
      row.appendChild(txt);
      if (esRolDefault) row.appendChild(badge);
      grid.appendChild(row);
    });

    section.appendChild(grid);
    container.appendChild(section);

    // Lógica del "marcar todos" del grupo
    const chks = grid.querySelectorAll('input[type=checkbox]');
    chkAll.checked = Array.from(chks).every(c => c.checked);
    chkAll.indeterminate = !chkAll.checked && Array.from(chks).some(c => c.checked);
    chkAll.addEventListener('change', () => {
      chks.forEach(c => { c.checked = chkAll.checked; });
    });
    chks.forEach(c => c.addEventListener('change', () => {
      chkAll.checked = Array.from(chks).every(x => x.checked);
      chkAll.indeterminate = !chkAll.checked && Array.from(chks).some(x => x.checked);
    }));
  });
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
      // Re-marcar el usuario activo
      const btnActivo = document.querySelector(`.permisos-user-btn[data-id="${_permisosUsuarioSeleccionado.id}"]`);
      if (btnActivo) { btnActivo.style.background='#eff6ff'; btnActivo.style.borderColor='#93c5fd'; }
    } else {
      showToast(data.error || 'Error al guardar permisos', 'error');
    }
  } catch(e) { showToast('Error de conexión', 'error'); }
  finally { setLoading(btn, false, 'Guardar cambios'); }
}

async function _restablecerPermisos() {
  if (!_permisosUsuarioSeleccionado) return;
  showConfirm(`¿Restablecer los permisos de "${_permisosUsuarioSeleccionado.nombre || _permisosUsuarioSeleccionado.usuario}" al predeterminado de su rol?\nSe eliminarán los permisos personalizados.`, async () => {
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
        const btnActivo = document.querySelector(`.permisos-user-btn[data-id="${_permisosUsuarioSeleccionado.id}"]`);
        if (btnActivo) { btnActivo.style.background='#eff6ff'; btnActivo.style.borderColor='#93c5fd'; }
      } else {
        showToast(data.error || 'Error al restablecer', 'error');
      }
    } catch(e) { showToast('Error de conexión', 'error'); }
    finally { setLoading(btn, false, '↺ Restablecer al rol'); }
  }, { okText: 'Restablecer', icon: '↺' });
}

// ========== GESTIÓN DE USUARIOS (solo admin) ==========
async function initUsuarios() {
  $('crearUsuario').addEventListener('click', crearUsuario);

  // ── Navegación lateral por páginas ────────────────────────────────────────
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

  // Cargar especialidades en los selects al abrir el módulo
  await cargarOpcionesEspecialidad('newUserEspecialidad');
  await cargarOpcionesEspecialidad('editEspecialidad');

  // Validador de contraseña en tiempo real
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
          'length': validation.issues.includes('length') ? '[✗]' : '[✓]',
          'upper': validation.issues.includes('upper') ? '[✗]' : '[✓]',
          'lower': validation.issues.includes('lower') ? '[✗]' : '[✓]',
          'number': validation.issues.includes('number') ? '[✗]' : '[✓]',
          'special': validation.issues.includes('special') ? '[✗]' : '[✓]'
        };
        
        $('req-length')?.textContent  && ($('req-length').textContent  = checks.length  + ' Mínimo 8 caracteres');
        $('req-upper')?.textContent   && ($('req-upper').textContent   = checks.upper   + ' Al menos una mayúscula (A-Z)');
        $('req-lower')?.textContent   && ($('req-lower').textContent   = checks.lower   + ' Al menos una minúscula (a-z)');
        $('req-number')?.textContent  && ($('req-number').textContent  = checks.number  + ' Al menos un número (0-9)');
        if ($('req-special')) $('req-special').textContent = checks.special + ' Al menos un símbolo (!@#$%^&* etc)';
      } else {
        strengthBar.style.display = 'none';
        strengthText.style.display = 'none';
        requirements.style.display = 'none';
      }
    });
  }
  
  // Mostrar/ocultar especialidad y consultorio según rol
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
  
  // Event listener para el botón de Auditoría
  const btnAuditoria = document.querySelector('button[onclick="abrirBusquedaAuditoria()"]');
  if (btnAuditoria) {
    btnAuditoria.addEventListener('click', function(e) {
      e.preventDefault();
      abrirBusquedaAuditoria();
    });
    console.log('[AUDIT] Event listener agregado al botón de Auditoría');
  } else {
    console.warn('[AUDIT] No se encontró el botón de Auditoría');
  }
  
  // Socket: cuando cualquier usuario cambia su nombre, refrescar lista de usuarios (si está visible)
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
      tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state"><div class="empty-state-icon">👤</div><p class="empty-state-title">Sin usuarios</p><p class="empty-state-subtitle">No hay usuarios registrados en el sistema</p></div></td></tr>';
      return;
    }

    // Usar setupPagination para renderizar con paginación
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
    showConfirm(`¿Resetear contraseña para ${u.usuario}?`, async () => {
      try {
        const r = await apiFetch(`/api/usuarios/${e.target.closest('[data-reset]').dataset.reset}/reset-password`, { method: 'PATCH' });
        const d = await r.json();
        if (d.ok) { verResetPassword(d); } else showToast(d.error||'Error', 'error');
      } catch (x) { showToast('Error', 'error'); }
    }, { okText: 'Resetear', icon: '🔑' });
  });
  tr.querySelector('[data-toggle]')?.addEventListener('click', (e) => {
    const newState = u.activo ? 'desactivar' : 'activar';
    const label = newState.charAt(0).toUpperCase() + newState.slice(1);
    showConfirm(`¿${label} este usuario?`, async () => {
      try {
        const r = await apiFetch(`/api/usuarios/${e.target.closest('[data-toggle]').dataset.toggle}/toggle-estado`, { method: 'PATCH' });
        const d = await r.json();
        if (d.ok) { showToast(`Usuario ${d.activo ? 'activado' : 'desactivado'}`, 'success'); cargarUsuarios(); }
        else showToast(d.error||'Error', 'error');
      } catch (x) { showToast('Error', 'error'); }
    }, { okText: label, danger: u.activo, icon: u.activo ? '🚫' : '✅' });
  });
  tr.querySelector('[data-del]')?.addEventListener('click', (e) => {
    showConfirm('¿Eliminar este usuario permanentemente?', async () => {
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

// Abrir modal de edición de usuario
function editarUsuario(u) {
  usuarioEnEdicion = u;
  $('editUsu').value = u.usuario;
  $('editNombre').value = u.nombre || '';
  $('editRol').value = u.rol || 'recepcion';
  $('editPassword').value = '';
  $('editarUsuarioError').classList.add('hidden');
  
  // Mostrar/ocultar consultorio y especialidad según rol
  mostrarConsultorioEdicion(u.rol);
  $('editConsultorio').value = u.numero_consultorio || '';
  
  // Mostrar/ocultar especialidad según rol
  mostrarEspecialidadEdicion(u.rol, u.especialidad);
  
  // Cambiar rol automáticamente muestra/oculta consultorio y especialidad
  // Usamos onchange (no addEventListener) para evitar acumulación de listeners al reabrir el modal
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
      html += '<tr style="background:#f3f4f6"><th style="padding:12px;border:1px solid #e5e7eb;text-align:left;font-weight:600">Fecha</th><th style="padding:12px;border:1px solid #e5e7eb;text-align:left;font-weight:600">Acción</th><th style="padding:12px;border:1px solid #e5e7eb;text-align:left;font-weight:600">Realizado por</th><th style="padding:12px;border:1px solid #e5e7eb;text-align:left;font-weight:600">Cambios</th></tr>';
      
      historial.forEach(h => {
        const iconos = {
          'CREAR': '✨',
          'ACTUALIZAR': '✏️',
          'ELIMINAR': '🗑️',
          'ACTIVAR': '🟢',
          'DESACTIVAR': '🔴'
        };
        const icon = iconos[h.accion] || '•';
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
            'password': 'Contraseña'
          }[campo] || campo;
          
          cambiosHtml += `<div style="font-size:12px;margin:4px 0"><strong>${label}:</strong> ${valores.antes || '-'} → ${valores.despues || '-'}</div>`;
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

// Mostrar contraseña temporal de reset password
function verResetPassword(data) {
  const modal = $('modalResetPassword');
  $('resetPasswordUser').textContent = escapeHtml(data.usuario);
  $('resetPasswordName').textContent = escapeHtml(data.nombre || '-');
  $('resetPasswordValue').textContent = data.passwordTemporal;
  modal.classList.remove('hidden');
  
  // Copiar al portapapeles
  $('btnCopyPassword').addEventListener('click', () => {
    navigator.clipboard.writeText(data.passwordTemporal).then(() => {
      showToast('Contraseña copiada al portapapeles', 'success');
    }).catch(() => {
      showToast('No se pudo copiar', 'error');
    });
  });
}

function closeResetPasswordModal() {
  $('modalResetPassword').classList.add('hidden');
}

// ========== BÚSQUEDA AVANZADA DE AUDITORÍA ==========
function abrirBusquedaAuditoria() {
  console.log('[AUDIT] Abriendo búsqueda de auditoría');
  
  // Asegurar que el modal existe
  const modal = document.getElementById('modalBusquedaAuditoria');
  console.log('[AUDIT] Modal encontrado:', !!modal);
  
  if (!modal) {
    console.error('[AUDIT] Modal de auditoría NO encontrado en el DOM');
    alert('Error: No se encontró el modal de auditoría');
    return;
  }
  
  console.log('[AUDIT] Clases actuales del modal:', modal.className);
  
  // Remover clase hidden
  modal.classList.remove('hidden');
  
  console.log('[AUDIT] Clases después de remove:', modal.className);
  console.log('[AUDIT] Display style:', window.getComputedStyle(modal).display);
  
  // Configurar event listeners para botones del modal
  setTimeout(() => {
    console.log('[AUDIT] Configurando event listeners del modal');
    
    // Botón de cerrar X
    const btnCerrar = modal.querySelector('.btn-close-modal');
    if (btnCerrar) {
      btnCerrar.removeEventListener('click', closeBusquedaAuditoriaModal);
      btnCerrar.addEventListener('click', closeBusquedaAuditoriaModal);
      console.log('[AUDIT] Event listener agregado al botón de cerrar');
    } else {
      console.warn('[AUDIT] Botón de cerrar no encontrado');
    }
    
    // Botón Buscar
    const btnBuscar = modal.querySelector('.btn-buscar-auditoria');
    if (btnBuscar) {
      btnBuscar.removeEventListener('click', buscarAuditoria);
      btnBuscar.addEventListener('click', buscarAuditoria);
      console.log('[AUDIT] Event listener agregado al botón Buscar');
    }
    
    // Botón Limpiar
    const btnLimpiar = modal.querySelector('.btn-limpiar-auditoria');
    if (btnLimpiar) {
      btnLimpiar.removeEventListener('click', limpiarFiltrosAuditoria);
      btnLimpiar.addEventListener('click', limpiarFiltrosAuditoria);
      console.log('[AUDIT] Event listener agregado al botón Limpiar');
    }
    
    // Botón Exportar
    const btnExportar = modal.querySelector('.btn-exportar-auditoria');
    if (btnExportar) {
      btnExportar.removeEventListener('click', exportarAuditoriaCSV);
      btnExportar.addEventListener('click', exportarAuditoriaCSV);
      console.log('[AUDIT] Event listener agregado al botón Exportar');
    }
    
    // Ejecutar limpieza de filtros
    limpiarFiltrosAuditoria();
    
  }, 100);
}

function closeBusquedaAuditoriaModal() {
  console.log('[AUDIT] Cerrando modal de auditoría');
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
    console.log('[AUDIT SEARCH] Iniciando búsqueda de auditoría');
    
    // Obtener elementos del DOM
    const containerEl = document.getElementById('busquedaResultados');
    const accionEl = document.getElementById('filtroAccion');
    const desdeEl = document.getElementById('filtroDesde');
    const hastaEl = document.getElementById('filtroHasta');
    
    if (!containerEl) {
      console.error('[AUDIT SEARCH] Container no encontrado');
      showToast('Error: No se encontró el contenedor de resultados', 'error');
      return;
    }
    
    containerEl.innerHTML = '<p style="text-align:center;color:#2d4a47;padding:20px">Cargando...</p>';
    
    const accion = (accionEl?.value || '').trim();
    const desde = desdeEl?.value || '';
    const hasta = hastaEl?.value || '';
    
    // Construir URL con parámetros
    const params = new URLSearchParams();
    if (accion) params.append('accion', accion);
    if (desde) params.append('desde', desde);
    if (hasta) params.append('hasta', hasta);
    params.append('limit', 500);
    
    console.log('[AUDIT SEARCH] Parámetros:', {accion, desde, hasta});
    
    const res = await apiFetch(`/api/auditoria/buscar?${params.toString()}`);
    
    if (!res.ok) {
      const errorData = await res.json();
      throw new Error(errorData.error || 'Error en la búsqueda');
    }
    
    const data = await res.json();
    
    console.log('[AUDIT SEARCH RESPONSE] Recibidos', data.results?.length || 0, 'registros');
    
    if (!data || !data.results) {
      showToast('Error: Respuesta inválida del servidor', 'error');
      containerEl.innerHTML = '<p style="text-align:center;color:#dc2626;padding:20px">Error en la búsqueda</p>';
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
            <th>Acción</th>
            <th>Usuario</th>
            <th>Admin</th>
            <th>Cambios</th>
          </tr>
        </thead>
        <tbody id="bodyAuditoriaTemporary">
        </tbody>
      </table>
    `;

    // Usar setupPagination para renderizar con paginación
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
    showToast('Error buscando auditoría: ' + e.message, 'error');
    const containerEl = document.getElementById('busquedaResultados');
    if (containerEl) {
      containerEl.innerHTML = `<p style="text-align:center;color:#dc2626;padding:20px">Error: ${escapeHtml(e.message)}</p>`;
    }
  }
}

/**
 * Renderiza una fila de auditoría en la tabla
 */
function renderAuditoriaRow(tbody, r) {
  const tr = document.createElement('tr');
  
  const iconos = {
    'CREAR': '✨',
    'ACTUALIZAR': '✏️',
    'ELIMINAR': '🗑️',
    'ACTIVAR': '🟢',
    'DESACTIVAR': '🔴',
    'RESET_PASSWORD': '🔑',
    'LOGIN': '🔓',
    'LOGOUT': '🔒'
  };
  
  const icon = iconos[r.accion] || '•';
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
    
    // Si no hay propiedades, retornar vacío
    if (!cambios || Object.keys(cambios).length === 0) {
      return '<span style="color:#999">Sin cambios</span>';
    }
    
    let html = '';
    for (const [field, changes] of Object.entries(cambios)) {
      if (changes && typeof changes === 'object') {
        const antes = escapeHtml(String(changes.antes || ''));
        const despues = escapeHtml(String(changes.despues || ''));
        html += `<div style="font-size:0.8rem;margin:4px 0;padding:4px;background:#f5f5f5;border-radius:3px"><strong>${escapeHtml(field)}:</strong> <span style="color:#999">${antes}</span> → <span style="color:#0369a1">${despues}</span></div>`;
      }
    }
    
    return html || '<span style="color:#999">Sin cambios</span>';
    
  } catch (e) {
    console.error('[AUDIT] Error formateando cambios:', e.message);
    return '<span style="color:#dc2626">Error al formatear</span>';
  }
}

function limpiarFiltrosAuditoria() {
  console.log('[AUDIT] Limpiando filtros de auditoría');
  
  try {
    const filtroAccion = document.getElementById('filtroAccion');
    const filtroDesde = document.getElementById('filtroDesde');
    const filtroHasta = document.getElementById('filtroHasta');
    
    if (filtroAccion) {
      filtroAccion.value = '';
      console.log('[AUDIT] Filter Acción limpio');
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
    
    console.log('[AUDIT] Esperando para ejecutar búsqueda...');
    // Cargar últimos registros por defecto después de un pequeño delay
    setTimeout(() => {
      console.log('[AUDIT] Ejecutando búsqueda después de limpiar filtros');
      buscarAuditoria();
    }, 200);
    
  } catch (e) {
    console.error('[AUDIT] Error limpiando filtros:', e.message);
    showToast('Error limpiando filtros: ' + e.message, 'error');
  }
}

function exportarAuditoriaCSV() {
  try {
    console.log('[AUDIT EXPORT] Iniciando exportación a CSV');
    
    const results = window.ultimosBusquedasAuditoria || [];
    if (results.length === 0) {
      showToast('No hay datos para exportar (ejecuta una búsqueda primero)', 'warning');
      return;
    }
    
    console.log('[AUDIT EXPORT] Exportando', results.length, 'registros');
    
    // Headers del CSV
    const headers = ['Fecha', 'Acción', 'Usuario Afectado', 'Admin', 'Cambios'];
    let csv = headers.join(',') + '\n';
    
    // Datos
    results.forEach(r => {
      const fecha = new Date(r.fecha_cambio).toLocaleString('es-CO');
      const usuario = (r.usuario || '-').replace(/"/g, '""').replace(/,/g, ' ');
      const admin = (r.usuario_admin || '-').replace(/"/g, '""').replace(/,/g, ' ');
      
      // Serializar cambios de manera más legible
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
    
    console.log('[AUDIT EXPORT] CSV generado, tamaño:', csv.length);
    
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
    
    showToast('Auditoría exportada a CSV - ' + results.length + ' registros', 'success');
    console.log('[AUDIT EXPORT] Exportación completada');
    
  } catch (e) {
    console.error('[AUDIT EXPORT ERROR]', e.message);
    showToast('Error exportando auditoría: ' + e.message, 'error');
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
  
  const rolesValidos = ['admin','recepcion','electro','doctor','contabilidad'];
  if (!rolesValidos.includes(rol)) {
    mostrarErrorEdicion('Rol inválido');
    return;
  }
  
  const body = { nombre, rol };
  
  // Si el nuevo rol es doctor, pedir el número de consultorio
  if (rol === 'doctor') {
    const consultorio = $('editConsultorio').value.trim();
    if (!consultorio) {
      mostrarErrorEdicion('Consultorio es requerido para DOCTOR');
      return;
    }
    const numero = parseInt(consultorio, 10);
    if (isNaN(numero) || numero < 1) {
      mostrarErrorEdicion('Consultorio debe ser un número válido');
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
  
  // Validar campos vacíos
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

  // Validar contraseña
  const passwordValidation = validatePasswordStrength(password);
  if (!passwordValidation.isValid) {
    const mensaje = passwordValidation.issues.length > 0 
      ? 'Contraseña incompleta: ' + passwordValidation.issues.map(i => {
          const labels = { length: '8+ caracteres', upper: 'mayúscula', lower: 'minúscula', number: 'número', special: 'símbolo' };
          return labels[i];
        }).join(', ')
      : 'Contraseña no válida';
    showToast(mensaje, 'error');
    return;
  }
  
  if (rol === 'doctor') {
    const consultorioValue = $('newUserConsultorio').value.trim();
    if (!consultorioValue) {
      showToast('El número de consultorio es obligatorio para DOCTOR', 'error');
      return;
    }
    numero_consultorio = parseInt(consultorioValue, 10);
    if (isNaN(numero_consultorio) || numero_consultorio < 1) {
      showToast('El número de consultorio debe ser un número válido', 'error');
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
      // Error con detalles de validación
      showToast(data.details[0] || data.error || 'Error', 'error');
    } else {
      showToast(data.error || 'Error al crear usuario', 'error');
    }
  } catch (e) { showToast('Error de conexión', 'error'); }
}

function formatMoney(n){ 
  const formatted = Number(n||0).toFixed(2);
  return '$ ' + formatted.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// Devuelve los tipos de consulta cacheados para el médico actualmente seleccionado.
// La BD es la única fuente de verdad; _reciboCurrentTipos se llena en cargarTiposConsultaEnRecibo.
function _getTiposParaDoctor(medicoId) {
  if (Array.isArray(window._reciboCurrentTipos) && window._reciboCurrentTipos.length > 0) {
    return window._reciboCurrentTipos;
  }
  return []; // sin caché → se esperará a que cargarTiposConsultaEnRecibo finalice
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
      // _reciboCurrentTipos vacío con médico seleccionado: cargar y dejar que ese método llame refreshConceptosRows de nuevo
      await cargarTiposConsultaEnRecibo(medicoId);
      return;
    }
    // si no hay médico aún, opciones queda vacío (se mostrará solo el placeholder)
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
    // Si no hay tipos aún y hay médico, dispara la carga asincrónica
    if (opciones.length === 0 && medicoId) {
      cargarTiposConsultaEnRecibo(medicoId); // no await: actualizará la fila cuando termine
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
    <td><button class="remove" type="button">✕</button></td>
  `;
  tbody.appendChild(tr);
  
  // Event listener para el input de precio con formateo de miles
  const priceInput = tr.querySelector('.item-price');
  priceInput.addEventListener('input', function(){
    // Remover caracteres que no sean dígitos o punto decimal
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
  
  // Event listener para el select de descripción
  const descSelect_el = tr.querySelector('.item-desc');
  descSelect_el.addEventListener('change', function(){
    const valor = this.value;
    if(valor === 'custom') {
      // Reemplazar select con input de texto personalizado
      const customDescInput = `<input class="item-desc-custom" type="text" placeholder="Descripción personalizada" style="width:100%;padding:4px;border:1px solid #ccc;box-sizing:border-box" />`;
      tr.querySelector('td:first-child').innerHTML = customDescInput;
      tr.querySelector('.item-desc-custom').focus();
      // Dejar que el usuario ingrese la descripción, el precio lo puede editar directamente en la columna de precio
    } else if(valor) {
      // Ya NO asignamos el precio automáticamente
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
    // Remover comas antes de convertir a número
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
  const medicoNombre = (reciboTipo === 'doctor' && medicoSel && medicoSel.value) ? (medicoSel.options[medicoSel.selectedIndex]?.text || null) : null;

  const consultaSel = $('reciboTipoConsulta');
  const tipoConsulta = (reciboTipo === 'doctor' && consultaSel && consultaSel.value) ? consultaSel.value : null;

  const servSel = $('reciboTipoServicio');
  const tipoEstudio = (reciboTipo === 'estudio' && servSel && servSel.value) ? servSel.value : null;

  // tipoServicio unificado para guardar en BD.
  // Fallback: si ningún selector tiene valor, usar la descripción del primer ítem.
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
    showToast('Selecciona el médico que realizó la consulta', 'error'); return false;
  }
  // Para 'estudio' no se valida reciboTipoServicio (está oculto);
  // el servicio se elige directamente en los conceptos del cobro.

  const items = document.querySelectorAll('#itemsTable tbody tr');
  let hayItemValido = false;
  items.forEach(r => {
    const descEl = r.querySelector('.item-desc-custom') || r.querySelector('.item-desc');
    const priceValue = r.querySelector('.item-price')?.value || '0';
    const price = Number(priceValue.replace(/,/g, ''));
    if (descEl?.value.trim() && price > 0) hayItemValido = true;
  });
  if (!hayItemValido) { showToast('Agrega al menos un concepto con descripción y valor', 'error'); return false; }
  return true;
}

async function saveToDatabase(){
  const payload = collectFormData();
  try {
    const body = {
      // numero no se envía: el servidor lo asigna atómicamente
      cliente: payload.cliente,
      fecha: payload.fecha,
      total: payload.total,
      data: payload,
      tipo_pago: payload.tipoPago || null,
      nombre_entidad: payload.nombreEntidad || null,
      medico_id: payload.medicoId || null,
      medico_nombre: payload.medicoNombre || null,
      tipo_servicio: payload.tipoServicio || null,
      turno_id: payload.turnoId ? parseInt(payload.turnoId, 10) : null,
      cita_electro_id: payload.citaElectroId ? parseInt(payload.citaElectroId, 10) : null,
      observaciones: payload.observ || null
    };
    const res = await apiFetch('/api/recibos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const json = await res.json();
    if (json.ok) {
      // Actualizar el número con el asignado realmente por el servidor (evita duplicados concurrentes)
      if (json.numero) {
        $('numero').value = json.numero;
        const rNum = document.getElementById('r_num');
        if (rNum) rNum.textContent = json.numero;
      }
      showToast('✓ Recibo guardado', 'success');
      updateSavedCount();
      nextNumber();
      cargarFiltrosUsuarios();
    } else {
      showToast('Error guardando: ' + (json.error || 'desconocido'), 'error');
    }
  } catch(e) {
    console.error(e);
    showToast('Error de conexión al guardar recibo', 'error');
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

  // Limpiar médico, tipo de consulta y estudio
  document.querySelectorAll('input[name="reciboTipo"]').forEach(r => { r.checked = false; });
  document.getElementById('reciboTipoDocCard')?.classList.remove('selected');
  document.getElementById('reciboTipoEstCard')?.classList.remove('selected');
  document.getElementById('reciboTipoDocPanel')?.classList.add('hidden');
  document.getElementById('reciboTipoEstPanel')?.classList.add('hidden');
  if ($('reciboMedico')) $('reciboMedico').value = '';
  if ($('reciboTipoConsulta')) $('reciboTipoConsulta').innerHTML = '<option value="">Seleccionar tipo</option>';
  if ($('reciboTipoServicio')) $('reciboTipoServicio').value = '';

  // Limpiar vinculación
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
    // Abrir el recibo con el ID más alto (el más reciente)
    let lastRecibo = arr[0];
    arr.forEach(r => {
      if(r.id > lastRecibo.id) {
        lastRecibo = r;
      }
    });
    lastReciboId = lastRecibo.id;
    
    const pdfWindow = window.open(`/api/recibos/${lastRecibo.id}/pdf`, '_blank');
    if (!pdfWindow) {
      showToast('El navegador bloqueó la ventana emergente. Permite los popups para este sitio y vuelve a intentarlo.', 'warn');
      return;
    }
  } catch(e){
    showToast('Error al generar PDF', 'error');
  } finally {
    showLoader(false);
  }
}

// descargarPDFAnterior removed — #downloadPDF button no longer exists in the new Recibos UI

// ---- Filtros activos para exportación ----
let _recibosLastParams = '';

async function aplicarFiltrosRecibos() {
  const desde = $('filtroFechaDesde')?.value || '';
  const hasta = $('filtroFechaHasta')?.value || '';
  const tipoPago = $('filtroTipoPago')?.value || '';
  const medicoId = $('filtroMedico')?.value || '';
  const genPor = $('filtroGeneradoPor')?.value || '';

  const params = new URLSearchParams();
  if (desde) params.set('fecha_desde', desde);
  if (hasta) params.set('fecha_hasta', hasta);
  if (tipoPago) params.set('tipo_pago', tipoPago);
  if (medicoId) params.set('medico_id', medicoId);
  if (genPor) params.set('generado_por_id', genPor);
  _recibosLastParams = params.toString();

  await cargarLista(_recibosLastParams);
}

function limpiarFiltrosRecibos() {
  if ($('filtroFechaDesde')) $('filtroFechaDesde').value = '';
  if ($('filtroFechaHasta')) $('filtroFechaHasta').value = '';
  if ($('filtroTipoPago')) $('filtroTipoPago').value = '';
  if ($('filtroMedico')) $('filtroMedico').value = '';
  if ($('filtroGeneradoPor')) $('filtroGeneradoPor').value = '';
  _recibosLastParams = '';
  const tbody = document.getElementById('savedItems');
  if (tbody) tbody.innerHTML = '<tr><td colspan="10"><div class="empty-state"><div class="empty-state-icon">📋</div><p class="empty-state-title">Aplica un filtro para ver los recibos</p></div></td></tr>';
  document.getElementById('reciboResumenCard')?.classList.add('hidden');
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
  try {
    const url = '/api/recibos' + (queryString ? '?' + queryString : '');
    const res = await apiFetch(url);
    if (!res.ok) {
      if (res.status === 401) { /* handled by apiFetch */ return; }
      else showToast('Error al cargar recibos', 'error');
      updateStats([]);
      return;
    }
    const recibos = await res.json();
    updateStats(Array.isArray(recibos) ? recibos : []);
    const tbody = document.getElementById('savedItems');
    if (!tbody) return;
    tbody.innerHTML = '';

    const resumenCard = document.getElementById('reciboResumenCard');

    if (!recibos || !recibos.length) {
      tbody.innerHTML = '<tr><td colspan="10"><div class="empty-state"><div class="empty-state-icon">📋</div><p class="empty-state-title">Sin resultados</p><p class="empty-state-subtitle">No hay recibos con los filtros aplicados</p></div></td></tr>';
      if (resumenCard) resumenCard.classList.add('hidden');
      return;
    }

    // Resumen
    const totalMonto = recibos.reduce((s, r) => s + Number(r.total||0), 0);
    if ($('resumenCantidad')) $('resumenCantidad').textContent = recibos.length;
    if ($('resumenTotal')) $('resumenTotal').textContent = '$ ' + totalMonto.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (resumenCard) resumenCard.classList.remove('hidden');

    recibos.forEach((r, idx) => {
      const tr = document.createElement('tr');
      if (idx % 2 === 0) tr.style.background = '#f9fafb';
      const fecha = r.fecha ? String(r.fecha).slice(0,10) : '-';
      const total = Number(r.total||0).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const deleteBtn = canDeleteRecibos()
        ? `<button class="delete btn-danger btn-sm" data-id="${r.id}">✕</button>` : '';
      tr.innerHTML = `
        <td style="padding:10px 12px">${escapeHtml(r.numero||'-')}</td>
        <td style="padding:10px 12px">${escapeHtml(fecha)}</td>
        <td style="padding:10px 12px">${escapeHtml(r.cliente||'-')}</td>
        <td style="padding:10px 12px">
          <span style="font-size:0.8rem;padding:2px 8px;border-radius:99px;${r.tipo_pago==='Particular'?'background:#fef9c3;color:#92400e':r.tipo_pago?'background:#dbeafe;color:#1e40af':'background:#f3f4f6;color:#6b7280'}">
            ${escapeHtml(r.tipo_pago||'-')}
          </span>
        </td>
        <td style="padding:10px 12px">${escapeHtml(r.nombre_entidad||'-')}</td>
        <td style="padding:10px 12px">${escapeHtml(r.medico_nombre||'-')}</td>
        <td style="padding:10px 12px">${escapeHtml(r.tipo_servicio||'-')}</td>
        <td style="padding:10px 12px;text-align:right;font-weight:600;color:#2d4a47">$ ${escapeHtml(total)}</td>
        <td style="padding:10px 12px">${escapeHtml(r.generado_por_nombre||'-')}</td>
        <td style="padding:10px 12px;text-align:center;white-space:nowrap">
          <a href="/api/recibos/${r.id}/pdf" target="_blank" class="btn-success btn-sm" style="text-decoration:none">PDF</a>
          ${deleteBtn}
        </td>`;
      tbody.appendChild(tr);
    });

    tbody.querySelectorAll('.delete').forEach(b => b.addEventListener('click', e => {
      showConfirm('¿Eliminar este recibo?', async () => {
        try {
          const jr = await apiFetch(`/api/recibos/${e.target.dataset.id}`, { method: 'DELETE' }).then(r => r.json());
          if (jr.ok) { showToast('Recibo eliminado', 'success'); cargarLista(_recibosLastParams); }
        } catch (_) { showToast('Error eliminando recibo', 'error'); }
      });
    }));
  } catch(e) {
    console.error(e);
    showToast('Error cargando lista', 'error');
  }
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
  showConfirm('¿Eliminar TODOS los recibos guardados?\nEsta acción no se puede deshacer.\nSolo los administradores pueden realizar esta operación.', async () => {
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
  }, { okText: 'Eliminar todo', icon: '🗑️' });
}

// (setDefaultReportDates, generarReporteDiario, generarReporteMensual eliminados — reemplazados por filtros en Ver Recibos)

// ============================================
// GESTIONAR CUENTA — Mi Cuenta
// ============================================
const MC_ROL_LABELS = {
  admin: 'Administrador', recepcion: 'Recepción', electro: 'Electro',
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
    if ($('mcHeaderName')) $('mcHeaderName').textContent = d.nombre || d.usuario || '—';
    if ($('mcHeaderAt'))   $('mcHeaderAt').textContent   = '@' + (d.usuario || '');
    if ($('mcRolBadge'))   $('mcRolBadge').textContent   = MC_ROL_LABELS[d.rol] || d.rol || '—';

    // Info cards
    if ($('mcInfoUsuario')) $('mcInfoUsuario').textContent = '@' + (d.usuario || '—');
    if ($('mcInfoRol'))     $('mcInfoRol').textContent     = MC_ROL_LABELS[d.rol] || d.rol || '—';

    // Especialidad / consultorio — solo doctores
    const espCard = $('mcInfoEspCard'), consCard = $('mcInfoConsCard');
    if (d.rol === 'doctor') {
      if (espCard)  { espCard.style.display  = ''; if ($('mcInfoEspecialidad')) $('mcInfoEspecialidad').textContent = d.especialidad || '—'; }
      if (consCard) { consCard.style.display = ''; if ($('mcInfoConsultorio'))  $('mcInfoConsultorio').textContent  = d.numero_consultorio ? 'N° ' + d.numero_consultorio : '—'; }
    } else {
      if (espCard)  espCard.style.display  = 'none';
      if (consCard) consCard.style.display = 'none';
    }

    // Fechas formateadas
    const fmtDate = (iso) => {
      if (!iso) return '—';
      const dt = new Date(iso), hoy = new Date();
      if (dt.toDateString() === hoy.toDateString())
        return 'Hoy ' + dt.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
      return dt.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
    };
    if ($('mcInfoCreado')) $('mcInfoCreado').textContent = fmtDate(d.creado_en);
    if ($('mcInfoAcceso')) $('mcInfoAcceso').textContent = d.ultimo_acceso ? fmtDate(d.ultimo_acceso) : 'Esta sesión';

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

  // ── Mi Cuenta: cerrar, cancelar, tabs ───────────────────────────────────────────
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

  // ── Formulario: cambiar nombre ──────────────────────────────────────────────
  const formNombre = $('formCambiarNombre');
  if (formNombre) {
    formNombre.addEventListener('submit', async (e) => {
      e.preventDefault();
      const nombre = $('cuentaNombreActual')?.value.trim() || '';
      const errDiv = $('cambiarNombreError');
      const showErr = (msg) => { if (errDiv) { errDiv.textContent = msg; errDiv.classList.remove('hidden'); } };
      if (!nombre) return showErr('El nombre no puede estar vacío');

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
      } catch (_) { showErr('Error de conexión'); }
      finally { setLoading(btn, false); }
    });
  }

  // ── Formulario: cambiar contraseña ───────────────────────────────────────────
  const formPwd = $('formCambiarContrasena');
  if (formPwd) {
    formPwd.addEventListener('submit', async (e) => {
      e.preventDefault();
      const contrasenaActual    = $('contrasenaActual')?.value    || '';
      const nuevaContrasena     = $('nuevaContrasena')?.value     || '';
      const confirmarContrasena = $('confirmarContrasena')?.value || '';
      const errDiv = $('cambiarContrasenaError');
      const showErr = (msg) => { if (errDiv) { errDiv.textContent = msg; errDiv.classList.remove('hidden'); } };

      if (!contrasenaActual)  return showErr('Ingresa tu contraseña actual');
      if (!nuevaContrasena)   return showErr('Ingresa la nueva contraseña');
      if (!confirmarContrasena) return showErr('Confirma la nueva contraseña');
      if (nuevaContrasena !== confirmarContrasena) return showErr('Las contraseñas no coinciden');
      if (nuevaContrasena.length < 6) return showErr('La contraseña debe tener al menos 6 caracteres');

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
        if (!res.ok) return showErr(data.error || 'Error al actualizar contraseña');
        showToast('Contraseña actualizada correctamente', 'success');
        formPwd.reset();
        if ($('cambiarContrasenaRequirements')) $('cambiarContrasenaRequirements').style.display = 'none';
        if (errDiv) errDiv.classList.add('hidden');
      } catch (_) { showErr('Error de conexión'); }
      finally { setLoading(btn, false); }
    });
  }

  // ── Toggle contraseñas (Mi Cuenta) ───────────────────────────────────────────
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

  // ── Requisitos de contraseña en tiempo real ─────────────────────────────────
  const pwdInput = $('nuevaContrasena'), reqBox = $('cambiarContrasenaRequirements');
  if (pwdInput && reqBox) {
    pwdInput.addEventListener('input', () => {
      const p = pwdInput.value;
      reqBox.style.display = p ? 'block' : 'none';
      if (p) {
        updateRequirementItem('cambiar-req-length', p.length >= 8,   'Mínimo 8 caracteres');
        updateRequirementItem('cambiar-req-upper',  /[A-Z]/.test(p), 'Al menos una mayúscula (A-Z)');
        updateRequirementItem('cambiar-req-lower',  /[a-z]/.test(p), 'Al menos una minúscula (a-z)');
        updateRequirementItem('cambiar-req-number', /[0-9]/.test(p), 'Al menos un número (0-9)');
      }
    });
  }

  // ── Modal Editar Usuario ─────────────────────────────────────────────────────
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

  // ── Modal Historial ─────────────────────────────────────────────────────────────
  const modalHistorial = $('modalHistorial');
  if (modalHistorial) {
    modalHistorial.querySelector('button.btn-close-modal')?.addEventListener('click', closeHistorialModal);
    modalHistorial.querySelectorAll('button[type="button"]').forEach(btn => {
      if (btn.textContent.includes('Cerrar')) btn.addEventListener('click', closeHistorialModal);
    });
  }

  // ── Modal Reset Password ─────────────────────────────────────────────────────
  const modalResetPassword = $('modalResetPassword');
  if (modalResetPassword) {
    modalResetPassword.querySelector('button.btn-close-modal')?.addEventListener('click', closeResetPasswordModal);
    modalResetPassword.querySelectorAll('button[type="button"]').forEach(btn => {
      if (btn.textContent.includes('Entendido')) btn.addEventListener('click', closeResetPasswordModal);
    });
  }
});


// ========== GESTIÓN DE DIAGNÓSTICOS (solo admin) ==========
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

    const res = await fetch('/api/diagnosticos/import-excel', {
      method: 'POST',
      body: formData,
      credentials: 'include'
    });

    progressBar.style.width = '70%';
    const data = await res.json();

    if (!res.ok) {
      progressDiv.style.display = 'none';
      showToast(data.error || 'Error importando diagnósticos', 'error');
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
      if (tbody) tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state"><div class="empty-state-icon">💬</div><p class="empty-state-title">Sin diagnósticos</p><p class="empty-state-subtitle">No hay diagnósticos cargados en el sistema</p></div></td></tr>';
      return;
    }

    // Usar setupPagination para renderizar con paginación
    setupPagination('diagnosticos', diagnosticos, renderDiagnosticoRow, {
      itemsPerPageDefault: 20,
      tbodyId: 'diagnosticosTableBody',
      containerSelector: '#diagnosticosTableControls'
    });
  } catch (e) {
    console.error('Error cargando diagnósticos:', e);
    if (tbody) tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state"><div class="empty-state-icon">⚠️</div><p class="empty-state-title" style="color:#dc2626">Error cargando diagnósticos</p></div></td></tr>';
  }
}

/**
 * Renderiza una fila de diagnóstico en la tabla
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
    showConfirm('¿Eliminar este diagnóstico?', async () => {
      try {
        await apiFetch(`/api/diagnosticos/${id}`, { method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({activo: 0}) });
        showToast('Diagnóstico eliminado', 'success');
        cargarListaDiagnosticos();
      } catch (x) {
        showToast('Error eliminando diagnóstico', 'error');
      }
    });
  });
  
  tbody.appendChild(tr);
}

// ========== FUNCIONES DEL MODAL DE DETALLES DE CITA ELECTRODIAGNÓSTICO ==========
async function iniciarEstudioModal() {
  if (!citaElectroSeleccionada) return;
  
  // VALIDACIÓN: Verificar que ya haya llegado la hora de agendamiento
  const ahora = new Date();
  const horaActualHH = String(ahora.getHours()).padStart(2, '0');
  const horaActualMM = String(ahora.getMinutes()).padStart(2, '0');
  const horaActual = `${horaActualHH}:${horaActualMM}`;
  
  const horaAgendada = citaElectroSeleccionada.hora_agendamiento || '';
  
  // Validar que la hora actual sea >= a la hora agendada
  if (horaActual < horaAgendada) {
    const faltanMinutos = Math.ceil((new Date(`2000-01-01 ${horaAgendada}`) - new Date(`2000-01-01 ${horaActual}`)) / 60000);
    showToast(`❌ El estudio está agendado para las ${horaAgendada}. Faltan ${faltanMinutos} minutos para poder iniciarlo.`, 'error');
    return;
  }
  
  // Mostrar modal de confirmación
  abrirModalConfirmarDuracion();
}

async function finalizarEstudioModal() {
  if (!citaElectroSeleccionada) return;
  
  // Mostrar modal de confirmación
  const modal = $('modalConfirmarFinalizarEstudio');
  if (modal) {
    modal.classList.remove('hidden');
  }
}

async function confirmarFinalizarEstudio() {
  if (!citaElectroSeleccionada) return;
  
  // Cerrar modal de confirmación
  const modal = $('modalConfirmarFinalizarEstudio');
  if (modal) {
    modal.classList.add('hidden');
  }
  
  try {
    const ahora = new Date();
    const hh = String(ahora.getHours()).padStart(2, '0');
    const mm = String(ahora.getMinutes()).padStart(2, '0');
    const horaActual = `${hh}:${mm}`;
    
    const cambios = {
      estado: 'Completado',
      hora_fin: horaActual
    };
    
    // Actualizar en la base de datos
    const res = await apiFetch(`/api/citas-electro/${citaElectroSeleccionada.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cambios)
    });
    
    const data = await res.json();
    
    if (data && data.ok) {
      showToast(`Estudio finalizado a las ${horaActual}`, 'success');
      
      // Actualizar el objeto de la cita localmente
      citaElectroSeleccionada.estado = 'Completado';
      citaElectroSeleccionada.hora_fin = horaActual;
      
      // Habilitar el select de estado ahora que se cambió a "Completado"
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
      
      // El servidor también emitirá el socket event
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

// ===== FUNCIONES PARA DURACIÓN DEL ESTUDIO =====

function abrirModalConfirmarDuracion() {
  console.log('[DURACION] Abriendo modal de confirmación');
  const modal = $('modalConfirmarDuracion');
  if (modal) {
    modal.classList.remove('hidden');
  }
}

function cerrarModalConfirmarDuracion() {
  console.log('[DURACION] Cerrando modal de confirmación');
  const modal = $('modalConfirmarDuracion');
  if (modal) {
    modal.classList.add('hidden');
  }
}

function abrirModalDuracionEstudio() {
  console.log('[DURACION] Abriendo modal de duración');
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
    
    // Duración predeterminada HH:MM desde duracion_minutos de la cita
    const durPredMin = (citaElectroSeleccionada && citaElectroSeleccionada.duracion_minutos)
      ? citaElectroSeleccionada.duracion_minutos
      : (selectedEstudioDuracion || 480);
    $('durEstudioHH').value = Math.floor(durPredMin / 60);
    $('durEstudioMM').value = durPredMin % 60;
    
    actualizarHoraFinCalculada();
  }
}

function cerrarModalDuracionEstudio() {
  console.log('[DURACION] Cerrando modal de duración');
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
  const minutosInicio = hhI * 60 + mmI;
  const duracionMinutos = hhDur * 60 + mmDur;
  let minutosFin = minutosInicio + duracionMinutos;
  
  const cruceMedianoche = minutosFin >= 24 * 60;
  if (cruceMedianoche) minutosFin -= 24 * 60;
  
  const hhFin = String(Math.floor(minutosFin / 60)).padStart(2, '0');
  const mmFin = String(minutosFin % 60).padStart(2, '0');
  
  if (display) {
    display.textContent = `${hhFin}:${mmFin}${cruceMedianoche ? ' (+1 día)' : ''}`;
  }
}

// Alias para compatibilidad con cualquier referencia vieja
function actualizarDuracionMostrada() { actualizarHoraFinCalculada(); }

async function confirmarDuracionEstudio() {
  console.log('[DURACION] Confirmando duración del estudio');
  
  if (!citaElectroSeleccionada) {
    showToast('Error: No hay cita seleccionada', 'error');
    return;
  }
  
  // VALIDACIÓN: Verificar que ya haya llegado la hora de agendamiento
  const ahora = new Date();
  const horaActualHH = String(ahora.getHours()).padStart(2, '0');
  const horaActualMM = String(ahora.getMinutes()).padStart(2, '0');
  const horaActual = `${horaActualHH}:${horaActualMM}`;
  
  const horaAgendada = citaElectroSeleccionada.hora_agendamiento || '';
  
  // Validar que la hora actual sea >= a la hora agendada
  if (horaActual < horaAgendada) {
    const faltanMinutos = Math.ceil((new Date(`2000-01-01 ${horaAgendada}`) - new Date(`2000-01-01 ${horaActual}`)) / 60000);
    showToast(`❌ El estudio está agendado para las ${horaAgendada}. Faltan ${faltanMinutos} minutos para poder iniciarlo.`, 'error');
    return;
  }
  
  // VALIDAR QUE SE HAYA SELECCIONADO UN EQUIPO
  const equipoSelect = $('modalEquipo');
  if (!equipoSelect || !equipoSelect.value) {
    showToast('❌ Debes seleccionar un equipo antes de iniciar el estudio', 'error');
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
      showToast('Ingresa una duración válida (HH y/o MM)', 'error');
      return;
    }
    
    // Calcular hora_fin a partir de inicio + duración
    const [hhI, mmI] = horaInicio.split(':').map(Number);
    let minutosFin = hhI * 60 + mmI + duracionMinutos;
    let cruceMedianoche = false;
    if (minutosFin >= 24 * 60) { minutosFin -= 24 * 60; cruceMedianoche = true; }
    const horaFin = `${String(Math.floor(minutosFin / 60)).padStart(2,'0')}:${String(minutosFin % 60).padStart(2,'0')}`;
    
    console.log(`[DURACION] Iniciando estudio: ${horaInicio} → ${horaFin} (${duracionMinutos} min${cruceMedianoche ? ', cruza medianoche' : ''})`);
    
    const equipoId = equipoSelect.value;
    const cambios = {
      estado: 'En Estudio',
      hora_inicio: horaInicio,
      hora_fin: horaFin,
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
    console.log('[DURACION] Respuesta del servidor:', data);
    
    if (data && data.ok) {
      showToast(`Estudio iniciado: ${horaInicio} - ${horaFin}`, 'success');
      
      // Actualizar el objeto de la cita localmente
      citaElectroSeleccionada.estado = 'En Estudio';
      citaElectroSeleccionada.hora_inicio = horaInicio;
      citaElectroSeleccionada.hora_fin = horaFin;
      
      // BLOQUEAR el select de estado mientras está en "En Estudio"
      const selectEstado = $('modalEstado');
      if (selectEstado) {
        selectEstado.disabled = true;
        selectEstado.style.opacity = '0.5';
        selectEstado.style.cursor = 'not-allowed';
        selectEstado.value = 'En Estudio';
        console.log('[DURACION] Select bloqueado - estado "En Estudio"');
      }
      
      // BLOQUEAR el menú de "Más opciones" mientras está en "En Estudio"
      const btnMasOpciones = $('btnMasOpciones');
      const menuMasOpciones = $('menuMasOpciones');
      if (btnMasOpciones) {
        btnMasOpciones.disabled = true;
        btnMasOpciones.style.opacity = '0.5';
        btnMasOpciones.style.cursor = 'not-allowed';
        if (menuMasOpciones) menuMasOpciones.style.display = 'none';
        console.log('[DURACION] Menú bloqueado - estado "En Estudio"');
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
      
      // El servidor también emitirá el socket event
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
  console.log('[DURACION] Iniciando estudio sin duración personalizada');
  
  if (!citaElectroSeleccionada) return;
  
  // VALIDACIÓN: Verificar que ya haya llegado la hora de agendamiento
  const ahora = new Date();
  const horaActualHH = String(ahora.getHours()).padStart(2, '0');
  const horaActualMM = String(ahora.getMinutes()).padStart(2, '0');
  const horaActual = `${horaActualHH}:${horaActualMM}`;
  
  const horaAgendada = citaElectroSeleccionada.hora_agendamiento || '';
  
  // Validar que la hora actual sea >= a la hora agendada
  if (horaActual < horaAgendada) {
    const faltanMinutos = Math.ceil((new Date(`2000-01-01 ${horaAgendada}`) - new Date(`2000-01-01 ${horaActual}`)) / 60000);
    showToast(`❌ El estudio está agendado para las ${horaAgendada}. Faltan ${faltanMinutos} minutos para poder iniciarlo.`, 'error');
    return;
  }
  
  // VALIDAR QUE SE HAYA SELECCIONADO UN EQUIPO
  const equipoSelect = $('modalEquipo');
  if (!equipoSelect || !equipoSelect.value) {
    showToast('❌ Debes seleccionar un equipo antes de iniciar el estudio', 'error');
    return;
  }
  
  try {
    // Obtener la duración predeterminada de la cita (en minutos)
    const duracionMinutos = citaElectroSeleccionada.duracion_minutos || 480; // 480 minutos = 8 horas por defecto
    
    console.log(`[DURACION_SIN] Usando duración predeterminada: ${duracionMinutos} minutos`);
    
    // Calcular hora_fin: hora_agendada + duracionMinutos (el inicio es la hora programada, no la actual)
    const horaInicio = horaAgendada;
    const [hh_inicio, mm_inicio] = horaInicio.split(':').map(Number);
    let minutosInicio = hh_inicio * 60 + mm_inicio;
    let minutosFin = minutosInicio + duracionMinutos;
    
    // Manejar si cruza medianoche
    let crucedaMedianoche = false;
    if (minutosFin >= 24 * 60) {
      minutosFin -= 24 * 60;
      crucedaMedianoche = true;
    }
    
    const hh_fin = Math.floor(minutosFin / 60);
    const mm_fin = minutosFin % 60;
    const horaFin = `${String(hh_fin).padStart(2, '0')}:${String(mm_fin).padStart(2, '0')}`;
    
    console.log(`[DURACION_SIN] Hora inicio: ${horaInicio}, Hora fin: ${horaFin} (${crucedaMedianoche ? 'cruza medianoche' : 'mismo día'})`);
    
    const equipoId = equipoSelect.value;
    const cambios = {
      estado: 'En Estudio',
      hora_inicio: horaInicio,
      hora_fin: horaFin,
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
      
      showToast(`Estudio iniciado a las ${horaInicio} (duración: ${textoHora})`, 'success');
      
      // Actualizar el objeto de la cita localmente
      citaElectroSeleccionada.estado = 'En Estudio';
      citaElectroSeleccionada.hora_inicio = horaInicio;
      citaElectroSeleccionada.hora_fin = horaFin;
      citaElectroSeleccionada.duracion_minutos = duracionMinutos;
      
      // BLOQUEAR el select de estado mientras está en "En Estudio"
      const selectEstado = $('modalEstado');
      if (selectEstado) {
        selectEstado.disabled = true;
        selectEstado.style.opacity = '0.5';
        selectEstado.style.cursor = 'not-allowed';
        selectEstado.value = 'En Estudio';
        console.log('[DURACION_SIN] Select bloqueado - estado "En Estudio"');
      }
      
      // BLOQUEAR el menú de "Más opciones" mientras está en "En Estudio"
      const btnMasOpciones = $('btnMasOpciones');
      const menuMasOpciones = $('menuMasOpciones');
      if (btnMasOpciones) {
        btnMasOpciones.disabled = true;
        btnMasOpciones.style.opacity = '0.5';
        btnMasOpciones.style.cursor = 'not-allowed';
        if (menuMasOpciones) menuMasOpciones.style.display = 'none';
        console.log('[DURACION_SIN] Menú bloqueado - estado "En Estudio"');
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

// Función para actualizar progreso del estudio en tiempo real
function actualizarProgresoEstudio() {
  if (!citaElectroSeleccionada || citaElectroSeleccionada.estado !== 'En Estudio') {
    return;
  }
  
  // Detener intervalo anterior si existe
  if (intervaloProgreso) {
    clearInterval(intervaloProgreso);
    intervaloProgreso = null;
  }
  
  // Convertir horas a segundos desde medianoche
  const horaInicio = citaElectroSeleccionada.hora_inicio; // "HH:MM"
  const horaFin = citaElectroSeleccionada.hora_fin; // "HH:MM"
  
  if (!horaInicio || !horaFin) {
    console.log('[PROGRESO] Horas no disponibles');
    return;
  }
  
  const parseHora = (hora) => {
    const [h, m] = hora.split(':').map(Number);
    return h * 3600 + m * 60; // Convertir a SEGUNDOS
  };
  
  const segundosInicio = parseHora(horaInicio);
  let segundosFin = parseHora(horaFin);
  
  // Manejar cruces de medianoche
  if (segundosFin < segundosInicio) {
    segundosFin += 24 * 3600;
  }
  
  const duracionTotal = segundosFin - segundosInicio;
  
  if (duracionTotal <= 0) {
    console.log('[PROGRESO] Duración inválida');
    return;
  }
  
  console.log(`[PROGRESO] Iniciando. Inicio: ${horaInicio}, Fin: ${horaFin}, Duración: ${Math.round(duracionTotal/60)} min`);
  
  // Actualizar cada 250ms para que la barra avance suavemente en tiempo real
  intervaloProgreso = setInterval(async () => {
    const ahora = new Date();
    const segundosAhora = ahora.getHours() * 3600 + ahora.getMinutes() * 60 + ahora.getSeconds();
    
    // Calcular progreso
    let segundosTranscurridos = segundosAhora - segundosInicio;
    
    // Manejar cruces de medianoche
    if (segundosTranscurridos < 0) {
      segundosTranscurridos += 24 * 3600;
    }
    
    let porcentaje = (segundosTranscurridos / duracionTotal) * 100;
    porcentaje = Math.min(Math.max(porcentaje, 0), 100); // Limitar entre 0 y 100
    
    // Convertir segundos transcurridos a HH:MM:SS
    const horas = Math.floor(segundosTranscurridos / 3600);
    const minutos = Math.floor((segundosTranscurridos % 3600) / 60);
    const segundos = Math.floor(segundosTranscurridos % 60);
    const tiempoFormato = `${String(horas).padStart(2, '0')}:${String(minutos).padStart(2, '0')}:${String(segundos).padStart(2, '0')}`;
    
    // Actualizar barra visual
    const barraLlena = $('estudioBarraLlena');
    const progreso = $('estudioProgreso');
    const tiempoTranscurrido = $('estudioTiempoTranscurrido');
    
    if (barraLlena) {
      barraLlena.style.width = porcentaje + '%';
    }
    if (progreso) {
      progreso.textContent = Math.round(porcentaje);
    }
    if (tiempoTranscurrido) {
      tiempoTranscurrido.textContent = tiempoFormato;
    }
    
    // Emitir evento de socket para actualizar otros usuarios
    if (window.socket && window.socket.connected) {
      window.socket.emit('electro:progreso-estudio', {
        citaId: citaElectroSeleccionada.id,
        porcentaje: porcentaje,
        tiempoTranscurrido: tiempoFormato
      });
    }
    
    console.log(`[PROGRESO] ${Math.round(porcentaje)}% - ${tiempoFormato}`);
    
    // Si llegó al 100%, finalizar automáticamente
    if (porcentaje >= 100) {
      clearInterval(intervaloProgreso);
      intervaloProgreso = null;
      
      console.log('[PROGRESO] Estudio completado. Finalizando automáticamente...');
      
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
          showToast(`Estudio completado automáticamente a las ${horaActual}`, 'success');
          
          citaElectroSeleccionada.estado = 'Completado';
          citaElectroSeleccionada.hora_fin = horaActual;
          
          // Ocultar barra de progreso
          const estudioBarra = $('estudioBarra');
          if (estudioBarra) {
            estudioBarra.style.display = 'none';
          }
          
          // Emitir socket
          if (window.socket && window.socket.connected) {
            window.socket.emit('electro:estudio-finalizado', {
              id: citaElectroSeleccionada.id,
              hora_fin: horaActual
            });
          }
          
          // Recargar citas
          cargarCitasElectro();
          
          // Cerrar modal
          cerrarModalDetallesCita();
        }
      } catch (error) {
        console.error('[PROGRESO] Error finalizando estudio:', error);
        showToast('Error finalizando estudio automáticamente', 'error');
      }
    }
  }, 250);
}

// Función para guardar edición de datos del paciente desde el modal
async function guardarEdicionPaciente() {
  if (!citaElectroSeleccionada?.paciente_id) {
    showToast('No se puede identificar al paciente', 'error');
    return;
  }
  const nombre = $('editNombrePaciente').value.trim();
  const documento = $('editDocumentoPaciente').value.trim();
  const telefono = $('editTelefonoPaciente').value.trim();

  if (!nombre) { showToast('El nombre no puede estar vacío', 'error'); return; }
  if (documento && !/^\d+$/.test(documento)) { showToast('El documento solo puede contener números', 'error'); return; }
  if (telefono && !/^\d{10}$/.test(telefono)) { showToast('El teléfono debe tener exactamente 10 dígitos', 'error'); return; }

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

// Función para enviar recomendaciones por WhatsApp
function enviarRecomendacionesWhatsApp(cita) {
  if (!cita) { showToast('Error: No hay cita seleccionada', 'error'); return; }
  if (!cita.telefono) { showToast('El paciente no tiene teléfono registrado', 'error'); return; }
  mostrarModalEnviarWhatsApp(cita);
}

// Variable global para guardar la información temporalmente
let citaParaWhatsApp = null;

// Función para mostrar modal de confirmación
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
          <p style="margin:0 0 12px 0;font-size:0.85rem;color:#6b7280;font-weight:600">INFORMACIÓN DEL PACIENTE</p>
          <div style="display:grid;gap:8px;font-size:0.95rem">
            <div><strong>Nombre:</strong> <span id="whatsappNombrePaciente">-</span></div>
            <div><strong>Documento:</strong> <span id="whatsappDocumento">-</span></div>
            <div><strong>Teléfono:</strong> <span id="whatsappTelefono">-</span></div>
          </div>
        </div>

        <div style="margin-bottom:16px;padding:12px 16px;background:#fffbeb;border-left:4px solid #f59e0b;border-radius:0 8px 8px 0;font-size:0.88rem;color:#92400e">
          ⚠️ WhatsApp Web no permite adjuntar archivos por enlace. Después de abrir el chat, adjunta el PDF de recomendaciones manualmente.
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

// Función para enviar por WhatsApp
function enviarPorWhatsApp() {
  if (!citaParaWhatsApp) {
    showToast('Error: No hay información para enviar', 'error');
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
      // Eliminar hora si está incluida (formato ISO: YYYY-MM-DD HH:MM:SS)
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
      // Si es un número (timestamp)
      fechaObj = new Date(cita.fecha);
    }
    
    // Validar que sea una fecha válida
    if (isNaN(fechaObj.getTime())) {
      console.error('Fecha inválida después del parseo:', cita.fecha);
      throw new Error('Fecha inválida');
    }
    
    console.log('Fecha parseada correctamente:', fechaObj);
  } catch (e) {
    console.error('Error parsing fecha:', e);
    showToast('Error: Formato de fecha inválido', 'error');
    return;
  }

  // Formato de fecha: DD de MMMM de YYYY
  const options = { day: 'numeric', month: 'long', year: 'numeric' };
  const fechaFormato = fechaObj.toLocaleDateString('es-ES', options);

  // Asegurarse de que la fecha sea capitalizada correctamente
  const fechaCapitalizada = fechaFormato.charAt(0).toUpperCase() + fechaFormato.slice(1);

  // Mensaje predeterminado del instituto
  let mensaje = `HOLA, ${(cita.paciente_nombre || '').toUpperCase()}, INSTITUTO NEUROCIENCIAS DE NARIÑO LE INFORMA QUE:\n\n`;
  mensaje += `Tiene programada su cita para la toma de su ${cita.estudio || 'ESTUDIO'}\n`;
  mensaje += `DÍA:  ${fechaCapitalizada.toUpperCase()}\n`;
  mensaje += `HORA:  ${cita.hora_agendamiento || '-'}\n\n`;
  mensaje += `Le recordamos que será atendido por una técnica especializada en electrodiagnostico.\n`;
  mensaje += `Anexo a este mensaje le enviamos las recomendaciones que debe tener en cuenta, le recordamos la dirección: Carrera 34 #13-80, Barrio San Ignacio.\n`;
  mensaje += `Teléfonos 3053560651- 6027238141\n\n`;
  mensaje += `NOTA: no olvide traer su orden de servicio, copia de su documento de identificación y epicrisis o historia clínica.\n\n`;
  mensaje += `Le solicitamos confirmar su asistencia.\n`;
  mensaje += `Recuerde acercarse al centro comercial Valle de Atriz 2do piso y hacer la respectiva facturación con sello. Muchas Gracias.`;

  if (mensajePersonalizado) {
    mensaje += `\n\n${mensajePersonalizado}`;
  }

  // Formatear el número de teléfono para WhatsApp
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
  citaElectroSeleccionada = cita;
  
  // Activar flag para evitar cambios automáticos
  isInitializingElectroModal = true;
  
  // Rellenar datos de paciente
  $('modalPacienteNombre').textContent = escapeHtml(cita.paciente_nombre || '-');
  $('modalPacienteDocumento').textContent = escapeHtml(cita.paciente_documento || '-');
  
  // Rellenar usuario que programó y editó
  $('modalUsuarioProgramo').textContent = escapeHtml(cita.programado_por_nombre || '-');
  $('modalUsuarioEdito').textContent = escapeHtml(cita.editado_por_nombre || cita.programado_por_nombre || '-');

  // Nuevos campos de información de la cita
  const $estudioEl = document.getElementById('modalEstudioDisplay');
  if ($estudioEl) $estudioEl.textContent = cita.estudio || '-';
  const $fechaEl = document.getElementById('modalFechaDisplay');
  if ($fechaEl) $fechaEl.textContent = cita.fecha ? formatearFechaISO(cita.fecha) : '-';
  const $horaEl = document.getElementById('modalHoraDisplay');
  if ($horaEl) $horaEl.textContent = cita.hora_agendamiento ? formatearHora(cita.hora_agendamiento) : '-';
  const $diagEl = document.getElementById('modalDiagnosticoDisplay');
  if ($diagEl) $diagEl.textContent = cita.diagnostico_codigo ? `${cita.diagnostico_codigo}${cita.diagnostico_nombre ? ' – ' + cita.diagnostico_nombre : ''}` : (cita.diagnostico_nombre || '-');
  const $telEl = document.getElementById('modalTelefonoDisplay');
  if ($telEl) $telEl.textContent = cita.telefono || '-';

  // Badge de estado en el header
  const $badgeEl = document.getElementById('modalEstadoHeaderBadge');
  if ($badgeEl) $badgeEl.innerHTML = estadoBadge(cita.estado || 'Programado');

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
  
  // Actualizar selector de estado oculto
  $('modalEstado').value = cita.estado || 'Programado';
  
  // Renderizar flujo contextual de estado
  renderFlujoEstado(cita);
  
  // Mostrar botón de eliminar para admin/superadmin y admin_electro (excepto estudios completados)
  const btnEliminar = $('btnEliminarCita');
  const esCompletado = cita.estado === 'Completado';
  if (currentUser) {
    const rol = currentUser.rol;
    const esAdminGlobal = rol === 'admin' || rol === 'administrador' || rol === 'superadmin';
    const esAdminElectro = rol === 'admin_electro';
    if (esAdminGlobal || (esAdminElectro && !esCompletado)) {
      btnEliminar.style.display = '';
    } else {
      btnEliminar.style.display = 'none';
    }
  } else {
    btnEliminar.style.display = 'none';
  }
  
  // Agregar listeners para los botones de reprogramación y adelanto
  const btnRep = $('btnReprogramarCita');
  const btnAde = $('btnAdelantarCita');
  
  console.log('[MODAL_DETALLES] btnReprogramarCita existe:', !!btnRep);
  console.log('[MODAL_DETALLES] btnAdelantarCita existe:', !!btnAde);
  
  if (btnRep) {
    btnRep.addEventListener('click', abrirModalReprogramar);
    console.log('[MODAL_DETALLES] Listener agregado a btnReprogramarCita');
  }
  
  if (btnAde) {
    btnAde.addEventListener('click', abrirModalAdelantarCita);
    console.log('[MODAL_DETALLES] Listener agregado a btnAdelantarCita');
  }
  
  // Configurar el menú de "Más opciones"
  const btnMasOpciones = $('btnMasOpciones');
  const menuMasOpciones = $('menuMasOpciones');
  const btnRepProgramarMenu = $('btnReprogramarCitaMenu');
  const btnAdelantarMenu = $('btnAdelantarCitaMenu');
  const btnRecomendacionesMenu = $('btnEnviarRecomendacionesMenu');
  
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
  
  // Cerrar menú al hacer click afuera (se registra una sola vez con flag)
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
  
  // Agregar listeners a los items del menú (onclick para evitar acumulación)
  if (btnRepProgramarMenu) {
    btnRepProgramarMenu.onclick = () => {
      menuMasOpciones.style.display = 'none';
      abrirModalReprogramar();
    };
  }
  
  if (btnAdelantarMenu) {
    btnAdelantarMenu.onclick = () => {
      menuMasOpciones.style.display = 'none';
      abrirModalAdelantarCita();
    };
  }
  
  if (btnRecomendacionesMenu) {
    btnRecomendacionesMenu.onclick = () => {
      menuMasOpciones.style.display = 'none';
      enviarRecomendacionesWhatsApp(citaElectroSeleccionada);
    };
  }
  
  // Bloquear menú si el estado es "En Estudio"
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
      $('estudioBarraLlena').style.width = '0%';
    }
    // Iniciar actualización de progreso
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
  
  // Desactivar flag de inicialización - Ahora es seguro procesar cambios del usuario
  isInitializingElectroModal = false;
  
  // Mostrar modal
  $('modalDetallesCitaElectro').classList.remove('hidden');
}

// ===== FLUJO CONTEXTUAL DE ESTADO =====
function renderFlujoEstado(cita) {
  const estado = cita.estado || 'Programado';
  const flujoEl = document.getElementById('modalFlujoEstudio');
  const accionesEl = document.getElementById('modalAccionesEstudio');
  const equipoSelect = $('modalEquipo');
  const btnGuardar = $('btnGuardarCambios');

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

  const svgCheck = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`;
  const svgPlay  = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
  const svgStop  = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`;

  if (estado === 'Programado') {
    // Equipo bloqueado hasta que llegue el paciente
    if (equipoSelect) { equipoSelect.disabled = true; equipoSelect.style.opacity = '0.45'; equipoSelect.style.cursor = 'not-allowed'; }
    flujoEl.innerHTML = `
      <div class="flujo-estado-panel">
        <div class="flujo-estado-label">Acci\u00f3n</div>
        <button class="flujo-btn-primary llegada" id="flujo-btn-llego">
          ${svgCheck} Paciente lleg\u00f3 &rarr; En Sala
        </button>
        <div class="flujo-btn-secondary-row">
          <button class="flujo-btn-sm no-asistio" id="flujo-btn-noasistio">No asisti\u00f3</button>
          <button class="flujo-btn-sm cancelar" id="flujo-btn-cancelar">Cancelar cita</button>
        </div>
      </div>`;
    document.getElementById('flujo-btn-llego').onclick    = () => cambiarEstadoCita('En Sala');
    document.getElementById('flujo-btn-noasistio').onclick = () => cambiarEstadoCita('No Asisti\u00f3');
    document.getElementById('flujo-btn-cancelar').onclick  = () => cambiarEstadoCita('Cancelado');

  } else if (estado === 'En Sala') {
    // Equipo habilitado
    if (equipoSelect) { equipoSelect.disabled = false; equipoSelect.style.opacity = '1'; equipoSelect.style.cursor = 'pointer'; }
    flujoEl.innerHTML = `
      <div class="flujo-estado-panel">
        <div class="flujo-estado-label">Acci\u00f3n</div>
        <button class="flujo-btn-primary" id="flujo-btn-iniciar" style="background:linear-gradient(135deg,#f97316,#ea580c);color:white;">
          ${svgPlay} Iniciar Estudio
        </button>
        <div class="flujo-btn-secondary-row">
          <button class="flujo-btn-sm no-asistio" id="flujo-btn-noasistio2">No asisti\u00f3</button>
          <button class="flujo-btn-sm cancelar" id="flujo-btn-cancelar2">Cancelar cita</button>
        </div>
      </div>`;
    document.getElementById('flujo-btn-iniciar').onclick    = () => iniciarEstudioModal();
    document.getElementById('flujo-btn-noasistio2').onclick  = () => cambiarEstadoCita('No Asisti\u00f3');
    document.getElementById('flujo-btn-cancelar2').onclick   = () => cambiarEstadoCita('Cancelado');

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
    document.getElementById('flujo-btn-pausar').onclick = () => cambiarEstadoCita('Pausado');

  } else if (estado === 'Pausado') {
    flujoEl.innerHTML = `
      <div class="flujo-estado-panel">
        <div class="flujo-estado-label">Estudio Pausado</div>
        <button class="flujo-btn-primary" id="flujo-btn-reanudar" style="background:linear-gradient(135deg,#f97316,#ea580c);color:white;">
          &#9654; Reanudar Estudio
        </button>
      </div>`;
    document.getElementById('flujo-btn-reanudar').onclick = () => cambiarEstadoCita('En Estudio');

  } else {
    // Completado / Cancelado / No Asist\u00f3 / Reprogramado / Adelantado
    flujoEl.innerHTML = `<div class="flujo-estado-readonly">Sin acciones disponibles para este estado.</div>`;
  }

  // Guardar: solo util para cambio de equipo; ocultarlo si estado final
  const estadosFinales = ['Completado','Cancelado','No Asisti\u00f3','Reprogramado','Adelantado'];
  if (btnGuardar) btnGuardar.style.display = estadosFinales.includes(estado) ? 'none' : '';
}

async function cambiarEstadoCita(nuevoEstado) {
  if (!citaElectroSeleccionada) return;
  try {
    const res = await apiFetch(`/api/citas-electro/${citaElectroSeleccionada.id}/estado`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ estado: nuevoEstado })
    });
    const data = await res.json();
    if (data && data.ok) {
      citaElectroSeleccionada.estado = nuevoEstado;
      $('modalEstado').value = nuevoEstado;
      const $badgeEl = document.getElementById('modalEstadoHeaderBadge');
      if ($badgeEl) $badgeEl.innerHTML = estadoBadge(nuevoEstado);
      renderFlujoEstado(citaElectroSeleccionada);
      showToast(`Estado: ${nuevoEstado}`, 'success');
      if (window.socket && window.socket.connected) {
        window.socket.emit('electro:cambios-guardados', { id: citaElectroSeleccionada.id, cambios: { estado: nuevoEstado } });
      }
      cargarCitasElectro();
    } else {
      showToast(data?.error || 'Error actualizando estado', 'error');
    }
  } catch (e) {
    showToast('Error actualizando estado', 'error');
  }
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
  
  // Verificar permisos: admin/superadmin siempre; admin_electro solo si no está Completado
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
    const equipoNuevo = $('modalEquipo').value;
    const estadoNuevo = $('modalEstado').value;
    
    // Si se cambió equipo o estado, actualizar
    const cambios = {};
    
    // Comparar equipo (convertir ambos a string para comparar)
    if (String(equipoNuevo) !== String(citaElectroSeleccionada.equipo_id || '')) {
      cambios.equipo_id = equipoNuevo ? parseInt(equipoNuevo) : null;
    }
    
    // Comparar estado
    if (estadoNuevo !== (citaElectroSeleccionada.estado || 'Programado')) {
      cambios.estado = estadoNuevo;
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
        
        // El servidor también emite el socket event
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
  console.log('[REPROGRAMAR] Llamando abrirModalReprogramar');
  if (!citaElectroSeleccionada) {
    console.log('[REPROGRAMAR] Sin cita seleccionada');
    return;
  }
  
  console.log('[REPROGRAMAR] Cita seleccionada:', citaElectroSeleccionada);
  
  // GUARDAR CITA ANTES DE CERRAR MODAL
  citaReprogramarAdelantarActual = citaElectroSeleccionada;
  console.log('[REPROGRAMAR] Guardada en variable temporal');
  
  // Rellenar datos actuales
  $('modalReprogramarFechaActual').textContent = 
    `${formatearFecha(citaElectroSeleccionada.fecha)} a las ${citaElectroSeleccionada.hora_agendamiento}`;
  
  // Precargar fecha y hora actual (extraer solo la fecha en formato YYYY-MM-DD)
  const fecha = citaElectroSeleccionada.fecha;
  const fechaFormato = fecha ? fecha.split('T')[0] : '';
  $('modalReprogramarFecha').value = fechaFormato;
  $('modalReprogramarHora').value = citaElectroSeleccionada.hora_agendamiento || '';
  
  console.log('[REPROGRAMAR] Fecha format: ' + fechaFormato);
  
  // Cerrar modal de detalles
  cerrarModalDetallesCita();
  
  // Abrir modal de reprogramación
  $('modalReprogramarCita').classList.remove('hidden');
}

function cerrarModalReprogramar() {
  $('modalReprogramarCita').classList.add('hidden');
}

async function confirmarReprogramar() {
  console.log('[CONFIRMAR_REPROGRAMAR] Iniciando...');
  if (!citaReprogramarAdelantarActual) {
    console.log('[CONFIRMAR_REPROGRAMAR] Sin cita seleccionada');
    return;
  }
  
  try {
    const fechaNueva = $('modalReprogramarFecha').value;
    const horaNueva = $('modalReprogramarHora').value;
    
    console.log('[CONFIRMAR_REPROGRAMAR] fechaNueva:', fechaNueva);
    console.log('[CONFIRMAR_REPROGRAMAR] horaNueva:', horaNueva);
    
    if (!fechaNueva || !horaNueva) {
      showToast('Debes completar fecha y hora', 'error');
      return;
    }
    
    const cambios = {
      estado: 'Reprogramado',
      fecha: fechaNueva,
      hora_agendamiento: horaNueva
    };
    
    console.log('[CONFIRMAR_REPROGRAMAR] Enviando cambios:', cambios);
    
    const res = await apiFetch(`/api/citas-electro/${citaReprogramarAdelantarActual.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cambios)
    });
    
    const data = await res.json();
    
    console.log('[CONFIRMAR_REPROGRAMAR] Respuesta del servidor:', data);
    
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
  console.log('[CONFIRMAR_ADELANTAR] Iniciando...');
  if (!citaReprogramarAdelantarActual) {
    console.log('[CONFIRMAR_ADELANTAR] Sin cita seleccionada');
    return;
  }
  
  try {
    const horaNueva = $('modalAdelantarHora').value;
    
    console.log('[CONFIRMAR_ADELANTAR] horaNueva:', horaNueva);
    
    if (!horaNueva) {
      showToast('Debes completar la hora', 'error');
      return;
    }
    
    const cambios = {
      estado: 'Adelantado',
      hora_agendamiento: horaNueva
    };
    
    console.log('[CONFIRMAR_ADELANTAR] Enviando cambios:', cambios);
    
    const res = await apiFetch(`/api/citas-electro/${citaReprogramarAdelantarActual.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cambios)
    });
    
    const data = await res.json();
    
    console.log('[CONFIRMAR_ADELANTAR] Respuesta del servidor:', data);
    
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

// ===== Event Listeners para Modal de Duración =====
$('btnConfirmarDuracionSi')?.addEventListener('click', () => {
  console.log('[DURACION] Usuario seleccionó SÍ');
  cerrarModalConfirmarDuracion();
  abrirModalDuracionEstudio();
});

$('btnConfirmarDuracionNo')?.addEventListener('click', () => {
  console.log('[DURACION] Usuario seleccionó NO');
  cerrarModalConfirmarDuracion();
  iniciarEstudioSinDuracion();
});

$('cerrarModalDuracion')?.addEventListener('click', cerrarModalDuracionEstudio);
$('btnCancelarDuracion')?.addEventListener('click', cerrarModalDuracionEstudio);
$('btnConfirmarDuracion')?.addEventListener('click', confirmarDuracionEstudio);

// Event listeners para confirmación de finalizar estudio
$('btnConfirmarFinalizarSi')?.addEventListener('click', confirmarFinalizarEstudio);
$('btnConfirmarFinalizarNo')?.addEventListener('click', cancelarFinalizarEstudio);

// ========== FUNCIONES PARA MODAL DE ESTADO DE CITAS MÉDICAS ==========

let currentTurnoMedicaData = null;
let currentEstadoAction = null;

function abrirModalEstadoCitaMedica(turno) {
  currentTurnoMedicaData = turno;

  // Cerrar menú y panel de edición si estaban abiertos
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

  // Bloquear edición si está EN ATENCIÓN
  const esEnAtencionModal = turno.estado === 'EN_ATENCION';
  const editBtnMed = el('btnEditarMedicaModal');
  if (editBtnMed) {
    editBtnMed.disabled = esEnAtencionModal;
    editBtnMed.style.opacity = esEnAtencionModal ? '0.4' : '';
    editBtnMed.title = esEnAtencionModal
      ? 'No es posible editar mientras el paciente está en atención'
      : 'Editar datos del paciente';
  }

  // Mostrar modal
  $('modalEstadoCitaMedica').classList.remove('hidden');
}

function cerrarModalEstadoCitaMedica() {
  $('modalEstadoCitaMedica').classList.add('hidden');
  // NO limpiar currentTurnoMedicaData ni currentEstadoAction aquí 
  // Se necesitan para el modal de confirmación
  // currentTurnoMedicaData = null;
  // currentEstadoAction = null;
}

function cerrarModalReprogramarMedica() {
  $('modalReprogramarMedica').classList.add('hidden');
  // Limpiar datos después de reprogramar
  currentTurnoMedicaData = null;
  currentEstadoAction = null;
}

function cerrarModalConfirmReprogramacion() {
  $('modalConfirmReprogramacion').classList.add('hidden');
  // Limpiar datos después de cerrar confirmación
  currentTurnoMedicaData = null;
  currentEstadoAction = null;
}

// Botón: En Sala
$('btnEstadoEnSala')?.addEventListener('click', async (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (!currentTurnoMedicaData) return;
  
  try {
    const turnoId = currentTurnoMedicaData.id;
    
    // Cambiar estado a EN_SALA y aplicar color amarillo
    const res = await apiFetch(`/api/turnos/${turnoId}/estado`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ estado: 'EN_SALA' })
    });
    
    const data = await res.json();
    if (data.ok) {
      showToast('Paciente marcado como En Sala', 'success');
      cerrarModalEstadoCitaMedica();
      cargarTurnosMedica(); // Recargar tabla
    } else {
      showToast(data.error || 'Error al actualizar', 'error');
    }
  } catch (e) {
    showToast('Error al actualizar estado', 'error');
    console.error(e);
  }
});

// Menú 3 puntos: abrir/cerrar
document.getElementById('btnMasOpcionesMedica')?.addEventListener('click', (e) => {
  e.stopPropagation();
  const menu = document.getElementById('menuMasOpcionesMedica');
  if (menu) menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
});

// Menú: Reprogramar
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

// Menú: Cancelado por Paciente
document.getElementById('btnCanceladoPacienteMedicaMenu')?.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (!currentTurnoMedicaData) return;
  document.getElementById('menuMasOpcionesMedica').style.display = 'none';
  currentEstadoAction = 'cancelado-paciente';
  cerrarModalEstadoCitaMedica();
  $('modalConfirmReprogramacionTitle').textContent = '¿Desea reprogramar esta cita?';
  $('modalConfirmReprogramacionMessage').textContent = 'El paciente canceló la cita. ¿Desea reprogramarla para otro día?';
  $('modalConfirmReprogramacion').classList.remove('hidden');
});

// Menú: No Asistió
document.getElementById('btnNoAsistioMedicaMenu')?.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (!currentTurnoMedicaData) return;
  document.getElementById('menuMasOpcionesMedica').style.display = 'none';
  currentEstadoAction = 'no-asistio';
  cerrarModalEstadoCitaMedica();
  $('modalConfirmReprogramacionTitle').textContent = '¿Desea reprogramar esta cita?';
  $('modalConfirmReprogramacionMessage').textContent = 'El paciente no asistió. ¿Desea reprogramarla para otro día?';
  $('modalConfirmReprogramacion').classList.remove('hidden');
});

// Delegación de eventos para los botones del modal de confirmación de reprogramación
document.addEventListener('click', async (e) => {
  const btnSi = e.target.closest('#btnConfirmReprogramacionSi');
  const btnNo = e.target.closest('#btnConfirmReprogramacionNo');
  
  // Botón: Confirmar Reprogramación - SÍ
  if (btnSi) {
    e.preventDefault();
    e.stopPropagation();
    console.log('[CONFIRM_SI] Botón clickeado');
    // Guardar datos antes de cerrar (cerrarModalConfirmReprogramacion los limpia)
    const savedTurnoData = currentTurnoMedicaData;
    cerrarModalConfirmReprogramacion();
    // Restaurar datos para el modal de reprogramación
    currentTurnoMedicaData = savedTurnoData;
    
    // Abrir modal de reprogramación
    $('modalReprogramarMedica').classList.remove('hidden');
    // Pre-llenar con la fecha/hora actuales de la cita como punto de partida
    $('modalReprogramarMedicaFecha').value = savedTurnoData?.fecha || '';
    $('modalReprogramarMedicaHora').value = (savedTurnoData?.hora || '').substring(0, 5);
  }
  
  // Botón: Confirmar Reprogramación - NO
  if (btnNo) {
    e.preventDefault();
    e.stopPropagation();
    console.log('[CONFIRM_NO] Botón clickeado');
    
    if (!currentTurnoMedicaData) {
      console.log('[CONFIRM_NO] No hay turno seleccionado');
      return;
    }
    
    // Guardar datos ANTES de limpiar modal
    const turnoData = currentTurnoMedicaData;
    const accion = currentEstadoAction;
    
    console.log('[CONFIRM_NO] Acción:', accion);
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
        console.error('[CONFIRM_NO] Acción desconocida:', accion);
        showToast('Error: no se especificó acción válida', 'error');
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
        
        // Recargar para asegurar que todo está sincronizado
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

// Modal: Confirmar Reprogramación
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
    // Determinar estado final según acción
    let estadoFinal = 'REPROGRAMADO';
    
    // Actualizar cita con nueva fecha/hora
    const res = await apiFetch(`/api/turnos/${currentTurnoMedicaData.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fecha: fechaNew,
        hora: horaNew,
        estado: estadoFinal
      })
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
  // Cerrar menú desplegable si se hace clic fuera de él
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

// ── Editar paciente en modal médica ──
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
      if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="padding:20px;text-align:center;color:#7f1d1d">❌ No se encontraron citas para el documento "<strong>${escapeHtml(documento)}</strong>"</td></tr>`;
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
      if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="padding:20px;text-align:center;color:#7f1d1d">❌ No se encontraron estudios para el documento "<strong>${escapeHtml(documento)}</strong>"</td></tr>`;
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

// buscarRecibosPorDocumento removed — replaced by buscarCitaParaRecibo in new Recibos UI

// Event listeners para buscadores (páginas dedicadas en sidebar)
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

// Old recibo document search listeners removed — those IDs no longer exist in the new HTML

// ============================================================
// PACIENTES EN ESPERA — ELECTRODIAGNÓSTICO
// ============================================================

let esperaData = [];   // caché local de registros

let _esperaPendienteId = null;  // id esperando confirmación de eliminación

function initEsperaElectro() {
  $('btnAgregarEspera')?.addEventListener('click', agregarPacienteEspera);

  // Filtros en tiempo real
  ['esperaFiltroTexto', 'esperaFiltroEntidad', 'esperaFiltroPrioridad'].forEach(id => {
    $(id)?.addEventListener('input', renderEsperaTable);
    $(id)?.addEventListener('change', renderEsperaTable);
  });

  // Botones del modal de confirmación de eliminación
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
  const entidad = $('esperaFiltroEntidad')?.value || '';
  const prioridad = $('esperaFiltroPrioridad')?.value || '';

  let lista = esperaData.filter(p => {
    const matchTexto = !texto || (
      (p.nombres || '').toLowerCase().includes(texto) ||
      (p.apellidos || '').toLowerCase().includes(texto) ||
      (p.documento || '').toLowerCase().includes(texto)
    );
    const matchEntidad = !entidad || p.entidad === entidad;
    const matchPrioridad = !prioridad || p.prioridad === prioridad;
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
    showToast('El documento debe tener entre 4 y 15 dígitos numéricos', 'error');
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
  // Buscar nombre del paciente en caché para mostrarlo en el modal
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
// ESPECIALIDADES Y TIPOS DE CONSULTA — MÓDULO USUARIOS
// ============================================================

// Caché para evitar re-fetches innecesarios
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
    // Conservar primera opción (vacía) y "Otra" al final
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
    _especialidadesCache = data;   // actualizar caché
    _tiposConsultaCache  = {};     // invalidar caché de tipos
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
  showConfirm(`¿Eliminar la especialidad "${nombre}" y todos sus tipos de consulta?\nEsta acción no se puede deshacer.`, async () => {
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
    // Invalidar caché de agenda para esta especialidad
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
  showConfirm('¿Eliminar este tipo de consulta?', async () => {
    try {
      const res = await apiFetch(`/api/tipos-consulta/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!data.ok) { showToast(data.error || 'Error', 'error'); return; }
      showToast('Tipo eliminado', 'success');
      await cargarTiposConsultaPanel();
    } catch (e) { showToast('Error: ' + e.message, 'error'); }
  });
}

// ========== MÓDULO GESTIÓN DE DATOS ==========

let _gestionTipoActual = 'citas_electro';

const _gestionTitulos = {
  citas_electro:     'Citas Electrodiagnóstico',
  turnos:            'Turnos Médicos',
  recibos:           'Recibos',
  estudio_duraciones:'Tipos de Estudio',
  especialidades:    'Especialidades',
  tipos_consulta:    'Tipos de Consulta',
  diagnosticos:      'Diagnósticos'
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
    { key: 'numero',     label: 'N°' },
    { key: 'cliente',    label: 'Cliente' },
    { key: 'fecha',      label: 'Fecha' },
    { key: 'total',      label: 'Total' },
    { key: 'tipo_pago',  label: 'Pago' },
    { key: 'creado_por', label: 'Creado por' }
  ],
  estudio_duraciones: [
    { key: 'id',                label: 'ID' },
    { key: 'nombre',            label: 'Nombre' },
    { key: 'duracion_minutos',  label: 'Duración (min)' }
  ],
  especialidades: [
    { key: 'id',     label: 'ID' },
    { key: 'nombre', label: 'Nombre' },
    { key: 'activo', label: 'Activo', format: v => v ? 'Sí' : 'No' }
  ],
  tipos_consulta: [
    { key: 'id',          label: 'ID' },
    { key: 'nombre',      label: 'Nombre' },
    { key: 'especialidad',label: 'Especialidad' },
    { key: 'activo',      label: 'Activo', format: v => v ? 'Sí' : 'No' }
  ],
  diagnosticos: [
    { key: 'id',     label: 'ID' },
    { key: 'nombre', label: 'Nombre' },
    { key: 'codigo', label: 'Código' },
    { key: 'activo', label: 'Activo', format: v => v ? 'Sí' : 'No' }
  ]
};

let _gestionSeleccionados = new Set();
let _gestionRegistrosAll  = [];
let _gestionPaginaActual  = 1;
const _GESTION_POR_PAGINA = 20;
const _GESTION_TIPOS_AGREGAR = ['estudio_duraciones', 'especialidades', 'tipos_consulta', 'diagnosticos'];

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
  const hayBusqueda = ['citas_electro', 'turnos', 'recibos', 'diagnosticos'].includes(tipo);
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
      // Mostrar/ocultar botón Agregar según tipo
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
  // Visibilidad inicial del botón Agregar
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
      if (tbody) tbody.innerHTML = `<tr><td colspan="10" style="padding:20px;text-align:center;color:#dc2626">Sin permisos para realizar esta acción</td></tr>`;
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
    <span style="font-size:13px;color:#627371">${total} registro${total !== 1 ? 's' : ''} — mostrando ${inicio}–${fin}</span>`;
  if (pages > 1) {
    html += `<div style="display:flex;gap:4px;align-items:center">`;
    html += `<button onclick="_gestionIrPagina(${pag - 1})" ${pag <= 1 ? 'disabled' : ''} style="padding:4px 10px;border:1px solid #d1d5db;border-radius:4px;background:#fff;cursor:pointer;font-size:13px">‹</button>`;
    const start = Math.max(1, pag - 2), end = Math.min(pages, pag + 2);
    if (start > 1) html += `<button onclick="_gestionIrPagina(1)" style="padding:4px 8px;border:1px solid #d1d5db;border-radius:4px;background:#fff;cursor:pointer;font-size:13px">1</button>${start > 2 ? '<span style="padding:0 4px">…</span>' : ''}`;
    for (let i = start; i <= end; i++) {
      const active = i === pag ? 'background:#627371;color:#fff;border-color:#627371' : 'background:#fff';
      html += `<button onclick="_gestionIrPagina(${i})" style="padding:4px 8px;border:1px solid #d1d5db;border-radius:4px;cursor:pointer;font-size:13px;${active}">${i}</button>`;
    }
    if (end < pages) html += `${end < pages - 1 ? '<span style="padding:0 4px">…</span>' : ''}<button onclick="_gestionIrPagina(${pages})" style="padding:4px 8px;border:1px solid #d1d5db;border-radius:4px;background:#fff;cursor:pointer;font-size:13px">${pages}</button>`;
    html += `<button onclick="_gestionIrPagina(${pag + 1})" ${pag >= pages ? 'disabled' : ''} style="padding:4px 10px;border:1px solid #d1d5db;border-radius:4px;background:#fff;cursor:pointer;font-size:13px">›</button>`;
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
  if (titulo) titulo.textContent = `Agregar — ${_gestionTitulos[tipo] || tipo}`;

  // Construir formulario dinámico
  const form = $('formAgregarGestion');
  if (!form) return;
  let camposHtml = '';
  if (tipo === 'estudio_duraciones') {
    camposHtml = `
      <div style="margin-bottom:14px">
        <label style="display:block;margin-bottom:6px;font-weight:500;font-size:14px">Nombre del estudio *</label>
        <input id="agrGestionNombre" type="text" required maxlength="120" placeholder="Ej: Electromiografía" style="width:100%;padding:9px 12px;border:1px solid #d1d5db;border-radius:6px;box-sizing:border-box;font-size:14px" />
      </div>
      <div style="margin-bottom:14px">
        <label style="display:block;margin-bottom:6px;font-weight:500;font-size:14px">Duración en minutos *</label>
        <input id="agrGestionDuracion" type="number" required min="1" max="480" placeholder="Ej: 45" style="width:100%;padding:9px 12px;border:1px solid #d1d5db;border-radius:6px;box-sizing:border-box;font-size:14px" />
      </div>`;
  } else if (tipo === 'especialidades') {
    camposHtml = `
      <div style="margin-bottom:14px">
        <label style="display:block;margin-bottom:6px;font-weight:500;font-size:14px">Nombre de la especialidad *</label>
        <input id="agrGestionNombre" type="text" required maxlength="120" placeholder="Ej: Cardiología" style="width:100%;padding:9px 12px;border:1px solid #d1d5db;border-radius:6px;box-sizing:border-box;font-size:14px" />
      </div>`;
  } else if (tipo === 'tipos_consulta') {
    // Cargar especialidades para el select
    let espOptions = '<option value="">Seleccionar especialidad…</option>';
    try {
      const res = await apiFetch('/api/especialidades');
      if (res.ok) {
        const lista = await res.json();
        espOptions += lista.map(e => `<option value="${e.id}">${escapeHtml(e.nombre)}</option>`).join('');
      }
    } catch(_) {}
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
        <input id="agrGestionNombre" type="text" required maxlength="200" placeholder="Nombre del diagnóstico" style="width:100%;padding:9px 12px;border:1px solid #d1d5db;border-radius:6px;box-sizing:border-box;font-size:14px" />
      </div>
      <div style="margin-bottom:14px">
        <label style="display:block;margin-bottom:6px;font-weight:500;font-size:14px">Código (opcional)</label>
        <input id="agrGestionCodigo" type="text" maxlength="20" placeholder="Ej: A00.1" style="width:100%;padding:9px 12px;border:1px solid #d1d5db;border-radius:6px;box-sizing:border-box;font-size:14px" />
      </div>
      <div style="margin-bottom:14px">
        <label style="display:block;margin-bottom:6px;font-weight:500;font-size:14px">Descripción (opcional)</label>
        <textarea id="agrGestionDescripcion" rows="3" maxlength="500" placeholder="Descripción adicional…" style="width:100%;padding:9px 12px;border:1px solid #d1d5db;border-radius:6px;box-sizing:border-box;font-size:14px;resize:vertical"></textarea>
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
    buscarGestionDatos();
  } catch (err) { showToast('Error: ' + err.message, 'error'); }
}

function confirmarEliminarGestion(tipo, id) {
  const titulo = _gestionTitulos[tipo] || tipo;
  showConfirm(`¿Eliminar este registro de "${titulo}"?\nEsta acción es permanente e irreversible.`, async () => {
  try {
    const res  = await apiFetch(`/api/admin/datos/${tipo}/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!data.ok) { showToast(data.error || 'Error al eliminar', 'error'); return; }
    showToast('Registro eliminado', 'success');
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
  showConfirm(`¿Eliminar ${n} registro${n !== 1 ? 's' : ''} de "${titulo}"?\nEsta acción es permanente e irreversible.`, async () => {
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
    buscarGestionDatos();
  } catch (e) { showToast('Error: ' + e.message, 'error'); }
  });
}
