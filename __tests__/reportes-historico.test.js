const { calcularVisibilidadPeriodo, periodoFromDate } = require('../utils/soportes-visibilidad');

describe('reportes-historico visibilidad', () => {
  test('periodo pasado con gracia cumplida queda en archivo', () => {
    const vis = calcularVisibilidadPeriodo('2020-01');
    expect(vis).toBe('archivo');
  });

  test('periodo en curso permanece activo', () => {
    const vis = calcularVisibilidadPeriodo(periodoFromDate());
    expect(vis).toBe('activa');
  });
});
