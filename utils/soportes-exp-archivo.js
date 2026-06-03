/**
 * Ver, eliminar y resolver rutas de archivos en expedientes de armado (SOPORTES y RIPS).
 */
const path = require('path');
const fs = require('fs');
const db = require('./db-mysql');
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

function resolveArchivoAbsoluto(row) {
  const rel = String(row.ruta_relativa || '').replace(/\\/g, '/');
  if (!rel) return null;
  const joined = rel.startsWith('soportes/') ? rel : path.join('soportes', rel).replace(/\\/g, '/');
  return resolveStoragePath(joined);
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
  eliminarArchivoExpedienteSlot
};
