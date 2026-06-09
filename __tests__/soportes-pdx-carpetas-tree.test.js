const {
  normalizarParentId,
  esAncestroEnMapa
} = require('../utils/soportes-pdx-carpetas-tree');

describe('soportes-pdx-carpetas-tree', () => {
  test('normalizarParentId convierte null/0 en raíz', () => {
    expect(normalizarParentId(null)).toBe(0);
    expect(normalizarParentId(0)).toBe(0);
    expect(normalizarParentId('')).toBe(0);
    expect(normalizarParentId(5)).toBe(5);
  });

  test('esAncestroEnMapa detecta ciclos prohibidos', () => {
    const map = { 2: 1, 3: 2, 4: 0 };
    expect(esAncestroEnMapa(1, 3, map)).toBe(true);
    expect(esAncestroEnMapa(3, 1, map)).toBe(false);
    expect(esAncestroEnMapa(1, 1, map)).toBe(false);
    expect(esAncestroEnMapa(4, 3, map)).toBe(false);
  });
});
