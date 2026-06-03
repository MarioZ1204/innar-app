const {
  detectarParteCrcTipo,
  resolverTiposPartes,
  hintOrdenCrcPorCantidad
} = require('../utils/soportes-crc-orden');

describe('soportes-crc-orden', () => {
  test('detecta tipos por nombre', () => {
    expect(detectarParteCrcTipo('COMPROBANTE - Pérez - Ana.pdf')).toBe('comprobante');
    expect(detectarParteCrcTipo('certificado_afiliacion.pdf')).toBe('certificado');
    expect(detectarParteCrcTipo('consentimiento firmado.pdf')).toBe('consentimiento');
    expect(detectarParteCrcTipo('Cotizacion servicio.pdf')).toBe('cotizacion');
  });

  test('2 archivos: comprobante luego certificado', () => {
    const r = resolverTiposPartes([
      { path: '/tmp/cert.pdf', originalname: 'CERTIFICADO.pdf' },
      { path: '/tmp/comp.pdf', originalname: 'COMPROBANTE - X.pdf' }
    ]);
    expect(r.orden).toEqual(['Comprobante', 'Certificado']);
    expect(r.partes[0].originalname).toMatch(/COMPROBANTE/i);
    expect(r.partes[1].originalname).toMatch(/CERTIFICADO/i);
  });

  test('3 archivos: comprobante, consentimiento (sin palabra clave), certificado', () => {
    const r = resolverTiposPartes([
      { path: '/tmp/c.pdf', originalname: 'COMPROBANTE - A.pdf' },
      { path: '/tmp/s.pdf', originalname: 'García - Juan - CC - 1 - 2026-01-01 - PSG.pdf' },
      { path: '/tmp/t.pdf', originalname: 'certificado.pdf' }
    ]);
    expect(r.orden).toEqual(['Comprobante', 'Consentimiento', 'Certificado']);
  });

  test('4 archivos: orden completo', () => {
    const r = resolverTiposPartes([
      { path: '/tmp/t.pdf', originalname: 'certificado.pdf' },
      { path: '/tmp/q.pdf', originalname: 'cotizacion.pdf' },
      { path: '/tmp/c.pdf', originalname: 'consentimiento.pdf' },
      { path: '/tmp/p.pdf', originalname: 'comprobante.pdf' }
    ]);
    expect(r.orden).toEqual(['Comprobante', 'Cotización', 'Consentimiento', 'Certificado']);
  });

  test('rechaza 3 archivos con cotización', () => {
    expect(() => resolverTiposPartes([
      { path: '/a', originalname: 'comprobante.pdf' },
      { path: '/b', originalname: 'cotizacion.pdf' },
      { path: '/c', originalname: 'certificado.pdf' }
    ])).toThrow(/Consentimiento/);
  });

  test('hint por cantidad', () => {
    expect(hintOrdenCrcPorCantidad(4)).toContain('Cotización');
  });
});
