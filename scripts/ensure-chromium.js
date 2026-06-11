#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Garantiza Chromium para Puppeteer tras npm install (Hostinger no trae Chrome del sistema).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const projectRoot = path.join(__dirname, '..');
const cacheDir = path.join(projectRoot, '.cache', 'puppeteer');

function chromeListo() {
  try {
    const puppeteer = require('puppeteer');
    if (typeof puppeteer.executablePath !== 'function') return null;
    const executablePath = puppeteer.executablePath();
    if (executablePath && fs.existsSync(executablePath)) {
      console.log('[ensure-chromium] Chrome listo:', executablePath);
      return executablePath;
    }
  } catch (e) {
    console.warn('[ensure-chromium] No se pudo resolver Chrome:', e.message);
  }
  return null;
}

function instalarChrome() {
  const env = {
    ...process.env,
    PUPPETEER_CACHE_DIR: cacheDir
  };
  console.log('[ensure-chromium] Descargando Chrome en', cacheDir);
  execSync('npx puppeteer browsers install chrome', {
    cwd: projectRoot,
    stdio: 'inherit',
    env
  });
}

function main() {
  if (chromeListo()) return;
  try {
    instalarChrome();
  } catch (e) {
    console.warn('[ensure-chromium] Instalación automática falló:', e.message);
    console.warn('[ensure-chromium] Defina PUPPETEER_EXECUTABLE_PATH en Hostinger si el PDF sigue fallando.');
  }
  chromeListo();
}

main();
