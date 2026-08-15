const {
  colVisibleTiposConsulta,
  colVisibleEntidades,
  sqlAndVisible,
  parseFlag
} = require('../utils/catalogo-visibilidad');

describe('catalogo-visibilidad', () => {
  test('mapea uso a columna de tipos de consulta', () => {
    expect(colVisibleTiposConsulta('agenda')).toBe('visible_agenda');
    expect(colVisibleTiposConsulta('comprobante')).toBe('visible_comprobante');
    expect(colVisibleTiposConsulta('recibo')).toBe('visible_recibo');
    expect(colVisibleTiposConsulta('otro')).toBeNull();
  });

  test('mapea uso a columna de entidades', () => {
    expect(colVisibleEntidades('electro')).toBe('visible_electro');
    expect(colVisibleEntidades('agenda')).toBe('visible_agenda');
    expect(colVisibleEntidades('')).toBeNull();
  });

  test('sqlAndVisible solo acepta columnas ya resueltas', () => {
    expect(sqlAndVisible('visible_agenda')).toBe(' AND COALESCE(visible_agenda, 1) = 1');
    expect(sqlAndVisible(null)).toBe('');
  });

  test('parseFlag interpreta booleanos y defaults', () => {
    expect(parseFlag(undefined, 1)).toBe(1);
    expect(parseFlag(false, 1)).toBe(0);
    expect(parseFlag(true, 0)).toBe(1);
    expect(parseFlag('0', 1)).toBe(0);
  });
});
