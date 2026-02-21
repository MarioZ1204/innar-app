// socket-client.js - Manejo de conexión WebSocket global con soporte para TODO

let socket = null;

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
  });

  socket.on('disconnect', () => {
    console.log('✗ Desconectado del servidor');
  });

  socket.on('connect_error', (error) => {
    console.error('Error en conexión WebSocket:', error);
  });

  // ===== EVENTOS DE RECIBOS =====
  socket.on('recibo:actualizar-lista', () => {
    console.log('[SOCKET] Recibos actualizado');
    if (typeof cargarLista === 'function') cargarLista();
  });

  socket.on('recibo:creado', (data) => {
    console.log('[SOCKET] Nuevo recibo creado:', data);
    if (typeof cargarLista === 'function') cargarLista();
  });

  socket.on('recibo:eliminado', (data) => {
    console.log('[SOCKET] Recibo eliminado:', data);
    if (typeof cargarLista === 'function') cargarLista();
  });

  // ===== EVENTOS DE USUARIOS =====
  socket.on('usuarios:actualizar-lista', () => {
    console.log('[SOCKET] Lista de usuarios actualizada');
    if (typeof cargarUsuarios === 'function') cargarUsuarios();
  });

  socket.on('usuario:creado', (data) => {
    console.log('[SOCKET] Nuevo usuario creado:', data);
    if (typeof cargarUsuarios === 'function') cargarUsuarios();
  });

  socket.on('usuario:actualizado', (data) => {
    console.log('[SOCKET] Usuario actualizado:', data);
    if (typeof cargarUsuarios === 'function') cargarUsuarios();
  });

  socket.on('usuario:eliminado', (data) => {
    console.log('[SOCKET] Usuario eliminado:', data);
    if (typeof cargarUsuarios === 'function') cargarUsuarios();
  });

  // ===== EVENTOS DE AGENDA MÉDICA =====
  socket.on('agenda:turno-creado', (data) => {
    console.log('[SOCKET] Turno creado:', data);
    if (typeof cargarTurnosMedica === 'function') cargarTurnosMedica();
  });

  socket.on('agenda:turno-eliminado', (data) => {
    console.log('[SOCKET] Turno eliminado:', data);
    if (typeof cargarTurnosMedica === 'function') cargarTurnosMedica();
  });

  socket.on('agenda:turno-estado-cambio', (data) => {
    console.log('[SOCKET] Estado de turno cambió:', data);
    if (typeof cargarTurnosMedica === 'function') cargarTurnosMedica();
  });

  socket.on('agenda:turno-numero-cambio', (data) => {
    console.log('[SOCKET] Número de turno cambió:', data);
    if (typeof cargarTurnosMedica === 'function') cargarTurnosMedica();
  });

  socket.on('agenda:disponibilidad-actualizada', (data) => {
    console.log('[SOCKET] Disponibilidad actualizada para doctor:', data.doctor_id);
    if (typeof actualizarDisponibilidad === 'function') {
      actualizarDisponibilidad(data.doctor_id);
    }
  });

  socket.on('agenda:turno-llamar-siguiente', (data) => {
    console.log('[SOCKET] Llamar siguiente turno:', data);
    if (typeof cargarTurnosMedica === 'function') cargarTurnosMedica();
  });

  socket.on('agenda:turno-marcar-atendido', (data) => {
    console.log('[SOCKET] Turno marcado como atendido:', data);
    if (typeof cargarTurnosMedica === 'function') cargarTurnosMedica();
  });

  // ===== EVENTOS DE ELECTRODIAGNÓSTICO =====
  socket.on('electro:cita-creada', (data) => {
    console.log('[SOCKET] Cita electrodiagnóstico creada:', data);
    if (typeof cargarCitasElectro === 'function') cargarCitasElectro();
  });

  socket.on('electro:cita-eliminada', (data) => {
    console.log('[SOCKET] Cita electrodiagnóstico eliminada:', data);
    if (typeof cargarCitasElectro === 'function') cargarCitasElectro();
  });

  socket.on('electro:cita-estado-cambio', (data) => {
    console.log('[SOCKET] Estado de cita electrodiagnóstico cambió:', data);
    if (typeof cargarCitasElectro === 'function') cargarCitasElectro();
  });

  // ===== EVENTOS DE ESTADÍSTICAS =====
  socket.on('stats:actualizar', () => {
    console.log('[SOCKET] Estadísticas actualizadas');
    if (typeof updateStats === 'function') updateStats();
  });

  return socket;
}

// Cerrar conexión al logout
function closeSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
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
