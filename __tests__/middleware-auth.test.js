// __tests__/middleware-auth.test.js
// Tests del middleware de autorización (sin DB).

const mw = require('../middleware');

function makeReqRes(session, extra = {}) {
  const req = {
    session,
    path: extra.path || '/api/test',
    originalUrl: extra.originalUrl,
    url: extra.url,
    get(name) {
      const h = extra.headers || {};
      return h[name] ?? h[name.toLowerCase()] ?? null;
    }
  };
  const res = {
    statusCode: 200,
    body: null,
    redirectUrl: null,
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; return this; },
    redirect(code, url) { this.statusCode = code; this.redirectUrl = url; return this; }
  };
  return { req, res };
}

describe('requireAuth', () => {
  test('pasa si hay usuarioId en sesión', () => {
    const { req, res } = makeReqRes({ usuarioId: 1 });
    const next = jest.fn();
    mw.requireAuth(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('responde 401 sin sesión en API', () => {
    const { req, res } = makeReqRes({}, { path: '/api/soportes/pdx/carpetas' });
    const next = jest.fn();
    mw.requireAuth(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  test('redirige al login sin sesión en página HTML', () => {
    const { req, res } = makeReqRes({}, {
      path: '/soportes/visor-pdf',
      originalUrl: '/soportes/visor-pdf?fuente=pdx&id=1'
    });
    const next = jest.fn();
    mw.requireAuth(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(302);
    expect(res.redirectUrl).toContain('login=1');
  });
});

describe('requireAdmin', () => {
  test('pasa con superadmin', () => {
    const { req, res } = makeReqRes({ usuarioId: 1, rol: 'superadmin' });
    const next = jest.fn();
    mw.requireAdmin(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('responde 403 con rol no admin', () => {
    const { req, res } = makeReqRes({ usuarioId: 1, rol: 'doctor' });
    const next = jest.fn();
    mw.requireAdmin(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });
});

describe('requireRoleOrPerm', () => {
  test('superadmin siempre pasa', () => {
    const { req, res } = makeReqRes({ usuarioId: 1, rol: 'superadmin' });
    const next = jest.fn();
    mw.requireRoleOrPerm(['doctor'], 'algo')(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('rol en lista sin permisos personalizados pasa', () => {
    const { req, res } = makeReqRes({ usuarioId: 1, rol: 'doctor', permisos: null });
    const next = jest.fn();
    mw.requireRoleOrPerm(['doctor'], 'turnos.editar')(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('rol fuera de lista sin permiso explícito: 403', () => {
    const { req, res } = makeReqRes({ usuarioId: 1, rol: 'contabilidad', permisos: ['otros'] });
    const next = jest.fn();
    mw.requireRoleOrPerm(['doctor'], 'turnos.editar')(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  test('rol fuera de lista CON permiso explícito: pasa', () => {
    const { req, res } = makeReqRes({ usuarioId: 1, rol: 'contabilidad', permisos: ['turnos.editar'] });
    const next = jest.fn();
    mw.requireRoleOrPerm(['doctor'], 'turnos.editar')(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('rol en lista con permisos personalizados que NO incluyen el permiso: 403', () => {
    const { req, res } = makeReqRes({ usuarioId: 1, rol: 'doctor', permisos: ['otra.cosa'] });
    const next = jest.fn();
    mw.requireRoleOrPerm(['doctor'], 'turnos.editar')(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  test('sin sesión: 401', () => {
    const { req, res } = makeReqRes({});
    const next = jest.fn();
    mw.requireRoleOrPerm(['doctor'], 'turnos.editar')(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });
});

describe('isAdminRol / isRecepcionRol / isElectroRol', () => {
  test('isAdminRol detecta superadmin y admin', () => {
    expect(mw.isAdminRol('superadmin')).toBe(true);
    expect(mw.isAdminRol('admin')).toBe(true);
    expect(mw.isAdminRol('doctor')).toBe(false);
  });
  test('isRecepcionRol incluye admin', () => {
    expect(mw.isRecepcionRol('admin_recepcion')).toBe(true);
    expect(mw.isRecepcionRol('recepcion')).toBe(true);
    expect(mw.isRecepcionRol('superadmin')).toBe(true);
    expect(mw.isRecepcionRol('doctor')).toBe(false);
  });
  test('isElectroRol incluye técnicos y admin', () => {
    expect(mw.isElectroRol('admin_electro')).toBe(true);
    expect(mw.isElectroRol('electro')).toBe(true);
    expect(mw.isElectroRol('tecnico_electro')).toBe(true);
    expect(mw.isElectroRol('admin')).toBe(true);
    expect(mw.isElectroRol('doctor')).toBe(false);
  });
});

describe('safeError', () => {
  beforeEach(() => { delete process.env.NODE_ENV; });

  test('en producción siempre devuelve mensaje genérico', () => {
    process.env.NODE_ENV = 'production';
    expect(mw.safeError(new Error('SELECT * FROM secretos'))).toBe('Error interno del servidor');
  });

  test('fuera de producción trunca a 200 chars', () => {
    process.env.NODE_ENV = 'test';
    const huge = 'x'.repeat(500);
    expect(mw.safeError(new Error(huge)).length).toBeLessThanOrEqual(200);
  });

  test('elimina líneas adicionales del stack', () => {
    process.env.NODE_ENV = 'test';
    const e = new Error('msg\n  at file:1:1\n  at otro:2:2');
    expect(mw.safeError(e)).toBe('msg');
  });
});
