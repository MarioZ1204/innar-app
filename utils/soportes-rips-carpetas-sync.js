/**
 * Sincroniza en disco las carpetas RIPS/FE{n} según las facturas (expedientes SOPORTES) del día.
 */
const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const {
  ensureContenedoresForDia,
  ensureFeParEnContenedorHermano,
  getArmadoFeDirAbs,
  numeroFeExpediente
} = require('./soportes-armado-structure');
const sopStorage = require('./soportes-storage');

function vaciarDirectorioSiExiste(abs) {
  if (!abs) return;
  if (!fs.existsSync(abs)) {
    fs.mkdirSync(abs, { recursive: true });
    return;
  }
  for (const entry of fs.readdirSync(abs)) {
    const entryPath = path.join(abs, entry);
    fs.rmSync(entryPath, { recursive: true, force: true });
  }
}

function codigoFacturaDesdeExp(exp) {
  const n = numeroFeExpediente(exp);
  if (n > 0) return `FE${n}`;
  const cod = String(exp.codigo || '').trim();
  if (cod) return cod;
  return `FE${exp.id}`;
}

async function ensureRipsCarpetaFacturaEnDisco(db, diaId, codigoFactura) {
  try {
    const ctx = await db.query(
      `SELECT d.nombre_display, d.estado_facturacion, p.periodo
       FROM sop_dias d
       JOIN sop_periodos p ON p.id = d.periodo_id
       WHERE d.id = ?`,
      [diaId]
    );
    if (!ctx.length) return null;
    const row = ctx[0];
    const { abs } = getArmadoFeDirAbs(
      sopStorage.soportesRoot,
      row.periodo,
      row.nombre_display,
      row.estado_facturacion,
      'rips',
      codigoFactura
    );
    vaciarDirectorioSiExiste(abs);
    return abs;
  } catch (e) {
    logger.warn('[SOPORTES] RIPS carpeta disco:', e.message);
    return null;
  }
}

/**
 * Por cada expediente SOPORTES del día: carpeta RIPS/FE en disco + par en BD si falta.
 */
async function syncRipsCarpetasDia(db, diaId, usuarioId = null) {
  try {
    await ensureContenedoresForDia(db, diaId);
  } catch (e) {
    logger.warn('[SOPORTES] sync RIPS contenedores:', e.message);
    return [];
  }
  let soportes = [];
  try {
    soportes = await db.query(
      `SELECT e.*, c.id AS contenedor_id
       FROM sop_expedientes e
       JOIN sop_contenedores c ON c.id = e.contenedor_id AND c.tipo = 'soportes'
       WHERE e.dia_id = ?`,
      [diaId]
    );
  } catch (e) {
    logger.warn('[SOPORTES] sync RIPS query:', e.message);
    return [];
  }
  const sincronizadas = [];
  for (const exp of soportes) {
    try {
      const codigo = codigoFacturaDesdeExp(exp);
      const ruta = await ensureRipsCarpetaFacturaEnDisco(db, diaId, codigo);
      try {
        await ensureFeParEnContenedorHermano(
          db,
          diaId,
          exp.contenedor_id,
          codigo,
          exp.numero_factura,
          exp.tipo_servicio || 'electro',
          usuarioId || exp.creado_por || null,
          exp.paciente_nombre
        );
      } catch (e) {
        /* par ya existe o duplicado */
      }
      sincronizadas.push({ codigo, ruta });
    } catch (e) {
      logger.warn('[SOPORTES] sync RIPS expediente:', e.message);
    }
  }
  return sincronizadas;
}

async function syncRipsCarpetasPeriodo(db, periodoId, usuarioId = null) {
  try {
    const dias = await db.query('SELECT id FROM sop_dias WHERE periodo_id = ?', [periodoId]);
    const todas = [];
    for (const d of dias) {
      const part = await syncRipsCarpetasDia(db, d.id, usuarioId);
      todas.push(...part);
    }
    return todas;
  } catch (e) {
    logger.warn('[SOPORTES] sync RIPS periodo:', e.message);
    return [];
  }
}

async function syncRipsCarpetasDias(db, dias, usuarioId = null) {
  const lista = Array.isArray(dias) ? dias : [dias];
  const todas = [];
  const syncDia = module.exports.syncRipsCarpetasDia || syncRipsCarpetasDia;
  for (const diaId of lista) {
    if (!diaId && diaId !== 0) continue;
    const part = await syncDia(db, diaId, usuarioId);
    todas.push(...part);
  }
  return todas;
}

module.exports = {
  codigoFacturaDesdeExp,
  ensureRipsCarpetaFacturaEnDisco,
  syncRipsCarpetasDia,
  syncRipsCarpetasPeriodo,
  syncRipsCarpetasDias,
};
