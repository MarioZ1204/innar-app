/**
 * Módulo pantalla de llamado de pacientes (sala de espera).
 */
(function () {
  'use strict';

  let initDone = false;
  let audioUnlocked = false;
  let voiceCache = null;
  let hideTimer = null;
  let boundRealtime = false;

  const HISTORIAL_MAX = 5;
  const DISPLAY_MS = 45000;

  function $(id) { return document.getElementById(id); }

  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

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
    if (voice) {
      utter.voice = voice;
      utter.lang = voice.lang;
    } else {
      utter.lang = 'es-CO';
    }
    window.speechSynthesis.speak(utter);
  }

  function agregarHistorial(data) {
    const list = $('llamadoHistorialList');
    if (!list) return;
    const li = document.createElement('li');
    const cons = data?.numero_consultorio ? ` · Consultorio ${data.numero_consultorio}` : '';
    const doc = data?.doctor_nombre ? ` · ${data.doctor_nombre}` : '';
    li.textContent = `${data?.paciente_nombre || 'Paciente'}${cons}${doc}`;
    list.prepend(li);
    while (list.children.length > HISTORIAL_MAX) list.lastChild.remove();
  }

  function mostrarLlamado(data) {
    if (!data) return;
    unlockAudio();

    const idle = $('llamadoIdle');
    const activo = $('llamadoActivo');
    const nomEl = $('llamadoPacienteNombre');
    const consEl = $('llamadoConsultorioNum');
    const espEl = $('llamadoEspecialista');

    if (nomEl) nomEl.textContent = data.paciente_nombre || 'Paciente';
    if (consEl) consEl.textContent = data.numero_consultorio != null && data.numero_consultorio !== ''
      ? String(data.numero_consultorio)
      : '—';
    if (espEl) {
      const doc = String(data.doctor_nombre || '').trim();
      espEl.innerHTML = doc
        ? `Especialista: <strong>${escapeHtml(doc)}</strong>`
        : '<span style="opacity:.7">Especialista no indicado</span>';
    }

    idle?.classList.add('hidden');
    activo?.classList.remove('hidden');
    agregarHistorial(data);
    hablarLlamado(data);

    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      activo?.classList.add('hidden');
      idle?.classList.remove('hidden');
    }, DISPLAY_MS);
  }

  function onLlamadoEvent(e) {
    if (window.currentModule !== 'llamado-pacientes') return;
    mostrarLlamado(e || {});
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

  function resetPantalla() {
    if (hideTimer) clearTimeout(hideTimer);
    $('llamadoActivo')?.classList.add('hidden');
    $('llamadoIdle')?.classList.remove('hidden');
    const list = $('llamadoHistorialList');
    if (list) list.innerHTML = '';
  }

  window.initLlamadoPacientes = function initLlamadoPacientes() {
    if (!initDone) {
      initDone = true;
      $('btnVolverLlamadoPacientes')?.addEventListener('click', () => {
        if (typeof goToMenu === 'function') goToMenu();
      });
      $('btnLlamadoActivarAudio')?.addEventListener('click', unlockAudio);
      bindRealtime();
    }
    resetPantalla();
    unlockAudio();
  };
})();
