#!/usr/bin/env node
require('dotenv').config();
const mysql = require('mysql2/promise');

async function migrateCitasElectro() {
  let connection;
  try {
    connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'innar_recibos',
      multipleStatements: true
    });

    console.log('🔄 Migrando tabla citas_electro...');

    // First, convert existing data from old ENUM values to new ones
    await connection.execute(`
      UPDATE citas_electro 
      SET estado = 'Programado' 
      WHERE estado = 'PROGRAMADO'
    `);
    console.log('✅ Converted PROGRAMADO → Programado');

    await connection.execute(`
      UPDATE citas_electro 
      SET estado = 'Completado' 
      WHERE estado = 'REALIZADO'
    `);
    console.log('✅ Converted REALIZADO → Completado');

    await connection.execute(`
      UPDATE citas_electro 
      SET estado = 'Cancelado' 
      WHERE estado = 'CANCELADO'
    `);
    console.log('✅ Converted CANCELADO → Cancelado');

    // Now modify the table
    await connection.execute(`
      ALTER TABLE citas_electro 
      MODIFY COLUMN estado ENUM('Programado', 'En Sala', 'En Estudio', 'Completado', 'No Asistió', 'Cancelado') 
      NOT NULL DEFAULT 'Programado'
    `);
    console.log('✅ Updated estado column ENUM values');

    // Make equipo_id nullable if it isn't already
    await connection.execute(`
      ALTER TABLE citas_electro 
      MODIFY COLUMN equipo_id INT NULL
    `);
    console.log('✅ Made equipo_id nullable');

    // Add diagnostico_id column if it doesn't exist
    const columnsResult = await connection.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME = 'citas_electro' AND COLUMN_NAME = 'diagnostico_id'
    `);

    if (columnsResult[0].length === 0) {
      await connection.execute(`
        ALTER TABLE citas_electro 
        ADD COLUMN diagnostico_id INT AFTER observaciones,
        ADD FOREIGN KEY (diagnostico_id) REFERENCES diagnosticos(id) ON DELETE SET NULL
      `);
      console.log('✅ Added diagnostico_id column');
    } else {
      console.log('ℹ️ diagnostico_id column already exists');
    }

    // Add programado_por_nombre column if it doesn't exist
    const programadoResult = await connection.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME = 'citas_electro' AND COLUMN_NAME = 'programado_por_nombre'
    `);

    if (programadoResult[0].length === 0) {
      await connection.execute(`
        ALTER TABLE citas_electro 
        ADD COLUMN programado_por_nombre VARCHAR(150) AFTER diagnostico_id
      `);
      console.log('✅ Added programado_por_nombre column');
    } else {
      console.log('ℹ️ programado_por_nombre column already exists');
    }

    console.log('\n✨ Migración completada exitosamente!');
    await connection.end();
  } catch (error) {
    console.error('❌ Error durante la migración:', error.message);
    if (connection) await connection.end();
    process.exit(1);
  }
}

migrateCitasElectro();
