/**
 * Generación de ZIP para Armado de Soportes (carpeta de día, paquete de mes, unificado).
 */
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const db = require('./db-mysql');
const logger = require('./logger');
const {
  resolveArchivoAbsoluto,
  resolverArchivoExpedienteRow,
  construirNombreEsperado,
  repararArchivosExpediente
} = require('./soportes-exp-archivo');
const sopStorage = require('./soportes-storage');
const { getArmadoFeDirFromContext } = require('./soportes-storage');
const { getUploadsRoot } = require('../config/uploads-path');
const { getArmadoFeDirAbs } = require('./soportes-armado-structure');
const { compararTextoNatural } = require('./comparar-texto-natural');
const { syncRipsCarpetasDia, syncRipsCarpetasPeriodo } = require('./soportes-rips-carpetas-sync');

const ZIP_COMPRESSION = 1;
/** Extensiones ya comprimidas: store en ZIP (más rápido, mismo tamaño). */
const PRECOMPRESSED_EXT = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.zip', '.xlsx', '.7z', '.rar']);

function zipEntryOptions(filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  if (PRECOMPRESSED_EXT.has(ext)) return { store: true };
  return {};
}

function getSopZipWorkDir() {
  const dir = path.join(getUploadsRoot(), 'sop-zip-jobs');
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    logger.warn('[SOPORTES] zip work dir:', e.message);
  }
  return dir;
}

function createArchiverInstance() {
  return archiver('zip', { zlib: { level: ZIP_COMPRESSION } });
}

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

/** Carpeta en ZIP = código del expediente (una carpeta FE por fila en la UI). */
function expedienteZipSegment(exp) {
  const cod = String(exp.codigo || '').trim();
  if (cod) return zipArchiveSegment(cod);
  const num = parseInt(exp.numero_factura, 10);
  if (num > 0) return zipArchiveSegment(`FE${num}`);
  return zipArchiveSegment(`FE${exp.id}`);
}

/** Carpeta FÍSICA real en disco (carpeta_fisica inmutable si existe, o el código legacy). */
function expedienteCarpetaFisicaSegment(exp) {
  const explicit = String(exp?.carpeta_fisica || '').trim();
  if (explicit) return explicit;
  return expedienteZipSegment(exp);
}

function ensureZipFolderPlaceholder(entries, usedPaths, folderPath) {
  let dir = String(folderPath || '');
  if (!dir.endsWith('/')) dir += '/';
  if (usedPaths?.has(dir)) return;
  if (entries.some((e) => e.name === dir || (e.name && e.name.startsWith(dir)))) return;
  if (usedPaths) usedPaths.add(dir);
  entries.push({ placeholder: true, name: dir, content: Buffer.alloc(0) });
}

/**
 * Recupera del disco los archivos de la carpeta física del expediente/contenedor
 * que no quedaron incluidos por el registro en BD (registro faltante, desincronizado
 * o apuntando a otra ubicación). Evita ZIPs incompletos aunque la BD esté desajustada.
 */
function listExpedienteFolderExtras(ctx, codigo, zipPrefix, usedPaths, alreadyAbsPaths) {
  const entries = [];
  if (!ctx || !codigo) return entries;
  let abs = null;
  try {
    ({ abs } = getArmadoFeDirFromContext(ctx, codigo));
  } catch (e) {
    logger.warn('[SOPORTES] zip recuperar disco resolver dir:', e.message);
    return entries;
  }
  if (!abs || !fs.existsSync(abs)) return entries;

  let files = [];
  try {
    files = fs.readdirSync(abs, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name);
  } catch (e) {
    logger.warn('[SOPORTES] zip recuperar disco:', e.message);
    return entries;
  }

  for (const fname of files) {
    const full = path.join(abs, fname);
    if (alreadyAbsPaths?.has(path.resolve(full))) continue;
    if (fname.startsWith('.') || fname.endsWith('.bak') || /\.bak\.\d+$/.test(fname)) continue;
    entries.push({
      absPath: full,
      name: uniqueEntryName(usedPaths, zipPrefix, fname, ctx.nombre_display)
    });
    if (alreadyAbsPaths) alreadyAbsPaths.add(path.resolve(full));
  }
  return entries;
}

function absPathsFromEntries(entries) {
  const set = new Set();
  for (const e of entries || []) {
    if (e?.absPath) set.add(path.resolve(e.absPath));
  }
  return set;
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
    try {
      if (e.placeholder) {
        archive.append(e.content || Buffer.alloc(0), { name: e.name });
      } else {
        archive.file(e.absPath, { name: e.name, ...zipEntryOptions(e.absPath) });
      }
    } catch (err) {
      logger.warn('[SOPORTES] zip omitir entrada:', e.name, err.message);
    }
  }
}

async function appendEntriesToArchiveAsync(archive, entries, yieldEvery = 4) {
  const valid = filterValidZipEntries(entries);
  for (let i = 0; i < valid.length; i++) {
    const e = valid[i];
    try {
      if (e.placeholder) {
        archive.append(e.content || Buffer.alloc(0), { name: e.name });
      } else {
        archive.file(e.absPath, { name: e.name, ...zipEntryOptions(e.absPath) });
      }
    } catch (err) {
      logger.warn('[SOPORTES] zip omitir entrada:', e.name, err.message);
    }
    if ((i + 1) % yieldEvery === 0) await yieldEventLoop();
  }
}

function bindArchiveStreamGuards(archive, res) {
  archive.on('warning', (err) => {
    if (err.code === 'ENOENT') {
      logger.warn('[SOPORTES] zip archivo no encontrado:', err.message);
      return;
    }
    logger.warn('[SOPORTES] zip warning:', err.message);
  });
  archive.on('error', (err) => {
    logger.error('[SOPORTES] zip archive error:', err.message);
    try { archive.abort(); } catch (_) { /* ignore */ }
  });
  if (res && !res.destroyed) {
    res.on('close', () => {
      if (!res.writableFinished) {
        try { archive.abort(); } catch (_) { /* ignore */ }
      }
    });
  }
}

async function loadArchivosByExpedienteIds(expIds) {
  const map = new Map();
  if (!expIds.length) return map;
  const placeholders = expIds.map(() => '?').join(',');
  const archivos = await db.query(
    `SELECT * FROM sop_exp_archivos WHERE expediente_id IN (${placeholders})`,
    expIds
  );
  for (const a of archivos) {
    if (!map.has(a.expediente_id)) map.set(a.expediente_id, []);
    map.get(a.expediente_id).push(a);
  }
  return map;
}

async function loadRipsArchivosByExpedienteIds(expIds) {
  const map = new Map();
  if (!expIds.length) return map;
  try {
    const placeholders = expIds.map(() => '?').join(',');
    const rows = await db.query(
      `SELECT * FROM sop_rips_archivos WHERE expediente_id IN (${placeholders})`,
      expIds
    );
    for (const a of rows) {
      if (!map.has(a.expediente_id)) map.set(a.expediente_id, []);
      map.get(a.expediente_id).push(a);
    }
  } catch (_) { /* tabla opcional */ }
  return map;
}

function listSoportesArchivoEntriesFromRows(archivos, zipPrefix, usedPaths, diaNombre, expediente = null) {
  const entries = [];
  for (const a of archivos || []) {
    const fp = expediente
      ? resolverArchivoExpedienteRow(a, expediente)
      : resolveArchivoAbsoluto(a);
    if (!fp || !fs.existsSync(fp)) continue;
    const zipName = construirNombreEsperado(a, expediente) || a.nombre_archivo;
    entries.push({
      absPath: fp,
      name: uniqueEntryName(usedPaths, zipPrefix, zipName, diaNombre)
    });
  }
  return entries;
}

function listRipsArchivoEntriesFromRows(ripsArchivos, expedienteId, zipPrefix, usedPaths, diaNombre, ctx, codigo, expediente = null) {
  const entries = [];
  for (const a of ripsArchivos || []) {
    const fp = expediente
      ? resolverArchivoExpedienteRow(a, expediente)
      : resolveArchivoAbsoluto(a);
    if (!fp || !fs.existsSync(fp)) continue;
    const slotKey = a.slot === 'json_1' ? 'RIPS_JSON_1' : a.slot === 'json_2' ? 'RIPS_JSON_2' : 'RIPS_XML';
    const zipName = construirNombreEsperado({ ...a, tipo: slotKey }, expediente) || a.nombre_archivo;
    entries.push({
      absPath: fp,
      name: uniqueEntryName(usedPaths, zipPrefix, zipName, diaNombre)
    });
  }
  if (ctx && codigo) {
    const fromDisk = listRipsDirEntriesFromDisk(ctx, codigo, zipPrefix, usedPaths, diaNombre);
    for (const de of fromDisk) {
      if (!entries.some((x) => x.name === de.name)) entries.push(de);
    }
  }
  return entries;
}

async function listSoportesArchivoEntries(expedienteId, zipPrefix, usedPaths, diaNombre, expediente = null) {
  const entries = [];
  try {
    const archivos = await db.query('SELECT * FROM sop_exp_archivos WHERE expediente_id = ?', [expedienteId]);
    for (const a of archivos) {
      const fp = expediente
        ? resolverArchivoExpedienteRow(a, expediente)
        : resolveArchivoAbsoluto(a);
      if (!fp || !fs.existsSync(fp)) continue;
      const zipName = construirNombreEsperado(a, expediente) || a.nombre_archivo;
      entries.push({
        absPath: fp,
        name: uniqueEntryName(usedPaths, zipPrefix, zipName, diaNombre)
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

async function listRipsArchivoEntries(expedienteId, zipPrefix, usedPaths, diaNombre, ctx, codigo, expediente = null) {
  const entries = [];
  try {
    const ripsArchivos = await db.query('SELECT * FROM sop_rips_archivos WHERE expediente_id = ?', [expedienteId]);
    for (const a of ripsArchivos) {
      const fp = expediente
        ? resolverArchivoExpedienteRow(a, expediente)
        : resolveArchivoAbsoluto(a);
      if (!fp || !fs.existsSync(fp)) continue;
      const slotKey = a.slot === 'json_1' ? 'RIPS_JSON_1' : a.slot === 'json_2' ? 'RIPS_JSON_2' : 'RIPS_XML';
      const zipName = construirNombreEsperado({ ...a, tipo: slotKey }, expediente) || a.nombre_archivo;
      entries.push({
        absPath: fp,
        name: uniqueEntryName(usedPaths, zipPrefix, zipName, diaNombre)
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
  const dirName = `RIPS/${codSeg}/`;
  if (usedPaths && usedPaths.has(dirName)) return;
  if (usedPaths) usedPaths.add(dirName);
  entries.push({ placeholder: true, name: dirName, content: Buffer.alloc(0) });
}

async function queryExpedientesDia(diaId) {
  return db.query(
    `SELECT e.id, e.codigo, e.carpeta_fisica, e.numero_factura, e.paciente_nombre, c.tipo AS contenedor_tipo, d.nombre_display AS dia_nombre,
            d.estado_facturacion, p.periodo, p.etiqueta AS periodo_etiqueta
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

async function collectDiaZipEntries(diaId, usedPaths = null, opts = {}) {
  const repair = opts.repair === true;
  const expedientes = await queryExpedientesDia(diaId);
  if (repair) {
    for (const exp of expedientes) {
      try {
        await repararArchivosExpediente(exp.id, exp);
      } catch (e) {
        logger.warn('[SOPORTES] zip reparar expediente:', e.message);
      }
    }
  }
  const expIds = expedientes.map((e) => e.id);
  const archivosByExp = await loadArchivosByExpedienteIds(expIds);
  const ripsByExp = await loadRipsArchivosByExpedienteIds(expIds);
  const entries = [];

  for (const exp of expedientes) {
    const codSeg = expedienteZipSegment(exp);
    const prefixRoot = exp.contenedor_tipo === 'rips' ? 'RIPS' : 'SOPORTES';
    const zipPrefix = `${prefixRoot}/${codSeg}`;
    const ctx = {
      periodo: exp.periodo,
      periodo_etiqueta: exp.periodo_etiqueta,
      nombre_display: exp.dia_nombre,
      estado_facturacion: exp.estado_facturacion,
      contenedor_tipo: exp.contenedor_tipo
    };
    const expedienteCtx = {
      codigo: exp.codigo,
      numero_factura: exp.numero_factura,
      paciente_nombre: exp.paciente_nombre,
      nombre_display: exp.dia_nombre
    };

    let part = [];
    if (exp.contenedor_tipo === 'rips') {
      part = listRipsArchivoEntriesFromRows(
        ripsByExp.get(exp.id),
        exp.id,
        zipPrefix,
        usedPaths,
        exp.dia_nombre,
        ctx,
        exp.codigo,
        expedienteCtx
      );
    } else {
      part = listSoportesArchivoEntriesFromRows(
        archivosByExp.get(exp.id),
        zipPrefix,
        usedPaths,
        exp.dia_nombre,
        expedienteCtx
      );
    }

    const extras = listExpedienteFolderExtras(ctx, expedienteCarpetaFisicaSegment(exp), zipPrefix, usedPaths, absPathsFromEntries(part));
    if (extras.length) part = part.concat(extras);

    if (!part.length) {
      ensureZipFolderPlaceholder(entries, usedPaths, zipPrefix);
    } else {
      entries.push(...part);
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
    const archive = createArchiverInstance();
    bindArchiveStreamGuards(archive, res);
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

function pipeArchiveToFile(outPath, entries, onEntry = null) {
  const valid = filterValidZipEntries(entries);
  return new Promise((resolve, reject) => {
    if (!valid.length) {
      reject(new Error('No hay archivos para el ZIP'));
      return;
    }
    const output = fs.createWriteStream(outPath);
    const archive = createArchiverInstance();
    bindArchiveStreamGuards(archive, null);
    archive.on('error', reject);
    output.on('error', reject);
    output.on('close', () => resolve(valid.length));
    archive.pipe(output);
    appendEntriesToArchive(archive, valid);
    if (onEntry) onEntry(valid.length);
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
    const archive = createArchiverInstance();
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

/** Carpetas de facturación con expedientes (excluye contenedoras, anexo y UCQN). */
async function queryDiasFacturacionZip(periodoId) {
  const dias = await db.query(
    `SELECT id, nombre_display FROM sop_dias
     WHERE periodo_id = ? AND es_contenedor = 0 AND COALESCE(modo, 'facturacion') = 'facturacion'`,
    [periodoId]
  );
  dias.sort((a, b) => compararTextoNatural(a.nombre_display, b.nombre_display));
  return dias;
}

function appendInnerZipToArchive(outerArchive, name, entries) {
  const valid = filterValidZipEntries(entries);
  if (!valid.length) return Promise.resolve(false);
  return new Promise((resolve, reject) => {
    const inner = createArchiverInstance();
    inner.on('error', reject);
    inner.on('end', () => resolve(true));
    outerArchive.append(inner, { name });
    appendEntriesToArchive(inner, valid);
    inner.finalize();
  });
}

async function streamDiaZip(res, dia) {
  const entries = await collectDiaZipEntries(dia.id);
  if (!entries.length) {
    throw new Error('La carpeta no tiene archivos para descargar');
  }
  const zipLabel = zipArchiveSegment(dia.nombre_display || `dia-${dia.id}`);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${zipLabel}.zip"`);
  await pipeArchiveToResponse(res, entries);
}

async function collectPeriodPaqueteFlatEntries(periodoId) {
  const dias = await queryDiasFacturacionZip(periodoId);
  const usedPaths = new Set();
  const entries = [];

  for (const dia of dias) {
    const diaSeg = zipArchiveSegment(dia.nombre_display || `dia-${dia.id}`);
    const part = await collectDiaZipEntries(dia.id);
    for (const e of part) {
      let name = `${diaSeg}/${e.name}`;
      if (usedPaths.has(name)) {
        name = `${diaSeg}/${diaSeg}_${path.basename(e.name)}`;
      }
      usedPaths.add(name);
      entries.push({ ...e, name });
    }
  }

  return filterValidZipEntries(entries);
}

/** @deprecated Preferir collectPeriodPaqueteFlatEntries. */
async function buildPeriodPaqueteParts(periodoId, zipLabel) {
  const entries = await collectPeriodPaqueteFlatEntries(periodoId);
  if (!entries.length) throw new Error('No hay archivos para descargar en este mes');
  const buf = await createZipBuffer(entries);
  return [{ name: `${zipLabel || 'mes'}-por-dias.zip`, buffer: buf }];
}

async function streamPeriodPaqueteZip(res, periodo) {
  const periodoId = periodo.id;
  const zipLabel = zipArchiveSegment(periodo.etiqueta || periodo.periodo || `periodo-${periodoId}`);
  const entries = await collectPeriodPaqueteFlatEntries(periodoId);
  if (!entries.length) throw new Error('No hay archivos para descargar en este mes');

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${zipLabel}-paquete.zip"`);
  res.setHeader('Cache-Control', 'no-store');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
  await pipeArchiveToResponse(res, entries);
}

async function collectPeriodUnifiedEntries(periodoId) {
  const usedPaths = new Set();
  const dias = await queryDiasFacturacionZip(periodoId);
  const entries = [];
  for (const dia of dias) {
    const part = await collectDiaZipEntries(dia.id, usedPaths);
    entries.push(...part);
  }
  return filterValidZipEntries(entries);
}

async function streamUnifiedPeriodZip(res, periodo) {
  const entries = await collectPeriodUnifiedEntries(periodo.id);
  if (!entries.length) {
    throw new Error('No hay archivos para el ZIP unificado');
  }
  const zipLabel = zipArchiveSegment(periodo.etiqueta || periodo.periodo || `periodo-${periodo.id}`);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${zipLabel}-unificado.zip"`);
  await pipeArchiveToResponse(res, entries);
}

function buildDiaChildrenMap(allDias) {
  const map = new Map();
  for (const d of allDias) {
    const p = parseInt(d.parent_id, 10) || 0;
    if (!map.has(p)) map.set(p, []);
    map.get(p).push(d);
  }
  for (const list of map.values()) {
    list.sort((a, b) => compararTextoNatural(a.nombre_display, b.nombre_display));
  }
  return map;
}

async function collectAnexoDiaZipEntries(dia, pathPrefix, usedPaths, out) {
  if (!dia.anexo_archivo_id) return;
  const archRows = await db.query('SELECT * FROM anexo_fidu_archivos WHERE id = ?', [dia.anexo_archivo_id]);
  if (!archRows.length || !archRows[0].ruta_export) return;
  const fp = resolveArchivoAbsoluto({ ruta_relativa: archRows[0].ruta_export });
  if (!fp || !fs.existsSync(fp)) return;
  const fname = path.basename(fp);
  out.push({
    absPath: fp,
    name: uniqueEntryName(usedPaths, pathPrefix, fname, dia.nombre_display)
  });
}

async function collectUcqnDiaZipEntries(dia, pathPrefix, usedPaths, out) {
  const archivos = await db.query(
    `SELECT a.* FROM sop_exp_archivos a
     JOIN sop_expedientes e ON e.id = a.expediente_id
     JOIN sop_contenedores c ON c.id = e.contenedor_id
     WHERE c.dia_id = ? AND a.tipo = 'PDF'`,
    [dia.id]
  );
  for (const a of archivos) {
    const fp = resolveArchivoAbsoluto(a);
    if (!fp || !fs.existsSync(fp)) continue;
    const fname = a.nombre_original || a.nombre_archivo;
    out.push({
      absPath: fp,
      name: uniqueEntryName(usedPaths, pathPrefix, fname, dia.nombre_display)
    });
  }
}

async function collectLeafDiaZipEntries(dia, pathPrefix, usedPaths, out) {
  const modo = dia.modo || 'facturacion';
  if (modo === 'ucqn') {
    await collectUcqnDiaZipEntries(dia, pathPrefix, usedPaths, out);
    return;
  }
  if (modo === 'anexo_fidu') {
    await collectAnexoDiaZipEntries(dia, pathPrefix, usedPaths, out);
    return;
  }
  const part = await collectDiaZipEntries(dia.id, null);
  for (const e of part) {
    let name = pathPrefix ? `${pathPrefix}/${e.name}` : e.name;
    if (usedPaths.has(name)) {
      const seg = zipArchiveSegment(dia.nombre_display || `dia-${dia.id}`);
      name = pathPrefix ? `${pathPrefix}/${seg}_${e.name}` : `${seg}_${e.name}`;
    }
    usedPaths.add(name);
    out.push({ absPath: e.absPath, name });
  }
}

async function walkCarpetaZip(diaId, pathPrefix, diasById, childrenMap, usedPaths, out) {
  const dia = diasById.get(diaId);
  if (!dia) return;
  if (!dia.es_contenedor) {
    await collectLeafDiaZipEntries(dia, pathPrefix, usedPaths, out);
    return;
  }
  const children = childrenMap.get(diaId) || [];
  for (const child of children) {
    const seg = zipArchiveSegment(child.nombre_display);
    const next = pathPrefix ? `${pathPrefix}/${seg}` : seg;
    await walkCarpetaZip(child.id, next, diasById, childrenMap, usedPaths, out);
  }
}

async function collectCarpetaZipEntries(rootDiaId) {
  const rootRows = await db.query('SELECT * FROM sop_dias WHERE id = ?', [rootDiaId]);
  const root = rootRows[0];
  if (!root) throw new Error('Carpeta no encontrada');

  const allDias = await db.query('SELECT * FROM sop_dias WHERE periodo_id = ?', [root.periodo_id]);
  const diasById = new Map(allDias.map((d) => [d.id, d]));
  const childrenMap = buildDiaChildrenMap(allDias);
  const usedPaths = new Set();
  const entries = [];

  if (!root.es_contenedor) {
    await collectLeafDiaZipEntries(root, '', usedPaths, entries);
  } else {
    await walkCarpetaZip(rootDiaId, '', diasById, childrenMap, usedPaths, entries);
  }

  return filterValidZipEntries(entries);
}

async function streamCarpetaZip(res, rootDia) {
  const entries = await collectCarpetaZipEntries(rootDia.id);
  if (!entries.length) {
    throw new Error('La carpeta no tiene archivos para descargar');
  }
  const zipLabel = zipArchiveSegment(rootDia.nombre_display || `carpeta-${rootDia.id}`);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${zipLabel}.zip"`);
  res.setHeader('Cache-Control', 'no-store');
  await pipeArchiveToResponse(res, entries);
}

async function collectContenedorZipEntries(contenedorId, usedPaths = null) {
  const contRows = await db.query(
    `SELECT c.*, d.nombre_display AS dia_nombre, d.estado_facturacion, p.periodo, p.etiqueta AS periodo_etiqueta
     FROM sop_contenedores c
     JOIN sop_dias d ON d.id = c.dia_id
     JOIN sop_periodos p ON p.id = d.periodo_id
     WHERE c.id = ?`,
    [contenedorId]
  );
  const cont = contRows[0];
  if (!cont) throw new Error('Contenedor no encontrado');

  const expedientes = await db.query(
    `SELECT e.id, e.codigo, e.carpeta_fisica, e.numero_factura, e.paciente_nombre
     FROM sop_expedientes e
     WHERE e.contenedor_id = ?
     ORDER BY e.codigo ASC`,
    [contenedorId]
  );

  const entries = [];
  const prefixRoot = cont.tipo === 'rips' ? 'RIPS' : 'SOPORTES';
  const ctx = {
    periodo: cont.periodo_etiqueta || cont.periodo,
    periodo_etiqueta: cont.periodo_etiqueta,
    nombre_display: cont.dia_nombre,
    estado_facturacion: cont.estado_facturacion,
    contenedor_tipo: cont.tipo
  };

  for (const exp of expedientes) {
    const codSeg = expedienteZipSegment(exp);
    const zipPrefix = `${prefixRoot}/${codSeg}`;
    const expedienteCtx = {
      codigo: exp.codigo,
      numero_factura: exp.numero_factura,
      paciente_nombre: exp.paciente_nombre,
      nombre_display: cont.dia_nombre
    };
    let part = [];
    if (cont.tipo === 'rips') {
      part = await listRipsArchivoEntries(
        exp.id, zipPrefix, usedPaths, cont.dia_nombre, ctx, exp.codigo, expedienteCtx
      );
    } else {
      part = await listSoportesArchivoEntries(
        exp.id, zipPrefix, usedPaths, cont.dia_nombre, expedienteCtx
      );
    }

    const extras = listExpedienteFolderExtras(ctx, expedienteCarpetaFisicaSegment(exp), zipPrefix, usedPaths, absPathsFromEntries(part));
    if (extras.length) part = part.concat(extras);

    if (!part.length) {
      ensureZipFolderPlaceholder(entries, usedPaths, zipPrefix);
    } else {
      entries.push(...part);
    }
  }

  return filterValidZipEntries(entries);
}

async function collectExpedienteZipEntries(expedienteId) {
  const rows = await db.query(
    `SELECT e.*, c.tipo AS contenedor_tipo, d.nombre_display AS dia_nombre, d.estado_facturacion, p.periodo, p.etiqueta AS periodo_etiqueta
     FROM sop_expedientes e
     JOIN sop_contenedores c ON c.id = e.contenedor_id
     JOIN sop_dias d ON d.id = c.dia_id
     JOIN sop_periodos p ON p.id = d.periodo_id
     WHERE e.id = ?`,
    [expedienteId]
  );
  const exp = rows[0];
  if (!exp) throw new Error('Expediente no encontrado');

  const expedienteCtx = {
    codigo: exp.codigo,
    numero_factura: exp.numero_factura,
    paciente_nombre: exp.paciente_nombre,
    nombre_display: exp.dia_nombre
  };
  const entries = [];
  const prefixRoot = exp.contenedor_tipo === 'rips' ? 'RIPS' : 'SOPORTES';
  const codSeg = expedienteZipSegment(exp);
  const zipPrefix = `${prefixRoot}/${codSeg}`;
  const ctx = {
    periodo: exp.periodo_etiqueta || exp.periodo,
    periodo_etiqueta: exp.periodo_etiqueta,
    nombre_display: exp.dia_nombre,
    estado_facturacion: exp.estado_facturacion,
    contenedor_tipo: exp.contenedor_tipo
  };
  let part = [];
  if (exp.contenedor_tipo === 'rips') {
    part = await listRipsArchivoEntries(
      exp.id, zipPrefix, null, exp.dia_nombre, ctx, exp.codigo, expedienteCtx
    );
  } else {
    part = await listSoportesArchivoEntries(
      exp.id, zipPrefix, null, exp.dia_nombre, expedienteCtx
    );
  }
  const extras = listExpedienteFolderExtras(ctx, expedienteCarpetaFisicaSegment(exp), zipPrefix, null, absPathsFromEntries(part));
  entries.push(...part, ...extras);
  return filterValidZipEntries(entries);
}

async function collectPeriodFacturadosEntries(periodoId) {
  const expedientes = await db.query(
    `SELECT e.id, e.codigo, e.carpeta_fisica, e.numero_factura, e.paciente_nombre, d.nombre_display AS dia_nombre, c.tipo AS contenedor_tipo
     FROM sop_expedientes e
     JOIN sop_contenedores c ON c.id = e.contenedor_id
     JOIN sop_dias d ON d.id = c.dia_id
     WHERE d.periodo_id = ? AND d.estado_facturacion = 'facturados'
     ORDER BY d.nombre_display ASC, c.tipo ASC, e.codigo ASC`,
    [periodoId]
  );
  const entries = [];
  for (const exp of expedientes) {
    const diaSeg = zipArchiveSegment(exp.dia_nombre);
    const tipoSeg = exp.contenedor_tipo === 'rips' ? 'RIPS' : 'SOPORTES';
    const codSeg = zipArchiveSegment(exp.codigo);
    const prefix = `${diaSeg}/${tipoSeg}/${codSeg}`;
    const expedienteCtx = {
      codigo: exp.codigo,
      numero_factura: exp.numero_factura,
      paciente_nombre: exp.paciente_nombre,
      nombre_display: exp.dia_nombre
    };
    const archivos = await db.query('SELECT * FROM sop_exp_archivos WHERE expediente_id = ?', [exp.id]);
    for (const a of archivos) {
      const fp = resolverArchivoExpedienteRow(a, expedienteCtx);
      if (fp) entries.push({ absPath: fp, name: `${prefix}/${a.nombre_archivo}` });
    }
    try {
      const ripsArchivos = await db.query('SELECT * FROM sop_rips_archivos WHERE expediente_id = ?', [exp.id]);
      for (const a of ripsArchivos) {
        const fp = resolverArchivoExpedienteRow(a, expedienteCtx);
        if (fp) entries.push({ absPath: fp, name: `${prefix}/${a.nombre_archivo}` });
      }
    } catch (_) { /* ignore */ }
  }
  return filterValidZipEntries(entries);
}

async function yieldEventLoop() {
  await new Promise((resolve) => setImmediate(resolve));
}

module.exports = {
  zipArchiveSegment,
  facturaFolderName,
  expedienteZipSegment,
  listExpedienteFolderExtras,
  getSopZipWorkDir,
  createArchiverInstance,
  bindArchiveStreamGuards,
  collectDiaZipEntries,
  collectCarpetaZipEntries,
  collectContenedorZipEntries,
  collectExpedienteZipEntries,
  collectPeriodFacturadosEntries,
  collectPeriodUnifiedEntries,
  collectPeriodPaqueteFlatEntries,
  createZipBuffer,
  buildPeriodPaqueteParts,
  queryDiasFacturacionZip,
  appendInnerZipToArchive,
  appendEntriesToArchive,
  appendEntriesToArchiveAsync,
  loadArchivosByExpedienteIds,
  loadRipsArchivosByExpedienteIds,
  pipeArchiveToResponse,
  pipeArchiveToFile,
  filterValidZipEntries,
  yieldEventLoop,
  zipEntryOptions,
  safeSyncRipsPeriodo,
  streamDiaZip,
  streamCarpetaZip,
  streamPeriodPaqueteZip,
  streamUnifiedPeriodZip
};
