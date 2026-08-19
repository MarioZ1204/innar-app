'use strict';

const { PDFDocument, StandardFonts } = require('pdf-lib');
const { stampFondoDetras } = require('../utils/pdf-stamp-fondo');

const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('pdf-stamp-fondo', () => {
  test('el membrete queda detrás y el texto sigue siendo texto', async () => {
    const src = await PDFDocument.create();
    const page = src.addPage([595.28, 841.89]);
    const font = await src.embedFont(StandardFonts.Helvetica);
    page.drawText('MARIO FERNANDO ZAMBRANO', {
      x: 50,
      y: 700,
      size: 14,
      font
    });
    const stamped = await stampFondoDetras(await src.save(), {
      base64: PNG_1X1,
      mime: 'image/png'
    });
    const raw = Buffer.from(stamped).toString('latin1');
    expect(raw).toMatch(/\/Font/);
    expect(raw).toMatch(/\/Subtype \/Image/);
    const reloaded = await PDFDocument.load(stamped);
    expect(reloaded.getPageCount()).toBe(1);
  });
});
