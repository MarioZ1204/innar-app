const { zipEntryOptions, facturaFolderName, getSopZipWorkDir, filterValidZipEntries } = require('../utils/soportes-armado-zip');

describe('soportes-armado-zip', () => {
  test('usa store para PDF (ya comprimidos)', () => {
    expect(zipEntryOptions('/tmp/OPF_901164565_FE14726.pdf')).toEqual({ store: true });
    expect(zipEntryOptions('/tmp/datos.json')).toEqual({});
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
});
