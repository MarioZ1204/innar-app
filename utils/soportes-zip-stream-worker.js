#!/usr/bin/env node
'use strict';

/**
 * Proceso hijo: transmite ZIP al socket HTTP del cliente mientras lo genera.
 */
require('dotenv').config();

const http = require('http');
const fs = require('fs');
const db = require('./db-mysql');
const { streamZipJobToResponse } = require('./soportes-zip-stream');
const {
  PERIOD_ZIP_KINDS,
  writeCacheManifest,
  getCacheZipPath
} = require('./soportes-zip-cache');
const logger = require('./logger');

function normalizeJob(msg) {
  const job = msg.job || {};
  return {
    kind: job.kind,
    periodoId: job.periodoId || null,
    diaId: job.diaId || null,
    contenedorId: job.contenedorId || null,
    expedienteId: job.expedienteId || null,
    filename: msg.filename || job.filename || 'descarga.zip',
    emptyError: job.emptyError || null
  };
}

async function handleStream(socket, msg) {
  const job = normalizeJob(msg);
  const filename = String(job.filename || 'descarga.zip').replace(/"/g, '');

  await db.initPool();

  const res = new http.ServerResponse({
    method: 'GET',
    httpVersion: '1.1',
    httpVersionMajor: 1,
    httpVersionMinor: 1,
    headers: {}
  });

  socket.resume();
  res.assignSocket(socket);
  res.writeHead(200, {
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store'
  });

  let cachePath = null;
  if (PERIOD_ZIP_KINDS.has(job.kind) && job.periodoId) {
    cachePath = getCacheZipPath(job.periodoId, job.kind);
    job._cachePath = cachePath;
    try {
      if (fs.existsSync(cachePath)) fs.unlinkSync(cachePath);
    } catch (_) { /* ignore */ }
  }

  try {
    await streamZipJobToResponse(res, job);
    if (!res.writableEnded) res.end();

    if (cachePath && fs.existsSync(cachePath)) {
      await writeCacheManifest(job.periodoId, job.kind, filename);
    }

    if (process.send) process.send({ type: 'done' });
    process.exit(0);
  } catch (e) {
    logger.error('[SOPORTES] zip stream worker:', e.message);
    if (cachePath && fs.existsSync(cachePath)) {
      try { fs.unlinkSync(cachePath); } catch (_) { /* ignore */ }
    }
    if (!res.headersSent) {
      try {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: e.message || 'Error al generar ZIP' }));
      } catch (_) { /* ignore */ }
    } else {
      try { res.destroy(); } catch (_) { /* ignore */ }
    }
    if (process.send) process.send({ type: 'error', error: e.message || 'Error al generar ZIP' });
    process.exit(1);
  }
}

process.on('message', (msg, socket) => {
  if (!msg || msg.type !== 'stream' || !socket) {
    process.exit(1);
    return;
  }
  handleStream(socket, msg).catch((e) => {
    if (process.send) process.send({ type: 'error', error: e.message || 'Error al generar ZIP' });
    process.exit(1);
  });
});

process.on('disconnect', () => {
  process.exit(0);
});
