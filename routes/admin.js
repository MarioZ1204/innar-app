'use strict';

const express = require('express');
const router = express.Router();
const db = require('../utils/db-mysql');
const logger = require('../utils/logger');
const auditLog = require('../modules/audit-log');
const { requireAuth, requireRoleOrPerm, safeError, emitSocket } = require('../middleware/index');
const { parseFlag } = require('../utils/catalogo-visibilidad');

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
      let where = 'WHERE ce.deleted_at IS NULL';
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
      rows = await db.query(`SELECT id, nombre, duracion_minutos FROM estudio_duraciones ORDER BY nombre ASC LIMIT ${limit}`);
    } else if (tipo === 'especialidades') {
      rows = await db.query(`SELECT id, nombre, activo FROM especialidades ORDER BY nombre ASC LIMIT ${limit}`);
    } else if (tipo === 'tipos_consulta') {
      rows = await db.query(`
        SELECT tc.id, tc.nombre, e.nombre AS especialidad, tc.activo,
               COALESCE(tc.permite_sesiones_multiples, 0) AS permite_sesiones_multiples,
               COALESCE(tc.visible_agenda, 1) AS visible_agenda,
               COALESCE(tc.visible_comprobante, 1) AS visible_comprobante,
               COALESCE(tc.visible_recibo, 1) AS visible_recibo
        FROM tipos_consulta tc LEFT JOIN especialidades e ON e.id=tc.especialidad_id
        ORDER BY e.nombre ASC, tc.nombre ASC LIMIT ${limit}`);
    } else if (tipo === 'diagnosticos') {
      let where = 'WHERE 1=1';
      const params = [];
      if (q) { where += ' AND nombre LIKE ?'; params.push(`%${q}%`); }
      rows = await db.query(`SELECT id, nombre, codigo, activo FROM diagnosticos ${where} ORDER BY nombre ASC LIMIT ${limit}`, params);
    } else if (tipo === 'entidades') {
      let where = 'WHERE 1=1';
      const params = [];
      if (q) { where += ' AND nombre LIKE ?'; params.push(`%${q}%`); }
      rows = await db.query(
        `SELECT id, nombre, activo,
                COALESCE(visible_agenda, 1) AS visible_agenda,
                COALESCE(visible_electro, 1) AS visible_electro,
                COALESCE(visible_recibo, 1) AS visible_recibo
         FROM entidades ${where} ORDER BY nombre ASC LIMIT ${limit}`,
        params
      );
    } else if (tipo === 'anexo_fidu_servicios') {
      let where = 'WHERE activo = 1';
      const params = [];
      if (q) {
        where += ' AND (codigo LIKE ? OR nombre LIKE ?)';
        params.push(`%${q}%`, `%${q}%`);
      }
      rows = await db.query(
        `SELECT id, codigo, nombre, valor_unitario, cantidad, valor_total, codigo_servicio_referencia
         FROM anexo_fidu_servicios ${where} ORDER BY codigo ASC LIMIT ${limit}`,
        params
      );
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
      emitSocket('estudio:creado', { id: result.insertId });
      res.json({ ok: true, id: result.insertId });
    } else if (tipo === 'especialidades') {
      const { nombre } = body;
      if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
      const result = await db.execute('INSERT INTO especialidades (nombre) VALUES (?)', [nombre.trim()]);
      res.json({ ok: true, id: result.insertId });
    } else if (tipo === 'tipos_consulta') {
      const { especialidad_id, nombre, permite_sesiones_multiples } = body;
      if (!especialidad_id || !nombre || !nombre.trim())
        return res.status(400).json({ error: 'Especialidad y nombre son obligatorios' });
      const ordenRows = await db.query(
        'SELECT COALESCE(MAX(orden)+1, 0) AS sig FROM tipos_consulta WHERE especialidad_id=?',
        [especialidad_id]
      );
      const orden = ordenRows[0]?.sig ?? 0;
      const flagSesiones = parseFlag(permite_sesiones_multiples, 0);
      const result = await db.execute(
        `INSERT INTO tipos_consulta
          (especialidad_id, nombre, orden, permite_sesiones_multiples,
           visible_agenda, visible_comprobante, visible_recibo)
         VALUES (?,?,?,?,?,?,?)`,
        [
          especialidad_id,
          nombre.trim(),
          orden,
          flagSesiones,
          parseFlag(body.visible_agenda, 1),
          parseFlag(body.visible_comprobante, 1),
          parseFlag(body.visible_recibo, 1)
        ]
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
        `INSERT INTO entidades
          (nombre, activo, visible_agenda, visible_electro, visible_recibo)
         VALUES (?,1,?,?,?)`,
        [
          nombre.trim().toUpperCase(),
          parseFlag(body.visible_agenda, 1),
          parseFlag(body.visible_electro, 1),
          parseFlag(body.visible_recibo, 1)
        ]
      );
      emitSocket('entidades:actualizado', { id: result.insertId });
      res.json({ ok: true, id: result.insertId });
    } else if (tipo === 'anexo_fidu_servicios') {
      const { normCodigoAlmacen } = require('../utils/anexo-fidu-catalogo');
      const codigo = normCodigoAlmacen(body.codigo);
      const nombre = String(body.nombre || '').trim();
      const valorUnitario = parseInt(body.valor_unitario, 10);
      const codigoRef = String(body.codigo_servicio_referencia || '').trim();
      if (!codigo) return res.status(400).json({ error: 'El código CUPS es obligatorio' });
      if (!nombre) return res.status(400).json({ error: 'El nombre del servicio es obligatorio' });
      if (!(valorUnitario >= 0)) return res.status(400).json({ error: 'Valor unitario inválido' });
      if (!codigoRef) return res.status(400).json({ error: 'Código servicio referencia (RIPS) es obligatorio' });
      const cantidad = body.cantidad != null ? String(body.cantidad).trim() : '1';
      const valorTotal = parseInt(body.valor_total, 10);
      const result = await db.execute(
        `INSERT INTO anexo_fidu_servicios
          (codigo, nombre, valor_unitario, cantidad, valor_total, codigo_servicio_referencia, activo)
         VALUES (?,?,?,?,?,?,1)`,
        [
          codigo,
          nombre,
          valorUnitario,
          cantidad,
          Number.isFinite(valorTotal) && valorTotal >= 0 ? valorTotal : valorUnitario,
          codigoRef
        ]
      );
      await refrescarCatalogoCupsAnexo();
      res.json({ ok: true, id: result.insertId });
    } else {
      res.status(400).json({ error: 'Tipo no soportado para agregar' });
    }
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Ya existe un registro con ese código o nombre' });
    }
    res.status(500).json({ error: safeError(e) });
  }
});

async function refrescarCatalogoCupsAnexo() {
  const { invalidarCatalogoAnexoFidu, recargarCatalogoAnexoFidu } = require('../utils/anexo-fidu-servicios');
  invalidarCatalogoAnexoFidu();
  emitSocket('anexo-fidu:servicios-actualizado', {});
  recargarCatalogoAnexoFidu().catch((err) => {
    logger.warn('[ADMIN CUPS] recarga catálogo en background:', err.message);
  });
}

// PATCH /api/admin/datos/:tipo/:id — editar catálogos
router.patch('/admin/datos/:tipo/:id', requireAuth, requireRoleOrPerm(['superadmin', 'admin'], 'modulo.gestion_datos'), async (req, res) => {
  try {
    const tipo = req.params.tipo;
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
    const body = req.body || {};

    if (tipo === 'tipos_consulta') {
      const campos = [];
      const values = [];
      if (body.nombre !== undefined) {
        const nombre = String(body.nombre || '').trim();
        if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });
        campos.push('nombre=?');
        values.push(nombre);
      }
      if (body.permite_sesiones_multiples !== undefined) {
        campos.push('permite_sesiones_multiples=?');
        values.push(parseFlag(body.permite_sesiones_multiples, 0));
      }
      for (const f of ['visible_agenda', 'visible_comprobante', 'visible_recibo']) {
        if (body[f] !== undefined) {
          campos.push(`${f}=?`);
          values.push(parseFlag(body[f], 1));
        }
      }
      if (!campos.length) return res.status(400).json({ error: 'No hay campos para actualizar' });
      values.push(id);
      const result = await db.execute(
        `UPDATE tipos_consulta SET ${campos.join(', ')} WHERE id=?`,
        values
      );
      if (!result.affectedRows) return res.status(404).json({ error: 'Tipo de consulta no encontrado' });
      emitSocket('tipos-consulta:actualizado', { id });
      return res.json({ ok: true, id });
    }

    if (tipo === 'entidades') {
      const campos = [];
      const values = [];
      if (body.nombre !== undefined) {
        const nombre = String(body.nombre || '').trim().toUpperCase();
        if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });
        campos.push('nombre=?');
        values.push(nombre);
      }
      for (const f of ['visible_agenda', 'visible_electro', 'visible_recibo', 'activo']) {
        if (body[f] !== undefined) {
          campos.push(`${f}=?`);
          values.push(parseFlag(body[f], 1));
        }
      }
      if (!campos.length) return res.status(400).json({ error: 'No hay campos para actualizar' });
      values.push(id);
      const result = await db.execute(
        `UPDATE entidades SET ${campos.join(', ')} WHERE id=?`,
        values
      );
      if (!result.affectedRows) return res.status(404).json({ error: 'Entidad no encontrada' });
      emitSocket('entidades:actualizado', { id });
      return res.json({ ok: true, id });
    }

    if (tipo === 'anexo_fidu_servicios') {
      const { normCodigoAlmacen } = require('../utils/anexo-fidu-catalogo');
      const codigo = normCodigoAlmacen(body.codigo);
      const nombre = String(body.nombre || '').trim();
      const valorUnitario = parseInt(body.valor_unitario, 10);
      const codigoRef = String(body.codigo_servicio_referencia || '').trim();
      if (!codigo) return res.status(400).json({ error: 'El código CUPS es obligatorio' });
      if (!nombre) return res.status(400).json({ error: 'El nombre del servicio es obligatorio' });
      if (!(valorUnitario >= 0)) return res.status(400).json({ error: 'Valor unitario inválido' });
      if (!codigoRef) return res.status(400).json({ error: 'Código servicio referencia (RIPS) es obligatorio' });
      const cantidad = body.cantidad != null ? String(body.cantidad).trim() : '1';
      const valorTotal = parseInt(body.valor_total, 10);
      const result = await db.execute(
        `UPDATE anexo_fidu_servicios SET
          codigo = ?, nombre = ?, valor_unitario = ?, cantidad = ?,
          valor_total = ?, codigo_servicio_referencia = ?
         WHERE id = ? AND activo = 1`,
        [
          codigo,
          nombre,
          valorUnitario,
          cantidad,
          Number.isFinite(valorTotal) && valorTotal >= 0 ? valorTotal : valorUnitario,
          codigoRef,
          id
        ]
      );
      if (!result.affectedRows) return res.status(404).json({ error: 'Servicio CUPS no encontrado' });
      await refrescarCatalogoCupsAnexo();
      return res.json({ ok: true, id });
    }

    return res.status(400).json({ error: 'Tipo no soportado para editar' });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Ya existe otro servicio con ese código CUPS' });
    }
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
      tipos_consulta: 'tipos_consulta', diagnosticos: 'diagnosticos', entidades: 'entidades',
      anexo_fidu_servicios: 'anexo_fidu_servicios'
    };
    if (!tablaMap[tipo]) return res.status(400).json({ error: 'Tipo no válido' });
    const tabla = tablaMap[tipo];
    const placeholders = ids.map(() => '?').join(',');
    const result = await db.execute(`DELETE FROM ${tabla} WHERE id IN (${placeholders})`, ids);
    if (tipo === 'anexo_fidu_servicios' && result.affectedRows > 0) {
      await refrescarCatalogoCupsAnexo();
    }
    if (tipo === 'tipos_consulta' && result.affectedRows > 0) {
      emitSocket('tipos-consulta:actualizado', { ids });
    }
    if (tipo === 'entidades' && result.affectedRows > 0) {
      emitSocket('entidades:actualizado', { ids });
    }
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
      if (affected > 0) emitSocket('electro:cita-eliminada', { id });
    } else if (tipo === 'turnos') {
      const result = await db.execute('DELETE FROM turnos WHERE id=?', [id]);
      affected = result.affectedRows;
    } else if (tipo === 'recibos') {
      const result = await db.execute('DELETE FROM recibos WHERE id=?', [id]);
      affected = result.affectedRows;
      if (affected > 0) { emitSocket('recibo:eliminado', { id }); emitSocket('recibo:actualizar-lista'); }
    } else if (tipo === 'estudio_duraciones') {
      const result = await db.execute('DELETE FROM estudio_duraciones WHERE id=?', [id]);
      affected = result.affectedRows;
    } else if (tipo === 'especialidades') {
      const result = await db.execute('DELETE FROM especialidades WHERE id=?', [id]);
      affected = result.affectedRows;
    } else if (tipo === 'tipos_consulta') {
      const result = await db.execute('DELETE FROM tipos_consulta WHERE id=?', [id]);
      affected = result.affectedRows;
      if (affected > 0) emitSocket('tipos-consulta:actualizado', { id });
    } else if (tipo === 'diagnosticos') {
      const result = await db.execute('DELETE FROM diagnosticos WHERE id=?', [id]);
      affected = result.affectedRows;
    } else if (tipo === 'entidades') {
      const result = await db.execute('DELETE FROM entidades WHERE id=?', [id]);
      affected = result.affectedRows;
      if (affected > 0) emitSocket('entidades:actualizado', { id });
    } else if (tipo === 'anexo_fidu_servicios') {
      const result = await db.execute('DELETE FROM anexo_fidu_servicios WHERE id=?', [id]);
      affected = result.affectedRows;
      if (affected > 0) await refrescarCatalogoCupsAnexo();
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
