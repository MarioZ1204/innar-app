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

async function repararArchivoExpedienteRow(row, { contenedor = 'soportes' } = {}) {
  if (!row?.id) return { ok: false, repaired: false, path: null };

  const resolved = resolveArchivoAbsoluto(row);
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

  const needsUpdate = !samePath || String(row?.nombre_archivo || '') !== targetName;
  if (!needsUpdate) {
    return { ok: true, repaired: false, path: resolved, nombre_archivo: targetName, ruta_relativa: targetRel };
  }

  if (contenedor === 'soportes') {
    await db.execute(
      'UPDATE sop_exp_archivos SET nombre_archivo = ?, ruta_relativa = ? WHERE id = ?',
      [targetName, targetRel, row.id]
    );
  } else {
    await db.execute(
      'UPDATE sop_rips_archivos SET nombre_archivo = ?, ruta_relativa = ? WHERE id = ?',
      [targetName, targetRel, row.id]
    );
  }

  return { ok: true, repaired: true, path: resolved, nombre_archivo: targetName, ruta_relativa: targetRel };
}

async function repararArchivosExpediente(expedienteId) {
  const soportesRows = await db.query('SELECT * FROM sop_exp_archivos WHERE expediente_id = ?', [expedienteId]);
  const reparaciones = [];
  for (const row of soportesRows) {
    reparaciones.push(await repararArchivoExpedienteRow(row, { contenedor: 'soportes' }));
  }

  try {
    const ripsRows = await db.query('SELECT * FROM sop_rips_archivos WHERE expediente_id = ?', [expedienteId]);
    for (const row of ripsRows) {
      reparaciones.push(await repararArchivoExpedienteRow(row, { contenedor: 'rips' }));
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
  repararArchivoExpedienteRow,
  repararArchivosExpediente,
  eliminarArchivoExpedienteSlot
};
