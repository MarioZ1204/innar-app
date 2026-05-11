// routes/pacientes.js
// Pacientes, especialidades, tipos de consulta, pacientes en espera
const express = require('express');
const router = express.Router();
const db = require('../utils/db-mysql');
const logger = require('../utils/logger');
const {
  requireAuth, requireRoleOrPerm,
  safeError, emitSocket
} = require('../middleware/index');
const { validateSchema } = require('../modules/validation-schemas');

// --- Pacientes ---

router.get('/pacientes', requireAuth, async (req, res) => {
  const { buscar, limit, offset } = req.query;
  const rawLimit = parseInt(limit, 10);
  const safeLimit = Math.max(1, Math.min(Number.isFinite(rawLimit) ? rawLimit : 100, 200));
  const rawOffset = parseInt(offset, 10);
  const safeOffset = Math.max(0, Number.isFinite(rawOffset) ? rawOffset : 0);
  const COLS = 'id, nombre, documento, telefono, telefono2, email, creado_en, actualizado_en';
  try {
    let pacientes;
    if (buscar) {
      pacientes = await db.query(`
        SELECT ${COLS} FROM pacientes
        WHERE nombre LIKE ? OR documento LIKE ?
        ORDER BY nombre ASC
        LIMIT ${safeLimit} OFFSET ${safeOffset}
      `, [`%${buscar}%`, `%${buscar}%`]);
    } else {
      pacientes = await db.query(
        `SELECT ${COLS} FROM pacientes ORDER BY nombre ASC LIMIT ${safeLimit} OFFSET ${safeOffset}`
      );
    }
    res.json(pacientes);
  } catch (e) {
    logger.error(e.message, { error: e });
    res.status(500).json({ error: safeError(e) });
  }
});

router.get('/pacientes/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  try {
    const rows = await db.query('SELECT * FROM pacientes WHERE id = ?', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Paciente no encontrado' });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: safeError(e) });
  }
});

router.patch('/pacientes/:id', requireAuth, requireRoleOrPerm(['superadmin', 'admin', 'admin_recepcion', 'recepcion', 'admin_electro', 'electro', 'tecnico_electro', 'auxiliar_recepcion'], ['agenda.editar', 'electro.editar']), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  const { nombre, documento, telefono, email } = req.body || {};
  if (!nombre && !documento && !telefono && !email) {
    return res.status(400).json({ error: 'Nada que actualizar' });
  }
  try {
    const pacs = await db.query('SELECT * FROM pacientes WHERE id = ?', [id]);
    const pac = pacs.length > 0 ? pacs[0] : null;
    if (!pac) return res.status(404).json({ error: 'Paciente no encontrado' });
    const updates = [];
    const params = [];
    if (nombre !== undefined) { updates.push('nombre = ?'); params.push(nombre); }
    if (documento !== undefined) { updates.push('documento = ?'); params.push(documento); }
    if (telefono !== undefined) { updates.push('telefono = ?'); params.push(telefono); }
    if (email !== undefined) { updates.push('email = ?'); params.push(email); }
    params.push(id);
    await db.execute(`UPDATE pacientes SET ${updates.join(', ')} WHERE id = ?`, params);
    res.json({ ok: true });
  } catch (e) {
    logger.error(e.message, { error: e });
    res.status(500).json({ error: safeError(e) });
  }
});

router.post('/pacientes', requireAuth, requireRoleOrPerm(['superadmin', 'admin', 'admin_recepcion', 'recepcion', 'auxiliar_recepcion', 'admin_electro', 'electro', 'tecnico_electro', 'doctor'], ['agenda.crear', 'electro.crear']), async (req, res) => {
  const { nombre, documento, telefono, telefono2, email } = req.body || {};
  if (!nombre) {
    return res.status(400).json({ error: 'Nombre es obligatorio' });
  }

  if (!/^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+$/.test(nombre)) {
    return res.status(400).json({ error: 'El nombre no puede contener números o caracteres especiales' });
  }

  if (documento && !/^\d+$/.test(documento)) {
    return res.status(400).json({ error: 'El documento solo puede contener números' });
  }

  if (telefono && !/^\d{10}$/.test(telefono)) {
    return res.status(400).json({ error: 'El teléfono debe tener exactamente 10 dígitos' });
  }

  if (telefono2 && !/^\d{10}$/.test(telefono2)) {
    return res.status(400).json({ error: 'El teléfono 2 debe tener exactamente 10 dígitos' });
  }

  try {
    const result = await db.execute(
      'INSERT INTO pacientes (nombre, documento, telefono, telefono2, email) VALUES (?, ?, ?, ?, ?)',
      [nombre, documento || null, telefono || null, telefono2 || null, email || null]
    );
    res.json({ ok: true, id: result.insertId });
  } catch (e) {
    logger.error(e.message, { error: e });
    res.status(500).json({ error: safeError(e) });
  }
});

// --- Especialidades ---

router.get('/especialidades', requireAuth, async (req, res) => {
  try {
    const rows = await db.query('SELECT id, nombre FROM especialidades WHERE activo=1 ORDER BY nombre ASC');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: safeError(e) }); }
});

router.post('/especialidades', requireAuth, requireRoleOrPerm(['superadmin', 'admin'], 'modulo.gestion_datos'), async (req, res) => {
  const { nombre } = req.body || {};
  if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
  try {
    const result = await db.execute('INSERT INTO especialidades (nombre) VALUES (?)', [nombre.trim()]);
    res.json({ ok: true, id: result.insertId });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ya existe una especialidad con ese nombre' });
    res.status(500).json({ error: safeError(e) });
  }
});

router.patch('/especialidades/:id', requireAuth, requireRoleOrPerm(['superadmin', 'admin'], 'modulo.gestion_datos'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { nombre } = req.body || {};
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
  try {
    await db.execute('UPDATE especialidades SET nombre=? WHERE id=?', [nombre.trim(), id]);
    res.json({ ok: true });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ya existe una especialidad con ese nombre' });
    res.status(500).json({ error: safeError(e) });
  }
});

router.delete('/especialidades/:id', requireAuth, requireRoleOrPerm(['superadmin', 'admin'], 'modulo.gestion_datos'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  try {
    await db.execute('DELETE FROM especialidades WHERE id=?', [id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: safeError(e) }); }
});

// --- Tipos de consulta ---

router.get('/tipos-consulta', requireAuth, async (req, res) => {
  const { especialidad_id, especialidad_nombre, medico_id } = req.query;
  try {
    if (medico_id) {
      const doc = await db.queryOne(
        "SELECT especialidad FROM usuarios WHERE id=? AND rol='doctor'",
        [parseInt(medico_id, 10)]
      );
      const espNombre = (doc?.especialidad || '').trim();
      if (espNombre) {
        const espRows = await db.query(
          'SELECT id FROM especialidades WHERE LOWER(TRIM(nombre))=LOWER(TRIM(?))',
          [espNombre]
        );
        if (espRows.length > 0) {
          const rows = await db.query(
            'SELECT id, nombre, orden FROM tipos_consulta WHERE especialidad_id=? AND activo=1 ORDER BY orden ASC, id ASC',
            [espRows[0].id]
          );
          return res.json(rows);
        }
      }
      const allRows = await db.query(
        'SELECT id, nombre, orden FROM tipos_consulta WHERE activo=1 ORDER BY orden ASC, id ASC'
      );
      return res.json(allRows);
    }
    let espId = especialidad_id ? parseInt(especialidad_id, 10) : null;
    if (!espId && especialidad_nombre) {
      const rows = await db.query(
        'SELECT id FROM especialidades WHERE LOWER(TRIM(nombre))=LOWER(TRIM(?))',
        [especialidad_nombre]
      );
      espId = rows.length > 0 ? rows[0].id : null;
    }
    if (!espId) {
      const rows = await db.query('SELECT id, nombre, orden FROM tipos_consulta WHERE activo=1 ORDER BY orden ASC, id ASC');
      return res.json(rows);
    }
    const rows = await db.query(
      'SELECT id, nombre, orden FROM tipos_consulta WHERE especialidad_id=? AND activo=1 ORDER BY orden ASC, id ASC',
      [espId]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: safeError(e) }); }
});

router.post('/tipos-consulta', requireAuth, requireRoleOrPerm(['superadmin', 'admin'], 'modulo.gestion_datos'), async (req, res) => {
  const { especialidad_id, nombre } = req.body || {};
  if (!especialidad_id || !nombre || !nombre.trim())
    return res.status(400).json({ error: 'Especialidad y nombre son obligatorios' });
  try {
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
  } catch (e) { res.status(500).json({ error: safeError(e) }); }
});

router.patch('/tipos-consulta/:id', requireAuth, requireRoleOrPerm(['superadmin', 'admin'], 'modulo.gestion_datos'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { nombre } = req.body || {};
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
  try {
    await db.execute('UPDATE tipos_consulta SET nombre=? WHERE id=?', [nombre.trim(), id]);
    emitSocket('tipos-consulta:actualizado', { id });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: safeError(e) }); }
});

router.delete('/tipos-consulta/:id', requireAuth, requireRoleOrPerm(['superadmin', 'admin'], 'modulo.gestion_datos'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  try {
    await db.execute('DELETE FROM tipos_consulta WHERE id=?', [id]);
    emitSocket('tipos-consulta:actualizado', { id });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: safeError(e) }); }
});

// --- Pacientes en espera ---

router.get('/pacientes-espera', requireAuth, async (req, res) => {
  try {
    const rows = await db.query(
      `SELECT * FROM pacientes_espera
       ORDER BY FIELD(prioridad,'ALTA','MEDIA','BAJA'), creado_en ASC`
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: safeError(e) });
  }
});

router.post('/pacientes-espera', requireAuth, validateSchema('apiPacienteEspera'), async (req, res) => {
  const { documento, nombres, apellidos, entidad, prioridad, ingresado_por, telefono1, telefono2, tipo_estudio } = req.body;
  try {
    const entidadesDB = await db.query('SELECT nombre FROM entidades WHERE activo=1');
    const entidadesValidas = entidadesDB.map(e => e.nombre.toUpperCase());
    if (!entidadesValidas.includes(entidad.toUpperCase())) {
      return res.status(400).json({ error: 'Entidad inválida' });
    }
    const result = await db.execute(
      'INSERT INTO pacientes_espera (documento, nombres, apellidos, entidad, prioridad, ingresado_por, telefono1, telefono2, tipo_estudio) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [documento, nombres, apellidos, entidad, prioridad, ingresado_por || null, telefono1 || null, telefono2 || null, tipo_estudio || null]
    );
    res.json({ ok: true, id: result.insertId });
  } catch (e) {
    logger.error(e.message, { error: e });
    res.status(500).json({ error: safeError(e) });
  }
});

router.delete(
  '/pacientes-espera/:id',
  requireAuth,
  requireRoleOrPerm(
    ['superadmin', 'admin', 'admin_recepcion', 'recepcion', 'admin_electro', 'electro', 'tecnico_electro'],
    'pacientes.eliminar_espera'
  ),
  async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'ID inválido' });
    try {
      await db.execute('DELETE FROM pacientes_espera WHERE id = ?', [id]);
      res.json({ ok: true });
    } catch (e) {
      logger.error(e.message, { error: e });
      res.status(500).json({ error: safeError(e) });
    }
  }
);

module.exports = router;
