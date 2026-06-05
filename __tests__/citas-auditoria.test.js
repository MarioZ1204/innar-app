'use strict';

const {
  mapReciboParaExport,
  expandirCitaConRecibos,
  elegirReciboActivo
} = require('../utils/citas-auditoria');

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
