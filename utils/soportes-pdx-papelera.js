/**
 * Papelera de Cargar Reportes (PDX): mueve PDF en vez de borrarlos,
 * cataloga huérfanos en disco y extrae copias desde backups.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const yauzl = require('yauzl');
const db = require('./db-mysql');
const logger = require('./logger');
const { insertRowId } = require('./db-insert-id');
const storage = require('./soportes-storage');
const {
  getPdxDir,
  ensureDir,
  relativeToSoportes,
  relativePdxRuta,
  resolveStoragePath,
  stripMulterTimestamp
} = storage;

function pdxRootAbs() {
  return path.join(storage.soportesRoot, 'pdx');
}
const {
  parseNombrePorCarpeta,
  normalizarNombreBusqueda
} = require('./soportes-pdx-parse');
const { ensureMetaPacienteNombre } = require('./soportes-pdx-upload');
const { cuentaReferenciasRutaPdx } = require('./soportes-pdx-duplicados');

const PAPELERA_DIR_NAME = '_papelera';
const RE_ZIP_PDX = /^uploads\/soportes\/pdx\/(\d+)\/([^/]+\.pdf)$/i;
const MAX_BACKUPS_POR_ESCANEO = 6;
const MAX_EXTRACT_POR_ESCANEO = 40;

function nuevoUuid() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : crypto.randomBytes(16).toString('hex');
}

function getPapeleraRoot() {
  const dir = path.join(pdxRootAbs(), PAPELERA_DIR_NAME);
  ensureDir(dir);
  return dir;
}

function getPapeleraItemDir(uuid) {
  const dir = path.join(getPapeleraRoot(), String(uuid));
  ensureDir(dir);
  return dir;
}

function claveArchivo(carpetaId, basename) {
  return `${carpetaId || 0}|${String(basename || '').toLowerCase()}`;
}

function parseEntradaBackupPdx(entryName) {
  const n = String(entryName || '').replace(/\\/g, '/');
  const m = n.match(RE_ZIP_PDX);
  if (!m) return null;
  const carpetaId = parseInt(m[1], 10);
  if (!carpetaId) return null;
  return { carpetaId, basename: m[2], entryName: n };
}

function moverOCopiar(src, dest, { copy = false } = {}) {
  ensureDir(path.dirname(dest));
  if (copy) {
    fs.copyFileSync(src, dest);
    return dest;
  }
  try {
    fs.renameSync(src, dest);
  } catch (e) {
    if (e.code !== 'EXDEV') throw e;
    fs.copyFileSync(src, dest);
    fs.unlinkSync(src);
  }
  return dest;
}

function archivoExiste(rutaRelativa) {
  if (!rutaRelativa) return false;
  const abs = path.isAbsolute(rutaRelativa)
    ? rutaRelativa
    : resolveStoragePath(rutaRelativa);
  return !!(abs && fs.existsSync(abs) && fs.statSync(abs).size > 0);
}

function metaDesdeNombre(basename, carpeta) {
  const limpio = stripMulterTimestamp(basename) || basename;
  let parsed;
  try {
    parsed = parseNombrePorCarpeta(limpio, carpeta || { nombre_display: carpeta?.nombre_display || '' }, []);
  } catch (_) {
    parsed = { ok: false };
  }
  if (parsed && parsed.ok) {
    return ensureMetaPacienteNombre({ ...parsed, nombre_archivo_display: parsed.nombre_display || limpio }, limpio);
  }
  const nombre = String(limpio).replace(/\.pdf$/i, '') || 'Paciente';
  return ensureMetaPacienteNombre({
    apellidos: null,
    nombres: null,
    paciente_nombre: nombre,
    paciente_nombre_norm: normalizarNombreBusqueda(nombre),
    paciente_documento: null,
    fecha_estudio: null,
    marca_tiempo: null,
    sufijo_numero: null,
    estudio_texto: null,
    nombre_archivo_display: limpio
  }, limpio);
}

async function yaEstaEnPapelera(carpetaId, basename) {
  const rows = await db.query(
    `SELECT id FROM sop_pdx_papelera
     WHERE recuperado_en IS NULL
       AND carpeta_id <=> ?
       AND LOWER(nombre_archivo_original) = LOWER(?)
     LIMIT 1`,
    [carpetaId || null, String(basename || '')]
  );
  return rows[0]?.id || null;
}

async function insertarPapelera(row) {
  const result = await db.execute(
    `INSERT INTO sop_pdx_papelera (
       archivo_id_origen, carpeta_id, carpeta_periodo, carpeta_nombre, carpeta_color_tema, carpeta_roles_visibles,
       apellidos, nombres, paciente_nombre, paciente_nombre_norm, paciente_documento,
       fecha_estudio, marca_tiempo, sufijo_numero, estudio_texto,
       nombre_archivo_original, nombre_archivo_display, ruta_relativa_origen, ruta_papelera,
       mime_type, tamano_bytes, subido_por, eliminado_por, origen, snapshot_json
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      row.archivo_id_origen || null,
      row.carpeta_id || null,
      row.carpeta_periodo || null,
      row.carpeta_nombre || null,
      row.carpeta_color_tema || null,
      row.carpeta_roles_visibles || null,
      row.apellidos || null,
      row.nombres || null,
      row.paciente_nombre,
      row.paciente_nombre_norm,
      row.paciente_documento || null,
      row.fecha_estudio || null,
      row.marca_tiempo || null,
      row.sufijo_numero || null,
      row.estudio_texto || null,
      String(row.nombre_archivo_original || 'archivo.pdf').slice(0, 255),
      row.nombre_archivo_display || null,
      row.ruta_relativa_origen || null,
      row.ruta_papelera,
      row.mime_type || 'application/pdf',
      Number(row.tamano_bytes) || 0,
      row.subido_por || null,
      row.eliminado_por || null,
      row.origen || 'eliminacion',
      row.snapshot_json || null
    ]
  );
  return insertRowId(result);
}

function snapshotDesdeFilas(archivo, carpeta) {
  const meta = ensureMetaPacienteNombre({
    apellidos: archivo.apellidos,
    nombres: archivo.nombres,
    paciente_nombre: archivo.paciente_nombre,
    paciente_nombre_norm: archivo.paciente_nombre_norm,
    paciente_documento: archivo.paciente_documento,
    fecha_estudio: archivo.fecha_estudio,
    marca_tiempo: archivo.marca_tiempo,
    sufijo_numero: archivo.sufijo_numero,
    estudio_texto: archivo.estudio_texto,
    nombre_archivo_display: archivo.nombre_archivo_display
  }, archivo.nombre_archivo_original || archivo.nombre_archivo_display || 'archivo.pdf');
  return {
    ...meta,
    archivo_id_origen: archivo.id || null,
    carpeta_id: archivo.carpeta_id || carpeta?.id || null,
    carpeta_periodo: carpeta?.periodo || null,
    carpeta_nombre: carpeta?.nombre_display || null,
    carpeta_color_tema: carpeta?.color_tema || null,
    carpeta_roles_visibles: carpeta?.roles_visibles || null,
    nombre_archivo_original: archivo.nombre_archivo_original || path.basename(String(archivo.ruta_relativa || 'archivo.pdf')),
    ruta_relativa_origen: archivo.ruta_relativa || null,
    mime_type: archivo.mime_type || 'application/pdf',
    tamano_bytes: archivo.tamano_bytes || 0,
    subido_por: archivo.subido_por || null,
    snapshot_json: JSON.stringify({
      archivo: { ...archivo },
      carpeta: carpeta ? { id: carpeta.id, periodo: carpeta.periodo, nombre_display: carpeta.nombre_display, color_tema: carpeta.color_tema } : null
    }).slice(0, 65000)
  };
}

/**
 * Envía un archivo PDX a la papelera (copia o mueve el PDF) y deja listo
 * el INSERT. No borra la fila activa: eso lo hace el caller.
 */
async function enviarArchivoAPapelera({ archivo, carpeta, usuarioId, origen = 'eliminacion' }) {
  const basename = path.basename(String(archivo.ruta_relativa || archivo.nombre_archivo_display || archivo.nombre_archivo_original || 'archivo.pdf'));
  const existente = await yaEstaEnPapelera(archivo.carpeta_id, basename);
  if (existente) return { id: existente, ya_estaba: true };

  const snap = snapshotDesdeFilas(archivo, carpeta);
  const uuid = nuevoUuid();
  const destDir = getPapeleraItemDir(uuid);
  const destAbs = path.join(destDir, basename);
  let rutaPapelera = relativeToSoportes(destAbs) || path.join('soportes', 'pdx', PAPELERA_DIR_NAME, uuid, basename).replace(/\\/g, '/');

  let srcAbs = resolveStoragePath(archivo.ruta_relativa);
  if ((!srcAbs || !fs.existsSync(srcAbs)) && archivo.carpeta_id) {
    const candidate = path.join(pdxRootAbs(), String(archivo.carpeta_id), basename);
    if (fs.existsSync(candidate)) srcAbs = candidate;
  }
  const refs = archivo.carpeta_id && archivo.ruta_relativa
    ? await cuentaReferenciasRutaPdx(db, archivo.carpeta_id, archivo.ruta_relativa, archivo.id || null)
    : 0;
  const srcOk = srcAbs && fs.existsSync(srcAbs);

  if (srcOk) {
    moverOCopiar(srcAbs, destAbs, { copy: true });
    try { snap.tamano_bytes = fs.statSync(destAbs).size; } catch (_) { /* ignore */ }
  } else {
    rutaPapelera = '';
  }

  const id = await insertarPapelera({
    ...snap,
    ruta_papelera: rutaPapelera,
    eliminado_por: usuarioId || null,
    origen
  });
  if (srcOk && refs === 0) {
    try { fs.unlinkSync(srcAbs); } catch (e) {
      logger.warn('[PAPELERA PDX] no se pudo quitar el original tras copiar a papelera', { message: e.message });
    }
  }
  return { id, movido: srcOk, ruta_papelera: rutaPapelera };
}

function listarDirsCarpetaPdxEnDisco() {
  const root = pdxRootAbs();
  if (!fs.existsSync(root)) return [];
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^\d+$/.test(d.name))
      .map((d) => d.name);
  } catch (_) {
    return [];
  }
}

function listarPdfsEnDir(absDir) {
  try {
    return fs.readdirSync(absDir).filter((f) => f.toLowerCase().endsWith('.pdf'));
  } catch (_) {
    return [];
  }
}

async function clavesActivasPdx() {
  const set = new Set();
  const rows = await db.query(
    'SELECT carpeta_id, ruta_relativa, nombre_archivo_original, nombre_archivo_display FROM sop_pdx_archivos'
  ).catch(() => []);
  for (const r of rows) {
    const names = [
      path.basename(String(r.ruta_relativa || '')),
      r.nombre_archivo_original,
      r.nombre_archivo_display
    ].filter(Boolean);
    for (const n of names) set.add(claveArchivo(r.carpeta_id, n));
  }
  return set;
}

async function escanearHuerfanosDisco() {
  const activos = await clavesActivasPdx();
  const dirs = listarDirsCarpetaPdxEnDisco();
  let catalogados = 0;
  const errores = [];

  const carpetasById = new Map();
  const carpetaRows = await db.query('SELECT * FROM sop_pdx_carpetas').catch(() => []);
  for (const c of carpetaRows) carpetasById.set(Number(c.id), c);

  for (const dirName of dirs) {
    const carpetaId = parseInt(dirName, 10);
    const absDir = path.join(pdxRootAbs(), dirName);
    const pdfs = listarPdfsEnDir(absDir);
    const carpeta = carpetasById.get(carpetaId) || {
      id: carpetaId,
      periodo: null,
      nombre_display: `Carpeta #${carpetaId}`,
      color_tema: null
    };
    for (const pdf of pdfs) {
      const key = claveArchivo(carpetaId, pdf);
      if (activos.has(key)) continue;
      if (await yaEstaEnPapelera(carpetaId, pdf)) continue;
      try {
        const abs = path.join(absDir, pdf);
        const rel = relativePdxRuta(carpetaId, pdf);
        const st = fs.statSync(abs);
        const meta = metaDesdeNombre(pdf, carpeta);
        await insertarPapelera({
          ...meta,
          archivo_id_origen: null,
          carpeta_id: carpetaId,
          carpeta_periodo: carpeta.periodo || null,
          carpeta_nombre: carpeta.nombre_display || `Carpeta #${carpetaId}`,
          carpeta_color_tema: carpeta.color_tema || null,
          carpeta_roles_visibles: carpeta.roles_visibles || null,
          nombre_archivo_original: pdf,
          ruta_relativa_origen: rel,
          ruta_papelera: rel,
          tamano_bytes: st.size || 0,
          origen: 'huerfano_disco',
          snapshot_json: JSON.stringify({ disco: rel, carpeta_id: carpetaId })
        });
        catalogados += 1;
      } catch (e) {
        errores.push({ archivo: pdf, carpeta_id: carpetaId, error: e.message });
        logger.warn('[PAPELERA PDX] huérfano disco', { pdf, carpetaId, message: e.message });
      }
    }
  }
  return { catalogados, errores };
}

function listarEntradasPdxZip(zipPath) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err);
      const found = [];
      zipfile.readEntry();
      zipfile.on('entry', (entry) => {
        const parsed = parseEntradaBackupPdx(entry.fileName);
        if (parsed) found.push({ ...parsed, uncompressedSize: entry.uncompressedSize });
        zipfile.readEntry();
      });
      zipfile.on('end', () => resolve(found));
      zipfile.on('error', reject);
    });
  });
}

function extraerEntradasPdxDeZip(zipPath, destinosPorEntry) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err);
      const extraidos = [];
      const errores = [];
      zipfile.readEntry();
      zipfile.on('entry', (entry) => {
        const name = String(entry.fileName || '').replace(/\\/g, '/');
        const dest = destinosPorEntry.get(name);
        if (!dest) {
          zipfile.readEntry();
          return;
        }
        zipfile.openReadStream(entry, (streamErr, readStream) => {
          if (streamErr) {
            errores.push({ entry: name, error: streamErr.message });
            zipfile.readEntry();
            return;
          }
          try { fs.mkdirSync(path.dirname(dest), { recursive: true }); } catch (e) {
            errores.push({ entry: name, error: e.message });
            zipfile.readEntry();
            return;
          }
          const tmp = `${dest}.tmp-${process.pid}`;
          const ws = fs.createWriteStream(tmp);
          readStream.on('error', (e) => {
            errores.push({ entry: name, error: e.message });
            try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
            zipfile.readEntry();
          });
          ws.on('error', (e) => {
            errores.push({ entry: name, error: e.message });
            try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
            zipfile.readEntry();
          });
          ws.on('close', () => {
            try {
              fs.renameSync(tmp, dest);
              extraidos.push({ entry: name, dest });
            } catch (e) {
              errores.push({ entry: name, error: e.message });
            }
            zipfile.readEntry();
          });
          readStream.pipe(ws);
        });
      });
      zipfile.on('end', () => resolve({ extraidos, errores }));
      zipfile.on('error', reject);
    });
  });
}

async function escanearBackupsPdx({ maxBackups = MAX_BACKUPS_POR_ESCANEO, maxExtract = MAX_EXTRACT_POR_ESCANEO } = {}) {
  const {
    listAllBackupsNewestFirst,
    resolveAnyBackupPath
  } = require('./soportes-backup-restore');
  const backups = listAllBackupsNewestFirst().slice(0, maxBackups);
  if (!backups.length) {
    return { catalogados: 0, revisados: 0, pendientes: 0, backups: 0, mensaje: 'No hay copias de seguridad para revisar' };
  }

  const activos = await clavesActivasPdx();
  const wanted = new Map();

  for (const b of backups) {
    const zipPath = resolveAnyBackupPath(b.filename);
    if (!zipPath || !fs.existsSync(zipPath)) continue;
    let entradas = [];
    try {
      entradas = await listarEntradasPdxZip(zipPath);
    } catch (e) {
      logger.warn('[PAPELERA PDX] no se pudo leer backup', { file: b.filename, message: e.message });
      continue;
    }
    for (const ent of entradas) {
      const key = claveArchivo(ent.carpetaId, ent.basename);
      if (activos.has(key) || wanted.has(key)) continue;
      if (await yaEstaEnPapelera(ent.carpetaId, ent.basename)) continue;
      wanted.set(key, { ...ent, backupFilename: b.filename, zipPath });
    }
  }

  const lista = [...wanted.values()];
  const lote = lista.slice(0, maxExtract);
  const pendientes = Math.max(0, lista.length - lote.length);
  let catalogados = 0;
  const errores = [];

  const porZip = new Map();
  for (const item of lote) {
    const uuid = nuevoUuid();
    const destAbs = path.join(getPapeleraItemDir(uuid), item.basename);
    if (!porZip.has(item.zipPath)) porZip.set(item.zipPath, { destinos: new Map(), items: [] });
    const bucket = porZip.get(item.zipPath);
    bucket.destinos.set(item.entryName, destAbs);
    bucket.items.push({ ...item, destAbs, uuid });
  }

  const carpetasById = new Map();
  const carpetaRows = await db.query('SELECT * FROM sop_pdx_carpetas').catch(() => []);
  for (const c of carpetaRows) carpetasById.set(Number(c.id), c);

  for (const [zipPath, bucket] of porZip.entries()) {
    let result;
    try {
      result = await extraerEntradasPdxDeZip(zipPath, bucket.destinos);
    } catch (e) {
      errores.push({ backup: zipPath, error: e.message });
      continue;
    }
    const okDest = new Set(result.extraidos.map((x) => x.dest));
    for (const item of bucket.items) {
      if (!okDest.has(item.destAbs)) continue;
      try {
        const carpeta = carpetasById.get(item.carpetaId) || {
          id: item.carpetaId,
          periodo: null,
          nombre_display: `Carpeta #${item.carpetaId}`,
          color_tema: null
        };
        const meta = metaDesdeNombre(item.basename, carpeta);
        const relPap = relativeToSoportes(item.destAbs)
          || path.join('soportes', 'pdx', PAPELERA_DIR_NAME, item.uuid, item.basename).replace(/\\/g, '/');
        let tamano = 0;
        try { tamano = fs.statSync(item.destAbs).size; } catch (_) { /* ignore */ }
        await insertarPapelera({
          ...meta,
          carpeta_id: item.carpetaId,
          carpeta_periodo: carpeta.periodo || null,
          carpeta_nombre: carpeta.nombre_display,
          carpeta_color_tema: carpeta.color_tema || null,
          carpeta_roles_visibles: carpeta.roles_visibles || null,
          nombre_archivo_original: item.basename,
          ruta_relativa_origen: relativePdxRuta(item.carpetaId, item.basename),
          ruta_papelera: relPap,
          tamano_bytes: tamano,
          origen: 'backup',
          snapshot_json: JSON.stringify({ backup: item.backupFilename, entry: item.entryName })
        });
        catalogados += 1;
      } catch (e) {
        errores.push({ archivo: item.basename, error: e.message });
      }
    }
    errores.push(...(result.errores || []).map((e) => ({ backup: path.basename(zipPath), ...e })));
  }

  return {
    catalogados,
    revisados: lote.length,
    pendientes,
    backups: backups.length,
    errores: errores.slice(0, 20),
    mensaje: pendientes
      ? `Se catalogaron ${catalogados}. Quedan ${pendientes} en backups; pulse de nuevo «Buscar en copias de seguridad».`
      : (catalogados ? `Se recuperaron ${catalogados} archivo(s) desde copias de seguridad.` : 'No se encontraron archivos eliminados en las copias de seguridad.')
  };
}

async function listarPapelera() {
  await escanearHuerfanosDisco().catch((e) => {
    logger.warn('[PAPELERA PDX] escaneo disco:', e.message);
  });
  const rows = await db.query(
    `SELECT p.*, u.nombre AS eliminado_por_nombre
     FROM sop_pdx_papelera p
     LEFT JOIN usuarios u ON u.id = p.eliminado_por
     WHERE p.recuperado_en IS NULL
     ORDER BY p.eliminado_en DESC, p.id DESC
     LIMIT 2000`
  );
  return rows.map((r) => ({
    ...r,
    archivo_disponible: archivoExiste(r.ruta_papelera)
  }));
}

async function obtenerPapelera(id) {
  const rows = await db.query('SELECT * FROM sop_pdx_papelera WHERE id = ?', [id]);
  return rows[0] || null;
}

function periodoActualYYYYMM() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

async function resolverCarpetaDestino(item, usuarioId) {
  if (item.carpeta_id) {
    const rows = await db.query('SELECT * FROM sop_pdx_carpetas WHERE id = ?', [item.carpeta_id]);
    if (rows[0]) return rows[0];
  }
  const periodo = item.carpeta_periodo || periodoActualYYYYMM();
  const nombre = String(item.carpeta_nombre || '').trim() || `Recuperados ${periodo}`;
  const porNombre = await db.query(
    'SELECT * FROM sop_pdx_carpetas WHERE periodo = ? AND nombre_display = ? LIMIT 1',
    [periodo, nombre]
  );
  if (porNombre[0]) return porNombre[0];

  const { detectarTemaCarpeta } = require('./soportes-temas');
  const { calcularVisibilidadPeriodo } = require('./soportes-visibilidad');
  const tema = item.carpeta_color_tema || detectarTemaCarpeta(nombre);
  const vis = calcularVisibilidadPeriodo(periodo);
  const ins = await db.execute(
    `INSERT INTO sop_pdx_carpetas (periodo, nombre_display, color_tema, roles_visibles, estado_visibilidad, creado_por)
     VALUES (?, ?, ?, NULL, ?, ?)`,
    [periodo, nombre, tema, vis, usuarioId || null]
  );
  const id = insertRowId(ins);
  const created = await db.query('SELECT * FROM sop_pdx_carpetas WHERE id = ?', [id]);
  return created[0];
}

async function insertarArchivoActivo(carpetaId, item, rutaRelativa, tamano) {
  const meta = ensureMetaPacienteNombre({
    apellidos: item.apellidos,
    nombres: item.nombres,
    paciente_nombre: item.paciente_nombre,
    paciente_nombre_norm: item.paciente_nombre_norm,
    paciente_documento: item.paciente_documento,
    fecha_estudio: item.fecha_estudio,
    marca_tiempo: item.marca_tiempo,
    sufijo_numero: item.sufijo_numero,
    estudio_texto: item.estudio_texto,
    nombre_archivo_display: item.nombre_archivo_display,
    ruta_relativa: rutaRelativa
  }, item.nombre_archivo_original);
  const result = await db.execute(
    `INSERT INTO sop_pdx_archivos (
        carpeta_id, apellidos, nombres, paciente_nombre, paciente_nombre_norm, paciente_documento,
        fecha_estudio, marca_tiempo, sufijo_numero, estudio_texto, nombre_archivo_original,
        nombre_archivo_display, ruta_relativa, tamano_bytes, subido_por
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      carpetaId,
      meta.apellidos || null,
      meta.nombres || null,
      meta.paciente_nombre,
      meta.paciente_nombre_norm,
      meta.paciente_documento || null,
      meta.fecha_estudio || null,
      meta.marca_tiempo || null,
      meta.sufijo_numero || null,
      meta.estudio_texto || null,
      String(item.nombre_archivo_original || 'archivo.pdf').slice(0, 255),
      meta.nombre_archivo_display,
      rutaRelativa,
      Number(tamano) || 0,
      item.subido_por || null
    ]
  );
  return insertRowId(result);
}

async function recuperarItemPapelera(id, usuarioId) {
  const item = await obtenerPapelera(id);
  if (!item) {
    const err = new Error('No está en la papelera');
    err.status = 404;
    throw err;
  }
  if (item.recuperado_en) {
    const err = new Error('Este archivo ya fue recuperado');
    err.status = 409;
    throw err;
  }

  let srcAbs = item.ruta_papelera ? resolveStoragePath(item.ruta_papelera) : null;
  if (!srcAbs || !fs.existsSync(srcAbs)) {
    const fallback = await extraerUnoDesdeBackup(item);
    srcAbs = fallback;
  }
  if (!srcAbs || !fs.existsSync(srcAbs)) {
    const err = new Error('El archivo físico no está disponible (no quedó en disco ni en copias de seguridad)');
    err.status = 404;
    throw err;
  }

  const carpeta = await resolverCarpetaDestino(item, usuarioId);
  const destDir = getPdxDir(carpeta.id);
  const baseOrig = path.basename(item.nombre_archivo_original || item.ruta_papelera || 'archivo.pdf');
  const destNatural = path.join(destDir, baseOrig);
  const mismaUbicacion = path.resolve(srcAbs) === path.resolve(destNatural);
  let destName = baseOrig;
  let destAbs = destNatural;
  if (!mismaUbicacion) {
    if (fs.existsSync(destNatural)) {
      destName = `${Date.now()}-${baseOrig}`;
      destAbs = path.join(destDir, destName);
    }
    fs.copyFileSync(srcAbs, destAbs);
  }
  const tamano = fs.statSync(destAbs).size;
  const rel = relativePdxRuta(carpeta.id, destName);
  const newId = await insertarArchivoActivo(carpeta.id, item, rel, tamano);
  await db.execute(
    'UPDATE sop_pdx_papelera SET recuperado_en = NOW(), recuperado_por = ? WHERE id = ?',
    [usuarioId || null, id]
  );
  if (!mismaUbicacion && item.origen !== 'huerfano_disco') {
    try { fs.unlinkSync(srcAbs); } catch (_) { /* keep trash copy if unlink fails */ }
  }
  return { archivo_id: newId, carpeta_id: carpeta.id, carpeta_nombre: carpeta.nombre_display };
}

async function extraerUnoDesdeBackup(item) {
  const carpetaId = item.carpeta_id;
  const basename = path.basename(item.nombre_archivo_original || item.ruta_relativa_origen || '');
  if (!carpetaId || !basename) return null;
  const {
    listAllBackupsNewestFirst,
    resolveAnyBackupPath
  } = require('./soportes-backup-restore');
  for (const b of listAllBackupsNewestFirst().slice(0, MAX_BACKUPS_POR_ESCANEO)) {
    const zipPath = resolveAnyBackupPath(b.filename);
    if (!zipPath || !fs.existsSync(zipPath)) continue;
    let entradas = [];
    try { entradas = await listarEntradasPdxZip(zipPath); } catch (_) { continue; }
    const match = entradas.find((e) => e.carpetaId === Number(carpetaId) && String(e.basename).toLowerCase() === basename.toLowerCase());
    if (!match) continue;
    const uuid = nuevoUuid();
    const destAbs = path.join(getPapeleraItemDir(uuid), basename);
    const destinos = new Map([[match.entryName, destAbs]]);
    const result = await extraerEntradasPdxDeZip(zipPath, destinos);
    if (result.extraidos.length) {
      const rel = relativeToSoportes(destAbs);
      if (rel) {
        await db.execute('UPDATE sop_pdx_papelera SET ruta_papelera = ? WHERE id = ?', [rel, item.id]).catch(() => {});
      }
      return destAbs;
    }
  }
  return null;
}

function absPapelera(item) {
  if (!item?.ruta_papelera) return null;
  const abs = resolveStoragePath(item.ruta_papelera);
  if (abs && fs.existsSync(abs)) return abs;
  return null;
}

module.exports = {
  PAPELERA_DIR_NAME,
  claveArchivo,
  parseEntradaBackupPdx,
  metaDesdeNombre,
  enviarArchivoAPapelera,
  escanearHuerfanosDisco,
  escanearBackupsPdx,
  listarPapelera,
  obtenerPapelera,
  recuperarItemPapelera,
  absPapelera,
  archivoExiste
};
