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
const BACKUP_DIR = path.join(__dirname, '../backups');
const MAX_BACKUPS = 7; // Mantener últimos 7 backups (1 semana)

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
 * Ejecutar mysqldump y crear backup
 */
function createBackup() {
  return new Promise((resolve, reject) => {
    ensureBackupDir();
    
    const filename = getBackupFilename();
    const filepath = path.join(BACKUP_DIR, filename);
    const writeStream = fs.createWriteStream(filepath);

    console.log(`⏳ Creando backup: ${filename}`);
    
    // Comando mysqldump
    const mysqldump = spawn('mysqldump', [
      `--host=${DB_HOST}`,
      `--port=${DB_PORT}`,
      `--user=${DB_USER}`,
      DB_PASSWORD ? `--password=${DB_PASSWORD}` : '--no-password',
      '--single-transaction',     // No bloquear tablas
      '--routines',              // Incluir stored procedures
      '--triggers',              // Incluir triggers
      '--events',                // Incluir events
      '--quick',                 // Búfer de límite
      '--lock-tables=false',     // Mejor para producción
      DB_NAME
    ]);

    mysqldump.stdout.pipe(writeStream);

    mysqldump.stderr.on('data', (data) => {
      console.error(`❌ Error mysqldump: ${data}`);
    });

    mysqldump.on('close', (code) => {
      if (code === 0) {
        const stats = fs.statSync(filepath);
        const sizeInMB = (stats.size / (1024 * 1024)).toFixed(2);
        console.log(`✅ Backup creado: ${filename} (${sizeInMB} MB)`);
        
        // Limpiar backups antiguos
        cleanOldBackups();
        resolve(filepath);
      } else {
        reject(new Error(`mysqldump terminó con código ${code}`));
      }
    });
  });
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
      
      console.log(`✅ Manteniendo últimos ${MAX_BACKUPS} backups`);
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
    } else {
      // Crear backup
      await createBackup();
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

module.exports = { createBackup };
