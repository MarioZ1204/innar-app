'use strict';

const {
  normTipoServicio,
  tipoServicioCoincideNombre,
  tipoServicioCoincideCatalogo
} = require('./recibos-catalogo-filtros');

const RECIBO_CAMPOS_AUDITORIA = 'r.id, r.numero, r.turno_id, r.cita_electro_id, r.total, r.anulado, r.anulado_razon, r.estado_pago, r.observaciones, r.tipo_servicio, r.fecha, r.cliente, r.medico_nombre, r.nombre_entidad, r.data';

const SQL_EXCLUIR_MEDICO_ELECTRO = `(medico_nombre IS NULL OR TRIM(medico_nombre) = '' OR UPPER(TRIM(medico_nombre)) NOT LIKE '%ELECTRODIAG%')`;

function extraerFechaYmd(val) {
  if (!val) return '';
  const m = String(val).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : String(val).slice(0, 10);
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

function extraerDocumentoRecibo(rec) {
  if (!rec) return '';
  const fromJoin = normDocumento(rec.turno_documento || rec.electro_documento || '');
  if (fromJoin) return fromJoin;
  if (rec.data) {
    try {
      const parsed = typeof rec.data === 'string' ? JSON.parse(rec.data) : rec.data;
      const doc = normDocumento(parsed?.doc);
      if (doc) return doc;
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

function pacienteReciboCoincideCita(rec, cita, estrictoNombre = true, opciones = {}) {
  const enlaceDirecto = opciones.enlaceDirecto === true;
  const docRec = extraerDocumentoRecibo(rec);
  const docCita = normDocumento(cita?.paciente_documento);
  if (docRec && docCita) return docRec === docCita;
  if (docRec && !docCita) return false;
  if (!docRec && docCita) return enlaceDirecto;
  return clienteCoincidePaciente(rec?.cliente, cita?.paciente_nombre, estrictoNombre);
}

function normNombrePaciente(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function clienteCoincidePaciente(cliente, pacienteNombre, estricto = false) {
  const a = normNombrePaciente(cliente);
  const b = normNombrePaciente(pacienteNombre);
  if (!a || !b) return estricto ? false : true;
  return a === b || a.includes(b) || b.includes(a);
}

function esMedicoElectroDiagnostico(medicoNombre) {
  const m = normTipoServicio(medicoNombre);
  return m.includes('electrodiag');
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
  if (rec.cita_electro_id != null && rec.cita_electro_id !== '' && Number(rec.cita_electro_id) !== 0) {
    return true;
  }
  if (esTipoServicioElectroDiagnostico(rec.tipo_servicio)) return true;
  const enEstudios = catalogos.estudios?.length
    && tipoServicioCoincideCatalogo(rec.tipo_servicio, catalogos.estudios);
  const enConsulta = catalogos.tiposConsulta?.length
    && tipoServicioCoincideCatalogo(rec.tipo_servicio, catalogos.tiposConsulta);
  if (enEstudios && !enConsulta) return true;
  if (enConsulta && !enEstudios) return false;
  if (esMedicoElectroDiagnostico(rec.medico_nombre) && !enConsulta) return true;
  return false;
}

/** Recibo de consulta médica: no electro (cita_electro, médico electro ni servicio de estudio). */
function esReciboConsultaMedica(rec, catalogos = {}) {
  if (!rec) return false;
  return !esReciboElectro(rec, catalogos);
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

function reciboEnlazadoPorTurno(rec, cita) {
  return rec.turno_id != null && rec.turno_id !== '' && Number(rec.turno_id) === Number(cita.id);
}

function reciboEnlazadoPorCitaElectro(rec, cita) {
  return rec.cita_electro_id != null && rec.cita_electro_id !== '' && Number(rec.cita_electro_id) === Number(cita.id);
}

/** Enlace directo por turno_id o, en su defecto, tipo_servicio ≈ tipo_consulta + fecha + paciente. */
function reciboCoincideCitaMedica(rec, cita, catalogos = {}) {
  if (esReciboElectro(rec, catalogos)) return false;
  if (reciboDirectoMedica(rec, cita, catalogos)) return true;
  if (rec.turno_id != null && rec.turno_id !== '' && Number(rec.turno_id) !== Number(cita.id)) {
    return false;
  }
  if (!cita.tipo_consulta) return false;
  if (catalogos.estudios?.length && tipoServicioCoincideCatalogo(rec.tipo_servicio, catalogos.estudios)) {
    return false;
  }
  if (!tipoServicioCoincideNombre(rec.tipo_servicio, cita.tipo_consulta)) return false;
  const fechaRec = extraerFechaYmd(rec.fecha);
  const fechaCita = extraerFechaYmd(cita.fecha);
  if (fechaRec && fechaCita && fechaRec !== fechaCita) return false;
  if (!entidadCoincide(rec, cita)) return false;
  return pacienteReciboCoincideCita(rec, cita, true);
}

/** Enlace directo por cita_electro_id o, en su defecto, tipo_servicio ≈ estudio + fecha + paciente. */
function reciboCoincideCitaElectro(rec, cita, catalogos = {}) {
  if (reciboDirectoElectro(rec, cita)) return true;
  if (!esReciboElectro(rec, catalogos)) return false;
  if (rec.cita_electro_id != null && rec.cita_electro_id !== '' && Number(rec.cita_electro_id) !== Number(cita.id)) {
    return false;
  }
  if (rec.turno_id != null && rec.turno_id !== '' && Number(rec.turno_id) !== 0) {
    return false;
  }
  if (!cita.tipo_consulta) return false;
  if (!tipoServicioCoincideNombre(rec.tipo_servicio, cita.tipo_consulta)) return false;
  const fechaRec = extraerFechaYmd(rec.fecha);
  const fechaCita = extraerFechaYmd(cita.fecha);
  if (fechaRec && fechaCita && fechaRec !== fechaCita) return false;
  if (!entidadCoincide(rec, cita)) return false;
  return pacienteReciboCoincideCita(rec, cita, true);
}

async function cargarRecibosConsultaMedica(db, citasMedicas) {
  if (!citasMedicas.length) return [];

  const turnoIds = citasMedicas.map((c) => c.id);
  const fechas = [...new Set(citasMedicas.map((c) => extraerFechaYmd(c.fecha)).filter(Boolean))];
  const phTurnos = turnoIds.map(() => '?').join(',');

  const porTurno = await db.query(
    `SELECT ${RECIBO_CAMPOS_AUDITORIA}, t.paciente_documento AS turno_documento
     FROM recibos r
     LEFT JOIN turnos t ON t.id = r.turno_id
     WHERE r.turno_id IN (${phTurnos})`,
    turnoIds
  );

  let porTipoFecha = [];
  if (fechas.length) {
    const phFechas = fechas.map(() => '?').join(',');
    porTipoFecha = await db.query(
      `SELECT ${RECIBO_CAMPOS_AUDITORIA}, t.paciente_documento AS turno_documento
       FROM recibos r
       LEFT JOIN turnos t ON t.id = r.turno_id
       WHERE (r.cita_electro_id IS NULL OR r.cita_electro_id = 0)
         AND ${SQL_EXCLUIR_MEDICO_ELECTRO.replace(/medico_nombre/g, 'r.medico_nombre')}
         AND (r.turno_id IS NULL OR r.turno_id = 0)
         AND DATE(r.fecha) IN (${phFechas})`,
      fechas
    );
  }

  return dedupeRecibosPorId([...porTurno, ...porTipoFecha]);
}

async function cargarRecibosElectro(db, citasElectro) {
  if (!citasElectro.length) return [];

  const electroIds = citasElectro.map((c) => c.id);
  const fechas = [...new Set(citasElectro.map((c) => extraerFechaYmd(c.fecha)).filter(Boolean))];
  const phElectro = electroIds.map(() => '?').join(',');

  const porCitaElectro = await db.query(
    `SELECT ${RECIBO_CAMPOS_AUDITORIA}, p.documento AS electro_documento
     FROM recibos r
     LEFT JOIN citas_electro ce ON ce.id = r.cita_electro_id
     LEFT JOIN pacientes p ON p.id = ce.paciente_id
     WHERE r.cita_electro_id IN (${phElectro})`,
    electroIds
  );

  let porTipoFecha = [];
  if (fechas.length) {
    const phFechas = fechas.map(() => '?').join(',');
    porTipoFecha = await db.query(
      `SELECT ${RECIBO_CAMPOS_AUDITORIA}
       FROM recibos r
       WHERE (r.cita_electro_id IS NULL OR r.cita_electro_id = 0)
         AND (r.turno_id IS NULL OR r.turno_id = 0)
         AND DATE(r.fecha) IN (${phFechas})`,
      fechas
    );
  }

  return dedupeRecibosPorId([...porCitaElectro, ...porTipoFecha]);
}

function dedupeRecibosPorId(rows) {
  const map = new Map();
  (rows || []).forEach((r) => {
    if (r?.id != null) map.set(r.id, r);
  });
  return [...map.values()];
}

function contarEstados(arr, estadosList) {
  return arr.filter((c) => estadosList.includes(c.estado)).length;
}

function combinarCitasPorTipo(tipoCita, estado, citasMedicas, citasElectro) {
  if (!tipoCita || tipoCita === 'TODOS') {
    const esMedicaEstado = estado && ['PENDIENTE', 'EN_SALA', 'EN_ATENCION', 'ATENDIDO', 'NO_ASISTIO', 'CANCELADO', 'REPROGRAMADO'].includes(estado);
    const esElectroEstado = estado && ['Programado', 'Confirmado', 'En Sala', 'En Estudio', 'Completado', 'No Asistió', 'Cancelado', 'Reprogramado'].includes(estado);
    if (esMedicaEstado && !esElectroEstado) return citasMedicas;
    if (esElectroEstado && !esMedicaEstado) return citasElectro;
    return [...citasMedicas, ...citasElectro];
  }
  if (tipoCita === 'AGENDA_MEDICA') return citasMedicas;
  return citasElectro;
}

function ordenarCitas(citas) {
  return [...citas].sort((a, b) => {
    const fd = (b.fecha || '').localeCompare(a.fecha || '');
    if (fd !== 0) return fd;
    return (b.hora || '').localeCompare(a.hora || '');
  });
}

function buildResumenAuditoria(tipoCita, citas, citasMedicas, citasElectro) {
  return {
    total_citas: citas.length,
    citas_medicas: (!tipoCita || tipoCita === 'TODOS' || tipoCita === 'AGENDA_MEDICA') ? citasMedicas.length : 0,
    citas_electrodiagnostico: (!tipoCita || tipoCita === 'TODOS' || tipoCita === 'ELECTRODIAGNOSTICO') ? citasElectro.length : 0,
    atendidos: contarEstados(citas, ['ATENDIDO', 'Completado']),
    no_asistieron: contarEstados(citas, ['NO_ASISTIO', 'No Asistió']),
    cancelados: contarEstados(citas, ['CANCELADO', 'Cancelado']),
    reprogramados: contarEstados(citas, ['REPROGRAMADO', 'Reprogramado']),
    pendientes: contarEstados(citas, ['PENDIENTE', 'EN_SALA', 'EN_ATENCION', 'Programado', 'Confirmado', 'En Sala', 'En Estudio']),
    agendadores: [...new Set(citas.map((c) => c.programado_por))].filter(Boolean)
  };
}

/** Consulta citas médicas y electro con los mismos filtros del dashboard. */
async function queryCitasAuditoria(db, query) {
  const {
    tipo_cita: tipoCita,
    fecha_desde,
    fecha_hasta,
    programado_por,
    tipo_estudio,
    tipo_consulta,
    entidad,
    doctor_id,
    estado,
    especialidad_id
  } = query;

  const entidadArr = entidad ? String(entidad).split(',').filter(Boolean) : [];
  const tipoConsultaArr = tipo_consulta ? String(tipo_consulta).split(',').filter(Boolean) : [];
  const tipoEstudioArr = tipo_estudio ? String(tipo_estudio).split(',').filter(Boolean) : [];

  const medConditions = ['1=1'];
  const medParams = [];
  if (fecha_desde) { medConditions.push('t.fecha >= ?'); medParams.push(fecha_desde); }
  if (fecha_hasta) { medConditions.push('t.fecha <= ?'); medParams.push(fecha_hasta); }
  if (programado_por) { medConditions.push('t.programado_por LIKE ?'); medParams.push(`%${programado_por}%`); }
  if (doctor_id) {
    const doctorIds = String(doctor_id).split(',').map((v) => parseInt(v, 10)).filter((n) => n > 0);
    if (doctorIds.length === 1) {
      medConditions.push('t.doctor_id = ?');
      medParams.push(doctorIds[0]);
    } else if (doctorIds.length > 1) {
      medConditions.push(`t.doctor_id IN (${doctorIds.map(() => '?').join(',')})`);
      medParams.push(...doctorIds);
    }
  }
  if (estado) { medConditions.push('t.estado = ?'); medParams.push(estado); }
  if (especialidad_id) { medConditions.push('e.id = ?'); medParams.push(parseInt(especialidad_id, 10)); }
  if (entidadArr.length === 1) { medConditions.push('t.entidad = ?'); medParams.push(entidadArr[0]); }
  else if (entidadArr.length > 1) { medConditions.push(`t.entidad IN (${entidadArr.map(() => '?').join(',')})`); medParams.push(...entidadArr); }
  if (tipoConsultaArr.length === 1) { medConditions.push('t.tipo_consulta = ?'); medParams.push(tipoConsultaArr[0]); }
  else if (tipoConsultaArr.length > 1) { medConditions.push(`t.tipo_consulta IN (${tipoConsultaArr.map(() => '?').join(',')})`); medParams.push(...tipoConsultaArr); }

  const citasMedicas = await db.query(`
    SELECT
      t.id,
      DATE_FORMAT(t.fecha, '%Y-%m-%d') AS fecha,
      TIME_FORMAT(t.hora, '%H:%i') AS hora,
      t.paciente_documento,
      t.paciente_nombre,
      t.tipo_consulta,
      t.programado_por,
      t.doctor_id,
      COALESCE(u.nombre, '') AS medico_nombre,
      COALESCE(e.nombre, u.especialidad, '') AS especialidad_nombre,
      t.estado,
      t.entidad,
      'AGENDA_MEDICA' AS tipo_cita,
      t.numero_turno
    FROM turnos t
    LEFT JOIN usuarios u ON u.id = t.doctor_id
    LEFT JOIN especialidades e ON LOWER(TRIM(e.nombre)) = LOWER(TRIM(u.especialidad))
    WHERE ${medConditions.join(' AND ')}
    ORDER BY t.fecha DESC, t.hora DESC
  `, medParams);

  const electroConditions = ['ce.deleted_at IS NULL'];
  const electroParams = [];
  if (fecha_desde) { electroConditions.push('ce.fecha >= ?'); electroParams.push(fecha_desde); }
  if (fecha_hasta) { electroConditions.push('ce.fecha <= ?'); electroParams.push(fecha_hasta); }
  if (programado_por) { electroConditions.push('ce.programado_por_nombre LIKE ?'); electroParams.push(`%${programado_por}%`); }
  if (doctor_id) {
    const doctorIds = String(doctor_id).split(',').map((v) => parseInt(v, 10)).filter((n) => n > 0);
    if (doctorIds.length === 1) {
      electroConditions.push('ce.equipo_id = ?');
      electroParams.push(doctorIds[0]);
    } else if (doctorIds.length > 1) {
      electroConditions.push(`ce.equipo_id IN (${doctorIds.map(() => '?').join(',')})`);
      electroParams.push(...doctorIds);
    }
  }
  if (estado) { electroConditions.push('ce.estado = ?'); electroParams.push(estado); }
  if (entidadArr.length === 1) { electroConditions.push('ce.entidad = ?'); electroParams.push(entidadArr[0]); }
  else if (entidadArr.length > 1) { electroConditions.push(`ce.entidad IN (${entidadArr.map(() => '?').join(',')})`); electroParams.push(...entidadArr); }
  if (tipoEstudioArr.length === 1) { electroConditions.push('ce.estudio = ?'); electroParams.push(tipoEstudioArr[0]); }
  else if (tipoEstudioArr.length > 1) { electroConditions.push(`ce.estudio IN (${tipoEstudioArr.map(() => '?').join(',')})`); electroParams.push(...tipoEstudioArr); }

  const citasElectro = await db.query(`
    SELECT
      ce.id,
      DATE_FORMAT(ce.fecha, '%Y-%m-%d') AS fecha,
      TIME_FORMAT(ce.hora_agendamiento, '%H:%i') AS hora,
      p.documento AS paciente_documento,
      p.nombre AS paciente_nombre,
      ce.estudio AS tipo_consulta,
      ce.programado_por_nombre AS programado_por,
      ce.equipo_id AS doctor_id,
      '' AS medico_nombre,
      ce.estudio AS especialidad_nombre,
      ce.estado,
      ce.entidad,
      'ELECTRODIAGNOSTICO' AS tipo_cita,
      'N/A' AS numero_turno
    FROM citas_electro ce
    LEFT JOIN pacientes p ON p.id = ce.paciente_id
    WHERE ${electroConditions.join(' AND ')}
    ORDER BY ce.fecha DESC, ce.hora_agendamiento DESC
  `, electroParams);

  const citas = ordenarCitas(combinarCitasPorTipo(tipoCita, estado, citasMedicas, citasElectro));
  const resumen = buildResumenAuditoria(tipoCita, citas, citasMedicas, citasElectro);

  return { citas, resumen, citasMedicas, citasElectro };
}

function mapReciboParaExport(rec) {
  if (!rec) {
    return {
      recibo_numero: '',
      recibo_valor: '',
      recibo_valor_anulado: '',
      recibo_estado: '',
      recibo_observaciones: ''
    };
  }
  const anulado = rec.anulado == 1;
  return {
    recibo_numero: rec.numero || '',
    recibo_valor: Number(rec.total || 0),
    recibo_valor_anulado: '',
    recibo_estado: anulado ? 'ANULADO' : (rec.estado_pago === 'PENDIENTE' ? 'PENDIENTE' : 'PAGADO'),
    recibo_observaciones: anulado ? (rec.anulado_razon || '') : (rec.observaciones || '')
  };
}

/** Recibo activo a mostrar: pagado > pendiente > más reciente. */
function elegirReciboActivo(recibos) {
  const activos = recibos.filter((r) => r.anulado != 1);
  if (!activos.length) return null;
  const pagados = activos.filter((r) => r.estado_pago !== 'PENDIENTE');
  const pool = pagados.length ? pagados : activos;
  return pool.sort((a, b) => b.id - a.id)[0];
}

/** Una fila de reporte por recibo (activos primero, luego anulados). */
function mapReciboFilaReporte(rec) {
  if (!rec) return mapReciboParaExport(null);
  const base = mapReciboParaExport(rec);
  const anulado = rec.anulado == 1;
  return {
    ...base,
    recibo_tipo_servicio: rec.tipo_servicio || '',
    recibo_valor: anulado ? '' : base.recibo_valor,
    recibo_valor_anulado: anulado ? base.recibo_valor : ''
  };
}

function ordenarRecibosParaReporte(recibos) {
  return [...recibos].sort((a, b) => {
    const peso = (r) => {
      if (r.anulado == 1) return 2;
      if (r.estado_pago === 'PENDIENTE') return 1;
      return 0;
    };
    const pa = peso(a);
    const pb = peso(b);
    if (pa !== pb) return pa - pb;
    return a.id - b.id;
  });
}

/**
 * Expande una cita en N filas (una por recibo vinculado).
 * Si hay 2+ recibos del mismo paciente/cita, el reporte muestra «1 de 2», «2 de 2», etc.
 */
function expandirCitaConRecibos(cita, recibos) {
  const lista = ordenarRecibosParaReporte(recibos || []);
  if (!lista.length) {
    return [{
      ...cita,
      ...mapReciboParaExport(null),
      recibo_seq: '',
      recibos_en_cita: 0
    }];
  }
  const total = lista.length;
  return lista.map((rec, idx) => ({
    ...cita,
    ...mapReciboFilaReporte(rec),
    recibo_seq: total > 1 ? `${idx + 1} de ${total}` : '',
    recibos_en_cita: total
  }));
}

/**
 * @deprecated Resumen en una sola fila — el export usa expandirCitaConRecibos.
 */
function resolverRecibosParaExport(recibos) {
  const filas = expandirCitaConRecibos({}, recibos);
  if (filas.length !== 1) return filas[0];
  const { recibo_seq, recibos_en_cita, ...out } = filas[0];
  return out;
}

function reciboDirectoMedica(rec, cita, catalogos = {}) {
  if (esReciboElectro(rec, catalogos)) return false;
  if (!reciboEnlazadoPorTurno(rec, cita)) return false;
  if (rec.cita_electro_id != null && rec.cita_electro_id !== '' && Number(rec.cita_electro_id) !== 0) {
    return false;
  }
  const fechaRec = extraerFechaYmd(rec.fecha);
  const fechaCita = extraerFechaYmd(cita.fecha);
  if (fechaRec && fechaCita && fechaRec !== fechaCita) return false;
  if (!entidadCoincide(rec, cita)) return false;
  return pacienteReciboCoincideCita(rec, cita, false, { enlaceDirecto: true });
}

function reciboDirectoElectro(rec, cita) {
  if (!reciboEnlazadoPorCitaElectro(rec, cita)) return false;
  const fechaRec = extraerFechaYmd(rec.fecha);
  const fechaCita = extraerFechaYmd(cita.fecha);
  if (fechaRec && fechaCita && fechaRec !== fechaCita) return false;
  if (!entidadCoincide(rec, cita)) return false;
  return pacienteReciboCoincideCita(rec, cita, false, { enlaceDirecto: true });
}

/** Asigna recibos en dos pasos: enlaces directos primero, coincidencia por tipo/fecha después. */
function asignarRecibosACitas(citas, recibos, catalogos, tipoCita) {
  const usados = new Set();
  const porCita = new Map(citas.map((c) => [c.id, []]));
  const directoFn = tipoCita === 'AGENDA_MEDICA'
    ? (r, c) => reciboDirectoMedica(r, c, catalogos)
    : reciboDirectoElectro;
  const coincideFn = tipoCita === 'AGENDA_MEDICA' ? reciboCoincideCitaMedica : reciboCoincideCitaElectro;
  const pool = recibos || [];

  citas.forEach((c) => {
    pool.forEach((r) => {
      if (usados.has(r.id)) return;
      if (!directoFn(r, c)) return;
      porCita.get(c.id).push(r);
      usados.add(r.id);
    });
  });

  citas.forEach((c) => {
    pool.forEach((r) => {
      if (usados.has(r.id)) return;
      if (!coincideFn(r, c, catalogos)) return;
      porCita.get(c.id).push(r);
      usados.add(r.id);
    });
  });

  return citas.flatMap((c) => expandirCitaConRecibos(c, porCita.get(c.id)));
}

/** Adjunta recibos según tipo de cita: médica (turno/tipo consulta) o electro (cita_electro/tipo estudio). */
async function enriquecerCitasConRecibos(db, citas) {
  if (!citas.length) return [];

  const citasMedicas = citas.filter((c) => c.tipo_cita === 'AGENDA_MEDICA');
  const citasElectro = citas.filter((c) => c.tipo_cita === 'ELECTRODIAGNOSTICO');

  const [catalogos, recibosMedicosRaw, recibosElectroRaw] = await Promise.all([
    cargarCatalogosEnlaceRecibos(db),
    cargarRecibosConsultaMedica(db, citasMedicas),
    cargarRecibosElectro(db, citasElectro)
  ]);

  const recibosMedicos = recibosMedicosRaw.filter((r) => esReciboConsultaMedica(r, catalogos));
  const recibosElectro = recibosElectroRaw.filter((r) => esReciboElectro(r, catalogos));

  const filasMedicas = asignarRecibosACitas(citasMedicas, recibosMedicos, catalogos, 'AGENDA_MEDICA');
  const filasElectro = asignarRecibosACitas(citasElectro, recibosElectro, catalogos, 'ELECTRODIAGNOSTICO');

  function indexarFilasPorCita(filas) {
    const map = new Map();
    (filas || []).forEach((f) => {
      if (!map.has(f.id)) map.set(f.id, []);
      map.get(f.id).push(f);
    });
    return map;
  }

  const medIdx = indexarFilasPorCita(filasMedicas);
  const elecIdx = indexarFilasPorCita(filasElectro);

  return citas.flatMap((c) => {
    if (c.tipo_cita === 'AGENDA_MEDICA') {
      return medIdx.get(c.id) || expandirCitaConRecibos(c, []);
    }
    if (c.tipo_cita === 'ELECTRODIAGNOSTICO') {
      return elecIdx.get(c.id) || expandirCitaConRecibos(c, []);
    }
    return expandirCitaConRecibos(c, []);
  });
}

module.exports = {
  queryCitasAuditoria,
  enriquecerCitasConRecibos,
  mapReciboParaExport,
  mapReciboFilaReporte,
  expandirCitaConRecibos,
  ordenarRecibosParaReporte,
  resolverRecibosParaExport,
  elegirReciboActivo,
  esReciboElectro,
  esReciboConsultaMedica,
  reciboCoincideCitaMedica,
  reciboCoincideCitaElectro,
  reciboEnlazadoPorTurno,
  reciboEnlazadoPorCitaElectro,
  reciboDirectoMedica,
  reciboDirectoElectro,
  normDocumento,
  extraerDocumentoRecibo,
  pacienteReciboCoincideCita,
  entidadCoincide,
  asignarRecibosACitas,
  cargarCatalogosEnlaceRecibos
};
