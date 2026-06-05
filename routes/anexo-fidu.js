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
  calcularEdadDesdeFecha,
  formatFechaParaCelda
} = require('../utils/anexo-fidu-import');
const {
  enriquecerRegistroAnexoFidu,
  listarServiciosCatalogo
} = require('../utils/anexo-fidu-servicios');
const {
  parsePersonasCsvContent,
  personaToAnexoPaciente,
  anexoRegistroToPersona,
  sanitizePersonaBody,
  armarRegistroAnexo,
  PERSONAS_CSV_COLUMNS
} = require('../utils/anexo-fidu-personas');
const { buildAnexoFiduExcelBuffer } = require('../utils/anexo-fidu-export');
const {
  normalizarNombreAnexo,
  parseAnexoFiduWorksheet
} = require('../utils/anexo-fidu-archivos');

function parseArchivoId(val) {
  const n = parseInt(val, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function fetchArchivoMeta(archivoId) {
  const rows = await db.query(
    `SELECT a.id, a.nombre, a.carpeta_id, c.nombre AS carpeta_nombre
     FROM anexo_fidu_archivos a
     INNER JOIN anexo_fidu_carpetas c ON c.id = a.carpeta_id
     WHERE a.id = ? LIMIT 1`,
    [archivoId]
  );
  return rows[0] || null;
}

async function upsertPersonaDesdeRegistro(data) {
  const persona = anexoRegistroToPersona(data);
  if (!persona.numero_documento) return false;
  const cols = PERSONAS_CSV_COLUMNS;
  const sets = cols.map((c) => `\`${c}\` = ?`).join(', ');
  const vals = cols.map((c) => persona[c] || '');
  const existing = await db.query(
    'SELECT id FROM anexo_fidu_personas WHERE numero_documento = ? LIMIT 1',
    [persona.numero_documento]
  );
  if (existing.length) {
    await db.execute(
      `UPDATE anexo_fidu_personas SET ${sets} WHERE numero_documento = ?`,
      [...vals, persona.numero_documento]
    );
  } else {
    const placeholders = cols.map(() => '?').join(',');
    await db.execute(
      `INSERT INTO anexo_fidu_personas (${cols.map((c) => `\`${c}\``).join(',')}) VALUES (${placeholders})`,
      vals
    );
  }
  return true;
}

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
  return enriquecerRegistroAnexoFidu(out);
}

function rowToApi(row) {
  if (!row) return null;
  const o = {
    id: row.id,
    archivo_id: row.archivo_id != null ? row.archivo_id : null,
    creado_en: row.creado_en,
    actualizado_en: row.actualizado_en
  };
  ANEXO_FIDU_COLUMN_KEYS.forEach((k) => { o[k] = row[k] != null ? String(row[k]) : ''; });
  return o;
}

/** GET /api/anexo-fidu/columnas */
router.get('/anexo-fidu/columnas', requireAuth, requirePermiso(PERM_ANEXO_FIDU), (req, res) => {
  res.json({ ok: true, total: ANEXO_FIDU_COLUMNAS.length, columnas: ANEXO_FIDU_COLUMNAS });
});

/** GET /api/anexo-fidu/servicios — catálogo CUPS + valores RIPS */
router.get('/anexo-fidu/servicios', requireAuth, requirePermiso(PERM_ANEXO_FIDU), (req, res) => {
  res.json({ ok: true, servicios: listarServiciosCatalogo() });
});

/** GET /api/anexo-fidu/diagnostico-por-codigo?codigo=G470 — nombre CIE-10 para NOMBREDIAGNOSTICO */
router.get('/anexo-fidu/diagnostico-por-codigo', requireAuth, requirePermiso(PERM_ANEXO_FIDU), async (req, res) => {
  const raw = String(req.query.codigo || '').trim();
  if (!raw) return res.json({ ok: true, nombre: '', codigo: '' });
  const norm = raw.toUpperCase();
  const normFlat = norm.replace(/\./g, '');
  try {
    const exact = await db.query(
      `SELECT nombre, descripcion, codigo FROM diagnosticos WHERE activo = 1
       AND (UPPER(TRIM(codigo)) = ? OR UPPER(REPLACE(TRIM(codigo), '.', '')) = ?)
       LIMIT 1`,
      [norm, normFlat]
    );
    if (exact.length) {
      const r = exact[0];
      return res.json({
        ok: true,
        nombre: String(r.nombre || r.descripcion || '').trim(),
        codigo: String(r.codigo || '').trim()
      });
    }
    if (normFlat.length < 2) {
      return res.json({ ok: true, nombre: '', codigo: '' });
    }
    const partial = await db.query(
      `SELECT nombre, descripcion, codigo FROM diagnosticos WHERE activo = 1
       AND UPPER(REPLACE(TRIM(codigo), '.', '')) LIKE ?
       ORDER BY LENGTH(codigo) ASC LIMIT 1`,
      [`${normFlat}%`]
    );
    const r = partial[0];
    res.json({
      ok: true,
      nombre: r ? String(r.nombre || r.descripcion || '').trim() : '',
      codigo: r ? String(r.codigo || '').trim() : ''
    });
  } catch (e) {
    logger.error('[ANEXO-FIDU] diagnostico-por-codigo:', e);
    res.status(500).json({ error: safeError(e) });
  }
});

/** GET /api/anexo-fidu/carpetas */
router.get('/anexo-fidu/carpetas', requireAuth, requirePermiso(PERM_ANEXO_FIDU), async (req, res) => {
  try {
    const rows = await db.query(`
      SELECT c.id, c.nombre, c.creado_en,
        (SELECT COUNT(*) FROM anexo_fidu_archivos a WHERE a.carpeta_id = c.id) AS total_archivos
      FROM anexo_fidu_carpetas c
      ORDER BY c.nombre ASC
    `);
    res.json({ ok: true, carpetas: rows });
  } catch (e) {
    logger.error('[ANEXO-FIDU] carpetas list:', e);
    res.status(500).json({ error: safeError(e) });
  }
});

/** POST /api/anexo-fidu/carpetas */
router.post('/anexo-fidu/carpetas', requireAuth, requirePermiso(PERM_ANEXO_FIDU), async (req, res) => {
  try {
    const nombre = normalizarNombreAnexo(req.body?.nombre);
    if (!nombre) return res.status(400).json({ error: 'Nombre de carpeta requerido (ej. Junio)' });
    const existing = await db.query('SELECT id FROM anexo_fidu_carpetas WHERE nombre = ? LIMIT 1', [nombre]);
    if (existing.length) {
      return res.status(409).json({ error: 'Ya existe una carpeta con ese nombre', carpeta: existing[0] });
    }
    const result = await db.execute('INSERT INTO anexo_fidu_carpetas (nombre) VALUES (?)', [nombre]);
    res.status(201).json({ ok: true, carpeta: { id: result.insertId, nombre } });
  } catch (e) {
    logger.error('[ANEXO-FIDU] carpeta create:', e);
    res.status(500).json({ error: safeError(e) });
  }
});

/** GET /api/anexo-fidu/carpetas/:carpetaId/archivos */
router.get('/anexo-fidu/carpetas/:carpetaId/archivos', requireAuth, requirePermiso(PERM_ANEXO_FIDU), async (req, res) => {
  try {
    const carpetaId = parseArchivoId(req.params.carpetaId);
    if (!carpetaId) return res.status(400).json({ error: 'Carpeta inválida' });
    const archivos = await db.query(
      `SELECT a.id, a.nombre, a.creado_en, a.actualizado_en,
        (SELECT COUNT(*) FROM anexo_fidu_registros r WHERE r.archivo_id = a.id) AS total_registros
       FROM anexo_fidu_archivos a
       WHERE a.carpeta_id = ?
       ORDER BY a.nombre ASC`,
      [carpetaId]
    );
    res.json({ ok: true, archivos });
  } catch (e) {
    res.status(500).json({ error: safeError(e) });
  }
});

/** POST /api/anexo-fidu/archivos */
router.post('/anexo-fidu/archivos', requireAuth, requirePermiso(PERM_ANEXO_FIDU), async (req, res) => {
  try {
    const carpetaId = parseArchivoId(req.body?.carpeta_id);
    const nombre = normalizarNombreAnexo(req.body?.nombre);
    if (!carpetaId) return res.status(400).json({ error: 'carpeta_id requerido' });
    if (!nombre) return res.status(400).json({ error: 'Nombre del anexo requerido (ej. ANEXO 1 JUNIO)' });
    const carp = await db.query('SELECT id FROM anexo_fidu_carpetas WHERE id = ? LIMIT 1', [carpetaId]);
    if (!carp.length) return res.status(404).json({ error: 'Carpeta no encontrada' });
    const dup = await db.query(
      'SELECT id FROM anexo_fidu_archivos WHERE carpeta_id = ? AND nombre = ? LIMIT 1',
      [carpetaId, nombre]
    );
    if (dup.length) {
      return res.status(409).json({
        error: 'Ya existe un anexo con ese nombre en la carpeta',
        archivo: { id: dup[0].id, nombre }
      });
    }
    const result = await db.execute(
      'INSERT INTO anexo_fidu_archivos (carpeta_id, nombre) VALUES (?, ?)',
      [carpetaId, nombre]
    );
    res.status(201).json({
      ok: true,
      archivo: { id: result.insertId, carpeta_id: carpetaId, nombre, total_registros: 0 }
    });
  } catch (e) {
    logger.error('[ANEXO-FIDU] archivo create:', e);
    res.status(500).json({ error: safeError(e) });
  }
});

/** GET /api/anexo-fidu/archivos/:id */
router.get('/anexo-fidu/archivos/:id', requireAuth, requirePermiso(PERM_ANEXO_FIDU), async (req, res) => {
  try {
    const archivoId = parseArchivoId(req.params.id);
    if (!archivoId) return res.status(400).json({ error: 'Archivo inválido' });
    const meta = await fetchArchivoMeta(archivoId);
    if (!meta) return res.status(404).json({ error: 'Anexo no encontrado' });
    const [cnt] = await db.query(
      'SELECT COUNT(*) AS total FROM anexo_fidu_registros WHERE archivo_id = ?',
      [archivoId]
    );
    res.json({
      ok: true,
      archivo: {
        id: meta.id,
        nombre: meta.nombre,
        carpeta_id: meta.carpeta_id,
        carpeta_nombre: meta.carpeta_nombre,
        total_registros: cnt?.total || 0
      }
    });
  } catch (e) {
    res.status(500).json({ error: safeError(e) });
  }
});

/** POST /api/anexo-fidu/archivos/:id/importar — Excel del anexo a este archivo */
router.post(
  '/anexo-fidu/archivos/:id/importar',
  requireAuth,
  requirePermiso(PERM_ANEXO_FIDU),
  upload.single('file'),
  validateMagicBytes,
  async (req, res) => {
    const fs = require('fs');
    const path = require('path');
    const archivoId = parseArchivoId(req.params.id);
    if (!archivoId) return res.status(400).json({ error: 'Archivo inválido' });
    if (!req.file) return res.status(400).json({ error: 'Selecciona un archivo Excel (.xlsx)' });
    const filePath = req.file.path;
    const reemplazar = String(req.body?.reemplazar || req.query?.reemplazar || '') === '1'
      || req.body?.reemplazar === true;

    try {
      const ext = path.extname(req.file.originalname).toLowerCase();
      if (ext !== '.xlsx') return res.status(400).json({ error: 'Solo se acepta Excel (.xlsx)' });
      const meta = await fetchArchivoMeta(archivoId);
      if (!meta) return res.status(404).json({ error: 'Anexo no encontrado' });

      const ExcelJS = require('exceljs');
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(filePath);
      const ws = wb.worksheets[0];
      if (!ws) return res.status(400).json({ error: 'El Excel no tiene hojas' });

      const { registros, errores } = parseAnexoFiduWorksheet(ws);
      if (!registros.length) {
        return res.status(400).json({ error: 'No hay filas válidas en el Excel', errores: errores.slice(0, 20) });
      }

      if (reemplazar) {
        await db.execute('DELETE FROM anexo_fidu_registros WHERE archivo_id = ?', [archivoId]);
      }

      const cols = ['archivo_id', ...ANEXO_FIDU_COLUMN_KEYS];
      const placeholders = cols.map(() => '?').join(',');
      const sql = `INSERT INTO anexo_fidu_registros (${cols.map((c) => `\`${c}\``).join(',')}) VALUES (${placeholders})`;
      let insertados = 0;
      for (const raw of registros) {
        const data = sanitizeRegistroBody(raw);
        await db.execute(sql, [archivoId, ...ANEXO_FIDU_COLUMN_KEYS.map((c) => data[c])]);
        if (req.body?.actualizar_personas !== '0') await upsertPersonaDesdeRegistro(data);
        insertados += 1;
      }

      res.json({
        ok: true,
        insertados,
        reemplazo: reemplazar,
        mensaje: `${insertados} fila(s) importada(s) en «${meta.nombre}»`,
        advertencias: errores.slice(0, 30)
      });
    } catch (e) {
      logger.error('[ANEXO-FIDU] import archivo:', e);
      res.status(500).json({ error: safeError(e, 'Error al importar Excel: ') });
    } finally {
      try { fs.unlinkSync(filePath); } catch (_) { /* ignore */ }
    }
  }
);

/** GET /api/anexo-fidu/registros */
router.get('/anexo-fidu/registros', requireAuth, requirePermiso(PERM_ANEXO_FIDU), async (req, res) => {
  try {
    const archivoId = parseArchivoId(req.query.archivo_id);
    if (!archivoId) return res.status(400).json({ error: 'Selecciona un anexo (archivo_id)' });
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(10, parseInt(req.query.limit, 10) || 50));
    const offset = (page - 1) * limit;
    const q = String(req.query.q || '').trim();

    let where = ' WHERE archivo_id = ?';
    const params = [archivoId];
    if (q) {
      where += ` AND (
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

/** POST /api/anexo-fidu/armar — documento + código servicio → fila del anexo */
router.post('/anexo-fidu/armar', requireAuth, requirePermiso(PERM_ANEXO_FIDU), async (req, res) => {
  try {
    const documento = String(req.body?.numero_documento || '').trim();
    const codigo = String(req.body?.codigo_servicio || '').trim();
    if (!documento) return res.status(400).json({ error: 'Ingresa el número de documento' });
    if (!codigo) return res.status(400).json({ error: 'Ingresa el código del servicio' });

    const rows = await db.query(
      'SELECT * FROM anexo_fidu_personas WHERE numero_documento = ? LIMIT 1',
      [documento]
    );
    if (!rows.length) {
      return res.json({
        ok: true,
        persona_encontrada: false,
        numero_documento: documento,
        codigo_servicio: codigo
      });
    }

    const { registro, servicio_encontrado } = armarRegistroAnexo(documento, codigo, rows[0]);
    res.json({
      ok: true,
      persona_encontrada: true,
      servicio_encontrado,
      registro: rowToApi({ id: null, ...registro }),
      persona: personaRowToApi(rows[0])
    });
  } catch (e) {
    logger.error('[ANEXO-FIDU] armar:', e);
    res.status(500).json({ error: safeError(e) });
  }
});

/** POST /api/anexo-fidu/personas — alta de paciente nuevo (15 campos) */
router.post('/anexo-fidu/personas', requireAuth, requirePermiso(PERM_ANEXO_FIDU), async (req, res) => {
  try {
    const persona = sanitizePersonaBody(req.body || {});
    const existing = await db.query(
      'SELECT id FROM anexo_fidu_personas WHERE numero_documento = ? LIMIT 1',
      [persona.numero_documento]
    );
    if (existing.length) {
      return res.status(409).json({ error: 'Ya existe un paciente con ese documento' });
    }
    const cols = PERSONAS_CSV_COLUMNS;
    const placeholders = cols.map(() => '?').join(',');
    const result = await db.execute(
      `INSERT INTO anexo_fidu_personas (${cols.map((c) => `\`${c}\``).join(',')}) VALUES (${placeholders})`,
      cols.map((c) => persona[c] || '')
    );
    const rows = await db.query('SELECT * FROM anexo_fidu_personas WHERE id = ?', [result.insertId]);
    res.status(201).json({ ok: true, persona: personaRowToApi(rows[0]) });
  } catch (e) {
    if (e.message === 'Número de documento requerido') {
      return res.status(400).json({ error: e.message });
    }
    logger.error('[ANEXO-FIDU] persona create:', e);
    res.status(500).json({ error: safeError(e) });
  }
});

/** POST /api/anexo-fidu/registros */
router.post('/anexo-fidu/registros', requireAuth, requirePermiso(PERM_ANEXO_FIDU), async (req, res) => {
  try {
    const archivoId = parseArchivoId(req.body?.archivo_id);
    if (!archivoId) return res.status(400).json({ error: 'archivo_id requerido' });
    const meta = await fetchArchivoMeta(archivoId);
    if (!meta) return res.status(404).json({ error: 'Anexo no encontrado' });
    const data = sanitizeRegistroBody(req.body || {});
    const cols = ['archivo_id', ...ANEXO_FIDU_COLUMN_KEYS];
    const placeholders = cols.map(() => '?').join(',');
    const result = await db.execute(
      `INSERT INTO anexo_fidu_registros (${cols.map((c) => `\`${c}\``).join(',')}) VALUES (${placeholders})`,
      [archivoId, ...ANEXO_FIDU_COLUMN_KEYS.map((c) => data[c])]
    );
    const syncPersona = req.body?.actualizar_persona !== false;
    if (syncPersona) await upsertPersonaDesdeRegistro(data);
    const id = result.insertId;
    const rows = await db.query('SELECT * FROM anexo_fidu_registros WHERE id = ?', [id]);
    res.status(201).json({
      ok: true,
      registro: rowToApi(rows[0]),
      persona_actualizada: syncPersona
    });
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
    const syncPersona = req.body?.actualizar_persona !== false;
    if (syncPersona) await upsertPersonaDesdeRegistro(data);
    const rows = await db.query('SELECT * FROM anexo_fidu_registros WHERE id = ?', [req.params.id]);
    res.json({ ok: true, registro: rowToApi(rows[0]), persona_actualizada: syncPersona });
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

function personaRowToApi(row) {
  if (!row) return null;
  const o = { id: row.id, creado_en: row.creado_en, actualizado_en: row.actualizado_en };
  PERSONAS_CSV_COLUMNS.forEach((k) => { o[k] = row[k] != null ? String(row[k]) : ''; });
  return o;
}

/** GET /api/anexo-fidu/personas/resumen */
router.get('/anexo-fidu/personas/resumen', requireAuth, requirePermiso(PERM_ANEXO_FIDU), async (req, res) => {
  try {
    const [row] = await db.query('SELECT COUNT(*) AS total FROM anexo_fidu_personas');
    res.json({ ok: true, total: row?.total || 0 });
  } catch (e) {
    res.status(500).json({ error: safeError(e) });
  }
});

/** GET /api/anexo-fidu/personas — búsqueda en base maestra */
router.get('/anexo-fidu/personas', requireAuth, requirePermiso(PERM_ANEXO_FIDU), async (req, res) => {
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
        OR apellidos_1 LIKE ? OR apellidos_2 LIKE ?
      )`;
      const like = `%${q}%`;
      params.push(like, like, like, like, like);
    }

    const [countRow] = await db.query(`SELECT COUNT(*) AS total FROM anexo_fidu_personas${where}`, params);
    const rows = await db.query(
      `SELECT * FROM anexo_fidu_personas${where} ORDER BY apellidos_1, nombres_1 LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    res.json({
      ok: true,
      page,
      limit,
      total: countRow?.total || 0,
      personas: rows.map(personaRowToApi)
    });
  } catch (e) {
    logger.error('[ANEXO-FIDU] personas list:', e);
    res.status(500).json({ error: safeError(e) });
  }
});

/** GET /api/anexo-fidu/personas/:documento — datos paciente para armar anexo */
router.get('/anexo-fidu/personas/doc/:documento', requireAuth, requirePermiso(PERM_ANEXO_FIDU), async (req, res) => {
  try {
    const doc = String(req.params.documento || '').trim();
    const rows = await db.query('SELECT * FROM anexo_fidu_personas WHERE numero_documento = ? LIMIT 1', [doc]);
    if (!rows.length) return res.status(404).json({ error: 'Persona no encontrada en la base' });
    const persona = personaRowToApi(rows[0]);
    res.json({ ok: true, persona, campos_anexo: personaToAnexoPaciente(rows[0]) });
  } catch (e) {
    res.status(500).json({ error: safeError(e) });
  }
});

/** POST /api/anexo-fidu/personas/importar — CSV Lista_Personas (reemplaza base completa) */
router.post(
  '/anexo-fidu/personas/importar',
  requireAuth,
  requirePermiso(PERM_ANEXO_FIDU),
  upload.single('file'),
  validateMagicBytes,
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Selecciona un archivo CSV (.csv)' });
    const fs = require('fs');
    const filePath = req.file.path;
    try {
      const ext = require('path').extname(req.file.originalname).toLowerCase();
      if (ext !== '.csv') return res.status(400).json({ error: 'Solo se acepta CSV (.csv)' });

      const content = fs.readFileSync(filePath, 'utf8');
      const { personas, errores } = parsePersonasCsvContent(content);
      if (!personas.length) {
        return res.status(400).json({ error: 'No hay personas válidas en el CSV', errores: errores.slice(0, 30) });
      }

      const cols = PERSONAS_CSV_COLUMNS;
      const placeholders = cols.map(() => '?').join(',');
      const sql = `INSERT INTO anexo_fidu_personas (${cols.map((c) => `\`${c}\``).join(',')}) VALUES (${placeholders})`;

      await db.execute('DELETE FROM anexo_fidu_personas');
      let insertados = 0;
      for (const p of personas) {
        await db.execute(sql, cols.map((c) => p[c] || ''));
        insertados += 1;
      }

      res.json({
        ok: true,
        insertados,
        omitidos: errores.length,
        mensaje: `Base de personas actualizada: ${insertados} registro(s)${errores.length ? ` (${errores.length} fila(s) omitidas)` : ''}`,
        advertencias: errores.slice(0, 50)
      });
    } catch (e) {
      logger.error('[ANEXO-FIDU] personas import:', e);
      res.status(500).json({ error: safeError(e, 'Error al importar CSV: ') });
    } finally {
      try { fs.unlinkSync(filePath); } catch (_) { /* ignore */ }
    }
  }
);

/** GET /api/anexo-fidu/exportar — Excel 45 columnas con colores por servicio */
router.get('/anexo-fidu/exportar', requireAuth, requirePermiso(PERM_ANEXO_FIDU), async (req, res) => {
  try {
    const archivoId = parseArchivoId(req.query.archivo_id);
    if (!archivoId) return res.status(400).json({ error: 'Selecciona un anexo para exportar (archivo_id)' });
    const meta = await fetchArchivoMeta(archivoId);
    if (!meta) return res.status(404).json({ error: 'Anexo no encontrado' });

    const rows = await db.query(
      'SELECT * FROM anexo_fidu_registros WHERE archivo_id = ? ORDER BY id ASC',
      [archivoId]
    );
    const { buffer, filename } = await buildAnexoFiduExcelBuffer(rows, { nombreArchivo: meta.nombre });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(Buffer.from(buffer));
  } catch (e) {
    logger.error('[ANEXO-FIDU] export:', e);
    if (!res.headersSent) res.status(500).json({ error: safeError(e) });
  }
});

module.exports = router;
