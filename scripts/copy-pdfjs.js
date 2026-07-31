/**
 * Copia PDF.js al directorio público — compatible con Hostinger/Apache.
 * Soporta pdfjs-dist v3 (.js) y v4+ (legacy/build/*.mjs).
 */
const fs = require('fs');
const path = require('path');

const pkgRoot = path.join(__dirname, '..', 'node_modules', 'pdfjs-dist');
const destDir = path.join(__dirname, '..', 'public', 'libs', 'pdfjs');

const SOURCE_SETS = [
  {
    label: 'legacy v4+ (.mjs)',
    dir: path.join(pkgRoot, 'legacy', 'build'),
    files: [
      ['pdf.min.mjs', 'pdf.min.mjs'],
      ['pdf.worker.min.mjs', 'pdf.worker.min.mjs'],
    ],
  },
  {
    label: 'v3 (.js)',
    dir: path.join(pkgRoot, 'build'),
    files: [
      ['pdf.min.js', 'pdf.min.js'],
      ['pdf.worker.min.js', 'pdf.worker.min.js'],
    ],
  },
];

if (!fs.existsSync(pkgRoot)) {
  console.warn('[copy-pdfjs] pdfjs-dist no instalado, omitiendo.');
  process.exit(0);
}

function findSourceSet() {
  for (const set of SOURCE_SETS) {
    if (!fs.existsSync(set.dir)) continue;
    const ok = set.files.every(([srcName]) => fs.existsSync(path.join(set.dir, srcName)));
    if (ok) return set;
  }
  return null;
}

const chosen = findSourceSet();
if (!chosen) {
  console.error('[copy-pdfjs] No hay build compatible en pdfjs-dist (legacy/*.mjs o build/*.js)');
  process.exit(1);
}

fs.mkdirSync(destDir, { recursive: true });

for (const name of fs.readdirSync(destDir)) {
  if (/^pdf(\.worker)?\.(min\.)?(js|mjs)$/.test(name) || name === 'manifest.json') {
    try { fs.unlinkSync(path.join(destDir, name)); } catch (_) { /* ignore */ }
  }
}

for (const [srcName, destName] of chosen.files) {
  fs.copyFileSync(path.join(chosen.dir, srcName), path.join(destDir, destName));
}

const manifest = {
  format: chosen.files[0][1].endsWith('.mjs') ? 'mjs' : 'js',
  pdf: chosen.files[0][1],
  worker: chosen.files[1][1],
};
fs.writeFileSync(path.join(destDir, 'manifest.json'), JSON.stringify(manifest));

console.log(`[copy-pdfjs] OK (${chosen.label}) → public/libs/pdfjs/`, manifest.pdf, manifest.worker);
