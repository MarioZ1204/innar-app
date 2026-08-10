const {
  usuarioTieneChatUsar,
  puedeHablarCon,
  pairOrdenado,
  esRolRecepcion,
  esRolDoctor
} = require('../utils/chat-acceso');

describe('chat-acceso', () => {
  test('pairOrdenado ordena ids', () => {
    expect(pairOrdenado(5, 2)).toEqual({ usuario_a_id: 2, usuario_b_id: 5 });
    expect(pairOrdenado(2, 5)).toEqual({ usuario_a_id: 2, usuario_b_id: 5 });
  });

  test('doctor tiene chat por defaults; recepción no', () => {
    expect(usuarioTieneChatUsar({ rol: 'doctor', permisos: null })).toBe(true);
    expect(usuarioTieneChatUsar({ rol: 'recepcion', permisos: null })).toBe(false);
    expect(usuarioTieneChatUsar({ rol: 'recepcion', permisos: ['chat.usar'] })).toBe(true);
    expect(usuarioTieneChatUsar({ rol: 'admin', permisos: null })).toBe(true);
  });

  test('recepción con permiso habla con doctor', () => {
    const recep = { id: 1, rol: 'recepcion', permisos: ['chat.usar'] };
    const doc = { id: 2, rol: 'doctor', permisos: null, activo: 1 };
    expect(puedeHablarCon(recep, doc)).toBe(true);
    expect(puedeHablarCon(doc, recep)).toBe(true);
  });

  test('doctores no se escriben entre sí', () => {
    const d1 = { id: 1, rol: 'doctor', permisos: null };
    const d2 = { id: 2, rol: 'doctor', permisos: null, activo: 1 };
    expect(puedeHablarCon(d1, d2)).toBe(false);
  });

  test('recepción sin permiso no habla', () => {
    const recep = { id: 1, rol: 'recepcion', permisos: null };
    const doc = { id: 2, rol: 'doctor', permisos: null, activo: 1 };
    expect(puedeHablarCon(recep, doc)).toBe(false);
  });

  test('recepción con permiso habla con otra recepción con permiso', () => {
    const a = { id: 1, rol: 'recepcion', permisos: ['chat.usar'] };
    const b = { id: 2, rol: 'auxiliar_recepcion', permisos: ['chat.usar'], activo: 1 };
    const c = { id: 3, rol: 'recepcion', permisos: null, activo: 1 };
    expect(puedeHablarCon(a, b)).toBe(true);
    expect(puedeHablarCon(a, c)).toBe(false);
  });

  test('helpers de rol', () => {
    expect(esRolRecepcion('auxiliar_recepcion')).toBe(true);
    expect(esRolDoctor('doctor')).toBe(true);
    expect(esRolDoctor('recepcion')).toBe(false);
  });
});
