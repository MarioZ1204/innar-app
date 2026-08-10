// modules/validation-schemas.js
// Esquemas de validación centralizados con Joi
//
// NOTA: existen dos grupos de schemas:
//  - Legacy (`login`, `crearUsuario`, `crearTurno`, `crearRecibo`, etc.): mantenidos
//    por compatibilidad con tests viejos. NO reflejan el modelo real en producción.
//  - "Api" (prefijados con `api*`): alineados con la BD y las rutas reales de
//    `routes/`. Estos son los que `validateSchema()` debería usar en código nuevo.

const Joi = require('joi');

const SHA512_HEX = /^[a-f0-9]{128}$/i;
// El frontend puede recibir horas/fechas desde MySQL como HH:MM:SS o
// YYYY-MM-DDT00:00:00.000Z y reenviarlas en ediciones parciales.
// Los schemas API aceptan esos formatos y normalizan a lo que espera la BD.
const HORA_HHMM = /^([0-1][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/;
const FECHA_ISO = /^\d{4}-\d{2}-\d{2}(?:[T\s].*)?$/;

const fechaApi = Joi.string().pattern(FECHA_ISO).custom((value) => value.slice(0, 10));
const horaApi = Joi.string().pattern(HORA_HHMM).custom((value) => value.slice(0, 5));

const ROLES_VALIDOS = ['superadmin', 'admin', 'admin_recepcion', 'recepcion', 'admin_electro', 'electro', 'tecnico_electro', 'auxiliar_recepcion', 'doctor', 'contabilidad'];
const ESTADOS_TURNOS = ['PENDIENTE', 'EN_SALA', 'EN_ATENCION', 'ATENDIDO', 'COMPLETADO', 'NO_ASISTIO', 'CANCELADO', 'REPROGRAMADO'];
const ESTADOS_ELECTRO = ['Programado', 'Confirmado', 'En Sala', 'En Estudio', 'Pausado', 'Completado', 'No Asistió', 'Cancelado', 'Reprogramado', 'Adelantado'];

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
  }),

  // ============= API: schemas alineados al modelo real =============

  apiLogin: Joi.object({
    usuario: Joi.string().pattern(/^[a-zA-Z0-9._-]+$/).max(64).required(),
    password: Joi.string().pattern(SHA512_HEX).required()
  }),

  apiCrearUsuario: Joi.object({
    usuario: Joi.string().pattern(/^[a-zA-Z0-9._-]+$/).min(3).max(50).required(),
    password: Joi.string().pattern(SHA512_HEX).required(),
    nombre: Joi.string().min(2).max(255).required(),
    rol: Joi.string().valid(...ROLES_VALIDOS).required(),
    numero_consultorio: Joi.number().integer().positive().optional().allow(null),
    especialidad: Joi.string().max(100).optional().allow(null, '')
  }),

  apiActualizarUsuario: Joi.object({
    usuario: Joi.string().pattern(/^[a-zA-Z0-9._-]+$/).min(3).max(50).optional(),
    password: Joi.string().pattern(SHA512_HEX).optional(),
    nombre: Joi.string().min(2).max(255).optional(),
    rol: Joi.string().valid(...ROLES_VALIDOS).optional(),
    activo: Joi.alternatives().try(Joi.number().valid(0, 1), Joi.boolean()).optional(),
    numero_consultorio: Joi.number().integer().positive().optional().allow(null),
    especialidad: Joi.string().max(100).optional().allow(null, '')
  }).min(1),

  apiCrearTurno: Joi.object({
    doctor_id: Joi.number().integer().positive().required(),
    paciente_nombre: Joi.string().min(2).max(255).required(),
    paciente_documento: Joi.string().max(30).optional().allow(null, ''),
    paciente_telefono: Joi.string().max(20).optional().allow(null, ''),
    paciente_telefono2: Joi.string().max(20).optional().allow(null, ''),
    fecha: fechaApi.required(),
    hora: horaApi.required(),
    tipo_consulta: Joi.string().max(200).optional().allow(null, ''),
    entidad: Joi.string().max(100).optional().allow(null, ''),
    notas: Joi.string().max(2000).optional().allow(null, ''),
    oportunidad: Joi.alternatives().try(Joi.number().integer(), Joi.string()).optional().allow(null, ''),
    programado_por: Joi.string().max(150).optional().allow(null, ''),
    forzar_cupo: Joi.boolean().optional()
  }),

  apiCrearTurnosLote: Joi.object({
    doctor_id: Joi.number().integer().positive().required(),
    paciente_nombre: Joi.string().min(2).max(255).required(),
    paciente_documento: Joi.string().max(30).optional().allow(null, ''),
    paciente_telefono: Joi.string().max(20).optional().allow(null, ''),
    paciente_telefono2: Joi.string().max(20).optional().allow(null, ''),
    hora: horaApi.required(),
    tipo_consulta: Joi.string().max(200).optional().allow(null, ''),
    entidad: Joi.string().max(100).optional().allow(null, ''),
    notas: Joi.string().max(2000).optional().allow(null, ''),
    oportunidad: Joi.alternatives().try(Joi.number().integer(), Joi.string()).optional().allow(null, ''),
    programado_por: Joi.string().max(150).optional().allow(null, ''),
    forzar_cupo: Joi.boolean().optional(),
    sesiones: Joi.array().items(
      Joi.object({
        fecha: fechaApi.required(),
        hora: horaApi.optional(),
        sesion_numero: Joi.number().integer().min(1).max(100).optional()
      })
    ).min(1).max(52).required()
  }),

  apiActualizarTurno: Joi.object({
    paciente_nombre: Joi.string().min(2).max(255).optional(),
    paciente_documento: Joi.string().max(30).optional().allow(null, ''),
    paciente_telefono: Joi.string().max(20).optional().allow(null, ''),
    paciente_telefono2: Joi.string().max(20).optional().allow(null, ''),
    entidad: Joi.string().max(100).optional().allow(null, ''),
    notas: Joi.string().max(2000).optional().allow(null, ''),
    tipo_consulta: Joi.string().max(200).optional().allow(null, ''),
    doctor_id: Joi.number().integer().positive().optional(),
    fecha: fechaApi.optional(),
    hora: horaApi.optional(),
    estado: Joi.string().valid(...ESTADOS_TURNOS).optional(),
    observaciones: Joi.string().max(2000).optional().allow(null, ''),
    forzar_cupo: Joi.boolean().optional()
  }).min(1),

  apiPatchEstadoTurno: Joi.object({
    estado: Joi.string().valid(...ESTADOS_TURNOS).required()
  }),

  apiPatchEstadoElectro: Joi.object({
    estado: Joi.string().valid(...ESTADOS_ELECTRO).required()
  }),

  apiChatAbrir: Joi.object({
    destinatario_id: Joi.number().integer().positive().required()
  }),

  apiChatMensaje: Joi.object({
    cuerpo: Joi.string().trim().min(1).max(2000).required(),
    paciente_id: Joi.number().integer().positive().optional().allow(null),
    turno_id: Joi.number().integer().positive().optional().allow(null),
    cita_electro_id: Joi.number().integer().positive().optional().allow(null),
    paciente_nombre: Joi.string().max(200).optional().allow(null, ''),
    contexto_label: Joi.string().max(240).optional().allow(null, '')
  }),

  apiCrearDiagnostico: Joi.object({
    nombre: Joi.string().min(3).max(255).required(),
    descripcion: Joi.string().max(1000).optional().allow(null, ''),
    codigo: Joi.string().max(50).optional().allow(null, ''),
    activo: Joi.alternatives().try(Joi.number().valid(0, 1), Joi.boolean()).optional()
  }),

  apiPacienteEspera: Joi.object({
    documento: Joi.string().min(3).max(30).required(),
    nombres: Joi.string().min(2).max(150).required(),
    apellidos: Joi.string().min(2).max(150).required(),
    entidad: Joi.string().max(100).required(),
    prioridad: Joi.string().valid('ALTA', 'MEDIA', 'BAJA').optional().default('MEDIA'),
    ingresado_por: Joi.string().max(150).optional().allow(null, ''),
    telefono1: Joi.string().max(20).optional().allow(null, ''),
    telefono2: Joi.string().max(20).optional().allow(null, ''),
    tipo_estudio: Joi.string().max(200).optional().allow(null, '')
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
  validate,
  ROLES_VALIDOS,
  ESTADOS_TURNOS,
  ESTADOS_ELECTRO,
  SHA512_HEX,
  HORA_HHMM,
  FECHA_ISO
};
