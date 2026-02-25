#!/usr/bin/env node
require('dotenv').config();
const mysql = require('mysql2/promise');

async function checkTriggers() {
  let connection;
  try {
    connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'innar_recibos',
      multipleStatements: true
    });

    console.log('🔍 Verificando triggers en citas_electro...\n');

    // Check for triggers
    const triggers = await connection.query(`
      SELECT TRIGGER_NAME, EVENT_MANIPULATION
      FROM INFORMATION_SCHEMA.TRIGGERS 
      WHERE TRIGGER_SCHEMA = DATABASE() 
      AND EVENT_OBJECT_TABLE = 'citas_electro'
    `);

    if (triggers[0].length === 0) {
      console.log('✅ No hay triggers en citas_electro');
    } else {
      console.log('⚠️ Se encontraron triggers:');
      triggers[0].forEach(t => {
        console.log(`\n  Trigger: ${t.TRIGGER_NAME}`);
        console.log(`  Evento: ${t.EVENT_MANIPULATION}`);
      });
    }

    // Check column defaults
    console.log('\n\n🔍 Verificando defaults de columnas...\n');
    const columns = await connection.query(`
      SELECT COLUMN_NAME, COLUMN_DEFAULT, IS_NULLABLE
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'citas_electro'
      ORDER BY ORDINAL_POSITION
    `);

    columns[0].forEach(col => {
      if (['hora_inicio', 'hora_agendamiento', 'hora_fin'].includes(col.COLUMN_NAME)) {
        console.log(`${col.COLUMN_NAME}: Default="${col.COLUMN_DEFAULT}" | Nullable=${col.IS_NULLABLE}`);
      }
    });

    await connection.end();
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (connection) await connection.end();
    process.exit(1);
  }
}

checkTriggers();
