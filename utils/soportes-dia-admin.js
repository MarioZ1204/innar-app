/**
 * Edición y eliminación de carpetas de día (sop_dias) en armado de soportes.
 */
const path = require('path');
const fs = require('fs');
const db = require('./db-mysql');
const { SOPORTES_ROOT } = require('./soportes-storage');
const { sanitizePathSegment, facturacionDir } = require('./soportes-armado-structure');
const { eliminarExpediente } = require('./soportes-expediente-admin');
const {
  normalizarModoDia,
  esModoUcqn,
  esModoAnexo,
  fetchDiaRow,
  getArmadoUcqnPersonaDir,
  getArmadoAnexoDir,
  nombreCarpetaPersonaUcqn
} = require('./soportes-armado-modos');

async function loadDiaConPeriodo(diaId) {
  const rows = await db.query(
    `SELECT d.*, p.periodo FROM sop_dias d
     JOIN sop_periodos p ON p.id = d.periodo_id
     WHERE d.id = ?`,
    [diaId]
  );
  return rows[0] || null;
}

function isContenedoraRaizFija(dia) {
  const parentId = Number(dia?.parent_id || 0);
  return parentId === 0 && Number(dia?.es_contenedor) === 1;
}

function renombrarDirSiExiste(oldAbs, newAbs) {
  if (!fs.existsSync(oldAbs)) return false;
  if (path.resolve(oldAbs) === path.resolve(newAbs)) return false;
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
  return true;
}

function toPosixRel(rel) {
  return String(rel || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

async function rewriteRutasPrefijo(oldRelRaw, newRelRaw) {
  const oldRel = toPosixRel(oldRelRaw);
  const newRel = toPosixRel(newRelRaw);
  if (!oldRel || !newRel || oldRel === newRel) return 0;

  const pairs = [[oldRel, newRel]];
  if (!oldRel.startsWith('soportes/')) {
    pairs.push([`soportes/${oldRel}`, `soportes/${newRel}`]);
  }

  let n = 0;
  const tables = [
    { table: 'sop_exp_archivos', col: 'ruta_relativa' },
    { table: 'sop_rips_archivos', col: 'ruta_relativa' },
    { table: 'anexo_fidu_archivos', col: 'ruta_export' }
  ];

  for (const { table, col } of tables) {
    for (const [from, to] of pairs) {
      let rows = [];
      try {
        rows = await db.query(
          `SELECT id, ${col} AS ruta FROM ${table}
           WHERE ${col} = ? OR ${col} LIKE ?`,
          [from, `${from}/%`]
        );
      } catch (e) {
        if (e.code === 'ER_NO_SUCH_TABLE' || e.code === 'ER_BAD_FIELD_ERROR') continue;
        throw e;
      }
      for (const row of rows) {
        const cur = toPosixRel(row.ruta);
        const next = cur === from ? to : `${to}${cur.slice(from.length)}`;
        if (next === cur) continue;
        await db.execute(`UPDATE ${table} SET ${col} = ? WHERE id = ?`, [next, row.id]);
        n += 1;
      }
    }
  }
  return n;
}

/**
 * Ruta relativa (bajo soportes/) de una carpeta de día en disco.
 * UCQN/Anexo: bajo el nombre del padre inmediato (igual que la subida).
 * Facturación: armado/{periodo}/{dia}.
 */
async function resolveDiaDiskRel(dia) {
  const periodo = dia.periodo;
  const modo = normalizarModoDia(dia.modo);
  const parentId = Number(dia.parent_id || 0);
  const nombre = dia.nombre_display;

  if (esModoUcqn(modo) || esModoAnexo(modo)) {
    if (!parentId) {
      return path.join('armado', String(periodo), sanitizePathSegment(nombre)).replace(/\\/g, '/');
    }
    const parent = await fetchDiaRow(db, parentId);
    const contenedorNombre = parent?.nombre_display
      || (esModoUcqn(modo) ? 'U C Q N' : 'Anexo FIDU');
    if (esModoUcqn(modo)) {
      return getArmadoUcqnPersonaDir(periodo, contenedorNombre, nombre);
    }
    return getArmadoAnexoDir(periodo, contenedorNombre, nombre);
  }

  return path.join('armado', String(periodo), sanitizePathSegment(nombre)).replace(/\\/g, '/');
}

/**
 * Prefijo de disco que usan los hijos cuando se renombra un contenedor intermedio UCQN/Anexo.
 * Las personas bajo «Mayo 1» viven en armado/{periodo}/Mayo 1/… (convención de subida).
 */
function contenedorIntermedioDiskRel(periodo, nombre) {
  return path.join('armado', String(periodo), sanitizePathSegment(nombre)).replace(/\\/g, '/');
}

async function renombrarCarpetasDiaEnDisco(dia, oldNombre, newNombre, oldEstado, newEstado) {
  const modo = normalizarModoDia(dia.modo);
  const renamed = [];

  if (esModoUcqn(modo) || esModoAnexo(modo)) {
    const oldLeaf = { ...dia, nombre_display: oldNombre };
    const newLeaf = { ...dia, nombre_display: newNombre };
    const oldRel = await resolveDiaDiskRel(oldLeaf);
    const newRel = await resolveDiaDiskRel(newLeaf);
    if (oldRel !== newRel) {
      renombrarDirSiExiste(path.join(SOPORTES_ROOT, oldRel), path.join(SOPORTES_ROOT, newRel));
      await rewriteRutasPrefijo(oldRel, newRel);
      renamed.push({ oldRel, newRel });
    }

    // Contenedor intermedio: además renombrar la carpeta raíz del periodo donde viven los hijos.
    if (Number(dia.es_contenedor) === 1 && Number(dia.parent_id || 0) > 0) {
      const oldCont = contenedorIntermedioDiskRel(dia.periodo, oldNombre);
      const newCont = contenedorIntermedioDiskRel(dia.periodo, newNombre);
      if (oldCont !== newCont) {
        renombrarDirSiExiste(path.join(SOPORTES_ROOT, oldCont), path.join(SOPORTES_ROOT, newCont));
        await rewriteRutasPrefijo(oldCont, newCont);
        renamed.push({ oldRel: oldCont, newRel: newCont });
      }
    }
    return renamed;
  }

  // Facturación: armado/{periodo}/{dia}/[A_FACTURAR|FACTURADOS]/…
  const oldRel = path.join('armado', String(dia.periodo), sanitizePathSegment(oldNombre)).replace(/\\/g, '/');
  const newRel = path.join('armado', String(dia.periodo), sanitizePathSegment(newNombre)).replace(/\\/g, '/');
  if (oldRel !== newRel) {
    renombrarDirSiExiste(path.join(SOPORTES_ROOT, oldRel), path.join(SOPORTES_ROOT, newRel));
    await rewriteRutasPrefijo(oldRel, newRel);
    renamed.push({ oldRel, newRel });
  }
  if (oldEstado !== newEstado) {
    const base = path.join(SOPORTES_ROOT, newRel);
    const oldEstRel = path.join(newRel, facturacionDir(oldEstado)).replace(/\\/g, '/');
    const newEstRel = path.join(newRel, facturacionDir(newEstado)).replace(/\\/g, '/');
    renombrarDirSiExiste(path.join(base, facturacionDir(oldEstado)), path.join(base, facturacionDir(newEstado)));
    await rewriteRutasPrefijo(oldEstRel, newEstRel);
    renamed.push({ oldRel: oldEstRel, newRel: newEstRel });
  }
  return renamed;
}

async function syncMetaTrasRenombre(dia, nuevoNombre) {
  const modo = normalizarModoDia(dia.modo);
  if (esModoUcqn(modo) && !Number(dia.es_contenedor)) {
    const nombre = nombreCarpetaPersonaUcqn(nuevoNombre);
    const codigo = String(nombre).slice(0, 32);
    await db.execute(
      `UPDATE sop_expedientes
       SET codigo = ?, paciente_nombre = ?
       WHERE dia_id = ?`,
      [codigo, nombre, dia.id]
    );
  }
  if (esModoAnexo(modo) && dia.anexo_archivo_id) {
    await db.execute(
      'UPDATE anexo_fidu_archivos SET nombre = ? WHERE id = ?',
      [String(nuevoNombre).trim().slice(0, 120), dia.anexo_archivo_id]
    ).catch(() => {});
  }
}

/**
 * Mueve en disco (y actualiza rutas) al cambiar el padre.
 * Facturación: no hace falta (la ruta no depende del padre).
 * UCQN/Anexo: sí, porque el padre inmediato forma parte de la ruta.
 */
async function moverDiaEnDisco(diaConPeriodo, oldParentId, newParentId) {
  const oldPid = Number(oldParentId || 0);
  const newPid = Number(newParentId || 0);
  if (oldPid === newPid) return { ok: true, moved: false };

  const modo = normalizarModoDia(diaConPeriodo.modo);
  if (!esModoUcqn(modo) && !esModoAnexo(modo)) {
    return { ok: true, moved: false };
  }

  // Contenedoras intermedias viven en armado/{periodo}/{nombre} (sin depender del padre).
  // Solo hojas/personas/anexos usan el nombre del padre en la ruta de disco.
  if (Number(diaConPeriodo.es_contenedor) === 1) {
    return { ok: true, moved: false };
  }

  const oldDia = { ...diaConPeriodo, parent_id: oldPid };
  const newDia = { ...diaConPeriodo, parent_id: newPid };
  const oldRel = await resolveDiaDiskRel(oldDia);
  const newRel = await resolveDiaDiskRel(newDia);
  if (oldRel === newRel) return { ok: true, moved: false };

  renombrarDirSiExiste(path.join(SOPORTES_ROOT, oldRel), path.join(SOPORTES_ROOT, newRel));
  await rewriteRutasPrefijo(oldRel, newRel);
  return { ok: true, moved: true, oldRel, newRel };
}

async function actualizarDia(diaId, body) {
  const dia = await loadDiaConPeriodo(diaId);
  if (!dia) return { error: 'Carpeta de día no encontrada', status: 404 };

  const modo = normalizarModoDia(dia.modo);
  const quiereRenombrar = body.nombre_display != null
    && String(body.nombre_display).trim() !== String(dia.nombre_display || '');

  if (quiereRenombrar && isContenedoraRaizFija(dia)) {
    return {
      error: 'Anexo FIDU, Facturas FIDU y U C Q N no se pueden renombrar.',
      status: 400
    };
  }

  let nombre_display = body.nombre_display != null
    ? String(body.nombre_display).trim()
    : dia.nombre_display;

  if (esModoUcqn(modo) && !Number(dia.es_contenedor)) {
    nombre_display = nombreCarpetaPersonaUcqn(nombre_display);
  }

  const estado_facturacion = (esModoUcqn(modo) || esModoAnexo(modo))
    ? (dia.estado_facturacion || 'a_facturar')
    : (body.estado_facturacion === 'facturados' ? 'facturados' : 'a_facturar');

  if (!nombre_display) {
    return { error: 'Indique el nombre de la carpeta', status: 400 };
  }

  const parentId = Number(dia.parent_id || 0);
  const dup = await db.query(
    `SELECT id FROM sop_dias
     WHERE periodo_id = ? AND COALESCE(parent_id, 0) = ? AND nombre_display = ? AND id <> ?
     LIMIT 1`,
    [dia.periodo_id, parentId, nombre_display, diaId]
  );
  if (dup.length) {
    return { error: 'Ya existe otra carpeta con ese nombre en esta ubicación', status: 409 };
  }

  const oldNombre = dia.nombre_display;
  const oldEstado = dia.estado_facturacion || 'a_facturar';

  if (nombre_display !== oldNombre || estado_facturacion !== oldEstado) {
    await renombrarCarpetasDiaEnDisco(dia, oldNombre, nombre_display, oldEstado, estado_facturacion);
  }

  await db.execute(
    'UPDATE sop_dias SET nombre_display = ?, estado_facturacion = ? WHERE id = ?',
    [nombre_display, estado_facturacion, diaId]
  );

  if (nombre_display !== oldNombre) {
    await syncMetaTrasRenombre(dia, nombre_display);
  }

  const row = await loadDiaConPeriodo(diaId);
  return { ok: true, dia: row };
}

async function eliminarDia(diaId) {
  const dia = await loadDiaConPeriodo(diaId);
  if (!dia) return { error: 'Carpeta de día no encontrada', status: 404 };

  if (isContenedoraRaizFija(dia)) {
    return {
      error: 'Anexo FIDU, Facturas FIDU y U C Q N no se pueden eliminar.',
      status: 400
    };
  }

  const hijos = await db.query('SELECT COUNT(*) AS n FROM sop_dias WHERE parent_id = ?', [diaId]);
  if (hijos[0]?.n > 0) {
    return {
      error: 'La carpeta contiene otras carpetas. Muévalas o elimínelas primero.',
      status: 409,
      hijos: hijos[0].n
    };
  }

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

  const rel = await resolveDiaDiskRel(dia);
  const diaPath = path.join(SOPORTES_ROOT, rel);
  if (fs.existsSync(diaPath)) {
    try {
      fs.rmSync(diaPath, { recursive: true, force: true });
    } catch (_) { /* ignore */ }
  }

  // Contenedor intermedio UCQN: también puede existir armado/{periodo}/{nombre}
  if (Number(dia.es_contenedor) === 1 && (esModoUcqn(dia.modo) || esModoAnexo(dia.modo))) {
    const contPath = path.join(SOPORTES_ROOT, contenedorIntermedioDiskRel(dia.periodo, dia.nombre_display));
    if (fs.existsSync(contPath)) {
      try { fs.rmSync(contPath, { recursive: true, force: true }); } catch (_) { /* ignore */ }
    }
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
  eliminarDia,
  moverDiaEnDisco,
  resolveDiaDiskRel,
  rewriteRutasPrefijo
};
