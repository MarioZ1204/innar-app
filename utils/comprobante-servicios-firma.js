'use strict';

const { transparentarFondoEnRgba } = require('./firma-quitar-fondo-core');

/** Carga diferida: evita fallo de arranque en Hostinger si el binario nativo no está listo. */
function getSharp() {
  try {
    return require('sharp');
  } catch (e) {
    return null;
  }
}

/**
 * Convierte píxeles casi blancos en transparentes (PNG).
 * Útil para firmas escaneadas o capturadas con fondo blanco.
 */
async function quitarFondoBlancoFirma(img) {
  if (!img?.base64) return img;
  const sharp = getSharp();
  if (!sharp) return img;
  try {
    const input = Buffer.from(img.base64, 'base64');
    const { data, info } = await sharp(input)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    transparentarFondoEnRgba(data, info.channels);

    const out = await sharp(data, {
      raw: { width: info.width, height: info.height, channels: info.channels }
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
