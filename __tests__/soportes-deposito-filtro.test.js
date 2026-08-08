'use strict';

const {
  carpetaCoincideSlotDeposito,
  carpetaNombreVisibleCoincideSlot
} = require('../utils/soportes-deposito-filtro');

describe('soportes-deposito-filtro', () => {
  test('OPF: carpetas ORDEN + HC y similares', () => {
    expect(carpetaCoincideSlotDeposito('OPF', { carpeta_nombre: 'ORDEN + HC' })).toBe(true);
    expect(carpetaCoincideSlotDeposito('OPF', { carpeta_nombre: 'ORDENES' })).toBe(true);
    expect(carpetaCoincideSlotDeposito('OPF', {
      carpeta_nombre: 'COMPROBANTES',
      nombre_archivo_original: 'COMPROBANTE Perez Juan CC 123 2026-01-01 PSG.pdf'
    })).toBe(false);
  });

  test('CRC: solo carpetas COMPROBANTES', () => {
    expect(carpetaCoincideSlotDeposito('CRC', { carpeta_nombre: 'COMPROBANTES' })).toBe(true);
    expect(carpetaCoincideSlotDeposito('CRC', { carpeta_nombre: 'Comprobante consultas médicas' })).toBe(true);
    expect(carpetaCoincideSlotDeposito('CRC', { carpeta_nombre: 'PSG' })).toBe(false);
  });

  test('PDX: PSG, VTM, EEG y TEST DE LATENCIA', () => {
    expect(carpetaCoincideSlotDeposito('PDX', { carpeta_nombre: 'PSG' })).toBe(true);
    expect(carpetaCoincideSlotDeposito('PDX', { carpeta_nombre: 'VTM' })).toBe(true);
    expect(carpetaCoincideSlotDeposito('PDX', { carpeta_nombre: 'EEG' })).toBe(true);
    expect(carpetaCoincideSlotDeposito('PDX', { carpeta_nombre: 'TEST DE LATENCIA' })).toBe(true);
    expect(carpetaCoincideSlotDeposito('PDX', { carpeta_nombre: 'COMPROBANTES' })).toBe(false);
    expect(carpetaCoincideSlotDeposito('PDX', { carpeta_nombre: 'ORDENES' })).toBe(false);
  });

  test('carpetaNombreVisibleCoincideSlot reconoce nombres visibles', () => {
    expect(carpetaNombreVisibleCoincideSlot('OPF', 'ORDEN + HC consultas')).toBe(true);
    expect(carpetaNombreVisibleCoincideSlot('CRC', 'COMPROBANTES Mayo')).toBe(true);
    expect(carpetaNombreVisibleCoincideSlot('PDX', 'Polisomnografía PSG')).toBe(true);
  });
});
