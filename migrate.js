// migrate.js - Script para agregar columna entidad a la tabla turnos
require('dotenv').config();
const db = require('./db-mysql');

async function migrate() {
  try {
    console.log('[MIGRATE] Iniciando migración...');
    
    // Inicializar pool de conexiones
    await db.initPool();
    console.log('[MIGRATE] Pool MySQL inicializado');

    // Verificar si la columna entidad existe
    const result = await db.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME = 'turnos' AND COLUMN_NAME = 'entidad' AND TABLE_SCHEMA = DATABASE()
    `);

    if (result.length === 0) {
      console.log('[MIGRATE] Columna entidad NO existe. Agregando...');
      try {
        await db.execute(`
          ALTER TABLE turnos ADD COLUMN entidad VARCHAR(200) AFTER tipo_consulta
        `);
        console.log('[MIGRATE] ✓ Columna entidad agregada exitosamente');
      } catch (err) {
        if (err.code === 'ER_DUP_FIELDNAME') {
          console.log('[MIGRATE] ✓ Columna entidad ya existe (error ignorado)');
        } else {
          throw err;
        }
      }
    } else {
      console.log('[MIGRATE] ✓ Columna entidad ya existe');
    }

    console.log('[MIGRATE] ✓ Migración completada');
    await db.closePool();
    process.exit(0);
  } catch (e) {
    console.error('[MIGRATE] ✗ Error:', e.message);
    console.error(e);
    await db.closePool();
    process.exit(1);
  }
}

migrate();
