const fs = require('fs');
const path = require('path');
const {
  zipEntryOptions,
  facturaFolderName,
  getSopZipWorkDir,
  filterValidZipEntries,
  listExpedienteFolderExtras
} = require('../utils/soportes-armado-zip');
const { getArmadoFeDirFromContext } = require('../utils/soportes-storage');

describe('soportes-armado-zip', () => {
  test('usa store para PDF (ya comprimidos)', () => {
    expect(zipEntryOptions('/tmp/OPF_901164565_FE14726.pdf')).toEqual({ store: true });
    expect(zipEntryOptions('/tmp/datos.json')).toEqual({});
  });

  test('expedienteZipSegment usa codigo de carpeta FE (no agrupa por numero_factura)', () => {
    const { expedienteZipSegment } = require('../utils/soportes-armado-zip');
    expect(expedienteZipSegment({ codigo: 'FE14726', numero_factura: 99999 })).toBe('FE14726');
    expect(expedienteZipSegment({ codigo: 'PEREZ_JUAN', numero_factura: 14726 })).toBe('PEREZ_JUAN');
  });

  test('carpeta ZIP agrupa por FE cuando hay factura vinculada', () => {
    expect(facturaFolderName({ numero_factura: 14726, codigo: 'FE14726' })).toBe('FE14726');
    expect(facturaFolderName({ numero_factura: 0, codigo: 'PEREZ_JUAN' })).toBe('PEREZ_JUAN');
  });

  test('getSopZipWorkDir usa carpeta bajo uploads', () => {
    const dir = getSopZipWorkDir();
    expect(dir).toMatch(/sop-zip-jobs$/);
  });

  test('filterValidZipEntries omite rutas inexistentes', () => {
    const out = filterValidZipEntries([
      { absPath: __filename, name: 'ok.txt' },
      { absPath: '/no/existe/archivo.pdf', name: 'bad.pdf' }
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('ok.txt');
  });

  test('listExpedienteFolderExtras recupera del disco archivos sin registro válido en BD', () => {
    const ctx = {
      periodo: 'TEST-ZIP-2026',
      nombre_display: 'DIA_TEST_ZIP',
      estado_facturacion: 'a_facturar',
      contenedor_tipo: 'soportes'
    };
    const codigo = 'FE_TEST_ZIP_99';
    const { abs } = getArmadoFeDirFromContext(ctx, codigo);
    const huerfano = path.join(abs, 'OPF_900000000_FE_TEST_ZIP_99.pdf');
    const yaIncluido = path.join(abs, 'CRC_900000000_FE_TEST_ZIP_99.pdf');
    fs.writeFileSync(huerfano, 'contenido');
    fs.writeFileSync(yaIncluido, 'contenido');

    try {
      const usedPaths = new Set();
      const already = new Set([path.resolve(yaIncluido)]);
      const extras = listExpedienteFolderExtras(ctx, codigo, 'SOPORTES/FE_TEST_ZIP_99', usedPaths, already);
      expect(extras).toHaveLength(1);
      expect(extras[0].absPath).toBe(huerfano);
      expect(extras[0].name).toBe('SOPORTES/FE_TEST_ZIP_99/OPF_900000000_FE_TEST_ZIP_99.pdf');
    } finally {
      fs.rmSync(abs, { recursive: true, force: true });
    }
  });
});
