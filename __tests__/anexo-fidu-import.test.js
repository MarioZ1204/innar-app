const { mapSheetsRowToAnexoFidu } = require('../utils/anexo-fidu-import');
const { ANEXO_FIDU_COLUMNAS } = require('../utils/anexo-fidu-columns');

describe('anexo-fidu-import', () => {
  test('mapea columnas Sheets a anexo y parte nombres', () => {
    const row = mapSheetsRowToAnexoFidu({
      NUMERODOCUMENTO: '123456',
      NOMBRES: 'Juan Carlos',
      APELLIDOS: 'Perez Lopez',
      TIPODOCUMENTO: 'CC',
      FECHANACIMIENTO: '1990-05-15',
      GENERO: 'Masculino',
      DIRECCION: 'Calle 1',
      BARRIO: 'Centro',
      CIUDADDERESIDENCIA: 'Pasto',
      TELEFONO: '3001234567',
      CORREO: 'a@b.com',
      AFILIACION: 'Cotizante'
    });
    expect(row.numero_documento).toBe('123456');
    expect(row.nombres_1).toBe('Juan');
    expect(row.nombres_2).toBe('Carlos');
    expect(row.apellidos_1).toBe('Perez');
    expect(row.apellidos_2).toBe('Lopez');
    expect(row.tipo_documento).toBe('CC');
    expect(row.direccion).toContain('Centro');
    expect(row.especiales_excepcion_cotizante).toBe('Cotizante');
  });

  test('plantilla tiene 46 columnas', () => {
    expect(ANEXO_FIDU_COLUMNAS.length).toBe(46);
  });

  test('importa con código de servicio y aplica catálogo', () => {
    const row = mapSheetsRowToAnexoFidu({
      NUMERODOCUMENTO: '999',
      NOMBRES: 'Ana',
      APELLIDOS: 'Ruiz',
      CODIGOSERVICIO: '891704'
    });
    expect(row.codigo_servicio).toBe('891704');
    expect(row.nit).toBe('901164565-1');
    expect(row.valor_unitario).toBe('$ 1.564.355');
    expect(row.codigo_servicio_referencia).toBe('327');
  });
});
