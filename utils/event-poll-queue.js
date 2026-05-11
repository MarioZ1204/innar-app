// Cola en memoria de eventos tiempo-real por usuario autenticado (HTTP long-polling).
const MAX_EVENTS_PER_USER = 200;
/** Usuarios considerados suscritos tras un GET /api/eventos/poll reciente */
const SUBSCRIBER_TTL_MS = 3 * 60 * 1000;

/** @type {Map<number, { event: string, data?: unknown }[]>} */
const queues = new Map();
/** @type {Map<number, number>} usuarioId → timestamp último poll */
const lastPollAt = new Map();

function prune() {
  const now = Date.now();
  for (const [usuarioId, t] of lastPollAt) {
    if (now - t > SUBSCRIBER_TTL_MS) {
      lastPollAt.delete(usuarioId);
      queues.delete(usuarioId);
    }
  }
}

function activeSubscriberIds() {
  prune();
  const now = Date.now();
  /** @type {number[]} */
  const ids = [];
  for (const [usuarioId, t] of lastPollAt) {
    if (now - t <= SUBSCRIBER_TTL_MS) ids.push(usuarioId);
  }
  return ids;
}

function touchSubscriber(usuarioId) {
  if (!usuarioId) return;
  lastPollAt.set(usuarioId, Date.now());
}

function enqueue(usuarioId, event, data) {
  let q = queues.get(usuarioId);
  if (!q) {
    q = [];
    queues.set(usuarioId, q);
  }
  q.push(data === undefined ? { event } : { event, data });
  while (q.length > MAX_EVENTS_PER_USER) q.shift();
}

/**
 * Broadcast a todos los usuarios con poll reciente.
 */
function broadcast(event, data) {
  const ids = activeSubscriberIds();
  for (const usuarioId of ids) {
    enqueue(usuarioId, event, data);
  }
}

/**
 * Broadcast a todos menos `excludeUsuarioId` (equiv. socket.broadcast desde un cliente).
 */
function broadcastExcept(excludeUsuarioId, event, data) {
  const ids = activeSubscriberIds();
  for (const usuarioId of ids) {
    if (usuarioId === excludeUsuarioId) continue;
    enqueue(usuarioId, event, data);
  }
}

/**
 * Devuelve y vacía la cola pendiente para un usuario.
 */
function flushUser(usuarioId) {
  touchSubscriber(usuarioId);
  const prev = queues.get(usuarioId) || [];
  queues.set(usuarioId, []);
  return prev;
}

module.exports = {
  touchSubscriber,
  flushUser,
  broadcast,
  broadcastExcept
};
