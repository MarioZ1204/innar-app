/**
 * Ingesta de archivos RIPS (.json) desde World Office hacia la estructura Soportes.
 * Mes → carpeta día → RIPS → FE{n}
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('./db-mysql');
const { periodoFromDate, calcularVisibilidadPeriodo } = require('./soportes-visibilidad');
const { ensureContenedoresForDia, parseFeCodigo, calcularCarpetaFisica } = require('./soportes-armado-structure');
const { getArmadoFeDirFromContext, getArmadoFeDirForExpediente, SOPORTES_ROOT } = require('./soportes-storage');

const MAX_JSON_BYTES = 5 * 1024 * 1024;

function periodoEtiqueta(periodo) {
  const [y, m] = String(periodo).split('-').map(Number);
  const meses = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];
  return `${meses[(m || 1) - 1]} ${y}`;
}

async function findOrCreatePeriodo(periodo, autoCreate) {
  const rows = await db.query('SELECT * FROM sop_periodos WHERE periodo = ?', [periodo]);
  if (rows.length) return rows[0];
  if (!autoCreate) return null;
  const vis = calcularVisibilidadPeriodo(periodo);
  const r = await db.execute(
    'INSERT INTO sop_periodos (periodo, etiqueta, estado_visibilidad, creado_por) VALUES (?,?,?,NULL)',
    [periodo, periodoEtiqueta(periodo), vis]
  );
  const created = await db.query('SELECT * FROM sop_periodos WHERE id = ?', [r.insertId]);
  return created[0];
}

async function findOrCreateDia(periodoId, nombreDisplay, estadoFacturacion, autoCreate) {
  const estado = estadoFacturacion === 'facturados' ? 'facturados' : 'a_facturar';
  const rows = await db.query(
    'SELECT * FROM sop_dias WHERE periodo_id = ? AND nombre_display = ?',
    [periodoId, nombreDisplay]
  );
  if (rows.length) return rows[0];
  if (!autoCreate) return null;
  const per = await db.query('SELECT periodo FROM sop_periodos WHERE id = ?', [periodoId]);
  const fecha = per[0] ? `${per[0].periodo}-01` : periodoFromDate(new Date());
  const { nextSopDiaNumero } = require('./soportes-armado-structure');
  const { insertRowId } = require('./db-insert-id');
  const diaNum = await nextSopDiaNumero(db, periodoId);
  const r = await db.execute(
    'INSERT INTO sop_dias (periodo_id, dia, fecha, nombre_display, estado_facturacion) VALUES (?,?,?,?,?)',
    [periodoId, diaNum, fecha, nombreDisplay, estado]
  );
  const diaId = insertRowId(r);
  await ensureContenedoresForDia(db, diaId);
  const created = await db.query('SELECT * FROM sop_dias WHERE id = ?', [diaId]);
  return created[0];
}

async function getRipsContenedor(diaId) {
  await ensureContenedoresForDia(db, diaId);
  const rows = await db.query(
    "SELECT * FROM sop_contenedores WHERE dia_id = ? AND tipo = 'rips' LIMIT 1",
    [diaId]
  );
  return rows[0] || null;
}

async function findOrCreateExpedienteFe(contenedorId, diaId, codigo, numero, autoCreate) {
  const existing = await db.query(
    'SELECT * FROM sop_expedientes WHERE contenedor_id = ? AND codigo = ?',
    [contenedorId, codigo]
  );
  if (existing.length) return { expediente: existing[0], created: false };

  if (!autoCreate) return { expediente: null, created: false };

  const ctx = await db.query(
    `SELECT c.tipo AS contenedor_tipo, d.nombre_display, d.estado_facturacion, d.dia, p.periodo
     FROM sop_contenedores c
     JOIN sop_dias d ON d.id = c.dia_id
     JOIN sop_periodos p ON p.id = d.periodo_id
     WHERE c.id = ?`,
    [contenedorId]
  );
  if (!ctx.length) return { expediente: null, created: false };

  const r = await db.execute(
    `INSERT INTO sop_expedientes (dia_id, contenedor_id, codigo, numero_factura, paciente_nombre, paciente_documento, tipo_servicio, creado_por)
     VALUES (?,?,?,?,?,?,?,NULL)`,
    [contenedorId, diaId, codigo, numero, null, null, 'electro']
  );
  const expId = r.insertId;
  // Carpeta física INMUTABLE: nunca se renombra aunque el código cambie después.
  const carpetaFisica = calcularCarpetaFisica(codigo, expId);
  await db.execute('UPDATE sop_expedientes SET carpeta_fisica = ? WHERE id = ?', [carpetaFisica, expId]);
  getArmadoFeDirFromContext(ctx[0], carpetaFisica);

  const exp = await db.query('SELECT * FROM sop_expedientes WHERE id = ?', [expId]);
  return { expediente: exp[0], created: true };
}

function safeJsonFilename(codigo, suggested) {
  const base = String(suggested || `${codigo}-rips.json`)
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '_');
  return base.toLowerCase().endsWith('.json') ? base : `${base}.json`;
}

/**
 * @param {object} payload
 * @param {string} payload.periodo - YYYY-MM
 * @param {string} payload.nombre_carpeta_dia
 * @param {'facturados'|'a_facturar'} payload.estado_facturacion
 * @param {string} [payload.codigo_fe] - FE12
 * @param {number} [payload.numero_factura]
 * @param {object} payload.contenido - JSON RIPS
 * @param {string} [payload.nombre_archivo]
 * @param {boolean} [payload.reemplazar] - si true, sobrescribe JSON existente del mismo nombre
 */
async function ingestRipsJson(payload, options = {}) {
  const autoCreate = options.autoCreate !== false;
  const periodo = String(payload.periodo || '').trim();
  if (!/^\d{4}-\d{2}$/.test(periodo)) {
    return { ok: false, status: 400, error: 'periodo inválido (use YYYY-MM)' };
  }
  const nombreCarpeta = String(payload.nombre_carpeta_dia || '').trim();
  if (!nombreCarpeta) {
    return { ok: false, status: 400, error: 'nombre_carpeta_dia es obligatorio' };
  }
  const estadoFacturacion = payload.estado_facturacion === 'facturados' ? 'facturados' : 'a_facturar';

  let codigo;
  let numero;
  if (payload.codigo_fe) {
    const parsed = parseFeCodigo(payload.codigo_fe);
    if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
    codigo = parsed.codigo;
    numero = parsed.numero;
  } else if (payload.numero_factura) {
    numero = parseInt(payload.numero_factura, 10);
    if (!numero || numero < 1) return { ok: false, status: 400, error: 'numero_factura inválido' };
    codigo = `FE${numero}`;
  } else {
    return { ok: false, status: 400, error: 'codigo_fe o numero_factura es obligatorio' };
  }

  const contenido = payload.contenido;
  if (contenido == null || typeof contenido !== 'object' || Array.isArray(contenido)) {
    return { ok: false, status: 400, error: 'contenido debe ser un objeto JSON' };
  }

  const jsonStr = JSON.stringify(contenido);
  if (Buffer.byteLength(jsonStr, 'utf8') > MAX_JSON_BYTES) {
    return { ok: false, status: 413, error: 'JSON demasiado grande (máx. 5 MB)' };
  }

  const per = await findOrCreatePeriodo(periodo, autoCreate);
  if (!per) {
    return { ok: false, status: 404, error: `No existe el mes ${periodo}. Cree la carpeta del mes en Soportes o active auto-creación.` };
  }

  const dia = await findOrCreateDia(per.id, nombreCarpeta, estadoFacturacion, autoCreate);
  if (!dia) {
    return { ok: false, status: 404, error: `No existe la carpeta de día «${nombreCarpeta}».` };
  }

  const contenedor = await getRipsContenedor(dia.id);
  if (!contenedor) {
    return { ok: false, status: 500, error: 'No se pudo obtener la carpeta RIPS' };
  }

  const { expediente, created: feCreated } = await findOrCreateExpedienteFe(
    contenedor.id,
    dia.id,
    codigo,
    numero,
    autoCreate
  );
  if (!expediente) {
    return { ok: false, status: 404, error: `No existe la carpeta ${codigo} en RIPS.` };
  }

  const ctx = {
    periodo: per.periodo,
    nombre_display: dia.nombre_display,
    estado_facturacion: dia.estado_facturacion,
    contenedor_tipo: 'rips',
    dia: dia.dia
  };
  const { abs: feDir, rel: feRel } = getArmadoFeDirForExpediente(ctx, expediente);
  const fileNameOrig = safeJsonFilename(codigo, payload.nombre_archivo);
  const { buildCanonicalName } = require('./soportes-archivo-detect');
  const diskName = buildCanonicalName('RIPS_JSON_1', numero, '.json');
  const destPath2 = path.join(feDir, diskName);
  if (fs.existsSync(destPath2)) fs.unlinkSync(destPath2);
  fs.writeFileSync(destPath2, jsonStr, 'utf8');
  const tamano = Buffer.byteLength(jsonStr, 'utf8');
  const hash = crypto.createHash('sha256').update(jsonStr).digest('hex');
  const rutaFinal = path.join(feRel, diskName).replace(/\\/g, '/');

  let archivoId = null;
  try {
    await db.execute('DELETE FROM sop_rips_archivos WHERE expediente_id = ? AND slot = ?', [expediente.id, 'json_1']);
    const ins = await db.execute(
      `INSERT INTO sop_rips_archivos (expediente_id, contenedor_id, slot, nombre_archivo, nombre_original, ruta_relativa, tamano_bytes, hash_sha256, origen)
       VALUES (?,?,?,?,?,?,?, 'worldoffice_api')`,
      [expediente.id, contenedor.id, 'json_1', diskName, fileNameOrig, rutaFinal, tamano, hash]
    );
    archivoId = ins.insertId;
  } catch (_) {
    /* tabla opcional si migración pendiente */
  }

  return {
    ok: true,
    status: 201,
    periodo,
    nombre_carpeta_dia: nombreCarpeta,
    estado_facturacion: estadoFacturacion,
    contenedor: 'rips',
    codigo_fe: codigo,
    expediente_id: expediente.id,
    archivo_id: archivoId,
    nombre_archivo: diskName,
    ruta_relativa: path.join('soportes', rutaFinal).replace(/\\/g, '/'),
    expediente_creado: feCreated,
    reemplazado: !!payload.reemplazar
  };
}

module.exports = {
  ingestRipsJson,
  MAX_JSON_BYTES
};
