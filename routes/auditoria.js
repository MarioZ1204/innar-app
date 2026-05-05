// routes/auditoria.js
const express = require('express');
const router = express.Router();
const db = require('../utils/db-mysql');
const logger = require('../utils/logger');
const auditLog = require('../modules/audit-log');
const { requireAuth, requireRoleOrPerm, safeError } = require('../middleware/index');

// GET /api/auditoria/historial
router.get('/historial', requireAuth, requireRoleOrPerm(['superadmin', 'admin'], 'usuarios.auditoria'), async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const historial = await auditLog.obtenerHistorialGlobal(limit);
    res.json(historial);
  } catch (e) {
    logger.error(e.message, { error: e });
    res.status(500).json({ error: safeError(e) });
  }
});

// GET /api/auditoria/buscar
router.get('/buscar', requireAuth, requireRoleOrPerm(['superadmin', 'admin'], 'usuarios.auditoria'), async (req, res) => {
  try {
    const { usuario_id, accion, admin_id, desde, hasta, limit: reqLimit } = req.query;
    const limit = Math.min(parseInt(reqLimit) || 500, 500);

    let query = 'SELECT ua.*, u.usuario, u.nombre FROM usuario_auditorias ua LEFT JOIN usuarios u ON ua.usuario_id = u.id WHERE 1=1';
    const params = [];

    if (usuario_id && usuario_id.trim() !== '') {
      query += ' AND ua.usuario_id = ?';
      params.push(parseInt(usuario_id));
    }

    if (accion && accion.trim() !== '') {
      const arr = accion.split(',').filter(Boolean);
      if (arr.length === 1) { query += ' AND ua.accion = ?'; params.push(arr[0].toUpperCase()); }
      else if (arr.length > 1) { query += ` AND ua.accion IN (${arr.map(() => '?').join(',')})`; params.push(...arr.map(a => a.toUpperCase())); }
    }

    if (admin_id && admin_id.trim() !== '') {
      query += ' AND ua.admin_id = ?';
      params.push(parseInt(admin_id));
    }

    if (desde && desde.trim() !== '') {
      query += ' AND ua.fecha_cambio >= ?';
      params.push(desde + ' 00:00:00');
    }

    if (hasta && hasta.trim() !== '') {
      query += ' AND ua.fecha_cambio <= ?';
      params.push(hasta + ' 23:59:59');
    }

    query += ` ORDER BY ua.fecha_cambio DESC LIMIT ${limit}`;

    const results = await db.query(query, params);

    const resultsWithParsedChanges = results.map(r => {
      let cambiosParsed = {};
      try {
        if (typeof r.cambios === 'string' && r.cambios) {
          cambiosParsed = JSON.parse(r.cambios);
        } else if (typeof r.cambios === 'object') {
          cambiosParsed = r.cambios;
        }
      } catch (e) {
        logger.error('[AUDIT SEARCH] Error parsing cambios:', e.message);
        cambiosParsed = { error: 'No se pudo parsear' };
      }
      return { ...r, cambios: cambiosParsed };
    });

    res.json({ ok: true, total: results.length, results: resultsWithParsedChanges });
  } catch (e) {
    logger.error('[AUDIT SEARCH ERROR]', e);
    res.status(500).json({ error: safeError(e) });
  }
});

module.exports = router;
