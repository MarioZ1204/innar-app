// Relé de eventos originados en el navegador (antes vía Socket.IO cliente → servidor).
const logger = require('./logger');
const q = require('./event-poll-queue');

const ALLOWED = new Set([
  'agenda:anunciar-paciente',
  'agenda:anuncio-ack',
  'electro:cambios-guardados',
  'electro:cita-cambio-estado',
  'electro:estudio-finalizado',
  'electro:estudio-iniciado',
  'electro:progreso-estudio',
  'turno-medico:estado-actualizado',
  'turno-medico:reprogramado'
]);

/** Permisos (cualquiera basta) para que un cliente emita cada evento. */
const EVENT_PERMISOS = {
  'agenda:anunciar-paciente': ['agenda.llamar_siguiente', 'agenda.cambiar_estado'],
  'agenda:anuncio-ack': ['modulo.llamado_pacientes', 'agenda.llamar_siguiente', 'agenda.cambiar_estado'],
  'electro:cambios-guardados': ['electro.ver'],
  'electro:cita-cambio-estado': ['electro.ver'],
  'electro:estudio-finalizado': ['electro.ver'],
  'electro:estudio-iniciado': ['electro.ver'],
  'electro:progreso-estudio': ['electro.ver'],
  'turno-medico:estado-actualizado': ['agenda.ver'],
  'turno-medico:reprogramado': ['agenda.ver']
};

function isAllowed(event) {
  return typeof event === 'string' && ALLOWED.has(event);
}

function permisosDeEvento(event) {
  return EVENT_PERMISOS[event] || null;
}

function recortarTextoEvento(val, max) {
  return String(val == null ? '' : val).trim().slice(0, max);
}

function sanitizarCallId(val) {
  const id = recortarTextoEvento(val, 64);
  return /^[A-Za-z0-9_-]{8,64}$/.test(id) ? id : '';
}

function sanitizarAnuncioPaciente(data) {
  const d = data && typeof data === 'object' ? data : {};
  const doctorId = parseInt(d.doctor_id, 10);
  const callId = sanitizarCallId(d.call_id);
  const out = {
    paciente_nombre: recortarTextoEvento(d.paciente_nombre, 120),
    numero_consultorio: recortarTextoEvento(d.numero_consultorio, 40),
    doctor_nombre: recortarTextoEvento(d.doctor_nombre, 120),
    doctor_id: Number.isFinite(doctorId) && doctorId > 0 ? doctorId : null
  };
  if (callId) out.call_id = callId;
  return out;
}

const ESTADOS_ANUNCIO_ACK = new Set(['reproducido', 'filtrado', 'sin_audio', 'modulo_oculto']);

function sanitizarAnuncioAck(data) {
  const d = data && typeof data === 'object' ? data : {};
  const estado = ESTADOS_ANUNCIO_ACK.has(d.estado) ? d.estado : 'filtrado';
  return {
    call_id: sanitizarCallId(d.call_id),
    estado,
    paciente_nombre: recortarTextoEvento(d.paciente_nombre, 120)
  };
}

function relay(usuarioId, event, data) {
  switch (event) {
    case 'agenda:anunciar-paciente':
      // broadcast (no broadcastExcept): la pantalla TV suele usar la misma sesión que recepción.
      q.broadcast('agenda:anunciar-paciente', sanitizarAnuncioPaciente(data));
      break;
    case 'agenda:anuncio-ack': {
      const ack = sanitizarAnuncioAck(data);
      if (!ack.call_id) break;
      q.broadcast('agenda:anuncio-ack', ack);
      break;
    }
    case 'electro:cambios-guardados':
    case 'electro:estudio-finalizado':
    case 'electro:estudio-iniciado':
      q.broadcast('electro:actualizar-lista');
      break;
    case 'electro:cita-cambio-estado':
      q.broadcast('electro:cita-cambio-estado', data);
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
  EVENT_PERMISOS,
  isAllowed,
  permisosDeEvento,
  sanitizarCallId,
  sanitizarAnuncioPaciente,
  sanitizarAnuncioAck,
  relay
};
