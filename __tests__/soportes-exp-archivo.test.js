jest.mock('../utils/db-mysql', () => ({
  query: jest.fn(),
  execute: jest.fn()
}));

const path = require('path');
const fs = require('fs');
const os = require('os');
const db = require('../utils/db-mysql');
const {
  normalizarTipoArchivo,
  SOPORTES_SLOT_TIPOS,
  resolveArchivoAbsoluto,
  repararArchivoExpedienteRow
} = require('../utils/soportes-exp-archivo');

describe('soportes-exp-archivo', () => {
  let tempRoot;

  beforeEach(() => {
    jest.clearAllMocks();
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'soportes-exp-archivo-'));
    process.env.UPLOADS_DIR = tempRoot;
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    delete process.env.UPLOADS_DIR;
  });

  test('normaliza tipos SOPORTES y RIPS', () => {
    expect(normalizarTipoArchivo('crc').tipo).toBe('CRC');
    expect(normalizarTipoArchivo('RIPS_XML').slotDb).toBe('xml');
    expect(normalizarTipoArchivo('FOO')).toBeNull();
  });

  test('lista slots soportes', () => {
    expect(SOPORTES_SLOT_TIPOS).toContain('OPF');
    expect(SOPORTES_SLOT_TIPOS).toContain('CRC');
  });

  test('encuentra el archivo por tipo y prefijo cuando la ruta guardada cambió de nombre', () => {
    const fileDir = path.join(tempRoot, 'soportes', 'armado', '2026', '03', 'A_FACTURAR', 'SOPORTES', 'FE15925');
    fs.mkdirSync(fileDir, { recursive: true });
    const filePath = path.join(fileDir, 'OPF_901164565_PEREZ_JUAN.pdf');
    fs.writeFileSync(filePath, 'pdf');

    const resolved = resolveArchivoAbsoluto({
      ruta_relativa: 'soportes/armado/2026/03/A_FACTURAR/SOPORTES/FE15925/OPF_901164565_FE15925.pdf',
      nombre_archivo: 'OPF_901164565_FE15925.pdf',
      tipo: 'OPF'
    });

    expect(resolved).toBe(filePath);
  });

  test('repara la ruta y nombre del archivo cuando el registro quedó desfasado', async () => {
    const fileDir = path.join(tempRoot, 'soportes', 'armado', '2026', '03', 'A_FACTURAR', 'SOPORTES', 'FE15925');
    fs.mkdirSync(fileDir, { recursive: true });
    const filePath = path.join(fileDir, 'CRC_901164565_PEREZ_JUAN.pdf');
    fs.writeFileSync(filePath, 'pdf');

    db.execute.mockResolvedValue({ affectedRows: 1 });

    const result = await repararArchivoExpedienteRow({
      id: 42,
      expediente_id: 1,
      tipo: 'CRC',
      nombre_archivo: 'CRC_901164565_FE15925.pdf',
      ruta_relativa: 'soportes/armado/2026/03/A_FACTURAR/SOPORTES/FE15925/CRC_901164565_FE15925.pdf'
    });

    expect(result.repaired).toBe(true);
    expect(db.execute).toHaveBeenCalled();
  });
});
