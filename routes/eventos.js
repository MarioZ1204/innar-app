// GET /api/eventos/poll  |  POST /api/eventos/push
const express = require('express');
const { requireAuth, sesionTieneAlgunPermiso } = require('../middleware');
const queue = require('../utils/event-poll-queue');
const relay = require('../utils/realtime-client-relay');

const router = express.Router();
const APP_VERSION = require('../package.json').version;

router.get('/eventos/poll', requireAuth, async (req, res) => {
  const uid = req.session.usuarioId;
  const waitRaw = parseInt(String(req.query.wait || '0'), 10);
  // Hostinger compartido: evitar waits largos (conexiones retenidas).
  const waitMs = Number.isFinite(waitRaw) ? Math.min(8000, Math.max(0, waitRaw)) : 0;
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('X-Accel-Buffering', 'no');
  if (waitMs > 0) {
    await queue.waitForEvents(uid, waitMs);
  }
  const events = queue.flushUser(uid);
  // version en el poll evita GET /api/version periódicos por cada pestaña.
  res.json({ events, version: APP_VERSION });
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
