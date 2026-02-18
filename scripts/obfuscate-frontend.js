#!/usr/bin/env node
/**
 * Ofusca public/app.js para dificultar la lectura del código en el navegador.
 * Crea una copia de respaldo en public/app.js.backup antes de sobrescribir.
 */

const JavaScriptObfuscator = require('javascript-obfuscator');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const appJsPath = path.join(rootDir, 'public', 'app.js');
const backupPath = path.join(rootDir, 'public', 'app.js.backup');

if (!fs.existsSync(appJsPath)) {
  console.error('No se encontró public/app.js');
  process.exit(1);
}

const source = fs.readFileSync(appJsPath, 'utf8');

const obfuscationResult = JavaScriptObfuscator.obfuscate(source, {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.5,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.2,
  debugProtection: false,
  disableConsoleOutput: false,
  identifierNamesGenerator: 'hexadecimal',
  log: false,
  numbersToExpressions: true,
  renameGlobals: false,
  selfDefending: false,
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 5,
  stringArray: true,
  stringArrayCallsTransform: true,
  stringArrayEncoding: ['base64'],
  stringArrayIndexShift: true,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayWrappersCount: 2,
  stringArrayWrappersChainedCalls: true,
  stringArrayWrappersParametersMaxCount: 4,
  stringArrayWrappersType: 'function',
  stringArrayThreshold: 0.75,
  transformObjectKeys: true,
  unicodeEscapeSequence: false,
});

// Respaldo antes de sobrescribir
fs.writeFileSync(backupPath, source, 'utf8');
fs.writeFileSync(appJsPath, obfuscationResult.getObfuscatedCode(), 'utf8');

console.log('OK: public/app.js ofuscado. Respaldo en public/app.js.backup');
console.log('Para restaurar el código legible: npm run restore-source');
