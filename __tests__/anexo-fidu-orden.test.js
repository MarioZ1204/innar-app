const { moverIdAntesDe, moverIdDespuesDe, reordenarFilaAnexo, mismoOrdenIds } = require('../utils/anexo-fidu-orden');

describe('anexo-fidu orden de filas', () => {
  test('mueve una fila al inicio (antes de la primera)', () => {
    expect(moverIdAntesDe([10, 20, 30], 30, 10)).toEqual([30, 10, 20]);
  });

  test('mueve una fila al final (beforeId nulo)', () => {
    expect(moverIdAntesDe([10, 20, 30], 10, null)).toEqual([20, 30, 10]);
  });

  test('inserta antes de otra fila en el medio', () => {
    expect(moverIdAntesDe([1, 2, 3, 4], 4, 2)).toEqual([1, 4, 2, 3]);
  });

  test('colocar después de una fila no la manda al final del anexo', () => {
    expect(moverIdDespuesDe([10, 20, 30, 40], 10, 30)).toEqual([20, 30, 10, 40]);
  });

  test('reordenarFilaAnexo usa afterId en la página actual', () => {
    expect(reordenarFilaAnexo([1, 2, 3, 4, 5], 2, { afterId: 3 })).toEqual([1, 3, 2, 4, 5]);
  });

  test('no cambia si ya está en esa posición', () => {
    const ids = [5, 6, 7];
    expect(moverIdAntesDe(ids, 6, 7)).toEqual([5, 6, 7]);
    expect(mismoOrdenIds(ids, moverIdAntesDe(ids, 6, 7))).toBe(true);
  });

  test('ignora id inexistente', () => {
    expect(moverIdAntesDe([1, 2], 99, 1)).toEqual([1, 2]);
  });
});
