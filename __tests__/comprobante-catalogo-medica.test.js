const {
  catalogoComprobanteConsultaMedica,
  nombreExtraComprobanteMedica,
  EXTRAS_COMPROBANTE_MEDICA
} = require('../utils/comprobante-catalogo-medica');

describe('catalogoComprobanteConsultaMedica', () => {
  const tipos = [
    { nombre: 'Consulta de Primera Vez por Neurología' },
    { nombre: 'Consulta de Control por Neurología' },
    { nombre: 'Consulta de Primera Vez por Epileptología' },
    { nombre: 'Consulta de Control por Epileptología' },
    { nombre: 'Consulta Virtual de Primera Vez por Epileptología' },
    { nombre: 'Consulta Virtual de Control por Epileptología' },
    { nombre: 'Particular' }
  ];

  test('quita las dos de epileptología internas y no incluye CUPS', () => {
    const out = catalogoComprobanteConsultaMedica(tipos);
    const nombres = out.map((s) => s.nombre);
    expect(nombres).not.toContain('Consulta de Primera Vez por Epileptología');
    expect(nombres).not.toContain('Consulta de Control por Epileptología');
    expect(out.every((s) => s.codigo === '')).toBe(true);
  });

  test('deja el resto de tipos de consulta, incluidas las virtuales de epileptología', () => {
    const nombres = catalogoComprobanteConsultaMedica(tipos).map((s) => s.nombre);
    expect(nombres).toContain('Consulta de Primera Vez por Neurología');
    expect(nombres).toContain('Consulta de Control por Neurología');
    expect(nombres).toContain('Consulta Virtual de Primera Vez por Epileptología');
    expect(nombres).toContain('Consulta Virtual de Control por Epileptología');
    expect(nombres).toContain('Particular');
  });

  test('agrega las dos de otras especialidades médicas (epileptología)', () => {
    const nombres = catalogoComprobanteConsultaMedica(tipos).map((s) => s.nombre);
    expect(nombres).toEqual(expect.arrayContaining(EXTRAS_COMPROBANTE_MEDICA));
  });

  test('no duplica extras si ya venían en tipos_consulta', () => {
    const out = catalogoComprobanteConsultaMedica([
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
