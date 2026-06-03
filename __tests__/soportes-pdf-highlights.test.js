const { PDFDocument } = require('pdf-lib');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { applyHighlightsToPdfBytes, sanitizeHighlightsList } = require('../utils/soportes-pdf-highlights');

async function makeOnePagePdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 300]);
  page.drawText('Test', { x: 50, y: 250, size: 18 });
  return Buffer.from(await doc.save());
}

describe('soportes-pdf-highlights', () => {
  test('sanitize rechaza página inválida', () => {
    const list = sanitizeHighlightsList([
      { pageIndex: 5, x: 0.1, y: 0.1, w: 0.2, h: 0.1 }
    ], 1);
    expect(list).toHaveLength(0);
  });

  test('aplica rectángulo y persiste en archivo', async () => {
    const base = await makeOnePagePdf();
    const out = await applyHighlightsToPdfBytes(base, [
      { pageIndex: 0, x: 0.1, y: 0.1, w: 0.5, h: 0.08, color: 'yellow' }
    ]);
    expect(out.length).toBeGreaterThan(base.length);
    const tmp = path.join(os.tmpdir(), `innar-hl-${Date.now()}.pdf`);
    fs.writeFileSync(tmp, out);
    const reloaded = await PDFDocument.load(fs.readFileSync(tmp));
    expect(reloaded.getPageCount()).toBe(1);
    fs.unlinkSync(tmp);
  });
});
