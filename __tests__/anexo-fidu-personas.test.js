const {
  limpiarDireccionRepetida,
  mapCsvRowToPersona,
  parsePersonasCsvContent,
  personaToAnexoPaciente,
  anexoRegistroToPersona,
  armarRegistroAnexo
} = require('../utils/anexo-fidu-personas');

describe('anexo-fidu-personas', () => {
  test('limpia repeticiones en columna J (dirección)', () => {
    const raw = 'MZ B CASA 7 AQUINE ALTO 1 AQUINE ALTO 1 AQUINE ALTO 1 AQUINE ALTO 1';
    expect(limpiarDireccionRepetida(raw)).toBe('MZ B CASA 7 AQUINE ALTO 1');
    expect(limpiarDireccionRepetida('PEÑOL EL PEÑOL EL PEÑOL')).toBe('PEÑOL EL PEÑOL');
  });

  test('normaliza correo con coma y arma dirección con barrio', () => {
    const p = mapCsvRowToPersona([
      '1004411154', 'ADRIANA', 'MERCEDES', 'GELPUD', 'TULCAN', 'CC', '2001-10-15',
      'PASTO (NARIÑO, COLOMBIA)', 'FEMENINO', 'CATAMBUCO', 'CATAMBUCO',
      'PASTO (NARIÑO, COLOMBIA)', '3135624077', 'ADRIANATHT23@GMAIL,COM', ''
    ]);
    expect(p.correo).toBe('ADRIANATHT23@GMAIL.COM');
    expect(p.direccion).toBe('CATAMBUCO');
    expect(p.genero).toBe('FEMENINO');
  });

  test('parsea CSV y omite documentos duplicados', () => {
    const csv = `NUMERODOCUMENTO,NOMBRES,,APELLIDOS,,TIPODOCUMENTO,FECHANACIMIENTO,CIUDADDENACIMIENTO,GENERO,DIRECCION,BARRIO,CIUDADDERESIDENCIA,TELEFONO,CORREO,AFILIACION
123,Juan,,Perez,,CC,1990-01-01,Pasto,MASCULINO,CLL 1,CENTRO,Pasto,300,,
123,Pedro,,Lopez,,CC,1991-01-01,Pasto,MASCULINO,CLL 2,CENTRO,Pasto,301,,`;
    const { personas, errores } = parsePersonasCsvContent(csv);
    expect(personas).toHaveLength(1);
    expect(errores.some((e) => e.includes('duplicado'))).toBe(true);
  });

  test('armarRegistroAnexo combina persona y servicio PSG', () => {
    const { registro, servicio_encontrado } = armarRegistroAnexo('27486786', '891704', {
      numero_documento: '27486786',
      nombres_1: 'MERCEDES',
      apellidos_1: 'ARGOTY',
      fecha_nacimiento: '1961-10-26',
      ciudad_residencia: 'PASTO (NARIÑO, COLOMBIA)'
    });
    expect(servicio_encontrado).toBe(true);
    expect(registro.nombres_1).toBe('MERCEDES');
    expect(registro.codigo_servicio).toBe('891704');
    expect(registro.nit).toBe('901164565-1');
    expect(registro.valor_unitario).toBe('$ 1.564.355');
  });

  test('anexoRegistroToPersona separa barrio de dirección', () => {
    const p = anexoRegistroToPersona({
      numero_documento: '1',
      direccion: 'CLL 1 — CENTRO',
      especiales_excepcion_cotizante: 'Cotizante'
    });
    expect(p.direccion).toBe('CLL 1');
    expect(p.barrio).toBe('CENTRO');
    expect(p.afiliacion).toBe('Cotizante');
  });

  test('personaToAnexoPaciente divide campos del anexo', () => {
    const anexo = personaToAnexoPaciente({
      numero_documento: '27486786',
      nombres_1: 'MERCEDES',
      nombres_2: 'DEL SOCORRO',
      apellidos_1: 'ARGOTY',
      apellidos_2: 'CHAVEZ',
      tipo_documento: 'CC',
      fecha_nacimiento: '1961-10-26',
      genero: 'FEMENINO',
      direccion: 'CLL 22 # 38/47 — MORASURCO',
      telefono: '3167454370',
      correo: '',
      afiliacion: '',
      ciudad_nacimiento: 'TANGUA',
      ciudad_residencia: 'PASTO'
    });
    expect(anexo.nombres_1).toBe('MERCEDES');
    expect(anexo.numero_documento).toBe('27486786');
    expect(Number(anexo.edad)).toBeGreaterThan(50);
  });

  test('personaToAnexoPaciente une barrio en direccion y conserva correo', () => {
    const anexo = personaToAnexoPaciente({
      numero_documento: '123',
      nombres_1: 'JUAN',
      apellidos_1: 'PEREZ',
      fecha_nacimiento: '1990-01-01',
      direccion: 'CALLE 10',
      barrio: 'MARILUZ',
      correo: 'test@mail.com',
      afiliacion: 'Especiales o de Excepcion cotizante'
    });
    expect(anexo.direccion).toBe('CALLE 10 — MARILUZ');
    expect(anexo.correo).toBe('test@mail.com');
    expect(anexo.especiales_excepcion_cotizante).toBe('Especiales o de Excepcion cotizante');
  });
});
