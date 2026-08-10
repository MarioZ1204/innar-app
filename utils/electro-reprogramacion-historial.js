/**
 * Historial de reprogramaciones electro: tabla + inferencia para citas anteriores al registro formal.
 */
const {
  extraerFechaYmd,
  normalizarHoraHmElectro
} = require('./electro-fechas');

function esMarcadaReprogramada(cita) {
  if (!cita) return false;
  if (String(cita.estado || '').trim() === 'Reprogramado') return true;
  return /\[Reprogramado\]/i.test(String(cita.observaciones || ''));
}

function normalizarEstudioNombre(s) {
  return String(s || '').trim().toLowerCase();
}

function instanteMs(val) {
  if (!val) return 0;
  const t = new Date(val).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function mapHistorialRow(row, { legacy = false } = {}) {
  return {
    id: row.id ?? 0,
    cita_original_id: row.cita_original_id,
    cita_nueva_id: row.cita_nueva_id,
    reprogramado_por_nombre: row.reprogramado_por_nombre,
    reprogramado_en: row.reprogramado_en,
    fecha_anterior: extraerFechaYmd(row.fecha_anterior) || row.fecha_anterior,
    hora_anterior: normalizarHoraHmElectro(row.hora_anterior) || row.hora_anterior,
    fecha_nueva: extraerFechaYmd(row.fecha_nueva) || row.fecha_nueva,
    hora_nueva: normalizarHoraHmElectro(row.hora_nueva) || row.hora_nueva,
    legacy: !!legacy
  };
}

function claveHistorial(row) {
  return [
    row.cita_original_id,
    row.cita_nueva_id || '',
    row.fecha_anterior,
    row.hora_anterior,
    row.fecha_nueva || '',
    row.hora_nueva || ''
  ].join('|');
}

function dedupeHistorial(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const k = claveHistorial(row);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(row);
  }
  return out.sort((a, b) => instanteMs(b.reprogramado_en) - instanteMs(a.reprogramado_en));
}

async function tablaHistorialExiste(db) {
  try {
    const r = await db.query("SHOW TABLES LIKE 'citas_electro_reprogramaciones'");
    return r.length > 0;
  } catch (_) {
    return false;
  }
}

async function cargarHistorialDesdeTabla(db, citaIds) {
  if (!citaIds.length || !(await tablaHistorialExiste(db))) return [];
  const placeholders = citaIds.map(() => '?').join(',');
  const params = [...citaIds, ...citaIds];
  const rows = await db.query(`
    SELECT id, cita_original_id, cita_nueva_id, reprogramado_por_nombre,
           DATE_FORMAT(reprogramado_en, '%Y-%m-%d %H:%i:%s') AS reprogramado_en,
           DATE_FORMAT(fecha_anterior, '%Y-%m-%d') AS fecha_anterior,
           TIME_FORMAT(hora_anterior, '%H:%i') AS hora_anterior,
           DATE_FORMAT(fecha_nueva, '%Y-%m-%d') AS fecha_nueva,
           TIME_FORMAT(hora_nueva, '%H:%i') AS hora_nueva
    FROM citas_electro_reprogramaciones
    WHERE cita_original_id IN (${placeholders}) OR cita_nueva_id IN (${placeholders})
    ORDER BY reprogramado_en DESC, id DESC
  `, params);
  return rows.map((r) => mapHistorialRow(r));
}

async function cargarCitaElectroBasica(db, id) {
  const rows = await db.query(`
    SELECT id, paciente_id, estudio, estado, observaciones,
           DATE_FORMAT(fecha, '%Y-%m-%d') AS fecha,
           TIME_FORMAT(hora_agendamiento, '%H:%i') AS hora_agendamiento,
           DATE_FORMAT(reprogramado_en, '%Y-%m-%d %H:%i:%s') AS reprogramado_en,
           reprogramado_por_nombre, reprogramada_desde_id,
           editado_por_nombre,
           DATE_FORMAT(editado_en, '%Y-%m-%d %H:%i:%s') AS editado_en,
           DATE_FORMAT(creado_en, '%Y-%m-%d %H:%i:%s') AS creado_en,
           programado_por_nombre
    FROM citas_electro
    WHERE id = ? AND deleted_at IS NULL
    LIMIT 1
  `, [id]);
  return rows[0] || null;
}

async function expandirIdsCadenaReprogramacion(db, citaId) {
  const ids = new Set([citaId]);
  let cur = citaId;
  for (let i = 0; i < 20; i++) {
    const row = await cargarCitaElectroBasica(db, cur);
    const parent = row?.reprogramada_desde_id;
    if (!parent || ids.has(parent)) break;
    ids.add(parent);
    cur = parent;
  }

  if (await tablaHistorialExiste(db)) {
    let added = true;
    while (added) {
      added = false;
      const list = [...ids];
      if (!list.length) break;
      const ph = list.map(() => '?').join(',');
      const hijos = await db.query(`
        SELECT cita_nueva_id AS id FROM citas_electro_reprogramaciones
        WHERE cita_original_id IN (${ph})
      `, list);
      for (const h of hijos) {
        if (h.id && !ids.has(h.id)) {
          ids.add(h.id);
          added = true;
        }
      }
      const padres = await db.query(`
        SELECT cita_original_id AS id FROM citas_electro_reprogramaciones
        WHERE cita_nueva_id IN (${ph})
      `, list);
      for (const p of padres) {
        if (p.id && !ids.has(p.id)) {
          ids.add(p.id);
          added = true;
        }
      }
    }
  }

  return [...ids];
}

function elegirMejorCitaNueva(original, candidatos) {
  if (!candidatos.length) return null;
  const t0 = instanteMs(original.reprogramado_en || original.editado_en || original.creado_en);
  const estudioOrig = normalizarEstudioNombre(original.estudio);

  let mejor = null;
  let mejorScore = -1;
  for (const c of candidatos) {
    if (normalizarEstudioNombre(c.estudio) !== estudioOrig) continue;
    const tN = instanteMs(c.creado_en);
    if (t0 && tN && tN < t0 - 3600000) continue;

    const mismaAgenda = c.fecha === original.fecha
      && normalizarHoraHmElectro(c.hora_agendamiento) === normalizarHoraHmElectro(original.hora_agendamiento);
    if (mismaAgenda) continue;

    let score = 0;
    if (original.editado_por_nombre && c.programado_por_nombre === original.editado_por_nombre) score += 10;
    if (t0 && tN) {
      const diffMin = Math.abs(tN - t0) / 60000;
      if (diffMin <= 10) score += 8;
      else if (diffMin <= 120) score += 4;
      else if (diffMin > 10080) score -= 5;
    }
    if (c.reprogramada_desde_id === original.id) score += 20;
    score -= Math.abs((c.id || 0) - (original.id || 0)) / 100000;

    if (score > mejorScore) {
      mejorScore = score;
      mejor = c;
    }
  }
  return mejor;
}

function construirFilaInferida(original, nueva) {
  const cuando = original.reprogramado_en
    || original.editado_en
    || nueva.creado_en;
  const quien = original.reprogramado_por_nombre
    || original.editado_por_nombre
    || nueva.programado_por_nombre
    || 'Sistema';
  return mapHistorialRow({
    id: 0,
    cita_original_id: original.id,
    cita_nueva_id: nueva.id,
    reprogramado_por_nombre: quien,
    reprogramado_en: cuando,
    fecha_anterior: original.fecha,
    hora_anterior: original.hora_agendamiento,
    fecha_nueva: nueva.fecha,
    hora_nueva: nueva.hora_agendamiento
  }, { legacy: true });
}

async function inferirParejasLegacyParaIds(db, citaIds) {
  const inferidas = [];
  const idsSet = new Set(citaIds);

  for (const citaId of citaIds) {
    const cita = await cargarCitaElectroBasica(db, citaId);
    if (!cita) continue;

    if (esMarcadaReprogramada(cita)) {
      const tRef = cita.reprogramado_en || cita.editado_en || cita.creado_en;
      const candidatos = await db.query(`
        SELECT id, paciente_id, estudio,
               DATE_FORMAT(fecha, '%Y-%m-%d') AS fecha,
               TIME_FORMAT(hora_agendamiento, '%H:%i') AS hora_agendamiento,
               DATE_FORMAT(creado_en, '%Y-%m-%d %H:%i:%s') AS creado_en,
               programado_por_nombre, reprogramada_desde_id
        FROM citas_electro
        WHERE deleted_at IS NULL
          AND paciente_id = ?
          AND id != ?
          AND id > ?
          AND (
            reprogramada_desde_id = ?
            OR (
              (reprogramada_desde_id IS NULL OR reprogramada_desde_id = 0)
              AND creado_en >= DATE_SUB(?, INTERVAL 1 HOUR)
              AND creado_en <= DATE_ADD(?, INTERVAL 14 DAY)
            )
          )
        ORDER BY creado_en ASC
        LIMIT 20
      `, [cita.paciente_id, cita.id, cita.id, cita.id, tRef || cita.creado_en, tRef || cita.creado_en]);

      const nueva = elegirMejorCitaNueva(cita, candidatos);
      if (nueva) inferidas.push(construirFilaInferida(cita, nueva));
    }

    if (cita.reprogramada_desde_id) {
      const orig = await cargarCitaElectroBasica(db, cita.reprogramada_desde_id);
      if (orig) inferidas.push(construirFilaInferida(orig, cita));
      continue;
    }

    const tNueva = cita.creado_en;
    const origenes = await db.query(`
      SELECT id, paciente_id, estudio, estado, observaciones,
             DATE_FORMAT(fecha, '%Y-%m-%d') AS fecha,
             TIME_FORMAT(hora_agendamiento, '%H:%i') AS hora_agendamiento,
             DATE_FORMAT(reprogramado_en, '%Y-%m-%d %H:%i:%s') AS reprogramado_en,
             reprogramado_por_nombre, editado_por_nombre,
             DATE_FORMAT(editado_en, '%Y-%m-%d %H:%i:%s') AS editado_en,
             DATE_FORMAT(creado_en, '%Y-%m-%d %H:%i:%s') AS creado_en
      FROM citas_electro
      WHERE deleted_at IS NULL
        AND paciente_id = ?
        AND id < ?
        AND (
          observaciones LIKE '%[Reprogramado]%'
          OR estado = 'Reprogramado'
        )
        AND COALESCE(reprogramado_en, editado_en, creado_en) <= DATE_ADD(?, INTERVAL 2 HOUR)
      ORDER BY COALESCE(reprogramado_en, editado_en, creado_en) DESC
      LIMIT 10
    `, [cita.paciente_id, cita.id, tNueva || new Date()]);

    const original = origenes.find((o) => normalizarEstudioNombre(o.estudio) === normalizarEstudioNombre(cita.estudio))
      || origenes[0];
    if (original) {
      const mismaAgenda = original.fecha === cita.fecha
        && normalizarHoraHmElectro(original.hora_agendamiento) === normalizarHoraHmElectro(cita.hora_agendamiento);
      if (!mismaAgenda) inferidas.push(construirFilaInferida(original, cita));
    }
  }

  return inferidas.filter((row) => idsSet.has(row.cita_original_id) || idsSet.has(row.cita_nueva_id));
}

async function obtenerHistorialCompletoReprogramacionesElectro(db, citaId) {
  const cadenaIds = await expandirIdsCadenaReprogramacion(db, citaId);
  const desdeTabla = await cargarHistorialDesdeTabla(db, cadenaIds);
  const inferidas = await inferirParejasLegacyParaIds(db, cadenaIds);

  const tablaClaves = new Set(desdeTabla.map(claveHistorial));
  const inferidasFiltradas = inferidas.filter((r) => !tablaClaves.has(claveHistorial(r)));

  let merged = dedupeHistorial([...desdeTabla, ...inferidasFiltradas]);

  if (!merged.length) {
    const cita = await cargarCitaElectroBasica(db, citaId);
    if (cita && esMarcadaReprogramada(cita)) {
      merged = [mapHistorialRow({
        id: 0,
        cita_original_id: cita.id,
        cita_nueva_id: null,
        reprogramado_por_nombre: cita.reprogramado_por_nombre || cita.editado_por_nombre || 'Sistema',
        reprogramado_en: cita.reprogramado_en || cita.editado_en || cita.creado_en,
        fecha_anterior: cita.fecha,
        hora_anterior: cita.hora_agendamiento,
        fecha_nueva: null,
        hora_nueva: null
      }, { legacy: true })];
    }
  }

  return merged;
}

async function backfillHistorialReprogramacionesElectro(db, { dryRun = false } = {}) {
  if (!(await tablaHistorialExiste(db))) return { insertados: 0, omitidos: 0 };

  const originales = await db.query(`
    SELECT id, paciente_id, estudio, observaciones, estado,
           DATE_FORMAT(fecha, '%Y-%m-%d') AS fecha,
           TIME_FORMAT(hora_agendamiento, '%H:%i') AS hora_agendamiento,
           DATE_FORMAT(reprogramado_en, '%Y-%m-%d %H:%i:%s') AS reprogramado_en,
           reprogramado_por_nombre, editado_por_nombre,
           DATE_FORMAT(editado_en, '%Y-%m-%d %H:%i:%s') AS editado_en,
           DATE_FORMAT(creado_en, '%Y-%m-%d %H:%i:%s') AS creado_en
    FROM citas_electro
    WHERE deleted_at IS NULL
      AND (observaciones LIKE '%[Reprogramado]%' OR estado = 'Reprogramado')
    ORDER BY id ASC
  `);

  let insertados = 0;
  let omitidos = 0;

  for (const orig of originales) {
    const existe = await db.query(
      'SELECT id FROM citas_electro_reprogramaciones WHERE cita_original_id = ? LIMIT 1',
      [orig.id]
    );
    if (existe.length) {
      omitidos += 1;
      continue;
    }

    const tRef = orig.reprogramado_en || orig.editado_en || orig.creado_en;
    const candidatos = await db.query(`
      SELECT id, paciente_id, estudio,
             DATE_FORMAT(fecha, '%Y-%m-%d') AS fecha,
             TIME_FORMAT(hora_agendamiento, '%H:%i') AS hora_agendamiento,
             DATE_FORMAT(creado_en, '%Y-%m-%d %H:%i:%s') AS creado_en,
             programado_por_nombre, reprogramada_desde_id
      FROM citas_electro
      WHERE deleted_at IS NULL AND paciente_id = ? AND id > ?
        AND creado_en >= DATE_SUB(?, INTERVAL 1 HOUR)
        AND creado_en <= DATE_ADD(?, INTERVAL 14 DAY)
      ORDER BY creado_en ASC
      LIMIT 20
    `, [orig.paciente_id, orig.id, tRef, tRef]);

    const nueva = elegirMejorCitaNueva(orig, candidatos);
    if (!nueva) {
      omitidos += 1;
      continue;
    }

    const fila = construirFilaInferida(orig, nueva);
    const quien = fila.reprogramado_por_nombre;
    const cuando = fila.reprogramado_en;

    if (!dryRun) {
      await db.execute(`
        INSERT INTO citas_electro_reprogramaciones (
          cita_original_id, cita_nueva_id, reprogramado_por_nombre, reprogramado_en,
          fecha_anterior, hora_anterior, fecha_nueva, hora_nueva
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        orig.id, nueva.id, quien, cuando,
        fila.fecha_anterior, fila.hora_anterior, fila.fecha_nueva, fila.hora_nueva
      ]);

      await db.execute(`
        UPDATE citas_electro
        SET reprogramado_por_nombre = COALESCE(reprogramado_por_nombre, ?),
            reprogramado_en = COALESCE(reprogramado_en, ?)
        WHERE id = ?
      `, [quien, cuando, orig.id]);

      await db.execute(`
        UPDATE citas_electro
        SET reprogramada_desde_id = COALESCE(reprogramada_desde_id, ?)
        WHERE id = ?
      `, [orig.id, nueva.id]);
    }
    insertados += 1;
  }

  return { insertados, omitidos };
}

module.exports = {
  esMarcadaReprogramada,
  obtenerHistorialCompletoReprogramacionesElectro,
  backfillHistorialReprogramacionesElectro
};
