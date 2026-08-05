'use strict';

const path = require('path');
const { fork } = require('child_process');
const logger = require('./logger');

const STREAM_WORKER_SCRIPT = path.join(__dirname, 'soportes-zip-stream-worker.js');
/** El traspaso de socket HTTP al hijo falla en varios hosts (503). Activar solo con ZIP_STREAM_CHILD=1. */
const USE_CHILD_STREAM = process.env.ZIP_STREAM_CHILD === '1'
  && process.env.ZIP_JOB_INLINE !== '1'
  && process.env.NODE_ENV !== 'test';

function serializeJobForStream(job) {
  return {
    kind: job.kind,
    periodoId: job.periodoId || null,
    diaId: job.diaId || null,
    contenedorId: job.contenedorId || null,
    expedienteId: job.expedienteId || null,
    filename: job.filename,
    emptyError: job.emptyError || null
  };
}

/**
 * Transmite ZIP en proceso hijo (no bloquea el servidor web).
 * El socket HTTP se entrega al hijo para que la descarga empiece de inmediato.
 */
function forkStreamZipToSocket(req, res, job, filename) {
  const socket = req.socket;
  if (!socket || socket.destroyed) {
    res.status(500).json({ error: 'Conexión no disponible para la descarga' });
    return false;
  }

  socket.pause();

  let child;
  try {
    child = fork(STREAM_WORKER_SCRIPT, [], {
      env: process.env,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc']
    });
  } catch (e) {
    logger.error('[SOPORTES] zip stream fork:', e.message);
    res.status(500).json({ error: 'No se pudo iniciar la descarga ZIP' });
    return false;
  }

  let handedOff = false;

  const fail = (message) => {
    if (handedOff) return;
    if (!res.headersSent) {
      res.status(500).json({ error: message || 'Error en descarga ZIP' });
    }
    try { child.kill('SIGTERM'); } catch (_) { /* ignore */ }
  };

  child.on('error', (e) => fail(e.message));
  child.on('exit', (code) => {
    if (code !== 0 && !handedOff) fail(`Proceso ZIP terminó (código ${code})`);
  });

  req.on('close', () => {
    if (!handedOff) {
      try { child.kill('SIGTERM'); } catch (_) { /* ignore */ }
    }
  });

  try {
    child.send({
      type: 'stream',
      job: serializeJobForStream(job),
      filename: filename || job.filename || 'descarga.zip'
    }, socket);
    handedOff = true;
    return true;
  } catch (e) {
    logger.error('[SOPORTES] zip stream send socket:', e.message);
    fail('No se pudo iniciar la transmisión ZIP');
    return false;
  }
}

module.exports = {
  forkStreamZipToSocket,
  USE_CHILD_STREAM
};
