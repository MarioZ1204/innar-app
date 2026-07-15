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
  repararArchivoExpedienteRow,
  repararArchivosExpediente,
  buscarRutaHistoricaArchivo
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

  test('reconoce el archivo correcto cuando el expediente usa un FE distinto al registro anterior', async () => {
    const fileDir = path.join(tempRoot, 'soportes', 'armado', '2026', '03', 'A_FACTURAR', 'SOPORTES', 'FE16300');
    fs.mkdirSync(fileDir, { recursive: true });
    const filePath = path.join(fileDir, 'OPF_901164565_FE16300.pdf');
    fs.writeFileSync(filePath, 'pdf');

    db.query.mockResolvedValueOnce([{ id: 1, codigo: 'FE16300', numero_factura: 16300 }]);
    db.execute.mockResolvedValue({ affectedRows: 1 });

    const result = await repararArchivoExpedienteRow({
      id: 43,
      expediente_id: 1,
      tipo: 'OPF',
      nombre_archivo: 'OPF_901164565_FE15448.pdf',
      ruta_relativa: 'soportes/armado/2026/03/A_FACTURAR/SOPORTES/FE15448/OPF_901164565_FE15448.pdf'
    });

    expect(result.repaired).toBe(true);
    expect(result.nombre_archivo).toBe('OPF_901164565_FE16300.pdf');
    expect(result.ruta_relativa).toContain('/FE16300/OPF_901164565_FE16300.pdf');
  });

  test('repara expedientes legacy que comparten el mismo archivo físico entre dos soportes', async () => {
    const expId = 77;
    const targetDir = path.join(tempRoot, 'soportes', 'armado', '2026', '03', 'A_FACTURAR', 'SOPORTES', 'FE14726');
    fs.mkdirSync(targetDir, { recursive: true });
    const sharedFile = path.join(targetDir, 'OPF_901164565_FE14726.pdf');
    fs.writeFileSync(sharedFile, 'shared');

    db.query.mockImplementation((sql) => {
      if (sql.includes('FROM sop_exp_archivos WHERE expediente_id = ?')) {
        return [
          { id: 1, expediente_id: expId, tipo: 'OPF', nombre_archivo: 'OPF_901164565_FE14726.pdf', ruta_relativa: 'soportes/armado/2026/03/A_FACTURAR/SOPORTES/FE14726/OPF_901164565_FE14726.pdf' },
          { id: 2, expediente_id: expId, tipo: 'CRC', nombre_archivo: 'CRC_901164565_FE14726.pdf', ruta_relativa: 'soportes/armado/2026/03/A_FACTURAR/SOPORTES/FE14726/CRC_901164565_FE14726.pdf' }
        ];
      }
      if (sql.includes('FROM sop_expedientes e')) {
        return [{ id: expId, codigo: 'FE14726', numero_factura: 14726, dia_id: 5, contenedor_tipo: 'soportes', periodo: '2026-03', nombre_display: 'Día 1', estado_facturacion: 'a_facturar' }];
      }
      return [];
    });
    db.execute.mockResolvedValue({ affectedRows: 1 });

    await repararArchivosExpediente(expId);

    const secondCall = db.execute.mock.calls.find((args) => String(args[0]).includes('UPDATE sop_exp_archivos') && args[1]?.[2] === 2);
    expect(secondCall).toBeTruthy();
    expect(secondCall[1][0]).toBe('CRC_901164565_FE14726_77.pdf');
    expect(fs.existsSync(path.join(targetDir, 'CRC_901164565_FE14726_77.pdf'))).toBe(true);
  });

  test('recupera la ruta histórica cuando el archivo actual ya no está en la ruta de FE', () => {
    const legacyDir = path.join(tempRoot, 'soportes', 'armado', '2026', '03', 'A_FACTURAR', 'SOPORTES', 'PEREZ_JUAN');
    fs.mkdirSync(legacyDir, { recursive: true });
    const legacyFile = path.join(legacyDir, 'OPF_901164565_PEREZ_JUAN.pdf');
    fs.writeFileSync(legacyFile, 'legacy');

    const recovered = buscarRutaHistoricaArchivo({
      tipo: 'OPF',
      nombre_archivo: 'OPF_901164565_FE14726.pdf',
      ruta_relativa: 'soportes/armado/2026/03/A_FACTURAR/SOPORTES/FE14726/OPF_901164565_FE14726.pdf'
    }, tempRoot);

    expect(recovered).toBe(legacyFile);
  });
});
