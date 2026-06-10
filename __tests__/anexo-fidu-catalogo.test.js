const {
  normCodigoAlmacen,
  buscarEnMapa,
  invalidarCatalogoAnexoFidu
} = require('../utils/anexo-fidu-catalogo');
const { ANEXO_FIDU_CATALOGO_SERVICIOS, buscarServicioPorCodigo, usarCatalogoEstatico } = require('../utils/anexo-fidu-servicios');

describe('anexo-fidu-catalogo', () => {
  beforeEach(() => {
    invalidarCatalogoAnexoFidu();
    usarCatalogoEstatico();
  });

  test('normaliza código CUPS a 6 dígitos', () => {
    expect(normCodigoAlmacen('53105')).toBe('053105');
    expect(normCodigoAlmacen('890211')).toBe('890211');
  });

  test('busca servicio desde caché en memoria', () => {
    const svc = buscarEnMapa('890211');
    expect(svc?.nombre).toContain('FISIOTERAPIA');
    expect(buscarServicioPorCodigo('53105')?.codigo).toBe('053105');
  });
});
