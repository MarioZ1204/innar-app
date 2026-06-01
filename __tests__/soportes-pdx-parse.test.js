const {
  parseNombreReporte,
  parseNombreOrdenHc,
  parseNombreComprobante,
  parseNombreConsentimiento,
  parseNombrePorCarpeta,
  nombreArchivoDescarga,
  inferirEstudioDesdeCarpeta,
  mensajeErrorFormato,
  analizarNombreArchivo,
  buildMetaDesdeCamposManuales,
  estudioPsgReconocido
} = require('../utils/soportes-pdx-parse');
const { buildMetaFromUpload } = require('../utils/soportes-pdx-upload');

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

describe('soportes-pdx-parse — carpeta PSG', () => {
  test('acepta formato mínimo con guiones', () => {
    const p = parseNombrePorCarpeta(
      'Juan Carlos - García López - 1234567890 - 2026-05-27 - PSG Básica.pdf',
      { nombre_display: 'REPORTES PSG MARZO' },
      []
    );
    expect(p.ok).toBe(true);
    expect(p.nombres).toBe('Juan Carlos');
    expect(p.apellidos).toBe('García López');
    expect(p.paciente_documento).toBe('1234567890');
    expect(p.fecha_estudio).toBe('2026-05-27');
    expect(p.estudio_texto).toBe('PSG Básica');
    expect(p.formato).toBe('psg');
  });

  test('acepta segmentos opcionales entre fecha y tipo PSG', () => {
    const p = parseNombrePorCarpeta(
      'Nancy - Arcos Enriquez - 52987654 - 2026-03-14 - 21-21-12 - PSG BASAL.pdf',
      { nombre_display: 'PSG MARZO' },
      []
    );
    expect(p.ok).toBe(true);
    expect(p.marca_tiempo).toBe('21-21-12');
    expect(p.estudio_texto).toBe('PSG BASAL');
  });

  test('rechaza formato antiguo solo con coma', () => {
    const p = parseNombrePorCarpeta(
      'García López, Juan Carlos   2026-05-27.pdf',
      { nombre_display: 'PSG MARZO' },
      []
    );
    expect(p.ok).toBe(false);
  });

  test('analizar requiere corrección si falta tipo PSG al final', () => {
    const a = analizarNombreArchivo(
      'Juan - García - 1234567890 - 2026-05-27 - sala 3.pdf',
      { nombre_display: 'PSG MARZO' }
    );
    expect(a.ok).toBe(false);
    expect(a.motivo).toBe('falta_estudio_psg');
  });
});

describe('soportes-pdx-parse — corrección manual', () => {

  test('estudioPsgReconocido acepta CPAP y Básica', () => {
    expect(estudioPsgReconocido('PSG CPAP')).toBe(true);
    expect(estudioPsgReconocido('PSG Básica')).toBe(true);
    expect(estudioPsgReconocido('')).toBe(false);
  });

  test('buildMetaDesdeCamposManuales con confirmación PSG', () => {
    const meta = buildMetaDesdeCamposManuales(
      'informe.pdf',
      {
        apellidos: 'García',
        nombres: 'Juan',
        paciente_documento: '1234567890',
        fecha_estudio: '2026-05-27',
        estudio_texto: 'PSG CPAP'
      },
      { nombre_display: 'PSG MARZO' }
    );
    expect(meta.ok).toBe(true);
    expect(meta.estudio_texto).toBe('PSG CPAP');
    expect(meta.nombre_display).toBe('Juan - García - 1234567890 - 2026-05-27 - PSG CPAP.pdf');
  });

  test('buildMetaFromUpload con confirmacion_manual en órdenes', () => {
    const meta = buildMetaFromUpload(
      'mal-nombre.pdf',
      {
        confirmacion_manual: '1',
        apellidos: 'Pérez',
        nombres: 'Ana',
        tipo_documento: 'CC',
        paciente_documento: '123',
        fecha_estudio: '2026-04-01',
        estudio_texto: 'EEG'
      },
      { nombre_display: 'ORDENES ABRIL', _estudiosLista: [] }
    );
    expect(meta.ok).toBe(true);
    expect(meta.nombre_display).toContain('ORDEN + HC');
  });
});
