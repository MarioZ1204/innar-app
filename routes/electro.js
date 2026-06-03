// routes/electro.js
// Electrodiagnóstico: equipos, estudios, UCQN, diagnósticos, citas electro
const express = require('express');
const router = express.Router();
const db = require('../utils/db-mysql');
const logger = require('../utils/logger');
const transactions = require('../utils/transactions');
const { upload, validateMagicBytes } = require('../middleware/upload');
const {
  requireAuth, requireRoleOrPerm,
  safeError, emitSocket
} = require('../middleware/index');
const { validateSchema } = require('../modules/validation-schemas');
const { hayCupoElectroParaAgendar, hayCupoElectroParaIniciar } = require('./electro-capacity');
const { buildMonitorEquiposView, citaOverlapsMonitorWindow } = require('../utils/electro-monitor');
const {
  extraerFechaYmd,
  sumarMinutosAHoraYFecha,
  fechaFinSiCruzaMedianoche,
  sqlCitaElectroVisibleEnFecha,
  paramsCitaElectroVisibleEnFecha,
  horaInicioCitaElectro,
  horaInicioAgendadaParaInicioEstudio,
  horaInicioEfectivaParaInicioEstudio,
  finProgramadoCitaElectro,
  inferirDuracionMinutosCitaElectro,
  calcularFinInicioEstudioElectro,
  sqlEstudioElectroFinProgramadoTs,
  sqlEstudioElectroFinProgramadoVencido
} = require('../utils/electro-fechas');

/** Rellena duracion_minutos desde catálogo o ventana agendada→hora_fin si falta. */
async function asegurarDuracionMinutosCitaElectro(cita) {
  if (!cita?.id) return cita;
  if (parseInt(cita.duracion_minutos, 10) > 0) return cita;
  let dur = null;
  if (cita.estudio) {
    try {
      const cat = await db.query(
        'SELECT duracion_minutos FROM estudio_duraciones WHERE nombre = ? LIMIT 1',
        [String(cita.estudio).trim()]
      );
      dur = parseInt(cat[0]?.duracion_minutos, 10) || null;
    } catch (err) {
      logger.warn('Catálogo estudio_duraciones no disponible:', err.message);
    }
  }
  if (!(dur > 0)) dur = inferirDuracionMinutosCitaElectro(cita);
  if (dur > 0) {
    await db.execute(
      'UPDATE citas_electro SET duracion_minutos = ? WHERE id = ? AND (duracion_minutos IS NULL OR duracion_minutos = 0)',
      [dur, cita.id]
    );
    cita.duracion_minutos = dur;
  }
  return cita;
}

/** Sincroniza duración en citas visibles de un día que solo tienen hora_fin (evita auto-cierre con slot corto). */
async function sincronizarDuracionesElectroEnFecha(fechaYmd) {
  if (!fechaYmd || !/^\d{4}-\d{2}-\d{2}$/.test(fechaYmd)) return 0;
  const vis = sqlCitaElectroVisibleEnFecha('c');
  const rows = await db.query(`
    SELECT c.id, c.fecha, c.hora_agendamiento, c.hora_fin, c.hora_fin_date, c.duracion_minutos, c.estudio
    FROM citas_electro c
    WHERE c.deleted_at IS NULL
      AND (c.duracion_minutos IS NULL OR c.duracion_minutos = 0)
      AND c.hora_fin IS NOT NULL
      AND ${vis}
  `, paramsCitaElectroVisibleEnFecha(fechaYmd));
  let n = 0;
  for (const row of rows) {
    await asegurarDuracionMinutosCitaElectro(row);
    n += 1;
  }
  return n;
}

/** Devuelve a En Estudio citas Completado cuyo tiempo programado aún no terminó. */
async function revertirElectroCompletadosAntesDeTiempo(diasVentana = 14, fechaCentro = null) {
  const dias = Math.min(Math.max(parseInt(diasVentana, 10) || 14, 1), 90);
  const finTs = sqlEstudioElectroFinProgramadoTs();
  let filtroFecha = `fecha >= DATE_SUB(CURDATE(), INTERVAL ${dias} DAY)`;
  const params = [];
  if (fechaCentro && /^\d{4}-\d{2}-\d{2}$/.test(fechaCentro)) {
    filtroFecha = 'fecha >= DATE_SUB(?, INTERVAL 3 DAY) AND fecha <= DATE_ADD(?, INTERVAL 3 DAY)';
    params.push(fechaCentro, fechaCentro);
  }
  try {
    const result = await db.execute(`
      UPDATE citas_electro
      SET
        estado = 'En Estudio',
        editado_por_nombre = 'Sistema (Corrección)',
        editado_en = NOW()
      WHERE deleted_at IS NULL
        AND estado = 'Completado'
        AND ${filtroFecha}
        AND ${finTs} > NOW()
    `, params);
    return result[0]?.affectedRows ?? result.affectedRows ?? 0;
  } catch (err) {
    logger.warn('Revertir completados electro falló:', err.message);
    return 0;
  }
}

/** Al abrir el kanban/monitor: reparar duraciones y revertir completados prematuros del día consultado. */
async function repararEstadosElectroAlConsultar(fechaYmd) {
  if (!fechaYmd || !/^\d{4}-\d{2}-\d{2}$/.test(fechaYmd)) return { duraciones: 0, revertidas: 0 };
  try {
    const duraciones = await sincronizarDuracionesElectroEnFecha(fechaYmd);
    const revertidas = await revertirElectroCompletadosAntesDeTiempo(14, fechaYmd);
    return { duraciones, revertidas };
  } catch (err) {
    logger.warn('Reparar estados electro al consultar falló (no crítico):', err.message);
    return { duraciones: 0, revertidas: 0 };
  }
}

/** Cierra estudios cuyo fin programado (inicio/duración o hora_fin) ya venció. */
async function autoCompletarEstudiosElectroVencidos(excludeId = null) {
  const condId = excludeId ? ' AND id != ?' : '';
  const params = excludeId ? [excludeId] : [];
  const sqlVencido = sqlEstudioElectroFinProgramadoVencido();
  const finTs = sqlEstudioElectroFinProgramadoTs();
  await db.execute(`
    UPDATE citas_electro
    SET estado = 'Completado', editado_por_nombre = 'Sistema (Auto)', editado_en = NOW()
    WHERE estado IN ('En Estudio', 'Pausado')
      AND deleted_at IS NULL
      AND ${sqlVencido}
      ${condId}
  `, params).catch((err) => logger.warn('Auto-completar estudios vencidos falló (no crítico):', err.message));
}

/** Entidad de la cita: columna propia, lista de espera o último recibo vinculado. */
const SQL_ENTIDAD_CITA_ELECTRO = `
  COALESCE(
    NULLIF(TRIM(c.entidad), ''),
    (
      SELECT pe.entidad FROM pacientes_espera pe
      WHERE pe.documento IS NOT NULL AND p.documento IS NOT NULL
        AND TRIM(pe.documento) = TRIM(p.documento)
      ORDER BY pe.id DESC LIMIT 1
    ),
    (
      SELECT r.nombre_entidad FROM recibos r
      WHERE r.cita_electro_id = c.id
        AND r.nombre_entidad IS NOT NULL AND TRIM(r.nombre_entidad) <> ''
      ORDER BY r.id DESC LIMIT 1
    )
  ) AS entidad`;

const CITAS_ELECTRO_SELECT = `
  c.id, c.equipo_id, c.paciente_id,
  DATE_FORMAT(c.fecha, '%Y-%m-%d') AS fecha,
  c.hora_agendamiento, c.hora_inicio, c.hora_fin,
  DATE_FORMAT(c.hora_fin_date, '%Y-%m-%d') AS hora_fin_date,
  c.estudio, c.observaciones, c.diagnostico_id, c.estado,
  c.programado_por_nombre, c.editado_por_nombre, c.editado_en, c.creado_en, c.actualizado_en,
  c.duracion_minutos, ${SQL_ENTIDAD_CITA_ELECTRO}`;

function normalizeHora(str) {
  if (!str) return '';
  const s = String(str).trim().toUpperCase();
  const m12 = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/);
  if (m12) {
    let h = parseInt(m12[1], 10);
    const m = parseInt(m12[2], 10);
    if (m12[3] === 'AM') { if (h === 12) h = 0; }
    else { if (h !== 12) h += 12; }
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  const m24 = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (m24) {
    const h = parseInt(m24[1], 10);
    const m = parseInt(m24[2], 10);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59)
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  return '';
}

function normalizeFecha(str) {
  if (!str) return '';
  const s = String(str).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.slice(0, 10);
  const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  return s.slice(0, 10);
}

// Helper: sincronizar estudios UCQN desde citas_electro
async function sincronizarUcqnDesdeElectro() {
  const rows = await db.query(`
    SELECT
      ce.id AS cita_electro_id,
      ce.fecha AS fecha_estudio,
      ce.hora_agendamiento AS hora_estudio,
      p.nombre AS paciente_nombre_completo,
      p.documento AS paciente_documento,
      ce.estudio AS tipo_estudio,
      ce.entidad AS entidad
    FROM citas_electro ce
    JOIN pacientes p ON p.id = ce.paciente_id
    WHERE ce.deleted_at IS NULL
      AND UPPER(TRIM(COALESCE(ce.entidad, ''))) = 'UCQN'
  `);

  for (const r of rows) {
    const fullName = String(r.paciente_nombre_completo || '').trim();
    const parts = fullName.split(/\s+/).filter(Boolean);
    const nombres = parts.length > 1 ? parts.slice(0, -1).join(' ') : fullName;
    const apellidos = parts.length > 1 ? parts.slice(-1).join(' ') : '';
    await db.execute(
      `INSERT INTO ucqn_estudios (
        cita_electro_id, fecha_estudio, hora_estudio, paciente_nombres, paciente_apellidos,
        paciente_documento, tipo_estudio, entidad, estado
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDIENTE')
      ON DUPLICATE KEY UPDATE
        fecha_estudio = VALUES(fecha_estudio),
        hora_estudio = VALUES(hora_estudio),
        paciente_nombres = VALUES(paciente_nombres),
        paciente_apellidos = VALUES(paciente_apellidos),
        paciente_documento = VALUES(paciente_documento),
        tipo_estudio = VALUES(tipo_estudio),
        entidad = VALUES(entidad)`,
      [
        r.cita_electro_id,
        r.fecha_estudio,
        r.hora_estudio,
        nombres || '',
        apellidos || '',
        r.paciente_documento || null,
        r.tipo_estudio || null,
        r.entidad || 'UCQN'
      ]
    );
  }
}

// GET /api/equipos-electro
router.get('/equipos-electro', requireAuth, async (req, res) => {
  try {
    const equipos = await db.query('SELECT * FROM equipos_electro WHERE activo = 1 ORDER BY nombre ASC');
    // En uso = estudio activo en el equipo (sin ventana horaria agendada).
    const equiposEnUso = await db.query(
      `SELECT DISTINCT equipo_id FROM citas_electro
       WHERE estado IN ('En Estudio', 'Pausado') AND equipo_id IS NOT NULL AND deleted_at IS NULL`
    );
    const equiposEnUsoIds = equiposEnUso.map(e => e.equipo_id);
    const vistosIds = new Set();
    const equiposConEstado = equipos
      .filter(e => { if (vistosIds.has(e.id)) return false; vistosIds.add(e.id); return true; })
      .map(e => ({ ...e, en_uso: equiposEnUsoIds.map(String).includes(String(e.id)) }));
    res.json(equiposConEstado);
  } catch (e) {
    res.status(500).json({ error: safeError(e) });
  }
});

// GET /api/equipos-electro/todos (incluye inactivos, solo superadmin)
router.get('/equipos-electro/todos', requireAuth, requireRoleOrPerm(['superadmin']), async (req, res) => {
  try {
    const equipos = await db.query('SELECT * FROM equipos_electro ORDER BY activo DESC, nombre ASC');
    res.json(equipos);
  } catch (e) { res.status(500).json({ error: safeError(e) }); }
});

// PATCH /api/equipos-electro/:id (editar equipo - superadmin)
router.patch('/equipos-electro/:id', requireAuth, requireRoleOrPerm(['superadmin']), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  const { nombre, descripcion, activo } = req.body || {};
  try {
    const exists = await db.queryOne('SELECT id FROM equipos_electro WHERE id = ?', [id]);
    if (!exists) return res.status(404).json({ error: 'Equipo no encontrado' });
    const updates = [];
    const values = [];
    if (nombre !== undefined) {
      if (!nombre || !String(nombre).trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
      updates.push('nombre = ?'); values.push(String(nombre).trim());
    }
    if (descripcion !== undefined) { updates.push('descripcion = ?'); values.push(descripcion ? String(descripcion).trim() : null); }
    if (activo !== undefined) { updates.push('activo = ?'); values.push(activo ? 1 : 0); }
    if (updates.length === 0) return res.status(400).json({ error: 'No se proporcionaron campos para actualizar' });
    values.push(id);
    await db.execute(`UPDATE equipos_electro SET ${updates.join(', ')} WHERE id = ?`, values);
    emitSocket('electro:actualizar-lista', { type: 'equipo-editado', id });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: safeError(e) }); }
});

// POST /api/equipos-electro (crear equipo - superadmin)
router.post('/equipos-electro', requireAuth, requireRoleOrPerm(['superadmin']), async (req, res) => {
  const { nombre, descripcion } = req.body || {};
  if (!nombre || !String(nombre).trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
  try {
    const result = await db.execute(
      'INSERT INTO equipos_electro (nombre, descripcion, activo) VALUES (?, ?, 1)',
      [String(nombre).trim(), descripcion ? String(descripcion).trim() : null]
    );
    const insertId = result[0]?.insertId ?? result.insertId;
    emitSocket('electro:actualizar-lista', { type: 'equipo-creado', id: insertId });
    res.json({ ok: true, id: insertId });
  } catch (e) { res.status(500).json({ error: safeError(e) }); }
});

// GET /api/equipos-electro/monitor
router.get('/equipos-electro/monitor', requireAuth, requireRoleOrPerm(
  ['superadmin', 'admin', 'admin_recepcion', 'recepcion', 'admin_electro', 'electro', 'tecnico_electro'],
  'modulo.monitor_equipos'
), async (req, res) => {
  try {
    const now = new Date();
    const hoy = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    const fechaParam = req.query.fecha && /^\d{4}-\d{2}-\d{2}$/.test(req.query.fecha) ? req.query.fecha : null;
    const esHoy = !fechaParam || fechaParam === hoy;
    const fechaConsulta = fechaParam || hoy;

    await repararEstadosElectroAlConsultar(fechaConsulta);

    const equipos = await db.query('SELECT id, nombre, descripcion, activo FROM equipos_electro ORDER BY activo DESC, nombre ASC');

    const [yC, mC, dC] = fechaConsulta.split('-').map(Number);
    const fechaAnterior = (() => {
      const dt = new Date(yC, mC - 1, dC - 1);
      return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    })();
    const fechaSiguiente = (() => {
      const dt = new Date(yC, mC - 1, dC + 1);
      return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    })();

    const citasDiaRows = await db.query(`
      SELECT c.id, c.equipo_id, c.estudio, c.estado, c.fecha,
             c.hora_agendamiento, c.hora_inicio, c.hora_fin, c.hora_fin_date,
             c.duracion_minutos, ${SQL_ENTIDAD_CITA_ELECTRO},
             p.nombre AS paciente_nombre, p.documento AS paciente_documento
      FROM citas_electro c
      JOIN pacientes p ON p.id = c.paciente_id
      WHERE c.deleted_at IS NULL
        AND c.estado NOT IN ('Cancelado')
        AND c.fecha <= ?
        AND COALESCE(c.hora_fin_date, c.fecha) >= ?
      ORDER BY COALESCE(c.hora_inicio, c.hora_agendamiento) ASC, c.id ASC
    `, [fechaSiguiente, fechaAnterior]);

    const vista = buildMonitorEquiposView(citasDiaRows, equipos, fechaConsulta, esHoy);
    const citasEnVentana = citasDiaRows.filter((c) => citaOverlapsMonitorWindow(c, fechaConsulta));
    const provisionCount = citasEnVentana.filter((c) => {
      const sinEq = c.equipo_id == null || c.equipo_id === '' || Number(c.equipo_id) === 0;
      return sinEq;
    }).length;

    res.json({
      fecha: fechaConsulta,
      es_hoy: esHoy,
      ventana_horaria: vista.ventana_horaria,
      resumen: {
        total_estudios: vista.total_en_ventana || citasEnVentana.length,
        completados: citasEnVentana.filter((c) => c.estado === 'Completado').length,
        en_estudio: citasEnVentana.filter((c) => c.estado === 'En Estudio' || c.estado === 'Pausado').length,
        pendientes: citasEnVentana.filter((c) => ['Programado', 'Confirmado', 'En Sala', 'Reprogramado', 'Adelantado'].includes(c.estado)).length,
        sin_equipo: vista.sin_equipo.length,
        sin_cupo_provision: vista.sin_cupo_provision.length,
        con_provision: provisionCount - vista.sin_cupo_provision.length,
        en_ventana: vista.total_en_ventana || 0
      },
      equipos: vista.equipos,
      sin_equipo: vista.sin_equipo,
      sin_cupo_provision: vista.sin_cupo_provision
    });
  } catch (e) {
    logger.error('Error en monitor de equipos:', e);
    res.status(500).json({ error: safeError(e) });
  }
});

// GET /api/estudios/duracion
router.get('/estudios/duracion', requireAuth, async (req, res) => {
  try {
    const { nombre } = req.query;
    if (!nombre) return res.status(400).json({ error: 'nombre del estudio es obligatorio' });
    let estudios = await db.query(
      'SELECT nombre, duracion_minutos, duracion_min, duracion_max FROM estudio_duraciones WHERE nombre = ?',
      [nombre]
    );
    if (!estudios || estudios.length === 0) {
      estudios = await db.query(
        "SELECT nombre, duracion_minutos, duracion_min, duracion_max FROM estudio_duraciones WHERE nombre LIKE ? OR ? LIKE CONCAT('%', nombre, '%')",
        [`%${nombre}%`, nombre]
      );
    }
    if (!estudios || estudios.length === 0) {
      return res.json({ ok: false, error: 'Estudio no encontrado en duraciones' });
    }
    const est = estudios[0];
    res.json({
      ok: true,
      duracion_minutos: est.duracion_minutos,
      duracion_min: est.duracion_min,
      duracion_max: est.duracion_max,
      esVariable: est.duracion_min !== null && est.duracion_max !== null
    });
  } catch (e) {
    logger.error('Error obteniendo duración:', e);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// GET /api/equipos-electro/disponibilidad
router.get('/equipos-electro/disponibilidad', requireAuth, async (req, res) => {
  try {
    const { fecha, hora, estudio, duracion_manual } = req.query;
    if (!fecha || !hora) return res.status(400).json({ error: 'fecha y hora son obligatorios' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return res.status(400).json({ error: 'Fecha inválida (YYYY-MM-DD)' });
    if (!/^\d{2}:\d{2}(:\d{2})?$/.test(hora)) return res.status(400).json({ error: 'Hora inválida (HH:MM)' });

    let duracionMinutos = 30;
    if (estudio) {
      const estudios = await db.query(
        'SELECT duracion_minutos, duracion_min, duracion_max FROM estudio_duraciones WHERE nombre = ?',
        [estudio]
      );
      if (estudios && estudios.length > 0) {
        const est = estudios[0];
        if (est.duracion_min && est.duracion_max) {
          duracionMinutos = duracion_manual ? parseInt(duracion_manual, 10) : est.duracion_min;
        } else {
          duracionMinutos = est.duracion_minutos || 30;
        }
      }
    }
    if (!Number.isFinite(duracionMinutos) || duracionMinutos <= 0) duracionMinutos = 30;
    duracionMinutos = Math.min(duracionMinutos, 10080);

    const [hh, mm] = hora.split(':').map(x => parseInt(x, 10));
    const fechaHoraInicio = new Date(`${fecha}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`);
    if (isNaN(fechaHoraInicio.getTime())) return res.status(400).json({ error: 'Fecha/hora inválida' });
    const fechaHoraFin = new Date(fechaHoraInicio.getTime() + (duracionMinutos * 60000));
    if (isNaN(fechaHoraFin.getTime())) return res.status(400).json({ error: 'No se pudo calcular la fecha final' });
    const horaFin = `${String(fechaHoraFin.getHours()).padStart(2, '0')}:${String(fechaHoraFin.getMinutes()).padStart(2, '0')}`;
    const fechaFin = `${fechaHoraFin.getFullYear()}-${String(fechaHoraFin.getMonth() + 1).padStart(2, '0')}-${String(fechaHoraFin.getDate()).padStart(2, '0')}`;

    const equiposActivosRows = await db.query(`SELECT COUNT(*) AS total FROM equipos_electro WHERE activo = 1`);
    const maxCupos = Math.max(0, parseInt(equiposActivosRows?.[0]?.total, 10) || 0);

    const citasOcupadas = await db.query(`
      SELECT c.id, c.paciente_id, c.fecha, c.hora_agendamiento, c.hora_inicio, c.hora_fin, c.hora_fin_date,
             c.estudio, c.estado, c.equipo_id, e.nombre AS equipo_nombre
      FROM citas_electro c
      LEFT JOIN equipos_electro e ON e.id = c.equipo_id
      WHERE c.estado IN ('Programado', 'Confirmado', 'En Sala', 'En Estudio', 'Pausado')
      AND c.deleted_at IS NULL
      AND TIMESTAMP(c.fecha, COALESCE(c.hora_agendamiento, '00:00:00')) < TIMESTAMP(?, ?)
      AND TIMESTAMP(COALESCE(c.hora_fin_date, c.fecha), COALESCE(c.hora_fin, '23:59:59')) > TIMESTAMP(?, ?)
      ORDER BY c.fecha, c.hora_agendamiento
    `, [fechaFin, horaFin, fecha, hora]);

    const cupoCheck = hayCupoElectroParaAgendar(citasOcupadas, fechaHoraInicio, fechaHoraFin, maxCupos);
    const cuposOcupados = cupoCheck.peak;
    const cuposaDisponibles = cupoCheck.disponibles;
    const hayDisponibilidad = cupoCheck.ok;

    const equiposEnUso = citasOcupadas
      .filter(c => c.equipo_id)
      .map(c => ({ equipo_id: String(c.equipo_id), equipo_nombre: c.equipo_nombre || `Equipo ${c.equipo_id}` }))
      .filter((eq, idx, self) => idx === self.findIndex(e => String(e.equipo_id) === String(eq.equipo_id)));

    const convertirFecha = (f) => {
      if (typeof f === 'string') return f;
      if (f instanceof Date) return f.toISOString().slice(0, 10);
      return String(f);
    };
    const convertirHora = (h) => typeof h === 'string' ? h : String(h);

    const citasEnRango = citasOcupadas.map((cita) => {
      const finProg = finProgramadoCitaElectro(cita);
      const fechaFin = finProg ? finProg.fechaFin : convertirFecha(cita.hora_fin_date || cita.fecha);
      const horaFin = finProg ? finProg.horaFin : convertirHora(cita.hora_fin);
      return {
        id: cita.id, estudio: cita.estudio,
        fechaInicio: convertirFecha(cita.fecha),
        horaInicio: convertirHora(cita.hora_agendamiento),
        horaInicioReal: cita.hora_inicio ? convertirHora(cita.hora_inicio) : null,
        fechaFin,
        horaFin,
        estado: cita.estado, equipo_id: cita.equipo_id, equipo_nombre: cita.equipo_nombre,
        hora: `${convertirHora(cita.hora_agendamiento)}-${horaFin}`
      };
    });

    let proximaDisponibilidad = null;
    if (!hayDisponibilidad && citasOcupadas.length > 0) {
      let maxFechaHoraFin = null;
      citasOcupadas.forEach(cita => {
        const fechaFinCita = convertirFecha(cita.hora_fin_date || cita.fecha);
        const horaFinCita = convertirHora(cita.hora_fin);
        const dt = `${fechaFinCita} ${horaFinCita}`;
        if (!maxFechaHoraFin || dt > maxFechaHoraFin) maxFechaHoraFin = dt;
      });
      if (maxFechaHoraFin) {
        const [fechaMax, horaMax] = maxFechaHoraFin.split(' ');
        proximaDisponibilidad = fechaMax !== fecha ? `${fechaMax} ${horaMax}` : horaMax;
      }
    }

    res.json({
      fecha, hora, horaFin, duracionMinutos,
      estudio: estudio || 'Sin especificar',
      capacidad: { maxCupos, cuposOcupados, cuposaDisponibles, hayDisponibilidad, equiposEnUso },
      citasEnRango, proximaDisponibilidad,
      mensaje: !hayDisponibilidad
        ? `⚠️ Sin capacidad. ${cuposOcupados}/${maxCupos} cupos ocupados (${equiposEnUso.map(e => e.equipo_nombre).join(', ')}). Próxima disponibilidad: ${proximaDisponibilidad}`
        : `Disponibilidad: ${cuposaDisponibles}/${maxCupos} cupos libres${equiposEnUso.length > 0 ? ` (En uso: ${equiposEnUso.map(e => e.equipo_nombre).join(', ')})` : ''}`
    });
  } catch (e) {
    logger.error('[electro/disponibilidad] Error:', e.message);
    res.status(500).json({ error: safeError(e) });
  }
});

// GET /api/ucqn/estudios
router.get('/ucqn/estudios', requireAuth, requireRoleOrPerm(['superadmin', 'admin', 'admin_recepcion', 'recepcion', 'admin_electro', 'electro', 'contabilidad'], ['ucqn.ver', 'electro.ver']), async (req, res) => {
  try {
    await sincronizarUcqnDesdeElectro();
    const { fecha_desde, fecha_hasta, estado } = req.query;
    const conditions = ['1=1'];
    const params = [];
    if (fecha_desde) { conditions.push('u.fecha_estudio >= ?'); params.push(fecha_desde); }
    if (fecha_hasta) { conditions.push('u.fecha_estudio <= ?'); params.push(fecha_hasta); }
    if (estado && ['PENDIENTE', 'LEIDO', 'FACTURADO'].includes(String(estado).toUpperCase())) {
      conditions.push('u.estado = ?');
      params.push(String(estado).toUpperCase());
    }
    const rows = await db.query(`
      SELECT u.id, u.cita_electro_id, DATE_FORMAT(u.fecha_estudio, '%Y-%m-%d') AS fecha_estudio,
             u.hora_estudio, u.paciente_nombres, u.paciente_apellidos, u.paciente_documento,
             u.tipo_estudio, u.entidad, u.estado, u.estado_actualizado_en, u.estado_actualizado_por
      FROM ucqn_estudios u
      WHERE ${conditions.join(' AND ')}
      ORDER BY u.fecha_estudio DESC, u.hora_estudio DESC, u.id DESC
    `, params);
    res.json({ ok: true, registros: rows });
  } catch (e) {
    res.status(500).json({ error: safeError(e) });
  }
});

// PATCH /api/ucqn/estudios/:id/estado
router.patch('/ucqn/estudios/:id/estado', requireAuth, requireRoleOrPerm(['superadmin', 'admin', 'admin_recepcion', 'recepcion', 'admin_electro', 'electro', 'contabilidad'], ['ucqn.editar_estado', 'electro.editar']), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const estado = String(req.body?.estado || '').trim().toUpperCase();
    if (!id || !['PENDIENTE', 'LEIDO', 'FACTURADO'].includes(estado)) {
      return res.status(400).json({ error: 'Parámetros inválidos' });
    }
    const current = await db.queryOne('SELECT estado FROM ucqn_estudios WHERE id = ?', [id]);
    if (!current) return res.status(404).json({ error: 'Registro no encontrado' });
    if (current.estado === 'FACTURADO' && estado !== 'FACTURADO') {
      return res.status(409).json({ error: 'Un estudio FACTURADO no puede volver a estado anterior' });
    }
    if (current.estado === 'PENDIENTE' && estado === 'FACTURADO') {
      return res.status(409).json({ error: 'Debe pasar por LEIDO antes de FACTURADO' });
    }
    await db.execute(
      `UPDATE ucqn_estudios SET estado = ?, estado_actualizado_en = NOW(), estado_actualizado_por = ? WHERE id = ?`,
      [estado, req.session?.usuario || 'Sistema', id]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: safeError(e) });
  }
});

// GET /api/diagnosticos
router.get('/diagnosticos', requireAuth, async (req, res) => {
  try {
    const diagnosticos = await db.query(
      'SELECT id, nombre, descripcion, codigo FROM diagnosticos WHERE activo = 1 ORDER BY nombre ASC'
    );
    res.json(diagnosticos);
  } catch (e) {
    logger.error(e.message, { error: e });
    res.status(500).json({ error: safeError(e) });
  }
});

// GET /api/diagnosticos/search
router.get('/diagnosticos/search', requireAuth, async (req, res) => {
  const { q } = req.query;
  if (!q || q.trim().length < 2) {
    try {
      const diagnosticos = await db.query(
        'SELECT id, nombre, descripcion, codigo FROM diagnosticos WHERE activo = 1 ORDER BY nombre ASC LIMIT 10'
      );
      return res.json(diagnosticos);
    } catch (e) {
      return res.status(500).json({ error: safeError(e) });
    }
  }
  try {
    const searchTerm = `%${q}%`;
    const diagnosticos = await db.query(
      'SELECT id, nombre, descripcion, codigo FROM diagnosticos WHERE activo = 1 AND (nombre LIKE ? OR descripcion LIKE ? OR codigo LIKE ?) ORDER BY nombre ASC LIMIT 20',
      [searchTerm, searchTerm, searchTerm]
    );
    res.json(diagnosticos);
  } catch (e) {
    res.status(500).json({ error: safeError(e) });
  }
});

// POST /api/diagnosticos
router.post('/diagnosticos', requireAuth, requireRoleOrPerm(['superadmin', 'admin'], 'diagnosticos.crear'), async (req, res) => {
  const { nombre, descripcion, codigo } = req.body || {};
  if (!nombre || nombre.trim().length === 0) return res.status(400).json({ error: 'El nombre del diagnóstico es obligatorio' });
  try {
    const result = await db.execute(
      'INSERT INTO diagnosticos (nombre, descripcion, codigo, activo) VALUES (?, ?, ?, 1)',
      [nombre.trim(), descripcion || null, codigo || null]
    );
    res.json({ ok: true, id: result.insertId, nombre });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'El diagnóstico ya existe' });
    res.status(500).json({ error: safeError(e) });
  }
});

// PUT /api/diagnosticos/:id
router.put('/diagnosticos/:id', requireAuth, requireRoleOrPerm(['superadmin', 'admin'], 'diagnosticos.editar'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { nombre, descripcion, codigo, activo } = req.body || {};
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  try {
    await db.execute(
      'UPDATE diagnosticos SET nombre = ?, descripcion = ?, codigo = ?, activo = ? WHERE id = ?',
      [nombre || null, descripcion || null, codigo || null, activo !== undefined ? activo : 1, id]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: safeError(e) });
  }
});

// POST /api/diagnosticos/import-excel
router.post('/diagnosticos/import-excel', requireAuth, requireRoleOrPerm(['superadmin', 'admin'], 'diagnosticos.crear'), upload.single('file'), validateMagicBytes, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Debes seleccionar un archivo' });
  try {
    const ExcelJS = require('exceljs');
    const fs = require('fs');
    const filePath = req.file.path;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const worksheet = workbook.worksheets[0];
    fs.unlinkSync(filePath);

    const headers = [];
    const data = [];
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) { row.values.forEach(val => headers.push(val ? String(val) : '')); return; }
      const obj = {};
      row.values.forEach((val, colIdx) => {
        const key = headers[colIdx] || '';
        if (key) obj[key] = val !== null && val !== undefined ? val : null;
      });
      data.push(obj);
    });

    if (!data || data.length === 0) return res.status(400).json({ error: 'El archivo Excel está vacío' });

    let insertados = 0, actualizados = 0, errores = 0;
    for (const row of data) {
      try {
        let codigo = null, nombre = null;
        for (const key of Object.keys(row)) {
          const keyLower = key.toLowerCase().trim();
          if (keyLower.includes('código') || keyLower.includes('codigo')) codigo = row[key] ? String(row[key]).trim() : null;
          if (keyLower.includes('diagnóstico') || keyLower.includes('diagnostico') || keyLower.includes('nombre')) nombre = row[key] ? String(row[key]).trim() : null;
        }
        if (!nombre) { errores++; continue; }
        const result = await db.execute(
          'INSERT INTO diagnosticos (nombre, codigo, activo) VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE activo = 1',
          [nombre, codigo || null]
        );
        if (result.affectedRows > 0) insertados++; else actualizados++;
      } catch (e) {
        logger.error('Error procesando fila:', e.message);
        errores++;
      }
    }
    res.json({ ok: true, insertados, actualizados, errores, total: data.length, mensaje: `Se procesaron ${data.length} filas: ${insertados} insertados, ${actualizados} actualizados, ${errores} con error` });
  } catch (e) {
    logger.error('Error importando Excel:', e);
    res.status(500).json({ error: safeError(e, 'Error procesando archivo: ') });
  }
});

// GET /api/citas-electro/plantilla-excel
router.get('/citas-electro/plantilla-excel', requireAuth, async (req, res) => {
  try {
    const ExcelJS = require('exceljs');
    const estudiosRows = await db.query('SELECT nombre FROM estudio_duraciones ORDER BY nombre ASC');
    const estudios = estudiosRows.map(r => r.nombre);
    const entidadesRows = await db.query('SELECT nombre FROM entidades WHERE activo=1 ORDER BY nombre ASC');
    const entidades = entidadesRows.map(r => r.nombre);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Estudios');
    const wsListas = wb.addWorksheet('_Listas');
    wsListas.state = 'veryHidden';
    estudios.forEach((v, i) => { wsListas.getCell(`A${i + 1}`).value = v; });
    entidades.forEach((v, i) => { wsListas.getCell(`B${i + 1}`).value = v; });

    ws.columns = [
      { header: 'FECHA', key: 'fecha', width: 15 },
      { header: 'HORA', key: 'hora', width: 10 },
      { header: 'NUMERO DOCUMENTO', key: 'documento', width: 20 },
      { header: 'NOMBRES Y APELLIDOS', key: 'nombre', width: 30 },
      { header: 'ESTUDIO', key: 'estudio', width: 25 },
      { header: 'ENTIDAD', key: 'entidad', width: 20 },
      { header: 'DIAGNOSTICO', key: 'diagnostico', width: 25 },
      { header: 'TELEFONO1', key: 'tel1', width: 15 },
      { header: 'TELEFONO2', key: 'tel2', width: 15 },
    ];
    ws.getRow(1).font = { bold: true };
    ws.addRow(['2026-04-01', '20:00', '1234567890', 'Juan Carlos Pérez López', estudios[0] || 'PSG Básica', entidades[0] || 'Particular', 'Apnea del sueño', '3001234567', '3009876543']);

    const maxRows = 200;
    if (estudios.length > 0) {
      const ref = `_Listas!$A$1:$A$${estudios.length}`;
      for (let row = 2; row <= maxRows; row++) {
        ws.getCell(`E${row}`).dataValidation = { type: 'list', allowBlank: true, formulae: [ref], showErrorMessage: true, errorTitle: 'Estudio no válido', error: 'Seleccione un estudio de la lista' };
      }
    }
    if (entidades.length > 0) {
      const ref = `_Listas!$B$1:$B$${entidades.length}`;
      for (let row = 2; row <= maxRows; row++) {
        ws.getCell(`F${row}`).dataValidation = { type: 'list', allowBlank: true, formulae: [ref], showErrorMessage: true, errorTitle: 'Entidad no válida', error: 'Seleccione una entidad de la lista' };
      }
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=plantilla_estudios_electro.xlsx');
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    logger.error('Error generando plantilla electro:', e);
    res.status(500).json({ error: safeError(e) });
  }
});

// GET /api/citas-electro/stats — BEFORE /:id
router.get('/citas-electro/stats', requireAuth, async (req, res) => {
  const { fecha } = req.query;
  if (!fecha) return res.status(400).json({ error: 'fecha es obligatoria' });
  try {
    const [porEstado, porEstudio] = await Promise.all([
      db.query(
        `SELECT estado, COUNT(*) AS total FROM citas_electro
         WHERE deleted_at IS NULL AND fecha <= ? AND COALESCE(hora_fin_date, fecha) >= ?
         GROUP BY estado`,
        [fecha, fecha]
      ),
      db.query(
        `SELECT estudio, COUNT(*) AS total FROM citas_electro
         WHERE deleted_at IS NULL AND fecha <= ? AND COALESCE(hora_fin_date, fecha) >= ?
         GROUP BY estudio`,
        [fecha, fecha]
      )
    ]);
    const total = porEstado.reduce((a, r) => a + r.total, 0);
    const completadas = (porEstado.find(r => r.estado === 'Completado') || {}).total || 0;
    const enEstudio = (porEstado.find(r => r.estado === 'En Estudio') || {}).total || 0;
    res.json({ total, completadas, enEstudio, porEstado, porEstudio });
  } catch (e) {
    res.status(500).json({ error: safeError(e) });
  }
});

// GET /api/citas-electro/export — BEFORE /:id
router.get('/citas-electro/export', requireAuth, async (req, res) => {
  const { fecha } = req.query;
  if (!fecha) return res.status(400).json({ error: 'fecha es obligatoria' });
  try {
    const rows = await db.query(`
      SELECT c.fecha, c.hora_agendamiento, c.hora_inicio, c.hora_fin, c.estudio,
             c.estado, c.programado_por_nombre, c.editado_por_nombre,
             p.nombre AS paciente_nombre, p.documento AS paciente_documento, p.telefono,
             d.codigo AS diagnostico_codigo, d.nombre AS diagnostico_nombre,
             e.nombre AS equipo_nombre
      FROM citas_electro c
      JOIN pacientes p ON p.id = c.paciente_id
      LEFT JOIN diagnosticos d ON d.id = c.diagnostico_id
      LEFT JOIN equipos_electro e ON e.id = c.equipo_id
      WHERE c.deleted_at IS NULL AND c.fecha <= ? AND COALESCE(c.hora_fin_date, c.fecha) >= ?
      ORDER BY c.hora_agendamiento ASC
    `, [fecha, fecha]);

    const headers = ['Fecha', 'Hora Agendamiento', 'Hora Inicio', 'Hora Fin', 'Estudio', 'Estado',
      'Paciente', 'Documento', 'Teléfono', 'Diagnóstico Cód', 'Diagnóstico', 'Equipo', 'Programó', 'Editó'];
    const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [
      headers.join(','),
      ...rows.map(r => [r.fecha, r.hora_agendamiento, r.hora_inicio, r.hora_fin, r.estudio, r.estado,
        r.paciente_nombre, r.paciente_documento, r.telefono, r.diagnostico_codigo, r.diagnostico_nombre,
        r.equipo_nombre, r.programado_por_nombre, r.editado_por_nombre].map(escape).join(','))
    ];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="citas-electro-${fecha}.csv"`);
    res.send('\uFEFF' + lines.join('\r\n'));
  } catch (e) {
    res.status(500).json({ error: safeError(e) });
  }
});

// POST /api/citas-electro/corregir-completados-prematuros
router.post('/citas-electro/corregir-completados-prematuros', requireAuth, requireRoleOrPerm(
  ['superadmin', 'admin', 'admin_electro'],
  'electro.editar'
), async (req, res) => {
  try {
    const dias = req.body?.dias ?? req.query?.dias ?? 14;
    const fechaCentro = req.body?.fecha || req.query?.fecha || null;
    const afectadas = await revertirElectroCompletadosAntesDeTiempo(dias, fechaCentro);
    emitSocket('electro:actualizar-lista', { type: 'correccion-estado', afectadas });
    res.json({ ok: true, afectadas });
  } catch (e) {
    res.status(500).json({ error: safeError(e) });
  }
});

// GET /api/citas-electro
router.get('/citas-electro', requireAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  const { fecha, equipo_id, buscar } = req.query;

  if (buscar && !fecha) {
    try {
      const citas = await db.query(`
        SELECT ${CITAS_ELECTRO_SELECT},
               p.nombre AS paciente_nombre, p.documento AS paciente_documento, p.telefono AS telefono,
               d.nombre AS diagnostico_nombre, d.codigo AS diagnostico_codigo, e.nombre AS equipo_nombre
        FROM citas_electro c
        JOIN pacientes p ON p.id = c.paciente_id
        LEFT JOIN diagnosticos d ON d.id = c.diagnostico_id
        LEFT JOIN equipos_electro e ON e.id = c.equipo_id
        WHERE (p.documento LIKE ? OR p.nombre LIKE ?) AND c.deleted_at IS NULL
        ORDER BY c.fecha ASC, c.hora_agendamiento ASC LIMIT 50
      `, [`%${buscar}%`, `%${buscar}%`]);
      return res.json(citas);
    } catch (e) {
      return res.status(500).json({ error: safeError(e) });
    }
  }

  if (!fecha) return res.status(400).json({ error: 'fecha es obligatoria' });

  try {
    await repararEstadosElectroAlConsultar(fecha);
    let query = `
      SELECT ${CITAS_ELECTRO_SELECT},
             p.nombre AS paciente_nombre, p.documento AS paciente_documento, p.telefono AS telefono,
             d.nombre AS diagnostico_nombre, d.codigo AS diagnostico_codigo, e.nombre AS equipo_nombre
      FROM citas_electro c
      JOIN pacientes p ON p.id = c.paciente_id
      LEFT JOIN diagnosticos d ON d.id = c.diagnostico_id
      LEFT JOIN equipos_electro e ON e.id = c.equipo_id
      WHERE c.deleted_at IS NULL AND ${sqlCitaElectroVisibleEnFecha('c')}
    `;
    let params = [...paramsCitaElectroVisibleEnFecha(fecha)];
    if (equipo_id) { query += ` AND c.equipo_id = ?`; params.push(equipo_id); }
    const { estado, entidad, estudio } = req.query;
    if (estado) {
      const arr = estado.split(',').filter(Boolean);
      if (arr.length === 1) { query += ' AND c.estado = ?'; params.push(arr[0]); }
      else if (arr.length > 1) { query += ` AND c.estado IN (${arr.map(() => '?').join(',')})`; params.push(...arr); }
    }
    if (entidad) {
      query += ' AND UPPER(TRIM(c.entidad)) = UPPER(TRIM(?))';
      params.push(entidad);
    }
    if (estudio) {
      query += ' AND c.estudio = ?';
      params.push(estudio);
    }
    query += ` ORDER BY c.hora_agendamiento ASC, c.hora_inicio ASC, c.id ASC`;
    const citas = await db.query(query, params);
    res.json(citas);
  } catch (e) {
    res.status(500).json({ error: safeError(e) });
  }
});

// POST /api/citas-electro
router.post('/citas-electro', requireAuth, requireRoleOrPerm(['superadmin', 'admin', 'admin_recepcion', 'recepcion', 'admin_electro', 'electro', 'auxiliar_recepcion'], 'electro.crear'), async (req, res) => {
  const { equipo_id, paciente_id, fecha: rawFecha, hora_agendamiento, hora, hora_fin, duracion, estudio, observaciones, diagnostico_id, estado, programado_por_nombre, telefono, entidad } = req.body || {};
  const rawHora = String(hora_agendamiento || hora || '').trim();
  const horaAgendamiento = normalizeHora(rawHora);
  const fecha = normalizeFecha(rawFecha);

  if (!paciente_id || !fecha || !horaAgendamiento) {
    return res.status(400).json({ error: 'paciente_id, fecha y hora_agendamiento son obligatorios' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return res.status(400).json({ error: 'Fecha en formato inválido (YYYY-MM-DD)' });
  if (!/^\d{2}:\d{2}$/.test(horaAgendamiento)) return res.status(400).json({ error: 'Hora en formato inválido (HH:MM)' });

  try {
    let finalHoraFin = hora_fin;
    let finalFechaFin = fecha;
    if (!hora_fin) {
      const duracionMinutos = duracion ? parseInt(duracion, 10) : 30;
      const finCalc = sumarMinutosAHoraYFecha(fecha, horaAgendamiento, duracionMinutos);
      if (finCalc) {
        finalHoraFin = finCalc.horaFin;
        finalFechaFin = finCalc.fechaFin;
      }
    } else {
      finalFechaFin = extraerFechaYmd(req.body.hora_fin_date) || fechaFinSiCruzaMedianoche(fecha, horaAgendamiento, hora_fin) || fecha;
    }

    await autoCompletarEstudiosElectroVencidos();

    // Verificaciones de capacidad SIN FOR UPDATE para evitar deadlocks
    const dupCheck = await db.query(
      `SELECT COUNT(*) as cnt FROM citas_electro
       WHERE paciente_id = ? AND estado IN ('Programado', 'Confirmado', 'En Sala', 'En Estudio', 'Pausado') AND deleted_at IS NULL
       AND TIMESTAMP(fecha, COALESCE(hora_agendamiento, '00:00:00')) < TIMESTAMP(?, ?)
       AND TIMESTAMP(COALESCE(hora_fin_date, fecha), COALESCE(hora_fin, '23:59:59')) > TIMESTAMP(?, ?)`,
      [paciente_id, finalFechaFin, finalHoraFin, fecha, horaAgendamiento]
    );
    if ((dupCheck[0]?.cnt || 0) > 0) {
      return res.status(409).json({ error: 'Este paciente ya tiene una cita que se superpone con este horario en Electrodiagnóstico.' });
    }

    const overlapRows = await db.query(
      `SELECT fecha, hora_agendamiento, hora_inicio, hora_fin, hora_fin_date, duracion_minutos, estado FROM citas_electro
       WHERE estado IN ('En Estudio', 'Pausado')
       AND deleted_at IS NULL
       AND TIMESTAMP(fecha, COALESCE(hora_inicio, hora_agendamiento, '00:00:00')) < TIMESTAMP(?, ?)
       AND TIMESTAMP(COALESCE(hora_fin_date, fecha), COALESCE(hora_fin, '23:59:59')) > TIMESTAMP(?, ?)`,
      [finalFechaFin, finalHoraFin, fecha, horaAgendamiento]
    );

    const maxCuposRows = await db.query(`SELECT COUNT(*) as total FROM equipos_electro WHERE activo = 1`);
    const maxCupos = parseInt(maxCuposRows[0]?.total, 10) || 0;
    const [hhS, mmS] = horaAgendamiento.split(':').map((x) => parseInt(x, 10));
    const rangeStart = new Date(`${fecha}T${String(hhS).padStart(2, '0')}:${String(mmS).padStart(2, '0')}:00`);
    const [hhE, mmE] = finalHoraFin.split(':').map((x) => parseInt(x, 10));
    const rangeEnd = new Date(`${finalFechaFin}T${String(hhE).padStart(2, '0')}:${String(mmE).padStart(2, '0')}:00`);
    const cupoCheck = hayCupoElectroParaAgendar(overlapRows, rangeStart, rangeEnd, maxCupos);

    if (!cupoCheck.ok) {
      return res.status(409).json({
        error: `Sin capacidad disponible en este horario. Pico simultáneo: ${cupoCheck.peak}/${maxCupos} equipos.`,
        details: `peak: ${cupoCheck.peak}, max: ${maxCupos}`,
        capacity: { max: maxCupos, peak: cupoCheck.peak }
      });
    }
    const overlapCount = cupoCheck.peak;

    if (equipo_id) {
      const ocupado = await db.query(
        `SELECT id, estudio FROM citas_electro
         WHERE equipo_id = ? AND estado = 'En Estudio' AND deleted_at IS NULL LIMIT 1`,
        [parseInt(equipo_id, 10)]
      );
      if (ocupado.length > 0) {
        const eqRows = await db.query('SELECT nombre FROM equipos_electro WHERE id = ?', [parseInt(equipo_id, 10)]);
        const eqNombre = eqRows[0]?.nombre || `Equipo ${equipo_id}`;
        return res.status(409).json({ error: `${eqNombre} está ocupado con "${ocupado[0].estudio}". Espere a que finalice.` });
      }
    }

    let duracionMinutosDB = duracion ? parseInt(duracion, 10) : null;
    if (!(duracionMinutosDB > 0) && finalHoraFin) {
      duracionMinutosDB = inferirDuracionMinutosCitaElectro({
        fecha,
        hora_agendamiento: horaAgendamiento,
        hora_fin: finalHoraFin,
        hora_fin_date: finalFechaFin
      });
    }
    const insertResult = await db.execute(`
      INSERT INTO citas_electro (equipo_id, paciente_id, fecha, hora_agendamiento, hora_inicio, hora_fin, hora_fin_date, estudio, observaciones, diagnostico_id, estado, programado_por_nombre, duracion_minutos, entidad)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      equipo_id || null, paciente_id, fecha, horaAgendamiento, null,
      finalHoraFin, finalFechaFin, estudio || null, observaciones || null,
      diagnostico_id || null, estado || 'Programado', programado_por_nombre || 'Sistema',
      duracionMinutosDB, entidad ? String(entidad).trim() : null
    ]);

    const insertId = insertResult[0]?.insertId ?? insertResult.insertId;
    emitSocket('electro:cita-creada', { id: insertId, paciente_id, fecha, hora_agendamiento: horaAgendamiento, hora_fin: finalHoraFin, estudio, estado: estado || 'Programado', telefono: telefono || null });
    emitSocket('electro:actualizar-lista', { type: 'creada', id: insertId });
    res.json({ ok: true, id: insertId, capacity_info: { active_studies: overlapCount, max: maxCupos, available: Math.max(0, maxCupos - overlapCount - 1) } });
  } catch (e) {
    if (e.message.includes('Sin capacidad')) {
      return res.status(409).json({ error: e.message, details: e.message, capacity: { max: null } });
    }
    if (e.message.includes('superpone')) {
      return res.status(409).json({ error: e.message });
    }
    logger.error('Error creando cita electro', { error: e.message, paciente_id });
    res.status(500).json({ error: safeError(e) });
  }
});

// GET /api/citas-electro/:id
router.get('/citas-electro/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  try {
    const rows = await db.query(`
      SELECT ${CITAS_ELECTRO_SELECT},
             p.nombre AS paciente_nombre, p.documento AS paciente_documento,
             p.telefono AS telefono, d.nombre AS diagnostico_nombre,
             d.codigo AS diagnostico_codigo, e.nombre AS equipo_nombre
      FROM citas_electro c
      JOIN pacientes p ON p.id = c.paciente_id
      LEFT JOIN diagnosticos d ON d.id = c.diagnostico_id
      LEFT JOIN equipos_electro e ON e.id = c.equipo_id
      WHERE c.id = ? AND c.deleted_at IS NULL
    `, [id]);
    if (!rows.length) return res.status(404).json({ error: 'Cita no encontrada' });
    const row = rows[0];
    const fechaRow = extraerFechaYmd(row.fecha) || normalizeFecha(row.fecha);
    if (fechaRow) await repararEstadosElectroAlConsultar(fechaRow);
    const rows2 = await db.query(`
      SELECT ${CITAS_ELECTRO_SELECT},
             p.nombre AS paciente_nombre, p.documento AS paciente_documento,
             p.telefono AS telefono, d.nombre AS diagnostico_nombre,
             d.codigo AS diagnostico_codigo, e.nombre AS equipo_nombre
      FROM citas_electro c
      JOIN pacientes p ON p.id = c.paciente_id
      LEFT JOIN diagnosticos d ON d.id = c.diagnostico_id
      LEFT JOIN equipos_electro e ON e.id = c.equipo_id
      WHERE c.id = ? AND c.deleted_at IS NULL
    `, [id]);
    const rowFresh = rows2[0] || row;
    rowFresh.fecha = extraerFechaYmd(rowFresh.fecha) || fechaRow;
    if (rowFresh.hora_fin_date) rowFresh.hora_fin_date = extraerFechaYmd(rowFresh.hora_fin_date) || normalizeFecha(rowFresh.hora_fin_date);
    res.json(rowFresh);
  } catch (e) {
    res.status(500).json({ error: safeError(e) });
  }
});

const ESTADOS_VALIDOS_ELECTRO = ['Programado','Confirmado','En Sala','En Estudio','Pausado','Completado','No Asistió','Cancelado','Reprogramado','Adelantado'];

// PATCH /api/citas-electro/:id/estado
router.patch('/citas-electro/:id/estado', requireAuth, requireRoleOrPerm(['superadmin', 'admin', 'admin_recepcion', 'recepcion', 'admin_electro', 'electro', 'tecnico_electro'], 'electro.cambiar_estado'), validateSchema('apiPatchEstadoElectro'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { estado } = req.body;
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  try {
    const citas = await db.query('SELECT id FROM citas_electro WHERE id = ? AND deleted_at IS NULL', [id]);
    const cita = citas.length > 0 ? citas[0] : null;
    if (!cita) return res.status(404).json({ error: 'Cita no encontrada' });

    const userName = req.session.usuario || 'Usuario';
    const users = await db.query('SELECT nombre FROM usuarios WHERE id = ?', [req.session.usuarioId]);
    const editadoPor = (users.length > 0 && users[0].nombre) ? users[0].nombre : userName;

    await db.execute('UPDATE citas_electro SET estado = ?, editado_por_nombre = ?, editado_en = NOW() WHERE id = ?', [estado, editadoPor, id]);

    emitSocket('electro:cita-actualizada', { id, estado, editado_por: editadoPor });
    emitSocket('electro:actualizar-lista', { type: 'estado', id, cambios: { estado } });
    res.json({ ok: true });
  } catch (e) {
    logger.error(e.message, { error: e });
    res.status(500).json({ error: safeError(e) });
  }
});

// PATCH /api/citas-electro/:id
router.patch('/citas-electro/:id', requireAuth, requireRoleOrPerm(['superadmin', 'admin', 'admin_recepcion', 'recepcion', 'admin_electro', 'electro', 'tecnico_electro'], ['electro.editar', 'electro.cambiar_estado']), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { equipo_id, estado, hora_inicio, hora_fin, hora_agendamiento, fecha: rawFechaPatch, duracion_minutos, entidad, estudio, inicio_desde } = req.body || {};
  const fecha = rawFechaPatch !== undefined ? normalizeFecha(rawFechaPatch) : undefined;
  if (!id) return res.status(400).json({ error: 'id es obligatorio' });
  if (estado !== undefined && !ESTADOS_VALIDOS_ELECTRO.includes(estado)) {
    return res.status(400).json({ error: `Estado inválido: "${estado}". Valores permitidos: ${ESTADOS_VALIDOS_ELECTRO.join(', ')}` });
  }

  try {
    const citasResult = await db.query(
      'SELECT id, equipo_id, paciente_id, fecha, hora_agendamiento, hora_inicio, hora_fin, hora_fin_date, estudio, estado, duracion_minutos, entidad, observaciones, diagnostico_id FROM citas_electro WHERE id = ? AND deleted_at IS NULL',
      [id]
    );
    if (citasResult.length === 0) return res.status(404).json({ error: 'Cita no encontrada' });
    const citaActual = await asegurarDuracionMinutosCitaElectro(citasResult[0]);
    const estadoActual = citaActual.estado;
    const estudioActivo = estadoActual === 'En Estudio' || estadoActual === 'Pausado';
    let forzarCamposInicioEstudio = null;

    if (equipo_id !== undefined && estudioActivo) {
      const equipoActualNorm = citaActual.equipo_id === null ? null : parseInt(citaActual.equipo_id, 10);
      const equipoNuevoNorm = equipo_id === null || equipo_id === '' ? null : parseInt(equipo_id, 10);
      const rolSesion = (req.session?.rol && String(req.session.rol).toLowerCase()) || '';
      if (equipoNuevoNorm !== equipoActualNorm && rolSesion !== 'superadmin') {
        return res.status(409).json({ error: 'No se puede cambiar el equipo mientras el estudio está activo. Solo el superadmin puede hacerlo.' });
      }
    }

    // Validar que el equipo no esté ocupado por otro estudio "En Estudio"
    if (equipo_id !== undefined && equipo_id !== null && equipo_id !== '') {
      const eqId = parseInt(equipo_id, 10);
      const ocupado = await db.query(
        `SELECT id, estudio FROM citas_electro
         WHERE equipo_id = ? AND id != ? AND estado = 'En Estudio' AND deleted_at IS NULL
         LIMIT 1`,
        [eqId, id]
      );
      if (ocupado.length > 0) {
        const eqRows = await db.query('SELECT nombre FROM equipos_electro WHERE id = ?', [eqId]);
        const eqNombre = eqRows[0]?.nombre || `Equipo ${eqId}`;
        return res.status(409).json({
          error: `${eqNombre} está ocupado con el estudio "${ocupado[0].estudio || 'Sin tipo'}". Espere a que finalice.`
        });
      }
    }

    if (estado && estado !== estadoActual) {
      const estadosManuales = ['Confirmado', 'En Sala', 'No Asistió', 'Reprogramado', 'Cancelado', 'Adelantado', 'Pausado'];
      const esManual = estadosManuales.includes(estado);
      const esReanudarEstudio = estadoActual === 'Pausado' && estado === 'En Estudio';
      const esInicioEstudioNuevo = ['Programado', 'Confirmado', 'En Sala', 'Reprogramado', 'Adelantado'].includes(estadoActual) && estado === 'En Estudio';
      const esInicioEstudio = esInicioEstudioNuevo || esReanudarEstudio;
      const esFinEstudio = (estadoActual === 'En Estudio' || estadoActual === 'Pausado') && estado === 'Completado';

      if (!esManual && !esInicioEstudio && !esFinEstudio) {
        return res.status(400).json({ error: `Transición de estado inválida: ${estadoActual} → ${estado}` });
      }

      if (esInicioEstudio) {
        const checkHora = hora_inicio || hora_agendamiento || horaInicioCitaElectro(citaActual);
        const checkFecha = fecha || extraerFechaYmd(citaActual.fecha) || normalizeFecha(citaActual.fecha);
        const durCheck = parseInt(duracion_minutos ?? citaActual.duracion_minutos, 10);
        let checkHoraFin = hora_fin || citaActual.hora_fin || checkHora;
        let checkFechaFin = req.body.hora_fin_date || citaActual.hora_fin_date || checkFecha;
        if (checkFecha && checkHora && durCheck > 0) {
          const finCalc = sumarMinutosAHoraYFecha(checkFecha, checkHora, durCheck);
          if (finCalc) {
            checkHoraFin = finCalc.horaFin;
            checkFechaFin = finCalc.fechaFin;
          }
        }
        await asegurarDuracionMinutosCitaElectro(citaActual);
        await autoCompletarEstudiosElectroVencidos(id);
        const eqIdInicio = (equipo_id !== undefined && equipo_id !== null && equipo_id !== '')
          ? parseInt(equipo_id, 10)
          : (citaActual.equipo_id ? parseInt(citaActual.equipo_id, 10) : null);
        const tieneEquipoAsignado = eqIdInicio && !Number.isNaN(eqIdInicio);
        // Con equipo asignado basta la validación de equipo libre (arriba).
        // Sin equipo: cupo = estudios activos ahora, no citas solo programadas con ventana larga.
        if (!tieneEquipoAsignado) {
          const activasRows = await db.query(`
            SELECT fecha, hora_agendamiento, hora_inicio, hora_fin, hora_fin_date, duracion_minutos, estado
            FROM citas_electro
            WHERE id != ? AND estado IN ('En Estudio', 'Pausado') AND deleted_at IS NULL
          `, [id]);
          const maxCuposRows = await db.query(`SELECT COUNT(*) as total FROM equipos_electro WHERE activo = 1`);
          const maxCupos = parseInt(maxCuposRows[0]?.total, 10) || 0;
          const cupoCheck = hayCupoElectroParaIniciar(activasRows, new Date(), maxCupos);
          if (!cupoCheck.ok) {
            return res.status(409).json({
              error: 'Sin capacidad disponible: todos los equipos están en uso',
              details: `Estudios activos: ${cupoCheck.peak}/${maxCupos}`,
              capacity: { active: cupoCheck.peak, max: maxCupos }
            });
          }
        }
        if (esInicioEstudioNuevo) {
          const fechaIni = fecha || extraerFechaYmd(citaActual.fecha) || normalizeFecha(citaActual.fecha);
          const modoInicio = String(inicio_desde || '').trim().toLowerCase();
          let horaIniStr;
          if (modoInicio === 'agendado') {
            horaIniStr = horaInicioAgendadaParaInicioEstudio(citaActual) || '';
          } else if (modoInicio === 'solicitud') {
            if (hora_inicio != null && String(hora_inicio).trim() !== '') {
              horaIniStr = String(hora_inicio).trim().slice(0, 5);
            } else {
              horaIniStr = horaInicioEfectivaParaInicioEstudio(citaActual) || '';
            }
          } else if (hora_inicio != null && String(hora_inicio).trim() !== '') {
            horaIniStr = String(hora_inicio).trim().slice(0, 5);
          } else {
            horaIniStr = horaInicioAgendadaParaInicioEstudio(citaActual)
              || horaInicioEfectivaParaInicioEstudio(citaActual)
              || '';
          }
          if (!/^\d{2}:\d{2}$/.test(horaIniStr)) {
            return res.status(400).json({ error: 'No se pudo determinar la hora de inicio del estudio' });
          }
          let durIni = parseInt(duracion_minutos ?? citaActual.duracion_minutos, 10);
          if (!(durIni > 0)) {
            await asegurarDuracionMinutosCitaElectro(citaActual);
            durIni = parseInt(citaActual.duracion_minutos, 10) || inferirDuracionMinutosCitaElectro(citaActual) || 0;
          }
          if (fechaIni && /^\d{2}:\d{2}$/.test(horaIniStr) && durIni > 0) {
            const finIni = calcularFinInicioEstudioElectro(fechaIni, horaIniStr, durIni, modoInicio);
            if (finIni) {
              forzarCamposInicioEstudio = finIni;
            }
          }
        }
      }
    }

    const updates = [];
    const values = [];
    const cambios = {};
    if (equipo_id !== undefined) { updates.push('equipo_id = ?'); values.push(equipo_id); cambios.equipo_id = equipo_id; }
    if (estado !== undefined) { updates.push('estado = ?'); values.push(estado); cambios.estado = estado; }

    const horaInicioPatch = forzarCamposInicioEstudio?.hora_inicio ?? hora_inicio;
    const horaFinPatch = forzarCamposInicioEstudio?.hora_fin ?? hora_fin;
    const horaFinDatePatch = forzarCamposInicioEstudio?.hora_fin_date ?? req.body.hora_fin_date;
    const duracionPatch = forzarCamposInicioEstudio?.duracion_minutos ?? duracion_minutos;

    if (horaInicioPatch !== undefined) {
      updates.push('hora_inicio = ?'); values.push(horaInicioPatch); cambios.hora_inicio = horaInicioPatch;
    }
    if (horaFinPatch !== undefined) {
      updates.push('hora_fin = ?'); values.push(horaFinPatch); cambios.hora_fin = horaFinPatch;
    }

    if (horaFinDatePatch !== undefined) {
      updates.push('hora_fin_date = ?'); values.push(horaFinDatePatch); cambios.hora_fin_date = horaFinDatePatch;
    } else if (horaFinPatch !== undefined) {
      const horaInicio = horaInicioPatch || citaActual.hora_inicio || citaActual.hora_agendamiento;
      const fechaEstudio = fecha || extraerFechaYmd(citaActual.fecha) || normalizeFecha(citaActual.fecha);
      const durMin = duracionPatch || citaActual.duracion_minutos;
      const horaStr = typeof horaInicio === 'string' ? horaInicio.slice(0, 5) : String(horaInicio).slice(0, 5);
      if (durMin && horaStr && fechaEstudio) {
        const finCalc = sumarMinutosAHoraYFecha(fechaEstudio, horaStr, durMin);
        if (finCalc) {
          updates.push('hora_fin_date = ?');
          values.push(finCalc.fechaFin);
        }
      } else if (horaFinPatch && fechaEstudio) {
        const finDate = fechaFinSiCruzaMedianoche(fechaEstudio, horaStr, horaFinPatch);
        if (finDate && finDate !== fechaEstudio) {
          updates.push('hora_fin_date = ?');
          values.push(finDate);
        } else {
          updates.push('hora_fin_date = ?');
          values.push(fechaEstudio);
        }
      }
    }

    if (hora_agendamiento !== undefined) { updates.push('hora_agendamiento = ?'); values.push(hora_agendamiento); cambios.hora_agendamiento = hora_agendamiento; }
    if (fecha !== undefined) { updates.push('fecha = ?'); values.push(fecha); cambios.fecha = fecha; }
    if (duracionPatch !== undefined) { updates.push('duracion_minutos = ?'); values.push(duracionPatch); cambios.duracion_minutos = duracionPatch; }
    if (entidad !== undefined) { updates.push('entidad = ?'); values.push(entidad ? String(entidad).trim() : null); }
    if (estudio !== undefined) {
      const nombreEstudio = String(estudio).trim();
      if (!nombreEstudio) return res.status(400).json({ error: 'El tipo de estudio no puede estar vacío' });
      updates.push('estudio = ?');
      values.push(nombreEstudio);
      cambios.estudio = nombreEstudio;
    }

    if (updates.length === 0) return res.json({ ok: true });

    updates.push('editado_en = NOW()');
    const editorNombre = req.session.usuarioNombre || req.session.usuario || 'Sistema';
    updates.push('editado_por_nombre = ?'); values.push(editorNombre);
    values.push(id);

    await db.execute(`UPDATE citas_electro SET ${updates.join(', ')} WHERE id = ?`, values);

    // Nota: la migración del ENUM `estado` debe aplicarse desde migrations/db-migrations.js
    // (idx: estado_enum_electro). NO se ejecuta ALTER TABLE en caliente desde una petición.

    emitSocket('electro:cita-actualizada', { id, ...cambios, editado_por: editorNombre });
    emitSocket('electro:actualizar-lista', { type: 'actualizada', id, cambios });
    if (estado !== undefined) {
      const ver2 = await db.query('SELECT estado FROM citas_electro WHERE id = ?', [id]);
      const estadoGuardado2 = ver2.length ? ver2[0].estado : null;
      if (estadoGuardado2 !== estado) {
        return res.status(409).json({ ok: false, error: `No se pudo persistir el estado solicitado (${estado}). Estado actual en BD: ${estadoGuardado2 || 'N/D'}`, estado_actual: estadoGuardado2 || null });
      }
    }

    res.json({ ok: true, transicion: `${estadoActual} → ${estado || estadoActual}` });
  } catch (e) {
    res.status(500).json({ error: safeError(e) });
  }
});

// DELETE /api/citas-electro/:id (soft delete)
router.delete('/citas-electro/:id', requireAuth, requireRoleOrPerm(['superadmin', 'admin', 'admin_electro', 'electro'], 'electro.eliminar'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  try {
    const citas = await db.query('SELECT id, estado FROM citas_electro WHERE id = ? AND deleted_at IS NULL', [id]);
    const cita = citas.length > 0 ? citas[0] : null;
    if (!cita) return res.status(404).json({ error: 'Cita no encontrada' });
    if (req.session?.rol === 'admin_electro' && cita.estado === 'Completado') {
      return res.status(400).json({ error: 'No se puede eliminar un estudio ya completado' });
    }
    const eliminadoPor = req.session.usuarioNombre || req.session.usuario || 'Admin';
    await db.execute("UPDATE citas_electro SET deleted_at = NOW(), editado_por_nombre = ? WHERE id = ?", [eliminadoPor, id]);
    emitSocket('electro:cita-eliminada', { id, cita_info: cita });
    emitSocket('electro:actualizar-lista', { type: 'eliminada', id });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: safeError(e) });
  }
});

module.exports = router;
