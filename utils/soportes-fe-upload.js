/**
 * Guardado de archivos en carpeta FE (SOPORTES o RIPS).
 * OPF/CRC/PDX/HEV: etiqueta FE si hay factura vinculada; si no, código del paciente.
 * FEV dispara renombrado/sincronización de carpeta y archivos con el número de factura.
 */

const path = require('path');

const fs = require('fs');

const db = require('./db-mysql');

const { fileLooksLikePdf } = require('../middleware/upload');

const { getArmadoFeDirForExpediente } = require('./soportes-storage');

const {

  buildCanonicalName,

  detectSoportesSlot,

  detectRipsSlot,

  parseFevFilename,

  safeOriginalFilename,

  decodeUploadFilename

} = require('./soportes-archivo-detect');

const { aplicarRenombradoPorFev } = require('./soportes-fe-rename');

const { moveFileSafe: moveFileToDest } = require('./fs-move-safe');

async function loadRipsSlotsOcupados(expedienteId) {

  const o = { RIPS_JSON_1: false, RIPS_JSON_2: false, RIPS_XML: false };

  try {

    const rows = await db.query(

      'SELECT slot FROM sop_rips_archivos WHERE expediente_id = ?',

      [expedienteId]

    );

    for (const r of rows) {

      if (r.slot === 'json_1') o.RIPS_JSON_1 = true;

      if (r.slot === 'json_2') o.RIPS_JSON_2 = true;

      if (r.slot === 'xml') o.RIPS_XML = true;

    }

  } catch (_) { /* tabla pendiente */ }

  return o;

}



async function saveRipsArchivo(exp, ctx, slotKey, tempPath, originalName, usuarioId) {

  const ext = path.extname(originalName).toLowerCase() || (slotKey.includes('XML') ? '.xml' : '.json');

  const num = parseInt(exp.numero_factura, 10) || 0;

  const diskName = num > 0

    ? buildCanonicalName(slotKey, num, ext)

    : safeOriginalFilename(originalName);

  const { abs: feDir, rel: feRel } = getArmadoFeDirForExpediente(ctx, exp);

  const destPath = path.join(feDir, diskName);

  moveFileToDest(tempPath, destPath);

  const rutaRelativa = path.join(feRel, diskName).replace(/\\/g, '/');

  const tamano = fs.statSync(destPath).size;

  const slotDb = slotKey === 'RIPS_JSON_1' ? 'json_1' : slotKey === 'RIPS_JSON_2' ? 'json_2' : 'xml';



  await db.execute('DELETE FROM sop_rips_archivos WHERE expediente_id = ? AND slot = ?', [exp.id, slotDb]);

  const ins = await db.execute(

    `INSERT INTO sop_rips_archivos (expediente_id, contenedor_id, slot, nombre_archivo, nombre_original, ruta_relativa, tamano_bytes, origen, subido_por)

     VALUES (?,?,?,?,?,?,?, 'manual', ?)`,

    [exp.id, exp.contenedor_id, slotDb, diskName, originalName, rutaRelativa, tamano, usuarioId]

  );

  return { slot: slotKey, nombre_archivo: diskName, nombre_original: originalName, archivo_id: ins.insertId };

}



async function slotOcupadoContrario(expedienteId, slotKey) {
  const otro = slotKey === 'PDX' ? 'HEV' : slotKey === 'HEV' ? 'PDX' : null;
  if (!otro) return false;
  const rows = await db.query(
    'SELECT id FROM sop_exp_archivos WHERE expediente_id = ? AND tipo = ? LIMIT 1',
    [expedienteId, otro]
  );
  return rows.length > 0;
}

async function saveSoportesArchivo(exp, ctx, slotKey, tempPath, originalName, usuarioId, origen = 'upload') {
  if ((slotKey === 'PDX' || slotKey === 'HEV') && (await slotOcupadoContrario(exp.id, slotKey))) {
    throw new Error(slotKey === 'PDX' ? 'Ya hay HEV cargado; no puede agregar PDX' : 'Ya hay PDX cargado; no puede agregar HEV');
  }

  let diskName;

  let fevParsed = null;



  if (slotKey === 'FEV') {

    fevParsed = parseFevFilename(originalName);

    if (!fevParsed.ok) {

      throw new Error(fevParsed.error || 'La factura debe llamarse FEV_{NIT}_FE{número}.pdf');

    }

    diskName = buildCanonicalName('FEV', fevParsed.numero, '.pdf');

  } else {
    const { buildSoportesDiskName } = require('./soportes-archivo-detect');
    diskName = buildSoportesDiskName(slotKey, exp, path.extname(originalName) || '.pdf');
  }



  const { abs: feDir, rel: feRel } = getArmadoFeDirForExpediente(ctx, exp);

  const destPath = path.join(feDir, diskName);
  const rutaRelativa = path.join(feRel, diskName).replace(/\\/g, '/');
  const anteriores = await db.query(
    'SELECT * FROM sop_exp_archivos WHERE expediente_id = ? AND tipo = ?',
    [exp.id, slotKey]
  );
  const backupPath = fs.existsSync(destPath) ? `${destPath}.replace-backup.${Date.now()}` : null;
  let renombrado = null;
  try {
    if (backupPath) fs.renameSync(destPath, backupPath);
    moveFileToDest(tempPath, destPath);
    const tamano = fs.statSync(destPath).size;

    await db.execute('DELETE FROM sop_exp_archivos WHERE expediente_id = ? AND tipo = ?', [exp.id, slotKey]);
    await db.execute(
      `INSERT INTO sop_exp_archivos (expediente_id, tipo, nombre_archivo, nombre_original, ruta_relativa, tamano_bytes, origen, subido_por)
       VALUES (?,?,?,?,?,?,?,?)`,
      [exp.id, slotKey, diskName, originalName, rutaRelativa, tamano, origen, usuarioId]
    );

    if (slotKey === 'PDX') {
      await db.execute("UPDATE sop_expedientes SET tipo_servicio = 'electro' WHERE id = ?", [exp.id]);
    } else if (slotKey === 'HEV') {
      await db.execute("UPDATE sop_expedientes SET tipo_servicio = 'consulta' WHERE id = ?", [exp.id]);
    }

    if (slotKey === 'FEV' && fevParsed?.ok) {
      renombrado = await aplicarRenombradoPorFev(exp.id, fevParsed.numero);
      if (!renombrado.ok) {
        throw new Error(renombrado.error || 'No se pudo renombrar la carpeta con el número de factura');
      }
    }
    if (backupPath && fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
  } catch (e) {
    try {
      await db.execute('DELETE FROM sop_exp_archivos WHERE expediente_id = ? AND tipo = ?', [exp.id, slotKey]);
      for (const anterior of anteriores) {
        await db.execute(
          `INSERT INTO sop_exp_archivos
           (expediente_id, tipo, nombre_archivo, nombre_original, ruta_relativa, tamano_bytes, origen, pdx_archivo_id, subido_por)
           VALUES (?,?,?,?,?,?,?,?,?)`,
          [
            anterior.expediente_id,
            anterior.tipo,
            anterior.nombre_archivo,
            anterior.nombre_original,
            anterior.ruta_relativa,
            anterior.tamano_bytes,
            anterior.origen,
            anterior.pdx_archivo_id,
            anterior.subido_por
          ]
        );
      }
    } catch (_) { /* conservar error original */ }
    try {
      if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
      if (backupPath && fs.existsSync(backupPath)) fs.renameSync(backupPath, destPath);
    } catch (_) { /* recuperación informada por el error original */ }
    throw e;
  }



  return {

    slot: slotKey,

    nombre_archivo: diskName,

    nombre_original: originalName,

    renombrado

  };

}



function validarPdfSoportes(tempPath, originalName) {

  const ext = path.extname(originalName).toLowerCase();

  if (ext && ext !== '.pdf') {

    return { ok: false, error: 'En SOPORTES solo se permiten archivos PDF (.pdf).' };

  }

  if (!fileLooksLikePdf(tempPath)) {

    return { ok: false, error: 'El archivo no es un PDF válido. Verifique que sea un documento PDF real.' };

  }

  return { ok: true };

}



async function ingestFeArchivo(exp, ctx, tempPath, originalName, usuarioId, tipoManual = null) {

  originalName = decodeUploadFilename(originalName);

  const contenedorTipo = ctx.contenedor_tipo || 'soportes';
  const diaModo = ctx.dia_modo || 'facturacion';

  if (diaModo === 'ucqn') {
    try {
      const { saveUcqnPdf } = require('./soportes-ucqn-upload');
      const saved = await saveUcqnPdf(exp, tempPath, originalName, usuarioId);
      return {
        ok: true,
        contenedor: 'soportes',
        modo: 'ucqn',
        tipo_detectado: 'PDF',
        message: 'PDF guardado',
        ...saved
      };
    } catch (e) {
      return { ok: false, status: 400, error: e.message || 'No se pudo guardar el PDF' };
    }
  }

  if (contenedorTipo === 'rips') {

    const extR = path.extname(originalName).toLowerCase();

    if (extR === '.pdf' || fileLooksLikePdf(tempPath)) {

      return {

        ok: false,

        status: 400,

        error: 'En la carpeta RIPS solo se suben JSON y XML. Los PDF (OPF, CRC, FEV, PDX, HEV) van en la carpeta SOPORTES.'

      };

    }

    const ocupados = await loadRipsSlotsOcupados(exp.id);

    let det = tipoManual ? { tipo: tipoManual, razon: 'Tipo indicado manualmente' } : detectRipsSlot(originalName, ocupados);

    if (!det && tipoManual) det = { tipo: tipoManual, razon: 'Manual' };

    if (!det) {

      return { ok: false, status: 400, error: 'No se reconoció JSON o XML RIPS. Indique el tipo de archivo.', requiere_tipo: true };

    }

    const ext = path.extname(originalName).toLowerCase();

    if (det.tipo === 'RIPS_XML' && ext !== '.xml') {

      return { ok: false, status: 400, error: 'El slot RIPS XML requiere archivo .xml' };

    }

    if ((det.tipo === 'RIPS_JSON_1' || det.tipo === 'RIPS_JSON_2') && ext !== '.json') {

      return { ok: false, status: 400, error: 'Los slots JSON RIPS requieren archivo .json' };

    }

    const saved = await saveRipsArchivo(exp, ctx, det.tipo, tempPath, originalName, usuarioId);

    return { ok: true, contenedor: 'rips', tipo_detectado: det.tipo, razon: det.razon, ...saved };

  }



  const pdfCheck = validarPdfSoportes(tempPath, originalName);

  if (!pdfCheck.ok) {

    return { ok: false, status: 400, error: pdfCheck.error };

  }



  let det = tipoManual ? { tipo: tipoManual, razon: 'Tipo indicado manualmente' } : detectSoportesSlot(originalName, exp.tipo_servicio);

  if (!det && tipoManual) det = { tipo: tipoManual, razon: 'Manual' };

  if (!det) {

    return {

      ok: false,

      status: 400,

      error: 'No se pudo detectar el tipo de documento. Elija OPF, CRC, FEV, PDX o HEV.',

      requiere_tipo: true,

      nombre_original: originalName

    };

  }

  if (det.tipo === 'FEV' && !parseFevFilename(originalName).ok) {

    return {

      ok: false,

      status: 400,

      error: parseFevFilename(originalName).error || 'La factura debe llamarse FEV_{NIT}_FE{número}.pdf'

    };

  }

  try {

    const saved = await saveSoportesArchivo(exp, ctx, det.tipo, tempPath, originalName, usuarioId);

    const msg = saved.renombrado?.ok
      ? (saved.renombrado.ya_renombrado
        ? `Factura vinculada: archivos sincronizados con FE ${saved.renombrado.numero_factura}`
        : `Factura vinculada: carpeta ${saved.renombrado.codigo} y archivos renombrados con FE ${saved.renombrado.numero_factura}`)
      : `Guardado como ${det.tipo}`;

    return {

      ok: true,

      contenedor: 'soportes',

      tipo_detectado: det.tipo,

      razon: det.razon,

      message: msg,

      ...saved

    };

  } catch (e) {

    return { ok: false, status: 400, error: e.message || 'No se pudo guardar el archivo' };

  }

}



module.exports = {

  ingestFeArchivo,

  saveSoportesArchivo,

  saveRipsArchivo

};


