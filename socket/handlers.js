// socket/handlers.js
// Configuración de Socket.IO + handlers de eventos.

const socketIo = require('socket.io');
const logger = require('../utils/logger');
const socketEmitter = require('../utils/socket-emitter');

/**
 * Crea servidor Socket.IO sobre httpServer, autentica vía sesión Express,
 * registra todos los handlers de dominio y lo expone como `app.io`.
 */
function attachSockets({ httpServer, app, sessionMiddleware, appVersion }) {
  try {
    logger.info('[SOCKET.IO] ► Iniciando Socket.IO...', { type: 'STARTUP' });
    logger.info('[SOCKET.IO] FRONTEND_URL=' + (process.env.FRONTEND_URL || 'http://localhost:3000'), { type: 'STARTUP' });
    
    const io = socketIo(httpServer, {
      cors: {
        origin: process.env.FRONTEND_URL || 'http://localhost:3000',
        methods: ['GET', 'POST'],
        credentials: true
      },
      // Hostinger (Apache proxy): el upgrade WebSocket suele fallar; solo polling es estable.
      transports: ['polling'],
      allowUpgrades: false,
      pingInterval: 30000,
      pingTimeout: 60000,
      maxHttpBufferSize: 1e6,
      serveClient: true,
      perMessageDeflate: { threshold: 32 * 1024 }
    });

    logger.info('[SOCKET.IO] ► socketIo() inicializado correctamente', { type: 'STARTUP' });

    app.io = io;
    logger.info('[SOCKET.IO] ► app.io asignado', { type: 'STARTUP' });
    
    socketEmitter.init(io);
    logger.info('[SOCKET.IO] ► socketEmitter inicializado', { type: 'STARTUP' });
    
    logger.info('[SOCKET.IO] ✓ Montado en /socket.io/ | transports: polling | path: /socket.io/', { type: 'STARTUP' });

    io.use((socket, next) => {
      logger.debug('[SOCKET.IO] Verificando autenticación de conexión', { socketId: socket.id });
      sessionMiddleware(socket.request, {}, () => {
        if (socket.request.session && socket.request.session.usuarioId) {
          logger.debug('[SOCKET.IO] ✓ Autenticado', { socketId: socket.id, usuarioId: socket.request.session.usuarioId });
          next();
        } else {
          logger.warn('[SOCKET.IO] ✗ No autenticado', { socketId: socket.id });
          next(new Error('No autenticado'));
        }
      });
    });

  io.on('connection', (socket) => {
      logger.info('[SOCKET.IO] ✓ Cliente conectado', { socketId: socket.id, usuarioId: socket.request.session?.usuarioId });
    socket.on('electro:estudio-finalizado', () => io.emit('electro:actualizar-lista'));
    socket.on('electro:cambios-guardados', () => io.emit('electro:actualizar-lista'));

    socket.on('turno-medico:estado-actualizado', (data) => {
      logger.debug('[SOCKET] turno-medico:estado-actualizado');
      io.emit('turno-medico:estado-actualizado', data);
    });
    socket.on('turno-medico:reprogramado', (data) => {
      logger.debug('[SOCKET] turno-medico:reprogramado');
      io.emit('turno-medico:reprogramado', data);
    });
    socket.on('turno-medico:creado', (data) => {
      logger.debug('[SOCKET] turno-medico:creado');
      io.emit('turno-medico:creado', data);
    });

    socket.on('disconnect', () => {});
  });

    logger.info('[SOCKET.IO] ✓ attachSockets() completado - servidor listo para conexiones', { type: 'STARTUP' });
    return io;
  } catch (error) {
    logger.error('[SOCKET.IO INIT ERROR] Error inicializando Socket.IO: ' + error.message, { type: 'STARTUP', stack: error.stack });
    throw error;
  }
}

module.exports = { attachSockets };
