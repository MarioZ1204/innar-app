const {
  normalizarModoDia,
  contenedoresTiposForModo,
  CONTENEDORAS_RAIZ,
  fetchModoParentContenedora,
  nombreCarpetaPersonaDesdePdx,
  nombreCarpetaPersonaUcqn
} = require('../utils/soportes-armado-modos');

describe('soportes-armado-modos', () => {
  test('normalizarModoDia', () => {
    expect(normalizarModoDia('ucqn')).toBe('ucqn');
    expect(normalizarModoDia('anexo_fidu')).toBe('anexo_fidu');
    expect(normalizarModoDia('otro')).toBe('facturacion');
  });

  test('contenedoresTiposForModo', () => {
    expect(contenedoresTiposForModo('facturacion')).toEqual(['rips', 'soportes']);
    expect(contenedoresTiposForModo('ucqn')).toEqual(['soportes']);
    expect(contenedoresTiposForModo('anexo_fidu')).toEqual([]);
  });

  test('CONTENEDORAS_RAIZ tiene tres modos fijos', () => {
    expect(CONTENEDORAS_RAIZ).toHaveLength(3);
    expect(CONTENEDORAS_RAIZ.map((c) => c.modo).sort()).toEqual(['anexo_fidu', 'facturacion', 'ucqn']);
  });

  test('fetchModoParentContenedora usa el modo de la contenedora raíz', async () => {
    const rows = {
      1: { id: 1, parent_id: 0, modo: 'ucqn', es_contenedor: 1 },
      2: { id: 2, parent_id: 1, modo: 'facturacion', es_contenedor: 1 },
      3: { id: 3, parent_id: 2, modo: 'facturacion', es_contenedor: 0 }
    };
    const db = {
      query: async (_sql, params) => {
        const row = rows[params[0]];
        return row ? [row] : [];
      }
    };
    expect(await fetchModoParentContenedora(db, 3)).toBe('ucqn');
    expect(await fetchModoParentContenedora(db, 2)).toBe('ucqn');
    expect(await fetchModoParentContenedora(db, 1)).toBe('ucqn');
  });

  test('nombreCarpetaPersonaDesdePdx usa paciente, si no el archivo', () => {
    expect(nombreCarpetaPersonaDesdePdx({ paciente_nombre: '  Ana Gómez  ' })).toBe('Ana Gómez');
    expect(nombreCarpetaPersonaDesdePdx({
      nombre_archivo_original: 'PSG_Juan_Perez_123.pdf'
    })).toBe('PSG_Juan_Perez_123');
    expect(nombreCarpetaPersonaUcqn('')).toBe('Persona');
  });
});
