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
    'Abogado',
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
    'Abogado',
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
  return fetch(url, { ...opts, credentials: 'include' });
}

function isAdmin() { return currentUser && currentUser.rol === 'admin'; }
function isRecepcion() { return currentUser && currentUser.rol === 'recepcion'; }
function isElectro() { return currentUser && currentUser.rol === 'electro'; }
function isDoctor() { return currentUser && currentUser.rol === 'doctor'; }
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
  const roleMap = { admin: 'Administrador', recepcion: 'Recepción', electro: 'Electrodiagnóstico', doctor: 'Doctor' };
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
  window.currentModule = null;  // Limpiar para sockets
  showView('view-login');
  history.pushState({view: 'login'}, '', '#login');
}

let initRecibosDone = false, initAgendaDone = false, initElectroDone = false, initUsuariosDone = false, initDiagnosticosDone = false, initDashboardCitasDone = false;
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
      // Si es RECEPCION y hace clic en AGENDA MÉDICA, mostrar selección de doctor
      if (card.dataset.module === 'agenda-medica' && isRecepcion()) {
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
      if (page === 'recibos') { cargarLista(); if ($('resetAll')) $('resetAll').style.display = canDeleteRecibos() ? 'inline-block' : 'none'; }
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
    btnDel.addEventListener('click', async () => {
      if (!confirm(`¿Eliminar el servicio "${s.nombre}"?`)) return;
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
function showLoader(show = true) {
  let loader = document.getElementById('loader');
  if (!loader) {
    loader = document.createElement('div');
    loader.id = 'loader';
    loader.className = 'app-loader-overlay';
    loader.innerHTML = '<div class="app-loader-box"><div class="app-loader-spinner"></div><div>Procesando...</div></div>';
    document.body.appendChild(loader);
  }
  loader.style.display = show ? 'flex' : 'none';
}

// Mostrar toast
function showToast(msg, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `app-toast app-toast-${type}`;
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// Reproducir número de consultorio por voz
function speakConsultorio(numero) {
  // Cancelar cualquier síntesis de voz anterior
  window.speechSynthesis.cancel();
  
  // Crear mensaje a sintetizar
  const texto = `Consultorio número ${numero}`;
  const utterance = new SpeechSynthesisUtterance(texto);
  
  // Configurar voz en español (si está disponible)
  utterance.lang = 'es-ES';
  utterance.rate = 1;
  utterance.pitch = 1;
  utterance.volume = 1;
  
  // Al terminar la síntesis, mostrar un toast
  utterance.onend = () => {
    showToast(`Consultorio ${numero} anunciado`, 'success');
  };
  
  utterance.onerror = (event) => {
    console.error('Error en síntesis de voz:', event.error);
    showToast('Error al reproducir audio', 'error');
  };
  
  // Reproducir
  window.speechSynthesis.speak(utterance);
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
  nextNumber();
  updateSavedCount();

  // Cargar médicos en el select
  cargarMedicosEnRecibo();
  // Cargar servicios en el select de tipo servicio
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

  initRecibosDone = true;
}

// ---- Cargar médicos en el select del formulario ----
async function cargarMedicosEnRecibo() {
  const sel = $('reciboMedico');
  const filtro = $('filtroMedico');
  if (!sel) return;
  try {
    const medicos = await apiFetch('/api/medicos').then(r => r.json()).catch(() => []);
    [sel, filtro].forEach(el => {
      if (!el) return;
      const first = el.querySelector('option');
      el.innerHTML = '';
      if (first) el.appendChild(first.cloneNode(true));
      medicos.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.nombre || m.usuario;
        el.appendChild(opt);
      });
    });
  } catch (_) {}
}

// ---- Cargar servicios en el select del formulario ----
async function cargarServiciosEnRecibo() {
  const sel = $('reciboTipoServicio');
  if (!sel) return;
  try {
    const servicios = await getServicios();
    const firstOpt = sel.querySelector('option');
    sel.innerHTML = '';
    if (firstOpt) sel.appendChild(firstOpt.cloneNode(true));
    servicios.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.nombre;
      opt.textContent = s.nombre;
      sel.appendChild(opt);
    });
  } catch (_) {}
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
  } catch (_) {}
}

// ---- Cargar usuarios que han generado recibos en filtro ----
async function cargarFiltrosUsuarios() {
  const sel = $('filtroGeneradoPor');
  if (!sel) return;
  try {
    const filas = await apiFetch('/api/recibos').then(r => r.json()).catch(() => []);
    const vistos = new Map();
    filas.forEach(r => {
      if (r.generado_por_id && !vistos.has(r.generado_por_id)) {
        vistos.set(r.generado_por_id, r.generado_por_nombre || String(r.generado_por_id));
      }
    });
    sel.innerHTML = '<option value="">Todos</option>';
    vistos.forEach((nombre, id) => {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = nombre;
      sel.appendChild(opt);
    });
  } catch (_) {}
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
function preLlenarReciboDesdeCita(cita) {
  if ($('cliente')) $('cliente').value = cita.paciente_nombre || '';
  if ($('docCliente')) $('docCliente').value = cita.paciente_documento || '';

  // Entidad: pre-seleccionar si existe en el select
  if ($('reciboEntidad') && cita.entidad) {
    $('reciboEntidad').value = cita.entidad; // intentará coincidir con la opción
  }

  // Médico
  if (cita.medico_id && $('reciboMedico')) {
    $('reciboMedico').value = String(cita.medico_id);
  }

  // Tipo de servicio
  if (cita.tipo_consulta && $('reciboTipoServicio')) {
    $('reciboTipoServicio').value = cita.tipo_consulta;
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
    $('crearTurnoMedica').addEventListener('click', crearTurnoMedica);
    $('nuevoPacienteNombreMedica').addEventListener('input', debounceBuscarPacientesMedica);
  }
  // (autocompletado por documento removido)
  // poblar opciones de hora y mostrar quien programa
  populateTurnoHoras('nuevoTurnoHoraMedica', '07:00', '18:00', 20);
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
  const btnProgramar = document.querySelector('[data-page="programar"]');
  if (btnProgramar) {
    btnProgramar.style.display = (isDoctor() || isRecepcion()) ? '' : 'none';
    // Cambiar texto del botón según rol
    btnProgramar.textContent = isDoctor() ? 'Programar Agenda' : 'Agenda';
  }
  
  // Pre-inicializar handlers si es DOCTOR o RECEPCION para que estén listos cuando abran "Programar Agenda"
  if ((isDoctor() || isRecepcion()) && !window._agendaProgramarHandlersSetup) {
    setupAgendaProgramarHandlers();
    window._agendaProgramarHandlersSetup = true;
  }
  if (isRecepcion() && !window._agendaVerMedicosSetup) {
    setupAgendaVerMedicos();
    window._agendaVerMedicosSetup = true;
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
        const progSection = $('agendaProgramarSection');
        const verMedicosSection = $('agendaVerMedicosSection');
        if (progSection) progSection.style.display = isDoctor() ? '' : 'none';
        if (verMedicosSection) verMedicosSection.style.display = isRecepcion() ? '' : 'none';
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
  const verMedicosSection = $('agendaVerMedicosSection');
  if (progSection) progSection.style.display = 'none';
  if (verMedicosSection) verMedicosSection.style.display = 'none';
  
  const nuevoTurnoSection = $('agendaNuevoTurnoSection');
  const doctorAcciones = $('agendaDoctorAcciones');
  if (nuevoTurnoSection) nuevoTurnoSection.style.display = (isElectro() || isDoctor()) ? 'none' : '';
  if (doctorAcciones) doctorAcciones.style.display = isDoctor() ? '' : 'none';
  
  // Desactivar el botón "Marcar como atendido" inicialmente
  const btnMarcar = $('btnMarcarAtendido');
  if (btnMarcar) {
    btnMarcar.disabled = true;
    btnMarcar.title = 'No hay paciente en atención';
  }
  
  $('btnLlamarSiguiente')?.addEventListener('click', llamarSiguientePaciente);
  $('btnMarcarAtendido')?.addEventListener('click', marcarAtendido);
  $('btnDescargarAgendaPDF')?.addEventListener('click', descargarAgendaPDF);
  
  // Mostrar botón de descarga PDF solo si hay doctor seleccionado
  const btnPDF = $('btnDescargarAgendaPDF');
  if (btnPDF && selectedDoctorId) {
    btnPDF.style.display = '';
  }
  
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
  const fecha = $('agendaMedicaFecha')?.value;
  const comboHoras = $('nuevoTurnoHoraMedica');
  const mensajeDiv = $('mensajeDisponibilidad');
  
  if (!comboHoras || !doctorId || !fecha) {
    // Si no hay todos los datos, mostrar todas las horas
    populateTurnoHoras('nuevoTurnoHoraMedica', '07:00', '18:00', 60);
    if (mensajeDiv) mensajeDiv.style.display = 'none';
    return;
  }
  
  try {
    // Obtener disponibilidad del doctor para esa fecha
    const res = await apiFetch(`/api/doctor-disponibilidad?doctor_id=${doctorId}&fecha=${fecha}`);
    const data = await res.json();
    
    if (!data.ok) {
      // Si hay error, mostrar todas las horas
      console.warn('Error obteniendo disponibilidad:', data.error);
      populateTurnoHoras('nuevoTurnoHoraMedica', '07:00', '18:00', 60);
      if (mensajeDiv) mensajeDiv.style.display = 'none';
      return;
    }
    
    const disponibleManana = data.disponible_manana;
    const disponibleTarde = data.disponible_tarde;
    
    comboHoras.innerHTML = '';
    
    // PASO 1: Validar disponibilidad general por turno (MAÑANA/TARDE)
    console.log(`Disponibilidad general para doctor ${doctorId}, fecha ${fecha}:`, {disponibleManana, disponibleTarde});
    
    if (!disponibleManana && !disponibleTarde) {
      // Día completamente no disponible
      if (mensajeDiv) {
        mensajeDiv.textContent = 'El doctor no está disponible en ningún horario este día.';
        mensajeDiv.style.display = 'block';
      }
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'Sin disponibilidad este día';
      comboHoras.appendChild(opt);
      comboHoras.disabled = true;
      return;
    }
    
    // PASO 2: Si hay intervalos específicos, filtrar dentro de turnos disponibles
    if (data.tiene_intervalos && data.intervalos && data.intervalos.length > 0) {
      console.log(`Doctor tiene ${data.intervalos.length} intervalos no disponibles:`, data.intervalos);
      
      // Generar base de horas disponibles según turno CON INTERVALOS DE 20 MINUTOS
      const horasBase = [];
      
      if (disponibleManana) {
        for (let h = 7; h < 13; h++) {
          for (let m = 0; m < 60; m += 20) {
            if (h === 12 && m > 0) continue;
            horasBase.push(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`);
          }
        }
      }
      
      if (disponibleTarde) {
        for (let h = 14; h < 19; h++) {
          for (let m = 0; m < 60; m += 20) {
            if (h === 18 && m > 0) continue;
            horasBase.push(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`);
          }
        }
      }
      
      // Filtrar horas que caen en intervalos bloqueados
      const horasDisponibles = [];
      const horasBloqueadas = new Map();
      
      for (const hora of horasBase) {
        let estaBloqueada = false;
        let razonBloqueo = null;
        
        const [horaStr, minStr] = hora.split(':');
        const horaNum = parseInt(horaStr, 10);
        const minNum = parseInt(minStr, 10);
        const minutoCita = horaNum * 60 + minNum;
        
        // Verificar si cae en algún intervalo bloqueado
        for (const intervalo of data.intervalos) {
          const [inicioH, inicioM, inicioS] = intervalo.hora_inicio.split(':').map(x => parseInt(x, 10));
          const [finH, finM, finS] = intervalo.hora_fin.split(':').map(x => parseInt(x, 10));
          const minutoInicio = inicioH * 60 + inicioM;
          const minutoFin = finH * 60 + finM;
          
          if (minutoCita >= minutoInicio && minutoCita < minutoFin) {
            estaBloqueada = true;
            razonBloqueo = intervalo.razon || 'No disponible';
            break;
          }
        }
        
        if (estaBloqueada) {
          horasBloqueadas.set(hora, razonBloqueo);
        } else {
          horasDisponibles.push(hora);
        }
      }
      
      // Mostrar mensaje con razones
      if (mensajeDiv) {
        if (horasDisponibles.length === 0) {
          mensajeDiv.innerHTML = 'No hay horarios disponibles (todos están bloqueados por intervalos)';
          mensajeDiv.style.display = 'block';
          comboHoras.disabled = true;
          const opt = document.createElement('option');
          opt.value = '';
          opt.textContent = 'Sin disponibilidad este día';
          comboHoras.appendChild(opt);
          return;
        }
        
        if (horasBloqueadas.size > 0) {
          let mensajeTexto = '<strong>Horarios bloqueados:</strong><br>';
          const razonesUnicas = new Map();
          for (const [hora, razon] of horasBloqueadas) {
            if (!razonesUnicas.has(razon)) {
              razonesUnicas.set(razon, []);
            }
            razonesUnicas.get(razon).push(hora);
          }
          
          for (const [razon, horas] of razonesUnicas) {
            mensajeTexto += ` ${horas.join(', ')}: ${razon}<br>`;
          }
          mensajeDiv.innerHTML = mensajeTexto;
          mensajeDiv.style.display = 'block';
        } else {
          mensajeDiv.style.display = 'none';
        }
      }
      
      comboHoras.disabled = false;
      
      // Agregar opciones disponibles
      horasDisponibles.forEach(hora => {
        const opt = document.createElement('option');
        opt.value = hora;
        opt.textContent = hora;
        comboHoras.appendChild(opt);
      });
      
      return;
    }
    
    // PASO 3: Si NO hay intervalos, usar solo el sistema de MAÑANA/TARDE
    console.log(`Sin intervalos específicos. Usando sistema clásico de turnos`);
    
    // Mostrar mensaje si algún turno NO está disponible
    if (mensajeDiv) {
      let mensajes = [];
      if (!disponibleManana) {
        mensajes.push('El doctor no estará disponible en la mañana (7:00-12:00)');
      }
      if (!disponibleTarde) {
        mensajes.push('El doctor no estará disponible en la tarde (14:00-18:00)');
      }
      
      if (mensajes.length > 0) {
        mensajeDiv.innerHTML = '' + mensajes.join('<br>');
        mensajeDiv.style.display = 'block';
      } else {
        mensajeDiv.style.display = 'none';
      }
    }
    
    comboHoras.disabled = false;
    
    // Generar horas con intervalos de 20 minutos (clásico)
    const horas = [];
    
    if (disponibleManana) {
      for (let h = 7; h < 13; h++) {
        for (let m = 0; m < 60; m += 20) {
          if (h === 12 && m > 0) continue;
          horas.push(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`);
        }
      }
    }
    
    if (disponibleTarde) {
      for (let h = 14; h < 19; h++) {
        for (let m = 0; m < 60; m += 20) {
          if (h === 18 && m > 0) continue;
          horas.push(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`);
        }
      }
    }
    
    // Agregar opciones al combobox
    horas.forEach(hora => {
      const opt = document.createElement('option');
      opt.value = hora;
      opt.textContent = hora;
      comboHoras.appendChild(opt);
    });
    
    
    
  } catch (e) {
    console.error('Error en actualizarHorasDisponibles:', e);
    // En caso de error, mostrar todas las horas
    populateTurnoHoras('nuevoTurnoHoraMedica', '07:00', '18:00', 20);
    if (mensajeDiv) mensajeDiv.style.display = 'none';
  }
}

// --- Programar agenda (cliente) ---
function setupAgendaProgramarHandlers() {
  const fileInput = $('agendaProgramarFile');
  const uploadBtn = $('agendaProgramarUpload');
  const preview = $('agendaProgramarPreview');
  if (!fileInput) return;
  
  fileInput.addEventListener('change', (e) => {
    const f = e.target.files[0];
    uploadBtn.disabled = !f;
    if (f) {
      preview.innerHTML = `<div style="padding:12px;background:#e0f2fe;border-radius:6px;color:#0369a1">
        <strong>Archivo seleccionado:</strong> ${escapeHtml(f.name)}
        <br><small>Tamaño: ${(f.size / 1024).toFixed(2)} KB</small>
      </div>`;
    } else {
      preview.innerHTML = '';
    }
  });
  
  uploadBtn?.addEventListener('click', async () => {
    if (!confirm('¿Subir este archivo?')) return;
    try {
      const f = fileInput.files[0];
      if (!f) { showToast('Selecciona un archivo', 'error'); return; }
      
      // Validar tamaño máximo (50MB)
      const maxSize = 50 * 1024 * 1024;
      if (f.size > maxSize) {
        showToast('El archivo es demasiado grande. Máximo 50MB.', 'error');
        return;
      }
      
      uploadBtn.disabled = true;
      uploadBtn.textContent = 'Subiendo...';
      
      // Usar FormData para enviar el archivo directamente
      const formData = new FormData();
      formData.append('file', f);
      // Usar selectedDoctorId si está disponible (RECEPCIONISTA), sino usar currentUser.id (DOCTOR)
      const doctorId = selectedDoctorId || currentUser?.id;
      if (!doctorId) {
        showToast('No hay doctor seleccionado', 'error');
        uploadBtn.disabled = false;
        uploadBtn.textContent = 'Subir archivo';
        return;
      }
      formData.append('doctor_id', doctorId);
      
      // Usar el endpoint correcto para procesar Excel de disponibilidad
      const res = await fetch('/api/doctor-disponibilidad/procesar-excel', {
        method: 'POST',
        credentials: 'include',
        body: formData
        // NO enviar Content-Type: multipart/form-data, dejar que el navegador lo establezca automáticamente
      });
      
      const data = await res.json();
      
      if (data.ok) { 
        showToast(`✓ ${data.diasGuardados} días de disponibilidad guardados correctamente`, 'success'); 
        fileInput.value = '';
        preview.innerHTML = `<div style="padding:12px;background:#d1fae5;border-radius:6px;color:#059669">✓ ${data.diasGuardados} días procesados exitosamente</div>`;
        setTimeout(() => { preview.innerHTML = ''; }, 3000);
        // Recargar lista de archivos
        setTimeout(() => loadDoctorFiles(), 500);
      }
      else showToast(data.error||'Error', 'error');
      
      uploadBtn.disabled = false;
      uploadBtn.textContent = 'Subir archivo';
    } catch (e) { 
      showToast('Error subiendo archivo: ' + e.message, 'error');
      console.error('Error detalles:', e);
      uploadBtn.disabled = false;
      uploadBtn.textContent = 'Subir archivo';
    }
  });
  
  // Cargar archivos del doctor actual
  setTimeout(() => loadDoctorFiles(), 500);
}

function loadDoctorFiles(doctorId) {
  // Usar el doctorId pasado, o defaultear a selectedDoctorId o currentUser.id
  const id = doctorId || selectedDoctorId || currentUser?.id;
  if (!id) {
    console.warn('loadDoctorFiles: no doctor id available');
    return;
  }
  apiFetch(`/api/doctor-agenda-files?doctor_id=${id}`)
    .then(r => r.json())
    .then(files => {
      const preview = $('agendaProgramarPreview');
      // Limpiar preview antes de agregar nuevos elementos
      preview.innerHTML = '';
      
      if (!files || files.length === 0) {
        const div = document.createElement('div');
        div.innerHTML = '<div style="padding:12px;color:#999;margin-top:16px;border-top:2px solid #e5e7eb;margin-top:16px;padding-top:16px">No hay archivos subidos aún</div>';
        preview.appendChild(div);
        return;
      }
      const filesSection = document.createElement('div');
      filesSection.style.marginTop = '20px';
      filesSection.style.paddingTop = '16px';
      filesSection.style.borderTop = '2px solid #e5e7eb';
      
      const title = document.createElement('h4');
      title.textContent = 'Archivos Subidos';
      title.style.margin = '0 0 12px 0';
      filesSection.appendChild(title);
      
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
        
        const link = document.createElement('a');
        link.href = f.url;
        link.target = '_blank';
        link.textContent = f.filename;
        link.style.color = '#0369a1';
        link.style.textDecoration = 'underline';
        link.style.flex = '1';
        
        const buttonsContainer = document.createElement('div');
        buttonsContainer.style.display = 'flex';
        buttonsContainer.style.gap = '8px';
        buttonsContainer.style.marginLeft = '8px';
        
        // Botón Ver para archivos Excel
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
          buttonsContainer.appendChild(btnView);
        }
        
        const btnDelete = document.createElement('button');
        btnDelete.textContent = 'Eliminar';
        btnDelete.style.padding = '4px 12px';
        btnDelete.style.fontSize = '0.85rem';
        btnDelete.style.background = '#dc2626';
        btnDelete.style.color = 'white';
        btnDelete.style.border = 'none';
        btnDelete.style.borderRadius = '4px';
        btnDelete.style.cursor = 'pointer';
        btnDelete.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!confirm('¿Eliminar este archivo?')) return;
          try {
            const res = await apiFetch(`/api/doctor-agenda-files/${f.id}`, { method: 'DELETE' });
            const data = await res.json();
            if (data.ok) {
              showToast('Archivo eliminado', 'success');
              loadDoctorFiles();
            } else {
              showToast(data.error || 'Error', 'error');
            }
          } catch (e) {
            showToast('Error eliminando archivo', 'error');
          }
        });
        
        li.appendChild(link);
        buttonsContainer.appendChild(btnDelete);
        li.appendChild(buttonsContainer);
        ul.appendChild(li);
      });
      filesSection.appendChild(ul);
      preview.appendChild(filesSection);
    })
    .catch(e => console.error(e));
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
  const q = $('nuevoPacienteNombreMedica').value.trim();
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
  // Usar selectedDoctorId (establecido al seleccionar doctor) o el ID del doctor logging si es doctor
  const doctorId = selectedDoctorId || (isDoctor() ? currentUser?.id : null);
  if (!fecha || !doctorId) { showToast('Selecciona fecha y médico', 'error'); return; }
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
    
    for (let i = 0; i < filasRequeridas; i++) {
      if (i < turnos.length) {
        renderTurnoRowMedica(tbody, turnos[i], animateTargetId, hayEnAtencion);
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
    // Admin: solo bloquear si hay EN_ATENCION en otro turno
    deshabilitarBotones = hayEnAtencion && !esEnAtencion;
  } else if (isRecepcion()) {
    // Recepción: bloquear si está ATENDIDO o hay EN_ATENCION (excepto si es el mismo turno)
    deshabilitarBotones = esAtendido || (hayEnAtencion && !esEnAtencion);
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
        <td>-</td>
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
      if (!confirm('¿Eliminar esta cita?')) return;
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
  }
  tbody.appendChild(tr);
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
      // Alerta por voz solo en la sesión del doctor
      if (isDoctor() && 'speechSynthesis' in window) {
        let texto = `Paciente ${nombre}`;
        if (consultorio) {
          texto += `, por favor pasar a consultorio número ${consultorio}`;
        } else {
          texto += ', por favor pasar a consultorio';
        }
        const utter = new SpeechSynthesisUtterance(texto);
        utter.lang = 'es-ES';
        utter.rate = 1;
        window.speechSynthesis.speak(utter);
      }
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
  if (isRecepcion()) {
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
  const nombre = $('nuevoPacienteNombreMedica').value.trim();
  const doc = $('nuevoPacienteDocMedica').value.trim();
  const fecha = $('agendaMedicaFecha').value;
  const doctorId = selectedDoctorId || (isDoctor() ? currentUser?.id : null);
  const hora = $('nuevoTurnoHoraMedica')?.value || '';
  const telefono1 = $('nuevoPacienteTelefonoMedica')?.value.trim() || '';
  const telefono2 = $('nuevoPacienteTelefonoMedica2')?.value.trim() || '';
  const tipoConsulta = $('nuevoTurnoTipoMedica')?.value || '';
  const entidad = $('nuevoTurnoEntidadMedica')?.value || '';
  const notas = $('nuevoTurnoNotasMedica')?.value || '';
  const oportunidad = $('nuevoTurnoOportunidadMedica')?.value || '';

  // ========== VALIDACIONES ==========
  
  // 1. Validar campos obligatorios
  if (!nombre || !doc || !fecha || !doctorId || !hora || !entidad || !tipoConsulta) {
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

  // 4. Validar teléfono 1: obligatorio, mínimo 7 dígitos
  if (!telefono1) {
    showToast('Teléfono 1 es obligatorio', 'error');
    return;
  }
  if (!/^\d{7,}$/.test(telefono1.replace(/[\s\-\(\)]/g, ''))) {
    showToast('Teléfono 1 inválido. Mínimo 7 dígitos', 'error');
    return;
  }

  // 5. Validar teléfono 2: obligatorio, mínimo 7 dígitos
  if (!telefono2) {
    showToast('Teléfono 2 es obligatorio', 'error');
    return;
  }
  if (!/^\d{7,}$/.test(telefono2.replace(/[\s\-\(\)]/g, ''))) {
    showToast('Teléfono 2 inválido. Mínimo 7 dígitos', 'error');
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
      $('nuevoPacienteNombreMedica').value = '';
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

// ========== DASHBOARD (Admin solo) ==========
// ========== AGENDA ELECTRODIAGNÓSTICO =========
async function initElectro() {
  const hoy = new Date().toISOString().slice(0,10);
  $('electroFecha').value = hoy;
  
  // Generar intervalos de hora (00:00 a 23:00)
  const horaSelect = $('electroHora');
  horaSelect.innerHTML = '<option value="">Seleccionar hora</option>';
  for (let i = 0; i < 24; i++) {
    const hora = String(i).padStart(2, '0') + ':00';
    const option = document.createElement('option');
    option.value = hora;
    option.textContent = formatearHora(hora);
    horaSelect.appendChild(option);
  }
  
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

  // Event listener para cambio en hora
  $('electroHora')?.addEventListener('change', async () => {
    await checkEquiposDisponibilidad();
  });

  // Event listener para cambio en duración
  $('electroDuracion')?.addEventListener('change', async () => {
    await checkEquiposDisponibilidad();
  });
  
  // Event listener para autocompletado de diagnósticos (búsqueda dinámica, sin opciones iniciales)
  $('electroDiagnostico')?.addEventListener('input', debounce(buscarDiagnosticosElectro, 300));
  
  // Validadores en tiempo real
  // Nombre: Solo letras y espacios
  $('electroPacienteNombre')?.addEventListener('input', (e) => {
    const valor = e.target.value;
    if (valor && !/^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s]*$/.test(valor)) {
      // Remover caracteres inválidos
      e.target.value = valor.replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑ\s]/g, '');
    }
  });
  
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
  $('electroTelefono')?.addEventListener('input', (e) => {
    const valor = e.target.value;
    if (valor && !/^\d*$/.test(valor)) {
      // Remover caracteres no numéricos
      e.target.value = valor.replace(/\D/g, '');
    }
    // Limitar a 10 dígitos
    if (e.target.value.length > 10) {
      e.target.value = e.target.value.slice(0, 10);
    }
  });
  
  const nuevaCitaSection = $('electroNuevaCitaSection');
  if (nuevaCitaSection) nuevaCitaSection.style.display = (isRecepcion() || isElectro()) ? '' : 'none';
  if (!isDoctor()) {
    $('crearCitaElectro')?.addEventListener('click', crearCitaElectro);
  }

  // Collapsible "Nueva Cita" form
  const collapseToggle = $('electroNuevaCitaToggle');
  const collapseBtn = $('electroNuevaCitaCollapseBtn');
  const collapseBody = $('electroNuevaCitaBody');
  if (collapseToggle && collapseBody) {
    collapseToggle.addEventListener('click', () => {
      const isCollapsed = collapseBody.classList.toggle('collapsed');
      if (collapseBtn) collapseBtn.textContent = isCollapsed ? '▼ Mostrar' : '▲ Ocultar';
    });
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
    const buscarCitasEl = $('modalBuscarCitasResultados');
    if (buscarCitasEl && !buscarCitasEl.classList.contains('hidden')) {
      buscarCitasEl.classList.add('hidden'); buscarCitasEl.style.display = 'none'; return;
    }
    const buscarEstudiosEl = $('modalBuscarEstudiosResultados');
    if (buscarEstudiosEl && !buscarEstudiosEl.classList.contains('hidden')) {
      buscarEstudiosEl.classList.add('hidden'); buscarEstudiosEl.style.display = 'none'; return;
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
  const fecha = $('electroFecha').value;
  const hora = $('electroHora').value;
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
          <div class="cupo-card-label">${enEstudio ? 'En estudio' : (ocupado ? 'Ocupado' : 'Libre')}</div>
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
      tbody.innerHTML = `<tr><td colspan="10" style="padding:20px;text-align:center;color:#999">No hay citas registradas para esta fecha${mensajeEstudio}</td></tr>`;
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
  
  const nombre = $('electroPacienteNombre').value.trim();
  const doc = $('electroDocumento').value.trim();
  const telefono = $('electroTelefono').value.trim();
  const telefono2 = $('electroTelefono2').value.trim();
  const hora = $('electroHora').value;
  const fecha = $('electroFecha').value;
  const duracion = $('electroDuracion').value.trim();
  const diagnostico = $('electroDiagnostico').value.trim();
  
  if (!nombre || !doc || !telefono || !telefono2 || !hora || !fecha || !diagnostico) { 
    showToast('Completa todos los campos obligatorios', 'error'); 
    return; 
  }
  
  // Validar nombre (solo letras y espacios)
  if (!validarNombre(nombre)) {
    showToast('El nombre no puede contener números o caracteres especiales', 'error');
    $('electroPacienteNombre').focus();
    $('electroPacienteNombre').style.borderColor = '#dc2626';
    return;
  }
  $('electroPacienteNombre').style.borderColor = '';
  
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
  const btnOriginalText = btnCrear ? btnCrear.textContent : 'Crear Cita';
  if (btnCrear) { btnCrear.disabled = true; btnCrear.textContent = '⏳ Guardando...'; }

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
      $('electroPacienteNombre').value = '';
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
    } else {
      showToast(data.error || 'Error creando cita', 'error');
    }
  } catch (e) { 
    showToast('Error creando cita: ' + e.message, 'error'); 
  } finally {
    if (btnCrear) { btnCrear.disabled = false; btnCrear.textContent = btnOriginalText; }
  }
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
    });
  });

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
        
        $('req-length').textContent = checks.length + ' Mínimo 8 caracteres';
        $('req-upper').textContent = checks.upper + ' Al menos una mayúscula (A-Z)';
        $('req-lower').textContent = checks.lower + ' Al menos una minúscula (a-z)';
        $('req-number').textContent = checks.number + ' Al menos un número (0-9)';
        $('req-special').textContent = checks.special + ' Al menos un símbolo (!@#$%^&* etc)';
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
  
  await cargarUsuarios();
}

async function cargarUsuarios() {
  try {
    const res = await apiFetch('/api/usuarios');
    if (res.status === 403) { showToast('No tienes permiso', 'error'); return; }
    const usuarios = await res.json();
    
    if (!usuarios.length) {
      const tbody = $('usuariosTableBody');
      tbody.innerHTML = '<tr><td colspan="6" style="padding:20px;text-align:center;color:#999">No hay usuarios</td></tr>';
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
  tr.querySelector('[data-reset]')?.addEventListener('click', async (e) => {
    if (!confirm(`\u00bfResetear contrase\u00f1a para ${u.usuario}?`)) return;
    try {
      const r = await apiFetch(`/api/usuarios/${e.target.closest('[data-reset]').dataset.reset}/reset-password`, { method: 'PATCH' });
      const d = await r.json();
      if (d.ok) { verResetPassword(d); } else showToast(d.error||'Error', 'error');
    } catch (x) { showToast('Error', 'error'); }
  });
  tr.querySelector('[data-toggle]')?.addEventListener('click', async (e) => {
    const newState = u.activo ? 'desactivar' : 'activar';
    if (!confirm(`\u00bf${newState.charAt(0).toUpperCase() + newState.slice(1)} este usuario?`)) return;
    try {
      const r = await apiFetch(`/api/usuarios/${e.target.closest('[data-toggle]').dataset.toggle}/toggle-estado`, { method: 'PATCH' });
      const d = await r.json();
      if (d.ok) { showToast(`Usuario ${d.activo ? 'activado' : 'desactivado'}`, 'success'); cargarUsuarios(); }
      else showToast(d.error||'Error', 'error');
    } catch (x) { showToast('Error', 'error'); }
  });
  tr.querySelector('[data-del]')?.addEventListener('click', async (e) => {
    if (!confirm('\u00bfEliminar este usuario permanentemente?')) return;
    try {
      const r = await apiFetch(`/api/usuarios/${e.target.closest('[data-del]').dataset.del}`, { method: 'DELETE' });
      const d = await r.json();
      if (d.ok) { showToast('Usuario eliminado', 'success'); cargarUsuarios(); }
      else showToast(d.error||'Error', 'error');
    } catch (x) { showToast('Error', 'error'); }
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
  $('editRol').addEventListener('change', function() {
    mostrarConsultorioEdicion(this.value);
    mostrarEspecialidadEdicion(this.value, null);
  });
  
  // Cambiar especialidad muestra/oculta el campo "Otra"
  $('editEspecialidad')?.addEventListener('change', function() {
    if (this.value === 'Otra') {
      $('editEspecialidadOtraCol').style.display = '';
      $('editEspecialidadOtra').focus();
    } else {
      $('editEspecialidadOtraCol').style.display = 'none';
      $('editEspecialidadOtra').value = '';
    }
  });
  
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
  
  const rolesValidos = ['admin','recepcion','electro','doctor'];
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

async function addRow(desc='', price=0){
  const tbody = document.querySelector('#itemsTable tbody');
  const tr = document.createElement('tr');
  
  const servicios = await getServicios();
  
  const descSelect = `<select class="item-desc">
    <option value="">Seleccionar servicio</option>
    ${servicios.map(s => `<option value="${escapeHtml(s.nombre).replace(/"/g, '&quot;')}" ${desc === s.nombre ? 'selected' : ''}>${escapeHtml(s.nombre)}</option>`).join('')}
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

  const medicoSel = $('reciboMedico');
  const medicoId  = medicoSel && medicoSel.value ? parseInt(medicoSel.value, 10) : null;
  const medicoNombre = medicoSel && medicoSel.value ? (medicoSel.options[medicoSel.selectedIndex]?.text || null) : null;

  const servSel = $('reciboTipoServicio');
  const tipoServicio = servSel && servSel.value ? servSel.value : null;

  return {
    numero: $('numero').value,
    fecha: $('fecha').value,
    cliente: $('cliente').value,
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
  const cliente = $('cliente')?.value.trim();
  const docCliente = $('docCliente')?.value.trim();
  const fecha = $('fecha')?.value.trim();

  if (!cliente) { showToast('Por favor escribe el nombre del paciente', 'error'); return false; }
  if (!docCliente) { showToast('Por favor escribe el documento del paciente', 'error'); return false; }
  if (!fecha) { showToast('Por favor selecciona una fecha', 'error'); return false; }

  const tipoPago = document.querySelector('input[name="tipoPago"]:checked')?.value;
  if (!tipoPago) { showToast('Selecciona la forma de pago (Efectivo o Transferencia)', 'error'); return false; }

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
      numero: payload.numero,
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
      showToast('✓ Recibo guardado', 'success');
      updateSavedCount();
      nextNumber();
    } else {
      showToast('Error guardando: ' + (json.error || 'desconocido'), 'error');
    }
  } catch(e) {
    console.error(e);
    showToast('Error de conexión al guardar recibo', 'error');
  }
}

function resetFormulario() {
  if ($('cliente')) $('cliente').value = '';
  if ($('docCliente')) $('docCliente').value = '';
  if ($('observ')) $('observ').value = '';

  // Limpiar tipo de pago
  document.querySelectorAll('input[name="tipoPago"]').forEach(r => { r.checked = false; });
  document.getElementById('radioPagoPCard')?.classList.remove('selected');
  document.getElementById('radioPagoTCard')?.classList.remove('selected');
  if ($('reciboEntidad')) $('reciboEntidad').value = '';

  // Limpiar médico y servicio
  if ($('reciboMedico')) $('reciboMedico').value = '';
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
      showToast('El navegador bloqueó la ventana emergente. Permite los popups para este sitio.', 'error');
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
  if (tbody) tbody.innerHTML = '<tr><td colspan="10" style="padding:24px;text-align:center;color:#999">Aplica un filtro para ver los recibos</td></tr>';
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
      if (res.status === 401) { showToast('Sesión expirada', 'error'); setTimeout(() => showView('view-login'), 1200); }
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
      tbody.innerHTML = '<tr><td colspan="10" style="padding:24px;text-align:center;color:#999">No hay recibos con los filtros aplicados</td></tr>';
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

    tbody.querySelectorAll('.delete').forEach(b => b.addEventListener('click', async e => {
      if (!confirm('¿Eliminar este recibo?')) return;
      try {
        const jr = await apiFetch(`/api/recibos/${e.target.dataset.id}`, { method: 'DELETE' }).then(r => r.json());
        if (jr.ok) { showToast('Recibo eliminado', 'success'); cargarLista(_recibosLastParams); }
      } catch (_) { showToast('Error eliminando recibo', 'error'); }
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

async function resetAllRecibos(){
  if(!confirm('¿Eliminar TODOS los recibos guardados? Esta acción no se puede deshacer.\nSolo los administradores pueden realizar esta operación.')) return;
  if(!confirm('Confirma: ¿Eliminar todos los recibos?')) return;
  
  showLoader(true);
  try {
    const res = await apiFetch('/api/recibos/reset', { method: 'DELETE' });
    const json = await res.json();
    showLoader(false);
    if(json.ok) {
      showToast('✓ Todos los recibos han sido eliminados', 'success');
      cargarLista();
      nextNumber();
    }
  } catch(e) {
    showLoader(false);
    showToast('Error al resetear', 'error');
    console.error(e);
  }
}

// (setDefaultReportDates, generarReporteDiario, generarReporteMensual eliminados — reemplazados por filtros en Ver Recibos)

// ============================================
// GESTIONAR CUENTA
// ============================================
function openCambiarContrasenaModal() {
  const modal = $('modalCambiarContrasena');
  if (modal) {
    modal.classList.remove('hidden');
    $('formCambiarContrasena').reset();
    $('cambiarContrasenaError').classList.add('hidden');
    
    // Cargar nombre actual
    const nombreSpan = $('menuUserName');
    if (nombreSpan) {
      const nombreCompleto = nombreSpan.textContent.split(' ').pop(); // Obtener del menú
      // Mejor aún, hacer una búsqueda del nombre en sesión
      $('cuentaNombreActual').value = sessionStorage.getItem('nombre_usuario') || '';
    }
  }
}

function closeCambiarContrasenaModal() {
  const modal = $('modalCambiarContrasena');
  if (modal) {
    modal.classList.add('hidden');
    $('formCambiarContrasena').reset();
  }
}

// Event listener para el formulario de gestionar cuenta
document.addEventListener('DOMContentLoaded', () => {
  // Setup botones de cerrar modal de cambiar contraseña
  const modalCambiarContrasena = $('modalCambiarContrasena');
  if (modalCambiarContrasena) {
    // Botón X de cerrar
    const btnCloseX = modalCambiarContrasena.querySelector('button.btn-close-modal');
    if (btnCloseX) {
      btnCloseX.addEventListener('click', closeCambiarContrasenaModal);
    }
    
    // Botón Cancelar
    const btnsCancelar = modalCambiarContrasena.querySelectorAll('button[type="button"]');
    btnsCancelar.forEach(btn => {
      if (btn.textContent.includes('Cancelar')) {
        btn.addEventListener('click', closeCambiarContrasenaModal);
      }
    });
  }
  
  // Setup botones de cerrar modal de editar usuario
  const modalEditarUsuario = $('modalEditarUsuario');
  if (modalEditarUsuario) {
    const btnCloseX = modalEditarUsuario.querySelector('button.btn-close-modal');
    if (btnCloseX) {
      btnCloseX.addEventListener('click', closeEditarUsuarioModal);
    }
    
    const btnsCancelar = modalEditarUsuario.querySelectorAll('button[type="button"]');
    btnsCancelar.forEach(btn => {
      if (btn.textContent.includes('Cancelar')) {
        btn.addEventListener('click', closeEditarUsuarioModal);
      }
    });
  }
  
  // Setup botones de cerrar modal de historial
  const modalHistorial = $('modalHistorial');
  if (modalHistorial) {
    const btnCloseX = modalHistorial.querySelector('button.btn-close-modal');
    if (btnCloseX) {
      btnCloseX.addEventListener('click', closeHistorialModal);
    }
    
    const btnsCerrar = modalHistorial.querySelectorAll('button[type="button"]');
    btnsCerrar.forEach(btn => {
      if (btn.textContent.includes('Cerrar')) {
        btn.addEventListener('click', closeHistorialModal);
      }
    });
  }
  
  // Setup botones de cerrar modal de reset password
  const modalResetPassword = $('modalResetPassword');
  if (modalResetPassword) {
    const btnCloseX = modalResetPassword.querySelector('button.btn-close-modal');
    if (btnCloseX) {
      btnCloseX.addEventListener('click', closeResetPasswordModal);
    }
    
    const btnsEntendido = modalResetPassword.querySelectorAll('button[type="button"]');
    btnsEntendido.forEach(btn => {
      if (btn.textContent.includes('Entendido')) {
        btn.addEventListener('click', closeResetPasswordModal);
      }
    });
  }
  
  // Setup toggle buttons para "Mi Cuenta"
  const toggleBtns = ['toggleContrasenaActual', 'toggleNuevaContrasena', 'toggleConfirmarContrasena', 'toggleEditPassword'];
  const inputIds = ['contrasenaActual', 'nuevaContrasena', 'confirmarContrasena', 'editPassword'];
  
  toggleBtns.forEach((btnId, idx) => {
    const btn = $(btnId);
    const input = $(inputIds[idx]);
    if (btn && input) {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const type = input.type === 'password' ? 'text' : 'password';
        input.type = type;
        // El emoji 👁 es el mismo para ambos estados - visualmente claro
      });
    }
  });
  
  // Setup password requirements display para "Cambiar Contraseña"
  const nuevaContrasenaInput = $('nuevaContrasena');
  const requirementsContainer = $('cambiarContrasenaRequirements');
  if (nuevaContrasenaInput && requirementsContainer) {
    nuevaContrasenaInput.addEventListener('input', () => {
      const password = nuevaContrasenaInput.value;
      if (password) {
        requirementsContainer.style.display = 'block';
        // Actualizar requisitos
        const hasLength = password.length >= 8;
        const hasUpper = /[A-Z]/.test(password);
        const hasLower = /[a-z]/.test(password);
        const hasNumber = /[0-9]/.test(password);
        
        updateRequirementItem('cambiar-req-length', hasLength, 'Mínimo 8 caracteres');
        updateRequirementItem('cambiar-req-upper', hasUpper, 'Al menos una mayúscula (A-Z)');
        updateRequirementItem('cambiar-req-lower', hasLower, 'Al menos una minúscula (a-z)');
        updateRequirementItem('cambiar-req-number', hasNumber, 'Al menos un número (0-9)');
      } else {
        requirementsContainer.style.display = 'none';
      }
    });
  }
  
  // Setup toggle button para "Editar Usuario"
  const toggleEditBtn = $('toggleEditPassword');
  const editPasswordInput = $('editPassword');
  if (toggleEditBtn && editPasswordInput) {
    toggleEditBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const type = editPasswordInput.type === 'password' ? 'text' : 'password';
      editPasswordInput.type = type;
      toggleEditBtn.textContent = type === 'password' ? 'Mostrar' : 'Ocultar';
    });
  }
  
  const form = $('formCambiarContrasena');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const nombre = $('cuentaNombreActual').value.trim();
      const contrasenaActual = $('contrasenaActual').value;
      const nuevaContrasena = $('nuevaContrasena').value;
      const confirmarContrasena = $('confirmarContrasena').value;
      const errorDiv = $('cambiarContrasenaError');

      // Validar que al menos nombre o contraseña sea proporcionado
      if (!nombre && !nuevaContrasena) {
        errorDiv.textContent = 'Debe cambiar al menos su nombre o contraseña';
        errorDiv.classList.remove('hidden');
        return;
      }

      // Si va a cambiar contraseña, validar los campos
      if (nuevaContrasena) {
        if (!contrasenaActual) {
          errorDiv.textContent = 'Se requiere tu contraseña actual para cambiar la contraseña';
          errorDiv.classList.remove('hidden');
          return;
        }

        if (!confirmarContrasena) {
          errorDiv.textContent = 'Debe confirmar la nueva contraseña';
          errorDiv.classList.remove('hidden');
          return;
        }

        if (nuevaContrasena !== confirmarContrasena) {
          errorDiv.textContent = 'Las contraseñas no coinciden';
          errorDiv.classList.remove('hidden');
          return;
        }

        if (nuevaContrasena.length < 6) {
          errorDiv.textContent = 'La contraseña debe tener al menos 6 caracteres';
          errorDiv.classList.remove('hidden');
          return;
        }
      }

      try {
        const body = {
          nombre: nombre || null
        };

        // Solo incluir contraseña si está siendo cambiada
        if (nuevaContrasena) {
          body.contrasenaActual = hashPassword(contrasenaActual);
          body.nuevaContrasena = hashPassword(nuevaContrasena);
          body.confirmarContrasena = hashPassword(confirmarContrasena);
        }

        const res = await apiFetch('/api/cambiar-contrasena', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });

        const data = await res.json();

        if (!res.ok) {
          errorDiv.textContent = data.error || 'Error al actualizar cuenta';
          errorDiv.classList.remove('hidden');
          return;
        }

        showToast(data.mensaje, 'success');
        
        // Actualizar nombre en sesión y menú
        if (data.nombre) {
          sessionStorage.setItem('nombre_usuario', data.nombre);
          const menuUserName = $('menuUserName');
          if (menuUserName) {
            menuUserName.textContent = `${data.nombre}`;
          }
        }
        
        closeCambiarContrasenaModal();
      } catch (error) {
        errorDiv.textContent = 'Error en la solicitud';
        errorDiv.classList.remove('hidden');
        console.error(error);
      }
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
  try {
    const res = await apiFetch('/api/diagnosticos');
    const diagnosticos = await res.json();

    if (diagnosticos.length === 0) {
      const tbody = $('diagnosticosTableBody');
      tbody.innerHTML = '<tr><td colspan="5" style="padding:20px;text-align:center;color:#999">Sin diagnósticos cargados</td></tr>';
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
    const tbody = $('diagnosticosTableBody');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="5" style="padding:20px;text-align:center;color:#dc2626">Error cargando diagnósticos</td></tr>';
    }
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
  
  tr.querySelector('.btn-eliminar-diag')?.addEventListener('click', async (e) => {
    const id = e.target.dataset.id;
    if (confirm('¿Está seguro que desea eliminar este diagnóstico?')) {
      try {
        await apiFetch(`/api/diagnosticos/${id}`, { method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({activo: 0}) });
        showToast('Diagnóstico eliminado', 'success');
        cargarListaDiagnosticos();
      } catch (x) {
        showToast('Error eliminando diagnóstico', 'error');
      }
    }
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

// Función para enviar recomendaciones por WhatsApp
function enviarRecomendacionesWhatsApp(cita) {
  if (!cita) {
    showToast('Error: No hay cita seleccionada', 'error');
    return;
  }

  // Validar que haya teléfono
  if (!cita.telefono) {
    showToast('Error: El paciente no tiene teléfono registrado', 'error');
    return;
  }

  // Crear un input file oculto
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.pdf';
  fileInput.style.display = 'none';

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Guardar temporalmente el archivo seleccionado
    citaParaWhatsApp = {
      cita: cita,
      archivo: file
    };

    // Mostrar modal con información de la cita y el archivo
    mostrarModalEnviarWhatsApp(cita, file.name);
  });

  document.body.appendChild(fileInput);
  fileInput.click();
  document.body.removeChild(fileInput);
}

// Variable global para guardar la información temporalmente
let citaParaWhatsApp = null;

// Función para mostrar modal de confirmación
function mostrarModalEnviarWhatsApp(cita, nombreArchivo) {
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

        <div style="margin-bottom:20px;padding:16px;background:#f0fdf4;border-left:4px solid #059669;border-radius:8px">
          <p style="margin:0 0 12px 0;font-size:0.85rem;color:#059669;font-weight:600">📎 ARCHIVO SELECCIONADO</p>
          <div style="font-size:0.95rem;color:#1f2937;font-weight:500" id="whatsappNombreArchivo">-</div>
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
    $('cerrarModalWhatsApp').addEventListener('click', () => {
      modal.classList.add('hidden');
      modal.style.display = 'none';
    });

    $('btnCancelarWhatsApp').addEventListener('click', () => {
      modal.classList.add('hidden');
      modal.style.display = 'none';
    });

    $('btnConfirmarWhatsApp').addEventListener('click', enviarPorWhatsApp);
  }

  // Llenar datos del modal
  $('whatsappNombrePaciente').textContent = escapeHtml(cita.paciente_nombre || '-');
  $('whatsappDocumento').textContent = escapeHtml(cita.paciente_documento || '-');
  $('whatsappTelefono').textContent = escapeHtml(cita.telefono || '-');
  $('whatsappNombreArchivo').textContent = nombreArchivo;
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
  const archivo = citaParaWhatsApp.archivo;
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

  showToast(`WhatsApp abierto. Adjunta el archivo: ${archivo.name}`, 'success');
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
  
  // Mostrar botón de eliminar solo para admin
  const btnEliminar = $('btnEliminarCita');
  if (currentUser && (currentUser.rol === 'admin' || currentUser.rol === 'administrador')) {
    btnEliminar.style.display = '';
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

  // Control de equipo: bloqueado si En Estudio
  const equipoBloqueado = estado === 'En Estudio' || estado === 'Completado';
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
      </div>`;
    document.getElementById('flujo-btn-finalizar').onclick = () => finalizarEstudioModal();

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
  
  // Verificar que sea admin
  const esAdmin = currentUser && (currentUser.rol === 'admin' || currentUser.rol === 'administrador');
  
  if (!esAdmin) {
    showToast('No tienes permisos para eliminar citas', 'error');
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
  
  // Llenar información del paciente
  $('modalMedicaPaciente').textContent = escapeHtml(turno.paciente_nombre || '-');
  $('modalMedicaHora').textContent = formatearHora(turno.hora) || '-';
  $('modalReprogramarMedicaFechaActual').innerHTML = `<strong>${formatearFecha(turno.fecha)}</strong> a las <strong>${formatearHora(turno.hora)}</strong>`;
  
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

// Botón: Reprogramar
$('btnEstadoReprogramar')?.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (!currentTurnoMedicaData) return;
  
  currentEstadoAction = 'reprogramar';
  cerrarModalEstadoCitaMedica();
  
  // Abrir modal de reprogramación
  $('modalReprogramarMedica').classList.remove('hidden');
  
  // Limpiar campos
  $('modalReprogramarMedicaFecha').value = '';
  $('modalReprogramarMedicaHora').value = '';
});

// Botón: Cancelado por Paciente
$('btnEstadoCanceladoPaciente')?.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (!currentTurnoMedicaData) return;
  
  currentEstadoAction = 'cancelado-paciente';
  cerrarModalEstadoCitaMedica();
  
  // Preguntar si desea reprogramar
  $('modalConfirmReprogramacionTitle').textContent = '¿Desea reprogramar esta cita?';
  $('modalConfirmReprogramacionMessage').textContent = 'El paciente canceló la cita. ¿Desea reprogramarla para otro día?';
  $('modalConfirmReprogramacion').classList.remove('hidden');
});

// Botón: No Asistió
$('btnEstadoNoAsistio')?.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (!currentTurnoMedicaData) return;
  
  currentEstadoAction = 'no-asistio';
  cerrarModalEstadoCitaMedica();
  
  // Preguntar si desea reprogramar
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
    cerrarModalConfirmReprogramacion();
    
    // Abrir modal de reprogramación
    $('modalReprogramarMedica').classList.remove('hidden');
    $('modalReprogramarMedicaFecha').value = '';
    $('modalReprogramarMedicaHora').value = '';
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
});
$('modalReprogramarMedica')?.addEventListener('click', (e) => {
  if (e.target === $('modalReprogramarMedica')) {
    cerrarModalReprogramarMedica();
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
  
  try {
    // Mostrar el modal con estado de carga
    const modal = $('modalBuscarCitasResultados');
    const tbody = $('modalBuscarCitasBody');
    tbody.innerHTML = '<tr><td colspan="5" style="padding:20px;text-align:center;color:#999">Cargando...</td></tr>';
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
    
    // Buscar en citas médicas
    const res = await apiFetch(`/api/turnos?buscar=${encodeURIComponent(documento)}`);
    const citas = await res.json();
    
    if (!citas || citas.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="padding:20px;text-align:center;color:#7f1d1d">❌ No se encontraron citas para el documento "${documento}"</td></tr>`;
      return;
    }
    
    // Llenar la tabla
    let html = '';
    citas.forEach(cita => {
      const rawFecha = cita.fecha ? String(cita.fecha).slice(0, 10) : '';
      const [y, m, d] = rawFecha.split('-');
      const fecha = y ? new Date(parseInt(y), parseInt(m) - 1, parseInt(d)).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '-';
      const hora = escapeHtml(cita.hora || '-');
      const docPaciente = escapeHtml(cita.paciente_documento || '-');
      const nombre = escapeHtml(cita.paciente_nombre || '-');
      const tipoConsulta = escapeHtml(cita.tipo_consulta || '-');
      
      html += `
        <tr style="border-bottom:1px solid #e5e7eb;hover-background:#f9fafb">
          <td style="padding:12px;color:#374151">${fecha}</td>
          <td style="padding:12px;color:#374151">${hora}</td>
          <td style="padding:12px;color:#374151;font-weight:500">${docPaciente}</td>
          <td style="padding:12px;color:#1f2937;font-weight:500">${nombre}</td>
          <td style="padding:12px;color:#374151">${tipoConsulta}</td>
        </tr>
      `;
    });
    
    tbody.innerHTML = html;
  } catch (e) {
    console.error('Error buscando citas:', e);
    const tbody = $('modalBuscarCitasBody');
    tbody.innerHTML = '<tr><td colspan="5" style="padding:20px;text-align:center;color:#dc2626">Error al buscar citas</td></tr>';
  }
}

async function buscarEstudiosPorDocumento() {
  const documento = $('buscarEstudioDocumento').value.trim();
  if (!documento) return;

  const modal = $('modalBuscarEstudiosResultados');
  const tbody = $('modalBuscarEstudiosBody');
  tbody.innerHTML = '<tr><td colspan="6" style="padding:20px;text-align:center;color:#999">Cargando...</td></tr>';
  modal.classList.remove('hidden');
  modal.style.display = 'flex';

  try {
    const res = await apiFetch(`/api/citas-electro?buscar=${encodeURIComponent(documento)}`);
    const citas = await res.json();

    if (!citas || citas.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="padding:20px;text-align:center;color:#7f1d1d">❌ No se encontraron estudios para el documento "${documento}"</td></tr>`;
      return;
    }

    let html = '';
    citas.forEach(cita => {
      const [y,m,d] = (cita.fecha || '').split('-');
      const fecha = y ? new Date(parseInt(y), parseInt(m)-1, parseInt(d)).toLocaleDateString('es-ES', {day:'2-digit',month:'2-digit',year:'numeric'}) : '-';
      html += `
        <tr style="border-bottom:1px solid #e5e7eb">
          <td style="padding:12px;color:#374151">${fecha}</td>
          <td style="padding:12px;color:#374151">${escapeHtml(cita.hora_agendamiento || '-')}</td>
          <td style="padding:12px;color:#374151;font-weight:500">${escapeHtml(cita.paciente_documento || '-')}</td>
          <td style="padding:12px;color:#1f2937;font-weight:500">${escapeHtml(cita.paciente_nombre || '-')}</td>
          <td style="padding:12px;color:#374151">${escapeHtml(cita.estudio || '-')}</td>
          <td style="padding:12px">${estadoBadge(cita.estado)}</td>
        </tr>
      `;
    });
    tbody.innerHTML = html;
  } catch (e) {
    console.error('Error buscando estudios:', e);
    tbody.innerHTML = '<tr><td colspan="6" style="padding:20px;text-align:center;color:#dc2626">Error al buscar estudios</td></tr>';
  }
}

// buscarRecibosPorDocumento removed — replaced by buscarCitaParaRecibo in new Recibos UI

// Event listeners para buscadores
$('btnBuscarCitaDocumento')?.addEventListener('click', buscarCitasPorDocumento);
$('buscarCitaDocumento')?.removeEventListener('keypress', buscarCitasPorDocumento);
$('btnLimpiarCitaDocumento')?.addEventListener('click', () => {
  $('buscarCitaDocumento').value = '';
  const modal = $('modalBuscarCitasResultados');
  if (modal) modal.classList.add('hidden');
});

// Event listeners para cerrar modal de búsqueda de citas
$('cerrarModalBuscarCitas')?.addEventListener('click', () => {
  const modal = $('modalBuscarCitasResultados');
  if (modal) modal.classList.add('hidden');
});
$('btnCerrarBuscarCitas')?.addEventListener('click', () => {
  const modal = $('modalBuscarCitasResultados');
  if (modal) modal.classList.add('hidden');
});

// Cerrar modal al hacer clic fuera
document.addEventListener('click', (e) => {
  const modal = $('modalBuscarCitasResultados');
  if (modal && e.target === modal) {
    modal.classList.add('hidden');
  }
});

$('btnBuscarEstudioDocumento')?.addEventListener('click', buscarEstudiosPorDocumento);
$('btnLimpiarEstudioDocumento')?.addEventListener('click', () => {
  $('buscarEstudioDocumento').value = '';
  const m = $('modalBuscarEstudiosResultados');
  if (m) { m.classList.add('hidden'); m.style.display = 'none'; }
});
$('cerrarModalBuscarEstudios')?.addEventListener('click', () => {
  const m = $('modalBuscarEstudiosResultados');
  if (m) { m.classList.add('hidden'); m.style.display = 'none'; }
});
$('btnCerrarBuscarEstudios')?.addEventListener('click', () => {
  const m = $('modalBuscarEstudiosResultados');
  if (m) { m.classList.add('hidden'); m.style.display = 'none'; }
});
document.addEventListener('click', (e) => {
  const m = $('modalBuscarEstudiosResultados');
  if (m && e.target === m) { m.classList.add('hidden'); m.style.display = 'none'; }
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
    tbody.innerHTML = '<tr><td colspan="8" style="padding:20px;text-align:center;color:#999">No hay pacientes que coincidan con los filtros</td></tr>';
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
  const documento = $('esperaDocumento').value.trim();
  const nombres   = $('esperaNombres').value.trim();
  const apellidos = $('esperaApellidos').value.trim();
  const entidad   = $('esperaEntidad').value;
  const prioridad = $('esperaPrioridad').value;

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
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Guardando...'; }

  try {
    const res = await apiFetch('/api/pacientes-espera', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        documento, nombres, apellidos, entidad, prioridad,
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
    await cargarEsperaElectro();
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Agregar a Lista'; }
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
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Guardando...'; }
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
  finally { if (btn) { btn.disabled = false; btn.textContent = 'Agregar Especialidad'; } }
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

async function eliminarEspecialidad(id, nombre) {
  if (!confirm(`¿Eliminar la especialidad "${nombre}" y todos sus tipos de consulta?\nEsta acción no se puede deshacer.`)) return;
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
  if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
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
  finally { if (btn) { btn.disabled = false; btn.textContent = 'Agregar'; } }
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

async function eliminarTipoConsulta(id) {
  if (!confirm('¿Eliminar este tipo de consulta?')) return;
  try {
    const res = await apiFetch(`/api/tipos-consulta/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!data.ok) { showToast(data.error || 'Error', 'error'); return; }
    showToast('Tipo eliminado', 'success');
    await cargarTiposConsultaPanel();
  } catch (e) { showToast('Error: ' + e.message, 'error'); }
}
