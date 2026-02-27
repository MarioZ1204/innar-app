// __tests__/validation.test.js
// Tests para módulo de validación con Joi

const { schemas, validateSchema, validate } = require('../modules/validation-schemas');

describe('Validation Schemas', () => {
  describe('Login Schema', () => {
    test('should accept valid login', () => {
      const result = validate('login', {
        usuario: 'testuser',
        contrasena: 'password123'
      });

      expect(result.valid).toBe(true);
      expect(result.data.usuario).toBe('testuser');
      expect(result.data.contrasena).toBe('password123');
    });

    test('should reject empty usuario', () => {
      const result = validate('login', {
        usuario: '',
        contrasena: 'password123'
      });

      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    test('should reject short password', () => {
      const result = validate('login', {
        usuario: 'testuser',
        contrasena: 'short'
      });

      expect(result.valid).toBe(false);
      expect(result.error[0].field).toBe('contrasena');
    });

    test('should reject non-alphanumeric usuario', () => {
      const result = validate('login', {
        usuario: 'test@user!',
        contrasena: 'password123'
      });

      expect(result.valid).toBe(false);
    });
  });

  describe('Crear Usuario Schema', () => {
    test('should accept valid user creation', () => {
      const result = validate('crearUsuario', {
        usuario: 'newdoctor',
        nombre: 'Juan',
        apellido: 'Pérez',
        email: 'juan@example.com',
        rol: 'doctor',
        especialidad: 'Cardiología',
        contrasena: 'securepass123'
      });

      expect(result.valid).toBe(true);
      expect(result.data.rol).toBe('doctor');
    });

    test('should reject invalid email', () => {
      const result = validate('crearUsuario', {
        usuario: 'newdoctor',
        nombre: 'Juan',
        apellido: 'Pérez',
        email: 'invalid-email',
        rol: 'doctor',
        contrasena: 'securepass123'
      });

      expect(result.valid).toBe(false);
      expect(result.error[0].field).toBe('email');
    });

    test('should reject invalid rol', () => {
      const result = validate('crearUsuario', {
        usuario: 'newdoctor',
        nombre: 'Juan',
        apellido: 'Pérez',
        email: 'juan@example.com',
        rol: 'superadmin',
        contrasena: 'securepass123'
      });

      expect(result.valid).toBe(false);
    });

    test('should strip unknown fields', () => {
      const result = validate('crearUsuario', {
        usuario: 'newdoctor',
        nombre: 'Juan',
        apellido: 'Pérez',
        email: 'juan@example.com',
        rol: 'doctor',
        contrasena: 'securepass123',
        unknownField: 'should be removed'
      });

      expect(result.valid).toBe(true);
      expect(result.data.unknownField).toBeUndefined();
    });
  });

  describe('Crear Turno Schema', () => {
    test('should accept valid appointment', () => {
      const result = validate('crearTurno', {
        fecha: '2026-03-15',
        hora: '14:30',
        doctor_id: 5,
        paciente_nombre: 'Carlos García',
        paciente_telefono: '1234567890',
        paciente_email: 'carlos@example.com'
      });

      expect(result.valid).toBe(true);
    });

    test('should reject invalid hours format', () => {
      const result = validate('crearTurno', {
        fecha: '2026-03-15',
        hora: '25:00',
        doctor_id: 5,
        paciente_nombre: 'Carlos García'
      });

      expect(result.valid).toBe(false);
    });

    test('should reject negative doctor_id', () => {
      const result = validate('crearTurno', {
        fecha: '2026-03-15',
        hora: '14:30',
        doctor_id: -1,
        paciente_nombre: 'Carlos García'
      });

      expect(result.valid).toBe(false);
    });
  });

  describe('Crear Cita Electro Schema', () => {
    test('should accept valid electro appointment', () => {
      const result = validate('crearCitaElectro', {
        fecha: '2026-03-20',
        hora_inicio: '09:00',
        hora_fin: '09:30',
        paciente_dni: '12345678',
        paciente_nombre: 'María López',
        paciente_edad: 45,
        estado: 'Programado'
      });

      expect(result.valid).toBe(true);
    });

    test('should allow null equipment', () => {
      const result = validate('crearCitaElectro', {
        fecha: '2026-03-20',
        hora_inicio: '09:00',
        hora_fin: '09:30',
        paciente_dni: '12345678',
        paciente_nombre: 'María López',
        equipo_id: null
      });

      expect(result.valid).toBe(true);
      expect(result.data.equipo_id).toBeNull();
    });

    test('should validate estado enum', () => {
      const result = validate('crearCitaElectro', {
        fecha: '2026-03-20',
        hora_inicio: '09:00',
        hora_fin: '09:30',
        paciente_dni: '12345678',
        paciente_nombre: 'María López',
        estado: 'InvalidStatus'
      });

      expect(result.valid).toBe(false);
    });
  });

  describe('Crear Diagnóstico Schema', () => {
    test('should accept valid diagnostic', () => {
      const result = validate('crearDiagnostico', {
        nombre: 'Hipertensión Arterial',
        descripcion: 'Presión arterial elevada',
        codigo: 'I10',
        activo: 1
      });

      expect(result.valid).toBe(true);
    });

    test('should reject short nombre', () => {
      const result = validate('crearDiagnostico', {
        nombre: 'AB',
        codigo: 'I10'
      });

      expect(result.valid).toBe(false);
    });

    test('should validate activo as 0 or 1', () => {
      const result = validate('crearDiagnostico', {
        nombre: 'Diagnóstico Test',
        activo: 2
      });

      expect(result.valid).toBe(false);
    });
  });

  describe('Crear Recibo Schema', () => {
    test('should accept valid receipt', () => {
      const result = validate('crearRecibo', {
        numero_recibo: 'REC-2026-001',
        paciente_nombre: 'Patient Name',
        fecha: '2026-02-27',
        servicios: [
          {
            descripcion: 'Consulta General',
            cantidad: 1,
            precio: 100.00
          }
        ],
        total: 100.00,
        estado: 'PENDIENTE'
      });

      expect(result.valid).toBe(true);
      expect(Array.isArray(result.data.servicios)).toBe(true);
    });

    test('should reject negative price', () => {
      const result = validate('crearRecibo', {
        numero_recibo: 'REC-2026-001',
        paciente_nombre: 'Patient Name',
        fecha: '2026-02-27',
        servicios: [
          {
            descripcion: 'Consulta General',
            cantidad: 1,
            precio: -100.00
          }
        ],
        total: 100.00
      });

      expect(result.valid).toBe(false);
    });

    test('should validate estado enum', () => {
      const result = validate('crearRecibo', {
        numero_recibo: 'REC-2026-001',
        paciente_nombre: 'Patient Name',
        fecha: '2026-02-27',
        servicios: [
          {
            descripcion: 'Consulta General',
            cantidad: 1,
            precio: 100.00
          }
        ],
        total: 100.00,
        estado: 'RECHAZADO'
      });

      expect(result.valid).toBe(false);
    });
  });

  describe('Filtro Turnos Schema', () => {
    test('should accept empty filter', () => {
      const result = validate('filtroTurnos', {});

      expect(result.valid).toBe(true);
    });

    test('should set default pagination', () => {
      const result = validate('filtroTurnos', {});

      expect(result.data.page).toBe(1);
      expect(result.data.limit).toBe(20);
    });

    test('should validate page as positive', () => {
      const result = validate('filtroTurnos', {
        page: 0
      });

      expect(result.valid).toBe(false);
    });

    test('should cap limit to 100', () => {
      const result = validate('filtroTurnos', {
        limit: 200
      });

      expect(result.valid).toBe(false);
    });
  });

  describe('Middleware Integration', () => {
    test('should provide validateSchema middleware', () => {
      expect(typeof validateSchema).toBe('function');
    });

    test('should provide validate function', () => {
      expect(typeof validate).toBe('function');
    });

    test('all schemas should be defined', () => {
      const schemaNames = Object.keys(schemas);
      expect(schemaNames.length).toBeGreaterThan(0);

      const expectedSchemas = [
        'login', 'cambiarContrasena', 'crearUsuario', 'actualizarUsuario',
        'crearTurno', 'actualizarTurno',
        'crearCitaElectro', 'actualizarCitaElectro',
        'crearDiagnostico', 'actualizarDiagnostico',
        'crearRecibo', 'actualizarRecibo',
        'crearDisponibilidad', 'agregarIntervaloBloqueado'
      ];

      expectedSchemas.forEach(schemaName => {
        expect(schemas).toHaveProperty(schemaName);
      });
    });
  });
});
