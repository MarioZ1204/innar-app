#!/usr/bin/env node
/**
 * Proceso hijo para tareas pesadas: backups y restauración de archivos.
 * Uso: node scripts/background-job.js <job> '<json-payload>'
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const job = String(process.argv[2] || '').trim();
const payload = (() => {
  try {
    return JSON.parse(process.argv[3] || '{}');
  } catch (_) {
    return {};
  }
})();

async function run() {
  switch (job) {
    case 'backup-sql': {
      const { createBackup } = require('../utils/backup');
      await createBackup();
      return;
    }
    case 'backup-full': {
      const { createFullBackup } = require('../utils/backup-full');
      await createFullBackup({
        triggeredBy: payload.triggeredBy || 'sistema',
        label: payload.label || 'Backup completo'
      });
      return;
    }
    case 'backup-files': {
      const { createFilesOnlyBackup } = require('../utils/backup-full');
      await createFilesOnlyBackup({
        triggeredBy: payload.triggeredBy || 'sistema',
        label: payload.label || 'Backup de archivos'
      });
      return;
    }
    case 'restore-all-uploads': {
      const { restoreMissingUploadsFromAllBackups } = require('../utils/soportes-backup-restore');
      await restoreMissingUploadsFromAllBackups({
        onlyPrefixes: Array.isArray(payload.onlyPrefixes) ? payload.onlyPrefixes : []
      });
      return;
    }
    case 'restore-one-uploads': {
      const { restoreMissingUploadsFromBackup } = require('../utils/soportes-backup-restore');
      await restoreMissingUploadsFromBackup({
        backupFilename: payload.backupFilename,
        overwrite: payload.overwrite === true,
        onlyPrefixes: Array.isArray(payload.onlyPrefixes) ? payload.onlyPrefixes : []
      });
      return;
    }
    case 'restore-deploy-uploads': {
      const fs = require('fs');
      const {
        restoreMissingUploadsFromAllBackups,
        latestAnyBackupFilename
      } = require('../utils/soportes-backup-restore');
      if (!latestAnyBackupFilename()) {
        console.log('[soportes-restore] No hay backups disponibles.');
        if (payload.markerPath && payload.version) {
          fs.mkdirSync(require('path').dirname(payload.markerPath), { recursive: true });
          fs.writeFileSync(payload.markerPath, JSON.stringify({
            version: payload.version,
            updatedAt: new Date().toISOString()
          }, null, 2));
        }
        return;
      }
      const result = await restoreMissingUploadsFromAllBackups();
      console.log(`[soportes-restore] Backups revisados: ${result.backupsRevisados.join(', ')}`);
      console.log(`[soportes-restore] Restaurados: ${result.restaurados.length}; omitidos: ${result.omitidos}; errores: ${result.errores.length}`);
      if (result.errores.length) {
        result.errores.forEach((e) => console.error(`[soportes-restore]   - ${e.ruta}: ${e.error}`));
      }
      if (payload.markerPath && payload.version) {
        fs.mkdirSync(require('path').dirname(payload.markerPath), { recursive: true });
        fs.writeFileSync(payload.markerPath, JSON.stringify({
          version: payload.version,
          updatedAt: new Date().toISOString()
        }, null, 2));
      }
      return;
    }
    default:
      throw new Error(`Trabajo desconocido: ${job}`);
  }
}

run().catch((error) => {
  console.error(`[background-job] ${job} falló:`, error);
  process.exitCode = 1;
});
