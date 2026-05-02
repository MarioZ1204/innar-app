/**
 * build-minify.js
 * Minifica JS/CSS y optimiza imágenes antes de desplegar en Hostinger.
 * Uso: npm run build:min
 *
 * - JS: terser  (elimina comentarios, comprime)
 * - CSS: csso   (elimina whitespace, fusiona reglas)
 * - Imágenes: sharp → convierte JPEG/PNG pesados a WebP + reduce resolución
 * El versionado ?v=APP_VERSION en la URL garantiza cache busting.
 */

const { minify } = require('terser');
const csso = require('csso');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '..', 'public');

const JS_FILES = [
  'app.js',
  'dashboard-citas.js',
  'socket-client.js',
  'socket-electro.js',
  'calendario-agenda.js',
  'calendario-bloqueado.js',
  'multiselect.js',
  'validation-client.js',
];

const CSS_FILES = [
  'style.css',
];

// Imágenes a optimizar: [archivo, ancho máximo, calidad webp]
const IMAGE_OPTS = [
  { file: 'images/bck3.jpeg',      width: 1920, quality: 75 }, // Fondo login 4.5MB → objetivo <300KB
  { file: 'images/fondo.png',      width: 900,  quality: 80 }, // Fondo módulos 95KB → <50KB
  { file: 'images/iconrecibos.png', width: 120, quality: 85 },
  { file: 'images/iconagenda.png',  width: 120, quality: 85 },
  { file: 'images/iconelectro.png', width: 120, quality: 85 },
  { file: 'images/iconuser.png',    width: 120, quality: 85 },
  { file: 'images/logo3.png',      width: 480,  quality: 90 },
  { file: 'images/logo.png',       width: 480,  quality: 90 },
  { file: 'images/logo1.png',      width: 480,  quality: 90 },
  { file: 'images/logorecibo.png', width: 480,  quality: 90 },
];

async function minifyJS() {
  for (const file of JS_FILES) {
    const filePath = path.join(PUBLIC, file);
    if (!fs.existsSync(filePath)) { console.warn(`⚠ No encontrado: ${file}`); continue; }
    const code = fs.readFileSync(filePath, 'utf8');
    const before = (code.length / 1024).toFixed(1);
    try {
      const result = await minify(code, {
        compress: { drop_console: false, passes: 2 },
        mangle: { toplevel: false },
        format: { comments: false },
      });
      if (result.code) {
        fs.writeFileSync(filePath, result.code, 'utf8');
        const after = (result.code.length / 1024).toFixed(1);
        console.log(`✓ ${file}: ${before}KB → ${after}KB (-${Math.round((1 - result.code.length / code.length) * 100)}%)`);
      }
    } catch (e) {
      console.error(`✗ Error minificando ${file}:`, e.message);
    }
  }
}

function minifyCSS() {
  for (const file of CSS_FILES) {
    const filePath = path.join(PUBLIC, file);
    if (!fs.existsSync(filePath)) { console.warn(`⚠ No encontrado: ${file}`); continue; }
    const code = fs.readFileSync(filePath, 'utf8');
    const before = (code.length / 1024).toFixed(1);
    try {
      const result = csso.minify(code);
      fs.writeFileSync(filePath, result.css, 'utf8');
      const after = (result.css.length / 1024).toFixed(1);
      console.log(`✓ ${file}: ${before}KB → ${after}KB (-${Math.round((1 - result.css.length / code.length) * 100)}%)`);
    } catch (e) {
      console.error(`✗ Error minificando ${file}:`, e.message);
    }
  }
}

async function optimizeImages() {
  for (const { file, width, quality } of IMAGE_OPTS) {
    const src = path.join(PUBLIC, file);
    if (!fs.existsSync(src)) { console.warn(`⚠ No encontrado: ${file}`); continue; }

    // Output: mismo nombre pero extensión .webp (next to original)
    const dir = path.dirname(src);
    const base = path.basename(src, path.extname(src));
    const dest = path.join(dir, base + '.webp');

    const before = (fs.statSync(src).size / 1024).toFixed(1);
    try {
      await sharp(src)
        .resize({ width, withoutEnlargement: true })
        .webp({ quality })
        .toFile(dest);
      const after = (fs.statSync(dest).size / 1024).toFixed(1);
      console.log(`✓ ${file} → ${base}.webp: ${before}KB → ${after}KB (-${Math.round((1 - fs.statSync(dest).size / fs.statSync(src).size) * 100)}%)`);
    } catch (e) {
      console.error(`✗ Error optimizando ${file}:`, e.message);
    }
  }

  // Reescribir references en CSS: bck3.jpeg → bck3.webp, fondo.png → fondo.webp, logo*.png → logo*.webp
  const cssPath = path.join(PUBLIC, 'style.css');
  if (fs.existsSync(cssPath)) {
    let css = fs.readFileSync(cssPath, 'utf8');
    css = css.replace(/images\/bck3\.jpeg/g, 'images/bck3.webp');
    css = css.replace(/images\/fondo\.png/g, 'images/fondo.webp');
    fs.writeFileSync(cssPath, css, 'utf8');
    console.log('✓ style.css: referencias de imágenes actualizadas a .webp');
  }

  // Reescribir references en HTML: logo3.png → logo3.webp, icon.png → icon.png (mantener, es favicon)
  const htmlPath = path.join(PUBLIC, 'index.html');
  if (fs.existsSync(htmlPath)) {
    let html = fs.readFileSync(htmlPath, 'utf8');
    html = html.replace(/\/images\/logo3\.png/g, '/images/logo3.webp');
    html = html.replace(/\/images\/logo\.png/g, '/images/logo.webp');
    html = html.replace(/\/images\/logo1\.png/g, '/images/logo1.webp');
    html = html.replace(/\/images\/logorecibo\.png/g, '/images/logorecibo.webp');
    html = html.replace(/\/images\/iconrecibos\.png/g, '/images/iconrecibos.webp');
    html = html.replace(/\/images\/iconagenda\.png/g, '/images/iconagenda.webp');
    html = html.replace(/\/images\/iconelectro\.png/g, '/images/iconelectro.webp');
    html = html.replace(/\/images\/iconuser\.png/g, '/images/iconuser.webp');
    // Actualizar preload
    html = html.replace('href="/images/logo3.png"', 'href="/images/logo3.webp"');
    // preloadImages en splash — actualizar también
    html = html.replace("'images/bck3.jpeg'", "'images/bck3.webp'");
    html = html.replace("'images/fondo.png'", "'images/fondo.webp'");
    html = html.replace("'images/logo.png'", "'images/logo.webp'");
    html = html.replace("'images/logo1.png'", "'images/logo1.webp'");
    html = html.replace("'images/logo3.png'", "'images/logo3.webp'");
    fs.writeFileSync(htmlPath, html, 'utf8');
    console.log('✓ index.html: referencias de imágenes actualizadas a .webp');
  }
}

(async () => {
  console.log('🔧 Minificando JS...');
  await minifyJS();
  console.log('🔧 Minificando CSS...');
  minifyCSS();
  console.log('🖼  Optimizando imágenes...');
  await optimizeImages();
  console.log('✅ Build completado. Sube todos los archivos de public/ a Hostinger.');
})();
