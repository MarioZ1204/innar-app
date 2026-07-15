/**
 * Ver, eliminar y resolver rutas de archivos en expedientes de armado (SOPORTES y RIPS).
 */
const path = require('path');
const fs = require('fs');
const db = require('./db-mysql');
const { getSoportesRoot } = require('../config/uploads-path');
const { resolveStoragePath } = require('./soportes-storage');

const SOPORTES_SLOT_TIPOS = ['OPF', 'CRC', 'FEV', 'PDX', 'HEV'];

const RIPS_TIPO_TO_SLOT = {
  RIPS_JSON_1: 'json_1',
  RIPS_JSON_2: 'json_2',
  RIPS_XML: 'xml'
};

function normalizarTipoArchivo(tipo) {
  const t = String(tipo || '').toUpperCase();
  if (SOPORTES_SLOT_TIPOS.includes(t)) return { contenedor: 'soportes', tipo: t };
  if (RIPS_TIPO_TO_SLOT[t]) return { contenedor: 'rips', tipo: t, slotDb: RIPS_TIPO_TO_SLOT[t] };
  return null;
}

async function loadArchivoExpedienteSlot(expedienteId, tipoParam) {
  const norm = normalizarTipoArchivo(tipoParam);
  if (!norm) return { error: 'Tipo de archivo no válido', status: 400 };

  if (norm.contenedor === 'soportes') {
    const rows = await db.query(
      'SELECT * FROM sop_exp_archivos WHERE expediente_id = ? AND tipo = ? LIMIT 1',
      [expedienteId, norm.tipo]
    );
    if (!rows.length) return { error: 'Archivo no encontrado', status: 404 };
    return { ok: true, row: rows[0], contenedor: 'soportes', tipo: norm.tipo };
  }

  const rows = await db.query(
    'SELECT * FROM sop_rips_archivos WHERE expediente_id = ? AND slot = ? LIMIT 1',
    [expedienteId, norm.slotDb]
  );
  if (!rows.length) return { error: 'Archivo no encontrado', status: 404 };
  return { ok: true, row: rows[0], contenedor: 'rips', tipo: norm.tipo, slotDb: norm.slotDb };
}

function buildStoredRutaRelativa(absPath) {
  if (!absPath) return null;
  const rel = path.relative(getSoportesRoot(), absPath).replace(/\\/g, '/');
  if (!rel || rel === '.' || rel.startsWith('..')) return null;
  return rel;
}

function buscarRutaHistoricaArchivo(row, baseRoot = getSoportesRoot()) {
  const nombre = String(row?.nombre_archivo || '').trim();
  const tipo = String(row?.tipo || '').toUpperCase();
  const rel = String(row?.ruta_relativa || '').replace(/\\/g, '/').trim();
  const base = path.basename(nombre);
  const relBase = rel ? path.basename(rel) : '';
  const tokens = [];

  if (base) tokens.push(base);
  if (relBase && relBase !== base) tokens.push(relBase);
  if (tipo) tokens.push(`${tipo.toLowerCase()}_`);
  if (nombre) tokens.push(path.basename(nombre, path.extname(nombre)));

  const roots = [baseRoot, path.join(baseRoot, 'armado'), path.resolve(__dirname, '..', 'public', 'uploads', 'soportes')];

  const walk = (currentDir) => {
    if (!fs.existsSync(currentDir)) return null;
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        const found = walk(full);
        if (found) return found;
        continue;
      }
      const lower = entry.name.toLowerCase();
      const matches = tokens.some((token) => {
        if (!token) return false;
        if (token.endsWith('_')) return lower.startsWith(token);
        return lower === token.toLowerCase() || lower.includes(token.toLowerCase());
      });
      if (matches) return full;
    }
    return null;
  };

  for (const root of roots) {
    const found = walk(root);
    if (found) return found;
  }

  return null;
}

function resolveArchivoAbsoluto(row) {
  const rel = String(row?.ruta_relativa || '').replace(/\\/g, '/');
  if (!rel) return null;
  const joined = rel.startsWith('soportes/') ? rel : path.join('soportes', rel).replace(/\\/g, '/');
  const resolved = resolveStoragePath(joined);
  if (resolved) return resolved;

  const nombre = String(row?.nombre_archivo || '');
  const tipo = String(row?.tipo || '').toUpperCase();
  const base = path.basename(nombre);
  const candidates = [];

  if (base) {
    candidates.push(path.join(path.dirname(joined), base));
    candidates.push(path.join(getSoportesRoot(), path.basename(joined)));
    candidates.push(path.join(getSoportesRoot(), path.dirname(joined).replace(/^soportes\//, ''), base));
    candidates.push(path.join(getSoportesRoot(), 'armado', path.basename(joined)));
    candidates.push(path.join(getSoportesRoot(), 'armado', path.dirname(joined).replace(/^soportes\//, ''), base));
  }

  const nombreSinExt = base ? path.basename(base, path.extname(base)) : '';
  const tipoPrefix = tipo ? `${tipo.toLowerCase()}_` : '';
  const buscarPorPrefijo = (dir) => {
    if (!dir || !fs.existsSync(dir)) return null;

    const walk = (currentDir) => {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          const found = walk(full);
          if (found) return found;
          continue;
        }
        const lower = entry.name.toLowerCase();
        const matches =
          lower === base.toLowerCase() ||
          lower.includes(nombreSinExt.toLowerCase()) ||
          (tipoPrefix && lower.startsWith(tipoPrefix)) ||
          (nombreSinExt && lower.includes(nombreSinExt.replace(/_/g, '').toLowerCase()));
        if (matches) return full;
      }
      return null;
    };

    return walk(dir);
  };

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  const relDir = path.dirname(joined).replace(/^soportes\//, '');
  const scanRoots = [
    getSoportesRoot(),
    path.join(getSoportesRoot(), 'armado'),
    path.join(getSoportesRoot(), 'armado', relDir),
    path.join(getSoportesRoot(), relDir),
    path.resolve(__dirname, '..', 'public', 'uploads', 'soportes')
  ];
  const historical = buscarRutaHistoricaArchivo(row);
  if (historical) return historical;
  for (const root of scanRoots) {
    const found = buscarPorPrefijo(root);
    if (found) return found;
  }

  if (base) {
    const dirCandidates = [
      path.join(path.dirname(joined)),
      path.join('soportes', 'armado'),
      path.resolve(__dirname, '..', 'public', 'uploads', 'soportes')
    ];
    for (const dir of dirCandidates) {
      const full = path.join(dir, base);
      if (fs.existsSync(full)) return full;
    }
  }

  return null;
}

async function repararArchivoExpedienteRow(row, { contenedor = 'soportes', usedPaths = null, expedienteId = null } = {}) {
  if (!row?.id) return { ok: false, repaired: false, path: null };

  let resolved = resolveArchivoAbsoluto(row);
  const rowNombre = String(row?.nombre_archivo || '').trim();
  const rowBaseName = rowNombre ? path.basename(rowNombre) : '';
  const resolvedBaseName = resolved ? path.basename(resolved) : '';
  const rowStem = rowBaseName ? path.basename(rowBaseName, path.extname(rowBaseName)) : '';
  const resolvedStem = resolvedBaseName ? path.basename(resolvedBaseName, path.extname(resolvedBaseName)) : '';
  const nombreNoCoincide = Boolean(rowBaseName && resolvedBaseName && rowStem && resolvedStem && rowStem.toLowerCase() !== resolvedStem.toLowerCase());
  const shouldCloneFromPrevious = Boolean(
    usedPaths instanceof Set &&
      usedPaths.size > 0 &&
      (!resolved || !fs.existsSync(resolved) || nombreNoCoincide || (resolvedBaseName && usedPaths.has(path.resolve(resolved))))
  );

  if (shouldCloneFromPrevious) {
    const sourcePath = Array.from(usedPaths).slice(-1)[0];
    if (sourcePath && fs.existsSync(sourcePath)) {
      const ext = path.extname(String(row?.nombre_archivo || 'archivo.pdf')) || '.pdf';
      const base = path.basename(String(row?.nombre_archivo || `archivo${ext}`), ext);
      const suffix = expedienteId ? `_${expedienteId}` : '';
      const dir = path.dirname(sourcePath);
      let index = 1;
      let candidatePath = null;
      while (!candidatePath) {
        const altName = `${base}${suffix}${index > 1 ? `_${index}` : ''}${ext}`;
        const altPath = path.join(dir, altName);
        if (!fs.existsSync(altPath) && !usedPaths.has(path.resolve(altPath))) {
          candidatePath = altPath;
          fs.copyFileSync(sourcePath, candidatePath);
          resolved = candidatePath;
        }
        index += 1;
      }
    }
  }

  if (!resolved || !fs.existsSync(resolved)) {
    return { ok: false, repaired: false, path: null };
  }

  const fromDb = row?.ruta_relativa ? resolveStoragePath(String(row.ruta_relativa).replace(/\\/g, '/')) : null;
  const samePath = fromDb && fs.existsSync(fromDb) && path.resolve(fromDb) === path.resolve(resolved);
  const targetName = path.basename(resolved);
  const targetRel = buildStoredRutaRelativa(resolved);

  if (!targetRel) {
    return { ok: false, repaired: false, path: resolved };
  }

  let finalPath = resolved;
  let finalName = targetName;
  let finalRel = targetRel;

  if (usedPaths instanceof Set) {
    const resolvedAbs = path.resolve(resolved);
    if (usedPaths.has(resolvedAbs)) {
      const ext = path.extname(targetName);
      const base = path.basename(targetName, ext);
      const suffix = expedienteId ? `_${expedienteId}` : '';
      let index = 1;
      let candidatePath = null;
      while (!candidatePath) {
        const altName = `${base}${suffix}${index > 1 ? `_${index}` : ''}${ext}`;
        const altPath = path.join(path.dirname(resolved), altName);
        if (!fs.existsSync(altPath) && !usedPaths.has(path.resolve(altPath))) {
          candidatePath = altPath;
          finalName = altName;
          finalPath = altPath;
          finalRel = buildStoredRutaRelativa(altPath);
        }
        index += 1;
      }
      fs.copyFileSync(resolved, finalPath);
      const currentRelPath = path.dirname(targetRel);
      if (finalRel && currentRelPath && finalRel.startsWith(`${currentRelPath}/`)) {
        // keep relative path aligned with the new filename inside the same directory
      }
    }
  }

  if (usedPaths instanceof Set) {
    usedPaths.add(path.resolve(finalPath));
  }

  const needsUpdate = !samePath || String(row?.nombre_archivo || '') !== finalName || String(row?.ruta_relativa || '').replace(/\\/g, '/') !== finalRel;
  if (!needsUpdate) {
    return { ok: true, repaired: false, path: finalPath, nombre_archivo: finalName, ruta_relativa: finalRel };
  }

  if (contenedor === 'soportes') {
    await db.execute(
      'UPDATE sop_exp_archivos SET nombre_archivo = ?, ruta_relativa = ? WHERE id = ?',
      [finalName, finalRel, row.id]
    );
  } else {
    await db.execute(
      'UPDATE sop_rips_archivos SET nombre_archivo = ?, ruta_relativa = ? WHERE id = ?',
      [finalName, finalRel, row.id]
    );
  }

  if (usedPaths instanceof Set) {
    usedPaths.add(path.resolve(finalPath));
  }

  return { ok: true, repaired: true, path: finalPath, nombre_archivo: finalName, ruta_relativa: finalRel };
}

async function repararArchivosExpediente(expedienteId) {
  const soportesRows = await db.query('SELECT * FROM sop_exp_archivos WHERE expediente_id = ?', [expedienteId]);
  const reparaciones = [];
  const usedPaths = new Set();
  for (const row of soportesRows) {
    reparaciones.push(await repararArchivoExpedienteRow(row, { contenedor: 'soportes', usedPaths, expedienteId }));
  }

  try {
    const ripsRows = await db.query('SELECT * FROM sop_rips_archivos WHERE expediente_id = ?', [expedienteId]);
    for (const row of ripsRows) {
      reparaciones.push(await repararArchivoExpedienteRow(row, { contenedor: 'rips', usedPaths, expedienteId }));
    }
  } catch (_) {
    // La tabla puede no existir o no estar preparada en todos los entornos.
  }

  return reparaciones;
}


async function eliminarArchivoExpedienteSlot(expedienteId, tipoParam) {
  const loaded = await loadArchivoExpedienteSlot(expedienteId, tipoParam);
  if (!loaded.ok) return loaded;

  const fp = resolveArchivoAbsoluto(loaded.row);
  if (fp && fs.existsSync(fp)) {
    try { fs.unlinkSync(fp); } catch (_) { /* ignore */ }
  }

  if (loaded.contenedor === 'soportes') {
    await db.execute('DELETE FROM sop_exp_archivos WHERE id = ?', [loaded.row.id]);
    if (loaded.tipo === 'FEV') {
      await db.execute('UPDATE sop_expedientes SET fev_externa_verificada = 0 WHERE id = ?', [expedienteId]);
    }
  } else {
    await db.execute('DELETE FROM sop_rips_archivos WHERE id = ?', [loaded.row.id]);
  }

  return {
    ok: true,
    tipo: loaded.tipo,
    nombre_archivo: loaded.row.nombre_archivo
  };
}

module.exports = {
  SOPORTES_SLOT_TIPOS,
  RIPS_TIPO_TO_SLOT,
  normalizarTipoArchivo,
  loadArchivoExpedienteSlot,
  resolveArchivoAbsoluto,
  buscarRutaHistoricaArchivo,
  repararArchivoExpedienteRow,
  repararArchivosExpediente,
  eliminarArchivoExpedienteSlot
};
