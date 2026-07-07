/**
 * Archivo de módulos Soportes / Reportes PDX / Anexo FIDU:
 * respaldo ZIP al pasar a estado «archivo» y registro en sop_modulo_archivo.
 */
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const db = require('./db-mysql');
const logger = require('./logger');
const { BACKUP_DIR, ensureBackupDir } = require('./backup');
const { calcularVisibilidadPeriodo } = require('./soportes-visibilidad');

function visKey(modulo, refId) {
  return `${modulo}:${refId}`;
}

function normalizeEtiquetaArchivo(s) {
  return String(s || '').trim().toUpperCase().replace(/\s+/g, ' ');
}

function etiquetasArchivoCoinciden(a, b) {
  const na = normalizeEtiquetaArchivo(a);
  const nb = normalizeEtiquetaArchivo(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  return na.includes(nb) || nb.includes(na);
}

function emptyVisibleCtx() {
  return { byRef: new Set(), armadoPeriodos: new Set(), pdxPeriodos: new Set(), anexoRefs: new Set(), armadoEtiquetas: new Set() };
}

async function loadVisibleEnSoportesCtx() {
  try {
    const rows = await db.query(
      'SELECT modulo, ref_id, periodo, etiqueta FROM sop_modulo_archivo WHERE visible_en_soportes = 1'
    );
    const ctx = emptyVisibleCtx();
    for (const r of rows) {
      ctx.byRef.add(visKey(r.modulo, r.ref_id));
      if (r.modulo === 'armado') {
        if (r.periodo) ctx.armadoPeriodos.add(r.periodo);
        if (r.etiqueta) ctx.armadoEtiquetas.add(normalizeEtiquetaArchivo(r.etiqueta));
      }
      if (r.modulo === 'pdx' && r.periodo) {
        ctx.pdxPeriodos.add(r.periodo);
        ctx.byRef.add(visKey('pdx', periodoToRefId(r.periodo)));
      }
      if (r.modulo === 'anexo') ctx.anexoRefs.add(r.ref_id);
    }
    return ctx;
  } catch (e) {
    if (e.code === 'ER_NO_SUCH_TABLE' || /visible_en_soportes|sop_modulo_archivo/i.test(String(e.message || ''))) {
      return emptyVisibleCtx();
    }
    throw e;
  }
}

/** @deprecated alias — use loadVisibleEnSoportesCtx */
async function loadVisibleEnSoportesSet() {
  return loadVisibleEnSoportesCtx();
}

function resolveVisibilidadPeriodo(periodo, modulo, refId, ctx, etiqueta = null) {
  const calc = calcularVisibilidadPeriodo(periodo);
  if (calc !== 'archivo') return calc;
  if (!ctx) return 'archivo';
  if (ctx.byRef && ctx.byRef.has(visKey(modulo, refId))) return 'activa';
  if (modulo === 'armado' && ctx.armadoPeriodos && ctx.armadoPeriodos.has(periodo)) return 'activa';
  if (modulo === 'pdx' && ctx.pdxPeriodos && ctx.pdxPeriodos.has(periodo)) return 'activa';
  if (modulo === 'anexo' && ctx.anexoRefs && ctx.anexoRefs.has(refId)) return 'activa';
  if (modulo === 'armado' && ctx.armadoEtiquetas && etiqueta) {
    const ne = normalizeEtiquetaArchivo(etiqueta);
    if (ctx.armadoEtiquetas.has(ne)) return 'activa';
    for (const ae of ctx.armadoEtiquetas) {
      if (etiquetasArchivoCoinciden(ne, ae)) return 'activa';
    }
  }
  return 'archivo';
}

function resolveVisibilidadArmadoRow(periodoRow, ctx) {
  if (!periodoRow) return 'archivo';
  return resolveVisibilidadPeriodo(
    periodoRow.periodo,
    'armado',
    periodoRow.id,
    ctx,
    periodoRow.etiqueta
  );
}

async function isForcedVisibleEnSoportes(modulo, refId, periodo = null, etiqueta = null) {
  try {
    const rows = await db.query(
      `SELECT etiqueta FROM sop_modulo_archivo
       WHERE visible_en_soportes = 1 AND modulo = ?
         AND (ref_id = ? OR (? IS NOT NULL AND periodo = ?))
       LIMIT 5`,
      [modulo, refId, periodo, periodo]
    );
    if (rows.length) return true;
    if (modulo === 'armado' && etiqueta) {
      const visibles = await db.query(
        `SELECT etiqueta FROM sop_modulo_archivo
         WHERE visible_en_soportes = 1 AND modulo = 'armado' AND etiqueta IS NOT NULL AND etiqueta != ''`
      );
      for (const r of visibles) {
        if (etiquetasArchivoCoinciden(r.etiqueta, etiqueta)) return true;
      }
    }
    return false;
  } catch (e) {
    if (e.code === 'ER_NO_SUCH_TABLE') return false;
    throw e;
  }
}

async function effectiveVisibilidad(modulo, refId, periodo, ctx = null, etiqueta = null) {
  const calc = calcularVisibilidadPeriodo(periodo);
  if (calc !== 'archivo') return calc;
  if (ctx) {
    const resolved = modulo === 'armado' && etiqueta
      ? resolveVisibilidadPeriodo(periodo, modulo, refId, ctx, etiqueta)
      : resolveVisibilidadPeriodo(periodo, modulo, refId, ctx);
    return resolved === 'activa' ? 'activa' : 'archivo';
  }
  return (await isForcedVisibleEnSoportes(modulo, refId, periodo, etiqueta)) ? 'activa' : 'archivo';
}

async function setVisibleEnSoportes(registroId, visible) {
  const rows = await db.query('SELECT * FROM sop_modulo_archivo WHERE id = ? LIMIT 1', [registroId]);
  if (!rows.length) throw new Error('Registro no encontrado');
  const reg = rows[0];

  if (visible && reg.modulo === 'armado') {
    let pr = [];
    if (reg.periodo) {
      pr = await db.query('SELECT id, etiqueta FROM sop_periodos WHERE periodo = ? LIMIT 1', [reg.periodo]);
    }
    if (!pr.length && reg.etiqueta) {
      pr = await db.query(
        'SELECT id, periodo, etiqueta FROM sop_periodos WHERE UPPER(TRIM(etiqueta)) = UPPER(TRIM(?)) LIMIT 1',
        [reg.etiqueta]
      );
    }
    if (pr.length) {
      const p0 = pr[0];
      await db.execute(
        'UPDATE sop_modulo_archivo SET ref_id = ?, periodo = ?, etiqueta = ? WHERE id = ?',
        [p0.id, p0.periodo || reg.periodo, p0.etiqueta || reg.etiqueta, registroId]
      );
    }
  }

  await db.execute(
    'UPDATE sop_modulo_archivo SET visible_en_soportes = ? WHERE id = ?',
    [visible ? 1 : 0, registroId]
  );
  return { visible: !!visible };
}
const { resolvePdxArchivoPath, soportesRoot } = require('./soportes-storage');
const { zipArchiveSegment, createZipBuffer, collectPeriodPaqueteFlatEntries, appendEntriesToArchive, safeSyncRipsPeriodo } = require('./soportes-armado-zip');
const { buildAnexoFiduExcelBuffer } = require('./anexo-fidu-export');

const ARCHIVO_SUBDIR = 'modulo-archivo';
const ZIP_COMPRESSION = 6;

function archivoModuloDir() {
  const dir = path.join(BACKUP_DIR, ARCHIVO_SUBDIR);
  ensureBackupDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function safeArchivoBackupName(name) {
  return String(name || '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .slice(0, 180);
}

function writeZipBufferToFile(buffer, destPath) {
  return new Promise((resolve, reject) => {
    fs.writeFile(destPath, buffer, (err) => (err ? reject(err) : resolve(destPath)));
  });
}

function writeZipFromParts(parts, destPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(destPath);
    const archive = archiver('zip', { zlib: { level: ZIP_COMPRESSION } });
    output.on('close', () => resolve(destPath));
    archive.on('error', reject);
    output.on('error', reject);
    archive.pipe(output);
    for (const part of parts) {
      archive.append(part.buffer, { name: part.name });
    }
    archive.finalize();
  });
}

function writeZipFromEntries(entries, destPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(destPath);
    const archive = archiver('zip', { zlib: { level: 1 } });
    output.on('close', () => resolve(destPath));
    archive.on('error', reject);
    output.on('error', reject);
    archive.pipe(output);
    appendEntriesToArchive(archive, entries);
    archive.finalize();
  });
}

async function yaRegistradoEnArchivo(modulo, refId) {
  const rows = await db.query(
    'SELECT id FROM sop_modulo_archivo WHERE modulo = ? AND ref_id = ? LIMIT 1',
    [modulo, refId]
  );
  return rows.length > 0;
}

async function existeRegistroArchivo(modulo, refId, periodo = null) {
  if (await yaRegistradoEnArchivo(modulo, refId)) return true;
  if (!periodo) return false;
  try {
    const rows = await db.query(
      'SELECT id FROM sop_modulo_archivo WHERE modulo = ? AND periodo = ? LIMIT 1',
      [modulo, periodo]
    );
    return rows.length > 0;
  } catch (e) {
    if (e.code === 'ER_NO_SUCH_TABLE') return false;
    throw e;
  }
}

async function ensureRegistroArchivoArmado(periodoRow, archivadoPor = null) {
  if (!periodoRow?.id || !periodoRow?.periodo) return null;
  if (calcularVisibilidadPeriodo(periodoRow.periodo) !== 'archivo') return null;
  if (await existeRegistroArchivo('armado', periodoRow.id, periodoRow.periodo)) {
    await db.execute(
      `UPDATE sop_modulo_archivo SET ref_id = ?, etiqueta = ?
       WHERE modulo = 'armado' AND periodo = ? AND ref_id != ?`,
      [periodoRow.id, periodoRow.etiqueta || periodoRow.periodo, periodoRow.periodo, periodoRow.id]
    ).catch(() => {});
    return null;
  }
  const id = await insertRegistroArchivo({
    modulo: 'armado',
    periodo: periodoRow.periodo,
    ref_id: periodoRow.id,
    etiqueta: periodoRow.etiqueta || periodoRow.periodo,
    backup_filename: null,
    backup_bytes: null,
    archivado_por: archivadoPor
  });
  return { id };
}

async function ensureRegistroArchivoPdx(periodo, archivadoPor = null) {
  const refId = periodoToRefId(periodo);
  if (!refId || calcularVisibilidadPeriodo(periodo) !== 'archivo') return null;
  if (await existeRegistroArchivo('pdx', refId, periodo)) return null;
  const id = await insertRegistroArchivo({
    modulo: 'pdx',
    periodo,
    ref_id: refId,
    etiqueta: `Reportes ${periodo}`,
    backup_filename: null,
    backup_bytes: null,
    archivado_por: archivadoPor
  });
  return { id };
}

async function syncRegistrosArchivoFaltantes(archivadoPor = null) {
  try {
    const periodos = await db.query('SELECT * FROM sop_periodos');
    for (const p of periodos) {
      if (calcularVisibilidadPeriodo(p.periodo) === 'archivo') {
        await ensureRegistroArchivoArmado(p, archivadoPor);
      }
    }
    const pdxPeriodos = await db.query('SELECT DISTINCT periodo FROM sop_pdx_carpetas WHERE periodo IS NOT NULL');
    for (const row of pdxPeriodos) {
      if (calcularVisibilidadPeriodo(row.periodo) === 'archivo') {
        await ensureRegistroArchivoPdx(row.periodo, archivadoPor);
      }
    }
  } catch (e) {
    if (e.code !== 'ER_NO_SUCH_TABLE') {
      logger.warn('[ARCHIVO-MODULO] sync registros faltantes:', e.message);
    }
  }
}

async function insertRegistroArchivo(row) {
  const result = await db.execute(
    `INSERT INTO sop_modulo_archivo
      (modulo, periodo, ref_id, etiqueta, backup_filename, backup_bytes, archivado_por)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      row.modulo,
      row.periodo || null,
      row.ref_id,
      row.etiqueta,
      row.backup_filename || null,
      row.backup_bytes || null,
      row.archivado_por || null
    ]
  );
  return result.insertId;
}

async function crearBackupZipPdxPeriodo(periodo) {
  const carpetas = await db.query(
    'SELECT id, nombre_display FROM sop_pdx_carpetas WHERE periodo = ? ORDER BY id ASC',
    [periodo]
  );
  const manifest = { modulo: 'pdx', periodo, carpetas: [], archivos: [] };
  const parts = [];

  for (const c of carpetas) {
    const archivos = await db.query('SELECT * FROM sop_pdx_archivos WHERE carpeta_id = ?', [c.id]);
    const seg = zipArchiveSegment(c.nombre_display || `carpeta-${c.id}`);
    manifest.carpetas.push({ id: c.id, nombre_display: c.nombre_display, total: archivos.length });
    const innerEntries = [];
    for (const a of archivos) {
      const fp = resolvePdxArchivoPath(a);
      if (!fp || !fs.existsSync(fp)) continue;
      const fname = a.nombre_archivo_display || a.nombre_archivo_original || path.basename(fp);
      innerEntries.push({ absPath: fp, name: `${seg}/${fname}` });
      manifest.archivos.push({ id: a.id, carpeta_id: c.id, paciente: a.paciente_nombre, archivo: fname });
    }
    if (innerEntries.length) {
      const buf = await createZipBuffer(innerEntries);
      parts.push({ name: `${seg}-reportes.zip`, buffer: buf });
    }
  }

  manifest.carpetas_count = manifest.carpetas.length;
  manifest.archivos_count = manifest.archivos.length;
  const manifestBuf = Buffer.from(JSON.stringify(manifest, null, 2), 'utf8');
  parts.push({ name: 'manifest-pdx.json', buffer: manifestBuf });

  if (!parts.length) {
    parts.push({ name: 'manifest-pdx.json', buffer: manifestBuf });
  }

  const filename = safeArchivoBackupName(`archivo-pdx-${periodo}-${Date.now()}.zip`);
  const destPath = path.join(archivoModuloDir(), filename);
  await writeZipFromParts(parts, destPath);
  const st = fs.statSync(destPath);
  return { filename, filepath: destPath, size_bytes: st.size };
}

async function crearBackupZipArmadoPeriodo(periodoRow) {
  await safeSyncRipsPeriodo(periodoRow.id);
  const entries = await collectPeriodPaqueteFlatEntries(periodoRow.id);
  const manifestBuf = Buffer.from(JSON.stringify({
    modulo: 'armado',
    periodo: periodoRow.periodo,
    periodo_id: periodoRow.id,
    etiqueta: periodoRow.etiqueta,
    archivos: entries.length,
    formato: 'carpetas-por-dia'
  }, null, 2), 'utf8');

  const filename = safeArchivoBackupName(`archivo-armado-${periodoRow.periodo}-${Date.now()}.zip`);
  const destPath = path.join(archivoModuloDir(), filename);
  await writeZipFromEntries([...entries, { placeholder: true, name: 'manifest-armado.json', content: manifestBuf }], destPath);
  const st = fs.statSync(destPath);
  return { filename, filepath: destPath, size_bytes: st.size };
}

async function crearBackupZipAnexoCarpeta(carpetaRow) {
  const archivos = await db.query(
    'SELECT id, nombre FROM anexo_fidu_archivos WHERE carpeta_id = ? ORDER BY id ASC',
    [carpetaRow.id]
  );
  const parts = [];
  for (const arch of archivos) {
    const registros = await db.query(
      'SELECT * FROM anexo_fidu_registros WHERE archivo_id = ? ORDER BY id ASC',
      [arch.id]
    );
    if (!registros.length) continue;
    const buffer = await buildAnexoFiduExcelBuffer(registros, { nombreArchivo: arch.nombre });
    parts.push({
      name: `${zipArchiveSegment(arch.nombre || `anexo-${arch.id}`)}.xlsx`,
      buffer
    });
  }
  const manifestBuf = Buffer.from(JSON.stringify({
    modulo: 'anexo',
    carpeta_id: carpetaRow.id,
    nombre: carpetaRow.nombre,
    periodo: carpetaRow.periodo || null,
    archivos: archivos.map((a) => ({ id: a.id, nombre: a.nombre }))
  }, null, 2), 'utf8');
  parts.push({ name: 'manifest-anexo.json', buffer: manifestBuf });

  const label = zipArchiveSegment(carpetaRow.nombre || `carpeta-${carpetaRow.id}`);
  const filename = safeArchivoBackupName(`archivo-anexo-${label}-${Date.now()}.zip`);
  const destPath = path.join(archivoModuloDir(), filename);
  await writeZipFromParts(parts.length ? parts : [{ name: 'manifest-anexo.json', buffer: manifestBuf }], destPath);
  const st = fs.statSync(destPath);
  return { filename, filepath: destPath, size_bytes: st.size };
}

function periodoToRefId(periodo) {
  if (!periodo || !/^\d{4}-\d{2}$/.test(periodo)) return 0;
  return parseInt(periodo.replace('-', ''), 10);
}

async function archivarPdxPeriodo(periodo, archivadoPor = null) {
  const refId = periodoToRefId(periodo);
  if (!refId) return null;
  if (await yaRegistradoEnArchivo('pdx', refId)) return null;
  let backup = null;
  try {
    backup = await crearBackupZipPdxPeriodo(periodo);
  } catch (e) {
    logger.warn('[ARCHIVO-MODULO] backup PDX falló:', periodo, e.message);
  }
  const id = await insertRegistroArchivo({
    modulo: 'pdx',
    periodo,
    ref_id: refId,
    etiqueta: `Reportes ${periodo}`,
    backup_filename: backup?.filename || null,
    backup_bytes: backup?.size_bytes || null,
    archivado_por: archivadoPor
  });
  return { id, backup };
}

async function archivarArmadoPeriodo(periodoRow, archivadoPor = null) {
  if (!periodoRow?.id) return null;
  if (await yaRegistradoEnArchivo('armado', periodoRow.id)) return null;
  let backup = null;
  try {
    backup = await crearBackupZipArmadoPeriodo(periodoRow);
  } catch (e) {
    logger.warn('[ARCHIVO-MODULO] backup Armado falló:', periodoRow.periodo, e.message);
  }
  const id = await insertRegistroArchivo({
    modulo: 'armado',
    periodo: periodoRow.periodo,
    ref_id: periodoRow.id,
    etiqueta: periodoRow.etiqueta || periodoRow.periodo,
    backup_filename: backup?.filename || null,
    backup_bytes: backup?.size_bytes || null,
    archivado_por: archivadoPor
  });
  return { id, backup };
}

async function archivarAnexoCarpeta(carpetaRow, archivadoPor = null) {
  if (!carpetaRow?.id) return null;
  if (await yaRegistradoEnArchivo('anexo', carpetaRow.id)) return null;
  let backup = null;
  try {
    backup = await crearBackupZipAnexoCarpeta(carpetaRow);
  } catch (e) {
    logger.warn('[ARCHIVO-MODULO] backup Anexo falló:', carpetaRow.nombre, e.message);
  }
  const id = await insertRegistroArchivo({
    modulo: 'anexo',
    periodo: carpetaRow.periodo || null,
    ref_id: carpetaRow.id,
    etiqueta: carpetaRow.nombre,
    backup_filename: backup?.filename || null,
    backup_bytes: backup?.size_bytes || null,
    archivado_por: archivadoPor
  });
  return { id, backup };
}

async function procesarTransicionArchivoPdx(periodo, estadoAnterior, archivadoPor = null) {
  const estado = calcularVisibilidadPeriodo(periodo);
  if (estado !== 'archivo' || estadoAnterior === 'archivo') return null;
  return archivarPdxPeriodo(periodo, archivadoPor);
}

async function procesarTransicionArchivoArmado(periodoRow, estadoAnterior, archivadoPor = null) {
  const estado = calcularVisibilidadPeriodo(periodoRow.periodo);
  if (estado !== 'archivo' || estadoAnterior === 'archivo') return null;
  return archivarArmadoPeriodo(periodoRow, archivadoPor);
}

async function procesarTransicionArchivoAnexo(carpetaRow, estadoAnterior, archivadoPor = null) {
  const periodo = carpetaRow.periodo;
  if (!periodo) return null;
  const estado = calcularVisibilidadPeriodo(periodo);
  if (estado !== 'archivo' || estadoAnterior === 'archivo') return null;
  return archivarAnexoCarpeta(carpetaRow, archivadoPor);
}

async function listarModuloArchivo(archivadoPor = null) {
  await syncRegistrosArchivoFaltantes(archivadoPor);
  const rows = await db.query(`
    SELECT a.*, u.nombre AS archivado_por_nombre
    FROM sop_modulo_archivo a
    LEFT JOIN usuarios u ON u.id = a.archivado_por
    ORDER BY a.archivado_en DESC, a.id DESC
  `);
  return rows.map((r) => ({
    ...r,
    size_mb: r.backup_bytes ? (r.backup_bytes / (1024 * 1024)).toFixed(2) : null,
    tiene_backup: Boolean(r.backup_filename),
    visible_en_soportes: Boolean(r.visible_en_soportes)
  }));
}

function resolveArchivoBackupPath(filename) {
  if (!filename || !/^archivo-[a-z0-9._-]+\.zip$/i.test(filename)) return null;
  const fp = path.join(archivoModuloDir(), filename);
  const resolved = path.resolve(fp);
  const root = path.resolve(archivoModuloDir());
  if (!resolved.startsWith(root + path.sep)) return null;
  if (!fs.existsSync(resolved)) return null;
  return resolved;
}

async function regenerarBackup(registroId, archivadoPor = null) {
  const rows = await db.query('SELECT * FROM sop_modulo_archivo WHERE id = ? LIMIT 1', [registroId]);
  if (!rows.length) throw new Error('Registro de archivo no encontrado');
  const reg = rows[0];
  let backup = null;
  if (reg.modulo === 'pdx') {
    if (!reg.periodo) throw new Error('Periodo PDX no definido');
    backup = await crearBackupZipPdxPeriodo(reg.periodo);
  } else if (reg.modulo === 'armado') {
    const pr = await db.query('SELECT * FROM sop_periodos WHERE id = ? LIMIT 1', [reg.ref_id]);
    if (!pr.length) throw new Error('Periodo de armado no encontrado');
    backup = await crearBackupZipArmadoPeriodo(pr[0]);
  } else if (reg.modulo === 'anexo') {
    const cr = await db.query('SELECT * FROM anexo_fidu_carpetas WHERE id = ? LIMIT 1', [reg.ref_id]);
    if (!cr.length) throw new Error('Carpeta Anexo no encontrada');
    backup = await crearBackupZipAnexoCarpeta(cr[0]);
  }
  if (backup) {
    await db.execute(
      'UPDATE sop_modulo_archivo SET backup_filename = ?, backup_bytes = ?, archivado_por = COALESCE(?, archivado_por) WHERE id = ?',
      [backup.filename, backup.size_bytes, archivadoPor, registroId]
    );
  }
  return backup;
}

module.exports = {
  archivoModuloDir,
  archivarPdxPeriodo,
  archivarArmadoPeriodo,
  archivarAnexoCarpeta,
  procesarTransicionArchivoPdx,
  procesarTransicionArchivoArmado,
  procesarTransicionArchivoAnexo,
  listarModuloArchivo,
  resolveArchivoBackupPath,
  regenerarBackup,
  crearBackupZipPdxPeriodo,
  crearBackupZipArmadoPeriodo,
  crearBackupZipAnexoCarpeta,
  periodoToRefId,
  loadVisibleEnSoportesSet,
  loadVisibleEnSoportesCtx,
  resolveVisibilidadPeriodo,
  resolveVisibilidadArmadoRow,
  isForcedVisibleEnSoportes,
  effectiveVisibilidad,
  setVisibleEnSoportes,
  ensureRegistroArchivoArmado,
  ensureRegistroArchivoPdx,
  syncRegistrosArchivoFaltantes
};
