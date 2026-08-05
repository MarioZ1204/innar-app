/**
 * Jobs en segundo plano para ZIP de Armado.
 * La generación corre en un proceso hijo para no bloquear HTTP (Node es single-thread).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { fork } = require('child_process');
const { zipArchiveSegment, getSopZipWorkDir } = require('./soportes-armado-zip');
const { runZipJobToDisk } = require('./soportes-zip-job-runner');
const logger = require('./logger');

const JOB_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_CONCURRENT_ZIP_JOBS = parseInt(process.env.ZIP_MAX_CONCURRENT || '1', 10) || 1;
const USE_CHILD_PROCESS = process.env.ZIP_JOB_INLINE !== '1' && process.env.NODE_ENV !== 'test';

const jobs = new Map();
const pendingQueue = [];
let runningZipJobs = 0;

const WORKER_SCRIPT = path.join(__dirname, 'soportes-zip-worker-process.js');

function cleanupOldJobs() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.createdAt > JOB_TTL_MS) {
      if (job.childProcess) {
        try { job.childProcess.kill('SIGTERM'); } catch (_) { /* ignore */ }
      }
      if (job.filePath && fs.existsSync(job.filePath)) {
        try { fs.unlinkSync(job.filePath); } catch (_) { /* ignore */ }
      }
      jobs.delete(id);
    }
  }
}

function serializeJobForWorker(job) {
  return {
    id: job.id,
    kind: job.kind,
    periodoId: job.periodoId,
    diaId: job.diaId,
    contenedorId: job.contenedorId,
    expedienteId: job.expedienteId,
    filename: job.filename,
    emptyError: job.emptyError
  };
}

function finishZipJobSlot() {
  runningZipJobs = Math.max(0, runningZipJobs - 1);
  drainZipJobQueue();
}

function applyProgress(job, patch) {
  if (patch.message != null) job.message = patch.message;
  if (patch.progress != null) job.progress = patch.progress;
}

function markJobFinished(job, patch) {
  if (job.status !== 'running') return false;
  Object.assign(job, patch);
  job.childProcess = null;
  finishZipJobSlot();
  return true;
}

function runZipJobInline(job) {
  job.status = 'running';
  return runZipJobToDisk(job, (patch) => applyProgress(job, patch))
    .then((result) => {
      job.status = 'ready';
      job.progress = 100;
      job.message = 'Listo para descargar';
      job.filePath = result.filePath;
    })
    .catch((e) => {
      job.status = 'error';
      job.error = e.message || 'Error al generar ZIP';
      job.progress = 0;
      if (job.filePath && fs.existsSync(job.filePath)) {
        try { fs.unlinkSync(job.filePath); } catch (_) { /* ignore */ }
      }
      job.filePath = null;
    })
    .finally(() => finishZipJobSlot());
}

function runZipJobInChildProcess(job) {
  job.status = 'running';
  job.message = 'Iniciando proceso ZIP…';

  let child;
  try {
    child = fork(WORKER_SCRIPT, [], {
      env: process.env,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc']
    });
  } catch (e) {
    logger.error('[SOPORTES] zip fork:', e.message);
    job.status = 'error';
    job.error = 'No se pudo iniciar el proceso ZIP';
    finishZipJobSlot();
    return;
  }

  job.childProcess = child;

  child.on('message', (msg) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'progress') {
      applyProgress(job, msg);
      return;
    }
    if (msg.type === 'done') {
      const ok = markJobFinished(job, {
        status: 'ready',
        progress: 100,
        message: 'Listo para descargar',
        filePath: msg.filePath || path.join(getSopZipWorkDir(), `${job.id}.zip`)
      });
      if (ok) try { child.disconnect(); } catch (_) { /* ignore */ }
      return;
    }
    if (msg.type === 'error') {
      markJobFinished(job, {
        status: 'error',
        error: msg.error || 'Error al generar ZIP',
        progress: 0,
        filePath: null
      });
    }
  });

  child.on('error', (e) => {
    logger.error('[SOPORTES] zip child error:', e.message);
    markJobFinished(job, {
      status: 'error',
      error: e.message || 'Proceso ZIP falló',
      progress: 0,
      filePath: null
    });
  });

  child.on('exit', (code) => {
    if (job.status !== 'running') return;
    markJobFinished(job, {
      status: 'error',
      error: code === 0 ? 'Proceso ZIP terminó sin respuesta' : `Proceso ZIP terminó (código ${code})`,
      progress: 0,
      filePath: null
    });
  });

  try {
    child.send({ type: 'run', job: serializeJobForWorker(job) });
  } catch (e) {
    markJobFinished(job, {
      status: 'error',
      error: 'No se pudo comunicar con el proceso ZIP',
      progress: 0,
      filePath: null
    });
  }
}

function startZipJob(job) {
  if (USE_CHILD_PROCESS) runZipJobInChildProcess(job);
  else void runZipJobInline(job);
}

function drainZipJobQueue() {
  while (runningZipJobs < MAX_CONCURRENT_ZIP_JOBS && pendingQueue.length) {
    const job = pendingQueue.shift();
    job.status = 'pending';
    job.message = 'Iniciando generación…';
    runningZipJobs += 1;
    startZipJob(job);
  }
}

function enqueueZipJob(job) {
  if (runningZipJobs < MAX_CONCURRENT_ZIP_JOBS) {
    runningZipJobs += 1;
    startZipJob(job);
    return;
  }
  job.status = 'queued';
  job.message = `En cola (${pendingQueue.length + 1} en espera)…`;
  job.progress = 0;
  pendingQueue.push(job);
}

function createZipJob(spec, usuarioId = null) {
  cleanupOldJobs();
  const id = crypto.randomBytes(12).toString('hex');
  const job = {
    id,
    kind: spec.kind,
    periodoId: spec.periodoId || null,
    diaId: spec.diaId || null,
    contenedorId: spec.contenedorId || null,
    expedienteId: spec.expedienteId || null,
    usuarioId,
    status: 'pending',
    progress: 0,
    message: 'Iniciando generación…',
    error: null,
    filePath: null,
    filename: spec.filename || 'descarga.zip',
    emptyError: spec.emptyError || null,
    createdAt: Date.now(),
    childProcess: null
  };
  jobs.set(id, job);
  enqueueZipJob(job);
  return job;
}

function createPeriodPaqueteJob(periodo, usuarioId = null) {
  return createZipJob({
    kind: 'periodo-paquete',
    periodoId: periodo.id,
    filename: `${zipArchiveSegment(periodo.etiqueta || periodo.periodo || `periodo-${periodo.id}`)}-paquete.zip`,
    emptyError: 'No hay archivos para descargar en este mes'
  }, usuarioId);
}

function getJob(jobId) {
  cleanupOldJobs();
  return jobs.get(jobId) || null;
}

module.exports = {
  createZipJob,
  createPeriodPaqueteJob,
  getJob,
  JOB_TTL_MS,
  MAX_CONCURRENT_ZIP_JOBS,
  USE_CHILD_PROCESS
};
