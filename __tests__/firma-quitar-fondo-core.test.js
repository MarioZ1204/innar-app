const { esPixelFondoBlanco, transparentarFondoEnRgba } = require('../utils/firma-quitar-fondo-core');

describe('firma-quitar-fondo-core', () => {
  test('detecta blanco puro y crema de escáner como fondo', () => {
    expect(esPixelFondoBlanco(255, 255, 255)).toBe(true);
    expect(esPixelFondoBlanco(248, 246, 240)).toBe(true);
    expect(esPixelFondoBlanco(0, 0, 0)).toBe(false);
    expect(esPixelFondoBlanco(40, 40, 180)).toBe(false);
  });

  test('transparenta píxeles de fondo en buffer RGBA', () => {
    const data = Buffer.from([
      255, 255, 255, 255,
      0, 0, 0, 255,
      248, 246, 240, 255
    ]);
    transparentarFondoEnRgba(data, 4);
    expect(data[3]).toBe(0);
    expect(data[7]).toBe(255);
    expect(data[11]).toBe(0);
  });
});
