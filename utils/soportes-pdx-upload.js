/**
 * Helpers de subida PDX: metadatos, nombre en disco normalizado.
 */
const path = require('path');
const fs = require('fs');
const {
  parseNombrePdx,
  parseNombreOrdenes,
  normalizarNombrePdx,
  normalizarNombreOrdenes,
  normalizarNombreBusqueda,
  fechaEnPeriodo,
  temaCoincideCarpeta,
  resolverEstudioDesdeLista
} = require('./soportes-pdx-parse');
const { detectarTemaCarpeta, esCarpetaOrdenes } = require('./soportes-temas');
const { getPdxDir } = require('./soportes-storage');

async function cargarEstudiosParaOrdenes(db) {
  try {
    return await db.query('SELECT id, nombre FROM estudio_duraciones ORDER BY nombre ASC');
  } catch (_) {
    return [];
  }
}

function buildMetaFromUploadOrdenes(originalName, body = {}, estudios = []) {
  const parsed = parseNombreOrdenes(originalName, estudios);
  const estudioManual = resolverEstudioDesdeLista(body.estudio_texto, estudios);
  if (!parsed.ok) {
    const doc = String(body.paciente_documento || '').trim().replace(/\s/g, '');
    if (!(body.apellidos && body.nombres && doc && body.fecha_estudio && estudioManual)) {
      return { ok: false, requiere_confirmacion: true };
    }
    const apellidos = String(body.apellidos).trim();
    const nombres = String(body.nombres).trim();
    return {
      ok: true,
      apellidos,
      nombres,
      paciente_documento: doc,
      paciente_nombre: `${apellidos}, ${nombres}`,
      paciente_nombre_norm: normalizarNombreBusqueda(`${apellidos}, ${nombres}`),
      fecha_estudio: body.fecha_estudio,
      marca_tiempo: '',
      sufijo_numero: '',
      estudio_texto: estudioManual,
      estudio_tema: 'ordenes',
      nombre_archivo_original: originalName,
      nombre_archivo_display: normalizarNombreOrdenes({
        apellidos,
        nombres,
        paciente_documento: doc,
        fecha: body.fecha_estudio,
        estudio: estudioManual
      })
    };
  }
  const estudio = estudioManual || parsed.estudio_texto;
  const doc = String(body.paciente_documento || parsed.paciente_documento || '').trim().replace(/\s/g, '') || parsed.paciente_documento;
  const fecha = body.fecha_estudio || parsed.fecha_estudio;
  const display = normalizarNombreOrdenes({
    apellidos: parsed.apellidos,
    nombres: parsed.nombres,
    paciente_documento: doc,
    fecha,
    estudio
  });
  return {
    ok: true,
    ...parsed,
    paciente_documento: doc,
    fecha_estudio: fecha,
    estudio_texto: estudio,
    estudio_tema: 'ordenes',
    nombre_archivo_original: originalName,
    nombre_archivo_display: display
  };
}

function buildMetaFromUpload(originalName, body = {}, carpeta = null) {
  if (carpeta && esCarpetaOrdenes(carpeta.nombre_display)) {
    return buildMetaFromUploadOrdenes(originalName, body, carpeta._estudiosLista || []);
  }
  const parsed = parseNombrePdx(originalName);
  const estudioManual = String(body.estudio_texto || '').trim();
  if (!parsed.ok) {
    if (!(body.apellidos && body.nombres && body.fecha_estudio && estudioManual)) {
      return { ok: false, requiere_confirmacion: true };
    }
    const apellidos = String(body.apellidos).trim();
    const nombres = String(body.nombres).trim();
    return {
      ok: true,
      apellidos,
      nombres,
      paciente_nombre: `${apellidos}, ${nombres}`,
      paciente_nombre_norm: normalizarNombreBusqueda(`${apellidos}, ${nombres}`),
      fecha_estudio: body.fecha_estudio,
      marca_tiempo: body.marca_tiempo || '',
      sufijo_numero: body.sufijo_numero || '',
      estudio_texto: estudioManual,
      estudio_tema: detectarTemaCarpeta(estudioManual),
      nombre_archivo_original: originalName,
      nombre_archivo_display: originalName
    };
  }
  const estudio = estudioManual || parsed.estudio_texto;
  const display = normalizarNombrePdx({
    apellidos: parsed.apellidos,
    nombres: parsed.nombres,
    fecha: parsed.fecha_estudio,
    marcaTiempo: parsed.marca_tiempo,
    sufijo: parsed.sufijo_numero,
    estudio
  });
  return {
    ok: true,
    ...parsed,
    estudio_texto: estudio,
    estudio_tema: detectarTemaCarpeta(estudio),
    nombre_archivo_original: originalName,
    nombre_archivo_display: display
  };
}

function pdxDiskFilename(meta) {
  const display = meta.nombre_archivo_display || normalizarNombrePdx({
    apellidos: meta.apellidos,
    nombres: meta.nombres,
    fecha: meta.fecha_estudio,
    marcaTiempo: meta.marca_tiempo || '00-00-00',
    sufijo: meta.sufijo_numero || '1',
    estudio: meta.estudio_texto
  });
  const safe = String(display)
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return safe || `reporte-${Date.now()}.pdf`;
}

function finalizePdxFileOnDisk(carpetaId, tmpFilename, meta) {
  const dir = getPdxDir(carpetaId);
  const diskName = pdxDiskFilename(meta);
  const tmpPath = path.join(dir, tmpFilename);
  const finalPath = path.join(dir, diskName);
  if (fs.existsSync(tmpPath)) {
    if (tmpFilename !== diskName) {
      if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath);
      fs.renameSync(tmpPath, finalPath);
    }
  }
  const rutaRelativa = path.join('soportes', 'pdx', String(carpetaId), diskName).replace(/\\/g, '/');
  return { rutaRelativa, diskName, nombre_archivo_display: meta.nombre_archivo_display || diskName };
}

function movePdxFileOnDisk(fromCarpetaId, toCarpetaId, oldRutaRelativa, meta) {
  const oldFp = path.join(getPdxDir(fromCarpetaId), path.basename(oldRutaRelativa));
  const diskName = pdxDiskFilename(meta);
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
  if (carpeta && esCarpetaOrdenes(carpeta.nombre_display)) {
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
  cargarEstudiosParaOrdenes,
  pdxDiskFilename,
  finalizePdxFileOnDisk,
  movePdxFileOnDisk,
  collectPdxWarnings
};
