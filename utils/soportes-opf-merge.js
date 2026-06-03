/**
 * Unión de PDFs para generar OPF (ORDEN+HC + Autorización).
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { PDFDocument } = require('pdf-lib');
const { detectarTemaCarpeta } = require('./soportes-temas');

function esArchivoOrdenHcPdx(row) {
  if (!row) return false;
  const tema = row.color_tema || detectarTemaCarpeta(row.carpeta_nombre || '');
  if (tema === 'ordenes') return true;
  const name = String(row.nombre_archivo_original || row.nombre_archivo_display || '').toUpperCase();
  return /^ORDEN\s*\+\s*HC/.test(name.replace(/\s+/g, ' ').trim());
}

async function mergePdfFilesToPath(sourcePaths, destPath) {
  const paths = (sourcePaths || []).filter((p) => p && fs.existsSync(p));
  if (paths.length < 2) {
    throw new Error('Se requieren al menos dos PDF válidos para unir');
  }
  const merged = await PDFDocument.create();
  for (const p of paths) {
    const bytes = fs.readFileSync(p);
    let doc;
    try {
      doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    } catch (e) {
      throw new Error(`No se pudo leer el PDF: ${path.basename(p)}`);
    }
    const indices = doc.getPageIndices();
    if (!indices.length) {
      throw new Error(`El PDF no tiene páginas: ${path.basename(p)}`);
    }
    const pages = await merged.copyPages(doc, indices);
    pages.forEach((page) => merged.addPage(page));
  }
  const out = await merged.save();
  fs.writeFileSync(destPath, out);
  return destPath;
}

async function mergePdfFilesToTemp(sourcePaths) {
  const tmp = path.join(os.tmpdir(), `innar-opf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.pdf`);
  await mergePdfFilesToPath(sourcePaths, tmp);
  return tmp;
}

module.exports = {
  esArchivoOrdenHcPdx,
  mergePdfFilesToPath,
  mergePdfFilesToTemp
};
