const {
  idMotivoAgenda,
  claseCcalPorDiaAgenda,
  claseCalProgramarPorDia
} = require('../public/agenda-motivo-dia');

describe('agenda-motivo-dia', () => {
  test('identifica motivos predefinidos', () => {
    expect(idMotivoAgenda('UCQN')).toBe('ucqn');
    expect(idMotivoAgenda('Festivo')).toBe('festivo');
    expect(idMotivoAgenda('Capacitación')).toBe('capacitacion');
    expect(idMotivoAgenda('texto libre')).toBe('otro');
  });

  test('no asiste bloqueado → rojo', () => {
    expect(claseCcalPorDiaAgenda({ bloqueado: true, esDomingo: false, motivo: 'UCQN' }))
      .toBe('ccal-ausente');
  });

  test('UCQN disponible → azul', () => {
    expect(claseCcalPorDiaAgenda({ bloqueado: false, motivo: 'UCQN' }))
      .toBe('ccal-motivo-ucqn');
  });

  test('festivo → rojo suave', () => {
    expect(claseCcalPorDiaAgenda({ bloqueado: false, motivo: 'Festivo' }))
      .toBe('ccal-motivo-festivo');
  });

  test('programar: no disponible → rojo', () => {
    expect(claseCalProgramarPorDia({ estadoDia: 'unavailable', motivo: null }))
      .toBe('cal-unavailable');
  });

  test('programar: UCQN con jornada → azul motivo', () => {
    expect(claseCalProgramarPorDia({ estadoDia: 'full', motivo: 'UCQN' }))
      .toBe('cal-motivo-ucqn');
  });

  test('programar: no asiste + cualquier motivo → rojo unavailable', () => {
    expect(claseCalProgramarPorDia({ estadoDia: 'unavailable', motivo: 'Festivo' }))
      .toBe('cal-unavailable');
    expect(claseCalProgramarPorDia({ estadoDia: 'unavailable', motivo: 'UCQN' }))
      .toBe('cal-unavailable');
    expect(claseCalProgramarPorDia({ estadoDia: 'unavailable', motivo: 'Cita especial' }))
      .toBe('cal-unavailable');
  });
});
