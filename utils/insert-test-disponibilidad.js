#!/usr/bin/env node
// utils/insert-test-disponibilidad.js
// Script para insertar datos de prueba de disponibilidad

const db = require('./db-mysql');

async function insertTestData() {
  try {
    console.log('✓ Conectando a base de datos...\n');
    const pool = await db.initPool();
    
    // Insertar registros de prueba para hoy y próximos días
    const today = new Date();
    const testDates = [];
    
    for (let i = 0; i < 10; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() + i);
      testDates.push(date.toISOString().split('T')[0]);
    }
    
    // Obtener el ID del doctor
    const doctors = await db.query('SELECT id FROM usuarios WHERE rol = "doctor" LIMIT 1');
    if (doctors.length === 0) {
      console.error('❌ No hay doctores en la base de datos');
      process.exit(1);
    }
    
    const doctorId = doctors[0].id;
    console.log(`✓ Usando doctor ID: ${doctorId}\n`);
    
    console.log('📝 Insertando datos de prueba:\n');
    
    for (let i = 0; i < testDates.length; i++) {
      const fecha = testDates[i];
      let manana, tarde;
      
      // Patrón de prueba:
      // Día 0: Ambos SÍ
      // Día 1: Mañana SÍ, Tarde NO
      // Día 2: Mañana NO, Tarde SÍ
      // Día 3: Ambos NO
      // Y se repite...
      
      const pattern = i % 4;
      switch(pattern) {
        case 0:
          manana = 1; tarde = 1;
          console.log(`${fecha} - MAÑANA: SI | TARDE: SI`);
          break;
        case 1:
          manana = 1; tarde = 0;
          console.log(`${fecha} - MAÑANA: SI | TARDE: NO`);
          break;
        case 2:
          manana = 0; tarde = 1;
          console.log(`${fecha} - MAÑANA: NO | TARDE: SI`);
          break;
        case 3:
          manana = 0; tarde = 0;
          console.log(`${fecha} → ❌ MAÑANA: NO │ TARDE: ❌ NO`);
          break;
      }
      
      await db.execute(
        `INSERT INTO doctor_disponibilidad_mensual 
         (doctor_id, fecha, disponible_manana, disponible_tarde) 
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
         disponible_manana = VALUES(disponible_manana),
         disponible_tarde = VALUES(disponible_tarde)`,
        [doctorId, fecha, manana, tarde]
      );
    }
    
    console.log('\n[OK] Datos de prueba insertados correctamente\n');
    console.log('Ahora puedes probar:');
    console.log('- Agendar a las 09:00 en día 0 (debe permitir)');
    console.log('- Agendar a las 15:00 en día 1 (debe rechazar - no disponible tarde)');
    console.log('- Agendar a las 09:00 en día 2 (debe rechazar - no disponible mañana)');
    console.log('- Agendar a las 09:00 en día 3 (debe rechazar - día no disponible)\n');
    
    await db.closePool();
  } catch (e) {
    console.error('❌ Error:', e.message);
    process.exit(1);
  }
}

if (require.main === module) {
  insertTestData();
}

module.exports = { insertTestData };
