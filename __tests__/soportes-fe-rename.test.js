process.env.SOPORTES_NIT_OBLIGADO = '901164565';

jest.mock('../utils/db-mysql', () => ({
  query: jest.fn(),
  execute: jest.fn()
}));

jest.mock('../utils/soportes-storage', () => ({
  getArmadoFeDirFromContext: jest.fn()
}));

jest.mock('../utils/soportes-pacientes-parse', () => ({
  parseLineaPaciente: jest.fn(),
  esExpedientePendienteFactura: jest.fn(() => true)
}));

jest.mock('../utils/soportes-exp-archivo', () => ({
  loadArchivoExpedienteSlot: jest.fn(),
  eliminarArchivoExpedienteSlot: jest.fn(),
  repararArchivosExpediente: jest.fn()
}));

jest.mock('../utils/soportes-rips-carpetas-sync', () => ({
  syncRipsCarpetasDia: jest.fn()
}));

const path = require('path');
const os = require('os');
const fs = require('fs');
const db = require('../utils/db-mysql');
const { getArmadoFeDirFromContext } = require('../utils/soportes-storage');
const { repararArchivosExpediente } = require('../utils/soportes-exp-archivo');
const { aplicarRenombradoPorFev } = require('../utils/soportes-fe-rename');

describe('aplicarRenombradoPorFev', () => {
  let tempRoot;

  beforeEach(() => {
    jest.clearAllMocks();
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'soportes-fe-rename-'));

    getArmadoFeDirFromContext.mockImplementation((ctx, codigo) => {
      const abs = path.join(tempRoot, codigo);
      return { abs, rel: `soportes/armado/${codigo}` };
    });

    const oldDir = path.join(tempRoot, 'PEREZ_JUAN');
    const newDir = path.join(tempRoot, 'FE14726');
    fs.mkdirSync(oldDir, { recursive: true });
    fs.mkdirSync(newDir, { recursive: true });
    fs.writeFileSync(path.join(oldDir, 'OPF_901164565_PEREZ_JUAN.pdf'), 'opf');
    fs.writeFileSync(path.join(oldDir, 'FEV_901164565_PEREZ_JUAN.pdf'), 'fev');

    db.query.mockResolvedValueOnce([{ id: 1, codigo: 'PEREZ_JUAN', numero_factura: 0, dia_id: 10, contenedor_tipo: 'soportes', paciente_nombre: 'Juan Pérez' }]);
    db.query.mockResolvedValueOnce([{ id: 1, codigo: 'PEREZ_JUAN', numero_factura: 0, dia_id: 10, contenedor_tipo: 'soportes', paciente_nombre: 'Juan Pérez' }]);
    db.query.mockResolvedValueOnce([]);
    db.query.mockResolvedValueOnce([
      { id: 11, tipo: 'OPF', nombre_archivo: 'OPF_901164565_PEREZ_JUAN.pdf' },
      { id: 12, tipo: 'FEV', nombre_archivo: 'FEV_901164565_PEREZ_JUAN.pdf' }
    ]);
    db.execute.mockResolvedValue({});
    repararArchivosExpediente.mockResolvedValue([]);
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('renombra los archivos de soporte a la etiqueta FE al vincular la factura', async () => {
    await aplicarRenombradoPorFev(1, 14726);

    const newDir = path.join(tempRoot, 'FE14726');
    expect(fs.existsSync(path.join(newDir, 'OPF_901164565_FE14726.pdf'))).toBe(true);
    expect(fs.existsSync(path.join(newDir, 'FEV_901164565_FE14726.pdf'))).toBe(true);
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE sop_exp_archivos SET nombre_archivo = ?, ruta_relativa = ? WHERE id = ?'),
      ['OPF_901164565_FE14726.pdf', expect.stringContaining('soportes/armado/FE14726/OPF_901164565_FE14726.pdf'), 11]
    );
  });
});
