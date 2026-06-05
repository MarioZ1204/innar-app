const {
  parseRolesVisibles,
  carpetaVisibleParaRol,
  normalizarRolesVisiblesBody,
  labelRolesVisibles
} = require('../utils/soportes-pdx-roles');

describe('soportes-pdx-roles', () => {
  test('vacío o null = todos los roles', () => {
    expect(carpetaVisibleParaRol([], 'recepcion')).toBe(true);
    expect(carpetaVisibleParaRol(null, 'electro')).toBe(true);
    expect(labelRolesVisibles([])).toBe('Todos los roles');
  });

  test('lista restringe por rol', () => {
    const roles = ['electro', 'admin_electro'];
    expect(carpetaVisibleParaRol(roles, 'electro')).toBe(true);
    expect(carpetaVisibleParaRol(roles, 'recepcion')).toBe(false);
    expect(labelRolesVisibles(roles)).toContain('Electro');
  });

  test('auxiliar_recepcion en lista legacy de roles de carpeta', () => {
    const roles = ['recepcion', 'auxiliar_recepcion'];
    expect(parseRolesVisibles(JSON.stringify(roles))).toEqual(roles);
    expect(carpetaVisibleParaRol(roles, 'auxiliar_recepcion')).toBe(true);
    expect(labelRolesVisibles(roles)).toContain('Auxiliar');
  });

  test('parseRolesVisibles desde JSON string', () => {
    expect(parseRolesVisibles('["electro","foo"]')).toEqual(['electro']);
  });

  test('normalizar body inválido', () => {
    expect(normalizarRolesVisiblesBody(['electro'])).toEqual(['electro']);
    expect(normalizarRolesVisiblesBody(null)).toBeNull();
    expect(normalizarRolesVisiblesBody('x').error).toBeTruthy();
  });
});
