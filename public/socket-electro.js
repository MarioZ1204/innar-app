/**
 * Socket.io - Cliente para Electrodiagnóstico
 * Maneja actualización en tiempo real de citas
 * Usa el socket global definido en socket-client.js
 */

// Usar el socket global (definido en socket-client.js)
// No declarar uno nuevo para evitar conflictos

let socketConectado = false;
let listenersConfigured = false;  // Flag para evitar registrar listeners múltiples veces

/**
 * Configurar listeners cuando el socket esté listo
 */
function configurarListeners() {
  // Evitar registrar listeners múltiples veces
  if (listenersConfigured) {
    return;
  }
  
  // Esperar a que el socket global esté disponible
  if (!window.socket) {
    setTimeout(configurarListeners, 500);
    return;
  }

  listenersConfigured = true;  // Marcar como configurado

  /**
   * Cuando se recibe solicitud de actualizar lista (evento generado por cambios)
   */
  window.socket.on('electro:actualizar-lista', (data) => {
    if (window.currentModule === 'electro') {
      if (typeof cargarCitasElectro === 'function') {
        cargarCitasElectro();
      }
    }
  });

  /**
   * Cuando se crea una nueva cita
   */
  window.socket.on('electro:cita-creada', (data) => {
    if (window.currentModule === 'electro' && typeof cargarCitasElectro === 'function') {
      cargarCitasElectro();
    }
  });

  /**
   * Cuando se actualiza una cita (equipo, estado, horas, etc.)
   */
  window.socket.on('electro:cita-actualizada', (data) => {
    if (window.currentModule === 'electro' && typeof cargarCitasElectro === 'function') {
      cargarCitasElectro();
    }
  });

  /**
   * Cuando se cambia el estado de una cita
   */
  window.socket.on('electro:cita-cambio-estado', (data) => {
    if (window.currentModule === 'electro' && typeof cargarCitasElectro === 'function') {
      cargarCitasElectro();
    }
  });

  /**
   * Cuando se inicia un estudio
   */
  window.socket.on('electro:estudio-iniciado', (data) => {
    if (window.currentModule === 'electro' && typeof cargarCitasElectro === 'function') {
      cargarCitasElectro();
    }
  });

  /**
   * Cuando se finaliza un estudio
   */
  window.socket.on('electro:estudio-finalizado', (data) => {
    if (window.currentModule === 'electro' && typeof cargarCitasElectro === 'function') {
      cargarCitasElectro();
    }
  });

  /**
   * Cuando se guardan cambios del modal (equipo, estado)
   */
  window.socket.on('electro:cambios-guardados', (data) => {
    if (window.currentModule === 'electro' && typeof cargarCitasElectro === 'function') {
      cargarCitasElectro();
    }
  });

  /**
   * Cuando se elimina una cita
   */
  window.socket.on('electro:cita-eliminada', (data) => {
    if (window.currentModule === 'electro' && typeof cargarCitasElectro === 'function') {
      cargarCitasElectro();
    }
  });
}

/**
 * Inicializar socket electrodiagnóstico
 */
function inicializarSocketElectro() {
  // El socket global se inicializa en socket-client.js cuando se conecta
  
  if (!window.socketReady) {
    // Escuchar el evento del socket listo
    if (!window.socketElectroListenerAdded) {
      window.addEventListener('socketReady', () => {
        configurarListeners();
      });
      window.socketElectroListenerAdded = true;
    }
    return;
  }
  
  // Si el socket ya estaba listo, configurar listeners ahora
  if (window.socket && window.socketReady) {
    configurarListeners();
  }
}

/**
 * Función para emitir eventos desde el cliente
 */
function emitirSocketEvent(evento, datos) {
  if (window.socket && window.socket.connected) {
    window.socket.emit(evento, datos);
  }
}

/**
 * Función para verificar si está conectado
 */
function esSocketActivo() {
  return window.socket && window.socket.connected;
}

// Inicializar socket electrodiagnóstico cuando el documento esté listo
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', inicializarSocketElectro);
} else {
  inicializarSocketElectro();
}
