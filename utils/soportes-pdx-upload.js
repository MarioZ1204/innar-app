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
  esCarpetaOrdenes,
  esCarpetaComprobantes,
  esCarpetaConsentimientos
} = require('./soportes-temas');
const { getPdxDir, relativePdxRuta } = require('./soportes-storage');

async function cargarEstudiosParaOrdenes(db) {
  try {
    return await db.query('SELECT id, nombre FROM estudio_duraciones ORDER BY nombre ASC');
  } catch (_) {
    return [];
  }
}

function necesitaListaEstudios(carpeta) {
  const tema = detectarTemaCarpeta(carpeta?.nombre_display || '');
  return ['ordenes', 'comprobantes', 'consentimientos'].includes(tema);
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
  if (['ordenes', 'comprobantes', 'consentimientos'].includes(tema)) {
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
    if (fileOrName.filename) return path.join(dir, fileOrName.filename);
  }
  return path.join(dir, String(fileOrName || ''));
}

function finalizePdxFileOnDisk(carpetaId, fileOrTmpName, meta, carpeta = null) {
  const dir = getPdxDir(carpetaId);
  const diskName = pdxDiskFilename(meta, carpeta);
  const tmpPath = resolveTmpUploadPath(carpetaId, fileOrTmpName);
  const finalPath = path.join(dir, diskName);
  if (!fs.existsSync(tmpPath)) {
    throw new Error(`Archivo temporal no encontrado tras la subida (${tmpPath})`);
  }
  if (path.resolve(tmpPath) !== path.resolve(finalPath)) {
    if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath);
    fs.renameSync(tmpPath, finalPath);
  }
  const onDisk = fs.existsSync(finalPath) ? path.basename(finalPath) : path.basename(tmpPath);
  const rutaRelativa = relativePdxRuta(carpetaId, onDisk);
  return {
    rutaRelativa,
    diskName: onDisk,
    nombre_archivo_display: meta.nombre_archivo_display || onDisk
  };
}

function ensureMetaPacienteNombre(meta, fallbackName = '') {
  if (!meta.paciente_nombre) {
    const ap = String(meta.apellidos || '').trim();
    const nom = String(meta.nombres || '').trim();
    meta.paciente_nombre = ap && nom ? `${ap}, ${nom}` : (ap || nom || fallbackName || 'Sin nombre');
  }
  if (!meta.paciente_nombre_norm) {
    meta.paciente_nombre_norm = normalizarNombreBusqueda(meta.paciente_nombre);
  }
  if (meta.fecha_estudio === '') meta.fecha_estudio = null;
  return meta;
}

function movePdxFileOnDisk(fromCarpetaId, toCarpetaId, oldRutaRelativa, meta, carpeta = null) {
  const oldFp = path.join(getPdxDir(fromCarpetaId), path.basename(oldRutaRelativa));
  const diskName = pdxDiskFilename(meta, carpeta);
  const destDir = getPdxDir(toCarpetaId);
  const newFp = path.join(destDir, diskName);
  if (fs.existsSync(oldFp)) {
    if (fs.existsSync(newFp)) fs.unlinkSync(newFp);
    fs.renameSync(oldFp, newFp);
  }
  return {
    rutaRelativa: path.join('soportes', 'pdx', String(toCarpetaId), diskName).replace(/\\/g, '/'),
    diskName
  };
}

function collectPdxWarnings(meta, carpeta) {
  const warnings = [];
  const tema = detectarTemaCarpeta(carpeta?.nombre_display || '');
  if (['ordenes', 'comprobantes', 'consentimientos', 'vtm', 'eeg', 'psg', 'actigrafia'].includes(tema)) {
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
  necesitaListaEstudios,
  pdxDiskFilename,
  finalizePdxFileOnDisk,
  resolveTmpUploadPath,
  ensureMetaPacienteNombre,
  movePdxFileOnDisk,
  collectPdxWarnings,
  nombreArchivoDescarga
};
