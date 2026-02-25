#!/usr/bin/env node
require('dotenv').config();
const mysql = require('mysql2/promise');

async function checkData() {
  let connection;
  try {
    connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'innar_recibos',
      multipleStatements: true
    });

    console.log('🔍 Verificando datos en la base de datos...\n');

    // Check pacientes
    const pacientes = await connection.query(`SELECT COUNT(*) as total FROM pacientes`);
    console.log(`👥 Pacientes: ${pacientes[0][0].total}`);

    // Check diagnosticos
    const diagnosticos = await connection.query(`SELECT COUNT(*) as total FROM diagnosticos`);
    console.log(`📋 Diagnósticos: ${diagnosticos[0][0].total}`);

    // Check équipos
    const equipos = await connection.query(`SELECT COUNT(*) as total FROM equipos_electro`);
    console.log(`⚙️ Equipos: ${equipos[0][0].total}`);

    // Check citas_electro
    const citas = await connection.query(`SELECT COUNT(*) as total FROM citas_electro`);
    console.log(`🕐 Citas Electro: ${citas[0][0].total}`);

    // Check citas_electro column structure
    console.log(`\n📊 Estructura de citas_electro:\n`);
    const columns = await connection.query(`
      SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'citas_electro'
      ORDER BY ORDINAL_POSITION
    `);

    columns[0].forEach(col => {
      console.log(`  ${col.COLUMN_NAME}: ${col.COLUMN_TYPE} | Nullable=${col.IS_NULLABLE} | Default=${col.COLUMN_DEFAULT}`);
    });

    await connection.end();
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (connection) await connection.end();
    process.exit(1);
  }
}

checkData();
