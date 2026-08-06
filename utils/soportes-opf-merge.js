/**
 * Unión de PDFs para generar OPF (ORDEN+HC + Autorización).
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { PDFDocument } = require('pdf-lib');
const { detectarTemaCarpeta } = require('./soportes-temas');
const { readFileBuffer, writeFileAtomic, pathExists, fsp } = require('./fs-async');

async function mergePdfFilesToPath(sourcePaths, destPath) {
  const paths = [];
  for (const p of sourcePaths || []) {
    if (p && await pathExists(p)) paths.push(p);
  }
  if (paths.length === 0) {
    throw new Error('No hay PDF válidos para unir');
  }
  if (paths.length === 1) {
    await fsp.copyFile(paths[0], destPath);
    return destPath;
  }
  const merged = await PDFDocument.create();
  for (const p of paths) {
    const bytes = await readFileBuffer(p);
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
  await writeFileAtomic(destPath, out);
  return destPath;
}

function esArchivoOrdenHcPdx(row) {
  if (!row) return false;
  const tema = row.color_tema || detectarTemaCarpeta(row.carpeta_nombre || '');
  if (tema === 'ordenes') return true;
  const name = String(row.nombre_archivo_original || row.nombre_archivo_display || '').toUpperCase();
  return /^ORDEN\s*\+\s*HC/.test(name.replace(/\s+/g, ' ').trim());
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
