const { zipEntryOptions, facturaFolderName } = require('../utils/soportes-armado-zip');

describe('soportes-armado-zip', () => {
  test('usa store para PDF (ya comprimidos)', () => {
    expect(zipEntryOptions('/tmp/OPF_901164565_FE14726.pdf')).toEqual({ store: true });
    expect(zipEntryOptions('/tmp/datos.json')).toEqual({});
  });

  test('carpeta ZIP agrupa por FE cuando hay factura vinculada', () => {
    expect(facturaFolderName({ numero_factura: 14726, codigo: 'FE14726' })).toBe('FE14726');
    expect(facturaFolderName({ numero_factura: 0, codigo: 'PEREZ_JUAN' })).toBe('PEREZ_JUAN');
  });
});
