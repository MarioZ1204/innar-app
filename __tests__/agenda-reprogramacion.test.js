const {
  buildReprogramacionTurnoPayload,
  buildReprogramacionElectroPayload,
  etiquetaNotasReprogramado,
  limpiarEtiquetaReprogramado
} = require('../utils/agenda-reprogramacion');
const publicApi = require('../public/agenda-reprogramacion.js');

describe('agenda reprogramacion', () => {
  test('separa el turno nuevo del original sin perder datos del paciente', () => {
    const turno = {
      id: 42,
      doctor_id: 7,
      paciente_nombre: 'Ana Gómez',
      paciente_documento: '12345678',
      paciente_telefono: '3001112233',
      paciente_telefono2: '3002223344',
      tipo_consulta: 'Neurología',
      entidad: 'EPS',
      notas: 'Pendiente',
      estado: 'PENDIENTE',
      fecha: '2026-01-10',
      hora: '09:00',
      programado_por: 'Recepción'
    };

    const payload = buildReprogramacionTurnoPayload(turno, {
      fecha: '2026-01-12',
      hora: '10:30',
      estadoOriginal: 'REPROGRAMADO',
      actor: 'Admin'
    });

    expect(payload.nuevoTurno).toMatchObject({
      doctor_id: 7,
      paciente_nombre: 'Ana Gómez',
      paciente_documento: '12345678',
      fecha: '2026-01-12',
      hora: '10:30',
      estado: 'PENDIENTE',
      programado_por: 'Admin'
    });
    expect(payload.actualizacionOriginal).toMatchObject({
      estado: 'REPROGRAMADO',
      numero_turno: null,
      reprogramado_fecha: '2026-01-12',
      reprogramado_hora: '10:30',
      notas: '[Reprogramado a 12/01/2026 10:30] Pendiente'
    });
    expect(payload.actualizacionOriginal).not.toHaveProperty('id');
    expect(payload.nuevoTurno).not.toHaveProperty('id');
  });

  test('preserva los datos del estudio electro y marca el original como reprogramado', () => {
    const cita = {
      id: 99,
      paciente_id: 12,
      fecha: '2026-01-10',
      hora_agendamiento: '09:00',
      estudio: 'MRI',
      entidad: 'UCQN',
      observaciones: 'Revision',
      equipo_id: 2,
      diagnostico_id: 5,
      duracion_minutos: 30,
      estado: 'Programado'
    };

    const payload = buildReprogramacionElectroPayload(cita, {
      fecha: '2026-01-12',
      hora: '10:30',
      actor: 'Admin'
    });

    expect(payload.nuevaCita).toMatchObject({
      paciente_id: 12,
      fecha: '2026-01-12',
      hora_agendamiento: '10:30',
      estudio: 'MRI',
      entidad: 'UCQN',
      observaciones: 'Revision',
      estado: 'Programado',
      programado_por_nombre: 'Admin'
    });
    expect(payload.actualizacionOriginal).toMatchObject({
      estado: 'Reprogramado',
      observaciones: '[Reprogramado a 12/01/2026 10:30] Revision'
    });
    expect(payload.actualizacionOriginal).not.toHaveProperty('id');
    expect(payload.nuevaCita).not.toHaveProperty('id');
  });

  test('etiqueta de notas incluye fecha y hora destino', () => {
    expect(etiquetaNotasReprogramado('2026-08-20', '14:00', '')).toBe('[Reprogramado a 20/08/2026 14:00]');
    expect(etiquetaNotasReprogramado('2026-08-20', '14:00:00', '[Reprogramado] previa'))
      .toBe('[Reprogramado a 20/08/2026 14:00] previa');
    expect(limpiarEtiquetaReprogramado('[Reprogramado a 12/01/2026 10:30] nota')).toBe('nota');
  });

  test('el util de servidor y el JS público son el mismo módulo', () => {
    expect(require('../utils/agenda-reprogramacion')).toBe(publicApi);
  });
});
