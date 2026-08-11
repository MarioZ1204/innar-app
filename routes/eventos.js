// GET /api/eventos/poll  |  POST /api/eventos/push
const express = require('express');
const { requireAuth } = require('../middleware');
const queue = require('../utils/event-poll-queue');
const relay = require('../utils/realtime-client-relay');

const router = express.Router();

router.get('/eventos/poll', requireAuth, async (req, res) => {
  const uid = req.session.usuarioId;
  const waitRaw = parseInt(String(req.query.wait || '0'), 10);
  // Hostinger/proxies suelen cortar ~30s; dejamos margen.
  const waitMs = Number.isFinite(waitRaw) ? Math.min(25000, Math.max(0, waitRaw)) : 0;
  if (waitMs > 0) {
    await queue.waitForEvents(uid, waitMs);
  }
  const events = queue.flushUser(uid);
  res.json({ events });
});

router.post('/eventos/push', requireAuth, (req, res) => {
  const { event, data } = req.body || {};
  if (!relay.isAllowed(event)) {
    return res.status(400).json({ error: 'Evento no permitido' });
  }
  relay.relay(req.session.usuarioId, event, data);
  res.json({ ok: true });
});

module.exports = router;
