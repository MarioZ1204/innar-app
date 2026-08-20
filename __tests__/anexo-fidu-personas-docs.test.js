const {
  detectarCamposFaltantes,
  nombreCompletoDesdePersona,
  sugerirNombresDesdeTexto,
  mergePersonaBodies,
  personaAPrefillComprobante,
  personaAPrefillCertificado,
  personaBodyDesdeComprobanteModal,
  personaBodyDesdeCertificadoModal
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

  test('prefill comprobante incluye firma guardada', () => {
    const firma = 'data:image/png;base64,abc';
    const pre = personaAPrefillComprobante(
      { numero_documento: '1', nombres_1: 'Ana', apellidos_1: 'Ruiz', firma_paciente: firma },
      {}
    );
    expect(pre.firma_paciente).toBe(firma);
  });

  test('prefill comprobante incluye firma y datos del acudiente', () => {
    const firma = 'data:image/png;base64,acud';
    const pre = personaAPrefillComprobante(
      {
        numero_documento: '1',
        nombres_1: 'Ana',
        apellidos_1: 'Ruiz',
        firma_acudiente: firma,
        acudiente_nombre: 'María Ruiz',
        parentesco: 'Madre'
      },
      {}
    );
    expect(pre.firma_acudiente).toBe(firma);
    expect(pre.acudiente_nombre).toBe('María Ruiz');
    expect(pre.parentesco).toBe('Madre');
  });

  test('merge no duplica nombres_2/apellidos_2 viejos al recalcular el nombre completo', () => {
    const existente = {
      numero_documento: '1',
      nombres_1: 'JUAN',
      nombres_2: 'CARLOS',
      apellidos_1: 'PEREZ',
      apellidos_2: 'GOMEZ'
    };
    const incoming = {
      numero_documento: '1',
      ...sugerirNombresDesdeTexto('JUAN CARLOS PEREZ GOMEZ')
    };
    const merged = mergePersonaBodies(existente, incoming);
    expect(merged.nombres_1).toBe('JUAN CARLOS');
    expect(merged.nombres_2).toBe('');
    expect(merged.apellidos_1).toBe('PEREZ');
    expect(merged.apellidos_2).toBe('GOMEZ');
  });

  test('merge conserva firma existente si no llega una nueva', () => {
    const firma = 'data:image/png;base64,xyz';
    const merged = mergePersonaBodies(
      { numero_documento: '1', firma_paciente: firma },
      { telefono: '300' }
    );
    expect(merged.firma_paciente).toBe(firma);
    expect(merged.telefono).toBe('300');
  });

  test('merge conserva firma y datos del acudiente si no llegan nuevos', () => {
    const firma = 'data:image/png;base64,acud';
    const merged = mergePersonaBodies(
      {
        numero_documento: '1',
        firma_acudiente: firma,
        acudiente_nombre: 'María Ruiz',
        parentesco: 'Madre'
      },
      { telefono: '300' }
    );
    expect(merged.firma_acudiente).toBe(firma);
    expect(merged.acudiente_nombre).toBe('María Ruiz');
    expect(merged.parentesco).toBe('Madre');
    expect(merged.telefono).toBe('300');
  });

  test('merge reemplaza firma del acudiente cuando llega una nueva', () => {
    const merged = mergePersonaBodies(
      {
        numero_documento: '1',
        firma_acudiente: 'data:image/png;base64,vieja',
        acudiente_nombre: 'María',
        parentesco: 'Madre'
      },
      {
        firma_acudiente: 'data:image/png;base64,nueva',
        acudiente_nombre: 'Pedro Ruiz',
        parentesco: 'Padre'
      }
    );
    expect(merged.firma_acudiente).toBe('data:image/png;base64,nueva');
    expect(merged.acudiente_nombre).toBe('Pedro Ruiz');
    expect(merged.parentesco).toBe('Padre');
  });

  test('personaBodyDesdeComprobanteModal mapea campos del modal', () => {
    const body = personaBodyDesdeComprobanteModal({
      paciente_nombre: 'MARIO FERNANDO ZAMBRANO MEJIA',
      paciente_documento: '123',
      tipo_documento: 'CC',
      fecha_nacimiento: '2002-04-12',
      direccion: 'Calle 1',
      telefono: '300',
      correo: 'a@b.com',
      tipo_afiliacion: 'Cotizante',
      firma_paciente: 'data:image/png;base64,abc',
      firma_acudiente: 'data:image/png;base64,acud',
      acudiente_nombre: 'María Ruiz',
      parentesco: 'Madre'
    });
    expect(body.numero_documento).toBe('123');
    expect(body.nombres_1).toBe('MARIO FERNANDO');
    expect(body.afiliacion).toBe('COTIZANTE');
    expect(body.firma_paciente).toBe('data:image/png;base64,abc');
    expect(body.firma_acudiente).toBe('data:image/png;base64,acud');
    expect(body.acudiente_nombre).toBe('María Ruiz');
    expect(body.parentesco).toBe('Madre');
  });

  test('personaBodyDesdeComprobanteModal no pisa afiliación especial del Anexo', () => {
    const body = personaBodyDesdeComprobanteModal({
      paciente_nombre: 'Ana Ruiz',
      paciente_documento: '99',
      tipo_documento: 'CC',
      fecha_nacimiento: '1990-01-01',
      direccion: 'Calle 1',
      telefono: '300',
      correo: 'a@b.com',
      tipo_afiliacion: 'COTIZANTE',
      afiliacion_anexo: 'Especiales o de Excepcion cotizante'
    });
    expect(body.afiliacion).toBeUndefined();
  });

  test('personaBodyDesdeComprobanteModal no escribe texto libre de afiliación al Anexo', () => {
    const body = personaBodyDesdeComprobanteModal({
      paciente_nombre: 'Ana Ruiz',
      paciente_documento: '99',
      tipo_documento: 'CC',
      fecha_nacimiento: '1990-01-01',
      direccion: 'Calle 1',
      telefono: '300',
      correo: 'a@b.com',
      tipo_afiliacion: 'Afiliado particular',
      afiliacion_anexo: 'COTIZANTE'
    });
    expect(body.afiliacion).toBeUndefined();
  });

  test('personaAPrefillComprobante mapea especiales a COTIZANTE/BENEFICIARIO', () => {
    const pre = personaAPrefillComprobante(
      { afiliacion: 'Especiales o de Excepcion beneficiario', numero_documento: '1' },
      { paciente_nombre: 'X' }
    );
    expect(pre.tipo_afiliacion).toBe('BENEFICIARIO');
    expect(pre.afiliacion_anexo).toBe('Especiales o de Excepcion beneficiario');
  });

  test('personaBodyDesdeCertificadoModal mapea nombre y documento', () => {
    const body = personaBodyDesdeCertificadoModal({
      paciente_nombre: 'Ana Ruiz',
      paciente_documento: '99',
      tipo_documento: 'TI'
    });
    expect(body.numero_documento).toBe('99');
    expect(body.nombres_1).toBe('Ana');
    expect(body.apellidos_1).toBe('Ruiz');
    expect(body.tipo_documento).toBe('TI');
  });
});
