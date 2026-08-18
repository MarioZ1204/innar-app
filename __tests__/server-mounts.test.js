// __tests__/server-mounts.test.js
// Smoke test del bootstrap: server.js debe poder requerirse sin tocar DB
// (gracias al guard del pool y al deferral de initPool).

const path = require('path');

describe('server bootstrap (smoke)', () => {
  beforeAll(() => {
    process.env.NODE_ENV = 'test';
    process.env.SESSION_SECRET = 'test-secret';
    process.env.DB_HOST = 'localhost';
    process.env.DB_USER = 'root';
    process.env.DB_NAME = 'innar_clinica_test';
  });

  test('config/security exporta applySecurity', () => {
    const security = require('../config/security');
    expect(typeof security.applySecurity).toBe('function');
    expect(typeof security.csrfProtection).toBe('function');
  });

  test('config/session exporta applySession', () => {
    const session = require('../config/session');
    expect(typeof session.applySession).toBe('function');
  });

  test('config/static-files exporta applyStaticFiles', () => {
    const sf = require('../config/static-files');
    expect(typeof sf.applyStaticFiles).toBe('function');
  });

  test('config/rate-limit exporta applyRateLimiters', () => {
    const rl = require('../config/rate-limit');
    expect(typeof rl.applyRateLimiters).toBe('function');
  });

  test('migrations/runtime-migrations exporta runRuntimeMigrations', () => {
    const rm = require('../migrations/runtime-migrations');
    expect(typeof rm.runRuntimeMigrations).toBe('function');
    expect(Array.isArray(rm.runtimeMigrations)).toBe(true);
  });

  test('rt_backfill_historial_reprog_electro resuelve el util (no ReferenceError)', async () => {
    const { runtimeMigrations } = require('../migrations/runtime-migrations');
    const mig = runtimeMigrations.find((m) => m.name === 'rt_backfill_historial_reprog_electro');
    expect(mig).toBeTruthy();
    const db = {
      async query(sql) {
        const s = String(sql);
        if (s.includes('information_schema.TABLES')) return [{ cnt: 1 }];
        if (s.includes('SHOW TABLES')) return [{}];
        if (s.includes('FROM citas_electro')) return [];
        return [];
      },
      async execute() {
        return { affectedRows: 0 };
      }
    };
    await expect(mig.run(db)).resolves.toBeUndefined();
  });

  test('socket/handlers exporta attachSockets (stub sin Socket.IO)', () => {
    const s = require('../socket/handlers');
    expect(typeof s.attachSockets).toBe('function');
  });

  test('utils/event-poll-queue exporta broadcast', () => {
    const q = require('../utils/event-poll-queue');
    expect(typeof q.broadcast).toBe('function');
    expect(typeof q.flushUser).toBe('function');
  });
});
