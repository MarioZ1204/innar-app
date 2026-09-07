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
const MAX_CONCURRENT_ZIP_JOBS = parseInt(process.env.ZIP_MAX_CONCURRENT || '2', 10) || 2;
const USE_CHILD_PROCESS = process.env.ZIP_JOB_INLINE !== '1' && process.env.NODE_ENV !== 'test';
/** Mantener workers vivos evita pagar fork + initPool (segundos) en cada ZIP. */
const WORKER_IDLE_TTL_MS = 5 * 60 * 1000;

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

/** Un job libera su cupo una sola vez: cancelar y terminar pueden coincidir. */
function releaseJobSlot(job) {
  if (!job || job.slotLibre) return;
  job.slotLibre = true;
  finishZipJobSlot();
}

function markJobFinished(job, patch) {
  if (!job || job.status !== 'running') return false;
  Object.assign(job, patch);
  job.childProcess = null;
  job.worker = null;
  releaseJobSlot(job);
  return true;
}

function borrarArchivoParcial(job) {
  const parcial = job.filePath || path.join(getSopZipWorkDir(), `${job.id}.zip`);
  if (job.fromCache) return;
  fs.promises.rm(parcial, { force: true }).catch(() => { /* ignore */ });
}

/**
 * Cancela un ZIP en cola o en curso. Matar el worker es la única forma de parar
 * de verdad: archiver no admite abortar desde fuera del proceso hijo.
 */
function cancelZipJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return { ok: false, reason: 'not_found' };
  if (job.status === 'cancelled') return { ok: true, status: 'cancelled' };
  if (job.status === 'error') return { ok: false, reason: 'finalizado', status: job.status };

  const previo = job.status;
  const enCola = pendingQueue.indexOf(job);
  if (enCola >= 0) pendingQueue.splice(enCola, 1);

  // 'pending' y 'running' son los únicos estados que ocupan un cupo de concurrencia.
  const ocupabaCupo = previo === 'pending' || previo === 'running';
  const w = job.worker;

  job.status = 'cancelled';
  job.progress = 0;
  job.message = 'Descarga cancelada';
  job.error = null;
  job.cancelled = true;

  if (w) {
    w.job = null;
    w.dead = true;
    removeFromIdle(w);
    shutdownWorker(w);
  }
  job.childProcess = null;
  job.worker = null;

  borrarArchivoParcial(job);
  job.filePath = null;

  if (ocupabaCupo) releaseJobSlot(job);
  else {
    job.slotLibre = true;
    drainZipJobQueue();
  }

  return { ok: true, status: 'cancelled', previo };
}

function runZipJobInline(job) {
  job.status = 'running';
  return runZipJobToDisk(job, (patch) => applyProgress(job, patch))
    .then(async (result) => {
    if (job.status === 'cancelled') {
      await fs.promises.rm(result.filePath, { force: true }).catch(() => {});
      return;
    }
    job.status = 'ready';
    job.progress = 100;
    job.message = 'Listo para descargar';
      job.filePath = result.filePath;
      if (PERIOD_ZIP_KINDS.has(job.kind) || job.periodoId || job.diaId || job.contenedorId || job.expedienteId) {
        await saveToCacheForSpec(cacheSpecFromJob(job), job.filePath, job.filename);
      }
    })
    .catch((e) => {
    if (job.status === 'cancelled') return;
    job.status = 'error';
    job.error = e.message || 'Error al generar ZIP';
    job.progress = 0;
    if (job.filePath && fs.existsSync(job.filePath)) {
      try { fs.unlinkSync(job.filePath); } catch (_) { /* ignore */ }
    }
    job.filePath = null;
    })
    .finally(() => releaseJobSlot(job));
}

const idleWorkers = [];

function shutdownWorker(w) {
  w.dead = true;
  try { w.child.send({ type: 'shutdown' }); } catch (_) { /* ignore */ }
  try { w.child.disconnect(); } catch (_) { /* ignore */ }
  setTimeout(() => {
    try { w.child.kill('SIGTERM'); } catch (_) { /* ignore */ }
  }, 1500).unref?.();
}

function removeFromIdle(w) {
  const i = idleWorkers.indexOf(w);
  if (i >= 0) idleWorkers.splice(i, 1);
  if (w.idleTimer) {
    clearTimeout(w.idleTimer);
    w.idleTimer = null;
  }
}

/** Termina el job del worker; devuelve el worker al pool solo si sigue sano. */
function settleWorkerJob(w, patch, { reusable = true } = {}) {
  const job = w.job;
  w.job = null;
  if (reusable) releaseWorker(w);
  return markJobFinished(job, patch);
}

function releaseWorker(w) {
  if (w.dead || !w.child.connected) return;
  if (idleWorkers.length >= MAX_CONCURRENT_ZIP_JOBS) {
    shutdownWorker(w);
    return;
  }
  w.idleTimer = setTimeout(() => {
    removeFromIdle(w);
    shutdownWorker(w);
  }, WORKER_IDLE_TTL_MS);
  w.idleTimer.unref?.();
  idleWorkers.push(w);
}

function onWorkerMessage(w, msg) {
  if (!msg || typeof msg !== 'object') return;
  const job = w.job;
  if (!job) return;
  if (msg.jobId && msg.jobId !== job.id) return;

  if (msg.type === 'progress') {
    applyProgress(job, msg);
    return;
  }
  if (msg.type === 'done') {
    const filePath = msg.filePath || path.join(getSopZipWorkDir(), `${job.id}.zip`);
    const ok = settleWorkerJob(w, {
      status: 'ready',
      progress: 100,
      message: 'Listo para descargar',
      filePath
    });
    if (ok) void saveToCacheForSpec(cacheSpecFromJob(job), filePath, job.filename);
    return;
  }
  if (msg.type === 'error') {
    settleWorkerJob(w, {
      status: 'error',
      error: msg.error || 'Error al generar ZIP',
      progress: 0,
      filePath: null
    });
  }
}

function createWorker() {
  const child = fork(WORKER_SCRIPT, [], {
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });
  const w = { child, job: null, idleTimer: null, dead: false };

  // Los pipes deben consumirse siempre: el worker vive entre trabajos y si stdout
  // llena el búfer (~64 KB) se bloquea a mitad de un ZIP sin dar señal alguna.
  child.stdout?.resume();
  child.stderr?.on('data', (chunk) => {
    const msg = String(chunk || '').trim();
    if (msg) logger.warn('[SOPORTES] zip worker:', msg.slice(0, 500));
  });
  child.on('message', (msg) => onWorkerMessage(w, msg));
  child.on('error', (e) => {
    logger.error('[SOPORTES] zip child error:', e.message);
    w.dead = true;
    removeFromIdle(w);
    settleWorkerJob(w, {
      status: 'error',
      error: e.message || 'Proceso ZIP falló',
      progress: 0,
      filePath: null
    }, { reusable: false });
  });
  child.on('exit', (code) => {
    w.dead = true;
    removeFromIdle(w);
    settleWorkerJob(w, {
      status: 'error',
      error: code === 0 ? 'Proceso ZIP terminó sin respuesta' : `Proceso ZIP terminó (código ${code})`,
      progress: 0,
      filePath: null
    }, { reusable: false });
  });

  return w;
}

function acquireWorker() {
  while (idleWorkers.length) {
    const w = idleWorkers.pop();
    if (w.idleTimer) {
      clearTimeout(w.idleTimer);
      w.idleTimer = null;
    }
    if (!w.dead && w.child.connected) return w;
  }
  return createWorker();
}

function runZipJobInChildProcess(job) {
  if (job.status === 'cancelled') return;
  job.status = 'running';
  job.message = 'Generando ZIP…';

  let w;
  try {
    w = acquireWorker();
  } catch (e) {
    logger.error('[SOPORTES] zip fork:', e.message);
    job.status = 'error';
    job.error = 'No se pudo iniciar el proceso ZIP';
    releaseJobSlot(job);
    return;
  }

  w.job = job;
  job.childProcess = w.child;
  job.worker = w;

  try {
    w.child.send({ type: 'run', job: serializeJobForWorker(job) });
  } catch (e) {
    w.dead = true;
    settleWorkerJob(w, {
      status: 'error',
      error: 'No se pudo comunicar con el proceso ZIP',
      progress: 0,
      filePath: null
    }, { reusable: false });
  }
}

function startZipJob(job) {
  if (USE_CHILD_PROCESS) runZipJobInChildProcess(job);
  else void runZipJobInline(job);
}

function drainZipJobQueue() {
  while (runningZipJobs < MAX_CONCURRENT_ZIP_JOBS && pendingQueue.length) {
    const job = pendingQueue.shift();
    if (job.status === 'cancelled') continue;
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
    worker: null,
    slotLibre: false,
    cancelled: false,
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
      worker: null,
      slotLibre: true,
      cancelled: false,
      fromCache: true
    };
    jobs.set(id, job);
    return job;
  }
  return createZipJob(spec, usuarioId);
}

async function createPeriodPaqueteJob(periodo, usuarioId = null) {
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
  cancelZipJob,
  getJob,
  JOB_TTL_MS,
  MAX_CONCURRENT_ZIP_JOBS,
  USE_CHILD_PROCESS
};
