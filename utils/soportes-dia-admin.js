/**
 * Edición y eliminación de carpetas de día (sop_dias) en armado de soportes.
 */
const path = require('path');
const fs = require('fs');
const db = require('./db-mysql');
const { SOPORTES_ROOT } = require('./soportes-storage');
const { sanitizePathSegment, facturacionDir } = require('./soportes-armado-structure');
const { eliminarExpediente } = require('./soportes-expediente-admin');

async function loadDiaConPeriodo(diaId) {
  const rows = await db.query(
    `SELECT d.*, p.periodo FROM sop_dias d
     JOIN sop_periodos p ON p.id = d.periodo_id
     WHERE d.id = ?`,
    [diaId]
  );
  return rows[0] || null;
}

function diaDirAbs(periodo, nombreDisplay) {
  return path.join(SOPORTES_ROOT, 'armado', String(periodo), sanitizePathSegment(nombreDisplay));
}

function renombrarDirSiExiste(oldAbs, newAbs) {
  if (!fs.existsSync(oldAbs)) return;
  const parent = path.dirname(newAbs);
  if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
  if (fs.existsSync(newAbs)) {
    for (const f of fs.readdirSync(oldAbs)) {
      const src = path.join(oldAbs, f);
      const dst = path.join(newAbs, f);
      if (fs.existsSync(dst)) {
        if (fs.statSync(dst).isDirectory()) {
          for (const inner of fs.readdirSync(src)) {
            const isrc = path.join(src, inner);
            const idst = path.join(dst, inner);
            if (fs.existsSync(idst)) fs.rmSync(idst, { recursive: true, force: true });
            fs.renameSync(isrc, idst);
          }
          try { fs.rmdirSync(src); } catch (_) { /* ignore */ }
        } else {
          fs.unlinkSync(dst);
          fs.renameSync(src, dst);
        }
      } else {
        fs.renameSync(src, dst);
      }
    }
    try { fs.rmdirSync(oldAbs); } catch (_) { /* ignore */ }
  } else {
    fs.renameSync(oldAbs, newAbs);
  }
}

async function renombrarCarpetasDiaEnDisco(periodo, oldNombre, newNombre, oldEstado, newEstado) {
  const oldNom = sanitizePathSegment(oldNombre);
  const newNom = sanitizePathSegment(newNombre);
  if (oldNom !== newNom) {
    renombrarDirSiExiste(diaDirAbs(periodo, oldNom), diaDirAbs(periodo, newNom));
  }
  if (oldEstado !== newEstado) {
    const base = diaDirAbs(periodo, newNom);
    const oldEst = path.join(base, facturacionDir(oldEstado));
    const newEst = path.join(base, facturacionDir(newEstado));
    renombrarDirSiExiste(oldEst, newEst);
  }
}

async function actualizarDia(diaId, body) {
  const dia = await loadDiaConPeriodo(diaId);
  if (!dia) return { error: 'Carpeta de día no encontrada', status: 404 };

  const nombre_display = body.nombre_display != null
    ? String(body.nombre_display).trim()
    : dia.nombre_display;
  const estado_facturacion = body.estado_facturacion === 'facturados' ? 'facturados' : 'a_facturar';

  if (!nombre_display) {
    return { error: 'Indique el nombre de la carpeta del día', status: 400 };
  }

  const dup = await db.query(
    'SELECT id FROM sop_dias WHERE periodo_id = ? AND nombre_display = ? AND id <> ?',
    [dia.periodo_id, nombre_display, diaId]
  );
  if (dup.length) {
    return { error: 'Ya existe otra carpeta con ese nombre en el mes', status: 409 };
  }

  const oldNombre = dia.nombre_display;
  const oldEstado = dia.estado_facturacion;

  if (nombre_display !== oldNombre || estado_facturacion !== oldEstado) {
    await renombrarCarpetasDiaEnDisco(dia.periodo, oldNombre, nombre_display, oldEstado, estado_facturacion);
  }

  await db.execute(
    'UPDATE sop_dias SET nombre_display = ?, estado_facturacion = ? WHERE id = ?',
    [nombre_display, estado_facturacion, diaId]
  );

  const row = await loadDiaConPeriodo(diaId);
  return { ok: true, dia: row };
}

async function eliminarDia(diaId) {
  const dia = await loadDiaConPeriodo(diaId);
  if (!dia) return { error: 'Carpeta de día no encontrada', status: 404 };

  const codigos = await db.query(
    'SELECT DISTINCT codigo FROM sop_expedientes WHERE dia_id = ?',
    [diaId]
  );

  for (const row of codigos) {
    const exp = await db.query(
      'SELECT id FROM sop_expedientes WHERE dia_id = ? AND codigo = ? LIMIT 1',
      [diaId, row.codigo]
    );
    if (exp.length) {
      const result = await eliminarExpediente(exp[0].id);
      if (result.error) return result;
    }
  }

  const diaPath = diaDirAbs(dia.periodo, dia.nombre_display);
  if (fs.existsSync(diaPath)) {
    try {
      fs.rmSync(diaPath, { recursive: true, force: true });
    } catch (_) { /* ignore */ }
  }

  await db.execute('DELETE FROM sop_dias WHERE id = ?', [diaId]);

  return {
    ok: true,
    nombre_display: dia.nombre_display,
    expedientes_grupos: codigos.length
  };
}

module.exports = {
  actualizarDia,
  eliminarDia
};
