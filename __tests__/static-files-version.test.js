const { injectAssetVersion } = require('../config/static-files');

describe('injectAssetVersion', () => {
  it('reemplaza ?v= existente en CSS y JS', () => {
    const html =
      '<link href="app.css?v=20260625-2">' +
      '<script src="app.js?v=1.7.19"></script>';
    const out = injectAssetVersion(html, '1.7.5');
    expect(out).toContain('app.css?v=1.7.5');
    expect(out).toContain('app.js?v=1.7.5');
    expect(out).not.toContain('20260625');
    expect(out).not.toContain('1.7.19');
  });

  it('añade ?v= si no existe', () => {
    const html = '<link href="app.css"><script src="app.js"></script>';
    const out = injectAssetVersion(html, '1.7.5');
    expect(out).toContain('app.css?v=1.7.5');
    expect(out).toContain('app.js?v=1.7.5');
  });
});
