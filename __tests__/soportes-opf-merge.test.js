const fs = require('fs');
const path = require('path');
const os = require('os');
const { PDFDocument } = require('pdf-lib');
const { esArchivoOrdenHcPdx, mergePdfFilesToPath } = require('../utils/soportes-opf-merge');

async function writeMinimalPdf(filePath, label) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 100]);
  page.drawText(label, { x: 20, y: 50, size: 12 });
  fs.writeFileSync(filePath, await doc.save());
}

describe('esArchivoOrdenHcPdx', () => {
  test('detecta carpeta tema ordenes', () => {
    expect(esArchivoOrdenHcPdx({ color_tema: 'ordenes', nombre_archivo_original: 'cualquier.pdf' })).toBe(true);
  });

  test('detecta prefijo ORDEN + HC en nombre', () => {
    expect(esArchivoOrdenHcPdx({
      carpeta_nombre: 'Estudios',
      nombre_archivo_original: 'ORDEN + HC - Pérez - Juan - RX.pdf'
    })).toBe(true);
  });

  test('rechaza reporte PDX normal', () => {
    expect(esArchivoOrdenHcPdx({
      color_tema: 'rx',
      nombre_archivo_original: 'RX - Pérez - Juan.pdf'
    })).toBe(false);
  });
});

describe('mergePdfFilesToPath', () => {
  test('copia un solo PDF sin exigir dos archivos', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'innar-opf-test-'));
    const solo = path.join(dir, 'solo.pdf');
    const out = path.join(dir, 'opf.pdf');
    await writeMinimalPdf(solo, 'OPF_UNIDO');
    await mergePdfFilesToPath([solo], out);
    expect(fs.existsSync(out)).toBe(true);
    const merged = await PDFDocument.load(fs.readFileSync(out));
    expect(merged.getPageCount()).toBe(1);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('une ORDEN+HC y autorización en orden', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'innar-opf-test-'));
    const orden = path.join(dir, 'orden.pdf');
    const auth = path.join(dir, 'auth.pdf');
    const out = path.join(dir, 'opf.pdf');
    await writeMinimalPdf(orden, 'ORDEN+HC');
    await writeMinimalPdf(auth, 'AUTORIZACION');
    await mergePdfFilesToPath([orden, auth], out);
    expect(fs.existsSync(out)).toBe(true);
    const merged = await PDFDocument.load(fs.readFileSync(out));
    expect(merged.getPageCount()).toBe(2);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
