'use strict';

const {
  SQL_LOCK_CUPOS_DIA,
  SQL_LOCK_TURNOS_DIA,
  SQL_LOCK_EQUIPO,
  SQL_LOCK_EQUIPOS_ACTIVOS,
  httpError,
  isHttpError,
  responderSiHttpError,
  throwIfCupoInvalido,
  ymdLock,
  ordenarParesDoctorFecha,
  bloquearAgendaDiaParaCupo,
  bloquearAgendaDiasParaCupo,
  bloquearEquiposElectro
} = require('../utils/locks-concurrencia');

describe('locks-concurrencia SQL', () => {
  test('los SELECT de cupo, turnos y equipos llevan FOR UPDATE', () => {
    expect(SQL_LOCK_CUPOS_DIA).toMatch(/FOR UPDATE\s*$/);
    expect(SQL_LOCK_TURNOS_DIA).toMatch(/FOR UPDATE\s*$/);
    expect(SQL_LOCK_EQUIPO).toMatch(/FOR UPDATE\s*$/);
    expect(SQL_LOCK_EQUIPOS_ACTIVOS).toMatch(/FOR UPDATE\s*$/);
    expect(SQL_LOCK_TURNOS_DIA).toMatch(/FROM turnos/);
    expect(SQL_LOCK_CUPOS_DIA).toMatch(/FROM doctor_cupos_entidad_dia/);
  });

  test('no añade UNIQUE de hora: varios pacientes en el mismo slot siguen permitidos', () => {
    expect(SQL_LOCK_TURNOS_DIA).not.toMatch(/UNIQUE|hora\s*=/i);
  });
});

describe('httpError / throwIfCupoInvalido', () => {
  test('httpError marca status y isHttpError lo reconoce', () => {
    const err = httpError(409, 'ocupado', { valido: false });
    expect(isHttpError(err)).toBe(true);
    expect(err.status).toBe(409);
    expect(err.body.valido).toBe(false);
    expect(isHttpError(new Error('x'))).toBe(false);
  });

  test('throwIfCupoInvalido no lanza si valido', () => {
    expect(() => throwIfCupoInvalido({ valido: true })).not.toThrow();
  });

  test('throwIfCupoInvalido usa 409 si requiere confirmación', () => {
    try {
      throwIfCupoInvalido({ valido: false, requiereConfirmacion: true, razon: '¿forzar?' });
      throw new Error('debía lanzar');
    } catch (e) {
      expect(e.status).toBe(409);
      expect(e.message).toBe('¿forzar?');
      expect(e.body.requiere_confirmacion).toBe(true);
    }
  });

  test('throwIfCupoInvalido usa 400 si el cupo propio está lleno', () => {
    try {
      throwIfCupoInvalido({ valido: false, razon: 'Sin cupos' });
      throw new Error('debía lanzar');
    } catch (e) {
      expect(e.status).toBe(400);
    }
  });

  test('responderSiHttpError escribe JSON y no trata 500 genérico', () => {
    const res = {
      statusCode: null,
      payload: null,
      status(c) { this.statusCode = c; return this; },
      json(b) { this.payload = b; return this; }
    };
    expect(responderSiHttpError(res, new Error('boom'))).toBe(false);
    expect(responderSiHttpError(res, httpError(409, 'Ya existe', { valido: false }))).toBe(true);
    expect(res.statusCode).toBe(409);
    expect(res.payload).toEqual({ error: 'Ya existe', valido: false });
  });
});

describe('ordenar y bloquear', () => {
  test('ymdLock recorta DATE/string', () => {
    expect(ymdLock('2026-08-18 10:00:00')).toBe('2026-08-18');
    expect(ymdLock(new Date(2026, 7, 18, 15, 0, 0))).toBe('2026-08-18');
  });

  test('ordenarParesDoctorFecha evita deadlocks (doctor, fecha asc)', () => {
    const ordered = ordenarParesDoctorFecha([
      { doctorId: 9, fecha: '2026-08-20' },
      { doctorId: 2, fecha: '2026-08-19' },
      { doctorId: 2, fecha: '2026-08-19' }
    ]);
    expect(ordered.map((p) => p.key)).toEqual([
      '0000000002|2026-08-19',
      '0000000009|2026-08-20'
    ]);
  });

  test('bloquearAgendaDiaParaCupo traba cupos y luego turnos', async () => {
    const sqls = [];
    const conn = {
      query: async (sql, params) => {
        sqls.push({ sql, params });
        return [];
      }
    };
    await bloquearAgendaDiaParaCupo(conn, 7, '2026-08-18');
    expect(sqls[0].sql).toBe(SQL_LOCK_CUPOS_DIA);
    expect(sqls[0].params).toEqual([7, '2026-08-18']);
    expect(sqls[1].sql).toBe(SQL_LOCK_TURNOS_DIA);
    expect(sqls[1].params).toEqual(['2026-08-18', 7]);
  });

  test('bloquearAgendaDiasParaCupo aplica el orden estable', async () => {
    const sqls = [];
    const conn = { query: async (sql, params) => { sqls.push(params); return []; } };
    await bloquearAgendaDiasParaCupo(conn, [
      { doctorId: 5, fecha: '2026-08-21' },
      { doctorId: 4, fecha: '2026-08-20' }
    ]);
    const cupoLocks = sqls.filter((p) => p[0] === 4 || p[0] === 5);
    expect(cupoLocks[0]).toEqual([4, '2026-08-20']);
    expect(cupoLocks[1]).toEqual([5, '2026-08-21']);
  });

  test('bloquearEquiposElectro: un id vs todos los activos', async () => {
    const sqls = [];
    const conn = { query: async (sql, params) => { sqls.push({ sql, params }); return []; } };
    await bloquearEquiposElectro(conn, 3);
    await bloquearEquiposElectro(conn, null);
    expect(sqls[0].sql).toBe(SQL_LOCK_EQUIPO);
    expect(sqls[0].params).toEqual([3]);
    expect(sqls[1].sql).toBe(SQL_LOCK_EQUIPOS_ACTIVOS);
  });
});
