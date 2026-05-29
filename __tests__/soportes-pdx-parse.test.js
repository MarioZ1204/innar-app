const {
  parseNombreReporte,
  parseNombreOrdenHc,
  parseNombreComprobante,
  parseNombreConsentimiento,
  parseNombrePorCarpeta,
  nombreArchivoDescarga,
  inferirEstudioDesdeCarpeta,
  mensajeErrorFormato
} = require('../utils/soportes-pdx-parse');

describe('soportes-pdx-parse — reportes simples', () => {
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

  test('rechaza nombre sin fecha válida', () => {
    const p = parseNombreReporte('Pérez, Ana informe.pdf');
    expect(p.ok).toBe(false);
    expect(p.error).toBe(mensajeErrorFormato('neutral'));
  });

  test('nombreArchivoDescarga añade estudio VTM al descargar', () => {
    const meta = {
      nombre_archivo_original: 'García, Juan   2026-05-27.pdf',
      estudio_texto: 'VTM'
    };
    const nombre = nombreArchivoDescarga(meta, { nombre_display: 'REPORTES VTM MARZO' });
    expect(nombre).toBe('García, Juan   2026-05-27 VTM.pdf');
  });

  test('inferir estudio PSG CPAP desde carpeta', () => {
    expect(inferirEstudioDesdeCarpeta({ nombre_display: 'PSG CPAP MARZO' })).toBe('PSG CPAP');
  });
});

describe('soportes-pdx-parse — formatos estructurados', () => {
  test('órdenes ORDEN + HC con guiones', () => {
    const p = parseNombreOrdenHc(
      'ORDEN + HC - García López - Juan Carlos - CC - 1234567890 - 2026-03-20 - PSG Basal.pdf',
      []
    );
    expect(p.ok).toBe(true);
    expect(p.paciente_documento).toBe('1234567890');
    expect(p.tipo_documento).toBe('CC');
    expect(p.estudio_texto).toBe('PSG Basal');
  });

  test('comprobantes', () => {
    const p = parseNombreComprobante(
      'COMPROBANTE - García López - Juan Carlos - CC - 987654321 - 2026-04-01 - EEG.pdf',
      []
    );
    expect(p.ok).toBe(true);
    expect(p.formato).toBe('comprobantes');
  });

  test('consentimientos', () => {
    const p = parseNombreConsentimiento(
      'García López - Juan Carlos - CC - 5555555 - 2026-04-02 - VTM.pdf',
      []
    );
    expect(p.ok).toBe(true);
    expect(p.formato).toBe('consentimientos');
  });

  test('parseNombrePorCarpeta elige parser según carpeta', () => {
    const p = parseNombrePorCarpeta(
      'COMPROBANTE - Pérez - Ana - CC - 111 - 2026-01-01 - EEG.pdf',
      { nombre_display: 'COMPROBANTES MARZO' },
      []
    );
    expect(p.ok).toBe(true);
    expect(p.formato).toBe('comprobantes');
  });

  test('descarga estructurada conserva nombre normalizado', () => {
    const meta = {
      nombre_archivo_original: 'ORDEN + HC - García - Juan - CC - 1 - 2026-01-01 - EEG.pdf',
      nombre_archivo_display: 'ORDEN + HC - García - Juan - CC - 1 - 2026-01-01 - EEG.pdf'
    };
    const nombre = nombreArchivoDescarga(meta, { nombre_display: 'ORDENES MARZO' });
    expect(nombre).toContain('ORDEN + HC');
  });
});
