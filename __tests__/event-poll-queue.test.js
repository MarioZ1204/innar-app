const q = require('../utils/event-poll-queue');

describe('event-poll-queue', () => {
  beforeEach(() => {
    q.resetQueuesForTests();
  });
  test('canonicalUsuarioId normaliza número y string', () => {
    expect(q.canonicalUsuarioId(5)).toBe('5');
    expect(q.canonicalUsuarioId('5')).toBe('5');
    expect(q.canonicalUsuarioId(null)).toBe(null);
    expect(q.canonicalUsuarioId('')).toBe(null);
  });

  test('flushUser(number) y broadcast entregan a flushUser(string) la misma cola', () => {
    const uid = 88001;
    q.flushUser(uid);
    q.broadcast('test:evento', { k: 1 });
    const recibidos = q.flushUser(String(uid));
    expect(recibidos.some((e) => e.event === 'test:evento' && e.data.k === 1)).toBe(true);
  });

  test('broadcastExcept excluye al emisor usando id string o número', () => {
    const a = 88002;
    const b = 88003;
    q.flushUser(a);
    q.flushUser(b);
    q.broadcastExcept(a, 'x', { n: 1 });
    expect(q.flushUser(String(a))).toEqual([]);
    const uB = q.flushUser(String(b));
    expect(uB.some((e) => e.event === 'x')).toBe(true);
  });

  test('enqueueToUser entrega solo al destinatario', () => {
    const a = 88004;
    const b = 88005;
    q.flushUser(a);
    q.flushUser(b);
    expect(q.enqueueToUser(a, 'chat:mensaje', { id: 1 })).toBe(true);
    expect(q.flushUser(String(b))).toEqual([]);
    const ua = q.flushUser(String(a));
    expect(ua.some((e) => e.event === 'chat:mensaje' && e.data.id === 1)).toBe(true);
  });

  test('isUserOnline refleja poll reciente', () => {
    const uid = 88006;
    expect(q.isUserOnline(uid)).toBe(false);
    q.flushUser(uid);
    expect(q.isUserOnline(uid, 90000)).toBe(true);
  });
});
