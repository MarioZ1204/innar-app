/**
 * Copia PDF.js (build legacy .js) al directorio público — compatible con Hostinger/Apache.
 */
const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'node_modules', 'pdfjs-dist', 'build');
const destDir = path.join(__dirname, '..', 'public', 'libs', 'pdfjs');

const files = ['pdf.min.js', 'pdf.worker.min.js'];

if (!fs.existsSync(srcDir)) {
  console.warn('[copy-pdfjs] pdfjs-dist no instalado, omitiendo.');
  process.exit(0);
}

fs.mkdirSync(destDir, { recursive: true });

for (const name of fs.readdirSync(destDir)) {
  if (name.endsWith('.mjs')) {
    try { fs.unlinkSync(path.join(destDir, name)); } catch (_) { /* ignore */ }
  }
}

for (const f of files) {
  const src = path.join(srcDir, f);
  if (!fs.existsSync(src)) {
    console.error(`[copy-pdfjs] Falta ${f} en pdfjs-dist`);
    process.exit(1);
  }
  fs.copyFileSync(src, path.join(destDir, f));
}
console.log('[copy-pdfjs] OK → public/libs/pdfjs (', files.join(', '), ')');
