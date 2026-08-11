const sharp = require('sharp');
const { quitarFondoBlancoFirma, bboxTintaRgba } = require('../utils/comprobante-servicios-firma');

describe('comprobante-servicios-firma', () => {
  test('quita píxeles blancos, recorta margen y devuelve PNG', async () => {
    const stroke = await sharp({
      create: { width: 80, height: 60, channels: 3, background: { r: 255, g: 255, b: 255 } }
    })
      .composite([{
        input: await sharp({
          create: { width: 20, height: 6, channels: 3, background: { r: 0, g: 0, b: 0 } }
        }).png().toBuffer(),
        left: 10,
        top: 8
      }])
      .png()
      .toBuffer();

    const out = await quitarFondoBlancoFirma({
      mime: 'image/png',
      base64: stroke.toString('base64')
    });

    expect(out.mime).toBe('image/png');
    const { data, info } = await sharp(Buffer.from(out.base64, 'base64'))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(info.channels).toBe(4);
    expect(info.width).toBeLessThan(80);
    expect(info.height).toBeLessThan(60);
    expect(data[3]).toBe(0);
    const hasInk = Array.from({ length: info.width * info.height }).some((_, i) => data[i * 4 + 3] > 0);
    expect(hasInk).toBe(true);
  });

  test('bboxTintaRgba localiza el trazo con padding', () => {
    const width = 10;
    const height = 8;
    const data = Buffer.alloc(width * height * 4, 0);
    // Píxel tinta en (3,2)
    const idx = (2 * width + 3) * 4;
    data[idx] = 0;
    data[idx + 1] = 0;
    data[idx + 2] = 0;
    data[idx + 3] = 255;
    const box = bboxTintaRgba(data, width, height, 4);
    expect(box).not.toBeNull();
    expect(box.left).toBeLessThanOrEqual(3);
    expect(box.top).toBeLessThanOrEqual(2);
    expect(box.left + box.width).toBeGreaterThan(3);
    expect(box.top + box.height).toBeGreaterThan(2);
  });
});
