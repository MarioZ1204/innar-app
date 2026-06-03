/**
 * Estructura Soportes: Mes → carpeta día (FACTURADOS|A FACTURAR) → RIPS|SOPORTES → FE{n}
 */
const path = require('path');
const { ensureDir } = require('./soportes-storage');
const { insertRowId } = require('./db-insert-id');

const CONTENEDOR_TIPOS = ['rips', 'soportes'];

function sanitizePathSegment(name) {
  return String(name || 'carpeta')
    .trim()
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .slice(0, 80) || 'carpeta';
}

function facturacionDir(estado) {
  return estado === 'facturados' ? 'FACTURADOS' : 'A_FACTURAR';
}

function contenedorDir(tipo) {
  return String(tipo || 'soportes').toLowerCase() === 'rips' ? 'RIPS' : 'SOPORTES';
}

function getArmadoContenedorBaseDir(periodo, diaNombre, estadoFacturacion, tipoContenedor) {
  const base = path.join(
    'armado',
    String(periodo),
    sanitizePathSegment(diaNombre),
    facturacionDir(estadoFacturacion),
    contenedorDir(tipoContenedor)
  );
  return base;
}

function getArmadoFeDirAbs(root, periodo, diaNombre, estadoFacturacion, tipoContenedor, codigo) {
  const rel = path.join(
    getArmadoContenedorBaseDir(periodo, diaNombre, estadoFacturacion, tipoContenedor),
    String(codigo || 'FE0')
  );
  const abs = path.join(root, rel);
  ensureDir(abs);
  return { abs, rel: rel.replace(/\\/g, '/') };
}

function parseFeCodigo(input) {
  const raw = String(input || '').trim().toUpperCase();
  const m = raw.match(/^FE(\d+)$/);
  if (m) return { ok: true, codigo: `FE${m[1]}`, numero: parseInt(m[1], 10) };
  const n = parseInt(raw.replace(/\D/g, ''), 10);
  if (n > 0) return { ok: true, codigo: `FE${n}`, numero: n };
  return { ok: false, error: 'Use el formato FE{número}, por ejemplo FE12' };
}

function badgeFacturacion(estado) {
  if (estado === 'facturados') {
    return '<span class="sop-badge sop-badge-listo" style="margin:0">Facturados</span>';
  }
  return '<span class="sop-badge sop-badge-pendiente" style="margin:0">A facturar</span>';
}

async function ensureFeParEnContenedorHermano(db, diaId, contenedorId, codigo, numero, tipoServicio, usuarioId, pacienteNombre = null) {
  await ensureContenedoresForDia(db, diaId);
  const rows = await db.query('SELECT tipo FROM sop_contenedores WHERE id = ?', [contenedorId]);
  if (!rows.length) return null;
  const hermanoTipo = rows[0].tipo === 'rips' ? 'soportes' : 'rips';
  const hermano = await db.query(
    'SELECT id FROM sop_contenedores WHERE dia_id = ? AND tipo = ?',
    [diaId, hermanoTipo]
  );
  if (!hermano.length) return null;
  const exists = await db.query(
    'SELECT id FROM sop_expedientes WHERE contenedor_id = ? AND codigo = ?',
    [hermano[0].id, codigo]
  );
  if (exists.length) return exists[0].id;
  const ctx = await db.query(
    `SELECT c.tipo AS contenedor_tipo, d.nombre_display, d.estado_facturacion, d.dia, p.periodo
     FROM sop_contenedores c JOIN sop_dias d ON d.id = c.dia_id JOIN sop_periodos p ON p.id = d.periodo_id
     WHERE c.id = ?`,
    [hermano[0].id]
  );
  if (ctx.length) {
    getArmadoFeDirAbs(
      require('./soportes-storage').SOPORTES_ROOT,
      ctx[0].periodo,
      ctx[0].nombre_display,
      ctx[0].estado_facturacion,
      ctx[0].contenedor_tipo,
      codigo
    );
  }
  try {
    const r = await db.execute(
      `INSERT INTO sop_expedientes (dia_id, contenedor_id, codigo, numero_factura, paciente_nombre, paciente_documento, tipo_servicio, creado_por)
       VALUES (?,?,?,?,?,?,?,?)`,
      [diaId, hermano[0].id, codigo, numero, pacienteNombre, null, tipoServicio, usuarioId]
    );
    return insertRowId(r);
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY' || String(e.message || '').includes('Duplicate')) {
      const again = await db.query(
        'SELECT id FROM sop_expedientes WHERE contenedor_id = ? AND codigo = ?',
        [hermano[0].id, codigo]
      );
      if (again.length) return again[0].id;
    }
    throw e;
  }
}

/** Número secuencial de día dentro del mes (evita uk_sop_dia periodo_id+dia con dia=0 fijo). */
async function nextSopDiaNumero(db, periodoId) {
  const pid = parseInt(periodoId, 10);
  if (!pid) return 1;
  const rows = await db.query(
    'SELECT COALESCE(MAX(dia), 0) AS mx FROM sop_dias WHERE periodo_id = ?',
    [pid]
  );
  const mx = parseInt(rows[0]?.mx, 10) || 0;
  return Math.min(mx + 1, 255);
}

async function ensureContenedoresForDia(db, diaId) {
  for (const tipo of CONTENEDOR_TIPOS) {
    const exists = await db.query(
      'SELECT id FROM sop_contenedores WHERE dia_id = ? AND tipo = ?',
      [diaId, tipo]
    );
    if (!exists.length) {
      await db.execute('INSERT INTO sop_contenedores (dia_id, tipo) VALUES (?,?)', [diaId, tipo]);
    }
  }
}

module.exports = {
  CONTENEDOR_TIPOS,
  sanitizePathSegment,
  facturacionDir,
  contenedorDir,
  getArmadoContenedorBaseDir,
  getArmadoFeDirAbs,
  parseFeCodigo,
  badgeFacturacion,
  nextSopDiaNumero,
  ensureContenedoresForDia,
  ensureFeParEnContenedorHermano
};
