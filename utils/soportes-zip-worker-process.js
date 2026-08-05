#!/usr/bin/env node
/**
 * Proceso hijo: genera ZIP sin bloquear el event loop del servidor web principal.
 */
require('dotenv').config();

const db = require('./db-mysql');
const { runZipJobToDisk } = require('./soportes-zip-job-runner');

async function handleRun(job) {
  await db.initPool();
  const result = await runZipJobToDisk(job, (patch) => {
    if (process.send) process.send({ type: 'progress', ...patch });
  });
  if (process.send) {
    process.send({ type: 'done', filePath: result.filePath, filesAdded: result.filesAdded });
  }
}

process.on('message', (msg) => {
  if (!msg || msg.type !== 'run' || !msg.job) return;
  handleRun(msg.job)
    .then(() => process.exit(0))
    .catch((e) => {
      if (process.send) process.send({ type: 'error', error: e.message || 'Error al generar ZIP' });
      process.exit(1);
    });
});

process.on('disconnect', () => {
  process.exit(0);
});
