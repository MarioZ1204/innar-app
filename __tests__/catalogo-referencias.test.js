'use strict';

const catalogoRefs = require('../utils/catalogo-referencias');
const { isHttpError } = require('../utils/locks-concurrencia');

function makeDb(state) {
  const api = {
    async query(sql, params = []) {
      const s = String(sql);
      if (s.includes('COUNT(*)') && s.includes('FROM turnos') && s.includes('entidad')) {
        return [{ c: state.turnosEntidad || 0 }];
      }
      if (s.includes('COUNT(*)') && s.includes('FROM citas_electro') && s.includes('entidad')) {
        return [{ c: state.citasEntidad || 0 }];
      }
      if (s.includes('COUNT(*)') && s.includes('FROM recibos')) {
        return [{ c: state.recibos || 0 }];
      }
      if (s.includes('COUNT(*)') && s.includes('doctor_cupos_entidad_dia')) {
        return [{ c: state.cupos || 0 }];
      }
      if (s.includes('COUNT(*)') && s.includes('pacientes_espera')) {
        return [{ c: state.espera || 0 }];
      }
      if (s.includes('COUNT(*)') && s.includes('FROM turnos') && s.includes('tipo_consulta')) {
        return [{ c: state.turnosTipo || 0 }];
      }
      if (s.includes('COUNT(*)') && s.includes('FROM tipos_consulta')) {
        return [{ c: state.tipos || 0 }];
      }
      if (s.includes('COUNT(*)') && s.includes('FROM usuarios')) {
        return [{ c: state.usuarios || 0 }];
      }
      if (s.includes('COUNT(*)') && s.includes('FROM citas_electro') && s.includes('estudio')) {
        return [{ c: state.citasEstudio || 0 }];
      }
      if (s.includes('COUNT(*)') && s.includes('diagnostico_id')) {
        return [{ c: state.citasDiag || 0 }];
      }
      if (s.includes('FROM entidades WHERE id')) {
        return state.entidad ? [state.entidad] : [];
      }
      if (s.includes('FROM especialidades WHERE id')) {
        return state.especialidad ? [state.especialidad] : [];
      }
      if (s.includes('FROM tipos_consulta tc')) {
        return state.tipoConsulta ? [state.tipoConsulta] : [];
      }
      if (s.includes('FROM estudio_duraciones WHERE id')) {
        return state.estudio ? [state.estudio] : [];
      }
      if (s.includes('FROM diagnosticos WHERE id')) {
        return state.diagnostico ? [state.diagnostico] : [];
      }
      return [];
    },
    async execute() {
      return { affectedRows: 1 };
    },
    async transaction(cb) {
      return cb(api);
    }
  };
  return api;
}

describe('catalogo-referencias', () => {
  test('limiteListadoGestion: catálogos alto, operativos acotados', () => {
    expect(catalogoRefs.limiteListadoGestion('especialidades')).toBe(2000);
    expect(catalogoRefs.limiteListadoGestion('especialidades', '99999')).toBe(5000);
    expect(catalogoRefs.limiteListadoGestion('citas_electro')).toBe(100);
    expect(catalogoRefs.limiteListadoGestion('turnos', '800')).toBe(500);
    expect(catalogoRefs.esTipoCatalogoGestion('entidades')).toBe(true);
    expect(catalogoRefs.esTipoCatalogoGestion('citas_electro')).toBe(false);
  });

  test('bloquea borrar entidad si hay turnos', async () => {
    const db = makeDb({
      entidad: { id: 3, nombre: 'SURA' },
      turnosEntidad: 4
    });
    await expect(catalogoRefs.assertCatalogoEliminable(db, 'entidades', 3))
      .rejects.toMatchObject({ status: 409, message: expect.stringContaining('está en uso') });
  });

  test('permite borrar entidad sin usos', async () => {
    const db = makeDb({ entidad: { id: 3, nombre: 'SURA' } });
    await expect(catalogoRefs.assertCatalogoEliminable(db, 'entidades', 3))
      .resolves.toMatchObject({ id: 3, nombre: 'SURA' });
  });

  test('bloquea especialidad si tiene tipos o usuarios', async () => {
    const db = makeDb({
      especialidad: { id: 1, nombre: 'Neurología' },
      tipos: 2,
      usuarios: 0
    });
    await expect(catalogoRefs.assertCatalogoEliminable(db, 'especialidades', 1))
      .rejects.toMatchObject({ status: 409 });
  });

  test('renombrar entidad actualiza textos y no borra citas', async () => {
    const sqls = [];
    const db = {
      async query(sql) {
        sqls.push(sql);
        if (String(sql).includes('SELECT nombre FROM entidades')) return [{ nombre: 'SURA' }];
        return [];
      },
      async execute(sql, params) {
        sqls.push(sql);
        return { affectedRows: 1, params };
      },
      async transaction(cb) { return cb(this); }
    };
    await catalogoRefs.persistirEntidadConReferencias(db, {
      id: 9,
      nombreNuevo: 'NUEVA EPS',
      camposSql: 'nombre=?',
      values: ['NUEVA EPS', 9]
    });
    const joined = sqls.join('\n');
    expect(joined).toMatch(/UPDATE turnos SET entidad/i);
    expect(joined).toMatch(/UPDATE citas_electro SET entidad/i);
    expect(joined).toMatch(/UPDATE recibos SET nombre_entidad/i);
    expect(joined).not.toMatch(/DELETE FROM turnos/i);
    expect(joined).not.toMatch(/DELETE FROM citas_electro/i);
  });

  test('isHttpError reconoce 409 de catálogo', () => {
    try {
      catalogoRefs.throwEnUso('bloqueado', { turnos: 1 });
    } catch (e) {
      expect(isHttpError(e)).toBe(true);
      expect(e.status).toBe(409);
      expect(e.body.en_uso).toBe(true);
    }
  });
});
