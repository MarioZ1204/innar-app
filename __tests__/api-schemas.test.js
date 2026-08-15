// __tests__/api-schemas.test.js
// Tests para los schemas Joi "api*" alineados con la BD real.

const { schemas, validate, ROLES_VALIDOS, ESTADOS_TURNOS, ESTADOS_ELECTRO } = require('../modules/validation-schemas');

describe('Api Login Schema', () => {
  test('acepta hash SHA-512 hex de 128 chars', () => {
    const r = validate('apiLogin', {
      usuario: 'admin',
      password: 'a'.repeat(128)
    });
    expect(r.valid).toBe(true);
  });

  test('rechaza password en claro', () => {
    const r = validate('apiLogin', { usuario: 'admin', password: 'plain123' });
    expect(r.valid).toBe(false);
  });

  test('rechaza hash inválido (caracteres no hex)', () => {
    const r = validate('apiLogin', { usuario: 'admin', password: 'z'.repeat(128) });
    expect(r.valid).toBe(false);
  });
});

describe('Api Crear Usuario Schema', () => {
  test('acepta superadmin como rol válido', () => {
    const r = validate('apiCrearUsuario', {
      usuario: 'newuser1',
      nombre: 'Nombre Apellido',
      password: 'a'.repeat(128),
      rol: 'superadmin'
    });
    expect(r.valid).toBe(true);
  });

  test('acepta auxiliar_recepcion', () => {
    const r = validate('apiCrearUsuario', {
      usuario: 'aux',
      nombre: 'Aux Rep',
      password: 'b'.repeat(128),
      rol: 'auxiliar_recepcion'
    });
    expect(r.valid).toBe(true);
  });

  test('rechaza rol no listado', () => {
    const r = validate('apiCrearUsuario', {
      usuario: 'x',
      nombre: 'X X',
      password: 'a'.repeat(128),
      rol: 'rol_invalido'
    });
    expect(r.valid).toBe(false);
  });
});

describe('Api Patch Estado Turno', () => {
  test('acepta estados válidos', () => {
    for (const estado of ESTADOS_TURNOS) {
      const r = validate('apiPatchEstadoTurno', { estado });
      expect(r.valid).toBe(true);
    }
  });

  test('rechaza estado fuera de la lista', () => {
    const r = validate('apiPatchEstadoTurno', { estado: 'NUEVO' });
    expect(r.valid).toBe(false);
  });
});

describe('Api Actualizar Turno', () => {
  test('acepta hora HH:MM:SS reenviada desde MySQL', () => {
    const r = validate('apiActualizarTurno', { hora: '08:30:00' });
    expect(r.valid).toBe(true);
    expect(r.data.hora).toBe('08:30');
  });

  test('acepta fecha con timestamp reenviada desde MySQL', () => {
    const r = validate('apiActualizarTurno', { fecha: '2026-05-12T00:00:00.000Z' });
    expect(r.valid).toBe(true);
    expect(r.data.fecha).toBe('2026-05-12');
  });
});

describe('Api Crear Turno', () => {
  test('normaliza fecha/hora de formularios que reenvían datos MySQL', () => {
    const r = validate('apiCrearTurno', {
      doctor_id: 1,
      paciente_nombre: 'Paciente Prueba',
      fecha: '2026-05-12T00:00:00.000Z',
      hora: '09:15:00'
    });
    expect(r.valid).toBe(true);
    expect(r.data.fecha).toBe('2026-05-12');
    expect(r.data.hora).toBe('09:15');
  });
});

describe('Api Reprogramar Turno', () => {
  test('exige fecha y hora nuevas', () => {
    const r = validate('apiReprogramarTurno', { fecha: '2026-08-20', hora: '10:30:00' });
    expect(r.valid).toBe(true);
    expect(r.data.hora).toBe('10:30');
  });

  test('rechaza estado_original inválido', () => {
    const r = validate('apiReprogramarTurno', {
      fecha: '2026-08-20',
      hora: '10:30',
      estado_original: 'PENDIENTE'
    });
    expect(r.valid).toBe(false);
  });
});

describe('Api Patch Estado Electro', () => {
  test('acepta estados válidos de electrodiagnóstico', () => {
    for (const estado of ESTADOS_ELECTRO) {
      const r = validate('apiPatchEstadoElectro', { estado });
      expect(r.valid).toBe(true);
    }
  });

  test('rechaza estado inválido', () => {
    const r = validate('apiPatchEstadoElectro', { estado: 'Inexistente' });
    expect(r.valid).toBe(false);
  });
});

describe('Api Paciente Espera', () => {
  test('acepta prioridad ALTA/MEDIA/BAJA', () => {
    for (const prioridad of ['ALTA', 'MEDIA', 'BAJA']) {
      const r = validate('apiPacienteEspera', {
        documento: '1234567890',
        nombres: 'Juan',
        apellidos: 'Perez',
        entidad: 'PARTICULAR',
        prioridad
      });
      expect(r.valid).toBe(true);
    }
  });

  test('rechaza prioridad inválida', () => {
    const r = validate('apiPacienteEspera', {
      documento: '1234567890',
      nombres: 'Juan',
      apellidos: 'Perez',
      entidad: 'PARTICULAR',
      prioridad: 'URGENTE'
    });
    expect(r.valid).toBe(false);
  });
});

describe('Constantes exportadas', () => {
  test('ROLES_VALIDOS incluye los roles del sistema actual', () => {
    expect(ROLES_VALIDOS).toContain('superadmin');
    expect(ROLES_VALIDOS).toContain('admin_recepcion');
    expect(ROLES_VALIDOS).toContain('admin_electro');
    expect(ROLES_VALIDOS).toContain('tecnico_electro');
    expect(ROLES_VALIDOS).toContain('auxiliar_recepcion');
  });

  test('ESTADOS_ELECTRO incluye los estados del flujo actual', () => {
    expect(ESTADOS_ELECTRO).toContain('Programado');
    expect(ESTADOS_ELECTRO).toContain('En Estudio');
    expect(ESTADOS_ELECTRO).toContain('Completado');
  });

  test('schemas api* están definidos', () => {
    const expected = [
      'apiLogin', 'apiCrearUsuario', 'apiActualizarUsuario',
      'apiCrearTurno', 'apiActualizarTurno', 'apiReprogramarTurno', 'apiPatchEstadoTurno',
      'apiPatchEstadoElectro', 'apiCrearDiagnostico', 'apiPacienteEspera'
    ];
    for (const name of expected) {
      expect(schemas[name]).toBeDefined();
    }
  });
});
