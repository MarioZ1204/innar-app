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
      recibo_estado: '',
      recibo_observaciones: ''
    };
  }
  const anulado = rec.anulado == 1;
  return {
    recibo_numero: rec.numero || '',
    recibo_valor: Number(rec.total || 0),
    recibo_estado: anulado ? 'ANULADO' : (rec.estado_pago === 'PENDIENTE' ? 'PENDIENTE' : 'PAGADO'),
    recibo_observaciones: anulado ? (rec.anulado_razon || '') : (rec.observaciones || '')
  };
}

/** Adjunta el recibo más reciente vinculado a cada cita (turno_id / cita_electro_id). */
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
    rows.forEach((r) => {
      const key = `AGENDA_MEDICA-${r.turno_id}`;
      if (!recibosMap.has(key)) recibosMap.set(key, r);
    });
  }

  if (electroIds.length) {
    const ph = electroIds.map(() => '?').join(',');
    const rows = await db.query(
      `SELECT id, numero, turno_id, cita_electro_id, total, anulado, anulado_razon, estado_pago, observaciones
       FROM recibos WHERE cita_electro_id IN (${ph}) ORDER BY id DESC`,
      electroIds
    );
    rows.forEach((r) => {
      const key = `ELECTRODIAGNOSTICO-${r.cita_electro_id}`;
      if (!recibosMap.has(key)) recibosMap.set(key, r);
    });
  }

  return citas.map((c) => {
    const rec = recibosMap.get(`${c.tipo_cita}-${c.id}`);
    return { ...c, ...mapReciboParaExport(rec) };
  });
}

module.exports = {
  queryCitasAuditoria,
  enriquecerCitasConRecibos,
  mapReciboParaExport
};
