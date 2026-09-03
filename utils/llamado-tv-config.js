'use strict';

/**
 * Configuración compartida del módulo Llamado (TV):
 * - consultorios/doctores activos en pantalla
 * - número de consultorio efectivo por jornada (día en Colombia)
 */
const { hoyColombiaISO, ymdCalendarioColombia } = require('./fecha-colombia');

function parseDoctorIdsJson(raw) {
  if (Array.isArray(raw)) {
    return raw.map((n) => parseInt(n, 10)).filter((n) => Number.isFinite(n) && n > 0);
  }
  if (typeof raw === 'string') {
    try {
      return parseDoctorIdsJson(JSON.parse(raw));
    } catch (_) {
      return [];
    }
  }
  if (raw && typeof raw === 'object') {
    // mysql2 a veces entrega JSON ya parseado como objeto
    return parseDoctorIdsJson(Object.values(raw));
  }
  return [];
}

async function listarDoctorIdsActivosBd(db) {
  const rows = await db.query(
    `SELECT id FROM usuarios WHERE rol = 'doctor' AND activo = 1 ORDER BY id ASC`
  );
  return (rows || []).map((r) => Number(r.id)).filter(Boolean);
}

async function ensureTvEstadoRow(db) {
  await db.execute(
    `INSERT IGNORE INTO llamado_tv_estado (id, doctor_ids_json, configurado)
     VALUES (1, JSON_ARRAY(), 0)`
  );
}

/**
 * Carga IDs de doctores activos en TV. Si nunca se configuró, activa a todos.
 */
async function getConsultoriosActivos(db) {
  await ensureTvEstadoRow(db);
  const row = await db.queryOne(
    'SELECT doctor_ids_json, configurado FROM llamado_tv_estado WHERE id = 1'
  );
  if (!row || !Number(row.configurado)) {
    const ids = await listarDoctorIdsActivosBd(db);
    await setConsultoriosActivos(db, ids, null, { seed: true });
    return ids;
  }
  return parseDoctorIdsJson(row.doctor_ids_json);
}

async function setConsultoriosActivos(db, doctorIds, usuarioId, opts = {}) {
  const ids = [...new Set(
    (Array.isArray(doctorIds) ? doctorIds : [])
      .map((n) => parseInt(n, 10))
      .filter((n) => Number.isFinite(n) && n > 0)
  )];
  await ensureTvEstadoRow(db);
  await db.execute(
    `UPDATE llamado_tv_estado
     SET doctor_ids_json = ?, configurado = 1, actualizado_en = NOW(), actualizado_por = ?
     WHERE id = 1`,
    [JSON.stringify(ids), usuarioId || null]
  );
  return { doctor_ids: ids, seeded: !!opts.seed };
}

/**
 * Mapa doctor_id → número para una fecha (YYYY-MM-DD).
 */
async function getConsultoriosJornadaMap(db, fechaYmd) {
  const fecha = ymdCalendarioColombia(fechaYmd) || hoyColombiaISO();
  const rows = await db.query(
    `SELECT doctor_id, numero_consultorio
     FROM llamado_consultorio_jornada
     WHERE fecha = ?`,
    [fecha]
  );
  const map = {};
  for (const r of rows || []) {
    const id = Number(r.doctor_id);
    const num = parseInt(r.numero_consultorio, 10);
    if (id && Number.isFinite(num) && num > 0) map[id] = num;
  }
  return { fecha, map };
}

async function setConsultorioJornada(db, doctorId, numero, fechaYmd, usuarioId) {
  const id = parseInt(doctorId, 10);
  const num = parseInt(numero, 10);
  const fecha = ymdCalendarioColombia(fechaYmd) || hoyColombiaISO();
  if (!id || !Number.isFinite(num) || num < 1) {
    return { error: 'Indique doctor y número de consultorio válido (≥ 1)', status: 400 };
  }
  const doc = await db.queryOne(
    `SELECT id FROM usuarios WHERE id = ? AND rol = 'doctor' AND activo = 1`,
    [id]
  );
  if (!doc) return { error: 'Médico no encontrado', status: 404 };

  await db.execute(
    `INSERT INTO llamado_consultorio_jornada
       (doctor_id, fecha, numero_consultorio, actualizado_por)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       numero_consultorio = VALUES(numero_consultorio),
       actualizado_por = VALUES(actualizado_por),
       actualizado_en = CURRENT_TIMESTAMP`,
    [id, fecha, num, usuarioId || null]
  );
  return { ok: true, doctor_id: id, fecha, numero_consultorio: num };
}

async function clearConsultorioJornada(db, doctorId, fechaYmd) {
  const id = parseInt(doctorId, 10);
  const fecha = ymdCalendarioColombia(fechaYmd) || hoyColombiaISO();
  if (!id) return { error: 'doctor_id inválido', status: 400 };
  await db.execute(
    'DELETE FROM llamado_consultorio_jornada WHERE doctor_id = ? AND fecha = ?',
    [id, fecha]
  );
  return { ok: true, doctor_id: id, fecha };
}

/**
 * Número anunciado: override de la jornada del turno (o hoy) → permanente del usuario.
 */
async function resolverNumeroConsultorioDoctor(db, doctorId, fechaTurno, numeroBase) {
  const id = parseInt(doctorId, 10);
  let base = numeroBase;
  if (base == null || base === '') {
    const row = await db.queryOne(
      'SELECT numero_consultorio FROM usuarios WHERE id = ?',
      [id]
    );
    base = row?.numero_consultorio ?? null;
  }
  if (!id) return base;
  const fecha = ymdCalendarioColombia(fechaTurno) || hoyColombiaISO();
  const ov = await db.queryOne(
    `SELECT numero_consultorio FROM llamado_consultorio_jornada
     WHERE doctor_id = ? AND fecha = ? LIMIT 1`,
    [id, fecha]
  );
  if (ov?.numero_consultorio != null) return ov.numero_consultorio;
  return base;
}

async function getTvConfigPayload(db) {
  const fecha = hoyColombiaISO();
  const doctor_ids = await getConsultoriosActivos(db);
  const { map } = await getConsultoriosJornadaMap(db, fecha);
  return {
    fecha,
    doctor_ids,
    consultorios_jornada: map
  };
}

module.exports = {
  parseDoctorIdsJson,
  getConsultoriosActivos,
  setConsultoriosActivos,
  getConsultoriosJornadaMap,
  setConsultorioJornada,
  clearConsultorioJornada,
  resolverNumeroConsultorioDoctor,
  getTvConfigPayload,
  hoyColombiaISO
};
