const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

describe('soportes-backup-restore', () => {
  let tmpRoot;
  let backupDir;
  let uploadsDir;
  let zipName;

  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'innar-restore-test-'));
    backupDir = path.join(tmpRoot, 'backups');
    uploadsDir = path.join(tmpRoot, 'uploads');
    fs.mkdirSync(backupDir, { recursive: true });
    fs.mkdirSync(uploadsDir, { recursive: true });

    process.env.BACKUP_DIR = backupDir;
    process.env.UPLOADS_DIR = uploadsDir;
    jest.resetModules();

    zipName = 'innar-completo-2026-01-01T00-00-00.zip';
    const zipPath = path.join(backupDir, zipName);

    // Genera el ZIP de prueba en un proceso Node aparte: archiver usa readable-stream
    // internamente y choca con el entorno de Jest si se ejecuta en el mismo proceso.
    const builderScript = `
      const fs = require('fs');
      const archiver = require('archiver');
      const output = fs.createWriteStream(${JSON.stringify(zipPath)});
      const archive = archiver('zip', { zlib: { level: 6 } });
      output.on('close', () => process.exit(0));
      archive.on('error', (e) => { console.error(e); process.exit(1); });
      archive.pipe(output);
      archive.append('contenido-existente-backup', { name: 'uploads/soportes/carpeta1/existente.pdf' });
      archive.append('contenido-faltante-backup', { name: 'uploads/soportes/carpeta1/faltante.pdf' });
      archive.append('otro-modulo-no-soportes', { name: 'uploads/otro-modulo/archivo.pdf' });
      archive.finalize();
    `;
    execFileSync(process.execPath, ['-e', builderScript], { cwd: path.resolve(__dirname, '..') });

    // Simula que "existente.pdf" ya está en disco con contenido distinto (no debe sobrescribirse por defecto).
    const existenteDir = path.join(uploadsDir, 'soportes', 'carpeta1');
    fs.mkdirSync(existenteDir, { recursive: true });
    fs.writeFileSync(path.join(existenteDir, 'existente.pdf'), 'contenido-actual-en-disco');
  });

  afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.BACKUP_DIR;
    delete process.env.UPLOADS_DIR;
  });

  test('restaura solo los archivos faltantes, sin sobreescribir los existentes', () => {
    const { restoreMissingUploadsFromBackup } = require('../utils/soportes-backup-restore');
    return restoreMissingUploadsFromBackup({ backupFilename: zipName }).then((result) => {
      expect(result.ok).toBe(true);
      expect(result.restaurados.sort()).toEqual([
        'otro-modulo/archivo.pdf',
        'soportes/carpeta1/faltante.pdf'
      ].sort());
      expect(result.omitidos).toBe(1);

      const faltantePath = path.join(uploadsDir, 'soportes', 'carpeta1', 'faltante.pdf');
      expect(fs.existsSync(faltantePath)).toBe(true);
      expect(fs.readFileSync(faltantePath, 'utf8')).toBe('contenido-faltante-backup');

      const existentePath = path.join(uploadsDir, 'soportes', 'carpeta1', 'existente.pdf');
      expect(fs.readFileSync(existentePath, 'utf8')).toBe('contenido-actual-en-disco');
    });
  });

  test('con onlyPrefixes restringe la restauración a esa carpeta', () => {
    fs.rmSync(path.join(uploadsDir, 'otro-modulo'), { recursive: true, force: true });
    fs.rmSync(path.join(uploadsDir, 'soportes', 'carpeta1', 'faltante.pdf'), { force: true });

    const { restoreMissingUploadsFromBackup } = require('../utils/soportes-backup-restore');
    return restoreMissingUploadsFromBackup({ backupFilename: zipName, onlyPrefixes: ['soportes/'] }).then((result) => {
      expect(result.restaurados).toEqual(['soportes/carpeta1/faltante.pdf']);
      expect(fs.existsSync(path.join(uploadsDir, 'otro-modulo', 'archivo.pdf'))).toBe(false);
    });
  });
});
