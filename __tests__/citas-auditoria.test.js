'use strict';

const { mapReciboParaExport } = require('../utils/citas-auditoria');

describe('mapReciboParaExport', () => {
  test('sin recibo devuelve campos vacíos', () => {
    expect(mapReciboParaExport(null)).toEqual({
      recibo_numero: '',
      recibo_valor: '',
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

  test('recibo pendiente', () => {
    const out = mapReciboParaExport({
      numero: 'R-200',
      total: 120000,
      anulado: 0,
      estado_pago: 'PENDIENTE',
      observaciones: 'Pago en caja'
    });
    expect(out.recibo_estado).toBe('PENDIENTE');
    expect(out.recibo_observaciones).toBe('Pago en caja');
  });

  test('recibo pagado por defecto', () => {
    const out = mapReciboParaExport({
      numero: 'R-300',
      total: 50000,
      anulado: 0,
      observaciones: 'OK'
    });
    expect(out.recibo_estado).toBe('PAGADO');
  });
});
