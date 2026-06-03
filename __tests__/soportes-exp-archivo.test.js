const {
  normalizarTipoArchivo,
  SOPORTES_SLOT_TIPOS
} = require('../utils/soportes-exp-archivo');

describe('soportes-exp-archivo', () => {
  test('normaliza tipos SOPORTES y RIPS', () => {
    expect(normalizarTipoArchivo('crc').tipo).toBe('CRC');
    expect(normalizarTipoArchivo('RIPS_XML').slotDb).toBe('xml');
    expect(normalizarTipoArchivo('FOO')).toBeNull();
  });

  test('lista slots soportes', () => {
    expect(SOPORTES_SLOT_TIPOS).toContain('OPF');
    expect(SOPORTES_SLOT_TIPOS).toContain('CRC');
  });
});
