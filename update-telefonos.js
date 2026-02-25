#!/usr/bin/env node
require('dotenv').config();
const mysql = require('mysql2/promise');

async function updatePacientes() {
  let connection;
  try {
    connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'innar_recibos',
      multipleStatements: true
    });

    console.log('📝 Actualizando teléfonos de pacientes de prueba...\n');

    const telefonos = [
      '3001234567',
      '3109876543',
      '3145678901',
      '3161234567',
      '3175432109'
    ];

    const pacientes = await connection.query(`SELECT id FROM pacientes ORDER BY id ASC LIMIT ${telefonos.length}`);
    
    for (let i = 0; i < pacientes[0].length; i++) {
      const pacienteId = pacientes[0][i].id;
      const telefono = telefonos[i];
      
      await connection.execute(`UPDATE pacientes SET telefono = ? WHERE id = ?`, [telefono, pacienteId]);
      console.log(`✅ Paciente ${pacienteId}: ${telefono}`);
    }

    console.log(`\n🎉 Actualización completada!`);

    await connection.end();
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (connection) await connection.end();
    process.exit(1);
  }
}

updatePacientes();
