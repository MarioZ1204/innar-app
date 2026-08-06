/**
 * Ejecuta trabajos pesados (backups, restauración masiva) en un proceso hijo
 * separado para no bloquear el servidor HTTP principal.
 */
const path = require('path');
const { spawn } = require('child_process');

const JOB_SCRIPT = path.join(__dirname, '..', 'scripts', 'background-job.js');

function spawnBackgroundJob(job, payload = {}, options = {}) {
  const args = [JOB_SCRIPT, job, JSON.stringify(payload || {})];
  const child = spawn(process.execPath, args, {
    cwd: path.join(__dirname, '..'),
    env: process.env,
    detached: options.detached !== false,
    stdio: options.stdio || 'ignore'
  });
  if (options.detached !== false) {
    child.unref();
  }
  return child;
}

function startBackgroundJob(job, payload = {}) {
  const child = spawnBackgroundJob(job, payload, { detached: true, stdio: 'ignore' });
  return { ok: true, background: true, pid: child.pid };
}

module.exports = {
  spawnBackgroundJob,
  startBackgroundJob
};
