/**
 * Helpers de subida PDX: metadatos, nombre en disco normalizado.
 */
const path = require('path');
const fs = require('fs');
const {
  parseNombrePorCarpeta,
  normalizarNombreBusqueda,
  inferirEstudioDesdeCarpeta,
  nombreArchivoDescarga,
  fechaEnPeriodo,
  temaCoincideCarpeta,
  resolverEstudioDesdeLista,
  mensajeErrorFormato,
  analizarNombreArchivo,
  buildMetaDesdeCamposManuales
} = require('./soportes-pdx-parse');
const {
  detectarTemaCarpeta,
  esTemaConsultaMedica
} = require('./soportes-temas');
const { getPdxDir, relativePdxRuta } = require('./soportes-storage');

async function cargarEstudiosParaOrdenes(db) {
  try {
    return await db.query('SELECT id, nombre FROM estudio_duraciones ORDER BY nombre ASC');
  } catch (_) {
    return [];
  }
}

async function cargarTiposConsultaParaPdx(db) {
  try {
    return await db.query(
      'SELECT id, nombre FROM tipos_consulta WHERE activo = 1 ORDER BY nombre ASC'
    );
  } catch (_) {
    return [];
  }
}

async function cargarEspecialidadesParaPdx(db) {
  try {
    return await db.query('SELECT id, nombre FROM especialidades WHERE activo = 1 ORDER BY nombre ASC');
  } catch (_) {
    return [];
  }
}

async function cargarListaParaCarpetaPdx(db, carpeta) {
  const tema = detectarTemaCarpeta(carpeta?.nombre_display || '');
  if (tema === 'ordenes_consulta_medica') {
    return cargarEspecialidadesParaPdx(db);
  }
  if (tema === 'comprobantes_consulta_medica') {
    return cargarTiposConsultaParaPdx(db);
  }
  if (['ordenes', 'comprobantes', 'consentimientos'].includes(tema)) {
    return cargarEstudiosParaOrdenes(db);
  }
  return [];
}

function necesitaListaEstudios(carpeta) {
  const tema = detectarTemaCarpeta(carpeta?.nombre_display || '');
  return ['ordenes', 'comprobantes', 'consentimientos', 'comprobantes_consulta_medica', 'ordenes_consulta_medica'].includes(tema);
}

function esConfirmacionManual(body) {
  const v = body?.confirmacion_manual;
  return v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true';
}

function buildMetaFromUpload(originalName, body = {}, carpeta = null) {
  if (esConfirmacionManual(body)) {
    return buildMetaDesdeCamposManuales(originalName, body, carpeta);
  }

  const estudios = carpeta?._estudiosLista || [];
  const analisis = analizarNombreArchivo(originalName, carpeta, estudios);
  const tema = analisis.tema || detectarTemaCarpeta(carpeta?.nombre_display || '');

  if (!analisis.ok) {
    return {
      ok: false,
      error: analisis.error || mensajeErrorFormato(tema),
      requiere_confirmacion: true,
      requiere_correccion: !!analisis.requiere_correccion,
      motivo: analisis.motivo,
      parcial: analisis.parcial
    };
  }

  const parsed = analisis.parsed;

  let estudio = parsed.estudio_texto || '';
  if (!estudio && ['vtm', 'eeg', 'psg', 'actigrafia'].includes(tema)) {
    estudio = inferirEstudioDesdeCarpeta(carpeta);
  }
  const estudioManual = resolverEstudioDesdeLista(body.estudio_texto, estudios);
  if (estudioManual) estudio = estudioManual;

  const meta = {
    ok: true,
    ...parsed,
    paciente_documento: parsed.paciente_documento || String(body.paciente_documento || '').trim().replace(/\s/g, '') || '',
    fecha_estudio: body.fecha_estudio || parsed.fecha_estudio,
    estudio_texto: estudio,
    estudio_tema: detectarTemaCarpeta(estudio || tema),
    nombre_archivo_original: originalName
  };

  meta.nombre_archivo_display = nombreArchivoDescarga(meta, carpeta);
  return meta;
}

function buildMetaFromUploadOrdenes(originalName, body = {}, estudios = []) {
  return buildMetaFromUpload(originalName, body, {
    nombre_display: 'ORDENES',
    _estudiosLista: estudios
  });
}

const MAX_PDX_DISK_NAME = 200;

function sanitizeDiskName(name) {
  let base = String(name)
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim() || `reporte-${Date.now()}.pdf`;
  if (!/\.pdf$/i.test(base)) base += '.pdf';
  if (base.length > MAX_PDX_DISK_NAME) {
    const ext = '.pdf';
    base = base.slice(0, MAX_PDX_DISK_NAME - ext.length) + ext;
  }
  return base;
}

function pdxDiskFilename(meta, carpeta = null) {
  const tema = detectarTemaCarpeta(carpeta?.nombre_display || '');
  if (['ordenes', 'comprobantes', 'consentimientos', 'comprobantes_consulta_medica', 'ordenes_consulta_medica'].includes(tema)) {
    return sanitizeDiskName(meta.nombre_archivo_display || meta.nombre_archivo_original || meta.original);
  }
  return sanitizeDiskName(meta.nombre_archivo_original || meta.original);
}

function resolveTmpUploadPath(carpetaId, fileOrName) {
  const dir = getPdxDir(carpetaId);
  if (fileOrName && typeof fileOrName === 'object') {
    if (fileOrName.path && fs.existsSync(fileOrName.path)) return fileOrName.path;
    if (fileOrName.destination && fileOrName.filename) {
      const p = path.join(fileOrName.destination, fileOrName.filename);
      if (fs.existsSync(p)) return p;
    }
    if (fileOrName.filename) {
      const p = path.join(dir, fileOrName.filename);
      if (fs.existsSync(p)) return p;
    }
  }
  const guess = path.join(dir, String(fileOrName || ''));
  return guess;
}

function moveFileSafe(src, dest) {
  if (path.resolve(src) === path.resolve(dest)) return;
  if (fs.existsSync(dest)) fs.unlinkSync(dest);
  try {
    fs.renameSync(src, dest);
  } catch (e) {
    if (e.code === 'EXDEV') {
      fs.copyFileSync(src, dest);
      fs.unlinkSync(src);
    } else {
      throw e;
    }
  }
}

/**
 * Deja el PDF con el nombre que generó multer (evita 500/404 por rename fallido en hosting).
 * nombre_archivo_display en BD sigue siendo el nombre “bonito” para descargas.
 */
function finalizePdxFileOnDisk(carpetaId, fileOrTmpName, meta, carpeta = null) {
  const dir = getPdxDir(carpetaId);
  const tmpPath = resolveTmpUploadPath(carpetaId, fileOrTmpName);
  if (!fs.existsSync(tmpPath)) {
    throw new Error(`Archivo temporal no encontrado tras la subida (${tmpPath})`);
  }

  const tema = detectarTemaCarpeta(carpeta?.nombre_display || '');
  const wantCanonicalDisk = ['ordenes', 'comprobantes', 'consentimientos', 'comprobantes_consulta_medica', 'ordenes_consulta_medica'].includes(tema);
  let onDisk = path.basename(tmpPath);

  if (wantCanonicalDisk) {
    const targetName = pdxDiskFilename(meta, carpeta);
    const finalPath = path.join(dir, targetName);
    if (targetName && targetName !== onDisk) {
      try {
        moveFileSafe(tmpPath, finalPath);
        onDisk = path.basename(finalPath);
      } catch (_) {
        onDisk = path.basename(tmpPath);
      }
    }
  }

  const rutaRelativa = relativePdxRuta(carpetaId, onDisk);
  return {
    rutaRelativa,
    diskName: onDisk,
    nombre_archivo_display: meta.nombre_archivo_display || meta.nombre_archivo_original || onDisk
  };
}

function ensureMetaPacienteNombre(meta, fallbackName = '') {
  if (!meta.paciente_nombre) {
    const ap = String(meta.apellidos || '').trim();
    const nom = String(meta.nombres || '').trim();
    meta.paciente_nombre = ap && nom ? `${ap}, ${nom}` : (ap || nom || fallbackName || 'Sin nombre');
  }
  meta.paciente_nombre = String(meta.paciente_nombre).slice(0, 200);
  if (!meta.paciente_nombre_norm) {
    meta.paciente_nombre_norm = normalizarNombreBusqueda(meta.paciente_nombre);
  }
  meta.paciente_nombre_norm = String(meta.paciente_nombre_norm).slice(0, 220);
  if (meta.fecha_estudio === '' || meta.fecha_estudio === undefined) meta.fecha_estudio = null;
  if (meta.fecha_estudio && !/^\d{4}-\d{2}-\d{2}$/.test(String(meta.fecha_estudio).slice(0, 10))) {
    meta.fecha_estudio = null;
  }
  meta.marca_tiempo = meta.marca_tiempo ? String(meta.marca_tiempo).slice(0, 40) : null;
  meta.sufijo_numero = meta.sufijo_numero ? String(meta.sufijo_numero).slice(0, 10) : null;
  meta.estudio_texto = meta.estudio_texto ? String(meta.estudio_texto).slice(0, 120) : null;
  meta.nombre_archivo_display = meta.nombre_archivo_display
    ? String(meta.nombre_archivo_display).slice(0, 255)
    : null;
  meta.ruta_relativa = meta.ruta_relativa ? String(meta.ruta_relativa).slice(0, 500) : null;
  return meta;
}

function movePdxFileOnDisk(fromCarpetaId, toCarpetaId, oldRutaRelativa, meta, carpeta = null) {
  const oldFp = path.join(getPdxDir(fromCarpetaId), path.basename(oldRutaRelativa));
  const diskName = pdxDiskFilename(meta, carpeta);
  const destDir = getPdxDir(toCarpetaId);
  const newFp = path.join(destDir, diskName);
  if (fs.existsSync(oldFp)) {
    moveFileSafe(oldFp, newFp);
  }
  return {
    rutaRelativa: path.join('soportes', 'pdx', String(toCarpetaId), diskName).replace(/\\/g, '/'),
    diskName
  };
}

function collectPdxWarnings(meta, carpeta) {
  const warnings = [];
  const tema = detectarTemaCarpeta(carpeta?.nombre_display || '');
  if (['ordenes', 'comprobantes', 'consentimientos', 'comprobantes_consulta_medica', 'ordenes_consulta_medica', 'vtm', 'eeg', 'psg', 'actigrafia'].includes(tema)) {
    if (carpeta && meta.fecha_estudio && !fechaEnPeriodo(meta.fecha_estudio, carpeta.periodo)) {
      warnings.push(`La fecha del estudio (${meta.fecha_estudio}) no pertenece al mes ${carpeta.periodo}`);
    }
    return warnings;
  }
  if (carpeta && meta.fecha_estudio && !fechaEnPeriodo(meta.fecha_estudio, carpeta.periodo)) {
    warnings.push(`La fecha del estudio (${meta.fecha_estudio}) no pertenece al mes ${carpeta.periodo}`);
  }
  if (carpeta && !temaCoincideCarpeta(meta.estudio_tema, carpeta.color_tema)) {
    warnings.push('El tipo de estudio no coincide con el tema de la carpeta');
  }
  return warnings;
}

module.exports = {
  buildMetaFromUpload,
  buildMetaFromUploadOrdenes,
  buildMetaDesdeCamposManuales,
  analizarNombreArchivo,
  esConfirmacionManual,
  cargarEstudiosParaOrdenes,
  cargarTiposConsultaParaPdx,
  cargarEspecialidadesParaPdx,
  cargarListaParaCarpetaPdx,
  necesitaListaEstudios,
  pdxDiskFilename,
  finalizePdxFileOnDisk,
  resolveTmpUploadPath,
  moveFileSafe,
  ensureMetaPacienteNombre,
  movePdxFileOnDisk,
  collectPdxWarnings,
  nombreArchivoDescarga
};
