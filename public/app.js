// public/app.js
const $ = id => document.getElementById(id);
const lsKey = 'recibos_sencillo_v1';
const lsKeyServicios = 'servicios_list_v1';
let lastReciboId = null;

// Usuario actual (rol: admin, recepcion, electro, doctor)
let currentUser = null;

// Intervalo de auto-refresh para Agenda Médica
let agendaMedicaInterval = null;

// Fetch con credenciales para sesión
function apiFetch(url, opts = {}) {
  return fetch(url, { ...opts, credentials: 'include' });
}

function isAdmin() { return currentUser && currentUser.rol === 'admin'; }
function isRecepcion() { return currentUser && currentUser.rol === 'recepcion'; }
function isElectro() { return currentUser && currentUser.rol === 'electro'; }
function isDoctor() { return currentUser && currentUser.rol === 'doctor'; }
function canDeleteRecibos() { return isAdmin(); }

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
      showView('view-menu');
      $('menuUserName').textContent = currentUser?.nombre || currentUser?.usuario || 'Usuario';
      updateMenuByRole();
      return true;
    }
  } catch (e) { console.error(e); }
  currentUser = null;
  showView('view-login');
  return false;
}

async function doLogin(usuario, password) {
  try {
    const res = await apiFetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario, password })
    });
    const data = await res.json();
    if (data.ok) {
      currentUser = data.usuario;
      $('loginError').classList.add('hidden');
      $('loginError').textContent = '';
      showView('view-menu');
      $('menuUserName').textContent = currentUser?.nombre || currentUser?.usuario || 'Usuario';
      updateMenuByRole();
      setupMenuHandlers();
      return true;
    }
    $('loginError').textContent = data.error || 'Error al iniciar sesión';
    $('loginError').classList.remove('hidden');
    return false;
  } catch (e) {
    $('loginError').textContent = 'Error de conexión';
    $('loginError').classList.remove('hidden');
    return false;
  }
}

async function doLogout() {
  try {
    await apiFetch('/api/logout', { method: 'POST' });
  } catch (e) {}
  showView('view-login');
}

let initRecibosDone = false, initAgendaDone = false, initElectroDone = false, initUsuariosDone = false;
function goToModule(moduleId) {
  showView(`view-${moduleId}`);
  if (moduleId === 'recibos') { if (!initRecibosDone) initRecibos(); else cargarLista(); }
  if (moduleId === 'agenda-medica') { 
    if (!initAgendaDone) initAgendaMedica(); 
    initAgendaDone = true; 
    startAgendaMedicaAutoRefresh();
  } else {
    stopAgendaMedicaAutoRefresh();
  }
  if (moduleId === 'electro') { if (!initElectroDone) initElectro(); initElectroDone = true; }
  if (moduleId === 'usuarios') { if (!initUsuariosDone) initUsuarios(); initUsuariosDone = true; }
}

function goToMenu() {
  showView('view-menu');
  stopAgendaMedicaAutoRefresh();
}

function setupMenuHandlers() {
  if (window._menuHandlersSetup) return;
  window._menuHandlersSetup = true;
  $('btnLogout').addEventListener('click', doLogout);
  document.querySelectorAll('.menu-card').forEach(card => {
    card.addEventListener('click', () => goToModule(card.dataset.module));
  });
  $('btnVolverRecibos').addEventListener('click', goToMenu);
  $('btnVolverAgenda').addEventListener('click', goToMenu);
  $('btnVolverElectro').addEventListener('click', goToMenu);
  if ($('btnVolverUsuarios')) $('btnVolverUsuarios').addEventListener('click', goToMenu);
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
    loader.innerHTML = '<div style="background:white;padding:20px;border-radius:8px;text-align:center"><div style="font-size:24px;margin-bottom:10px">⏳</div><div>Procesando...</div></div>';
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

// init
document.addEventListener('DOMContentLoaded', async ()=>{
  // Verificar sesión al cargar
  const autenticado = await checkSession();
  if (!autenticado) {
    // Login form
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

// ========== AGENDA MÉDICA (Turnos) ==========
async function initAgendaMedica() {
  const hoy = new Date().toISOString().slice(0,10);
  $('agendaMedicaFecha').value = hoy;
  const consultorios = await apiFetch('/api/consultorios').then(r=>r.json()).catch(()=>[]);
  const sel = $('agendaMedicaConsultorio');
  sel.innerHTML = '<option value="">Seleccionar consultorio</option>';
  consultorios.forEach(c => { const o = document.createElement('option'); o.value = c.id; o.textContent = c.nombre; sel.appendChild(o); });
  if (consultorios.length) sel.value = consultorios[0].id;
  $('cargarTurnosMedica').addEventListener('click', cargarTurnosMedica);
  if (!isElectro() && !isDoctor()) {
    $('crearTurnoMedica').addEventListener('click', crearTurnoMedica);
    $('nuevoPacienteNombreMedica').addEventListener('input', debounceBuscarPacientesMedica);
  }
  const nuevoTurnoSection = $('agendaNuevoTurnoSection');
  const doctorAcciones = $('agendaDoctorAcciones');
  if (nuevoTurnoSection) nuevoTurnoSection.style.display = (isElectro() || isDoctor()) ? 'none' : '';
  if (doctorAcciones) doctorAcciones.style.display = isDoctor() ? '' : 'none';
  $('btnLlamarSiguiente')?.addEventListener('click', llamarSiguientePaciente);
  $('btnMarcarAtendido')?.addEventListener('click', marcarAtendido);
  // Modal de edición solo para admin/recepción
  const editSection = $('agendaEditPacienteSection');
  if (editSection) {
    // Modal empieza oculto
    editSection.classList.add('hidden');
    if (isAdmin() || isRecepcion()) {
      $('btnGuardarNombreMedica').addEventListener('click', guardarNombrePacienteMedica);
      $('btnGuardarTurnoNumeroMedica').addEventListener('click', guardarNumeroTurnoMedica);
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

async function cargarTurnosMedica() {
  const fecha = $('agendaMedicaFecha').value;
  const consultorioId = $('agendaMedicaConsultorio').value;
  if (!fecha || !consultorioId) { showToast('Selecciona fecha y consultorio', 'error'); return; }
  try {
    const res = await apiFetch(`/api/turnos?fecha=${fecha}&consultorio_id=${consultorioId}`);
    const turnos = await res.json();
    const tbody = $('turnosTableBodyMedica');
    tbody.innerHTML = '';
    if (!turnos.length) tbody.innerHTML = '<tr><td colspan="6" style="padding:20px;text-align:center;color:#999">No hay turnos</td></tr>';
    else turnos.forEach(t => renderTurnoRowMedica(tbody, t));
  } catch (e) { showToast('Error cargando turnos', 'error'); }
}

let selectedTurnoMedica = null;

function renderTurnoRowMedica(tbody, t) {
  const tr = document.createElement('tr');
  tr.className = `turno-row estado-${t.estado}`;

  const esAtendido = t.estado === 'ATENDIDO';
  const esEnAtencion = t.estado === 'EN_ATENCION';

  // Doctor y usuario electro no editan por dropdown (doctor usa botones especiales)
  let canEdit = !isElectro() && !isDoctor();
  // No permitir edición desde dropdown cuando está EN_ATENCION o ATENDIDO
  if (esEnAtencion || esAtendido) canEdit = false;

  // Opciones generales (sin EN_ATENCION ni ATENDIDO, esos los controla el doctor)
  let estadosDisponibles = ['','PROGRAMADO','EN_SALA','CANCELADO','NO_ASISTIO','REPROGRAMADO'];

  const opts = estadosDisponibles.map(e => `<option value="${e}" ${t.estado===e?'selected':''}>${e ? e.replace(/_/g,' ') : ''}</option>`).join('');

  const estadoCell = canEdit
    ? `<select class="btn-estado" data-id="${t.id}">${opts}</select>`
    : escapeHtml((t.estado||'').replace(/_/g,' '));

  const puedeEliminar = isAdmin() || isRecepcion();
  const accionesCell = puedeEliminar
    ? `<button class="btn-estado-small" data-delete="${t.id}">Eliminar</button>`
    : '-';
  tr.innerHTML = `
    <td style="padding:8px;border:1px solid #ddd">${t.numero_turno}</td>
    <td style="padding:8px;border:1px solid #ddd">${escapeHtml(t.paciente_nombre)}</td>
    <td style="padding:8px;border:1px solid #ddd">${escapeHtml(t.paciente_documento||'')}</td>
    <td style="padding:8px;border:1px solid #ddd">${escapeHtml(t.entidad||'')}</td>
    <td style="padding:8px;border:1px solid #ddd">${estadoCell}</td>
    <td style="padding:8px;border:1px solid #ddd">${accionesCell}</td>
  `;
  // Selección de fila para panel de edición
  if (isAdmin() || isRecepcion()) {
    tr.addEventListener('click', () => {
      seleccionarTurnoMedica(tr, t);
    });
  }

  if (canEdit) {
    tr.querySelector('select')?.addEventListener('change', async (e)=>{
      try {
        await apiFetch(`/api/turnos/${e.target.dataset.id}/estado`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({estado:e.target.value}) });
        showToast('Estado actualizado', 'success');
        cargarTurnosMedica();
      } catch(x){ showToast('Error', 'error'); }
    });
  }
  if (puedeEliminar) {
    tr.querySelector('[data-delete]')?.addEventListener('click', async (e)=>{
      if (!confirm('¿Eliminar este turno?')) return;
      try {
        await apiFetch(`/api/turnos/${e.target.dataset.delete}`, { method:'DELETE' });
        showToast('Turno eliminado', 'success');
        cargarTurnosMedica();
      } catch(x){ showToast('Error', 'error'); }
    });
  }
  tbody.appendChild(tr);
}

async function llamarSiguientePaciente() {
  const fecha = $('agendaMedicaFecha').value;
  const consultorioId = $('agendaMedicaConsultorio').value;
  if (!fecha || !consultorioId) { showToast('Selecciona fecha y consultorio', 'error'); return; }
  try {
    const res = await apiFetch('/api/turnos/llamar-siguiente', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({fecha, consultorio_id:consultorioId}) });
    const data = await res.json();
    if (data.ok) { 
      const nombre = data.turno.paciente_nombre || '';
      const consultorio = data.turno.consultorio_nombre || '';
      showToast('Paciente llamado: ' + nombre, 'success'); 
      // Alerta por voz solo en la sesión del doctor
      if (isDoctor() && 'speechSynthesis' in window) {
        const texto = `Paciente ${nombre}, por favor pasar al consultorio ${consultorio}`;
        const utter = new SpeechSynthesisUtterance(texto);
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
  const consultorioId = $('agendaMedicaConsultorio').value;
  if (!fecha || !consultorioId) { showToast('Selecciona fecha y consultorio', 'error'); return; }
  try {
    const res = await apiFetch('/api/turnos/marcar-atendido', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({fecha, consultorio_id:consultorioId}) });
    const data = await res.json();
    if (data.ok) { showToast('Paciente marcado como atendido', 'success'); cargarTurnosMedica(); }
    else showToast(data.error||'Error', 'error');
  } catch (e) { showToast('Error', 'error'); }
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
      showToast(data.error || 'Error reordenando turno', 'error');
    }
  } catch (e) {
    showToast('Error reordenando turno', 'error');
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
    info.textContent = `Turno actual: ${t.numero_turno || '-'} · Estado: ${(t.estado || '').replace(/_/g,' ')} · Consultorio: ${t.consultorio_nombre || ''}`;
  }
  const inputNombre = $('editPacienteNombreMedica');
  if (inputNombre) {
    inputNombre.value = t.paciente_nombre || '';
  }
  const inputNumero = $('editTurnoNumeroMedica');
  if (inputNumero) {
    inputNumero.value = t.numero_turno && t.numero_turno > 0 ? t.numero_turno : '';
  }
  const modal = $('agendaEditPacienteSection');
  if (modal) {
    modal.classList.remove('hidden');
  }
}

async function guardarNombrePacienteMedica() {
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
    const res = await apiFetch(`/api/pacientes/${selectedTurnoMedica.paciente_id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre: nuevoNombre })
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
    showToast('Número de turno inválido', 'error');
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
      showToast('Número de turno actualizado', 'success');
      cargarTurnosMedica();
    } else {
      showToast(data.error || 'Error actualizando turno', 'error');
    }
  } catch (e) {
    showToast('Error actualizando turno', 'error');
  }
}

async function crearTurnoMedica() {
  const nombre = $('nuevoPacienteNombreMedica').value.trim();
  const doc = $('nuevoPacienteDocMedica').value.trim();
  const fecha = $('agendaMedicaFecha').value;
  const consultorioId = $('agendaMedicaConsultorio').value;
  if (!nombre || !fecha || !consultorioId) { showToast('Completa paciente, fecha y consultorio', 'error'); return; }
  let pacienteId;
  const opt = document.querySelector(`#pacientesListMedica option[value="${nombre}"]`);
  if (opt && opt.dataset.id) pacienteId = parseInt(opt.dataset.id, 10);
  else {
    const res = await apiFetch('/api/pacientes', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({nombre, documento:doc||null}) });
    const data = await res.json();
    if (!data.ok) { showToast(data.error||'Error creando paciente', 'error'); return; }
    pacienteId = data.id;
  }
  try {
    const body = { paciente_id: pacienteId, consultorio_id: parseInt(consultorioId,10), fecha, entidad: $('nuevoTurnoEntidadMedica').value, prioridad: parseInt($('nuevoTurnoPrioridadMedica').value,10) };
    const res = await apiFetch('/api/turnos', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
    const data = await res.json();
    if (data.ok) { showToast('Turno creado', 'success'); $('nuevoPacienteNombreMedica').value=''; $('nuevoPacienteDocMedica').value=''; cargarTurnosMedica(); }
    else showToast(data.error||'Error', 'error');
  } catch (e) { showToast('Error creando turno', 'error'); }
}

// ========== AGENDA ELECTRODIAGNÓSTICO ==========
async function initElectro() {
  const hoy = new Date().toISOString().slice(0,10);
  $('electroFecha').value = hoy;
  const equipos = await apiFetch('/api/equipos-electro').then(r=>r.json()).catch(()=>[]);
  const sel = $('electroEquipo');
  sel.innerHTML = '<option value="">Seleccionar equipo</option>';
  equipos.forEach(e => { const o = document.createElement('option'); o.value = e.id; o.textContent = e.nombre; sel.appendChild(o); });
  if (equipos.length) sel.value = equipos[0].id;
  $('cargarCitasElectro').addEventListener('click', cargarCitasElectro);
  const nuevaCitaSection = $('electroNuevaCitaSection');
  if (nuevaCitaSection) nuevaCitaSection.style.display = isDoctor() ? 'none' : '';
  if (!isDoctor()) {
    $('crearCitaElectro')?.addEventListener('click', crearCitaElectro);
    $('nuevoPacienteElectro')?.addEventListener('input', debounce(buscarPacientesElectro, 300));
  }
  await cargarCitasElectro();
}

async function buscarPacientesElectro() {
  const q = $('nuevoPacienteElectro').value.trim();
  if (q.length < 2) return;
  const res = await apiFetch(`/api/pacientes?buscar=${encodeURIComponent(q)}`);
  const pacientes = await res.json();
  const dl = $('pacientesListElectro');
  dl.innerHTML = '';
  pacientes.forEach(p => { const o = document.createElement('option'); o.value = p.nombre; o.dataset.id = p.id; o.dataset.doc = p.documento || ''; dl.appendChild(o); });
}

async function cargarCitasElectro() {
  const fecha = $('electroFecha').value;
  const equipoId = $('electroEquipo').value;
  if (!fecha || !equipoId) { showToast('Selecciona fecha y equipo', 'error'); return; }
  try {
    const res = await apiFetch(`/api/citas-electro?fecha=${fecha}&equipo_id=${equipoId}`);
    const citas = await res.json();
    const tbody = $('citasElectroBody');
    tbody.innerHTML = '';
    if (!citas.length) tbody.innerHTML = '<tr><td colspan="7" style="padding:20px;text-align:center;color:#999">No hay citas</td></tr>';
    else citas.forEach(c => renderCitaElectroRow(tbody, c));
  } catch (e) { showToast('Error cargando citas', 'error'); }
}

function renderCitaElectroRow(tbody, c) {
  const tr = document.createElement('tr');
  tr.className = `turno-row estado-${c.estado}`;
  const canEdit = !isDoctor();
  const estados = ['PROGRAMADO','EN_ATENCION','ATENDIDO','CANCELADO','NO_ASISTIO'];
  const opts = estados.map(e => `<option value="${e}" ${c.estado===e?'selected':''}>${e.replace(/_/g,' ')}</option>`).join('');
  const estadoCell = canEdit 
    ? `<select class="btn-estado" data-id="${c.id}">${opts}</select>` 
    : escapeHtml((c.estado||'').replace(/_/g,' '));
  const accionesCell = canEdit 
    ? `<button class="btn-estado-small" data-delete="${c.id}">Eliminar</button>` 
    : '-';
  tr.innerHTML = `
    <td style="padding:8px;border:1px solid #ddd">${escapeHtml(c.hora_inicio)}${c.hora_fin ? ' - ' + c.hora_fin : ''}</td>
    <td style="padding:8px;border:1px solid #ddd">${escapeHtml(c.paciente_nombre)}</td>
    <td style="padding:8px;border:1px solid #ddd">${escapeHtml(c.paciente_documento||'')}</td>
    <td style="padding:8px;border:1px solid #ddd">${escapeHtml(c.estudio||'')}</td>
    <td style="padding:8px;border:1px solid #ddd">${estadoCell}</td>
    <td style="padding:8px;border:1px solid #ddd;font-size:0.85rem;color:#666">${escapeHtml(c.editado_por_nombre||'-')}</td>
    <td style="padding:8px;border:1px solid #ddd">${accionesCell}</td>
  `;
  if (canEdit) {
    tr.querySelector('select')?.addEventListener('change', async (e)=>{
      try {
        await apiFetch(`/api/citas-electro/${e.target.dataset.id}/estado`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({estado:e.target.value}) });
        showToast('Estado actualizado', 'success');
        cargarCitasElectro();
      } catch(x){ showToast('Error', 'error'); }
    });
    tr.querySelector('[data-delete]')?.addEventListener('click', async (e)=>{
      if (!confirm('¿Eliminar esta cita?')) return;
      try {
        await apiFetch(`/api/citas-electro/${e.target.dataset.delete}`, { method:'DELETE' });
        showToast('Cita eliminada', 'success');
        cargarCitasElectro();
      } catch(x){ showToast('Error', 'error'); }
    });
  }
  tbody.appendChild(tr);
}

async function crearCitaElectro() {
  const nombre = $('nuevoPacienteElectro').value.trim();
  const doc = $('nuevoPacienteDocElectro').value.trim();
  const fecha = $('electroFecha').value;
  const equipoId = $('electroEquipo').value;
  const horaInicio = $('electroHoraInicio').value;
  if (!nombre || !fecha || !equipoId || !horaInicio) { showToast('Completa paciente, fecha, equipo y hora', 'error'); return; }
  let pacienteId;
  const opt = document.querySelector(`#pacientesListElectro option[value="${nombre}"]`);
  if (opt && opt.dataset.id) pacienteId = parseInt(opt.dataset.id, 10);
  else {
    const res = await apiFetch('/api/pacientes', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({nombre, documento:doc||null}) });
    const data = await res.json();
    if (!data.ok) { showToast(data.error||'Error creando paciente', 'error'); return; }
    pacienteId = data.id;
  }
  try {
    const body = { equipo_id: parseInt(equipoId,10), paciente_id: pacienteId, fecha, hora_inicio: horaInicio, hora_fin: $('electroHoraFin').value || null, estudio: $('electroEstudio').value || null };
    const res = await apiFetch('/api/citas-electro', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
    const data = await res.json();
    if (data.ok) { showToast('Cita creada', 'success'); $('nuevoPacienteElectro').value=''; $('nuevoPacienteDocElectro').value=''; $('electroHoraInicio').value=''; $('electroHoraFin').value=''; $('electroEstudio').value=''; cargarCitasElectro(); }
    else showToast(data.error||'Error', 'error');
  } catch (e) { showToast('Error creando cita', 'error'); }
}

// ========== GESTIÓN DE USUARIOS (solo admin) ==========
async function initUsuarios() {
  $('crearUsuario').addEventListener('click', crearUsuario);
  await cargarUsuarios();
}

async function cargarUsuarios() {
  try {
    const res = await apiFetch('/api/usuarios');
    if (res.status === 403) { showToast('No tienes permiso', 'error'); return; }
    const usuarios = await res.json();
    const tbody = $('usuariosTableBody');
    tbody.innerHTML = '';
    if (!usuarios.length) tbody.innerHTML = '<tr><td colspan="5" style="padding:20px;text-align:center;color:#999">No hay usuarios</td></tr>';
    else usuarios.forEach(u => {
      const tr = document.createElement('tr');
      const rolLabels = { admin: 'Administrador', recepcion: 'Recepción', electro: 'Electrodiagnóstico', doctor: 'Doctor' };
      tr.innerHTML = `
        <td style="padding:8px;border:1px solid #ddd">${escapeHtml(u.usuario)}</td>
        <td style="padding:8px;border:1px solid #ddd">${escapeHtml(u.nombre||'')}</td>
        <td style="padding:8px;border:1px solid #ddd">${rolLabels[u.rol]||u.rol}</td>
        <td style="padding:8px;border:1px solid #ddd">${u.activo ? 'Activo' : 'Inactivo'}</td>
        <td style="padding:8px;border:1px solid #ddd">
          <button class="btn-estado-small" data-edit="${u.id}">Editar</button>
          ${currentUser?.id !== u.id ? `<button class="btn-estado-small" data-del="${u.id}" style="background:#dc2626;margin-left:4px">Eliminar</button>` : ''}
        </td>
      `;
      tr.querySelector('[data-edit]')?.addEventListener('click', () => editarUsuario(u));
      tr.querySelector('[data-del]')?.addEventListener('click', async (e) => {
        if (!confirm('¿Eliminar este usuario?')) return;
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

function editarUsuario(u) {
  const nombre = prompt('Nombre:', u.nombre || '');
  if (nombre === null) return;
  const rol = prompt('Rol (admin, recepcion, electro, doctor):', u.rol || '');
  if (rol === null) return;
  const rolesValidos = ['admin','recepcion','electro','doctor'];
  if (!rolesValidos.includes(rol)) { showToast('Rol inválido', 'error'); return; }
  const password = prompt('Nueva contraseña (dejar vacío para no cambiar):', '');
  const body = { nombre: nombre.trim(), rol };
  if (password && password.trim()) body.password = password;
  apiFetch(`/api/usuarios/${u.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(r => r.json())
    .then(d => { if (d.ok) { showToast('Usuario actualizado', 'success'); cargarUsuarios(); } else showToast(d.error||'Error', 'error'); })
    .catch(() => showToast('Error', 'error'));
}

async function crearUsuario() {
  const usuario = $('newUserUsuario').value.trim();
  const password = $('newUserPassword').value;
  const nombre = $('newUserName').value.trim();
  const rol = $('newUserRol').value;
  if (!usuario || !password || !nombre || !rol) { showToast('Completa todos los campos', 'error'); return; }
  try {
    const res = await apiFetch('/api/usuarios', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuario, password, nombre, rol }) });
    const data = await res.json();
    if (data.ok) { showToast('Usuario creado', 'success'); $('newUserUsuario').value=''; $('newUserPassword').value=''; $('newUserName').value=''; cargarUsuarios(); }
    else showToast(data.error||'Error', 'error');
  } catch (e) { showToast('Error', 'error'); }
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
  
  tr.innerHTML = `
    <td>${descSelect}</td>
    <td><input class="item-price" type="number" min="0" step="0.01" placeholder="0" value="${price === 0 ? '' : price}"/></td>
    <td><button class="remove" type="button">✕</button></td>
  `;
  tbody.appendChild(tr);
  
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
  tr.querySelectorAll('.item-price').forEach(inp=>inp.addEventListener('input', ()=>{ recalc(); }));
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
    const price = Number(r.querySelector('.item-price').value || 0);
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
    items.push({
      desc: descEl.value,
      price: Number(r.querySelector('.item-price').value || 0)
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
    const price = Number(r.querySelector('.item-price').value || 0);
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
    const price = Number(r.querySelector('.item-price').value || 0);
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
    const cont = document.getElementById('savedItems');
    updateStats(recibos);
    
    if(cont){
      cont.innerHTML = '';
      if(!recibos.length) {
        cont.innerHTML = '<div style="padding:12px;text-align:center;color:#999">No hay recibos guardados</div>';
      } else {
        recibos.forEach(r=>{
          const d = document.createElement('div');
          d.style.borderTop = '1px solid #eee';
          d.style.padding = '12px 0';
          const deleteBtn = canDeleteRecibos() 
            ? `<button class="delete" data-id="${r.id}" style="font-size:0.85rem;padding:6px 10px;background:#ef4444;color:white;border:0;border-radius:6px;cursor:pointer">✕</button>`
            : '';
          d.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center">
              <div>
                <div><strong>Recibo ${escapeHtml(r.numero)}</strong> — ${escapeHtml(r.fecha)}</div>
                <div style="font-size:0.9rem;color:#666;margin-top:2px"><em>${escapeHtml(r.cliente)}</em> — $${escapeHtml(Number(r.total).toFixed(2))}</div>
              </div>
              <div style="display:flex;gap:6px">
                <a href="/api/recibos/${r.id}/pdf" target="_blank" style="padding:6px 10px;background:#10b981;color:white;border:0;border-radius:6px;cursor:pointer;font-size:0.85rem;text-decoration:none;display:inline-block">PDF</a>
                ${deleteBtn}
              </div>
            </div>
          `;
          cont.appendChild(d);
        });
        
        // listeners delete con protección de contraseña
        cont.querySelectorAll('.delete').forEach(b => b.addEventListener('click', async (e)=>{
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
  if(typeof n === 'undefined') {
    // intentar desde servidor
    apiFetch('/api/recibos').then(r=>r.json()).then(arr=> {
      updateStats(arr);
    }).catch(()=> {
      updateStats([]);
    });
  }
}

function updateStats(recibos) {
  const hoy = new Date().toISOString().slice(0, 10);
  const recibosHoy = recibos.filter(r => r.fecha === hoy);
  const totalHoy = recibosHoy.reduce((sum, r) => sum + (Number(r.total) || 0), 0);
  
  $('statsRecibosHoy').textContent = recibosHoy.length;
  $('statsTotalHoy').textContent = '$ ' + totalHoy.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

async function resetAllRecibos(){
  if(!confirm('⚠️ ¿Eliminar TODOS los recibos guardados? Esta acción no se puede deshacer.')) return;
  
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

// cargar inicial
async function cargar(){
  await cargarLista();
}
cargar();
