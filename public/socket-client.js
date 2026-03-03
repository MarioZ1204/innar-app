// socket-client.js - Manejo de conexión WebSocket global con soporte para TODO

let socket = null;
window.socketReady = false;  // Flag para indicar cuando socket está listo

// Detectar si es dispositivo móvil
function isMobile() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

// Inicializar WebSocket después de login (con soporte mejorado para móviles)
function initSocket() {
  if (socket) return;
  
  const isMobileDevice = isMobile();
  
  // Configuración optimizada para móviles y desktop
  socket = io({
    reconnection: true,
    reconnectionDelay: isMobileDevice ? 3000 : 1000,          // Mayor demora en móviles
    reconnectionDelayMax: isMobileDevice ? 20000 : 5000,       // Máximo más alto para móviles
    reconnectionAttempts: isMobileDevice ? 10 : 5,             // Más intentos en móviles
    timeout: isMobileDevice ? 30000 : 20000,                   // Timeout más largo en móviles
    transports: isMobileDevice ? ['polling', 'websocket'] : ['websocket', 'polling'],  // Prioridad diferente
    path: '/socket.io/',                                       // Ruta explícita de Socket.IO
    withCredentials: true,                                     // Permitir credenciales (cookies)
    forceNew: false,                                           // Reutilizar conexión existente
    autoConnect: true                                          // Conectar automáticamente
  });

  // Eventos de conexión
  socket.on('connect', () => {
    console.log('✓ Conectado al servidor WebSocket', {
      mobile: isMobileDevice,
      transport: socket.io.engine.transport.name,
      socketId: socket.id
    });
    window.socket = socket;  // Exponer globalmente
    window.socketReady = true;  // Marcar como listo
    // Disparar evento para módulos que esperan
    window.dispatchEvent(new CustomEvent('socketReady', { detail: socket }));
  });

  socket.on('disconnect', (reason) => {
    console.log('✗ Desconectado del servidor', { reason, mobile: isMobileDevice });
    window.socketReady = false;
  });

  socket.on('connect_error', (error) => {
    console.error('Error en conexión WebSocket:', {
      error: error.message || error,
      mobile: isMobileDevice,
      transport: socket?.io?.engine?.transport?.name
    });
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
