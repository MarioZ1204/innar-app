const {
  parseNombreReporte,
  parseNombreOrdenes,
  MSG_FORMATO_REPORTE
} = require('../utils/soportes-pdx-parse');

describe('soportes-pdx-parse — reportes', () => {
  test('acepta formato mínimo Apellido, Nombre   YYYY-MM-DD.pdf', () => {
    const p = parseNombreReporte('García López, Juan Carlos   2026-05-27.pdf');
    expect(p.ok).toBe(true);
    expect(p.apellidos).toBe('García López');
    expect(p.nombres).toBe('Juan Carlos');
    expect(p.fecha_estudio).toBe('2026-05-27');
  });

  test('acepta sufijo con hora, número y estudio', () => {
    const p = parseNombreReporte('Arcos Enriquez, Nancy Del Carmen   2026-03-14   21-21-12   1.   PSG BASAL.pdf');
    expect(p.ok).toBe(true);
    expect(p.marca_tiempo).toBe('21-21-12');
    expect(p.sufijo_numero).toBe('1');
    expect(p.estudio_texto).toBe('PSG BASAL');
  });

  test('acepta solo fecha y texto de estudio después', () => {
    const p = parseNombreReporte('Pérez, Ana   2026-01-15 EEG prolongado.pdf');
    expect(p.ok).toBe(true);
    expect(p.estudio_texto).toBe('EEG prolongado');
  });

  test('rechaza nombre sin fecha válida', () => {
    const p = parseNombreReporte('Pérez, Ana informe.pdf');
    expect(p.ok).toBe(false);
    expect(p.error).toBe(MSG_FORMATO_REPORTE);
  });

  test('órdenes mantiene formato con documento', () => {
    const p = parseNombreOrdenes('García, Juan, 1234567890, 2026-03-20, PSG BASAL.pdf', []);
    expect(p.ok).toBe(true);
    expect(p.paciente_documento).toBe('1234567890');
  });
});
