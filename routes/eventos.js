// GET /api/eventos/poll  |  GET /api/eventos/stream (SSE)  |  POST /api/eventos/push
const express = require('express');
const { requireAuth, sesionTieneAlgunPermiso } = require('../middleware');
const queue = require('../utils/event-poll-queue');
const relay = require('../utils/realtime-client-relay');

const router = express.Router();
const APP_VERSION = require('../package.json').version;

function parseSince(req) {
  const q = parseInt(String(req.query.since || '0'), 10) || 0;
  const header = parseInt(String(req.get('Last-Event-ID') || '0'), 10) || 0;
  return Math.max(q, header, 0);
}

async function collectEvents(uid, since) {
  const mem = queue.flushUser(uid);
  const persisted = await queue.readPersistedSince(uid, since);
  const events = queue.mergePollEvents(persisted.events, mem);
  const lastId = Math.max(since, persisted.lastId || 0);
  return { events, lastId };
}

router.get('/eventos/poll', requireAuth, async (req, res) => {
  const uid = req.session.usuarioId;
  const waitRaw = parseInt(String(req.query.wait || '0'), 10);
  const waitMs = Number.isFinite(waitRaw) ? Math.min(8000, Math.max(0, waitRaw)) : 0;
  const since = parseSince(req);
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('X-Accel-Buffering', 'no');
  if (waitMs > 0) {
    const peek = await queue.readPersistedSince(uid, since);
    if (!peek.events.length) {
      await queue.waitForEvents(uid, waitMs);
    }
  }
  const { events, lastId } = await collectEvents(uid, since);
  res.json({ events, version: APP_VERSION, lastId });
});

/**
 * Canal persistente tipo socket sobre HTTP (Server-Sent Events).
 * Hostinger/Passenger no deja upgrade WebSocket; SSE empuja eventos sin Socket.IO.
 */
router.get('/eventos/stream', requireAuth, async (req, res) => {
  const uid = req.session.usuarioId;
  let since = parseSince(req);
  let closed = false;

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
  try {
    if (req.socket) req.socket.setTimeout(0);
    if (res.socket) res.socket.setTimeout(0);
  } catch (_) { /* noop */ }

  const safeWrite = (chunk) => {
    if (closed || res.writableEnded) return false;
    try {
      const ok = res.write(chunk);
      if (typeof res.flush === 'function') res.flush();
      return ok !== false;
    } catch (_) {
      closed = true;
      return false;
    }
  };

  const sendFrame = (payload) => {
    const id = Number(payload.lastId) || since;
    return safeWrite(`id: ${id}\ndata: ${JSON.stringify(payload)}\n\n`);
  };

  const onClose = () => { closed = true; };
  req.on('close', onClose);
  req.on('aborted', onClose);

  sendFrame({ type: 'hello', version: APP_VERSION, lastId: since, events: [] });

  while (!closed) {
    const peek = await queue.readPersistedSince(uid, since);
    if (!peek.events.length) {
      await queue.waitForEvents(uid, 4000);
    }
    if (closed) break;
    const batch = await collectEvents(uid, since);
    since = batch.lastId;
    if (batch.events.length) {
      if (!sendFrame({
        type: 'events',
        events: batch.events,
        lastId: since,
        version: APP_VERSION
      })) break;
    } else if (!safeWrite(': ping\n\n')) {
      break;
    }
  }
});

router.post('/eventos/push', requireAuth, (req, res) => {
  const { event, data } = req.body || {};
  if (!relay.isAllowed(event)) {
    return res.status(400).json({ error: 'Evento no permitido' });
  }
  const perms = relay.permisosDeEvento(event);
  if (!perms || !sesionTieneAlgunPermiso(req.session, perms)) {
    return res.status(403).json({ error: 'No tienes permiso para emitir este evento' });
  }
  relay.relay(req.session.usuarioId, event, data);
  res.json({ ok: true });
});

module.exports = router;
