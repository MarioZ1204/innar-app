#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const flagPath = path.join(root, 'maintenance.flag');
const configPath = path.join(root, 'maintenance.json');

const message = process.argv.slice(2).join(' ').trim();

fs.writeFileSync(flagPath, `${new Date().toISOString()}\n`, 'utf8');

if (message) {
  let cfg = {};
  try {
    if (fs.existsSync(configPath)) cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (_) { /* ignore */ }
  cfg.message = message;
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf8');
}

console.log('[OK] Modo mantenimiento ACTIVADO (maintenance.flag creado).');
console.log('     Reinicie Node si también usa MAINTENANCE_MODE en .env.');
console.log('     Vista previa: /mantenimiento?preview=1');
console.log('     Desactivar: npm run maintenance:off');
