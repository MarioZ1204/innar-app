// Relé de eventos originados en el navegador (antes vía Socket.IO cliente → servidor).
const logger = require('./logger');
const q = require('./event-poll-queue');

const ALLOWED = new Set([
  'agenda:anunciar-paciente',
  'electro:cambios-guardados',
  'electro:estudio-finalizado',
  'electro:estudio-iniciado',
  'electro:progreso-estudio',
  'turno-medico:estado-actualizado',
  'turno-medico:reprogramado'
]);

function isAllowed(event) {
  return typeof event === 'string' && ALLOWED.has(event);
}

function relay(usuarioId, event, data) {
  switch (event) {
    case 'agenda:anunciar-paciente':
      q.broadcastExcept(usuarioId, 'agenda:anunciar-paciente', data);
      break;
    case 'electro:cambios-guardados':
    case 'electro:estudio-finalizado':
    case 'electro:estudio-iniciado':
      q.broadcast('electro:actualizar-lista');
      break;
    case 'electro:progreso-estudio':
      q.broadcast('electro:progreso-estudio', data);
      break;
    case 'turno-medico:estado-actualizado':
      q.broadcast('turno-medico:estado-actualizado', data);
      break;
    case 'turno-medico:reprogramado':
      q.broadcast('turno-medico:reprogramado', data);
      break;
    default:
      logger.warn('[realtime/push] evento no gestionado', { event });
  }
}

module.exports = {
  ALLOWED,
  isAllowed,
  relay
};
