/**
 * Generación de ZIP para Armado de Soportes (carpeta de día, paquete de mes, unificado).
 */
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const db = require('./db-mysql');
const { resolveStoragePath } = require('./soportes-storage');
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

function resolveArchivoAbsoluto(row) {
  const rel = String(row.ruta_relativa || '').replace(/\\/g, '/');
  if (!rel) return null;
  const joined = rel.startsWith('soportes/') ? rel : path.join('soportes', rel).replace(/\\/g, '/');
  return resolveStoragePath(joined);
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

async function listSoportesArchivoEntries(expedienteId, zipPrefix, usedPaths, diaNombre) {
  const entries = [];
  const archivos = await db.query('SELECT * FROM sop_exp_archivos WHERE expediente_id = ?', [expedienteId]);
  for (const a of archivos) {
    const fp = resolveArchivoAbsoluto(a);
    if (!fp || !fs.existsSync(fp)) continue;
    entries.push({
      absPath: fp,
      name: uniqueEntryName(usedPaths, zipPrefix, a.nombre_archivo, diaNombre)
    });
  }
  return entries;
}

async function listRipsArchivoEntries(expedienteId, zipPrefix, usedPaths, diaNombre) {
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
    const ripsDirEntries = await listRipsDirEntriesFromDisk(expedienteId, zipPrefix, usedPaths, diaNombre);
    for (const de of ripsDirEntries) {
      if (!entries.some((x) => x.name === de.name)) entries.push(de);
    }
  } catch (_) { /* tabla RIPS opcional */ }
  return entries;
}

async function listRipsDirEntriesFromDisk(expedienteId, zipPrefix, usedPaths, diaNombre) {
  const entries = [];
  const expRows = await db.query(
    `SELECT e.codigo, e.numero_factura, d.nombre_display, d.estado_facturacion, p.periodo
     FROM sop_expedientes e
     JOIN sop_contenedores c ON c.id = e.contenedor_id
     JOIN sop_dias d ON d.id = c.dia_id
     JOIN sop_periodos p ON p.id = d.periodo_id
     WHERE e.id = ?`,
    [expedienteId]
  );
  if (!expRows.length) return entries;
  const row = expRows[0];
  const { getArmadoFeDirAbs } = require('./soportes-armado-structure');
  const { soportesRoot } = require('./soportes-storage');
  const { abs } = getArmadoFeDirAbs(
    soportesRoot(),
    row.periodo,
    row.nombre_display,
    row.estado_facturacion,
    'rips',
    row.codigo
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
  return entries;
}

function ensureRipsFacturaFolder(entries, usedPaths, codSeg, diaNombre) {
  const prefix = `RIPS/${codSeg}`;
  const marker = `${prefix}/_CARPETA_FACTURA.txt`;
  if (usedPaths && usedPaths.has(marker)) return;
  if (usedPaths) usedPaths.add(marker);
  entries.push({ placeholder: true, name: marker, content: RIPS_FOLDER_PLACEHOLDER });
}

async function queryExpedientesDia(diaId) {
  return db.query(
    `SELECT e.id, e.codigo, e.numero_factura, c.tipo AS contenedor_tipo, d.nombre_display AS dia_nombre
     FROM sop_expedientes e
     JOIN sop_contenedores c ON c.id = e.contenedor_id
     JOIN sop_dias d ON d.id = c.dia_id
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
      grupos.set(cod, { cod, soportes: [], rips: [], diaNombre: exp.dia_nombre });
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

    for (const exp of g.soportes) {
      const part = await listSoportesArchivoEntries(exp.id, sopPrefix, usedPaths, g.diaNombre);
      entries.push(...part);
    }

    if (g.soportes.length) {
      ensureRipsFacturaFolder(entries, usedPaths, codSeg, g.diaNombre);
    }

    for (const exp of g.rips) {
      const part = await listRipsArchivoEntries(exp.id, ripsPrefix, usedPaths, g.diaNombre);
      entries.push(...part);
      if (part.length && !g.soportes.length) {
        ensureRipsFacturaFolder(entries, usedPaths, codSeg, g.diaNombre);
      }
    }
  }

  return entries;
}

function pipeArchiveToResponse(res, entries) {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: ZIP_COMPRESSION } });
    archive.on('error', reject);
    res.on('error', reject);
    archive.on('end', () => resolve(entries.length));
    res.setHeader('Cache-Control', 'no-store');
    archive.pipe(res);
    for (const e of entries) {
      if (e.placeholder) {
        archive.append(e.content || Buffer.alloc(0), { name: e.name });
      } else {
        archive.file(e.absPath, { name: e.name });
      }
    }
    archive.finalize();
  });
}

function createZipBuffer(entries) {
  return new Promise((resolve, reject) => {
    if (!entries.length) {
      reject(new Error('ZIP vacío'));
      return;
    }
    const archive = archiver('zip', { zlib: { level: ZIP_COMPRESSION } });
    const chunks = [];
    archive.on('data', (chunk) => chunks.push(chunk));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);
    for (const e of entries) {
      if (e.placeholder) {
        archive.append(e.content || Buffer.alloc(0), { name: e.name });
      } else {
        archive.file(e.absPath, { name: e.name });
      }
    }
    archive.finalize();
  });
}

async function buildDiaZipBuffer(diaId) {
  const entries = await collectDiaZipEntries(diaId);
  return createZipBuffer(entries);
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
  return entries;
}

async function streamDiaZip(res, dia) {
  await syncRipsCarpetasDia(db, dia.id);
  const entries = await collectDiaZipEntries(dia.id);
  if (!entries.length) {
    throw new Error('La carpeta no tiene archivos para descargar');
  }
  const zipLabel = zipArchiveSegment(dia.nombre_display || `dia-${dia.id}`);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${zipLabel}.zip"`);
  await pipeArchiveToResponse(res, entries);
}

async function streamPeriodPaqueteZip(res, periodo) {
  const periodoId = periodo.id;
  await syncRipsCarpetasPeriodo(db, periodoId);
  const dias = await db.query(
    'SELECT id, nombre_display FROM sop_dias WHERE periodo_id = ? ORDER BY nombre_display ASC',
    [periodoId]
  );
  if (!dias.length) throw new Error('El mes no tiene carpetas de día');

  const innerBuffers = [];
  for (const dia of dias) {
    try {
      const entries = await collectDiaZipEntries(dia.id);
      if (!entries.length) continue;
      const buf = await createZipBuffer(entries);
      const diaSeg = zipArchiveSegment(dia.nombre_display || `dia-${dia.id}`);
      innerBuffers.push({ name: `${diaSeg}.zip`, buf });
    } catch (_) { /* sin archivos en este día */ }
  }

  const unifiedEntries = await collectPeriodUnifiedEntries(periodoId);
  if (unifiedEntries.length) {
    const zipLabel = zipArchiveSegment(periodo.etiqueta || periodo.periodo || `periodo-${periodoId}`);
    const unifiedBuf = await createZipBuffer(unifiedEntries);
    innerBuffers.push({ name: `${zipLabel}-unificado.zip`, buf: unifiedBuf });
  }

  if (!innerBuffers.length) {
    throw new Error('No hay archivos para descargar en este mes');
  }

  const zipLabel = zipArchiveSegment(periodo.etiqueta || periodo.periodo || `periodo-${periodoId}`);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${zipLabel}-paquete.zip"`);

  await new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: ZIP_COMPRESSION } });
    archive.on('error', reject);
    res.on('finish', resolve);
    res.on('error', reject);
    archive.pipe(res);
    for (const item of innerBuffers) {
      archive.append(item.buf, { name: item.name });
    }
    archive.finalize();
  });
}

async function streamUnifiedPeriodZip(res, periodo) {
  await syncRipsCarpetasPeriodo(db, periodo.id);
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
  buildDiaZipBuffer,
  streamDiaZip,
  streamPeriodPaqueteZip,
  streamUnifiedPeriodZip
};
