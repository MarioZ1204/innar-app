#!/usr/bin/env node
/**
 * Proceso hijo: genera ZIP sin bloquear el event loop del servidor web principal.
 * Se mantiene vivo entre trabajos (el fork + initPool cuesta segundos en hosting compartido).
 */
require('dotenv').config();

const db = require('./db-mysql');
const { runZipJobToDisk } = require('./soportes-zip-job-runner');

let poolReady = null;
let ocupado = false;

function ensurePool() {
  if (!poolReady) poolReady = db.initPool();
  return poolReady;
}

function send(msg) {
  if (process.send) process.send(msg);
}

async function handleRun(job) {
  await ensurePool();
  const result = await runZipJobToDisk(job, (patch) => {
    send({ type: 'progress', jobId: job.id, ...patch });
  });
  send({ type: 'done', jobId: job.id, filePath: result.filePath, filesAdded: result.filesAdded });
}

process.on('message', (msg) => {
  if (!msg || typeof msg !== 'object') return;

  if (msg.type === 'shutdown') {
    process.exit(0);
    return;
  }

  if (msg.type !== 'run' || !msg.job) return;

  const jobId = msg.job.id;
  if (ocupado) {
    send({ type: 'error', jobId, error: 'Proceso ZIP ocupado' });
    return;
  }
  ocupado = true;
  handleRun(msg.job)
    .then(() => { ocupado = false; })
    .catch((e) => {
      ocupado = false;
      send({ type: 'error', jobId, error: e.message || 'Error al generar ZIP' });
    });
});

process.on('disconnect', () => {
  process.exit(0);
});
