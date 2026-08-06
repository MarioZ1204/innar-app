const {
  RECIBO_FILTRO_OTROS_CONSULTA,
  separarValoresUsadosEnOtros,
  expandirSeleccionFiltroServicio,
  tipoServicioCoincideCatalogo
} = require('../utils/recibos-catalogo-filtros');

describe('recibos-catalogo-filtros', () => {
  test('detecta valores fuera del catálogo de consulta', () => {
    const otros = separarValoresUsadosEnOtros(
      ['Control', 'Servicio raro XYZ'],
      ['Primera vez', 'Control']
    );
    expect(otros).toEqual(['Servicio raro XYZ']);
  });

  test('expandir Otros incluye lista de valores misceláneos', () => {
    const expanded = expandirSeleccionFiltroServicio(
      [RECIBO_FILTRO_OTROS_CONSULTA],
      RECIBO_FILTRO_OTROS_CONSULTA,
      ['A', 'B']
    );
    expect(expanded).toEqual(['A', 'B']);
  });

  test('coincidencia flexible por nombre', () => {
    expect(tipoServicioCoincideCatalogo('control de seguimiento', ['Control'])).toBe(true);
    expect(tipoServicioCoincideCatalogo('Otro concepto', ['Control'])).toBe(false);
  });

  test('estudioServicioCoincide une PSG y Polisomnografía del mismo subtipo', () => {
    const { estudioServicioCoincide } = require('../utils/recibos-catalogo-filtros');
    expect(estudioServicioCoincide('Polisomnografía Básica', 'PSG Básica')).toBe(true);
    expect(estudioServicioCoincide('PSG Básica', 'PSG CPAP')).toBe(false);
  });
});
