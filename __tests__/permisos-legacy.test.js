const fs = require('fs');
const path = require('path');
const {
  normalizePermisosLista,
  sesionIncluyePermiso,
  PERMISOS_LEGACY_REEMPLAZOS,
} = require('../config/permisos-legacy');

describe('permisos-legacy', () => {
  test('normaliza permisos legados a canónicos', () => {
    const { list, changed } = normalizePermisosLista([
      'modulo.reportes_pdx',
      'modulo.archivo_soportes',
      'soportes.ver_archivo',
    ]);
    expect(changed).toBe(true);
    expect(list).toEqual(expect.arrayContaining(['modulo.reportes_pdx', 'modulo.reportes_historico']));
    expect(list).not.toContain('modulo.archivo_soportes');
    expect(list).not.toContain('soportes.ver_archivo');
  });

  test('sesionIncluyePermiso reconoce alias legado', () => {
    expect(sesionIncluyePermiso(['modulo.archivo_soportes'], 'modulo.reportes_historico')).toBe(true);
    expect(sesionIncluyePermiso(['soportes.ver_archivo'], 'modulo.reportes_historico')).toBe(true);
    expect(sesionIncluyePermiso(['modulo.reportes_pdx'], 'modulo.reportes_historico')).toBe(false);
  });

  test('mapa legado alineado con public/app.js', () => {
    const appJs = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
    const block = appJs.match(/const PERMISOS_LEGACY_REEMPLAZOS = (\{[\s\S]*?\n\};)/);
    expect(block).toBeTruthy();
    // eslint-disable-next-line no-eval
    const clientMap = eval(`(${block[1].slice(0, -1)})`);
    expect(clientMap).toEqual(PERMISOS_LEGACY_REEMPLAZOS);
  });
});
