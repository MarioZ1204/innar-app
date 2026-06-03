let listenersConfigured = false;
let configRetries = 0;
const maxRetries = 30;

document.addEventListener('socketClosed', () => {
  listenersConfigured = false;
  configRetries = 0;
});

function configurarListeners() {
  if (listenersConfigured) return;
  if (!window.socket) {
    configRetries += 1;
    if (configRetries <= maxRetries) {
      console.log(`[Electro realtime] Esperando socket... (${configRetries}/${maxRetries})`);
      setTimeout(configurarListeners, 500);
    } else {
      console.warn('[Electro realtime] No hay socket después de varios reintentos');
    }
    return;
  }
  listenersConfigured = true;
  configRetries = 0;
  console.log('[Electro realtime] Listeners registrados');

  const refrescarLista = () => {
    if (window.currentModule === 'electro' && typeof cargarCitasElectro === 'function') cargarCitasElectro();
    if (typeof refrescarElectroCalendarioSiVisible === 'function') refrescarElectroCalendarioSiVisible();
  };

  window.socket.on('electro:actualizar-lista', refrescarLista);
  window.socket.on('electro:cita-creada', refrescarLista);
  window.socket.on('electro:cita-actualizada', refrescarLista);
  window.socket.on('electro:cita-cambio-estado', refrescarLista);
  window.socket.on('electro:estudio-iniciado', refrescarLista);
  window.socket.on('electro:estudio-finalizado', refrescarLista);
  window.socket.on('electro:cambios-guardados', refrescarLista);
  window.socket.on('electro:cita-eliminada', refrescarLista);

  window.socket.on('electro:progreso-estudio', (e) => {
    if (
      window.citaElectroSeleccionada &&
      window.citaElectroSeleccionada.id === e.citaId
    ) {
      const bar = document.getElementById('estudioBarraLlena');
      const pct = document.getElementById('estudioProgreso');
      const timeEl = document.getElementById('estudioTiempoTranscurrido');
      if (bar && pct && typeof e.porcentaje !== 'undefined') {
        bar.style.width = `${e.porcentaje}%`;
        pct.textContent = String(Math.round(e.porcentaje));
      }
      if (timeEl && e.tiempoTranscurrido) {
        timeEl.textContent = e.tiempoTranscurrido;
      }
      console.log('[Electro realtime] Progreso:', `${e.porcentaje}%`);
    }
  });
}

function inicializarSocketElectro() {
  if (window.socketReady && window.socket) {
    configurarListeners();
  } else if (!window.socketElectroListenerAdded) {
    window.socketElectroListenerAdded = true;
    window.addEventListener('socketReady', () => configurarListeners());
  }
}

function emitirSocketEvent(eventName, payload) {
  if (window.socket && window.socket.connected) {
    window.socket.emit(eventName, payload);
  }
}

function esSocketActivo() {
  return !!(window.socket && window.socket.connected);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', inicializarSocketElectro);
} else {
  inicializarSocketElectro();
}
