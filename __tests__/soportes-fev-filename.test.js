process.env.SOPORTES_NIT_OBLIGADO = '901164565';

const { parseFevFilename, buildCanonicalName } = require('../utils/soportes-archivo-detect');

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
