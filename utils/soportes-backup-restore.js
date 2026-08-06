/**
 * Restaura archivos físicos (uploads/) que faltan en disco a partir de un backup
 * completo generado por utils/backup-full.js, sin tocar la base de datos.
 *
 * Caso de uso: al redesplegar en Hostinger (o tras una pérdida parcial de archivos),
 * se puede recuperar del último backup completo cualquier archivo de `uploads/`
 * que ya no exista en disco, sin sobreescribir los que sí existen.
 */
const fs = require('fs');
const path = require('path');
const yauzl = require('yauzl');
const { getUploadsRoot } = require('../config/uploads-path');
const { resolveFullBackupPath, isSafeFullBackupName, listFullBackups } = require('./backup-full');

const ZIP_UPLOADS_PREFIX = 'uploads/';

/**
 * Recorre el ZIP de backup y restaura en UPLOADS_DIR únicamente las entradas
 * bajo `uploads/` que no existan actualmente en disco (o que estén vacías/corruptas).
 *
 * @param {object} options
 * @param {string} options.backupFilename Nombre del ZIP en carpeta de backups (ver listFullBackups()).
 * @param {boolean} [options.overwrite=false] Si es true, sobreescribe también los archivos existentes.
 * @param {string[]} [options.onlyPrefixes] Restringe la restauración a rutas relativas que empiecen por alguno de estos prefijos (ej: ['soportes/']).
 * @returns {Promise<{ ok: boolean, restaurados: string[], omitidos: number, errores: {ruta:string, error:string}[] }>}
 */
function restoreMissingUploadsFromBackup(options = {}) {
  const { backupFilename, overwrite = false, onlyPrefixes = [] } = options;

  if (!isSafeFullBackupName(backupFilename)) {
    return Promise.reject(new Error('Nombre de backup no válido'));
  }
  const zipPath = resolveFullBackupPath(backupFilename);
  if (!zipPath || !fs.existsSync(zipPath)) {
    return Promise.reject(new Error('Backup no encontrado'));
  }

  const uploadsRoot = getUploadsRoot();
  const restaurados = [];
  const errores = [];
  let omitidos = 0;

  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err);

      zipfile.on('error', reject);
      zipfile.on('close', () => {
        resolve({ ok: true, restaurados, omitidos, errores });
      });

      zipfile.readEntry();
      zipfile.on('entry', (entry) => {
        const entryName = String(entry.fileName || '').replace(/\\/g, '/');
        if (!entryName.startsWith(ZIP_UPLOADS_PREFIX) || entryName.endsWith('/')) {
          zipfile.readEntry();
          return;
        }
        const relPath = entryName.slice(ZIP_UPLOADS_PREFIX.length);
        if (!relPath) {
          zipfile.readEntry();
          return;
        }
        if (onlyPrefixes.length && !onlyPrefixes.some((p) => relPath.startsWith(p))) {
          zipfile.readEntry();
          return;
        }

        const destPath = path.resolve(uploadsRoot, relPath);
        if (!destPath.startsWith(path.resolve(uploadsRoot) + path.sep)) {
          // Evita path traversal desde un ZIP manipulado.
          omitidos += 1;
          zipfile.readEntry();
          return;
        }

        const alreadyExists = fs.existsSync(destPath) && fs.statSync(destPath).size > 0;
        if (alreadyExists && !overwrite) {
          omitidos += 1;
          zipfile.readEntry();
          return;
        }

        zipfile.openReadStream(entry, (streamErr, readStream) => {
          if (streamErr) {
            errores.push({ ruta: relPath, error: streamErr.message });
            zipfile.readEntry();
            return;
          }
          try {
            fs.mkdirSync(path.dirname(destPath), { recursive: true });
          } catch (mkdirErr) {
            errores.push({ ruta: relPath, error: mkdirErr.message });
            zipfile.readEntry();
            return;
          }
          const tmpPath = `${destPath}.restaurando-${process.pid}`;
          const writeStream = fs.createWriteStream(tmpPath);
          readStream.on('error', (readErr) => {
            errores.push({ ruta: relPath, error: readErr.message });
            try { fs.unlinkSync(tmpPath); } catch (_) { /* ignore */ }
            zipfile.readEntry();
          });
          writeStream.on('error', (writeErr) => {
            errores.push({ ruta: relPath, error: writeErr.message });
            try { fs.unlinkSync(tmpPath); } catch (_) { /* ignore */ }
            zipfile.readEntry();
          });
          writeStream.on('close', () => {
            try {
              fs.renameSync(tmpPath, destPath);
              restaurados.push(relPath);
            } catch (renameErr) {
              errores.push({ ruta: relPath, error: renameErr.message });
            }
            zipfile.readEntry();
          });
          readStream.pipe(writeStream);
        });
      });
    });
  });
}

function latestFullBackupFilename() {
  const list = listFullBackups();
  return list.length ? list[0].filename : null;
}

module.exports = {
  restoreMissingUploadsFromBackup,
  latestFullBackupFilename
};
