// audit-log.js - Módulo para registrar auditorías de usuarios
const db = require('./db-mysql');

/**
 * Registrar cambio en auditoría
 * @param {Object} options - { usuarioId, adminId, adminUsuario, accion, cambios, ip }
 */
async function registrarAuditoria(options) {
  const { usuarioId, adminId, adminUsuario, accion, cambios, ip } = options;

  try {
    await db.execute(
      `INSERT INTO usuario_auditorias (usuario_id, usuario_admin, admin_id, accion, cambios, ip_address)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        usuarioId,
        adminUsuario || 'sistema',
        adminId || null,
        accion,
        cambios ? JSON.stringify(cambios) : null,
        ip || null
      ]
    );

    console.log(`[AUDIT] ${accion.toUpperCase()} - Usuario: ${usuarioId}, Admin: ${adminUsuario}`);
  } catch (error) {
    console.error('[AUDIT ERROR]', error.message);
  }
}

/**
 * Obtener historial de auditoría de un usuario
 */
async function obtenerHistorial(usuarioId, limit = 50) {
  try {
    const historial = await db.query(
      `SELECT 
        id,
        usuario_admin,
        accion,
        cambios,
        ip_address,
        DATE_FORMAT(fecha_cambio, '%d/%m/%Y %H:%i:%s') as fecha
       FROM usuario_auditorias
       WHERE usuario_id = ?
       ORDER BY fecha_cambio DESC
       LIMIT ?`,
      [usuarioId, limit]
    );

    return historial;
  } catch (error) {
    console.error('[AUDIT QUERY ERROR]', error.message);
    return [];
  }
}

/**
 * Obtener historial global (todos los usuarios)
 */
async function obtenerHistorialGlobal(limit = 100) {
  try {
    const historial = await db.query(
      `SELECT 
        u.id as usuario_id,
        u.usuario,
        u.nombre,
        ua.id,
        ua.usuario_admin,
        ua.accion,
        ua.cambios,
        ua.ip_address,
        DATE_FORMAT(ua.fecha_cambio, '%d/%m/%Y %H:%i:%s') as fecha
       FROM usuario_auditorias ua
       JOIN usuarios u ON ua.usuario_id = u.id
       ORDER BY ua.fecha_cambio DESC
       LIMIT ?`,
      [limit]
    );

    return historial;
  } catch (error) {
    console.error('[AUDIT GLOBAL QUERY ERROR]', error.message);
    return [];
  }
}

/**
 * Generar objeto de cambios para auditoría
 */
function generarCambios(usuarioAntes, usuarioDespues) {
  const cambios = {};

  const campos = ['usuario', 'nombre', 'rol', 'numero_consultorio', 'activo'];

  campos.forEach(campo => {
    if (usuarioAntes[campo] !== usuarioDespues[campo]) {
      cambios[campo] = {
        antes: usuarioAntes[campo],
        despues: usuarioDespues[campo]
      };
    }
  });

  return Object.keys(cambios).length > 0 ? cambios : null;
}

module.exports = {
  registrarAuditoria,
  obtenerHistorial,
  obtenerHistorialGlobal,
  generarCambios
};
