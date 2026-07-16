const {
  analizarNombreArchivo,
  extraerDatosParcialesNombre
} = require('../utils/soportes-pdx-parse');
const { evaluarCamposMinimos } = require('../utils/soportes-pdx-campos');

describe('evaluarCamposMinimos — carga flexible', () => {
  test('VTM: nombre sin coma pero con fecha — solo apellidos/nombres/fecha', () => {
    const carpeta = { nombre_display: 'REPORTES VTM MARZO' };
    const parcial = extraerDatosParcialesNombre('Garcia Lopez Juan Carlos 2026-05-27.pdf', carpeta);
    const evaluacion = evaluarCamposMinimos('vtm', parcial, { ok: false }, carpeta);
    expect(evaluacion.completo).toBe(true);
    expect(evaluacion.datos.apellidos).toBeTruthy();
    expect(evaluacion.datos.nombres).toBeTruthy();
    expect(evaluacion.datos.fecha_estudio).toBe('2026-05-27');
  });

  test('analizarNombreArchivo acepta mínimo en VTM sin regex estricta', () => {
    const a = analizarNombreArchivo(
      'Perez Ana Maria 2026-04-10.pdf',
      { nombre_display: 'VTM ABRIL' },
      []
    );
    expect(a.requiere_correccion).toBe(false);
    expect(a.ok).toBe(true);
    expect(a.parcial.fecha_estudio).toBe('2026-04-10');
  });

  test('órdenes incompletas — pide corrección con campos parciales', () => {
    const carpeta = { nombre_display: 'ORDENES MARZO' };
    const a = analizarNombreArchivo('ORDEN + HC - Garcia - Juan.pdf', carpeta, []);
    expect(a.requiere_correccion).toBe(true);
    expect(a.campos?.length).toBeGreaterThan(0);
    expect(a.parcial.apellidos).toMatch(/Garcia/i);
  });

  test('comprobantes: nombre mal formado pero extrae documento y fecha DD-MM-YY', () => {
    const carpeta = { nombre_display: 'COMPROBANTES ELECTRO' };
    const estudios = [{ nombre: 'EEG' }, { nombre: 'PSG Básica' }];
    const a = analizarNombreArchivo(
      'ORDEN MATABANCHOY ESPINOSA LUIS CARLOS CC 1085289107 19-05-26 EEG PSG Básica.pdf',
      carpeta,
      estudios
    );
    expect(a.parcial.apellidos).toBe('MATABANCHOY ESPINOSA');
    expect(a.parcial.nombres).toBe('LUIS CARLOS');
    expect(a.parcial.tipo_documento).toBe('CC');
    expect(a.parcial.paciente_documento).toBe('1085289107');
    expect(a.parcial.fecha_estudio).toBe('2026-05-19');
    expect(a.parcial.estudio_texto).toMatch(/EEG|PSG Básica/i);
    expect(a.requiere_correccion).toBe(false);
  });

  test('EEG: fecha DD-MM-YY y nombre sin coma', () => {
    const carpeta = { nombre_display: 'REPORTES EEG MARZO' };
    const parcial = extraerDatosParcialesNombre(
      'Garcia Lopez Juan Carlos 19-05-26.pdf',
      carpeta
    );
    expect(parcial.apellidos).toBeTruthy();
    expect(parcial.nombres).toBeTruthy();
    expect(parcial.fecha_estudio).toBe('2026-05-19');
  });

  test('órdenes consulta médica: nombre completo, fecha y especialidad', () => {
    const carpeta = { nombre_display: 'ORDENES + HC CONSULTAS MÉDICAS' };
    const evaluacion = evaluarCamposMinimos(
      'ordenes_consulta_medica',
      { paciente_nombre_completo: 'Juan Carlos García López', fecha_estudio: '2026-05-27', estudio_texto: 'Neurología' },
      { ok: false },
      carpeta
    );
    expect(evaluacion.completo).toBe(true);
    expect(evaluacion.datos.nombres).toMatch(/Juan Carlos/i);
    expect(evaluacion.datos.apellidos).toMatch(/García López/i);
  });

  test('órdenes: prefijo cruzado y fecha DD-MM-YY', () => {
    const carpeta = { nombre_display: 'ORDENES MARZO' };
    const a = analizarNombreArchivo(
      'COMPROBANTE Perez Ana CC 1234567 01-06-26 PSG Basal.pdf',
      carpeta,
      [{ nombre: 'PSG Basal' }]
    );
    expect(a.parcial.apellidos).toBe('Perez');
    expect(a.parcial.nombres).toBe('Ana');
    expect(a.parcial.paciente_documento).toBe('1234567');
    expect(a.parcial.fecha_estudio).toBe('2026-06-01');
  });
});
