/**
 * Copia PDF.js al directorio público (CSP: solo 'self').
 */
const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'node_modules', 'pdfjs-dist', 'build');
const destDir = path.join(__dirname, '..', 'public', 'libs', 'pdfjs');

const files = ['pdf.min.mjs', 'pdf.worker.min.mjs'];

if (!fs.existsSync(srcDir)) {
  console.warn('[copy-pdfjs] pdfjs-dist no instalado, omitiendo.');
  process.exit(0);
}

fs.mkdirSync(destDir, { recursive: true });
for (const f of files) {
  fs.copyFileSync(path.join(srcDir, f), path.join(destDir, f));
}
console.log('[copy-pdfjs] OK → public/libs/pdfjs');
