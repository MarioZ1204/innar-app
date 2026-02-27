// modules/validation-schemas.js
// Esquemas de validación centralizados con Joi
// Mantienen la consistencia de datos en toda la aplicación

const Joi = require('joi');

/**
 * Esquemas de validación para todos los endpoints
 * Agrupa por módulo (auth, usuarios, turnos, citas, recibos, etc.)
 */

// ============= AUTH & USUARIOS =============

const schemas = {
  // -------- LOGIN & AUTH --------
  login: Joi.object({
    usuario: Joi.string().alphanum().required().messages({
      'string.empty': 'Usuario requerido',
      'string.alphanum': 'Usuario solo puede contener letras y números'
    }),
    contrasena: Joi.string().min(8).required().messages({
      'string.empty': 'Contraseña requerida',
      'string.min': 'Contraseña debe tener mínimo 8 caracteres'
    })
  }),

  cambiarContrasena: Joi.object({
    contrasenaActual: Joi.string().min(8).required().messages({
      'string.empty': 'Contraseña actual requerida',
      'string.min': 'Contraseña debe tener mínimo 8 caracteres'
    }),
    contrasenaNew: Joi.string().min(8).required().messages({
      'string.empty': 'Nueva contraseña requerida',
      'string.min': 'Contraseña debe tener mínimo 8 caracteres'
    })
  }),

  // -------- USUARIOS --------
  crearUsuario: Joi.object({
    usuario: Joi.string().alphanum().required().min(3).max(50).messages({
      'string.empty': 'Usuario requerido',
      'string.alphanum': 'Usuario solo puede contener letras y números',
      'string.min': 'Usuario debe tener mínimo 3 caracteres',
      'string.max': 'Usuario no puede exceder 50 caracteres'
    }),
    nombre: Joi.string().required().min(3).max(255).messages({
      'string.empty': 'Nombre requerido',
      'string.min': 'Nombre debe tener mínimo 3 caracteres'
    }),
    apellido: Joi.string().required().min(3).max(255).messages({
      'string.empty': 'Apellido requerido',
      'string.min': 'Apellido debe tener mínimo 3 caracteres'
    }),
    email: Joi.string().email().required().messages({
      'string.empty': 'Email requerido',
      'string.email': 'Email inválido'
    }),
    rol: Joi.string().valid('admin', 'doctor', 'recepcion', 'gerente').required().messages({
      'string.empty': 'Rol requerido',
      'any.only': 'Rol debe ser admin, doctor, recepcion o gerente'
    }),
    especialidad: Joi.string().max(100).optional(),
    numero_consultorio: Joi.number().integer().positive().optional(),
    contrasena: Joi.string().min(8).required().messages({
      'string.empty': 'Contraseña requerida',
      'string.min': 'Contraseña debe tener mínimo 8 caracteres'
    })
  }),

  actualizarUsuario: Joi.object({
    nombre: Joi.string().min(3).max(255).optional(),
    apellido: Joi.string().min(3).max(255).optional(),
    email: Joi.string().email().optional(),
    especialidad: Joi.string().max(100).optional(),
    numero_consultorio: Joi.number().integer().positive().optional(),
    activo: Joi.number().valid(0, 1).optional()
  }),

  // ============= TURNOS =============

  crearTurno: Joi.object({
    fecha: Joi.date().iso().required().messages({
      'date.base': 'Fecha debe ser válida',
      'date.format': 'Fecha debe estar en formato ISO (YYYY-MM-DD)'
    }),
    hora: Joi.string().pattern(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/).required().messages({
      'string.pattern.base': 'Hora debe estar en formato HH:MM (24h)'
    }),
    doctor_id: Joi.number().integer().positive().required().messages({
      'number.base': 'doctor_id debe ser número',
      'number.positive': 'doctor_id debe ser positivo'
    }),
    paciente_nombre: Joi.string().required().min(3).max(255).messages({
      'string.empty': 'Nombre de paciente requerido'
    }),
    paciente_telefono: Joi.string().optional().max(20),
    paciente_email: Joi.string().email().optional(),
    consultorio_numero: Joi.number().integer().positive().optional(),
    observaciones: Joi.string().optional().max(500)
  }),

  actualizarTurno: Joi.object({
    fecha: Joi.date().iso().optional(),
    hora: Joi.string().pattern(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/).optional(),
    estado: Joi.string().optional().max(50),
    consultorio_numero: Joi.number().integer().positive().optional(),
    observaciones: Joi.string().optional().max(500)
  }),

  // ============= CITAS ELECTRO =============

  crearCitaElectro: Joi.object({
    fecha: Joi.date().iso().required().messages({
      'date.base': 'Fecha debe ser válida'
    }),
    hora_inicio: Joi.string().pattern(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/).required(),
    hora_fin: Joi.string().pattern(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/).required(),
    paciente_dni: Joi.string().required().min(5).max(20),
    paciente_nombre: Joi.string().required().min(3).max(255),
    paciente_edad: Joi.number().integer().min(0).max(150).optional(),
    paciente_email: Joi.string().email().optional(),
    paciente_telefono: Joi.string().optional().max(20),
    equipo_id: Joi.number().integer().positive().optional().allow(null),
    diagnostico_id: Joi.number().integer().positive().optional().allow(null),
    estado: Joi.string().valid('Programado', 'En Sala', 'En Estudio', 'Completado', 'No Asistió', 'Cancelado').optional(),
    observaciones: Joi.string().optional().max(1000),
    programado_por_nombre: Joi.string().optional().max(150)
  }),

  actualizarCitaElectro: Joi.object({
    fecha: Joi.date().iso().optional(),
    hora_inicio: Joi.string().pattern(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/).optional(),
    hora_fin: Joi.string().pattern(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/).optional(),
    equipo_id: Joi.number().integer().positive().optional().allow(null),
    diagnostico_id: Joi.number().integer().positive().optional().allow(null),
    estado: Joi.string().valid('Programado', 'En Sala', 'En Estudio', 'Completado', 'No Asistió', 'Cancelado').optional(),
    observaciones: Joi.string().optional().max(1000)
  }),

  // ============= DIAGNÓSTICOS =============

  crearDiagnostico: Joi.object({
    nombre: Joi.string().required().min(3).max(255).messages({
      'string.empty': 'Nombre requerido'
    }),
    descripcion: Joi.string().optional().max(1000),
    codigo: Joi.string().optional().max(50),
    activo: Joi.number().valid(0, 1).optional().default(1)
  }),

  actualizarDiagnostico: Joi.object({
    nombre: Joi.string().min(3).max(255).optional(),
    descripcion: Joi.string().optional().max(1000),
    codigo: Joi.string().optional().max(50),
    activo: Joi.number().valid(0, 1).optional()
  }),

  // ============= RECIBOS =============

  crearRecibo: Joi.object({
    numero_recibo: Joi.string().required().messages({
      'string.empty': 'Número de recibo requerido'
    }),
    paciente_nombre: Joi.string().required().min(3).max(255),
    fecha: Joi.date().iso().required(),
    servicios: Joi.array().items(
      Joi.object({
        descripcion: Joi.string().required(),
        cantidad: Joi.number().positive().required(),
        precio: Joi.number().positive().required()
      })
    ).required(),
    total: Joi.number().positive().required(),
    estado: Joi.string().valid('PENDIENTE', 'PAGADO', 'CANCELADO').optional().default('PENDIENTE'),
    observaciones: Joi.string().optional().max(500)
  }),

  actualizarRecibo: Joi.object({
    estado: Joi.string().valid('PENDIENTE', 'PAGADO', 'CANCELADO').optional(),
    observaciones: Joi.string().optional().max(500)
  }),

  // ============= DISPONIBILIDAD =============

  crearDisponibilidad: Joi.object({
    doctor_id: Joi.number().integer().positive().required(),
    fecha: Joi.date().iso().required(),
    disponible_manana: Joi.boolean().optional().default(true),
    disponible_tarde: Joi.boolean().optional().default(true)
  }),

  agregarIntervaloBloqueado: Joi.object({
    doctor_id: Joi.number().integer().positive().required(),
    fecha: Joi.date().iso().required(),
    hora_inicio: Joi.string().pattern(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/).required(),
    hora_fin: Joi.string().pattern(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/).required(),
    razon: Joi.string().optional().max(255)
  }),

  // ============= BÚSQUEDAS & FILTROS =============

  searchPacientes: Joi.object({
    nombre: Joi.string().optional(),
    dni: Joi.string().optional(),
    email: Joi.string().optional()
  }),

  filtroTurnos: Joi.object({
    fecha_inicio: Joi.date().iso().optional(),
    fecha_fin: Joi.date().iso().optional(),
    doctor_id: Joi.number().integer().optional(),
    estado: Joi.string().optional(),
    page: Joi.number().integer().min(1).optional().default(1),
    limit: Joi.number().integer().min(1).max(100).optional().default(20)
  })
};

/**
 * Middleware para validar request body
 * @param {String} schemaName - Nombre del schema en schemas obj
 * @returns {Function} Middleware
 * 
 * @example
 * app.post('/api/usuarios', validateSchema('crearUsuario'), controller);
 */
function validateSchema(schemaName) {
  return (req, res, next) => {
    if (!schemas[schemaName]) {
      return res.status(400).json({
        error: `Schema '${schemaName}' no existe`
      });
    }

    const schema = schemas[schemaName];
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true
    });

    if (error) {
      const messages = error.details.map(d => ({
        field: d.path.join('.'),
        message: d.message
      }));

      return res.status(422).json({
        error: 'Validación fallida',
        details: messages
      });
    }

    // Reemplazar req.body con valores validados y limpios
    req.body = value;
    next();
  };
}

/**
 * Validar solo con el schema, sin middleware
 * Útil para validaciones manuales
 */
function validate(schemaName, data) {
  if (!schemas[schemaName]) {
    return {
      valid: false,
      error: `Schema '${schemaName}' no existe`
    };
  }

  const schema = schemas[schemaName];
  const { error, value } = schema.validate(data, {
    abortEarly: false,
    stripUnknown: true
  });

  if (error) {
    return {
      valid: false,
      error: error.details.map(d => ({
        field: d.path.join('.'),
        message: d.message
      }))
    };
  }

  return {
    valid: true,
    data: value
  };
}

module.exports = {
  schemas,
  validateSchema,
  validate
};
