/**
 * Copia librerías de generación PDF en el navegador a public/libs.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const destDir = path.join(root, 'public', 'libs');

const copies = [
  ['node_modules/html2canvas/dist/html2canvas.min.js', 'html2canvas.min.js'],
  ['node_modules/jspdf/dist/jspdf.umd.min.js', 'jspdf.umd.min.js'],
  ['node_modules/html2pdf.js/dist/html2pdf.bundle.min.js', 'html2pdf.bundle.min.js']
];

fs.mkdirSync(destDir, { recursive: true });

let ok = 0;
for (const [relSrc, name] of copies) {
  const src = path.join(root, relSrc);
  if (!fs.existsSync(src)) {
    console.warn(`[copy-pdf-libs] omitiendo (no existe): ${relSrc}`);
    continue;
  }
  fs.copyFileSync(src, path.join(destDir, name));
  console.log(`[copy-pdf-libs] OK → public/libs/${name}`);
  ok += 1;
}

if (!ok) {
  console.warn('[copy-pdf-libs] ninguna librería copiada; ejecute npm install.');
  process.exit(0);
}
