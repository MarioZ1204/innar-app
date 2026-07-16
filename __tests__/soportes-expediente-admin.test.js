jest.mock('../utils/db-mysql', () => ({
  query: jest.fn(),
  execute: jest.fn()
}));

jest.mock('../utils/soportes-fe-rename', () => ({
  findExpedientesMismoCodigo: jest.fn(),
  aplicarRenombradoPorFev: jest.fn(),
  revertirRenombradoPorFev: jest.fn()
}));

jest.mock('../utils/soportes-storage', () => ({
  getArmadoFeDirFromContext: jest.fn((ctx, codigo) => ({
    abs: `/tmp/soportes/${codigo}`,
    rel: `soportes/armado/${codigo}`
  }))
}));

const db = require('../utils/db-mysql');
const { findExpedientesMismoCodigo, aplicarRenombradoPorFev } = require('../utils/soportes-fe-rename');
const { actualizarExpediente } = require('../utils/soportes-expediente-admin');

describe('actualizarExpediente — vincular FE', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.execute.mockResolvedValue({});
  });

  test('carpeta pendiente: vincula número FE y renombra archivos', async () => {
    db.query
      .mockResolvedValueOnce([{
        id: 1,
        codigo: 'PEREZ_JUAN',
        numero_factura: 0,
        dia_id: 10,
        contenedor_id: 5,
        paciente_nombre: 'Juan Pérez'
      }])
      .mockResolvedValueOnce([{
        id: 1,
        codigo: 'FE14726',
        numero_factura: 14726,
        dia_id: 10,
        contenedor_id: 5,
        paciente_nombre: 'Juan Pérez'
      }]);

    aplicarRenombradoPorFev.mockResolvedValueOnce({
      ok: true,
      codigo: 'FE14726',
      numero_factura: 14726
    });

    const result = await actualizarExpediente(1, {
      paciente_linea: 'Juan Pérez',
      numero_factura: 14726
    });

    expect(aplicarRenombradoPorFev).toHaveBeenCalledWith(1, 14726);
    expect(result.ok).toBe(true);
    expect(result.renombrado?.codigo).toBe('FE14726');
  });

  test('carpeta pendiente sin FE: solo actualiza notas sin renombrar', async () => {
    db.query.mockResolvedValueOnce([{
      id: 1,
      codigo: 'PEREZ_JUAN',
      numero_factura: 0,
      dia_id: 10,
      contenedor_id: 5,
      paciente_nombre: 'Juan Pérez'
    }]);

    const result = await actualizarExpediente(1, { notas: 'Observación' });

    expect(aplicarRenombradoPorFev).not.toHaveBeenCalled();
    expect(findExpedientesMismoCodigo).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('notas = COALESCE'),
      expect.any(Array)
    );
  });

  test('carpeta ya facturada: corrige número FE', async () => {
    db.query
      .mockResolvedValueOnce([{
        id: 1,
        codigo: 'FE14726',
        numero_factura: 14726,
        dia_id: 10,
        contenedor_id: 5,
        paciente_nombre: 'Juan Pérez'
      }])
      .mockResolvedValueOnce([{
        id: 1,
        codigo: 'FE16300',
        numero_factura: 16300,
        dia_id: 10,
        contenedor_id: 5,
        paciente_nombre: 'Juan Pérez'
      }]);

    aplicarRenombradoPorFev.mockResolvedValueOnce({
      ok: true,
      codigo: 'FE16300',
      numero_factura: 16300
    });

    const result = await actualizarExpediente(1, {
      paciente_linea: 'Pérez, Juan',
      numero_factura: 16300
    });

    expect(aplicarRenombradoPorFev).toHaveBeenCalledWith(1, 16300);
    expect(result.ok).toBe(true);
    expect(result.renombrado?.codigo).toBe('FE16300');
  });
});
