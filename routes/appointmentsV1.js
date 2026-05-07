/**
 * Rutas para API de Citas Electrodiagnósticas
 * Integración del Appointments Service en innar-app
 */
const express = require('express');
const AppointmentService = require('../services/appointmentService');
const logger = require('../utils/logger');
const { safeError } = require('../middleware/index');

const router = express.Router();

/**
 * POST /api/v1/appointments
 * Crear nueva cita
 */
router.post('/', async (req, res) => {
  try {
    const {
      study_type_id,
      equipment_id,
      paciente_id,
      paciente_nombre,
      paciente_email,
      paciente_phone,
      start_time,
      end_time,
      estudio,
      observaciones,
      diagnostico_id,
      estado,
      programado_por_nombre
    } = req.body;

    // Validaciones básicas
    if (!paciente_id || !start_time || !end_time) {
      return res.status(400).json({
        error: 'Faltan campos obligatorios: paciente_id, start_time, end_time'
      });
    }

    const result = await AppointmentService.createAppointment({
      study_type_id,
      equipment_id,
      paciente_id,
      paciente_nombre,
      paciente_email,
      paciente_phone,
      start_time,
      end_time,
      estudio,
      observaciones,
      diagnostico_id,
      estado,
      programado_por_nombre
    });

    res.status(201).json(result);
  } catch (error) {
    logger.error('Error creando cita', { error: error.message });
    res.status(500).json({ error: safeError(error) });
  }
});

/**
 * GET /api/v1/appointments
 * Listar citas con filtros
 */
router.get('/', async (req, res) => {
  try {
    const { fecha, equipo_id, estado, limit, offset } = req.query;
    const appointments = await AppointmentService.listAppointments({
      fecha,
      equipo_id: equipo_id ? parseInt(equipo_id) : undefined,
      estado,
      limit: limit ? parseInt(limit) : 100,
      offset: offset ? parseInt(offset) : 0
    });

    res.json(appointments);
  } catch (error) {
    logger.error('Error listando citas', { error: error.message });
    res.status(500).json({ error: safeError(error) });
  }
});

/**
 * GET /api/v1/appointments/availability/:equipment_id/:date
 * Obtener disponibilidad de un equipo
 */
router.get('/availability/:equipment_id/:date', async (req, res) => {
  try {
    const { equipment_id, date } = req.params;
    const occupancies = await AppointmentService.getEquipmentAvailability(equipment_id, date);

    res.json({ equipment_id, date, occupancies });
  } catch (error) {
    logger.error('Error obteniendo disponibilidad', { error: error.message });
    res.status(500).json({ error: safeError(error) });
  }
});

/**
 * GET /api/v1/study-types
 * Obtener tipos de estudio
 */
router.get('/types/list', async (req, res) => {
  try {
    const studies = await AppointmentService.getStudyTypes();
    res.json(studies);
  } catch (error) {
    logger.error('Error obteniendo tipos de estudio', { error: error.message });
    res.status(500).json({ error: safeError(error) });
  }
});

/**
 * GET /api/v1/equipments
 * Obtener equipos disponibles
 */
router.get('/equipments/list', async (req, res) => {
  try {
    const equipments = await AppointmentService.getEquipments();
    res.json(equipments);
  } catch (error) {
    logger.error('Error obteniendo equipos', { error: error.message });
    res.status(500).json({ error: safeError(error) });
  }
});

/**
 * GET /api/v1/appointments/:id
 * Obtener cita por ID
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const appointment = await AppointmentService.getAppointmentById(id);

    if (!appointment) {
      return res.status(404).json({ error: 'Cita no encontrada' });
    }

    res.json(appointment);
  } catch (error) {
    logger.error('Error obteniendo cita', { error: error.message });
    res.status(500).json({ error: safeError(error) });
  }
});

/**
 * PATCH /api/v1/appointments/:id
 * Actualizar cita
 */
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;

    await AppointmentService.updateAppointment(id, data);

    res.json({ ok: true, message: 'Cita actualizada correctamente' });
  } catch (error) {
    logger.error('Error actualizando cita', { error: error.message });
    res.status(500).json({ error: safeError(error) });
  }
});

/**
 * DELETE /api/v1/appointments/:id
 * Cancelar cita
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    await AppointmentService.cancelAppointment(id);

    res.json({ ok: true, message: 'Cita cancelada correctamente' });
  } catch (error) {
    logger.error('Error cancelando cita', { error: error.message });
    res.status(500).json({ error: safeError(error) });
  }
});

module.exports = router;
