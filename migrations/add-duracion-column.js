require('dotenv').config();
const mysql = require('mysql2/promise');

async function addDuracionColumn() {
  let connection;
  try {
    connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME
    });

    console.log('Agregando columna duracion_minutos a citas_electro...');
    
    // Verificar si la columna ya existe
    const [columns] = await connection.execute(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'citas_electro' AND TABLE_SCHEMA = ? AND COLUMN_NAME = 'duracion_minutos'",
      [process.env.DB_NAME]
    );
    
    if (columns.length > 0) {
      console.log('✅ La columna duracion_minutos ya existe');
    } else {
      await connection.execute(`
        ALTER TABLE citas_electro 
        ADD COLUMN duracion_minutos INT NULL DEFAULT NULL
      `);
      console.log('✅ Columna duracion_minutos agregada correctamente');
    }
    
    await connection.end();
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

addDuracionColumn();
