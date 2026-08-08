#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Garantiza Chromium para Puppeteer (postinstall y arranque en Hostinger).
 * La caché debe vivir fuera del deploy (ver config/puppeteer-cache-path.js).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { applyPuppeteerCacheEnv, getPuppeteerCacheDir } = require('../config/puppeteer-cache-path');

const projectRoot = path.join(__dirname, '..');

function resolveBundledExecutable() {
  applyPuppeteerCacheEnv();
  try {
    const puppeteer = require('puppeteer');
    if (typeof puppeteer.executablePath !== 'function') return null;
    const executablePath = puppeteer.executablePath();
    if (executablePath && fs.existsSync(executablePath)) return executablePath;
  } catch (e) {
    console.warn('[ensure-chromium] No se pudo resolver Chrome:', e.message);
  }
  return null;
}

function installChrome(cacheDir) {
  console.log('[ensure-chromium] Descargando Chrome en', cacheDir);
  execSync('npx puppeteer browsers install chrome', {
    cwd: projectRoot,
    stdio: 'inherit',
    env: { ...process.env, PUPPETEER_CACHE_DIR: cacheDir },
  });
}

/**
 * @param {{ install?: boolean }} opts
 * @returns {Promise<{ ok: boolean, executablePath?: string, cacheDir: string, installed?: boolean, error?: string }>}
 */
async function ensureChromiumReady(opts = {}) {
  const install = opts.install !== false;
  const cacheDir = getPuppeteerCacheDir();
  applyPuppeteerCacheEnv();

  let executablePath = resolveBundledExecutable();
  if (executablePath) {
    return { ok: true, executablePath, cacheDir };
  }

  if (!install) {
    return {
      ok: false,
      cacheDir,
      error: 'Chrome no instalado. Ejecute npm install o defina PUPPETEER_EXECUTABLE_PATH.',
    };
  }

  try {
    installChrome(cacheDir);
    executablePath = resolveBundledExecutable();
    if (executablePath) {
      console.log('[ensure-chromium] Chrome listo:', executablePath);
      return { ok: true, executablePath, cacheDir, installed: true };
    }
  } catch (e) {
    console.warn('[ensure-chromium] Instalación automática falló:', e.message);
    return {
      ok: false,
      cacheDir,
      error: e.message || 'No se pudo instalar Chrome',
    };
  }

  return {
    ok: false,
    cacheDir,
    error: 'Chrome no disponible tras la instalación',
  };
}

function main() {
  ensureChromiumReady({ install: true })
    .then((r) => {
      if (!r.ok) {
        console.warn('[ensure-chromium] Defina PUPPETEER_CACHE_DIR o PUPPETEER_EXECUTABLE_PATH en Hostinger si el PDF sigue fallando.');
      }
    })
    .catch((e) => {
      console.warn('[ensure-chromium] Error:', e.message);
    });
}

if (require.main === module) {
  main();
}

module.exports = { ensureChromiumReady, resolveBundledExecutable };
