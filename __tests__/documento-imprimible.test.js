const { wrapHtmlDocumentoImprimible } = require('../utils/documento-imprimible');

describe('documento-imprimible', () => {
  test('agrega barra de impresión y título', () => {
    const html = wrapHtmlDocumentoImprimible('<!doctype html><html><head></head><body><p>Hola</p></body></html>', 'Mi doc');
    expect(html).toContain('Imprimir / Guardar PDF');
    expect(html).toContain('<title>Mi doc</title>');
    expect(html).toContain('doc-print-bar');
    expect(html).toContain('<p>Hola</p>');
  });
});
