/**
 * API módulo Anexo FIDU — tabla tipo Excel (46 columnas).
 */
const express = require('express');
const router = express.Router();
const db = require('../utils/db-mysql');
const logger = require('../utils/logger');
const { requireAuth, requirePermiso, safeError } = require('../middleware/index');
const PERM_ANEXO_FIDU = 'modulo.anexo_fidu';
const { upload, validateMagicBytes } = require('../middleware/upload');
const { ANEXO_FIDU_COLUMNAS, ANEXO_FIDU_COLUMN_KEYS, ANEXO_FIDU_REGISTROS_ORDER_SQL } = require('../utils/anexo-fidu-columns');
const {
  calcularEdadDesdeFecha,
  formatFechaParaCelda
} = require('../utils/anexo-fidu-import');
const {
  enriquecerRegistroAnexoFidu,
  listarServiciosCatalogo,
  recargarCatalogoAnexoFidu
} = require('../utils/anexo-fidu-servicios');
const {
  parsePersonasCsvContent,
  personaToAnexoPaciente,
  anexoRegistroToPersona,
  sanitizePersonaBody,
  armarRegistroAnexo,
  upsertPersonaEnDb,
  PERSONAS_CSV_COLUMNS
} = require('../utils/anexo-fidu-personas');
const { buildAnexoFiduExcelBuffer } = require('../utils/anexo-fidu-export');
const {
  normalizarNombreAnexo,
  parseAnexoFiduWorksheet
} = require('../utils/anexo-fidu-archivos');
const { ordenarPorTextoNatural } = require('../utils/comparar-texto-natural');
const { calcularVisibilidadPeriodo, periodoFromDate, diasRestantesGracia } = require('../utils/soportes-visibilidad');
const {
  loadVisibleEnSoportesCtx,
  resolveVisibilidadPeriodo,
  effectiveVisibilidad
} = require('../utils/soportes-modulo-archivo');

function parseArchivoId(val) {
  const n = parseInt(val, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function refrescarVisibilidadAnexoCarpeta(carpetaRow, archivadoPor = null) {
  const periodo = carpetaRow.periodo || periodoFromDate();
  const estadoAnterior = carpetaRow.estado_visibilidad || calcularVisibilidadPeriodo(periodo);
  const estado = calcularVisibilidadPeriodo(periodo);
  await db.execute(
    'UPDATE anexo_fidu_carpetas SET estado_visibilidad = ?, periodo = COALESCE(NULLIF(periodo, ""), ?) WHERE id = ?',
    [estado, periodo, carpetaRow.id]
  );
  try {
    const { procesarTransicionArchivoAnexo } = require('../utils/soportes-modulo-archivo');
    await procesarTransicionArchivoAnexo(
      { ...carpetaRow, periodo, estado_visibilidad: estado },
      estadoAnterior,
      archivadoPor
    );
  } catch (e) {
    logger.warn('[ANEXO-FIDU] archivo automático:', e.message);
  }
  return estado;
}

async function pushAnexoASoportes(archivoId) {
  try {
    const meta = await fetchArchivoMeta(archivoId);
    if (!meta?.carpeta_id) return;
    const {
      syncAnexoModuloPorCarpetaId,
      guardarExportAnexoEnSoportes
    } = require('../utils/soportes-anexo-sync');
    await syncAnexoModuloPorCarpetaId(meta.carpeta_id, { exportarExcel: false });
    const exp = await guardarExportAnexoEnSoportes(archivoId, { diaId: meta.sop_dia_id || null });
    if (!exp.ok) {
      logger.warn('[ANEXO-FIDU] export soportes:', exp.error);
    }
  } catch (e) {
    logger.warn('[ANEXO-FIDU] push soportes:', e.message);
  }
}

async function fetchArchivoMeta(archivoId) {
  const rows = await db.query(
    `SELECT a.id, a.nombre, a.carpeta_id, a.sop_dia_id, c.nombre AS carpeta_nombre
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
  await upsertPersonaEnDb(db, persona);
  return true;
}

const {
  lookupDiagnosticoDb,
  lookupDiagnosticoExactoDb
} = require('../utils/anexo-fidu-diagnosticos');

async function lookupNombreDiagnosticoDb(codigoRaw, opts = {}) {
  return lookupDiagnosticoDb(db, codigoRaw, opts);
}

function sanitizeRegistroBody(body) {
  const { correoParaAnexo } = require('../utils/anexo-fidu-personas');
  const { CAMPOS_SERVICIO_AUTO } = require('../utils/anexo-fidu-servicios');
  const out = {};
  for (const key of ANEXO_FIDU_COLUMN_KEYS) {
    if (body[key] == null) out[key] = '';
    else out[key] = String(body[key]).trim();
  }
  if (out.fecha_nacimiento) {
    const { calcularTipoDocumentoDesdeFecha } = require('../utils/anexo-fidu-import');
    out.fecha_nacimiento = formatFechaParaCelda(out.fecha_nacimiento);
    if (!out.edad) out.edad = calcularEdadDesdeFecha(out.fecha_nacimiento);
    if (!out.tipo_documento) out.tipo_documento = calcularTipoDocumentoDesdeFecha(out.fecha_nacimiento);
  }
  if (out.fecha_autorizacion_hora) {
    const { formatFechaAutorizacionHora } = require('../utils/anexo-fidu-import');
    out.fecha_autorizacion_hora = formatFechaAutorizacionHora(out.fecha_autorizacion_hora);
  }
  const antes = { ...out };
  const enriched = enriquecerRegistroAnexoFidu(out);
  ANEXO_FIDU_COLUMN_KEYS.forEach((k) => {
    if (!CAMPOS_SERVICIO_AUTO.has(k) && String(antes[k] || '').trim()) {
      enriched[k] = antes[k];
    }
  });
  enriched.correo = correoParaAnexo(enriched.correo || antes.correo);
  return enriched;
}

function rowToApi(row) {
  if (!row) return null;
  const o = {
    id: row.id,
    archivo_id: row.archivo_id != null ? row.archivo_id : null,
    creado_en: row.creado_en,
    actualizado_en: row.actualizado_en
  };
  const { correoParaAnexo } = require('../utils/anexo-fidu-personas');
  ANEXO_FIDU_COLUMN_KEYS.forEach((k) => {
    const raw = row[k] != null ? String(row[k]) : '';
    o[k] = k === 'correo' ? correoParaAnexo(raw) : raw;
  });
  return o;
}

/** GET /api/anexo-fidu/columnas */
router.get('/anexo-fidu/columnas', requireAuth, requirePermiso(PERM_ANEXO_FIDU), (req, res) => {
  res.json({ ok: true, total: ANEXO_FIDU_COLUMNAS.length, columnas: ANEXO_FIDU_COLUMNAS });
});

/** GET /api/anexo-fidu/servicios — catálogo CUPS + valores RIPS */
router.get('/anexo-fidu/servicios', requireAuth, requirePermiso(PERM_ANEXO_FIDU), async (req, res) => {
  try {
    await recargarCatalogoAnexoFidu();
    res.json({ ok: true, servicios: listarServiciosCatalogo() });
  } catch (e) {
    logger.error('[ANEXO-FIDU] servicios:', e);
    res.status(500).json({ error: safeError(e) });
  }
});

/** POST /api/anexo-fidu/diagnosticos — alta CIE-10 desde el módulo anexo */
router.post('/anexo-fidu/diagnosticos', requireAuth, requirePermiso(PERM_ANEXO_FIDU), async (req, res) => {
  const codigo = String(req.body?.codigo || '').trim();
  const nombre = String(req.body?.nombre || '').trim();
  const descripcion = String(req.body?.descripcion || '').trim();
  if (!codigo || codigo.replace(/\./g, '').length < 2) {
    return res.status(400).json({ error: 'Código CIE-10 requerido (mín. 2 caracteres)' });
  }
  if (!nombre) return res.status(400).json({ error: 'Nombre del diagnóstico requerido' });
  try {
    const existente = await lookupDiagnosticoExactoDb(db, codigo);
    if (existente.nombre) {
      return res.json({
        ok: true,
        ya_existia: true,
        id: null,
        codigo: existente.codigo || codigo,
        nombre: existente.nombre
      });
    }
    const result = await db.execute(
      'INSERT INTO diagnosticos (nombre, descripcion, codigo, activo) VALUES (?, ?, ?, 1)',
      [nombre, descripcion || nombre, codigo]
    );
    res.status(201).json({
      ok: true,
      ya_existia: false,
      id: result.insertId,
      codigo,
      nombre
    });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') {
      const dup = await lookupDiagnosticoExactoDb(db, codigo);
      if (dup.nombre) {
        return res.json({
          ok: true,
          ya_existia: true,
          id: null,
          codigo: dup.codigo || codigo,
          nombre: dup.nombre
        });
      }
      return res.status(409).json({
        error: 'Ya existe un diagnóstico con ese nombre. Edítelo en Gestión de datos o use otro nombre.'
      });
    }
    logger.error('[ANEXO-FIDU] crear diagnostico:', e);
    res.status(500).json({ error: safeError(e) });
  }
});

/** GET /api/anexo-fidu/diagnostico-por-codigo?codigo=G470 — nombre CIE-10 para NOMBREDIAGNOSTICO */
router.get('/anexo-fidu/diagnostico-por-codigo', requireAuth, requirePermiso(PERM_ANEXO_FIDU), async (req, res) => {
  const raw = String(req.query.codigo || '').trim();
  if (!raw) return res.json({ ok: true, nombre: '', codigo: '' });
  const soloExacto = req.query.exacto === '1' || req.query.exacto === 'true';
  try {
    const diag = await lookupNombreDiagnosticoDb(raw, { soloExacto });
    res.json({
      ok: true,
      nombre: diag.nombre || '',
      codigo: diag.codigo || ''
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
      SELECT c.id, c.nombre, c.periodo, c.estado_visibilidad, c.creado_en,
        (SELECT COUNT(*) FROM anexo_fidu_archivos a WHERE a.carpeta_id = c.id) AS total_archivos
      FROM anexo_fidu_carpetas c
    `);
    const visCtx = await loadVisibleEnSoportesCtx();
    const activas = [];
    for (const c of rows) {
      await refrescarVisibilidadAnexoCarpeta(c, req.session?.usuarioId || null);
      const vis = await effectiveVisibilidad('anexo', c.id, c.periodo || periodoFromDate(), visCtx);
      if (vis === 'archivo') continue;
      activas.push({
        ...c,
        estado_visibilidad: vis,
        dias_restantes_gracia: diasRestantesGracia(c.periodo || periodoFromDate())
      });
    }
    const carpetas = ordenarPorTextoNatural(activas, 'nombre');
    res.json({ ok: true, carpetas });
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
    const periodo = (req.body?.periodo && /^\d{4}-\d{2}$/.test(String(req.body.periodo).trim()))
      ? String(req.body.periodo).trim()
      : periodoFromDate();
    const vis = calcularVisibilidadPeriodo(periodo);
    const result = await db.execute(
      'INSERT INTO anexo_fidu_carpetas (nombre, periodo, estado_visibilidad) VALUES (?, ?, ?)',
      [nombre, periodo, vis]
    );
    res.status(201).json({ ok: true, carpeta: { id: result.insertId, nombre, periodo, estado_visibilidad: vis } });
  } catch (e) {
    logger.error('[ANEXO-FIDU] carpeta create:', e);
    res.status(500).json({ error: safeError(e) });
  }
});

/** PATCH /api/anexo-fidu/carpetas/:id */
router.patch('/anexo-fidu/carpetas/:id', requireAuth, requirePermiso(PERM_ANEXO_FIDU), async (req, res) => {
  try {
    const id = parseArchivoId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Carpeta inválida' });
    const rows = await db.query('SELECT id, nombre FROM anexo_fidu_carpetas WHERE id = ? LIMIT 1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Carpeta no encontrada' });
    const nombre = normalizarNombreAnexo(req.body?.nombre);
    if (!nombre) return res.status(400).json({ error: 'Nombre de carpeta requerido (ej. Junio)' });
    const dup = await db.query(
      'SELECT id FROM anexo_fidu_carpetas WHERE nombre = ? AND id <> ? LIMIT 1',
      [nombre, id]
    );
    if (dup.length) {
      return res.status(409).json({ error: 'Ya existe una carpeta con ese nombre' });
    }
    await db.execute('UPDATE anexo_fidu_carpetas SET nombre = ? WHERE id = ?', [nombre, id]);
    const [cnt] = await db.query(
      'SELECT COUNT(*) AS total_archivos FROM anexo_fidu_archivos WHERE carpeta_id = ?',
      [id]
    );
    res.json({
      ok: true,
      carpeta: { id, nombre, total_archivos: cnt?.total_archivos || 0 }
    });
  } catch (e) {
    logger.error('[ANEXO-FIDU] carpeta update:', e);
    res.status(500).json({ error: safeError(e) });
  }
});

/** DELETE /api/anexo-fidu/carpetas/:id */
router.delete('/anexo-fidu/carpetas/:id', requireAuth, requirePermiso(PERM_ANEXO_FIDU), async (req, res) => {
  try {
    const id = parseArchivoId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Carpeta inválida' });
    const rows = await db.query('SELECT id, nombre FROM anexo_fidu_carpetas WHERE id = ? LIMIT 1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Carpeta no encontrada' });
    const [regCnt] = await db.query(
      `SELECT COUNT(*) AS n FROM anexo_fidu_registros r
       INNER JOIN anexo_fidu_archivos a ON a.id = r.archivo_id
       WHERE a.carpeta_id = ?`,
      [id]
    );
    const [archCnt] = await db.query(
      'SELECT COUNT(*) AS n FROM anexo_fidu_archivos WHERE carpeta_id = ?',
      [id]
    );
    await db.execute(
      `DELETE r FROM anexo_fidu_registros r
       INNER JOIN anexo_fidu_archivos a ON a.id = r.archivo_id
       WHERE a.carpeta_id = ?`,
      [id]
    );
    const delArch = await db.execute('DELETE FROM anexo_fidu_archivos WHERE carpeta_id = ?', [id]);
    await db.execute('DELETE FROM anexo_fidu_carpetas WHERE id = ?', [id]);
    res.json({
      ok: true,
      eliminados_archivos: delArch.affectedRows || archCnt?.n || 0,
      eliminados_registros: regCnt?.n || 0
    });
  } catch (e) {
    logger.error('[ANEXO-FIDU] carpeta delete:', e);
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
       WHERE a.carpeta_id = ?`,
      [carpetaId]
    );
    const archivosOrdenados = ordenarPorTextoNatural(archivos, 'nombre');
    res.json({ ok: true, archivos: archivosOrdenados });
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
    const archivoId = result.insertId;
    await pushAnexoASoportes(archivoId);
    res.status(201).json({
      ok: true,
      archivo: { id: archivoId, carpeta_id: carpetaId, nombre, total_registros: 0 }
    });
  } catch (e) {
    logger.error('[ANEXO-FIDU] archivo create:', e);
    res.status(500).json({ error: safeError(e) });
  }
});

/** PATCH /api/anexo-fidu/archivos/:id */
router.patch('/anexo-fidu/archivos/:id', requireAuth, requirePermiso(PERM_ANEXO_FIDU), async (req, res) => {
  try {
    const archivoId = parseArchivoId(req.params.id);
    if (!archivoId) return res.status(400).json({ error: 'Anexo inválido' });
    const meta = await fetchArchivoMeta(archivoId);
    if (!meta) return res.status(404).json({ error: 'Anexo no encontrado' });
    const nombre = normalizarNombreAnexo(req.body?.nombre);
    if (!nombre) return res.status(400).json({ error: 'Nombre del anexo requerido' });
    const dup = await db.query(
      'SELECT id FROM anexo_fidu_archivos WHERE carpeta_id = ? AND nombre = ? AND id <> ? LIMIT 1',
      [meta.carpeta_id, nombre, archivoId]
    );
    if (dup.length) {
      return res.status(409).json({ error: 'Ya existe un anexo con ese nombre en la carpeta' });
    }
    await db.execute('UPDATE anexo_fidu_archivos SET nombre = ? WHERE id = ?', [nombre, archivoId]);
    await pushAnexoASoportes(archivoId);
    const [cnt] = await db.query(
      'SELECT COUNT(*) AS total FROM anexo_fidu_registros WHERE archivo_id = ?',
      [archivoId]
    );
    res.json({
      ok: true,
      archivo: {
        id: archivoId,
        carpeta_id: meta.carpeta_id,
        nombre,
        total_registros: cnt?.total || 0
      }
    });
  } catch (e) {
    logger.error('[ANEXO-FIDU] archivo update:', e);
    res.status(500).json({ error: safeError(e) });
  }
});

/** DELETE /api/anexo-fidu/archivos/:id */
router.delete('/anexo-fidu/archivos/:id', requireAuth, requirePermiso(PERM_ANEXO_FIDU), async (req, res) => {
  try {
    const archivoId = parseArchivoId(req.params.id);
    if (!archivoId) return res.status(400).json({ error: 'Anexo inválido' });
    const meta = await fetchArchivoMeta(archivoId);
    if (!meta) return res.status(404).json({ error: 'Anexo no encontrado' });
    const delReg = await db.execute('DELETE FROM anexo_fidu_registros WHERE archivo_id = ?', [archivoId]);
    await db.execute('DELETE FROM anexo_fidu_archivos WHERE id = ?', [archivoId]);
    res.json({
      ok: true,
      eliminados_registros: delReg.affectedRows || 0
    });
  } catch (e) {
    logger.error('[ANEXO-FIDU] archivo delete:', e);
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

      await pushAnexoASoportes(archivoId);
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
      `SELECT * FROM anexo_fidu_registros${where} ORDER BY ${ANEXO_FIDU_REGISTROS_ORDER_SQL} LIMIT ? OFFSET ?`,
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
      const { detectarCamposFaltantes } = require('../utils/anexo-fidu-personas-docs');
      return res.json({
        ok: true,
        persona_encontrada: false,
        numero_documento: documento,
        codigo_servicio: codigo,
        campos_faltantes: detectarCamposFaltantes({ numero_documento: documento }, 'anexo')
      });
    }

    const { registro, servicio_encontrado } = armarRegistroAnexo(documento, codigo, rows[0]);
    const cie10 = String(req.body?.codigo_cie10 || '').trim();
    const nombreMedico = String(req.body?.nombre_medico || '').trim();
    const medicoAtencion = String(req.body?.medico_quien_realiza_atencion || '').trim();
    const espRemitente = String(req.body?.especialidad_remitente || '').trim();
    if (cie10) {
      registro.codigo_cie10 = cie10;
      const diag = await lookupDiagnosticoExactoDb(db, cie10);
      if (diag.codigo) registro.codigo_cie10 = diag.codigo;
      if (diag.nombre) registro.nombre_diagnostico = diag.nombre;
      else registro.codigo_cie10 = cie10;
    }
    if (nombreMedico) registro.nombre_medico = nombreMedico;
    if (medicoAtencion) registro.medico_quien_realiza_atencion = medicoAtencion;
    if (espRemitente) registro.especialidad_remitente = espRemitente;
    const fechaAuth = String(req.body?.fecha_autorizacion_hora || '').trim();
    if (fechaAuth) {
      const { formatFechaAutorizacionHora } = require('../utils/anexo-fidu-import');
      registro.fecha_autorizacion_hora = formatFechaAutorizacionHora(fechaAuth);
    }
    const cantidad = String(req.body?.cantidad ?? '').trim();
    if (cantidad) {
      const { aplicarValorTotalCalculado } = require('../utils/anexo-fidu-servicios');
      registro.cantidad = cantidad;
      aplicarValorTotalCalculado(registro);
    }
    const { detectarCamposFaltantes } = require('../utils/anexo-fidu-personas-docs');
    const personaApi = personaRowToApi(rows[0]);
    const campos_faltantes = detectarCamposFaltantes(personaApi, 'anexo');
    res.json({
      ok: true,
      persona_encontrada: true,
      servicio_encontrado,
      registro: rowToApi({ id: null, ...registro }),
      persona: personaApi,
      campos_faltantes
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
    await pushAnexoASoportes(archivoId);
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
    if (rows[0]?.archivo_id) await pushAnexoASoportes(rows[0].archivo_id);
    res.json({ ok: true, registro: rowToApi(rows[0]), persona_actualizada: syncPersona });
  } catch (e) {
    logger.error('[ANEXO-FIDU] update:', e);
    res.status(500).json({ error: safeError(e) });
  }
});

/** DELETE /api/anexo-fidu/registros/:id */
router.delete('/anexo-fidu/registros/:id', requireAuth, requirePermiso(PERM_ANEXO_FIDU), async (req, res) => {
  try {
    const prev = await db.query('SELECT archivo_id FROM anexo_fidu_registros WHERE id = ? LIMIT 1', [req.params.id]);
    const result = await db.execute('DELETE FROM anexo_fidu_registros WHERE id = ?', [req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Registro no encontrado' });
    if (prev[0]?.archivo_id) await pushAnexoASoportes(prev[0].archivo_id);
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

/** POST /api/anexo-fidu/personas/importar — CSV Lista_Personas (fusiona: inserta nuevos, actualiza existentes) */
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

      let insertados = 0;
      let actualizados = 0;
      for (const p of personas) {
        const accion = await upsertPersonaEnDb(db, p);
        if (accion === 'updated') actualizados += 1;
        else insertados += 1;
      }

      res.json({
        ok: true,
        insertados,
        actualizados,
        omitidos: errores.length,
        mensaje: `Base de personas sincronizada: ${insertados} nuevo(s), ${actualizados} actualizado(s)${errores.length ? ` (${errores.length} fila(s) omitidas)` : ''}`,
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
      `SELECT * FROM anexo_fidu_registros WHERE archivo_id = ? ORDER BY ${ANEXO_FIDU_REGISTROS_ORDER_SQL}`,
      [archivoId]
    );
    const { buffer, filename } = await buildAnexoFiduExcelBuffer(rows, { nombreArchivo: meta.nombre });

    try {
      await pushAnexoASoportes(archivoId);
    } catch (syncErr) {
      logger.warn('[ANEXO-FIDU] sync soportes:', syncErr.message);
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(Buffer.from(buffer));
  } catch (e) {
    logger.error('[ANEXO-FIDU] export:', e);
    if (!res.headersSent) res.status(500).json({ error: safeError(e) });
  }
});

module.exports = router;
