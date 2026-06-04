#!/usr/bin/env node
// utils/backup.js
// Script para hacer backup automático de la base de datos
// Uso: node utils/backup.js
// O programado en cron: 0 2 * * * /usr/bin/node /ruta/al/backup.js

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PORT = process.env.DB_PORT || 3306;
const DB_USER = process.env.DB_USER || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || '';
const DB_NAME = process.env.DB_NAME || 'innar_clinica';

// Carpeta de backups
const BACKUP_DIR = process.env.BACKUP_DIR
  ? path.resolve(process.env.BACKUP_DIR)
  : path.join(__dirname, '../backups');
const MAX_BACKUPS = parseInt(process.env.MAX_BACKUPS) || 14;

/**
 * Detectar ruta de mysqldump (XAMPP en Windows o PATH del sistema)
 */
function getMysqldumpPath() {
  if (process.platform === 'win32') {
    const xamppPath = 'C:\\xampp\\mysql\\bin\\mysqldump.exe';
    if (fs.existsSync(xamppPath)) return xamppPath;
  }
  return 'mysqldump'; // fallback al PATH del sistema
}

/**
 * Crear carpeta de backups si no existe
 */
function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    console.log(`📁 Carpeta de backups creada: ${BACKUP_DIR}`);
  }
}

/**
 * Obtener nombre del archivo de backup con timestamp
 */
function getBackupFilename() {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, -5);
  return `backup-${DB_NAME}-${timestamp}.sql`;
}

/**
 * Volcado SQL a un archivo (reutilizable por backup completo).
 * @param {string} filepath
 */
function dumpDatabaseToFile(filepath) {
  return new Promise((resolve, reject) => {
    ensureBackupDir();
    const writeStream = fs.createWriteStream(filepath);
    const childEnv = { ...process.env };
    if (DB_PASSWORD) childEnv.MYSQL_PWD = DB_PASSWORD;

    const mysqldump = spawn(getMysqldumpPath(), [
      `--host=${DB_HOST}`,
      `--port=${DB_PORT}`,
      `--user=${DB_USER}`,
      '--default-auth=mysql_native_password',
      '--single-transaction',
      '--skip-lock-tables',
      '--routines',
      '--triggers',
      '--events',
      '--quick',
      DB_NAME
    ], { env: childEnv });

    mysqldump.stdout.pipe(writeStream);

    mysqldump.stderr.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) console.warn(`⚠️ mysqldump: ${msg}`);
    });

    mysqldump.on('error', (err) => {
      writeStream.destroy();
      try { fs.unlinkSync(filepath); } catch (_) {}
      reject(new Error(`No se pudo ejecutar mysqldump: ${err.message}. Verifique que existe en C:\\xampp\\mysql\\bin\\`));
    });

    mysqldump.on('close', (code) => {
      writeStream.end();
      if (code === 0) resolve(filepath);
      else {
        try { fs.unlinkSync(filepath); } catch (_) {}
        reject(new Error(`mysqldump terminó con código ${code}`));
      }
    });
  });
}

/**
 * Ejecutar mysqldump y crear backup SQL diario
 */
async function createBackup() {
  ensureBackupDir();
  const filename = getBackupFilename();
  const filepath = path.join(BACKUP_DIR, filename);
  console.log(`⏳ Creando backup: ${filename}`);
  await dumpDatabaseToFile(filepath);
  const stats = fs.statSync(filepath);
  const sizeInMB = (stats.size / (1024 * 1024)).toFixed(2);
  console.log(`[OK] Backup creado: ${filename} (${sizeInMB} MB)`);
  cleanOldBackups();
  return filepath;
}

/**
 * Eliminar backups antiguos, mantener solo los últimos MAX_BACKUPS
 */
function cleanOldBackups() {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('backup-') && f.endsWith('.sql'))
      .sort()
      .reverse(); // Más recientes primero

    if (files.length > MAX_BACKUPS) {
      const toDelete = files.slice(MAX_BACKUPS);
      console.log(`🧹 Limpiando ${toDelete.length} backups antiguos...`);
      
      toDelete.forEach(file => {
        const filepath = path.join(BACKUP_DIR, file);
        fs.unlinkSync(filepath);
        console.log(`   Eliminado: ${file}`);
      });
      
      console.log(`[OK] Manteniendo últimos ${MAX_BACKUPS} backups`);
    }
  } catch (error) {
    console.error('❌ Error limpiando backups antiguos:', error.message);
  }
}

/**
 * Listar backups disponibles
 */
function listBackups() {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('backup-') && f.endsWith('.sql'))
      .sort()
      .reverse();

    if (files.length === 0) {
      console.log('ℹ️ No hay backups disponibles');
      return;
    }

    console.log('\n📋 Backups disponibles:');
    files.forEach((file, i) => {
      const filepath = path.join(BACKUP_DIR, file);
      const stats = fs.statSync(filepath);
      const sizeInMB = (stats.size / (1024 * 1024)).toFixed(2);
      const date = new Date(stats.mtimeMs).toLocaleString();
      console.log(`  ${i + 1}. ${file} (${sizeInMB} MB) - ${date}`);
    });
    console.log();
  } catch (error) {
    console.error('❌ Error listando backups:', error.message);
  }
}

/**
 * Verificar integridad de un backup: tamaño mínimo y presencia de CREATE TABLE
 */
function verifyBackup(filepath) {
  try {
    const stats = fs.statSync(filepath);
    if (stats.size < 1024) {
      return { ok: false, error: 'Archivo demasiado pequeño (< 1KB), posible backup corrupto' };
    }
    const content = fs.readFileSync(filepath, 'utf8');
    const tables = (content.match(/CREATE TABLE/gi) || []).length;
    if (tables === 0) {
      return { ok: false, error: 'No se encontraron sentencias CREATE TABLE' };
    }
    const hasInsert = /INSERT INTO/i.test(content);
    return {
      ok: true,
      sizeMB: (stats.size / (1024 * 1024)).toFixed(2),
      tables,
      hasData: hasInsert
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Comando principal
 */
async function main() {
  const command = process.argv[2];

  console.log('🔐 UTILIDAD DE BACKUP - BASE DE DATOS INNAR CLÍNICA');
  console.log(`Base de datos: ${DB_NAME}`);
  console.log(`Host: ${DB_HOST}:${DB_PORT}`);
  console.log(`Directorio: ${BACKUP_DIR}\n`);

  try {
    if (command === 'list') {
      listBackups();
    } else if (command === 'verify') {
      const files = fs.readdirSync(BACKUP_DIR)
        .filter(f => f.startsWith('backup-') && f.endsWith('.sql'))
        .sort().reverse();
      if (files.length === 0) { console.log('No hay backups para verificar'); return; }
      const target = process.argv[3] ? path.join(BACKUP_DIR, process.argv[3]) : path.join(BACKUP_DIR, files[0]);
      console.log(`Verificando: ${path.basename(target)}`);
      const result = verifyBackup(target);
      if (result.ok) {
        console.log(`✅ Backup válido: ${result.sizeMB} MB, ${result.tables} tablas, datos: ${result.hasData ? 'sí' : 'no'}`);
      } else {
        console.error(`❌ Backup inválido: ${result.error}`);
      }
    } else {
      // Crear backup
      const filepath = await createBackup();
      // Verificar automáticamente
      const v = verifyBackup(filepath);
      if (v.ok) {
        console.log(`✅ Verificación OK: ${v.tables} tablas, datos: ${v.hasData ? 'sí' : 'no'}`);
      } else {
        console.warn(`⚠️ Verificación falló: ${v.error}`);
      }
      listBackups();
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

// Ejecutar si se llama directamente
if (require.main === module) {
  main();
}

module.exports = {
  BACKUP_DIR,
  DB_HOST,
  DB_PORT,
  DB_USER,
  DB_PASSWORD,
  DB_NAME,
  MAX_BACKUPS,
  getMysqldumpPath,
  ensureBackupDir,
  createBackup,
  dumpDatabaseToFile,
  verifyBackup
};
