'use strict';

const {
  inferModulo,
  shouldSkipPath,
  isSuccessJson,
  shouldBroadcast
} = require('../utils/realtime-mutation-broadcast');

describe('realtime-mutation-broadcast', () => {
  test('infiere módulo según la ruta', () => {
    expect(inferModulo('/turnos/12/estado')).toBe('agenda-medica');
    expect(inferModulo('/citas-electro/9')).toBe('electro');
    expect(inferModulo('/recibos')).toBe('recibos');
    expect(inferModulo('/soportes/pdx/carpetas')).toBe('reportes-pdx');
    expect(inferModulo('/soportes/armado/periodos')).toBe('armado-soportes');
    expect(inferModulo('/anexo-fidu/archivos')).toBe('anexo-fidu');
    expect(inferModulo('/usuarios/3')).toBe('usuarios');
    expect(inferModulo('/admin/datos/entidades')).toBe('gestion-datos');
  });

  test('omite poll, login, chat y descargas', () => {
    expect(shouldSkipPath('/eventos/poll')).toBe(true);
    expect(shouldSkipPath('/eventos/stream')).toBe(true);
    expect(shouldSkipPath('/eventos/push')).toBe(true);
    expect(shouldSkipPath('/login')).toBe(true);
    expect(shouldSkipPath('/chat/conversaciones')).toBe(true);
    expect(shouldSkipPath('/soportes/armado/zip/job')).toBe(true);
    expect(shouldSkipPath('/turnos/1/estado')).toBe(false);
  });

  test('no avisa si la respuesta es error', () => {
    expect(isSuccessJson(200, { ok: true })).toBe(true);
    expect(isSuccessJson(400, { error: 'x' })).toBe(false);
    expect(isSuccessJson(200, { ok: false })).toBe(false);
  });

  test('shouldBroadcast solo en mutaciones exitosas de datos', () => {
    const res = { statusCode: 200 };
    expect(shouldBroadcast(
      { method: 'PATCH', originalUrl: '/api/turnos/1/estado' },
      res,
      { ok: true }
    )).toBe(true);
    expect(shouldBroadcast(
      { method: 'GET', originalUrl: '/api/turnos?fecha=2026-08-21' },
      res,
      []
    )).toBe(false);
    expect(shouldBroadcast(
      { method: 'POST', originalUrl: '/api/eventos/push' },
      res,
      { ok: true }
    )).toBe(false);
  });
});
