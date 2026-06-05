'use strict';

const { colorFilaPorCodigoServicio, COLOR_DEFAULT } = require('../utils/anexo-fidu-colores');

describe('anexo-fidu-colores', () => {
  test('polisomnografía — amarillo dorado', () => {
    expect(colorFilaPorCodigoServicio('891704')).toBe('FFEB9C');
  });

  test('psicología — crema', () => {
    expect(colorFilaPorCodigoServicio('890208')).toBe('FFF2CC');
  });

  test('neurología — verde', () => {
    expect(colorFilaPorCodigoServicio('890274')).toBe('E2EFDA');
  });

  test('código desconocido — blanco', () => {
    expect(colorFilaPorCodigoServicio('999999')).toBe(COLOR_DEFAULT);
  });

  test('53105 bloqueo — azul psiquiatría', () => {
    expect(colorFilaPorCodigoServicio('53105')).toBe('DAEEF3');
  });
});
