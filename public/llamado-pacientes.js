/**
 * Módulo pantalla TV de llamado de pacientes (sala de espera multi-consultorio).
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'innar_llamado_tv_doctores';
  const POLL_MS = 8000;
  const HIGHLIGHT_MS = 45000;

  let initDone = false;
  let audioUnlocked = false;
  let voiceCache = null;
  let boundRealtime = false;
  let pollTimer = null;
  let highlightTimers = {};

  let medicos = [];
  let turnos = [];
  let doctoresActivos = new Set();

  function $(id) { return document.getElementById(id); }

  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function hoyISO() {
    if (typeof hoyColombiaISO === 'function') return hoyColombiaISO();
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Bogota',
      year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    const y = parts.find(p => p.type === 'year')?.value;
    const m = parts.find(p => p.type === 'month')?.value;
    const d = parts.find(p => p.type === 'day')?.value;
    return `${y}-${m}-${d}`;
  }

  function fetchApi(url) {
    if (typeof apiFetch === 'function') return apiFetch(url).then(r => r.json());
    return fetch(url, { credentials: 'include' }).then(r => r.json());
  }

  /* ── Audio / TTS ── */

  function pickSoftSpanishVoice() {
    if (voiceCache) return voiceCache;
    if (!('speechSynthesis' in window)) return null;
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return null;
    const preferNames = [
      'Google español', 'Microsoft Sabina', 'Paulina', 'Helena', 'Monica',
      'Luciana', 'Soledad', 'Esperanza', 'Paloma', 'Camila'
    ];
    for (const name of preferNames) {
      const v = voices.find(x => x.name.includes(name));
      if (v) { voiceCache = v; return v; }
    }
    const langs = ['es-CO', 'es-419', 'es-MX', 'es-US', 'es-ES'];
    for (const lang of langs) {
      const v = voices.find(x => x.lang === lang || x.lang.startsWith(lang + '-'));
      if (v) { voiceCache = v; return v; }
    }
    voiceCache = voices.find(v => v.lang.startsWith('es')) || null;
    return voiceCache;
  }

  if ('speechSynthesis' in window) {
    window.speechSynthesis.onvoiceschanged = () => { voiceCache = null; };
  }

  function unlockAudio() {
    if (audioUnlocked || !('speechSynthesis' in window)) return;
    audioUnlocked = true;
    const silent = new SpeechSynthesisUtterance(' ');
    silent.volume = 0;
    silent.lang = 'es-CO';
    window.speechSynthesis.speak(silent);
    const btn = $('btnLlamadoActivarAudio');
    if (btn) {
      btn.textContent = 'Audio activado';
      btn.classList.add('is-ready');
      btn.disabled = true;
    }
  }

  function textoAnuncio(data) {
    const nombre = String(data?.paciente_nombre || 'paciente').trim();
    const cons = data?.numero_consultorio;
    const doc = String(data?.doctor_nombre || '').trim();
    const consTxt = cons ? `consultorio número ${cons}` : 'consultorio';
    const docTxt = doc ? ` con ${doc}` : '';
    return `Atención. ${nombre}, por favor diríjase al ${consTxt}${docTxt}.`;
  }

  function hablarLlamado(data) {
    if (!audioUnlocked || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(textoAnuncio(data));
    utter.rate = 0.86;
    utter.pitch = 1.02;
    utter.volume = 1;
    const voice = pickSoftSpanishVoice();
    if (voice) { utter.voice = voice; utter.lang = voice.lang; }
    else { utter.lang = 'es-CO'; }
    window.speechSynthesis.speak(utter);
  }

  /* ── Persistencia consultorios activos ── */

  function cargarDoctoresActivos() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const ids = JSON.parse(raw);
        if (Array.isArray(ids)) {
          doctoresActivos = new Set(ids.map(Number).filter(Boolean));
          return;
        }
      }
    } catch (_) { /* ignore */ }
    doctoresActivos = new Set();
  }

  function guardarDoctoresActivos() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...doctoresActivos]));
  }

  /* ── Grid layout ── */

  function calcularGrid(n) {
    if (n <= 1) return { cols: 1, rows: 1 };
    if (n === 2) return { cols: 2, rows: 1 };
    if (n <= 4) return { cols: 2, rows: Math.ceil(n / 2) };
    if (n <= 6) return { cols: 3, rows: Math.ceil(n / 3) };
    if (n <= 9) return { cols: 3, rows: Math.ceil(n / 3) };
    const cols = Math.ceil(Math.sqrt(n));
    return { cols, rows: Math.ceil(n / cols) };
  }

  /* ── Lógica de paciente visible ── */

  function turnosDelDoctor(doctorId) {
    return turnos.filter(t => Number(t.doctor_id) === Number(doctorId));
  }

  /**
   * Muestra el paciente "Siguiente" solo si:
   * - Está EN_SALA con numero_turno === 1
   * - No hay paciente EN_ATENCION (el anterior ya fue atendido)
   */
  function pacienteVisibleParaDoctor(doctorId) {
    const delDoctor = turnosDelDoctor(doctorId);
    const enAtencion = delDoctor.find(t => t.estado === 'EN_ATENCION');
    if (enAtencion) {
      return { tipo: 'en_atencion', nombre: enAtencion.paciente_nombre || '' };
    }
    const siguiente = delDoctor.find(t => t.estado === 'EN_SALA' && t.numero_turno === 1);
    if (siguiente) {
      return { tipo: 'siguiente', nombre: siguiente.paciente_nombre || '' };
    }
    return { tipo: 'vacio', nombre: '' };
  }

  /* ── Render ── */

  function renderGrid() {
    const grid = $('llamadoTvGrid');
    const empty = $('llamadoTvEmpty');
    if (!grid) return;

    const activos = medicos
      .filter(m => doctoresActivos.has(m.id))
      .sort((a, b) => {
        const ca = a.numero_consultorio ?? 9999;
        const cb = b.numero_consultorio ?? 9999;
        return ca - cb || String(a.nombre).localeCompare(String(b.nombre));
      });

    if (!activos.length) {
      grid.classList.add('hidden');
      grid.innerHTML = '';
      empty?.classList.remove('hidden');
      return;
    }

    empty?.classList.add('hidden');
    grid.classList.remove('hidden');

    const { cols, rows } = calcularGrid(activos.length);
    grid.style.setProperty('--tv-cols', cols);
    grid.style.setProperty('--tv-rows', rows);

    grid.innerHTML = activos.map(m => {
      const pac = pacienteVisibleParaDoctor(m.id);
      let pacienteHtml;
      if (pac.tipo === 'siguiente') {
        pacienteHtml = `<div class="llamado-consultorio-card-paciente">${escapeHtml(pac.nombre)}</div>`;
      } else if (pac.tipo === 'en_atencion') {
        pacienteHtml = `<div class="llamado-consultorio-card-paciente is-en-atencion">En atención</div>`;
      } else {
        pacienteHtml = `<div class="llamado-consultorio-card-paciente is-vacio">—</div>`;
      }

      const consNum = m.numero_consultorio != null && m.numero_consultorio !== ''
        ? String(m.numero_consultorio)
        : '—';

      return `<div class="llamado-consultorio-card" data-doctor-id="${m.id}">
        <div class="llamado-consultorio-card-num-wrap">
          <span class="llamado-consultorio-card-label">Consultorio</span>
          <span class="llamado-consultorio-card-num">${escapeHtml(consNum)}</span>
        </div>
        <div class="llamado-consultorio-card-doctor">${escapeHtml(m.nombre)}</div>
        ${pacienteHtml}
      </div>`;
    }).join('');
  }

  function resaltarConsultorio(doctorId) {
    const card = document.querySelector(`.llamado-consultorio-card[data-doctor-id="${doctorId}"]`);
    if (!card) return;
    card.classList.add('is-llamando');
    if (highlightTimers[doctorId]) clearTimeout(highlightTimers[doctorId]);
    highlightTimers[doctorId] = setTimeout(() => {
      card.classList.remove('is-llamando');
      delete highlightTimers[doctorId];
    }, HIGHLIGHT_MS);
  }

  function resaltarPorEvento(data) {
    const doctorId = data?.doctor_id;
    if (doctorId) resaltarConsultorio(doctorId);
    else if (data?.numero_consultorio != null) {
      const med = medicos.find(m =>
        Number(m.numero_consultorio) === Number(data.numero_consultorio)
      );
      if (med) resaltarConsultorio(med.id);
    }
  }

  /* ── Datos ── */

  async function cargarMedicos() {
    try {
      medicos = await fetchApi('/api/medicos');
      if (!Array.isArray(medicos)) medicos = [];
    } catch (_) {
      medicos = [];
    }
  }

  async function cargarTurnos() {
    const fecha = hoyISO();
    try {
      const data = await fetchApi(
        `/api/turnos?fecha=${fecha}&estado=EN_SALA,EN_ATENCION,ATENDIDO`
      );
      turnos = Array.isArray(data) ? data : [];
    } catch (_) {
      turnos = [];
    }
  }

  async function refrescar() {
    await cargarTurnos();
    renderGrid();
  }

  async function refrescarCompleto() {
    await cargarMedicos();
    if (!doctoresActivos.size && medicos.length) {
      medicos.forEach(m => doctoresActivos.add(m.id));
      guardarDoctoresActivos();
    }
    await refrescar();
    renderConfigLista();
  }

  function iniciarPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      if (window.currentModule !== 'llamado-pacientes') return;
      refrescar();
    }, POLL_MS);
  }

  function detenerPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  /* ── Config panel ── */

  function renderConfigLista() {
    const lista = $('llamadoConfigLista');
    if (!lista) return;

    if (!medicos.length) {
      lista.innerHTML = '<p style="color:#64748b;font-size:.875rem">No hay médicos disponibles.</p>';
      return;
    }

    lista.innerHTML = medicos.map(m => {
      const activo = doctoresActivos.has(m.id);
      const cons = m.numero_consultorio != null ? `Consultorio ${m.numero_consultorio}` : 'Sin consultorio asignado';
      return `<label class="llamado-config-item${activo ? ' is-active' : ''}" data-doctor-id="${m.id}">
        <input type="checkbox" ${activo ? 'checked' : ''} data-doctor-id="${m.id}" />
        <div class="llamado-config-item-info">
          <div class="llamado-config-item-nombre">${escapeHtml(m.nombre)}</div>
          <div class="llamado-config-item-cons">${escapeHtml(cons)}</div>
        </div>
      </label>`;
    }).join('');

    lista.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', () => {
        const id = Number(cb.dataset.doctorId);
        if (cb.checked) doctoresActivos.add(id);
        else doctoresActivos.delete(id);
        guardarDoctoresActivos();
        cb.closest('.llamado-config-item')?.classList.toggle('is-active', cb.checked);
        renderGrid();
      });
    });
  }

  function abrirConfig() {
    renderConfigLista();
    $('llamadoConfigPanel')?.classList.remove('hidden');
  }

  function cerrarConfig() {
    $('llamadoConfigPanel')?.classList.add('hidden');
  }

  function activarTodos() {
    medicos.forEach(m => doctoresActivos.add(m.id));
    guardarDoctoresActivos();
    renderConfigLista();
    renderGrid();
  }

  function desactivarTodos() {
    doctoresActivos.clear();
    guardarDoctoresActivos();
    renderConfigLista();
    renderGrid();
  }

  /* ── Eventos tiempo real ── */

  function onLlamadoEvent(data) {
    if (window.currentModule !== 'llamado-pacientes') return;
    unlockAudio();
    hablarLlamado(data || {});
    resaltarPorEvento(data || {});
    refrescar();
  }

  function onEstadoCambio() {
    if (window.currentModule !== 'llamado-pacientes') return;
    refrescar();
  }

  function bindRealtime() {
    if (boundRealtime) return;
    const attach = () => {
      if (!window.socket || boundRealtime) return;
      window.socket.on('agenda:anunciar-paciente', onLlamadoEvent);
      window.socket.on('agenda:turno-llamar-siguiente', onLlamadoEvent);
      window.socket.on('agenda:turno-estado-cambio', onEstadoCambio);
      window.socket.on('agenda:turno-marcar-atendido', onEstadoCambio);
      boundRealtime = true;
    };
    if (window.socketReady && window.socket) attach();
    document.addEventListener('socketReady', attach);
  }

  /* ── Init ── */

  window.initLlamadoPacientes = async function initLlamadoPacientes() {
    if (!initDone) {
      initDone = true;
      $('btnVolverLlamadoPacientes')?.addEventListener('click', () => {
        if (typeof goToMenu === 'function') goToMenu();
      });
      $('btnLlamadoActivarAudio')?.addEventListener('click', unlockAudio);
      $('btnLlamadoConfig')?.addEventListener('click', abrirConfig);
      $('btnLlamadoConfigCerrar')?.addEventListener('click', cerrarConfig);
      $('llamadoConfigBackdrop')?.addEventListener('click', cerrarConfig);
      $('btnLlamadoConfigTodos')?.addEventListener('click', activarTodos);
      $('btnLlamadoConfigNinguno')?.addEventListener('click', desactivarTodos);
      bindRealtime();
    }

    cargarDoctoresActivos();
    unlockAudio();
    await refrescarCompleto();
    iniciarPolling();
  };

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      detenerPolling();
    } else if (window.currentModule === 'llamado-pacientes') {
      refrescar();
      iniciarPolling();
    }
  });
})();
