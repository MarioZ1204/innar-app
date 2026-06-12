const {
  CUPS_COMPROBANTE_CODIGOS,
  listarServiciosComprobante
} = require('../utils/cups-comprobante-activos');

describe('cups-comprobante-activos', () => {
  test('lista autoritativa sin duplicados', () => {
    const unicos = new Set(CUPS_COMPROBANTE_CODIGOS);
    expect(unicos.size).toBe(CUPS_COMPROBANTE_CODIGOS.length);
    expect(unicos.has('890202')).toBe(true);
    expect(unicos.has('891806')).toBe(true);
  });

  test('listarServiciosComprobante devuelve nombres para todos los códigos activos', async () => {
    const lista = await listarServiciosComprobante();
    expect(lista.length).toBe(CUPS_COMPROBANTE_CODIGOS.length);
    const map = new Map(lista.map((s) => [s.codigo, s.nombre]));
    expect(map.get('890202')).toMatch(/otras especialidades m[eé]dicas/i);
    expect(map.get('891806')).toMatch(/actigraf/i);
    expect(map.get('012210')).toMatch(/neuroestimulador/i);
  });
});
