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
const { upload, validateMagicBytes } = require('../middleware/upload');
const {
  periodoFromDate,
  calcularVisibilidadPeriodo,
  diasRestantesGracia
} = require('../utils/soportes-visibilidad');
const { detectarTemaCarpeta } = require('../utils/soportes-temas');
const { parseNombrePdx, fechaEnPeriodo, temaCoincideCarpeta, normalizarNombreBusqueda } = require('../utils/soportes-pdx-parse');
const {
  buildMetaFromUpload,
  finalizePdxFileOnDisk,
  movePdxFileOnDisk,
  collectPdxWarnings
} = require('../utils/soportes-pdx-upload');
const {
  getPdxDir,
  getArmadoExpedienteDir,
  safeFilename,
  resolveStoragePath
} = require('../utils/soportes-storage');

const ROLES_SOPORTES = ['superadmin', 'admin', 'admin_recepcion', 'recepcion', 'contabilidad', 'admin_electro', 'electro', 'tecnico_electro'];

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

router.get('/soportes/pdx/carpetas', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, 'modulo.reportes_pdx'), async (req, res) => {
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

router.post('/soportes/pdx/carpetas', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, ['modulo.reportes_pdx', 'soportes.pdx.subir']), async (req, res) => {
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

router.patch('/soportes/pdx/carpetas/:id', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, ['modulo.reportes_pdx', 'soportes.pdx.subir']), async (req, res) => {
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

router.delete('/soportes/pdx/carpetas/:id', requireAuth, requireRoleOrPerm(['superadmin', 'admin'], 'soportes.pdx.eliminar'), async (req, res) => {
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
      const fp = resolveStoragePath(a.ruta_relativa);
      if (fp && fs.existsSync(fp)) {
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

router.get('/soportes/pdx/carpetas/:id/archivos', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, 'modulo.reportes_pdx'), async (req, res) => {
  try {
    const carpeta = await db.query('SELECT * FROM sop_pdx_carpetas WHERE id = ?', [req.params.id]);
    if (!carpeta.length) return res.status(404).json({ error: 'Carpeta no encontrada' });
    const vis = calcularVisibilidadPeriodo(carpeta[0].periodo);
    if (vis === 'archivo' && !puedeVerArchivo(req)) {
      return res.status(403).json({ error: 'Carpeta en archivo' });
    }
    const archivos = await db.query(
      `SELECT a.*, us.nombre AS subido_por_nombre, ue.nombre AS editado_por_nombre
       FROM sop_pdx_archivos a
       LEFT JOIN usuarios us ON us.id = a.subido_por
       LEFT JOIN usuarios ue ON ue.id = a.editado_por
       WHERE a.carpeta_id = ? ORDER BY a.paciente_nombre ASC, a.id DESC`,
      [req.params.id]
    );
    res.json({ carpeta: mapCarpetaPdx({ ...carpeta[0], archivos_count: archivos.length }), archivos });
  } catch (e) {
    res.status(500).json({ error: safeError(e) });
  }
});

router.post(
  '/soportes/pdx/carpetas/:id/archivos',
  requireAuth,
  requireRoleOrPerm(ROLES_SOPORTES, ['modulo.reportes_pdx', 'soportes.pdx.subir']),
  uploadPdx.single('file'),
  validateMagicBytes,
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'Archivo PDF requerido' });
      const carpetaRows = await db.query('SELECT * FROM sop_pdx_carpetas WHERE id = ?', [req.params.id]);
      if (!carpetaRows.length) return res.status(404).json({ error: 'Carpeta no encontrada' });
      const carpeta = carpetaRows[0];
      const vis = calcularVisibilidadPeriodo(carpeta.periodo);
      if (vis === 'archivo') return res.status(403).json({ error: 'Carpeta cerrada para carga' });

      const meta = buildMetaFromUpload(req.file.originalname, req.body);
      if (!meta.ok) {
        return res.status(400).json({
          error: 'Complete apellidos, nombres, fecha y nombre del estudio.',
          requiere_confirmacion: true
        });
      }

      const warnings = collectPdxWarnings(meta, carpeta);
      const { rutaRelativa, nombre_archivo_display } = finalizePdxFileOnDisk(
        carpeta.id,
        req.file.filename,
        meta
      );

      const ins = await db.execute(
        `INSERT INTO sop_pdx_archivos (
          carpeta_id, apellidos, nombres, paciente_nombre, paciente_nombre_norm, paciente_documento,
          fecha_estudio, marca_tiempo, sufijo_numero, estudio_texto, nombre_archivo_original,
          nombre_archivo_display, ruta_relativa, tamano_bytes, subido_por
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          carpeta.id, meta.apellidos, meta.nombres, meta.paciente_nombre, meta.paciente_nombre_norm,
          req.body.paciente_documento || null, meta.fecha_estudio, meta.marca_tiempo, meta.sufijo_numero,
          meta.estudio_texto, req.file.originalname, nombre_archivo_display, rutaRelativa,
          req.file.size, req.session.usuarioId
        ]
      );

      await logPdxArchivo(ins.insertId, 'subida', req.session.usuarioId, req.file.originalname);
      const row = await db.query('SELECT * FROM sop_pdx_archivos WHERE id = ?', [ins.insertId]);
      res.status(201).json({ ok: true, archivo: row[0], warnings });
    } catch (e) {
      logger.error('[SOPORTES] subir pdx:', e);
      res.status(500).json({ error: safeError(e) });
    }
  }
);

router.get('/soportes/pdx/buscar', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, 'modulo.reportes_pdx'), async (req, res) => {
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
    }).map((a) => ({
      archivo_id: a.id,
      paciente_nombre: a.paciente_nombre,
      nombre_archivo_original: a.nombre_archivo_original,
      nombre_archivo_display: a.nombre_archivo_display,
      fecha_estudio: a.fecha_estudio,
      estudio_texto: a.estudio_texto,
      carpeta_id: a.carpeta_id,
      carpeta_nombre: a.carpeta_nombre,
      periodo: a.periodo,
      color_tema: a.color_tema
    }));
    res.json({ resultados });
  } catch (e) {
    res.status(500).json({ error: safeError(e) });
  }
});

router.patch('/soportes/pdx/archivos/:id', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, ['modulo.reportes_pdx', 'soportes.pdx.subir']), async (req, res) => {
  try {
    const rows = await db.query(
      `SELECT a.*, c.periodo, c.color_tema AS carpeta_tema FROM sop_pdx_archivos a
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
    if (!apellidos || !nombres || !fecha || !estudio) {
      return res.status(400).json({ error: 'Apellidos, nombres, fecha y estudio son obligatorios' });
    }

    const pacienteNombre = `${apellidos}, ${nombres}`;
    const { normalizarNombreBusqueda } = require('../utils/soportes-pdx-parse');
    const { movePdxFileOnDisk } = require('../utils/soportes-pdx-upload');

    let carpetaId = prev.carpeta_id;
    let rutaRelativa = prev.ruta_relativa;
    let nombreDisplay = prev.nombre_archivo_display;
    const warnings = [];
    let destCarpeta = null;

    const newCarpetaId = req.body?.carpeta_id != null ? parseInt(req.body.carpeta_id, 10) : null;
    if (newCarpetaId && newCarpetaId !== prev.carpeta_id) {
      const destRows = await db.query('SELECT * FROM sop_pdx_carpetas WHERE id = ?', [newCarpetaId]);
      if (!destRows.length) return res.status(404).json({ error: 'Carpeta destino no encontrada' });
      destCarpeta = destRows[0];
      const visDest = calcularVisibilidadPeriodo(destCarpeta.periodo);
      if (visDest === 'archivo') return res.status(403).json({ error: 'Carpeta destino en archivo' });
      const moved = movePdxFileOnDisk(prev.carpeta_id, newCarpetaId, prev.ruta_relativa, {
        apellidos,
        nombres,
        fecha_estudio: fecha,
        marca_tiempo: prev.marca_tiempo,
        sufijo_numero: prev.sufijo_numero,
        estudio_texto: estudio,
        nombre_archivo_display: prev.nombre_archivo_display
      });
      carpetaId = newCarpetaId;
      rutaRelativa = moved.rutaRelativa;
      if (!fechaEnPeriodo(fecha, destCarpeta.periodo)) {
        warnings.push(`La fecha (${fecha}) no pertenece al mes ${destCarpeta.periodo}`);
      }
      if (!temaCoincideCarpeta(detectarTemaCarpeta(estudio), destCarpeta.color_tema)) {
        warnings.push('El estudio no coincide con el tema de la carpeta destino');
      }
    } else {
      if (!fechaEnPeriodo(fecha, prev.periodo)) {
        warnings.push(`La fecha (${fecha}) no pertenece al mes ${prev.periodo}`);
      }
      if (!temaCoincideCarpeta(detectarTemaCarpeta(estudio), prev.carpeta_tema)) {
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
        req.body.paciente_documento != null ? req.body.paciente_documento : prev.paciente_documento,
        fecha,
        estudio,
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

router.delete('/soportes/pdx/archivos/:id', requireAuth, requireRoleOrPerm(['superadmin', 'admin'], 'soportes.pdx.eliminar'), async (req, res) => {
  try {
    const rows = await db.query('SELECT * FROM sop_pdx_archivos WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'No encontrado' });
    const fp = resolveStoragePath(rows[0].ruta_relativa);
    if (fp && fs.existsSync(fp)) fs.unlinkSync(fp);
    await db.execute('DELETE FROM sop_pdx_archivos WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: safeError(e) });
  }
});

router.get('/soportes/pdx/archivos/:id/descargar', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, 'modulo.reportes_pdx'), async (req, res) => {
  try {
    const rows = await db.query(
      `SELECT a.*, c.periodo FROM sop_pdx_archivos a JOIN sop_pdx_carpetas c ON c.id = a.carpeta_id WHERE a.id = ?`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'No encontrado' });
    const vis = calcularVisibilidadPeriodo(rows[0].periodo);
    if (vis === 'archivo' && !puedeVerArchivo(req)) return res.status(403).json({ error: 'Archivo en carpeta cerrada' });
    const fp = resolveStoragePath(rows[0].ruta_relativa);
    if (!fp || !fs.existsSync(fp)) return res.status(404).json({ error: 'Archivo no en disco' });
    res.download(fp, rows[0].nombre_archivo_original);
  } catch (e) {
    res.status(500).json({ error: safeError(e) });
  }
});

router.get('/soportes/pdx/archivos/:id/ver', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, 'modulo.reportes_pdx'), async (req, res) => {
  try {
    const rows = await db.query(
      `SELECT a.*, c.periodo FROM sop_pdx_archivos a JOIN sop_pdx_carpetas c ON c.id = a.carpeta_id WHERE a.id = ?`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'No encontrado' });
    const vis = calcularVisibilidadPeriodo(rows[0].periodo);
    if (vis === 'archivo' && !puedeVerArchivo(req)) return res.status(403).json({ error: 'Archivo en carpeta cerrada' });
    const fp = resolveStoragePath(rows[0].ruta_relativa);
    if (!fp || !fs.existsSync(fp)) return res.status(404).json({ error: 'Archivo no en disco' });
    const name = rows[0].nombre_archivo_display || rows[0].nombre_archivo_original;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(name)}"`);
    fs.createReadStream(fp).pipe(res);
  } catch (e) {
    res.status(500).json({ error: safeError(e) });
  }
});

router.get('/soportes/pdx/archivos/:id/historial', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, 'modulo.reportes_pdx'), async (req, res) => {
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
  requireRoleOrPerm(ROLES_SOPORTES, ['modulo.reportes_pdx', 'soportes.pdx.subir']),
  uploadPdxReemplazar.single('file'),
  validateMagicBytes,
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'Archivo PDF requerido' });
      const rows = await db.query(
        `SELECT a.*, c.periodo, c.color_tema FROM sop_pdx_archivos a
         JOIN sop_pdx_carpetas c ON c.id = a.carpeta_id WHERE a.id = ?`,
        [req.params.id]
      );
      if (!rows.length) return res.status(404).json({ error: 'Archivo no encontrado' });
      const prev = rows[0];
      const vis = calcularVisibilidadPeriodo(prev.periodo);
      if (vis === 'archivo') return res.status(403).json({ error: 'Carpeta cerrada' });

      const meta = buildMetaFromUpload(req.file.originalname, req.body);
      if (!meta.ok) {
        return res.status(400).json({
          error: 'Complete apellidos, nombres, fecha y nombre del estudio.',
          requiere_confirmacion: true
        });
      }

      const warnings = collectPdxWarnings(meta, { periodo: prev.periodo, color_tema: prev.color_tema });
      const oldFp = resolveStoragePath(prev.ruta_relativa);
      if (oldFp && fs.existsSync(oldFp)) {
        try { fs.unlinkSync(oldFp); } catch (_) { /* ignore */ }
      }

      const { rutaRelativa, nombre_archivo_display } = finalizePdxFileOnDisk(
        prev.carpeta_id,
        req.file.filename,
        meta
      );

      await db.execute(
        `UPDATE sop_pdx_archivos SET
          apellidos = ?, nombres = ?, paciente_nombre = ?, paciente_nombre_norm = ?,
          fecha_estudio = ?, marca_tiempo = ?, sufijo_numero = ?, estudio_texto = ?,
          nombre_archivo_original = ?, nombre_archivo_display = ?, ruta_relativa = ?,
          tamano_bytes = ?, editado_por = ?, editado_en = NOW()
         WHERE id = ?`,
        [
          meta.apellidos, meta.nombres, meta.paciente_nombre, meta.paciente_nombre_norm,
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

// ─── Armado: períodos / días / expedientes ───────────────────────────────────

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
      LEFT JOIN sop_expedientes e ON e.dia_id = d.id
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
       LEFT JOIN sop_expedientes e ON e.dia_id = d.id
       WHERE d.periodo_id = ?
       GROUP BY d.id ORDER BY d.dia ASC`,
      [req.params.id]
    );
    res.json({ dias });
  } catch (e) {
    res.status(500).json({ error: safeError(e) });
  }
});

router.post('/soportes/armado/periodos/:id/dias', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, 'soportes.armado.crear_estructura'), async (req, res) => {
  try {
    const dia = parseInt(req.body.dia, 10);
    const fecha = req.body.fecha;
    if (!dia || dia < 1 || dia > 31) return res.status(400).json({ error: 'dia inválido (1-31)' });
    const periodo = await db.query('SELECT periodo FROM sop_periodos WHERE id = ?', [req.params.id]);
    if (!periodo.length) return res.status(404).json({ error: 'Periodo no encontrado' });
    const fechaDate = fecha || `${periodo[0].periodo}-${String(dia).padStart(2, '0')}`;
    const r = await db.execute(
      'INSERT INTO sop_dias (periodo_id, dia, fecha) VALUES (?,?,?)',
      [req.params.id, dia, fechaDate]
    );
    const row = await db.query('SELECT * FROM sop_dias WHERE id = ?', [r.insertId]);
    res.status(201).json({ ok: true, dia: row[0] });
  } catch (e) {
    if (String(e.message).includes('uk_sop_dia')) return res.status(409).json({ error: 'El día ya existe' });
    res.status(500).json({ error: safeError(e) });
  }
});

async function buildExpedienteDetail(expId) {
  const exp = await db.query('SELECT * FROM sop_expedientes WHERE id = ?', [expId]);
  if (!exp.length) return null;
  const archivos = await db.query('SELECT * FROM sop_exp_archivos WHERE expediente_id = ?', [expId]);
  const slots = { OPF: null, CRC: null, FEV: null, PDX: null, HEV: null };
  for (const a of archivos) {
    slots[a.tipo] = {
      completo: true,
      archivo_id: a.id,
      nombre_archivo: a.nombre_archivo,
      origen: a.origen,
      pdx_archivo_id: a.pdx_archivo_id
    };
  }
  const e = exp[0];
  const hevOn = e.tipo_servicio === 'consulta';
  return {
    ...e,
    slots: {
      OPF: slots.OPF || { completo: false },
      CRC: slots.CRC || { completo: false },
      FEV: { completo: !!e.fev_externa_verificada, externa: true, archivo: slots.FEV },
      PDX: hevOn ? { completo: false, habilitado: false } : (slots.PDX || { completo: false, habilitado: true }),
      HEV: hevOn ? (slots.HEV || { completo: false, habilitado: true }) : { completo: false, habilitado: false }
    },
    paquete_completo: !!e.listo_radicacion
  };
}

router.get('/soportes/armado/dias/:id/expedientes', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, 'modulo.armado_soportes'), async (req, res) => {
  try {
    const rows = await db.query(
      'SELECT id, codigo, numero_factura, paciente_nombre, tipo_servicio, listo_radicacion FROM sop_expedientes WHERE dia_id = ? ORDER BY numero_factura ASC',
      [req.params.id]
    );
    res.json({ expedientes: rows });
  } catch (e) {
    res.status(500).json({ error: safeError(e) });
  }
});

router.post('/soportes/armado/dias/:id/expedientes', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, 'soportes.armado.crear_estructura'), async (req, res) => {
  try {
    const { numero_factura, paciente_nombre, paciente_documento, tipo_servicio } = req.body || {};
    const num = parseInt(numero_factura, 10);
    if (!num || num < 1) return res.status(400).json({ error: 'numero_factura requerido' });
    if (!paciente_nombre) return res.status(400).json({ error: 'paciente_nombre requerido' });
    const ts = tipo_servicio === 'consulta' ? 'consulta' : 'electro';
    const codigo = `FE${num}`;
    const diaRow = await db.query(
      `SELECT d.*, p.periodo FROM sop_dias d JOIN sop_periodos p ON p.id = d.periodo_id WHERE d.id = ?`,
      [req.params.id]
    );
    if (!diaRow.length) return res.status(404).json({ error: 'Día no encontrado' });
    getArmadoExpedienteDir(diaRow[0].periodo, diaRow[0].dia, codigo);
    const r = await db.execute(
      `INSERT INTO sop_expedientes (dia_id, codigo, numero_factura, paciente_nombre, paciente_documento, tipo_servicio, creado_por)
       VALUES (?,?,?,?,?,?,?)`,
      [req.params.id, codigo, num, paciente_nombre, paciente_documento || null, ts, req.session.usuarioId]
    );
    const detail = await buildExpedienteDetail(r.insertId);
    res.status(201).json({ ok: true, expediente: detail });
  } catch (e) {
    if (String(e.message).includes('uk_sop_exp')) return res.status(409).json({ error: 'Código FE ya existe en este día' });
    res.status(500).json({ error: safeError(e) });
  }
});

router.post('/soportes/armado/dias/:id/expedientes/siguiente', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, 'soportes.armado.crear_estructura'), async (req, res) => {
  try {
    const diaId = req.params.id;
    const diaRow = await db.query(
      `SELECT d.*, p.id AS periodo_id, p.periodo FROM sop_dias d JOIN sop_periodos p ON p.id = d.periodo_id WHERE d.id = ?`,
      [diaId]
    );
    if (!diaRow.length) return res.status(404).json({ error: 'Día no encontrado' });
    const maxRows = await db.query(
      `SELECT MAX(e.numero_factura) AS mx FROM sop_expedientes e
       JOIN sop_dias d ON d.id = e.dia_id WHERE d.periodo_id = ?`,
      [diaRow[0].periodo_id]
    );
    const siguiente = (parseInt(maxRows[0]?.mx, 10) || 0) + 1;
    req.body = { ...req.body, numero_factura: req.body.numero_factura || siguiente };
    const { numero_factura, paciente_nombre, paciente_documento, tipo_servicio } = req.body || {};
    const num = parseInt(numero_factura, 10);
    if (!num || num < 1) return res.status(400).json({ error: 'numero_factura requerido' });
    if (!paciente_nombre) return res.status(400).json({ error: 'paciente_nombre requerido' });
    const ts = tipo_servicio === 'consulta' ? 'consulta' : 'electro';
    const codigo = `FE${num}`;
    getArmadoExpedienteDir(diaRow[0].periodo, diaRow[0].dia, codigo);
    const r = await db.execute(
      `INSERT INTO sop_expedientes (dia_id, codigo, numero_factura, paciente_nombre, paciente_documento, tipo_servicio, creado_por)
       VALUES (?,?,?,?,?,?,?)`,
      [diaId, codigo, num, paciente_nombre, paciente_documento || null, ts, req.session.usuarioId]
    );
    const detail = await buildExpedienteDetail(r.insertId);
    res.status(201).json({ ok: true, expediente: detail, numero_sugerido: siguiente });
  } catch (e) {
    if (String(e.message).includes('uk_sop_exp')) return res.status(409).json({ error: 'Código FE ya existe en este día' });
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
    const { fev_externa_verificada, listo_radicacion, paciente_nombre, paciente_documento, notas } = req.body || {};
    await db.execute(
      `UPDATE sop_expedientes SET
        fev_externa_verificada = COALESCE(?, fev_externa_verificada),
        listo_radicacion = COALESCE(?, listo_radicacion),
        paciente_nombre = COALESCE(?, paciente_nombre),
        paciente_documento = COALESCE(?, paciente_documento),
        notas = COALESCE(?, notas)
       WHERE id = ?`,
      [
        fev_externa_verificada != null ? (fev_externa_verificada ? 1 : 0) : null,
        listo_radicacion != null ? (listo_radicacion ? 1 : 0) : null,
        paciente_nombre || null,
        paciente_documento || null,
        notas != null ? notas : null,
        req.params.id
      ]
    );
    const detail = await buildExpedienteDetail(req.params.id);
    res.json({ ok: true, expediente: detail });
  } catch (e) {
    res.status(500).json({ error: safeError(e) });
  }
});

router.post('/soportes/armado/expedientes/:id/importar-pdx', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, 'soportes.armado.importar_pdx'), async (req, res) => {
  try {
    const pdxId = parseInt(req.body.pdx_archivo_id, 10);
    if (!pdxId) return res.status(400).json({ error: 'pdx_archivo_id requerido' });
    const exp = await db.query(
      `SELECT e.*, d.dia, p.periodo FROM sop_expedientes e
       JOIN sop_dias d ON d.id = e.dia_id JOIN sop_periodos p ON p.id = d.periodo_id WHERE e.id = ?`,
      [req.params.id]
    );
    if (!exp.length) return res.status(404).json({ error: 'Expediente no encontrado' });
    if (exp[0].tipo_servicio !== 'electro') return res.status(400).json({ error: 'Solo expedientes electro admiten PDX' });

    const pdx = await db.query(
      `SELECT a.*, c.periodo FROM sop_pdx_archivos a JOIN sop_pdx_carpetas c ON c.id = a.carpeta_id WHERE a.id = ?`,
      [pdxId]
    );
    if (!pdx.length) return res.status(404).json({ error: 'PDX no encontrado' });

    const warnings = [];
    if (pdx[0].periodo !== exp[0].periodo) {
      warnings.push(`PDX del mes ${pdx[0].periodo} → expediente en periodo ${exp[0].periodo}`);
    }

    const src = resolveStoragePath(pdx[0].ruta_relativa);
    if (!src || !fs.existsSync(src)) return res.status(404).json({ error: 'Archivo PDX no en disco' });

    const codigo = exp[0].codigo;
    const destDir = getArmadoExpedienteDir(exp[0].periodo, exp[0].dia, codigo);
    const destName = safeFilename(pdx[0].nombre_archivo_original);
    const destPath = path.join(destDir, 'PDX', destName);
    fs.copyFileSync(src, destPath);
    const rutaRelativa = path.relative(path.join(__dirname, '..', 'public', 'uploads'), destPath).replace(/\\/g, '/');

    await db.execute('DELETE FROM sop_exp_archivos WHERE expediente_id = ? AND tipo = ?', [req.params.id, 'PDX']);
    await db.execute(
      `INSERT INTO sop_exp_archivos (expediente_id, tipo, nombre_archivo, ruta_relativa, tamano_bytes, origen, pdx_archivo_id, subido_por)
       VALUES (?,?,?,?,?,?,?,?)`,
      [req.params.id, 'PDX', pdx[0].nombre_archivo_original, rutaRelativa, pdx[0].tamano_bytes, 'copia_pdx', pdxId, req.session.usuarioId]
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

// Expediente slot upload
router.post(
  '/soportes/armado/expedientes/:id/archivos/:tipo',
  requireAuth,
  requireRoleOrPerm(ROLES_SOPORTES, 'soportes.armado.subir'),
  upload.single('file'),
  validateMagicBytes,
  async (req, res) => {
    try {
      const tipo = String(req.params.tipo || '').toUpperCase();
      if (!['OPF', 'CRC', 'FEV', 'HEV'].includes(tipo)) {
        return res.status(400).json({ error: 'tipo inválido (OPF, CRC, FEV, HEV)' });
      }
      if (!req.file) return res.status(400).json({ error: 'Archivo requerido' });
      const exp = await db.query(
        `SELECT e.*, d.dia, p.periodo FROM sop_expedientes e
         JOIN sop_dias d ON d.id = e.dia_id JOIN sop_periodos p ON p.id = d.periodo_id WHERE e.id = ?`,
        [req.params.id]
      );
      if (!exp.length) return res.status(404).json({ error: 'Expediente no encontrado' });
      if (tipo === 'HEV' && exp[0].tipo_servicio !== 'consulta') {
        return res.status(400).json({ error: 'HEV solo para consulta' });
      }
      const destDir = getArmadoExpedienteDir(exp[0].periodo, exp[0].dia, exp[0].codigo);
      const fname = safeFilename(req.file.originalname);
      const destPath = path.join(destDir, tipo, fname);
      fs.renameSync(req.file.path, destPath);
      const rutaRelativa = path.relative(path.join(__dirname, '..', 'public', 'uploads'), destPath).replace(/\\/g, '/');
      await db.execute('DELETE FROM sop_exp_archivos WHERE expediente_id = ? AND tipo = ?', [req.params.id, tipo]);
      await db.execute(
        `INSERT INTO sop_exp_archivos (expediente_id, tipo, nombre_archivo, ruta_relativa, tamano_bytes, origen, subido_por)
         VALUES (?,?,?,?,?,?,?)`,
        [req.params.id, tipo, req.file.originalname, rutaRelativa, req.file.size, 'upload', req.session.usuarioId]
      );
      const detail = await buildExpedienteDetail(req.params.id);
      res.json({ ok: true, expediente: detail });
    } catch (e) {
      res.status(500).json({ error: safeError(e) });
    }
  }
);

router.get('/soportes/armado/expedientes/:id/zip', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, 'soportes.descargar_zip'), async (req, res) => {
  try {
    const exp = await db.query(
      `SELECT e.*, d.dia, p.periodo FROM sop_expedientes e
       JOIN sop_dias d ON d.id = e.dia_id JOIN sop_periodos p ON p.id = d.periodo_id WHERE e.id = ?`,
      [req.params.id]
    );
    if (!exp.length) return res.status(404).json({ error: 'No encontrado' });
    const archivos = await db.query('SELECT * FROM sop_exp_archivos WHERE expediente_id = ?', [req.params.id]);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${exp[0].codigo}.zip"`);
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => { throw err; });
    archive.pipe(res);
    for (const a of archivos) {
      const fp = resolveStoragePath(a.ruta_relativa);
      if (fp && fs.existsSync(fp)) archive.file(fp, { name: `${a.tipo}/${a.nombre_archivo}` });
    }
    archive.finalize();
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: safeError(e) });
  }
});

// List expedientes for import modal (armado visible periods)
router.get('/soportes/armado/expedientes-select', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, 'soportes.armado.importar_pdx'), async (req, res) => {
  try {
    const periodo = req.query.periodo;
    let sql = `
      SELECT e.id, e.codigo, e.paciente_nombre, d.dia, p.periodo
      FROM sop_expedientes e
      JOIN sop_dias d ON d.id = e.dia_id
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
