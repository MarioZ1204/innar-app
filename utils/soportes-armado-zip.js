/**
 * Generación de ZIP para Armado de Soportes (carpeta de día, paquete de mes, unificado).
 */
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const db = require('./db-mysql');
const { resolveStoragePath } = require('./soportes-storage');

function zipArchiveSegment(name) {
  return String(name || 'sin-nombre')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100) || 'sin-nombre';
}

function facturaFolderName(exp) {
  const cod = String(exp.codigo || '').trim();
  if (cod) return zipArchiveSegment(cod);
  const num = parseInt(exp.numero_factura, 10);
  if (num > 0) return zipArchiveSegment(`FE${num}`);
  return zipArchiveSegment(`FE${exp.id}`);
}

async function appendSoportesArchivosToZip(archive, expedienteId, zipPrefix, usedPaths, diaNombre) {
  let added = 0;
  const archivos = await db.query('SELECT * FROM sop_exp_archivos WHERE expediente_id = ?', [expedienteId]);
  for (const a of archivos) {
    const fp = resolveStoragePath(path.join('soportes', a.ruta_relativa));
    if (!fp || !fs.existsSync(fp)) continue;
    let entryName = zipPrefix ? `${zipPrefix}/${a.nombre_archivo}` : a.nombre_archivo;
    if (usedPaths) {
      if (usedPaths.has(entryName)) {
        const diaSeg = zipArchiveSegment(diaNombre || 'dia');
        entryName = zipPrefix
          ? `${zipPrefix}/${diaSeg}_${a.nombre_archivo}`
          : `${diaSeg}_${a.nombre_archivo}`;
      }
      usedPaths.add(entryName);
    }
    archive.file(fp, { name: entryName });
    added += 1;
  }
  return added;
}

async function appendRipsArchivosToZip(archive, expedienteId, zipPrefix, usedPaths, diaNombre) {
  let added = 0;
  try {
    const ripsArchivos = await db.query('SELECT * FROM sop_rips_archivos WHERE expediente_id = ?', [expedienteId]);
    for (const a of ripsArchivos) {
      const fp = resolveStoragePath(path.join('soportes', a.ruta_relativa));
      if (!fp || !fs.existsSync(fp)) continue;
      let entryName = zipPrefix ? `${zipPrefix}/${a.nombre_archivo}` : a.nombre_archivo;
      if (usedPaths) {
        if (usedPaths.has(entryName)) {
          const diaSeg = zipArchiveSegment(diaNombre || 'dia');
          entryName = zipPrefix
            ? `${zipPrefix}/${diaSeg}_${a.nombre_archivo}`
            : `${diaSeg}_${a.nombre_archivo}`;
        }
        usedPaths.add(entryName);
      }
      archive.file(fp, { name: entryName });
      added += 1;
    }
  } catch (_) { /* tabla RIPS opcional */ }
  return added;
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

async function appendDiaEstructuradoToZip(archive, diaId, usedPaths = null) {
  const expedientes = await queryExpedientesDia(diaId);
  let total = 0;
  for (const exp of expedientes) {
    const codSeg = facturaFolderName(exp);
    if (exp.contenedor_tipo === 'rips') {
      total += await appendRipsArchivosToZip(
        archive,
        exp.id,
        `RIPS/${codSeg}`,
        usedPaths,
        exp.dia_nombre
      );
    } else {
      total += await appendSoportesArchivosToZip(
        archive,
        exp.id,
        `SOPORTES/${codSeg}`,
        usedPaths,
        exp.dia_nombre
      );
    }
  }
  return total;
}

function createZipBuffer(buildFn) {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 9 } });
    const chunks = [];
    archive.on('data', (chunk) => chunks.push(chunk));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);
    Promise.resolve(buildFn(archive))
      .then((count) => {
        if (!count) {
          reject(new Error('ZIP vacío'));
          return;
        }
        archive.finalize();
      })
      .catch(reject);
  });
}

async function buildDiaZipBuffer(diaId) {
  return createZipBuffer((archive) => appendDiaEstructuradoToZip(archive, diaId));
}

async function buildUnifiedPeriodZipBuffer(periodoId) {
  const usedPaths = new Set();
  return createZipBuffer(async (archive) => {
    const dias = await db.query(
      'SELECT id FROM sop_dias WHERE periodo_id = ? ORDER BY nombre_display ASC',
      [periodoId]
    );
    let total = 0;
    for (const dia of dias) {
      total += await appendDiaEstructuradoToZip(archive, dia.id, usedPaths);
    }
    return total;
  });
}

async function streamDiaZip(res, dia) {
  const zipLabel = zipArchiveSegment(dia.nombre_display || `dia-${dia.id}`);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${zipLabel}.zip"`);
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (err) => { throw err; });
  archive.pipe(res);
  const total = await appendDiaEstructuradoToZip(archive, dia.id);
  if (!total) {
    if (!res.headersSent) throw new Error('La carpeta no tiene archivos para descargar');
    archive.abort();
    return 0;
  }
  archive.finalize();
  return total;
}

async function streamPeriodPaqueteZip(res, periodo) {
  const periodoId = periodo.id;
  const dias = await db.query(
    'SELECT id, nombre_display FROM sop_dias WHERE periodo_id = ? ORDER BY nombre_display ASC',
    [periodoId]
  );
  if (!dias.length) throw new Error('El mes no tiene carpetas de día');

  const zipLabel = zipArchiveSegment(periodo.etiqueta || periodo.periodo || `periodo-${periodoId}`);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${zipLabel}-paquete.zip"`);
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (err) => { throw err; });
  archive.pipe(res);

  let anyFile = false;

  for (const dia of dias) {
    try {
      const buf = await buildDiaZipBuffer(dia.id);
      const diaSeg = zipArchiveSegment(dia.nombre_display || `dia-${dia.id}`);
      archive.append(buf, { name: `${diaSeg}.zip` });
      anyFile = true;
    } catch (_) { /* carpeta sin archivos — omitir */ }
  }

  try {
    const unifiedBuf = await buildUnifiedPeriodZipBuffer(periodoId);
    archive.append(unifiedBuf, { name: `${zipLabel}-unificado.zip` });
    anyFile = true;
  } catch (_) { /* sin archivos unificables */ }

  if (!anyFile) {
    if (!res.headersSent) throw new Error('No hay archivos para descargar en este mes');
    archive.abort();
    return 0;
  }

  archive.finalize();
  return 1;
}

async function streamUnifiedPeriodZip(res, periodo) {
  const zipLabel = zipArchiveSegment(periodo.etiqueta || periodo.periodo || `periodo-${periodo.id}`);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${zipLabel}-unificado.zip"`);
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (err) => { throw err; });
  archive.pipe(res);
  const usedPaths = new Set();
  const dias = await db.query(
    'SELECT id FROM sop_dias WHERE periodo_id = ? ORDER BY nombre_display ASC',
    [periodo.id]
  );
  let total = 0;
  for (const dia of dias) {
    total += await appendDiaEstructuradoToZip(archive, dia.id, usedPaths);
  }
  if (!total) {
    if (!res.headersSent) throw new Error('No hay archivos para el ZIP unificado');
    archive.abort();
    return 0;
  }
  archive.finalize();
  return total;
}

module.exports = {
  zipArchiveSegment,
  facturaFolderName,
  appendSoportesArchivosToZip,
  appendRipsArchivosToZip,
  appendDiaEstructuradoToZip,
  buildDiaZipBuffer,
  buildUnifiedPeriodZipBuffer,
  streamDiaZip,
  streamPeriodPaqueteZip,
  streamUnifiedPeriodZip
};
