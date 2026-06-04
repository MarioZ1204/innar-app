/**
 * API módulo Anexo FIDU — grilla tipo Excel (45 columnas).
 */
const express = require('express');
const router = express.Router();
const db = require('../utils/db-mysql');
const logger = require('../utils/logger');
const { requireAuth, requirePermiso, safeError } = require('../middleware/index');
const PERM_ANEXO_FIDU = 'modulo.anexo_fidu';
const { upload, validateMagicBytes } = require('../middleware/upload');
const { ANEXO_FIDU_COLUMNAS, ANEXO_FIDU_COLUMN_KEYS } = require('../utils/anexo-fidu-columns');
const {
  mapExcelRowsToAnexoFidu,
  calcularEdadDesdeFecha,
  formatFechaParaCelda,
  cellToString
} = require('../utils/anexo-fidu-import');

function sanitizeRegistroBody(body) {
  const out = {};
  for (const key of ANEXO_FIDU_COLUMN_KEYS) {
    if (body[key] == null) out[key] = '';
    else out[key] = String(body[key]).trim();
  }
  if (out.fecha_nacimiento) {
    out.fecha_nacimiento = formatFechaParaCelda(out.fecha_nacimiento);
    if (!out.edad) out.edad = calcularEdadDesdeFecha(out.fecha_nacimiento);
  }
  return out;
}

function rowToApi(row) {
  if (!row) return null;
  const o = { id: row.id, creado_en: row.creado_en, actualizado_en: row.actualizado_en };
  ANEXO_FIDU_COLUMN_KEYS.forEach((k) => { o[k] = row[k] != null ? String(row[k]) : ''; });
  return o;
}

/** GET /api/anexo-fidu/columnas */
router.get('/anexo-fidu/columnas', requireAuth, requirePermiso(PERM_ANEXO_FIDU), (req, res) => {
  res.json({ ok: true, total: ANEXO_FIDU_COLUMNAS.length, columnas: ANEXO_FIDU_COLUMNAS });
});

/** GET /api/anexo-fidu/registros */
router.get('/anexo-fidu/registros', requireAuth, requirePermiso(PERM_ANEXO_FIDU), async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(10, parseInt(req.query.limit, 10) || 50));
    const offset = (page - 1) * limit;
    const q = String(req.query.q || '').trim();

    let where = '';
    const params = [];
    if (q) {
      where = ` WHERE (
        numero_documento LIKE ? OR nombres_1 LIKE ? OR nombres_2 LIKE ?
        OR apellidos_1 LIKE ? OR apellidos_2 LIKE ? OR numero_orden_fomag LIKE ?
      )`;
      const like = `%${q}%`;
      params.push(like, like, like, like, like, like);
    }

    const [countRow] = await db.query(
      `SELECT COUNT(*) AS total FROM anexo_fidu_registros${where}`,
      params
    );
    const total = countRow?.total || 0;

    const rows = await db.query(
      `SELECT * FROM anexo_fidu_registros${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    res.json({
      ok: true,
      page,
      limit,
      total,
      registros: rows.map(rowToApi)
    });
  } catch (e) {
    logger.error('[ANEXO-FIDU] list:', e);
    res.status(500).json({ error: safeError(e) });
  }
});

/** GET /api/anexo-fidu/registros/:id */
router.get('/anexo-fidu/registros/:id', requireAuth, requirePermiso(PERM_ANEXO_FIDU), async (req, res) => {
  try {
    const rows = await db.query('SELECT * FROM anexo_fidu_registros WHERE id = ? LIMIT 1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Registro no encontrado' });
    res.json({ ok: true, registro: rowToApi(rows[0]) });
  } catch (e) {
    res.status(500).json({ error: safeError(e) });
  }
});

/** POST /api/anexo-fidu/registros */
router.post('/anexo-fidu/registros', requireAuth, requirePermiso(PERM_ANEXO_FIDU), async (req, res) => {
  try {
    const data = sanitizeRegistroBody(req.body || {});
    const cols = ANEXO_FIDU_COLUMN_KEYS;
    const placeholders = cols.map(() => '?').join(',');
    const result = await db.execute(
      `INSERT INTO anexo_fidu_registros (${cols.map((c) => `\`${c}\``).join(',')}) VALUES (${placeholders})`,
      cols.map((c) => data[c])
    );
    const id = result.insertId;
    const rows = await db.query('SELECT * FROM anexo_fidu_registros WHERE id = ?', [id]);
    res.status(201).json({ ok: true, registro: rowToApi(rows[0]) });
  } catch (e) {
    logger.error('[ANEXO-FIDU] create:', e);
    res.status(500).json({ error: safeError(e) });
  }
});

/** PUT /api/anexo-fidu/registros/:id */
router.put('/anexo-fidu/registros/:id', requireAuth, requirePermiso(PERM_ANEXO_FIDU), async (req, res) => {
  try {
    const data = sanitizeRegistroBody(req.body || {});
    const sets = ANEXO_FIDU_COLUMN_KEYS.map((c) => `\`${c}\` = ?`).join(', ');
    const vals = ANEXO_FIDU_COLUMN_KEYS.map((c) => data[c]);
    vals.push(req.params.id);
    const result = await db.execute(
      `UPDATE anexo_fidu_registros SET ${sets} WHERE id = ?`,
      vals
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Registro no encontrado' });
    const rows = await db.query('SELECT * FROM anexo_fidu_registros WHERE id = ?', [req.params.id]);
    res.json({ ok: true, registro: rowToApi(rows[0]) });
  } catch (e) {
    logger.error('[ANEXO-FIDU] update:', e);
    res.status(500).json({ error: safeError(e) });
  }
});

/** DELETE /api/anexo-fidu/registros/:id */
router.delete('/anexo-fidu/registros/:id', requireAuth, requirePermiso(PERM_ANEXO_FIDU), async (req, res) => {
  try {
    const result = await db.execute('DELETE FROM anexo_fidu_registros WHERE id = ?', [req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Registro no encontrado' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: safeError(e) });
  }
});

/** POST /api/anexo-fidu/importar — Excel/CSV pacientes Sheets */
router.post(
  '/anexo-fidu/importar',
  requireAuth,
  requirePermiso(PERM_ANEXO_FIDU),
  upload.single('file'),
  validateMagicBytes,
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Selecciona un archivo Excel (.xlsx)' });
    const fs = require('fs');
    const filePath = req.file.path;
    try {
      const ExcelJS = require('exceljs');
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(filePath);

      const ws = workbook.worksheets[0];
      if (!ws) return res.status(400).json({ error: 'El archivo no tiene hojas' });

      const headers = [];
      const dataRows = [];
      ws.eachRow((row, rowNumber) => {
        if (rowNumber === 1) {
          row.eachCell({ includeEmpty: true }, (cell, col) => {
            headers[col] = cellToString(cell.value);
          });
          return;
        }
        const obj = {};
        let hasData = false;
        row.eachCell({ includeEmpty: true }, (cell, col) => {
          const key = headers[col];
          if (!key) return;
          const v = cellToString(cell.value);
          if (v) hasData = true;
          obj[key] = v;
        });
        if (hasData) dataRows.push(obj);
      });

      if (!dataRows.length) {
        return res.status(400).json({ error: 'No hay filas de datos (revise encabezados en fila 1)' });
      }

      const mapped = mapExcelRowsToAnexoFidu(dataRows);
      const cols = ANEXO_FIDU_COLUMN_KEYS;
      const placeholders = cols.map(() => '?').join(',');
      const sql = `INSERT INTO anexo_fidu_registros (${cols.map((c) => `\`${c}\``).join(',')}) VALUES (${placeholders})`;

      let insertados = 0;
      for (const data of mapped) {
        if (!data.numero_documento && !data.nombres_1 && !data.apellidos_1) continue;
        await db.execute(sql, cols.map((c) => data[c] || ''));
        insertados += 1;
      }

      res.json({
        ok: true,
        insertados,
        total_filas: dataRows.length,
        mensaje: `Se importaron ${insertados} registro(s) desde ${dataRows.length} fila(s)`
      });
    } catch (e) {
      logger.error('[ANEXO-FIDU] import:', e);
      res.status(500).json({ error: safeError(e, 'Error al importar: ') });
    } finally {
      try { fs.unlinkSync(filePath); } catch (_) { /* ignore */ }
    }
  }
);

module.exports = router;
