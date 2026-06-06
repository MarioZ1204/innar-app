'use strict';

const { colorFilaPorCodigoServicio, COLOR_DEFAULT } = require('../utils/anexo-fidu-colores');

describe('anexo-fidu-colores', () => {
  test('polisomnografía — amarillo pastel', () => {
    expect(colorFilaPorCodigoServicio('891704')).toBe('FFF5E0');
  });

  test('psicología — crema pastel', () => {
    expect(colorFilaPorCodigoServicio('890208')).toBe('FFF9ED');
  });

  test('neurología — verde pastel', () => {
    expect(colorFilaPorCodigoServicio('890274')).toBe('EEF6EB');
  });

  test('código desconocido — blanco', () => {
    expect(colorFilaPorCodigoServicio('999999')).toBe(COLOR_DEFAULT);
  });

  test('53105 bloqueo — azul pastel', () => {
    expect(colorFilaPorCodigoServicio('53105')).toBe('E8F3F8');
  });
});
