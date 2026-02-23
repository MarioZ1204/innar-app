// migrate-recibos.js - Script para crear/resetear tabla de recibos con estructura correcta
require('dotenv').config();
const db = require('./db-mysql');

async function migrate() {
  try {
    console.log('[MIGRATE RECIBOS] Iniciando migración...');
    
    // Inicializar pool de conexiones
    await db.initPool();
    console.log('[MIGRATE RECIBOS] Pool MySQL inicializado');

    // Primero, intentar eliminar la tabla existente para crear limpia
    try {
      await db.execute('DROP TABLE IF EXISTS recibos');
      console.log('[MIGRATE RECIBOS] Tabla recibos anterior eliminada (limpia)');
    } catch (err) {
      console.log('[MIGRATE RECIBOS] Sin tabla anterior para eliminar');
    }

    // Crear tabla recibos nueva con estructura correcta
    await db.execute(`
      CREATE TABLE recibos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        numero VARCHAR(50) NULL,
        cliente VARCHAR(255) NULL,
        fecha DATE NULL,
        total DECIMAL(10, 2) NULL,
        data LONGTEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('[MIGRATE RECIBOS] ✓ Tabla recibos creada exitosamente con estructura correcta');

    console.log('[MIGRATE RECIBOS] ✓ Migración completada');
    await db.closePool();
    process.exit(0);
  } catch (e) {
    console.error('[MIGRATE RECIBOS] ✗ Error:', e.message);
    console.error(e);
    await db.closePool();
    process.exit(1);
  }
}

migrate();
