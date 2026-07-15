const path = require('path');
const { spawn } = require('child_process');

function runSoportesRecoveryScript(options = {}) {
  const cwd = options.cwd || path.resolve(__dirname, '..');
  const scriptPath = path.join(cwd, 'scripts', 'recuperar-rutas-soportes-historicas.js');
  const expedienteIds = [];

  if (Array.isArray(options.expedienteIds)) {
    expedienteIds.push(...options.expedienteIds.filter((value) => value != null));
  } else if (options.expedienteId != null) {
    expedienteIds.push(options.expedienteId);
  }

  const background = options.background === true;

  if (background) {
    const child = spawn(process.execPath, [scriptPath, ...expedienteIds.map((value) => String(value))], {
      cwd,
      env: { ...process.env, ...(options.env || {}) },
      detached: true,
      stdio: ['ignore', 'ignore', 'ignore']
    });

    try {
      child.unref?.();
    } catch (_) {
      // Ignore cleanup issues for detached child processes.
    }

    return Promise.resolve({
      ok: true,
      background: true,
      pid: child?.pid || null,
      exitCode: null,
      signal: null,
      stdout: '',
      stderr: ''
    });
  }

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...expedienteIds.map((value) => String(value))], {
      cwd,
      env: { ...process.env, ...(options.env || {}) }
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      resolve({
        ok: code === 0,
        exitCode: code,
        signal,
        stdout,
        stderr
      });
    });
  });
}

module.exports = {
  runSoportesRecoveryScript
};
