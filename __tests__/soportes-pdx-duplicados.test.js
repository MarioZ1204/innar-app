const { mensajeDuplicadoPdx } = require('../utils/soportes-pdx-duplicados');

describe('soportes-pdx-duplicados', () => {
  test('mensaje duplicado incluye paciente', () => {
    const msg = mensajeDuplicadoPdx({
      row: { id: 12, paciente_nombre: 'GARCIA, Ana' }
    });
    expect(msg).toContain('GARCIA, Ana');
    expect(msg).toContain('duplicados');
  });
});
