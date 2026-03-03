#!/usr/bin/env node
// utils/debug-disponibilidad.js
// Script para debuguear la disponibilidad de doctores

const db = require('./db-mysql');

async function debugDisponibilidad() {
  try {
    console.log('✓ Conectando a base de datos...\n');
    const pool = await db.initPool();
    
    // Obtener todos los registros de disponibilidad
    console.log('📋 REGISTROS DE DISPONIBILIDAD EN BASE DE DATOS:\n');
    
    const registros = await db.query(`
      SELECT 
        d.id,
        u.usuario as doctor,
        d.fecha,
        d.disponible_manana,
        d.disponible_tarde,
        d.creado_en
      FROM doctor_disponibilidad_mensual d
      LEFT JOIN usuarios u ON d.doctor_id = u.id
      ORDER BY d.fecha DESC, d.doctor_id
      LIMIT 20
    `);
    
    if (registros.length === 0) {
      console.log('❌ No hay registros de disponibilidad en la base de datos\n');
    } else {
      console.log('┌─────────────────────────────────────────────────────────────────┐');
      console.log('│ ID │ Doctor │ Fecha │ Mañana │ Tarde │ Creado');
      console.log('├────┼────────┼───────┼────────┼───────┼─────────────────────┤');
      
      registros.forEach(r => {
        const manana = r.disponible_manana === 1 || r.disponible_manana === true ? '[OK] SI' : '[NO] NO';
        const tarde = r.disponible_tarde === 1 || r.disponible_tarde === true ? '[OK] SI' : '[NO] NO';
        const fecha = r.fecha ? new Date(r.fecha).toISOString().split('T')[0] : 'N/A';
        console.log(`│ ${r.id.toString().padEnd(3)} │ ${(r.doctor || '-').padEnd(6)} │ ${fecha} │ ${manana.padEnd(6)} │ ${tarde.padEnd(5)} │ ${r.creado_en}`);
      });
      
      console.log('└────┴────────┴───────┴────────┴───────┴─────────────────────┘\n');
    }
    
    // Obtener información sobre los tipos de datos
    console.log('🔍 INFORMACIÓN DE COLUMNAS:\n');
    
    const columns = await db.query(`
      SELECT 
        COLUMN_NAME,
        COLUMN_TYPE,
        IS_NULLABLE,
        COLUMN_DEFAULT
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'doctor_disponibilidad_mensual'
      AND COLUMN_NAME IN ('disponible_manana', 'disponible_tarde', 'disponible')
    `);
    
    console.log('┌──────────────────┬──────────────┬──────────┬────────────┐');
    console.log('│ COLUMNA │ TIPO │ NULLABLE │ DEFAULT');
    console.log('├──────────────────┼──────────────┼──────────┼────────────┤');
    
    columns.forEach(col => {
      console.log(`│ ${col.COLUMN_NAME.padEnd(16)} │ ${col.COLUMN_TYPE.padEnd(12)} │ ${(col.IS_NULLABLE || 'N/A').padEnd(8)} │ ${col.COLUMN_DEFAULT || '-'}`);
    });
    
    console.log('└──────────────────┴──────────────┴──────────┴────────────┘\n');
    
    console.log('[OK] Debug completado\n');
    
    await db.closePool();
  } catch (e) {
    console.error('❌ Error:', e.message);
    process.exit(1);
  }
}

if (require.main === module) {
  debugDisponibilidad();
}

module.exports = { debugDisponibilidad };
