/**
 * Script de prueba: Insertar datos de DISPONIBILIDAD COMBINADA (MAÑANA/TARDE + INTERVALOS)
 * Uso: node utils/insert-test-intervalos.js
 */

const db = require('./db-mysql');

async function insertarTestIntervalos() {
  try {
    await db.initPool();
    
    console.log('Limpiando datos anteriores para doctor_id = 6...\n');
    
    // Limpiar
    await db.execute('DELETE FROM doctor_disponibilidad_intervalos WHERE doctor_id = 6');
    await db.execute('DELETE FROM doctor_disponibilidad_mensual WHERE doctor_id = 6');
    
    console.log('Insertando disponibilidad base (MAÑANA/TARDE)...\n');
    
    // Insertar disponibilidad base MAÑANA/TARDE
    const disponibilidadBase = [
      { fecha: '2026-02-23', manana: 0, tarde: 0 },  // Día NO disponible
      { fecha: '2026-02-24', manana: 1, tarde: 1 },  // Disponible ambos turnos
      { fecha: '2026-02-25', manana: 1, tarde: 0 },  // Solo mañana
      { fecha: '2026-02-26', manana: 1, tarde: 1 },  // Disponible ambos turnos
      { fecha: '2026-02-27', manana: 1, tarde: 1 },  // Disponible ambos turnos
    ];
    
    for (const dia of disponibilidadBase) {
      await db.execute(
        `INSERT INTO doctor_disponibilidad_mensual 
         (doctor_id, fecha, disponible_manana, disponible_tarde)
         VALUES (?, ?, ?, ?)`,
        [6, dia.fecha, dia.manana, dia.tarde]
      );
      
      const mananaStr = dia.manana ? 'SÍ' : 'NO';
      const tardeStr = dia.tarde ? 'SÍ' : 'NO';
      console.log(`✓ ${dia.fecha}: MAÑANA=${mananaStr}, TARDE=${tardeStr}`);
    }
    
    console.log('\nInsertando intervalos específicos (refinamiento)...\n');
    
    // Insertar intervalos específicos DENTRO de turnos disponibles
    const intervalos = [
      {
        fecha: '2026-02-24',
        inicio: '10:00:00',
        fin: '11:30:00',
        razon: 'Capacitación médica obligatoria'
      },
      {
        fecha: '2026-02-26',
        inicio: '07:00:00',
        fin: '09:00:00',
        razon: 'Con estudiantes de la universidad'
      },
      {
        fecha: '2026-02-26',
        inicio: '15:00:00',
        fin: '16:00:00',
        razon: 'Reunión con junta directiva'
      },
      {
        fecha: '2026-02-27',
        inicio: '11:00:00',
        fin: '11:45:00',
        razon: 'Evaluación de paciente especial'
      }
    ];
    
    for (const intervalo of intervalos) {
      await db.execute(
        `INSERT INTO doctor_disponibilidad_intervalos 
         (doctor_id, fecha, hora_inicio, hora_fin, razon)
         VALUES (?, ?, ?, ?, ?)`,
        [6, intervalo.fecha, intervalo.inicio, intervalo.fin, intervalo.razon]
      );
      
      console.log(`✓ ${intervalo.fecha}: ${intervalo.inicio.slice(0,5)}-${intervalo.fin.slice(0,5)} - ${intervalo.razon}`);
    }
    
    console.log(`\n✨ Datos de prueba cargados exitosamente\n`);
    console.log('📊 Resumen de disponibilidad (doctor_id=6):');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  2026-02-23: ❌ NO DISPONIBLE (mañana y tarde)');
    console.log('  2026-02-24: ✓ DISPONIBLE (08:00-10:00, 11:30-18:00)');
    console.log('             [Bloqueado: 10:00-11:30 capacitación]');
    console.log('  2026-02-25: ✓ DISPONIBLE (07:00-12:00)');
    console.log('             [Tarde NO disponible]');
    console.log('  2026-02-26: ✓ DISPONIBLE (09:00-15:00, 16:00-18:00)');
    console.log('             [Bloqueado: 07:00-09:00 estudiantes, 15:00-16:00 junta]');
    console.log('  2026-02-27: ✓ DISPONIBLE (07:00-11:00, 11:45-18:00)');
    console.log('             [Bloqueado: 11:00-11:45 evaluación especial]');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    await db.closePool();
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

insertarTestIntervalos();
