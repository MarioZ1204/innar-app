/**
 * Módulos: Reportes PDX + Armado de soportes de radicación
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const archiver = require('archiver');

const router = express.Router();
const db = require('../utils/db-mysql');
const logger = require('../utils/logger');
const { requireAuth, requireRoleOrPerm, safeError } = require('../middleware/index');
const { upload, uploadArmadoSoportes, validateMagicBytes } = require('../middleware/upload');
const {
  periodoFromDate,
  calcularVisibilidadPeriodo,
  diasRestantesGracia
} = require('../utils/soportes-visibilidad');
const {
  detectarTemaCarpeta
} = require('../utils/soportes-temas');
const {
  fechaEnPeriodo,
  temaCoincideCarpeta,
  normalizarNombreBusqueda,
  mensajeErrorFormato,
  nombreArchivoDescarga,
  parseNombrePorCarpeta,
  normalizarNombreOrdenHc,
  normalizarNombreComprobante,
  normalizarNombreConsentimiento,
  inferirEstudioDesdeCarpeta,
  buildNombreDescargaPdxDesdeRow
} = require('../utils/soportes-pdx-parse');
const {
  buildMetaFromUpload,
  cargarEstudiosParaOrdenes,
  necesitaListaEstudios,
  finalizePdxFileOnDisk,
  ensureMetaPacienteNombre,
  resolveTmpUploadPath,
  movePdxFileOnDisk,
  collectPdxWarnings
} = require('../utils/soportes-pdx-upload');
const {
  ensureContenedoresForDia,
  ensureFeParEnContenedorHermano,
  parseFeCodigo
} = require('../utils/soportes-armado-structure');
const { ingestFeArchivo } = require('../utils/soportes-fe-upload');
const { slotRequirements, buildCanonicalName, getNitObligado, fevFilenameHint } = require('../utils/soportes-archivo-detect');
const { parseListaPacientes, parseLineaPaciente } = require('../utils/soportes-pacientes-parse');
const { actualizarExpediente, eliminarExpediente } = require('../utils/soportes-expediente-admin');
const { actualizarDia, eliminarDia } = require('../utils/soportes-dia-admin');
const {
  getPdxDir,
  getArmadoExpedienteDir,
  getArmadoFeDirFromContext,
  ensureDir,
  safeFilename,
  resolveStoragePath,
  resolvePdxArchivoPath,
  relativePdxRuta
} = require('../utils/soportes-storage');

async function resolvePdxArchivoPathForApi(row, repair = false) {
  const fp = resolvePdxArchivoPath(row);
  if (!fp || !repair || !row?.id) return fp;
  const rel = relativePdxRuta(row.carpeta_id, path.basename(fp));
  if (row.ruta_relativa !== rel) {
    await db.execute('UPDATE sop_pdx_archivos SET ruta_relativa = ? WHERE id = ?', [rel, row.id]).catch(() => {});
  }
  return fp;
}
const { jsonSafeRow } = require('../utils/json-safe');

const ROLES_SOPORTES = ['superadmin', 'admin', 'admin_recepcion', 'recepcion', 'contabilidad', 'admin_electro', 'electro', 'tecnico_electro'];

function enrichArchivoPdxConNombreDescarga(archivo, carpeta) {
  const carpetaCtx = carpeta?.nombre_display != null
    ? carpeta
    : { nombre_display: archivo.carpeta_nombre || '' };
  const nombre_descarga = buildNombreDescargaPdxDesdeRow(archivo, carpetaCtx);
  return { ...archivo, nombre_descarga };
}

function safeEnrichArchivoPdxConNombreDescarga(archivo, carpeta) {
  try {
    return enrichArchivoPdxConNombreDescarga(archivo, carpeta);
  } catch (e) {
    logger.warn('[SOPORTES] nombre_descarga fallback', { archivoId: archivo?.id, err: e.message });
    return {
      ...archivo,
      nombre_descarga: archivo?.nombre_archivo_display
        || archivo?.nombre_archivo_original
        || 'archivo.pdf'
    };
  }
}

async function queryPdxArchivosConUsuarios(carpetaId) {
  const queries = [
    {
      sql: `SELECT a.*, us.nombre AS subido_por_nombre, ue.nombre AS editado_por_nombre
       FROM sop_pdx_archivos a
       LEFT JOIN usuarios us ON us.id = a.subido_por
       LEFT JOIN usuarios ue ON ue.id = a.editado_por
       WHERE a.carpeta_id = ? ORDER BY a.paciente_nombre ASC, a.id DESC`,
      map: (rows) => rows
    },
    {
      sql: `SELECT a.*, us.nombre AS subido_por_nombre
       FROM sop_pdx_archivos a
       LEFT JOIN usuarios us ON us.id = a.subido_por
       WHERE a.carpeta_id = ? ORDER BY a.paciente_nombre ASC, a.id DESC`,
      map: (rows) => rows.map((r) => ({ ...r, editado_por_nombre: null }))
    },
    {
      sql: 'SELECT a.* FROM sop_pdx_archivos a WHERE a.carpeta_id = ? ORDER BY a.id DESC',
      map: (rows) => rows.map((r) => ({ ...r, subido_por_nombre: null, editado_por_nombre: null }))
    }
  ];

  let lastErr;
  for (const { sql, map } of queries) {
    try {
      const rows = await db.query(sql, [carpetaId]);
      return map(rows).map(jsonSafeRow);
    } catch (e) {
      lastErr = e;
      if (e.code === 'ER_NO_SUCH_TABLE') {
        logger.error('[SOPORTES] Falta tabla sop_pdx_archivos; reinicie la app para aplicar migraciones');
        return [];
      }
      if (e.code !== 'ER_BAD_FIELD_ERROR') throw e;
    }
  }
  throw lastErr;
}

function pdxListErrorPayload(req, e, step) {
  const payload = { error: safeError(e) };
  const msg = String(e?.message || e);
  if (step) payload.step = step;
  if (req.session?.rol === 'superadmin' || process.env.NODE_ENV !== 'production') {
    payload.detail = msg.slice(0, 400);
    if (e?.code) payload.code = e.code;
  } else {
    payload.detail = msg.slice(0, 250);
    if (e?.code) payload.code = e.code;
  }
  return payload;
}

function puedeVerArchivo(req) {
  const perms = req.session?.permisos;
  if (req.session?.rol === 'superadmin') return true;
  if (Array.isArray(perms) && perms.includes('soportes.ver_archivo')) return true;
  return false;
}

async function refrescarVisibilidadPdx(periodo) {
  const estado = calcularVisibilidadPeriodo(periodo);
  await db.execute('UPDATE sop_pdx_carpetas SET estado_visibilidad = ? WHERE periodo = ?', [estado, periodo]);
  return estado;
}

async function refrescarVisibilidadArmado(periodo) {
  const estado = calcularVisibilidadPeriodo(periodo);
  await db.execute('UPDATE sop_periodos SET estado_visibilidad = ? WHERE periodo = ?', [estado, periodo]);
  return estado;
}

function mapCarpetaPdx(row) {
  const periodo = row.periodo;
  const vis = calcularVisibilidadPeriodo(periodo);
  return {
    id: row.id,
    periodo,
    nombre_display: row.nombre_display,
    color_tema: row.color_tema || detectarTemaCarpeta(row.nombre_display),
    estado_visibilidad: vis,
    dias_restantes_gracia: diasRestantesGracia(periodo),
    archivos_count: row.archivos_count || 0,
    creado_en: row.creado_en
  };
}

const pdxStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    try {
      const dir = getPdxDir(req.params.id || req.body.carpeta_id || '0');
      cb(null, dir);
    } catch (e) {
      cb(e);
    }
  },
  filename: (req, file, cb) => {
    cb(null, safeFilename(file.originalname));
  }
});

const uploadPdx = multer({
  storage: pdxStorage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.pdf') cb(null, true);
    else cb(new Error('Solo se permiten archivos PDF'));
  }
});

function uploadPdxSingle(req, res, next) {
  uploadPdx.single('file')(req, res, (err) => {
    if (!err) return next();
    logger.error('[SOPORTES] multer pdx', { message: err.message, code: err.code });
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    const payload = { error: err.message || 'No se pudo recibir el archivo PDF' };
    if (req.session?.rol === 'superadmin' && err.code) payload.code = err.code;
    return res.status(status).json(payload);
  });
}

function pdxInsertId(result) {
  if (!result?.insertId) return 0;
  return typeof result.insertId === 'bigint' ? Number(result.insertId) : Number(result.insertId);
}

async function insertPdxArchivoRow(carpetaId, meta, file, session) {
  ensureMetaPacienteNombre(meta, file.originalname);
  const tamano = Number(file.size) || 0;
  const params = [
    carpetaId, meta.apellidos || null, meta.nombres || null, meta.paciente_nombre,
    meta.paciente_nombre_norm, meta.paciente_documento || null,
    meta.fecha_estudio || null, meta.marca_tiempo || null, meta.sufijo_numero || null,
    meta.estudio_texto || null, String(file.originalname || 'archivo.pdf').slice(0, 255),
    meta.nombre_archivo_display,
    meta.ruta_relativa, tamano, session.usuarioId || null
  ];
  try {
    return await db.execute(
      `INSERT INTO sop_pdx_archivos (
          carpeta_id, apellidos, nombres, paciente_nombre, paciente_nombre_norm, paciente_documento,
          fecha_estudio, marca_tiempo, sufijo_numero, estudio_texto, nombre_archivo_original,
          nombre_archivo_display, ruta_relativa, tamano_bytes, subido_por
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      params
    );
  } catch (e) {
    if (e.code !== 'ER_BAD_FIELD_ERROR') throw e;
    return db.execute(
      `INSERT INTO sop_pdx_archivos (
          carpeta_id, paciente_nombre, paciente_nombre_norm, paciente_documento,
          fecha_estudio, nombre_archivo_original, nombre_archivo_display, ruta_relativa,
          tamano_bytes, subido_por
        ) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        carpetaId, meta.paciente_nombre, meta.paciente_nombre_norm,
        meta.paciente_documento || null, meta.fecha_estudio || null,
        String(file.originalname || 'archivo.pdf').slice(0, 255),
        meta.nombre_archivo_display, meta.ruta_relativa,
        tamano, session.usuarioId || null
      ]
    );
  }
}

// ─── PDX: carpetas ─────────────────────────────────────────────────────────

async function logPdxArchivo(archivoId, tipo, usuarioId, detalle) {
  try {
    await db.execute(
      'INSERT INTO sop_pdx_archivo_log (archivo_id, tipo, usuario_id, detalle) VALUES (?,?,?,?)',
      [archivoId, tipo, usuarioId || null, detalle ? String(detalle).slice(0, 500) : null]
    );
  } catch (_) { /* log opcional si migración pendiente */ }
}

const uploadPdxReemplazar = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      db.query('SELECT carpeta_id FROM sop_pdx_archivos WHERE id = ?', [req.params.id])
        .then((rows) => {
          if (!rows.length) return cb(new Error('Archivo no encontrado'));
          cb(null, getPdxDir(rows[0].carpeta_id));
        })
        .catch((e) => cb(e));
    },
    filename: (req, file, cb) => cb(null, safeFilename(file.originalname))
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.pdf') cb(null, true);
    else cb(new Error('Solo se permiten archivos PDF'));
  }
});

router.get('/soportes/pdx/carpetas', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, ['modulo.reportes_pdx', 'soportes.pdx.ver', 'soportes.pdx.subir']), async (req, res) => {
  try {
    const incluirArchivo = puedeVerArchivo(req) && req.query.archivo === '1';
    const rows = await db.query(`
      SELECT c.*, COUNT(a.id) AS archivos_count
      FROM sop_pdx_carpetas c
      LEFT JOIN sop_pdx_archivos a ON a.carpeta_id = c.id
      GROUP BY c.id
      ORDER BY c.periodo DESC, c.nombre_display ASC
    `);
    const hoyPeriodo = periodoFromDate();
    for (const r of rows) await refrescarVisibilidadPdx(r.periodo);
    const lista = rows
      .map(mapCarpetaPdx)
      .filter((c) => c.estado_visibilidad !== 'archivo' || incluirArchivo);
    res.json({ periodo_actual: hoyPeriodo, carpetas: lista });
  } catch (e) {
    logger.error('[SOPORTES] pdx carpetas:', e);
    res.status(500).json({ error: safeError(e) });
  }
});

router.post('/soportes/pdx/carpetas', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, ['modulo.reportes_pdx', 'soportes.pdx.crear_carpeta', 'soportes.pdx.subir']), async (req, res) => {
  try {
    const { periodo, nombre_display } = req.body || {};
    if (!periodo || !/^\d{4}-\d{2}$/.test(periodo)) {
      return res.status(400).json({ error: 'periodo inválido (YYYY-MM)' });
    }
    const nombre = String(nombre_display || '').trim();
    if (nombre.length < 3) return res.status(400).json({ error: 'nombre de carpeta requerido' });
    const tema = detectarTemaCarpeta(nombre);
    const vis = calcularVisibilidadPeriodo(periodo);
    const r = await db.execute(
      `INSERT INTO sop_pdx_carpetas (periodo, nombre_display, color_tema, estado_visibilidad, creado_por)
       VALUES (?, ?, ?, ?, ?)`,
      [periodo, nombre, tema, vis, req.session.usuarioId]
    );
    const id = r.insertId;
    getPdxDir(id);
    const rows = await db.query('SELECT * FROM sop_pdx_carpetas WHERE id = ?', [id]);
    res.status(201).json({ ok: true, carpeta: mapCarpetaPdx({ ...rows[0], archivos_count: 0 }) });
  } catch (e) {
    if (String(e.message || '').includes('uk_sop_pdx')) {
      return res.status(409).json({ error: 'Ya existe una carpeta con ese nombre en el periodo' });
    }
    logger.error('[SOPORTES] crear carpeta pdx:', e);
    res.status(500).json({ error: safeError(e) });
  }
});

router.patch('/soportes/pdx/carpetas/:id', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, ['modulo.reportes_pdx', 'soportes.pdx.editar', 'soportes.pdx.subir']), async (req, res) => {
  try {
    const rows = await db.query('SELECT * FROM sop_pdx_carpetas WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Carpeta no encontrada' });
    const prev = rows[0];
    const vis = calcularVisibilidadPeriodo(prev.periodo);
    if (vis === 'archivo') return res.status(403).json({ error: 'Carpeta en archivo: no editable' });

    const periodo = req.body?.periodo != null ? String(req.body.periodo).trim() : prev.periodo;
    const nombre = req.body?.nombre_display != null ? String(req.body.nombre_display).trim() : prev.nombre_display;
    if (!/^\d{4}-\d{2}$/.test(periodo)) return res.status(400).json({ error: 'periodo inválido (YYYY-MM)' });
    if (nombre.length < 3) return res.status(400).json({ error: 'nombre de carpeta requerido' });

    const tema = detectarTemaCarpeta(nombre);
    const estado = calcularVisibilidadPeriodo(periodo);
    await db.execute(
      'UPDATE sop_pdx_carpetas SET periodo = ?, nombre_display = ?, color_tema = ?, estado_visibilidad = ? WHERE id = ?',
      [periodo, nombre, tema, estado, req.params.id]
    );
    const countRows = await db.query('SELECT COUNT(*) AS n FROM sop_pdx_archivos WHERE carpeta_id = ?', [req.params.id]);
    const updated = await db.query('SELECT * FROM sop_pdx_carpetas WHERE id = ?', [req.params.id]);
    res.json({
      ok: true,
      carpeta: mapCarpetaPdx({ ...updated[0], archivos_count: countRows[0]?.n || 0 })
    });
  } catch (e) {
    if (String(e.message || '').includes('uk_sop_pdx')) {
      return res.status(409).json({ error: 'Ya existe una carpeta con ese nombre en el periodo' });
    }
    logger.error('[SOPORTES] editar carpeta pdx:', e);
    res.status(500).json({ error: safeError(e) });
  }
});

router.delete('/soportes/pdx/carpetas/:id', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, ['modulo.reportes_pdx', 'soportes.pdx.eliminar']), async (req, res) => {
  try {
    const rows = await db.query('SELECT * FROM sop_pdx_carpetas WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Carpeta no encontrada' });
    const archivos = await db.query('SELECT id, ruta_relativa FROM sop_pdx_archivos WHERE carpeta_id = ?', [req.params.id]);
    const usados = await db.query(
      'SELECT COUNT(*) AS n FROM sop_exp_archivos WHERE pdx_archivo_id IN (SELECT id FROM sop_pdx_archivos WHERE carpeta_id = ?)',
      [req.params.id]
    );
    if (usados[0]?.n > 0 && req.query.force !== '1') {
      return res.status(409).json({
        error: 'Hay archivos de esta carpeta vinculados a expedientes FE. No se puede eliminar.',
        vinculados: usados[0].n
      });
    }
    for (const a of archivos) {
      const fp = resolvePdxArchivoPath({ ...a, carpeta_id: req.params.id });
      if (fp) {
        try { fs.unlinkSync(fp); } catch (_) { /* ignore */ }
      }
    }
    await db.execute('DELETE FROM sop_pdx_carpetas WHERE id = ?', [req.params.id]);
    try {
      const dir = getPdxDir(req.params.id);
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    } catch (_) { /* ignore */ }
    res.json({ ok: true, eliminados: archivos.length });
  } catch (e) {
    logger.error('[SOPORTES] eliminar carpeta pdx:', e);
    res.status(500).json({ error: safeError(e) });
  }
});

router.get('/soportes/pdx/carpetas/:id/archivos', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, ['modulo.reportes_pdx', 'soportes.pdx.ver', 'soportes.pdx.subir']), async (req, res) => {
  try {
    const carpeta = await db.query('SELECT * FROM sop_pdx_carpetas WHERE id = ?', [req.params.id]);
    if (!carpeta.length) return res.status(404).json({ error: 'Carpeta no encontrada' });
    const vis = calcularVisibilidadPeriodo(carpeta[0].periodo);
    if (vis === 'archivo' && !puedeVerArchivo(req)) {
      return res.status(403).json({ error: 'Carpeta en archivo' });
    }
    const archivos = await queryPdxArchivosConUsuarios(req.params.id);
    const carp = jsonSafeRow(carpeta[0]);
    res.json({
      carpeta: mapCarpetaPdx({ ...carp, archivos_count: archivos.length }),
      archivos: archivos.map((a) => safeEnrichArchivoPdxConNombreDescarga(a, carp))
    });
  } catch (e) {
    logger.error('[SOPORTES] listar archivos pdx carpeta', {
      carpetaId: req.params.id,
      message: e?.message,
      code: e?.code
    });
    res.status(500).json(pdxListErrorPayload(req, e));
  }
});

router.post(
  '/soportes/pdx/carpetas/:id/archivos',
  requireAuth,
  requireRoleOrPerm(ROLES_SOPORTES, ['modulo.reportes_pdx', 'soportes.pdx.subir']),
  uploadPdxSingle,
  validateMagicBytes,
  async (req, res) => {
    let uploadedPath = null;
    let step = 'inicio';
    try {
      if (!req.file) return res.status(400).json({ error: 'Archivo PDF requerido' });
      uploadedPath = resolveTmpUploadPath(req.params.id, req.file);
      if (!req.file.path && uploadedPath) req.file.path = uploadedPath;

      step = 'carpeta';
      const carpetaRows = await db.query('SELECT * FROM sop_pdx_carpetas WHERE id = ?', [req.params.id]);
      if (!carpetaRows.length) return res.status(404).json({ error: 'Carpeta no encontrada' });
      const carpeta = carpetaRows[0];
      const vis = calcularVisibilidadPeriodo(carpeta.periodo);
      if (vis === 'archivo') return res.status(403).json({ error: 'Carpeta cerrada para carga' });

      step = 'meta';
      if (necesitaListaEstudios(carpeta)) {
        carpeta._estudiosLista = await cargarEstudiosParaOrdenes(db);
      }
      const meta = buildMetaFromUpload(req.file.originalname, req.body, carpeta);
      if (!meta.ok) {
        const tema = detectarTemaCarpeta(carpeta.nombre_display);
        return res.status(400).json({
          error: meta.error || mensajeErrorFormato(tema),
          requiere_confirmacion: !!meta.requiere_confirmacion
        });
      }

      if (req.body.paciente_documento && !meta.paciente_documento) {
        meta.paciente_documento = String(req.body.paciente_documento).trim().replace(/\s/g, '');
      }

      const warnings = collectPdxWarnings(meta, carpeta);
      step = 'disco';
      const { rutaRelativa, nombre_archivo_display } = finalizePdxFileOnDisk(
        carpeta.id,
        req.file,
        meta,
        carpeta
      );
      meta.ruta_relativa = rutaRelativa;
      meta.nombre_archivo_display = nombre_archivo_display;
      uploadedPath = null;

      step = 'insert';
      const ins = await insertPdxArchivoRow(carpeta.id, meta, req.file, req.session);
      const newId = pdxInsertId(ins);
      if (!newId) {
        throw new Error('No se obtuvo id del archivo insertado en base de datos');
      }

      await logPdxArchivo(newId, 'subida', req.session.usuarioId, req.file.originalname);
      const row = await db.query('SELECT * FROM sop_pdx_archivos WHERE id = ?', [newId]);
      if (!row.length) {
        throw new Error('Archivo guardado en BD pero no se pudo leer el registro');
      }
      res.status(201).json({
        ok: true,
        archivo: safeEnrichArchivoPdxConNombreDescarga(jsonSafeRow(row[0]), carpeta),
        warnings
      });
    } catch (e) {
      if (uploadedPath && fs.existsSync(uploadedPath)) {
        try { fs.unlinkSync(uploadedPath); } catch (_) { /* ignore */ }
      }
      logger.error('[SOPORTES] subir pdx', {
        carpetaId: req.params.id,
        step,
        message: e?.message,
        code: e?.code
      });
      res.status(500).json(pdxListErrorPayload(req, e, step));
    }
  }
);

router.get('/soportes/pdx/buscar', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, ['modulo.reportes_pdx', 'soportes.pdx.ver', 'soportes.pdx.subir']), async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ resultados: [] });
    const incluirArchivo = puedeVerArchivo(req);
    const norm = q.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const like = `%${norm.replace(/[^a-z0-9\s]/g, '%')}%`;
    const archivos = await db.query(
      `SELECT a.*, c.nombre_display AS carpeta_nombre, c.periodo, c.color_tema
       FROM sop_pdx_archivos a
       JOIN sop_pdx_carpetas c ON c.id = a.carpeta_id
       WHERE a.paciente_nombre_norm LIKE ? OR a.estudio_texto LIKE ? OR a.apellidos LIKE ? OR a.nombres LIKE ?
       ORDER BY a.fecha_estudio DESC LIMIT 80`,
      [like, like, like, like]
    );
    const resultados = archivos.filter((a) => {
      const vis = calcularVisibilidadPeriodo(a.periodo);
      return vis !== 'archivo' || incluirArchivo;
    }).map((a) => {
      const enriched = enrichArchivoPdxConNombreDescarga(a, { nombre_display: a.carpeta_nombre });
      return {
        archivo_id: a.id,
        paciente_nombre: a.paciente_nombre,
        nombre_archivo_original: a.nombre_archivo_original,
        nombre_archivo_display: a.nombre_archivo_display,
        nombre_descarga: enriched.nombre_descarga,
        fecha_estudio: a.fecha_estudio,
        estudio_texto: a.estudio_texto,
        carpeta_id: a.carpeta_id,
        carpeta_nombre: a.carpeta_nombre,
        periodo: a.periodo,
        color_tema: a.color_tema
      };
    });
    res.json({ resultados });
  } catch (e) {
    res.status(500).json({ error: safeError(e) });
  }
});

router.patch('/soportes/pdx/archivos/:id', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, ['modulo.reportes_pdx', 'soportes.pdx.editar', 'soportes.pdx.subir']), async (req, res) => {
  try {
    const rows = await db.query(
      `SELECT a.*, c.periodo, c.color_tema AS carpeta_tema, c.nombre_display AS carpeta_nombre FROM sop_pdx_archivos a
       JOIN sop_pdx_carpetas c ON c.id = a.carpeta_id WHERE a.id = ?`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Archivo no encontrado' });
    const prev = rows[0];
    const vis = calcularVisibilidadPeriodo(prev.periodo);
    if (vis === 'archivo') return res.status(403).json({ error: 'Carpeta en archivo: no editable' });

    const apellidos = req.body?.apellidos != null ? String(req.body.apellidos).trim() : prev.apellidos;
    const nombres = req.body?.nombres != null ? String(req.body.nombres).trim() : prev.nombres;
    const fecha = req.body?.fecha_estudio != null ? req.body.fecha_estudio : prev.fecha_estudio;
    const estudio = req.body?.estudio_texto != null ? String(req.body.estudio_texto).trim() : prev.estudio_texto;
    const documento = req.body?.paciente_documento != null
      ? String(req.body.paciente_documento).trim().replace(/\s/g, '')
      : (prev.paciente_documento || '');
    if (!apellidos || !nombres || !fecha) {
      return res.status(400).json({ error: 'Apellidos, nombres y fecha son obligatorios' });
    }
    const temaCarpeta = detectarTemaCarpeta(prev.carpeta_nombre);
    let estudioFinal = estudio;
    if (!estudioFinal && ['vtm', 'eeg', 'psg', 'actigrafia'].includes(temaCarpeta)) {
      estudioFinal = inferirEstudioDesdeCarpeta({ nombre_display: prev.carpeta_nombre });
    }
    if (!estudioFinal) {
      return res.status(400).json({ error: 'Apellidos, nombres, fecha y estudio son obligatorios' });
    }
    const requiereDocumento = ['ordenes', 'comprobantes', 'consentimientos'].includes(temaCarpeta);
    if (requiereDocumento && !documento) {
      return res.status(400).json({ error: 'El número de documento es obligatorio en esta carpeta' });
    }

    const pacienteNombre = `${apellidos}, ${nombres}`;

    let carpetaId = prev.carpeta_id;
    let rutaRelativa = prev.ruta_relativa;
    let carpetaCtx = { nombre_display: prev.carpeta_nombre, color_tema: prev.carpeta_tema, periodo: prev.periodo };
    const reparsed = parseNombrePorCarpeta(prev.nombre_archivo_original, carpetaCtx);
    const tipoDoc = reparsed.ok ? reparsed.tipo_documento : 'CC';
    let metaDisplay = {
      apellidos,
      nombres,
      paciente_documento: documento,
      tipo_documento: tipoDoc,
      fecha_estudio: fecha,
      estudio_texto: estudioFinal,
      nombre_archivo_original: prev.nombre_archivo_original
    };
    let nombreDisplay = prev.nombre_archivo_display;
    if (temaCarpeta === 'ordenes') {
      nombreDisplay = normalizarNombreOrdenHc({
        apellidos, nombres, tipo_documento: tipoDoc, paciente_documento: documento, fecha, estudio: estudioFinal
      });
    } else if (temaCarpeta === 'comprobantes') {
      nombreDisplay = normalizarNombreComprobante({
        apellidos, nombres, tipo_documento: tipoDoc, paciente_documento: documento, fecha, estudio: estudioFinal
      });
    } else if (temaCarpeta === 'consentimientos') {
      nombreDisplay = normalizarNombreConsentimiento({
        apellidos, nombres, tipo_documento: tipoDoc, paciente_documento: documento, fecha, estudio: estudioFinal
      });
    } else {
      nombreDisplay = nombreArchivoDescarga(metaDisplay, carpetaCtx);
    }
    metaDisplay.nombre_archivo_display = nombreDisplay;
    const warnings = [];
    let destCarpeta = null;

    const newCarpetaId = req.body?.carpeta_id != null ? parseInt(req.body.carpeta_id, 10) : null;
    if (newCarpetaId && newCarpetaId !== prev.carpeta_id) {
      const destRows = await db.query('SELECT * FROM sop_pdx_carpetas WHERE id = ?', [newCarpetaId]);
      if (!destRows.length) return res.status(404).json({ error: 'Carpeta destino no encontrada' });
      destCarpeta = destRows[0];
      const visDest = calcularVisibilidadPeriodo(destCarpeta.periodo);
      if (visDest === 'archivo') return res.status(403).json({ error: 'Carpeta destino en archivo' });
      const moved = movePdxFileOnDisk(prev.carpeta_id, newCarpetaId, prev.ruta_relativa, metaDisplay, destCarpeta);
      const destTema = detectarTemaCarpeta(destCarpeta.nombre_display);
      if (destTema === 'ordenes') {
        nombreDisplay = normalizarNombreOrdenHc({
          apellidos, nombres, tipo_documento: tipoDoc, paciente_documento: documento, fecha, estudio: estudioFinal
        });
      } else if (destTema === 'comprobantes') {
        nombreDisplay = normalizarNombreComprobante({
          apellidos, nombres, tipo_documento: tipoDoc, paciente_documento: documento, fecha, estudio: estudioFinal
        });
      } else if (destTema === 'consentimientos') {
        nombreDisplay = normalizarNombreConsentimiento({
          apellidos, nombres, tipo_documento: tipoDoc, paciente_documento: documento, fecha, estudio: estudioFinal
        });
      } else {
        nombreDisplay = nombreArchivoDescarga(metaDisplay, destCarpeta);
      }
      metaDisplay.nombre_archivo_display = nombreDisplay;
      carpetaId = newCarpetaId;
      rutaRelativa = moved.rutaRelativa;
      if (!fechaEnPeriodo(fecha, destCarpeta.periodo)) {
        warnings.push(`La fecha (${fecha}) no pertenece al mes ${destCarpeta.periodo}`);
      }
      if (!temaCoincideCarpeta(detectarTemaCarpeta(estudioFinal), destCarpeta.color_tema)) {
        warnings.push('El estudio no coincide con el tema de la carpeta destino');
      }
    } else {
      const moved = movePdxFileOnDisk(prev.carpeta_id, prev.carpeta_id, prev.ruta_relativa, metaDisplay, carpetaCtx);
      rutaRelativa = moved.rutaRelativa;
      if (!fechaEnPeriodo(fecha, prev.periodo)) {
        warnings.push(`La fecha (${fecha}) no pertenece al mes ${prev.periodo}`);
      }
      if (!temaCoincideCarpeta(detectarTemaCarpeta(estudioFinal), prev.carpeta_tema)) {
        warnings.push('El estudio no coincide con el tema de la carpeta');
      }
    }

    await db.execute(
      `UPDATE sop_pdx_archivos SET
        carpeta_id = ?, apellidos = ?, nombres = ?, paciente_nombre = ?, paciente_nombre_norm = ?,
        paciente_documento = ?, fecha_estudio = ?, estudio_texto = ?,
        ruta_relativa = ?, nombre_archivo_display = ?, editado_por = ?, editado_en = NOW()
       WHERE id = ?`,
      [
        carpetaId,
        apellidos,
        nombres,
        pacienteNombre,
        normalizarNombreBusqueda(pacienteNombre),
        documento || null,
        fecha,
        estudioFinal,
        rutaRelativa,
        nombreDisplay,
        req.session.usuarioId,
        req.params.id
      ]
    );
    const logTipo = newCarpetaId && newCarpetaId !== prev.carpeta_id ? 'movimiento' : 'edicion';
    const logDetalle = logTipo === 'movimiento'
      ? `Carpeta ${prev.carpeta_id} → ${carpetaId}`
      : 'Metadatos actualizados';
    await logPdxArchivo(req.params.id, logTipo, req.session.usuarioId, logDetalle);
    const updated = await db.query('SELECT * FROM sop_pdx_archivos WHERE id = ?', [req.params.id]);
    res.json({ ok: true, archivo: updated[0], warnings, movido: logTipo === 'movimiento' });
  } catch (e) {
    logger.error('[SOPORTES] editar archivo pdx:', e);
    res.status(500).json({ error: safeError(e) });
  }
});

router.delete('/soportes/pdx/archivos/:id', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, ['modulo.reportes_pdx', 'soportes.pdx.eliminar']), async (req, res) => {
  try {
    const rows = await db.query('SELECT * FROM sop_pdx_archivos WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'No encontrado' });
    const fp = resolvePdxArchivoPath(rows[0]);
    if (fp) fs.unlinkSync(fp);
    await db.execute('DELETE FROM sop_pdx_archivos WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: safeError(e) });
  }
});

router.get('/soportes/pdx/archivos/:id/descargar', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, ['modulo.reportes_pdx', 'soportes.pdx.ver', 'soportes.pdx.subir']), async (req, res) => {
  try {
    const rows = await db.query(
      `SELECT a.*, c.periodo, c.nombre_display AS carpeta_nombre FROM sop_pdx_archivos a
       JOIN sop_pdx_carpetas c ON c.id = a.carpeta_id WHERE a.id = ?`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'No encontrado' });
    const row = rows[0];
    const vis = calcularVisibilidadPeriodo(row.periodo);
    if (vis === 'archivo' && !puedeVerArchivo(req)) return res.status(403).json({ error: 'Archivo en carpeta cerrada' });
    const fp = await resolvePdxArchivoPathForApi(row, true);
    if (!fp) return res.status(404).json({ error: 'Archivo no en disco' });
    const downloadName = buildNombreDescargaPdxDesdeRow(row, { nombre_display: row.carpeta_nombre })
      || row.nombre_archivo_original
      || 'archivo.pdf';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${String(downloadName).replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`
    );
    fs.createReadStream(fp).pipe(res);
  } catch (e) {
    res.status(500).json({ error: safeError(e) });
  }
});

router.get('/soportes/pdx/archivos/:id/ver', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, ['modulo.reportes_pdx', 'soportes.pdx.ver', 'soportes.pdx.subir']), async (req, res) => {
  try {
    const rows = await db.query(
      `SELECT a.*, c.periodo FROM sop_pdx_archivos a JOIN sop_pdx_carpetas c ON c.id = a.carpeta_id WHERE a.id = ?`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'No encontrado' });
    const vis = calcularVisibilidadPeriodo(rows[0].periodo);
    if (vis === 'archivo' && !puedeVerArchivo(req)) return res.status(403).json({ error: 'Archivo en carpeta cerrada' });
    const fp = await resolvePdxArchivoPathForApi(rows[0], true);
    if (!fp) return res.status(404).json({ error: 'Archivo no en disco' });
    const name = rows[0].nombre_archivo_display || rows[0].nombre_archivo_original;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(name)}"`);
    fs.createReadStream(fp).pipe(res);
  } catch (e) {
    res.status(500).json({ error: safeError(e) });
  }
});

router.get('/soportes/pdx/archivos/:id/historial', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, ['modulo.reportes_pdx', 'soportes.pdx.ver', 'soportes.pdx.subir']), async (req, res) => {
  try {
    const rows = await db.query(
      `SELECT l.*, u.nombre AS usuario_nombre
       FROM sop_pdx_archivo_log l
       LEFT JOIN usuarios u ON u.id = l.usuario_id
       WHERE l.archivo_id = ? ORDER BY l.creado_en DESC LIMIT 50`,
      [req.params.id]
    );
    res.json({ eventos: rows });
  } catch (e) {
    res.json({ eventos: [] });
  }
});

router.post(
  '/soportes/pdx/archivos/:id/reemplazar',
  requireAuth,
  requireRoleOrPerm(ROLES_SOPORTES, ['modulo.reportes_pdx', 'soportes.pdx.editar', 'soportes.pdx.subir']),
  uploadPdxReemplazar.single('file'),
  validateMagicBytes,
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'Archivo PDF requerido' });
      const rows = await db.query(
        `SELECT a.*, c.periodo, c.color_tema, c.nombre_display FROM sop_pdx_archivos a
         JOIN sop_pdx_carpetas c ON c.id = a.carpeta_id WHERE a.id = ?`,
        [req.params.id]
      );
      if (!rows.length) return res.status(404).json({ error: 'Archivo no encontrado' });
      const prev = rows[0];
      const vis = calcularVisibilidadPeriodo(prev.periodo);
      if (vis === 'archivo') return res.status(403).json({ error: 'Carpeta cerrada' });

      const carpetaCtx = { periodo: prev.periodo, color_tema: prev.color_tema, nombre_display: prev.nombre_display };
      if (necesitaListaEstudios(carpetaCtx)) {
        carpetaCtx._estudiosLista = await cargarEstudiosParaOrdenes(db);
      }
      const meta = buildMetaFromUpload(req.file.originalname, req.body, carpetaCtx);
      if (!meta.ok) {
        const tema = detectarTemaCarpeta(prev.nombre_display);
        return res.status(400).json({
          error: meta.error || mensajeErrorFormato(tema),
          requiere_confirmacion: !!meta.requiere_confirmacion
        });
      }

      const warnings = collectPdxWarnings(meta, carpetaCtx);
      const oldFp = resolveStoragePath(prev.ruta_relativa);
      if (oldFp && fs.existsSync(oldFp)) {
        try { fs.unlinkSync(oldFp); } catch (_) { /* ignore */ }
      }

      const { rutaRelativa, nombre_archivo_display } = finalizePdxFileOnDisk(
        prev.carpeta_id,
        req.file,
        meta,
        carpetaCtx
      );

      ensureMetaPacienteNombre(meta, req.file.originalname);

      await db.execute(
        `UPDATE sop_pdx_archivos SET
          apellidos = ?, nombres = ?, paciente_nombre = ?, paciente_nombre_norm = ?,
          paciente_documento = ?, fecha_estudio = ?, marca_tiempo = ?, sufijo_numero = ?, estudio_texto = ?,
          nombre_archivo_original = ?, nombre_archivo_display = ?, ruta_relativa = ?,
          tamano_bytes = ?, editado_por = ?, editado_en = NOW()
         WHERE id = ?`,
        [
          meta.apellidos, meta.nombres, meta.paciente_nombre, meta.paciente_nombre_norm,
          meta.paciente_documento || null,
          meta.fecha_estudio, meta.marca_tiempo, meta.sufijo_numero, meta.estudio_texto,
          req.file.originalname, nombre_archivo_display, rutaRelativa, req.file.size,
          req.session.usuarioId, req.params.id
        ]
      );
      await logPdxArchivo(req.params.id, 'reemplazo', req.session.usuarioId, req.file.originalname);
      const updated = await db.query('SELECT * FROM sop_pdx_archivos WHERE id = ?', [req.params.id]);
      res.json({ ok: true, archivo: updated[0], warnings });
    } catch (e) {
      logger.error('[SOPORTES] reemplazar pdx:', e);
      res.status(500).json({ error: safeError(e) });
    }
  }
);

// ─── Soportes (armado): mes → día → RIPS|SOPORTES → FE{n} ───────────────────

async function resolveExpedienteContext(expedienteId) {
  const rows = await db.query(
    `SELECT e.*, c.tipo AS contenedor_tipo, c.id AS contenedor_id,
            d.id AS dia_id, d.dia, d.nombre_display, d.estado_facturacion,
            p.periodo, p.etiqueta AS periodo_etiqueta
     FROM sop_expedientes e
     LEFT JOIN sop_contenedores c ON c.id = e.contenedor_id
     LEFT JOIN sop_dias d ON d.id = COALESCE(c.dia_id, e.dia_id)
     LEFT JOIN sop_periodos p ON p.id = d.periodo_id
     WHERE e.id = ?`,
    [expedienteId]
  );
  return rows[0] || null;
}

async function resolveContenedorContext(contenedorId) {
  const rows = await db.query(
    `SELECT c.*, c.tipo AS contenedor_tipo, d.dia, d.nombre_display, d.estado_facturacion, d.periodo_id, p.periodo, p.etiqueta AS periodo_etiqueta
     FROM sop_contenedores c
     JOIN sop_dias d ON d.id = c.dia_id
     JOIN sop_periodos p ON p.id = d.periodo_id
     WHERE c.id = ?`,
    [contenedorId]
  );
  return rows[0] || null;
}

function mapDia(row) {
  return {
    id: row.id,
    periodo_id: row.periodo_id,
    dia: row.dia,
    fecha: row.fecha,
    nombre_display: row.nombre_display || `Día ${row.dia}`,
    estado_facturacion: row.estado_facturacion || 'a_facturar',
    expedientes_count: row.expedientes_count || 0,
    creado_en: row.creado_en
  };
}

function mapContenedor(row) {
  return {
    id: row.id,
    dia_id: row.dia_id,
    tipo: row.tipo,
    expedientes_count: row.expedientes_count || 0,
    creado_en: row.creado_en
  };
}

function mapPeriodo(row) {
  const periodo = row.periodo;
  return {
    id: row.id,
    periodo,
    etiqueta: row.etiqueta,
    estado_visibilidad: calcularVisibilidadPeriodo(periodo),
    dias_restantes_gracia: diasRestantesGracia(periodo),
    expedientes_count: row.expedientes_count || 0
  };
}

router.get('/soportes/armado/periodos', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, 'modulo.armado_soportes'), async (req, res) => {
  try {
    const incluirArchivo = puedeVerArchivo(req) && req.query.archivo === '1';
    const rows = await db.query(`
      SELECT p.*, COUNT(DISTINCT e.id) AS expedientes_count
      FROM sop_periodos p
      LEFT JOIN sop_dias d ON d.periodo_id = p.id
      LEFT JOIN sop_expedientes e ON e.dia_id = d.id OR e.contenedor_id IN (SELECT id FROM sop_contenedores WHERE dia_id = d.id)
      GROUP BY p.id ORDER BY p.periodo DESC
    `);
    const lista = rows.map(mapPeriodo).filter((p) => p.estado_visibilidad !== 'archivo' || incluirArchivo);
    res.json({ periodos: lista });
  } catch (e) {
    res.status(500).json({ error: safeError(e) });
  }
});

router.post('/soportes/armado/periodos', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, 'soportes.armado.crear_estructura'), async (req, res) => {
  try {
    const { periodo, etiqueta } = req.body || {};
    if (!periodo || !/^\d{4}-\d{2}$/.test(periodo)) return res.status(400).json({ error: 'periodo inválido' });
    const label = etiqueta || periodo;
    const vis = calcularVisibilidadPeriodo(periodo);
    const r = await db.execute(
      'INSERT INTO sop_periodos (periodo, etiqueta, estado_visibilidad, creado_por) VALUES (?,?,?,?)',
      [periodo, label, vis, req.session.usuarioId]
    );
    const rows = await db.query('SELECT * FROM sop_periodos WHERE id = ?', [r.insertId]);
    res.status(201).json({ ok: true, periodo: mapPeriodo({ ...rows[0], expedientes_count: 0 }) });
  } catch (e) {
    if (String(e.message).includes('Duplicate')) return res.status(409).json({ error: 'El periodo ya existe' });
    res.status(500).json({ error: safeError(e) });
  }
});

router.get('/soportes/armado/periodos/:id/dias', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, 'modulo.armado_soportes'), async (req, res) => {
  try {
    const dias = await db.query(
      `SELECT d.*, COUNT(e.id) AS expedientes_count
       FROM sop_dias d
       LEFT JOIN sop_contenedores c ON c.dia_id = d.id
       LEFT JOIN sop_expedientes e ON e.contenedor_id = c.id
       WHERE d.periodo_id = ?
       GROUP BY d.id ORDER BY d.nombre_display ASC, d.id ASC`,
      [req.params.id]
    );
    res.json({ dias: dias.map(mapDia) });
  } catch (e) {
    res.status(500).json({ error: safeError(e) });
  }
});

router.post('/soportes/armado/periodos/:id/dias', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, 'soportes.armado.crear_estructura'), async (req, res) => {
  try {
    const nombre_display = String(req.body.nombre_display || '').trim();
    const estado_facturacion = req.body.estado_facturacion === 'facturados' ? 'facturados' : 'a_facturar';
    if (!nombre_display) return res.status(400).json({ error: 'Indique el nombre de la carpeta del día (ej: MAYO 1, MAYO 2-3)' });
    const periodo = await db.query('SELECT periodo FROM sop_periodos WHERE id = ?', [req.params.id]);
    if (!periodo.length) return res.status(404).json({ error: 'Periodo no encontrado' });
    const fechaDate = req.body.fecha || `${periodo[0].periodo}-01`;
    const r = await db.execute(
      'INSERT INTO sop_dias (periodo_id, dia, fecha, nombre_display, estado_facturacion) VALUES (?,?,?,?,?)',
      [req.params.id, 0, fechaDate, nombre_display, estado_facturacion]
    );
    const diaId = r.insertId;
    await ensureContenedoresForDia(db, diaId);
    const contenedores = await db.query('SELECT * FROM sop_contenedores WHERE dia_id = ? ORDER BY tipo', [diaId]);
    const row = await db.query('SELECT * FROM sop_dias WHERE id = ?', [diaId]);
    res.status(201).json({
      ok: true,
      dia: mapDia({ ...row[0], expedientes_count: 0 }),
      contenedores: contenedores.map(mapContenedor)
    });
  } catch (e) {
    if (String(e.message).includes('uk_sop_dia_nombre')) return res.status(409).json({ error: 'Ya existe una carpeta con ese nombre en el mes' });
    res.status(500).json({ error: safeError(e) });
  }
});

router.patch('/soportes/armado/dias/:id', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, 'soportes.armado.crear_estructura'), async (req, res) => {
  try {
    const result = await actualizarDia(req.params.id, req.body || {});
    if (result.error) return res.status(result.status || 400).json({ error: result.error });
    const contenedores = await db.query(
      `SELECT c.*, COUNT(e.id) AS expedientes_count
       FROM sop_contenedores c
       LEFT JOIN sop_expedientes e ON e.contenedor_id = c.id
       WHERE c.dia_id = ?
       GROUP BY c.id ORDER BY FIELD(c.tipo, 'rips', 'soportes')`,
      [req.params.id]
    );
    res.json({
      ok: true,
      dia: mapDia({ ...result.dia, expedientes_count: contenedores.reduce((s, c) => s + (c.expedientes_count || 0), 0) }),
      contenedores: contenedores.map(mapContenedor)
    });
  } catch (e) {
    logger.error('[SOPORTES] PATCH dia:', e);
    res.status(500).json({ error: safeError(e) });
  }
});

router.delete('/soportes/armado/dias/:id', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, 'soportes.armado.crear_estructura'), async (req, res) => {
  try {
    const result = await eliminarDia(req.params.id);
    if (result.error) return res.status(result.status || 400).json({ error: result.error });
    res.json(result);
  } catch (e) {
    logger.error('[SOPORTES] DELETE dia:', e);
    res.status(500).json({ error: safeError(e) });
  }
});

router.get('/soportes/armado/dias/:id/contenedores', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, 'modulo.armado_soportes'), async (req, res) => {
  try {
    const dia = await db.query('SELECT * FROM sop_dias WHERE id = ?', [req.params.id]);
    if (!dia.length) return res.status(404).json({ error: 'Carpeta de día no encontrada' });
    await ensureContenedoresForDia(db, req.params.id);
    const contenedores = await db.query(
      `SELECT c.*, COUNT(e.id) AS expedientes_count
       FROM sop_contenedores c
       LEFT JOIN sop_expedientes e ON e.contenedor_id = c.id
       WHERE c.dia_id = ?
       GROUP BY c.id ORDER BY FIELD(c.tipo, 'rips', 'soportes')`,
      [req.params.id]
    );
    res.json({ dia: mapDia({ ...dia[0], expedientes_count: contenedores.reduce((s, c) => s + (c.expedientes_count || 0), 0) }), contenedores: contenedores.map(mapContenedor) });
  } catch (e) {
    res.status(500).json({ error: safeError(e) });
  }
});

async function buildExpedienteDetail(expId) {
  const ctx = await resolveExpedienteContext(expId);
  if (!ctx) return null;
  const e = ctx;
  const nit = getNitObligado();
  const req = slotRequirements(e.contenedor_tipo, e.tipo_servicio);

  if (e.contenedor_tipo === 'rips') {
    const archivos = await db.query('SELECT * FROM sop_rips_archivos WHERE expediente_id = ?', [expId]);
    const slotMap = {
      RIPS_JSON_1: { completo: false },
      RIPS_JSON_2: { completo: false },
      RIPS_XML: { completo: false }
    };
    const slotKey = { json_1: 'RIPS_JSON_1', json_2: 'RIPS_JSON_2', xml: 'RIPS_XML' };
    for (const a of archivos) {
      const key = slotKey[a.slot] || a.slot;
      slotMap[key] = {
        completo: true,
        archivo_id: a.id,
        nombre_archivo: a.nombre_archivo,
        nombre_original: a.nombre_original,
        origen: a.origen
      };
    }
    return {
      ...e,
      nit_obligado: nit,
      requisitos: req,
      slots: slotMap,
      paquete_completo: !!(slotMap.RIPS_JSON_1.completo && slotMap.RIPS_JSON_2.completo && slotMap.RIPS_XML.completo)
    };
  }

  const archivos = await db.query('SELECT * FROM sop_exp_archivos WHERE expediente_id = ?', [expId]);
  const slots = { OPF: null, CRC: null, FEV: null, PDX: null, HEV: null };
  for (const a of archivos) {
    slots[a.tipo] = {
      completo: true,
      archivo_id: a.id,
      nombre_archivo: a.nombre_archivo,
      nombre_original: a.nombre_original,
      origen: a.origen,
      pdx_archivo_id: a.pdx_archivo_id
    };
  }
  const hasPdx = !!slots.PDX?.completo;
  const hasHev = !!slots.HEV?.completo;
  const tipoPendiente = !hasPdx && !hasHev;
  const slotState = {
    OPF: slots.OPF || { completo: false },
    CRC: slots.CRC || { completo: false },
    FEV: { completo: !!(e.fev_externa_verificada || slots.FEV), externa: true, archivo: slots.FEV },
    PDX: tipoPendiente
      ? { completo: false, habilitado: true }
      : hasHev
        ? { completo: false, habilitado: false }
        : (slots.PDX || { completo: false, habilitado: true }),
    HEV: tipoPendiente
      ? { completo: false, habilitado: true }
      : hasPdx
        ? { completo: false, habilitado: false }
        : (slots.HEV || { completo: false, habilitado: true })
  };
  const estudioOk = hasPdx || hasHev;
  const paquete = slotState.OPF.completo && slotState.CRC.completo && slotState.FEV.completo && estudioOk;
  return {
    ...e,
    nit_obligado: nit,
    fev_nombre_ejemplo: fevFilenameHint(
      e.numero_factura != null && Number(e.numero_factura) > 0 ? e.numero_factura : '14726'
    ),
    requisitos: req,
    slots: slotState,
    paquete_completo: paquete && !!e.listo_radicacion
  };
}

router.get('/soportes/armado/dias/:id/expedientes', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, 'modulo.armado_soportes'), async (req, res) => {
  try {
    const rows = await db.query(
      `SELECT e.id, e.codigo, e.numero_factura, e.listo_radicacion, c.tipo AS contenedor_tipo
       FROM sop_expedientes e
       JOIN sop_contenedores c ON c.id = e.contenedor_id
       WHERE c.dia_id = ?
       ORDER BY c.tipo, e.numero_factura ASC`,
      [req.params.id]
    );
    res.json({ expedientes: rows });
  } catch (e) {
    res.status(500).json({ error: safeError(e) });
  }
});

router.get('/soportes/armado/contenedores/:id/expedientes', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, 'modulo.armado_soportes'), async (req, res) => {
  try {
    const ctx = await resolveContenedorContext(req.params.id);
    if (!ctx) return res.status(404).json({ error: 'Contenedor no encontrado' });
    const rows = await db.query(
      `SELECT id, codigo, numero_factura, paciente_nombre, listo_radicacion
       FROM sop_expedientes WHERE contenedor_id = ?
       ORDER BY (numero_factura = 0) DESC, paciente_nombre ASC, numero_factura ASC`,
      [req.params.id]
    );
    res.json({ contenedor: mapContenedor({ ...ctx, expedientes_count: rows.length }), expedientes: rows });
  } catch (e) {
    res.status(500).json({ error: safeError(e) });
  }
});

async function codigoDisponibleEnContenedor(contenedorId, codigo, excludeId = null) {
  const params = [contenedorId, codigo];
  let sql = 'SELECT id FROM sop_expedientes WHERE contenedor_id = ? AND codigo = ?';
  if (excludeId) {
    sql += ' AND id <> ?';
    params.push(excludeId);
  }
  const rows = await db.query(sql, params);
  return rows.length === 0;
}

async function crearExpedienteEnContenedor(contenedorId, body, usuarioId) {
  const ctx = await resolveContenedorContext(contenedorId);
  if (!ctx) return { error: 'Contenedor no encontrado', status: 404 };

  let codigo;
  let numero;
  let pacienteNombre = body.paciente_nombre ? String(body.paciente_nombre).trim() : null;

  if (body.paciente_linea || pacienteNombre) {
    const parsed = parseLineaPaciente(body.paciente_linea || pacienteNombre);
    if (!parsed) {
      return { error: 'Indique nombre y apellido (ej. Juan Pérez o Pérez, Juan)', status: 400 };
    }
    codigo = body.codigo || parsed.codigo;
    pacienteNombre = parsed.paciente_nombre;
    numero = null;
  } else if (body.codigo) {
    const parsed = parseFeCodigo(body.codigo);
    if (parsed.ok) {
      codigo = parsed.codigo;
      numero = parsed.numero;
    } else {
      codigo = String(body.codigo).trim().slice(0, 32);
      numero = parseInt(body.numero_factura, 10) || 0;
      pacienteNombre = pacienteNombre || codigo;
    }
  } else {
    const num = parseInt(body.numero_factura, 10);
    if (!num || num < 1) return { error: 'Indique paciente (nombre apellido) o FE{número}', status: 400 };
    codigo = `FE${num}`;
    numero = num;
  }

  if (!(await codigoDisponibleEnContenedor(contenedorId, codigo))) {
    return { error: `Ya existe la carpeta "${codigo}" en este contenedor`, status: 409 };
  }

  await ensureContenedoresForDia(db, ctx.dia_id);
  getArmadoFeDirFromContext(ctx, codigo);
  const ts = 'electro';
  const r = await db.execute(
    `INSERT INTO sop_expedientes (dia_id, contenedor_id, codigo, numero_factura, paciente_nombre, paciente_documento, tipo_servicio, creado_por)
     VALUES (?,?,?,?,?,?,?,?)`,
    [ctx.dia_id, contenedorId, codigo, numero, pacienteNombre, null, ts, usuarioId]
  );
  try {
    await ensureFeParEnContenedorHermano(db, ctx.dia_id, contenedorId, codigo, numero, ts, usuarioId, pacienteNombre);
  } catch (e) {
    logger.warn('[SOPORTES] carpeta par RIPS/SOPORTES:', e.message);
  }
  const detail = await buildExpedienteDetail(r.insertId);
  return { ok: true, expediente: detail, codigo, par_creado: true };
}

async function crearExpedientesLote(contenedorId, body, usuarioId) {
  const lista = parseListaPacientes(body.lista || body.texto || '');
  if (!lista.length) {
    return { error: 'No se encontraron líneas válidas. Use una línea por paciente: Nombre Apellido', status: 400 };
  }
  const creados = [];
  const errores = [];
  for (const p of lista) {
    try {
      const result = await crearExpedienteEnContenedor(
        contenedorId,
        { paciente_nombre: p.paciente_nombre, codigo: p.codigo },
        usuarioId
      );
      if (result.ok) {
        creados.push({
          id: result.expediente?.id,
          codigo: result.codigo,
          paciente_nombre: p.paciente_nombre
        });
      } else {
        errores.push({ paciente: p.paciente_nombre, error: result.error });
      }
    } catch (e) {
      logger.error('[SOPORTES] lote expediente:', e);
      errores.push({ paciente: p.paciente_nombre, error: safeError(e) });
    }
  }
  return { ok: true, creados, errores, total: lista.length };
}

router.post('/soportes/armado/contenedores/:id/expedientes', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, 'soportes.armado.crear_estructura'), async (req, res) => {
  try {
    const result = await crearExpedienteEnContenedor(req.params.id, req.body || {}, req.session.usuarioId);
    if (result.error) return res.status(result.status || 400).json({ error: result.error });
    res.status(201).json(result);
  } catch (e) {
    if (String(e.message).includes('uk_sop_exp_cont')) return res.status(409).json({ error: 'Ese código FE ya existe en esta carpeta' });
    res.status(500).json({ error: safeError(e) });
  }
});

router.post('/soportes/armado/contenedores/:id/expedientes/lote', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, 'soportes.armado.crear_estructura'), async (req, res) => {
  try {
    const result = await crearExpedientesLote(req.params.id, req.body || {}, req.session.usuarioId);
    if (result.error) return res.status(result.status || 400).json({ error: result.error });
    res.status(201).json(result);
  } catch (e) {
    res.status(500).json({ error: safeError(e) });
  }
});

router.post('/soportes/armado/contenedores/:id/expedientes/siguiente', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, 'soportes.armado.crear_estructura'), async (req, res) => {
  try {
    const ctx = await resolveContenedorContext(req.params.id);
    if (!ctx) return res.status(404).json({ error: 'Contenedor no encontrado' });
    const maxRows = await db.query(
      'SELECT MAX(numero_factura) AS mx FROM sop_expedientes WHERE contenedor_id = ?',
      [req.params.id]
    );
    const siguiente = (parseInt(maxRows[0]?.mx, 10) || 0) + 1;
    const result = await crearExpedienteEnContenedor(
      req.params.id,
      { ...req.body, numero_factura: req.body?.numero_factura || siguiente },
      req.session.usuarioId
    );
    if (result.error) return res.status(result.status || 400).json({ error: result.error });
    res.status(201).json({ ...result, numero_sugerido: siguiente });
  } catch (e) {
    if (String(e.message).includes('uk_sop_exp_cont')) return res.status(409).json({ error: 'Ese código FE ya existe en esta carpeta' });
    res.status(500).json({ error: safeError(e) });
  }
});

router.post('/soportes/armado/dias/:id/expedientes', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, 'soportes.armado.crear_estructura'), async (req, res) => {
  try {
    const tipo = req.body?.contenedor === 'rips' ? 'rips' : 'soportes';
    const c = await db.query('SELECT id FROM sop_contenedores WHERE dia_id = ? AND tipo = ?', [req.params.id, tipo]);
    if (!c.length) return res.status(404).json({ error: 'Contenedor no encontrado' });
    const result = await crearExpedienteEnContenedor(c[0].id, req.body || {}, req.session.usuarioId);
    if (result.error) return res.status(result.status || 400).json({ error: result.error });
    res.status(201).json(result);
  } catch (e) {
    if (String(e.message).includes('uk_sop_exp_cont')) return res.status(409).json({ error: 'Ese código FE ya existe en esta carpeta' });
    res.status(500).json({ error: safeError(e) });
  }
});

router.post('/soportes/armado/dias/:id/expedientes/siguiente', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, 'soportes.armado.crear_estructura'), async (req, res) => {
  try {
    const tipo = req.body?.contenedor === 'rips' ? 'rips' : 'soportes';
    const c = await db.query('SELECT id FROM sop_contenedores WHERE dia_id = ? AND tipo = ?', [req.params.id, tipo]);
    if (!c.length) return res.status(404).json({ error: 'Contenedor no encontrado' });
    const maxRows = await db.query(
      'SELECT MAX(numero_factura) AS mx FROM sop_expedientes WHERE contenedor_id = ?',
      [c[0].id]
    );
    const siguiente = (parseInt(maxRows[0]?.mx, 10) || 0) + 1;
    const result = await crearExpedienteEnContenedor(
      c[0].id,
      { ...req.body, numero_factura: req.body?.numero_factura || siguiente },
      req.session.usuarioId
    );
    if (result.error) return res.status(result.status || 400).json({ error: result.error });
    res.status(201).json({ ...result, numero_sugerido: siguiente });
  } catch (e) {
    if (String(e.message).includes('uk_sop_exp_cont')) return res.status(409).json({ error: 'Ese código FE ya existe en esta carpeta' });
    res.status(500).json({ error: safeError(e) });
  }
});

router.get('/soportes/armado/expedientes/:id', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, 'modulo.armado_soportes'), async (req, res) => {
  try {
    const detail = await buildExpedienteDetail(req.params.id);
    if (!detail) return res.status(404).json({ error: 'Expediente no encontrado' });
    res.json({ expediente: detail });
  } catch (e) {
    res.status(500).json({ error: safeError(e) });
  }
});

router.patch('/soportes/armado/expedientes/:id', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, 'soportes.armado.subir'), async (req, res) => {
  try {
    const result = await actualizarExpediente(req.params.id, req.body || {});
    if (result.error) return res.status(result.status || 400).json({ error: result.error });
    const detail = await buildExpedienteDetail(req.params.id);
    res.json({ ok: true, expediente: detail });
  } catch (e) {
    res.status(500).json({ error: safeError(e) });
  }
});

router.delete('/soportes/armado/expedientes/:id', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, 'soportes.armado.crear_estructura'), async (req, res) => {
  try {
    const result = await eliminarExpediente(req.params.id);
    if (result.error) return res.status(result.status || 400).json({ error: result.error });
    res.json(result);
  } catch (e) {
    logger.error('[SOPORTES] eliminar expediente:', e);
    res.status(500).json({ error: safeError(e) });
  }
});

router.post('/soportes/armado/expedientes/:id/importar-pdx', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, 'soportes.armado.importar_pdx'), async (req, res) => {
  try {
    const pdxId = parseInt(req.body.pdx_archivo_id, 10);
    if (!pdxId) return res.status(400).json({ error: 'pdx_archivo_id requerido' });
    const exp = await resolveExpedienteContext(req.params.id);
    if (!exp) return res.status(404).json({ error: 'Expediente no encontrado' });
    const hev = await db.query('SELECT id FROM sop_exp_archivos WHERE expediente_id = ? AND tipo = ?', [req.params.id, 'HEV']);
    if (hev.length) return res.status(400).json({ error: 'Ya existe HEV en este expediente; no puede importar PDX' });

    const pdx = await db.query(
      `SELECT a.*, c.periodo FROM sop_pdx_archivos a JOIN sop_pdx_carpetas c ON c.id = a.carpeta_id WHERE a.id = ?`,
      [pdxId]
    );
    if (!pdx.length) return res.status(404).json({ error: 'PDX no encontrado' });

    const warnings = [];
    if (pdx[0].periodo !== exp.periodo) {
      warnings.push(`PDX del mes ${pdx[0].periodo} → expediente en periodo ${exp.periodo}`);
    }

    const src = resolveStoragePath(pdx[0].ruta_relativa);
    if (!src || !fs.existsSync(src)) return res.status(404).json({ error: 'Archivo PDX no en disco' });

    const { saveSoportesArchivo } = require('../utils/soportes-fe-upload');
    const tmpCopy = path.join(require('os').tmpdir(), `innar-pdx-${Date.now()}.pdf`);
    fs.copyFileSync(src, tmpCopy);
    await saveSoportesArchivo(
      exp,
      exp,
      'PDX',
      tmpCopy,
      pdx[0].nombre_archivo_original,
      req.session.usuarioId,
      'copia_pdx'
    );
    try { fs.unlinkSync(tmpCopy); } catch (_) { /* ignore */ }
    await db.execute(
      'UPDATE sop_exp_archivos SET pdx_archivo_id = ? WHERE expediente_id = ? AND tipo = ?',
      [pdxId, req.params.id, 'PDX']
    );
    await db.execute(
      'INSERT INTO sop_transferencias (pdx_archivo_id, expediente_id, usuario_id) VALUES (?,?,?)',
      [pdxId, req.params.id, req.session.usuarioId]
    );

    const detail = await buildExpedienteDetail(req.params.id);
    res.json({ ok: true, expediente: detail, warnings });
  } catch (e) {
    logger.error('[SOPORTES] importar pdx:', e);
    res.status(500).json({ error: safeError(e) });
  }
});

router.get('/soportes/armado/expedientes/:id/requisitos', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, 'modulo.armado_soportes'), async (req, res) => {
  try {
    const exp = await resolveExpedienteContext(req.params.id);
    if (!exp) return res.status(404).json({ error: 'No encontrado' });
    const reqSlots = slotRequirements(exp.contenedor_tipo, exp.tipo_servicio);
    res.json({
      codigo_fe: exp.codigo,
      numero_factura: exp.numero_factura,
      nit_obligado: getNitObligado(),
      ...reqSlots,
      fev_nombre_ejemplo: fevFilenameHint(exp.numero_factura > 0 ? exp.numero_factura : '14726'),
      ejemplos_nombre: {
        OPF: buildCanonicalName('OPF', exp.numero_factura || 'FE14726', '.pdf'),
        CRC: buildCanonicalName('CRC', exp.numero_factura || 'FE14726', '.pdf'),
        FEV: buildCanonicalName('FEV', exp.numero_factura || 'FE14726', '.pdf'),
        PDX: buildCanonicalName('PDX', exp.numero_factura || 'FE14726', '.pdf'),
        HEV: buildCanonicalName('HEV', exp.numero_factura || 'FE14726', '.pdf')
      }
    });
  } catch (e) {
    res.status(500).json({ error: safeError(e) });
  }
});

function armadoUploadError(err, req, res, next) {
  if (!err) return next();
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'El archivo supera el tamaño máximo (20 MB).' });
  }
  const msg = err.message || 'Error al subir el archivo';
  if (err.code === 'LIMIT_UNEXPECTED_FILE' || /permiten|PDF/i.test(msg)) {
    return res.status(400).json({ error: msg });
  }
  next(err);
}

/** Subida: OPF/CRC/… conservan nombre; FEV_{NIT}_{n}.pdf renombra carpeta y archivos */
router.post(
  '/soportes/armado/expedientes/:id/upload',
  requireAuth,
  requireRoleOrPerm(ROLES_SOPORTES, 'soportes.armado.subir'),
  (req, res, next) => {
    uploadArmadoSoportes.single('file')(req, res, (err) => {
      if (err) return armadoUploadError(err, req, res, next);
      next();
    });
  },
  validateMagicBytes,
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'Archivo requerido' });
      const exp = await resolveExpedienteContext(req.params.id);
      if (!exp) return res.status(404).json({ error: 'Expediente no encontrado' });
      const tipoManual = req.body?.tipo ? String(req.body.tipo).toUpperCase() : null;
      const result = await ingestFeArchivo(
        exp,
        exp,
        req.file.path,
        req.file.originalname,
        req.session.usuarioId,
        tipoManual
      );
      if (!result.ok) {
        return res.status(result.status || 400).json(result);
      }
      const detail = await buildExpedienteDetail(req.params.id);
      res.json({
        ok: true,
        message: result.message || `Archivo ${result.tipo_detectado} guardado`,
        ...result,
        expediente: detail
      });
    } catch (e) {
      logger.error('[SOPORTES] upload smart:', e);
      res.status(500).json({ error: safeError(e) });
    }
  }
);

router.post(
  '/soportes/armado/expedientes/:id/archivos/:tipo',
  requireAuth,
  requireRoleOrPerm(ROLES_SOPORTES, 'soportes.armado.subir'),
  (req, res, next) => {
    uploadArmadoSoportes.single('file')(req, res, (err) => {
      if (err) return armadoUploadError(err, req, res, next);
      next();
    });
  },
  validateMagicBytes,
  async (req, res) => {
    try {
      const tipo = String(req.params.tipo || '').toUpperCase();
      if (!req.file) return res.status(400).json({ error: 'Archivo requerido' });
      const exp = await resolveExpedienteContext(req.params.id);
      if (!exp) return res.status(404).json({ error: 'Expediente no encontrado' });
      const result = await ingestFeArchivo(exp, exp, req.file.path, req.file.originalname, req.session.usuarioId, tipo);
      if (!result.ok) return res.status(result.status || 400).json(result);
      const detail = await buildExpedienteDetail(req.params.id);
      res.json({ ok: true, expediente: detail, ...result });
    } catch (e) {
      res.status(500).json({ error: safeError(e) });
    }
  }
);

router.get('/soportes/armado/expedientes/:id/zip', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, 'soportes.descargar_zip'), async (req, res) => {
  try {
    const exp = await resolveExpedienteContext(req.params.id);
    if (!exp) return res.status(404).json({ error: 'No encontrado' });
    const archivos = await db.query('SELECT * FROM sop_exp_archivos WHERE expediente_id = ?', [req.params.id]);
    let ripsArchivos = [];
    try {
      ripsArchivos = await db.query('SELECT * FROM sop_rips_archivos WHERE expediente_id = ?', [req.params.id]);
    } catch (_) { /* ignore */ }
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${exp.codigo}.zip"`);
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => { throw err; });
    archive.pipe(res);
    for (const a of archivos) {
      const fp = resolveStoragePath(path.join('soportes', a.ruta_relativa));
      if (fp && fs.existsSync(fp)) archive.file(fp, { name: a.nombre_archivo });
    }
    for (const a of ripsArchivos) {
      const fp = resolveStoragePath(path.join('soportes', a.ruta_relativa));
      if (fp && fs.existsSync(fp)) archive.file(fp, { name: a.nombre_archivo });
    }
    archive.finalize();
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: safeError(e) });
  }
});

router.get('/soportes/armado/buscar', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, 'modulo.armado_soportes'), async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ resultados: [] });
    const norm = q.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const like = `%${norm.replace(/[^a-z0-9\s]/g, '%')}%`;
    const docLike = `%${q.replace(/\s/g, '')}%`;
    const rows = await db.query(
      `SELECT e.id AS expediente_id, e.codigo, e.paciente_nombre, e.paciente_documento, e.numero_factura,
              c.id AS contenedor_id, c.tipo AS contenedor_tipo,
              d.id AS dia_id, d.nombre_display AS dia_nombre,
              p.id AS periodo_id, p.periodo, p.etiqueta AS periodo_etiqueta
       FROM sop_expedientes e
       JOIN sop_contenedores c ON c.id = e.contenedor_id
       JOIN sop_dias d ON d.id = c.dia_id
       JOIN sop_periodos p ON p.id = d.periodo_id
       WHERE LOWER(e.paciente_nombre) LIKE ? OR LOWER(e.codigo) LIKE ?
          OR REPLACE(COALESCE(e.paciente_documento, ''), ' ', '') LIKE ?
       ORDER BY p.periodo DESC, e.paciente_nombre ASC
       LIMIT 60`,
      [like, like, docLike]
    );
    res.json({
      resultados: rows.map((r) => ({
        expediente_id: r.expediente_id,
        codigo: r.codigo,
        paciente_nombre: r.paciente_nombre,
        paciente_documento: r.paciente_documento,
        numero_factura: r.numero_factura,
        contenedor_id: r.contenedor_id,
        contenedor_tipo: r.contenedor_tipo,
        dia_id: r.dia_id,
        dia_nombre: r.dia_nombre,
        periodo_id: r.periodo_id,
        periodo: r.periodo,
        periodo_etiqueta: r.periodo_etiqueta
      }))
    });
  } catch (e) {
    res.status(500).json({ error: safeError(e) });
  }
});

// List expedientes for import modal (armado visible periods)
router.get('/soportes/armado/expedientes-select', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, 'soportes.armado.importar_pdx'), async (req, res) => {
  try {
    const periodo = req.query.periodo;
    let sql = `
      SELECT e.id, e.codigo, d.nombre_display AS dia_nombre, c.tipo AS contenedor_tipo, p.periodo
      FROM sop_expedientes e
      JOIN sop_contenedores c ON c.id = e.contenedor_id
      JOIN sop_dias d ON d.id = c.dia_id
      JOIN sop_periodos p ON p.id = d.periodo_id
      WHERE e.tipo_servicio = 'electro'`;
    const params = [];
    if (periodo) { sql += ' AND p.periodo = ?'; params.push(periodo); }
    sql += ' ORDER BY p.periodo DESC, e.numero_factura DESC LIMIT 200';
    const rows = await db.query(sql, params);
    res.json({ expedientes: rows });
  } catch (e) {
    res.status(500).json({ error: safeError(e) });
  }
});

module.exports = router;
