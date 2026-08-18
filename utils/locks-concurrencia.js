/**
 * Candados InnoDB (SELECT … FOR UPDATE) para cupos/números/equipos.
 * No impone UNIQUE de (doctor, fecha, hora): varios pacientes a la misma hora es válido.
 *
 * `conn` debe ser el wrapper de db.transaction ({ query, execute } → filas / OkPacket).
 */
'use strict';

const SQL_LOCK_CUPOS_DIA =
  'SELECT id FROM doctor_cupos_entidad_dia WHERE doctor_id = ? AND fecha = ? FOR UPDATE';
const SQL_LOCK_TURNOS_DIA =
  'SELECT id FROM turnos WHERE fecha = ? AND doctor_id = ? FOR UPDATE';
const SQL_LOCK_EQUIPO =
  'SELECT id FROM equipos_electro WHERE id = ? FOR UPDATE';
const SQL_LOCK_EQUIPOS_ACTIVOS =
  'SELECT id FROM equipos_electro WHERE activo = 1 ORDER BY id ASC FOR UPDATE';

function httpError(status, message, body) {
  const err = new Error(message || 'Error');
  err.status = status;
  err.expose = true;
  if (body && typeof body === 'object') err.body = body;
  return err;
}

function isHttpError(err) {
  const status = err && err.status;
  return Number.isInteger(status) && status >= 400 && status < 600;
}

function responderSiHttpError(res, err) {
  if (!isHttpError(err)) return false;
  const body = { error: err.message, ...(err.body || {}) };
  res.status(err.status).json(body);
  return true;
}

function throwIfCupoInvalido(validacion) {
  if (!validacion || validacion.valido) return;
  throw httpError(
    validacion.requiereConfirmacion ? 409 : 400,
    validacion.razon || 'Sin cupo de entidad',
    {
      valido: false,
      requiere_confirmacion: !!validacion.requiereConfirmacion
    }
  );
}

function ymdLock(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'string') return v.slice(0, 10);
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const y = v.getFullYear();
    const mo = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${mo}-${d}`;
  }
  return String(v).slice(0, 10);
}

function parDoctorFecha(doctorId, fecha) {
  const id = parseInt(doctorId, 10) || 0;
  const f = ymdLock(fecha);
  return {
    doctorId: id,
    fecha: f,
    key: `${String(id).padStart(10, '0')}|${f}`
  };
}

function ordenarParesDoctorFecha(pares) {
  const uniq = new Map();
  for (const p of Array.isArray(pares) ? pares : []) {
    const c = parDoctorFecha(p.doctorId ?? p.doctor_id, p.fecha);
    if (c.doctorId && /^\d{4}-\d{2}-\d{2}$/.test(c.fecha)) uniq.set(c.key, c);
  }
  return [...uniq.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

async function bloquearCuposEntidadDia(conn, doctorId, fecha) {
  return conn.query(SQL_LOCK_CUPOS_DIA, [doctorId, ymdLock(fecha)]);
}

async function bloquearTurnosDoctorDia(conn, doctorId, fecha) {
  return conn.query(SQL_LOCK_TURNOS_DIA, [ymdLock(fecha), doctorId]);
}

/** Cupos del día primero, luego turnos (mismo orden siempre → menos deadlocks). */
async function bloquearAgendaDiaParaCupo(conn, doctorId, fecha) {
  await bloquearCuposEntidadDia(conn, doctorId, fecha);
  await bloquearTurnosDoctorDia(conn, doctorId, fecha);
}

async function bloquearAgendaDiasParaCupo(conn, pares) {
  const ordered = ordenarParesDoctorFecha(pares);
  for (const c of ordered) {
    await bloquearAgendaDiaParaCupo(conn, c.doctorId, c.fecha);
  }
  return ordered;
}

/**
 * Un equipo concreto, o todos los activos (inicio de estudio sin equipo asignado).
 */
async function bloquearEquiposElectro(conn, equipoId) {
  const eqId = equipoId != null && equipoId !== '' ? parseInt(equipoId, 10) : null;
  if (eqId && !Number.isNaN(eqId)) {
    return conn.query(SQL_LOCK_EQUIPO, [eqId]);
  }
  return conn.query(SQL_LOCK_EQUIPOS_ACTIVOS);
}

module.exports = {
  SQL_LOCK_CUPOS_DIA,
  SQL_LOCK_TURNOS_DIA,
  SQL_LOCK_EQUIPO,
  SQL_LOCK_EQUIPOS_ACTIVOS,
  httpError,
  isHttpError,
  responderSiHttpError,
  throwIfCupoInvalido,
  ymdLock,
  parDoctorFecha,
  ordenarParesDoctorFecha,
  bloquearCuposEntidadDia,
  bloquearTurnosDoctorDia,
  bloquearAgendaDiaParaCupo,
  bloquearAgendaDiasParaCupo,
  bloquearEquiposElectro
};
