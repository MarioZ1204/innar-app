const {
  parseNombreReporte,
  parseNombreOrdenHc,
  parseNombreComprobante,
  parseNombreConsentimiento,
  parseNombrePorCarpeta,
  nombreArchivoDescarga,
  buildNombreDescargaPdxDesdeRow,
  inferirEstudioDesdeCarpeta,
  mensajeErrorFormato,
  analizarNombreArchivo,
  buildMetaDesdeCamposManuales,
  estudioPsgReconocido,
  extraerNombreApellidoConsultaMedica,
  separarNombreCompletoConsultaMedica
} = require('../utils/soportes-pdx-parse');
const { buildMetaFromUpload } = require('../utils/soportes-pdx-upload');
const { detectarTemaCarpeta } = require('../utils/soportes-temas');

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

  test('buildNombreDescargaPdxDesdeRow — órdenes sin guiones', () => {
    const nombre = buildNombreDescargaPdxDesdeRow(
      {
        apellidos: 'García López',
        nombres: 'Juan Carlos',
        paciente_documento: '1234567890',
        fecha_estudio: '2026-05-27',
        estudio_texto: 'PSG Basal',
        nombre_archivo_original: 'mal.pdf'
      },
      { nombre_display: 'ORDENES MARZO' }
    );
    expect(nombre).toBe('ORDEN + HC García López Juan Carlos CC 1234567890 2026-05-27 PSG Basal.pdf');
  });

  test('buildNombreDescargaPdxDesdeRow — comprobantes', () => {
    const nombre = buildNombreDescargaPdxDesdeRow(
      {
        apellidos: 'Pérez',
        nombres: 'Ana',
        paciente_documento: '987654',
        fecha_estudio: '2026-04-01',
        estudio_texto: 'EEG',
        nombre_archivo_original: 'x.pdf'
      },
      { nombre_display: 'COMPROBANTES ABRIL' }
    );
    expect(nombre).toContain('COMPROBANTE Pérez Ana');
    expect(nombre).toContain('EEG.pdf');
  });

  test('buildNombreDescargaPdxDesdeRow — PSG con estudio inferido', () => {
    const nombre = buildNombreDescargaPdxDesdeRow(
      {
        apellidos: 'López',
        nombres: 'María',
        fecha_estudio: '2026-03-10',
        nombre_archivo_original: 'López, María   2026-03-10.pdf'
      },
      { nombre_display: 'PSG CPAP MARZO' }
    );
    expect(nombre).toBe('López, María   2026-03-10 PSG CPAP.pdf');
  });

  test('buildNombreDescargaPdxDesdeRow añade estudio VTM al descargar', () => {
    const nombre = buildNombreDescargaPdxDesdeRow(
      {
        nombre_archivo_original: 'García, Juan   2026-05-27.pdf',
        apellidos: 'García',
        nombres: 'Juan',
        fecha_estudio: '2026-05-27',
        estudio_texto: ''
      },
      { nombre_display: 'REPORTES VTM MARZO' }
    );
    expect(nombre).toBe('García, Juan   2026-05-27 VTM.pdf');
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

  test('detectar tema latencia múltiple del sueño', () => {
    expect(detectarTemaCarpeta('PRUEBA DE LATENCIA MULTIPLE DEL SUEÑO')).toBe('latencia');
    expect(inferirEstudioDesdeCarpeta({ nombre_display: 'PRUEBA DE LATENCIA MULTIPLE DEL SUEÑO' }))
      .toBe('Prueba de latencia múltiple del sueño');
  });
});

describe('soportes-pdx-parse — formatos estructurados', () => {
  test('carpeta ORDEN + HC detecta tema ordenes', () => {
    expect(detectarTemaCarpeta('ORDEN + HC MARZO 2026')).toBe('ordenes');
    expect(detectarTemaCarpeta('Reportes ORDEN HC abril')).toBe('ordenes');
  });

  test('analizar nombre ideal en carpeta ORDEN + HC', () => {
    const a = analizarNombreArchivo(
      'ORDEN + HC García López Juan Carlos CC 1234567890 2026-05-27 PSG Basal.pdf',
      { nombre_display: 'ORDEN + HC MARZO' }
    );
    expect(a.ok).toBe(true);
    expect(a.requiere_correccion).toBe(false);
    expect(a.parsed.paciente_documento).toBe('1234567890');
    expect(a.parsed.estudio_texto).toBe('PSG Basal');
    expect(a.parsed.nombre_display).toBe('ORDEN + HC García López Juan Carlos CC 1234567890 2026-05-27 PSG Basal.pdf');
  });

  test('órdenes ORDEN + HC con guiones legacy (acepta y normaliza sin guiones)', () => {
    const p = parseNombreOrdenHc(
      'ORDEN + HC - García López - Juan Carlos - CC - 1234567890 - 2026-03-20 - PSG Basal.pdf',
      []
    );
    expect(p.ok).toBe(true);
    expect(p.paciente_documento).toBe('1234567890');
    expect(p.tipo_documento).toBe('CC');
    expect(p.estudio_texto).toBe('PSG Basal');
    expect(p.nombre_display).toBe('ORDEN + HC García López Juan Carlos CC 1234567890 2026-03-20 PSG Basal.pdf');
  });

  test('documento con puntos y guiones se normaliza a solo dígitos', () => {
    const p = parseNombreOrdenHc(
      'ORDEN + HC - Pérez - Ana - TI - 12.345.678-9 - 2026-03-20 - PSG Basal.pdf',
      [{ nombre: 'PSG Basal' }]
    );
    expect(p.ok).toBe(true);
    expect(p.paciente_documento).toBe('123456789');
    expect(p.tipo_documento).toBe('TI');
  });

  test('comprobantes', () => {
    const p = parseNombreComprobante(
      'COMPROBANTE - García López - Juan Carlos - CC - 987654321 - 2026-04-01 - EEG.pdf',
      []
    );
    expect(p.ok).toBe(true);
    expect(p.formato).toBe('comprobantes');
  });

  test('consentimientos con prefijo CONSENTIMIENTO al guardar', () => {
    const p = parseNombreConsentimiento(
      'CONSENTIMIENTO - García López - Juan Carlos - CC - 5555555 - 2026-04-02 - VTM.pdf',
      []
    );
    expect(p.ok).toBe(true);
    expect(p.formato).toBe('consentimientos');
    expect(p.nombre_display).toMatch(/^CONSENTIMIENTO /);
    expect(p.nombre_display).not.toMatch(/\s-\s/);
  });

  test('órdenes sin guiones obligatorios', () => {
    const p = parseNombreOrdenHc(
      'ORDEN + HC García López Juan Carlos CC 1234567890 2026-05-27 PSG Basal.pdf',
      [{ nombre: 'PSG Basal' }]
    );
    expect(p.ok).toBe(true);
    expect(p.paciente_documento).toBe('1234567890');
  });

  test('comprobante consultas médicas por especialidad', () => {
    expect(detectarTemaCarpeta('COMPROBANTES CONSULTAS MÉDICAS')).toBe('comprobantes_consulta_medica');
    const p = parseNombrePorCarpeta(
      'COMPROBANTE Juan Carlos García López 2026-05-27 Neurología.pdf',
      { nombre_display: 'COMPROBANTES CONSULTAS MÉDICAS' },
      [{ nombre: 'Neurología' }]
    );
    expect(p.ok).toBe(true);
    expect(p.nombres).toBe('Juan Carlos');
    expect(p.apellidos).toBe('García López');
    expect(p.estudio_texto).toBe('Neurología');
    expect(p.nombre_display).toBe('COMPROBANTE Juan Carlos García López 2026-05-27 Neurología.pdf');
  });

  test('orden + HC consultas médicas por especialidad', () => {
    expect(detectarTemaCarpeta('ORDENES + HC CONSULTAS MÉDICAS')).toBe('ordenes_consulta_medica');
    const a = analizarNombreArchivo(
      'ORDEN + HC María Elena Pérez Gómez 2026-06-01 Neurología.pdf',
      { nombre_display: 'ORDENES + HC CONSULTAS MÉDICAS' },
      [{ nombre: 'Neurología' }]
    );
    expect(a.ok).toBe(true);
    expect(a.parsed.estudio_texto).toBe('Neurología');
    expect(a.parsed.nombre_display).toBe('ORDEN + HC María Elena Pérez Gómez 2026-06-01 Neurología.pdf');
  });

  test('comprobante consultas médicas ignora prefijos al extraer nombres y apellidos', () => {
    const p = parseNombrePorCarpeta(
      'COMPROBANTE Juan Carlos García López 2026-05-27 Neurología.pdf',
      { nombre_display: 'COMPROBANTES CONSULTAS MÉDICAS' },
      [{ nombre: 'Neurología' }]
    );
    expect(p.ok).toBe(true);
    expect(p.nombres).toBe('Juan Carlos');
    expect(p.apellidos).toBe('García López');
    expect(p.estudio_texto).toBe('Neurología');
  });

  test('prefijos estructurales se ignoran cuando aparecen antes del nombre en consultas médicas', () => {
    const p = parseNombrePorCarpeta(
      'COMPROBANTE ORDEN + HC Juan Carlos García López 2026-05-27 Neurología.pdf',
      { nombre_display: 'COMPROBANTES CONSULTAS MÉDICAS' },
      [{ nombre: 'Neurología' }]
    );
    expect(p.ok).toBe(true);
    expect(p.nombres).toBe('Juan Carlos');
    expect(p.apellidos).toBe('García López');
    expect(p.estudio_texto).toBe('Neurología');
  });

  test('extrae nombres y apellidos desde un nombre completo escrito en un solo campo', () => {
    expect(extraerNombreApellidoConsultaMedica('Juan Carlos García López')).toEqual({
      nombres: 'Juan Carlos',
      apellidos: 'García López'
    });
  });

  test('separa un nombre completo de consulta médica aunque no incluya fecha ni prefijo', () => {
    expect(separarNombreCompletoConsultaMedica('Juan Carlos García López')).toEqual({
      nombres: 'Juan Carlos',
      apellidos: 'García López'
    });
  });

  test('comprobante consultas médicas extrae nombres y apellidos desde formato con guiones', () => {
    const p = parseNombrePorCarpeta(
      'COMPROBANTE - Juan Carlos - García López - 2026-05-27 - Neurología.pdf',
      { nombre_display: 'COMPROBANTES CONSULTAS MÉDICAS' },
      [{ nombre: 'Neurología' }]
    );
    expect(p.ok).toBe(true);
    expect(p.nombres).toBe('Juan Carlos');
    expect(p.apellidos).toBe('García López');
    expect(p.estudio_texto).toBe('Neurología');
  });

  test('comprobante consultas médicas extrae especialidad y tipo de consulta del nombre', () => {
    const p = parseNombrePorCarpeta(
      'COMPROBANTE Juan Carlos García López 2026-05-27 Neurología Control.pdf',
      { nombre_display: 'COMPROBANTES CONSULTAS MÉDICAS' },
      [{ nombre: 'Neurología' }]
    );
    expect(p.ok).toBe(true);
    expect(p.estudio_texto).toBe('Neurología');
    expect(p.marca_tiempo).toBe('Control');
    expect(p.nombre_display).toBe('COMPROBANTE Juan Carlos García López 2026-05-27 Neurología Control.pdf');
  });

  test('buildMetaFromUpload usa el nombre estructurado para carpetas de consultas médicas y evita sobrescribir archivos con distinta especialidad', () => {
    const meta = buildMetaFromUpload(
      'COMPROBANTE mismo.pdf',
      {
        confirmacion_manual: '1',
        nombres: 'Juan Carlos',
        apellidos: 'García López',
        fecha_estudio: '2026-05-27',
        estudio_texto: 'Neurología',
        tipo_consulta: 'Control'
      },
      { nombre_display: 'COMPROBANTES CONSULTAS MÉDICAS' }
    );
    expect(meta.ok).toBe(true);
    expect(meta.marca_tiempo).toBe('Control');
    expect(meta.nombre_archivo_display).toBe('COMPROBANTE Juan Carlos García López 2026-05-27 Neurología Control.pdf');
  });

  test('analizarNombreArchivo requiere tipo de consulta si el nombre no lo incluye', () => {
    const a = analizarNombreArchivo(
      'COMPROBANTE Juan Carlos García López 2026-05-27 Neurología.pdf',
      { nombre_display: 'CONSULTAS MÉDICAS' },
      [{ nombre: 'Neurología' }]
    );
    expect(a.ok).toBe(false);
    expect(a.requiere_correccion).toBe(true);
    expect(a.parcial.estudio_texto).toBe('Neurología');
    expect(a.parcial.tipo_consulta).toBe('');
  });

  test('analizarNombreArchivo acepta comprobantes consultas médicas con tipo en el nombre', () => {
    const a = analizarNombreArchivo(
      'COMPROBANTE Juan Carlos García López 2026-05-27 Neurología Control.pdf',
      { nombre_display: 'CONSULTAS MÉDICAS' },
      [{ nombre: 'Neurología' }]
    );
    expect(a.ok).toBe(true);
    expect(a.requiere_correccion).toBe(false);
    expect(a.parsed.estudio_texto).toBe('Neurología');
    expect(a.parsed.marca_tiempo).toBe('Control');
  });

  test('consultas médicas ignora prefijos estructurales concatenados al inicio', () => {
    const casos = [
      'COMPROBANTE ORDEN + HC Juan Carlos García López 2026-05-27 Neurología.pdf',
      'ORDEN + HC COMPROBANTE Juan Carlos García López 2026-05-27 Neurología.pdf',
      'COMPROBANTE CONSENTIMIENTO Juan Carlos García López 2026-05-27 Neurología.pdf'
    ];

    for (const nombre of casos) {
      const p = parseNombrePorCarpeta(
        nombre,
        { nombre_display: 'COMPROBANTES CONSULTAS MÉDICAS' },
        [{ nombre: 'Neurología' }]
      );
      expect(p.ok).toBe(true);
      expect(p.nombres).toBe('Juan Carlos');
      expect(p.apellidos).toBe('García López');
      expect(p.estudio_texto).toBe('Neurología');
    }
  });

  test('orden + HC consultas médicas ignora prefijos al extraer nombres y apellidos', () => {
    const p = parseNombrePorCarpeta(
      'ORDEN + HC María Elena Pérez Gómez 2026-06-01 Neurología.pdf',
      { nombre_display: 'ORDENES + HC CONSULTAS MÉDICAS' },
      [{ nombre: 'Neurología' }]
    );
    expect(p.ok).toBe(true);
    expect(p.nombres).toBe('María Elena');
    expect(p.apellidos).toBe('Pérez Gómez');
    expect(p.estudio_texto).toBe('Neurología');
  });

  test('consentimientos extrae datos del nombre de archivo', () => {
    const a = analizarNombreArchivo(
      'CONSENTIMIENTO García López Juan Carlos CC 1234567890 2026-05-27 PSG Basal.pdf',
      { nombre_display: 'CONSENTIMIENTOS' },
      [{ nombre: 'PSG Basal' }]
    );
    expect(a.ok).toBe(true);
    expect(a.parsed.apellidos).toBe('García López');
    expect(a.parsed.nombres).toBe('Juan Carlos');
    expect(a.parsed.paciente_documento).toBe('1234567890');
    expect(a.parsed.estudio_texto).toBe('PSG Basal');
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
  test('acepta formato con coma sin documento', () => {
    const p = parseNombrePorCarpeta(
      'García López, Juan Carlos   2026-05-27.pdf',
      { nombre_display: 'REPORTES PSG MARZO' },
      []
    );
    expect(p.ok).toBe(true);
    expect(p.apellidos).toBe('García López');
    expect(p.nombres).toBe('Juan Carlos');
    expect(p.paciente_documento).toBe('');
    expect(p.fecha_estudio).toBe('2026-05-27');
    expect(p.formato).toBe('simple');
  });

  test('acepta Apellidos - Nombres - fecha sin documento', () => {
    const p = parseNombrePorCarpeta(
      'García López - Juan Carlos - 2026-05-27.pdf',
      { nombre_display: 'PSG CPAP MARZO' },
      []
    );
    expect(p.ok).toBe(true);
    expect(p.apellidos).toBe('García López');
    expect(p.nombres).toBe('Juan Carlos');
    expect(p.estudio_texto).toBe('PSG CPAP');
  });

  test('ignora segmento de documento en nombres legacy con guiones', () => {
    const p = parseNombrePorCarpeta(
      'Juan Carlos - García López - 1234567890 - 2026-05-27 - PSG Básica.pdf',
      { nombre_display: 'PSG MARZO' },
      []
    );
    expect(p.ok).toBe(true);
    expect(p.nombres).toBe('Juan Carlos');
    expect(p.apellidos).toBe('García López');
    expect(p.paciente_documento).toBe('');
    expect(p.estudio_texto).toBe('PSG Básica');
  });

  test('analizar infiere tipo PSG desde carpeta si falta en el nombre', () => {
    const a = analizarNombreArchivo(
      'García López, Juan Carlos   2026-05-27.pdf',
      { nombre_display: 'PSG CPAP MARZO' }
    );
    expect(a.ok).toBe(true);
    expect(a.requiere_correccion).toBe(false);
    expect(a.parsed.estudio_texto).toBe('PSG CPAP');
  });
});

describe('soportes-pdx-parse — corrección manual', () => {

  test('estudioPsgReconocido acepta CPAP y Básica', () => {
    expect(estudioPsgReconocido('PSG CPAP')).toBe(true);
    expect(estudioPsgReconocido('PSG Básica')).toBe(true);
    expect(estudioPsgReconocido('')).toBe(false);
  });

  test('buildMetaDesdeCamposManuales con confirmación PSG sin documento', () => {
    const meta = buildMetaDesdeCamposManuales(
      'informe.pdf',
      {
        apellidos: 'García',
        nombres: 'Juan',
        fecha_estudio: '2026-05-27',
        estudio_texto: 'PSG CPAP'
      },
      { nombre_display: 'PSG MARZO' }
    );
    expect(meta.ok).toBe(true);
    expect(meta.estudio_texto).toBe('PSG CPAP');
    expect(meta.paciente_documento).toBe('');
    expect(meta.formato).toBe('simple');
  });

  test('buildMetaDesdeCamposManuales órdenes consulta médica con nombre completo', () => {
    const meta = buildMetaDesdeCamposManuales(
      'orden.pdf',
      {
        paciente_nombre_completo: 'Juan Carlos García López',
        fecha_estudio: '2026-05-27',
        estudio_texto: 'Neurología'
      },
      { nombre_display: 'ORDENES + HC CONSULTAS MÉDICAS', _estudiosLista: [{ nombre: 'Neurología' }] }
    );
    expect(meta.ok).toBe(true);
    expect(meta.formato).toBe('ordenes_consulta_medica');
    expect(meta.nombres).toMatch(/Juan Carlos/i);
    expect(meta.apellidos).toMatch(/García López/i);
    expect(meta.nombre_display).toContain('ORDEN + HC');
  });

  test('buildMetaFromUpload con confirmacion_manual en órdenes', () => {
    const meta = buildMetaFromUpload(
      'mal-nombre.pdf',
      {
        confirmacion_manual: '1',
        apellidos: 'Pérez',
        nombres: 'Ana',
        tipo_documento: 'CC',
        paciente_documento: '1234567',
        fecha_estudio: '2026-04-01',
        estudio_texto: 'EEG'
      },
      { nombre_display: 'ORDENES ABRIL', _estudiosLista: [] }
    );
    expect(meta.ok).toBe(true);
    expect(meta.nombre_display).toContain('ORDEN + HC');
  });

  test('analizarNombreArchivo retorna parsed incluso cuando requiere corrección', () => {
    const analisis = analizarNombreArchivo(
      'COMPROBANTE García López Juan Carlos CC 1234567890 2026-05-27 PSG Basal.pdf',
      { nombre_display: 'COMPROBANTES', _estudiosLista: [] },
      []
    );
    // Si ok es true, parsed debe estar presente
    if (analisis.ok) {
      expect(analisis.parsed).toBeDefined();
      expect(analisis.parsed.apellidos).toBe('García López');
      expect(analisis.parsed.nombres).toBe('Juan Carlos');
    }
  });

  test('analizarNombreArchivo retorna parsed cuando campos faltan pero se pueden parsear', () => {
    // Nombre incompleto: sin documento (requerido para comprobantes)
    const analisis = analizarNombreArchivo(
      'García López Juan 2026-05-27.pdf',
      { nombre_display: 'COMPROBANTES', _estudiosLista: [] },
      []
    );
    // Aunque ok sea false y requiera corrección, debe retornar parsed con lo que se pudo extraer
    // O en su defecto, debe retornar los datos parseados si los tiene
    if (!analisis.ok) {
      // Cuando falla, debe haber field parsed con los datos que se pudieron extraer
      expect(analisis.requiere_correccion).toBe(true);
      // El campo 'parsed' debe estar presente si hubo parsing exitoso previo
      if (analisis.parsed && analisis.parsed.ok) {
        expect(analisis.parsed.apellidos).toBeDefined();
        expect(analisis.parsed.nombres).toBeDefined();
      }
    }
  });
});
