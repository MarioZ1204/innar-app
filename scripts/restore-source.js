#!/usr/bin/env node
/**
 * Restaura public/app.js desde el respaldo (app.js.backup) para poder editar de nuevo.
 */

const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const appJsPath = path.join(rootDir, 'public', 'app.js');
const backupPath = path.join(rootDir, 'public', 'app.js.backup');

if (!fs.existsSync(backupPath)) {
  console.error('No hay respaldo (public/app.js.backup). Solo puedes restaurar si antes ejecutaste npm run obfuscate.');
  process.exit(1);
}

const backup = fs.readFileSync(backupPath, 'utf8');
fs.writeFileSync(appJsPath, backup, 'utf8');

console.log('OK: public/app.js restaurado desde app.js.backup');
console.log('Para volver a ofuscar antes de distribuir: npm run obfuscate');
