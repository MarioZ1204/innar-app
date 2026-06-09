const {
  normalizarParentId,
  esAncestroEnMapa
} = require('../utils/soportes-armado-dias-tree');

describe('soportes-armado-dias-tree', () => {
  test('normalizarParentId', () => {
    expect(normalizarParentId(null)).toBe(0);
    expect(normalizarParentId(3)).toBe(3);
  });

  test('esAncestroEnMapa detecta ciclos', () => {
    const map = { 2: 1, 3: 2 };
    expect(esAncestroEnMapa(1, 3, map)).toBe(true);
    expect(esAncestroEnMapa(3, 1, map)).toBe(false);
  });
});
