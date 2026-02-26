/**
 * Servicio de Citas Electrodiagnósticas
 * Maneja lógica de negocio para gestión de citas y disponibilidad de equipos
 */
const db = require('../utils/db-mysql');

class AppointmentService {
  /**
   * Crear nueva cita y registrar ocupación de equipo
   */
  static async createAppointment(data) {
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
    } = data;

    try {
      // Convertir start_time y end_time a formato DATETIME si son necesarios
      const startDateTime = new Date(start_time);
      const endDateTime = new Date(end_time);

      // Verificar que el equipo esté disponible
      const conflict = await this.checkEquipmentConflict(equipment_id, startDateTime, endDateTime);
      if (conflict) {
        throw new Error('El equipo no está disponible en el rango de tiempo solicitado');
      }

      // Crear la cita
      const appointmentResult = await db.execute(
        `INSERT INTO citas_electro (
          equipo_id, paciente_id, fecha, hora_agendamiento, estudio, 
          observaciones, diagnostico_id, estado, programado_por_nombre
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          equipment_id || null,
          paciente_id,
          new Date(start_time).toISOString().split('T')[0], // Fecha
          startDateTime.toTimeString().split(' ')[0], // Hora
          estudio || null,
          observaciones || null,
          diagnostico_id || null,
          estado || 'Programado',
          programado_por_nombre || 'Sistema'
        ]
      );

      const appointmentId = appointmentResult.insertId;

      // Registrar ocupación del equipo
      if (equipment_id) {
        await db.execute(
          `INSERT INTO equipment_occupancies (
            equipo_id, cita_id, start_time, end_time
          ) VALUES (?, ?, ?, ?)`,
          [equipment_id, appointmentId, startDateTime, endDateTime]
        );
      }

      return { ok: true, id: appointmentId };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Obtener cita por ID
   */
  static async getAppointmentById(id) {
    try {
      const appointment = await db.queryOne(
        `SELECT c.*, 
                p.nombre as paciente_nombre, 
                p.documento as paciente_documento,
                p.telefono as paciente_phone,
                d.nombre as diagnostico_nombre,
                d.codigo as diagnostico_codigo,
                e.nombre as equipment_name
         FROM citas_electro c
         LEFT JOIN pacientes p ON p.id = c.paciente_id
         LEFT JOIN diagnosticos d ON d.id = c.diagnostico_id
         LEFT JOIN equipos_electro e ON e.id = c.equipo_id
         WHERE c.id = ?`,
        [id]
      );
      return appointment;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Listar citas con filtros
   */
  static async listAppointments(filters = {}) {
    try {
      const { fecha, equipo_id, estado, limit = 100, offset = 0 } = filters;
      let query = `
        SELECT c.*, 
               p.nombre as paciente_nombre, 
               p.documento as paciente_documento,
               p.telefono as paciente_phone,
               d.nombre as diagnostico_nombre,
               d.codigo as diagnostico_codigo,
               e.nombre as equipment_name
        FROM citas_electro c
        LEFT JOIN pacientes p ON p.id = c.paciente_id
        LEFT JOIN diagnosticos d ON d.id = c.diagnostico_id
        LEFT JOIN equipos_electro e ON e.id = c.equipo_id
        WHERE 1=1
      `;
      const params = [];

      if (fecha) {
        query += ` AND DATE(c.fecha) = ?`;
        params.push(fecha);
      }

      if (equipo_id) {
        query += ` AND c.equipo_id = ?`;
        params.push(equipo_id);
      }

      if (estado) {
        query += ` AND c.estado = ?`;
        params.push(estado);
      }

      // Convertir limit y offset a números enteros
      const safeLimit = Math.max(1, Math.min(parseInt(limit) || 100, 500)); // Max 500
      const safeOffset = Math.max(0, parseInt(offset) || 0);

      query += ` ORDER BY c.hora_agendamiento ASC LIMIT ${safeLimit} OFFSET ${safeOffset}`;

      const appointments = await db.query(query, params);
      return appointments;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Actualizar cita
   */
  static async updateAppointment(id, data) {
    try {
      const { equipo_id, estado, hora_inicio, hora_fin, observaciones, diagnostico_id } = data;
      const updates = [];
      const values = [];

      if (equipo_id !== undefined) {
        updates.push('equipo_id = ?');
        values.push(equipo_id || null);
      }

      if (estado !== undefined) {
        updates.push('estado = ?');
        values.push(estado);
      }

      if (hora_inicio !== undefined) {
        updates.push('hora_inicio = ?');
        values.push(hora_inicio);
      }

      if (hora_fin !== undefined) {
        updates.push('hora_fin = ?');
        values.push(hora_fin);
      }

      if (observaciones !== undefined) {
        updates.push('observaciones = ?');
        values.push(observaciones);
      }

      if (diagnostico_id !== undefined) {
        updates.push('diagnostico_id = ?');
        values.push(diagnostico_id || null);
      }

      if (updates.length === 0) {
        return { ok: true };
      }

      updates.push('actualizado_en = CURRENT_TIMESTAMP');
      values.push(id);

      await db.execute(
        `UPDATE citas_electro SET ${updates.join(', ')} WHERE id = ?`,
        values
      );

      return { ok: true };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Cancelar cita y liberar ocupación de equipo
   */
  static async cancelAppointment(id) {
    try {
      // Actualizar estado a cancelado
      await db.execute(
        `UPDATE citas_electro SET estado = 'Cancelado', actualizado_en = CURRENT_TIMESTAMP WHERE id = ?`,
        [id]
      );

      // Eliminar ocupación de equipo
      await db.execute(
        `DELETE FROM equipment_occupancies WHERE cita_id = ?`,
        [id]
      );

      return { ok: true };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Verificar si un equipo tiene conflicto de disponibilidad
   */
  static async checkEquipmentConflict(equipment_id, start_time, end_time) {
    try {
      const conflict = await db.queryOne(
        `SELECT id FROM equipment_occupancies 
         WHERE equipo_id = ?
         AND (
           (start_time < ? AND end_time > ?)
           OR (start_time >= ? AND start_time < ?)
           OR (end_time > ? AND end_time <= ?)
         )`,
        [equipment_id, end_time, start_time, start_time, end_time, start_time, end_time]
      );
      return conflict !== null;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Obtener disponibilidad de un equipo en un rango de fechas
   */
  static async getEquipmentAvailability(equipment_id, date) {
    try {
      const occupancies = await db.query(
        `SELECT start_time, end_time 
         FROM equipment_occupancies 
         WHERE equipo_id = ? AND DATE(start_time) = ?
         ORDER BY start_time ASC`,
        [equipment_id, date]
      );
      return occupancies;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Obtener todos los estudios disponibles
   */
  static async getStudyTypes() {
    try {
      const studies = await db.query(
        `SELECT * FROM study_types ORDER BY name ASC`
      );
      return studies;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Obtener todos los equipos disponibles
   */
  static async getEquipments() {
    try {
      const equipments = await db.query(
        `SELECT * FROM equipos_electro WHERE activo = 1 ORDER BY nombre ASC`
      );
      return equipments;
    } catch (error) {
      throw error;
    }
  }
}

module.exports = AppointmentService;
