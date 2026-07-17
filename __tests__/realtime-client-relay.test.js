const relay = require('../utils/realtime-client-relay');
const q = require('../utils/event-poll-queue');

describe('realtime-client-relay', () => {
  beforeEach(() => {
    q.resetQueuesForTests();
  });

  test('agenda:anunciar-paciente hace broadcast al emisor (misma sesión TV/recepción)', () => {
    const emisor = 99001;
    q.flushUser(emisor);
    relay.relay(emisor, 'agenda:anunciar-paciente', { paciente_nombre: 'Ana' });
    const recibidos = q.flushUser(emisor);
    expect(recibidos.some((e) => e.event === 'agenda:anunciar-paciente' && e.data.paciente_nombre === 'Ana')).toBe(true);
  });
});
