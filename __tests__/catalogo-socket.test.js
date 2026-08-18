'use strict';

jest.mock('../utils/socket-emitter', () => ({
  emit: jest.fn(),
  emitToUser: jest.fn(),
  init: jest.fn()
}));

const socketEmitter = require('../utils/socket-emitter');
const {
  EVENTOS_POR_TIPO,
  eventoCatalogo,
  emitCatalogoActualizado
} = require('../utils/catalogo-socket');

describe('catalogo-socket', () => {
  beforeEach(() => {
    socketEmitter.emit.mockClear();
  });

  test('mapea tipos de gestión a eventos de invalidación', () => {
    expect(eventoCatalogo('especialidades')).toBe('especialidades:actualizado');
    expect(eventoCatalogo('estudio_duraciones')).toBe('estudio:actualizado');
    expect(eventoCatalogo('diagnosticos')).toBe('diagnosticos:actualizado');
    expect(eventoCatalogo('tipos_consulta')).toBe('tipos-consulta:actualizado');
    expect(eventoCatalogo('entidades')).toBe('entidades:actualizado');
    expect(eventoCatalogo('citas_electro')).toBeNull();
  });

  test('emitCatalogoActualizado emite el evento y extra', () => {
    expect(emitCatalogoActualizado('especialidades', { id: 9 })).toBe(true);
    expect(socketEmitter.emit).toHaveBeenCalledWith('especialidades:actualizado', { id: 9 });
  });

  test('emitCatalogoActualizado no emite tipos operativos', () => {
    expect(emitCatalogoActualizado('turnos', { id: 1 })).toBe(false);
    expect(socketEmitter.emit).not.toHaveBeenCalled();
  });

  test('todos los eventos de catálogo terminan en actualizado', () => {
    Object.values(EVENTOS_POR_TIPO).forEach((ev) => {
      expect(ev).toMatch(/actualizado$/);
    });
  });
});
