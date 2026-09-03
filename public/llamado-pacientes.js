/**
 * Pantalla TV de llamado de pacientes.
 * Reposo: logo Innar. Al llamar: pop-up + voz intercalada (2 rondas).
 */
(function () {
  'use strict';

  const STORAGE_KEY_LEGACY = 'innar_llamado_tv_doctores';
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
  const CALLS_SESION_KEY = 'innar_llamado_tv_calls_sesion';
  const MEDICOS_REFRESH_MS = 60000;

  let initDone = false;
  let audioUnlocked = false;
  let audioCtx = null;
  let ttsAudioEl = null;
  let ttsKeepAliveTimer = null;
  let voiceCache = null;
  let boundRealtime = false;
  let relojTimer = null;
  let medicosRefreshTimer = null;
  let tabHeartbeatTimer = null;
  let guardandoActivos = false;
  let tvConfigFecha = null;
  /** @type {Record<string, number>} */
  let consultoriosJornada = {};

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

  function fetchApi(url, opts) {
    if (typeof apiFetch === 'function') {
      return apiFetch(url, opts).then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || `Error ${r.status}`);
        return data;
      });
    }
    return fetch(url, { credentials: 'include', ...(opts || {}) }).then(async (r) => {
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `Error ${r.status}`);
      return data;
    });
  }

  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function $(id) { return document.getElementById(id); }

  function toastLlamado(msg, type) {
    if (typeof showToast === 'function') showToast(msg, type || 'info');
    else if (typeof sopToast === 'function') sopToast(msg, type || 'info');
  }

  /* ── Consultorios activos / jornada (compartido en servidor) ── */

  function aplicarTvConfig(payload, { silent } = {}) {
    if (!payload || typeof payload !== 'object') return;
    if (payload.fecha) tvConfigFecha = payload.fecha;
    if (Array.isArray(payload.doctor_ids)) {
      consultoriosActivos = new Set(payload.doctor_ids.map(Number).filter(Boolean));
    }
    if (payload.consultorios_jornada && typeof payload.consultorios_jornada === 'object') {
      consultoriosJornada = {};
      for (const [k, v] of Object.entries(payload.consultorios_jornada)) {
        const n = parseInt(v, 10);
        if (Number.isFinite(n) && n > 0) consultoriosJornada[String(k)] = n;
      }
    }
    medicos = medicos.map((m) => enriquecerMedicoLocal(m));
    if (!silent) {
      renderConfigLista();
      actualizarUiEstado();
    }
  }

  function enriquecerMedicoLocal(m) {
    const id = Number(m.id);
    const base = m.numero_consultorio_base != null
      ? m.numero_consultorio_base
      : (m.numero_consultorio_permanente != null ? m.numero_consultorio_permanente : m.numero_consultorio);
    const jornada = consultoriosJornada[String(id)];
    const efectivo = jornada != null ? jornada : (m.numero_consultorio_efectivo != null
      ? m.numero_consultorio_efectivo
      : base);
    return {
      ...m,
      numero_consultorio_base: base,
      numero_consultorio_jornada: jornada != null ? jornada : null,
      numero_consultorio_efectivo: efectivo,
      numero_consultorio: efectivo
    };
  }

  async function cargarTvConfig() {
    try {
      const data = await fetchApi('/api/llamado/tv-config');
      aplicarTvConfig(data, { silent: true });
      try { localStorage.removeItem(STORAGE_KEY_LEGACY); } catch (_) { /* noop */ }
      return data;
    } catch (e) {
      // Fallback legacy solo si el servidor aún no tiene el endpoint
      try {
        const raw = localStorage.getItem(STORAGE_KEY_LEGACY);
        if (raw !== null) {
          const ids = JSON.parse(raw);
          if (Array.isArray(ids)) {
            consultoriosActivos = new Set(ids.map(Number).filter(Boolean));
          }
        }
      } catch (_) { /* noop */ }
      throw e;
    }
  }

  async function guardarConsultoriosActivos() {
    if (guardandoActivos) return;
    guardandoActivos = true;
    const ids = [...consultoriosActivos];
    try {
      const data = await fetchApi('/api/llamado/consultorios-activos', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ doctor_ids: ids })
      });
      aplicarTvConfig(data, { silent: true });
    } catch (e) {
      toastLlamado(e.message || 'No se pudo guardar consultorios activos', 'error');
      try { await cargarTvConfig(); } catch (_) { /* noop */ }
      renderConfigLista();
      actualizarUiEstado();
    } finally {
      guardandoActivos = false;
    }
  }

  async function guardarConsultorioJornada(doctorId, numero) {
    const data = await fetchApi('/api/llamado/consultorio-jornada', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ doctor_id: doctorId, numero_consultorio: numero })
    });
    aplicarTvConfig(data);
    return data;
  }

  async function restaurarConsultorioJornada(doctorId) {
    const data = await fetchApi(`/api/llamado/consultorio-jornada/${doctorId}`, {
      method: 'DELETE'
    });
    aplicarTvConfig(data);
    return data;
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
    const turnoIdRaw = data?.turno_id;
    const turnoIdNum = parseInt(turnoIdRaw, 10);
    const item = {
      paciente_nombre: String(data?.paciente_nombre || '').trim(),
      numero_consultorio: data?.numero_consultorio != null && data?.numero_consultorio !== ''
        ? String(data.numero_consultorio)
        : '',
      doctor_id: data?.doctor_id ?? null,
      doctor_nombre: data?.doctor_nombre ? String(data.doctor_nombre).trim() : '',
      call_id: data?.call_id ? String(data.call_id).trim() : '',
      turno_id: Number.isFinite(turnoIdNum) && turnoIdNum > 0 ? turnoIdNum : null
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

  function leerSetSesion(key) {
    try {
      const arr = JSON.parse(sessionStorage.getItem(key) || '[]');
      return new Set((Array.isArray(arr) ? arr : []).map(String).filter(Boolean));
    } catch (_) {
      return new Set();
    }
  }

  function guardarSetSesion(key, set) {
    try {
      sessionStorage.setItem(key, JSON.stringify([...set].slice(-200)));
    } catch (_) { /* noop */ }
  }

  const callIdsVistos = leerSetSesion(CALLS_SESION_KEY);

  function llamadoSesionDuplicado(item) {
    const callId = String(item?.call_id || '').trim();
    return !!(callId && callIdsVistos.has(callId));
  }

  function marcarLlamadoSesion(item) {
    const callId = String(item?.call_id || '').trim();
    if (!callId || callIdsVistos.has(callId)) return;
    callIdsVistos.add(callId);
    guardarSetSesion(CALLS_SESION_KEY, callIdsVistos);
  }

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
      const raw = await fetchApi('/api/medicos');
      medicos = Array.isArray(raw) ? raw.map(enriquecerMedicoLocal) : [];
    } catch (_) {
      medicos = [];
    }
  }

  async function asegurarConfigLlamado() {
    try {
      await cargarTvConfig();
    } catch (_) { /* fallback local ya aplicado en cargarTvConfig */ }
    await cargarMedicos();
    if (!consultoriosActivos.size && medicos.length) {
      medicos.forEach((m) => consultoriosActivos.add(m.id));
      await guardarConsultoriosActivos();
    }
  }

  function renderConfigLista() {
    const lista = $('llamadoConfigLista');
    if (!lista) return;

    if (!medicos.length) {
      lista.innerHTML = typeof htmlListaVacia === 'function'
        ? htmlListaVacia('Sin médicos', 'No hay médicos disponibles.')
        : '<p class="ltv-empty-text">No hay médicos disponibles.</p>';
      return;
    }

    const ordenados = [...medicos].sort((a, b) => {
      const ca = a.numero_consultorio ?? 9999;
      const cb = b.numero_consultorio ?? 9999;
      return ca - cb || String(a.nombre).localeCompare(String(b.nombre));
    });

    const fechaLbl = tvConfigFecha ? `Hoy (${tvConfigFecha})` : 'Hoy';

    lista.innerHTML = ordenados.map((m) => {
      const activo = consultoriosActivos.has(m.id);
      const base = m.numero_consultorio_base != null ? String(m.numero_consultorio_base) : '';
      const efectivo = m.numero_consultorio != null ? String(m.numero_consultorio) : '';
      const tieneOverride = m.numero_consultorio_jornada != null;
      const consTxt = efectivo
        ? (tieneOverride ? `Consultorio ${fechaLbl}` : 'Consultorio base')
        : 'Sin consultorio asignado';
      return `<div class="ltv-toggle-item${activo ? ' is-on' : ' is-off'}" data-doctor-id="${m.id}">
        <div class="ltv-toggle-item-info">
          <div class="ltv-toggle-item-nombre">${escapeHtml(m.nombre)}</div>
          <div class="ltv-toggle-item-cons">
            ${efectivo ? `<span class="ltv-toggle-item-cons-num">${escapeHtml(efectivo)}</span>` : ''}
            ${escapeHtml(consTxt)}
            ${base && tieneOverride ? `<span class="ltv-toggle-item-base">· base ${escapeHtml(base)}</span>` : ''}
          </div>
          <div class="ltv-cons-edit">
            <label class="ltv-cons-edit-label">Nº consultorio</label>
            <input type="number" min="1" class="ltv-cons-input" data-doctor-id="${m.id}"
              value="${escapeHtml(efectivo)}" ${puedeConfigurarLlamado() ? '' : 'disabled'}
              aria-label="Número de consultorio de ${escapeHtml(m.nombre)}" />
            <button type="button" class="ltv-cons-save" data-doctor-id="${m.id}"
              ${puedeConfigurarLlamado() ? '' : 'disabled'} title="Guardar número de hoy">Guardar</button>
            ${tieneOverride
              ? `<button type="button" class="ltv-cons-restore" data-doctor-id="${m.id}"
                  ${puedeConfigurarLlamado() ? '' : 'disabled'} title="Volver al número base del doctor">Base</button>`
              : ''}
          </div>
        </div>
        <label class="ltv-switch" title="Activo en pantalla">
          <input type="checkbox" ${activo ? 'checked' : ''} data-doctor-id="${m.id}"
            ${puedeConfigurarLlamado() ? '' : 'disabled'}
            aria-label="Consultorio ${escapeHtml(m.nombre)}" />
          <span class="ltv-switch-track"></span>
        </label>
      </div>`;
    }).join('');

    lista.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.addEventListener('change', () => {
        const id = Number(cb.dataset.doctorId);
        if (cb.checked) consultoriosActivos.add(id);
        else consultoriosActivos.delete(id);
        const row = cb.closest('.ltv-toggle-item');
        row?.classList.toggle('is-on', cb.checked);
        row?.classList.toggle('is-off', !cb.checked);
        actualizarUiEstado();
        guardarConsultoriosActivos();
      });
    });

    lista.querySelectorAll('.ltv-cons-save').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = Number(btn.dataset.doctorId);
        const input = lista.querySelector(`.ltv-cons-input[data-doctor-id="${id}"]`);
        const num = parseInt(input?.value, 10);
        if (!Number.isFinite(num) || num < 1) {
          toastLlamado('Indique un número de consultorio válido', 'warning');
          return;
        }
        btn.disabled = true;
        try {
          await guardarConsultorioJornada(id, num);
          toastLlamado('Consultorio actualizado para hoy', 'success');
        } catch (e) {
          toastLlamado(e.message || 'No se pudo guardar', 'error');
        } finally {
          btn.disabled = false;
        }
      });
    });

    lista.querySelectorAll('.ltv-cons-restore').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = Number(btn.dataset.doctorId);
        btn.disabled = true;
        try {
          await restaurarConsultorioJornada(id);
          toastLlamado('Se restauró el consultorio base', 'success');
        } catch (e) {
          toastLlamado(e.message || 'No se pudo restaurar', 'error');
        } finally {
          btn.disabled = false;
        }
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
    Promise.all([cargarTvConfig().catch(() => null), cargarMedicos()]).then(() => {
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
    renderConfigLista();
    actualizarUiEstado();
    guardarConsultoriosActivos();
  }

  function bloquearTodosConsultorios() {
    if (consultoriosActivos.size && typeof showConfirm === 'function') {
      showConfirm('¿Bloquear todos los consultorios? No se mostrarán llamados hasta activar al menos uno.', () => {
        consultoriosActivos.clear();
        renderConfigLista();
        actualizarUiEstado();
        guardarConsultoriosActivos();
      }, { okText: 'Bloquear todos', icon: '🔇' });
      return;
    }
    consultoriosActivos.clear();
    renderConfigLista();
    actualizarUiEstado();
    guardarConsultoriosActivos();
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
    const audioOff = estaTabEsLlamadoActiva() && !audioUnlocked;

    if (bar) {
      if (activos === 0) {
        bar.textContent = 'Ningún consultorio activo — active al menos uno en configuración';
        bar.classList.remove('hidden', 'ltv-status-bar--audio-off');
        bar.classList.add('ltv-status-bar--warn');
      } else if (audioOff) {
        bar.textContent = 'Toque la pantalla para activar el audio de llamados';
        bar.classList.remove('hidden', 'ltv-status-bar--warn');
        bar.classList.add('ltv-status-bar--audio-off');
      } else {
        bar.classList.add('hidden');
        bar.textContent = '';
      }
    }

    if (alerta) {
      alerta.classList.toggle('hidden', activos > 0);
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

  const TTS_SERVER_ENABLED = true;
  /** MP3 silencioso para desbloquear `<audio>` en iOS Safari. */
  const SILENT_MP3 = 'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAAYYoRwmHAAAAAAD/+1DEAAAAGkAAAAAAAA0gAAAAAA==';

  function esDispositivoIos() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function obtenerAudioTts() {
    if (!ttsAudioEl) {
      ttsAudioEl = document.createElement('audio');
      ttsAudioEl.preload = 'auto';
      ttsAudioEl.playsInline = true;
      ttsAudioEl.setAttribute('playsinline', 'true');
      ttsAudioEl.setAttribute('webkit-playsinline', 'true');
      ttsAudioEl.style.cssText = 'position:fixed;width:0;height:0;opacity:0;pointer-events:none';
      document.body.appendChild(ttsAudioEl);
    }
    return ttsAudioEl;
  }

  async function warmUpAudioElement() {
    const audio = obtenerAudioTts();
    try {
      if (!audio.src || audio.src === window.location.href) audio.src = SILENT_MP3;
      audio.currentTime = 0;
      await audio.play();
      audio.pause();
      audio.currentTime = 0;
    } catch (_) { /* noop */ }
  }

  function puntuacionVoz(voice) {
    const name = String(voice?.name || '').toLowerCase();
    const lang = String(voice?.lang || '').toLowerCase();
    let score = 0;
    if (esDispositivoIos()) {
      const iosPrefer = ['paulina', 'mónica', 'monica', 'jorge', 'enhanced', 'premium'];
      for (let i = 0; i < iosPrefer.length; i++) {
        if (name.includes(iosPrefer[i])) score += 150 - i * 10;
      }
    }
    if (name.includes('siri') || name.includes('enhanced')) score += 200;
    if (name.includes('neural')) score += 120;
    if (name.includes('natural') || name.includes('premium')) score += 80;
    if (name.includes('online')) score += 60;
    if (lang.startsWith('es-mx')) score += 45;
    if (lang.startsWith('es-co') || lang.startsWith('es-419')) score += 40;
    const preferNames = [
      'dalia', 'paloma', 'monica', 'paulina', 'sabina', 'helena', 'luciana',
      'soledad', 'esperanza', 'camila', 'google español', 'microsoft'
    ];
    for (let i = 0; i < preferNames.length; i++) {
      if (name.includes(preferNames[i])) score += 40 - i;
    }
    if (voice?.localService === false) score += 15;
    return score;
  }

  function pickSoftSpanishVoice() {
    if (voiceCache) return voiceCache;
    if (!('speechSynthesis' in window)) return null;
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return null;
    const esVoices = voices.filter((v) => String(v.lang || '').toLowerCase().startsWith('es'));
    const pool = esVoices.length ? esVoices : voices;
    pool.sort((a, b) => puntuacionVoz(b) - puntuacionVoz(a));
    voiceCache = pool[0] || null;
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
    if (!('speechSynthesis' in window) && !window.Audio) return;
    if (!audioUnlocked) {
      audioUnlocked = true;
      unlockAudioContext();
      void warmUpAudioElement();
      if ('speechSynthesis' in window) {
        const silent = new SpeechSynthesisUtterance(' ');
        silent.volume = 0;
        silent.lang = 'es-CO';
        try {
          window.speechSynthesis.speak(silent);
          if (window.speechSynthesis.paused) window.speechSynthesis.resume();
        } catch (_) { /* noop */ }
      }
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
    const cons = String(item?.numero_consultorio ?? '').trim() || 'indicado';
    return `${nombre}, pase al consultorio ${cons}.`;
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

  function hablarConNavegadorAsync(texto) {
    return new Promise((resolve) => {
      if (!('speechSynthesis' in window)) {
        resolve();
        return;
      }

      const synth = window.speechSynthesis;
      const run = () => {
        const utter = new SpeechSynthesisUtterance(texto);
        utter.rate = 0.94;
        utter.pitch = 0.98;
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
          if (synth.paused) synth.resume();
        } catch (_) {
          finish();
        }
      };

      void esperarVocesListas(esDispositivoIos() ? 1800 : 600).then(run);
    });
  }

  function hablarConServidorAsync(texto) {
    return new Promise(async (resolve, reject) => {
      try {
        const url = `/api/llamado/tts?text=${encodeURIComponent(texto)}`;
        const res = typeof apiFetch === 'function'
          ? await apiFetch(url)
          : await fetch(url, { credentials: 'include' });
        if (!res.ok) {
          reject(new Error('TTS servidor no disponible'));
          return;
        }
        const blob = await res.blob();
        if (!blob?.size) {
          reject(new Error('Audio vacío'));
          return;
        }
        const src = URL.createObjectURL(blob);
        const audio = obtenerAudioTts();
        audio.volume = 1;
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(maxTimer);
          URL.revokeObjectURL(src);
          resolve();
        };
        const maxTimer = setTimeout(finish, Math.max(15000, estimarDuracionAnuncioMs(texto) + 4000));
        audio.onended = finish;
        audio.onerror = finish;
        if (audioCtx?.state === 'suspended') await audioCtx.resume().catch(() => {});
        audio.src = src;
        await audio.play();
      } catch (e) {
        reject(e);
      }
    });
  }

  async function hablarAsync(texto) {
    if (!audioUnlocked) return;

    /* iOS: voz del sistema (Paulina/Mónica) — el audio remoto suele bloquearse tras fetch async. */
    if (esDispositivoIos()) {
      await hablarConNavegadorAsync(texto);
      return;
    }

    if (TTS_SERVER_ENABLED) {
      try {
        await hablarConServidorAsync(texto);
        return;
      } catch (_) {
        /* fallback navegador */
      }
    }

    await hablarConNavegadorAsync(texto);
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

  function emitirAnuncioAck(item, estado) {
    const callId = String(item?.call_id || '').trim();
    if (!callId || !window.socket) return;
    window.socket.emit('agenda:anuncio-ack', {
      call_id: callId,
      estado,
      paciente_nombre: item?.paciente_nombre || ''
    });
  }

  function encolarLlamado(data) {
    const item = normalizarLlamado(data);
    if (!item.paciente_nombre) return false;
    if (!consultorioPermitido(item)) return false;
    if (llamadoSesionDuplicado(item)) return 'duplicado_evento';
    if (llamadoRecienteDuplicado(item)) return 'duplicado_reciente';
    if (llamadoRecienteDuplicadoGlobal(item)) return 'duplicado_reciente';
    marcarLlamadoSesion(item);

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
      if (!consultorioPermitido(item)) {
        emitirAnuncioAck(item, 'filtrado');
        return;
      }
      const ok = encolarLlamado(item);
      if (ok === true) emitirAnuncioAck(item, audioUnlocked ? 'reproducido' : 'sin_audio');
      else if (ok === 'duplicado_evento') emitirAnuncioAck(item, audioUnlocked ? 'reproducido' : 'sin_audio');
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
    emitirAnuncioAck(item, 'modulo_oculto');
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
    procesarLlamadoEntrante(data || {});
  }

  function bindRealtime() {
    if (boundRealtime) return;
    const attach = () => {
      if (!window.socket || boundRealtime) return;
      window.socket.on('agenda:anunciar-paciente', onLlamadoEvent);
      window.socket.on('llamado:tv-config', (payload) => {
        aplicarTvConfig(payload || {});
        cargarMedicos().then(() => {
          if (!$('llamadoConfigPanel')?.classList.contains('hidden')) renderConfigLista();
          actualizarUiEstado();
        });
      });
      window.socket.on('agenda:medicos-consultorio', () => {
        cargarTvConfig().catch(() => null).then(() => cargarMedicos()).then(() => {
          if (!$('llamadoConfigPanel')?.classList.contains('hidden')) renderConfigLista();
          actualizarUiEstado();
        });
      });
      boundRealtime = true;
    };
    if (window.socketReady && window.socket) attach();
    document.addEventListener('socketReady', attach);
  }

  function iniciarRefreshMedicos() {
    if (medicosRefreshTimer) clearInterval(medicosRefreshTimer);
    medicosRefreshTimer = setInterval(() => {
      if (window.currentModule !== 'llamado-pacientes') return;
      Promise.all([
        cargarTvConfig().catch(() => null),
        cargarMedicos()
      ]).then(() => {
        if (!$('llamadoConfigPanel')?.classList.contains('hidden')) renderConfigLista();
        actualizarUiEstado();
      });
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
      const viewLlamado = $('view-llamado-pacientes');
      ['touchstart', 'touchend', 'click'].forEach((ev) => {
        viewLlamado?.addEventListener(ev, unlockAudio, { passive: true });
      });
      $('btnLlamadoActivarAudio')?.addEventListener('click', unlockAudio);
      viewLlamado?.addEventListener('click', unlockAudio, { once: true });
      $('btnLlamadoConfig')?.addEventListener('click', abrirConfig);
      $('btnLlamadoConfigCerrar')?.addEventListener('click', cerrarConfig);
      const llamadoBd = $('llamadoConfigBackdrop');
      if (llamadoBd) {
        if (typeof window.bindBackdropDismiss === 'function') {
          window.bindBackdropDismiss(llamadoBd, cerrarConfig);
        } else {
          llamadoBd.addEventListener('click', cerrarConfig);
        }
      }
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

    cargarHistorialLocal();
    if (!procesando) ocultarPopup();
    await asegurarConfigLlamado();
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
          if (!consultorioPermitido(payload.item)) {
            emitirAnuncioAck(payload.item, 'filtrado');
          } else {
            const ok = encolarLlamado(payload.item);
            if (ok) emitirAnuncioAck(payload.item, audioUnlocked ? 'reproducido' : 'sin_audio');
          }
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
