const {
  finProgramadoCitaElectro,
  estudioElectroFinProgramadoVencido,
  horaInicioAgendadaParaInicioEstudio,
  horaInicioEfectivaParaInicioEstudio,
  calcularFinInicioEstudioElectro,
  sqlEstudioElectroFinProgramadoVencido
} = require('../utils/electro-fechas');

describe('electro-fechas', () => {
  test('fin programado usa hora_inicio + duracion', () => {
    const fin = finProgramadoCitaElectro({
      fecha: '2026-05-27',
      hora_inicio: '11:00',
      hora_agendamiento: '09:00',
      hora_fin: '09:30',
      hora_fin_date: '2026-05-27',
      duracion_minutos: 60
    });
    expect(fin).toEqual({ horaFin: '12:00', fechaFin: '2026-05-27' });
  });

  test('no vencido si inicio tardío deja fin en el futuro', () => {
    const cita = {
      fecha: '2026-05-27',
      hora_inicio: '11:00',
      hora_agendamiento: '09:00',
      hora_fin: '12:00',
      hora_fin_date: '2026-05-27',
      duracion_minutos: 60
    };
    const ahora = new Date(Date.UTC(2026, 4, 27, 11, 45, 0));
    expect(estudioElectroFinProgramadoVencido(cita, ahora)).toBe(false);
  });

  test('vencido cuando fin programado ya pasó', () => {
    const cita = {
      fecha: '2026-05-27',
      hora_inicio: '09:00',
      duracion_minutos: 30,
      hora_fin: '09:30',
      hora_fin_date: '2026-05-27'
    };
    const ahora = new Date('2026-05-27T10:00:00');
    expect(estudioElectroFinProgramadoVencido(cita, ahora)).toBe(true);
  });

  test('hora inicio agendada ignora hora actual (flujo No)', () => {
    const cita = { fecha: '2026-05-27', hora_agendamiento: '09:00' };
    const ahora = new Date('2026-05-27T11:20:00');
    expect(horaInicioAgendadaParaInicioEstudio(cita)).toBe('09:00');
    expect(horaInicioEfectivaParaInicioEstudio(cita, ahora)).toBe('11:20');
  });

  test('sql vencido prioriza duracion sobre hora_fin antigua', () => {
    const sql = sqlEstudioElectroFinProgramadoVencido('c');
    expect(sql).toContain('duracion_minutos');
    expect(sql).toContain('hora_inicio');
  });

  test('inicio tardío agendado ancla fin a hora efectiva + duración', () => {
    const ahora = new Date('2026-05-27T11:20:00');
    const fin = calcularFinInicioEstudioElectro('2026-05-27', '09:00', 60, 'agendado', ahora);
    expect(fin).toEqual({
      hora_inicio: '09:00',
      hora_fin: '12:20',
      hora_fin_date: '2026-05-27',
      duracion_minutos: 60
    });
  });

  test('inicio a tiempo conserva fin desde hora programada', () => {
    const ahora = new Date('2026-05-27T09:15:00');
    const fin = calcularFinInicioEstudioElectro('2026-05-27', '09:00', 60, 'agendado', ahora);
    expect(fin).toEqual({
      hora_inicio: '09:00',
      hora_fin: '10:00',
      hora_fin_date: '2026-05-27',
      duracion_minutos: 60
    });
  });
});
