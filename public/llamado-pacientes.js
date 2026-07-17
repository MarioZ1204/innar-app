/**
 * Pantalla TV de llamado de pacientes.
 * Reposo: logo Innar. Al llamar: pop-up + voz intercalada (2 rondas).
 */
(function () {
  'use strict';

  const VECES_POR_RONDA = 2;
  const BATCH_MS = 900;
  const PAUSA_ENTRE_ANUNCIOS_MS = 500;
  const POPUP_EXTRA_MS = 800;

  let initDone = false;
  let audioUnlocked = false;
  let voiceCache = null;
  let boundRealtime = false;
  let relojTimer = null;

  let procesando = false;
  let colaAnuncios = [];
  let batchPendiente = [];
  let batchTimer = null;

  function $(id) { return document.getElementById(id); }

  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

  function textoAnuncio(item) {
    const nombre = String(item?.paciente_nombre || 'paciente').trim();
    const cons = item?.numero_consultorio;
    const consTxt = cons != null && cons !== '' ? String(cons) : '—';
    return `Paciente ${nombre}, pasar al consultorio ${consTxt}`;
  }

  function hablarAsync(texto) {
    return new Promise((resolve) => {
      if (!audioUnlocked || !('speechSynthesis' in window)) {
        resolve();
        return;
      }
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(texto);
      utter.rate = 0.88;
      utter.pitch = 1.02;
      utter.volume = 1;
      const voice = pickSoftSpanishVoice();
      if (voice) { utter.voice = voice; utter.lang = voice.lang; }
      else { utter.lang = 'es-CO'; }
      utter.onend = () => resolve();
      utter.onerror = () => resolve();
      window.speechSynthesis.speak(utter);
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
    $('llamadoIdleLogo')?.classList.add('is-dimmed');
    popup?.classList.remove('hidden');
  }

  function ocultarPopup() {
    $('llamadoPopup')?.classList.add('hidden');
    $('llamadoIdleLogo')?.classList.remove('is-dimmed');
  }

  /* ── Cola intercalada ── */

  function normalizarLlamado(data) {
    return {
      paciente_nombre: String(data?.paciente_nombre || '').trim(),
      numero_consultorio: data?.numero_consultorio != null && data?.numero_consultorio !== ''
        ? String(data.numero_consultorio)
        : '',
      doctor_id: data?.doctor_id ?? null
    };
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
    if (!item.paciente_nombre) return;

    batchPendiente.push(item);
    if (batchTimer) clearTimeout(batchTimer);
    batchTimer = setTimeout(finalizarBatch, BATCH_MS);
  }

  function finalizarBatch() {
    batchTimer = null;
    if (!batchPendiente.length) return;

    const items = dedupeLlamados(batchPendiente.splice(0));
    const secuencia = construirSecuencia(items);
    colaAnuncios.push(...secuencia);

    if (!procesando) procesarCola();
  }

  function dedupeLlamados(items) {
    const map = new Map();
    for (const item of items) {
      const key = `${item.doctor_id ?? ''}|${item.numero_consultorio}|${item.paciente_nombre}`;
      map.set(key, item);
    }
    return [...map.values()];
  }

  async function procesarCola() {
    if (procesando) return;
    procesando = true;

    while (colaAnuncios.length) {
      const item = colaAnuncios.shift();
      mostrarPopup(item);
      await hablarAsync(textoAnuncio(item));
      await sleep(POPUP_EXTRA_MS);

      if (colaAnuncios.length) {
        await sleep(PAUSA_ENTRE_ANUNCIOS_MS);
      }
    }

    ocultarPopup();
    procesando = false;

    if (batchPendiente.length) {
      finalizarBatch();
    }
  }

  /* ── Eventos tiempo real ── */

  function onLlamadoEvent(data) {
    if (window.currentModule !== 'llamado-pacientes') return;
    unlockAudio();
    encolarLlamado(data || {});
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

  window.initLlamadoPacientes = function initLlamadoPacientes() {
    if (!initDone) {
      initDone = true;
      $('btnVolverLlamadoPacientes')?.addEventListener('click', () => {
        if (typeof goToMenu === 'function') goToMenu();
      });
      $('btnLlamadoActivarAudio')?.addEventListener('click', unlockAudio);
      $('btnLlamadoFullscreen')?.addEventListener('click', toggleFullscreen);
      document.addEventListener('fullscreenchange', actualizarEstadoFullscreen);
      document.addEventListener('mousemove', (e) => {
        const view = $('view-llamado-pacientes');
        if (!view?.classList.contains('ltv-is-fullscreen')) return;
        view.classList.toggle('ltv-show-bar', e.clientY < 80);
      });
      bindRealtime();
    }

    ocultarPopup();
    iniciarReloj();
  };

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      detenerReloj();
    } else if (window.currentModule === 'llamado-pacientes') {
      actualizarReloj();
      iniciarReloj();
    }
  });
})();
