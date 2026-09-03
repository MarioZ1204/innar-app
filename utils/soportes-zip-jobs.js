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
const { tryGetCachedZipForSpec, saveToCacheForSpec, PERIOD_ZIP_KINDS } = require('./soportes-zip-cache');
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
      if (job.filePath && fs.existsSync(job.filePath) && !job.fromCache) {
        try { fs.unlinkSync(job.filePath); } catch (_) { /* ignore */ }
      }
      jobs.delete(id);
    }
  }
}

function jobSpecKey(job) {
  return JSON.stringify({
    kind: job.kind,
    periodoId: job.periodoId || null,
    diaId: job.diaId || null,
    contenedorId: job.contenedorId || null,
    expedienteId: job.expedienteId || null
  });
}

function cacheSpecFromJob(job) {
  return {
    kind: job.kind,
    periodoId: job.periodoId,
    diaId: job.diaId,
    contenedorId: job.contenedorId,
    expedienteId: job.expedienteId
  };
}

function findReusableJob(spec) {
  const key = jobSpecKey(spec);
  for (const job of jobs.values()) {
    if (jobSpecKey(job) !== key) continue;
    if (job.status === 'ready' && job.filePath && fs.existsSync(job.filePath)) return job;
    if (['pending', 'queued', 'running'].includes(job.status)) return job;
  }
  return null;
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
    .then(async (result) => {
    job.status = 'ready';
    job.progress = 100;
    job.message = 'Listo para descargar';
      job.filePath = result.filePath;
      if (PERIOD_ZIP_KINDS.has(job.kind) || job.periodoId || job.diaId || job.contenedorId || job.expedienteId) {
        await saveToCacheForSpec(cacheSpecFromJob(job), job.filePath, job.filename);
      }
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
      stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    });
    child.stderr?.on('data', (chunk) => {
      const msg = String(chunk || '').trim();
      if (msg) logger.warn('[SOPORTES] zip worker:', msg.slice(0, 500));
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
      const filePath = msg.filePath || path.join(getSopZipWorkDir(), `${job.id}.zip`);
      const ok = markJobFinished(job, {
        status: 'ready',
        progress: 100,
        message: 'Listo para descargar',
        filePath
      });
      if (ok) {
        void saveToCacheForSpec(cacheSpecFromJob(job), filePath, job.filename);
      }
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
    childProcess: null,
    fromCache: false
  };
  jobs.set(id, job);
  enqueueZipJob(job);
  return job;
}

async function createZipJobWithCache(spec, usuarioId = null) {
  const reusable = findReusableJob(spec);
  if (reusable) {
    return {
      ...reusable,
      message: reusable.status === 'ready'
        ? (reusable.fromCache ? 'Listo para descargar (caché)' : 'Listo para descargar')
        : reusable.message
    };
  }

  const cached = await tryGetCachedZipForSpec(spec);
  if (cached?.filePath) {
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
      status: 'ready',
      progress: 100,
      message: 'Listo para descargar (caché)',
      error: null,
      filePath: cached.filePath,
      filename: cached.filename || spec.filename || 'descarga.zip',
      emptyError: spec.emptyError || null,
      createdAt: Date.now(),
      childProcess: null,
      fromCache: true
    };
    jobs.set(id, job);
    return job;
  }
  return createZipJob(spec, usuarioId);
}

function createPeriodPaqueteJob(periodo, usuarioId = null) {
  return createZipJobWithCache({
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
  createZipJobWithCache,
  createPeriodPaqueteJob,
  getJob,
  JOB_TTL_MS,
  MAX_CONCURRENT_ZIP_JOBS,
  USE_CHILD_PROCESS
};
