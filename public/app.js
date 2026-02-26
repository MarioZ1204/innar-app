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
    element.textContent = (isMet ? '✅' : '❌') + ' ' + text;
    element.style.color = isMet ? '#16a34a' : '#dc2626';
  }
}

const lsKeySelectedDoctor = 'selected_doctor_v1';
let lastReciboId = null;

// Usuario actual (rol: admin, recepcion, electro, doctor)
let currentUser = null;
let currentModule = null;
let selectedDoctorId = null;
let citaElectroSeleccionada = null;
let selectedDoctorEspecialidad = null;
let selectedDiagnosticoElectroId = null;
let selectedEquipoElectroId = null;
let selectedEstudioDuracion = null; // Duración en minutos del estudio seleccionado
let filtroEstudioElectro = 'todas'; // Filtro de estudio en tabla de citas

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
let lastTurnoNumber1Id = null; // Guardar cuál fue el último turno con número 1
let globalHayEnAtencion = false; // Variable global para rastrear si hay turno EN_ATENCION

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
      updateMenuByRole();
      mostrarSaludoDoctor();
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

let initRecibosDone = false, initAgendaDone = false, initElectroDone = false, initUsuariosDone = false, initDiagnosticosDone = false;
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
}

// Escapar HTML para evitar XSS al insertar en innerHTML
function escapeHtml(str) {
  if (str == null) return '';
  const s = String(str);
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

/**
 * Formatea una hora al formato HH:MM
 * Maneja: null, undefined, '', 'null', HH:MM, HH:MM:SS
 * @param {string|null} valor - La hora a formatear
 * @returns {string} Hora en formato HH:MM o '-' si es inválida
 */
function formatearHora(valor) {
  if (valor === null || valor === undefined || valor === '' || valor === 'null') {
    return '-';
  }
  const strValor = String(valor).trim();
  if (strValor.length >= 5) {
    return strValor.substring(0, 5); // HH:MM
  }
  return strValor || '-';
}

// Servicios por defecto
const serviciosDefault = [
  { nombre: 'Electroencefalograma Computarizado' },
  { nombre: 'Electroencefalograma Convencional'},
  { nombre: 'Monitorización Electroencefalográfica por video y radio'},
  { nombre: 'Polisomnografía'},
  { nombre: 'Polisomnograma en Titulación de CPAP/BPAP' },
  { nombre: 'Test de Latencia Múltiple'},
  { nombre: 'Polisomnograma Noche Dividida' }
];

function getServicios() {
  const stored = localStorage.getItem(lsKeyServicios);
  return stored ? JSON.parse(stored) : serviciosDefault;
}

function saveServicios(servicios) {
  localStorage.setItem(lsKeyServicios, JSON.stringify(servicios));
  updateServiciosSelects();
}

function editServicio(idx) {
  const servicios = getServicios();
  const nuevoNombre = prompt('Editar servicio:', servicios[idx].nombre);
  if(nuevoNombre && nuevoNombre.trim()) {
    servicios[idx].nombre = nuevoNombre.trim();
    saveServicios(servicios);
    renderServiciosList();
    showToast('Servicio actualizado', 'success');
  }
}

function renderServiciosList() {
  const servicios = getServicios();
  const list = $('serviciosList');
  list.innerHTML = '';
  servicios.forEach((s, idx) => {
    const div = document.createElement('div');
    div.className = 'servicio-item';
    const span = document.createElement('span');
    span.textContent = s.nombre;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Editar';
    btn.addEventListener('click', () => editServicio(idx));
    div.appendChild(span);
    div.appendChild(btn);
    list.appendChild(div);
  });
}

function updateServiciosSelects() {
  const servicios = getServicios();
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
    loader.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:9999';
    loader.innerHTML = '<div style="background:white;padding:20px;border-radius:8px;text-align:center"><div style="font-size:24px;margin-bottom:10px"></div><div>Procesando...</div></div>';
    document.body.appendChild(loader);
  }
  loader.style.display = show ? 'flex' : 'none';
}

// Mostrar toast
function showToast(msg, type = 'info') {
  const toast = document.createElement('div');
  toast.style.cssText = `position:fixed;top:20px;right:20px;padding:12px 20px;border-radius:6px;background:${type === 'error' ? '#ef4444' : type === 'success' ? '#10b981' : '#3b82f6'};color:white;z-index:9998;max-width:400px;box-shadow:0 4px 12px rgba(0,0,0,0.15)`;
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
        const type = passwordInput.type === 'password' ? 'text' : 'password';
        passwordInput.type = type;
        toggleBtn.textContent = type === 'password' ? '👁️' : '👁️‍🗨️';
      });
    }
    
    // Detector de Caps Lock (tiempo real)
    if (passwordInput && capsWarning) {
      const checkCapsLock = (e) => {
        const isCapsLockOn = e.getModifierState('CapsLock');
        capsWarning.style.display = isCapsLockOn ? 'block' : 'none';
      };
      
      // Escuchar keydown, keyup y keypress para detectar en tiempo real
      passwordInput.addEventListener('keydown', checkCapsLock);
      passwordInput.addEventListener('keyup', checkCapsLock);
      passwordInput.addEventListener('keypress', checkCapsLock);
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

function cargarTiposConsultaSegunEspecialidad(especialidad) {
  const selectTipo = $('nuevoTurnoTipoMedica');
  if (!selectTipo) return;
  
  // Limpiar opciones actuales excepto la primera (vacía)
  selectTipo.innerHTML = '<option value="">Seleccionar</option>';
  
  // Obtener tipos de consulta según especialidad
  const tipos = ESPECIALIDAD_TIPOS_CONSULTA[especialidad] || [];
  
  tipos.forEach(tipo => {
    const option = document.createElement('option');
    option.value = tipo;
    option.textContent = tipo;
    selectTipo.appendChild(option);
  });
  
  // Remover listeners anteriores para evitar duplicados
  selectTipo.removeEventListener('change', manejarCambioTipoConsulta);
  // Agregar nuevo listener
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
  setDefaultReportDates();
  const addItem = document.getElementById('addItem');
  if (addItem) addItem.addEventListener('click', ()=> addRow());
  if ($('generate')) $('generate').addEventListener('click', generatePreview);
  if ($('resetAll')) $('resetAll').addEventListener('click', resetAllRecibos);
  if ($('print')) $('print').addEventListener('click', abrirPDF);
  if ($('downloadPDF')) $('downloadPDF').addEventListener('click', descargarPDFAnterior);
  if ($('reportDiaBtn')) $('reportDiaBtn').addEventListener('click', generarReporteDiario);
  if ($('reportMesBtn')) $('reportMesBtn').addEventListener('click', generarReporteMensual);
  const addServ = document.getElementById('addServicio');
  if (addServ) addServ.addEventListener('click', () => {
    const nombre = $('newServicioNombre').value.trim();
    if(!nombre) { showToast('Ingresa el nombre del servicio', 'error'); return; }
    const servicios = getServicios();
    if(servicios.some(s => s.nombre.toLowerCase() === nombre.toLowerCase())) { showToast('Este servicio ya existe', 'error'); return; }
    servicios.push({ nombre, precio: 0 });
    saveServicios(servicios);
    $('newServicioNombre').value = '';
    renderServiciosList();
    showToast('Servicio agregado', 'success');
  });
  const docCliente = document.getElementById('docCliente');
  if (docCliente) docCliente.addEventListener('input', function() { this.value = this.value.replace(/[^0-9]/g, ''); });
  const entidad = document.getElementById('entidad');
  if (entidad) entidad.addEventListener('change', function() {
    const otherContainer = document.getElementById('entidadOtraContainer');
    const otherInput = document.getElementById('entidadOtra');
    if(this.value === 'Otra') { otherContainer.style.display = 'block'; otherInput.focus(); }
    else { otherContainer.style.display = 'none'; otherInput.value = ''; }
  });
  cargarLista();
  initRecibosDone = true;
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
    btnProgramar.textContent = isDoctor() ? 'Programar Agenda' : 'Agenda Programada';
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
        if (titleHeader) titleHeader.textContent = isDoctor() ? 'Programar Agenda' : 'Agenda Programada';
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
    btnMarcar.style.opacity = '0.5';
    btnMarcar.title = 'No hay paciente en atención';
  }
  
  $('btnLlamarSiguiente')?.addEventListener('click', llamarSiguientePaciente);
  $('btnMarcarAtendido')?.addEventListener('click', marcarAtendido);
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
    o.textContent = val;
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
          tr.innerHTML = `<td style="padding:8px;border:1px solid #ddd">${escapeHtml(r.fecha)}</td><td style="padding:8px;border:1px solid #ddd">${escapeHtml(r.hora_inicio)}</td><td style="padding:8px;border:1px solid #ddd">${escapeHtml(r.hora_fin||'')}</td><td style="padding:8px;border:1px solid #ddd">${r.disponible? 'Sí':'No'}</td>`; 
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
    
    // Solo animar si el turno con número 1 es DIFERENTE al anterior
    // (es decir, un paciente que no tenía número 1 ahora tiene número 1)
    if (firstWithNum1 && firstWithNum1.id !== lastTurnoNumber1Id) {
      animateTargetId = firstWithNum1.id;
      lastTurnoNumber1Id = firstWithNum1.id; // Recordar el nuevo paciente con número 1
    }

    // Crear 25 filas: algunas con datos, otras vacías
    tbody.innerHTML = '';
    const filasRequeridas = 25;
    const colspan = isDoctor() ? 8 : 9;
    
    // Verificar si hay algún turno EN_ATENCION
    const hayEnAtencion = turnos.some(t => t.estado === 'EN_ATENCION');
    globalHayEnAtencion = hayEnAtencion; // Guardar en variable global
    
    for (let i = 0; i < filasRequeridas; i++) {
      if (i < turnos.length) {
        // Llenar con datos reales
        renderTurnoRowMedica(tbody, turnos[i], animateTargetId, hayEnAtencion);
      } else {
        // Crear fila vacía
        crearFilaTurnoVacia(tbody, colspan, isDoctor());
      }
    }
    
    // Actualizar estado del botón "Marcar como atendido"
    updateMarcarAtendidoButton(turnos);
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
    html += '<td style="padding:8px;border:1px solid #ddd;background:#fafafa">&nbsp;</td>';
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
    btnMarcar.style.opacity = '1';
    btnMarcar.title = `Paciente en atención: ${turnoEnAtencion.paciente_nombre}`;
  } else {
    btnMarcar.disabled = true;
    btnMarcar.style.opacity = '0.5';
    btnMarcar.title = 'No hay paciente en atención';
  }
}

let selectedTurnoMedica = null;

function renderTurnoRowMedica(tbody, t, animateTargetId, hayEnAtencion) {
  // DEBUG: registra objeto turno para detectar desalineamientos en la tabla (remover cuando se confirme)
  if (window && window.location && window.location.search && window.location.search.indexOf('debugTurnos') !== -1) {
    console.debug('DEBUG turno object:', t);
  }
  const tr = document.createElement('tr');
  tr.className = `turno-row estado-${t.estado}`;

  const esAtendido = t.estado === 'ATENDIDO';
  const esEnAtencion = t.estado === 'EN_ATENCION';

  // Doctor y usuario electro no editan por dropdown (doctor usa botones especiales)
  let canEdit = !isElectro() && !isDoctor();
  // No permitir edición desde dropdown cuando está EN_ATENCION o ATENDIDO
  if (esEnAtencion || esAtendido) canEdit = false;

  // Opciones generales 
  let estadosDisponibles = ['PROGRAMADO','EN_SALA','EN_ATENCION','CANCELADO','NO_ASISTIO','REPROGRAMADO'];

  const opts = estadosDisponibles.map(e => `<option value="${e}" ${t.estado===e?'selected':''}>${e ? e.replace(/_/g,' ') : ''}</option>`).join('');

  const estadoCell = canEdit
    ? `<select class="btn-estado" data-id="${t.id}">${opts}</select>`
    : escapeHtml((t.estado||'').replace(/_/g,' '));

  // Deshabilitar botones según rol:
  // ADMIN: solo deshabilita cuando hay EN_ATENCION EN OTRO TURNO
  // RECEPCION: deshabilita si EN_ATENCION o ATENDIDO
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
  
  const prioridadBtns = (isAdmin() || isRecepcion()) ? `<button class="btn-prioridad-up" data-up="${t.id}" title="Subir prioridad" ${btnUpDisabled} ${dataDeshabilitado}><img src="images/up.svg" alt="↑" class="btn-icon"/></button><button class="btn-prioridad-down" data-down="${t.id}" title="Bajar prioridad" ${btnDownDisabled} ${dataDeshabilitado}><img src="images/down.svg" alt="↓" class="btn-icon"/></button>` : '';
  const accionesCell = puedeEliminar
    ? `${prioridadBtns} <button class="btn-editar" data-edit="${t.id}" title="Editar" ${btnEditDisabled} ${dataDeshabilitado}><img src="images/edit.svg" alt="✎" class="btn-icon"/> Editar</button> <button class="btn-eliminar" data-delete="${t.id}" ${btnDeleteDisabled} ${dataDeshabilitado}><img src="images/delete.svg" alt="🗑" class="btn-icon"/> Eliminar</button>`
    : '-';
    if (isDoctor()) {
      tr.innerHTML = `
        <td style="padding:8px;border:1px solid #ddd">${t.numero_turno || ''}</td>
        <td style="padding:8px;border:1px solid #ddd">${escapeHtml(t.paciente_nombre)}</td>
        <td style="padding:8px;border:1px solid #ddd">${escapeHtml(t.tipo_consulta || '')}</td>
        <td style="padding:8px;border:1px solid #ddd">${escapeHtml(t.paciente_documento||'')}</td>
        <td style="padding:8px;border:1px solid #ddd">${escapeHtml(t.entidad||'')}</td>
        <td style="padding:8px;border:1px solid #ddd">${estadoCell}</td>
        <td style="padding:8px;border:1px solid #ddd">${escapeHtml(t.notas || '')}</td>
        <td style="padding:8px;border:1px solid #ddd">${escapeHtml(t.programado_por || '-')}</td>
      `;
      if (animateTargetId && t.id === animateTargetId) {
        tr.classList.add('animate-up');
        setTimeout(() => tr.classList.remove('animate-up'), 900);
      }
    } else {
      tr.innerHTML = `
        <td style="padding:8px;border:1px solid #ddd">${t.numero_turno || ''}</td>
        <td class="col-hora" style="padding:8px;border:1px solid #ddd">${escapeHtml(formatearHora(t.hora))}</td>
        <td style="padding:8px;border:1px solid #ddd">${escapeHtml(t.paciente_nombre)}</td>
        <td style="padding:8px;border:1px solid #ddd">${escapeHtml(t.tipo_consulta || '')}</td>
        <td style="padding:8px;border:1px solid #ddd">${escapeHtml(t.paciente_documento||'')}</td>
        <td style="padding:8px;border:1px solid #ddd">${escapeHtml(t.entidad||'')}</td>
        <td style="padding:8px;border:1px solid #ddd">${estadoCell}</td>
        <td style="padding:8px;border:1px solid #ddd">${escapeHtml(t.notas || '')}</td>
        <td style="padding:8px;border:1px solid #ddd">${accionesCell}</td>
      `;
    }
  // Abrir panel de edición SOLO desde botón 'editar' (lapiz) para admin/recepcion
  if (isAdmin() || isRecepcion()) {
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
  // ajustar columnas por rol (ocultar Hora para doctor)
  adjustColumnsForRole();

  if (canEdit) {
    tr.querySelector('select')?.addEventListener('change', async (e)=>{
      try {
        const nuevoEstado = e.target.value;
        const turnoId = e.target.dataset.id;
        
        // Si se cambia a "EN_SALA", asignar número de turno automáticamente
        if (nuevoEstado === 'EN_SALA' && !t.numero_turno) {
          // Primero asignar número
          const fecha = $('agendaMedicaFecha').value;
          const doctorId = selectedDoctorId || (isDoctor() ? currentUser?.id : null);
          const nextNumRes = await apiFetch(`/api/turnos/get-next-number?fecha=${fecha}&doctor_id=${doctorId}`);
          const nextNumData = await nextNumRes.json();
          const nextNum = nextNumData.numero || 1;
          
          await apiFetch(`/api/turnos/${turnoId}/numero`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({numero: nextNum}) });
        }
        
        // Luego cambiar estado
        const stateRes = await apiFetch(`/api/turnos/${turnoId}/estado`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({estado:nuevoEstado}) });
        const stateData = await stateRes.json();
        if (stateData.ok) {
          showToast('Estado actualizado', 'success');
          cargarTurnosMedica();
        } else {
          showToast(stateData.error || 'Error al actualizar estado', 'error');
        }
      } catch(x){ showToast('Error al actualizar', 'error'); console.error(x); }
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
  const telefono = $('nuevoPacienteTelefonoMedica')?.value.trim() || '';
  const tipoConsulta = $('nuevoTurnoTipoMedica')?.value || '';
  const entidad = $('nuevoTurnoEntidadMedica')?.value || '';
  const notas = $('nuevoTurnoNotasMedica')?.value || '';
  const oportunidad = $('nuevoTurnoOportunidadMedica')?.value || '';

  // ========== VALIDACIONES ==========
  
  // 1. Validar campos obligatorios
  if (!nombre || !fecha || !doctorId || !hora) {
    showToast('Completa paciente, fecha, médico y hora', 'error');
    return;
  }

  // 2. Validar nombre: mínimo 3 caracteres
  if (nombre.length < 3) {
    showToast('El nombre debe tener al menos 3 caracteres', 'error');
    return;
  }

  // 3. Validar documento: solo números, 6-15 caracteres
  if (doc && !/^\d{6,15}$/.test(doc)) {
    showToast('Documento inválido. Solo números, 6-15 dígitos', 'error');
    return;
  }

  // 4. Validar teléfono: solo números (mínimo 7 dígitos si se ingresa)
  if (telefono && !/^\d{7,}$/.test(telefono.replace(/[\s\-\(\)]/g, ''))) {
    showToast('Teléfono inválido. Mínimo 7 dígitos', 'error');
    return;
  }

  try {
    // Validaciones completadas - permitir múltiples pacientes en la misma hora
    // (no hay validación de duplicados por hora, se permite hasta 20 pacientes)

    const body = {
      doctor_id: parseInt(doctorId, 10),
      paciente_nombre: nombre,
      paciente_documento: doc || null,
      paciente_telefono: telefono || null,
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
      $('nuevoTurnoNotasMedica').value = '';
      cargarTurnosMedica();
    } else {
      showToast(data.error || 'Error al crear la cita', 'error');
    }
  } catch (e) {
    showToast('Error creando cita: ' + e.message, 'error');
    console.error(e);
  }
}

// ========== AGENDA ELECTRODIAGNÓSTICO ==========
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
    option.textContent = hora;
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
  
  // Event listeners del modal
  $('cerrarModalDetallesCita')?.addEventListener('click', cerrarModalDetallesCita);
  $('btnCancelarModal')?.addEventListener('click', cerrarModalDetallesCita);
  $('btnGuardarCambios')?.addEventListener('click', guardarCambiosCitaElectro);
  $('btnIniciarEstudio')?.addEventListener('click', iniciarEstudioModal);
  $('btnFinalizarEstudio')?.addEventListener('click', finalizarEstudioModal);
  
  // Event listeners para cambios en el modal (equipo y estado)
  $('modalEquipo')?.addEventListener('change', (e) => {
  });
  $('modalEstado')?.addEventListener('change', (e) => {
  });
  $('btnEnviarRecomendaciones')?.addEventListener('click', (e) => {
    showToast('Función "Enviar Recomendaciones" - En desarrollo', 'info');
  });
  $('btnEliminarCita')?.addEventListener('click', eliminarCitaElectro);
  
  // Cerrar modal con tecla Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('modalDetallesCitaElectro').classList.contains('hidden')) {
      cerrarModalDetallesCita();
    }
  });

  // Event listeners para pestañas de estudios
  document.querySelectorAll('.tab-electro-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      filtroEstudioElectro = e.target.dataset.estudio;
      
      // Actualizar estilos de botones
      document.querySelectorAll('.tab-electro-btn').forEach(b => {
        b.style.borderBottomColor = 'transparent';
        b.style.color = '#6b7280';
      });
      e.target.style.borderBottomColor = '#0369a1';
      e.target.style.color = '#0369a1';
      
      // Recargar tabla filtrada
      cargarCitasElectro();
    });
  });

  await cargarCitasElectro();
}

// Verificar y mostrar disponibilidad de CUPOS
async function checkEquiposDisponibilidad() {
  const fecha = $('electroFecha').value;
  const hora = $('electroHora').value;
  const estudio = $('electroEstudio').value;
  const duracionHoras = $('electroDuracion').value;

  if (!fecha || !hora) {
    $('equiposDisponibilidadAlerta').style.display = 'none';
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
      $('equiposDisponibilidadAlerta').style.display = 'none';
      return;
    }

    const contenido = $('equiposDisponibilidadContenido');
    const alerta = $('equiposDisponibilidadAlerta');
    
    // Determinar color según disponibilidad
    const esDisponible = data.capacidad.hayDisponibilidad;
    const colorFondo = esDisponible ? '#dbeafe' : '#fef2f2';
    const colorBorde = esDisponible ? '#0284c7' : '#dc2626';
    const colorTexto = esDisponible ? '#0c4a6e' : '#7f1d1d';
    
    alerta.style.backgroundColor = colorFondo;
    alerta.style.borderLeftColor = colorBorde;
    
    // Mostrar estado de cupos
    let html = `
      <div style="font-weight:600;color:${colorTexto};margin-bottom:12px">
        ${esDisponible ? '✅' : '⛔'} ${data.mensaje}
      </div>
      
      <div style="margin-bottom:8px;font-size:0.9rem;color:${colorTexto}">
        <strong>${data.capacidad.cuposaDisponibles}/4</strong> cupos libres | 
        <strong>${data.duracionMinutos}min</strong> | 
        <strong>${data.horaFin}</strong>h fin
      </div>
      
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px">
    `;
    
    // Mostrar 4 cupos
    for (let i = 1; i <= 4; i++) {
      const ocupado = i <= data.capacidad.cuposOcupados;
      const colorCupo = ocupado ? '#fee2e2' : '#dcfce7';
      const textoCupo = ocupado ? '🔴' : '⭕';
      const borderColor = ocupado ? '#fca5a5' : '#86efac';
      
      html += `
        <div style="
          padding:8px;
          background:${colorCupo};
          border:2px solid ${borderColor};
          border-radius:6px;
          text-align:center;
          font-weight:600;
          font-size:1.1rem
        ">
          ${textoCupo} <div style="font-size:0.75rem;color:${ocupado ? '#991b1b' : '#166534'};margin-top:2px">${ocupado ? 'Ocupado' : 'Libre'}</div>
        </div>
      `;
    }
    html += '</div>';
    
    // Mostrar citas en rango si las hay
    if (data.citasEnRango && data.citasEnRango.length > 0) {
      html += `
        <div style="margin-top:12px;padding:8px;background:white;border-radius:4px;border-left:3px solid #6366f1">
          <div style="font-weight:600;color:#1e293b;margin-bottom:6px">📋 Estudios en este rango:</div>
      `;
      data.citasEnRango.forEach(cita => {
        // Función para formatear fecha (asegurar que sea YYYY-MM-DD)
        const formatearFecha = (fecha) => {
          if (!fecha) return '';
          // Remover caracteres ISO adicionales si los hay
          const fechaLimpia = fecha.substring(0, 10); // Tomar solo los primeros 10 caracteres (YYYY-MM-DD)
          const [año, mes, día] = fechaLimpia.split('-');
          return `${día}/${mes}`;
        };
        
        // Función para formatear hora (asegurar HH:MM)
        const formatearHora = (hora) => {
          if (!hora) return '';
          return hora.substring(0, 5); // HH:MM
        };
        
        const fechaInicio = formatearFecha(cita.fechaInicio);
        const horaInicio = formatearHora(cita.horaInicio);
        const fechaFin = formatearFecha(cita.fechaFin);
        const horaFin = formatearHora(cita.horaFin);
        
        const etiquetaCita = `${cita.estudio} (Inicio ${fechaInicio} - ${horaInicio} | Fin ${fechaFin} - ${horaFin})`;
        html += `<div style="font-size:0.85rem;color:#475569;margin:4px 0">• ${etiquetaCita}</div>`;
      });
      html += '</div>';
    }
    
    // Si no hay disponibilidad, mostrar próxima disponibilidad
    if (!esDisponible && data.proximaDisponibilidad) {
      html += `
        <div style="margin-top:12px;padding:8px;background:#fef3c7;border-radius:4px;color:#92400e;font-size:0.9rem">
          ⏰ Próxima disponibilidad: <strong>${data.proximaDisponibilidad}</strong>
        </div>
      `;
    }

    contenido.innerHTML = html;
    alerta.style.display = 'block';
  } catch (e) {
    console.error('Error checking disponibilidad:', e);
    $('equiposDisponibilidadAlerta').style.display = 'none';
  }
}

// Buscar paciente por documento y auto-completar nombre y teléfono
async function buscarPacientePorDocumento() {
  const doc = $('electroDocumento').value.trim();
  
  if (doc.length < 1) {
    // Si el documento está vacío, limpiar nombre y teléfono
    $('electroPacienteNombre').value = '';
    $('electroTelefono').value = '';
    return;
  }
  
  try {
    const res = await apiFetch(`/api/pacientes?buscar=${encodeURIComponent(doc)}`);
    const pacientes = await res.json();
    
    if (pacientes && pacientes.length > 0) {
      // Buscar el paciente con documento exacto
      const paciente = pacientes.find(p => p.documento === doc);
      
      if (paciente) {
        // Auto-completar nombre y teléfono
        $('electroPacienteNombre').value = paciente.nombre || '';
        $('electroTelefono').value = paciente.telefono || '';
        $('electroDocumento').dataset.pacienteId = paciente.id;
      }
    }
  } catch (e) {
    console.error('Error buscando paciente:', e);
  }
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
    
    const tbody = $('citasElectroBody');
    tbody.innerHTML = '';
    
    if (citasFiltradas.length === 0) {
      const mensajeEstudio = filtroEstudioElectro === 'todas' ? '' : ` para ${filtroEstudioElectro}`;
      tbody.innerHTML = `<tr><td colspan="10" style="padding:20px;text-align:center;color:#999">No hay citas registradas para esta fecha${mensajeEstudio}</td></tr>`;
      // Actualizar información de usuario
      $('electroUsuarioProgramo').textContent = '-';
      $('electroUsuarioEdito').textContent = '-';
      return;
    }
    
    // Renderizar cada cita filtrada
    citasFiltradas.forEach(c => renderCitaElectroRow(tbody, c));
    
    // Actualizar información de usuario (del primer registro filtrado)
    if (citasFiltradas.length > 0) {
      $('electroUsuarioProgramo').textContent = citasFiltradas[0].programado_por_nombre || citasFiltradas[0].usuario_programo || '-';
      $('electroUsuarioEdito').textContent = citasFiltradas[0].editado_por_nombre || citasFiltradas[0].usuario_edito || citasFiltradas[0].programado_por_nombre || citasFiltradas[0].usuario_programo || 'Quien programó';
    }
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
  
  // Mostrar hora_fin con indicador si cruza medianoche
  let horaFinDisplay = formatearHora(c.hora_fin);
  if (c.hora_fin_date && c.hora_fin_date !== c.fecha) {
    horaFinDisplay = `${formatearHora(c.hora_fin)} <span style="color:#dc2626;font-weight:600;">(+1 día)</span>`;
  }
  
  tr.innerHTML = `
    <td style="padding:12px">${formatearHora(c.hora_agendamiento)}</td>
    <td style="padding:12px">${formatearHora(c.hora_inicio)}</td>
    <td style="padding:12px">${escapeHtml(equipoDisplay)}</td>
    <td style="padding:12px">${escapeHtml(c.paciente_nombre || '-')}</td>
    <td style="padding:12px">${escapeHtml(c.paciente_documento || '-')}</td>
    <td style="padding:12px">${escapeHtml(c.telefono || '-')}</td>
    <td style="padding:12px">${escapeHtml(c.estudio || '-')}</td>
    <td style="padding:12px">${escapeHtml(c.diagnostico_codigo || '-')}</td>
    <td style="padding:12px">${escapeHtml(c.estado || 'Programado')}</td>
    <td style="padding:12px">${horaFinDisplay}</td>
  `;
  
  // Hacer la fila clickeable para abrir modal
  tr.addEventListener('click', (e) => {
    abrirModalDetallesCita(c);
  });
  
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
  const hora = $('electroHora').value;
  const fecha = $('electroFecha').value;
  const duracion = $('electroDuracion').value.trim();
  const diagnostico = $('electroDiagnostico').value.trim();
  
  if (!nombre || !doc || !telefono || !hora || !fecha) { 
    showToast('Completa todos los campos obligatorios (Estudio, Hora, Paciente, Documento y Teléfono)', 'error'); 
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
    const resP = await apiFetch('/api/pacientes', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({nombre, documento:doc||null, telefono:telefono||null}) });
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
  
  try {
    const body = {
      paciente_id: pacienteId,
      fecha,
      hora,
      telefono,
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
  }
}

// ========== GESTIÓN DE USUARIOS (solo admin) ==========
async function initUsuarios() {
  $('crearUsuario').addEventListener('click', crearUsuario);
  
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
          'length': validation.issues.includes('length') ? '❌' : '✅',
          'upper': validation.issues.includes('upper') ? '❌' : '✅',
          'lower': validation.issues.includes('lower') ? '❌' : '✅',
          'number': validation.issues.includes('number') ? '❌' : '✅',
          'special': validation.issues.includes('special') ? '❌' : '✅'
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
  
  await cargarUsuarios();
}

async function cargarUsuarios() {
  try {
    const res = await apiFetch('/api/usuarios');
    if (res.status === 403) { showToast('No tienes permiso', 'error'); return; }
    const usuarios = await res.json();
    const tbody = $('usuariosTableBody');
    tbody.innerHTML = '';
    if (!usuarios.length) tbody.innerHTML = '<tr><td colspan="6" style="padding:20px;text-align:center;color:#999">No hay usuarios</td></tr>';
    else usuarios.forEach(u => {
      const tr = document.createElement('tr');
      const rolLabels = { admin: 'Administrador', recepcion: 'Recepción', electro: 'Electrodiagnóstico', doctor: 'Doctor' };
      const estadoIcon = u.activo ? '🟢' : '🔴';
      const estadoColor = u.activo ? '#10b981' : '#666';
      tr.innerHTML = `
        <td style="padding:8px;border:1px solid #ddd">${escapeHtml(u.usuario)}</td>
        <td style="padding:8px;border:1px solid #ddd">${escapeHtml(u.nombre||'')}</td>
        <td style="padding:8px;border:1px solid #ddd">${rolLabels[u.rol]||u.rol}</td>
        <td style="padding:8px;border:1px solid #ddd">${u.numero_consultorio ? u.numero_consultorio : '-'}</td>
        <td style="padding:8px;border:1px solid #ddd;color:${estadoColor};font-weight:600">${estadoIcon} ${u.activo ? 'Activo' : 'Inactivo'}</td>
        <td style="padding:8px;border:1px solid #ddd">
          <button class="btn-estado-small" data-edit="${u.id}" style="background:#2d4a47">Editar</button>
          ${u.numero_consultorio ? `<button class="btn-estado-small" data-speak="${u.numero_consultorio}" style="background:#059669;margin-left:4px" title="Reproducir número de consultorio">🔊 ${u.numero_consultorio}</button>` : ''}
          <button class="btn-estado-small" data-historial="${u.id}" style="background:#2d4a47;margin-left:4px" title="Ver historial de cambios">Historial</button>
          <button class="btn-estado-small" data-reset="${u.id}" style="background:#2d4a47;margin-left:4px" title="Resetear contraseña">Reset</button>
          ${currentUser?.id !== u.id ? `<button class="btn-estado-small" data-toggle="${u.id}" style="background:#2d4a47;margin-left:4px">${u.activo ? 'Desactivar' : 'Activar'}</button>` : ''}
          ${currentUser?.id !== u.id ? `<button class="btn-estado-small" data-del="${u.id}" style="background:#dc2626;margin-left:4px">Eliminar</button>` : ''}
        </td>
      `;
      tr.querySelector('[data-edit]')?.addEventListener('click', () => editarUsuario(u));
      tr.querySelector('[data-speak]')?.addEventListener('click', (e) => speakConsultorio(e.target.dataset.speak));
      tr.querySelector('[data-historial]')?.addEventListener('click', (e) => verHistorialAuditoria(u.id, u.usuario));
      tr.querySelector('[data-reset]')?.addEventListener('click', async (e) => {
        if (!confirm(`¿Resetear contraseña para ${u.usuario}?`)) return;
        try {
          const r = await apiFetch(`/api/usuarios/${e.target.dataset.reset}/reset-password`, { method: 'PATCH' });
          const d = await r.json();
          if (d.ok) {
            verResetPassword(d);
          } else showToast(d.error||'Error', 'error');
        } catch (x) { showToast('Error', 'error'); }
      });
      tr.querySelector('[data-toggle]')?.addEventListener('click', async (e) => {
        const newState = u.activo ? 'desactivar' : 'activar';
        if (!confirm(`¿${newState.charAt(0).toUpperCase() + newState.slice(1)} este usuario?`)) return;
        try {
          const r = await apiFetch(`/api/usuarios/${e.target.dataset.toggle}/toggle-estado`, { method: 'PATCH' });
          const d = await r.json();
          if (d.ok) {
            showToast(`Usuario ${d.activo ? 'activado' : 'desactivado'}`, 'success');
            cargarUsuarios();
          } else showToast(d.error||'Error', 'error');
        } catch (x) { showToast('Error', 'error'); }
      });
      tr.querySelector('[data-del]')?.addEventListener('click', async (e) => {
        if (!confirm('¿Eliminar este usuario permanentemente?')) return;
        try {
          const r = await apiFetch(`/api/usuarios/${e.target.dataset.del}`, { method: 'DELETE' });
          const d = await r.json();
          if (d.ok) { showToast('Usuario eliminado', 'success'); cargarUsuarios(); }
          else showToast(d.error||'Error', 'error');
        } catch (x) { showToast('Error', 'error'); }
      });
      tbody.appendChild(tr);
    });
  } catch (e) { showToast('Error cargando usuarios', 'error'); }
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
    
    // Si tiene especialidad actual
    if (especialidadActual) {
      const predefinidas = ['Neurología', 'Epileptología', 'Psicología', 'Neuropsicología', 'Psiquiatría'];
      if (predefinidas.includes(especialidadActual)) {
        $('editEspecialidad').value = especialidadActual;
        colOtra.style.display = 'none';
        $('editEspecialidadOtra').value = '';
      } else {
        $('editEspecialidad').value = 'Otra';
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
  $('modalBusquedaAuditoria').classList.remove('hidden');
  limpiarFiltrosAuditoria();
}

function closeBusquedaAuditoriaModal() {
  $('modalBusquedaAuditoria').classList.add('hidden');
}

async function buscarAuditoria() {
  try {
    const container = $('busquedaResultados');
    container.innerHTML = '<p style="text-align:center;color:#2d4a47;padding:20px">Cargando...</p>';
    
    const accion = $('filtroAccion').value || '';
    const desde = $('filtroDesde').value || '';
    const hasta = $('filtroHasta').value || '';
    
    // Construir URL con parámetros
    const params = new URLSearchParams();
    if (accion.trim()) params.append('accion', accion.trim());
    if (desde) params.append('desde', desde);
    if (hasta) params.append('hasta', hasta);
    params.append('limit', 500);
    
    console.log('[AUDIT SEARCH] Parámetros:', {accion, desde, hasta});
    
    const res = await apiFetch(`/api/auditoria/buscar?${params.toString()}`);
    const data = await res.json();
    
    console.log('[AUDIT SEARCH RESPONSE]', data);
    
    if (!data || (!data.ok && !data.results)) {
      showToast('Error en búsqueda: ' + (data?.error || 'desconocido'), 'error');
      container.innerHTML = '<p style="text-align:center;color:#dc2626;padding:20px">Error en la búsqueda</p>';
      return;
    }
    
    const results = data.results || [];
    
    if (results.length === 0) {
      container.innerHTML = '<p style="text-align:center;color:#6b7280;padding:20px">No se encontraron registros</p>';
      return;
    }
    
    // Generar tabla de resultados
    let html = `<table style="width:100%;border-collapse:collapse;font-size:0.85rem"><thead><tr style="background:#f3f4f6;border:1px solid #e5e7eb"><th style="padding:10px;text-align:left;border:1px solid #e5e7eb">Fecha</th><th style="padding:10px;text-align:left;border:1px solid #e5e7eb">Acción</th><th style="padding:10px;text-align:left;border:1px solid #e5e7eb">Usuario</th><th style="padding:10px;text-align:left;border:1px solid #e5e7eb">Admin</th><th style="padding:10px;text-align:left;border:1px solid #e5e7eb">Cambios</th></tr></thead><tbody>`;
    
    const iconos = {
      'CREAR': '✨',
      'ACTUALIZAR': '✏️',
      'ELIMINAR': '🗑️',
      'ACTIVAR': '🟢',
      'DESACTIVAR': '🔴',
      'RESET_PASSWORD': '🔑'
    };
    
    results.forEach((r, idx) => {
      const icon = iconos[r.accion] || '•';
      const fecha = new Date(r.fecha_cambio).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });
      const cambiosHtml = formatearCambios(r.cambios);
      
      html += `<tr style="border-bottom:1px solid #e5e7eb;background:${idx % 2 === 0 ? '#fff' : '#f9fafb'}">
        <td style="padding:10px;border:1px solid #e5e7eb">${fecha}</td>
        <td style="padding:10px;border:1px solid #e5e7eb"><span style="font-weight:600">${icon} ${r.accion}</span></td>
        <td style="padding:10px;border:1px solid #e5e7eb">${escapeHtml(r.usuario || '-')}</td>
        <td style="padding:10px;border:1px solid #e5e7eb">${escapeHtml(r.usuario_admin || '-')}</td>
        <td style="padding:10px;border:1px solid #e5e7eb;max-width:200px;overflow:hidden">${cambiosHtml}</td>
      </tr>`;
    });
    
    html += '</tbody></table>';
    container.innerHTML = html;
    
    // Guardar resultados para exportar
    window.ultimosBusquedasAuditoria = results;
    
  } catch (e) {
    showToast('Error buscando auditoría', 'error');
    console.error(e);
  }
}

function formatearCambios(cambios) {
  if (!cambios || Object.keys(cambios).length === 0) return '-';
  let html = '';
  for (const [field, changes] of Object.entries(cambios)) {
    html += `<div style="font-size:0.8rem;margin:4px 0"><strong>${field}:</strong> ${changes.antes || '∅'} → ${changes.despues || '∅'}</div>`;
  }
  return html;
}

function limpiarFiltrosAuditoria() {
  $('filtroAccion').value = '';
  $('filtroDesde').value = '';
  $('filtroHasta').value = '';
  window.ultimosBusquedasAuditoria = [];
  // Cargar últimos registros por defecto
  buscarAuditoria();
}

function exportarAuditoriaCSV() {
  const results = window.ultimosBusquedasAuditoria || [];
  if (results.length === 0) {
    showToast('No hay datos para exportar', 'warning');
    return;
  }
  
  // Headers del CSV
  const headers = ['Fecha', 'Acción', 'Usuario Afectado', 'Admin', 'Cambios'];
  let csv = headers.join(',') + '\n';
  
  // Datos
  results.forEach(r => {
    const fecha = new Date(r.fecha_cambio).toLocaleString('es-CO');
    const usuario = (r.usuario || '-').replace(/,/g, ' ');
    const admin = (r.usuario_admin || '-').replace(/,/g, ' ');
    const cambios = JSON.stringify(r.cambios).replace(/,/g, ' ').replace(/"/g, '');
    
    csv += `"${fecha}","${r.accion}","${usuario}","${admin}","${cambios}"\n`;
  });
  
  // Crear descarga
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', `auditoria_${new Date().getTime()}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  showToast('Auditoría exportada a CSV', 'success');
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

function addRow(desc='', price=0){
  const tbody = document.querySelector('#itemsTable tbody');
  const tr = document.createElement('tr');
  
  const servicios = getServicios();
  
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

function initItemsTable(){
  const tbody = document.querySelector('#itemsTable tbody');
  // si no hay filas, agrega una de ejemplo
  if(!tbody.children.length) addRow();
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
  $('fecha').readOnly = true;
  $('fecha').style.cursor = 'not-allowed';
  $('fecha').style.backgroundColor = '#f0f0f0';
}

async function nextNumber(){
  try {
    const res = await apiFetch('/api/recibos');
    const arr = await res.json();
    // Buscar el máximo número entre todos los recibos
    // SOLO contar números pequeños (secuenciales, no timestamps)
    let maxNum = 0;
    arr.forEach(r => {
      const num = Number(r.numero);
      // Solo contar números menores a 10000 (ignorar timestamps)
      if(!isNaN(num) && num > maxNum && num < 10000) maxNum = num;
    });
    const next = maxNum + 1;
    $('numero').value = String(next).padStart(4,'0');
  } catch(e) {
    // si falla el servidor, fallback local
    const saved = JSON.parse(localStorage.getItem(lsKey) || '[]');
    let maxNum = 0;
    saved.forEach(r => {
      const num = Number(r.numero);
      if(!isNaN(num) && num > maxNum && num < 10000) maxNum = num;
    });
    $('numero').value = String(maxNum + 1).padStart(4,'0');
  }
  updateSavedCount();
}

function collectFormData(){
  const items = [];
  document.querySelectorAll('#itemsTable tbody tr').forEach(r=>{
    // Si hay input personalizado, usar su valor; si no, usar el select
    const descEl = r.querySelector('.item-desc-custom') || r.querySelector('.item-desc');
    const priceValue = r.querySelector('.item-price').value || '0';
    items.push({
      desc: descEl.value,
      price: Number(priceValue.replace(/,/g, ''))
    });
  });
  // Extraer solo los números del textContent (remover $ y comas)
  const subtotal = Number($('r_subtotal').textContent.replace(/[^\d.]/g, '') || 0);
  const iva = Number($('r_iva').textContent.replace(/[^\d.]/g, '') || 0);
  const total = Number($('r_total').textContent.replace(/[^\d.]/g, '') || 0);
  return {
    numero: $('numero').value,
    fecha: $('fecha').value,
    cliente: $('cliente').value,
    doc: $('docCliente').value,
    entidad: $('entidad').value === 'Otra' ? $('entidadOtra').value : $('entidad').value,
    observ: $('observ').value,
    items, subtotal, iva, total
  };
}

function generatePreview(){
  if(!validarFormulario()) return;
  
  // llenar campos del preview
  $('r_num').textContent = $('numero').value;
  $('r_fecha').textContent = $('fecha').value;
  $('r_cliente').textContent = $('cliente').value;
  $('r_doc').textContent = $('docCliente').value;
  $('r_observ').textContent = $('observ').value;

  const tbody = document.querySelector('#r_table tbody'); tbody.innerHTML = '';
  document.querySelectorAll('#itemsTable tbody tr').forEach(r=>{
    // Si hay input personalizado, usar su valor; si no, usar el select
    const descEl = r.querySelector('.item-desc-custom') || r.querySelector('.item-desc');
    const desc = descEl.value;
    const priceValue = r.querySelector('.item-price').value || '0';
    const price = Number(priceValue.replace(/,/g, ''));
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${escapeHtml(desc)}</td><td style="text-align:right">${escapeHtml(formatMoney(price))}</td>`;
    tbody.appendChild(tr);
  });

  recalc();
  
  // Guardar automáticamente en la base de datos
  saveToDatabase();
}

function validarFormulario(){
  const cliente = $('cliente').value.trim();
  const docCliente = $('docCliente').value.trim();
  const fecha = $('fecha').value.trim();
  const entidad = $('entidad').value.trim();
  const items = document.querySelectorAll('#itemsTable tbody tr');
  
  if(!cliente) {
    showToast('Por favor escribe el nombre del cliente', 'error');
    return false;
  }
  
  if(!docCliente) {
    showToast('Por favor escribe el documento del cliente', 'error');
    return false;
  }
  
  if(!entidad) {
    showToast('Por favor selecciona una entidad', 'error');
    return false;
  }
  
  if(entidad === 'Otra') {
    const entidadOtra = $('entidadOtra').value.trim();
    if(!entidadOtra) {
      showToast('Por favor especifica la entidad personalizada', 'error');
      return false;
    }
  }
  
  if(!fecha) {
    showToast('Por favor selecciona una fecha', 'error');
    return false;
  }
  
  if(items.length === 0) {
    showToast('Por favor agrega al menos un servicio', 'error');
    return false;
  }
  
  let hayItemValido = false;
  items.forEach(r => {
    // Si hay input personalizado, usar su valor; si no, usar el select
    const descEl = r.querySelector('.item-desc-custom') || r.querySelector('.item-desc');
    const desc = descEl.value.trim();
    const priceValue = r.querySelector('.item-price').value || '0';
    const price = Number(priceValue.replace(/,/g, ''));
    if(desc && price > 0) {
      hayItemValido = true;
    }
  });
  
  if(!hayItemValido) {
    showToast('Por favor completa descripción y precio de al menos un servicio', 'error');
    return false;
  }
  
  return true;
}

async function saveToDatabase(){
  if(!validarFormulario()) return;
  
  const payload = collectFormData();
  try {
    const res = await apiFetch('/api/recibos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ numero: payload.numero, cliente: payload.cliente, fecha: payload.fecha, total: payload.total, data: payload })
    });
    const json = await res.json();
    if(json.ok){
      showToast('✓ Recibo guardado', 'success');
      resetFormulario();
      cargarLista();
      // Actualizar stats después de guardar
      updateSavedCount();
      nextNumber();
    } else {
      showToast('Error guardando: ' + (json.error || 'desconocido'), 'error');
    }
  } catch(e){
    console.error(e);
  }
}

function resetFormulario() {
  // Limpiar campos del cliente
  $('cliente').value = '';
  $('docCliente').value = '';
  $('entidad').value = '';
  $('entidadOtra').value = '';
  document.getElementById('entidadOtraContainer').style.display = 'none';
  
  // Limpiar observaciones
  $('observ').value = '';
  
  // Limpiar tabla de items
  const tbody = document.querySelector('#itemsTable tbody');
  tbody.innerHTML = '';
  addRow();
  
  // Generar nuevo número de recibo
  nextNumber();
  
  // Establecer fecha actual
  setDefaultDate();
  
  // Limpiar preview
  document.querySelector('#r_table tbody').innerHTML = '';
  $('r_cliente').textContent = '';
  $('r_doc').textContent = '';
  $('r_observ').textContent = '';
  $('r_subtotal').textContent = '0.00';
  $('r_iva').textContent = '0.00';
  $('r_total').textContent = '0.00';
}

async function abrirPDF(){
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
    pdfWindow.onload = () => {
      setTimeout(() => {
        pdfWindow.print();
      }, 250);
    };
  } catch(e){
    showToast('Error al generar PDF', 'error');
  }
}

async function descargarPDFAnterior(){
  if(!lastReciboId) {
    showToast('No hay PDF anterior', 'error');
    return;
  }
  try {
    const res = await apiFetch('/api/recibos');
    const arr = await res.json();
    if(!arr || arr.length < 2) {
      showToast('No hay PDF anterior', 'error');
      return;
    }
    // Encontrar el segundo más reciente
    let sorted = arr.sort((a, b) => b.id - a.id);
    const previousRecibo = sorted[1];
    const pdfWindow = window.open(`/api/recibos/${previousRecibo.id}/pdf`, '_blank');
    pdfWindow.onload = () => {
      setTimeout(() => {
        pdfWindow.print();
      }, 250);
    };
  } catch(e){
    showToast('Error al descargar PDF anterior', 'error');
  }
}

async function cargarLista(){
  try {
    const res = await apiFetch('/api/recibos');
    const recibos = await res.json();
    const tbody = document.getElementById('savedItems');
    updateStats(recibos);
    
    if(tbody){
      tbody.innerHTML = '';
      if(!recibos.length) {
        tbody.innerHTML = '<tr><td colspan="5" style="padding:12px;text-align:center;color:#999">No hay recibos guardados</td></tr>';
      } else {
        recibos.forEach((r, idx) => {
          const tr = document.createElement('tr');
          tr.style.borderBottom = '1px solid #e5e7eb';
          if (idx % 2 === 0) {
            tr.style.backgroundColor = '#f9fafb';
          }
          
          // Formatear fecha a YYYY-MM-DD
          let fechaFormato = r.fecha || '-';
          if (r.fecha) {
            if (typeof r.fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.fecha)) {
              fechaFormato = r.fecha;
            } else {
              const d = new Date(r.fecha);
              if (!isNaN(d.getTime())) {
                fechaFormato = d.toISOString().split('T')[0];
              }
            }
          }
          
          const deleteBtn = canDeleteRecibos() 
            ? `<button class="delete" data-id="${r.id}" style="font-size:0.85rem;padding:6px 10px;background:#ef4444;color:white;border:0;border-radius:6px;cursor:pointer;margin-left:6px">✕ Eliminar</button>`
            : '';
          
          tr.innerHTML = `
            <td style="padding:12px;border:1px solid #e5e7eb;color:#374151">${escapeHtml(r.numero || '-')}</td>
            <td style="padding:12px;border:1px solid #e5e7eb;color:#374151">${escapeHtml(r.cliente || '-')}</td>
            <td style="padding:12px;border:1px solid #e5e7eb;color:#374151">${escapeHtml(fechaFormato)}</td>
            <td style="padding:12px;border:1px solid #e5e7eb;color:#374151;text-align:right;font-weight:500">$${escapeHtml(Number(r.total || 0).toFixed(2))}</td>
            <td style="padding:12px;border:1px solid #e5e7eb;text-align:center;white-space:nowrap">
              <a href="/api/recibos/${r.id}/pdf" target="_blank" style="padding:6px 10px;background:#10b981;color:white;border:0;border-radius:6px;cursor:pointer;font-size:0.85rem;text-decoration:none;display:inline-block">📄 PDF</a>
              ${deleteBtn}
            </td>
          `;
          tbody.appendChild(tr);
        });
        
        // listeners delete con protección de contraseña
        tbody.querySelectorAll('.delete').forEach(b => b.addEventListener('click', async (e)=>{
          const password = prompt('Ingresa la contraseña para eliminar el recibo:');
          if(!password) return;
          if(password !== '1NN4R') {
            showToast('Contraseña incorrecta', 'error');
            return;
          }
          if(!confirm('¿Eliminar este recibo? Esta acción no se puede deshacer.')) return;
          const id = e.target.dataset.id;
          try {
            const res = await apiFetch(`/api/recibos/${id}`, { method: 'DELETE' });
            const json = await res.json();
            if(json.ok) {
              showToast('Recibo eliminado', 'success');
              cargarLista();
            }
          } catch(e) { 
            console.error(e); 
            showToast('Error eliminando recibo', 'error'); 
          }
        }));
      }
    }
  } catch(e){
    console.error(e);
    showToast('Error cargando lista', 'error');
  }
}

function updateSavedCount(n) {
  // Siempre cargar desde el servidor
  console.log('[DEBUG] updateSavedCount iniciado');
  apiFetch('/api/recibos').then(r=>r.json()).then(arr=> {
    console.log('[DEBUG] Recibos cargados desde servidor:', arr);
    updateStats(arr);
  }).catch((err)=> {
    console.error('[DEBUG] Error cargando recibos:', err);
    updateStats([]);
  });
}

function updateStats(recibos) {
  console.log('[DEBUG] updateStats llamado con recibos:', recibos);
  
  const hoy = new Date().toISOString().slice(0, 10);
  console.log('[DEBUG] Fecha de hoy:', hoy);
  
  // Normalizar fechas a formato YYYY-MM-DD para comparación
  const recibosHoy = recibos.filter(r => {
    let fechaFormato = r.fecha;
    
    // Si es un string y ya está en YYYY-MM-DD, úsalo directamente
    if (typeof fechaFormato === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(fechaFormato)) {
      console.log('[DEBUG] Recibo', r.id, 'fecha ya en formato correcto:', fechaFormato, '===', hoy, '?', fechaFormato === hoy);
      return fechaFormato === hoy;
    }
    
    // Si no, intenta convertir
    if (fechaFormato) {
      const d = new Date(fechaFormato);
      if (!isNaN(d.getTime())) {
        fechaFormato = d.toISOString().split('T')[0];
        console.log('[DEBUG] Recibo', r.id, 'fecha convertida:', fechaFormato, '===', hoy, '?', fechaFormato === hoy);
        return fechaFormato === hoy;
      }
    }
    
    return false;
  });
  
  const totalHoy = recibosHoy.reduce((sum, r) => sum + (Number(r.total) || 0), 0);
  
  console.log('[DEBUG] Recibos de hoy:', recibosHoy.length, 'Total:', totalHoy);
  
  $('statsRecibosHoy').textContent = recibosHoy.length;
  $('statsTotalHoy').textContent = '$ ' + totalHoy.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

async function resetAllRecibos(){
  if(!confirm('¿Eliminar TODOS los recibos guardados? Esta acción no se puede deshacer.')) return;
  
  const password = prompt('Ingresa la contraseña para eliminar todos los recibos:');
  if(!password) return;
  if(password !== '1NN4R') {
    showToast('Contraseña incorrecta', 'error');
    return;
  }
  
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

function setDefaultReportDates(){
  const hoy = new Date().toISOString().slice(0, 10);
  const mesActual = hoy.slice(0, 7);
  $('reportDiaFecha').value = hoy;
  $('reportMesFecha').value = mesActual;
}

async function generarReporteDiario(){
  const fecha = $('reportDiaFecha').value;
  if(!fecha) {
    showToast('Selecciona una fecha', 'error');
    return;
  }
  try {
    window.open(`/reportes/diario/vista?fecha=${encodeURIComponent(fecha)}`, '_blank');
  } catch(e) {
    showToast('Error generando reporte', 'error');
    console.error(e);
  }
}

async function generarReporteMensual(){
  const mes = $('reportMesFecha').value;
  if(!mes) {
    showToast('Selecciona un mes', 'error');
    return;
  }
  try {
    window.open(`/reportes/mensual/vista?mes=${encodeURIComponent(mes)}`, '_blank');
  } catch(e) {
    showToast('Error generando reporte', 'error');
    console.error(e);
  }
}

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
  // Setup toggle buttons para "Mi Cuenta"
  const toggleBtns = ['toggleContrasenaActual', 'toggleNuevaContrasena', 'toggleConfirmarContrasena'];
  const inputIds = ['contrasenaActual', 'nuevaContrasena', 'confirmarContrasena'];
  
  toggleBtns.forEach((btnId, idx) => {
    const btn = $(btnId);
    const input = $(inputIds[idx]);
    if (btn && input) {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const type = input.type === 'password' ? 'text' : 'password';
        input.type = type;
        btn.textContent = type === 'password' ? '👁️' : '👁️‍🗨️';
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
      toggleEditBtn.textContent = type === 'password' ? '👁️' : '👁️‍🗨️';
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
    showToast(`✅ ${data.mensaje}`, 'success');

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
    const tbody = $('diagnosticosTableBody');
    tbody.innerHTML = '';

    if (diagnosticos.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="padding:20px;text-align:center;color:#999">Sin diagnósticos cargados</td></tr>';
      return;
    }

    diagnosticos.forEach(d => {
      const tr = document.createElement('tr');
      tr.className = 'turno-row';
      tr.innerHTML = `
        <td style="padding:12px">${escapeHtml(d.codigo || '-')}</td>
        <td style="padding:12px">${escapeHtml(d.nombre)}</td>
        <td style="padding:12px">${escapeHtml(d.descripcion || '-')}</td>
        <td style="padding:12px">${d.activo === 1 ? '<span style="background:#dcfce7;color:#15803d;padding:4px 8px;border-radius:4px;font-size:0.85rem">Activo</span>' : '<span style="background:#fee2e2;color:#991b1b;padding:4px 8px;border-radius:4px;font-size:0.85rem">Inactivo</span>'}</td>
        <td style="padding:12px">
          <button class="btn-eliminar-diag" data-id="${d.id}" style="padding:6px 10px;background:#dc2626;color:white;border:none;border-radius:4px;cursor:pointer;font-size:0.85rem">Eliminar</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    // Agregar event listeners a botones de eliminar
    document.querySelectorAll('.btn-eliminar-diag').forEach(btn => {
      btn.addEventListener('click', async (e) => {
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
    });
  } catch (e) {
    console.error('Error cargando diagnósticos:', e);
    $('diagnosticosTableBody').innerHTML = '<tr><td colspan="5" style="padding:20px;text-align:center;color:#dc2626">Error cargando diagnósticos</td></tr>';
  }
}

// ========== FUNCIONES DEL MODAL DE DETALLES DE CITA ELECTRODIAGNÓSTICO ==========
async function iniciarEstudioModal() {
  if (!citaElectroSeleccionada) return;
  
  try {
    const ahora = new Date();
    const hh = String(ahora.getHours()).padStart(2, '0');
    const mm = String(ahora.getMinutes()).padStart(2, '0');
    const horaActual = `${hh}:${mm}`;
    
    const cambios = {
      estado: 'En Estudio',
      hora_inicio: horaActual
    };
    
    // Actualizar en la base de datos
    const res = await apiFetch(`/api/citas-electro/${citaElectroSeleccionada.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cambios)
    });
    
    const data = await res.json();
    
    if (data && data.ok) {
      showToast(`✅ Estudio iniciado a las ${horaActual}`, 'success');
      
      // Emitir evento de socket desde el cliente
      if (window.socket && window.socket.connected) {
        window.socket.emit('electro:estudio-iniciado', {
          id: citaElectroSeleccionada.id,
          hora_inicio: horaActual
        });
      }
      
      // El servidor también emitirá el socket event
      cargarCitasElectro();
      cerrarModalDetallesCita();
    } else {
      showToast(data?.error || 'Error iniciando estudio', 'error');
    }
  } catch (e) {
    showToast('Error iniciando estudio', 'error');
  }
}

async function finalizarEstudioModal() {
  if (!citaElectroSeleccionada) return;
  
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
      showToast(`✅ Estudio finalizado a las ${horaActual}`, 'success');
      
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
    showToast('Error finalizando estudio', 'error');
  }
}

function abrirModalDetallesCita(cita) {
  citaElectroSeleccionada = cita;
  
  // Rellenar datos de paciente
  $('modalPacienteNombre').textContent = escapeHtml(cita.paciente_nombre || '-');
  $('modalPacienteDocumento').textContent = escapeHtml(cita.paciente_documento || '-');
  
  // Rellenar usuario que programó y editó
  $('modalUsuarioProgramo').textContent = escapeHtml(cita.programado_por_nombre || '-');
  $('modalUsuarioEdito').textContent = escapeHtml(cita.editado_por_nombre || cita.programado_por_nombre || '-');
  
  // Rellenar selector de equipo
  $('modalEquipo').value = cita.equipo_id || '';
  
  // Rellenar selector de estado
  $('modalEstado').value = cita.estado || 'Programado';
  
  // Mostrar botón de eliminar solo para admin
  const btnEliminar = $('btnEliminarCita');
  if (currentUser && (currentUser.rol === 'admin' || currentUser.rol === 'administrador')) {
    btnEliminar.style.display = '';
  } else {
    btnEliminar.style.display = 'none';
  }
  
  // Mostrar modal
  $('modalDetallesCitaElectro').classList.remove('hidden');
}

function cerrarModalDetallesCita() {
  $('modalDetallesCitaElectro').classList.add('hidden');
  citaElectroSeleccionada = null;
}

async function eliminarCitaElectro() {
  if (!citaElectroSeleccionada) return;
  
  // Verificar que sea admin
  const esAdmin = currentUser && (currentUser.rol === 'admin' || currentUser.rol === 'administrador');
  console.log('Intentando eliminar cita. Es Admin?', esAdmin, 'Usuario:', currentUser);
  
  if (!esAdmin) {
    showToast('No tienes permisos para eliminar citas', 'error');
    return;
  }
  
  if (!confirm(`¿Está seguro que desea eliminar la cita de ${citaElectroSeleccionada.paciente_nombre}?`)) {
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
        showToast('✅ Cambios guardados', 'success');
        
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

// cargar inicial
async function cargar(){
  await cargarLista();
}
cargar();

