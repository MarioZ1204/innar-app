// socket-client.js - Manejo de conexión WebSocket global con soporte para TODO

let socket = null;
window.socketReady = false;  // Flag para indicar cuando socket está listo

// Inicializar WebSocket después de login
function initSocket() {
  if (socket) return;
  
  socket = io({
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: 5
  });

  // Eventos de conexión
  socket.on('connect', () => {
    console.log('✓ Conectado al servidor WebSocket');
    window.socket = socket;  // Exponer globalmente
    window.socketReady = true;  // Marcar como listo
    // Disparar evento para módulos que esperan
    window.dispatchEvent(new CustomEvent('socketReady', { detail: socket }));
  });

  socket.on('disconnect', () => {
    console.log('✗ Desconectado del servidor');
    window.socketReady = false;
  });

  socket.on('connect_error', (error) => {
    console.error('Error en conexión WebSocket:', error);
  });

  // ===== EVENTOS DE RECIBOS =====
  socket.on('recibo:actualizar-lista', () => {
    if (typeof cargarLista === 'function') cargarLista();
  });

  socket.on('recibo:creado', (data) => {
    if (typeof cargarLista === 'function') cargarLista();
  });

  socket.on('recibo:eliminado', (data) => {
    if (typeof cargarLista === 'function') cargarLista();
  });

  // ===== EVENTOS DE USUARIOS =====
  socket.on('usuarios:actualizar-lista', () => {
    if (typeof cargarUsuarios === 'function') cargarUsuarios();
  });

  socket.on('usuario:creado', (data) => {
    if (typeof cargarUsuarios === 'function') cargarUsuarios();
  });

  socket.on('usuario:actualizado', (data) => {
    if (typeof cargarUsuarios === 'function') cargarUsuarios();
  });

  socket.on('usuario:eliminado', (data) => {
    if (typeof cargarUsuarios === 'function') cargarUsuarios();
  });

  // ===== EVENTOS DE AGENDA MÉDICA =====
  socket.on('agenda:turno-creado', (data) => {
    if (typeof cargarTurnosMedica === 'function') cargarTurnosMedica();
  });

  socket.on('agenda:turno-eliminado', (data) => {
    if (typeof cargarTurnosMedica === 'function') cargarTurnosMedica();
  });

  socket.on('agenda:turno-estado-cambio', (data) => {
    if (typeof cargarTurnosMedica === 'function') cargarTurnosMedica();
  });

  socket.on('agenda:turno-numero-cambio', (data) => {
    if (typeof cargarTurnosMedica === 'function') cargarTurnosMedica();
  });

  socket.on('agenda:disponibilidad-actualizada', (data) => {
    if (typeof actualizarDisponibilidad === 'function') {
      actualizarDisponibilidad(data.doctor_id);
    }
  });

  socket.on('agenda:turno-llamar-siguiente', (data) => {
    if (typeof cargarTurnosMedica === 'function') cargarTurnosMedica();
  });

  socket.on('agenda:turno-marcar-atendido', (data) => {
    if (typeof cargarTurnosMedica === 'function') cargarTurnosMedica();
  });

  // ===== EVENTOS DE ELECTRODIAGNÓSTICO =====
  socket.on('electro:cita-creada', (data) => {
    if (typeof cargarCitasElectro === 'function') cargarCitasElectro();
  });

  socket.on('electro:cita-eliminada', (data) => {
    if (typeof cargarCitasElectro === 'function') cargarCitasElectro();
  });

  socket.on('electro:cita-estado-cambio', (data) => {
    if (typeof cargarCitasElectro === 'function') cargarCitasElectro();
  });

  // ===== EVENTOS DE ESTADÍSTICAS =====
  socket.on('stats:actualizar', () => {
    if (typeof updateStats === 'function') updateStats();
  });

  return socket;
}

// Cerrar conexión al logout
function closeSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
    window.socket = null;
    window.socketReady = false;
  }
}

// Función para emitir eventos
function emitSocket(event, data) {
  if (socket && socket.connected) {
    socket.emit(event, data);
  }
}

// Función para escuchar eventos custom
function onSocket(event, callback) {
  if (socket) {
    socket.on(event, callback);
  }
}
