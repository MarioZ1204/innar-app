const { idsTurnoPositivos, desvincularRecibosDeTurnos } = require('../utils/recibos-vinculo');

describe('recibos-vinculo', () => {
  test('idsTurnoPositivos descarta inválidos y duplicados', () => {
    expect(idsTurnoPositivos(['1', 1, 0, -3, 'x', 8])).toEqual([1, 8]);
  });

  test('desvincularRecibosDeTurnos no ejecuta SQL sin ids', async () => {
    let called = false;
    const db = {
      async execute() {
        called = true;
        return { affectedRows: 0 };
      }
    };
    expect(await desvincularRecibosDeTurnos(db, [])).toBe(0);
    expect(called).toBe(false);
  });

  test('desvincularRecibosDeTurnos anula turno_id de los recibos', async () => {
    const db = {
      async execute(sql, params) {
        expect(sql).toMatch(/UPDATE recibos SET turno_id = NULL/);
        expect(params).toEqual([10, 11]);
        return { affectedRows: 2 };
      }
    };
    expect(await desvincularRecibosDeTurnos(db, [10, 11])).toBe(2);
  });
});
