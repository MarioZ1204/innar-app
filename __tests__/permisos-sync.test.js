const fs = require('fs');
const path = require('path');
const { PERMISOS_ROL_DEFAULTS: serverDefaults } = require('../config/permisos-rol-defaults');

function extraerKeysPermisosDefs(appJs) {
  const block = appJs.match(/const PERMISOS_DEFS = \[([\s\S]*?)\];/);
  if (!block) return [];
  return [...block[1].matchAll(/key: '([^']+)'/g)].map((m) => m[1]);
}

function extraerPermisosValidos(usuariosJs) {
  const start = usuariosJs.indexOf('const PERMISOS_VALIDOS');
  const end = usuariosJs.indexOf(']);', start);
  return [...usuariosJs.slice(start, end).matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

function extraerPermisosRolDefaultsApp(appJs) {
  const block = appJs.match(/const PERMISOS_ROL_DEFAULTS = (\{[\s\S]*?\n\};)/);
  if (!block) throw new Error('PERMISOS_ROL_DEFAULTS no encontrado en app.js');
  // eslint-disable-next-line no-eval
  return eval(`(${block[1].slice(0, -1)})`);
}

function extraerModulePermMap(appJs) {
  const block = appJs.match(/const MODULE_PERM_MAP = \{([\s\S]*?)\};/);
  if (!block) return {};
  const map = {};
  for (const m of block[1].matchAll(/'([^']+)':\s*'([^']+)'/g)) {
    map[m[1]] = m[2];
  }
  return map;
}

/** Permisos legados que pueden quedar en BD pero ya no se muestran en la UI. */
const LEGACY_VALID_ONLY = new Set(Object.keys(require('../config/permisos-legacy').PERMISOS_LEGACY_REEMPLAZOS));

describe('permisos-sync', () => {
  const appJs = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  const usuariosJs = fs.readFileSync(path.join(__dirname, '../routes/usuarios.js'), 'utf8');
  const defs = extraerKeysPermisosDefs(appJs);
  const valid = extraerPermisosValidos(usuariosJs);
  const defsSet = new Set(defs);
  const validSet = new Set(valid);
  const appDefaults = extraerPermisosRolDefaultsApp(appJs);
  const moduleMap = extraerModulePermMap(appJs);

  test('PERMISOS_DEFS y PERMISOS_VALIDOS tienen las mismas claves (salvo legado)', () => {
    const soloValid = [...validSet].filter((k) => !defsSet.has(k) && !LEGACY_VALID_ONLY.has(k));
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
      'modulo.dashboard',
      'modulo.usuarios',
      'modulo.diagnosticos',
      'modulo.gestion_datos',
      'modulo.reportes_pdx',
      'modulo.reportes_historico',
      'modulo.armado_soportes',
      'modulo.anexo_fidu',
      'modulo.backup',
      'modulo.llamado_pacientes'
    ]));
  });

  test('cada tarjeta del menú con MODULE_PERM_MAP tiene permiso en PERMISOS_DEFS', () => {
    for (const perm of Object.values(moduleMap)) {
      expect(defsSet.has(perm)).toBe(true);
    }
  });

  test('PERMISOS_ROL_DEFAULTS alineado entre app.js y config/permisos-rol-defaults.js', () => {
    const roles = new Set([...Object.keys(appDefaults), ...Object.keys(serverDefaults)]);
    for (const rol of roles) {
      const a = appDefaults[rol];
      const s = serverDefaults[rol];
      const sa = a === null ? null : [...a].sort();
      const ss = s === null ? null : [...s].sort();
      expect(sa).toEqual(ss);
    }
  });

  test('permisos nuevos de recibos están definidos', () => {
    expect(defsSet.has('recibos.pagar')).toBe(true);
    expect(defsSet.has('recibos.pendiente')).toBe(true);
  });
});
