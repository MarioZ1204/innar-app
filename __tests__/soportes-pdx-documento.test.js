const {
  normalizarNumeroDocumentoPdx,
  normalizarTipoDocumentoPdx,
  normalizarParDocumentoPdx,
  numeroDocumentoValidoPdx,
  esSegmentoDocumento,
  detectarTipoDocumentoEnTexto
} = require('../utils/soportes-pdx-documento');

describe('soportes-pdx-documento', () => {
  test('normalizarNumeroDocumentoPdx quita puntos y guiones', () => {
    expect(normalizarNumeroDocumentoPdx('12.345.678-9')).toBe('123456789');
    expect(normalizarNumeroDocumentoPdx(' 1 234 567 ')).toBe('1234567');
  });

  test('numeroDocumentoValidoPdx exige 4 a 20 dígitos', () => {
    expect(numeroDocumentoValidoPdx('123')).toBe(false);
    expect(numeroDocumentoValidoPdx('1234')).toBe(true);
    expect(numeroDocumentoValidoPdx('1.234.567')).toBe(true);
  });

  test('normalizarTipoDocumentoPdx reconoce CC y sinónimos', () => {
    expect(normalizarTipoDocumentoPdx('cc')).toBe('CC');
    expect(normalizarTipoDocumentoPdx('CEDULA')).toBe('CC');
    expect(normalizarTipoDocumentoPdx('TI')).toBe('TI');
    expect(normalizarTipoDocumentoPdx('')).toBe('CC');
  });

  test('normalizarParDocumentoPdx', () => {
    const p = normalizarParDocumentoPdx('TI', '98.765.432');
    expect(p.tipo_documento).toBe('TI');
    expect(p.paciente_documento).toBe('98765432');
  });

  test('esSegmentoDocumento acepta segmentos con formato viejo', () => {
    expect(esSegmentoDocumento('12.345.678')).toBe(true);
    expect(esSegmentoDocumento('CC')).toBe(false);
  });

  test('detectarTipoDocumentoEnTexto', () => {
    expect(detectarTipoDocumentoEnTexto('RC')).toBe('RC');
    expect(detectarTipoDocumentoEnTexto('NUIP')).toBe('NUIP');
  });
});
