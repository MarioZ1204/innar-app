'use strict';

/**
 * Motor optimizado de vinculación recibos ↔ citas (auditoría).
 * - Pocas consultas SQL acotadas
 * - Índices en memoria (turno, cita electro, fecha, documento)
 * - Coincidencia flexible: estudio, nombre, fecha ±N días
 */

const {
  normTipoServicio,
  tipoServicioCoincideNombre,
  tipoServicioCoincideCatalogo,
  estudioServicioCoincide
} = require('./recibos-catalogo-filtros');
const { tipoEstudioElectro } = require('./electro-estudio-tipo');

const RECIBO_CAMPOS = 'r.id, r.numero, r.turno_id, r.cita_electro_id, r.total, r.anulado, r.anulado_razon, r.estado_pago, r.observaciones, r.tipo_servicio, r.fecha, r.cliente, r.medico_nombre, r.nombre_entidad, r.data';
const SQL_EXCLUIR_MEDICO_ELECTRO = `(medico_nombre IS NULL OR TRIM(medico_nombre) = '' OR UPPER(TRIM(medico_nombre)) NOT LIKE '%ELECTRODIAG%')`;
const MARGEN_DIAS_FECHA = 7;
const CATALOGOS_TTL_MS = 5 * 60 * 1000;

const SQL_FILTRO_RECIBO_ELECTRO = `(
  UPPER(COALESCE(r.medico_nombre, '')) LIKE '%ELECTRODIAG%'
  OR LOWER(COALESCE(r.tipo_servicio, '')) LIKE '%psg%'
  OR LOWER(COALESCE(r.tipo_servicio, '')) LIKE '%polisom%'
  OR LOWER(COALESCE(r.tipo_servicio, '')) LIKE '%eeg%'
  OR LOWER(COALESCE(r.tipo_servicio, '')) LIKE '%electro%'
  OR LOWER(COALESCE(r.tipo_servicio, '')) LIKE '%vtm%'
  OR LOWER(COALESCE(r.tipo_servicio, '')) LIKE '%mslt%'
  OR LOWER(COALESCE(r.tipo_servicio, '')) LIKE '%estudios electro%'
)`;

let catalogosCache = null;
let catalogosCacheAt = 0;

function resetCatalogosCacheForTests() {
  catalogosCache = null;
  catalogosCacheAt = 0;
}

function extraerFechaYmd(val) {
  if (!val) return '';
  const m = String(val).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : String(val).slice(0, 10);
}

function sumarDiasYmd(ymd, dias) {
  if (!ymd) return '';
  const d = new Date(`${ymd}T12:00:00`);
  if (Number.isNaN(d.getTime())) return ymd;
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

function fechasUnicasCitas(citas) {
  return [...new Set((citas || []).map((c) => extraerFechaYmd(c.fecha)).filter(Boolean))];
}

function sqlInFechasCitas(citas) {
  const fechas = fechasUnicasCitas(citas);
  if (!fechas.length) return null;
  return { fechas, ph: fechas.map(() => '?').join(',') };
}

function calcularRangoMargen(citas, margenDias = MARGEN_DIAS_FECHA) {
  const fechas = fechasUnicasCitas(citas);
  if (!fechas.length) return null;
  const minC = fechas.reduce((a, b) => (a < b ? a : b));
  const maxC = fechas.reduce((a, b) => (a > b ? a : b));
  return {
    desde: sumarDiasYmd(minC, -margenDias),
    hasta: sumarDiasYmd(maxC, margenDias)
  };
}

function fechasCitaReciboCercanas(fechaRec, fechaCita, margenDias = MARGEN_DIAS_FECHA) {
  if (!fechaRec || !fechaCita) return true;
  if (fechaRec === fechaCita) return true;
  const a = new Date(`${fechaRec}T12:00:00`);
  const b = new Date(`${fechaCita}T12:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return fechaRec === fechaCita;
  return Math.abs(a - b) / 86400000 <= margenDias;
}

function normDocumento(s) {
  return String(s || '').replace(/\D/g, '').trim();
}

function normEntidad(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function normNombrePaciente(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function tokensNombrePaciente(s) {
  return normNombrePaciente(s).split(/\s+/).filter(Boolean);
}

function distanciaLevenshtein(a, b) {
  const s = String(a || '');
  const t = String(b || '');
  if (s === t) return 0;
  if (!s.length) return t.length;
  if (!t.length) return s.length;
  const row = Array.from({ length: t.length + 1 }, (_, i) => i);
  for (let i = 1; i <= s.length; i++) {
    let prev = i - 1;
    row[0] = i;
    for (let j = 1; j <= t.length; j++) {
      const tmp = row[j];
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return row[t.length];
}

function nombresPacienteCoincidenFuzzy(cliente, pacienteNombre) {
  const a = normNombrePaciente(cliente);
  const b = normNombrePaciente(pacienteNombre);
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;

  const ta = tokensNombrePaciente(cliente);
  const tb = tokensNombrePaciente(pacienteNombre);
  if (ta.length && tb.length) {
    const sa = [...ta].sort().join(' ');
    const sb = [...tb].sort().join(' ');
    if (sa === sb) return true;
    if (Math.max(sa.length, sb.length) >= 12 && distanciaLevenshtein(sa, sb) <= 4) return true;
  }

  if (ta.length && ta.length === tb.length) {
    let ok = true;
    for (let i = 0; i < ta.length; i++) {
      if (ta[i] === tb[i]) continue;
      const dist = distanciaLevenshtein(ta[i], tb[i]);
      const minLen = Math.min(ta[i].length, tb[i].length);
      if (dist === 1 && minLen >= 4) continue;
      if (dist === 2 && minLen >= 5) continue;
      if (dist <= 3 && minLen >= 7) continue;
      ok = false;
      break;
    }
    if (ok) return true;
  }

  if (ta.length >= 2 && tb.length >= 2) {
    const minTokens = Math.min(ta.length, tb.length);
    let coincidencias = 0;
    const usados = new Set();
    for (const tokA of ta) {
      for (let j = 0; j < tb.length; j++) {
        if (usados.has(j)) continue;
        const tokB = tb[j];
        if (tokA === tokB) {
          coincidencias++;
          usados.add(j);
          break;
        }
        const dist = distanciaLevenshtein(tokA, tokB);
        const minLen = Math.min(tokA.length, tokB.length);
        if ((dist === 1 && minLen >= 4) || (dist === 2 && minLen >= 5) || (dist <= 3 && minLen >= 7)) {
          coincidencias++;
          usados.add(j);
          break;
        }
      }
    }
    if (coincidencias >= Math.max(2, minTokens - 1)) return true;
  }

  return Math.max(a.length, b.length) >= 10 && distanciaLevenshtein(a, b) <= 4;
}

function clienteCoincidePaciente(cliente, pacienteNombre, estricto = false) {
  const a = normNombrePaciente(cliente);
  const b = normNombrePaciente(pacienteNombre);
  if (!a || !b) return estricto ? false : true;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  if (estricto) return nombresPacienteCoincidenFuzzy(cliente, pacienteNombre);
  return false;
}

function extraerDocumentoRecibo(rec) {
  if (!rec) return '';
  const fromJoin = normDocumento(rec.turno_documento || rec.electro_documento || '');
  if (fromJoin) return fromJoin;
  if (rec.data) {
    try {
      const parsed = typeof rec.data === 'string' ? JSON.parse(rec.data) : rec.data;
      return normDocumento(parsed?.doc);
    } catch (_) { /* ignore */ }
  }
  return '';
}

function entidadCoincide(rec, cita) {
  const a = normEntidad(rec?.nombre_entidad);
  const b = normEntidad(cita?.entidad);
  if (!a || !b) return true;
  return a === b || a.includes(b) || b.includes(a);
}

function documentosPacienteConflictivos(rec, cita) {
  const docRec = extraerDocumentoRecibo(rec);
  const docCita = normDocumento(cita?.paciente_documento);
  return !!(docRec && docCita && docRec !== docCita);
}

function pacienteReciboCoincideCita(rec, cita, estrictoNombre = true, opciones = {}) {
  const docRec = extraerDocumentoRecibo(rec);
  const docCita = normDocumento(cita?.paciente_documento);
  if (docRec && docCita) return docRec === docCita;
  if (docRec && !docCita) return false;
  if (!docRec && docCita && opciones.enlaceDirecto === true) return true;
  return clienteCoincidePaciente(rec?.cliente, cita?.paciente_nombre, estrictoNombre);
}

function esMedicoElectroDiagnostico(medicoNombre) {
  return normTipoServicio(medicoNombre).includes('electrodiag');
}

function esTipoServicioElectroDiagnostico(tipoServicio) {
  const ts = normTipoServicio(tipoServicio);
  if (!ts) return false;
  if (ts.includes('estudios') && ts.includes('electro')) return true;
  if (ts.includes('electrodiag') && !ts.includes('consulta')) return true;
  return false;
}

function esReciboElectro(rec, catalogos = {}) {
  if (!rec) return false;
  if (rec.cita_electro_id != null && rec.cita_electro_id !== '' && Number(rec.cita_electro_id) !== 0) return true;
  if (esTipoServicioElectroDiagnostico(rec.tipo_servicio)) return true;
  if (tipoEstudioElectro(rec.tipo_servicio) !== 'otro') return true;
  const enEstudios = catalogos.estudios?.length && tipoServicioCoincideCatalogo(rec.tipo_servicio, catalogos.estudios);
  const enConsulta = catalogos.tiposConsulta?.length && tipoServicioCoincideCatalogo(rec.tipo_servicio, catalogos.tiposConsulta);
  if (enEstudios && !enConsulta) return true;
  if (enConsulta && !enEstudios) return false;
  return esMedicoElectroDiagnostico(rec.medico_nombre) && !enConsulta;
}

function esReciboConsultaMedica(rec, catalogos = {}) {
  return !esReciboElectro(rec, catalogos);
}

function reciboEnlazadoPorTurno(rec, cita) {
  return rec.turno_id != null && rec.turno_id !== '' && Number(rec.turno_id) === Number(cita.id);
}

function reciboEnlazadoPorCitaElectro(rec, cita) {
  return rec.cita_electro_id != null && rec.cita_electro_id !== '' && Number(rec.cita_electro_id) === Number(cita.id);
}

function reciboDirectoMedica(rec, cita, catalogos = {}) {
  if (esReciboElectro(rec, catalogos)) return false;
  if (!reciboEnlazadoPorTurno(rec, cita)) return false;
  if (rec.cita_electro_id != null && rec.cita_electro_id !== '' && Number(rec.cita_electro_id) !== 0) return false;
  return !documentosPacienteConflictivos(rec, cita);
}

function reciboDirectoElectro(rec, cita) {
  if (!reciboEnlazadoPorCitaElectro(rec, cita)) return false;
  return !documentosPacienteConflictivos(rec, cita);
}

function reciboCoincideCitaMedica(rec, cita, catalogos = {}) {
  if (esReciboElectro(rec, catalogos)) return false;
  if (reciboDirectoMedica(rec, cita, catalogos)) return true;
  if (rec.turno_id != null && rec.turno_id !== '' && Number(rec.turno_id) !== Number(cita.id)) return false;
  if (!cita.tipo_consulta) return false;
  if (catalogos.estudios?.length && tipoServicioCoincideCatalogo(rec.tipo_servicio, catalogos.estudios)) return false;
  if (!tipoServicioCoincideNombre(rec.tipo_servicio, cita.tipo_consulta)) return false;
  if (!fechasCitaReciboCercanas(extraerFechaYmd(rec.fecha), extraerFechaYmd(cita.fecha))) return false;
  if (!entidadCoincide(rec, cita)) return false;
  if (documentosPacienteConflictivos(rec, cita)) return false;
  return pacienteReciboCoincideCita(rec, cita, true);
}

function reciboCoincideCitaElectro(rec, cita, catalogos = {}) {
  if (reciboDirectoElectro(rec, cita)) return true;
  if (!esReciboElectro(rec, catalogos)) return false;
  if (rec.cita_electro_id != null && rec.cita_electro_id !== '' && Number(rec.cita_electro_id) !== Number(cita.id)) return false;
  if (!cita.tipo_consulta) return false;
  if (!estudioServicioCoincide(rec.tipo_servicio, cita.tipo_consulta)) return false;
  if (!fechasCitaReciboCercanas(extraerFechaYmd(rec.fecha), extraerFechaYmd(cita.fecha))) return false;
  if (!entidadCoincide(rec, cita)) return false;
  if (documentosPacienteConflictivos(rec, cita)) return false;
  return pacienteReciboCoincideCita(rec, cita, true);
}

function dedupeRecibosPorId(rows) {
  const map = new Map();
  (rows || []).forEach((r) => {
    if (r?.id != null) map.set(r.id, r);
  });
  return [...map.values()];
}

async function cargarCatalogosEnlaceRecibos(db) {
  const [consultaRows, serviciosRows, duracionesRows] = await Promise.all([
    db.query('SELECT DISTINCT nombre FROM tipos_consulta WHERE activo = 1'),
    db.query(
      'SELECT DISTINCT nombre FROM servicios_recibo WHERE activo = 1 AND nombre IS NOT NULL AND TRIM(nombre) <> ""'
    ).catch(() => []),
    db.query(
      'SELECT DISTINCT nombre FROM estudio_duraciones WHERE nombre IS NOT NULL AND TRIM(nombre) <> ""'
    ).catch(() => [])
  ]);
  const estudios = [...new Set([
    ...serviciosRows.map((r) => r.nombre),
    ...duracionesRows.map((r) => r.nombre)
  ].filter(Boolean))];
  return {
    tiposConsulta: consultaRows.map((r) => r.nombre).filter(Boolean),
    estudios
  };
}

async function obtenerCatalogosEnlace(db) {
  if (catalogosCache && Date.now() - catalogosCacheAt < CATALOGOS_TTL_MS) {
    return catalogosCache;
  }
  catalogosCache = await cargarCatalogosEnlaceRecibos(db);
  catalogosCacheAt = Date.now();
  return catalogosCache;
}

async function cargarRecibosConsultaMedica(db, citasMedicas) {
  if (!citasMedicas.length) return [];

  const turnoIds = citasMedicas.map((c) => c.id);
  const fechasSql = sqlInFechasCitas(citasMedicas);
  const rango = calcularRangoMargen(citasMedicas);
  const phTurnos = turnoIds.map(() => '?').join(',');

  const queries = [
    db.query(
      `SELECT ${RECIBO_CAMPOS}, t.paciente_documento AS turno_documento
       FROM recibos r
       LEFT JOIN turnos t ON t.id = r.turno_id
       WHERE r.turno_id IN (${phTurnos})`,
      turnoIds
    )
  ];

  if (fechasSql) {
    queries.push(db.query(
      `SELECT ${RECIBO_CAMPOS}, t.paciente_documento AS turno_documento
       FROM recibos r
       LEFT JOIN turnos t ON t.id = r.turno_id
       WHERE (r.cita_electro_id IS NULL OR r.cita_electro_id = 0)
         AND ${SQL_EXCLUIR_MEDICO_ELECTRO.replace(/medico_nombre/g, 'r.medico_nombre')}
         AND DATE(r.fecha) IN (${fechasSql.ph})`,
      fechasSql.fechas
    ));
  }

  const documentos = [...new Set(citasMedicas.map((c) => normDocumento(c.paciente_documento)).filter((d) => d.length >= 5))];
  if (documentos.length && rango) {
    const docConds = documentos.slice(0, 80).map(() =>
      `REPLACE(REPLACE(REPLACE(REPLACE(JSON_UNQUOTE(JSON_EXTRACT(r.data, '$.doc')), '.', ''), '-', ''), ' ', ''), '/', '') = ?`
    ).join(' OR ');
    queries.push(
      db.query(
        `SELECT ${RECIBO_CAMPOS}, t.paciente_documento AS turno_documento
         FROM recibos r
         LEFT JOIN turnos t ON t.id = r.turno_id
         WHERE (r.cita_electro_id IS NULL OR r.cita_electro_id = 0)
           AND ${SQL_EXCLUIR_MEDICO_ELECTRO.replace(/medico_nombre/g, 'r.medico_nombre')}
           AND DATE(r.fecha) BETWEEN ? AND ?
           AND (${docConds})`,
        [rango.desde, rango.hasta, ...documentos.slice(0, 80)]
      ).catch(() => [])
    );
  }

  const results = await Promise.all(queries);
  return dedupeRecibosPorId(results.flat());
}

async function cargarRecibosElectro(db, citasElectro) {
  if (!citasElectro.length) return [];

  const electroIds = citasElectro.map((c) => c.id);
  const rango = calcularRangoMargen(citasElectro);
  const phElectro = electroIds.map(() => '?').join(',');

  const queries = [
    db.query(
      `SELECT ${RECIBO_CAMPOS}, p.documento AS electro_documento
       FROM recibos r
       LEFT JOIN citas_electro ce ON ce.id = r.cita_electro_id
       LEFT JOIN pacientes p ON p.id = ce.paciente_id
       WHERE r.cita_electro_id IN (${phElectro})`,
      electroIds
    )
  ];

  if (rango) {
    queries.push(db.query(
      `SELECT ${RECIBO_CAMPOS}
       FROM recibos r
       WHERE (r.cita_electro_id IS NULL OR r.cita_electro_id = 0)
         AND DATE(r.fecha) BETWEEN ? AND ?
         AND ${SQL_FILTRO_RECIBO_ELECTRO}`,
      [rango.desde, rango.hasta]
    ));
  }

  const documentos = [...new Set(citasElectro.map((c) => normDocumento(c.paciente_documento)).filter((d) => d.length >= 5))];
  if (documentos.length && rango) {
    const docConds = documentos.slice(0, 80).map(() =>
      `REPLACE(REPLACE(REPLACE(REPLACE(JSON_UNQUOTE(JSON_EXTRACT(r.data, '$.doc')), '.', ''), '-', ''), ' ', ''), '/', '') = ?`
    ).join(' OR ');
    queries.push(
      db.query(
        `SELECT ${RECIBO_CAMPOS}
         FROM recibos r
         WHERE (r.cita_electro_id IS NULL OR r.cita_electro_id = 0)
           AND DATE(r.fecha) BETWEEN ? AND ?
           AND (${docConds})`,
        [rango.desde, rango.hasta, ...documentos.slice(0, 80)]
      ).catch(() => [])
    );
  }

  const results = await Promise.all(queries);
  return dedupeRecibosPorId(results.flat());
}

function crearIndiceRecibos(recibos) {
  const porTurnoId = new Map();
  const porCitaElectroId = new Map();
  const porFecha = new Map();
  const porDocumento = new Map();

  for (const r of recibos || []) {
    if (r.turno_id != null && r.turno_id !== '' && Number(r.turno_id) !== 0) {
      const k = Number(r.turno_id);
      if (!porTurnoId.has(k)) porTurnoId.set(k, []);
      porTurnoId.get(k).push(r);
    }
    if (r.cita_electro_id != null && r.cita_electro_id !== '' && Number(r.cita_electro_id) !== 0) {
      const k = Number(r.cita_electro_id);
      if (!porCitaElectroId.has(k)) porCitaElectroId.set(k, []);
      porCitaElectroId.get(k).push(r);
    }
    const f = extraerFechaYmd(r.fecha);
    if (f) {
      if (!porFecha.has(f)) porFecha.set(f, []);
      porFecha.get(f).push(r);
    }
    const doc = extraerDocumentoRecibo(r);
    if (doc.length >= 5) {
      if (!porDocumento.has(doc)) porDocumento.set(doc, []);
      porDocumento.get(doc).push(r);
    }
  }

  return { porTurnoId, porCitaElectroId, porFecha, porDocumento };
}

function candidatosPorFecha(cita, indice, margenDias = MARGEN_DIAS_FECHA) {
  const fechaCita = extraerFechaYmd(cita.fecha);
  if (!fechaCita) return [];
  const candidatos = [];
  const vistos = new Set();
  for (let d = -margenDias; d <= margenDias; d++) {
    const f = sumarDiasYmd(fechaCita, d);
    const lista = indice.porFecha.get(f);
    if (!lista) continue;
    for (const r of lista) {
      if (r?.id != null && !vistos.has(r.id)) {
        vistos.add(r.id);
        candidatos.push(r);
      }
    }
  }
  return candidatos;
}

function mapearRecibosPorCita(citas, recibos, catalogos, tipoCita) {
  const usados = new Set();
  const porCita = new Map(citas.map((c) => [c.id, []]));
  const esMedica = tipoCita === 'AGENDA_MEDICA';
  const indice = crearIndiceRecibos(recibos);
  const coincideFn = esMedica ? reciboCoincideCitaMedica : reciboCoincideCitaElectro;

  for (const c of citas) {
    const directos = esMedica
      ? (indice.porTurnoId.get(Number(c.id)) || [])
      : (indice.porCitaElectroId.get(Number(c.id)) || []);
    for (const r of directos) {
      if (usados.has(r.id)) continue;
      const ok = esMedica ? reciboDirectoMedica(r, c, catalogos) : reciboDirectoElectro(r, c);
      if (!ok) continue;
      porCita.get(c.id).push(r);
      usados.add(r.id);
    }
  }

  for (const c of citas) {
    const doc = normDocumento(c.paciente_documento);
    if (doc.length < 5) continue;
    for (const r of indice.porDocumento.get(doc) || []) {
      if (usados.has(r.id)) continue;
      if (!coincideFn(r, c, catalogos)) continue;
      porCita.get(c.id).push(r);
      usados.add(r.id);
    }
  }

  for (const c of citas) {
    for (const r of candidatosPorFecha(c, indice)) {
      if (usados.has(r.id)) continue;
      if (!coincideFn(r, c, catalogos)) continue;
      porCita.get(c.id).push(r);
      usados.add(r.id);
    }
  }

  return porCita;
}

async function prepararVinculoRecibos(db, citas) {
  const citasMedicas = citas.filter((c) => c.tipo_cita === 'AGENDA_MEDICA');
  const citasElectro = citas.filter((c) => c.tipo_cita === 'ELECTRODIAGNOSTICO');

  const [catalogos, recibosMedicosRaw, recibosElectroRaw] = await Promise.all([
    obtenerCatalogosEnlace(db),
    cargarRecibosConsultaMedica(db, citasMedicas),
    cargarRecibosElectro(db, citasElectro)
  ]);

  const recibosMedicos = recibosMedicosRaw.filter((r) => esReciboConsultaMedica(r, catalogos));
  const recibosElectro = recibosElectroRaw.filter((r) => esReciboElectro(r, catalogos));

  return {
    catalogos,
    medMap: mapearRecibosPorCita(citasMedicas, recibosMedicos, catalogos, 'AGENDA_MEDICA'),
    elecMap: mapearRecibosPorCita(citasElectro, recibosElectro, catalogos, 'ELECTRODIAGNOSTICO')
  };
}

module.exports = {
  MARGEN_DIAS_FECHA,
  resetCatalogosCacheForTests,
  extraerFechaYmd,
  normDocumento,
  extraerDocumentoRecibo,
  pacienteReciboCoincideCita,
  documentosPacienteConflictivos,
  entidadCoincide,
  esReciboElectro,
  esReciboConsultaMedica,
  reciboCoincideCitaMedica,
  reciboCoincideCitaElectro,
  reciboEnlazadoPorTurno,
  reciboEnlazadoPorCitaElectro,
  reciboDirectoMedica,
  reciboDirectoElectro,
  mapearRecibosPorCita,
  cargarCatalogosEnlaceRecibos,
  prepararVinculoRecibos
};
