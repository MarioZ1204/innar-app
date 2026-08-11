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
 * Bounding box del trazo (píxeles con alpha > umbral), con un poco de padding.
 * Evita que firmas con mucho margen vacío aparezcan “muy arriba” en el PDF.
 */
function bboxTintaRgba(data, width, height, channels = 4, alphaMin = 8) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = data[(y * width + x) * channels + (channels - 1)];
      if (a > alphaMin) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const span = Math.max(maxX - minX + 1, maxY - minY + 1);
  const pad = Math.max(2, Math.round(span * 0.04));
  const left = Math.max(0, minX - pad);
  const top = Math.max(0, minY - pad);
  const right = Math.min(width, maxX + pad + 1);
  const bottom = Math.min(height, maxY + pad + 1);
  return { left, top, width: right - left, height: bottom - top };
}

/**
 * Convierte píxeles casi blancos en transparentes y recorta márgenes vacíos (PNG).
 * Útil para firmas escaneadas o capturadas con fondo blanco / canvas grande.
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

    const box = bboxTintaRgba(data, info.width, info.height, info.channels);
    let pipeline = sharp(data, {
      raw: { width: info.width, height: info.height, channels: info.channels }
    });
    if (box && (box.width < info.width || box.height < info.height)) {
      pipeline = pipeline.extract(box);
    }

    const out = await pipeline.png().toBuffer();
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
  bboxTintaRgba,
  quitarFondoBlancoFirma,
  procesarImagenesFirma
};
