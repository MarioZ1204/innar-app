const {
  detectarCamposFaltantes,
  nombreCompletoDesdePersona,
  sugerirNombresDesdeTexto,
  mergePersonaBodies,
  personaAPrefillComprobante,
  personaAPrefillCertificado
} = require('../utils/anexo-fidu-personas-docs');

describe('anexo-fidu-personas-docs', () => {
  test('detecta campos faltantes para comprobante', () => {
    const faltantes = detectarCamposFaltantes({
      numero_documento: '123',
      nombres_1: 'Juan',
      apellidos_1: 'Pérez',
      tipo_documento: 'CC'
    }, 'comprobante');
    expect(faltantes.map((f) => f.key)).toEqual(
      expect.arrayContaining(['fecha_nacimiento', 'direccion', 'telefono', 'correo', 'afiliacion'])
    );
  });

  test('tipo documento no falta si hay fecha de nacimiento', () => {
    const faltantes = detectarCamposFaltantes({
      numero_documento: '123',
      nombres_1: 'Ana',
      apellidos_1: 'López',
      fecha_nacimiento: '2010-05-01'
    }, 'certificado');
    expect(faltantes.find((f) => f.key === 'tipo_documento')).toBeUndefined();
  });

  test('correo notiene cuenta como vacío', () => {
    const faltantes = detectarCamposFaltantes({
      numero_documento: '1',
      nombres_1: 'A',
      apellidos_1: 'B',
      tipo_documento: 'CC',
      fecha_nacimiento: '1990-01-01',
      direccion: 'CLL 1',
      telefono: '300',
      correo: 'notiene@gmail.com',
      afiliacion: 'Cotizante'
    }, 'comprobante');
    expect(faltantes.find((f) => f.key === 'correo')).toBeDefined();
  });

  test('arma nombre completo y prefill comprobante', () => {
    const persona = {
      numero_documento: '99',
      nombres_1: 'MARIO',
      nombres_2: 'FERNANDO',
      apellidos_1: 'ZAMBRANO',
      apellidos_2: 'MEJIA',
      tipo_documento: 'CC',
      fecha_nacimiento: '2002-04-12',
      direccion: 'Calle 1',
      telefono: '3001234567',
      correo: 'a@b.com',
      afiliacion: 'Cotizante'
    };
    expect(nombreCompletoDesdePersona(persona)).toBe('MARIO FERNANDO ZAMBRANO MEJIA');
    const pre = personaAPrefillComprobante(persona, { servicio: 'EEG', fecha: '2026-05-27' });
    expect(pre.paciente_nombre).toBe('MARIO FERNANDO ZAMBRANO MEJIA');
    expect(pre.fecha_nacimiento).toBe('2002-04-12');
    expect(pre.servicio).toBe('EEG');
  });

  test('sugerir nombres desde texto de cita', () => {
    expect(sugerirNombresDesdeTexto('MARIO FERNANDO ZAMBRANO MEJIA')).toEqual({
      nombres_1: 'MARIO FERNANDO',
      nombres_2: '',
      apellidos_1: 'ZAMBRANO',
      apellidos_2: 'MEJIA'
    });
  });

  test('merge no pisa valores existentes con vacíos', () => {
    const merged = mergePersonaBodies(
      { numero_documento: '1', telefono: '300' },
      { telefono: '', correo: 'x@y.com' }
    );
    expect(merged.telefono).toBe('300');
    expect(merged.correo).toBe('x@y.com');
  });

  test('prefill certificado conserva datos de cita', () => {
    const pre = personaAPrefillCertificado(
      { numero_documento: '1', nombres_1: 'Ana', apellidos_1: 'Ruiz', tipo_documento: 'CC' },
      { motivo: 'Consulta', hora_ingreso: '08:00' }
    );
    expect(pre.motivo).toBe('Consulta');
    expect(pre.paciente_nombre).toBe('Ana Ruiz');
  });
});
