const {
  normalizarModoDia,
  contenedoresTiposForModo,
  CONTENEDORAS_RAIZ
} = require('../utils/soportes-armado-modos');

describe('soportes-armado-modos', () => {
  test('normalizarModoDia', () => {
    expect(normalizarModoDia('ucqn')).toBe('ucqn');
    expect(normalizarModoDia('anexo_fidu')).toBe('anexo_fidu');
    expect(normalizarModoDia('otro')).toBe('facturacion');
  });

  test('contenedoresTiposForModo', () => {
    expect(contenedoresTiposForModo('facturacion')).toEqual(['rips', 'soportes']);
    expect(contenedoresTiposForModo('ucqn')).toEqual(['soportes']);
    expect(contenedoresTiposForModo('anexo_fidu')).toEqual([]);
  });

  test('CONTENEDORAS_RAIZ tiene tres modos fijos', () => {
    expect(CONTENEDORAS_RAIZ).toHaveLength(3);
    expect(CONTENEDORAS_RAIZ.map((c) => c.modo).sort()).toEqual(['anexo_fidu', 'facturacion', 'ucqn']);
  });
});
