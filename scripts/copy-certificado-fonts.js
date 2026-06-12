#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'node_modules', '@fontsource', 'archivo-narrow', 'files');
const destDir = path.join(__dirname, '..', 'public', 'fonts');

const COPIAR = [
  'archivo-narrow-latin-400-normal.woff2',
  'archivo-narrow-latin-600-normal.woff2',
  'archivo-narrow-latin-700-normal.woff2'
];

if (!fs.existsSync(srcDir)) {
  console.warn('[copy-certificado-fonts] @fontsource/archivo-narrow no instalado.');
  process.exit(0);
}

fs.mkdirSync(destDir, { recursive: true });

for (const name of COPIAR) {
  const src = path.join(srcDir, name);
  const dest = path.join(destDir, name);
  if (!fs.existsSync(src)) {
    console.warn('[copy-certificado-fonts] Falta', name);
    continue;
  }
  fs.copyFileSync(src, dest);
}

const readme = path.join(destDir, 'README.txt');
if (!fs.existsSync(readme)) {
  fs.writeFileSync(readme, [
    'Fuentes del certificado de asistencia',
    '',
    'Por defecto se usa Archivo Narrow (sustituto visual de Aptos Narrow).',
    'Para la fuente oficial Aptos Narrow, copie aquí desde Microsoft Office:',
    '  - Aptos-Narrow.ttf',
    '  - Aptos-Narrow-Bold.ttf',
    'Si existen, tienen prioridad sobre Archivo Narrow.',
    ''
  ].join('\n'), 'utf8');
}

console.log('[copy-certificado-fonts] OK → public/fonts (', COPIAR.length, 'archivos )');
