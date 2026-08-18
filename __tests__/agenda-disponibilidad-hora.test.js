'use strict';

const {
  horaCaeEnSlotAgenda,
  jornadaDefaultDeHora,
  validarDisponibilidadPorHora
} = require('../utils/procesar-agenda-excel');

describe('horaCaeEnSlotAgenda', () => {
  const manana = { hora_inicio: '08:00', hora_fin: '12:00' };
  const tarde = { hora_inicio: '14:00', hora_fin: '18:00' };

  test('incluye el inicio y excluye el fin (12:00 / 18:00 fuera)', () => {
    expect(horaCaeEnSlotAgenda('08:00', manana)).toBe(true);
    expect(horaCaeEnSlotAgenda('11:35', manana)).toBe(true);
    expect(horaCaeEnSlotAgenda('12:00', manana)).toBe(false);
    expect(horaCaeEnSlotAgenda('12:25', manana)).toBe(false);
    expect(horaCaeEnSlotAgenda('14:00', tarde)).toBe(true);
    expect(horaCaeEnSlotAgenda('17:40', tarde)).toBe(true);
    expect(horaCaeEnSlotAgenda('18:00', tarde)).toBe(false);
    expect(horaCaeEnSlotAgenda('18:20', tarde)).toBe(false);
  });
});

describe('jornadaDefaultDeHora', () => {
  test('mañana 7:00–11:59, tarde 14:00–17:59 (mismo criterio que slots BD)', () => {
    expect(jornadaDefaultDeHora('07:00')).toBe('manana');
    expect(jornadaDefaultDeHora('11:59')).toBe('manana');
    expect(jornadaDefaultDeHora('12:00')).toBeNull();
    expect(jornadaDefaultDeHora('12:30')).toBeNull();
    expect(jornadaDefaultDeHora('13:00')).toBeNull();
    expect(jornadaDefaultDeHora('14:00')).toBe('tarde');
    expect(jornadaDefaultDeHora('17:59')).toBe('tarde');
    expect(jornadaDefaultDeHora('18:00')).toBeNull();
  });
});

describe('validarDisponibilidadPorHora sin slots de doctor_agenda', () => {
  function mockDb({ disponible = 1, manana = 1, tarde = 1 } = {}) {
    return {
      execute: async (sql) => {
        if (sql.includes('FROM doctor_disponibilidad_mensual')) {
          return [{ disponible, disponible_manana: manana, disponible_tarde: tarde }];
        }
        if (sql.includes('FROM doctor_agenda')) return [];
        if (sql.includes('FROM doctor_disponibilidad_intervalos')) return [];
        return [];
      },
      query: async () => []
    };
  }

  test('12:00 y 18:00 no pasan el fallback (almuerzo / cierre de jornada)', async () => {
    const db = mockDb();
    const r12 = await validarDisponibilidadPorHora(1, '2026-08-18', '12:00', db);
    const r18 = await validarDisponibilidadPorHora(1, '2026-08-18', '18:00', db);
    expect(r12.valido).toBe(false);
    expect(r18.valido).toBe(false);
  });

  test('11:35 y 17:40 sí están en jornada', async () => {
    const db = mockDb();
    expect((await validarDisponibilidadPorHora(1, '2026-08-18', '11:35', db)).valido).toBe(true);
    expect((await validarDisponibilidadPorHora(1, '2026-08-18', '17:40', db)).valido).toBe(true);
  });
});
