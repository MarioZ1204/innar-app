'use strict';

const path = require('path');
const fs = require('fs');
const db = require('./db-mysql');
const { insertRowId } = require('./db-insert-id');
const { buildAnexoFiduExcelBuffer } = require('./anexo-fidu-export');
const { soportesRoot, ensureDir } = require('./soportes-storage');
const {
  getArmadoAnexoDir,
  ensureAnexoCarpetaPeriodo,
  idContenedoraAnexo
} = require('./soportes-armado-modos');
const { nextSopDiaNumero } = require('./soportes-armado-structure');

async function fetchAnexoArchivoMeta(archivoId) {
  const rows = await db.query(
    `SELECT a.*, c.nombre AS carpeta_nombre
     FROM anexo_fidu_archivos a
     JOIN anexo_fidu_carpetas c ON c.id = a.carpeta_id
     WHERE a.id = ?`,
    [archivoId]
  );
  return rows[0] || null;
}

async function resolverSopDiaAnexo(archivoId, meta) {
  if (meta?.sop_dia_id) {
    const dia = await db.query('SELECT * FROM sop_dias WHERE id = ?', [meta.sop_dia_id]);
    if (dia.length) return dia[0];
  }
  const byLink = await db.query('SELECT * FROM sop_dias WHERE anexo_archivo_id = ? LIMIT 1', [archivoId]);
  if (byLink.length) return byLink[0];
  return null;
}

async function resolverCarpetaAnexoPeriodo(dbConn, per) {
  const candidates = [per.etiqueta, per.periodo]
    .map((s) => String(s || '').trim())
    .filter(Boolean);
  const seen = new Set();
  for (const nom of candidates) {
    const key = nom.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const rows = await dbConn.query(
      `SELECT id FROM anexo_fidu_carpetas
       WHERE nombre = ? OR UPPER(TRIM(nombre)) = UPPER(?)
       ORDER BY id ASC LIMIT 1`,
      [nom, nom]
    );
    if (rows.length) return rows[0].id;
  }
  return ensureAnexoCarpetaPeriodo(dbConn, per);
}

async function periodoIdsPorCarpetaAnexo(carpetaId) {
  const carp = await db.query('SELECT nombre FROM anexo_fidu_carpetas WHERE id = ?', [carpetaId]);
  if (!carp.length) return [];
  const nom = String(carp[0].nombre || '').trim();
  if (!nom) return [];
  const rows = await db.query(
    'SELECT id FROM sop_periodos WHERE etiqueta = ? OR periodo = ?',
    [nom, nom]
  );
  return rows.map((r) => r.id);
}

async function vincularArchivoAnexoASopDia(dbConn, periodoId, anexoContId, arch, per) {
  let diaId = arch.sop_dia_id || null;
  if (diaId) {
    const dia = await dbConn.query(
      'SELECT id FROM sop_dias WHERE id = ? AND periodo_id = ?',
      [diaId, periodoId]
    );
    if (!dia.length) diaId = null;
  }
  if (!diaId) {
    const byLink = await dbConn.query(
      'SELECT id FROM sop_dias WHERE periodo_id = ? AND anexo_archivo_id = ? LIMIT 1',
      [periodoId, arch.id]
    );
    if (byLink.length) diaId = byLink[0].id;
  }
  if (!diaId) {
    const byNom = await dbConn.query(
      'SELECT id FROM sop_dias WHERE periodo_id = ? AND parent_id = ? AND nombre_display = ? LIMIT 1',
      [periodoId, anexoContId, arch.nombre]
    );
    if (byNom.length) diaId = byNom[0].id;
  }

  let accion = 'existente';
  if (!diaId) {
    const diaNum = await nextSopDiaNumero(dbConn, periodoId);
    const fechaDate = `${per.periodo}-01`;
    const r = await dbConn.execute(
      `INSERT INTO sop_dias (periodo_id, parent_id, dia, fecha, nombre_display, es_contenedor, modo, estado_facturacion, anexo_archivo_id)
       VALUES (?,?,?,?,?,0,'anexo_fidu','a_facturar',?)`,
      [periodoId, anexoContId, diaNum, fechaDate, arch.nombre, arch.id]
    );
    diaId = insertRowId(r);
    accion = 'creada';
  } else {
    accion = 'vinculada';
  }

  if (!diaId) return { ok: false, error: 'No se pudo vincular carpeta de anexo' };

  await dbConn.execute(
    `UPDATE sop_dias SET parent_id = ?, nombre_display = ?, modo = 'anexo_fidu', anexo_archivo_id = ?
     WHERE id = ?`,
    [anexoContId, arch.nombre, arch.id, diaId]
  );
  await dbConn.execute(
    'UPDATE anexo_fidu_archivos SET sop_dia_id = ? WHERE id = ?',
    [diaId, arch.id]
  );

  return { ok: true, dia_id: diaId, accion };
}

/**
 * Crea/vincula en Soportes (Anexo FIDU) todas las carpetas-archivo del módulo Anexo del mes.
 * Opcionalmente exporta Excel a disco bajo armado/{periodo}/Anexo FIDU/…
 */
async function syncAnexoModuloASoportesPeriodo(periodoId, options = {}) {
  const exportarExcel = options.exportarExcel !== false;
  const forzarExport = !!options.forzarExport;

  const periodoRows = await db.query('SELECT * FROM sop_periodos WHERE id = ?', [periodoId]);
  if (!periodoRows.length) return { ok: false, error: 'Periodo no encontrado' };
  const per = periodoRows[0];

  const anexoContId = await idContenedoraAnexo(db, periodoId);
  if (!anexoContId) return { ok: false, error: 'Contenedora Anexo FIDU no encontrada en el mes' };

  const carpetaId = await resolverCarpetaAnexoPeriodo(db, per);
  const archivosCarpeta = await db.query(
    'SELECT * FROM anexo_fidu_archivos WHERE carpeta_id = ? ORDER BY nombre ASC, id ASC',
    [carpetaId]
  );
  const archivosVinculados = await db.query(
    `SELECT DISTINCT a.* FROM anexo_fidu_archivos a
     INNER JOIN sop_dias d ON d.anexo_archivo_id = a.id OR d.id = a.sop_dia_id
     WHERE d.periodo_id = ?
     ORDER BY a.nombre ASC, a.id ASC`,
    [periodoId]
  );
  const byId = new Map();
  for (const a of [...archivosCarpeta, ...archivosVinculados]) byId.set(a.id, a);
  const archivos = [...byId.values()];

  let creadas = 0;
  let vinculadas = 0;
  let exportadas = 0;
  let omitidas = 0;
  const detalle = [];

  for (const arch of archivos) {
    const link = await vincularArchivoAnexoASopDia(db, periodoId, anexoContId, arch, per);
    if (!link.ok) {
      omitidas += 1;
      detalle.push({ archivo_id: arch.id, nombre: arch.nombre, error: link.error });
      continue;
    }
    if (link.accion === 'creada') creadas += 1;
    else if (link.accion === 'vinculada') vinculadas += 1;

    if (exportarExcel) {
      const tieneFilas = await db.query(
        'SELECT 1 FROM anexo_fidu_registros WHERE archivo_id = ? LIMIT 1',
        [arch.id]
      );
      const meta = await fetchAnexoArchivoMeta(arch.id);
      const necesitaExport = forzarExport || !meta?.ruta_export;
      if (tieneFilas.length && necesitaExport) {
        const exp = await guardarExportAnexoEnSoportes(arch.id);
        if (exp.ok) exportadas += 1;
        else detalle.push({ archivo_id: arch.id, nombre: arch.nombre, export_error: exp.error || exp.reason });
      }
    }
  }

  return {
    ok: true,
    total_modulo: archivos.length,
    creadas,
    vinculadas,
    exportadas,
    omitidas,
    detalle
  };
}

async function syncAnexoModuloPorCarpetaId(carpetaId, options = {}) {
  const periodoIds = await periodoIdsPorCarpetaAnexo(carpetaId);
  const results = [];
  for (const pid of periodoIds) {
    results.push({ periodo_id: pid, ...(await syncAnexoModuloASoportesPeriodo(pid, options)) });
  }
  return { ok: true, periodos: results };
}

async function guardarExportAnexoEnSoportes(archivoId) {
  const meta = await fetchAnexoArchivoMeta(archivoId);
  if (!meta) return { ok: false, error: 'Anexo no encontrado' };

  const dia = await resolverSopDiaAnexo(archivoId, meta);
  if (!dia) return { ok: false, skipped: true, reason: 'sin_vinculo_soportes' };

  const parentRows = dia.parent_id
    ? await db.query('SELECT nombre_display FROM sop_dias WHERE id = ?', [dia.parent_id])
    : [];
  const contenedorNombre = parentRows[0]?.nombre_display || 'Anexo FIDU';
  const periodoRows = await db.query('SELECT periodo FROM sop_periodos WHERE id = ?', [dia.periodo_id]);
  const periodo = periodoRows[0]?.periodo;
  if (!periodo) return { ok: false, error: 'Periodo no encontrado' };

  const rows = await db.query(
    'SELECT * FROM anexo_fidu_registros WHERE archivo_id = ? ORDER BY id ASC',
    [archivoId]
  );
  const { buffer, filename } = await buildAnexoFiduExcelBuffer(rows, { nombreArchivo: meta.nombre });
  const relDir = getArmadoAnexoDir(periodo, contenedorNombre, dia.nombre_display);
  const absDir = path.join(soportesRoot(), relDir);
  ensureDir(absDir);
  const absPath = path.join(absDir, filename);
  fs.writeFileSync(absPath, Buffer.from(buffer));
  const rutaExport = path.join(relDir, filename).replace(/\\/g, '/');

  await db.execute(
    'UPDATE anexo_fidu_archivos SET ruta_export = ?, sop_dia_id = COALESCE(sop_dia_id, ?) WHERE id = ?',
    [rutaExport, dia.id, archivoId]
  );
  await db.execute('UPDATE sop_dias SET anexo_archivo_id = ? WHERE id = ?', [archivoId, dia.id]);

  return { ok: true, ruta_export: rutaExport, filename };
}

module.exports = {
  guardarExportAnexoEnSoportes,
  syncAnexoModuloASoportesPeriodo,
  syncAnexoModuloPorCarpetaId,
  periodoIdsPorCarpetaAnexo,
  fetchAnexoArchivoMeta,
  resolverSopDiaAnexo
};
