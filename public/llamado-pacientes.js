/**
 * Pantalla TV de llamado de pacientes.
 * Reposo: logo Innar. Al llamar: pop-up + voz intercalada (2 rondas).
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'innar_llamado_tv_doctores';
  const HISTORIAL_KEY = 'innar_llamado_tv_historial';
  const TAB_ACTIVE_KEY = 'innar_llamado_tv_tab_activa';
  const RELAY_KEY = 'innar_llamado_tv_relay';
  const DEDUPE_GLOBAL_KEY = 'innar_llamado_tv_dedupe';
  const HISTORIAL_MAX = 8;
  const BUFFER_PENDIENTE_MAX = 12;
  const TAB_HEARTBEAT_MS = 3000;
  const TAB_STALE_MS = 9000;
  const VECES_POR_RONDA = 2;
  const BATCH_MS = 900;
  const PAUSA_ENTRE_ANUNCIOS_MS = 500;
  const POPUP_EXTRA_MS = 800;
  const MIN_ANUNCIO_VISIBLE_MS = 4500;
  const ENCUELO_DEDUPE_MS = 5000;
  const MEDICOS_REFRESH_MS = 60000;

  let initDone = false;
  let audioUnlocked = false;
  let audioCtx = null;
  let ttsKeepAliveTimer = null;
  let voiceCache = null;
  let boundRealtime = false;
  let relojTimer = null;
  let medicosRefreshTimer = null;
  let tabHeartbeatTimer = null;

  let tabId = sessionStorage.getItem('innar_llamado_tab_id');
  if (!tabId) {
    tabId = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    sessionStorage.setItem('innar_llamado_tab_id', tabId);
  }

  let procesando = false;
  let colaAnuncios = [];
  let batchPendiente = [];
  let batchTimer = null;

  let medicos = [];
  let consultoriosActivos = new Set();
  /** @type {Map<string, number>} */
  const llamadosRecientes = new Map();
  /** @type {object[]} */
  let historialLlamados = [];
  /** @type {object[]} */
  let bufferPendienteModulo = [];

  function fetchApi(url) {
    if (typeof apiFetch === 'function') return apiFetch(url).then((r) => r.json());
    return fetch(url, { credentials: 'include' }).then((r) => r.json());
  }

  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function $(id) { return document.getElementById(id); }

  /* ── Consultorios activos / bloqueados ── */

  function cargarConsultoriosActivos() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const ids = JSON.parse(raw);
        if (Array.isArray(ids)) {
          consultoriosActivos = new Set(ids.map(Number).filter(Boolean));
          return;
        }
      }
    } catch (_) { /* ignore */ }
    consultoriosActivos = new Set();
  }

  function guardarConsultoriosActivos() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...consultoriosActivos]));
  }

  function resolverDoctorId(item) {
    if (item.doctor_id != null && item.doctor_id !== '') {
      return Number(item.doctor_id);
    }
    if (item.numero_consultorio !== '') {
      const matches = medicos.filter(
        (m) => String(m.numero_consultorio) === String(item.numero_consultorio)
      );
      if (matches.length === 1) return Number(matches[0].id);
    }
    if (item.doctor_nombre) {
      const byName = medicos.find(
        (m) => String(m.nombre || '').trim().toLowerCase() === String(item.doctor_nombre).trim().toLowerCase()
      );
      if (byName) return Number(byName.id);
    }
    return null;
  }

  function enriquecerLlamado(data) {
    const item = {
      paciente_nombre: String(data?.paciente_nombre || '').trim(),
      numero_consultorio: data?.numero_consultorio != null && data?.numero_consultorio !== ''
        ? String(data.numero_consultorio)
        : '',
      doctor_id: data?.doctor_id ?? null,
      doctor_nombre: data?.doctor_nombre ? String(data.doctor_nombre).trim() : ''
    };

    let med = null;
    if (item.doctor_id != null && item.doctor_id !== '') {
      med = medicos.find((m) => Number(m.id) === Number(item.doctor_id));
    }
    if (!med && item.numero_consultorio !== '') {
      const matches = medicos.filter(
        (m) => String(m.numero_consultorio) === String(item.numero_consultorio)
      );
      if (matches.length === 1) med = matches[0];
    }
    if (!med && item.doctor_nombre) {
      med = medicos.find(
        (m) => String(m.nombre || '').trim().toLowerCase() === item.doctor_nombre.toLowerCase()
      );
    }

    if (med) {
      item.doctor_id = med.id;
      if (!item.numero_consultorio && med.numero_consultorio != null && med.numero_consultorio !== '') {
        item.numero_consultorio = String(med.numero_consultorio);
      }
      if (!item.doctor_nombre) item.doctor_nombre = med.nombre || '';
    }

    return item;
  }

  function consultorioPermitido(item) {
    if (!consultoriosActivos.size) return false;
    const doctorId = resolverDoctorId(item);
    return !!(doctorId && consultoriosActivos.has(doctorId));
  }

  /* ── Coordinación multi-pestaña ── */

  function estaTabEsLlamadoActiva() {
    return window.currentModule === 'llamado-pacientes';
  }

  function leerTabLlamadoActiva() {
    try {
      const raw = localStorage.getItem(TAB_ACTIVE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data?.tabId || !data?.ts) return null;
      if (Date.now() - data.ts > TAB_STALE_MS) return null;
      return data;
    } catch (_) {
      return null;
    }
  }

  function otraTabTieneLlamadoActivo() {
    const data = leerTabLlamadoActiva();
    return !!(data && data.tabId !== tabId);
  }

  function enviarHeartbeatTabLlamado() {
    if (!estaTabEsLlamadoActiva()) return;
    localStorage.setItem(TAB_ACTIVE_KEY, JSON.stringify({ tabId, ts: Date.now() }));
  }

  function activarTabLlamado() {
    enviarHeartbeatTabLlamado();
    if (tabHeartbeatTimer) clearInterval(tabHeartbeatTimer);
    tabHeartbeatTimer = setInterval(enviarHeartbeatTabLlamado, TAB_HEARTBEAT_MS);
  }

  function desactivarTabLlamado() {
    if (tabHeartbeatTimer) {
      clearInterval(tabHeartbeatTimer);
      tabHeartbeatTimer = null;
    }
    try {
      const data = leerTabLlamadoActiva();
      if (data?.tabId === tabId) localStorage.removeItem(TAB_ACTIVE_KEY);
    } catch (_) { /* noop */ }
  }

  window.deactivateLlamadoPacientesTab = desactivarTabLlamado;

  function llamadoRecienteDuplicadoGlobal(item) {
    const key = claveLlamado(item);
    const now = Date.now();
    try {
      const raw = localStorage.getItem(DEDUPE_GLOBAL_KEY);
      const map = raw ? JSON.parse(raw) : {};
      if (map[key] != null && now - map[key] < ENCUELO_DEDUPE_MS) return true;
      map[key] = now;
      for (const [k, t] of Object.entries(map)) {
        if (now - t > ENCUELO_DEDUPE_MS) delete map[k];
      }
      localStorage.setItem(DEDUPE_GLOBAL_KEY, JSON.stringify(map));
    } catch (_) { /* noop */ }
    return false;
  }

  async function cargarMedicos() {
    try {
      medicos = await fetchApi('/api/medicos');
      if (!Array.isArray(medicos)) medicos = [];
    } catch (_) {
      medicos = [];
    }
  }

  async function asegurarConsultoriosIniciales() {
    await cargarMedicos();
    if (!consultoriosActivos.size && medicos.length) {
      medicos.forEach((m) => consultoriosActivos.add(m.id));
      guardarConsultoriosActivos();
    }
  }

  function renderConfigLista() {
    const lista = $('llamadoConfigLista');
    if (!lista) return;

    if (!medicos.length) {
      lista.innerHTML = '<p style="color:#64748b;font-size:.875rem;padding:8px 0">No hay médicos disponibles.</p>';
      return;
    }

    const ordenados = [...medicos].sort((a, b) => {
      const ca = a.numero_consultorio ?? 9999;
      const cb = b.numero_consultorio ?? 9999;
      return ca - cb || String(a.nombre).localeCompare(String(b.nombre));
    });

    lista.innerHTML = ordenados.map((m) => {
      const activo = consultoriosActivos.has(m.id);
      const consNum = m.numero_consultorio != null ? String(m.numero_consultorio) : null;
      const consTxt = consNum ? 'Recibe llamados en pantalla' : 'Sin consultorio asignado';
      return `<label class="ltv-toggle-item${activo ? ' is-on' : ' is-off'}" data-doctor-id="${m.id}">
        <div class="ltv-toggle-item-info">
          <div class="ltv-toggle-item-nombre">${escapeHtml(m.nombre)}</div>
          <div class="ltv-toggle-item-cons">${consNum ? `<span class="ltv-toggle-item-cons-num">${escapeHtml(consNum)}</span>` : ''}${escapeHtml(consTxt)}</div>
        </div>
        <div class="ltv-switch">
          <input type="checkbox" ${activo ? 'checked' : ''} data-doctor-id="${m.id}" aria-label="Consultorio ${escapeHtml(m.nombre)}" />
          <span class="ltv-switch-track"></span>
        </div>
      </label>`;
    }).join('');

    lista.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.addEventListener('change', () => {
        const id = Number(cb.dataset.doctorId);
        if (cb.checked) consultoriosActivos.add(id);
        else consultoriosActivos.delete(id);
        guardarConsultoriosActivos();
        const row = cb.closest('.ltv-toggle-item');
        row?.classList.toggle('is-on', cb.checked);
        row?.classList.toggle('is-off', !cb.checked);
        actualizarUiEstado();
      });
    });
  }

  function puedeConfigurarLlamado() {
    return typeof window.tienePermiso === 'function'
      && (window.tienePermiso('llamado.configurar') || window.tienePermiso('modulo.llamado_pacientes'));
  }

  function aplicarPermisosUiLlamado() {
    const cfg = $('btnLlamadoConfig');
    if (cfg) cfg.style.display = puedeConfigurarLlamado() ? '' : 'none';
  }

  function abrirConfig() {
    if (!puedeConfigurarLlamado()) return;
    cargarMedicos().then(() => {
      renderConfigLista();
      $('llamadoConfigBackdrop')?.classList.remove('hidden');
      $('llamadoConfigPanel')?.classList.remove('hidden');
    });
  }

  function cerrarConfig() {
    $('llamadoConfigBackdrop')?.classList.add('hidden');
    $('llamadoConfigPanel')?.classList.add('hidden');
  }

  function activarTodosConsultorios() {
    medicos.forEach((m) => consultoriosActivos.add(m.id));
    guardarConsultoriosActivos();
    renderConfigLista();
    actualizarUiEstado();
  }

  function bloquearTodosConsultorios() {
    if (consultoriosActivos.size && typeof showConfirm === 'function') {
      showConfirm('¿Bloquear todos los consultorios? No se mostrarán llamados hasta activar al menos uno.', () => {
        consultoriosActivos.clear();
        guardarConsultoriosActivos();
        renderConfigLista();
        actualizarUiEstado();
      }, { okText: 'Bloquear todos', icon: '🔇' });
      return;
    }
    consultoriosActivos.clear();
    guardarConsultoriosActivos();
    renderConfigLista();
    actualizarUiEstado();
  }

  function cargarHistorialLocal() {
    try {
      const raw = sessionStorage.getItem(HISTORIAL_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) historialLlamados = parsed.slice(0, HISTORIAL_MAX);
    } catch (_) { historialLlamados = []; }
  }

  function guardarHistorialLocal() {
    try {
      sessionStorage.setItem(HISTORIAL_KEY, JSON.stringify(historialLlamados.slice(0, HISTORIAL_MAX)));
    } catch (_) { /* noop */ }
  }

  function formatearHoraLlamado(ts) {
    try {
      return new Intl.DateTimeFormat('es-CO', {
        timeZone: 'America/Bogota',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      }).format(new Date(ts));
    } catch (_) {
      return '';
    }
  }

  function registrarEnHistorial(item) {
    if (!item?.paciente_nombre) return;
    historialLlamados.unshift({
      paciente_nombre: item.paciente_nombre,
      numero_consultorio: item.numero_consultorio || '',
      ts: Date.now()
    });
    if (historialLlamados.length > HISTORIAL_MAX) {
      historialLlamados.length = HISTORIAL_MAX;
    }
    guardarHistorialLocal();
    renderHistorial();
  }

  function renderHistorial() {
    const panel = $('llamadoHistorial');
    const lista = $('llamadoHistorialLista');
    if (!panel || !lista) return;

    if (!historialLlamados.length) {
      panel.classList.add('hidden');
      lista.innerHTML = '';
      return;
    }

    panel.classList.remove('hidden');
    lista.innerHTML = historialLlamados.map((h) => {
      const cons = h.numero_consultorio ? `Consultorio ${escapeHtml(h.numero_consultorio)}` : 'Consultorio —';
      return `<li class="ltv-historial-item">
        <div class="ltv-historial-item-top">
          <span class="ltv-historial-hora">${escapeHtml(formatearHoraLlamado(h.ts))}</span>
          <span class="ltv-historial-cons">${cons}</span>
        </div>
        <div class="ltv-historial-nombre">${escapeHtml(h.paciente_nombre)}</div>
      </li>`;
    }).join('');
  }

  function actualizarUiEstado() {
    const bar = $('llamadoStatusBar');
    const alerta = $('llamadoAlertaBloqueo');
    const activos = consultoriosActivos.size;
    const enFullscreen = !!document.fullscreenElement;

    if (bar) {
      if (activos > 0 || enFullscreen) {
        bar.classList.add('hidden');
        bar.textContent = '';
      } else {
        bar.textContent = 'Ningún consultorio activo — active al menos uno en configuración';
        bar.classList.remove('hidden', 'ltv-status-bar--audio-off');
        bar.classList.add('ltv-status-bar--warn');
      }
    }

    if (alerta) {
      alerta.classList.toggle('hidden', activos > 0 || enFullscreen);
    }

    renderHistorial();
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /* ── Reloj ── */

  function actualizarReloj() {
    const el = $('llamadoTvReloj');
    if (!el) return;
    const now = new Date();
    const fecha = new Intl.DateTimeFormat('es-CO', {
      timeZone: 'America/Bogota',
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    }).format(now);
    const hora = new Intl.DateTimeFormat('es-CO', {
      timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit', hour12: true
    }).format(now);
    el.textContent = `${fecha.charAt(0).toUpperCase() + fecha.slice(1)} · ${hora}`;
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
      const v = voices.find((x) => x.name.includes(name));
      if (v) { voiceCache = v; return v; }
    }
    const langs = ['es-CO', 'es-419', 'es-MX', 'es-US', 'es-ES'];
    for (const lang of langs) {
      const v = voices.find((x) => x.lang === lang || x.lang.startsWith(lang + '-'));
      if (v) { voiceCache = v; return v; }
    }
    voiceCache = voices.find((v) => v.lang.startsWith('es')) || null;
    return voiceCache;
  }

  if ('speechSynthesis' in window) {
    window.speechSynthesis.onvoiceschanged = () => { voiceCache = null; };
  }

  function unlockAudioContext() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtx) audioCtx = new Ctx();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const buf = audioCtx.createBuffer(1, 1, 22050);
      const src = audioCtx.createBufferSource();
      src.buffer = buf;
      src.connect(audioCtx.destination);
      src.start(0);
    } catch (_) { /* noop */ }
  }

  function iniciarTtsKeepAlive() {
    if (ttsKeepAliveTimer) return;
    ttsKeepAliveTimer = setInterval(() => {
      if (!audioUnlocked || !('speechSynthesis' in window)) return;
      const synth = window.speechSynthesis;
      if (synth.speaking || synth.pending) {
        if (synth.paused) synth.resume();
      }
      if (audioCtx?.state === 'suspended') audioCtx.resume().catch(() => {});
    }, 180);
  }

  function detenerTtsKeepAlive() {
    if (ttsKeepAliveTimer) {
      clearInterval(ttsKeepAliveTimer);
      ttsKeepAliveTimer = null;
    }
  }

  function unlockAudio() {
    if (!('speechSynthesis' in window)) return;
    if (!audioUnlocked) {
      audioUnlocked = true;
      unlockAudioContext();
      const silent = new SpeechSynthesisUtterance(' ');
      silent.volume = 0;
      silent.lang = 'es-CO';
      try {
        window.speechSynthesis.speak(silent);
        if (window.speechSynthesis.paused) window.speechSynthesis.resume();
      } catch (_) { /* noop */ }
    }
    const btn = $('btnLlamadoActivarAudio');
    if (btn) {
      btn.classList.add('is-ready');
      btn.title = 'Audio activado';
      btn.setAttribute('aria-hidden', 'true');
    }
    actualizarUiEstado();
  }

  function textoAnuncio(item) {
    const nombre = String(item?.paciente_nombre || 'paciente').trim();
    const cons = item?.numero_consultorio;
    const consTxt = cons != null && cons !== '' ? String(cons) : '—';
    return `Paciente ${nombre}, pasar al consultorio ${consTxt}`;
  }

  function estimarDuracionAnuncioMs(texto) {
    const palabras = String(texto || '').trim().split(/\s+/).filter(Boolean).length;
    return Math.max(MIN_ANUNCIO_VISIBLE_MS, palabras * 380 + 1200);
  }

  function esperarVocesListas(timeoutMs) {
    if (!('speechSynthesis' in window)) return Promise.resolve();
    if (window.speechSynthesis.getVoices().length) return Promise.resolve();
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      const timer = setTimeout(finish, timeoutMs);
      const prev = window.speechSynthesis.onvoiceschanged;
      window.speechSynthesis.onvoiceschanged = () => {
        clearTimeout(timer);
        if (typeof prev === 'function') prev();
        finish();
      };
    });
  }

  function hablarAsync(texto) {
    return new Promise((resolve) => {
      if (!audioUnlocked || !('speechSynthesis' in window)) {
        resolve();
        return;
      }

      const synth = window.speechSynthesis;
      const run = () => {
        const utter = new SpeechSynthesisUtterance(texto);
        utter.rate = 0.88;
        utter.pitch = 1.02;
        utter.volume = 1;
        const voice = pickSoftSpanishVoice();
        if (voice) { utter.voice = voice; utter.lang = voice.lang; }
        else { utter.lang = 'es-CO'; }

        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(maxTimer);
          resolve();
        };

        const maxTimer = setTimeout(finish, Math.max(12000, estimarDuracionAnuncioMs(texto) + 2000));
        utter.onend = finish;
        utter.onerror = finish;

        try {
          if (synth.speaking || synth.pending) synth.cancel();
          if (synth.paused) synth.resume();
          synth.speak(utter);
          // Chrome a veces no arranca TTS hasta resume()
          if (synth.paused) synth.resume();
        } catch (_) {
          finish();
        }
      };

      void esperarVocesListas(600).then(run);
    });
  }

  /* ── Pop-up ── */

  function mostrarPopup(item) {
    const popup = $('llamadoPopup');
    const nomEl = $('llamadoPopupNombre');
    const consEl = $('llamadoPopupConsultorio');
    if (nomEl) nomEl.textContent = item.paciente_nombre || 'Paciente';
    if (consEl) {
      consEl.textContent = item.numero_consultorio != null && item.numero_consultorio !== ''
        ? String(item.numero_consultorio)
        : '—';
    }
    popup?.classList.remove('hidden', 'is-animate');
    $('llamadoIdleLogo')?.classList.add('is-dimmed');
    requestAnimationFrame(() => popup?.classList.add('is-animate'));
  }

  function ocultarPopup() {
    const popup = $('llamadoPopup');
    popup?.classList.remove('is-animate');
    popup?.classList.add('hidden');
    $('llamadoIdleLogo')?.classList.remove('is-dimmed');
  }

  function retransmitirLlamadoATabActiva(item) {
    try {
      localStorage.setItem(RELAY_KEY, JSON.stringify({ item, ts: Date.now(), fromTab: tabId }));
    } catch (_) { /* noop */ }
  }

  /* ── Cola intercalada ── */

  function normalizarLlamado(data) {
    return enriquecerLlamado(data || {});
  }

  function ordenarPorConsultorio(items) {
    return [...items].sort((a, b) => {
      const na = parseInt(a.numero_consultorio, 10);
      const nb = parseInt(b.numero_consultorio, 10);
      if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
      return String(a.numero_consultorio).localeCompare(String(b.numero_consultorio));
    });
  }

  /** Genera secuencia intercalada: 302, 303, 304, 302, 303, 304 (2 rondas) */
  function construirSecuencia(items) {
    const unicos = ordenarPorConsultorio(items);
    const secuencia = [];
    for (let r = 0; r < VECES_POR_RONDA; r++) {
      for (const item of unicos) {
        secuencia.push(item);
      }
    }
    return secuencia;
  }

  function encolarLlamado(data) {
    const item = normalizarLlamado(data);
    if (!item.paciente_nombre) return false;
    if (!consultorioPermitido(item)) return false;
    if (llamadoRecienteDuplicado(item)) return false;
    if (llamadoRecienteDuplicadoGlobal(item)) return false;

    batchPendiente.push(item);
    if (batchTimer) clearTimeout(batchTimer);
    batchTimer = setTimeout(finalizarBatch, BATCH_MS);
    return true;
  }

  function procesarLlamadoEntrante(data) {
    const item = normalizarLlamado(data);
    if (!item.paciente_nombre) return;

    if (estaTabEsLlamadoActiva()) {
      unlockAudio();
      encolarLlamado(item);
      return;
    }

    if (otraTabTieneLlamadoActivo()) {
      retransmitirLlamadoATabActiva(item);
      bufferPendienteModulo.length = 0;
      return;
    }

    bufferPendienteModulo.push(item);
    if (bufferPendienteModulo.length > BUFFER_PENDIENTE_MAX) {
      bufferPendienteModulo.shift();
    }
  }

  function vaciarBufferPendiente() {
    if (!bufferPendienteModulo.length) return;
    const pendientes = bufferPendienteModulo.splice(0);
    unlockAudio();
    pendientes.forEach((item) => encolarLlamado(item));
  }

  function finalizarBatch() {
    batchTimer = null;
    if (!batchPendiente.length) return;

    const items = dedupeLlamados(batchPendiente.splice(0));
    if (!items.length) return;

    items.forEach((item) => registrarEnHistorial(item));

    const secuencia = construirSecuencia(items);
    if (!secuencia.length) return;

    colaAnuncios.push(...secuencia);

    if (!procesando) procesarCola();
  }

  function claveLlamado(item) {
    return `${item.doctor_id ?? ''}|${item.numero_consultorio}|${item.paciente_nombre}`.toLowerCase();
  }

  function llamadoRecienteDuplicado(item) {
    const key = claveLlamado(item);
    const now = Date.now();
    const last = llamadosRecientes.get(key);
    if (last != null && now - last < ENCUELO_DEDUPE_MS) return true;
    llamadosRecientes.set(key, now);
    if (llamadosRecientes.size > 100) {
      for (const [k, t] of llamadosRecientes) {
        if (now - t > ENCUELO_DEDUPE_MS) llamadosRecientes.delete(k);
      }
    }
    return false;
  }

  async function anunciarItem(item) {
    const texto = textoAnuncio(item);
    mostrarPopup(item);
    const minVisibleMs = estimarDuracionAnuncioMs(texto);
    await Promise.all([
      hablarAsync(texto),
      sleep(minVisibleMs)
    ]);
    await sleep(POPUP_EXTRA_MS);
  }

  function dedupeLlamados(items) {
    const map = new Map();
    for (const item of items) {
      const key = claveLlamado(item);
      map.set(key, item);
    }
    return [...map.values()];
  }

  async function procesarCola() {
    if (procesando) return;
    if (!colaAnuncios.length) return;
    procesando = true;
    unlockAudio();
    iniciarTtsKeepAlive();

    while (colaAnuncios.length) {
      const item = colaAnuncios.shift();
      await anunciarItem(item);

      if (colaAnuncios.length) {
        await sleep(PAUSA_ENTRE_ANUNCIOS_MS);
      }
    }

    ocultarPopup();
    procesando = false;
    detenerTtsKeepAlive();

    if (batchPendiente.length) {
      finalizarBatch();
    }
  }

  /* ── Eventos tiempo real ── */

  async function onLlamadoEvent(data) {
    if (!medicos.length) await cargarMedicos();
    if (!consultoriosActivos.size && medicos.length && window.currentModule === 'llamado-pacientes') {
      medicos.forEach((m) => consultoriosActivos.add(m.id));
      guardarConsultoriosActivos();
    }
    procesarLlamadoEntrante(data || {});
  }

  function bindRealtime() {
    if (boundRealtime) return;
    const attach = () => {
      if (!window.socket || boundRealtime) return;
      window.socket.on('agenda:anunciar-paciente', onLlamadoEvent);
      window.socket.on('agenda:turno-llamar-siguiente', onLlamadoEvent);
      boundRealtime = true;
    };
    if (window.socketReady && window.socket) attach();
    document.addEventListener('socketReady', attach);
  }

  function iniciarRefreshMedicos() {
    if (medicosRefreshTimer) clearInterval(medicosRefreshTimer);
    medicosRefreshTimer = setInterval(() => {
      if (window.currentModule !== 'llamado-pacientes') return;
      cargarMedicos();
    }, MEDICOS_REFRESH_MS);
  }

  function detenerRefreshMedicos() {
    if (medicosRefreshTimer) {
      clearInterval(medicosRefreshTimer);
      medicosRefreshTimer = null;
    }
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
    actualizarUiEstado();
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
    unlockAudio();

    if (!initDone) {
      initDone = true;
      $('btnVolverLlamadoPacientes')?.addEventListener('click', () => {
        if (typeof goToMenu === 'function') goToMenu();
      });
      $('btnLlamadoActivarAudio')?.addEventListener('click', unlockAudio);
      $('view-llamado-pacientes')?.addEventListener('click', unlockAudio, { once: true });
      $('btnLlamadoConfig')?.addEventListener('click', abrirConfig);
      $('btnLlamadoConfigCerrar')?.addEventListener('click', cerrarConfig);
      $('llamadoConfigBackdrop')?.addEventListener('click', cerrarConfig);
      $('btnLlamadoConfigTodos')?.addEventListener('click', activarTodosConsultorios);
      $('btnLlamadoConfigNinguno')?.addEventListener('click', bloquearTodosConsultorios);
      $('btnLlamadoFullscreen')?.addEventListener('click', toggleFullscreen);
      document.addEventListener('fullscreenchange', actualizarEstadoFullscreen);
      document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (window.currentModule !== 'llamado-pacientes') return;
        if (document.fullscreenElement) {
          document.exitFullscreen?.().catch(() => {});
        }
      });
      bindRealtime();
    }

    cargarConsultoriosActivos();
    cargarHistorialLocal();
    if (!procesando) ocultarPopup();
    await asegurarConsultoriosIniciales();
    aplicarPermisosUiLlamado();
    renderConfigLista();
    actualizarUiEstado();
    vaciarBufferPendiente();
    activarTabLlamado();
    iniciarReloj();
    iniciarRefreshMedicos();
  };

  document.addEventListener('visibilitychange', () => {
    if (window.currentModule !== 'llamado-pacientes') return;
    if (document.hidden) {
      detenerReloj();
      if (procesando || colaAnuncios.length) iniciarTtsKeepAlive();
    } else {
      actualizarReloj();
      iniciarReloj();
      cargarMedicos();
      iniciarRefreshMedicos();
      actualizarUiEstado();
      unlockAudio();
      if ('speechSynthesis' in window && window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
    }
  });

  window.addEventListener('storage', (e) => {
    if (e.key === RELAY_KEY && e.newValue && estaTabEsLlamadoActiva()) {
      try {
        const payload = JSON.parse(e.newValue);
        if (payload?.item) {
          unlockAudio();
          encolarLlamado(payload.item);
        }
      } catch (_) { /* noop */ }
      return;
    }
    if (e.key !== TAB_ACTIVE_KEY) return;
    if (!e.newValue) return;
    try {
      const data = JSON.parse(e.newValue);
      if (data?.tabId && data.tabId !== tabId) bufferPendienteModulo.length = 0;
    } catch (_) { /* noop */ }
  });

  window.addEventListener('beforeunload', desactivarTabLlamado);

  bindRealtime();
})();
