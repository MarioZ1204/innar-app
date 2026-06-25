const fs = require('fs');
const path = require('path');
const os = require('os');

jest.mock('../utils/soportes-armado-structure', () => {
  const actual = jest.requireActual('../utils/soportes-armado-structure');
  return {
    ...actual,
    getArmadoFeDirAbs: jest.fn((root, periodo, diaNombre, estadoFacturacion, tipoContenedor, codigo) => {
      const path = require('path');
      const fs = require('fs');
      const abs = path.join(root, String(tipoContenedor || 'rips'), String(codigo || 'FE0'));
      fs.mkdirSync(abs, { recursive: true });
      return { abs, rel: path.join(String(tipoContenedor || 'rips'), String(codigo || 'FE0')).replace(/\\/g, '/') };
    })
  };
});

const soporteRipsSync = require('../utils/soportes-rips-carpetas-sync');
const { ensureRipsCarpetaFacturaEnDisco, syncRipsCarpetasDias } = soporteRipsSync;

describe('ensureRipsCarpetaFacturaEnDisco', () => {
  test('crea la carpeta espejo sin marcador de carpeta', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sop-rips-sync-'));
    process.env.UPLOADS_DIR = tempRoot;

    const db = {
      query: jest.fn().mockResolvedValue([{ nombre_display: 'JUNIO 1', estado_facturacion: 'a_facturar', periodo: '2026-06' }])
    };

    const abs = await ensureRipsCarpetaFacturaEnDisco(db, 77, 'FE12');

    expect(abs).toBeTruthy();
    expect(fs.existsSync(abs)).toBe(true);
    expect(fs.existsSync(path.join(abs, '_CARPETA_FACTURA.txt'))).toBe(false);
    expect(fs.readdirSync(abs)).toEqual([]);
  });

  test('procesa todos los días indicados', async () => {
    const db = { query: jest.fn() };
    const calls = [];
    const original = soporteRipsSync.syncRipsCarpetasDia;
    soporteRipsSync.syncRipsCarpetasDia = async (dbRef, diaId, usuarioId) => {
      calls.push({ diaId, usuarioId });
      return [{ codigo: 'FE1', ruta: `/tmp/${diaId}` }];
    };

    try {
      const result = await syncRipsCarpetasDias(db, [3, 7], 99);
      expect(calls).toEqual([{ diaId: 3, usuarioId: 99 }, { diaId: 7, usuarioId: 99 }]);
      expect(result).toHaveLength(2);
    } finally {
      soporteRipsSync.syncRipsCarpetasDia = original;
    }
  });
});
