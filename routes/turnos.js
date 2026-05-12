// routes/turnos.js
// Agenda médica: turnos, calendario, estados, plantilla excel
const express = require('express');
const router = express.Router();
const db = require('../utils/db-mysql');
const logger = require('../utils/logger');
const procesarAgendaExcel = require('../utils/procesar-agenda-excel');
const {
  requireAuth, requireRoleOrPerm,
  safeError, emitSocket
} = require('../middleware/index');
const { validateSchema } = require('../modules/validation-schemas');

// Helper: obtener siguiente número de turno
async function getNextTurnoNumber(fecha, doctor_id) {
  const result = await db.query(`
    SELECT MAX(CAST(numero_turno AS UNSIGNED)) as max_num FROM turnos 
    WHERE fecha = ? AND doctor_id = ? AND numero_turno IS NOT NULL
  `, [fecha, doctor_id]);
  const maxNum = result[0]?.max_num || 0;
  return maxNum + 1;
}

const ESTADOS_VALIDOS_TURNOS = ['PENDIENTE', 'EN_SALA', 'EN_ATENCION', 'ATENDIDO', 'COMPLETADO', 'NO_ASISTIO', 'CANCELADO', 'REPROGRAMADO'];

// Si el rol del usuario es 'doctor', exige que doctorId coincida con la sesión.
// Otros roles (admin, recepción, electro) no se ven afectados.
function denyIfDoctorMismatch(req, doctorId) {
  if (req.session?.rol === 'doctor') {
    const sessionId = parseInt(req.session.usuarioId, 10);
    const target = parseInt(doctorId, 10);
    if (!target || target !== sessionId) {
      return 'No tienes permiso para operar sobre turnos de otro médico';
    }
  }
  return null;
}

// GET /api/turnos/calendario
router.get('/turnos/calendario', requireAuth, async (req, res) => {
  const { mes, doctor_id } = req.query;
  if (!mes || !/^\d{4}-\d{2}$/.test(mes)) {
    return res.status(400).json({ error: 'mes es obligatorio (formato YYYY-MM)' });
  }
  try {
    const [year, month] = mes.split('-').map(Number);
    const fechaInicio = `${mes}-01`;
    const fechaFin = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;

    const baseSql = `
        SELECT fecha, COUNT(*) as total,
          SUM(CASE WHEN estado IN ('PENDIENTE','EN_SALA','EN_ATENCION') THEN 1 ELSE 0 END) as agendadas,
          SUM(CASE WHEN estado IN ('ATENDIDO','COMPLETADO') THEN 1 ELSE 0 END) as atendidas,
          SUM(CASE WHEN estado = 'NO_ASISTIO' THEN 1 ELSE 0 END) as no_asistieron,
          SUM(CASE WHEN estado = 'CANCELADO' THEN 1 ELSE 0 END) as canceladas,
          SUM(CASE WHEN estado = 'REPROGRAMADO' THEN 1 ELSE 0 END) as reprogramadas
        FROM turnos
        WHERE fecha >= ? AND fecha < ?`;
    let sql, params;
    if (doctor_id) {
      sql = baseSql + ` AND doctor_id = ? GROUP BY fecha ORDER BY fecha ASC`;
      params = [fechaInicio, fechaFin, doctor_id];
    } else {
      sql = baseSql + ` GROUP BY fecha ORDER BY fecha ASC`;
      params = [fechaInicio, fechaFin];
    }
    const rawRows = await db.query(sql, params);
    const rows = rawRows.map(r => ({
      fecha: r.fecha,
      total: Number(r.total) || 0,
      agendadas: Number(r.agendadas) || 0,
      atendidas: Number(r.atendidas) || 0,
      no_asistieron: Number(r.no_asistieron) || 0,
      canceladas: Number(r.canceladas) || 0,
      reprogramadas: Number(r.reprogramadas) || 0
    }));

    let disponibilidad = [];
    if (doctor_id) {
      try {
        disponibilidad = await db.query(
          'SELECT fecha, disponible, disponible_manana, disponible_tarde, motivo_ausencia, total_pacientes FROM doctor_disponibilidad_mensual WHERE doctor_id = ? AND fecha >= ? AND fecha < ?',
          [doctor_id, fechaInicio, fechaFin]
        );
      } catch (_) { /* tabla puede no existir aún */ }
    }

    res.json({ ok: true, dias: rows, disponibilidad });
  } catch (e) {
    logger.error(e.message, { error: e });
    res.status(500).json({ error: safeError(e) });
  }
});

// GET /api/turnos
router.get('/turnos', requireAuth, async (req, res) => {
  const { fecha, doctor_id, buscar } = req.query;

  const COLS = `id, numero_turno, doctor_id, paciente_nombre, paciente_documento,
                paciente_telefono, paciente_telefono2, estado, fecha, hora, tipo_consulta,
                entidad, notas, oportunidad, programado_por, creado_en`;

  if (buscar && !fecha) {
    try {
      const turnos = await db.query(`
        SELECT ${COLS} FROM turnos
        WHERE paciente_documento LIKE ? OR paciente_nombre LIKE ?
        ORDER BY fecha ASC, hora ASC
        LIMIT 50
      `, [`%${buscar}%`, `%${buscar}%`]);
      return res.json(turnos);
    } catch (e) {
      logger.error(e.message, { error: e });
      return res.status(500).json({ error: safeError(e) });
    }
  }

  if (!fecha && !buscar) {
    return res.status(400).json({ error: 'fecha es obligatoria' });
  }

  try {
    const query = doctor_id
      ? `SELECT ${COLS} FROM turnos
         WHERE fecha = ? AND doctor_id = ?
         ORDER BY CASE WHEN hora IS NULL OR hora = '' THEN 1 ELSE 0 END,
                  hora ASC,
                  numero_turno ASC,
                  id ASC
         LIMIT 500`
      : `SELECT ${COLS} FROM turnos
         WHERE fecha = ?
         ORDER BY CASE WHEN hora IS NULL OR hora = '' THEN 1 ELSE 0 END,
                  hora ASC,
                  numero_turno ASC,
                  id ASC
         LIMIT 500`;

    const params = doctor_id ? [fecha, doctor_id] : [fecha];
    const turnos = await db.query(query, params);
    res.json(turnos);
  } catch (e) {
    logger.error(e.message, { error: e });
    res.status(500).json({ error: safeError(e) });
  }
});

// GET /api/turnos/export
router.get('/turnos/export', requireAuth, async (req, res) => {
  const { fecha, doctor_id } = req.query;
  if (!fecha) return res.status(400).json({ error: 'fecha es obligatoria' });
  try {
    const params = doctor_id ? [fecha, doctor_id] : [fecha];
    const whereClause = doctor_id
      ? 'WHERE fecha = ? AND doctor_id = ?'
      : 'WHERE fecha = ?';
    const rows = await db.query(
      `SELECT numero_turno, paciente_nombre, paciente_documento, paciente_telefono,
              estado, hora, tipo_consulta, entidad, notas, fecha
       FROM turnos ${whereClause}
       ORDER BY hora ASC, numero_turno ASC`,
      params
    );
    const headers = ['N° Turno', 'Paciente', 'Documento', 'Teléfono', 'Estado',
      'Hora', 'Tipo Consulta', 'Entidad', 'Notas', 'Fecha'];
    const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [
      headers.join(','),
      ...rows.map(r => [
        r.numero_turno, r.paciente_nombre, r.paciente_documento, r.paciente_telefono,
        r.estado, r.hora, r.tipo_consulta, r.entidad, r.notas, r.fecha
      ].map(escape).join(','))
    ];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="turnos-${fecha}.csv"`);
    res.send('\uFEFF' + lines.join('\r\n'));
  } catch (e) {
    res.status(500).json({ error: safeError(e) });
  }
});

// GET /api/turnos/get-next-number
router.get('/turnos/get-next-number', requireAuth, async (req, res) => {
  const { fecha, doctor_id } = req.query;
  if (!fecha || !doctor_id) {
    return res.status(400).json({ error: 'fecha y doctor_id son obligatorios' });
  }
  try {
    const result = await db.query(`
      SELECT MAX(CAST(numero_turno AS UNSIGNED)) as max_num FROM turnos 
      WHERE fecha = ? AND doctor_id = ? AND numero_turno IS NOT NULL
    `, [fecha, doctor_id]);
    const maxNum = result[0]?.max_num || 0;
    res.json({ numero: maxNum + 1 });
  } catch (e) {
    logger.error(e.message, { error: e });
    res.status(500).json({ error: safeError(e) });
  }
});

// GET /api/turnos/plantilla-excel
router.get('/turnos/plantilla-excel', requireAuth, async (req, res) => {
  const { doctor_id } = req.query;
  try {
    const ExcelJS = require('exceljs');

    const entidadesRows = await db.query('SELECT nombre FROM entidades WHERE activo=1 ORDER BY nombre ASC');
    const entidades = entidadesRows.map(r => r.nombre);

    let tiposConsulta = [];
    if (doctor_id) {
      const docs = await db.query('SELECT especialidad FROM usuarios WHERE id = ?', [parseInt(doctor_id, 10)]);
      if (docs.length && docs[0].especialidad) {
        const esp = await db.query('SELECT id FROM especialidades WHERE nombre = ?', [docs[0].especialidad]);
        if (esp.length) {
          const tipos = await db.query('SELECT nombre FROM tipos_consulta WHERE especialidad_id = ? AND activo = 1 ORDER BY orden ASC, nombre ASC', [esp[0].id]);
          tiposConsulta = tipos.map(t => t.nombre);
        }
      }
    }
    if (!tiposConsulta.length) {
      const all = await db.query('SELECT DISTINCT nombre FROM tipos_consulta WHERE activo = 1 ORDER BY nombre ASC');
      tiposConsulta = all.map(t => t.nombre);
    }

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Pacientes');
    const wsListas = wb.addWorksheet('_Listas');
    wsListas.state = 'veryHidden';
    entidades.forEach((v, i) => { wsListas.getCell(`A${i + 1}`).value = v; });
    tiposConsulta.forEach((v, i) => { wsListas.getCell(`B${i + 1}`).value = v; });

    ws.columns = [
      { header: 'FECHA', key: 'fecha', width: 15 },
      { header: 'HORA', key: 'hora', width: 10 },
      { header: 'NUMERO DOCUMENTO', key: 'documento', width: 20 },
      { header: 'NOMBRES Y APELLIDOS', key: 'nombre', width: 30 },
      { header: 'ENTIDAD', key: 'entidad', width: 20 },
      { header: 'TIPO DE CONSULTA', key: 'tipo', width: 25 },
      { header: 'TELEFONO1', key: 'tel1', width: 15 },
      { header: 'TELEFONO2', key: 'tel2', width: 15 },
      { header: 'NOTAS', key: 'notas', width: 20 },
    ];
    ws.getRow(1).font = { bold: true };
    ws.addRow(['2026-04-01', '08:00', '1234567890', 'Juan Carlos Pérez López', entidades[0] || 'Particular', tiposConsulta[0] || 'Consulta General', '3001234567', '3009876543', '']);

    const maxRows = 200;
    if (entidades.length > 0) {
      const ref = `_Listas!$A$1:$A$${entidades.length}`;
      for (let row = 2; row <= maxRows; row++) {
        ws.getCell(`E${row}`).dataValidation = { type: 'list', allowBlank: true, formulae: [ref], showErrorMessage: true, errorTitle: 'Entidad no válida', error: 'Seleccione una entidad de la lista' };
      }
    }
    if (tiposConsulta.length > 0) {
      const ref = `_Listas!$B$1:$B$${tiposConsulta.length}`;
      for (let row = 2; row <= maxRows; row++) {
        ws.getCell(`F${row}`).dataValidation = { type: 'list', allowBlank: true, formulae: [ref], showErrorMessage: true, errorTitle: 'Tipo de consulta no válido', error: 'Seleccione un tipo de consulta de la lista' };
      }
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=plantilla_citas_medicas.xlsx');
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    logger.error('Error generando plantilla:', e);
    res.status(500).json({ error: safeError(e) });
  }
});

// POST /api/turnos/llamar-siguiente
router.post('/turnos/llamar-siguiente', requireAuth, requireRoleOrPerm(['superadmin', 'admin', 'doctor', 'admin_recepcion', 'recepcion'], 'agenda.llamar_siguiente'), async (req, res) => {
  const { fecha, doctor_id } = req.body || {};
  if (!fecha || !doctor_id) {
    return res.status(400).json({ error: 'fecha y doctor_id son obligatorios' });
  }
  const idorErr = denyIfDoctorMismatch(req, doctor_id);
  if (idorErr) return res.status(403).json({ error: idorErr });
  try {
    const doctor = await db.query(`SELECT numero_consultorio FROM usuarios WHERE id = ?`, [doctor_id]);
    const numeroConsultorio = doctor.length > 0 ? doctor[0].numero_consultorio : null;

    const turnos = await db.query(`
      SELECT id, numero_turno, doctor_id, paciente_nombre, paciente_documento,
             paciente_telefono, fecha, hora, estado
      FROM turnos
      WHERE fecha = ? AND doctor_id = ? AND estado = 'EN_SALA' AND numero_turno IS NOT NULL
      ORDER BY numero_turno ASC LIMIT 1
    `, [fecha, doctor_id]);

    const turno = turnos.length > 0 ? turnos[0] : null;
    if (!turno) {
      return res.status(404).json({ error: 'No hay más pacientes en espera' });
    }

    const turnoConConsultorio = { ...turno, numero_consultorio: numeroConsultorio };

    emitSocket('agenda:turno-llamar-siguiente', {
      turno_id: turno.id,
      doctor_id,
      fecha,
      paciente_nombre: turnoConConsultorio.paciente_nombre,
      numero_turno: turnoConConsultorio.numero_turno,
      numero_consultorio: numeroConsultorio
    });
    res.json({ ok: true, turno: turnoConConsultorio });
  } catch (e) {
    logger.error(e.message, { error: e });
    res.status(500).json({ error: safeError(e) });
  }
});

// POST /api/turnos/marcar-atendido
router.post('/turnos/marcar-atendido', requireAuth, requireRoleOrPerm(['superadmin', 'admin', 'doctor', 'admin_recepcion', 'recepcion'], 'agenda.marcar_atendido'), async (req, res) => {
  const { turno_id } = req.body || {};
  if (!turno_id) {
    return res.status(400).json({ error: 'turno_id es obligatorio' });
  }
  try {
    const turnos = await db.query(`SELECT id, fecha, doctor_id, estado FROM turnos WHERE id = ? AND estado = 'EN_ATENCION'`, [turno_id]);
    const turno = turnos.length > 0 ? turnos[0] : null;
    if (!turno) {
      return res.status(404).json({ error: 'No hay turno en atención actualmente' });
    }

    const idorErr = denyIfDoctorMismatch(req, turno.doctor_id);
    if (idorErr) return res.status(403).json({ error: idorErr });

    await db.transaction(async (conn) => {
      await conn.execute('UPDATE turnos SET estado = ?, numero_turno = NULL WHERE id = ?', ['ATENDIDO', turno_id]);
      const enSalaList = await conn.query(
        `SELECT id FROM turnos WHERE fecha = ? AND doctor_id = ? AND estado = 'EN_SALA' ORDER BY numero_turno ASC, id ASC`,
        [turno.fecha, turno.doctor_id]
      );
      for (let i = 0; i < enSalaList.length; i++) {
        await conn.execute('UPDATE turnos SET numero_turno = ? WHERE id = ?', [i + 1, enSalaList[i].id]);
      }
    });

    emitSocket('agenda:turno-marcar-atendido', {
      turno_id,
      doctor_id: turno.doctor_id,
      fecha: turno.fecha
    });
    emitSocket('agenda:turno-estado-cambio', { id: turno_id, estado: 'ATENDIDO' });

    res.json({ ok: true });
  } catch (e) {
    logger.error(e.message, { error: e });
    res.status(500).json({ error: safeError(e) });
  }
});

// POST /api/turnos
router.post('/turnos', requireAuth, requireRoleOrPerm(['superadmin', 'admin', 'admin_recepcion', 'recepcion', 'auxiliar_recepcion'], 'agenda.crear'), validateSchema('apiCrearTurno'), async (req, res) => {
  const { doctor_id, paciente_nombre, paciente_documento, paciente_telefono, paciente_telefono2, fecha, hora, tipo_consulta, entidad, notas, oportunidad, programado_por } = req.body;

  try {
    const validacion = await procesarAgendaExcel.validarDisponibilidadPorHora(doctor_id, fecha, hora, db);
    if (!validacion.valido) {
      return res.status(400).json({ error: validacion.razon, valido: false });
    }

    const result = await db.execute(`
      INSERT INTO turnos (numero_turno, doctor_id, paciente_nombre, paciente_documento, paciente_telefono, paciente_telefono2, estado, fecha, hora, tipo_consulta, entidad, notas, oportunidad, programado_por)
      VALUES (NULL, ?, ?, ?, ?, ?, 'PENDIENTE', ?, ?, ?, ?, ?, ?, ?)
    `, [
      doctor_id,
      paciente_nombre,
      paciente_documento || null,
      paciente_telefono || null,
      paciente_telefono2 || null,
      fecha,
      hora,
      tipo_consulta || null,
      entidad || null,
      notas || null,
      oportunidad ? parseInt(oportunidad, 10) : null,
      programado_por || null
    ]);

    emitSocket('agenda:turno-creado', { id: result.insertId, doctor_id, paciente_nombre, fecha });
    res.json({ ok: true, id: result.insertId });
  } catch (e) {
    logger.error(e.message, { error: e });
    res.status(500).json({ error: safeError(e) });
  }
});

// PATCH /api/turnos/:id
router.patch('/turnos/:id', requireAuth, requireRoleOrPerm(['superadmin', 'admin', 'admin_recepcion', 'recepcion', 'auxiliar_recepcion', 'doctor'], 'agenda.editar'), validateSchema('apiActualizarTurno'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { paciente_nombre, paciente_telefono, paciente_documento, paciente_telefono2, entidad, notas, tipo_consulta, fecha, hora, estado, observaciones } = req.body;

  if (!id) {
    return res.status(400).json({ error: 'ID inválido' });
  }

  try {
    const turnos = await db.query('SELECT id, estado, doctor_id, fecha, paciente_nombre FROM turnos WHERE id = ?', [id]);
    const turno = turnos.length > 0 ? turnos[0] : null;
    if (!turno) {
      return res.status(404).json({ error: 'Turno no encontrado' });
    }

    const idorErr = denyIfDoctorMismatch(req, turno.doctor_id);
    if (idorErr) return res.status(403).json({ error: idorErr });

    const userRole = req.session?.rol;
    const puedeEditarSiempre = userRole === 'superadmin' || (Array.isArray(req.session?.permisos) && req.session.permisos.includes('agenda.editar_siempre'));
    const ESTADOS_FINALES_EDICION = ['ATENDIDO', 'NO_ASISTIO', 'CANCELADO', 'REPROGRAMADO'];
    if (ESTADOS_FINALES_EDICION.includes(turno.estado) && !puedeEditarSiempre) {
      return res.status(400).json({ error: 'No se puede modificar una cita en estado final. Se requiere permiso especial.' });
    }
    // Solo superadmin puede cambiar el estado de una cita finalizada
    if (estado !== undefined && ESTADOS_FINALES_EDICION.includes(turno.estado) && userRole !== 'superadmin') {
      return res.status(400).json({ error: 'No se puede cambiar el estado de una cita finalizada' });
    }

    const updates = [];
    const values = [];

    if (paciente_nombre !== undefined) { updates.push('paciente_nombre = ?'); values.push(paciente_nombre); }
    if (paciente_telefono !== undefined) { updates.push('paciente_telefono = ?'); values.push(paciente_telefono); }
    if (paciente_documento !== undefined) { updates.push('paciente_documento = ?'); values.push(paciente_documento); }
    if (paciente_telefono2 !== undefined) { updates.push('paciente_telefono2 = ?'); values.push(paciente_telefono2); }
    if (entidad !== undefined) { updates.push('entidad = ?'); values.push(entidad); }
    if (notas !== undefined) { updates.push('notas = ?'); values.push(notas); }
    if (tipo_consulta !== undefined) { updates.push('tipo_consulta = ?'); values.push(tipo_consulta); }
    if (fecha !== undefined) { updates.push('fecha = ?'); values.push(fecha); }
    if (hora !== undefined) { updates.push('hora = ?'); values.push(hora); }
    if (estado !== undefined) { updates.push('estado = ?'); values.push(estado); }
    if (observaciones !== undefined) { updates.push('observaciones = ?'); values.push(observaciones); }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No hay campos para actualizar' });
    }

    values.push(id);
    const query = `UPDATE turnos SET ${updates.join(', ')} WHERE id = ?`;
    await db.execute(query, values);

    if (paciente_nombre !== undefined || paciente_telefono !== undefined || paciente_documento !== undefined || paciente_telefono2 !== undefined || entidad !== undefined || notas !== undefined || tipo_consulta !== undefined) {
      emitSocket('agenda:turno-cambio-paciente', {
        id,
        paciente_nombre: paciente_nombre || turno.paciente_nombre,
        doctor_id: turno.doctor_id,
        fecha: turno.fecha
      });
    }
    if (fecha !== undefined || hora !== undefined || estado !== undefined) {
      emitSocket('agenda:turno-estado-cambio', {
        id,
        estado: estado || turno.estado,
        doctor_id: turno.doctor_id,
        fecha: fecha || turno.fecha
      });
    }

    res.json({ ok: true });
  } catch (e) {
    logger.error(e.message, { error: e });
    res.status(500).json({ error: safeError(e) });
  }
});

// PATCH /api/turnos/:id/estado
router.patch('/turnos/:id/estado', requireAuth, requireRoleOrPerm(['superadmin', 'admin', 'admin_recepcion', 'recepcion', 'doctor', 'auxiliar_recepcion'], 'agenda.cambiar_estado'), validateSchema('apiPatchEstadoTurno'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { estado } = req.body;
  if (!id) {
    return res.status(400).json({ error: 'ID inválido' });
  }

  try {
    const turnos = await db.query('SELECT id, estado, fecha, doctor_id, paciente_nombre, numero_turno FROM turnos WHERE id = ?', [id]);
    const turno = turnos.length > 0 ? turnos[0] : null;
    if (!turno) {
      return res.status(404).json({ error: 'Turno no encontrado' });
    }

    const idorErr = denyIfDoctorMismatch(req, turno.doctor_id);
    if (idorErr) return res.status(403).json({ error: idorErr });

    if (turno.estado === 'ATENDIDO' && estado !== 'ATENDIDO') {
      return res.status(400).json({ error: 'No se puede modificar un turno ya atendido' });
    }

    if (estado === 'EN_ATENCION' && turno.estado !== 'EN_SALA') {
      return res.status(400).json({ error: 'Solo se puede pasar a EN_ATENCION desde EN_SALA' });
    }

    if (estado === 'EN_ATENCION') {
      const enAtencionExistente = await db.query(
        `SELECT id FROM turnos
         WHERE fecha = ? AND doctor_id = ? AND estado = 'EN_ATENCION' AND id != ?
         LIMIT 1`,
        [turno.fecha, turno.doctor_id, id]
      );
      if (enAtencionExistente.length > 0) {
        return res.status(409).json({ error: 'Ya existe un paciente EN_ATENCION para este doctor' });
      }
    }

    const ESTADOS_FINALES = ['ATENDIDO', 'NO_ASISTIO', 'CANCELADO', 'REPROGRAMADO'];
    const esFinal = ESTADOS_FINALES.includes(estado);

    let numeroAsignado = null;
    if (estado === 'EN_SALA' && !turno.numero_turno) {
      await db.transaction(async (conn) => {
        const result = await conn.query(`
          SELECT MAX(CAST(numero_turno AS UNSIGNED)) as max_num FROM turnos 
          WHERE fecha = ? AND doctor_id = ? AND numero_turno IS NOT NULL
        `, [turno.fecha, turno.doctor_id]);
        const maxNum = result[0]?.max_num || 0;
        numeroAsignado = maxNum + 1;
        await conn.execute('UPDATE turnos SET estado = ?, numero_turno = ? WHERE id = ?', [estado, numeroAsignado, id]);
      });
    } else if (esFinal) {
      await db.transaction(async (conn) => {
        await conn.execute('UPDATE turnos SET estado = ?, numero_turno = NULL WHERE id = ?', [estado, id]);
        const enSalaList = await conn.query(
          `SELECT id FROM turnos WHERE fecha = ? AND doctor_id = ? AND estado = 'EN_SALA' ORDER BY numero_turno ASC, id ASC`,
          [turno.fecha, turno.doctor_id]
        );
        for (let i = 0; i < enSalaList.length; i++) {
          await conn.execute('UPDATE turnos SET numero_turno = ? WHERE id = ?', [i + 1, enSalaList[i].id]);
        }
      });
    } else {
      await db.execute('UPDATE turnos SET estado = ? WHERE id = ?', [estado, id]);
    }

    const emitData = { id, estado, paciente_nombre: turno.paciente_nombre || null };
      if (estado === 'EN_ATENCION') {
        const doctorRow = await db.query('SELECT numero_consultorio FROM usuarios WHERE id = ?', [turno.doctor_id]);
        emitData.numero_consultorio = doctorRow.length > 0 ? doctorRow[0].numero_consultorio : null;
      }
      emitSocket('agenda:turno-estado-cambio', emitData);
      if (numeroAsignado) {
        emitSocket('agenda:turno-numero-cambio', {
          id,
          numero_turno: numeroAsignado,
          doctor_id: turno.doctor_id,
          fecha: turno.fecha
        });
      }

    res.json({ ok: true });
  } catch (e) {
    logger.error(e.message, { error: e });
    res.status(500).json({ error: safeError(e) });
  }
});

// POST /api/turnos/aviso-concluir
router.post('/turnos/aviso-concluir', requireAuth,
  requireRoleOrPerm(['superadmin', 'admin', 'admin_recepcion', 'recepcion', 'auxiliar_recepcion', 'admin_electro', 'electro', 'tecnico_electro'], 'agenda.aviso_doctor'),
  (req, res) => {
    const { doctor_id } = req.body || {};
    emitSocket('agenda:aviso-concluir-consulta', { doctor_id: doctor_id || null });
    res.json({ ok: true });
  }
);

// DELETE /api/turnos/:id
router.delete('/turnos/:id', requireAuth, requireRoleOrPerm(['superadmin', 'admin', 'admin_recepcion', 'recepcion'], 'agenda.eliminar'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) {
    return res.status(400).json({ error: 'ID inválido' });
  }

  try {
    const turnos = await db.query('SELECT id, estado, doctor_id, fecha FROM turnos WHERE id = ?', [id]);
    const turno = turnos.length > 0 ? turnos[0] : null;
    if (!turno) {
      return res.status(404).json({ error: 'Turno no encontrado' });
    }

    const userRole = req.session?.rol;
    if (userRole === 'recepcion') {
      if (turno.estado === 'EN_ATENCION' || turno.estado === 'ATENDIDO') {
        return res.status(400).json({ error: 'No se puede eliminar un turno en atención o ya atendido' });
      }
      const enAtencion = await db.query(
        'SELECT id FROM turnos WHERE doctor_id = ? AND fecha = ? AND estado = ? AND id != ?',
        [turno.doctor_id, turno.fecha, 'EN_ATENCION', id]
      );
      if (enAtencion.length > 0) {
        return res.status(400).json({ error: 'No se pueden eliminar citas mientras hay un paciente en atención' });
      }
    } else if (userRole === 'admin_recepcion') {
      if (turno.estado === 'ATENDIDO') {
        return res.status(400).json({ error: 'No se puede eliminar un turno ya atendido' });
      }
    }

    await db.execute('DELETE FROM turnos WHERE id = ?', [id]);

    emitSocket('agenda:turno-eliminado', { id, doctor_id: turno.doctor_id, fecha: turno.fecha });
    res.json({ ok: true });
  } catch (e) {
    logger.error(e.message, { error: e });
    res.status(500).json({ error: safeError(e) });
  }
});

// PATCH /api/turnos/:id/numero
router.patch('/turnos/:id/numero', requireAuth, requireRoleOrPerm(['superadmin', 'admin', 'admin_recepcion', 'recepcion', 'doctor'], 'agenda.cambiar_estado'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { numero, delta } = req.body || {};

  if (!id || (!numero && typeof delta !== 'number')) {
    return res.status(400).json({ error: 'Debe enviar numero o delta' });
  }

  try {
    const turnos = await db.query('SELECT id, estado, numero_turno, fecha, doctor_id FROM turnos WHERE id = ?', [id]);
    const turno = turnos.length > 0 ? turnos[0] : null;
    if (!turno) {
      return res.status(404).json({ error: 'Turno no encontrado' });
    }

    const idorErr = denyIfDoctorMismatch(req, turno.doctor_id);
    if (idorErr) return res.status(403).json({ error: idorErr });

    if (typeof numero === 'number') {
      if (numero <= 0) {
        return res.status(400).json({ error: 'Número debe ser mayor a 0' });
      }
      await db.execute('UPDATE turnos SET numero_turno = ? WHERE id = ?', [numero, id]);
      emitSocket('agenda:turno-numero-cambio', { id, numero_turno: numero, doctor_id: turno.doctor_id, fecha: turno.fecha });
      return res.json({ ok: true });
    }

    if (typeof delta === 'number') {
      if ([-1, 1].indexOf(delta) === -1) {
        return res.status(400).json({ error: 'delta debe ser -1 o 1' });
      }
      if (turno.estado === 'ATENDIDO' || turno.estado === 'EN_ATENCION') {
        return res.status(400).json({ error: 'No se puede reordenar un turno en atención o ya atendido' });
      }
      if (!turno.numero_turno) {
        return res.status(400).json({ error: 'El turno no tiene número asignado aún' });
      }
      const nuevoNumero = turno.numero_turno + delta;
      if (nuevoNumero <= 0) {
        return res.status(400).json({ error: 'No se puede subir más la prioridad' });
      }

      let intercambioOk = false;
      await db.transaction(async (conn) => {
        const turnoIntercambio = await conn.query(
          `SELECT id FROM turnos WHERE numero_turno = ? AND fecha = ? AND doctor_id = ? AND estado IN ('EN_SALA', 'PENDIENTE')`,
          [nuevoNumero, turno.fecha, turno.doctor_id]
        );
        if (turnoIntercambio.length === 0) return;
        await conn.execute('UPDATE turnos SET numero_turno = -1 WHERE id = ?', [id]);
        await conn.execute('UPDATE turnos SET numero_turno = ? WHERE id = ?', [turno.numero_turno, turnoIntercambio[0].id]);
        await conn.execute('UPDATE turnos SET numero_turno = ? WHERE id = ?', [nuevoNumero, id]);
        intercambioOk = true;
      });

      if (!intercambioOk) {
        return res.status(400).json({ error: 'No hay turno para intercambiar' });
      }

      emitSocket('agenda:turno-numero-cambio', { id, numero_turno: nuevoNumero, doctor_id: turno.doctor_id, fecha: turno.fecha });
      return res.json({ ok: true });
    }
  } catch (e) {
    logger.error(e.message, { error: e });
    res.status(500).json({ error: safeError(e) });
  }
});

module.exports = router;
