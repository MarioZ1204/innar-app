#!/usr/bin/env node
require('dotenv').config();
const mysql = require('mysql2/promise');

async function checkPacientes() {
  let connection;
  try {
    connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'innar_recibos',
      multipleStatements: true
    });

    console.log('🔍 Verificando pacientes...\n');

    const result = await connection.query(`
      SELECT id, nombre, documento, telefono FROM pacientes LIMIT 5
    `);

    console.log('📋 Primeros 5 pacientes:\n');
    result[0].forEach(p => {
      console.log(`ID: ${p.id}`);
      console.log(`  Nombre: ${p.nombre}`);
      console.log(`  Documento: ${p.documento}`);
      console.log(`  Teléfono: ${p.telefono || '❌ NULL'}`);
      console.log('');
    });

    await connection.end();
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (connection) await connection.end();
    process.exit(1);
  }
}

checkPacientes();
