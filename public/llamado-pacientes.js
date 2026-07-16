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
  let relojTimer = null;
  let highlightTimers = {};

  let medicos = [];
  let turnos = [];
  let doctoresActivos = new Set();
  let llamadosActivos = {};

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

  /* ── Reloj ── */

  function actualizarReloj() {
    const el = $('llamadoTvReloj');
    if (!el) return;
    const now = new Date();
    const fecha = new Intl.DateTimeFormat('es-CO', {
      timeZone: 'America/Bogota',
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    }).format(now);
    const hora = new Intl.DateTimeFormat('es-CO', {
      timeZone: 'America/Bogota',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    }).format(now);
    const fechaCap = fecha.charAt(0).toUpperCase() + fecha.slice(1);
    el.textContent = `${fechaCap} · ${hora}`;
  }

  function iniciarReloj() {
    actualizarReloj();
    if (relojTimer) clearInterval(relojTimer);
    relojTimer = setInterval(actualizarReloj, 30000);
  }

  function detenerReloj() {
    if (relojTimer) { clearInterval(relojTimer); relojTimer = null; }
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
      btn.classList.add('is-ready');
      btn.title = 'Audio activado';
      const label = btn.querySelector('span');
      if (label) label.textContent = 'Audio ✓';
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

  function pacienteVisibleParaDoctor(doctorId) {
    const ahora = Date.now();
    const llamado = llamadosActivos[doctorId];
    if (llamado && llamado.until > ahora && llamado.nombre) {
      return { tipo: 'llamando', nombre: llamado.nombre };
    }

    const delDoctor = turnosDelDoctor(doctorId);
    const enAtencion = delDoctor.find(t => t.estado === 'EN_ATENCION');
    if (enAtencion) {
      return { tipo: 'en_atencion', nombre: enAtencion.paciente_nombre || '' };
    }

    const siguiente = delDoctor.find(t => t.estado === 'EN_SALA' && t.numero_turno === 1);
    if (siguiente) {
      return { tipo: 'siguiente', nombre: siguiente.paciente_nombre || '' };
    }

    const primerEnSala = delDoctor
      .filter(t => t.estado === 'EN_SALA')
      .sort((a, b) => (a.numero_turno ?? 999) - (b.numero_turno ?? 999))[0];
    if (primerEnSala?.paciente_nombre) {
      return { tipo: 'siguiente', nombre: primerEnSala.paciente_nombre };
    }

    return { tipo: 'vacio', nombre: '' };
  }

  function htmlPaciente(nombre, etiqueta) {
    return `<div class="ltv-card-paciente-wrap">
      <span class="ltv-card-paciente-label">${escapeHtml(etiqueta)}</span>
      <p class="ltv-card-paciente">${escapeHtml(nombre)}</p>
    </div>`;
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
      const consNum = m.numero_consultorio != null && m.numero_consultorio !== ''
        ? String(m.numero_consultorio)
        : '—';

      let cardMod = '';
      let bodyHtml;

      if ((pac.tipo === 'siguiente' || pac.tipo === 'llamando') && pac.nombre) {
        cardMod = pac.tipo === 'llamando' ? ' ltv-card--siguiente ltv-card--llamando' : ' ltv-card--siguiente';
        bodyHtml = htmlPaciente(pac.nombre, pac.tipo === 'llamando' ? 'Paciente llamado' : 'Siguiente paciente');
      } else if (pac.tipo === 'en_atencion' && pac.nombre) {
        cardMod = ' ltv-card--atencion';
        bodyHtml = htmlPaciente(pac.nombre, 'En consulta');
      } else {
        bodyHtml = `<p class="ltv-card-estado ltv-card-estado--espera"><span class="ltv-card-estado-dot"></span>En espera</p>`;
      }

      return `<article class="ltv-card${cardMod}" data-doctor-id="${m.id}">
        <span class="ltv-card-badge-llamando">Llamando</span>
        <header class="ltv-card-head">
          <div class="ltv-card-cons-badge">
            <span class="ltv-card-cons-label">Cons.</span>
            <span class="ltv-card-cons-num">${escapeHtml(consNum)}</span>
          </div>
          <p class="ltv-card-doctor">${escapeHtml(m.nombre)}</p>
        </header>
        <div class="ltv-card-body">${bodyHtml}</div>
      </article>`;
    }).join('');

    Object.keys(highlightTimers).forEach(id => {
      const card = grid.querySelector(`.ltv-card[data-doctor-id="${id}"]`);
      if (card) card.classList.add('ltv-card--llamando');
    });
  }

  function registrarLlamado(data) {
    let doctorId = data?.doctor_id;
    if (!doctorId && data?.numero_consultorio != null) {
      const med = medicos.find(m =>
        Number(m.numero_consultorio) === Number(data.numero_consultorio)
      );
      doctorId = med?.id;
    }
    if (!doctorId || !data?.paciente_nombre) return;
    doctorId = Number(doctorId);
    llamadosActivos[doctorId] = {
      nombre: data.paciente_nombre,
      until: Date.now() + HIGHLIGHT_MS
    };
    if (highlightTimers[doctorId]) clearTimeout(highlightTimers[doctorId]);
    highlightTimers[doctorId] = setTimeout(() => {
      delete llamadosActivos[doctorId];
      delete highlightTimers[doctorId];
      renderGrid();
    }, HIGHLIGHT_MS);
  }

  function resaltarConsultorio(doctorId) {
    const card = document.querySelector(`.ltv-card[data-doctor-id="${doctorId}"]`);
    if (card) card.classList.add('ltv-card--llamando');
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

  /* ── Drawer configuración ── */

  function renderConfigLista() {
    const lista = $('llamadoConfigLista');
    if (!lista) return;

    if (!medicos.length) {
      lista.innerHTML = '<p style="color:#64748b;font-size:.875rem;padding:8px 0">No hay médicos disponibles.</p>';
      return;
    }

    lista.innerHTML = medicos.map(m => {
      const activo = doctoresActivos.has(m.id);
      const consNum = m.numero_consultorio != null ? String(m.numero_consultorio) : null;
      const consTxt = consNum ? 'Consultorio asignado' : 'Sin consultorio asignado';
      return `<label class="ltv-toggle-item${activo ? ' is-on' : ''}" data-doctor-id="${m.id}">
        <div class="ltv-toggle-item-info">
          <div class="ltv-toggle-item-nombre">${escapeHtml(m.nombre)}</div>
          <div class="ltv-toggle-item-cons">${consNum ? `<span class="ltv-toggle-item-cons-num">${escapeHtml(consNum)}</span>` : ''}${escapeHtml(consTxt)}</div>
        </div>
        <div class="ltv-switch">
          <input type="checkbox" ${activo ? 'checked' : ''} data-doctor-id="${m.id}" aria-label="Mostrar consultorio de ${escapeHtml(m.nombre)}" />
          <span class="ltv-switch-track"></span>
        </div>
      </label>`;
    }).join('');

    lista.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', () => {
        const id = Number(cb.dataset.doctorId);
        if (cb.checked) doctoresActivos.add(id);
        else doctoresActivos.delete(id);
        guardarDoctoresActivos();
        cb.closest('.ltv-toggle-item')?.classList.toggle('is-on', cb.checked);
        renderGrid();
      });
    });
  }

  function abrirConfig() {
    renderConfigLista();
    $('llamadoConfigBackdrop')?.classList.remove('hidden');
    $('llamadoConfigPanel')?.classList.remove('hidden');
  }

  function cerrarConfig() {
    $('llamadoConfigBackdrop')?.classList.add('hidden');
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
    registrarLlamado(data || {});
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

  /* ── Pantalla completa ── */

  function actualizarEstadoFullscreen() {
    const view = $('view-llamado-pacientes');
    const btn = $('btnLlamadoFullscreen');
    const isFs = !!document.fullscreenElement;
    view?.classList.toggle('ltv-is-fullscreen', isFs);
    btn?.classList.toggle('is-active', isFs);
    btn?.querySelector('.ltv-fs-icon-expand')?.classList.toggle('hidden', isFs);
    btn?.querySelector('.ltv-fs-icon-compress')?.classList.toggle('hidden', !isFs);
    const label = btn?.querySelector('.ltv-fs-label');
    if (label) label.textContent = isFs ? 'Salir' : 'Pantalla completa';
  }

  function toggleFullscreen() {
    const target = $('view-llamado-pacientes') || document.documentElement;
    if (!document.fullscreenElement) {
      target.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
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
      $('btnLlamadoEmptyConfig')?.addEventListener('click', abrirConfig);
      $('btnLlamadoFullscreen')?.addEventListener('click', toggleFullscreen);
      $('btnLlamadoConfigCerrar')?.addEventListener('click', cerrarConfig);
      $('llamadoConfigBackdrop')?.addEventListener('click', cerrarConfig);
      $('btnLlamadoConfigTodos')?.addEventListener('click', activarTodos);
      $('btnLlamadoConfigNinguno')?.addEventListener('click', desactivarTodos);
      document.addEventListener('fullscreenchange', actualizarEstadoFullscreen);
      document.addEventListener('mousemove', (e) => {
        const view = $('view-llamado-pacientes');
        if (!view?.classList.contains('ltv-is-fullscreen')) return;
        view.classList.toggle('ltv-show-bar', e.clientY < 80);
      });
      bindRealtime();
    }

    cargarDoctoresActivos();
    iniciarReloj();
    await refrescarCompleto();
    iniciarPolling();
  };

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      detenerPolling();
      detenerReloj();
    } else if (window.currentModule === 'llamado-pacientes') {
      actualizarReloj();
      iniciarReloj();
      refrescar();
      iniciarPolling();
    }
  });
})();
