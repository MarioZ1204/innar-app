'use strict';

const {
  mapReciboParaExport,
  expandirCitaConRecibos,
  elegirReciboActivo,
  esReciboElectro,
  esReciboConsultaMedica,
  reciboCoincideCitaMedica,
  reciboCoincideCitaElectro,
  reciboEnlazadoPorTurno,
  reciboEnlazadoPorCitaElectro,
  reciboDirectoMedica,
  asignarRecibosACitas
} = require('../utils/citas-auditoria');

const CATALOGOS_AUDITORIA = {
  tiposConsulta: ['Medicina General', 'Cardiología'],
  estudios: ['EEG Convencional', 'ELECTROENCEFALOGRAMA  CONVENCIONAL']
};

const CITA_BASE = {
  id: 99,
  fecha: '2026-06-01',
  paciente_documento: '123456',
  paciente_nombre: 'Juan Pérez'
};

describe('mapReciboParaExport', () => {
  test('sin recibo devuelve campos vacíos', () => {
    expect(mapReciboParaExport(null)).toEqual({
      recibo_numero: '',
      recibo_valor: '',
      recibo_valor_anulado: '',
      recibo_estado: '',
      recibo_observaciones: ''
    });
  });

  test('recibo anulado usa razón de anulación', () => {
    const out = mapReciboParaExport({
      numero: 'R-100',
      total: 85000,
      anulado: 1,
      anulado_razon: 'Error de digitación',
      observaciones: 'Nota normal',
      estado_pago: 'PAGADO'
    });
    expect(out.recibo_estado).toBe('ANULADO');
    expect(out.recibo_observaciones).toBe('Error de digitación');
    expect(out.recibo_valor).toBe(85000);
  });
});

describe('expandirCitaConRecibos', () => {
  test('sin recibos: una fila vacía', () => {
    const filas = expandirCitaConRecibos(CITA_BASE, []);
    expect(filas).toHaveLength(1);
    expect(filas[0].recibo_numero).toBe('');
    expect(filas[0].recibo_seq).toBe('');
  });

  test('anulado + activo: dos filas con secuencia 1 de 2 y 2 de 2', () => {
    const filas = expandirCitaConRecibos(CITA_BASE, [
      {
        id: 20,
        numero: 'R-020',
        total: 90000,
        anulado: 1,
        anulado_razon: 'DUPLICADO',
        estado_pago: 'PAGADO'
      },
      {
        id: 15,
        numero: 'R-015',
        total: 90000,
        anulado: 0,
        estado_pago: 'PAGADO',
        observaciones: 'Recibo válido'
      }
    ]);
    expect(filas).toHaveLength(2);
    expect(filas[0].recibo_numero).toBe('R-015');
    expect(filas[0].recibo_estado).toBe('PAGADO');
    expect(filas[0].recibo_valor).toBe(90000);
    expect(filas[0].recibo_valor_anulado).toBe('');
    expect(filas[0].recibo_seq).toBe('1 de 2');
    expect(filas[1].recibo_numero).toBe('R-020');
    expect(filas[1].recibo_estado).toBe('ANULADO');
    expect(filas[1].recibo_valor).toBe('');
    expect(filas[1].recibo_valor_anulado).toBe(90000);
    expect(filas[1].recibo_seq).toBe('2 de 2');
    expect(filas[0].paciente_documento).toBe('123456');
    expect(filas[1].paciente_documento).toBe('123456');
  });

  test('un solo recibo: sin etiqueta de secuencia', () => {
    const filas = expandirCitaConRecibos(CITA_BASE, [
      { id: 1, numero: 'R-001', total: 50000, anulado: 0, estado_pago: 'PAGADO' }
    ]);
    expect(filas).toHaveLength(1);
    expect(filas[0].recibo_seq).toBe('');
    expect(filas[0].recibo_valor).toBe(50000);
  });

  test('prefiere pagado sobre pendiente si hay dos activos', () => {
    const elegido = elegirReciboActivo([
      { id: 2, anulado: 0, estado_pago: 'PENDIENTE', total: 100 },
      { id: 1, anulado: 0, estado_pago: 'PAGADO', total: 100 }
    ]);
    expect(elegido.id).toBe(1);
  });
});

describe('recibos consulta médica en auditoría', () => {
  const citaMedica = {
    id: 42,
    fecha: '2026-06-15',
    tipo_consulta: 'Medicina General',
    paciente_nombre: 'María López'
  };

  test('excluye recibos de electrodiagnóstico', () => {
    expect(esReciboConsultaMedica({ cita_electro_id: 7 }, CATALOGOS_AUDITORIA)).toBe(false);
    expect(esReciboConsultaMedica({ cita_electro_id: null, turno_id: 42 }, CATALOGOS_AUDITORIA)).toBe(true);
    expect(esReciboElectro({
      cita_electro_id: null,
      medico_nombre: 'ELECTRODIAGNÓSTICOS',
      tipo_servicio: 'EEG Convencional'
    }, CATALOGOS_AUDITORIA)).toBe(true);
  });

  test('no arrastra electro por medico ni por servicio de estudio', () => {
    const recMedicoElectro = {
      id: 5,
      turno_id: 42,
      cita_electro_id: null,
      medico_nombre: 'ELECTRODIAGNÓSTICOS',
      tipo_servicio: 'Medicina General',
      fecha: '2026-06-15',
      cliente: 'María López'
    };
    expect(reciboCoincideCitaMedica(recMedicoElectro, citaMedica, CATALOGOS_AUDITORIA)).toBe(false);

    const recEstudio = {
      id: 6,
      turno_id: null,
      cita_electro_id: null,
      medico_nombre: null,
      tipo_servicio: 'EEG Convencional',
      fecha: '2026-06-15',
      cliente: 'María López'
    };
    expect(reciboCoincideCitaMedica(recEstudio, citaMedica, CATALOGOS_AUDITORIA)).toBe(false);
  });

  test('enlaza por turno_id', () => {
    const rec = { id: 1, turno_id: 42, cita_electro_id: null, tipo_servicio: 'Otro' };
    expect(reciboEnlazadoPorTurno(rec, citaMedica)).toBe(true);
    expect(reciboCoincideCitaMedica(rec, citaMedica, CATALOGOS_AUDITORIA)).toBe(true);
  });

  test('no asigna recibo enlazado a otro turno', () => {
    const rec = { id: 2, turno_id: 99, cita_electro_id: null, tipo_servicio: 'Medicina General' };
    expect(reciboCoincideCitaMedica(rec, citaMedica, CATALOGOS_AUDITORIA)).toBe(false);
  });

  test('enlace directo por turno aunque el médico del recibo diga electrodiagnóstico', () => {
    const rec = {
      id: 7,
      turno_id: 42,
      cita_electro_id: null,
      medico_nombre: 'ELECTRODIAGNÓSTICOS',
      tipo_servicio: 'Medicina General',
      fecha: '2026-06-15',
      cliente: 'María López',
      total: 120000,
      numero: 'R-007',
      anulado: 0,
      estado_pago: 'PAGADO'
    };
    expect(reciboDirectoMedica(rec, citaMedica)).toBe(true);
    const filas = asignarRecibosACitas([citaMedica], [rec], CATALOGOS_AUDITORIA, 'AGENDA_MEDICA');
    expect(filas).toHaveLength(1);
    expect(filas[0].recibo_valor).toBe(120000);
  });

  test('fallback por tipo de consulta, fecha y paciente', () => {
    const rec = {
      id: 3,
      turno_id: null,
      cita_electro_id: null,
      tipo_servicio: 'Medicina General',
      fecha: '2026-06-15',
      cliente: 'María López'
    };
    expect(reciboCoincideCitaMedica(rec, citaMedica, CATALOGOS_AUDITORIA)).toBe(true);
  });

  test('fallback no coincide si cambia fecha o tipo', () => {
    const base = {
      id: 4,
      turno_id: null,
      cita_electro_id: null,
      tipo_servicio: 'Medicina General',
      fecha: '2026-06-15',
      cliente: 'María López'
    };
    expect(reciboCoincideCitaMedica({ ...base, fecha: '2026-06-16' }, citaMedica, CATALOGOS_AUDITORIA)).toBe(false);
    expect(reciboCoincideCitaMedica({ ...base, tipo_servicio: 'Cardiología' }, citaMedica, CATALOGOS_AUDITORIA)).toBe(false);
  });
});

describe('recibos electro en auditoría', () => {
  const citaElectro = {
    id: 88,
    fecha: '2026-06-20',
    tipo_consulta: 'EEG Convencional',
    paciente_nombre: 'Pedro Ruiz'
  };

  test('enlaza por cita_electro_id', () => {
    const rec = { id: 10, cita_electro_id: 88, turno_id: null, tipo_servicio: 'Otro' };
    expect(reciboEnlazadoPorCitaElectro(rec, citaElectro)).toBe(true);
    expect(reciboCoincideCitaElectro(rec, citaElectro, CATALOGOS_AUDITORIA)).toBe(true);
  });

  test('no asigna recibo enlazado a otra cita electro', () => {
    const rec = { id: 11, cita_electro_id: 99, turno_id: null, tipo_servicio: 'EEG Convencional' };
    expect(reciboCoincideCitaElectro(rec, citaElectro, CATALOGOS_AUDITORIA)).toBe(false);
  });

  test('no mezcla recibo médico con cita electro', () => {
    const rec = { id: 12, turno_id: 42, cita_electro_id: null, tipo_servicio: 'EEG Convencional' };
    expect(reciboCoincideCitaElectro(rec, citaElectro, CATALOGOS_AUDITORIA)).toBe(false);
  });

  test('fallback por tipo de estudio, fecha y paciente', () => {
    const rec = {
      id: 13,
      cita_electro_id: null,
      turno_id: null,
      medico_nombre: 'ELECTRODIAGNÓSTICOS',
      tipo_servicio: 'EEG Convencional',
      fecha: '2026-06-20',
      cliente: 'Pedro Ruiz'
    };
    expect(reciboCoincideCitaElectro(rec, citaElectro, CATALOGOS_AUDITORIA)).toBe(true);
  });
});
