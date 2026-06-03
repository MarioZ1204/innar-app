const { sanitizePageIndexes, removePdfPagesFromBytes } = require('../utils/soportes-pdf-pages');
const { PDFDocument } = require('pdf-lib');

async function pdfWithPages(n) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < n; i++) {
    doc.addPage();
  }
  return Buffer.from(await doc.save());
}

describe('soportes-pdf-pages', () => {
  test('sanitizePageIndexes acepta números 1-based', () => {
    expect(sanitizePageIndexes([2, 1], 3)).toEqual([0, 1]);
  });

  test('rechaza eliminar todas las páginas', () => {
    expect(() => sanitizePageIndexes([1, 2], 2)).toThrow(/al menos una página/);
  });

  test('removePdfPagesFromBytes elimina páginas indicadas', async () => {
    const src = await pdfWithPages(4);
    const out = await removePdfPagesFromBytes(src, [1, 3]);
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(2);
  });
});
