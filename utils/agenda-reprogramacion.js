function buildReprogramacionTurnoPayload(turno, { fecha, hora, estadoOriginal = 'REPROGRAMADO', actor = 'Sistema' } = {}) {
  const base = {
    doctor_id: turno?.doctor_id,
    paciente_nombre: turno?.paciente_nombre || null,
    paciente_documento: turno?.paciente_documento || null,
    paciente_telefono: turno?.paciente_telefono || null,
    paciente_telefono2: turno?.paciente_telefono2 || null,
    tipo_consulta: turno?.tipo_consulta || null,
    entidad: turno?.entidad || null,
    notas: turno?.notas || null,
    fecha,
    hora,
    estado: 'PENDIENTE',
    programado_por: actor || 'Sistema'
  };

  const original = {
    estado: estadoOriginal,
    numero_turno: null,
    notas: turno?.notas ? `[Reprogramado] ${turno.notas}` : '[Reprogramado]'
  };

  return { nuevoTurno: base, actualizacionOriginal: original };
}

function buildReprogramacionElectroPayload(cita, { fecha, hora, actor = 'Sistema', overrides = {} } = {}) {
  const obs = String(cita?.observaciones || '').trim();
  const observaciones = /\[Reprogramado\]/i.test(obs) ? obs : (obs ? `[Reprogramado] ${obs}` : '[Reprogramado]');

  return {
    nuevaCita: {
      paciente_id: cita?.paciente_id,
      fecha,
      hora_agendamiento: hora,
      estudio: overrides.estudio !== undefined ? overrides.estudio : (cita?.estudio || null),
      entidad: overrides.entidad !== undefined ? overrides.entidad : (cita?.entidad || null),
      observaciones: overrides.observaciones !== undefined ? overrides.observaciones : (cita?.observaciones || null),
      diagnostico_id: cita?.diagnostico_id || null,
      equipo_id: overrides.equipo_id !== undefined ? overrides.equipo_id : (cita?.equipo_id || null),
      duracion_minutos: overrides.duracion_minutos !== undefined ? overrides.duracion_minutos : (cita?.duracion_minutos || null),
      estado: 'Programado',
      programado_por_nombre: actor || 'Sistema'
    },
    actualizacionOriginal: {
      estado: 'Reprogramado',
      observaciones
    }
  };
}

module.exports = {
  buildReprogramacionTurnoPayload,
  buildReprogramacionElectroPayload
};
