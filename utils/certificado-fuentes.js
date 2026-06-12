'use strict';

const fs = require('fs');
const path = require('path');

const FONT_DIRS = [
  path.join(__dirname, '..', 'public', 'fonts'),
  path.join(process.execPath, '..', 'public', 'fonts')
];

const APTOS_FILES = [
  { file: 'Aptos-Narrow.ttf', weight: 400 },
  { file: 'Aptos-Narrow-Bold.ttf', weight: 700 },
  { file: 'AptosNarrow.ttf', weight: 400 },
  { file: 'AptosNarrow-Bold.ttf', weight: 700 },
  { file: 'Aptos-Narrow.woff2', weight: 400 },
  { file: 'Aptos-Narrow-Bold.woff2', weight: 700 }
];

const ARCHIVO_FALLBACK = [
  { file: 'archivo-narrow-latin-400-normal.woff2', weight: 400, mime: 'font/woff2' },
  { file: 'archivo-narrow-latin-600-normal.woff2', weight: 600, mime: 'font/woff2' },
  { file: 'archivo-narrow-latin-700-normal.woff2', weight: 700, mime: 'font/woff2' }
];

function leerFontBase64(nombreArchivo) {
  for (const dir of FONT_DIRS) {
    const p = path.join(dir, nombreArchivo);
    if (!fs.existsSync(p)) continue;
    try {
      return fs.readFileSync(p).toString('base64');
    } catch (_) { /* ignore */ }
  }
  return '';
}

function getCertificadoAsistenciaFontCss() {
  let css = '';
  let tieneAptos = false;

  for (const ar of APTOS_FILES) {
    const b64 = leerFontBase64(ar.file);
    if (!b64) continue;
    tieneAptos = true;
    const fmt = ar.file.endsWith('.woff2') ? 'woff2' : 'truetype';
    const mime = ar.file.endsWith('.woff2') ? 'font/woff2' : 'font/ttf';
    css += `@font-face{font-family:'Aptos Narrow';font-style:normal;font-weight:${ar.weight};src:url(data:${mime};base64,${b64}) format('${fmt}');}`;
  }

  if (!tieneAptos) {
    for (const ar of ARCHIVO_FALLBACK) {
      const b64 = leerFontBase64(ar.file);
      if (!b64) continue;
      css += `@font-face{font-family:'Aptos Narrow';font-style:normal;font-weight:${ar.weight};src:url(data:${ar.mime};base64,${b64}) format('woff2');}`;
    }
  }

  return css;
}

function tieneFuenteCertificadoAptos() {
  return getCertificadoAsistenciaFontCss().includes('Aptos Narrow');
}

module.exports = {
  getCertificadoAsistenciaFontCss,
  tieneFuenteCertificadoAptos
};
