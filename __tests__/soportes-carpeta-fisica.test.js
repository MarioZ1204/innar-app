jest.mock('../utils/db-mysql', () => ({
  query: jest.fn(),
  execute: jest.fn()
}));

jest.mock('../utils/soportes-storage', () => {
  const actual = jest.requireActual('../utils/soportes-storage');
  return {
    ...actual,
    getArmadoFeDirFromContext: jest.fn()
  };
});

jest.mock('../utils/soportes-pacientes-parse', () => ({
  parseLineaPaciente: jest.fn((s) => ({ codigo: 'PEREZ_JUAN', paciente_nombre: s })),
  esExpedientePendienteFactura: jest.fn(() => false)
}));

jest.mock('../utils/soportes-exp-archivo', () => {
  const actual = jest.requireActual('../utils/soportes-exp-archivo');
  return {
    ...actual,
    loadArchivoExpedienteSlot: jest.fn(() => Promise.resolve({ ok: false })),
    eliminarArchivoExpedienteSlot: jest.fn(),
    repararArchivosExpediente: jest.fn(() => Promise.resolve([]))
  };
});

jest.mock('../utils/soportes-rips-carpetas-sync', () => ({
  syncRipsCarpetasDia: jest.fn()
}));

const fs = require('fs');
const db = require('../utils/db-mysql');
const { getArmadoFeDirFromContext } = require('../utils/soportes-storage');
const {
  calcularCarpetaFisica,
  carpetaFisicaExpediente
} = require('../utils/soportes-armado-structure');
const { aplicarRenombradoPorFev, revertirRenombradoPorFev, findExpedientesMismoCodigo } = require('../utils/soportes-fe-rename');

describe('carpeta física inmutable (evita renombrados que pierden archivos)', () => {
  test('calcularCarpetaFisica combina código vigente + ID y sanea el segmento', () => {
    expect(calcularCarpetaFisica('FE45', 482)).toBe('FE45_482');
    expect(calcularCarpetaFisica('PEREZ / JUAN', 7)).toBe('PEREZ _ JUAN_7');
    expect(calcularCarpetaFisica('', 3)).toBe('FE0_3');
  });

  test('carpetaFisicaExpediente prioriza carpeta_fisica sobre codigo (legacy)', () => {
    expect(carpetaFisicaExpediente({ carpeta_fisica: 'FE45_482', codigo: 'FE99999' })).toBe('FE45_482');
    expect(carpetaFisicaExpediente({ codigo: 'FE45' })).toBe('FE45');
    expect(carpetaFisicaExpediente({})).toBe('');
  });

  describe('aplicarRenombradoPorFev: expediente ya migrado (tiene carpeta_fisica)', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      db.query.mockReset();
      db.execute.mockReset();
      db.execute.mockResolvedValue({});
    });

    test('actualiza solo la BD y nunca toca disco', async () => {
      const hermano = {
        id: 1,
        codigo: 'PEREZ_JUAN',
        carpeta_fisica: 'PEREZ_JUAN_1',
        numero_factura: 0,
        dia_id: 10,
        contenedor_tipo: 'soportes',
        paciente_nombre: 'Juan Pérez'
      };
      // loadExpedienteContext
      db.query.mockResolvedValueOnce([hermano]);
      // findExpedientesMismoCodigo (hermanos)
      db.query.mockResolvedValueOnce([hermano]);
      // conflict check
      db.query.mockResolvedValueOnce([]);

      const result = await aplicarRenombradoPorFev(1, 14726);

      expect(result.ok).toBe(true);
      expect(result.codigo).toBe('FE14726');
      expect(result.carpeta_fisica_estable).toBe(true);
      expect(getArmadoFeDirFromContext).not.toHaveBeenCalled();
      expect(db.execute).toHaveBeenCalledWith(
        'UPDATE sop_expedientes SET codigo = ?, numero_factura = ? WHERE id = ?',
        ['FE14726', 14726, 1]
      );
    });
  });

  describe('revertirRenombradoPorFev: expediente ya migrado (tiene carpeta_fisica)', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      db.query.mockReset();
      db.execute.mockReset();
      db.execute.mockResolvedValue({});
    });

    test('actualiza solo la BD y nunca toca disco', async () => {
      const hermano = {
        id: 1,
        codigo: 'FE14726',
        carpeta_fisica: 'PEREZ_JUAN_1',
        numero_factura: 14726,
        dia_id: 10,
        contenedor_tipo: 'soportes',
        paciente_nombre: 'Juan Pérez'
      };
      db.query.mockResolvedValueOnce([hermano]);
      db.query.mockResolvedValueOnce([hermano]);
      db.query.mockResolvedValueOnce([]);

      const result = await revertirRenombradoPorFev(1, { paciente_nombre: 'Juan Pérez' });

      expect(result.ok).toBe(true);
      expect(result.carpeta_fisica_estable).toBe(true);
      expect(getArmadoFeDirFromContext).not.toHaveBeenCalled();
      expect(db.execute).toHaveBeenCalledWith(
        'UPDATE sop_expedientes SET codigo = ?, numero_factura = 0, paciente_nombre = ?, fev_externa_verificada = 0 WHERE id = ?',
        ['PEREZ_JUAN', 'Juan Pérez', 1]
      );
    });
  });
});
