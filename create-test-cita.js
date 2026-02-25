#!/usr/bin/env node
require('dotenv').config();
const mysql = require('mysql2/promise');

async function createTestCita() {
  let connection;
  try {
    connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'innar_recibos',
      multipleStatements: true
    });

    console.log('📝 Creando cita de prueba...\n');

    // Get first paciente
    const pacientes = await connection.query(`SELECT id FROM pacientes LIMIT 1`);
    const paciente_id = pacientes[0][0].id;
    console.log(`👤 Paciente ID: ${paciente_id}`);

    // Get first equipo
    const equipos = await connection.query(`SELECT id FROM equipos_electro LIMIT 1`);
    const equipo_id = equipos[0][0].id;
    console.log(`⚙️ Equipo ID: ${equipo_id}`);

    // Get first diagnostico
    const diagnosticos = await connection.query(`SELECT id FROM diagnosticos LIMIT 1`);
    const diagnostico_id = diagnosticos[0][0].id;
    console.log(`📋 Diagnóstico ID: ${diagnostico_id}`);

    // Insert cita
    const hoy = new Date().toISOString().split('T')[0];
    const result = await connection.execute(`
      INSERT INTO citas_electro (
        equipo_id, 
        paciente_id, 
        fecha, 
        hora_agendamiento,
        hora_inicio,
        hora_fin, 
        estudio, 
        observaciones, 
        diagnostico_id, 
        estado,
        programado_por_nombre
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      equipo_id,
      paciente_id,
      hoy,
      '10:00:00',
      null,
      null,
      'EEG',
      'Cita de prueba',
      diagnostico_id,
      'Programado',
      'Test Usuario'
    ]);

    console.log(`\n✅ Cita creada con ID: ${result[0].insertId}`);
    console.log(`📅 Fecha: ${hoy}`);
    console.log(`🕐 Hora Agendamiento: 10:00:00`);
    console.log(`Ahora puedes verificar en la interfaz con fecha: ${hoy}`);

    await connection.end();
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (connection) await connection.end();
    process.exit(1);
  }
}

createTestCita();
