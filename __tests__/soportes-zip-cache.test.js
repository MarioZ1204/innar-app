jest.mock('../utils/db-mysql', () => ({
  query: jest.fn(),
  execute: jest.fn()
}));

const fs = require('fs');
const os = require('os');
const path = require('path');

describe('soportes-zip-cache: publicación sin bloquear el servidor', () => {
  let uploadsDir;
  let cache;
  let db;

  beforeAll(() => {
    uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'innar-zipcache-'));
    process.env.UPLOADS_DIR = uploadsDir;
    jest.resetModules();
    // Tras resetModules el módulo usa una instancia nueva del mock: tomar la misma.
    cache = require('../utils/soportes-zip-cache');
    db = require('../utils/db-mysql');
  });

  afterAll(() => {
    delete process.env.UPLOADS_DIR;
    try { fs.rmSync(uploadsDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  });

  beforeEach(() => {
    db.query.mockReset();
    db.query.mockResolvedValue([{ file_count: 3, exp_count: 1, max_ts: 1700000000 }]);
  });

  test('no usa copia síncrona: copyFileSync nunca se invoca', async () => {
    const spy = jest.spyOn(fs, 'copyFileSync');
    const src = path.join(uploadsDir, 'origen-a.zip');
    fs.writeFileSync(src, 'contenido-zip-a');

    await cache.saveToCacheForSpec({ kind: 'dia', diaId: 41 }, src, 'dia-41.zip');

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  test('publica el ZIP en caché con el mismo contenido y guarda el manifiesto', async () => {
    const src = path.join(uploadsDir, 'origen-b.zip');
    fs.writeFileSync(src, 'contenido-zip-b');

    await cache.saveToCacheForSpec({ kind: 'dia', diaId: 42 }, src, 'dia-42.zip');

    const { zipPath, manifestPath } = cache.cachePaths(cache.jobCacheId({ kind: 'dia', diaId: 42 }));
    expect(fs.existsSync(zipPath)).toBe(true);
    expect(fs.readFileSync(zipPath, 'utf8')).toBe('contenido-zip-b');

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    expect(manifest.filename).toBe('dia-42.zip');
    expect(manifest.kind).toBe('dia');
  });

  test('borrar el ZIP temporal del job no destruye el de caché', async () => {
    const src = path.join(uploadsDir, 'origen-c.zip');
    fs.writeFileSync(src, 'contenido-zip-c');

    await cache.saveToCacheForSpec({ kind: 'expediente', expedienteId: 7 }, src, 'exp-7.zip');
    fs.unlinkSync(src);

    const { zipPath } = cache.cachePaths(cache.jobCacheId({ kind: 'expediente', expedienteId: 7 }));
    expect(fs.existsSync(zipPath)).toBe(true);
    expect(fs.readFileSync(zipPath, 'utf8')).toBe('contenido-zip-c');
  });

  test('regenerar sobre una caché existente la reemplaza', async () => {
    const spec = { kind: 'contenedor', contenedorId: 12 };
    const { zipPath } = cache.cachePaths(cache.jobCacheId(spec));

    const src1 = path.join(uploadsDir, 'origen-d1.zip');
    fs.writeFileSync(src1, 'v1');
    await cache.saveToCacheForSpec(spec, src1, 'cont-12.zip');
    expect(fs.readFileSync(zipPath, 'utf8')).toBe('v1');

    const src2 = path.join(uploadsDir, 'origen-d2.zip');
    fs.writeFileSync(src2, 'v2-mas-largo');
    await cache.saveToCacheForSpec(spec, src2, 'cont-12.zip');
    expect(fs.readFileSync(zipPath, 'utf8')).toBe('v2-mas-largo');
  });
});
