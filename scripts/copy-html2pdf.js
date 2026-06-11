/**
 * Copia html2pdf.js al directorio público (generación PDF en el navegador).
 */
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'node_modules', 'html2pdf.js', 'dist', 'html2pdf.bundle.min.js');
const destDir = path.join(__dirname, '..', 'public', 'libs');
const dest = path.join(destDir, 'html2pdf.bundle.min.js');

if (!fs.existsSync(src)) {
  console.warn('[copy-html2pdf] html2pdf.js no instalado, omitiendo.');
  process.exit(0);
}

fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, dest);
console.log('[copy-html2pdf] OK → public/libs/html2pdf.bundle.min.js');
