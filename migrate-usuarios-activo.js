// migrate-usuarios-activo.js - Agregar columna activo si no existe
const db = require('./db-mysql');

async function migrate() {
  try {
    await db.initPool();
    
    console.log('Verificando estructura de tabla usuarios...');
    
    // Verificar si la columna ya existe
    const result = await db.query(
      "SHOW COLUMNS FROM usuarios LIKE 'activo'"
    );
    
    if (result.length === 0) {
      console.log('Agregando columna activo...');
      await db.execute(`
        ALTER TABLE usuarios ADD COLUMN activo TINYINT DEFAULT 1 AFTER numero_consultorio
      `);
      console.log('✓ Columna activo agregada');
    } else {
      console.log('✓ Columna activo ya existe');
    }
    
    await db.closePool();
    process.exit(0);
  } catch (error) {
    console.error('Error en migración:', error.message);
    process.exit(1);
  }
}

migrate();
