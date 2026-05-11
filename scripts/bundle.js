/**
 * scripts/bundle.js
 * Compila `public/js/*.js` (módulos ES) en un bundle único `public/js/app-modules.js`.
 * Usa esbuild si está instalado; de lo contrario falla con instrucciones claras.
 *
 * Uso:
 *   npm install --save-dev esbuild
 *   npm run build:bundle
 */
const path = require('path');
const fs = require('fs');

const ENTRY = path.join(__dirname, '..', 'public', 'js', 'index.js');
const OUTFILE = path.join(__dirname, '..', 'public', 'js', 'app-modules.js');

(async () => {
  let esbuild;
  try {
    esbuild = require('esbuild');
  } catch (e) {
    console.error('esbuild no está instalado. Ejecuta:');
    console.error('  npm install --save-dev esbuild');
    process.exit(1);
  }

  if (!fs.existsSync(ENTRY)) {
    console.error(`Entry point no existe: ${ENTRY}`);
    process.exit(1);
  }

  try {
    const result = await esbuild.build({
      entryPoints: [ENTRY],
      bundle: true,
      format: 'iife',
      target: ['chrome100', 'firefox100', 'safari15', 'edge100'],
      outfile: OUTFILE,
      minify: process.env.NODE_ENV === 'production',
      sourcemap: process.env.NODE_ENV !== 'production',
      logLevel: 'info',
      legalComments: 'none'
    });
    console.log(`Bundle generado en ${OUTFILE}`);
    if (result.warnings?.length) {
      console.warn(`${result.warnings.length} warnings durante el bundle.`);
    }
  } catch (err) {
    console.error('Error generando bundle:', err.message);
    process.exit(1);
  }
})();
