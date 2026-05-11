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
  const io = socketIo(httpServer, {
    cors: {
      origin: process.env.FRONTEND_URL || 'http://localhost:3000',
      methods: ['GET', 'POST'],
      credentials: true
    },
    transports: ['websocket', 'polling'],
    allowUpgrades: true,
    pingInterval: 30000,
    pingTimeout: 60000,
    maxHttpBufferSize: 1e6,
    serveClient: true,
    perMessageDeflate: { threshold: 32 * 1024 }
  });

  app.io = io;
  socketEmitter.init(io);

  io.use((socket, next) => {
    sessionMiddleware(socket.request, {}, () => {
      if (socket.request.session && socket.request.session.usuarioId) {
        next();
      } else {
        next(new Error('No autenticado'));
      }
    });
  });

  io.on('connection', (socket) => {
    socket.emit('sistema:version', { version: appVersion });

    socket.on('recibo:crear', () => {
      io.emit('recibo:actualizar-lista');
      io.emit('stats:actualizar');
    });
    socket.on('recibo:eliminar', () => {
      io.emit('recibo:actualizar-lista');
      io.emit('stats:actualizar');
    });

    socket.on('cita:crear', (data) => {
      io.emit('agenda:actualizar-consultorio', data && data.consultorio);
      io.emit('agenda:actualizar-lista');
    });
    socket.on('cita:actualizar', (data) => {
      io.emit('agenda:actualizar-consultorio', data && data.consultorio);
      io.emit('agenda:actualizar-lista');
    });
    socket.on('cita:atender', (data) => {
      io.emit('agenda:actualizar-consultorio', data && data.consultorio);
      io.emit('agenda:actualizar-lista');
      io.emit('voz:anunciar-siguiente', data);
    });
    socket.on('agenda:anunciar-paciente', (data) => {
      socket.broadcast.emit('agenda:anunciar-paciente', data);
    });

    socket.on('electro:crear-turno', (data) => {
      io.emit('electro:actualizar-equipo', data && data.equipo);
      io.emit('electro:actualizar-lista');
    });
    socket.on('electro:completar-turno', (data) => {
      io.emit('electro:actualizar-equipo', data && data.equipo);
      io.emit('electro:actualizar-lista');
    });
    socket.on('electro:cita-creada', (data) => {
      io.emit('electro:actualizar-lista');
      io.emit('electro:nueva-cita', data);
    });
    socket.on('electro:cita-actualizada', (data) => {
      io.emit('electro:actualizar-lista');
      io.emit('electro:cita-cambio-estado', data);
    });
    socket.on('electro:cita-eliminada', (data) => {
      io.emit('electro:actualizar-lista');
      io.emit('electro:cita-removida', data);
    });
    socket.on('electro:estudio-iniciado', () => io.emit('electro:actualizar-lista'));
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

  return io;
}

module.exports = { attachSockets };
