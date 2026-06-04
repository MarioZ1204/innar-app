/** Permisos que no heredan el default "todo permitido" de admin/superadmin sin lista explícita. */
const PERMISOS_OPT_IN = new Set(['modulo.anexo_fidu']);

function esPermisoOptIn(permKey) {
  return PERMISOS_OPT_IN.has(permKey);
}

module.exports = { PERMISOS_OPT_IN, esPermisoOptIn };
