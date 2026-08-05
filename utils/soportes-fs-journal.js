const crypto = require('crypto');
const db = require('./db-mysql');
const logger = require('./logger');

function nuevaOperacionId() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : crypto.randomBytes(16).toString('hex');
}

async function registrarMovimiento({
  operacionId,
  expedienteId = null,
  tipo,
  rutaAnterior = null,
  rutaNueva = null,
  detalle = null
}) {
  try {
    const result = await db.execute(
      `INSERT INTO sop_fs_journal
       (operacion_id, expediente_id, tipo, ruta_anterior, ruta_nueva, estado, detalle)
       VALUES (?,?,?,?,?,'preparado',?)`,
      [operacionId, expedienteId, tipo, rutaAnterior, rutaNueva, detalle]
    );
    return result.insertId || null;
  } catch (e) {
    logger.warn('[SOPORTES] No se pudo registrar journal FS:', e.message);
    return null;
  }
}

async function actualizarOperacion(operacionId, estado, detalle = null) {
  try {
    await db.execute(
      'UPDATE sop_fs_journal SET estado = ?, detalle = COALESCE(?, detalle) WHERE operacion_id = ?',
      [estado, detalle, operacionId]
    );
  } catch (e) {
    logger.warn('[SOPORTES] No se pudo actualizar journal FS:', e.message);
  }
}

module.exports = {
  nuevaOperacionId,
  registrarMovimiento,
  actualizarOperacion
};
