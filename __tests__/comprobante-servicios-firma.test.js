const sharp = require('sharp');
const { quitarFondoBlancoFirma } = require('../utils/comprobante-servicios-firma');

describe('comprobante-servicios-firma', () => {
  test('quita píxeles blancos y devuelve PNG', async () => {
    const white = await sharp({
      create: { width: 20, height: 10, channels: 3, background: { r: 255, g: 255, b: 255 } }
    }).png().toBuffer();
    const stroke = await sharp({
      create: { width: 20, height: 10, channels: 3, background: { r: 255, g: 255, b: 255 } }
    })
      .composite([{
        input: await sharp({
          create: { width: 12, height: 2, channels: 3, background: { r: 0, g: 0, b: 0 } }
        }).png().toBuffer(),
        left: 4,
        top: 4
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
    const cornerAlpha = data[3];
    const inkIdx = (4 * info.width + 4) * 4 + 3;
    expect(cornerAlpha).toBe(0);
    expect(data[inkIdx]).toBeGreaterThan(0);
  });
});
