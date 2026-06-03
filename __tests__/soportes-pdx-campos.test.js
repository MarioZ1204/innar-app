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
});
