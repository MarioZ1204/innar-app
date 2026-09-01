const relay = require('../utils/realtime-client-relay');
const q = require('../utils/event-poll-queue');
const mw = require('../middleware');

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

  test('sanitizarAnuncioPaciente recorta texto y descarta campos extra', () => {
    const out = relay.sanitizarAnuncioPaciente({
      paciente_nombre: '  Ana <script>  ',
      numero_consultorio: 'C-1',
      doctor_nombre: 'Dr. Pérez',
      doctor_id: '12',
      html: '<img src=x>'
    });
    expect(out).toEqual({
      paciente_nombre: 'Ana <script>',
      numero_consultorio: 'C-1',
      doctor_nombre: 'Dr. Pérez',
      doctor_id: 12
    });
    expect(out.html).toBeUndefined();
  });

  test('sanitizarAnuncioPaciente conserva call_id válido y descarta basura', () => {
    const out = relay.sanitizarAnuncioPaciente({
      paciente_nombre: 'Ana',
      call_id: 'c-llamado-abc12',
      extra: true
    });
    expect(out.call_id).toBe('c-llamado-abc12');
    expect(out.extra).toBeUndefined();
    expect(relay.sanitizarCallId('<script>')).toBe('');
  });

  test('sanitizarAnuncioPaciente conserva turno_id válido', () => {
    const out = relay.sanitizarAnuncioPaciente({
      paciente_nombre: 'Ana',
      turno_id: '42',
      extra: true
    });
    expect(out.turno_id).toBe(42);
    expect(out.extra).toBeUndefined();
  });

  test('agenda:anuncio-ack se retransmite con estado sanitizado', () => {
    const emisor = 99002;
    q.flushUser(emisor);
    relay.relay(emisor, 'agenda:anuncio-ack', {
      call_id: 'c-llamado-xyz99',
      estado: 'filtrado',
      html: '<b>'
    });
    const recibidos = q.flushUser(emisor);
    expect(recibidos.some((e) => e.event === 'agenda:anuncio-ack' && e.data.estado === 'filtrado' && e.data.call_id === 'c-llamado-xyz99')).toBe(true);
  });

  test('contabilidad no puede emitir llamado a TV; recepción sí', () => {
    const perms = relay.permisosDeEvento('agenda:anunciar-paciente');
    expect(mw.sesionTieneAlgunPermiso(
      { usuarioId: 1, rol: 'contabilidad', permisos: null },
      perms
    )).toBe(false);
    expect(mw.sesionTieneAlgunPermiso(
      { usuarioId: 2, rol: 'recepcion', permisos: null },
      perms
    )).toBe(true);
    expect(mw.sesionTieneAlgunPermiso(
      { usuarioId: 3, rol: 'doctor', permisos: null },
      perms
    )).toBe(true);
  });
});
