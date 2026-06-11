'use strict';

const sharp = require('sharp');

const UMBRAL_BLANCO = 242;

/**
 * Convierte píxeles casi blancos en transparentes (PNG).
 * Útil para firmas escaneadas o capturadas con fondo blanco.
 */
async function quitarFondoBlancoFirma(img) {
  if (!img?.base64) return img;
  try {
    const input = Buffer.from(img.base64, 'base64');
    const { data, info } = await sharp(input)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const ch = info.channels;
    for (let i = 0; i < data.length; i += ch) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (r >= UMBRAL_BLANCO && g >= UMBRAL_BLANCO && b >= UMBRAL_BLANCO) {
        data[i + 3] = 0;
      }
    }

    const out = await sharp(data, {
      raw: { width: info.width, height: info.height, channels: 4 }
    })
      .png()
      .toBuffer();

    return { mime: 'image/png', base64: out.toString('base64') };
  } catch (_) {
    return img;
  }
}

async function procesarImagenesFirma(data) {
  if (!data) return data;
  const out = { ...data };
  if (out.firma_paciente) {
    out.firma_paciente = await quitarFondoBlancoFirma(out.firma_paciente);
  }
  if (out.firma_acudiente) {
    out.firma_acudiente = await quitarFondoBlancoFirma(out.firma_acudiente);
  }
  return out;
}

module.exports = {
  quitarFondoBlancoFirma,
  procesarImagenesFirma
};
