#!/usr/bin/env node
require('dotenv').config();
const mysql = require('mysql2/promise');

async function fixHoraInicio() {
  let connection;
  try {
    connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'innar_recibos',
      multipleStatements: true
    });

    console.log('🔄 Fixeando hora_inicio column...');

    // Make hora_inicio nullable
    await connection.execute(`
      ALTER TABLE citas_electro 
      MODIFY COLUMN hora_inicio TIME NULL
    `);
    console.log('✅ hora_inicio is now nullable');

    console.log('\n✨ Fix completado exitosamente!');
    await connection.end();
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (connection) await connection.end();
    process.exit(1);
  }
}

fixHoraInicio();
