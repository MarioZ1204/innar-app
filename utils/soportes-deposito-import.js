/**
 * Importar archivos del depósito de reportes (PDX) al expediente FE.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { detectarTemaCarpeta } = require('./soportes-temas');
const { esArchivoOrdenHcPdx } = require('./soportes-opf-merge');
const { resolveStoragePath } = require('./soportes-storage');
const { saveSoportesArchivo } = require('./soportes-fe-upload');
const db = require('./db-mysql');

const TEMA_LABEL = {
  comprobantes: 'comprobante',
  consentimientos: 'consentimiento',
  ordenes: 'orden',
  neutral: 'reporte',
  vtm: 'reporte',
  psg: 'reporte',
  eeg: 'reporte',
  actigrafia: 'reporte'
};

function temaDeArchivo(row) {
  return row.color_tema || detectarTemaCarpeta(row.carpeta_nombre || '');
}

/** Slot FE destino según carpeta/tema del depósito. */
function resolverDestinoImportacion(pdxRow) {
  const tema = temaDeArchivo(pdxRow);
  if (tema === 'comprobantes') {
    return { modo: 'slot', slot: 'CRC', etiqueta: 'CRC (comprobante)' };
  }
  if (tema === 'consentimientos') {
    return {
      modo: 'no_soportes',
      error: 'Los consentimientos se gestionan solo en Cargar reportes; no se vinculan al módulo Soportes.'
    };
  }
  if (tema === 'ordenes') {
    if (esArchivoOrdenHcPdx(pdxRow)) {
      return {
        modo: 'vinculo',
        rol: 'orden_hc',
        etiqueta: 'ORDEN + HC',
        aviso: 'Quedó vinculado al expediente. Use «Generar OPF» para unirlo con la autorización.'
      };
    }
    return {
      modo: 'vinculo',
      rol: 'orden_hc',
      etiqueta: 'Orden',
      aviso: 'Quedó vinculado al expediente.'
    };
  }
  return { modo: 'slot', slot: 'PDX', etiqueta: 'PDX (reporte)' };
}

async function assertExpedienteSoportes(exp) {
  if (!exp?.id) throw new Error('Expediente no encontrado');
  if (exp.contenedor_tipo === 'rips') {
    throw new Error('Vincule el archivo en la carpeta SOPORTES del expediente, no en RIPS');
  }
}

async function copiarDepositoATemporal(pdxRow) {
  const src = resolveStoragePath(pdxRow.ruta_relativa);
  if (!src || !fs.existsSync(src)) {
    throw new Error('El archivo no está en disco en el depósito de reportes');
  }
  const tmpCopy = path.join(os.tmpdir(), `innar-dep-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.pdf`);
  fs.copyFileSync(src, tmpCopy);
  return tmpCopy;
}

async function registrarVinculo(expedienteId, pdxArchivoId, rol, rutaRelativa, nombreArchivo, usuarioId) {
  const exist = await db.query(
    'SELECT id FROM sop_exp_vinculos WHERE expediente_id = ? AND pdx_archivo_id = ? LIMIT 1',
    [expedienteId, pdxArchivoId]
  );
  if (exist.length) {
    throw new Error('Este archivo ya está vinculado a este expediente');
  }
  await db.execute(
    `INSERT INTO sop_exp_vinculos (expediente_id, pdx_archivo_id, rol, ruta_relativa, nombre_archivo, vinculado_por)
     VALUES (?,?,?,?,?,?)`,
    [expedienteId, pdxArchivoId, rol, rutaRelativa, nombreArchivo, usuarioId]
  );
}

const { moveFileSafe: moveFileToDest } = require('./fs-move-safe');

async function importarArchivoDesdeDeposito(exp, pdxRow, usuarioId) {
  await assertExpedienteSoportes(exp);
  const dest = resolverDestinoImportacion(pdxRow);
  if (dest.modo === 'no_soportes') {
    throw new Error(dest.error || 'Este tipo de archivo no se vincula a Soportes');
  }

  if (dest.modo === 'slot' && dest.slot === 'PDX') {
    const hev = await db.query(
      'SELECT id FROM sop_exp_archivos WHERE expediente_id = ? AND tipo = ? LIMIT 1',
      [exp.id, 'HEV']
    );
    if (hev.length) {
      throw new Error('Ya existe HEV en este expediente; no puede importar el reporte como PDX');
    }
  }

  const tmpCopy = await copiarDepositoATemporal(pdxRow);
  try {
    if (dest.modo === 'vinculo') {
      const { getArmadoFeDirFromContext } = require('./soportes-storage');
      const { safeOriginalFilename } = require('./soportes-archivo-detect');
      const { abs: feDir, rel: feRel } = getArmadoFeDirFromContext(exp, exp.codigo);
      const enlacesDir = path.join(feDir, 'Enlaces');
      if (!fs.existsSync(enlacesDir)) fs.mkdirSync(enlacesDir, { recursive: true });
      const diskName = safeOriginalFilename(pdxRow.nombre_archivo_original || `vinculo-${pdxRow.id}.pdf`);
      const destPath = path.join(enlacesDir, diskName);
      moveFileToDest(tmpCopy, destPath);
      const rutaRelativa = path.join(feRel, 'Enlaces', diskName).replace(/\\/g, '/');
      await registrarVinculo(exp.id, pdxRow.id, dest.rol, rutaRelativa, diskName, usuarioId);
      return {
        ok: true,
        modo: 'vinculo',
        rol: dest.rol,
        etiqueta: dest.etiqueta,
        nombre_archivo: diskName,
        aviso: dest.aviso
      };
    }

    const result = await saveSoportesArchivo(
      exp,
      exp,
      dest.slot,
      tmpCopy,
      pdxRow.nombre_archivo_original,
      usuarioId,
      'copia_pdx'
    );
    try { if (fs.existsSync(tmpCopy)) fs.unlinkSync(tmpCopy); } catch (_) { /* ignore */ }
    await db.execute(
      'UPDATE sop_exp_archivos SET pdx_archivo_id = ? WHERE expediente_id = ? AND tipo = ?',
      [pdxRow.id, exp.id, dest.slot]
    );
    await db.execute(
      'INSERT INTO sop_transferencias (pdx_archivo_id, expediente_id, usuario_id) VALUES (?,?,?)',
      [pdxRow.id, exp.id, usuarioId]
    );
    return {
      ok: true,
      modo: 'slot',
      slot: dest.slot,
      etiqueta: dest.etiqueta,
      ...result
    };
  } catch (e) {
    try { if (fs.existsSync(tmpCopy)) fs.unlinkSync(tmpCopy); } catch (_) { /* ignore */ }
    throw e;
  }
}

module.exports = {
  temaDeArchivo,
  TEMA_LABEL,
  resolverDestinoImportacion,
  importarArchivoDesdeDeposito
};
