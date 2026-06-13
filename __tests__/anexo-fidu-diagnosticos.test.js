const {
  normCie10,
  lookupDiagnosticoExactoDb,
  lookupDiagnosticoDb
} = require('../utils/anexo-fidu-diagnosticos');

describe('anexo-fidu-diagnosticos', () => {
  test('normCie10 normaliza mayúsculas y quita puntos', () => {
    expect(normCie10('g47.0')).toEqual({ raw: 'g47.0', norm: 'G47.0', flat: 'G470' });
  });

  test('lookup exacto no consulta por prefijo', async () => {
    const db = { query: jest.fn().mockResolvedValueOnce([]) };
    const r = await lookupDiagnosticoExactoDb(db, 'G47');
    expect(r.nombre).toBe('');
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  test('lookup con prefijo sí encuentra hijos (autocompletar)', async () => {
    const db = {
      query: jest.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ codigo: 'G470', nombre: 'Insomnio', descripcion: 'Insomnio' }])
    };
    const r = await lookupDiagnosticoDb(db, 'G47');
    expect(r.nombre).toBe('Insomnio');
    expect(db.query).toHaveBeenCalledTimes(2);
  });

  test('soloExacto evita búsqueda por prefijo', async () => {
    const db = {
      query: jest.fn().mockResolvedValueOnce([])
    };
    const r = await lookupDiagnosticoDb(db, 'G47', { soloExacto: true });
    expect(r.nombre).toBe('');
    expect(db.query).toHaveBeenCalledTimes(1);
  });
});
