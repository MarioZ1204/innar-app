/**
 * Payload de reprogramación (agenda médica y electro).
 * Una sola copia para Node (`require`) y el navegador (`window.innarAgendaReprogramacion`).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.innarAgendaReprogramacion = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this, function () {
  const RE_ETIQUETA_REPROG = /\[Reprogramado(?:\s+a\s+[^\]]+)?\]\s*/gi;

  function limpiarEtiquetaReprogramado(texto) {
    return String(texto || '').replace(RE_ETIQUETA_REPROG, '').trim();
  }

  function etiquetaNotasReprogramado(fecha, hora, notasPrevias) {
    const ymd = String(fecha || '').slice(0, 10);
    const parts = ymd.split('-');
    const hm = String(hora || '').slice(0, 5);
    let tag = '[Reprogramado]';
    if (parts.length === 3 && parts[0] && parts[1] && parts[2]) {
      tag = `[Reprogramado a ${parts[2]}/${parts[1]}/${parts[0]}${hm ? ` ${hm}` : ''}]`;
    }
    const prev = limpiarEtiquetaReprogramado(notasPrevias);
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
    const notasUsuario = overrides.observaciones !== undefined
      ? String(overrides.observaciones || '').trim()
      : limpiarEtiquetaReprogramado(cita?.observaciones);

    return {
      nuevaCita: {
        paciente_id: cita?.paciente_id,
        fecha,
        hora_agendamiento: hora,
        estudio: overrides.estudio !== undefined ? overrides.estudio : (cita?.estudio || null),
        entidad: overrides.entidad !== undefined ? overrides.entidad : (cita?.entidad || null),
        observaciones: overrides.observaciones !== undefined
          ? (overrides.observaciones || null)
          : (notasUsuario || null),
        diagnostico_id: cita?.diagnostico_id || null,
        equipo_id: overrides.equipo_id !== undefined ? overrides.equipo_id : (cita?.equipo_id || null),
        duracion_minutos: overrides.duracion_minutos !== undefined ? overrides.duracion_minutos : (cita?.duracion_minutos || null),
        estado: 'Programado',
        programado_por_nombre: actor || 'Sistema'
      },
      actualizacionOriginal: {
        estado: 'Reprogramado',
        observaciones: etiquetaNotasReprogramado(fecha, hora, cita?.observaciones)
      }
    };
  }

  return {
    limpiarEtiquetaReprogramado,
    etiquetaNotasReprogramado,
    buildReprogramacionTurnoPayload,
    buildReprogramacionElectroPayload
  };
});
