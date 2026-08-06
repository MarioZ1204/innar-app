#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function shouldRunOnce(options = {}) {
  const env = options.env || process.env;
  const cwd = options.cwd || process.cwd();
  const version = options.version || env.APP_BUILD_VERSION || env.SOURCE_VERSION || 'unknown';
  const enabled = env[options.enableVar] === '1' || env[options.enableVar] === 'true';

  if (!enabled) {
    return { shouldRun: false, reason: 'disabled' };
  }

  const markerDir = path.join(cwd, '.deploy-state');
  const markerPath = path.join(markerDir, options.markerFile);
  const previous = readMarker(markerPath);
  const currentVersion = String(version || 'unknown');

  if (previous && previous.version === currentVersion) {
    return { shouldRun: false, reason: 'same-version', markerPath };
  }

  return { shouldRun: true, reason: previous ? 'new-version' : 'first-run', markerPath, version: currentVersion };
}

function shouldRunRecovery(options = {}) {
  return shouldRunOnce({ ...options, enableVar: 'SOPORTES_RECOVERY_ON_DEPLOY', markerFile: 'soportes-recovery.json' });
}

function shouldRunFileRestore(options = {}) {
  return shouldRunOnce({ ...options, enableVar: 'SOPORTES_RESTORE_FILES_ON_DEPLOY', markerFile: 'soportes-restore-files.json' });
}

function readMarker(markerPath) {
  try {
    if (!fs.existsSync(markerPath)) return null;
    return JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  } catch (error) {
    return null;
  }
}

function writeMarker(markerPath, version) {
  fs.mkdirSync(path.dirname(markerPath), { recursive: true });
  fs.writeFileSync(markerPath, JSON.stringify({ version, updatedAt: new Date().toISOString() }, null, 2));
}

/**
 * Restaura desde el último backup completo (ZIP con BD + uploads) los archivos
 * de uploads/ que no existan en disco. Se ejecuta automáticamente al arrancar
 * el servidor si SOPORTES_RESTORE_FILES_ON_DEPLOY=1, una sola vez por versión
 * de despliegue (marcador en .deploy-state/soportes-restore-files.json).
 * Nunca sobreescribe archivos existentes.
 */
async function runFileRestoreBootstrap() {
  const result = shouldRunFileRestore();
  if (!result.shouldRun) {
    if (result.reason === 'disabled') {
      console.log('[soportes-restore] Bootstrap desactivado: SOPORTES_RESTORE_FILES_ON_DEPLOY no está habilitado.');
    } else {
      console.log(`[soportes-restore] Bootstrap omitido (${result.reason}).`);
    }
    return;
  }

  console.log(`[soportes-restore] Revisando backups disponibles para restaurar archivos faltantes (versión ${result.version})...`);

  try {
    const { latestAnyBackupFilename } = require('../utils/soportes-backup-restore');
    if (!latestAnyBackupFilename()) {
      console.log('[soportes-restore] No hay backups disponibles; se omite la restauración.');
      writeMarker(result.markerPath, result.version);
      return;
    }

    const { startBackgroundJob } = require('../utils/background-jobs');
    const started = startBackgroundJob('restore-deploy-uploads', {
      markerPath: result.markerPath,
      version: result.version
    });
    console.log(`[soportes-restore] Restauración iniciada en proceso hijo (pid ${started.pid}).`);
  } catch (error) {
    console.error('[soportes-restore] Falló al iniciar la restauración automática de archivos:', error);
  }
}

async function runRecoveryBootstrap() {
  await runFileRestoreBootstrap();

  const result = shouldRunRecovery();
  if (!result.shouldRun) {
    if (result.reason === 'disabled') {
      console.log('[soportes-recovery] Bootstrap desactivado: SOPORTES_RECOVERY_ON_DEPLOY no está habilitado.');
    } else {
      console.log(`[soportes-recovery] Bootstrap omitido (${result.reason}).`);
    }
    return;
  }

  console.log(`[soportes-recovery] Iniciando recuperación para la versión ${result.version}...`);

  const scriptPath = path.join(__dirname, 'recuperar-rutas-soportes-historicas.js');
  const child = spawn(process.execPath, [scriptPath], {
    cwd: path.resolve(__dirname, '..'),
    stdio: 'inherit',
    env: process.env
  });

  child.on('exit', (code) => {
    if (code === 0) {
      writeMarker(result.markerPath, result.version);
      console.log('[soportes-recovery] Recuperación completada y marcador actualizado.');
    } else {
      console.error(`[soportes-recovery] La recuperación falló con código ${code}.`);
    }
  });
}

if (require.main === module) {
  runRecoveryBootstrap().catch((error) => {
    console.error('[soportes-recovery] Error al arrancar la recuperación:', error);
    process.exitCode = 1;
  });
}

module.exports = {
  shouldRunRecovery,
  shouldRunFileRestore,
  runFileRestoreBootstrap,
  runRecoveryBootstrap
};
