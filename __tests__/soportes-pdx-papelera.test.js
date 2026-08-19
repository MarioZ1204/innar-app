const {
  claveArchivo,
  parseEntradaBackupPdx,
  metaDesdeNombre
} = require('../utils/soportes-pdx-papelera');

describe('soportes-pdx-papelera', () => {
  test('parseEntradaBackupPdx extrae carpeta y nombre', () => {
    expect(parseEntradaBackupPdx('uploads/soportes/pdx/12/Garcia_Juan.pdf')).toEqual({
      carpetaId: 12,
      basename: 'Garcia_Juan.pdf',
      entryName: 'uploads/soportes/pdx/12/Garcia_Juan.pdf'
    });
  });

  test('parseEntradaBackupPdx ignora _papelera y no-pdf', () => {
    expect(parseEntradaBackupPdx('uploads/soportes/pdx/_papelera/x/a.pdf')).toBeNull();
    expect(parseEntradaBackupPdx('uploads/soportes/pdx/12/nota.txt')).toBeNull();
    expect(parseEntradaBackupPdx('uploads/otro/12/a.pdf')).toBeNull();
  });

  test('claveArchivo normaliza mayúsculas', () => {
    expect(claveArchivo(5, 'A.PDF')).toBe(claveArchivo(5, 'a.pdf'));
  });

  test('metaDesdeNombre no lanza con nombre libre', () => {
    const meta = metaDesdeNombre('archivo-suelto.pdf', { nombre_display: 'COMPROBANTES' });
    expect(meta.paciente_nombre).toBeTruthy();
    expect(meta.paciente_nombre_norm).toBeTruthy();
  });
});
