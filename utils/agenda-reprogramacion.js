function etiquetaNotasReprogramado(fecha, hora, notasPrevias) {
  const ymd = String(fecha || '').slice(0, 10);
  const parts = ymd.split('-');
  const hm = String(hora || '').slice(0, 5);
  let tag = '[Reprogramado]';
  if (parts.length === 3 && parts[0] && parts[1] && parts[2]) {
    tag = `[Reprogramado a ${parts[2]}/${parts[1]}/${parts[0]}${hm ? ` ${hm}` : ''}]`;
  }
  const prev = String(notasPrevias || '')
    .replace(/\[Reprogramado(?:\s+a\s+[^\]]+)?\]\s*/gi, '')
    .trim();
  return prev ? `${tag} ${prev}` : tag;
}

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
    reprogramado_fecha: fecha || null,
    reprogramado_hora: hora || null,
    notas: etiquetaNotasReprogramado(fecha, hora, turno?.notas)
  };

  return { nuevoTurno: base, actualizacionOriginal: original };
}

function buildReprogramacionElectroPayload(cita, { fecha, hora, actor = 'Sistema', overrides = {} } = {}) {
  const obs = String(cita?.observaciones || '').trim();
  const notasUsuario = obs.replace(/\[Reprogramado\]\s*/gi, '').trim();
  const observaciones = /\[Reprogramado\]/i.test(obs) ? obs : (notasUsuario ? `[Reprogramado] ${notasUsuario}` : '[Reprogramado]');

  return {
    nuevaCita: {
      paciente_id: cita?.paciente_id,
      fecha,
      hora_agendamiento: hora,
      estudio: overrides.estudio !== undefined ? overrides.estudio : (cita?.estudio || null),
      entidad: overrides.entidad !== undefined ? overrides.entidad : (cita?.entidad || null),
      observaciones: overrides.observaciones !== undefined
        ? overrides.observaciones
        : (notasUsuario || null),
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
  etiquetaNotasReprogramado,
  buildReprogramacionTurnoPayload,
  buildReprogramacionElectroPayload
};
