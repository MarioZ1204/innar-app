'use strict';

const path = require('path');
const { insertRowId } = require('./db-insert-id');
const { nextSopDiaNumero, sanitizePathSegment } = require('./soportes-armado-structure');

/** Contenedoras fijas en la raíz de cada mes (orden de visualización). */
const CONTENEDORAS_RAIZ = [
  { nombre: 'Anexo FIDU', modo: 'anexo_fidu', orden: 1 },
  { nombre: 'Facturas FIDU', modo: 'facturacion', orden: 2 },
  { nombre: 'U C Q N', modo: 'ucqn', orden: 3 }
];

const MODOS_DIA = new Set(['facturacion', 'anexo_fidu', 'ucqn']);

function normalizarModoDia(raw) {
  const m = String(raw || 'facturacion').trim().toLowerCase();
  return MODOS_DIA.has(m) ? m : 'facturacion';
}

function contenedoresTiposForModo(modo) {
  if (modo === 'ucqn') return ['soportes'];
  if (modo === 'anexo_fidu') return [];
  return ['rips', 'soportes'];
}

function esModoFacturacion(modo) {
  return normalizarModoDia(modo) === 'facturacion';
}

function esModoAnexo(modo) {
  return normalizarModoDia(modo) === 'anexo_fidu';
}

function esModoUcqn(modo) {
  return normalizarModoDia(modo) === 'ucqn';
}

function getArmadoUcqnPersonaDir(periodo, contenedorNombre, personaNombre) {
  return path.join(
    'armado',
    String(periodo),
    sanitizePathSegment(contenedorNombre),
    sanitizePathSegment(personaNombre)
  ).replace(/\\/g, '/');
}

function getArmadoAnexoDir(periodo, contenedorNombre, anexoNombre) {
  return path.join(
    'armado',
    String(periodo),
    sanitizePathSegment(contenedorNombre),
    sanitizePathSegment(anexoNombre)
  ).replace(/\\/g, '/');
}

async function fetchDiaRow(db, diaId) {
  const rows = await db.query('SELECT * FROM sop_dias WHERE id = ?', [diaId]);
  return rows[0] || null;
}

async function fetchModoDia(db, diaId) {
  const row = await fetchDiaRow(db, diaId);
  return row ? normalizarModoDia(row.modo) : 'facturacion';
}

async function fetchModoParentContenedora(db, parentId) {
  if (!parentId) return 'facturacion';
  const row = await fetchDiaRow(db, parentId);
  if (!row) return 'facturacion';
  if (row.es_contenedor) return normalizarModoDia(row.modo);
  return normalizarModoDia(row.modo);
}

async function ensureContenedoresForDiaModo(db, diaId, modoRaw) {
  const modo = normalizarModoDia(modoRaw);
  const tipos = contenedoresTiposForModo(modo);
  for (const tipo of tipos) {
    const exists = await db.query(
      'SELECT id FROM sop_contenedores WHERE dia_id = ? AND tipo = ?',
      [diaId, tipo]
    );
    if (!exists.length) {
      await db.execute('INSERT INTO sop_contenedores (dia_id, tipo) VALUES (?,?)', [diaId, tipo]);
    }
  }
}

async function ensureAnexoCarpetaPeriodo(db, periodoRow) {
  const nombre = String(periodoRow.etiqueta || periodoRow.periodo || 'Periodo').trim().slice(0, 120);
  const dup = await db.query('SELECT id FROM anexo_fidu_carpetas WHERE nombre = ? LIMIT 1', [nombre]);
  if (dup.length) return dup[0].id;
  const r = await db.execute('INSERT INTO anexo_fidu_carpetas (nombre) VALUES (?)', [nombre]);
  return insertRowId(r);
}

async function buscarContenedoraRaizPeriodo(db, periodoId, def) {
  const byModo = await db.query(
    `SELECT id FROM sop_dias
     WHERE periodo_id = ? AND parent_id = 0 AND es_contenedor = 1 AND modo = ?
     ORDER BY orden ASC, id ASC LIMIT 1`,
    [periodoId, def.modo]
  );
  if (byModo.length) return byModo[0].id;

  const byNombre = await db.query(
    `SELECT id FROM sop_dias
     WHERE periodo_id = ? AND parent_id = 0
       AND (nombre_display = ? OR UPPER(TRIM(nombre_display)) = UPPER(?))
     ORDER BY es_contenedor DESC, id ASC LIMIT 1`,
    [periodoId, def.nombre, def.nombre]
  );
  if (byNombre.length) return byNombre[0].id;

  return null;
}

async function ensureContenedorasRaizPeriodo(db, periodoId, usuarioId = null) {
  const periodoRows = await db.query('SELECT * FROM sop_periodos WHERE id = ?', [periodoId]);
  if (!periodoRows.length) return [];
  const per = periodoRows[0];
  const fechaDate = `${per.periodo}-01`;
  const creadas = [];

  for (const def of CONTENEDORAS_RAIZ) {
    let existingId = await buscarContenedoraRaizPeriodo(db, periodoId, def);
    if (existingId) {
      await db.execute(
        `UPDATE sop_dias SET nombre_display = ?, es_contenedor = 1, modo = ?, orden = ?, parent_id = 0
         WHERE id = ?`,
        [def.nombre, def.modo, def.orden, existingId]
      );
      continue;
    }

    const diaNum = await nextSopDiaNumero(db, periodoId);
    const r = await db.execute(
      `INSERT INTO sop_dias (periodo_id, parent_id, dia, fecha, nombre_display, es_contenedor, modo, orden, estado_facturacion)
       VALUES (?,?,?,?,?,1,?,?, 'a_facturar')`,
      [periodoId, 0, diaNum, fechaDate, def.nombre, def.modo, def.orden]
    );
    const id = insertRowId(r);
    if (id) creadas.push({ id, ...def });
  }

  try {
    await ensureAnexoCarpetaPeriodo(db, per);
  } catch (_) { /* anexo opcional si tablas no existen */ }

  return creadas;
}

async function backfillContenedorasTodosPeriodos(db) {
  const periodos = await db.query('SELECT id FROM sop_periodos ORDER BY id ASC');
  for (const p of periodos) {
    await ensureContenedorasRaizPeriodo(db, p.id);
  }
}

/** Contenedora canónica Anexo FIDU de un mes (crea si falta). */
async function idContenedoraAnexo(db, periodoId) {
  await ensureContenedorasRaizPeriodo(db, periodoId);
  const rows = await db.query(
    `SELECT id FROM sop_dias
     WHERE periodo_id = ? AND parent_id = 0 AND es_contenedor = 1
       AND modo = 'anexo_fidu'
     ORDER BY orden ASC, id ASC LIMIT 1`,
    [periodoId]
  );
  return rows[0]?.id || null;
}

/** Contenedora canónica Facturas FIDU de un mes (crea si falta). */
async function idContenedoraFacturas(db, periodoId) {
  await ensureContenedorasRaizPeriodo(db, periodoId);
  const rows = await db.query(
    `SELECT id FROM sop_dias
     WHERE periodo_id = ? AND parent_id = 0 AND es_contenedor = 1
       AND modo = 'facturacion'
     ORDER BY orden ASC, id ASC LIMIT 1`,
    [periodoId]
  );
  return rows[0]?.id || null;
}

/**
 * Repara carpetas de facturación que quedaron en la raíz del mes (parent_id=0)
 * antes de la jerarquía con contenedoras. No borra archivos ni expedientes.
 */
async function reparentCarpetasFacturacionHuerfanas(db, periodoId = null) {
  let periodos = [];
  if (periodoId) {
    periodos = [{ id: periodoId }];
  } else {
    periodos = await db.query('SELECT id FROM sop_periodos ORDER BY id ASC');
  }
  let movidas = 0;
  let omitidas = 0;
  const detalle = [];

  for (const per of periodos) {
    const facturasId = await idContenedoraFacturas(db, per.id);
    if (!facturasId) continue;

    const huerfanas = await db.query(
      `SELECT d.id, d.nombre_display, d.modo, d.es_contenedor
       FROM sop_dias d
       WHERE d.periodo_id = ? AND d.parent_id = 0 AND d.es_contenedor = 0
         AND d.id != ?
       ORDER BY d.id ASC`,
      [per.id, facturasId]
    );

    for (const dia of huerfanas) {
      if (esModoAnexo(dia.modo) || esModoUcqn(dia.modo)) {
        omitidas += 1;
        continue;
      }
      const tieneEstructura = await db.query(
        `SELECT 1 FROM sop_contenedores c WHERE c.dia_id = ? LIMIT 1`,
        [dia.id]
      );
      const tieneExp = await db.query(
        'SELECT 1 FROM sop_expedientes e WHERE e.dia_id = ? LIMIT 1',
        [dia.id]
      );
      if (!tieneEstructura.length && !tieneExp.length) {
        omitidas += 1;
        continue;
      }
      const dup = await db.query(
        'SELECT id FROM sop_dias WHERE periodo_id = ? AND parent_id = ? AND nombre_display = ? AND id != ? LIMIT 1',
        [per.id, facturasId, dia.nombre_display, dia.id]
      );
      if (dup.length) {
        omitidas += 1;
        detalle.push({ id: dia.id, nombre: dia.nombre_display, motivo: 'nombre_duplicado_en_destino' });
        continue;
      }
      await db.execute('UPDATE sop_dias SET parent_id = ?, modo = ? WHERE id = ?', [facturasId, 'facturacion', dia.id]);
      movidas += 1;
      detalle.push({ id: dia.id, nombre: dia.nombre_display, destino: facturasId });
    }

    const contDuplicadas = await db.query(
      `SELECT id, nombre_display FROM sop_dias
       WHERE periodo_id = ? AND parent_id = 0 AND es_contenedor = 1
         AND modo = 'facturacion' AND id != ?
       ORDER BY id ASC`,
      [per.id, facturasId]
    );
    for (const dupCont of contDuplicadas) {
      const hijos = await db.query('SELECT id, nombre_display FROM sop_dias WHERE parent_id = ?', [dupCont.id]);
      for (const hijo of hijos) {
        const clash = await db.query(
          'SELECT id FROM sop_dias WHERE periodo_id = ? AND parent_id = ? AND nombre_display = ? AND id != ? LIMIT 1',
          [per.id, facturasId, hijo.nombre_display, hijo.id]
        );
        if (!clash.length) {
          await db.execute('UPDATE sop_dias SET parent_id = ? WHERE id = ?', [facturasId, hijo.id]);
          movidas += 1;
        }
      }
      const quedanHijos = await db.query('SELECT COUNT(*) AS n FROM sop_dias WHERE parent_id = ?', [dupCont.id]);
      if (!(quedanHijos[0]?.n > 0)) {
        await db.execute('DELETE FROM sop_dias WHERE id = ?', [dupCont.id]);
        detalle.push({ id: dupCont.id, nombre: dupCont.nombre_display, motivo: 'contenedora_duplicada_vacia' });
      }
    }
  }

  return { ok: true, movidas, omitidas, detalle };
}

async function crearAnexoArchivoParaDia(db, diaRow, usuarioId) {
  const parentRows = await db.query('SELECT * FROM sop_dias WHERE id = ?', [diaRow.parent_id]);
  const parent = parentRows[0];
  if (!parent || !esModoAnexo(parent.modo)) {
    return { error: 'La carpeta debe estar dentro de Anexo FIDU', status: 400 };
  }
  const periodoRows = await db.query('SELECT * FROM sop_periodos WHERE id = ?', [diaRow.periodo_id]);
  if (!periodoRows.length) return { error: 'Periodo no encontrado', status: 404 };
  const carpetaId = await ensureAnexoCarpetaPeriodo(db, periodoRows[0]);
  const nombre = String(diaRow.nombre_display || '').trim();
  const dup = await db.query(
    'SELECT id FROM anexo_fidu_archivos WHERE carpeta_id = ? AND nombre = ? LIMIT 1',
    [carpetaId, nombre]
  );
  if (dup.length) {
    await db.execute('UPDATE sop_dias SET anexo_archivo_id = ? WHERE id = ?', [dup[0].id, diaRow.id]);
    return { ok: true, archivo_id: dup[0].id, existed: true };
  }
  const r = await db.execute(
    'INSERT INTO anexo_fidu_archivos (carpeta_id, nombre, sop_dia_id) VALUES (?,?,?)',
    [carpetaId, nombre, diaRow.id]
  );
  const archivoId = insertRowId(r);
  if (!archivoId) return { error: 'No se pudo crear el anexo', status: 500 };
  await db.execute('UPDATE sop_dias SET anexo_archivo_id = ? WHERE id = ?', [archivoId, diaRow.id]);
  return { ok: true, archivo_id: archivoId };
}

async function asegurarExpedienteUcqn(db, diaId, nombrePersona, usuarioId) {
  const contRows = await db.query(
    "SELECT id FROM sop_contenedores WHERE dia_id = ? AND tipo = 'soportes' LIMIT 1",
    [diaId]
  );
  if (!contRows.length) return null;
  const contenedorId = contRows[0].id;
  const codigo = String(nombrePersona || 'Persona').trim().slice(0, 32);
  const exists = await db.query(
    'SELECT id FROM sop_expedientes WHERE contenedor_id = ? LIMIT 1',
    [contenedorId]
  );
  if (exists.length) return exists[0].id;
  const r = await db.execute(
    `INSERT INTO sop_expedientes (dia_id, contenedor_id, codigo, numero_factura, paciente_nombre, paciente_documento, tipo_servicio, creado_por)
     VALUES (?,?,?,0,?,?, 'consulta', ?)`,
    [diaId, contenedorId, codigo, nombrePersona, null, usuarioId]
  );
  return insertRowId(r);
}

module.exports = {
  CONTENEDORAS_RAIZ,
  MODOS_DIA,
  normalizarModoDia,
  contenedoresTiposForModo,
  esModoFacturacion,
  esModoAnexo,
  esModoUcqn,
  getArmadoUcqnPersonaDir,
  getArmadoAnexoDir,
  fetchDiaRow,
  fetchModoDia,
  fetchModoParentContenedora,
  ensureContenedoresForDiaModo,
  ensureContenedorasRaizPeriodo,
  ensureAnexoCarpetaPeriodo,
  backfillContenedorasTodosPeriodos,
  idContenedoraAnexo,
  idContenedoraFacturas,
  reparentCarpetasFacturacionHuerfanas,
  crearAnexoArchivoParaDia,
  asegurarExpedienteUcqn
};
