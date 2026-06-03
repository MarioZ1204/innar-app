/**
 * Eliminar páginas de un PDF (pdf-lib). Índices 0-based.
 */
const { PDFDocument } = require('pdf-lib');

const MAX_PAGES_PER_REQUEST = 120;

function sanitizePageIndexes(list, pageCount) {
  if (!Number.isFinite(pageCount) || pageCount < 1) {
    throw new Error('El PDF no tiene páginas');
  }
  if (!Array.isArray(list) || !list.length) {
    throw new Error('Indique al menos una página a eliminar');
  }
  const set = new Set();
  for (const raw of list.slice(0, MAX_PAGES_PER_REQUEST)) {
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 1 || n > pageCount) {
      throw new Error(`Página no válida: ${raw} (el documento tiene ${pageCount} página(s))`);
    }
    set.add(n - 1);
  }
  if (set.size >= pageCount) {
    throw new Error('Debe conservar al menos una página en el documento');
  }
  return [...set].sort((a, b) => a - b);
}

/**
 * @param {Buffer|Uint8Array} pdfBytes
 * @param {number[]} pageIndexes0 — índices 0-based a eliminar
 * @returns {Promise<Buffer>}
 */
async function removePdfPagesFromBytes(pdfBytes, pageIndexes0) {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const pageCount = doc.getPageCount();
  const toRemove = new Set(pageIndexes0);
  const out = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    if (!toRemove.has(i)) {
      const [copied] = await out.copyPages(doc, [i]);
      out.addPage(copied);
    }
  }
  if (out.getPageCount() < 1) {
    throw new Error('Debe conservar al menos una página');
  }
  return Buffer.from(await out.save());
}

module.exports = {
  MAX_PAGES_PER_REQUEST,
  sanitizePageIndexes,
  removePdfPagesFromBytes
};
