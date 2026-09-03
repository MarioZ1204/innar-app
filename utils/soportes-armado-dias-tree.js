/**
 * Jerarquía de carpetas de día en armado de soportes (contenedoras).
 */

function normalizarParentId(raw) {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function esAncestroEnMapa(posibleAncestroId, carpetaId, parentById) {
  const anc = parseInt(posibleAncestroId, 10);
  let cur = parseInt(carpetaId, 10);
  if (!anc || !cur || anc === cur) return false;
  const seen = new Set();
  while (cur) {
    const p = normalizarParentId(parentById[cur]);
    if (!p) return false;
    if (p === anc) return true;
    if (seen.has(p)) return false;
    seen.add(p);
    cur = p;
  }
  return false;
}

async function cargarParentMapDias(db, periodoId) {
  const rows = await db.query(
    'SELECT id, parent_id FROM sop_dias WHERE periodo_id = ?',
    [periodoId]
  );
  const map = {};
  for (const r of rows) map[r.id] = normalizarParentId(r.parent_id);
  return map;
}

async function esAncestroDiaArmado(db, periodoId, posibleAncestroId, diaId) {
  const map = await cargarParentMapDias(db, periodoId);
  return esAncestroEnMapa(posibleAncestroId, diaId, map);
}

async function validarMoverDiaArmado(db, diaId, nuevoParentIdRaw) {
  const diaRows = await db.query('SELECT * FROM sop_dias WHERE id = ?', [diaId]);
  if (!diaRows.length) {
    return { ok: false, status: 404, error: 'Carpeta no encontrada' };
  }
  const dia = diaRows[0];
  const nuevoParentId = normalizarParentId(nuevoParentIdRaw);
  const oldParentId = normalizarParentId(dia.parent_id);

  if (Number(dia.es_contenedor) === 1 && oldParentId === 0) {
    return {
      ok: false,
      status: 400,
      error: 'Anexo FIDU, Facturas FIDU y U C Q N no se pueden mover.'
    };
  }

  if (nuevoParentId === diaId) {
    return { ok: false, status: 400, error: 'No puede mover una carpeta dentro de sí misma' };
  }
  if (nuevoParentId > 0) {
    const parentRows = await db.query('SELECT * FROM sop_dias WHERE id = ?', [nuevoParentId]);
    if (!parentRows.length) {
      return { ok: false, status: 404, error: 'Carpeta destino no encontrada' };
    }
    if (parentRows[0].periodo_id !== dia.periodo_id) {
      return { ok: false, status: 400, error: 'Solo puede reorganizar carpetas dentro del mismo mes' };
    }
    if (!parentRows[0].es_contenedor) {
      return { ok: false, status: 400, error: 'Solo puede soltar dentro de carpetas contenedoras' };
    }
    if (await esAncestroDiaArmado(db, dia.periodo_id, diaId, nuevoParentId)) {
      return { ok: false, status: 400, error: 'No puede mover una carpeta dentro de una subcarpeta suya' };
    }
  }

  // Evitar mover entre Anexo / Facturas / U C Q N (estructuras de disco distintas).
  const { fetchModoParentContenedora, normalizarModoDia } = require('./soportes-armado-modos');
  const modoOrigen = oldParentId
    ? await fetchModoParentContenedora(db, oldParentId)
    : normalizarModoDia(dia.modo);
  const modoDestino = nuevoParentId
    ? await fetchModoParentContenedora(db, nuevoParentId)
    : null;
  if (nuevoParentId === 0) {
    // Raíz del mes: solo carpetas de facturación huérfanas deberían llegar aquí.
    if (modoOrigen !== 'facturacion') {
      return {
        ok: false,
        status: 400,
        error: 'Las carpetas de Anexo o U C Q N deben permanecer dentro de su contenedora.'
      };
    }
  } else if (modoOrigen !== modoDestino) {
    return {
      ok: false,
      status: 400,
      error: 'No puede mover carpetas entre Anexo FIDU, Facturas FIDU y U C Q N.'
    };
  }

  const dup = await db.query(
    `SELECT id FROM sop_dias
     WHERE periodo_id = ? AND parent_id = ? AND nombre_display = ? AND id != ?
     LIMIT 1`,
    [dia.periodo_id, nuevoParentId, dia.nombre_display, diaId]
  );
  if (dup.length) {
    return { ok: false, status: 409, error: 'Ya existe una carpeta con ese nombre en el destino' };
  }
  return { ok: true, dia, nuevoParentId, oldParentId, modoDestino };
}

module.exports = {
  normalizarParentId,
  esAncestroEnMapa,
  validarMoverDiaArmado
};
