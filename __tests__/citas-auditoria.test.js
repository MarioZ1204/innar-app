'use strict';

const {
  mapReciboParaExport,
  resolverRecibosParaExport,
  elegirReciboActivo
} = require('../utils/citas-auditoria');

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

describe('resolverRecibosParaExport', () => {
  test('anulado DUPLICADO + activo pagado: usa el activo y suma anulado aparte', () => {
    const out = resolverRecibosParaExport([
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
    expect(out.recibo_numero).toBe('R-015');
    expect(out.recibo_estado).toBe('PAGADO');
    expect(out.recibo_observaciones).toBe('Recibo válido');
    expect(out.recibo_valor).toBe(90000);
    expect(out.recibo_valor_anulado).toBe(90000);
  });

  test('solo recibo anulado: valor va a columna anulada', () => {
    const out = resolverRecibosParaExport([
      {
        id: 10,
        numero: 'R-010',
        total: 50000,
        anulado: 1,
        anulado_razon: 'Error en monto',
        estado_pago: 'PAGADO'
      }
    ]);
    expect(out.recibo_estado).toBe('ANULADO');
    expect(out.recibo_valor).toBe('');
    expect(out.recibo_valor_anulado).toBe(50000);
  });

  test('prefiere pagado sobre pendiente si hay dos activos', () => {
    const elegido = elegirReciboActivo([
      { id: 2, anulado: 0, estado_pago: 'PENDIENTE', total: 100 },
      { id: 1, anulado: 0, estado_pago: 'PAGADO', total: 100 }
    ]);
    expect(elegido.id).toBe(1);
  });
});
