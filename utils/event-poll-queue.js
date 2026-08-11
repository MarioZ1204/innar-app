// Cola en memoria de eventos tiempo-real por usuario autenticado (HTTP long-polling).
// NOTA PASAJERO / CLUSTER: cada proceso Node tiene su propio Map. Si Passenger (u otro)
// balanceador levanta varios workers, un POST puede ir al proceso A y el GET poll del
// otro navegador al proceso B → no habrá tiempo real hasta usar 1 proceso o Redis/BD.
const MAX_EVENTS_PER_USER = 200;
/** Usuarios considerados suscritos tras un GET /api/eventos/poll reciente */
const SUBSCRIBER_TTL_MS = 3 * 60 * 1000;

/**
 * Unifica número vs string (express-mysql-session / mysql2 pueden devolver `id` como string).
 * Todas las claves del Map usan el mismo formato para una misma persona.
 */
function canonicalUsuarioId(raw) {
  if (raw == null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n < 1) return null;
  return String(Math.trunc(n));
}

/** @type {Map<string, { event: string, data?: unknown }[]>} */
const queues = new Map();
/** @type {Map<string, number>} usuarioId canónico → timestamp último poll */
const lastPollAt = new Map();
/**
 * Esperas de long-poll: se resuelven al encolar eventos o al timeout.
 * @type {Map<string, { resolve: () => void, timer: ReturnType<typeof setTimeout> }[]>}
 */
const waiters = new Map();

function prune() {
  const now = Date.now();
  for (const [usuarioKey, t] of lastPollAt) {
    if (now - t > SUBSCRIBER_TTL_MS) {
      lastPollAt.delete(usuarioKey);
      queues.delete(usuarioKey);
      const pending = waiters.get(usuarioKey);
      if (pending) {
        waiters.delete(usuarioKey);
        for (const w of pending) {
          clearTimeout(w.timer);
          try { w.resolve(); } catch (_) { /* noop */ }
        }
      }
    }
  }
}

function notifyWaiters(usuarioKey) {
  const list = waiters.get(usuarioKey);
  if (!list || !list.length) return;
  waiters.delete(usuarioKey);
  for (const w of list) {
    clearTimeout(w.timer);
    try { w.resolve(); } catch (_) { /* noop */ }
  }
}

function activeSubscriberIds() {
  prune();
  const now = Date.now();
  /** @type {string[]} */
  const ids = [];
  for (const [usuarioKey, t] of lastPollAt) {
    if (now - t <= SUBSCRIBER_TTL_MS) ids.push(usuarioKey);
  }
  return ids;
}

function touchSubscriber(usuarioId) {
  const key = canonicalUsuarioId(usuarioId);
  if (!key) return;
  lastPollAt.set(key, Date.now());
}

function enqueue(usuarioKey, event, data) {
  let q = queues.get(usuarioKey);
  if (!q) {
    q = [];
    queues.set(usuarioKey, q);
  }
  q.push(data === undefined ? { event } : { event, data });
  while (q.length > MAX_EVENTS_PER_USER) q.shift();
  notifyWaiters(usuarioKey);
}

/**
 * Espera hasta que haya eventos en cola o expire `timeoutMs` (long-poll).
 * Si ya hay eventos, resuelve de inmediato.
 */
function waitForEvents(usuarioId, timeoutMs = 0) {
  const key = canonicalUsuarioId(usuarioId);
  const wait = Math.max(0, Math.min(30000, Number(timeoutMs) || 0));
  if (!key || wait <= 0) return Promise.resolve();
  touchSubscriber(usuarioId);
  const existing = queues.get(key);
  if (existing && existing.length) return Promise.resolve();

  return new Promise((resolve) => {
    const entry = {
      resolve: () => resolve(),
      timer: setTimeout(() => {
        const list = waiters.get(key);
        if (list) {
          const next = list.filter((w) => w !== entry);
          if (next.length) waiters.set(key, next);
          else waiters.delete(key);
        }
        resolve();
      }, wait)
    };
    let list = waiters.get(key);
    if (!list) {
      list = [];
      waiters.set(key, list);
    }
    list.push(entry);
  });
}

/** Entrega un evento solo a un usuario (DM / notificaciones dirigidas). */
function enqueueToUser(usuarioId, event, data) {
  const key = canonicalUsuarioId(usuarioId);
  if (!key) return false;
  enqueue(key, event, data);
  return true;
}

/** Online aproximado: último GET /api/eventos/poll reciente. */
function isUserOnline(usuarioId, ttlMs = 90000) {
  const key = canonicalUsuarioId(usuarioId);
  if (!key) return false;
  const t = lastPollAt.get(key);
  return t != null && (Date.now() - t) <= ttlMs;
}

/**
 * Broadcast a todos los usuarios con poll reciente.
 */
function broadcast(event, data) {
  const ids = activeSubscriberIds();
  for (const usuarioKey of ids) {
    enqueue(usuarioKey, event, data);
  }
}

/**
 * Broadcast a todos menos `excludeUsuarioId` (equiv. socket.broadcast desde un cliente).
 */
function broadcastExcept(excludeUsuarioId, event, data) {
  const ex = canonicalUsuarioId(excludeUsuarioId);
  const ids = activeSubscriberIds();
  for (const usuarioKey of ids) {
    if (usuarioKey === ex) continue;
    enqueue(usuarioKey, event, data);
  }
}

/**
 * Devuelve y vacía la cola pendiente para un usuario.
 */
function flushUser(usuarioId) {
  const key = canonicalUsuarioId(usuarioId);
  if (!key) return [];
  touchSubscriber(usuarioId);
  const prev = queues.get(key) || [];
  queues.set(key, []);
  return prev;
}

/** Solo para pruebas: limpia el singleton en memoria. */
function resetQueuesForTests() {
  for (const list of waiters.values()) {
    for (const w of list) {
      clearTimeout(w.timer);
      try { w.resolve(); } catch (_) { /* noop */ }
    }
  }
  waiters.clear();
  queues.clear();
  lastPollAt.clear();
}

module.exports = {
  canonicalUsuarioId,
  touchSubscriber,
  flushUser,
  waitForEvents,
  enqueueToUser,
  isUserOnline,
  broadcast,
  broadcastExcept,
  resetQueuesForTests
};
