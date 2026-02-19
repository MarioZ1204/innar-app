// migrate-estados.js - Script para agregar EN_ATENCION al ENUM de estados
require('dotenv').config();
const db = require('./db-mysql');

async function migrate() {
  try {
    console.log('[MIGRATE-ESTADOS] Iniciando migración de estados...');
    
    // Inicializar pool de conexiones
    await db.initPool();
    console.log('[MIGRATE-ESTADOS] Pool MySQL inicializado');

    console.log('[MIGRATE-ESTADOS] Actualizando ENUM de estados...');
    try {
      await db.execute(`
        ALTER TABLE turnos MODIFY COLUMN estado ENUM('PENDIENTE', 'EN_SALA', 'EN_ATENCION', 'COMPLETADO', 'CANCELADO', 'ATENDIDO', 'NO_ASISTIO', 'REPROGRAMADO') NOT NULL DEFAULT 'PENDIENTE'
      `);
      console.log('[MIGRATE-ESTADOS] ✓ ENUM de estados actualizado exitosamente');
    } catch (err) {
      console.error('[MIGRATE-ESTADOS] Error:', err.message);
      throw err;
    }

    console.log('[MIGRATE-ESTADOS] ✓ Migración completada');
    await db.closePool();
    process.exit(0);
  } catch (e) {
    console.error('[MIGRATE-ESTADOS] ✗ Error:', e.message);
    console.error(e);
    await db.closePool();
    process.exit(1);
  }
}

migrate();
