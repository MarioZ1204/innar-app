const {
  catalogoComprobanteConsultaMedica,
  nombreExtraComprobanteMedica,
  EXTRAS_COMPROBANTE_MEDICA
} = require('../utils/comprobante-catalogo-medica');

describe('catalogoComprobanteConsultaMedica', () => {
  test('respeta visible_comprobante=0 y no inyecta extras por código', () => {
    const out = catalogoComprobanteConsultaMedica([
      { nombre: 'Consulta de Primera Vez por Neurología', visible_comprobante: 1 },
      { nombre: 'Consulta de Primera Vez por Epileptología', visible_comprobante: 0 },
      { nombre: 'Consulta de Control por Epileptología', visible_comprobante: 0 },
      { nombre: EXTRAS_COMPROBANTE_MEDICA[0], visible_comprobante: 1 }
    ]);
    const nombres = out.map((s) => s.nombre);
    expect(nombres).toContain('Consulta de Primera Vez por Neurología');
    expect(nombres).toContain(EXTRAS_COMPROBANTE_MEDICA[0]);
    expect(nombres).not.toContain('Consulta de Primera Vez por Epileptología');
    expect(nombres).not.toContain('Consulta de Control por Epileptología');
    expect(out.every((s) => s.codigo === '')).toBe(true);
  });

  test('no duplica nombres equivalentes', () => {
    const out = catalogoComprobanteConsultaMedica([
      { nombre: EXTRAS_COMPROBANTE_MEDICA[0] },
      { nombre: EXTRAS_COMPROBANTE_MEDICA[0] },
      { nombre: 'Particular' }
    ]);
    const extras = out.filter((s) => s.nombre === EXTRAS_COMPROBANTE_MEDICA[0]);
    expect(extras).toHaveLength(1);
  });
});

describe('nombreExtraComprobanteMedica', () => {
  test('reconoce el nombre del catálogo sin importar mayúsculas', () => {
    expect(nombreExtraComprobanteMedica(
      'consulta de primera vez por otras especialidades medicas (epileptologia)'
    )).toBe(EXTRAS_COMPROBANTE_MEDICA[0]);
  });
});
