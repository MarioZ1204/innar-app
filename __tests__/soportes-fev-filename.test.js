process.env.SOPORTES_NIT_OBLIGADO = '901164565';

const {
  parseFevFilename,
  buildCanonicalName,
  buildSoportesDiskName,
  etiquetaFacturaExpediente,
  expedienteTieneFactura
} = require('../utils/soportes-archivo-detect');

describe('parseFevFilename FE tag', () => {
  test('acepta FEV_901164565_FE14726.pdf', () => {
    const r = parseFevFilename('FEV_901164565_FE14726.pdf');
    expect(r.ok).toBe(true);
    expect(r.numero).toBe(14726);
    expect(r.codigo_fe).toBe('FE14726');
  });

  test('rechaza solo dígitos sin prefijo FE', () => {
    const r = parseFevFilename('FEV_901164565_14726.pdf');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/FE14726/);
  });

  test('buildCanonicalName usa FE en OPF', () => {
    expect(buildCanonicalName('OPF', 14726, '.pdf')).toBe('OPF_901164565_FE14726.pdf');
    expect(buildCanonicalName('FEV', 'FE14726', '.pdf')).toBe('FEV_901164565_FE14726.pdf');
  });
});

describe('buildSoportesDiskName sin factura', () => {
  test('usa código de carpeta cuando no hay numero_factura', () => {
    const exp = { codigo: 'PEREZ_JUAN', numero_factura: 0 };
    expect(etiquetaFacturaExpediente(exp)).toBe('PEREZ_JUAN');
    expect(buildSoportesDiskName('OPF', exp, '.pdf')).toBe('OPF_901164565_PEREZ_JUAN.pdf');
    expect(expedienteTieneFactura(exp)).toBe(false);
  });

  test('usa FE cuando hay factura', () => {
    const exp = { codigo: 'FE14726', numero_factura: 14726 };
    expect(buildSoportesDiskName('OPF', exp, '.pdf')).toBe('OPF_901164565_FE14726.pdf');
    expect(expedienteTieneFactura(exp)).toBe(true);
  });
});
