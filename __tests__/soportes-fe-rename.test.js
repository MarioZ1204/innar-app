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
const { aplicarRenombradoPorFev, resolveSourceFileForRename, buildUniqueTargetPathForRename, etiquetasCompatiblesParaRenombrado, renameDirectoryIfExists } = require('../utils/soportes-fe-rename');

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

  test('prefiere el archivo asociado al registro sobre otro archivo genérico en la carpeta destino', () => {
    const oldDir = path.join(tempRoot, 'PEREZ_JUAN');
    const newDir = path.join(tempRoot, 'FE14726');
    fs.mkdirSync(oldDir, { recursive: true });
    fs.mkdirSync(newDir, { recursive: true });

    const sourcePath = path.join(oldDir, 'OPF_901164565_PEREZ_JUAN.pdf');
    const otherPath = path.join(newDir, 'OPF_901164565_FE14726.pdf');
    fs.writeFileSync(sourcePath, 'source');
    fs.writeFileSync(otherPath, 'other');

    const resolved = resolveSourceFileForRename(
      {
        nombre_archivo: 'OPF_901164565_PEREZ_JUAN.pdf',
        ruta_relativa: 'soportes/armado/PEREZ_JUAN/OPF_901164565_PEREZ_JUAN.pdf',
        tipo: 'OPF'
      },
      oldDir,
      newDir
    );

    expect(resolved?.fullPath).toBe(sourcePath);
  });

  test('genera un nombre alternativo cuando el archivo canónico ya está ocupado por otro expediente', () => {
    const newDir = path.join(tempRoot, 'FE14726');
    fs.mkdirSync(newDir, { recursive: true });
    fs.writeFileSync(path.join(newDir, 'OPF_901164565_FE14726.pdf'), 'ocuppied');

    const targetPath = buildUniqueTargetPathForRename(newDir, 'OPF_901164565_FE14726.pdf', path.join(newDir, 'OPF_901164565_PEREZ_JUAN.pdf'), 42);

    expect(path.basename(targetPath)).toBe('OPF_901164565_FE14726_42.pdf');
  });

  test('no reutiliza el mismo archivo físico para más de un soporte ya asignado', () => {
    const oldDir = path.join(tempRoot, 'PEREZ_JUAN');
    const newDir = path.join(tempRoot, 'FE14726');
    fs.mkdirSync(oldDir, { recursive: true });
    fs.mkdirSync(newDir, { recursive: true });

    const sourcePath = path.join(oldDir, 'OPF_901164565_PEREZ_JUAN.pdf');
    fs.writeFileSync(sourcePath, 'exp1');

    const first = resolveSourceFileForRename(
      {
        nombre_archivo: 'OPF_901164565_PEREZ_JUAN.pdf',
        ruta_relativa: 'soportes/armado/PEREZ_JUAN/OPF_901164565_PEREZ_JUAN.pdf',
        tipo: 'OPF'
      },
      oldDir,
      newDir,
      { usedPaths: new Set() }
    );

    const second = resolveSourceFileForRename(
      {
        nombre_archivo: 'CRC_901164565_PEREZ_JUAN.pdf',
        ruta_relativa: 'soportes/armado/PEREZ_JUAN/CRC_901164565_PEREZ_JUAN.pdf',
        tipo: 'CRC'
      },
      oldDir,
      newDir,
      { usedPaths: new Set([first.fullPath]) }
    );

    expect(first?.fullPath).toBe(sourcePath);
    expect(second).toBeNull();
  });

  test('rechaza un archivo con etiqueta FE distinta al renombrar', () => {
    const isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'soportes-fe-rename-reject-'));
    const oldDir = path.join(isolatedRoot, 'GARCIA_ANA');
    fs.mkdirSync(oldDir, { recursive: true });
    fs.writeFileSync(path.join(oldDir, 'OPF_901164565_FE15448.pdf'), 'wrong-fe');

    const resolved = resolveSourceFileForRename(
      {
        nombre_archivo: 'OPF_901164565_GARCIA_ANA.pdf',
        tipo: 'OPF'
      },
      oldDir,
      path.join(isolatedRoot, 'FE16300')
    );

    expect(resolved).toBeNull();
    fs.rmSync(isolatedRoot, { recursive: true, force: true });
  });

  test('no fusiona carpetas cuando el destino FE ya contiene archivos', () => {
    const oldDir = path.join(tempRoot, 'PEREZ_JUAN');
    const newDir = path.join(tempRoot, 'FE16300');
    fs.mkdirSync(oldDir, { recursive: true });
    fs.mkdirSync(newDir, { recursive: true });
    fs.writeFileSync(path.join(oldDir, 'OPF_901164565_PEREZ_JUAN.pdf'), 'paciente');
    fs.writeFileSync(path.join(newDir, 'OPF_901164565_FE16300.pdf'), 'otro');

    const result = renameDirectoryIfExists(oldDir, newDir);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/destino ya existe/);
    expect(fs.existsSync(path.join(oldDir, 'OPF_901164565_PEREZ_JUAN.pdf'))).toBe(true);
  });

  test('encuentra archivos en la carpeta destino tras renombrar el directorio', () => {
    const oldDir = path.join(tempRoot, 'PEREZ_JUAN');
    const newDir = path.join(tempRoot, 'FE14726');
    fs.mkdirSync(oldDir, { recursive: true });
    const sourcePath = path.join(oldDir, 'OPF_901164565_PEREZ_JUAN.pdf');
    fs.writeFileSync(sourcePath, 'source');
    renameDirectoryIfExists(oldDir, newDir);

    const resolved = resolveSourceFileForRename(
      {
        nombre_archivo: 'OPF_901164565_PEREZ_JUAN.pdf',
        tipo: 'OPF'
      },
      oldDir,
      newDir
    );

    expect(resolved?.fullPath).toBe(path.join(newDir, 'OPF_901164565_PEREZ_JUAN.pdf'));
  });

  test('no copia la factura FEV como OPF al renombrar por FEV', async () => {
    const isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'soportes-fe-rename-fev-'));
    getArmadoFeDirFromContext.mockImplementation((ctx, codigo) => {
      const abs = path.join(isolatedRoot, codigo);
      return { abs, rel: `soportes/armado/${codigo}` };
    });

    const oldDir = path.join(isolatedRoot, 'PEREZ_JUAN');
    fs.mkdirSync(oldDir, { recursive: true });
    fs.writeFileSync(path.join(oldDir, 'OPF_901164565_PEREZ_JUAN.pdf'), 'contenido-opf');
    fs.writeFileSync(path.join(oldDir, 'FEV_901164565_FE14726.pdf'), 'contenido-fev');

    jest.clearAllMocks();
    db.query.mockResolvedValueOnce([{ id: 1, codigo: 'PEREZ_JUAN', numero_factura: 0, dia_id: 10, contenedor_tipo: 'soportes', paciente_nombre: 'Juan Pérez' }]);
    db.query.mockResolvedValueOnce([{ id: 1, codigo: 'PEREZ_JUAN', numero_factura: 0, dia_id: 10, contenedor_tipo: 'soportes', paciente_nombre: 'Juan Pérez' }]);
    db.query.mockResolvedValueOnce([]);
    db.query.mockResolvedValueOnce([
      { id: 11, tipo: 'OPF', nombre_archivo: 'OPF_901164565_PEREZ_JUAN.pdf' },
      { id: 12, tipo: 'FEV', nombre_archivo: 'FEV_901164565_FE14726.pdf' }
    ]);
    db.execute.mockResolvedValue({});

    await aplicarRenombradoPorFev(1, 14726);

    const opfPath = path.join(isolatedRoot, 'FE14726', 'OPF_901164565_FE14726.pdf');
    expect(fs.existsSync(opfPath)).toBe(true);
    expect(fs.readFileSync(opfPath, 'utf8')).toBe('contenido-opf');
    fs.rmSync(isolatedRoot, { recursive: true, force: true });
  });

  test('etiquetasCompatiblesParaRenombrado bloquea cruce entre facturas distintas', () => {
    expect(etiquetasCompatiblesParaRenombrado('OPF_901164565_PEREZ_JUAN.pdf', 'OPF_901164565_PEREZ_JUAN.pdf')).toBe(true);
    expect(etiquetasCompatiblesParaRenombrado('OPF_901164565_PEREZ_JUAN.pdf', 'OPF_901164565_FE16300.pdf')).toBe(false);
    expect(etiquetasCompatiblesParaRenombrado('OPF_901164565_FE16300.pdf', 'OPF_901164565_FE15448.pdf')).toBe(false);
    expect(etiquetasCompatiblesParaRenombrado('OPF_901164565_FE16300.pdf', 'OPF_901164565_PEREZ_JUAN.pdf')).toBe(true);
  });

  test('renombra archivos cuando la BD ya tiene etiqueta FE pero el disco conserva el nombre del paciente', async () => {
    const isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'soportes-fe-rename-fe-db-'));
    getArmadoFeDirFromContext.mockImplementation((ctx, codigo) => {
      const abs = path.join(isolatedRoot, codigo);
      return { abs, rel: `soportes/armado/${codigo}` };
    });

    const oldDir = path.join(isolatedRoot, 'PEREZ_JUAN');
    fs.mkdirSync(oldDir, { recursive: true });
    fs.writeFileSync(path.join(oldDir, 'OPF_901164565_PEREZ_JUAN.pdf'), 'opf');
    fs.writeFileSync(path.join(oldDir, 'FEV_901164565_FE14726.pdf'), 'fev');

    jest.clearAllMocks();
    db.query.mockResolvedValueOnce([{ id: 1, codigo: 'PEREZ_JUAN', numero_factura: 0, dia_id: 10, contenedor_tipo: 'soportes', paciente_nombre: 'Juan Pérez' }]);
    db.query.mockResolvedValueOnce([{ id: 1, codigo: 'PEREZ_JUAN', numero_factura: 0, dia_id: 10, contenedor_tipo: 'soportes', paciente_nombre: 'Juan Pérez' }]);
    db.query.mockResolvedValueOnce([]);
    db.query.mockResolvedValueOnce([
      { id: 11, tipo: 'OPF', nombre_archivo: 'OPF_901164565_FE14726.pdf', ruta_relativa: 'soportes/armado/PEREZ_JUAN/OPF_901164565_FE14726.pdf' },
      { id: 12, tipo: 'FEV', nombre_archivo: 'FEV_901164565_FE14726.pdf', ruta_relativa: 'soportes/armado/PEREZ_JUAN/FEV_901164565_FE14726.pdf' }
    ]);
    db.execute.mockResolvedValue({});

    await aplicarRenombradoPorFev(1, 14726);

    expect(fs.existsSync(path.join(isolatedRoot, 'FE14726', 'OPF_901164565_FE14726.pdf'))).toBe(true);
    fs.rmSync(isolatedRoot, { recursive: true, force: true });
  });
});
