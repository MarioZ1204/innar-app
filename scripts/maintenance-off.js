#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const flagPath = path.join(path.resolve(__dirname, '..'), 'maintenance.flag');

if (fs.existsSync(flagPath)) {
  fs.unlinkSync(flagPath);
  console.log('[OK] Modo mantenimiento DESACTIVADO (maintenance.flag eliminado).');
} else {
  console.log('[OK] No había maintenance.flag. Si usó MAINTENANCE_MODE en .env, póngalo en false y reinicie Node.');
}
