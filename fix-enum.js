require('dotenv').config();
const mysql = require('mysql2/promise');

async function fixEnum() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'innar_clinica'
  });

  try {
    console.log('Actualizando ENUM de estado en citas_electro...');
    
    await connection.execute(`
      ALTER TABLE citas_electro 
      MODIFY COLUMN estado ENUM('Programado', 'En Sala', 'En Estudio', 'Completado', 'No Asistió', 'Cancelado', 'Reprogramado', 'Adelantado') 
      NOT NULL DEFAULT 'Programado'
    `);
    
    console.log('✅ ENUM actualizado correctamente');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await connection.end();
  }
}

fixEnum();
