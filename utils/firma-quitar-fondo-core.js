'use strict';

const UMBRAL_LUMINANCIA = 238;
const MAX_SATURACION_FONDO = 30;

function esPixelFondoBlanco(r, g, b) {
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  const sat = Math.max(r, g, b) - Math.min(r, g, b);
  return lum >= UMBRAL_LUMINANCIA && sat < MAX_SATURACION_FONDO;
}

function transparentarFondoEnRgba(data, channels = 4) {
  for (let i = 0; i < data.length; i += channels) {
    if (esPixelFondoBlanco(data[i], data[i + 1], data[i + 2])) {
      data[i + 3] = 0;
    }
  }
  return data;
}

module.exports = {
  UMBRAL_LUMINANCIA,
  MAX_SATURACION_FONDO,
  esPixelFondoBlanco,
  transparentarFondoEnRgba
};
