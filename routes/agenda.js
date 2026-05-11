// routes/agenda.js
// Rutas de agenda médica: consultorios, médicos, doctor-agenda, doctor-disponibilidad
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const db = require('../utils/db-mysql');
const logger = require('../utils/logger');
const procesarAgendaExcel = require('../utils/procesar-agenda-excel');
const { upload, validateMagicBytes } = require('../middleware/upload');
const {
  requireAuth, requireRoleOrPerm,
  isAdminRol, isRecepcionRol,
  safeError, emitSocket
} = require('../middleware/index');

// --- Consultorios ---
router.get('/consultorios', requireAuth, async (req, res) => {
  try {
    const consultorios = await db.query('SELECT * FROM consultorios WHERE activo = 1 ORDER BY nombre ASC');
    res.json(consultorios);
  } catch (e) {
    logger.error(e.message, { error: e });
    res.status(500).json({ error: safeError(e) });
  }
});

// --- Médicos ---
router.get('/medicos', requireAuth, async (req, res) => {
  try {
    const medicos = await db.query(`
      SELECT u.id, u.nombre, u.usuario, u.especialidad, u.numero_consultorio,
             e.id AS especialidad_id
      FROM usuarios u
      LEFT JOIN especialidades e ON LOWER(TRIM(e.nombre)) = LOWER(TRIM(u.especialidad))
      WHERE u.rol = 'doctor' AND u.activo = 1
      ORDER BY u.nombre ASC
    `);
    res.json(medicos);
  } catch (e) {
    logger.error(e.message, { error: e });
    res.status(500).json({ error: safeError(e) });
  }
});

// --- Doctor Agenda ---

router.get('/doctor-agenda', requireAuth, async (req, res) => {
  const doctorId = parseInt(req.query.doctor_id, 10);
  if (!doctorId) return res.status(400).json({ error: 'doctor_id es obligatorio' });
  try {
    const rows = await db.query('SELECT id, doctor_id, fecha, hora_inicio, hora_fin, disponible FROM doctor_agenda WHERE doctor_id = ? ORDER BY fecha ASC, hora_inicio ASC', [doctorId]);
    res.json(rows);
  } catch (e) {
    logger.error(e.message, { error: e });
    res.status(500).json({ error: safeError(e) });
  }
});

router.post('/doctor-agenda', requireAuth, async (req, res) => {
  const { doctor_id, slots } = req.body || {};
  if (!Array.isArray(slots)) return res.status(400).json({ error: 'slots debe ser un arreglo' });
  const actorId = req.session.usuarioId;
  const isAdminUser = isAdminRol(req.session.rol) || isRecepcionRol(req.session.rol);
  const isDoctorUser = req.session.rol === 'doctor';
  const targetDoctorId = parseInt(doctor_id || actorId, 10);
  if (!targetDoctorId) return res.status(400).json({ error: 'doctor_id inválido' });
  if (!isAdminUser && !isDoctorUser) return res.status(403).json({ error: 'Solo médicos o administradores pueden subir agenda' });
  if (isDoctorUser && targetDoctorId !== actorId) return res.status(403).json({ error: 'Médicos solo pueden modificar su propia agenda' });

  try {
    await db.transaction(async (conn) => {
      await conn.execute('DELETE FROM doctor_agenda WHERE doctor_id = ?', [targetDoctorId]);
      for (const s of slots) {
        const fecha = s.fecha;
        const hi = s.hora_inicio;
        const hf = s.hora_fin || null;
        const disp = s.disponible ? 1 : 0;
        await conn.execute(
          'INSERT INTO doctor_agenda (doctor_id, fecha, hora_inicio, hora_fin, disponible) VALUES (?, ?, ?, ?, ?)',
          [targetDoctorId, fecha, hi, hf, disp]
        );
      }
    });
    res.json({ ok: true });
  } catch (e) {
    logger.error(e.message, { error: e });
    res.status(500).json({ error: safeError(e) });
  }
});

router.post('/doctor-agenda/upload', requireAuth, upload.single('file'), validateMagicBytes, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se recibió archivo' });
    }
    const doctorId = parseInt(req.body.doctor_id || req.session.usuarioId, 10);
    if (!doctorId) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: 'doctor_id inválido' });
    }
    const isAdminUser = isAdminRol(req.session.rol) || isRecepcionRol(req.session.rol);
    const isDoctorUser = req.session.rol === 'doctor' && doctorId === parseInt(req.session.usuarioId, 10);
    if (!isAdminUser && !isDoctorUser) {
      fs.unlink(req.file.path, () => {});
      return res.status(403).json({ error: 'No tienes permiso para subir archivos a la agenda de otro doctor' });
    }
    const url = `/uploads/${req.file.filename}`;
    const result = await db.execute(
      'INSERT INTO doctor_agenda_files (doctor_id, filename, url, uploaded_by) VALUES (?, ?, ?, ?)',
      [doctorId, req.file.originalname, url, req.session.usuarioId || null]
    );
    res.json({ ok: true, id: result.insertId, url });
  } catch (e) {
    if (req.file) fs.unlink(req.file.path, () => {});
    logger.error(e.message, { error: e });
    res.status(500).json({ error: safeError(e) });
  }
});

router.post('/doctor-agenda/guardar-dia', requireAuth, async (req, res) => {
  try {
    const { doctor_id, fecha, slots } = req.body || {};
    const doctorId = parseInt(doctor_id || req.session.usuarioId, 10);
    if (!doctorId || !fecha) return res.status(400).json({ error: 'doctor_id y fecha son requeridos' });

    const isAdminUser = isAdminRol(req.session.rol) || isRecepcionRol(req.session.rol);
    const isDoctorUser = req.session.rol === 'doctor' && doctorId === parseInt(req.session.usuarioId, 10);
    if (!isAdminUser && !isDoctorUser) return res.status(403).json({ error: 'Sin permiso' });

    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return res.status(400).json({ error: 'Formato de fecha inválido' });

    await db.transaction(async (conn) => {
      await conn.execute('DELETE FROM doctor_agenda WHERE doctor_id = ? AND fecha = ?', [doctorId, fecha]);
      if (Array.isArray(slots)) {
        for (const s of slots) {
          if (!s.hora_inicio || !s.hora_fin) continue;
          if (!/^\d{2}:\d{2}$/.test(s.hora_inicio) || !/^\d{2}:\d{2}$/.test(s.hora_fin)) continue;
          await conn.execute(
            'INSERT INTO doctor_agenda (doctor_id, fecha, hora_inicio, hora_fin, disponible) VALUES (?, ?, ?, ?, ?)',
            [doctorId, fecha, s.hora_inicio, s.hora_fin, s.disponible ? 1 : 0]
          );
        }
      }
    });

    emitSocket('agenda:disponibilidad-actualizada', { doctor_id: doctorId });
    res.json({ ok: true });
  } catch (e) {
    logger.error('[AGENDA] Error guardando slots del día:', e.message);
    res.status(500).json({ error: safeError(e) });
  }
});

router.get('/doctor-agenda-files', requireAuth, async (req, res) => {
  const doctorId = parseInt(req.query.doctor_id, 10);
  if (!doctorId) return res.status(400).json({ error: 'doctor_id es obligatorio' });
  try {
    const rows = await db.query('SELECT id, doctor_id, filename, url, uploaded_by, creado_en FROM doctor_agenda_files WHERE doctor_id = ? ORDER BY creado_en DESC', [doctorId]);
    res.json(rows);
  } catch (e) { logger.error(e.message, { error: e }); res.status(500).json({ error: safeError(e) }); }
});

router.delete('/doctor-agenda-files/:id', requireAuth, async (req, res) => {
  const fileId = parseInt(req.params.id, 10);
  if (!fileId) return res.status(400).json({ error: 'id es obligatorio' });
  try {
    const files = await db.query('SELECT id, doctor_id, url FROM doctor_agenda_files WHERE id = ?', [fileId]);
    const file = files.length > 0 ? files[0] : null;
    if (!file) return res.status(404).json({ error: 'Archivo no encontrado' });

    const isDoctorOwner = req.session.rol === 'doctor' && req.session.usuarioId === file.doctor_id;
    const isAdmin = isAdminRol(req.session.rol);
    if (!isDoctorOwner && !isAdmin) return res.status(403).json({ error: 'No tienes permiso para eliminar este archivo' });

    const publicDir = path.resolve(__dirname, '..', 'public');
    const filePath = path.resolve(publicDir, file.url.replace(/^\//, ''));
    if (!filePath.startsWith(publicDir)) {
      return res.status(400).json({ error: 'Ruta de archivo inválida' });
    }
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    await db.execute('DELETE FROM doctor_agenda_files WHERE id = ?', [fileId]);
    res.json({ ok: true });
  } catch (e) {
    logger.error(e.message, { error: e });
    res.status(500).json({ error: safeError(e) });
  }
});

// --- Doctor Disponibilidad ---

router.post('/init-doctor-disponibilidad', requireAuth, requireRoleOrPerm(['superadmin', 'admin'], 'modulo.gestion_datos'), async (req, res) => {
  try {
    const sql = `
      CREATE TABLE IF NOT EXISTS doctor_disponibilidad_mensual (
        id INT AUTO_INCREMENT PRIMARY KEY,
        doctor_id INT NOT NULL,
        fecha DATE NOT NULL,
        pacientes_proinsalud INT DEFAULT 0,
        pacientes_otros INT DEFAULT 0,
        total_pacientes INT DEFAULT 0,
        disponible BOOLEAN DEFAULT TRUE,
        disponible_manana BOOLEAN DEFAULT TRUE,
        disponible_tarde BOOLEAN DEFAULT TRUE,
        creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_doctor_fecha (doctor_id, fecha),
        FOREIGN KEY (doctor_id) REFERENCES usuarios(id) ON DELETE CASCADE,
        INDEX idx_doctor_fecha (doctor_id, fecha),
        INDEX idx_disponible (disponible)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
    `;
    await db.execute(sql);
    res.json({ ok: true, message: 'Tabla doctor_disponibilidad_mensual creada/verificada' });
  } catch (e) {
    logger.error('[DISPONIBILIDAD] Error creando tabla:', e.message);
    res.status(500).json({ error: safeError(e) });
  }
});

async function handleProcesarExcelDisponibilidad(req, res) {
  if (!req.file) {
    return res.status(400).json({ error: 'No se recibió archivo' });
  }
  try {
    const doctorId = parseInt(req.body.doctor_id || req.session.usuarioId, 10);
    logger.info(`[DISPONIBILIDAD] Procesando Excel para doctor=${doctorId}, archivo=${req.file.originalname}`);

    if (!doctorId) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: 'doctor_id inválido' });
    }

    const isAdmin = isAdminRol(req.session.rol);
    const isDoctor = req.session.rol === 'doctor' && doctorId === req.session.usuarioId;
    if (!isAdmin && !isDoctor) {
      fs.unlink(req.file.path, () => {});
      logger.warn(`[DISPONIBILIDAD] Acceso denegado: rol=${req.session.rol}, usuarioId=${req.session.usuarioId}`);
      return res.status(403).json({ error: 'No tienes permiso para esto' });
    }

    const result = await procesarAgendaExcel.procesarAgendaExcel(req.file.path, doctorId, db);
    logger.debug('[DISPONIBILIDAD] Resultado: ' + JSON.stringify(result));

    if (!result.ok) {
      fs.unlink(req.file.path, () => {});
      logger.warn(`[DISPONIBILIDAD] Error en procesamiento: ${result.error}`);
      return res.status(400).json({ error: result.error });
    }

    const url = `/uploads/${req.file.filename}`;
    try {
      await db.execute(
        'INSERT INTO doctor_agenda_files (doctor_id, filename, url, uploaded_by) VALUES (?, ?, ?, ?)',
        [doctorId, req.file.originalname, url, req.session.usuarioId || null]
      );
    } catch (dbErr) {
      logger.warn('[DISPONIBILIDAD] Error guardando metadatos del archivo', { error: dbErr.message });
    }

    emitSocket('agenda:disponibilidad-actualizada', { doctor_id: doctorId });

    res.json({
      ok: true,
      diasGuardados: result.diasGuardados,
      errores: result.errores,
      fileUrl: url,
      message: `✓ ${result.diasGuardados} días de disponibilidad guardados`
    });
  } catch (e) {
    logger.error('[DISPONIBILIDAD] Error procesando Excel:', e.message, e.stack);
    if (req.file) fs.unlink(req.file.path, () => {});
    res.status(500).json({ error: safeError(e) });
  }
}

router.post('/doctor-disponibilidad/procesar-excel', requireAuth, upload.single('file'), validateMagicBytes, async (req, res) => {
  return handleProcesarExcelDisponibilidad(req, res);
});

router.get('/doctor-disponibilidad/:doctorId', requireAuth, async (req, res) => {
  try {
    const doctorId = parseInt(req.params.doctorId, 10);
    const mes = req.query.mes;
    if (!doctorId) {
      return res.status(400).json({ error: 'doctorId inválido' });
    }
    const disponibilidad = await procesarAgendaExcel.obtenerDisponibilidadMensual(doctorId, mes, db);
    res.json({ ok: true, disponibilidad });
  } catch (e) {
    logger.error('[DISPONIBILIDAD] Error obteniendo disponibilidad:', e.message);
    res.status(500).json({ error: safeError(e) });
  }
});

router.post('/doctor-disponibilidad/validar', requireAuth, async (req, res) => {
  try {
    const { doctor_id, fecha } = req.body;
    if (!doctor_id || !fecha) {
      return res.status(400).json({ error: 'doctor_id y fecha son obligatorios' });
    }
    const resultado = await procesarAgendaExcel.tieneDisponibilidad(doctor_id, fecha, db);
    res.json({
      ok: true,
      fecha,
      doctor_id,
      disponible: resultado.disponible,
      totalPacientes: resultado.totalPacientes || null,
      mensaje: !resultado.disponible ? 'PARA ESTE DÍA NO PUEDES AGENDAR, EL DOCTOR NO CUENTA CON DISPONIBILIDAD' : null
    });
  } catch (e) {
    logger.error('[DISPONIBILIDAD] Error validando disponibilidad:', e.message);
    res.status(500).json({ error: safeError(e) });
  }
});

router.post('/doctor-disponibilidad/guardar-dia', requireAuth, async (req, res) => {
  try {
    const { doctor_id, fecha, disponible, disponible_manana, disponible_tarde, motivo_ausencia } = req.body || {};
    const doctorId = parseInt(doctor_id || req.session.usuarioId, 10);
    if (!doctorId || !fecha) return res.status(400).json({ error: 'doctor_id y fecha son requeridos' });

    const isAdminUser = isAdminRol(req.session.rol) || isRecepcionRol(req.session.rol);
    const isDoctorUser = req.session.rol === 'doctor' && doctorId === parseInt(req.session.usuarioId, 10);
    if (!isAdminUser && !isDoctorUser) return res.status(403).json({ error: 'Sin permiso' });

    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return res.status(400).json({ error: 'Formato de fecha inválido' });

    const motivoLimpio = (typeof motivo_ausencia === 'string' && motivo_ausencia.trim())
      ? motivo_ausencia.trim().substring(0, 200)
      : null;

    await db.execute(
      `INSERT INTO doctor_disponibilidad_mensual (doctor_id, fecha, disponible, disponible_manana, disponible_tarde, motivo_ausencia)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE disponible = VALUES(disponible), disponible_manana = VALUES(disponible_manana), disponible_tarde = VALUES(disponible_tarde), motivo_ausencia = VALUES(motivo_ausencia)`,
      [doctorId, fecha, disponible ? 1 : 0, disponible_manana ? 1 : 0, disponible_tarde ? 1 : 0, motivoLimpio]
    );

    logger.info(`[DISPONIBILIDAD] Día guardado: doctor=${doctorId}, fecha=${fecha}, disponible=${disponible ? 1 : 0}, motivo=${motivoLimpio || 'ninguno'}`, { type: 'API' });
    emitSocket('agenda:disponibilidad-actualizada', { doctor_id: doctorId });
    res.json({ ok: true });
  } catch (e) {
    logger.error('[DISPONIBILIDAD] Error guardando día:', e.message);
    res.status(500).json({ error: safeError(e) });
  }
});

router.post('/doctor-disponibilidad/eliminar-dia', requireAuth, async (req, res) => {
  try {
    const { doctor_id, fecha } = req.body || {};
    const doctorId = parseInt(doctor_id || req.session.usuarioId, 10);
    if (!doctorId || !fecha) return res.status(400).json({ error: 'doctor_id y fecha son requeridos' });

    const isAdminUser = isAdminRol(req.session.rol) || isRecepcionRol(req.session.rol);
    const isDoctorUser = req.session.rol === 'doctor' && doctorId === parseInt(req.session.usuarioId, 10);
    if (!isAdminUser && !isDoctorUser) return res.status(403).json({ error: 'Sin permiso' });

    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return res.status(400).json({ error: 'Formato de fecha inválido' });

    await db.transaction(async (conn) => {
      await conn.execute('DELETE FROM doctor_disponibilidad_mensual WHERE doctor_id = ? AND fecha = ?', [doctorId, fecha]);
      await conn.execute('DELETE FROM doctor_agenda WHERE doctor_id = ? AND fecha = ?', [doctorId, fecha]);
    });

    emitSocket('agenda:disponibilidad-actualizada', { doctor_id: doctorId });
    res.json({ ok: true });
  } catch (e) {
    logger.error('[DISPONIBILIDAD] Error eliminando día:', e.message);
    res.status(500).json({ error: safeError(e) });
  }
});

router.delete('/doctor-disponibilidad/:doctorId', requireAuth, async (req, res) => {
  try {
    const doctorId = parseInt(req.params.doctorId, 10);
    if (!doctorId) {
      return res.status(400).json({ error: 'doctorId inválido' });
    }
    const isAdmin = req.session.rol === 'admin' || req.session.rol === 'superadmin';
    const isDoctor = req.session.rol === 'doctor' && doctorId === req.session.usuarioId;
    if (!isAdmin && !isDoctor) {
      return res.status(403).json({ error: 'No tienes permiso para esto' });
    }
    const result = await procesarAgendaExcel.limpiarDisponibilidad(doctorId, db);
    if (result.ok) emitSocket('agenda:disponibilidad-actualizada', { doctor_id: doctorId });
    res.json(result);
  } catch (e) {
    logger.error('[DISPONIBILIDAD] Error limpiando disponibilidad:', e.message);
    res.status(500).json({ error: safeError(e) });
  }
});

// GET /api/doctor-disponibilidad (con query params fecha/doctor_id)
router.get('/doctor-disponibilidad', requireAuth, async (req, res) => {
  const { doctor_id, fecha } = req.query;
  if (!doctor_id || !fecha) {
    return res.status(400).json({ ok: false, error: 'doctor_id y fecha son obligatorios' });
  }
  try {
    const { intervalos, existe_registro: tiene_intervalos } = await procesarAgendaExcel.consultarIntervalosNoDisponibles(doctor_id, fecha, db);

    if (tiene_intervalos) {
      return res.json({
        ok: true,
        tiene_intervalos: true,
        intervalos: intervalos,
        disponible_manana: true,
        disponible_tarde: true
      });
    }

    const result = await db.execute(
      `SELECT disponible_manana, disponible_tarde FROM doctor_disponibilidad_mensual
       WHERE doctor_id = ? AND fecha = ?`,
      [doctor_id, fecha]
    );

    if (result.length === 0) {
      return res.json({
        ok: true,
        tiene_intervalos: false,
        intervalos: [],
        disponible_manana: true,
        disponible_tarde: true,
        razon: 'sin_restricciones'
      });
    }

    const registro = result[0];
    const dm = registro.disponible_manana;
    const dt = registro.disponible_tarde;
    return res.json({
      ok: true,
      tiene_intervalos: false,
      intervalos: [],
      disponible_manana: (dm === null || dm === undefined) ? true : Boolean(dm),
      disponible_tarde: (dt === null || dt === undefined) ? true : Boolean(dt)
    });
  } catch (e) {
    logger.error(e.message, { error: e });
    res.status(500).json({ ok: false, error: safeError(e) });
  }
});

// --- Rutas heredadas (compatibilidad) ---

router.post('/doctor-dias-bloqueados/procesar-excel', requireAuth, upload.single('file'), validateMagicBytes, async (req, res) => {
  return handleProcesarExcelDisponibilidad(req, res);
});

router.get('/doctor-dias-bloqueados/:doctorId', requireAuth, async (req, res) => {
  try {
    const doctorId = parseInt(req.params.doctorId, 10);
    const disp = await procesarAgendaExcel.obtenerDiasBloqueados(doctorId, db);
    res.json({ ok: true, dias: disp });
  } catch (e) {
    res.status(500).json({ error: safeError(e) });
  }
});

router.post('/doctor-dias-bloqueados/validar', requireAuth, async (req, res) => {
  try {
    const { doctor_id, fecha } = req.body;
    const esta_bloqueada = await procesarAgendaExcel.estaFechaBloqueada(doctor_id, fecha, db);
    res.json({
      ok: true,
      fecha,
      doctor_id,
      bloqueada: esta_bloqueada,
      mensaje: esta_bloqueada ? 'PARA ESTE DÍA NO PUEDES AGENDAR, EL DOCTOR NO CUENTA CON DISPONIBILIDAD' : null
    });
  } catch (e) {
    res.status(500).json({ error: safeError(e) });
  }
});

router.delete('/doctor-dias-bloqueados/:doctorId', requireAuth, async (req, res) => {
  const doctorId = parseInt(req.params.doctorId, 10);
  const isAdmin = isAdminRol(req.session.rol);
  const isDoctor = req.session.rol === 'doctor' && doctorId === req.session.usuarioId;
  if (!isAdmin && !isDoctor) {
    return res.status(403).json({ error: 'No tienes permiso' });
  }
  const result = await procesarAgendaExcel.limpiarDisponibilidad(doctorId, db);
  res.json(result);
});

module.exports = router;
