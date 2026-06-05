const {
  PERMISO_CARPETAS_TODAS,
  permisoKeyCarpetaPdx,
  usuarioVeCarpetaPdx,
  esPermisoPdxValido
} = require('../utils/soportes-pdx-carpetas-permisos');

describe('soportes-pdx-carpetas-permisos', () => {
  const carpeta = { id: 12, nombre_display: 'COMPROBANTES ELECTRO' };

  test('superadmin ve cualquier carpeta', () => {
    expect(usuarioVeCarpetaPdx({ rol: 'superadmin' }, carpeta)).toBe(true);
  });

  test('recepción por defecto ve todas (carpetas.todas en rol)', () => {
    expect(usuarioVeCarpetaPdx({ rol: 'recepcion', permisos: null }, carpeta)).toBe(true);
  });

  test('auxiliar sin carpetas asignadas no ve ninguna', () => {
    expect(usuarioVeCarpetaPdx({ rol: 'auxiliar_recepcion', permisos: null }, carpeta)).toBe(false);
  });

  test('auxiliar con permiso de carpeta específica la ve', () => {
    const session = {
      rol: 'auxiliar_recepcion',
      permisos: ['modulo.reportes_pdx', 'soportes.pdx.ver', 'soportes.pdx.subir', permisoKeyCarpetaPdx(12)]
    };
    expect(usuarioVeCarpetaPdx(session, carpeta)).toBe(true);
    expect(usuarioVeCarpetaPdx(session, { id: 99 })).toBe(false);
  });

  test('permiso personalizado todas las carpetas', () => {
    const session = {
      rol: 'auxiliar_recepcion',
      permisos: ['modulo.reportes_pdx', 'soportes.pdx.ver', PERMISO_CARPETAS_TODAS]
    };
    expect(usuarioVeCarpetaPdx(session, carpeta)).toBe(true);
  });

  test('validación de claves dinámicas', () => {
    expect(esPermisoPdxValido(PERMISO_CARPETAS_TODAS)).toBe(true);
    expect(esPermisoPdxValido('soportes.pdx.carpeta.5')).toBe(true);
    expect(esPermisoPdxValido('soportes.pdx.foo')).toBe(false);
  });
});
