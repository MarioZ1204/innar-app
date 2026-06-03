/**
 * Incrusta resaltados (rectángulos semitransparentes) en un PDF con pdf-lib.
 * Coordenadas normalizadas 0–1; origen Y arriba (como en el visor).
 */
const { PDFDocument, rgb } = require('pdf-lib');

const HIGHLIGHT_COLORS = {
  yellow: { r: 1, g: 0.92, b: 0.23 },
  green: { r: 0.56, g: 0.93, b: 0.56 },
  pink: { r: 0.98, g: 0.74, b: 0.87 },
  blue: { r: 0.68, g: 0.85, b: 0.98 }
};

const MAX_HIGHLIGHTS_PER_REQUEST = 80;

function clamp01(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

function normalizeHighlight(raw, pageCount) {
  if (!raw || typeof raw !== 'object') return null;
  const pageIndex = parseInt(raw.pageIndex, 10);
  if (!Number.isFinite(pageIndex) || pageIndex < 0 || pageIndex >= pageCount) return null;
  const x = clamp01(raw.x);
  const y = clamp01(raw.y);
  const w = clamp01(raw.w);
  const h = clamp01(raw.h);
  if (w < 0.002 || h < 0.002) return null;
  if (x + w > 1.001) return null;
  if (y + h > 1.001) return null;
  const colorKey = String(raw.color || 'yellow').toLowerCase();
  const color = HIGHLIGHT_COLORS[colorKey] || HIGHLIGHT_COLORS.yellow;
  return { pageIndex, x, y, w, h, color, colorKey };
}

function sanitizeHighlightsList(list, pageCount) {
  if (!Array.isArray(list) || list.length === 0) return [];
  const out = [];
  for (const raw of list.slice(0, MAX_HIGHLIGHTS_PER_REQUEST)) {
    const h = normalizeHighlight(raw, pageCount);
    if (h) out.push(h);
  }
  return out;
}

/**
 * @param {Buffer|Uint8Array} pdfBytes
 * @param {Array<{pageIndex:number,x:number,y:number,w:number,h:number,color?:string}>} highlights
 * @returns {Promise<Buffer>}
 */
async function applyHighlightsToPdfBytes(pdfBytes, highlights) {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const pages = doc.getPages();
  const pageCount = pages.length;
  const list = sanitizeHighlightsList(highlights, pageCount);
  if (!list.length) {
    throw new Error('No hay resaltados válidos para aplicar');
  }

  for (const h of list) {
    const page = pages[h.pageIndex];
    const { width, height } = page.getSize();
    const rectW = h.w * width;
    const rectH = h.h * height;
    const x = h.x * width;
    const y = height - (h.y + h.h) * height;
    page.drawRectangle({
      x,
      y,
      width: rectW,
      height: rectH,
      color: rgb(h.color.r, h.color.g, h.color.b),
      opacity: 0.38,
      borderWidth: 0
    });
  }

  const out = await doc.save();
  return Buffer.from(out);
}

module.exports = {
  HIGHLIGHT_COLORS,
  MAX_HIGHLIGHTS_PER_REQUEST,
  sanitizeHighlightsList,
  applyHighlightsToPdfBytes
};
