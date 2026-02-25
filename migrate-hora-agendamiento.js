#!/usr/bin/env node
require('dotenv').config();
const mysql = require('mysql2/promise');

async function migrateHoraAgendamiento() {
  let connection;
  try {
    connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'innar_recibos',
      multipleStatements: true
    });

    console.log('🔄 Migrando tabla citas_electro - agregando hora_agendamiento...');

    // Add hora_agendamiento column if it doesn't exist
    const columnsResult = await connection.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME = 'citas_electro' AND COLUMN_NAME = 'hora_agendamiento'
    `);

    if (columnsResult[0].length === 0) {
      await connection.execute(`
        ALTER TABLE citas_electro 
        ADD COLUMN hora_agendamiento TIME AFTER fecha
      `);
      console.log('✅ Added hora_agendamiento column');

      // Copy current hora_inicio values to hora_agendamiento (these are the scheduled times)
      await connection.execute(`
        UPDATE citas_electro 
        SET hora_agendamiento = hora_inicio
        WHERE hora_agendamiento IS NULL
      `);
      console.log('✅ Migrated existing agendamiento times');
    } else {
      console.log('ℹ️ hora_agendamiento column already exists');
    }

    console.log('\n✨ Migración completada exitosamente!');
    await connection.end();
  } catch (error) {
    console.error('❌ Error durante la migración:', error.message);
    if (connection) await connection.end();
    process.exit(1);
  }
}

migrateHoraAgendamiento();
