const {
  claveEntidad,
  totalesDesdeResumen,
  normalizarEntidadNombre
} = require('../utils/cupos-entidad-agenda');

describe('cupos-entidad-agenda helpers', () => {
  test('claveEntidad normaliza mayúsculas', () => {
    expect(claveEntidad('proinsalud')).toBe('PROINSALUD');
    expect(claveEntidad('  Sura  ')).toBe('SURA');
  });

  test('totalesDesdeResumen suma capacidad y libres', () => {
    const resumen = [
      { entidad: 'PROINSALUD', cupo_max: 10, ocupados: 7, libres: 3 },
      { entidad: 'SURA', cupo_max: 5, ocupados: 5, libres: 0 }
    ];
    const t = totalesDesdeResumen(resumen);
    expect(t.capacidad).toBe(15);
    expect(t.ocupados).toBe(12);
    expect(t.libres).toBe(3);
  });

  test('normalizarEntidadNombre recorta espacios', () => {
    expect(normalizarEntidadNombre('  UCQN ')).toBe('UCQN');
  });
});
