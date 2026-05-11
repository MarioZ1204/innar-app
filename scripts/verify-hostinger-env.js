#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const REQUIRED_ENV = ['DB_HOST', 'DB_USER', 'DB_NAME', 'SESSION_SECRET'];
const RECOMMENDED_ENV = ['PORT', 'NODE_ENV', 'FRONTEND_URL', 'DB_PASSWORD'];

const projectRoot = process.cwd();
const envPath = path.join(projectRoot, '.env');

function parseEnvFile(filePath) {
  const env = {};
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const idx = line.indexOf('=');
    if (idx === -1) continue;

    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    env[key] = value;
  }

  return env;
}

function main() {
  if (!fs.existsSync(envPath)) {
    console.error('[ERROR] No existe .env en la raiz del proyecto.');
    console.error('[ERROR] En Hostinger debes crear variables en el panel Node.js App.');
    process.exit(1);
  }

  const env = parseEnvFile(envPath);
  const missingRequired = REQUIRED_ENV.filter((key) => !env[key]);
  const missingRecommended = RECOMMENDED_ENV.filter((key) => !env[key]);

  if (missingRequired.length > 0) {
    console.error(`[ERROR] Variables requeridas faltantes: ${missingRequired.join(', ')}`);
    process.exit(1);
  }

  if (env.NODE_ENV && env.NODE_ENV !== 'production') {
    console.warn(`[WARN] NODE_ENV actual es "${env.NODE_ENV}". En Hostinger debe ser "production".`);
  }

  if (env.FRONTEND_URL && !/^https:\/\//.test(env.FRONTEND_URL)) {
    console.warn('[WARN] FRONTEND_URL no usa https://');
  }

  if (missingRecommended.length > 0) {
    console.warn(`[WARN] Variables recomendadas faltantes: ${missingRecommended.join(', ')}`);
  }

  console.log('[OK] Validacion de .env para Hostinger completada.');
}

main();
