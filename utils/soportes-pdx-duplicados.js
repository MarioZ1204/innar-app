/**
 * Detección de duplicados PDX y borrado seguro del PDF en disco.
 */
const { detectarTemaCarpeta } = require('./soportes-temas');

const TEMAS_CON_DOCUMENTO = ['ordenes', 'comprobantes', 'consentimientos'];

function mensajeDuplicadoPdx(dup) {
  const row = dup?.row || {};
  const nombre = row.paciente_nombre || row.nombre_archivo_display || 'registro existente';
  return `Ya existe un archivo con los mismos datos en esta carpeta (${nombre}). No se permiten duplicados.`;
}

async function buscarDuplicadoPdxEnCarpeta(db, carpetaId, meta, carpeta = null) {
  if (!carpetaId || !meta) return null;
  const tema = detectarTemaCarpeta(carpeta?.nombre_display || '');

  if (meta.nombre_archivo_display) {
    const byDisplay = await db.query(
      `SELECT id, paciente_nombre, nombre_archivo_display, ruta_relativa
       FROM sop_pdx_archivos WHERE carpeta_id = ? AND nombre_archivo_display = ? LIMIT 1`,
      [carpetaId, meta.nombre_archivo_display]
    );
    if (byDisplay.length) return { row: byDisplay[0], motivo: 'nombre_display' };
  }

  const norm = meta.paciente_nombre_norm;
  const fecha = meta.fecha_estudio;
  const estudio = meta.estudio_texto;
  if (!norm || !fecha || !estudio) return null;

  const params = [carpetaId, norm, fecha, estudio];
  let sql = `SELECT id, paciente_nombre, nombre_archivo_display, ruta_relativa
    FROM sop_pdx_archivos
    WHERE carpeta_id = ? AND paciente_nombre_norm = ? AND fecha_estudio = ? AND estudio_texto = ?`;

  if (TEMAS_CON_DOCUMENTO.includes(tema)) {
    const doc = String(meta.paciente_documento || '').trim();
    if (!doc) return null;
    sql += ' AND paciente_documento = ?';
    params.push(doc);
  }

  sql += ' LIMIT 1';
  const byDatos = await db.query(sql, params);
  if (byDatos.length) return { row: byDatos[0], motivo: 'datos' };
  return null;
}

async function cuentaReferenciasRutaPdx(db, carpetaId, rutaRelativa, excludeId = null) {
  if (!carpetaId || !rutaRelativa) return 0;
  const params = [carpetaId, rutaRelativa];
  let sql = 'SELECT COUNT(*) AS n FROM sop_pdx_archivos WHERE carpeta_id = ? AND ruta_relativa = ?';
  if (excludeId != null) {
    sql += ' AND id <> ?';
    params.push(excludeId);
  }
  const rows = await db.query(sql, params);
  return parseInt(rows[0]?.n, 10) || 0;
}

module.exports = {
  mensajeDuplicadoPdx,
  buscarDuplicadoPdxEnCarpeta,
  cuentaReferenciasRutaPdx
};
