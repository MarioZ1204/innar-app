const {
  mapSheetsRowToAnexoFidu,
  calcularTipoDocumentoDesdeFecha,
  aplicarCamposCombinadosImport
} = require('../utils/anexo-fidu-import');
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

  test('calcularTipoDocumentoDesdeFecha', () => {
    const hoy = new Date();
    const yChild = hoy.getFullYear() - 5;
    const yTeen = hoy.getFullYear() - 12;
    const yAdult = hoy.getFullYear() - 30;
    expect(calcularTipoDocumentoDesdeFecha(`${yChild}-01-15`)).toBe('REGISTRO CIVIL');
    expect(calcularTipoDocumentoDesdeFecha(`${yTeen}-06-01`)).toBe('TI');
    expect(calcularTipoDocumentoDesdeFecha(`${yAdult}-03-10`)).toBe('CC');
  });

  test('aplicarCamposCombinadosImport parte nombres y barrio', () => {
    const out = aplicarCamposCombinadosImport(
      { direccion: 'CALLE 1', fecha_nacimiento: '2010-05-01' },
      { nombresRaw: 'Ana Maria', apellidosRaw: 'Lopez Ruiz', barrioRaw: 'CENTRO' }
    );
    expect(out.nombres_1).toBe('Ana');
    expect(out.nombres_2).toBe('Maria');
    expect(out.apellidos_1).toBe('Lopez');
    expect(out.apellidos_2).toBe('Ruiz');
    expect(out.direccion).toContain('CENTRO');
    expect(out.tipo_documento).toBe('TI');
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
