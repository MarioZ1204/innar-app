#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function shouldRunRecovery(options = {}) {
  const env = options.env || process.env;
  const cwd = options.cwd || process.cwd();
  const version = options.version || env.APP_BUILD_VERSION || env.SOURCE_VERSION || 'unknown';
  const enabled = env.SOPORTES_RECOVERY_ON_DEPLOY === '1' || env.SOPORTES_RECOVERY_ON_DEPLOY === 'true';

  if (!enabled) {
    return { shouldRun: false, reason: 'disabled' };
  }

  const markerDir = path.join(cwd, '.deploy-state');
  const markerPath = path.join(markerDir, 'soportes-recovery.json');
  const previous = readMarker(markerPath);
  const currentVersion = String(version || 'unknown');

  if (previous && previous.version === currentVersion) {
    return { shouldRun: false, reason: 'same-version', markerPath };
  }

  return { shouldRun: true, reason: previous ? 'new-version' : 'first-run', markerPath, version: currentVersion };
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

async function runRecoveryBootstrap() {
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
  runRecoveryBootstrap
};
