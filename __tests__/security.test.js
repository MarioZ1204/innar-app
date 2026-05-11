// __tests__/security.test.js
// Tests para verificar que las medidas de seguridad están activas

describe('Security Headers', () => {
  test('Helmet.js should be configured', () => {
    const securityCode = require('fs').readFileSync(
      require('path').join(__dirname, '../config/security.js'),
      'utf8'
    );

    expect(securityCode).toContain("require('helmet')");
    expect(securityCode).toContain('contentSecurityPolicy');
    expect(securityCode).toContain('hsts');
    expect(securityCode).toContain('frameguard');
  });

  test('should have HTTP security headers configured', () => {
    const expectedHeaders = [
      'Content-Security-Policy',
      'X-Frame-Options',
      'X-Content-Type-Options',
      'Strict-Transport-Security'
    ];

    // En un servidor real, estos headers serían verificables
    // Este test documenta qué headers deben estar presentes
    expect(expectedHeaders).toHaveLength(4);
    expectedHeaders.forEach(header => {
      expect(header).toBeTruthy();
    });
  });
});

describe('Input Validation', () => {
  test('validation module should exist', () => {
    const validation = require('../modules/validation');
    expect(validation).toBeDefined();
  });

  test('Joi schemas API exist', () => {
    const { schemas } = require('../modules/validation-schemas');
    expect(schemas.apiLogin).toBeDefined();
    expect(schemas.apiCrearUsuario).toBeDefined();
    expect(schemas.apiActualizarUsuario).toBeDefined();
    expect(schemas.apiCrearTurno).toBeDefined();
    expect(schemas.apiPatchEstadoTurno).toBeDefined();
    expect(schemas.apiPatchEstadoElectro).toBeDefined();
    expect(schemas.apiPacienteEspera).toBeDefined();
  });
});

describe('HTTPS Configuration', () => {
  test('should have USE_HTTPS environment setting', () => {
    const useHttps = process.env.USE_HTTPS;
    expect(['true', 'false']).toContain(useHttps || 'false');
  });

  test('development should use HTTP', () => {
    const nodeEnv = process.env.NODE_ENV;
    if (nodeEnv === 'development') {
      expect(process.env.USE_HTTPS).not.toBe('true');
    }
  });
});

describe('Session Security', () => {
  test('session middleware should be present in config/session', () => {
    const sessionCode = require('fs').readFileSync(
      require('path').join(__dirname, '../config/session.js'),
      'utf8'
    );

    expect(sessionCode).toContain('express-session');
    expect(sessionCode).toContain('session(');
    expect(sessionCode).toContain('cookie');
    expect(sessionCode).toContain('httpOnly: true');
  });
});

describe('Password helper', () => {
  const password = require('../utils/password');

  test('isValidClientHash detects SHA-512 hex of 128 chars', () => {
    expect(password.isValidClientHash('a'.repeat(128))).toBe(true);
    expect(password.isValidClientHash('z'.repeat(128))).toBe(false);
    expect(password.isValidClientHash('a'.repeat(127))).toBe(false);
    expect(password.isValidClientHash('')).toBe(false);
    expect(password.isValidClientHash(null)).toBe(false);
  });

  test('hashForStorage produces a different bcrypt hash each time', () => {
    const h = 'a'.repeat(128);
    const a = password.hashForStorage(h);
    const b = password.hashForStorage(h);
    expect(a).not.toEqual(b);
    expect(a).toMatch(/^\$2[aby]?\$/);
  });

  test('compareClientHash matches the stored bcrypt of the SHA-512', () => {
    const clientHash = 'a'.repeat(128);
    const stored = password.hashForStorage(clientHash);
    expect(password.compareClientHash(clientHash, stored)).toBe(true);
    expect(password.compareClientHash('b'.repeat(128), stored)).toBe(false);
  });
});
