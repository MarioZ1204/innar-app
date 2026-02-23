// reset-login-attempts.js - Limpiar tabla de intentos de login
require('dotenv').config();
const mysql = require('mysql2/promise');

async function resetLoginAttempts() {
  let connection;
  try {
    connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'innar_clinica'
    });
    
    console.log('[RESET] Limpiando tabla login_attempts...');
    
    await connection.execute('TRUNCATE TABLE login_attempts');
    
    console.log('✓ Tabla login_attempts reseteada exitosamente');
    await connection.end();
    process.exit(0);
  } catch (error) {
    console.error('✗ Error reseteando tabla:', error.message);
    if (connection) await connection.end();
    process.exit(1);
  }
}

resetLoginAttempts();
