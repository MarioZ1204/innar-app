#!/usr/bin/env node
require('dotenv').config();
const mysql = require('mysql2/promise');

async function findCitas() {
  let connection;
  try {
    connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'innar_recibos',
      multipleStatements: true
    });

    console.log('🔍 Buscando citas en la base de datos...\n');

    // Get all distinct dates
    const result = await connection.query(`
      SELECT DISTINCT fecha FROM citas_electro ORDER BY fecha DESC LIMIT 10
    `);

    const fechas = result[0];

    if (fechas.length === 0) {
      console.log('❌ No hay citas electro en la base de datos');
    } else {
      console.log(`✅ Encontradas citas en las siguientes fechas:\n`);
      fechas.forEach(f => {
        console.log(`  - ${f.fecha}`);
      });

      // Get details for the first date
      if(fechas.length > 0) {
        const primeraFecha = fechas[0].fecha;
        console.log(`\n📋 Detalles para fecha: ${primeraFecha}\n`);

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

        const citas = await connection.query(query, [primeraFecha]);

        citas[0].forEach((cita, idx) => {
          console.log(`Cita ${idx + 1}:`);
          console.log(`  Paciente: ${cita.paciente_nombre}`);
          console.log(`  Teléfono: ${cita.telefono || '❌ NULL'}`);
          console.log(`  Diagnóstico: ${cita.diagnostico_nombre || '❌ NULL'}`);
          console.log(`  Estado: ${cita.estado}`);
        });
      }
    }

    await connection.end();
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (connection) await connection.end();
    process.exit(1);
  }
}

findCitas();
