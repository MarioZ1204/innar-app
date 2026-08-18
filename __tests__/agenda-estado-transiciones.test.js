const {
  evaluarTransicionElectro,
  requiereFichaElectroParaTransicion,
  validarTransicionEstadoTurno
} = require('../utils/agenda-estado-transiciones');

describe('evaluarTransicionElectro', () => {
  test('rechaza Programado → Completado (salto de flujo)', () => {
    const r = evaluarTransicionElectro('Programado', 'Completado');
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
  });

  test('permite Programado → En Sala (manual)', () => {
    const r = evaluarTransicionElectro('Programado', 'En Sala');
    expect(r).toMatchObject({ ok: true, tipo: 'manual' });
  });

  test('permite Programado → En Estudio (inicio, debe ir por la ficha)', () => {
    const r = evaluarTransicionElectro('Programado', 'En Estudio');
    expect(r).toMatchObject({ ok: true, tipo: 'inicio' });
    expect(requiereFichaElectroParaTransicion(r.tipo)).toBe(true);
  });

  test('solo superadmin puede reabrir Completado → En Estudio', () => {
    expect(evaluarTransicionElectro('Completado', 'En Estudio', { rol: 'electro' }).ok).toBe(false);
    expect(evaluarTransicionElectro('Completado', 'En Estudio', { rol: 'superadmin' })).toMatchObject({
      ok: true,
      tipo: 'reabrir'
    });
  });
});

describe('validarTransicionEstadoTurno', () => {
  test('no permite EN_ATENCION desde PENDIENTE', () => {
    const r = validarTransicionEstadoTurno('PENDIENTE', 'EN_ATENCION');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/EN_SALA/);
  });

  test('permite EN_ATENCION desde EN_SALA', () => {
    expect(validarTransicionEstadoTurno('EN_SALA', 'EN_ATENCION').ok).toBe(true);
  });

  test('no permite ATENDIDO saltándose EN_ATENCION', () => {
    expect(validarTransicionEstadoTurno('PENDIENTE', 'ATENDIDO').ok).toBe(false);
    expect(validarTransicionEstadoTurno('EN_SALA', 'ATENDIDO').ok).toBe(false);
    expect(validarTransicionEstadoTurno('EN_ATENCION', 'ATENDIDO').ok).toBe(true);
  });
});
