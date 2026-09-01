'use strict';

const {
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
} = require('./citas-auditoria-vinculo');

function contarEstados(arr, estadosList) {
  return arr.filter((c) => estadosList.includes(c.estado)).length;
}

/** Misma regla que electro: estado Reprogramado o marca [Reprogramado] en observaciones. */
function esElectroReprogramadaAuditoria(row) {
  if (!row) return false;
  const est = String(row.estado || '').trim();
  if (est === 'Reprogramado') return true;
  return /\[Reprogramado\]/i.test(String(row.observaciones || ''));
}

function normalizarEstadoElectroAuditoria(row) {
  if (!row) return row;
  if (!esElectroReprogramadaAuditoria(row)) return row;
  if (row.estado === 'Reprogramado') return row;
  return { ...row, estado: 'Reprogramado' };
}

/** Programado ≠ Reprogramado: no mezclar por coincidencia parcial ni por etiqueta en observaciones. */
function aplicarFiltroEstadoElectro(conditions, params, estado) {
  if (!estado) return;
  if (estado === 'Programado') {
    conditions.push('ce.estado = ?');
    params.push('Programado');
    conditions.push('(ce.observaciones IS NULL OR ce.observaciones NOT LIKE ?)');
    params.push('%[Reprogramado]%');
    return;
  }
  if (estado === 'Reprogramado') {
    conditions.push('(ce.estado = ? OR (ce.observaciones IS NOT NULL AND ce.observaciones LIKE ?))');
    params.push('Reprogramado', '%[Reprogramado]%');
    return;
  }
  conditions.push('ce.estado = ?');
  params.push(estado);
}

function combinarCitasPorTipo(tipoCita, estado, citasMedicas, citasElectro) {
  if (!tipoCita || tipoCita === 'TODOS') {
    const esMedicaEstado = estado && ['PENDIENTE', 'EN_SALA', 'EN_ATENCION', 'ATENDIDO', 'NO_ASISTIO', 'CANCELADO', 'REPROGRAMADO'].includes(estado);
    const esElectroEstado = estado && ['Programado', 'Confirmado', 'En Sala', 'En Estudio', 'Pausado', 'Completado', 'No Asistió', 'Cancelado', 'Reprogramado', 'Adelantado'].includes(estado);
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
  if (estado) aplicarFiltroEstadoElectro(electroConditions, electroParams, estado);
  if (entidadArr.length === 1) { electroConditions.push('ce.entidad = ?'); electroParams.push(entidadArr[0]); }
  else if (entidadArr.length > 1) { electroConditions.push(`ce.entidad IN (${entidadArr.map(() => '?').join(',')})`); electroParams.push(...entidadArr); }
  if (tipoEstudioArr.length === 1) { electroConditions.push('ce.estudio = ?'); electroParams.push(tipoEstudioArr[0]); }
  else if (tipoEstudioArr.length > 1) { electroConditions.push(`ce.estudio IN (${tipoEstudioArr.map(() => '?').join(',')})`); electroParams.push(...tipoEstudioArr); }

  const citasElectroRaw = await db.query(`
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
      ce.observaciones,
      ce.entidad,
      'ELECTRODIAGNOSTICO' AS tipo_cita,
      'N/A' AS numero_turno
    FROM citas_electro ce
    LEFT JOIN pacientes p ON p.id = ce.paciente_id
    WHERE ${electroConditions.join(' AND ')}
    ORDER BY ce.fecha DESC, ce.hora_agendamiento DESC
  `, electroParams);

  const citasElectro = (Array.isArray(citasElectroRaw) ? citasElectroRaw : []).map(normalizarEstadoElectroAuditoria);
  const citasMedicasNorm = Array.isArray(citasMedicas) ? citasMedicas : [];

  const citas = ordenarCitas(combinarCitasPorTipo(tipoCita, estado, citasMedicasNorm, citasElectro));
  const resumen = buildResumenAuditoria(tipoCita, citas, citasMedicasNorm, citasElectro);

  return { citas, resumen, citasMedicas: citasMedicasNorm, citasElectro };
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

function asignarRecibosACitas(citas, recibos, catalogos, tipoCita) {
  const porCita = mapearRecibosPorCita(citas, recibos, catalogos, tipoCita);
  return citas.flatMap((c) => expandirCitaConRecibos(c, porCita.get(c.id)));
}

function adjuntarReciboResumenACita(cita, recibos) {
  const lista = ordenarRecibosParaReporte(recibos || []);
  if (!lista.length) {
    return {
      ...cita,
      ...mapReciboParaExport(null),
      recibo_seq: '',
      recibos_en_cita: 0
    };
  }
  const activo = elegirReciboActivo(lista) || lista[0];
  const total = lista.length;
  const numeros = lista.map((r) => r.numero).filter(Boolean);
  return {
    ...cita,
    ...mapReciboFilaReporte(activo),
    recibo_seq: total > 1 ? `${total} recibos` : '',
    recibos_en_cita: total,
    recibo_numero: numeros.length > 1 ? numeros.join(', ') : (activo.numero || '')
  };
}

function aplicarVinculoACitas(citas, { medMap, elecMap }, modo = 'resumen') {
  if (modo === 'expandido') {
    const medIdx = new Map();
    const elecIdx = new Map();
    for (const c of citas) {
      if (c.tipo_cita === 'AGENDA_MEDICA') {
        const filas = expandirCitaConRecibos(c, medMap.get(c.id) || []);
        medIdx.set(c.id, filas);
      } else if (c.tipo_cita === 'ELECTRODIAGNOSTICO') {
        const filas = expandirCitaConRecibos(c, elecMap.get(c.id) || []);
        elecIdx.set(c.id, filas);
      }
    }
    return citas.flatMap((c) => {
      if (c.tipo_cita === 'AGENDA_MEDICA') return medIdx.get(c.id) || expandirCitaConRecibos(c, []);
      if (c.tipo_cita === 'ELECTRODIAGNOSTICO') return elecIdx.get(c.id) || expandirCitaConRecibos(c, []);
      return expandirCitaConRecibos(c, []);
    });
  }

  return citas.map((c) => {
    if (c.tipo_cita === 'AGENDA_MEDICA') {
      return adjuntarReciboResumenACita(c, medMap.get(c.id) || []);
    }
    if (c.tipo_cita === 'ELECTRODIAGNOSTICO') {
      return adjuntarReciboResumenACita(c, elecMap.get(c.id) || []);
    }
    return adjuntarReciboResumenACita(c, []);
  });
}

/** Adjunta recibos según tipo de cita (export Excel: una fila por recibo). */
async function enriquecerCitasConRecibos(db, citas) {
  if (!citas.length) return [];
  const ctx = await prepararVinculoRecibos(db, citas);
  return aplicarVinculoACitas(citas, ctx, 'expandido');
}

/** Una fila por cita con resumen del recibo (tabla del dashboard). */
async function adjuntarRecibosResumenACitas(db, citas) {
  if (!citas.length) return [];
  const ctx = await prepararVinculoRecibos(db, citas);
  return aplicarVinculoACitas(citas, ctx, 'resumen');
}

function citasSinRecibosResumen(citas) {
  return (citas || []).map((c) => adjuntarReciboResumenACita(c, []));
}

function opcionesCargaRecibosDesdeQuery() {
  return {};
}

module.exports = {
  queryCitasAuditoria,
  enriquecerCitasConRecibos,
  adjuntarRecibosResumenACitas,
  citasSinRecibosResumen,
  opcionesCargaRecibosDesdeQuery,
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
  documentosPacienteConflictivos,
  entidadCoincide,
  asignarRecibosACitas,
  mapearRecibosPorCita,
  adjuntarReciboResumenACita,
  cargarCatalogosEnlaceRecibos,
  prepararVinculoRecibos
};
