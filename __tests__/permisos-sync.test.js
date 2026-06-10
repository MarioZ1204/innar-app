const fs = require('fs');
const path = require('path');

function extraerKeysPermisosDefs(appJs) {
  return [...appJs.matchAll(/key: '([^']+)'/g)]
    .map((m) => m[1])
    .filter((k) => k.includes('.'));
}

function extraerPermisosValidos(usuariosJs) {
  const start = usuariosJs.indexOf('const PERMISOS_VALIDOS');
  const end = usuariosJs.indexOf(']);', start);
  return [...usuariosJs.slice(start, end).matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe('permisos-sync', () => {
  const appJs = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  const usuariosJs = fs.readFileSync(path.join(__dirname, '../routes/usuarios.js'), 'utf8');
  const defs = extraerKeysPermisosDefs(appJs);
  const valid = extraerPermisosValidos(usuariosJs);
  const defsSet = new Set(defs);
  const validSet = new Set(valid);

  test('PERMISOS_DEFS y PERMISOS_VALIDOS tienen las mismas claves', () => {
    const soloValid = [...validSet].filter((k) => !defsSet.has(k));
    const soloDefs = [...defsSet].filter((k) => !validSet.has(k));
    expect(soloValid).toEqual([]);
    expect(soloDefs).toEqual([]);
  });

  test('cada módulo principal tiene permiso de acceso modulo.*', () => {
    const modulos = defs.filter((k) => k.startsWith('modulo.'));
    expect(modulos).toEqual(expect.arrayContaining([
      'modulo.recibos',
      'modulo.agenda_medica',
      'modulo.electrodiag',
      'modulo.monitor_equipos',
      'modulo.ucqn',
      'modulo.dashboard',
      'modulo.usuarios',
      'modulo.diagnosticos',
      'modulo.gestion_datos',
      'modulo.reportes_pdx',
      'modulo.armado_soportes',
      'modulo.anexo_fidu',
      'modulo.backup'
    ]));
  });

  test('permisos nuevos de recibos están definidos', () => {
    expect(defsSet.has('recibos.pagar')).toBe(true);
    expect(defsSet.has('recibos.pendiente')).toBe(true);
  });
});
