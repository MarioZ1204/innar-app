const {
  formatFechaCertificado,
  formatHoraCertificado,
  validarPayloadCertificado,
  buildCertificadoAsistenciaHtml,
  CERT_ASISTENCIA_TELEFONOS,
  CERT_ASISTENCIA_TITULO,
  CERT_ASISTENCIA_FIRMA_ELABORADO,
  CERT_ASISTENCIA_PIE
} = require('../utils/certificado-asistencia');

describe('certificado-asistencia', () => {
  test('formatea fecha estilo plantilla', () => {
    expect(formatFechaCertificado('2026-06-23')).toBe('23/JUNIO/2026');
  });

  test('formatea hora AM/PM', () => {
    expect(formatHoraCertificado('07:00')).toBe('7:00 AM');
    expect(formatHoraCertificado('19:00')).toBe('7:00 PM');
    expect(formatHoraCertificado('05:00')).toBe('5:00 AM');
  });

  test('teléfonos institucionales fijos', () => {
    expect(CERT_ASISTENCIA_TELEFONOS.celular).toBe('3053560651');
    expect(CERT_ASISTENCIA_TELEFONOS.fijo).toBe('6027299737');
  });

  test('valida payload mínimo', () => {
    const r = validarPayloadCertificado({
      paciente_nombre: 'FATIMA CORDERO',
      paciente_documento: '1085259645',
      tipo_documento: 'CC',
      motivo: 'POLISOMNOGRAFIA BASICA',
      fecha_ingreso: '2026-06-23',
      hora_ingreso: '19:00',
      fecha_egreso: '2026-06-24',
      hora_egreso: '05:00',
      funcionario_nombre: 'Alejandra Benavides',
      funcionario_cargo: 'Secretaria'
    });
    expect(r.error).toBeUndefined();
    expect(r.data.tipo_documento).toBe('CC');
    expect(r.data.firma_elaborado).toBe(CERT_ASISTENCIA_FIRMA_ELABORADO);
  });

  test('HTML incluye datos y teléfonos', () => {
    const { data } = validarPayloadCertificado({
      paciente_nombre: 'FATIMA CORDERO BURBANO',
      paciente_documento: '1085259645',
      motivo: 'POLISOMNOGRAFIA BASICA',
      fecha_ingreso: '2026-06-23',
      hora_ingreso: '19:00',
      fecha_egreso: '2026-06-24',
      hora_egreso: '05:00',
      funcionario_nombre: 'Alejandra Benavides',
      funcionario_cargo: 'Secretaria'
    });
    const html = buildCertificadoAsistenciaHtml(data);
    expect(html).toContain('FATIMA CORDERO BURBANO');
    expect(html).toContain('>Secretaria</div>');
    expect(html).toContain('1085259645');
    expect(html).toContain('POLISOMNOGRAFIA BASICA');
    expect(html).toContain('3053560651');
    expect(html).toContain('6027299737');
    expect(html).toContain('Alejandra Benavides');
    expect(html).toContain(CERT_ASISTENCIA_TITULO);
    expect(html).toMatch(/Aptos Narrow|Archivo Narrow/);
    expect(html).toContain(CERT_ASISTENCIA_PIE.codigo);
    expect(html).toContain(CERT_ASISTENCIA_PIE.fecha_actualizacion);
    expect(html).toContain('1 de 1');
  });
});
