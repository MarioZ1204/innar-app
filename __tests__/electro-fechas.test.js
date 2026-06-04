const {
  citaVisibleEnFechaYmd,
  citaVisibleEnAgendaDiaYmd,
  finProgramadoCitaElectro,
  estudioElectroFinProgramadoVencido,
  horaInicioAgendadaParaInicioEstudio,
  horaInicioEfectivaParaInicioEstudio,
  calcularFinInicioEstudioElectro,
  inferirDuracionMinutosCitaElectro,
  inferirDuracionMinutosCitaElectroParaPersistir,
  sqlEstudioElectroFinProgramadoVencido,
  sqlEstudioElectroFinProgramadoVencidoConDuracion
} = require('../utils/electro-fechas');

describe('electro-fechas', () => {
  test('agenda: Completado mult día solo visible en día de inicio', () => {
    const cita = {
      fecha: '2026-05-03',
      hora_fin_date: '2026-05-04',
      duracion_minutos: 1440,
      estado: 'Completado'
    };
    expect(citaVisibleEnFechaYmd(cita, '2026-05-04')).toBe(true);
    expect(citaVisibleEnAgendaDiaYmd(cita, '2026-05-04')).toBe(false);
    expect(citaVisibleEnAgendaDiaYmd(cita, '2026-05-03')).toBe(true);
  });

  test('agenda: En Estudio mult día visible en días intermedios', () => {
    const cita = {
      fecha: '2026-05-03',
      hora_fin_date: '2026-05-04',
      estado: 'En Estudio'
    };
    expect(citaVisibleEnAgendaDiaYmd(cita, '2026-05-04')).toBe(true);
    expect(citaVisibleEnAgendaDiaYmd(cita, '2026-05-03')).toBe(true);
  });

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

  test('fin programado prioriza hora_fin_date reprogramada tras reapertura', () => {
    const fin = finProgramadoCitaElectro({
      fecha: '2026-05-03',
      hora_inicio: '08:00',
      duracion_minutos: 480,
      hora_fin: '18:00',
      hora_fin_date: '2026-05-27'
    });
    expect(fin).toEqual({ horaFin: '18:00', fechaFin: '2026-05-27' });
    const ahora = new Date('2026-05-27T14:00:00');
    expect(estudioElectroFinProgramadoVencido({
      fecha: '2026-05-03',
      hora_inicio: '08:00',
      duracion_minutos: 480,
      hora_fin: '18:00',
      hora_fin_date: '2026-05-27'
    }, ahora)).toBe(false);
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

  test('sql vencido con duracion exige duracion_minutos > 0', () => {
    const sql = sqlEstudioElectroFinProgramadoVencidoConDuracion('c');
    expect(sql).toContain('duracion_minutos > 0');
    expect(sql).toContain('hora_fin_date');
    expect(sql).toContain('GREATEST');
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

  test('inferir duración desde ventana agendada a hora_fin', () => {
    const min = inferirDuracionMinutosCitaElectro({
      fecha: '2026-06-03',
      hora_agendamiento: '07:00',
      hora_fin: '13:00',
      hora_fin_date: '2026-06-03',
      duracion_minutos: null
    });
    expect(min).toBe(360);
  });

  test('no inferir duración corta de agenda si estudio ya está En Estudio', () => {
    const min = inferirDuracionMinutosCitaElectroParaPersistir({
      estado: 'En Estudio',
      fecha: '2026-05-27',
      hora_agendamiento: '09:00',
      hora_inicio: '09:05',
      hora_fin: '09:35',
      hora_fin_date: '2026-05-27',
      duracion_minutos: null
    });
    expect(min).toBeNull();
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
