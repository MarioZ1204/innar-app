'use strict';

const { PDFDocument } = require('pdf-lib');
const { buildComprobanteServiciosPdf } = require('../utils/comprobante-servicios-pdf');
const {
  validarPayloadComprobanteServicios
} = require('../utils/comprobante-servicios');

const FIRMA_MINI = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG_1X1 = FIRMA_MINI.replace(/^data:image\/png;base64,/, '');

describe('comprobante-servicios-pdf', () => {
  test('genera PDF con texto (no solo imagen) y al menos una página', async () => {
    const { data } = validarPayloadComprobanteServicios({
      fecha: '2026-05-27',
      paciente_nombre: 'MARIO FERNANDO ZAMBRANO MEJIA',
      paciente_documento: '1010101893',
      fecha_nacimiento: '2002-04-12',
      direccion: 'CRA 15B JAVERIANO',
      telefono: '3164518932',
      correo: 'mariozamb1204@gmail.com',
      tipo_afiliacion: 'Cotizante',
      servicio: 'Consulta de Control por Neurología',
      firma_paciente: FIRMA_MINI
    });
    const pdf = await buildComprobanteServiciosPdf(data, {
      base64: PNG_1X1,
      mime: 'image/png'
    });
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.length).toBeGreaterThan(1000);
    const raw = pdf.toString('latin1');
    expect(raw).toMatch(/\/Font/);
    expect(raw).toMatch(/\/BaseFont \/Helvetica/);
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBe(1);
  });
});
