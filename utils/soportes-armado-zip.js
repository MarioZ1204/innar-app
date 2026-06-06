/**
 * Generación de ZIP para Armado de Soportes (carpeta de día, paquete de mes, unificado).
 */
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const db = require('./db-mysql');
const logger = require('./logger');
const { resolveArchivoAbsoluto } = require('./soportes-exp-archivo');
const sopStorage = require('./soportes-storage');
const { getArmadoFeDirAbs } = require('./soportes-armado-structure');
const { syncRipsCarpetasDia, syncRipsCarpetasPeriodo } = require('./soportes-rips-carpetas-sync');

const ZIP_COMPRESSION = 6;
const RIPS_FOLDER_PLACEHOLDER = Buffer.from(
  'Carpeta de factura para archivos RIPS (JSON/XML).\r\n',
  'utf8'
);

function zipArchiveSegment(name) {
  return String(name || 'sin-nombre')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100) || 'sin-nombre';
}

function facturaFolderName(exp) {
  const num = parseInt(exp.numero_factura, 10);
  if (num > 0) return zipArchiveSegment(`FE${num}`);
  const cod = String(exp.codigo || '').trim();
  if (cod) return zipArchiveSegment(cod);
  return zipArchiveSegment(`FE${exp.id}`);
}

function uniqueEntryName(usedPaths, zipPrefix, fileName, diaNombre) {
  let entryName = zipPrefix ? `${zipPrefix}/${fileName}` : fileName;
  if (!usedPaths) return entryName;
  if (!usedPaths.has(entryName)) {
    usedPaths.add(entryName);
    return entryName;
  }
  const diaSeg = zipArchiveSegment(diaNombre || 'dia');
  entryName = zipPrefix ? `${zipPrefix}/${diaSeg}_${fileName}` : `${diaSeg}_${fileName}`;
  usedPaths.add(entryName);
  return entryName;
}

function filterValidZipEntries(entries) {
  return entries.filter((e) => {
    if (e.placeholder) return true;
    if (!e.absPath) return false;
    try {
      return fs.existsSync(e.absPath) && fs.statSync(e.absPath).isFile();
    } catch (_) {
      return false;
    }
  });
}

function appendEntriesToArchive(archive, entries) {
  for (const e of filterValidZipEntries(entries)) {
    if (e.placeholder) {
      archive.append(e.content || Buffer.alloc(0), { name: e.name });
    } else {
      archive.file(e.absPath, { name: e.name });
    }
  }
}

async function listSoportesArchivoEntries(expedienteId, zipPrefix, usedPaths, diaNombre) {
  const entries = [];
  try {
    const archivos = await db.query('SELECT * FROM sop_exp_archivos WHERE expediente_id = ?', [expedienteId]);
    for (const a of archivos) {
      const fp = resolveArchivoAbsoluto(a);
      if (!fp || !fs.existsSync(fp)) continue;
      entries.push({
        absPath: fp,
        name: uniqueEntryName(usedPaths, zipPrefix, a.nombre_archivo, diaNombre)
      });
    }
  } catch (e) {
    logger.warn('[SOPORTES] zip soportes archivos:', e.message);
  }
  return entries;
}

function listRipsDirEntriesFromDisk(ctx, codigo, zipPrefix, usedPaths, diaNombre) {
  const entries = [];
  try {
    const { abs } = getArmadoFeDirAbs(
      sopStorage.soportesRoot,
      ctx.periodo,
      ctx.nombre_display,
      ctx.estado_facturacion,
      'rips',
      codigo
    );
    if (!abs || !fs.existsSync(abs)) return entries;
    const files = fs.readdirSync(abs);
    for (const fname of files) {
      const fp = path.join(abs, fname);
      if (!fs.statSync(fp).isFile()) continue;
      entries.push({
        absPath: fp,
        name: uniqueEntryName(usedPaths, zipPrefix, fname, diaNombre)
      });
    }
  } catch (e) {
    logger.warn('[SOPORTES] zip rips disco:', e.message);
  }
  return entries;
}

async function listRipsArchivoEntries(expedienteId, zipPrefix, usedPaths, diaNombre, ctx, codigo) {
  const entries = [];
  try {
    const ripsArchivos = await db.query('SELECT * FROM sop_rips_archivos WHERE expediente_id = ?', [expedienteId]);
    for (const a of ripsArchivos) {
      const fp = resolveArchivoAbsoluto(a);
      if (!fp || !fs.existsSync(fp)) continue;
      entries.push({
        absPath: fp,
        name: uniqueEntryName(usedPaths, zipPrefix, a.nombre_archivo, diaNombre)
      });
    }
  } catch (_) { /* tabla RIPS opcional */ }

  if (ctx && codigo) {
    const fromDisk = listRipsDirEntriesFromDisk(ctx, codigo, zipPrefix, usedPaths, diaNombre);
    for (const de of fromDisk) {
      if (!entries.some((x) => x.name === de.name)) entries.push(de);
    }
  }
  return entries;
}

function ensureRipsFacturaFolder(entries, usedPaths, codSeg) {
  const marker = `RIPS/${codSeg}/_CARPETA_FACTURA.txt`;
  if (usedPaths && usedPaths.has(marker)) return;
  if (usedPaths) usedPaths.add(marker);
  entries.push({ placeholder: true, name: marker, content: RIPS_FOLDER_PLACEHOLDER });
}

async function queryExpedientesDia(diaId) {
  return db.query(
    `SELECT e.id, e.codigo, e.numero_factura, c.tipo AS contenedor_tipo, d.nombre_display AS dia_nombre,
            d.estado_facturacion, p.periodo
     FROM sop_expedientes e
     JOIN sop_contenedores c ON c.id = e.contenedor_id
     JOIN sop_dias d ON d.id = c.dia_id
     JOIN sop_periodos p ON p.id = d.periodo_id
     WHERE c.dia_id = ?
     ORDER BY c.tipo ASC, e.codigo ASC`,
    [diaId]
  );
}

function groupExpedientesPorFactura(expedientes) {
  const grupos = new Map();
  for (const exp of expedientes) {
    const cod = facturaFolderName(exp);
    if (!grupos.has(cod)) {
      grupos.set(cod, {
        cod,
        soportes: [],
        rips: [],
        diaNombre: exp.dia_nombre,
        ctx: {
          periodo: exp.periodo,
          nombre_display: exp.dia_nombre,
          estado_facturacion: exp.estado_facturacion
        }
      });
    }
    const g = grupos.get(cod);
    if (exp.contenedor_tipo === 'rips') g.rips.push(exp);
    else g.soportes.push(exp);
  }
  return grupos;
}

async function collectDiaZipEntries(diaId, usedPaths = null) {
  const expedientes = await queryExpedientesDia(diaId);
  const grupos = groupExpedientesPorFactura(expedientes);
  const entries = [];

  for (const [, g] of grupos) {
    const codSeg = g.cod;
    const sopPrefix = `SOPORTES/${codSeg}`;
    const ripsPrefix = `RIPS/${codSeg}`;
    const ripsCodigo = g.soportes[0]?.codigo || g.rips[0]?.codigo || codSeg;

    for (const exp of g.soportes) {
      const part = await listSoportesArchivoEntries(exp.id, sopPrefix, usedPaths, g.diaNombre);
      entries.push(...part);
    }

    if (g.soportes.length) {
      ensureRipsFacturaFolder(entries, usedPaths, codSeg);
    }

    for (const exp of g.rips) {
      const part = await listRipsArchivoEntries(
        exp.id,
        ripsPrefix,
        usedPaths,
        g.diaNombre,
        g.ctx,
        ripsCodigo
      );
      entries.push(...part);
      if (part.length && !g.soportes.length) {
        ensureRipsFacturaFolder(entries, usedPaths, codSeg);
      }
    }
  }

  return filterValidZipEntries(entries);
}

function pipeArchiveToResponse(res, entries) {
  const valid = filterValidZipEntries(entries);
  if (!valid.length) {
    return Promise.reject(new Error('No hay archivos para el ZIP'));
  }
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: ZIP_COMPRESSION } });
    archive.on('error', reject);
    res.on('error', reject);
    archive.on('end', () => resolve(valid.length));
    if (!res.headersSent) {
      res.setHeader('Cache-Control', 'no-store');
    }
    archive.pipe(res);
    appendEntriesToArchive(archive, valid);
    archive.finalize();
  });
}

function createZipBuffer(entries) {
  const valid = filterValidZipEntries(entries);
  return new Promise((resolve, reject) => {
    if (!valid.length) {
      reject(new Error('ZIP vacío'));
      return;
    }
    const archive = archiver('zip', { zlib: { level: ZIP_COMPRESSION } });
    const chunks = [];
    archive.on('data', (chunk) => chunks.push(chunk));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);
    appendEntriesToArchive(archive, valid);
    archive.finalize();
  });
}

async function safeSyncRipsDia(diaId) {
  try {
    await syncRipsCarpetasDia(db, diaId);
  } catch (e) {
    logger.warn('[SOPORTES] zip sync dia:', e.message);
  }
}

async function safeSyncRipsPeriodo(periodoId) {
  try {
    await syncRipsCarpetasPeriodo(db, periodoId);
  } catch (e) {
    logger.warn('[SOPORTES] zip sync periodo:', e.message);
  }
}

async function streamDiaZip(res, dia) {
  await safeSyncRipsDia(dia.id);
  const entries = await collectDiaZipEntries(dia.id);
  if (!entries.length) {
    throw new Error('La carpeta no tiene archivos para descargar');
  }
  const zipLabel = zipArchiveSegment(dia.nombre_display || `dia-${dia.id}`);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${zipLabel}.zip"`);
  await pipeArchiveToResponse(res, entries);
}

async function buildPeriodPaqueteParts(periodoId, zipLabel) {
  const dias = await db.query(
    'SELECT id, nombre_display FROM sop_dias WHERE periodo_id = ? ORDER BY nombre_display ASC',
    [periodoId]
  );
  if (!dias.length) throw new Error('El mes no tiene carpetas de día');

  const parts = [];
  for (const dia of dias) {
    try {
      const entries = await collectDiaZipEntries(dia.id);
      if (!entries.length) continue;
      const buf = await createZipBuffer(entries);
      const diaSeg = zipArchiveSegment(dia.nombre_display || `dia-${dia.id}`);
      parts.push({ name: `${diaSeg}.zip`, buffer: buf });
    } catch (e) {
      logger.warn('[SOPORTES] zip paquete dia:', e.message);
    }
  }

  try {
    const unifiedEntries = await collectPeriodUnifiedEntries(periodoId);
    if (unifiedEntries.length) {
      const unifiedBuf = await createZipBuffer(unifiedEntries);
      parts.push({ name: `${zipLabel}-unificado.zip`, buffer: unifiedBuf });
    }
  } catch (e) {
    logger.warn('[SOPORTES] zip paquete unificado:', e.message);
  }

  if (!parts.length) throw new Error('No hay archivos para descargar en este mes');
  return parts;
}

async function streamPeriodPaqueteZip(res, periodo) {
  const periodoId = periodo.id;
  await safeSyncRipsPeriodo(periodoId);

  const zipLabel = zipArchiveSegment(periodo.etiqueta || periodo.periodo || `periodo-${periodoId}`);
  const parts = await buildPeriodPaqueteParts(periodoId, zipLabel);

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${zipLabel}-paquete.zip"`);
  res.setHeader('Cache-Control', 'no-store');

  await new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: ZIP_COMPRESSION } });
    archive.on('error', reject);
    res.on('error', reject);
    archive.on('end', () => resolve());
    archive.pipe(res);
    for (const part of parts) {
      archive.append(part.buffer, { name: part.name });
    }
    archive.finalize();
  });
}

async function collectPeriodUnifiedEntries(periodoId) {
  const usedPaths = new Set();
  const dias = await db.query(
    'SELECT id FROM sop_dias WHERE periodo_id = ? ORDER BY nombre_display ASC',
    [periodoId]
  );
  const entries = [];
  for (const dia of dias) {
    const part = await collectDiaZipEntries(dia.id, usedPaths);
    entries.push(...part);
  }
  return filterValidZipEntries(entries);
}

async function streamUnifiedPeriodZip(res, periodo) {
  await safeSyncRipsPeriodo(periodo.id);
  const entries = await collectPeriodUnifiedEntries(periodo.id);
  if (!entries.length) {
    throw new Error('No hay archivos para el ZIP unificado');
  }
  const zipLabel = zipArchiveSegment(periodo.etiqueta || periodo.periodo || `periodo-${periodo.id}`);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${zipLabel}-unificado.zip"`);
  await pipeArchiveToResponse(res, entries);
}

module.exports = {
  zipArchiveSegment,
  facturaFolderName,
  collectDiaZipEntries,
  collectPeriodUnifiedEntries,
  streamDiaZip,
  streamPeriodPaqueteZip,
  streamUnifiedPeriodZip
};
