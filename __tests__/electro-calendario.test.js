const { buildCalendarioElectroMes, citaVisibleEnDiaAgenda } = require('../utils/electro-calendario');

describe('electro-calendario', () => {
  test('citaVisibleEnDiaAgenda — día de inicio', () => {
    expect(
      citaVisibleEnDiaAgenda(
        { fecha: '2026-05-15', hora_fin_date: '2026-05-15', estado: 'Programado' },
        '2026-05-15'
      )
    ).toBe(true);
  });

  test('citaVisibleEnDiaAgenda — mult día En Estudio', () => {
    const cita = {
      fecha: '2026-05-14',
      hora_fin_date: '2026-05-16',
      estado: 'En Estudio'
    };
    expect(citaVisibleEnDiaAgenda(cita, '2026-05-15')).toBe(true);
    expect(citaVisibleEnDiaAgenda(cita, '2026-05-13')).toBe(false);
  });

  test('citaVisibleEnDiaAgenda — Completado mult día solo inicio', () => {
    const cita = {
      fecha: '2026-05-03',
      hora_fin_date: '2026-05-04',
      estado: 'Completado'
    };
    expect(citaVisibleEnDiaAgenda(cita, '2026-05-03')).toBe(true);
    expect(citaVisibleEnDiaAgenda(cita, '2026-05-04')).toBe(false);
  });

  test('citaVisibleEnDiaAgenda — mult día Programado por duración', () => {
    const cita = {
      fecha: '2026-05-14',
      hora_agendamiento: '20:00',
      duracion_minutos: 480,
      hora_fin_date: '2026-05-16',
      hora_fin: '04:00',
      estado: 'Programado'
    };
    expect(citaVisibleEnDiaAgenda(cita, '2026-05-15')).toBe(true);
    expect(citaVisibleEnDiaAgenda(cita, '2026-05-14')).toBe(true);
    expect(citaVisibleEnDiaAgenda(cita, '2026-05-17')).toBe(false);
  });

  test('buildCalendarioElectroMes agrupa por tipo e inicio/continuación', () => {
    const citas = [
      { fecha: '2026-05-10', hora_fin_date: '2026-05-10', estudio: 'PSG Básica', estado: 'Programado' },
      { fecha: '2026-05-10', hora_fin_date: '2026-05-10', estudio: 'Electroencefalograma', estado: 'Confirmado' },
      { fecha: '2026-05-10', hora_fin_date: '2026-05-10', estudio: 'Monitorización VTM', estado: 'Programado' },
      {
        fecha: '2026-05-09',
        hora_fin_date: '2026-05-11',
        hora_fin: '04:00',
        estudio: 'PSG CPAP',
        estado: 'Programado'
      },
      { fecha: '2026-05-11', hora_fin_date: '2026-05-11', estudio: 'PSG CPAP', estado: 'Cancelado' }
    ];
    const cal = buildCalendarioElectroMes(citas, '2026-05');
    const d9 = cal.dias.find((d) => d.fecha === '2026-05-09');
    const d10 = cal.dias.find((d) => d.fecha === '2026-05-10');
    const d11 = cal.dias.find((d) => d.fecha === '2026-05-11');
    expect(d10.total).toBe(4);
    expect(d10.inicio).toBe(3);
    expect(d10.continuacion).toBe(1);
    expect(d10.porTipo.psg).toBe(2);
    expect(d10.porTipo.eeg).toBe(1);
    expect(d10.porTipo.vtm).toBe(1);
    expect(d10.porTipoCont.psg).toBe(1);
    expect(d9.inicio).toBe(1);
    expect(d9.continuacion).toBe(0);
    expect(d11.total).toBe(1);
    expect(d11.inicio).toBe(0);
    expect(d11.continuacion).toBe(1);
    expect(d11.porTipoCont.psg).toBe(1);
  });
});
