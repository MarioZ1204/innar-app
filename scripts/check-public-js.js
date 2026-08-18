'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const publicDir = path.join(__dirname, '..', 'public');
const files = fs.readdirSync(publicDir)
  .filter((name) => name.endsWith('.js'))
  .sort();

if (!files.length) {
  console.error('No se encontraron JS en public/');
  process.exit(1);
}

let failed = 0;
for (const name of files) {
  const filePath = path.join(publicDir, name);
  const result = spawnSync(process.execPath, ['--check', filePath], { encoding: 'utf8' });
  if (result.status !== 0) {
    failed += 1;
    process.stderr.write(result.stderr || `Error en ${name}\n`);
  }
}

if (failed) {
  console.error(`check:public-js: ${failed}/${files.length} archivos con error de sintaxis`);
  process.exit(1);
}

console.log(`check:public-js: OK ${files.length} archivos`);
