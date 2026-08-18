const { hayCupoElectroParaAgendar } = require('../routes/electro-capacity');

describe('hayCupoElectroParaAgendar', () => {
  const rangeStart = new Date('2026-08-20T08:00:00');
  const rangeEnd = new Date('2026-08-20T09:00:00');

  test('las citas solo Programado no consumen cupo', () => {
    const citas = [{
      fecha: '2026-08-20',
      hora_agendamiento: '08:00',
      hora_fin: '09:00',
      estado: 'Programado',
      duracion_minutos: 60
    }];
    const r = hayCupoElectroParaAgendar(citas, rangeStart, rangeEnd, 1);
    expect(r.ok).toBe(true);
    expect(r.peak).toBe(0);
  });

  test('En Estudio en el mismo horario llena el cupo', () => {
    const citas = [{
      fecha: '2026-08-20',
      hora_agendamiento: '08:00',
      hora_inicio: '08:00',
      hora_fin: '09:00',
      estado: 'En Estudio',
      duracion_minutos: 60
    }];
    const r = hayCupoElectroParaAgendar(citas, rangeStart, rangeEnd, 1);
    expect(r.ok).toBe(false);
    expect(r.peak).toBe(1);
  });
});
