// migrate-consultorio.js - Agregar columna numero_consultorio a usuarios
require('dotenv').config();
const db = require('./db-mysql');

async function migrate() {
  try {
    await db.initPool();
    console.log('🔄 Iniciando migración de consultorio...');

    // Verificar si la columna ya existe
    const columns = await db.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME = 'usuarios' AND COLUMN_NAME = 'numero_consultorio'
    `);

    if (columns.length > 0) {
      console.log('✓ Columna numero_consultorio ya existe');
      process.exit(0);
    }

    // Agregar columna
    console.log('📌 Agregando columna numero_consultorio...');
    await db.execute(`
      ALTER TABLE usuarios 
      ADD COLUMN numero_consultorio INT DEFAULT NULL
    `);
    console.log('✓ Columna agregada exitosamente');

    console.log('✅ Migración completada');
    process.exit(0);
  } catch (e) {
    console.error('❌ Error en la migración:', e.message);
    process.exit(1);
  }
}

migrate();
