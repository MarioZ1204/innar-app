'use strict';

const express = require('express');
const router = express.Router();
const db = require('../utils/db-mysql');
const logger = require('../utils/logger');
const auditLog = require('../modules/audit-log');
const { requireAuth, requireRoleOrPerm, safeError, emitSocket } = require('../middleware/index');

// GET /api/estudios/lista - lista pública a todos los roles autenticados
router.get('/estudios/lista', requireAuth, async (req, res) => {
  try {
    const rows = await db.query('SELECT id, nombre FROM estudio_duraciones ORDER BY nombre ASC');
    res.json({ ok: true, registros: rows });
  } catch (e) {
    res.status(500).json({ error: safeError(e) });
  }
});

// GET /api/admin/datos/:tipo
router.get('/admin/datos/:tipo', requireAuth, requireRoleOrPerm(['superadmin', 'admin'], 'modulo.gestion_datos'), async (req, res) => {
  try {
    const tipo = req.params.tipo;
    const { q, fecha_desde, fecha_hasta, limit: reqLimit } = req.query;
    const limit = Math.min(parseInt(reqLimit) || 100, 500);
    let rows = [];

    if (tipo === 'citas_electro') {
      let where = 'WHERE (ce.deleted_at IS NULL OR ce.deleted_at IS NOT NULL)';
      const params = [];
      if (q) { where += ' AND (p.nombre LIKE ? OR p.documento LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
      if (fecha_desde) { where += ' AND ce.fecha >= ?'; params.push(fecha_desde); }
      if (fecha_hasta) { where += ' AND ce.fecha <= ?'; params.push(fecha_hasta); }
      rows = await db.query(`
        SELECT ce.id, p.nombre AS paciente_nombre, p.documento, ce.fecha,
               ce.hora_agendamiento AS hora, ce.estudio, ce.estado, ce.creado_en
        FROM citas_electro ce LEFT JOIN pacientes p ON p.id=ce.paciente_id
        ${where} ORDER BY ce.fecha DESC, ce.creado_en DESC LIMIT ${limit}`, params);
    } else if (tipo === 'turnos') {
      let where = 'WHERE 1=1';
      const params = [];
      if (q) { where += ' AND (t.paciente_nombre LIKE ? OR t.paciente_documento LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
      if (fecha_desde) { where += ' AND t.fecha >= ?'; params.push(fecha_desde); }
      if (fecha_hasta) { where += ' AND t.fecha <= ?'; params.push(fecha_hasta); }
      rows = await db.query(`
        SELECT t.id, t.paciente_nombre, t.paciente_documento AS documento,
               t.fecha, t.hora, t.tipo_consulta AS tipo, t.estado, t.creado_en
        FROM turnos t ${where} ORDER BY t.fecha DESC, t.creado_en DESC LIMIT ${limit}`, params);
    } else if (tipo === 'recibos') {
      let where = 'WHERE 1=1';
      const params = [];
      if (q) { where += ' AND (cliente LIKE ? OR numero LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
      if (fecha_desde) { where += ' AND fecha >= ?'; params.push(fecha_desde); }
      if (fecha_hasta) { where += ' AND fecha <= ?'; params.push(fecha_hasta); }
      rows = await db.query(`
        SELECT id, numero, cliente, fecha, total, tipo_pago, generado_por_nombre AS creado_por, creado_en
        FROM recibos ${where} ORDER BY id DESC LIMIT ${limit}`, params);
    } else if (tipo === 'estudio_duraciones') {
      rows = await db.query('SELECT id, nombre, duracion_minutos FROM estudio_duraciones ORDER BY nombre ASC');
    } else if (tipo === 'especialidades') {
      rows = await db.query('SELECT id, nombre, activo FROM especialidades ORDER BY nombre ASC');
    } else if (tipo === 'tipos_consulta') {
      rows = await db.query(`
        SELECT tc.id, tc.nombre, e.nombre AS especialidad, tc.activo
        FROM tipos_consulta tc LEFT JOIN especialidades e ON e.id=tc.especialidad_id
        ORDER BY e.nombre ASC, tc.nombre ASC`);
    } else if (tipo === 'diagnosticos') {
      let where = 'WHERE 1=1';
      const params = [];
      if (q) { where += ' AND nombre LIKE ?'; params.push(`%${q}%`); }
      rows = await db.query(`SELECT id, nombre, codigo, activo FROM diagnosticos ${where} ORDER BY nombre ASC LIMIT ${limit}`, params);
    } else if (tipo === 'entidades') {
      let where = 'WHERE 1=1';
      const params = [];
      if (q) { where += ' AND nombre LIKE ?'; params.push(`%${q}%`); }
      rows = await db.query(`SELECT id, nombre, activo FROM entidades ${where} ORDER BY nombre ASC LIMIT ${limit}`, params);
    } else {
      return res.status(400).json({ error: 'Tipo no válido' });
    }
    res.json({ ok: true, registros: rows });
  } catch (e) {
    logger.error('[ADMIN GET]', e.message);
    res.status(500).json({ error: safeError(e) });
  }
});

// POST /api/admin/datos/:tipo - crear registro en catálogos
router.post('/admin/datos/:tipo', requireAuth, requireRoleOrPerm(['superadmin', 'admin'], 'modulo.gestion_datos'), async (req, res) => {
  try {
    const tipo = req.params.tipo;
    const body = req.body || {};
    if (tipo === 'estudio_duraciones') {
      const { nombre, duracion_minutos } = body;
      if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
      const dur = parseInt(duracion_minutos, 10);
      if (isNaN(dur) || dur <= 0) return res.status(400).json({ error: 'La duracion debe ser un numero positivo' });
      const result = await db.execute(
        'INSERT INTO estudio_duraciones (nombre, duracion_minutos) VALUES (?,?)',
        [nombre.trim(), dur]
      );
      if (req.app.io) emitSocket('estudio:creado', { id: result.insertId });
      res.json({ ok: true, id: result.insertId });
    } else if (tipo === 'especialidades') {
      const { nombre } = body;
      if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
      const result = await db.execute('INSERT INTO especialidades (nombre) VALUES (?)', [nombre.trim()]);
      res.json({ ok: true, id: result.insertId });
    } else if (tipo === 'tipos_consulta') {
      const { especialidad_id, nombre } = body;
      if (!especialidad_id || !nombre || !nombre.trim())
        return res.status(400).json({ error: 'Especialidad y nombre son obligatorios' });
      const ordenRows = await db.query(
        'SELECT COALESCE(MAX(orden)+1, 0) AS sig FROM tipos_consulta WHERE especialidad_id=?',
        [especialidad_id]
      );
      const orden = ordenRows[0]?.sig ?? 0;
      const result = await db.execute(
        'INSERT INTO tipos_consulta (especialidad_id, nombre, orden) VALUES (?,?,?)',
        [especialidad_id, nombre.trim(), orden]
      );
      emitSocket('tipos-consulta:actualizado', { especialidad_id });
      res.json({ ok: true, id: result.insertId });
    } else if (tipo === 'diagnosticos') {
      const { nombre, descripcion, codigo } = body;
      if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
      const result = await db.execute(
        'INSERT INTO diagnosticos (nombre, descripcion, codigo, activo) VALUES (?,?,?,1)',
        [nombre.trim(), descripcion || null, codigo || null]
      );
      res.json({ ok: true, id: result.insertId });
    } else if (tipo === 'entidades') {
      const { nombre } = body;
      if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
      const result = await db.execute(
        'INSERT INTO entidades (nombre, activo) VALUES (?,1)',
        [nombre.trim().toUpperCase()]
      );
      res.json({ ok: true, id: result.insertId });
    } else {
      res.status(400).json({ error: 'Tipo no soportado para agregar' });
    }
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ya existe un registro con ese nombre' });
    res.status(500).json({ error: safeError(e) });
  }
});

// DELETE /api/admin/datos/:tipo/bulk - eliminar en bloque (hasta 50 registros)
// MUST be before /:tipo/:id
router.delete('/admin/datos/:tipo/bulk', requireAuth, requireRoleOrPerm(['superadmin', 'admin'], 'modulo.gestion_datos'), async (req, res) => {
  try {
    const tipo = req.params.tipo;
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids requerido' });
    if (ids.length > 50) return res.status(400).json({ error: 'Máximo 50 registros por vez' });
    const tablaMap = {
      citas_electro: 'citas_electro', turnos: 'turnos', recibos: 'recibos',
      estudio_duraciones: 'estudio_duraciones', especialidades: 'especialidades',
      tipos_consulta: 'tipos_consulta', diagnosticos: 'diagnosticos', entidades: 'entidades'
    };
    if (!tablaMap[tipo]) return res.status(400).json({ error: 'Tipo no válido' });
    const tabla = tablaMap[tipo];
    const placeholders = ids.map(() => '?').join(',');
    const result = await db.execute(`DELETE FROM ${tabla} WHERE id IN (${placeholders})`, ids);
    res.json({ ok: true, eliminados: result.affectedRows });
  } catch (e) {
    logger.error('[ADMIN BULK DELETE]', e.message);
    res.status(500).json({ error: safeError(e) });
  }
});

// DELETE /api/admin/datos/:tipo/:id
router.delete('/admin/datos/:tipo/:id', requireAuth, requireRoleOrPerm(['superadmin', 'admin'], 'modulo.gestion_datos'), async (req, res) => {
  try {
    const tipo = req.params.tipo;
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

    let affected = 0;
    if (tipo === 'citas_electro') {
      const result = await db.execute('DELETE FROM citas_electro WHERE id=?', [id]);
      affected = result.affectedRows;
      if (affected > 0 && req.app.io) emitSocket('electro:cita-eliminada', { id });
    } else if (tipo === 'turnos') {
      const result = await db.execute('DELETE FROM turnos WHERE id=?', [id]);
      affected = result.affectedRows;
    } else if (tipo === 'recibos') {
      const result = await db.execute('DELETE FROM recibos WHERE id=?', [id]);
      affected = result.affectedRows;
      if (affected > 0 && req.app.io) { emitSocket('recibo:eliminado', { id }); emitSocket('recibo:actualizar-lista'); }
    } else if (tipo === 'estudio_duraciones') {
      const result = await db.execute('DELETE FROM estudio_duraciones WHERE id=?', [id]);
      affected = result.affectedRows;
    } else if (tipo === 'especialidades') {
      const result = await db.execute('DELETE FROM especialidades WHERE id=?', [id]);
      affected = result.affectedRows;
    } else if (tipo === 'tipos_consulta') {
      const result = await db.execute('DELETE FROM tipos_consulta WHERE id=?', [id]);
      affected = result.affectedRows;
    } else if (tipo === 'diagnosticos') {
      const result = await db.execute('DELETE FROM diagnosticos WHERE id=?', [id]);
      affected = result.affectedRows;
    } else if (tipo === 'entidades') {
      const result = await db.execute('DELETE FROM entidades WHERE id=?', [id]);
      affected = result.affectedRows;
    } else {
      return res.status(400).json({ error: 'Tipo no válido' });
    }

    if (affected === 0) return res.status(404).json({ error: 'Registro no encontrado' });

    await auditLog.registrarAuditoria({
      usuarioId: req.session.usuarioId, adminId: req.session.usuarioId,
      adminUsuario: req.session.usuario, accion: 'ELIMINAR',
      cambios: { tipo, id }, ip: req.ip
    });

    res.json({ ok: true });
  } catch (e) {
    logger.error('[ADMIN DELETE]', e.message);
    res.status(500).json({ error: safeError(e) });
  }
});

module.exports = router;
