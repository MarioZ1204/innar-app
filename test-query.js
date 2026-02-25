#!/usr/bin/env node
require('dotenv').config();
const mysql = require('mysql2/promise');

async function testQuery() {
  let connection;
  try {
    connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'innar_recibos',
      multipleStatements: true
    });

    console.log('🔍 Testing GET query...\n');

    // Get today's date (or any date with data)
    const hoy = new Date().toISOString().split('T')[0];
    console.log(`📅 Testing with fecha: ${hoy}\n`);

    const query = `
      SELECT c.*, 
             p.nombre AS paciente_nombre, 
             p.documento AS paciente_documento,
             p.telefono AS telefono,
             d.nombre AS diagnostico_nombre,
             e.nombre AS equipo_nombre
      FROM citas_electro c
      JOIN pacientes p ON p.id = c.paciente_id
      LEFT JOIN diagnosticos d ON d.id = c.diagnostico_id
      LEFT JOIN equipos_electro e ON e.id = c.equipo_id
      WHERE c.fecha = ?
      ORDER BY c.hora_agendamiento ASC, c.hora_inicio ASC, c.id ASC
    `;

    const result = await connection.query(query, [hoy]);
    const citas = result[0];

    if (citas.length === 0) {
      console.log('❌ No citas found for today');
    } else {
      console.log(`✅ Found ${citas.length} cita(s)\n`);
      citas.forEach((cita, idx) => {
        console.log(`\n📋 Cita ${idx + 1}:`);
        console.log(`  ID: ${cita.id}`);
        console.log(`  Paciente: ${cita.paciente_nombre}`);
        console.log(`  Documento: ${cita.paciente_documento}`);
        console.log(`  Teléfono: ${cita.telefono || 'NULL'}`);
        console.log(`  Estudio: ${cita.estudio}`);
        console.log(`  Diagnóstico ID: ${cita.diagnostico_id}`);
        console.log(`  Diagnóstico Nombre: ${cita.diagnostico_nombre || 'NULL'}`);
        console.log(`  Estado: ${cita.estado}`);
      });
    }

    await connection.end();
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (connection) await connection.end();
    process.exit(1);
  }
}

testQuery();
