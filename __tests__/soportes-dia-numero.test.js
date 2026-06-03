const { nextSopDiaNumero } = require('../utils/soportes-armado-structure');

describe('nextSopDiaNumero', () => {
  test('devuelve 1 si no hay filas', async () => {
    const db = {
      query: jest.fn().mockResolvedValue([{ mx: 0 }])
    };
    await expect(nextSopDiaNumero(db, 5)).resolves.toBe(1);
  });

  test('incrementa desde MAX(dia)', async () => {
    const db = {
      query: jest.fn().mockResolvedValue([{ mx: 3 }])
    };
    await expect(nextSopDiaNumero(db, 5)).resolves.toBe(4);
  });
});
