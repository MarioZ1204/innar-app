/**
 * Backup completo Innar: base de datos (mysqldump) + carpeta uploads (PDFs, soportes, etc.) en ZIP.
 */
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const { getUploadsRoot } = require('../config/uploads-path');
const {
  BACKUP_DIR,
  DB_NAME,
  ensureBackupDir,
  dumpDatabaseToFile,
  verifyBackup,
  getMysqldumpPath
} = require('./backup');

const MAX_FULL_BACKUPS = parseInt(process.env.MAX_FULL_BACKUPS || '12', 10);
const FULL_PREFIX = 'innar-completo-';
const MAX_FILES_ONLY_BACKUPS = parseInt(process.env.MAX_FILES_ONLY_BACKUPS || '14', 10);
const FILES_ONLY_PREFIX = 'innar-archivos-';

function fullBackupFilename(now = new Date()) {
  const ts = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `${FULL_PREFIX}${ts}.zip`;
}

function isSafeFullBackupName(name) {
  return typeof name === 'string' && /^innar-completo-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.zip$/.test(name);
}

function resolveFullBackupPath(name) {
  if (!isSafeFullBackupName(name)) return null;
  const fp = path.join(BACKUP_DIR, name);
  const resolved = path.resolve(fp);
  const root = path.resolve(BACKUP_DIR);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) return null;
  return resolved;
}

function filesOnlyBackupFilename(now = new Date()) {
  const ts = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `${FILES_ONLY_PREFIX}${ts}.zip`;
}

function isSafeFilesOnlyBackupName(name) {
  return typeof name === 'string' && /^innar-archivos-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.zip$/.test(name);
}

function resolveFilesOnlyBackupPath(name) {
  if (!isSafeFilesOnlyBackupName(name)) return null;
  const fp = path.join(BACKUP_DIR, name);
  const resolved = path.resolve(fp);
  const root = path.resolve(BACKUP_DIR);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) return null;
  return resolved;
}

function listFilesOnlyBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith(FILES_ONLY_PREFIX) && f.endsWith('.zip'))
    .map((filename) => {
      const fp = path.join(BACKUP_DIR, filename);
      const st = fs.statSync(fp);
      return {
        filename,
        size_bytes: st.size,
        size_mb: (st.size / (1024 * 1024)).toFixed(2),
        created_at: st.mtime.toISOString(),
        tipo: 'archivos'
      };
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

function cleanOldFilesOnlyBackups() {
  const files = listFilesOnlyBackups();
  if (files.length <= MAX_FILES_ONLY_BACKUPS) return;
  const toDelete = files.slice(MAX_FILES_ONLY_BACKUPS);
  for (const item of toDelete) {
    try {
      fs.unlinkSync(path.join(BACKUP_DIR, item.filename));
    } catch (_) { /* ignore */ }
  }
}

/**
 * Backup liviano SOLO de la carpeta uploads/ (sin volcado de base de datos).
 * Pensado para correr con mucha más frecuencia que el backup completo mensual,
 * de forma que nunca pase mucho tiempo sin respaldo de los PDF físicos.
 *
 * @param {{ triggeredBy?: string, label?: string }} [meta]
 * @returns {Promise<{ filename: string, filepath: string, size_bytes: number, manifest: object }>}
 */
async function createFilesOnlyBackup(meta = {}) {
  ensureBackupDir();

  const lockPath = path.join(BACKUP_DIR, '.files-only-backup.lock');
  if (fs.existsSync(lockPath)) {
    throw new Error('Ya hay un backup de archivos en curso. Espere a que termine.');
  }
  fs.writeFileSync(lockPath, String(Date.now()));

  const filename = filesOnlyBackupFilename();
  const filepath = path.join(BACKUP_DIR, filename);

  try {
    const uploadsRoot = getUploadsRoot();
    const manifest = {
      app: 'innar-app',
      tipo: 'archivos',
      created_at: new Date().toISOString(),
      triggered_by: meta.triggeredBy || 'sistema',
      label: meta.label || 'Backup de archivos',
      uploads_root: uploadsRoot,
      contents: ['uploads/', 'MANIFEST.json']
    };

    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(filepath);
      const archive = archiver('zip', { zlib: { level: 6 } });

      output.on('close', resolve);
      archive.on('error', reject);
      output.on('error', reject);

      archive.pipe(output);
      archive.append(JSON.stringify(manifest, null, 2), { name: 'MANIFEST.json' });
      zipDirectory(archive, uploadsRoot, 'uploads');
      archive.finalize();
    });

    const size_bytes = fs.statSync(filepath).size;
    if (size_bytes < 512) {
      fs.unlinkSync(filepath);
      throw new Error('El archivo ZIP resultó demasiado pequeño; posible error al comprimir.');
    }

    cleanOldFilesOnlyBackups();
    return { filename, filepath, size_bytes, manifest };
  } finally {
    try { fs.unlinkSync(lockPath); } catch (_) { /* ignore */ }
  }
}

function listFullBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith(FULL_PREFIX) && f.endsWith('.zip'))
    .map((filename) => {
      const fp = path.join(BACKUP_DIR, filename);
      const st = fs.statSync(fp);
      return {
        filename,
        size_bytes: st.size,
        size_mb: (st.size / (1024 * 1024)).toFixed(2),
        created_at: st.mtime.toISOString(),
        tipo: 'completo'
      };
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

function cleanOldFullBackups() {
  const files = listFullBackups();
  if (files.length <= MAX_FULL_BACKUPS) return;
  const toDelete = files.slice(MAX_FULL_BACKUPS);
  for (const item of toDelete) {
    try {
      fs.unlinkSync(path.join(BACKUP_DIR, item.filename));
    } catch (_) { /* ignore */ }
  }
}

function zipDirectory(archive, absDir, zipPath) {
  if (!fs.existsSync(absDir)) return;
  archive.directory(absDir, zipPath);
}

/**
 * @param {{ triggeredBy?: string, label?: string }} [meta]
 * @returns {Promise<{ filename: string, filepath: string, size_bytes: number, manifest: object }>}
 */
async function createFullBackup(meta = {}) {
  ensureBackupDir();
  const mysqldumpBin = getMysqldumpPath();
  if (process.platform === 'win32' && !fs.existsSync(mysqldumpBin)) {
    throw new Error('mysqldump no encontrado. Instale MySQL/XAMPP o defina MYSQLDUMP_PATH.');
  }

  const lockPath = path.join(BACKUP_DIR, '.full-backup.lock');
  if (fs.existsSync(lockPath)) {
    throw new Error('Ya hay un backup completo en curso. Espere a que termine.');
  }
  fs.writeFileSync(lockPath, String(Date.now()));

  const filename = fullBackupFilename();
  const filepath = path.join(BACKUP_DIR, filename);
  const tmpSql = path.join(BACKUP_DIR, `.tmp-${Date.now()}-db.sql`);

  try {
    await dumpDatabaseToFile(tmpSql);
    const v = verifyBackup(tmpSql);
    if (!v.ok) {
      throw new Error(`Backup SQL inválido: ${v.error}`);
    }

    const uploadsRoot = getUploadsRoot();
    const manifest = {
      app: 'innar-app',
      tipo: 'completo',
      created_at: new Date().toISOString(),
      triggered_by: meta.triggeredBy || 'sistema',
      label: meta.label || 'Backup completo',
      db_name: DB_NAME,
      uploads_root: uploadsRoot,
      sql_tables: v.tables,
      sql_has_data: v.hasData,
      contents: ['database.sql', 'uploads/', 'MANIFEST.json', 'LEEME-RESTAURACION.txt']
    };

    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(filepath);
      const archive = archiver('zip', { zlib: { level: 6 } });

      output.on('close', resolve);
      archive.on('error', reject);
      output.on('error', reject);

      archive.pipe(output);
      archive.file(tmpSql, { name: 'database.sql' });
      archive.append(JSON.stringify(manifest, null, 2), { name: 'MANIFEST.json' });
      archive.append(
        [
          'RESTAURACION BACKUP COMPLETO INNAR',
          '================================',
          '',
          '1. Importe database.sql en MySQL (phpMyAdmin o: mysql -u USER -p DB < database.sql)',
          '2. Copie la carpeta uploads/ del ZIP a UPLOADS_DIR del servidor',
          '   (ver .env UPLOADS_DIR o por defecto public/uploads)',
          '3. Reinicie el proceso Node',
          '',
          `Generado: ${manifest.created_at}`,
          `Base de datos: ${DB_NAME}`
        ].join('\n'),
        { name: 'LEEME-RESTAURACION.txt' }
      );
      zipDirectory(archive, uploadsRoot, 'uploads');
      archive.finalize();
    });

    const size_bytes = fs.statSync(filepath).size;
    if (size_bytes < 2048) {
      fs.unlinkSync(filepath);
      throw new Error('El archivo ZIP resultó demasiado pequeño; posible error al comprimir.');
    }

    cleanOldFullBackups();
    return { filename, filepath, size_bytes, manifest };
  } finally {
    try { fs.unlinkSync(tmpSql); } catch (_) { /* ignore */ }
    try { fs.unlinkSync(lockPath); } catch (_) { /* ignore */ }
  }
}

module.exports = {
  MAX_FULL_BACKUPS,
  FULL_PREFIX,
  isSafeFullBackupName,
  resolveFullBackupPath,
  listFullBackups,
  createFullBackup,
  cleanOldFullBackups,
  MAX_FILES_ONLY_BACKUPS,
  FILES_ONLY_PREFIX,
  isSafeFilesOnlyBackupName,
  resolveFilesOnlyBackupPath,
  listFilesOnlyBackups,
  createFilesOnlyBackup,
  cleanOldFilesOnlyBackups
};
