/**
 * Progreso de documentos por expediente (lista de carpetas FE / RIPS).
 */
function computeExpedienteListaProgreso(exp, archivosRows, contenedorTipo) {
  if (contenedorTipo === 'rips') {
    const slotMap = { RIPS_JSON_1: false, RIPS_JSON_2: false, RIPS_XML: false };
    const slotKey = { json_1: 'RIPS_JSON_1', json_2: 'RIPS_JSON_2', xml: 'RIPS_XML' };
    for (const a of archivosRows || []) {
      const k = slotKey[a.slot] || a.slot;
      if (Object.prototype.hasOwnProperty.call(slotMap, k)) slotMap[k] = true;
    }
    const keys = ['RIPS_JSON_1', 'RIPS_JSON_2', 'RIPS_XML'];
    const items = keys.map((key) => ({ key, done: !!slotMap[key] }));
    const done = items.filter((i) => i.done).length;
    const total = keys.length;
    return {
      progreso_done: done,
      progreso_total: total,
      documentos_completos: done === total,
      progreso_items: items
    };
  }

  const slots = { OPF: false, CRC: false, FEV: false, PDX: false, HEV: false };
  for (const a of archivosRows || []) {
    if (Object.prototype.hasOwnProperty.call(slots, a.tipo)) slots[a.tipo] = true;
  }
  const tipo = exp.tipo_servicio || 'electro';
  const fevOk = slots.FEV || !!exp.fev_externa_verificada;
  const estudioOk = slots.PDX || slots.HEV;
  const items = [
    { key: 'OPF', done: slots.OPF },
    { key: 'CRC', done: slots.CRC },
    { key: 'FEV', done: fevOk },
    tipo === 'consulta'
      ? { key: 'HEV', done: slots.HEV }
      : { key: 'PDX', done: slots.PDX }
  ];
  const done = items.filter((i) => i.done).length;
  const total = items.length;
  const documentos_completos = !!(slots.OPF && slots.CRC && fevOk && estudioOk);
  return {
    progreso_done: done,
    progreso_total: total,
    documentos_completos,
    progreso_items: items
  };
}

async function enrichExpedientesLista(db, rows, contenedorTipo) {
  if (!rows?.length) return [];
  const ids = rows.map((r) => r.id);
  const ph = ids.map(() => '?').join(',');
  const archivosByExp = Object.create(null);
  if (contenedorTipo === 'rips') {
    const arch = await db.query(
      `SELECT expediente_id, slot FROM sop_rips_archivos WHERE expediente_id IN (${ph})`,
      ids
    );
    for (const a of arch) {
      if (!archivosByExp[a.expediente_id]) archivosByExp[a.expediente_id] = [];
      archivosByExp[a.expediente_id].push(a);
    }
  } else {
    const arch = await db.query(
      `SELECT expediente_id, tipo FROM sop_exp_archivos WHERE expediente_id IN (${ph})`,
      ids
    );
    for (const a of arch) {
      if (!archivosByExp[a.expediente_id]) archivosByExp[a.expediente_id] = [];
      archivosByExp[a.expediente_id].push(a);
    }
  }
  return rows.map((row) => ({
    ...row,
    ...computeExpedienteListaProgreso(row, archivosByExp[row.id], contenedorTipo)
  }));
}

module.exports = {
  computeExpedienteListaProgreso,
  enrichExpedientesLista
};
