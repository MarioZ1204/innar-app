'use strict';

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
  if (doctor_id) { electroConditions.push('ce.equipo_id = ?'); electroParams.push(parseInt(doctor_id, 10)); }
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

function agruparRecibosPorCita(rows, tipoCita, idField) {
  const map = new Map();
  rows.forEach((r) => {
    const citaId = r[idField];
    if (citaId == null) return;
    const key = `${tipoCita}-${citaId}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  });
  return map;
}

/** Adjunta recibos vinculados a cada cita (turno_id / cita_electro_id). */
async function enriquecerCitasConRecibos(db, citas) {
  if (!citas.length) return [];

  const turnoIds = citas.filter((c) => c.tipo_cita === 'AGENDA_MEDICA').map((c) => c.id);
  const electroIds = citas.filter((c) => c.tipo_cita === 'ELECTRODIAGNOSTICO').map((c) => c.id);
  const recibosMap = new Map();

  if (turnoIds.length) {
    const ph = turnoIds.map(() => '?').join(',');
    const rows = await db.query(
      `SELECT id, numero, turno_id, cita_electro_id, total, anulado, anulado_razon, estado_pago, observaciones
       FROM recibos WHERE turno_id IN (${ph}) ORDER BY id DESC`,
      turnoIds
    );
    agruparRecibosPorCita(rows, 'AGENDA_MEDICA', 'turno_id').forEach((v, k) => recibosMap.set(k, v));
  }

  if (electroIds.length) {
    const ph = electroIds.map(() => '?').join(',');
    const rows = await db.query(
      `SELECT id, numero, turno_id, cita_electro_id, total, anulado, anulado_razon, estado_pago, observaciones
       FROM recibos WHERE cita_electro_id IN (${ph}) ORDER BY id DESC`,
      electroIds
    );
    agruparRecibosPorCita(rows, 'ELECTRODIAGNOSTICO', 'cita_electro_id').forEach((v, k) => recibosMap.set(k, v));
  }

  return citas.flatMap((c) => {
    const lista = recibosMap.get(`${c.tipo_cita}-${c.id}`) || [];
    return expandirCitaConRecibos(c, lista);
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
  elegirReciboActivo
};
