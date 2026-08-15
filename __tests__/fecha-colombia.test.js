'use strict';

const { hoyColombiaISO, fechaYmdOHoyColombia } = require('../utils/fecha-colombia');

describe('fecha-colombia', () => {
  test('hoyColombiaISO es YYYY-MM-DD', () => {
    expect(hoyColombiaISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('a las 23:30 UTC (18:30 Colombia) sigue siendo el día de Bogotá, no el ISO UTC', () => {
    const utcNoche = new Date('2026-08-14T23:30:00.000Z');
    expect(utcNoche.toISOString().slice(0, 10)).toBe('2026-08-14');
    expect(hoyColombiaISO(utcNoche)).toBe('2026-08-14');
  });

  test('después de las 19:00 Colombia (00:30 UTC del día siguiente) no adelanta el día', () => {
    const despuesDeLasSiete = new Date('2026-08-15T00:30:00.000Z');
    expect(despuesDeLasSiete.toISOString().slice(0, 10)).toBe('2026-08-15');
    expect(hoyColombiaISO(despuesDeLasSiete)).toBe('2026-08-14');
  });

  test('fechaYmdOHoyColombia respeta un YYYY-MM-DD válido', () => {
    expect(fechaYmdOHoyColombia('2026-04-01')).toBe('2026-04-01');
    expect(fechaYmdOHoyColombia(' 2026-04-01 ')).toBe('2026-04-01');
  });

  test('fechaYmdOHoyColombia cae a hoy Colombia si el valor no es YMD', () => {
    expect(fechaYmdOHoyColombia('')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(fechaYmdOHoyColombia('no-es-fecha')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
