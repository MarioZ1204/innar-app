'use strict';

const { UNIR_PDF_SLOTS } = require('../utils/soportes-slot-merge');

describe('soportes-slot-merge OPF', () => {
  test('OPF está habilitado para unir PDFs', () => {
    expect(UNIR_PDF_SLOTS).toContain('OPF');
    expect(UNIR_PDF_SLOTS).toContain('CRC');
  });
});
