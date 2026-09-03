/**
 * Módulos: Reportes PDX + Armado de soportes de radicación
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const router = express.Router();
const db = require('../utils/db-mysql');
const logger = require('../utils/logger');
const { requireAuth, requireRoleOrPerm, requireSuperAdmin, safeError, emitSocket } = require('../middleware/index');
const { upload, uploadArmadoSoportes, validateMagicBytes, resolveUploadedFilePath } = require('../middleware/upload');
const {
  periodoFromDate,
  calcularVisibilidadPeriodo,
  diasRestantesGracia
} = require('../utils/soportes-visibilidad');
const {
  loadVisibleEnSoportesSet,
  loadVisibleEnSoportesCtx,
  resolveVisibilidadPeriodo,
  resolveVisibilidadArmadoRow,
  periodoToRefId,
  effectiveVisibilidad,
  ensureRegistroArchivoArmado,
  syncRegistrosArchivoFaltantes,
  setVisibleEnSoportes
} = require('../utils/soportes-modulo-archivo');
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
  normalizarNumeroDocumentoPdx,
  normalizarTipoDocumentoPdx,
  numeroDocumentoValidoPdx
} = require('../utils/soportes-pdx-documento');
const {
  buildPdxBusquedaWhere,
  buildArmadoBusquedaWhere,
  tokenizeSearchQuery
} = require('../utils/soportes-busqueda');
const {
  buildMetaFromUpload,
  buildMetaDesdeCamposManuales,
  cargarListaParaCarpetaPdx,
  necesitaListaEstudios,
  finalizePdxFileOnDisk,
  ensureMetaPacienteNombre,
  resolveTmpUploadPath,
  movePdxFileOnDisk,
  collectPdxWarnings
} = require('../utils/soportes-pdx-upload');
const {
  nextSopDiaNumero,
  ensureContenedoresForDia,
  ensureFeParEnContenedorHermano,
  parseFeCodigo,
  ordenarExpedientesFeLista,
  calcularCarpetaFisica
} = require('../utils/soportes-armado-structure');
const { compararTextoNatural, ordenarPorTextoNatural } = require('../utils/comparar-texto-natural');
const {
  normalizarParentId: normalizarParentIdDia,
  validarMoverDiaArmado
} = require('../utils/soportes-armado-dias-tree');
const {
  normalizarModoDia,
  fetchModoParentContenedora,
  ensureContenedorasRaizPeriodo,
  reparentCarpetasFacturacionHuerfanas,
  crearAnexoArchivoParaDia,
  asegurarExpedienteUcqn,
  asegurarPersonaUcqnBajoParent,
  nombreCarpetaPersonaDesdePdx,
  esModoAnexo,
  esModoUcqn,
  esModoFacturacion
} = require('../utils/soportes-armado-modos');
const { buildUcqnExpedienteDetail } = require('../utils/soportes-ucqn-upload');
const {
  guardarExportAnexoEnSoportes,
  syncAnexoModuloASoportesPeriodo
} = require('../utils/soportes-anexo-sync');
const { ingestFeArchivo } = require('../utils/soportes-fe-upload');
const {
  slotRequirements,
  buildCanonicalName,
  buildSoportesDiskName,
  expedienteTieneFactura,
  getNitObligado,
  fevFilenameHint
} = require('../utils/soportes-archivo-detect');
const { parseListaPacientes, parseLineaPaciente } = require('../utils/soportes-pacientes-parse');
const { actualizarExpediente, eliminarExpediente } = require('../utils/soportes-expediente-admin');
const {
  buscarDuplicadoPdxEnCarpeta,
  mensajeDuplicadoPdx,
  cuentaReferenciasRutaPdx
} = require('../utils/soportes-pdx-duplicados');
const {
  enviarArchivoAPapelera,
  listarPapelera,
  obtenerPapelera,
  recuperarItemPapelera,
  escanearBackupsPdx,
  absPapelera
} = require('../utils/soportes-pdx-papelera');
const { enrichExpedientesLista } = require('../utils/soportes-expediente-progreso');
const { actualizarDia, eliminarDia, moverDiaEnDisco } = require('../utils/soportes-dia-admin');
const { resolveArchivoAbsoluto, resolverArchivoExpedienteRow } = require('../utils/soportes-exp-archivo');
const { runSoportesRecoveryScript } = require('../utils/soportes-recovery-runner');
const { syncRipsCarpetasDia, syncRipsCarpetasContenedor } = require('../utils/soportes-rips-carpetas-sync');
const { zipArchiveSegment } = require('../utils/soportes-armado-zip');
const { createZipJob, createZipJobWithCache, createPeriodPaqueteJob, getJob: getSopZipJob } = require('../utils/soportes-zip-jobs');
const {
  SOPORTES_ROOT,
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

const ROLES_SOPORTES = ['superadmin', 'admin', 'admin_recepcion', 'recepcion', 'auxiliar_recepcion', 'contabilidad', 'admin_electro', 'electro', 'tecnico_electro'];
const PERM_REPORTES_HISTORICO = ['modulo.reportes_historico'];
const { sesionIncluyeAlgunPermiso } = require('../config/permisos-legacy');
const { permisoKeyCarpetaPdx } = require('../utils/soportes-pdx-carpetas-permisos');
const { usuarioVeCarpetaPdx: usuarioVeCarpetaPdxPermiso } = require('../utils/soportes-pdx-carpetas-permisos');

function esSuperadminSesion(req) {
  return req.session?.rol === 'superadmin';
}

function usuarioVeCarpetaPdx(req, carpetaRow) {
  return usuarioVeCarpetaPdxPermiso(req.session, carpetaRow);
}

function denySinAccesoCarpetaPdx(req, carpetaRow) {
  if (!usuarioVeCarpetaPdx(req, carpetaRow)) {
    return { status: 403, error: 'No tiene acceso a esta carpeta' };
  }
  return null;
}

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
       WHERE a.carpeta_id = ? ORDER BY a.fecha_estudio IS NULL, a.fecha_estudio DESC, a.paciente_nombre ASC, a.id DESC`,
      map: (rows) => rows
    },
    {
      sql: `SELECT a.*, us.nombre AS subido_por_nombre
       FROM sop_pdx_archivos a
       LEFT JOIN usuarios us ON us.id = a.subido_por
       WHERE a.carpeta_id = ? ORDER BY a.fecha_estudio IS NULL, a.fecha_estudio DESC, a.paciente_nombre ASC, a.id DESC`,
      map: (rows) => rows.map((r) => ({ ...r, editado_por_nombre: null }))
    },
    {
      sql: 'SELECT a.* FROM sop_pdx_archivos a WHERE a.carpeta_id = ? ORDER BY a.fecha_estudio IS NULL, a.fecha_estudio DESC, a.id DESC',
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

async function queryPdxBuscarArchivadasConUsuarios(whereSql, whereParams) {
  const extra = `c.nombre_display AS carpeta_nombre, c.periodo, c.color_tema, c.roles_visibles,
              COALESCE(c.archivada_manual, 0) AS archivada_manual`;
  const fromSql = `FROM sop_pdx_archivos a
       JOIN sop_pdx_carpetas c ON c.id = a.carpeta_id`;
  const orderSql = `WHERE ${whereSql} ORDER BY a.fecha_estudio DESC LIMIT 150`;
  const queries = [
    {
      sql: `SELECT a.*, ${extra}, us.nombre AS subido_por_nombre, ue.nombre AS editado_por_nombre
       ${fromSql}
       LEFT JOIN usuarios us ON us.id = a.subido_por
       LEFT JOIN usuarios ue ON ue.id = a.editado_por
       ${orderSql}`,
      map: (rows) => rows
    },
    {
      sql: `SELECT a.*, ${extra}, us.nombre AS subido_por_nombre
       ${fromSql}
       LEFT JOIN usuarios us ON us.id = a.subido_por
       ${orderSql}`,
      map: (rows) => rows.map((r) => ({ ...r, editado_por_nombre: null }))
    },
    {
      sql: `SELECT a.*, ${extra}
       ${fromSql}
       ${orderSql}`,
      map: (rows) => rows.map((r) => ({ ...r, subido_por_nombre: null, editado_por_nombre: null }))
    }
  ];

  let lastErr;
  for (const { sql, map } of queries) {
    try {
      const rows = await db.query(sql, whereParams);
      return map(rows);
    } catch (e) {
      lastErr = e;
      if (e.code === 'ER_NO_SUCH_TABLE') {
        logger.error('[SOPORTES] Falta tabla para búsqueda archivada; reinicie la app para aplicar migraciones');
        return [];
      }
      if (e.code !== 'ER_BAD_FIELD_ERROR') throw e;
    }
  }
  throw lastErr;
}

function pdxListErrorPayload(req, e, step) {
  const msg = String(e?.message || e);
  const payload = {
    error: sopErrorCliente(e, 'No se pudo completar la operación en Cargar reportes.'),
    step: step || undefined,
    detail: msg.slice(0, 400),
    code: e?.code || undefined
  };
  if (process.env.NODE_ENV === 'production' && req.session?.rol !== 'superadmin') {
    delete payload.code;
    if (payload.error === 'Error interno del servidor') {
      payload.detail = msg.slice(0, 200);
    }
  }
  return payload;
}

function safeNombreDescargaPdx(row, carpetaCtx) {
  try {
    return buildNombreDescargaPdxDesdeRow(row, carpetaCtx);
  } catch (e) {
    logger.warn('[SOPORTES] nombre descarga PDX:', e.message);
    return row?.nombre_archivo_display || row?.nombre_archivo_original || 'archivo.pdf';
  }
}

function puedeVerReportesHistorico(req) {
  if (req.session?.rol === 'superadmin') return true;
  const perms = req.session?.permisos;
  if (!Array.isArray(perms)) return false;
  return sesionIncluyeAlgunPermiso(perms, PERM_REPORTES_HISTORICO);
}

function puedeVerArchivo(req) {
  return puedeVerReportesHistorico(req);
}

function tieneAccesoPdxActivos(req) {
  if (req.session?.rol === 'superadmin') return true;
  const perms = req.session?.permisos;
  if (!Array.isArray(perms)) return false;
  return perms.includes('modulo.reportes_pdx')
    || perms.includes('soportes.pdx.ver')
    || perms.includes('soportes.pdx.subir');
}

function denyPdxSoloHistoricoEnCarpetaActiva(req, visibilidad) {
  if (visibilidad === 'archivo') return null;
  if (tieneAccesoPdxActivos(req)) return null;
  if (puedeVerReportesHistorico(req)) {
    return { status: 403, error: 'Solo puede consultar carpetas archivadas (Reportes anteriores)' };
  }
  return null;
}

async function visPdxPeriodo(periodo, visiblesSet = null) {
  return effectiveVisibilidad('pdx', periodoToRefId(periodo), periodo, visiblesSet);
}

async function visArmadoPeriodo(periodoRow, visCtx = null) {
  return effectiveVisibilidad('armado', periodoRow.id, periodoRow.periodo, visCtx, periodoRow.etiqueta);
}

async function fetchPeriodoArmadoRow(periodoId) {
  const id = parseInt(periodoId, 10);
  if (!id) return null;
  const rows = await db.query('SELECT * FROM sop_periodos WHERE id = ? LIMIT 1', [id]);
  return rows[0] || null;
}

async function denyPeriodoArmadoInaccesible(req, res, periodoRow, visCtx = null) {
  const vis = await visArmadoPeriodo(periodoRow, visCtx);
  if (vis === 'archivo') {
    res.status(403).json({
      error: 'Este mes está archivado. Ábralo desde «Meses archivados» → Devolver a Soportes.'
    });
    return true;
  }
  return false;
}

async function requirePeriodoArmadoAccesible(req, res, periodoId, visCtx = null) {
  const row = await fetchPeriodoArmadoRow(periodoId);
  if (!row) {
    res.status(404).json({ error: 'Periodo no encontrado' });
    return null;
  }
  if (await denyPeriodoArmadoInaccesible(req, res, row, visCtx)) return null;
  return row;
}

async function requireDiaArmadoAccesible(req, res, diaId, visCtx = null) {
  const id = parseInt(diaId, 10);
  if (!id) {
    res.status(400).json({ error: 'Carpeta inválida' });
    return null;
  }
  const rows = await db.query(
    `SELECT d.*, p.id AS periodo_ref_id, p.periodo, p.etiqueta
     FROM sop_dias d JOIN sop_periodos p ON p.id = d.periodo_id WHERE d.id = ?`,
    [id]
  );
  if (!rows.length) {
    res.status(404).json({ error: 'Carpeta no encontrada' });
    return null;
  }
  const periodo = await requirePeriodoArmadoAccesible(req, res, rows[0].periodo_id, visCtx);
  if (!periodo) return null;
  return rows[0];
}

async function requireContenedorArmadoAccesible(req, res, contenedorId, visCtx = null) {
  const id = parseInt(contenedorId, 10);
  if (!id) {
    res.status(400).json({ error: 'Contenedor inválido' });
    return null;
  }
  const rows = await db.query(
    `SELECT c.*, d.nombre_display AS dia_nombre, d.periodo_id
     FROM sop_contenedores c JOIN sop_dias d ON d.id = c.dia_id WHERE c.id = ?`,
    [id]
  );
  if (!rows.length) {
    res.status(404).json({ error: 'Contenedor no encontrado' });
    return null;
  }
  const periodo = await requirePeriodoArmadoAccesible(req, res, rows[0].periodo_id, visCtx);
  if (!periodo) return null;
  return rows[0];
}

function streamZipJobDownload(res, job) {
  if (job.status === 'error') {
    return res.status(500).json({ error: job.error || 'Error al generar ZIP' });
  }
  if (job.status !== 'ready' || !job.filePath || !fs.existsSync(job.filePath)) {
    return res.status(409).json({
      error: 'El ZIP aún se está generando',
      status: job.status,
      progress: job.progress
    });
  }
  let size = 0;
  try {
    size = fs.statSync(job.filePath).size;
  } catch (_) { /* ignore */ }
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${job.filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  if (size > 0) res.setHeader('Content-Length', String(size));
  const stream = fs.createReadStream(job.filePath);
  stream.on('error', () => {
    if (!res.headersSent) res.status(500).json({ error: 'Error al leer el ZIP generado' });
  });
  stream.pipe(res);
  return null;
}

/** Las rutas GET síncronas bloqueaban Node en Hostinger; usar POST /soportes/armado/zip/job. */
function respondLegacySyncZipDisabled(res) {
  return res.status(410).json({
    error: 'La descarga ZIP directa fue reemplazada por generación en segundo plano. Use el botón ZIP en Soportes.',
    code: 'ZIP_USE_BACKGROUND_JOB'
  });
}

async function refrescarVisibilidadPdx(periodo, archivadoPor = null) {
  const prevRows = await db.query(
    'SELECT estado_visibilidad FROM sop_pdx_carpetas WHERE periodo = ? AND COALESCE(archivada_manual, 0) = 0 LIMIT 1',
    [periodo]
  );
  const estadoAnterior = prevRows[0]?.estado_visibilidad || calcularVisibilidadPeriodo(periodo);
  const estado = calcularVisibilidadPeriodo(periodo);
  await db.execute(
    'UPDATE sop_pdx_carpetas SET estado_visibilidad = ? WHERE periodo = ? AND COALESCE(archivada_manual, 0) = 0',
    [estado, periodo]
  );
  try {
    // Solo registro liviano en BD (sin ZIP ni copia de carpetas)
    const { procesarTransicionArchivoPdx } = require('../utils/soportes-modulo-archivo');
    await procesarTransicionArchivoPdx(periodo, estadoAnterior, archivadoPor);
  } catch (e) {
    logger.warn('[SOPORTES] archivo automático PDX:', e.message);
  }
  return estado;
}

/** Un refresh por periodo (evita N awaits al listar muchas carpetas). */
async function refrescarVisibilidadPdxPeriodos(periodos, archivadoPor = null) {
  const uniq = [...new Set((periodos || []).filter((p) => p && /^\d{4}-\d{2}$/.test(p)))];
  for (const periodo of uniq) {
    await refrescarVisibilidadPdx(periodo, archivadoPor);
  }
}

async function refrescarVisibilidadArmado(periodo, archivadoPor = null) {
  const prevRows = await db.query(
    'SELECT id, periodo, etiqueta, estado_visibilidad FROM sop_periodos WHERE periodo = ? LIMIT 1',
    [periodo]
  );
  const estadoAnterior = prevRows[0]?.estado_visibilidad || calcularVisibilidadPeriodo(periodo);
  const estado = calcularVisibilidadPeriodo(periodo);
  await db.execute('UPDATE sop_periodos SET estado_visibilidad = ? WHERE periodo = ?', [estado, periodo]);
  if (prevRows.length && estado === 'archivo' && estadoAnterior !== 'archivo') {
    try {
      const { procesarTransicionArchivoArmado } = require('../utils/soportes-modulo-archivo');
      await procesarTransicionArchivoArmado(prevRows[0], estadoAnterior, archivadoPor);
    } catch (e) {
      logger.warn('[SOPORTES] archivo automático Armado:', e.message);
    }
  } else if (prevRows.length && estado === 'archivo') {
    try {
      await ensureRegistroArchivoArmado(prevRows[0], archivadoPor);
    } catch (e) {
      logger.warn('[SOPORTES] ensure registro archivo Armado:', e.message);
    }
  }
  return estado;
}

function mapCarpetaPdx(row, visiblesSet) {
  const periodo = row.periodo;
  const vis = row.archivada_manual
    ? 'archivo'
    : (visiblesSet
      ? resolveVisibilidadPeriodo(periodo, 'pdx', periodoToRefId(periodo), visiblesSet)
      : calcularVisibilidadPeriodo(periodo));
  // Siempre derivar del nombre visible: color_tema en BD puede quedar obsoleto tras renombres.
  const colorTema = detectarTemaCarpeta(row.nombre_display) || row.color_tema || 'neutral';
  return {
    id: row.id,
    periodo,
    nombre_display: row.nombre_display,
    color_tema: colorTema,
    estado_visibilidad: vis,
    archivada_manual: Boolean(row.archivada_manual),
    // Solo se puede devolver a Cargar reportes si se archivó a mano y el periodo aún no está cerrado.
    puede_devolver_a_cargar: Boolean(row.archivada_manual) && calcularVisibilidadPeriodo(periodo) !== 'archivo',
    dias_restantes_gracia: diasRestantesGracia(periodo),
    archivos_count: row.archivos_count || 0,
    creado_en: row.creado_en
  };
}

function carpetaPdxYaArchivada(carpetaRow) {
  return Boolean(carpetaRow?.archivada_manual);
}

async function visibilidadCarpetaPdx(carpetaRow, visiblesSet = null) {
  if (carpetaPdxYaArchivada(carpetaRow)) return 'archivo';
  return visPdxPeriodo(carpetaRow.periodo, visiblesSet);
}

async function denyCarpetaPdxNoEditable(req, carpetaRow, visiblesSet = null) {
  if (!carpetaRow) return { status: 404, error: 'Carpeta no encontrada' };
  const denied = denySinAccesoCarpetaPdx(req, carpetaRow);
  if (denied) return denied;
  const vis = await visibilidadCarpetaPdx(carpetaRow, visiblesSet);
  if (vis === 'archivo') return { status: 403, error: 'Carpeta en archivo: no editable' };
  return null;
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

async function requirePdxCarpetaExiste(req, res, next) {
  const carpetaId = parseInt(req.params.id, 10);
  if (!carpetaId) {
    return res.status(400).json({ error: 'ID de carpeta inválido', codigo: 'PDX_CARPETA_INVALIDA' });
  }
  try {
    const rows = await db.query('SELECT id FROM sop_pdx_carpetas WHERE id = ?', [carpetaId]);
    if (!rows.length) {
      return res.status(404).json({
        error: 'Carpeta no encontrada o eliminada. Vuelva a la lista y ábrala de nuevo.',
        codigo: 'PDX_CARPETA_INEXISTENTE'
      });
    }
    return next();
  } catch (e) {
    logger.error('[SOPORTES] validar carpeta pdx:', e);
    return res.status(500).json(pdxListErrorPayload(req, e, 'carpeta'));
  }
}

function uploadPdxSingle(req, res, next) {
  uploadPdx.single('file')(req, res, (err) => {
    if (!err) return next();
    logger.error('[SOPORTES] multer pdx', err);
    const msg = err.message || '';
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413
      : (/permiten|PDF/i.test(msg) ? 400 : 500);
    return res.status(status).json({
      ...pdxListErrorPayload(req, err, 'multer'),
      error: err.code === 'LIMIT_FILE_SIZE'
        ? 'El PDF supera el tamaño máximo (20 MB).'
        : sopErrorCliente(err, err.message || 'No se pudo recibir el archivo PDF')
    });
  });
}

function uploadPdxMultiple(req, res, next) {
  uploadPdx.array('files', 12)(req, res, (err) => {
    if (!err) return next();
    logger.error('[SOPORTES] multer pdx múltiple', { message: err.message, code: err.code });
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(status).json({ error: err.message || 'No se pudieron recibir los PDF' });
  });
}

const { insertRowId } = require('../utils/db-insert-id');

function pdxInsertId(result) {
  return insertRowId(result);
}

function sopErrorCliente(e, fallback = 'Error interno del servidor') {
  if (e.code === 'ER_NO_SUCH_TABLE') {
    return 'Módulo Soportes no inicializado en la base de datos. Reinicie la aplicación (migraciones al arranque).';
  }
  if (e.code === 'ER_BAD_FIELD_ERROR') {
    return 'Estructura de Soportes desactualizada. Reinicie la aplicación para aplicar migraciones.';
  }
  if (e.code === 'ER_NO_REFERENCED_ROW_2') {
    return 'La carpeta no existe en la base de datos (puede haber sido eliminada). Actualice la lista de carpetas.';
  }
  if (e.code === 'ER_DUP_ENTRY') {
    return 'Ya existe un registro con los mismos datos en esta carpeta.';
  }
  if (e.code === 'ENSURE_DIR_FAILED' || e.code === 'EACCES' || e.code === 'EPERM') {
    return 'Sin permiso de escritura en la carpeta de archivos (revise UPLOADS_DIR en el servidor).';
  }
  return safeError(e) || fallback;
}

async function queryPdxCarpetasConCount() {
  const sqlConArchivos = `
      SELECT c.*, COUNT(a.id) AS archivos_count
      FROM sop_pdx_carpetas c
      LEFT JOIN sop_pdx_archivos a ON a.carpeta_id = c.id
      GROUP BY c.id
      ORDER BY c.nombre_display ASC, c.periodo DESC`;
  const sqlSinArchivos = `
      SELECT c.*, 0 AS archivos_count
      FROM sop_pdx_carpetas c
      ORDER BY c.nombre_display ASC, c.periodo DESC`;
  let rows;
  try {
    rows = await db.query(sqlConArchivos);
  } catch (e) {
    if (e.code === 'ER_NO_SUCH_TABLE' && String(e.message || '').includes('sop_pdx_archivos')) {
      rows = await db.query(sqlSinArchivos);
    } else {
      throw e;
    }
  }
  rows.sort((a, b) => {
    const pc = String(b.periodo || '').localeCompare(String(a.periodo || ''));
    if (pc !== 0) return pc;
    return compararTextoNatural(a.nombre_display, b.nombre_display);
  });
  return rows;
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

const PERMS_PDX_VER_SUBIR = [
  'modulo.reportes_pdx',
  'modulo.reportes_historico',
  'soportes.pdx.ver',
  'soportes.pdx.subir'
];
const PERMS_PAPELERA_PDX = ['modulo.papelera_pdx'];
const PERMS_ARMADO_VER_SUBIR = ['modulo.armado_soportes', 'soportes.armado.subir'];

function notifySoportesPdx(cambio = {}) {
  try {
    emitSocket('soportes:pdx-actualizado', cambio);
  } catch (_) { /* noop */ }
}

function notifySoportesArmado(cambio = {}) {
  try {
    emitSocket('soportes:armado-actualizado', cambio);
  } catch (_) { /* noop */ }
}

const { applyHighlightsToPdfBytes, sanitizeHighlightsList } = require('../utils/soportes-pdf-highlights');
const { appendPdfFilesToExisting } = require('../utils/soportes-pdf-anexar');
const { sanitizePageIndexes, removePdfPagesFromBytes, reorderPdfPagesFromBytes } = require('../utils/soportes-pdf-pages');
const { readFileBuffer, writeFileAtomic } = require('../utils/fs-async');

async function writePdfBytesAtomic(filePath, buffer) {
  await writeFileAtomic(filePath, buffer);
}

function contentDispositionUtf8(kind, name) {
  const n = String(name || 'documento.pdf').replace(/"/g, '');
  return `${kind}; filename="${n}"; filename*=UTF-8''${encodeURIComponent(n)}`;
}

async function persistHighlightsOnPdfFile(filePath, highlights) {
  const bytes = await readFileBuffer(filePath);
  const next = await applyHighlightsToPdfBytes(bytes, highlights);
  await writePdfBytesAtomic(filePath, next);
  return next.length;
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

/** Catálogo de carpetas para asignar permisos por usuario (superadmin). */
router.get('/soportes/pdx/carpetas/catalogo-permisos', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const rows = await queryPdxCarpetasConCount();
    const carpetas = rows.map((r) => ({
      id: r.id,
      periodo: r.periodo,
      nombre_display: r.nombre_display,
      color_tema: r.color_tema || detectarTemaCarpeta(r.nombre_display),
      permiso_key: permisoKeyCarpetaPdx(r.id)
    }));
    ordenarPorTextoNatural(carpetas, 'nombre_display');
    res.json({ carpetas });
  } catch (e) {
    logger.error('[SOPORTES] catalogo permisos pdx:', e);
    res.status(500).json({ error: sopErrorCliente(e) });
  }
});

router.get('/soportes/pdx/carpetas', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, PERMS_PDX_VER_SUBIR), async (req, res) => {
  try {
    const rows = await queryPdxCarpetasConCount();
    const hoyPeriodo = periodoFromDate();
    await refrescarVisibilidadPdxPeriodos(rows.map((r) => r.periodo), req.session?.usuarioId || null);
    const visiblesSet = await loadVisibleEnSoportesSet();
    const lista = rows
      .filter((r) => usuarioVeCarpetaPdx(req, r))
      .map((r) => mapCarpetaPdx(r, visiblesSet))
      .filter((c) => c.estado_visibilidad !== 'archivo');
    ordenarPorTextoNatural(lista, 'nombre_display');
    res.json({ periodo_actual: hoyPeriodo, carpetas: lista });
  } catch (e) {
    logger.error('[SOPORTES] pdx carpetas:', e);
    res.status(500).json({ error: sopErrorCliente(e) });
  }
});

router.get('/soportes/pdx/carpetas-archivadas', requireAuth, requireRoleOrPerm(
  ROLES_SOPORTES,
  [...PERM_REPORTES_HISTORICO, 'soportes.pdx.ver']
), async (req, res) => {
  try {
    if (!puedeVerReportesHistorico(req)) {
      return res.status(403).json({ error: 'Sin permiso para consultar reportes archivados' });
    }
    const rows = await queryPdxCarpetasConCount();
    await refrescarVisibilidadPdxPeriodos(rows.map((r) => r.periodo), req.session?.usuarioId || null);
    const visiblesSet = await loadVisibleEnSoportesSet();
    let lista = rows
      .filter((r) => usuarioVeCarpetaPdx(req, r))
      .map((r) => mapCarpetaPdx(r, visiblesSet))
      .filter((c) => c.estado_visibilidad === 'archivo');
    const periodo = String(req.query.periodo || '').trim();
    const tema = String(req.query.tema || '').trim().toLowerCase();
    if (periodo && /^\d{4}-\d{2}$/.test(periodo)) {
      lista = lista.filter((c) => c.periodo === periodo);
    }
    if (tema) {
      lista = lista.filter((c) => (c.color_tema || 'neutral') === tema);
    }
    ordenarPorTextoNatural(lista, 'nombre_display');
    res.json({ carpetas: lista, total: lista.length });
  } catch (e) {
    logger.error('[SOPORTES] pdx carpetas archivadas:', e);
    res.status(500).json({ error: sopErrorCliente(e) });
  }
});

router.get('/soportes/pdx/buscar-archivadas', requireAuth, requireRoleOrPerm(
  ROLES_SOPORTES,
  [...PERM_REPORTES_HISTORICO, 'soportes.pdx.ver']
), async (req, res) => {
  try {
    if (!puedeVerReportesHistorico(req)) {
      return res.status(403).json({ error: 'Sin permiso para buscar reportes archivados' });
    }
    const q = String(req.query.q || '').trim();
    if (q.length < 2 || !tokenizeSearchQuery(q).length) return res.json({ resultados: [] });
    const visiblesSet = await loadVisibleEnSoportesSet();
    const { sql: whereSql, params: whereParams } = buildPdxBusquedaWhere(q);
    const archivos = await queryPdxBuscarArchivadasConUsuarios(whereSql, whereParams);
    const limitHit = Array.isArray(archivos) && archivos.length >= 150;
    const resultados = archivos.filter((a) => {
      if (!usuarioVeCarpetaPdx(req, a)) return false;
      if (Number(a.archivada_manual) === 1) return true;
      const vis = resolveVisibilidadPeriodo(a.periodo, 'pdx', periodoToRefId(a.periodo), visiblesSet);
      return vis === 'archivo';
    }).map((a) => {
      const enriched = enrichArchivoPdxConNombreDescarga(a, { nombre_display: a.carpeta_nombre });
      return {
        archivo_id: a.id,
        paciente_nombre: a.paciente_nombre,
        paciente_documento: a.paciente_documento || null,
        nombre_archivo_original: a.nombre_archivo_original,
        nombre_archivo_display: a.nombre_archivo_display,
        nombre_descarga: enriched.nombre_descarga,
        fecha_estudio: a.fecha_estudio,
        estudio_texto: a.estudio_texto,
        carpeta_id: a.carpeta_id,
        carpeta_nombre: a.carpeta_nombre,
        periodo: a.periodo,
        color_tema: a.color_tema,
        subido_por_nombre: a.subido_por_nombre || null,
        editado_por_nombre: a.editado_por_nombre || null,
        creado_en: a.creado_en || null,
        editado_en: a.editado_en || null
      };
    });
    res.json({ resultados, limit: 150, truncated: limitHit });
  } catch (e) {
    logger.error('[SOPORTES] buscar archivadas:', e);
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
      `INSERT INTO sop_pdx_carpetas (periodo, nombre_display, color_tema, roles_visibles, estado_visibilidad, creado_por)
       VALUES (?, ?, ?, NULL, ?, ?)`,
      [periodo, nombre, tema, vis, req.session.usuarioId ?? null]
    );
    const id = pdxInsertId(r);
    if (!id) {
      return res.status(500).json({ error: 'No se pudo registrar la carpeta (id inválido tras INSERT)' });
    }
    try {
      getPdxDir(id);
    } catch (dirErr) {
      await db.execute('DELETE FROM sop_pdx_carpetas WHERE id = ?', [id]).catch(() => {});
      logger.error('[SOPORTES] crear carpeta pdx disco:', dirErr);
      return res.status(500).json({ error: sopErrorCliente(dirErr) });
    }
    const rows = await db.query('SELECT * FROM sop_pdx_carpetas WHERE id = ?', [id]);
    if (!rows.length) {
      return res.status(500).json({ error: 'Carpeta creada pero no encontrada al leer' });
    }
    res.status(201).json({ ok: true, carpeta: mapCarpetaPdx({ ...rows[0], archivos_count: 0 }) });
    notifySoportesPdx({ accion: 'carpeta_creada', carpetaId: id, periodo });
  } catch (e) {
    if (String(e.message || '').includes('uk_sop_pdx')) {
      return res.status(409).json({ error: 'Ya existe una carpeta con ese nombre en el periodo' });
    }
    logger.error('[SOPORTES] crear carpeta pdx:', e);
    res.status(500).json({ error: sopErrorCliente(e) });
  }
});

router.patch('/soportes/pdx/carpetas/:id', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, ['modulo.reportes_pdx', 'soportes.pdx.editar', 'soportes.pdx.subir']), async (req, res) => {
  try {
    const rows = await db.query('SELECT * FROM sop_pdx_carpetas WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Carpeta no encontrada' });
    const prev = rows[0];
    const denied = denySinAccesoCarpetaPdx(req, prev);
    if (denied) return res.status(denied.status).json({ error: denied.error });
    const deniedEdit = await denyCarpetaPdxNoEditable(req, prev);
    if (deniedEdit) return res.status(deniedEdit.status).json({ error: deniedEdit.error });

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
    notifySoportesPdx({ accion: 'carpeta_editada', carpetaId: parseInt(req.params.id, 10), periodo });
  } catch (e) {
    if (String(e.message || '').includes('uk_sop_pdx')) {
      return res.status(409).json({ error: 'Ya existe una carpeta con ese nombre en el periodo' });
    }
    logger.error('[SOPORTES] editar carpeta pdx:', e);
    res.status(500).json({ error: safeError(e) });
  }
});

router.post('/soportes/pdx/carpetas/archivar', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, ['modulo.reportes_pdx', 'soportes.pdx.editar']), async (req, res) => {
  try {
    const rawIds = req.body?.ids;
    if (!Array.isArray(rawIds) || !rawIds.length) {
      return res.status(400).json({ error: 'Seleccione al menos una carpeta' });
    }
    const ids = [...new Set(rawIds.map((id) => parseInt(id, 10)).filter((id) => id > 0))];
    if (!ids.length) return res.status(400).json({ error: 'IDs de carpeta inválidos' });

    const visiblesSet = await loadVisibleEnSoportesSet();
    const archivadas = [];
    const omitidas = [];
    const errores = [];

    for (const id of ids) {
      const rows = await db.query('SELECT * FROM sop_pdx_carpetas WHERE id = ?', [id]);
      if (!rows.length) {
        errores.push({ id, error: 'Carpeta no encontrada' });
        continue;
      }
      const carpeta = rows[0];
      const denied = denySinAccesoCarpetaPdx(req, carpeta);
      if (denied) {
        errores.push({ id, error: denied.error });
        continue;
      }
      const vis = mapCarpetaPdx(
        { ...carpeta, archivos_count: 0 },
        visiblesSet
      ).estado_visibilidad;
      if (vis === 'archivo') {
        omitidas.push({ id, nombre_display: carpeta.nombre_display, motivo: 'ya_archivada' });
        continue;
      }
      // Solo cambio de visibilidad: la carpeta y sus PDF quedan iguales en disco
      // y pasan a verse en Reportes anteriores (sin ZIP ni copia).
      await db.execute(
        'UPDATE sop_pdx_carpetas SET archivada_manual = 1, estado_visibilidad = ? WHERE id = ?',
        ['archivo', id]
      );
      archivadas.push({ id, nombre_display: carpeta.nombre_display, periodo: carpeta.periodo });
    }

    if (!archivadas.length && !omitidas.length) {
      return res.status(400).json({
        error: 'No se pudo archivar ninguna carpeta',
        errores
      });
    }

    res.json({
      ok: true,
      archivadas,
      omitidas,
      errores
    });
    notifySoportesPdx({ accion: 'carpetas_archivadas', carpetaIds: archivadas.map((c) => c.id) });
  } catch (e) {
    logger.error('[SOPORTES] archivar carpetas pdx:', e);
    res.status(500).json({ error: sopErrorCliente(e) });
  }
});

/** Devuelve a Cargar reportes carpetas archivadas a mano cuyo periodo aún está activo/gracia. */
router.post('/soportes/pdx/carpetas/restaurar', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, ['modulo.reportes_pdx', 'soportes.pdx.editar']), async (req, res) => {
  try {
    const rawIds = req.body?.ids;
    if (!Array.isArray(rawIds) || !rawIds.length) {
      return res.status(400).json({ error: 'Seleccione al menos una carpeta' });
    }
    const ids = [...new Set(rawIds.map((id) => parseInt(id, 10)).filter((id) => id > 0))];
    if (!ids.length) return res.status(400).json({ error: 'IDs de carpeta inválidos' });

    const restauradas = [];
    const omitidas = [];
    const errores = [];

    for (const id of ids) {
      const rows = await db.query('SELECT * FROM sop_pdx_carpetas WHERE id = ?', [id]);
      if (!rows.length) {
        errores.push({ id, error: 'Carpeta no encontrada' });
        continue;
      }
      const carpeta = rows[0];
      const denied = denySinAccesoCarpetaPdx(req, carpeta);
      if (denied) {
        errores.push({ id, error: denied.error });
        continue;
      }
      if (!Number(carpeta.archivada_manual)) {
        omitidas.push({
          id,
          nombre_display: carpeta.nombre_display,
          motivo: 'no_manual',
          detalle: 'Esta carpeta está en Reportes anteriores por cierre de mes; no se archiva/restaura a mano.'
        });
        continue;
      }
      const visPeriodo = calcularVisibilidadPeriodo(carpeta.periodo);
      if (visPeriodo === 'archivo') {
        omitidas.push({
          id,
          nombre_display: carpeta.nombre_display,
          motivo: 'periodo_cerrado',
          detalle: 'El periodo ya cerró: la carpeta permanece en Reportes anteriores para consulta.'
        });
        continue;
      }
      await db.execute(
        'UPDATE sop_pdx_carpetas SET archivada_manual = 0, estado_visibilidad = ? WHERE id = ?',
        [visPeriodo, id]
      );
      restauradas.push({
        id,
        nombre_display: carpeta.nombre_display,
        periodo: carpeta.periodo,
        estado_visibilidad: visPeriodo
      });
    }

    if (!restauradas.length && !omitidas.length) {
      return res.status(400).json({
        error: 'No se pudo devolver ninguna carpeta',
        errores
      });
    }

    res.json({
      ok: true,
      restauradas,
      omitidas,
      errores
    });
    notifySoportesPdx({ accion: 'carpetas_restauradas', carpetaIds: restauradas.map((c) => c.id) });
  } catch (e) {
    logger.error('[SOPORTES] restaurar carpetas pdx:', e);
    res.status(500).json({ error: sopErrorCliente(e) });
  }
});

router.delete('/soportes/pdx/carpetas/:id', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, ['modulo.reportes_pdx', 'soportes.pdx.eliminar']), async (req, res) => {
  const carpetaId = parseInt(req.params.id, 10);
  if (!carpetaId) return res.status(400).json({ error: 'ID de carpeta inválido' });
  try {
    const rows = await db.query('SELECT * FROM sop_pdx_carpetas WHERE id = ?', [carpetaId]);
    if (!rows.length) return res.status(404).json({ error: 'Carpeta no encontrada' });
    const deniedDel = denySinAccesoCarpetaPdx(req, rows[0]);
    if (deniedDel) return res.status(deniedDel.status).json({ error: deniedDel.error });
    const archivos = await db.query('SELECT * FROM sop_pdx_archivos WHERE carpeta_id = ?', [carpetaId]);
    const usados = await db.query(
      `SELECT COUNT(*) AS n FROM sop_exp_archivos e
       INNER JOIN sop_pdx_archivos a ON a.id = e.pdx_archivo_id
       WHERE a.carpeta_id = ?`,
      [carpetaId]
    );
    if (usados[0]?.n > 0 && req.query.force !== '1') {
      return res.status(409).json({
        error: 'Hay archivos de esta carpeta vinculados a expedientes FE. No se puede eliminar.',
        vinculados: usados[0].n
      });
    }
    if (req.query.force === '1' && archivos.length) {
      const ids = archivos.map((a) => a.id);
      const ph = ids.map(() => '?').join(',');
      await db.execute(
        `UPDATE sop_exp_archivos SET pdx_archivo_id = NULL WHERE pdx_archivo_id IN (${ph})`,
        ids
      );
    }
    const carpeta = rows[0];
    let enviadosPapelera = 0;
    for (const a of archivos) {
      try {
        await enviarArchivoAPapelera({
          archivo: a,
          carpeta,
          usuarioId: req.session.usuarioId
        });
        enviadosPapelera += 1;
      } catch (papErr) {
        logger.warn('[SOPORTES] papelera al eliminar carpeta pdx', { id: a.id, message: papErr.message });
      }
    }
    await db.execute('DELETE FROM sop_pdx_archivos WHERE carpeta_id = ?', [carpetaId]);
    await db.execute('DELETE FROM sop_pdx_carpetas WHERE id = ?', [carpetaId]);
    try {
      const dir = path.join(require('../utils/soportes-storage').soportesRoot, 'pdx', String(carpetaId));
      if (fs.existsSync(dir)) {
        const leftover = fs.readdirSync(dir);
        if (!leftover.length) fs.rmSync(dir, { recursive: true, force: true });
      }
    } catch (_) { /* ignore */ }
    res.json({ ok: true, eliminados: archivos.length, papelera: enviadosPapelera });
    notifySoportesPdx({ accion: 'carpeta_eliminada', carpetaId });
  } catch (e) {
    logger.error('[SOPORTES] eliminar carpeta pdx:', e);
    res.status(500).json({ error: sopErrorCliente(e), detail: String(e?.message || '').slice(0, 200) });
  }
});

router.get('/soportes/pdx/carpetas/:id/archivos', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, PERMS_PDX_VER_SUBIR), async (req, res) => {
  try {
    const carpeta = await db.query('SELECT * FROM sop_pdx_carpetas WHERE id = ?', [req.params.id]);
    if (!carpeta.length) return res.status(404).json({ error: 'Carpeta no encontrada' });
    const deniedArch = denySinAccesoCarpetaPdx(req, carpeta[0]);
    if (deniedArch) return res.status(deniedArch.status).json({ error: deniedArch.error });
    const vis = await visibilidadCarpetaPdx(carpeta[0]);
    const deniedHist = denyPdxSoloHistoricoEnCarpetaActiva(req, vis);
    if (deniedHist) return res.status(deniedHist.status).json({ error: deniedHist.error });
    if (vis === 'archivo' && !puedeVerArchivo(req)) {
      return res.status(403).json({ error: 'Carpeta en archivo' });
    }
    const visiblesSet = await loadVisibleEnSoportesSet();
    const archivos = await queryPdxArchivosConUsuarios(req.params.id);
    const carp = jsonSafeRow(carpeta[0]);
    res.json({
      carpeta: mapCarpetaPdx({ ...carp, archivos_count: archivos.length }, visiblesSet),
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

router.post('/soportes/pdx/carpetas/:id/pre-analizar', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, ['modulo.reportes_pdx', 'soportes.pdx.subir', 'soportes.pdx.ver']), async (req, res) => {
  try {
    const nombre = String(req.body?.nombre || '').trim();
    if (!nombre) return res.status(400).json({ error: 'Indique el nombre del archivo' });
    const carpetaRows = await db.query('SELECT * FROM sop_pdx_carpetas WHERE id = ?', [req.params.id]);
    if (!carpetaRows.length) return res.status(404).json({ error: 'Carpeta no encontrada' });
    const carpeta = carpetaRows[0];
    const deniedPre = denySinAccesoCarpetaPdx(req, carpeta);
    if (deniedPre) return res.status(deniedPre.status).json({ error: deniedPre.error });
    if (necesitaListaEstudios(carpeta)) {
      carpeta._estudiosLista = await cargarListaParaCarpetaPdx(db, carpeta);
    }
    const { analizarNombreArchivo, ayudaFormatoPorTema } = require('../utils/soportes-pdx-parse');
    const analisis = analizarNombreArchivo(nombre, carpeta, carpeta._estudiosLista || []);
    const ayuda = ayudaFormatoPorTema(analisis.tema || detectarTemaCarpeta(carpeta.nombre_display));
    let duplicado = null;
    if (analisis.ok && analisis.parsed) {
      const p = analisis.parsed;
      const tmpMeta = {
        ...p,
        paciente_nombre_norm: p.paciente_nombre_norm || normalizarNombreBusqueda(
          p.paciente_nombre || `${p.apellidos || ''}, ${p.nombres || ''}`
        ),
        nombre_archivo_display: nombreArchivoDescarga(p, carpeta)
      };
      const dup = await buscarDuplicadoPdxEnCarpeta(db, carpeta.id, tmpMeta, carpeta);
      if (dup) {
        duplicado = { id: dup.row.id, mensaje: mensajeDuplicadoPdx(dup) };
      }
    }
    res.json({
      ...analisis,
      ayuda_formato: ayuda,
      duplicado,
      carpeta: { id: carpeta.id, nombre_display: carpeta.nombre_display, periodo: carpeta.periodo }
    });
  } catch (e) {
    res.status(500).json({ error: safeError(e) });
  }
});

router.post(
  '/soportes/pdx/carpetas/:id/archivos',
  requireAuth,
  requireRoleOrPerm(ROLES_SOPORTES, ['modulo.reportes_pdx', 'soportes.pdx.subir']),
  requirePdxCarpetaExiste,
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
      const deniedUp = denySinAccesoCarpetaPdx(req, carpeta);
      if (deniedUp) return res.status(deniedUp.status).json({ error: deniedUp.error });
      const deniedUpEdit = await denyCarpetaPdxNoEditable(req, carpeta);
      if (deniedUpEdit) {
        return res.status(deniedUpEdit.status).json({
          error: deniedUpEdit.error === 'Carpeta en archivo: no editable'
            ? 'Carpeta cerrada para carga'
            : deniedUpEdit.error
        });
      }

      step = 'meta';
      if (necesitaListaEstudios(carpeta)) {
        carpeta._estudiosLista = await cargarListaParaCarpetaPdx(db, carpeta);
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
        meta.paciente_documento = normalizarNumeroDocumentoPdx(req.body.paciente_documento);
      }
      if (req.body.tipo_documento) {
        meta.tipo_documento = normalizarTipoDocumentoPdx(req.body.tipo_documento);
      }

      const warnings = collectPdxWarnings(meta, carpeta);

      step = 'duplicado';
      const dup = await buscarDuplicadoPdxEnCarpeta(db, carpeta.id, meta, carpeta);
      if (dup) {
        if (uploadedPath && fs.existsSync(uploadedPath)) {
          try { fs.unlinkSync(uploadedPath); } catch (_) { /* ignore */ }
        }
        uploadedPath = null;
        return res.status(409).json({
          error: mensajeDuplicadoPdx(dup),
          codigo: 'PDX_DUPLICADO',
          duplicado_de: dup.row.id
        });
      }

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
      notifySoportesPdx({ accion: 'archivo_subido', carpetaId: carpeta.id, archivoId: newId, periodo: carpeta.periodo });
    } catch (e) {
      if (uploadedPath && fs.existsSync(uploadedPath)) {
        try { fs.unlinkSync(uploadedPath); } catch (_) { /* ignore */ }
      }
      logger.error('[SOPORTES] subir pdx', e);
      const status = /no encontrado|ZIP vacío|requerido/i.test(e?.message || '') ? 400
        : (e?.code === 'ER_DUP_ENTRY' ? 409 : 500);
      res.status(status).json(pdxListErrorPayload(req, e, step));
    }
  }
);

router.post(
  '/soportes/pdx/carpetas/:id/archivos/unificar',
  requireAuth,
  requireRoleOrPerm(ROLES_SOPORTES, ['modulo.reportes_pdx', 'soportes.pdx.subir']),
  requirePdxCarpetaExiste,
  uploadPdxMultiple,
  validateMagicBytes,
  async (req, res) => {
    const partPaths = [];
    let mergedTmp = null;
    try {
      const files = req.files || [];
      if (files.length < 2) {
        cleanupMulterTempFiles(req);
        return res.status(400).json({ error: 'Para unificar debe seleccionar 2 o más PDF' });
      }
      partPaths.push(...files.map((f) => f.path).filter(Boolean));

      const carpetaRows = await db.query('SELECT * FROM sop_pdx_carpetas WHERE id = ?', [req.params.id]);
      if (!carpetaRows.length) {
        cleanupMulterTempFiles(req);
        return res.status(404).json({ error: 'Carpeta no encontrada' });
      }
      const carpeta = carpetaRows[0];
      const deniedUni = denySinAccesoCarpetaPdx(req, carpeta);
      if (deniedUni) {
        cleanupMulterTempFiles(req);
        return res.status(deniedUni.status).json({ error: deniedUni.error });
      }
      const deniedUniEdit = await denyCarpetaPdxNoEditable(req, carpeta);
      if (deniedUniEdit) {
        cleanupMulterTempFiles(req);
        return res.status(deniedUniEdit.status).json({
          error: deniedUniEdit.error === 'Carpeta en archivo: no editable'
            ? 'Carpeta cerrada para carga'
            : deniedUniEdit.error
        });
      }

      carpeta._estudiosLista = await cargarListaParaCarpetaPdx(db, carpeta);
      const refLabel = files.map((f) => f.originalname).join(' + ');
      const body = { ...req.body, confirmacion_manual: '1' };
      const meta = buildMetaDesdeCamposManuales(refLabel, body, carpeta);
      if (!meta.ok) {
        cleanupMulterTempFiles(req);
        return res.status(400).json({ error: meta.error || mensajeErrorFormato(tema) });
      }

      const { mergePdfFilesToTemp } = require('../utils/soportes-opf-merge');
      mergedTmp = await mergePdfFilesToTemp(partPaths);
      for (const p of partPaths) {
        try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch (_) { /* ignore */ }
      }
      partPaths.length = 0;

      const tamano = fs.statSync(mergedTmp).size;
      const fakeFile = {
        path: mergedTmp,
        originalname: meta.nombre_archivo_display || refLabel,
        size: tamano,
        filename: path.basename(mergedTmp)
      };

      const warnings = collectPdxWarnings(meta, carpeta);

      const dupUni = await buscarDuplicadoPdxEnCarpeta(db, carpeta.id, meta, carpeta);
      if (dupUni) {
        if (mergedTmp && fs.existsSync(mergedTmp)) {
          try { fs.unlinkSync(mergedTmp); } catch (_) { /* ignore */ }
        }
        mergedTmp = null;
        return res.status(409).json({
          error: mensajeDuplicadoPdx(dupUni),
          codigo: 'PDX_DUPLICADO',
          duplicado_de: dupUni.row.id
        });
      }

      const { rutaRelativa, nombre_archivo_display } = finalizePdxFileOnDisk(
        carpeta.id,
        fakeFile,
        meta,
        carpeta
      );
      meta.ruta_relativa = rutaRelativa;
      meta.nombre_archivo_display = nombre_archivo_display;
      mergedTmp = null;

      const ins = await insertPdxArchivoRow(carpeta.id, meta, fakeFile, req.session);
      const newId = pdxInsertId(ins);
      if (!newId) throw new Error('No se obtuvo id del archivo unificado');

      await logPdxArchivo(
        newId,
        'subida',
        req.session.usuarioId,
        `Unificado (${files.length} PDF): ${refLabel}`
      );
      const row = await db.query('SELECT * FROM sop_pdx_archivos WHERE id = ?', [newId]);
      res.status(201).json({
        ok: true,
        unificados: files.length,
        archivo: safeEnrichArchivoPdxConNombreDescarga(jsonSafeRow(row[0]), carpeta),
        warnings
      });
      notifySoportesPdx({ accion: 'archivos_unificados', carpetaId: carpeta.id, archivoId: newId, periodo: carpeta.periodo });
    } catch (e) {
      if (mergedTmp && fs.existsSync(mergedTmp)) {
        try { fs.unlinkSync(mergedTmp); } catch (_) { /* ignore */ }
      }
      for (const p of partPaths) {
        try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch (_) { /* ignore */ }
      }
      cleanupMulterTempFiles(req);
      logger.error('[SOPORTES] unificar pdx', { carpetaId: req.params.id, message: e?.message });
      res.status(500).json(pdxListErrorPayload(req, e));
    }
  }
);

router.get('/soportes/pdx/buscar', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, PERMS_PDX_VER_SUBIR), async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const slotFiltro = String(req.query.slot || '').toUpperCase();
    if (q.length < 2 || !tokenizeSearchQuery(q).length) return res.json({ resultados: [] });
    const visiblesSet = await loadVisibleEnSoportesSet();
    const { sql: whereSql, params: whereParams } = buildPdxBusquedaWhere(q);
    const archivos = await db.query(
      `SELECT a.*, c.nombre_display AS carpeta_nombre, c.periodo, c.color_tema, c.roles_visibles,
              COALESCE(c.archivada_manual, 0) AS archivada_manual
       FROM sop_pdx_archivos a
       JOIN sop_pdx_carpetas c ON c.id = a.carpeta_id
       WHERE ${whereSql}
       ORDER BY a.fecha_estudio DESC LIMIT 120`,
      whereParams
    );
    const { resolverDestinoImportacion } = require('../utils/soportes-deposito-import');
    const { carpetaCoincideSlotDeposito } = require('../utils/soportes-deposito-filtro');
    const limitHit = archivos.length >= 120;
    const resultados = archivos.filter((a) => {
      if (!usuarioVeCarpetaPdx(req, a)) return false;
      // Cargar reportes: nunca devolver carpetas ya enviadas a Reportes anteriores.
      if (Number(a.archivada_manual) === 1) return false;
      const vis = resolveVisibilidadPeriodo(a.periodo, 'pdx', periodoToRefId(a.periodo), visiblesSet);
      if (vis === 'archivo') return false;
      if (slotFiltro && !carpetaCoincideSlotDeposito(slotFiltro, a)) return false;
      return true;
    }).map((a) => {
      const enriched = enrichArchivoPdxConNombreDescarga(a, { nombre_display: a.carpeta_nombre });
      const dest = resolverDestinoImportacion(a);
      return {
        archivo_id: a.id,
        paciente_nombre: a.paciente_nombre,
        paciente_documento: a.paciente_documento || null,
        nombre_archivo_original: a.nombre_archivo_original,
        nombre_archivo_display: a.nombre_archivo_display,
        nombre_descarga: enriched.nombre_descarga,
        fecha_estudio: a.fecha_estudio,
        estudio_texto: a.estudio_texto,
        carpeta_id: a.carpeta_id,
        carpeta_nombre: a.carpeta_nombre,
        periodo: a.periodo,
        color_tema: a.color_tema,
        destino_importacion: dest.modo === 'no_soportes' ? '—' : (dest.modo === 'vinculo' ? dest.etiqueta : (dest.slot || 'PDX')),
        destino_modo: dest.modo,
        puede_vincular_fe: dest.modo !== 'no_soportes',
        puede_importar_ucqn: true
      };
    });
    res.json({
      resultados,
      limit: 120,
      truncated: limitHit
    });
  } catch (e) {
    res.status(500).json({ error: safeError(e) });
  }
});

router.get('/soportes/pdx/buscar-ordenes', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, ['modulo.armado_soportes', 'soportes.armado.subir']), async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2 || !tokenizeSearchQuery(q).length) return res.json({ resultados: [] });
    const incluirArchivo = puedeVerArchivo(req);
    const visiblesSet = await loadVisibleEnSoportesSet();
    const { sql: whereSql, params: whereParams } = buildPdxBusquedaWhere(q);
    const archivos = await db.query(
      `SELECT a.*, c.nombre_display AS carpeta_nombre, c.periodo, c.color_tema, c.roles_visibles
       FROM sop_pdx_archivos a
       JOIN sop_pdx_carpetas c ON c.id = a.carpeta_id
       WHERE ${whereSql}
       ORDER BY a.fecha_estudio DESC LIMIT 150`,
      whereParams
    );
    const { esArchivoOrdenHcPdx } = require('../utils/soportes-opf-merge');
    const resultados = archivos.filter((a) => {
      if (!usuarioVeCarpetaPdx(req, a)) return false;
      const vis = resolveVisibilidadPeriodo(a.periodo, 'pdx', periodoToRefId(a.periodo), visiblesSet);
      if (vis === 'archivo' && !incluirArchivo) return false;
      return esArchivoOrdenHcPdx(a);
    }).map((a) => {
      const enriched = enrichArchivoPdxConNombreDescarga(a, { nombre_display: a.carpeta_nombre });
      return {
        archivo_id: a.id,
        paciente_nombre: a.paciente_nombre,
        paciente_documento: a.paciente_documento,
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
    }).slice(0, 80);
    res.json({ resultados });
  } catch (e) {
    res.status(500).json({ error: safeError(e) });
  }
});

router.patch('/soportes/pdx/archivos/:id', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, ['modulo.reportes_pdx', 'soportes.pdx.editar', 'soportes.pdx.subir']), async (req, res) => {
  try {
    const rows = await db.query(
      `SELECT a.*, c.periodo, c.color_tema AS carpeta_tema, c.nombre_display AS carpeta_nombre, c.roles_visibles FROM sop_pdx_archivos a
       JOIN sop_pdx_carpetas c ON c.id = a.carpeta_id WHERE a.id = ?`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Archivo no encontrado' });
    const prev = rows[0];
    const deniedEd = denySinAccesoCarpetaPdx(req, prev);
    if (deniedEd) return res.status(deniedEd.status).json({ error: deniedEd.error });
    const vis = await visPdxPeriodo(prev.periodo);
    if (vis === 'archivo') return res.status(403).json({ error: 'Carpeta en archivo: no editable' });

    const marcaTiempo = req.body?.marca_tiempo != null
      ? String(req.body.marca_tiempo).trim()
      : (req.body?.tipo_consulta != null ? String(req.body.tipo_consulta).trim() : prev.marca_tiempo);
    const apellidos = req.body?.apellidos != null ? String(req.body.apellidos).trim() : prev.apellidos;
    const nombres = req.body?.nombres != null ? String(req.body.nombres).trim() : prev.nombres;
    const fecha = req.body?.fecha_estudio != null ? req.body.fecha_estudio : prev.fecha_estudio;
    const estudio = req.body?.estudio_texto != null ? String(req.body.estudio_texto).trim() : prev.estudio_texto;
    const documento = req.body?.paciente_documento != null
      ? normalizarNumeroDocumentoPdx(req.body.paciente_documento)
      : normalizarNumeroDocumentoPdx(prev.paciente_documento || '');
    if (!apellidos || !nombres || !fecha) {
      return res.status(400).json({ error: 'Apellidos, nombres y fecha son obligatorios' });
    }
    const temaCarpeta = detectarTemaCarpeta(prev.carpeta_nombre);
    let estudioFinal = estudio;
    if (!estudioFinal && ['vtm', 'eeg', 'psg', 'actigrafia', 'latencia'].includes(temaCarpeta)) {
      estudioFinal = inferirEstudioDesdeCarpeta({ nombre_display: prev.carpeta_nombre });
    }
    if (!estudioFinal) {
      return res.status(400).json({ error: 'Apellidos, nombres, fecha y estudio son obligatorios' });
    }
    const { temaRequiereDocumentoPdx } = require('../utils/soportes-pdx-campos');
    const requiereDocumento = temaRequiereDocumentoPdx(temaCarpeta);
    if (requiereDocumento && !numeroDocumentoValidoPdx(documento)) {
      return res.status(400).json({ error: 'El número de documento es obligatorio (solo dígitos, 4 a 20)' });
    }

    const pacienteNombre = `${apellidos}, ${nombres}`;

    let carpetaId = prev.carpeta_id;
    let rutaRelativa = prev.ruta_relativa;
    let carpetaCtx = { nombre_display: prev.carpeta_nombre, color_tema: prev.carpeta_tema, periodo: prev.periodo };
    const reparsed = parseNombrePorCarpeta(prev.nombre_archivo_original, carpetaCtx);
    const tipoDoc = req.body?.tipo_documento != null
      ? normalizarTipoDocumentoPdx(req.body.tipo_documento)
      : (reparsed.ok ? normalizarTipoDocumentoPdx(reparsed.tipo_documento) : 'CC');
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
      const deniedDest = denySinAccesoCarpetaPdx(req, destCarpeta);
      if (deniedDest) return res.status(deniedDest.status).json({ error: deniedDest.error });
      const visDest = await visPdxPeriodo(destCarpeta.periodo);
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
        paciente_documento = ?, fecha_estudio = ?, marca_tiempo = ?, estudio_texto = ?,
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
        marcaTiempo || null,
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
    notifySoportesPdx({
      accion: logTipo === 'movimiento' ? 'archivo_movido' : 'archivo_editado',
      archivoId: parseInt(req.params.id, 10),
      carpetaId: carpetaId || prev.carpeta_id,
      carpetaIdAnterior: prev.carpeta_id
    });
  } catch (e) {
    logger.error('[SOPORTES] editar archivo pdx:', e);
    res.status(500).json({ error: safeError(e) });
  }
});

router.delete('/soportes/pdx/archivos/:id', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, ['modulo.reportes_pdx', 'soportes.pdx.eliminar']), async (req, res) => {
  try {
    const rows = await db.query(
      `SELECT a.*, c.roles_visibles, c.periodo AS carpeta_periodo, c.nombre_display AS carpeta_nombre,
              c.color_tema AS carpeta_color_tema
       FROM sop_pdx_archivos a
       JOIN sop_pdx_carpetas c ON c.id = a.carpeta_id WHERE a.id = ?`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'No encontrado' });
    const deniedDelArch = denySinAccesoCarpetaPdx(req, rows[0]);
    if (deniedDelArch) return res.status(deniedDelArch.status).json({ error: deniedDelArch.error });
    const row = rows[0];
    let papeleraId = null;
    try {
      const pap = await enviarArchivoAPapelera({
        archivo: row,
        carpeta: {
          id: row.carpeta_id,
          periodo: row.carpeta_periodo,
          nombre_display: row.carpeta_nombre,
          color_tema: row.carpeta_color_tema,
          roles_visibles: row.roles_visibles
        },
        usuarioId: req.session.usuarioId
      });
      papeleraId = pap?.id || null;
    } catch (papErr) {
      logger.warn('[SOPORTES] papelera al eliminar pdx', { id: req.params.id, message: papErr.message });
      return res.status(500).json({ error: 'No se pudo enviar el archivo a la papelera. No se eliminó.' });
    }
    await db.execute('DELETE FROM sop_pdx_archivos WHERE id = ?', [req.params.id]);
    res.json({ ok: true, papelera: true, papelera_id: papeleraId });
    notifySoportesPdx({
      accion: 'archivo_eliminado',
      archivoId: parseInt(req.params.id, 10),
      carpetaId: row.carpeta_id
    });
  } catch (e) {
    res.status(500).json({ error: safeError(e) });
  }
});

router.get('/soportes/pdx/papelera', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, PERMS_PAPELERA_PDX), async (req, res) => {
  try {
    let items = await listarPapelera();
    items = items.filter((item) => {
      if (!item.carpeta_id) return true;
      return usuarioVeCarpetaPdx(req, {
        carpeta_id: item.carpeta_id,
        roles_visibles: item.carpeta_roles_visibles
      });
    });
    res.json({ ok: true, items, total: items.length });
  } catch (e) {
    logger.error('[SOPORTES] listar papelera pdx:', e);
    res.status(500).json({ error: sopErrorCliente(e, 'No se pudo cargar la papelera') });
  }
});

router.post('/soportes/pdx/papelera/escanear-backups', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, PERMS_PAPELERA_PDX), async (req, res) => {
  try {
    const result = await escanearBackupsPdx();
    res.json({ ok: true, ...result });
  } catch (e) {
    logger.error('[SOPORTES] escanear backups papelera pdx:', e);
    res.status(500).json({ error: sopErrorCliente(e, 'No se pudo buscar en copias de seguridad') });
  }
});

router.get('/soportes/pdx/papelera/:id/ver', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, PERMS_PAPELERA_PDX), async (req, res) => {
  try {
    const item = await obtenerPapelera(req.params.id);
    if (!item || item.recuperado_en) return res.status(404).json({ error: 'No encontrado' });
    if (!usuarioVeCarpetaPdx(req, { carpeta_id: item.carpeta_id, id: item.carpeta_id, roles_visibles: item.carpeta_roles_visibles })) {
      return res.status(403).json({ error: 'No tiene acceso a esta carpeta' });
    }
    const fp = absPapelera(item);
    if (!fp) return res.status(404).json({ error: 'Archivo no disponible en disco' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(item.nombre_archivo_original || 'archivo.pdf')}"`);
    fs.createReadStream(fp).pipe(res);
  } catch (e) {
    res.status(500).json({ error: safeError(e) });
  }
});

router.post('/soportes/pdx/papelera/:id/recuperar', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, PERMS_PAPELERA_PDX), async (req, res) => {
  try {
    const item = await obtenerPapelera(req.params.id);
    if (!item) return res.status(404).json({ error: 'No encontrado' });
    if (!usuarioVeCarpetaPdx(req, { carpeta_id: item.carpeta_id, id: item.carpeta_id, roles_visibles: item.carpeta_roles_visibles })) {
      return res.status(403).json({ error: 'No tiene acceso a esta carpeta' });
    }
    const result = await recuperarItemPapelera(item.id, req.session.usuarioId);
    res.json({ ok: true, ...result });
    notifySoportesPdx({ accion: 'archivo_recuperado', archivoId: result.archivo_id, carpetaId: result.carpeta_id });
  } catch (e) {
    const status = e.status || 500;
    logger.error('[SOPORTES] recuperar papelera pdx:', e);
    res.status(status).json({ error: e.status ? e.message : sopErrorCliente(e, 'No se pudo recuperar el archivo') });
  }
});

router.get('/soportes/pdx/archivos/:id/descargar', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, PERMS_PDX_VER_SUBIR), async (req, res) => {
  try {
    const rows = await db.query(
      `SELECT a.*, c.periodo, c.nombre_display AS carpeta_nombre, c.roles_visibles FROM sop_pdx_archivos a
       JOIN sop_pdx_carpetas c ON c.id = a.carpeta_id WHERE a.id = ?`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'No encontrado' });
    const row = rows[0];
    const deniedDl = denySinAccesoCarpetaPdx(req, row);
    if (deniedDl) return res.status(deniedDl.status).json({ error: deniedDl.error });
    const vis = await visPdxPeriodo(row.periodo);
    const deniedHistDl = denyPdxSoloHistoricoEnCarpetaActiva(req, vis);
    if (deniedHistDl) return res.status(deniedHistDl.status).json({ error: deniedHistDl.error });
    if (vis === 'archivo' && !puedeVerArchivo(req)) return res.status(403).json({ error: 'Archivo en carpeta cerrada' });
    const fp = await resolvePdxArchivoPathForApi(row, true);
    if (!fp) return res.status(404).json({ error: 'Archivo no en disco' });
    const downloadName = safeNombreDescargaPdx(row, { nombre_display: row.carpeta_nombre });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${String(downloadName).replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`
    );
    const stream = fs.createReadStream(fp);
    stream.on('error', (err) => {
      logger.error('[SOPORTES] descargar pdx stream:', err);
      if (!res.headersSent) res.status(500).json({ error: 'No se pudo leer el archivo' });
    });
    stream.pipe(res);
  } catch (e) {
    logger.error('[SOPORTES] descargar pdx:', e);
    if (!res.headersSent) res.status(500).json({ error: sopErrorCliente(e, 'No se pudo descargar el archivo') });
  }
});

router.get('/soportes/pdx/archivos/:id/ver', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, PERMS_PDX_VER_SUBIR), async (req, res) => {
  try {
    const rows = await db.query(
      `SELECT a.*, c.periodo, c.roles_visibles FROM sop_pdx_archivos a JOIN sop_pdx_carpetas c ON c.id = a.carpeta_id WHERE a.id = ?`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'No encontrado' });
    const deniedVer = denySinAccesoCarpetaPdx(req, rows[0]);
    if (deniedVer) return res.status(deniedVer.status).json({ error: deniedVer.error });
    const vis = await visPdxPeriodo(rows[0].periodo);
    const deniedHistVer = denyPdxSoloHistoricoEnCarpetaActiva(req, vis);
    if (deniedHistVer) return res.status(deniedHistVer.status).json({ error: deniedHistVer.error });
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

router.post(
  '/soportes/pdx/archivos/:id/resaltar',
  requireAuth,
  requireRoleOrPerm(ROLES_SOPORTES, PERMS_PDX_VER_SUBIR),
  async (req, res) => {
    try {
      const highlights = req.body?.highlights;
      if (!Array.isArray(highlights) || highlights.length === 0) {
        return res.status(400).json({ error: 'Indique al menos un resaltado' });
      }
      const rows = await db.query(
        `SELECT a.*, c.periodo, c.roles_visibles FROM sop_pdx_archivos a JOIN sop_pdx_carpetas c ON c.id = a.carpeta_id WHERE a.id = ?`,
        [req.params.id]
      );
      if (!rows.length) return res.status(404).json({ error: 'No encontrado' });
      const row = rows[0];
      const deniedRes = denySinAccesoCarpetaPdx(req, row);
      if (deniedRes) return res.status(deniedRes.status).json({ error: deniedRes.error });
      const vis = await visPdxPeriodo(row.periodo);
      if (vis === 'archivo') return res.status(403).json({ error: 'Carpeta cerrada' });
      const fp = await resolvePdxArchivoPathForApi(row, true);
      if (!fp || !fs.existsSync(fp)) return res.status(404).json({ error: 'Archivo no en disco' });

      const bytes = await readFileBuffer(fp);
      const { PDFDocument } = require('pdf-lib');
      const probe = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const sanitized = sanitizeHighlightsList(highlights, probe.getPageCount());
      if (!sanitized.length) return res.status(400).json({ error: 'Resaltados no válidos' });

      const tamano = await persistHighlightsOnPdfFile(fp, sanitized);
      await db.execute(
        'UPDATE sop_pdx_archivos SET tamano_bytes = ?, editado_por = ?, editado_en = NOW() WHERE id = ?',
        [tamano, req.session.usuarioId, req.params.id]
      );
      await logPdxArchivo(
        req.params.id,
        'resaltado',
        req.session.usuarioId,
        `${sanitized.length} marca(s)`
      );
      res.json({ ok: true, aplicados: sanitized.length, tamano_bytes: tamano });
    } catch (e) {
      logger.error('[SOPORTES] resaltar pdx:', e);
      res.status(500).json({ error: safeError(e) });
    }
  }
);

router.post(
  '/soportes/pdx/archivos/:id/anexar-pdf',
  requireAuth,
  requireRoleOrPerm(ROLES_SOPORTES, PERMS_PDX_VER_SUBIR),
  (req, res, next) => {
    uploadArmadoSoportes.array('partes', 12)(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message || 'Error al subir PDF' });
      next();
    });
  },
  validateMagicBytes,
  async (req, res) => {
    try {
      const partes = (req.files || []).map((f) => f.path).filter(Boolean);
      if (!partes.length) {
        cleanupMulterTempFiles(req);
        return res.status(400).json({ error: 'Seleccione al menos un PDF para añadir' });
      }
      const rows = await db.query(
        `SELECT a.*, c.periodo, c.roles_visibles FROM sop_pdx_archivos a JOIN sop_pdx_carpetas c ON c.id = a.carpeta_id WHERE a.id = ?`,
        [req.params.id]
      );
      if (!rows.length) {
        cleanupMulterTempFiles(req);
        return res.status(404).json({ error: 'No encontrado' });
      }
      const row = rows[0];
      const deniedAnx = denySinAccesoCarpetaPdx(req, row);
      if (deniedAnx) {
        cleanupMulterTempFiles(req);
        return res.status(deniedAnx.status).json({ error: deniedAnx.error });
      }
      const vis = await visPdxPeriodo(row.periodo);
      if (vis === 'archivo') {
        cleanupMulterTempFiles(req);
        return res.status(403).json({ error: 'Carpeta cerrada' });
      }
      const fp = await resolvePdxArchivoPathForApi(row, true);
      if (!fp || !fs.existsSync(fp)) {
        cleanupMulterTempFiles(req);
        return res.status(404).json({ error: 'Archivo no en disco' });
      }
      const tamano = await appendPdfFilesToExisting(fp, partes);
      cleanupMulterTempFiles(req);
      await db.execute(
        'UPDATE sop_pdx_archivos SET tamano_bytes = ?, editado_por = ?, editado_en = NOW() WHERE id = ?',
        [tamano, req.session.usuarioId, req.params.id]
      );
      await logPdxArchivo(req.params.id, 'anexo_pdf', req.session.usuarioId, `+${partes.length} PDF`);
      res.json({ ok: true, anexados: partes.length, tamano_bytes: tamano });
    } catch (e) {
      cleanupMulterTempFiles(req);
      logger.error('[SOPORTES] anexar pdx:', e);
      res.status(500).json({ error: safeError(e) });
    }
  }
);

router.post(
  '/soportes/pdx/archivos/:id/reordenar-paginas',
  requireAuth,
  requireRoleOrPerm(ROLES_SOPORTES, PERMS_PDX_VER_SUBIR),
  async (req, res) => {
    try {
      const order = req.body?.order;
      if (!Array.isArray(order) || !order.length) {
        return res.status(400).json({ error: 'Indique el nuevo orden de páginas' });
      }
      const rows = await db.query(
        `SELECT a.*, c.periodo, c.roles_visibles FROM sop_pdx_archivos a JOIN sop_pdx_carpetas c ON c.id = a.carpeta_id WHERE a.id = ?`,
        [req.params.id]
      );
      if (!rows.length) return res.status(404).json({ error: 'No encontrado' });
      const row = rows[0];
      const deniedOrd = denySinAccesoCarpetaPdx(req, row);
      if (deniedOrd) return res.status(deniedOrd.status).json({ error: deniedOrd.error });
      const vis = await visPdxPeriodo(row.periodo);
      if (vis === 'archivo') return res.status(403).json({ error: 'Carpeta cerrada' });
      const fp = await resolvePdxArchivoPathForApi(row, true);
      if (!fp || !fs.existsSync(fp)) return res.status(404).json({ error: 'Archivo no en disco' });
      const bytes = await readFileBuffer(fp);
      const { PDFDocument } = require('pdf-lib');
      const pageCount = (await PDFDocument.load(bytes, { ignoreEncryption: true })).getPageCount();
      const outBytes = await reorderPdfPagesFromBytes(bytes, order);
      await writePdfBytesAtomic(fp, outBytes);
      const tamanoFinal = outBytes.length;
      await db.execute(
        'UPDATE sop_pdx_archivos SET tamano_bytes = ?, editado_por = ?, editado_en = NOW() WHERE id = ?',
        [tamanoFinal, req.session.usuarioId, req.params.id]
      );
      await logPdxArchivo(req.params.id, 'reordenar_paginas', req.session.usuarioId, `${order.length} pág.`);
      res.json({ ok: true, message: 'Se reordenaron las páginas del PDF', tamano_bytes: tamanoFinal });
    } catch (e) {
      logger.error('[SOPORTES] reordenar paginas pdx:', e);
      res.status(500).json({ error: safeError(e) });
    }
  }
);

router.post(
  '/soportes/pdx/archivos/:id/eliminar-paginas',
  requireAuth,
  requireRoleOrPerm(ROLES_SOPORTES, PERMS_PDX_VER_SUBIR),
  async (req, res) => {
    try {
      const pages = req.body?.pages;
      if (!Array.isArray(pages) || !pages.length) {
        return res.status(400).json({ error: 'Indique las páginas a eliminar (número 1, 2, …)' });
      }
      const rows = await db.query(
        `SELECT a.*, c.periodo, c.roles_visibles FROM sop_pdx_archivos a JOIN sop_pdx_carpetas c ON c.id = a.carpeta_id WHERE a.id = ?`,
        [req.params.id]
      );
      if (!rows.length) return res.status(404).json({ error: 'No encontrado' });
      const row = rows[0];
      const deniedPag = denySinAccesoCarpetaPdx(req, row);
      if (deniedPag) return res.status(deniedPag.status).json({ error: deniedPag.error });
      const vis = await visPdxPeriodo(row.periodo);
      if (vis === 'archivo') return res.status(403).json({ error: 'Carpeta cerrada' });
      const fp = await resolvePdxArchivoPathForApi(row, true);
      if (!fp || !fs.existsSync(fp)) return res.status(404).json({ error: 'Archivo no en disco' });

      const bytes = await readFileBuffer(fp);
      const { PDFDocument } = require('pdf-lib');
      const pageCount = (await PDFDocument.load(bytes, { ignoreEncryption: true })).getPageCount();
      const indexes = sanitizePageIndexes(pages, pageCount);
      const outBytes = await removePdfPagesFromBytes(bytes, indexes);
      await writePdfBytesAtomic(fp, outBytes);
      const tamanoFinal = outBytes.length;

      await db.execute(
        'UPDATE sop_pdx_archivos SET tamano_bytes = ?, editado_por = ?, editado_en = NOW() WHERE id = ?',
        [tamanoFinal, req.session.usuarioId, req.params.id]
      );
      await logPdxArchivo(req.params.id, 'eliminar_paginas', req.session.usuarioId, `-${indexes.length} pág.`);
      res.json({
        ok: true,
        message: `Se eliminaron ${indexes.length} página(s) del PDF`,
        eliminadas: indexes.length,
        tamano_bytes: tamanoFinal
      });
    } catch (e) {
      logger.error('[SOPORTES] eliminar paginas pdx:', e);
      res.status(500).json({ error: safeError(e) });
    }
  }
);

router.get('/soportes/pdx/archivos/:id/historial', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, PERMS_PDX_VER_SUBIR), async (req, res) => {
  try {
    const accRows = await db.query(
      `SELECT c.roles_visibles FROM sop_pdx_archivos a
       JOIN sop_pdx_carpetas c ON c.id = a.carpeta_id WHERE a.id = ?`,
      [req.params.id]
    );
    if (!accRows.length) return res.status(404).json({ error: 'No encontrado' });
    const deniedHist = denySinAccesoCarpetaPdx(req, accRows[0]);
    if (deniedHist) return res.status(deniedHist.status).json({ error: deniedHist.error });
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
        `SELECT a.*, c.periodo, c.color_tema, c.nombre_display, c.roles_visibles FROM sop_pdx_archivos a
         JOIN sop_pdx_carpetas c ON c.id = a.carpeta_id WHERE a.id = ?`,
        [req.params.id]
      );
      if (!rows.length) return res.status(404).json({ error: 'Archivo no encontrado' });
      const prev = rows[0];
      const deniedRep = denySinAccesoCarpetaPdx(req, prev);
      if (deniedRep) return res.status(deniedRep.status).json({ error: deniedRep.error });
      const vis = await visPdxPeriodo(prev.periodo);
      if (vis === 'archivo') return res.status(403).json({ error: 'Carpeta cerrada' });

      const carpetaCtx = { periodo: prev.periodo, color_tema: prev.color_tema, nombre_display: prev.nombre_display };
      if (necesitaListaEstudios(carpetaCtx)) {
        carpetaCtx._estudiosLista = await cargarListaParaCarpetaPdx(db, carpetaCtx);
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
            d.id AS dia_id, d.dia, d.nombre_display, d.estado_facturacion, d.modo AS dia_modo,
            d.anexo_archivo_id, d.parent_id AS dia_parent_id,
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
    `SELECT c.*, c.tipo AS contenedor_tipo, d.dia, d.nombre_display, d.estado_facturacion, d.modo AS dia_modo,
            d.anexo_archivo_id, d.periodo_id, p.periodo, p.etiqueta AS periodo_etiqueta
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
    parent_id: normalizarParentIdDia(row.parent_id),
    es_contenedor: !!row.es_contenedor,
    modo: normalizarModoDia(row.modo),
    anexo_archivo_id: row.anexo_archivo_id || null,
    anexo_carpeta_id: row.anexo_carpeta_id || null,
    anexo_total_registros: Number(row.anexo_total_registros || 0),
    anexo_ruta_export: row.anexo_ruta_export || null,
    anexo_export_existe: !!row.anexo_export_existe,
    orden: row.orden || 0,
    dia: row.dia,
    fecha: row.fecha,
    nombre_display: row.nombre_display || `Día ${row.dia}`,
    estado_facturacion: row.estado_facturacion || 'a_facturar',
    expedientes_count: row.expedientes_count || 0,
    hijos_count: row.hijos_count || 0,
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

function mapPeriodo(row, visCtx) {
  const periodo = row.periodo;
  const calc = calcularVisibilidadPeriodo(periodo);
  const vis = visCtx
    ? resolveVisibilidadArmadoRow(row, visCtx)
    : calc;
  return {
    id: row.id,
    periodo,
    etiqueta: row.etiqueta,
    estado_visibilidad: vis,
    estado_calendario: calc,
    // Calendario ya cerró, pero se forzó de nuevo en Soportes (visible_en_soportes).
    restaurado_en_soportes: calc === 'archivo' && vis !== 'archivo',
    dias_restantes_gracia: diasRestantesGracia(periodo),
    expedientes_count: row.expedientes_count || 0
  };
}

async function findRegistroArchivoArmadoId(periodoRow) {
  if (!periodoRow?.id) return null;
  await ensureRegistroArchivoArmado(periodoRow, null);
  let rows = await db.query(
    'SELECT id FROM sop_modulo_archivo WHERE modulo = ? AND ref_id = ? LIMIT 1',
    ['armado', periodoRow.id]
  );
  if (rows.length) return rows[0].id;
  if (periodoRow.periodo) {
    rows = await db.query(
      'SELECT id FROM sop_modulo_archivo WHERE modulo = ? AND periodo = ? LIMIT 1',
      ['armado', periodoRow.periodo]
    );
    if (rows.length) return rows[0].id;
  }
  return null;
}

router.get('/soportes/armado/periodos', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, 'modulo.armado_soportes'), async (req, res) => {
  try {
    const rows = await db.query(`
      SELECT p.*, COUNT(DISTINCT e.id) AS expedientes_count
      FROM sop_periodos p
      LEFT JOIN sop_dias d ON d.periodo_id = p.id
      LEFT JOIN sop_expedientes e ON e.dia_id = d.id OR e.contenedor_id IN (SELECT id FROM sop_contenedores WHERE dia_id = d.id)
      GROUP BY p.id ORDER BY p.periodo DESC
    `);
    for (const r of rows) {
      await refrescarVisibilidadArmado(r.periodo, req.session?.usuarioId || null);
    }
    await syncRegistrosArchivoFaltantes(req.session?.usuarioId || null);
    const visCtx = await loadVisibleEnSoportesCtx();
    const lista = rows.map((r) => mapPeriodo(r, visCtx)).filter((p) => p.estado_visibilidad !== 'archivo');
    res.json({ periodos: lista });
  } catch (e) {
    res.status(500).json({ error: safeError(e) });
  }
});

/** Meses que ya cerraron y no están forzados visibles en Soportes. */
router.get('/soportes/armado/periodos-archivados', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, 'modulo.armado_soportes'), async (req, res) => {
  try {
    const rows = await db.query(`
      SELECT p.*, COUNT(DISTINCT e.id) AS expedientes_count
      FROM sop_periodos p
      LEFT JOIN sop_dias d ON d.periodo_id = p.id
      LEFT JOIN sop_expedientes e ON e.dia_id = d.id OR e.contenedor_id IN (SELECT id FROM sop_contenedores WHERE dia_id = d.id)
      GROUP BY p.id ORDER BY p.periodo DESC
    `);
    for (const r of rows) {
      await refrescarVisibilidadArmado(r.periodo, req.session?.usuarioId || null);
    }
    await syncRegistrosArchivoFaltantes(req.session?.usuarioId || null);
    const visCtx = await loadVisibleEnSoportesCtx();
    const periodos = rows
      .map((r) => mapPeriodo(r, visCtx))
      .filter((p) => p.estado_visibilidad === 'archivo');
    res.json({ periodos });
  } catch (e) {
    logger.error('[SOPORTES] listar periodos archivados:', e);
    res.status(500).json({ error: sopErrorCliente(e) });
  }
});

/**
 * Devuelve meses archivados a la lista de Soportes (visible_en_soportes=1).
 * Los archivos no se mueven: solo vuelven a verse/editarse aquí.
 */
router.post('/soportes/armado/periodos/restaurar', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, ['modulo.armado_soportes', 'soportes.armado.crear_estructura']), async (req, res) => {
  try {
    const rawIds = req.body?.ids;
    if (!Array.isArray(rawIds) || !rawIds.length) {
      return res.status(400).json({ error: 'Seleccione al menos un mes' });
    }
    const ids = [...new Set(rawIds.map((id) => parseInt(id, 10)).filter((id) => id > 0))];
    if (!ids.length) return res.status(400).json({ error: 'IDs de periodo inválidos' });

    const restaurados = [];
    const omitidos = [];
    const errores = [];

    for (const id of ids) {
      const rows = await db.query('SELECT * FROM sop_periodos WHERE id = ?', [id]);
      if (!rows.length) {
        errores.push({ id, error: 'Periodo no encontrado' });
        continue;
      }
      const periodo = rows[0];
      const calc = calcularVisibilidadPeriodo(periodo.periodo);
      if (calc !== 'archivo') {
        omitidos.push({
          id,
          etiqueta: periodo.etiqueta || periodo.periodo,
          motivo: 'no_archivado',
          detalle: 'Este mes aún está activo o en gracia; ya aparece en Soportes.'
        });
        continue;
      }
      const regId = await findRegistroArchivoArmadoId(periodo);
      if (!regId) {
        errores.push({ id, error: 'No se pudo registrar el mes en archivo' });
        continue;
      }
      await setVisibleEnSoportes(regId, true);
      restaurados.push({
        id: periodo.id,
        periodo: periodo.periodo,
        etiqueta: periodo.etiqueta || periodo.periodo
      });
    }

    if (!restaurados.length && !omitidos.length) {
      return res.status(400).json({ error: 'No se pudo devolver ningún mes', errores });
    }

    res.json({ ok: true, restaurados, omitidos, errores });
    notifySoportesArmado({
      accion: 'periodos_restaurados',
      periodoIds: restaurados.map((p) => p.id)
    });
  } catch (e) {
    logger.error('[SOPORTES] restaurar periodos armado:', e);
    res.status(500).json({ error: sopErrorCliente(e) });
  }
});

/** Quita de la lista de Soportes un mes restaurado (vuelve a Meses archivados). */
router.post('/soportes/armado/periodos/ocultar-archivo', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, ['modulo.armado_soportes', 'soportes.armado.crear_estructura']), async (req, res) => {
  try {
    const rawIds = req.body?.ids;
    if (!Array.isArray(rawIds) || !rawIds.length) {
      return res.status(400).json({ error: 'Seleccione al menos un mes' });
    }
    const ids = [...new Set(rawIds.map((id) => parseInt(id, 10)).filter((id) => id > 0))];
    if (!ids.length) return res.status(400).json({ error: 'IDs de periodo inválidos' });

    const ocultados = [];
    const omitidos = [];
    const errores = [];

    for (const id of ids) {
      const rows = await db.query('SELECT * FROM sop_periodos WHERE id = ?', [id]);
      if (!rows.length) {
        errores.push({ id, error: 'Periodo no encontrado' });
        continue;
      }
      const periodo = rows[0];
      const calc = calcularVisibilidadPeriodo(periodo.periodo);
      if (calc !== 'archivo') {
        omitidos.push({
          id,
          etiqueta: periodo.etiqueta || periodo.periodo,
          motivo: 'periodo_activo',
          detalle: 'Solo se pueden volver a archivar meses cuyo calendario ya cerró.'
        });
        continue;
      }
      const regId = await findRegistroArchivoArmadoId(periodo);
      if (!regId) {
        errores.push({ id, error: 'Registro de archivo no encontrado' });
        continue;
      }
      await setVisibleEnSoportes(regId, false);
      ocultados.push({
        id: periodo.id,
        periodo: periodo.periodo,
        etiqueta: periodo.etiqueta || periodo.periodo
      });
    }

    if (!ocultados.length && !omitidos.length) {
      return res.status(400).json({ error: 'No se pudo ocultar ningún mes', errores });
    }

    res.json({ ok: true, ocultados, omitidos, errores });
    notifySoportesArmado({
      accion: 'periodos_ocultados',
      periodoIds: ocultados.map((p) => p.id)
    });
  } catch (e) {
    logger.error('[SOPORTES] ocultar periodos armado:', e);
    res.status(500).json({ error: sopErrorCliente(e) });
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
    const periodoId = pdxInsertId(r);
    if (!periodoId) return res.status(500).json({ error: 'No se pudo crear el periodo' });
    const rows = await db.query('SELECT * FROM sop_periodos WHERE id = ?', [periodoId]);
    if (!rows.length) return res.status(500).json({ error: 'Periodo creado pero no encontrado' });
    await ensureContenedorasRaizPeriodo(db, periodoId, req.session.usuarioId);
    res.status(201).json({ ok: true, periodo: mapPeriodo({ ...rows[0], expedientes_count: 0 }) });
    notifySoportesArmado({ accion: 'periodo_creado', periodoId, periodo });
  } catch (e) {
    if (String(e.message).includes('Duplicate')) return res.status(409).json({ error: 'El periodo ya existe' });
    logger.error('[SOPORTES] crear periodo armado:', e);
    res.status(500).json({ error: sopErrorCliente(e) });
  }
});

router.post('/soportes/armado/periodos/:id/sync-anexo-modulo', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, 'modulo.armado_soportes'), async (req, res) => {
  try {
    const periodoId = parseInt(req.params.id, 10);
    const visCtx = await loadVisibleEnSoportesCtx();
    if (!await requirePeriodoArmadoAccesible(req, res, periodoId, visCtx)) return;
    const forzarExport = req.body?.forzar_export === true || req.body?.forzar_export === 1;
    const result = await syncAnexoModuloASoportesPeriodo(periodoId, { forzarExport });
    if (!result.ok) return res.status(400).json({ error: result.error || 'No se pudo sincronizar' });
    res.json(result);
  } catch (e) {
    logger.error('[SOPORTES] sync anexo modulo manual:', e);
    res.status(500).json({ error: safeError(e) });
  }
});

router.post('/soportes/armado/periodos/:id/reparent-facturas', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, 'soportes.armado.crear_estructura'), async (req, res) => {
  try {
    const periodoId = parseInt(req.params.id, 10);
    const visCtx = await loadVisibleEnSoportesCtx();
    if (!await requirePeriodoArmadoAccesible(req, res, periodoId, visCtx)) return;
    const result = await reparentCarpetasFacturacionHuerfanas(db, periodoId);
    res.json(result);
  } catch (e) {
    logger.error('[SOPORTES] reparent facturas:', e);
    res.status(500).json({ error: safeError(e) });
  }
});

router.post('/soportes/armado/recuperar-archivos', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, ['modulo.armado_soportes', 'soportes.armado.crear_estructura', 'soportes.armado.subir']), async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.expedienteIds)
      ? req.body.expedienteIds.filter((value) => Number.isFinite(Number(value)) && Number(value) > 0)
      : [];
    const expedienteId = req.body?.expedienteId != null ? Number(req.body.expedienteId) : null;
    const targetIds = ids.length ? ids : (expedienteId ? [expedienteId] : []);

    const result = await runSoportesRecoveryScript({
      cwd: path.resolve(__dirname, '..'),
      expedienteIds: targetIds,
      background: true
    });

    if (!result.ok && !result.background) {
      logger.error('[SOPORTES] recuperación manual fallida', { result, expedienteIds: targetIds });
      return res.status(500).json({ error: 'No se pudo ejecutar la recuperación', detail: result.stderr || result.stdout });
    }

    res.status(202).json({ ok: true, message: 'Recuperación iniciada en segundo plano', result });
  } catch (e) {
    logger.error('[SOPORTES] recuperar archivos manual:', e);
    res.status(500).json({ error: safeError(e) });
  }
});

router.get('/soportes/armado/periodos/:id/dias', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, 'modulo.armado_soportes'), async (req, res) => {
  try {
    const periodoId = parseInt(req.params.id, 10);
    const visCtx = await loadVisibleEnSoportesCtx();
    const periodoRow = await requirePeriodoArmadoAccesible(req, res, periodoId, visCtx);
    if (!periodoRow) return;
    await ensureContenedorasRaizPeriodo(db, periodoId);
    await reparentCarpetasFacturacionHuerfanas(db, periodoId);
    try {
      await syncAnexoModuloASoportesPeriodo(periodoId);
    } catch (syncAnexoErr) {
      logger.warn('[SOPORTES] sync anexo modulo:', syncAnexoErr.message);
    }
    const dias = await db.query(
      `SELECT d.*,
        COUNT(DISTINCT e.id) AS expedientes_count,
        (SELECT COUNT(*) FROM sop_dias ch WHERE ch.parent_id = d.id) AS hijos_count,
        a.carpeta_id AS anexo_carpeta_id,
        a.ruta_export AS anexo_ruta_export,
        (SELECT COUNT(*) FROM anexo_fidu_registros ar WHERE ar.archivo_id = a.id) AS anexo_total_registros
       FROM sop_dias d
       LEFT JOIN sop_contenedores c ON c.dia_id = d.id AND d.es_contenedor = 0
       LEFT JOIN sop_expedientes e ON e.contenedor_id = c.id
       LEFT JOIN anexo_fidu_archivos a ON a.id = d.anexo_archivo_id
       WHERE d.periodo_id = ?
       GROUP BY d.id ORDER BY d.orden ASC, d.nombre_display ASC, d.id ASC`,
      [req.params.id]
    );
    const diasRaw = dias.map((row) => mapDia({
      ...row,
      anexo_export_existe: row.anexo_ruta_export
        ? fs.existsSync(path.join(SOPORTES_ROOT, String(row.anexo_ruta_export)))
        : false
    }));
    diasRaw.sort((a, b) => {
      const ord = (a.orden || 0) - (b.orden || 0);
      if (ord !== 0) return ord;
      return compararTextoNatural(a.nombre_display, b.nombre_display);
    });
    res.json({ dias: diasRaw });
  } catch (e) {
    res.status(500).json({ error: safeError(e) });
  }
});

router.post('/soportes/armado/periodos/:id/dias', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, 'soportes.armado.crear_estructura'), async (req, res) => {
  try {
    const periodoId = parseInt(req.params.id, 10);
    const visCtx = await loadVisibleEnSoportesCtx();
    if (!await requirePeriodoArmadoAccesible(req, res, periodoId, visCtx)) return;
    if (!periodoId) return res.status(400).json({ error: 'Periodo inválido' });
    const nombre_display = String(req.body.nombre_display || '').trim();
    const parent_id = normalizarParentIdDia(req.body?.parent_id);
    const es_contenedor = req.body?.es_contenedor === true
      || req.body?.es_contenedor === 1
      || req.body?.es_contenedor === '1';
    if (es_contenedor && !parent_id) {
      return res.status(400).json({ error: 'Las carpetas contenedoras del mes (Anexo FIDU, Facturas FIDU, U C Q N) se crean automáticamente.' });
    }
    const estado_facturacion = req.body.estado_facturacion === 'facturados' ? 'facturados' : 'a_facturar';
    if (!nombre_display) return res.status(400).json({ error: 'Indique el nombre de la carpeta del día (ej: MAYO 1, MAYO 2-3)' });
    const modo = await fetchModoParentContenedora(db, parent_id);
    const periodo = await db.query('SELECT periodo FROM sop_periodos WHERE id = ?', [periodoId]);
    if (!periodo.length) return res.status(404).json({ error: 'Periodo no encontrado' });
    if (parent_id > 0) {
      const parentRows = await db.query('SELECT * FROM sop_dias WHERE id = ?', [parent_id]);
      if (!parentRows.length) return res.status(400).json({ error: 'Carpeta padre no encontrada' });
      if (parentRows[0].periodo_id !== periodoId) {
        return res.status(400).json({ error: 'La carpeta padre debe estar en el mismo mes' });
      }
      if (!parentRows[0].es_contenedor) {
        return res.status(400).json({ error: 'La carpeta padre no es contenedora' });
      }
    }
    const dupNom = await db.query(
      'SELECT id FROM sop_dias WHERE periodo_id = ? AND parent_id = ? AND nombre_display = ? LIMIT 1',
      [periodoId, parent_id, nombre_display]
    );
    if (dupNom.length) {
      return res.status(409).json({ error: 'Ya existe una carpeta con ese nombre en el mismo nivel' });
    }
    const fechaDate = req.body.fecha || `${periodo[0].periodo}-01`;
    const diaNum = await nextSopDiaNumero(db, periodoId);
    const r = await db.execute(
      `INSERT INTO sop_dias (periodo_id, parent_id, dia, fecha, nombre_display, es_contenedor, modo, estado_facturacion)
       VALUES (?,?,?,?,?,?,?,?)`,
      [periodoId, parent_id, diaNum, fechaDate, nombre_display, es_contenedor ? 1 : 0, modo, estado_facturacion]
    );
    const diaId = pdxInsertId(r);
    if (!diaId) return res.status(500).json({ error: 'No se pudo crear la carpeta del día' });
    let contenedores = [];
    if (!es_contenedor) {
      try {
        await ensureContenedoresForDia(db, diaId);
        if (esModoAnexo(modo)) {
          const diaTmp = { id: diaId, periodo_id: periodoId, parent_id, nombre_display };
          const anexoRes = await crearAnexoArchivoParaDia(db, diaTmp, req.session.usuarioId);
          if (anexoRes.error) throw new Error(anexoRes.error);
        }
        if (esModoUcqn(modo)) {
          await asegurarExpedienteUcqn(db, diaId, nombre_display, req.session.usuarioId);
        }
      } catch (contErr) {
        await db.execute('DELETE FROM sop_dias WHERE id = ?', [diaId]).catch(() => {});
        logger.error('[SOPORTES] crear dia contenedores:', contErr);
        return res.status(500).json({ error: sopErrorCliente(contErr) });
      }
      contenedores = await db.query('SELECT * FROM sop_contenedores WHERE dia_id = ? ORDER BY tipo', [diaId]);
    }
    const row = await db.query('SELECT * FROM sop_dias WHERE id = ?', [diaId]);
    if (!row.length) return res.status(500).json({ error: 'Carpeta del día creada pero no encontrada' });
    res.status(201).json({
      ok: true,
      dia: mapDia({ ...row[0], expedientes_count: 0, hijos_count: 0 }),
      contenedores: contenedores.map(mapContenedor)
    });
    notifySoportesArmado({ accion: 'dia_creado', periodoId, diaId });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY' || /uk_sop_dia|Duplicate entry/i.test(String(e.message || ''))) {
      return res.status(409).json({ error: 'Ya existe una carpeta con ese nombre en el mes (o conflicto de índice en BD)' });
    }
    logger.error('[SOPORTES] crear dia armado:', e);
    res.status(500).json({ error: sopErrorCliente(e) });
  }
});

router.patch('/soportes/armado/dias/:id', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, 'soportes.armado.crear_estructura'), async (req, res) => {
  try {
    const diaId = parseInt(req.params.id, 10);
    if (req.body?.parent_id !== undefined) {
      const moveCheck = await validarMoverDiaArmado(db, diaId, req.body.parent_id);
      if (!moveCheck.ok) return res.status(moveCheck.status).json({ error: moveCheck.error });
      if (moveCheck.oldParentId !== moveCheck.nuevoParentId) {
        const periodoRows = await db.query('SELECT periodo FROM sop_periodos WHERE id = ?', [moveCheck.dia.periodo_id]);
        const diaConPeriodo = {
          ...moveCheck.dia,
          periodo: periodoRows[0]?.periodo || moveCheck.dia.periodo
        };
        // Disco primero (con padre viejo), luego BD.
        await moverDiaEnDisco(diaConPeriodo, moveCheck.oldParentId, moveCheck.nuevoParentId);
        const modoNuevo = moveCheck.modoDestino || moveCheck.dia.modo;
        await db.execute(
          'UPDATE sop_dias SET parent_id = ?, modo = ? WHERE id = ?',
          [moveCheck.nuevoParentId, modoNuevo, diaId]
        );
      }
    }
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
    notifySoportesArmado({ accion: 'dia_actualizado', diaId, periodoId: result.dia?.periodo_id });
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

router.post('/soportes/armado/dias/:id/sync-anexo-export', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, 'modulo.armado_soportes'), async (req, res) => {
  try {
    const diaId = parseInt(req.params.id, 10);
    const diaRows = await db.query('SELECT * FROM sop_dias WHERE id = ?', [diaId]);
    if (!diaRows.length) return res.status(404).json({ error: 'Carpeta no encontrada' });
    const dia = diaRows[0];
    if (dia.es_contenedor) {
      return res.status(400).json({ error: 'Seleccione un anexo dentro de la contenedora Anexo FIDU, no la contenedora misma' });
    }
    if (!esModoAnexo(dia.modo)) return res.status(400).json({ error: 'No es una carpeta de Anexo FIDU' });

    let archivoId = dia.anexo_archivo_id;
    if (!archivoId) {
      const arch = await db.query('SELECT id FROM anexo_fidu_archivos WHERE sop_dia_id = ? LIMIT 1', [diaId]);
      if (arch.length) {
        archivoId = arch[0].id;
        await db.execute('UPDATE sop_dias SET anexo_archivo_id = ? WHERE id = ?', [archivoId, diaId]);
      }
    }
    if (!archivoId) {
      return res.status(400).json({
        error: 'Sin anexo vinculado. Use «Sincronizar desde Anexo» dentro de la contenedora Anexo FIDU del mes.'
      });
    }

    const sync = await guardarExportAnexoEnSoportes(archivoId, { diaId });
    if (!sync.ok) return res.status(400).json({ error: sync.error || 'No se pudo exportar' });
    res.json({ ok: true, ...sync });
  } catch (e) {
    logger.error('[SOPORTES] sync anexo export:', e);
    res.status(500).json({ error: safeError(e) });
  }
});

router.get('/soportes/armado/dias/:id/descargar-anexo', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, 'modulo.armado_soportes'), async (req, res) => {
  try {
    const diaRows = await db.query('SELECT * FROM sop_dias WHERE id = ?', [req.params.id]);
    if (!diaRows.length) return res.status(404).json({ error: 'Carpeta no encontrada' });
    const archivoId = diaRows[0].anexo_archivo_id;
    if (!archivoId) return res.status(404).json({ error: 'Sin anexo vinculado' });
    let arch = await db.query('SELECT * FROM anexo_fidu_archivos WHERE id = ?', [archivoId]);
    if (!arch.length) return res.status(404).json({ error: 'Anexo no encontrado' });
    if (!arch[0].ruta_export) {
      const sync = await guardarExportAnexoEnSoportes(archivoId);
      if (!sync.ok) return res.status(404).json({ error: 'Exporte el anexo desde el módulo Anexo primero' });
      arch = await db.query('SELECT * FROM anexo_fidu_archivos WHERE id = ?', [archivoId]);
    }
    const fp = resolveArchivoAbsoluto({ ruta_relativa: arch[0].ruta_export });
    if (!fp || !fs.existsSync(fp)) return res.status(404).json({ error: 'Archivo Excel no encontrado en disco' });
    const name = path.basename(fp);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`);
    fs.createReadStream(fp).pipe(res);
  } catch (e) {
    logger.error('[SOPORTES] descargar anexo:', e);
    if (!res.headersSent) res.status(500).json({ error: safeError(e) });
  }
});

router.get('/soportes/armado/expedientes/:id/pdfs/:archivoId/ver', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, 'modulo.armado_soportes'), async (req, res) => {
  try {
    const { resolverArchivoUcqnPdf } = require('../utils/soportes-ucqn-upload');
    const { decodeUploadFilename } = require('../utils/soportes-archivo-detect');
    const resolved = await resolverArchivoUcqnPdf(req.params.id, req.params.archivoId);
    if (!resolved.ok) return res.status(resolved.status || 404).json({ error: resolved.error });
    const name = decodeUploadFilename(resolved.row.nombre_original || resolved.row.nombre_archivo || 'documento.pdf');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', contentDispositionUtf8('inline', name));
    fs.createReadStream(resolved.fp).pipe(res);
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: safeError(e) });
  }
});

router.get('/soportes/armado/expedientes/:id/pdfs/:archivoId/descargar', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, 'modulo.armado_soportes'), async (req, res) => {
  try {
    const { resolverArchivoUcqnPdf } = require('../utils/soportes-ucqn-upload');
    const { decodeUploadFilename } = require('../utils/soportes-archivo-detect');
    const resolved = await resolverArchivoUcqnPdf(req.params.id, req.params.archivoId);
    if (!resolved.ok) return res.status(resolved.status || 404).json({ error: resolved.error });
    const name = decodeUploadFilename(resolved.row.nombre_original || resolved.row.nombre_archivo || 'documento.pdf');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', contentDispositionUtf8('attachment', name));
    fs.createReadStream(resolved.fp).pipe(res);
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: safeError(e) });
  }
});

router.post(
  '/soportes/armado/expedientes/:id/pdfs/:archivoId/resaltar',
  requireAuth,
  requireRoleOrPerm(ROLES_SOPORTES, PERMS_ARMADO_VER_SUBIR),
  async (req, res) => {
    try {
      const highlights = req.body?.highlights;
      if (!Array.isArray(highlights) || highlights.length === 0) {
        return res.status(400).json({ error: 'Indique al menos un resaltado' });
      }
      const { resolverArchivoUcqnPdf } = require('../utils/soportes-ucqn-upload');
      const resolved = await resolverArchivoUcqnPdf(req.params.id, req.params.archivoId);
      if (!resolved.ok) return res.status(resolved.status || 404).json({ error: resolved.error });
      const bytes = await readFileBuffer(resolved.fp);
      const { PDFDocument } = require('pdf-lib');
      const probe = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const sanitized = sanitizeHighlightsList(highlights, probe.getPageCount());
      if (!sanitized.length) return res.status(400).json({ error: 'Resaltados no válidos' });
      const tamano = await persistHighlightsOnPdfFile(resolved.fp, sanitized);
      await db.execute(
        'UPDATE sop_exp_archivos SET tamano_bytes = ?, subido_por = ? WHERE id = ?',
        [tamano, req.session.usuarioId, resolved.row.id]
      );
      notifySoportesArmado({ accion: 'pdf_editado', expedienteId: parseInt(req.params.id, 10) });
      const detail = await buildExpedienteDetail(req.params.id);
      res.json({ ok: true, aplicados: sanitized.length, tamano_bytes: tamano, expediente: detail });
    } catch (e) {
      logger.error('[SOPORTES] resaltar ucqn:', e);
      res.status(500).json({ error: safeError(e) });
    }
  }
);

router.post(
  '/soportes/armado/expedientes/:id/pdfs/:archivoId/anexar-pdf',
  requireAuth,
  requireRoleOrPerm(ROLES_SOPORTES, PERMS_ARMADO_VER_SUBIR),
  (req, res, next) => {
    uploadArmadoSoportes.array('partes', 12)(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message || 'Error al subir PDF' });
      next();
    });
  },
  validateMagicBytes,
  async (req, res) => {
    try {
      const partes = (req.files || []).map((f) => f.path).filter(Boolean);
      if (!partes.length) {
        cleanupMulterTempFiles(req);
        return res.status(400).json({ error: 'Seleccione al menos un PDF para añadir' });
      }
      const { resolverArchivoUcqnPdf } = require('../utils/soportes-ucqn-upload');
      const resolved = await resolverArchivoUcqnPdf(req.params.id, req.params.archivoId);
      if (!resolved.ok) {
        cleanupMulterTempFiles(req);
        return res.status(resolved.status || 404).json({ error: resolved.error });
      }
      const tamano = await appendPdfFilesToExisting(resolved.fp, partes);
      cleanupMulterTempFiles(req);
      await db.execute(
        'UPDATE sop_exp_archivos SET tamano_bytes = ?, subido_por = ? WHERE id = ?',
        [tamano, req.session.usuarioId, resolved.row.id]
      );
      notifySoportesArmado({ accion: 'pdf_anexado', expedienteId: parseInt(req.params.id, 10) });
      const detail = await buildExpedienteDetail(req.params.id);
      res.json({
        ok: true,
        message: `Se añadió ${partes.length} PDF al final`,
        anexados: partes.length,
        tamano_bytes: tamano,
        expediente: detail
      });
    } catch (e) {
      cleanupMulterTempFiles(req);
      logger.error('[SOPORTES] anexar ucqn:', e);
      res.status(500).json({ error: safeError(e) });
    }
  }
);

router.post(
  '/soportes/armado/expedientes/:id/pdfs/:archivoId/reordenar-paginas',
  requireAuth,
  requireRoleOrPerm(ROLES_SOPORTES, PERMS_ARMADO_VER_SUBIR),
  async (req, res) => {
    try {
      const order = req.body?.order;
      if (!Array.isArray(order) || !order.length) {
        return res.status(400).json({ error: 'Indique el nuevo orden de páginas' });
      }
      const { resolverArchivoUcqnPdf } = require('../utils/soportes-ucqn-upload');
      const resolved = await resolverArchivoUcqnPdf(req.params.id, req.params.archivoId);
      if (!resolved.ok) return res.status(resolved.status || 404).json({ error: resolved.error });
      const bytes = await readFileBuffer(resolved.fp);
      const outBytes = await reorderPdfPagesFromBytes(bytes, order);
      await writePdfBytesAtomic(resolved.fp, outBytes);
      await db.execute(
        'UPDATE sop_exp_archivos SET tamano_bytes = ?, subido_por = ? WHERE id = ?',
        [outBytes.length, req.session.usuarioId, resolved.row.id]
      );
      notifySoportesArmado({ accion: 'pdf_reordenado', expedienteId: parseInt(req.params.id, 10) });
      const detail = await buildExpedienteDetail(req.params.id);
      res.json({ ok: true, message: 'Se reordenaron las páginas del PDF', tamano_bytes: outBytes.length, expediente: detail });
    } catch (e) {
      logger.error('[SOPORTES] reordenar ucqn:', e);
      res.status(500).json({ error: safeError(e) });
    }
  }
);

router.post(
  '/soportes/armado/expedientes/:id/pdfs/:archivoId/eliminar-paginas',
  requireAuth,
  requireRoleOrPerm(ROLES_SOPORTES, PERMS_ARMADO_VER_SUBIR),
  async (req, res) => {
    try {
      const pages = req.body?.pages;
      if (!Array.isArray(pages) || !pages.length) {
        return res.status(400).json({ error: 'Indique las páginas a eliminar (número 1, 2, …)' });
      }
      const { resolverArchivoUcqnPdf } = require('../utils/soportes-ucqn-upload');
      const resolved = await resolverArchivoUcqnPdf(req.params.id, req.params.archivoId);
      if (!resolved.ok) return res.status(resolved.status || 404).json({ error: resolved.error });
      const bytes = await readFileBuffer(resolved.fp);
      const { PDFDocument } = require('pdf-lib');
      const pageCount = (await PDFDocument.load(bytes, { ignoreEncryption: true })).getPageCount();
      const indexes = sanitizePageIndexes(pages, pageCount);
      const outBytes = await removePdfPagesFromBytes(bytes, indexes);
      await writePdfBytesAtomic(resolved.fp, outBytes);
      await db.execute(
        'UPDATE sop_exp_archivos SET tamano_bytes = ?, subido_por = ? WHERE id = ?',
        [outBytes.length, req.session.usuarioId, resolved.row.id]
      );
      notifySoportesArmado({ accion: 'pdf_paginas', expedienteId: parseInt(req.params.id, 10) });
      const detail = await buildExpedienteDetail(req.params.id);
      res.json({
        ok: true,
        message: `Se eliminaron ${indexes.length} página(s) del PDF`,
        eliminadas: indexes.length,
        tamano_bytes: outBytes.length,
        expediente: detail
      });
    } catch (e) {
      logger.error('[SOPORTES] eliminar paginas ucqn:', e);
      res.status(500).json({ error: safeError(e) });
    }
  }
);

router.delete('/soportes/armado/expedientes/:id/pdfs/:archivoId', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, 'soportes.armado.crear_estructura'), async (req, res) => {
  try {
    const rows = await db.query(
      `SELECT a.* FROM sop_exp_archivos a JOIN sop_expedientes e ON e.id = a.expediente_id
       JOIN sop_dias d ON d.id = e.dia_id WHERE a.id = ? AND a.expediente_id = ? AND a.tipo = 'PDF' AND d.modo = 'ucqn'`,
      [req.params.archivoId, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'PDF no encontrado' });
    const fp = resolveArchivoAbsoluto(rows[0]);
    if (fp && fs.existsSync(fp)) {
      try { fs.unlinkSync(fp); } catch (_) { /* ignore */ }
    }
    await db.execute('DELETE FROM sop_exp_archivos WHERE id = ?', [rows[0].id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: safeError(e) });
  }
});

router.post('/soportes/armado/dias/:id/sync-rips-carpetas', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, 'soportes.armado.crear_estructura'), async (req, res) => {
  try {
    const diaRows = await db.query('SELECT id FROM sop_dias WHERE id = ?', [req.params.id]);
    if (!diaRows.length) return res.status(404).json({ error: 'Carpeta de día no encontrada' });
    const result = await syncRipsCarpetasDia(db, req.params.id, req.session?.usuarioId);
    res.json({ ok: true, dia_id: Number(req.params.id), count: Array.isArray(result) ? result.length : 0, items: result || [] });
  } catch (e) {
    logger.warn('[SOPORTES] sync RIPS manual:', e.message);
    res.status(500).json({ error: safeError(e) });
  }
});

router.post('/soportes/armado/contenedores/:id/sync-rips-carpetas', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, 'soportes.armado.crear_estructura'), async (req, res) => {
  try {
    const contRows = await db.query('SELECT id, dia_id FROM sop_contenedores WHERE id = ?', [req.params.id]);
    if (!contRows.length) return res.status(404).json({ error: 'Carpeta SOPORTES no encontrada' });
    const diaId = contRows[0].dia_id;
    const result = await syncRipsCarpetasContenedor(db, req.params.id, req.session?.usuarioId);
    const ripsRows = await db.query('SELECT id FROM sop_contenedores WHERE dia_id = ? AND tipo = ?', [diaId, 'rips']);
    res.json({
      ok: true,
      contenedor_id: Number(req.params.id),
      rips_contenedor_id: ripsRows[0]?.id || null,
      count: Array.isArray(result) ? result.length : 0,
      items: result || []
    });
  } catch (e) {
    logger.warn('[SOPORTES] sync RIPS manual contenedor:', e.message);
    res.status(500).json({ error: safeError(e) });
  }
});

router.get('/soportes/armado/dias/:id/contenedores', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, 'modulo.armado_soportes'), async (req, res) => {
  try {
    const dia = await db.query('SELECT * FROM sop_dias WHERE id = ?', [req.params.id]);
    if (!dia.length) return res.status(404).json({ error: 'Carpeta de día no encontrada' });
    const modo = normalizarModoDia(dia[0].modo);
    let anexo = null;
    if (esModoAnexo(modo)) {
      if (dia[0].anexo_archivo_id) {
        const arch = await db.query(
          `SELECT a.*, (SELECT COUNT(*) FROM anexo_fidu_registros r WHERE r.archivo_id = a.id) AS total_registros
           FROM anexo_fidu_archivos a WHERE a.id = ?`,
          [dia[0].anexo_archivo_id]
        );
        if (arch.length) {
          anexo = {
            archivo_id: arch[0].id,
            nombre: arch[0].nombre,
            ruta_export: arch[0].ruta_export || null,
            total_registros: arch[0].total_registros || 0
          };
        }
      }
      return res.json({
        dia: mapDia({ ...dia[0], expedientes_count: 0 }),
        modo,
        anexo,
        contenedores: []
      });
    }
    await ensureContenedoresForDia(db, req.params.id);
    if (esModoFacturacion(modo)) {
      try {
        await syncRipsCarpetasDia(db, req.params.id, req.session?.usuarioId);
      } catch (syncErr) {
        logger.warn('[SOPORTES] sync RIPS carpetas:', syncErr.message);
      }
    }
    const contenedores = await db.query(
      `SELECT c.*, COUNT(e.id) AS expedientes_count
       FROM sop_contenedores c
       LEFT JOIN sop_expedientes e ON e.contenedor_id = c.id
       WHERE c.dia_id = ?
       GROUP BY c.id ORDER BY FIELD(c.tipo, 'rips', 'soportes')`,
      [req.params.id]
    );
    let ucqn_expediente_id = null;
    if (esModoUcqn(modo)) {
      const exp = await db.query(
        `SELECT e.id FROM sop_expedientes e
         JOIN sop_contenedores c ON c.id = e.contenedor_id
         WHERE c.dia_id = ? LIMIT 1`,
        [req.params.id]
      );
      ucqn_expediente_id = exp[0]?.id || null;
      if (!ucqn_expediente_id) {
        ucqn_expediente_id = await asegurarExpedienteUcqn(db, req.params.id, dia[0].nombre_display, req.session?.usuarioId);
      }
    }
    res.json({
      dia: mapDia({ ...dia[0], expedientes_count: contenedores.reduce((s, c) => s + (c.expedientes_count || 0), 0) }),
      modo,
      ucqn_expediente_id,
      contenedores: contenedores.map(mapContenedor)
    });
  } catch (e) {
    res.status(500).json({ error: safeError(e) });
  }
});

async function buildExpedienteDetail(expId) {
  const ctx = await resolveExpedienteContext(expId);
  if (!ctx) return null;
  const e = ctx;
  if (esModoUcqn(e.dia_modo)) {
    return buildUcqnExpedienteDetail(expId, e);
  }
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
  let vinculos = [];
  try {
    vinculos = await db.query(
      `SELECT v.*, a.paciente_nombre, a.nombre_archivo_original, a.fecha_estudio
       FROM sop_exp_vinculos v
       JOIN sop_pdx_archivos a ON a.id = v.pdx_archivo_id
       WHERE v.expediente_id = ?
       ORDER BY v.creado_en DESC`,
      [expId]
    );
  } catch (_) { /* tabla pendiente */ }
  const hasPdx = !!slots.PDX?.completo;
  const hasHev = !!slots.HEV?.completo;
  const tipoPendiente = !hasPdx && !hasHev;
  const slotState = {
    OPF: slots.OPF || { completo: false },
    CRC: slots.CRC || { completo: false },
    FEV: slots.FEV
      ? { ...slots.FEV, completo: true }
      : { completo: !!e.fev_externa_verificada, externa: !slots.FEV, habilitado: true },
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
    tiene_factura: expedienteTieneFactura(e),
    fev_nombre_ejemplo: fevFilenameHint(
      e.numero_factura != null && Number(e.numero_factura) > 0 ? e.numero_factura : '14726'
    ),
    ejemplos_nombre: {
      OPF: buildSoportesDiskName('OPF', e, '.pdf'),
      CRC: buildSoportesDiskName('CRC', e, '.pdf'),
      PDX: buildSoportesDiskName('PDX', e, '.pdf'),
      HEV: buildSoportesDiskName('HEV', e, '.pdf')
    },
    requisitos: req,
    slots: slotState,
    vinculos,
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
      `SELECT id, codigo, numero_factura, paciente_nombre, listo_radicacion, tipo_servicio, fev_externa_verificada
       FROM sop_expedientes WHERE contenedor_id = ?`,
      [req.params.id]
    );
    const expedientes = ordenarExpedientesFeLista(await enrichExpedientesLista(db, rows, ctx.tipo));
    res.json({ contenedor: mapContenedor({ ...ctx, expedientes_count: rows.length }), expedientes });
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

  const diaModo = ctx.dia_modo || await fetchModoParentContenedora(db, ctx.dia_id);
  if (esModoUcqn(diaModo)) {
    return { error: 'En UCQN cree una carpeta por persona desde el explorador del mes', status: 400 };
  }
  await ensureContenedoresForDia(db, ctx.dia_id);
  const ts = 'electro';
  const r = await db.execute(
    `INSERT INTO sop_expedientes (dia_id, contenedor_id, codigo, numero_factura, paciente_nombre, paciente_documento, tipo_servicio, creado_por)
     VALUES (?,?,?,?,?,?,?,?)`,
    [ctx.dia_id, contenedorId, codigo, numero, pacienteNombre, null, ts, usuarioId]
  );
  const expId = pdxInsertId(r);
  if (!expId) return { error: 'No se pudo crear la carpeta FE', status: 500 };

  // Carpeta física INMUTABLE: código vigente + ID de BD (nunca cambia). Se crea
  // aquí (ya con el ID asignado) en vez de con el código "en crudo", para que
  // futuros cambios de código/factura NUNCA requieran renombrar disco.
  const carpetaFisica = calcularCarpetaFisica(codigo, expId);
  await db.execute('UPDATE sop_expedientes SET carpeta_fisica = ? WHERE id = ?', [carpetaFisica, expId]);
  getArmadoFeDirFromContext(ctx, carpetaFisica);

  try {
    if (esModoFacturacion(diaModo)) {
      await ensureFeParEnContenedorHermano(db, ctx.dia_id, contenedorId, codigo, numero, ts, usuarioId, pacienteNombre);
      await syncRipsCarpetasDia(db, ctx.dia_id, usuarioId);
    }
  } catch (e) {
    logger.warn('[SOPORTES] carpeta par RIPS/SOPORTES:', e.message);
  }
  const detail = await buildExpedienteDetail(expId);
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
    notifySoportesArmado({ accion: 'expediente_creado', contenedorId: parseInt(req.params.id, 10) });
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
    notifySoportesArmado({ accion: 'expedientes_lote', contenedorId: parseInt(req.params.id, 10) });
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
    notifySoportesArmado({ accion: 'expediente_creado', contenedorId: parseInt(req.params.id, 10) });
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
    notifySoportesArmado({ accion: 'expediente_creado', diaId: parseInt(req.params.id, 10) });
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
    notifySoportesArmado({ accion: 'expediente_creado', diaId: parseInt(req.params.id, 10) });
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
    let expediente = null;
    try {
      expediente = await buildExpedienteDetail(req.params.id);
    } catch (detailErr) {
      logger.error('[SOPORTES] buildExpedienteDetail tras PATCH expediente:', detailErr);
    }
    res.json({ ok: true, expediente, renombrado: result.renombrado || null });
    notifySoportesArmado({ accion: 'expediente_actualizado', expedienteId: parseInt(req.params.id, 10) });
  } catch (e) {
    logger.error('[SOPORTES] PATCH expediente:', e);
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

async function handleImportarDesdeDeposito(req, res) {
  try {
    const pdxId = parseInt(req.body.pdx_archivo_id, 10);
    if (!pdxId) return res.status(400).json({ error: 'Seleccione un archivo de los cargados en reportes' });
    const exp = await resolveExpedienteContext(req.params.id);
    if (!exp) return res.status(404).json({ error: 'Expediente no encontrado' });

    const pdx = await db.query(
      `SELECT a.*, c.periodo, c.nombre_display AS carpeta_nombre, c.color_tema, c.roles_visibles
       FROM sop_pdx_archivos a JOIN sop_pdx_carpetas c ON c.id = a.carpeta_id WHERE a.id = ?`,
      [pdxId]
    );
    if (!pdx.length) return res.status(404).json({ error: 'Archivo no encontrado en reportes' });
    const deniedImp = denySinAccesoCarpetaPdx(req, pdx[0]);
    if (deniedImp) return res.status(deniedImp.status).json({ error: deniedImp.error });

    const { importarArchivoDesdeDeposito, resolverDestinoImportacion } = require('../utils/soportes-deposito-import');
    const { carpetaCoincideSlotDeposito } = require('../utils/soportes-deposito-filtro');
    const destPreview = resolverDestinoImportacion(pdx[0]);
    const slotDestino = String(req.body.slot_destino || '').toUpperCase();
    const esUcqn = esModoUcqn(exp.dia_modo);
    if (!esUcqn && slotDestino && !carpetaCoincideSlotDeposito(slotDestino, pdx[0])) {
      return res.status(400).json({
        error: `El archivo no pertenece a una carpeta válida para ${slotDestino}. Revise los archivos cargados.`
      });
    }
    const result = await importarArchivoDesdeDeposito(exp, pdx[0], req.session.usuarioId, {
      slotForzado: slotDestino || undefined
    });

    const warnings = [];
    if (pdx[0].periodo !== exp.periodo) {
      warnings.push(`Archivo del mes ${pdx[0].periodo} → expediente en periodo ${exp.periodo}`);
    }
    if (result.aviso) warnings.push(result.aviso);

    const detail = await buildExpedienteDetail(req.params.id);
    const msg = result.modo === 'vinculo'
      ? `Vinculado (${destPreview.etiqueta})`
      : result.modo === 'pdf'
        ? `Copiado a UCQN (${result.nombre_archivo || 'PDF'})`
        : `Importado en ${result.slot || destPreview.slot}`;
    res.json({ ok: true, message: msg, ...result, expediente: detail, warnings });
    notifySoportesArmado({ accion: 'importar_pdx', expedienteId: parseInt(req.params.id, 10) });
  } catch (e) {
    logger.error('[SOPORTES] importar deposito:', e);
    const msg = e.message || safeError(e);
      const status = /ya existe|no puede|vinculado|SOPORTES|disco|HEV|OPF|consentimiento/i.test(msg) ? 400 : 500;
    res.status(status).json({ error: msg });
  }
}

router.post('/soportes/armado/expedientes/:id/importar-pdx', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, 'soportes.armado.importar_pdx'), handleImportarDesdeDeposito);
router.post('/soportes/armado/expedientes/:id/importar-deposito', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, 'soportes.armado.importar_pdx'), handleImportarDesdeDeposito);

router.post('/soportes/armado/periodos/:id/ucqn/importar-deposito', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, 'soportes.armado.importar_pdx'), async (req, res) => {
  try {
    const periodoId = parseInt(req.params.id, 10);
    const visCtx = await loadVisibleEnSoportesCtx();
    if (!await requirePeriodoArmadoAccesible(req, res, periodoId, visCtx)) return;
    const parentId = normalizarParentIdDia(req.body?.parent_id);
    if (!parentId) return res.status(400).json({ error: 'Indique la carpeta UCQN destino' });
    const parentRows = await db.query('SELECT * FROM sop_dias WHERE id = ?', [parentId]);
    if (!parentRows.length) return res.status(400).json({ error: 'Carpeta destino no encontrada' });
    if (parentRows[0].periodo_id !== periodoId) {
      return res.status(400).json({ error: 'La carpeta destino debe estar en el mismo mes' });
    }
    if (!parentRows[0].es_contenedor) {
      return res.status(400).json({ error: 'El destino debe ser una carpeta contenedora de UCQN' });
    }
    const modoParent = await fetchModoParentContenedora(db, parentId);
    if (!esModoUcqn(modoParent)) {
      return res.status(400).json({ error: 'Solo puede importar a carpetas dentro de U C Q N' });
    }
    const idsRaw = Array.isArray(req.body?.pdx_archivo_ids) ? req.body.pdx_archivo_ids : [];
    const pdxIds = [...new Set(idsRaw.map((n) => parseInt(n, 10)).filter((n) => Number.isFinite(n) && n > 0))].slice(0, 40);
    if (!pdxIds.length) return res.status(400).json({ error: 'Seleccione uno o más archivos de Cargar reportes' });

    const placeholders = pdxIds.map(() => '?').join(',');
    const pdxRows = await db.query(
      `SELECT a.*, c.periodo, c.nombre_display AS carpeta_nombre, c.color_tema, c.roles_visibles
       FROM sop_pdx_archivos a JOIN sop_pdx_carpetas c ON c.id = a.carpeta_id
       WHERE a.id IN (${placeholders})`,
      pdxIds
    );
    const byId = new Map(pdxRows.map((r) => [r.id, r]));
    const periodoRows = await db.query('SELECT periodo FROM sop_periodos WHERE id = ?', [periodoId]);
    const fechaDate = `${periodoRows[0]?.periodo || '2026-01'}-01`;
    const { importarArchivoUcqnDesdeDeposito } = require('../utils/soportes-deposito-import');
    const importados = [];
    const errores = [];
    let carpetasCreadas = 0;
    for (const pdxId of pdxIds) {
      const pdxRow = byId.get(pdxId);
      if (!pdxRow) {
        errores.push({ pdx_archivo_id: pdxId, error: 'Archivo no encontrado en reportes' });
        continue;
      }
      const denied = denySinAccesoCarpetaPdx(req, pdxRow);
      if (denied) {
        errores.push({ pdx_archivo_id: pdxId, error: denied.error });
        continue;
      }
      try {
        const persona = await asegurarPersonaUcqnBajoParent(db, {
          periodoId,
          parentId,
          nombreDisplay: nombreCarpetaPersonaDesdePdx(pdxRow),
          fechaDate,
          usuarioId: req.session.usuarioId
        });
        if (persona.creada) carpetasCreadas += 1;
        const result = await importarArchivoUcqnDesdeDeposito(
          { id: persona.expedienteId, dia_id: persona.diaId, dia_modo: 'ucqn' },
          pdxRow,
          req.session.usuarioId
        );
        importados.push({
          pdx_archivo_id: pdxId,
          dia_id: persona.diaId,
          expediente_id: persona.expedienteId,
          persona: persona.nombre,
          carpeta_creada: persona.creada,
          nombre_archivo: result.nombre_archivo
        });
      } catch (impErr) {
        errores.push({ pdx_archivo_id: pdxId, error: impErr.message || 'No se pudo importar' });
      }
    }
    res.json({
      ok: errores.length < pdxIds.length,
      message: `${importados.length} archivo(s) copiado(s) a UCQN${carpetasCreadas ? `, ${carpetasCreadas} carpeta(s) nueva(s)` : ''}`,
      importados,
      errores,
      carpetas_creadas: carpetasCreadas
    });
    notifySoportesArmado({ accion: 'importar_pdx_ucqn', periodoId, parentId });
  } catch (e) {
    logger.error('[SOPORTES] importar deposito UCQN lote:', e);
    res.status(500).json({ error: safeError(e) });
  }
});

function multerFieldFile(req, field) {
  const list = req.files?.[field];
  if (!list?.length) return null;
  const f = list[0];
  const p = f.path || resolveUploadedFilePath(f);
  return p && fs.existsSync(p) ? { path: p, originalname: f.originalname } : null;
}

function cleanupMulterTempFiles(req) {
  const fileList = [];
  if (Array.isArray(req.files)) {
    fileList.push(...req.files);
  } else if (req.files && typeof req.files === 'object') {
    for (const items of Object.values(req.files)) {
      if (Array.isArray(items)) fileList.push(...items);
    }
  }
  for (const f of fileList) {
    try { if (f?.path && fs.existsSync(f.path)) fs.unlinkSync(f.path); } catch (_) { /* ignore */ }
  }
  if (req.file?.path) {
    try { if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path); } catch (_) { /* ignore */ }
  }
}

router.post(
  '/soportes/armado/expedientes/:id/generar-opf',
  requireAuth,
  requireRoleOrPerm(ROLES_SOPORTES, 'soportes.armado.subir'),
  (req, res, next) => {
    uploadArmadoSoportes.fields([
      { name: 'autorizacion', maxCount: 1 },
      { name: 'orden_manual', maxCount: 1 },
      { name: 'opf_unido', maxCount: 1 },
      { name: 'parte_archivo', maxCount: 16 }
    ])(req, res, (err) => {
      if (err) return armadoUploadError(err, req, res, next);
      next();
    });
  },
  validateMagicBytes,
  async (req, res) => {
    try {
      const exp = await resolveExpedienteContext(req.params.id);
      if (!exp) return res.status(404).json({ error: 'Expediente no encontrado' });
      if (exp.contenedor_tipo === 'rips') {
        return res.status(400).json({ error: 'Genere el OPF en la carpeta SOPORTES del expediente' });
      }

      const { generarOpfEnExpediente, generarOpfDesdePartes, guardarOpfPdfUnido } = require('../utils/soportes-opf-generar');
      const opfUnido = multerFieldFile(req, 'opf_unido');
      const authFile = multerFieldFile(req, 'autorizacion');
      const ordenManual = multerFieldFile(req, 'orden_manual');
      const pdxOrdenId = parseInt(req.body?.pdx_orden_archivo_id, 10);
      const parteArchivos = (req.files?.parte_archivo || []).map((f) => {
        const p = f.path || resolveUploadedFilePath(f);
        return p && fs.existsSync(p) ? { path: p, originalname: f.originalname } : null;
      }).filter(Boolean);

      let result;
      const warnings = [];

      if (opfUnido) {
        result = await guardarOpfPdfUnido(exp, exp, opfUnido.path, {
          nombreOriginal: opfUnido.originalname,
          origen: 'upload_opf_unido',
          usuarioId: req.session.usuarioId
        });
      } else if (req.body?.partes_json) {
        let spec = [];
        try {
          spec = JSON.parse(req.body.partes_json);
        } catch (_) {
          return res.status(400).json({ error: 'Lista de partes inválida' });
        }
        if (!Array.isArray(spec) || spec.length < 2) {
          return res.status(400).json({ error: 'Agregue al menos 2 archivos PDF' });
        }
        const partes = [];
        for (const item of spec) {
          if (item?.t === 'pdx' || item?.tipo === 'pdx') {
            const pdxId = parseInt(item.id ?? item.pdx_archivo_id, 10);
            if (!pdxId) return res.status(400).json({ error: 'ID de archivo cargado inválido en la lista' });
            const pdxRows = await db.query(
              `SELECT a.*, c.nombre_display AS carpeta_nombre, c.periodo, c.color_tema
               FROM sop_pdx_archivos a JOIN sop_pdx_carpetas c ON c.id = a.carpeta_id WHERE a.id = ?`,
              [pdxId]
            );
            if (!pdxRows.length) return res.status(404).json({ error: `Archivo #${pdxId} no encontrado en reportes` });
            const row = pdxRows[0];
            const vis = await visPdxPeriodo(row.periodo);
            if (vis === 'archivo' && !puedeVerArchivo(req)) {
              return res.status(403).json({ error: 'Un archivo está en carpeta archivada' });
            }
            if (row.periodo !== exp.periodo) {
              warnings.push(`${row.nombre_archivo_original || 'PDF'} (${row.periodo}) → expediente ${exp.periodo}`);
            }
            partes.push({ kind: 'pdx', pdxRow: row });
          } else if (item?.t === 'file' || item?.tipo === 'file') {
            const idx = parseInt(item.i ?? item.index, 10);
            const f = parteArchivos[idx];
            if (!f) return res.status(400).json({ error: 'Falta un PDF manual en la lista' });
            partes.push({ kind: 'file', path: f.path, label: f.originalname });
          } else {
            return res.status(400).json({ error: 'Parte de lista no reconocida' });
          }
        }
        result = await generarOpfDesdePartes(exp, exp, partes, req.session.usuarioId);
      } else {
        let pdxRow = null;
        let ordenPath = ordenManual?.path || null;
        let ordenLabel = ordenManual?.originalname || null;

        if (pdxOrdenId) {
          const pdxRows = await db.query(
            `SELECT a.*, c.nombre_display AS carpeta_nombre, c.periodo, c.color_tema
             FROM sop_pdx_archivos a JOIN sop_pdx_carpetas c ON c.id = a.carpeta_id WHERE a.id = ?`,
            [pdxOrdenId]
          );
          if (!pdxRows.length) return res.status(404).json({ error: 'ORDEN+HC no encontrado en reportes' });
          pdxRow = pdxRows[0];
          const vis = await visPdxPeriodo(pdxRow.periodo);
          if (vis === 'archivo' && !puedeVerArchivo(req)) {
            return res.status(403).json({ error: 'El ORDEN+HC está en carpeta archivada' });
          }
          if (pdxRow.periodo !== exp.periodo) {
            warnings.push(`ORDEN+HC del mes ${pdxRow.periodo} → expediente en periodo ${exp.periodo}`);
          }
        }

        if (!pdxRow && !ordenPath) {
          return res.status(400).json({
            error: 'Agregue al menos 2 PDF (desde archivos cargados o manual), o suba el OPF ya unido'
          });
        }

        result = await generarOpfEnExpediente(exp, exp, {
          ordenPdxRow: pdxRow,
          ordenPath,
          ordenOriginalName: ordenLabel,
          authTempPath: authFile?.path || null,
          authOriginalName: authFile?.originalname,
          usuarioId: req.session.usuarioId
        });
      }

      cleanupMulterTempFiles(req);

      const detail = await buildExpedienteDetail(req.params.id);
      const avisoFactura = result.pendiente_factura
        ? ' Sin factura aún: al subir la FEV se renombrará con NIT y número FE.'
        : '';
      res.json({
        ok: true,
        message: `OPF guardado: ${result.nombre_archivo}${avisoFactura}`,
        ...result,
        expediente: detail,
        warnings
      });
    } catch (e) {
      cleanupMulterTempFiles(req);
      logger.error('[SOPORTES] generar-opf:', e);
      const msg = e.message || safeError(e);
      const status = /ya existe|no es un ORDEN|debe ser un PDF|no está en disco|Falta el PDF|Indique ORDEN/i.test(msg) ? 400 : 500;
      res.status(status).json({ error: msg });
    }
  }
);

router.get(
  '/soportes/armado/expedientes/:id/archivos/:tipo/descargar',
  requireAuth,
  requireRoleOrPerm(ROLES_SOPORTES, 'modulo.armado_soportes'),
  async (req, res) => {
    try {
      const { resolverArchivoExpedienteSlot } = require('../utils/soportes-exp-archivo');
      const resolved = await resolverArchivoExpedienteSlot(req.params.id, req.params.tipo, {
        repair: false,
        deepScan: false
      });
      if (!resolved.ok) return res.status(resolved.status || 404).json({ error: resolved.error });
      const fp = resolved.fp;
      const name = resolved.row.nombre_archivo || 'archivo';
      const ext = path.extname(name).toLowerCase();
      const mime = ext === '.pdf' ? 'application/pdf'
        : ext === '.json' ? 'application/json'
          : ext === '.xml' ? 'application/xml'
            : 'application/octet-stream';
      const inline = req.query.inline === '1' || req.query.inline === 'true';
      res.setHeader('Content-Type', mime);
      res.setHeader(
        'Content-Disposition',
        `${inline ? 'inline' : 'attachment'}; filename="${String(name).replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(name)}`
      );
      fs.createReadStream(fp).pipe(res);
    } catch (e) {
      logger.error('[SOPORTES] descargar archivo armado:', e);
      if (!res.headersSent) res.status(500).json({ error: safeError(e) });
    }
  }
);

router.post(
  '/soportes/armado/expedientes/:id/archivos/:tipo/resaltar',
  requireAuth,
  requireRoleOrPerm(ROLES_SOPORTES, PERMS_ARMADO_VER_SUBIR),
  async (req, res) => {
    try {
      const highlights = req.body?.highlights;
      if (!Array.isArray(highlights) || highlights.length === 0) {
        return res.status(400).json({ error: 'Indique al menos un resaltado' });
      }
      const { resolverArchivoExpedienteSlot, SOPORTES_SLOT_TIPOS } = require('../utils/soportes-exp-archivo');
      const tipo = String(req.params.tipo || '').toUpperCase();
      if (!SOPORTES_SLOT_TIPOS.includes(tipo)) {
        return res.status(400).json({ error: 'Solo se pueden resaltar PDF de soportes (OPF, CRC, FEV, PDX, HEV)' });
      }
      const resolved = await resolverArchivoExpedienteSlot(req.params.id, tipo);
      if (!resolved.ok) return res.status(resolved.status || 404).json({ error: resolved.error });
      const fp = resolved.fp;
      const loaded = resolved;
      if (!/\.pdf$/i.test(fp) && loaded.row.mime_type !== 'application/pdf') {
        return res.status(400).json({ error: 'El archivo no es PDF' });
      }

      const bytes = await readFileBuffer(fp);
      const { PDFDocument } = require('pdf-lib');
      const probe = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const sanitized = sanitizeHighlightsList(highlights, probe.getPageCount());
      if (!sanitized.length) return res.status(400).json({ error: 'Resaltados no válidos' });

      const tamano = await persistHighlightsOnPdfFile(fp, sanitized);
      await db.execute(
        'UPDATE sop_exp_archivos SET tamano_bytes = ?, subido_por = ? WHERE id = ?',
        [tamano, req.session.usuarioId, loaded.row.id]
      );
      const detail = await buildExpedienteDetail(req.params.id);
      res.json({
        ok: true,
        aplicados: sanitized.length,
        tamano_bytes: tamano,
        expediente: detail
      });
    } catch (e) {
      logger.error('[SOPORTES] resaltar armado:', e);
      res.status(500).json({ error: safeError(e) });
    }
  }
);

router.post(
  '/soportes/armado/expedientes/:id/archivos/:tipo/anexar-pdf',
  requireAuth,
  requireRoleOrPerm(ROLES_SOPORTES, PERMS_ARMADO_VER_SUBIR),
  (req, res, next) => {
    uploadArmadoSoportes.array('partes', 12)(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message || 'Error al subir PDF' });
      next();
    });
  },
  validateMagicBytes,
  async (req, res) => {
    try {
      const partes = (req.files || []).map((f) => f.path).filter(Boolean);
      if (!partes.length) {
        cleanupMulterTempFiles(req);
        return res.status(400).json({ error: 'Seleccione al menos un PDF para añadir' });
      }
      const { resolverArchivoExpedienteSlot, SOPORTES_SLOT_TIPOS } = require('../utils/soportes-exp-archivo');
      const tipo = String(req.params.tipo || '').toUpperCase();
      if (!SOPORTES_SLOT_TIPOS.includes(tipo)) {
        cleanupMulterTempFiles(req);
        return res.status(400).json({ error: 'Tipo de archivo no válido para anexar PDF' });
      }
      const resolved = await resolverArchivoExpedienteSlot(req.params.id, tipo);
      if (!resolved.ok) {
        cleanupMulterTempFiles(req);
        return res.status(resolved.status || 404).json({ error: resolved.error });
      }
      const fp = resolved.fp;
      const loaded = resolved;
      if (!/\.pdf$/i.test(fp) && loaded.row.mime_type !== 'application/pdf') {
        cleanupMulterTempFiles(req);
        return res.status(400).json({ error: 'El archivo no es PDF' });
      }
      const tamano = await appendPdfFilesToExisting(fp, partes);
      cleanupMulterTempFiles(req);
      await db.execute(
        'UPDATE sop_exp_archivos SET tamano_bytes = ?, subido_por = ? WHERE id = ?',
        [tamano, req.session.usuarioId, loaded.row.id]
      );
      const detail = await buildExpedienteDetail(req.params.id);
      res.json({
        ok: true,
        message: `Se añadió ${partes.length} PDF al final de ${tipo}`,
        anexados: partes.length,
        tamano_bytes: tamano,
        expediente: detail
      });
    } catch (e) {
      cleanupMulterTempFiles(req);
      logger.error('[SOPORTES] anexar armado:', e);
      res.status(500).json({ error: safeError(e) });
    }
  }
);

router.post(
  '/soportes/armado/expedientes/:id/archivos/:tipo/reordenar-paginas',
  requireAuth,
  requireRoleOrPerm(ROLES_SOPORTES, PERMS_ARMADO_VER_SUBIR),
  async (req, res) => {
    try {
      const order = req.body?.order;
      if (!Array.isArray(order) || !order.length) {
        return res.status(400).json({ error: 'Indique el nuevo orden de páginas' });
      }
      const { resolverArchivoExpedienteSlot, SOPORTES_SLOT_TIPOS } = require('../utils/soportes-exp-archivo');
      const tipo = String(req.params.tipo || '').toUpperCase();
      if (!SOPORTES_SLOT_TIPOS.includes(tipo)) {
        return res.status(400).json({ error: 'Tipo de archivo no válido' });
      }
      const resolved = await resolverArchivoExpedienteSlot(req.params.id, tipo);
      if (!resolved.ok) return res.status(resolved.status || 404).json({ error: resolved.error });
      const fp = resolved.fp;
      const loaded = resolved;
      if (!/\.pdf$/i.test(fp) && loaded.row.mime_type !== 'application/pdf') {
        return res.status(400).json({ error: 'El archivo no es PDF' });
      }
      const bytes = await readFileBuffer(fp);
      const { PDFDocument } = require('pdf-lib');
      const pageCount = (await PDFDocument.load(bytes, { ignoreEncryption: true })).getPageCount();
      const outBytes = await reorderPdfPagesFromBytes(bytes, order);
      await writePdfBytesAtomic(fp, outBytes);
      await db.execute(
        'UPDATE sop_exp_archivos SET tamano_bytes = ?, subido_por = ? WHERE id = ?',
        [outBytes.length, req.session.usuarioId, loaded.row.id]
      );
      const detail = await buildExpedienteDetail(req.params.id);
      res.json({ ok: true, message: 'Se reordenaron las páginas del PDF', tamano_bytes: outBytes.length, expediente: detail });
    } catch (e) {
      logger.error('[SOPORTES] reordenar armado:', e);
      res.status(500).json({ error: safeError(e) });
    }
  }
);

router.post(
  '/soportes/armado/expedientes/:id/archivos/:tipo/eliminar-paginas',
  requireAuth,
  requireRoleOrPerm(ROLES_SOPORTES, PERMS_ARMADO_VER_SUBIR),
  async (req, res) => {
    try {
      const pages = req.body?.pages;
      if (!Array.isArray(pages) || !pages.length) {
        return res.status(400).json({ error: 'Indique las páginas a eliminar (número 1, 2, …)' });
      }
      const { resolverArchivoExpedienteSlot, SOPORTES_SLOT_TIPOS } = require('../utils/soportes-exp-archivo');
      const tipo = String(req.params.tipo || '').toUpperCase();
      if (!SOPORTES_SLOT_TIPOS.includes(tipo)) {
        return res.status(400).json({ error: 'Tipo de archivo no válido' });
      }
      const resolved = await resolverArchivoExpedienteSlot(req.params.id, tipo);
      if (!resolved.ok) return res.status(resolved.status || 404).json({ error: resolved.error });
      const fp = resolved.fp;
      const loaded = resolved;
      if (!/\.pdf$/i.test(fp) && loaded.row.mime_type !== 'application/pdf') {
        return res.status(400).json({ error: 'El archivo no es PDF' });
      }

      const bytes = await readFileBuffer(fp);
      const { PDFDocument } = require('pdf-lib');
      const pageCount = (await PDFDocument.load(bytes, { ignoreEncryption: true })).getPageCount();
      const indexes = sanitizePageIndexes(pages, pageCount);
      const outBytes = await removePdfPagesFromBytes(bytes, indexes);
      await writePdfBytesAtomic(fp, outBytes);

      await db.execute(
        'UPDATE sop_exp_archivos SET tamano_bytes = ?, subido_por = ? WHERE id = ?',
        [outBytes.length, req.session.usuarioId, loaded.row.id]
      );
      const detail = await buildExpedienteDetail(req.params.id);
      res.json({
        ok: true,
        message: `Se eliminaron ${indexes.length} página(s) del PDF`,
        eliminadas: indexes.length,
        tamano_bytes: outBytes.length,
        expediente: detail
      });
    } catch (e) {
      logger.error('[SOPORTES] eliminar paginas armado:', e);
      res.status(500).json({ error: safeError(e) });
    }
  }
);

router.delete(
  '/soportes/armado/expedientes/:id/archivos/:tipo',
  requireAuth,
  requireRoleOrPerm(ROLES_SOPORTES, 'soportes.armado.subir'),
  async (req, res) => {
    try {
      const { eliminarArchivoExpedienteSlot } = require('../utils/soportes-exp-archivo');
      const result = await eliminarArchivoExpedienteSlot(req.params.id, req.params.tipo);
      if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
      const detail = await buildExpedienteDetail(req.params.id);
      res.json({
        ok: true,
        message: `Archivo ${result.tipo} eliminado`,
        expediente: detail
      });
    } catch (e) {
      logger.error('[SOPORTES] eliminar archivo armado:', e);
      res.status(500).json({ error: safeError(e) });
    }
  }
);

router.post(
  '/soportes/armado/expedientes/:id/unir-pdf/:tipo',
  requireAuth,
  requireRoleOrPerm(ROLES_SOPORTES, 'soportes.armado.subir'),
  (req, res, next) => {
    uploadArmadoSoportes.array('partes', 24)(req, res, (err) => {
      if (err) return armadoUploadError(err, req, res, next);
      next();
    });
  },
  validateMagicBytes,
  async (req, res) => {
    try {
      const exp = await resolveExpedienteContext(req.params.id);
      if (!exp) return res.status(404).json({ error: 'Expediente no encontrado' });
      if (exp.contenedor_tipo === 'rips') {
        return res.status(400).json({ error: 'Una los PDF en la carpeta SOPORTES del expediente' });
      }
      const partes = (req.files || []).map((f) => ({
        path: f.path,
        originalname: f.originalname
      })).filter((p) => p.path);
      if (partes.length < 2) {
        cleanupMulterTempFiles(req);
        return res.status(400).json({ error: 'Seleccione al menos 2 PDF para unir.' });
      }
      const tipoSlot = String(req.params.tipo || '').toUpperCase();
      if (tipoSlot === 'CRC' && partes.length > 4) {
        cleanupMulterTempFiles(req);
        return res.status(400).json({
          error: 'Para CRC seleccione 2, 3 o 4 PDF: 2=Comprobante+Certificado; 3=+Consentimiento; 4=+Cotización.'
        });
      }
      const { unirPdfsEnSlot } = require('../utils/soportes-slot-merge');
      const reemplazar = req.body?.reemplazar === '1' || req.body?.reemplazar === 'true';
      const ordenManual = req.body?.orden_manual === '1' || req.body?.orden_manual === 'true';
      const result = await unirPdfsEnSlot(exp, exp, req.params.tipo, partes, {
        usuarioId: req.session.usuarioId,
        reemplazar,
        minArchivos: 2,
        ordenManual
      });
      cleanupMulterTempFiles(req);
      const detail = await buildExpedienteDetail(req.params.id);
      const aviso = result.pendiente_factura ? ' (se renombrará al subir la FEV)' : '';
      res.json({
        ok: true,
        message: `${result.tipo} guardado: ${result.nombre_archivo}${aviso}`,
        ...result,
        expediente: detail
      });
    } catch (e) {
      cleanupMulterTempFiles(req);
      logger.error('[SOPORTES] unir-pdf:', e);
      const msg = e.message || safeError(e);
      const status = /al menos|Seleccione|requiere|reconoci|Falta|Ya existe|PDF|válido|no válido|RIPS|archivo\(s\)/i.test(msg) ? 400 : 500;
      res.status(status).json({ error: msg });
    }
  }
);

router.get('/soportes/armado/expedientes/:id/requisitos', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, 'modulo.armado_soportes'), async (req, res) => {
  try {
    const exp = await resolveExpedienteContext(req.params.id);
    if (!exp) return res.status(404).json({ error: 'No encontrado' });
    const reqSlots = slotRequirements(exp.contenedor_tipo, exp.tipo_servicio);
    res.json({
      codigo_fe: exp.codigo,
      numero_factura: exp.numero_factura,
      tiene_factura: expedienteTieneFactura(exp),
      nit_obligado: getNitObligado(),
      ...reqSlots,
      fev_nombre_ejemplo: fevFilenameHint(exp.numero_factura > 0 ? exp.numero_factura : '14726'),
      ejemplos_nombre: {
        OPF: buildSoportesDiskName('OPF', exp, '.pdf'),
        CRC: buildSoportesDiskName('CRC', exp, '.pdf'),
        FEV: buildCanonicalName('FEV', exp.numero_factura > 0 ? exp.numero_factura : '14726', '.pdf'),
        PDX: buildSoportesDiskName('PDX', exp, '.pdf'),
        HEV: buildSoportesDiskName('HEV', exp, '.pdf')
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
      notifySoportesArmado({ accion: 'archivo_subido', expedienteId: parseInt(req.params.id, 10), slot: tipo });
    } catch (e) {
      res.status(500).json({ error: safeError(e) });
    }
  }
);

router.post('/soportes/armado/zip/job', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, 'soportes.descargar_zip'), async (req, res) => {
  try {
    const body = req.body || {};
    const kind = String(body.kind || '').trim();
    const visCtx = await loadVisibleEnSoportesCtx();
    let job;

    if (kind === 'periodo-paquete' || kind === 'periodo-unificado' || kind === 'periodo-facturados') {
      const periodoId = parseInt(body.periodo_id, 10);
      const periodoRow = await requirePeriodoArmadoAccesible(req, res, periodoId, visCtx);
      if (!periodoRow) return;
      const label = zipArchiveSegment(periodoRow.etiqueta || periodoRow.periodo || `periodo-${periodoId}`);
      const suffix = kind === 'periodo-unificado' ? 'unificado' : (kind === 'periodo-facturados' ? 'facturados' : 'paquete');
      job = await createZipJobWithCache({
        kind,
        periodoId,
        filename: `${label}-${suffix}.zip`,
        emptyError: kind === 'periodo-facturados'
          ? 'No hay carpetas FE facturadas con archivos'
          : 'No hay archivos para descargar en este mes'
      }, req.session?.usuarioId || null);
    } else if (kind === 'dia' || kind === 'dia-carpeta') {
      const diaId = parseInt(body.dia_id, 10);
      const diaRow = await requireDiaArmadoAccesible(req, res, diaId, visCtx);
      if (!diaRow) return;
      const label = zipArchiveSegment(diaRow.nombre_display || `dia-${diaId}`);
      job = await createZipJobWithCache({
        kind,
        diaId,
        filename: `${label}.zip`,
        emptyError: 'La carpeta no tiene archivos para descargar'
      }, req.session?.usuarioId || null);
    } else if (kind === 'contenedor') {
      const contenedorId = parseInt(body.contenedor_id, 10);
      const cont = await requireContenedorArmadoAccesible(req, res, contenedorId, visCtx);
      if (!cont) return;
      const tipoLabel = cont.tipo === 'rips' ? 'RIPS' : 'SOPORTES';
      const label = zipArchiveSegment(cont.dia_nombre || 'dia');
      job = await createZipJobWithCache({
        kind,
        contenedorId,
        filename: `${label}-${tipoLabel}.zip`,
        emptyError: `La carpeta ${tipoLabel} no tiene archivos para descargar`
      }, req.session?.usuarioId || null);
    } else if (kind === 'expediente') {
      const expedienteId = parseInt(body.expediente_id, 10);
      const exp = await resolveExpedienteContext(expedienteId);
      if (!exp) return res.status(404).json({ error: 'Expediente no encontrado' });
      const diaRows = await db.query('SELECT periodo_id FROM sop_dias WHERE id = ?', [exp.dia_id]);
      if (!diaRows.length) return res.status(404).json({ error: 'Carpeta no encontrada' });
      const periodo = await requirePeriodoArmadoAccesible(req, res, diaRows[0].periodo_id, visCtx);
      if (!periodo) return;
      job = await createZipJobWithCache({
        kind,
        expedienteId,
        filename: `${zipArchiveSegment(exp.codigo || 'expediente')}.zip`,
        emptyError: 'El expediente no tiene archivos para descargar'
      }, req.session?.usuarioId || null);
    } else {
      return res.status(400).json({ error: 'Tipo de ZIP inválido' });
    }

    res.json({
      ok: true,
      job_id: job.id,
      status: job.status,
      progress: job.progress,
      message: job.message,
      filename: job.filename
    });
  } catch (e) {
    logger.error('[SOPORTES] zip job start:', e);
    res.status(500).json({ error: safeError(e) });
  }
});

router.get('/soportes/armado/zip/job/:jobId', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, 'soportes.descargar_zip'), (req, res) => {
  const job = getSopZipJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Trabajo no encontrado o expirado' });
  res.json({
    ok: true,
    job_id: job.id,
    kind: job.kind,
    status: job.status,
    progress: job.progress,
    message: job.message,
    error: job.error || null,
    filename: job.filename
  });
});

router.get('/soportes/armado/zip/job/:jobId/descargar', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, 'soportes.descargar_zip'), (req, res) => {
  try {
    const job = getSopZipJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Trabajo no encontrado o expirado' });
    streamZipJobDownload(res, job);
  } catch (e) {
    logger.error('[SOPORTES] zip job download:', e);
    if (!res.headersSent) res.status(500).json({ error: safeError(e) });
  }
});

router.get('/soportes/armado/dias/:id/zip', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, 'soportes.descargar_zip'), (req, res) => {
  respondLegacySyncZipDisabled(res);
});

router.get('/soportes/armado/dias/:id/zip-carpeta', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, 'soportes.descargar_zip'), (req, res) => {
  respondLegacySyncZipDisabled(res);
});

router.post('/soportes/armado/periodos/:id/zip-paquete/job', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, 'soportes.descargar_zip'), async (req, res) => {
  try {
    const periodoId = parseInt(req.params.id, 10);
    if (!periodoId) return res.status(400).json({ error: 'Periodo inválido' });
    const periodoRows = await db.query('SELECT * FROM sop_periodos WHERE id = ?', [periodoId]);
    if (!periodoRows.length) return res.status(404).json({ error: 'Periodo no encontrado' });
    const job = createPeriodPaqueteJob(periodoRows[0], req.session?.usuarioId || null);
    res.json({
      ok: true,
      job_id: job.id,
      status: job.status,
      progress: job.progress,
      message: job.message
    });
  } catch (e) {
    logger.error('[SOPORTES] zip-paquete job start:', e);
    res.status(500).json({ error: safeError(e) });
  }
});

router.get('/soportes/armado/periodos/:id/zip-paquete/job/:jobId', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, 'soportes.descargar_zip'), (req, res) => {
  const periodoId = parseInt(req.params.id, 10);
  const job = getSopZipJob(req.params.jobId);
  if (!job || job.periodoId !== periodoId) {
    return res.status(404).json({ error: 'Trabajo no encontrado o expirado' });
  }
  res.json({
    ok: true,
    job_id: job.id,
    status: job.status,
    progress: job.progress,
    message: job.message,
    error: job.error || null,
    filename: job.filename
  });
});

router.get('/soportes/armado/periodos/:id/zip-paquete/job/:jobId/descargar', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, 'soportes.descargar_zip'), (req, res) => {
  try {
    const periodoId = parseInt(req.params.id, 10);
    const job = getSopZipJob(req.params.jobId);
    if (!job || job.periodoId !== periodoId) {
      return res.status(404).json({ error: 'Trabajo no encontrado o expirado' });
    }
    if (job.status === 'error') {
      return res.status(500).json({ error: job.error || 'Error al generar ZIP' });
    }
    if (job.status !== 'ready' || !job.filePath || !fs.existsSync(job.filePath)) {
      return res.status(409).json({ error: 'El ZIP aún se está generando', status: job.status, progress: job.progress });
    }
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${job.filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    const stream = fs.createReadStream(job.filePath);
    stream.on('error', () => {
      if (!res.headersSent) res.status(500).json({ error: 'Error al leer el ZIP generado' });
    });
    stream.pipe(res);
  } catch (e) {
    logger.error('[SOPORTES] zip-paquete job download:', e);
    if (!res.headersSent) res.status(500).json({ error: safeError(e) });
  }
});

router.get('/soportes/armado/periodos/:id/zip-paquete', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, 'soportes.descargar_zip'), (req, res) => {
  respondLegacySyncZipDisabled(res);
});

router.get('/soportes/armado/periodos/:id/zip-unificado', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, 'soportes.descargar_zip'), (req, res) => {
  respondLegacySyncZipDisabled(res);
});

router.get('/soportes/armado/periodos/:id/zip-facturados', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, 'soportes.descargar_zip'), (req, res) => {
  respondLegacySyncZipDisabled(res);
});

router.get('/soportes/armado/expedientes/:id/zip', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, 'soportes.descargar_zip'), (req, res) => {
  respondLegacySyncZipDisabled(res);
});

router.get('/soportes/armado/buscar', requireAuth, requireRoleOrPerm(ROLES_SOPORTES, 'modulo.armado_soportes'), async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2 || !tokenizeSearchQuery(q).length) return res.json({ resultados: [] });
    const { sql: whereSql, params: whereParams } = buildArmadoBusquedaWhere(q);
    const rows = await db.query(
      `SELECT e.id AS expediente_id, e.codigo, e.paciente_nombre, e.paciente_documento, e.numero_factura,
              c.id AS contenedor_id, c.tipo AS contenedor_tipo,
              d.id AS dia_id, d.nombre_display AS dia_nombre,
              p.id AS periodo_id, p.periodo, p.etiqueta AS periodo_etiqueta
       FROM sop_expedientes e
       JOIN sop_contenedores c ON c.id = e.contenedor_id
       JOIN sop_dias d ON d.id = c.dia_id
       JOIN sop_periodos p ON p.id = d.periodo_id
       WHERE ${whereSql}
       ORDER BY p.periodo DESC, e.paciente_nombre ASC
       LIMIT 80`,
      whereParams
    );
    const visCtx = await loadVisibleEnSoportesCtx();
    const visibles = rows.filter((r) =>
      resolveVisibilidadArmadoRow(
        { id: r.periodo_id, periodo: r.periodo, etiqueta: r.periodo_etiqueta },
        visCtx
      ) !== 'archivo'
    );
    res.json({
      resultados: visibles.map((r) => ({
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
      SELECT e.id, e.codigo, e.tipo_servicio, e.paciente_nombre, d.nombre_display AS dia_nombre, c.tipo AS contenedor_tipo, p.periodo
      FROM sop_expedientes e
      JOIN sop_contenedores c ON c.id = e.contenedor_id
      JOIN sop_dias d ON d.id = c.dia_id
      JOIN sop_periodos p ON p.id = d.periodo_id
      WHERE c.tipo = 'soportes'`;
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
