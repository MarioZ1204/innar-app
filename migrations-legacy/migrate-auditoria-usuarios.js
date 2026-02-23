// migrate-auditoria-usuarios.js
const db = require('./db-mysql');

async function migrate() {
  try {
    await db.initPool();
    
    console.log('Creando tabla usuario_auditorias...');
    
    await db.execute(`
      CREATE TABLE IF NOT EXISTS usuario_auditorias (
        id INT AUTO_INCREMENT PRIMARY KEY,
        usuario_id INT NOT NULL,
        usuario_admin VARCHAR(100) NOT NULL,
        admin_id INT,
        accion VARCHAR(50) NOT NULL,
        cambios JSON,
        ip_address VARCHAR(45),
        fecha_cambio DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_usuario_id (usuario_id),
        INDEX idx_admin_id (admin_id),
        INDEX idx_fecha (fecha_cambio),
        FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
        FOREIGN KEY (admin_id) REFERENCES usuarios(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);
    
    console.log('✓ Tabla usuario_auditorias creada exitosamente');
    await db.closePool();
    process.exit(0);
  } catch (error) {
    console.error('Error en migración:', error.message);
    process.exit(1);
  }
}

migrate();
