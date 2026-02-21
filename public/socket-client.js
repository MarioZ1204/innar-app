// socket-client.js - Manejo de conexión WebSocket global

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
    if (typeof loadRecibos === 'function') {
      loadRecibos();
    }
  });

  // ===== EVENTOS DE ESTADÍSTICAS =====
  socket.on('stats:actualizar', () => {
    if (typeof updateStats === 'function') {
      updateStats();
    }
  });

  // ===== EVENTOS DE AGENDA MÉDICA =====
  socket.on('agenda:actualizar-lista', () => {
    if (typeof cargarAgenda === 'function') {
      cargarAgenda();
    }
  });

  socket.on('agenda:actualizar-consultorio', (consultorio) => {
    if (typeof cargarAgendaConsultorio === 'function') {
      cargarAgendaConsultorio(consultorio);
    }
  });

  socket.on('voz:anunciar-siguiente', (data) => {
    if (typeof anunciarSiguiente === 'function') {
      anunciarSiguiente(data);
    }
  });

  // ===== EVENTOS DE ELECTRODIAGNÓSTICO =====
  socket.on('electro:actualizar-lista', () => {
    if (typeof cargarElectro === 'function') {
      cargarElectro();
    }
  });

  socket.on('electro:actualizar-equipo', (equipo) => {
    if (typeof cargarEquipo === 'function') {
      cargarEquipo(equipo);
    }
  });

  // ===== EVENTOS DE USUARIOS =====
  socket.on('usuario:actualizar-lista', () => {
    if (typeof cargarUsuarios === 'function') {
      cargarUsuarios();
    }
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
