/**
 * Detección de duplicados PDX y borrado seguro del PDF en disco.
 */
const { detectarTemaCarpeta, esTemaConsultaMedica } = require('./soportes-temas');

const TEMAS_CON_DOCUMENTO = ['ordenes', 'comprobantes', 'consentimientos'];

/** Consultas médicas: duplicado solo si coinciden paciente + fecha + especialidad (+ tipo consulta en comprobantes). */
function esDuplicadoConsultaMedica(meta, existente, opts = {}) {
  const norm = String(meta?.paciente_nombre_norm || '').trim();
  const fecha = String(meta?.fecha_estudio || '').trim();
  const estudio = String(meta?.estudio_texto || '').trim();
  if (!norm || !fecha || !estudio) return false;
  if (norm !== String(existente?.paciente_nombre_norm || '').trim()) return false;
  if (fecha !== String(existente?.fecha_estudio || '').trim()) return false;
  if (estudio !== String(existente?.estudio_texto || '').trim()) return false;
  if (opts.incluirTipoConsulta) {
    const tipo = String(meta?.marca_tiempo || meta?.tipo_consulta || '').trim();
    const tipoEx = String(existente?.marca_tiempo || existente?.tipo_consulta || '').trim();
    if (tipo !== tipoEx) return false;
  }
  return true;
}

function mensajeDuplicadoPdx(dup) {
  const row = dup?.row || {};
  const nombre = row.paciente_nombre || row.nombre_archivo_display || 'registro existente';
  return `Ya existe un archivo con los mismos datos en esta carpeta (${nombre}). No se permiten duplicados.`;
}

async function buscarPorNombreDisplay(db, carpetaId, meta, excludeId) {
  if (!meta.nombre_archivo_display) return null;
  const paramsDisplay = [carpetaId, meta.nombre_archivo_display];
  let sqlDisplay = `SELECT id, paciente_nombre, nombre_archivo_display, ruta_relativa, paciente_nombre_norm, fecha_estudio, estudio_texto
     FROM sop_pdx_archivos WHERE carpeta_id = ? AND nombre_archivo_display = ?`;
  if (excludeId) {
    sqlDisplay += ' AND id <> ?';
    paramsDisplay.push(excludeId);
  }
  sqlDisplay += ' LIMIT 1';
  try {
    const byDisplay = await db.query(sqlDisplay, paramsDisplay);
    if (byDisplay.length) return { row: byDisplay[0], motivo: 'nombre_display' };
  } catch (e) {
    if (e.code !== 'ER_BAD_FIELD_ERROR') throw e;
    /* esquema antiguo sin nombre_archivo_display */
  }
  return null;
}

async function buscarDuplicadoPdxEnCarpeta(db, carpetaId, meta, carpeta = null, opts = {}) {
  if (!carpetaId || !meta) return null;
  try {
    const tema = detectarTemaCarpeta(carpeta?.nombre_display || '');
    const excludeId = opts.excludeId != null ? parseInt(opts.excludeId, 10) : null;
    const consultaMedica = esTemaConsultaMedica(tema);

    if (!consultaMedica) {
      const byName = await buscarPorNombreDisplay(db, carpetaId, meta, excludeId);
      if (byName) return byName;
    }

    // Para temas con documento (ordenes, comprobantes, consentimientos), buscar por documento+fecha.
    // NO incluir estudio_texto, ya que puede cambiar sin que sea duplicado (ej: cambio de especialidad).
    if (TEMAS_CON_DOCUMENTO.includes(tema)) {
      const doc = String(meta.paciente_documento || '').trim();
      const fecha = meta.fecha_estudio;
      if (!doc || !fecha) return null;

      const params = [carpetaId, doc, fecha];
      let sql = `SELECT id, paciente_nombre, nombre_archivo_display, ruta_relativa, paciente_nombre_norm, fecha_estudio, estudio_texto, marca_tiempo
      FROM sop_pdx_archivos
      WHERE carpeta_id = ? AND paciente_documento = ? AND fecha_estudio = ?`;

      if (excludeId) {
        sql += ' AND id <> ?';
        params.push(excludeId);
      }

      sql += ' LIMIT 1';
      const byDocFecha = await db.query(sql, params);
      if (byDocFecha.length) return { row: byDocFecha[0], motivo: 'documento_fecha' };
      return null;
    }

    if (tema === 'comprobantes_consulta_medica') {
      const norm = meta.paciente_nombre_norm;
      const fecha = meta.fecha_estudio;
      const estudio = meta.estudio_texto;
      const tipo = String(meta.marca_tiempo || meta.tipo_consulta || '').trim();
      if (!norm || !fecha || !estudio) return null;

      const params = [carpetaId, norm, fecha, estudio];
      let sql = `SELECT id, paciente_nombre, nombre_archivo_display, ruta_relativa, paciente_nombre_norm, fecha_estudio, estudio_texto, marca_tiempo
      FROM sop_pdx_archivos
      WHERE carpeta_id = ? AND paciente_nombre_norm = ? AND fecha_estudio = ? AND estudio_texto = ?`;

      if (tipo) {
        sql += ' AND COALESCE(marca_tiempo, \'\') = ?';
        params.push(tipo);
      } else {
        sql += ' AND (marca_tiempo IS NULL OR marca_tiempo = \'\')';
      }

      if (excludeId) {
        sql += ' AND id <> ?';
        params.push(excludeId);
      }

      sql += ' LIMIT 1';
      const byComprobante = await db.query(sql, params);
      if (byComprobante.length) return { row: byComprobante[0], motivo: 'comprobante_consulta' };
      return null;
    }

    // Para otros temas (sin documento), buscar por nombre normalizado + fecha + estudio
    const norm = meta.paciente_nombre_norm;
    const fecha = meta.fecha_estudio;
    const estudio = meta.estudio_texto;
    if (!norm || !fecha || !estudio) return null;

    const params = [carpetaId, norm, fecha, estudio];
    let sql = `SELECT id, paciente_nombre, nombre_archivo_display, ruta_relativa, paciente_nombre_norm, fecha_estudio, estudio_texto
    FROM sop_pdx_archivos
    WHERE carpeta_id = ? AND paciente_nombre_norm = ? AND fecha_estudio = ? AND estudio_texto = ?`;

    if (excludeId) {
      sql += ' AND id <> ?';
      params.push(excludeId);
    }

    sql += ' LIMIT 1';
    const byDatos = await db.query(sql, params);
    if (byDatos.length) return { row: byDatos[0], motivo: 'datos' };
    return null;
  } catch (e) {
    if (e.code === 'ER_NO_SUCH_TABLE' || e.code === 'ER_BAD_FIELD_ERROR') return null;
    throw e;
  }
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
  esDuplicadoConsultaMedica,
  buscarDuplicadoPdxEnCarpeta,
  cuentaReferenciasRutaPdx
};
