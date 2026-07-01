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
const { getArmadoFeDirAbs, ensureFeParEnContenedorHermano } = require('../utils/soportes-armado-structure');
const { ensureRipsCarpetaFacturaEnDisco, syncRipsCarpetasDias, syncRipsCarpetasContenedor } = soporteRipsSync;

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

  test('usa la etiqueta visible del periodo para la ruta de RIPS', async () => {
    const db = {
      query: jest.fn().mockResolvedValue([{ nombre_display: 'JUNIO 1', estado_facturacion: 'a_facturar', periodo: '2026-06', periodo_etiqueta: 'JUNIO 2026' }])
    };

    await ensureRipsCarpetaFacturaEnDisco(db, 77, 'FE12');

    expect(getArmadoFeDirAbs).toHaveBeenCalledWith(expect.anything(), 'JUNIO 2026', 'JUNIO 1', 'a_facturar', 'rips', 'FE12');
  });

  test('crea la carpeta espejo cruzada en RIPS usando etiqueta de periodo', async () => {
    const db = {
      query: jest.fn((sql, params) => {
        const q = String(sql || '').toLowerCase();
        if (q.includes('select tipo from sop_contenedores where id = ?')) {
          return Promise.resolve([{ tipo: 'soportes' }]);
        }
        if (q.includes('select id from sop_contenedores where dia_id = ? and tipo = ?')) {
          return Promise.resolve([{ id: 99 }]);
        }
        if (q.includes('select id from sop_expedientes where contenedor_id = ? and codigo = ?')) {
          return Promise.resolve([]);
        }
        if (q.includes('select c.tipo as contenedor_tipo')) {
          return Promise.resolve([{ contenedor_tipo: 'rips', nombre_display: 'JUNIO 1', estado_facturacion: 'a_facturar', periodo: '2026-06', periodo_etiqueta: 'JUNIO 2026' }]);
        }
        return Promise.resolve([]);
      }),
      execute: jest.fn().mockResolvedValue({ insertId: 123 })
    };

    await ensureFeParEnContenedorHermano(db, 77, 12, 'FE12', 12, 'electro', 5, 'Ana');

    expect(getArmadoFeDirAbs).toHaveBeenCalledWith(expect.anything(), 'JUNIO 2026', 'JUNIO 1', 'a_facturar', 'rips', 'FE12');
    expect(db.execute).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO sop_expedientes'), expect.any(Array));
  });

  test('preserva el código FE actual del expediente al migrar', () => {
    const exp = { codigo: 'FE14730', numero_factura: 0, paciente_nombre: 'Mario Zambrano' };
    expect(soporteRipsSync.codigoFacturaDesdeExp(exp)).toBe('FE14730');
  });

  test('migración por contenedor solo procesa las carpetas FE de ese contenedor', async () => {
    const db = {
      query: jest.fn(function (sql, params) {
        if (String(sql).includes('SELECT id, dia_id, tipo FROM sop_contenedores')) {
          return Promise.resolve([{ id: 12, dia_id: 3, tipo: 'soportes' }]);
        }
        if (String(sql).includes('SELECT modo FROM sop_dias')) {
          return Promise.resolve([{ modo: 'facturacion' }]);
        }
        if (String(sql).includes('SELECT id FROM sop_contenedores WHERE dia_id')) {
          return Promise.resolve([{ id: 99, tipo: 'rips' }]);
        }
        if (String(sql).includes('FROM sop_expedientes e')) {
          const filtered = Array.isArray(params) && params[0] === 12
            ? [{ id: 1, dia_id: 3, contenedor_id: 12, numero_factura: 100, codigo: 'FE100', tipo_servicio: 'electro', creado_por: 9, paciente_nombre: 'Ana' }]
            : [{ id: 2, dia_id: 3, contenedor_id: 99, numero_factura: 101, codigo: 'FE101', tipo_servicio: 'electro', creado_por: 9, paciente_nombre: 'Luis' }];
          return Promise.resolve(filtered);
        }
        return Promise.resolve([]);
      })
    };

    const result = await syncRipsCarpetasContenedor(db, 12, 55);

    const expedienteQuery = db.query.mock.calls.find((call) => String(call[0]).includes('FROM sop_expedientes e'));
    expect(expedienteQuery).toBeDefined();
    expect(expedienteQuery[1]).toEqual([12]);
    expect(result).toHaveLength(1);
    expect(result[0].codigo).toBe('FE100');
  });
});
