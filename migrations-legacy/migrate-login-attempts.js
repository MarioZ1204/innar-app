const db = require('./db-mysql');

async function migrate() {
  try {
    // Inicializar pool MySQL
    await db.initPool();
    
    console.log('Creando tabla login_attempts...');
    
    await db.execute(`
      CREATE TABLE IF NOT EXISTS login_attempts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        ip_address VARCHAR(45) NOT NULL,
        usuario VARCHAR(100),
        intentos_fallidos INT DEFAULT 0,
        bloqueado_hasta DATETIME,
        primer_intento DATETIME DEFAULT CURRENT_TIMESTAMP,
        ultimo_intento DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_ip (ip_address),
        INDEX idx_usuario (usuario)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);
    
    console.log('✓ Tabla login_attempts creada exitosamente');
    await db.closePool();
    process.exit(0);
  } catch (error) {
    console.error('Error en migración:', error.message);
    console.error(error);
    process.exit(1);
  }
}

migrate();
