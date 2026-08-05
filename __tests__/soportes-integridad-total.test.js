const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../utils/db-mysql', () => ({
  query: jest.fn(),
  execute: jest.fn()
}));

const db = require('../utils/db-mysql');

describe('integridad total de Soportes', () => {
  let uploadsDir;

  beforeEach(() => {
    jest.clearAllMocks();
    uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soportes-integridad-'));
    process.env.UPLOADS_DIR = uploadsDir;
  });

  afterEach(() => {
    fs.rmSync(uploadsDir, { recursive: true, force: true });
    delete process.env.UPLOADS_DIR;
  });

  test('las rutas nuevas se guardan relativas a UPLOADS_DIR/soportes', () => {
    const storage = require('../utils/soportes-storage');
    const file = path.join(uploadsDir, 'soportes', 'armado', '2026-08', 'Anexo FIDU', 'anexo.xlsx');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'excel');

    expect(storage.relativeToSoportes(file)).toBe('armado/2026-08/Anexo FIDU/anexo.xlsx');
    expect(storage.resolveStoragePath('soportes/armado/2026-08/Anexo FIDU/anexo.xlsx')).toBe(file);
  });

  test('audita registros faltantes, huérfanos, rutas legacy y journals', async () => {
    const root = path.join(uploadsDir, 'soportes');
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'huerfano.txt'), 'sin vínculo');
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('FROM sop_exp_archivos')) {
        return [{
          id: 1,
          expediente_id: 7,
          tipo: 'OPF',
          nombre_archivo: 'OPF_901_FE700.pdf',
          ruta_relativa: 'uploads/soportes/no-existe.pdf',
          origen_tabla: 'soportes'
        }];
      }
      if (sql.includes('FROM sop_rips_archivos')) return [];
      if (sql.includes('SHOW COLUMNS')) return [{ Field: 'id' }, { Field: 'codigo' }, { Field: 'numero_factura' }];
      if (sql.includes('FROM sop_expedientes e')) return [{ id: 7, codigo: 'FE700', numero_factura: 700 }];
      if (sql.includes('FROM sop_fs_journal')) return [{ id: 9, estado: 'preparado' }];
      return [];
    });
    const { auditarIntegridadSoportes } = require('../utils/soportes-integrity-audit');

    const report = await auditarIntegridadSoportes();

    expect(report.resumen).toMatchObject({
      registros_sin_archivo: 1,
      archivos_huerfanos: 1,
      journals_incompletos: 1
    });
  });

  test('el deep-link de Anexo abre el archivo solicitado en una pestaña nueva', () => {
    const soportesJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'soportes.js'), 'utf8');
    const appJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
    const anexoJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'anexo-fidu.js'), 'utf8');

    expect(soportesJs).toContain("url.searchParams.set('module', 'anexo-fidu')");
    expect(soportesJs).toContain("window.open(url.toString(), '_blank'");
    expect(appJs).toContain("get('module')");
    expect(anexoJs).toContain("get('archivo_id')");
    expect(anexoJs).toContain('await abrirArchivoAfidu(deepArchivoId)');
  });
});
