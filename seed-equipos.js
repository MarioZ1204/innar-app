// Seed de equipos para electrodiagnóstico
require('dotenv').config();
const db = require('./utils/db-mysql');

const equipos = [
  { nombre: 'Equipo 1', descripcion: 'Electroencefalógrafo - Sala 1' },
  { nombre: 'Equipo 2', descripcion: 'Electroencefalógrafo - Sala 2' },
  { nombre: 'Equipo 3', descripcion: 'Electromiografía - Sala 3' },
  { nombre: 'Equipo 4', descripcion: 'Electrocardiografía - Sala 4' }
];

async function seedEquipos() {
  try {
    // Inicializar pool
    await db.initPool();
    
    console.log('Eliminando equipos existentes...');
    await db.execute('DELETE FROM equipos_electro');
    
    console.log('Insertando nuevos equipos...');
    for (const equipo of equipos) {
      await db.execute(
        'INSERT INTO equipos_electro (nombre, descripcion, activo) VALUES (?, ?, 1)',
        [equipo.nombre, equipo.descripcion]
      );
      console.log(`✓ Insertado: ${equipo.nombre}`);
    }
    
    const count = await db.query('SELECT COUNT(*) as total FROM equipos_electro');
    console.log(`\n✅ Seeding completado. Total de equipos: ${count[0].total}`);
    
    await db.closePool();
    process.exit(0);
  } catch (e) {
    console.error('❌ Error:', e.message);
    process.exit(1);
  }
}

seedEquipos();
