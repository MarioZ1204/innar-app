// db-migrations.js - Archivo consolidado de todas las migraciones
const db = require('./db-mysql');

// Lista de todas las migraciones
const migrations = [
  {
    name: 'login_attempts',
    description: 'Tabla para rate limiting de login',
    sql: `
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
    `
  },
  {
    name: 'usuario_auditorias',
    description: 'Tabla para auditoría de cambios de usuarios',
    sql: `
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
    `
  },
  {
    name: 'usuarios_activo',
    description: 'Agregar columna activo a tabla usuarios',
    sql: `ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS activo TINYINT DEFAULT 1`
  },
  {
    name: 'turnos',
    description: 'Tabla para gestión de turnos',
    sql: `
      CREATE TABLE IF NOT EXISTS turnos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        fecha DATE NOT NULL,
        hora TIME NOT NULL,
        doctor_id INT NOT NULL,
        paciente_nombre VARCHAR(255) NOT NULL,
        paciente_telefono VARCHAR(20),
        paciente_email VARCHAR(100),
        estado VARCHAR(50) DEFAULT 'PROGRAMADO',
        consultorio_numero INT,
        observaciones TEXT,
        fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
        fecha_actualizacion DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_fecha (fecha),
        INDEX idx_doctor (doctor_id),
        INDEX idx_estado (estado),
        FOREIGN KEY (doctor_id) REFERENCES usuarios(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `
  },
  {
    name: 'estados',
    description: 'Tabla para estados de turnos',
    sql: `
      CREATE TABLE IF NOT EXISTS estados (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nombre VARCHAR(100) NOT NULL UNIQUE,
        descripcion TEXT,
        color VARCHAR(20),
        activo TINYINT DEFAULT 1,
        fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `
  },
  {
    name: 'dias_bloqueados',
    description: 'Tabla para días bloqueados (no disponibles)',
    sql: `
      CREATE TABLE IF NOT EXISTS dias_bloqueados (
        id INT AUTO_INCREMENT PRIMARY KEY,
        fecha DATE NOT NULL UNIQUE,
        doctor_id INT,
        razon VARCHAR(255),
        fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_fecha (fecha),
        INDEX idx_doctor (doctor_id),
        FOREIGN KEY (doctor_id) REFERENCES usuarios(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `
  },
  {
    name: 'consultorio',
    description: 'Agregar columna numero_consultorio a tabla usuarios',
    sql: `ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS numero_consultorio INT`
  },
  {
    name: 'recibos',
    description: 'Tabla para gestión de recibos/facturas',
    sql: `
      CREATE TABLE IF NOT EXISTS recibos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        numero_recibo VARCHAR(50) NOT NULL UNIQUE,
        usuario_id INT NOT NULL,
        paciente_nombre VARCHAR(255),
        fecha DATE NOT NULL,
        servicios JSON,
        total DECIMAL(10, 2),
        estado VARCHAR(50) DEFAULT 'PENDIENTE',
        observaciones TEXT,
        fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
        fecha_actualizacion DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_usuario (usuario_id),
        INDEX idx_fecha (fecha),
        INDEX idx_estado (estado),
        FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `
  }
];

/**
 * Ejecutar todas las migraciones
 */
async function runAllMigrations() {
  try {
    await db.initPool();
    
    console.log('\n╔════════════════════════════════════════╗');
    console.log('║  INICIANDO MIGRACIONES DE BASE DE DATOS  ║');
    console.log('╚════════════════════════════════════════╝\n');
    
    let successCount = 0;
    let errorCount = 0;
    
    for (const migration of migrations) {
      try {
        console.log(`⏳ Ejecutando: ${migration.name}`);
        console.log(`   📝 ${migration.description}`);
        
        await db.execute(migration.sql);
        
        console.log(`✅ ${migration.name} - OK\n`);
        successCount++;
      } catch (error) {
        console.error(`❌ ERROR en ${migration.name}: ${error.message}\n`);
        errorCount++;
      }
    }
    
    console.log('╔════════════════════════════════════════╗');
    console.log('║           RESUMEN DE EJECUCIÓN         ║');
    console.log('╚════════════════════════════════════════╝');
    console.log(`✅ Exitosas: ${successCount}`);
    console.log(`❌ Errores:  ${errorCount}`);
    console.log(`📊 Total:    ${migrations.length}\n`);
    
    await db.closePool();
    process.exit(errorCount > 0 ? 1 : 0);
  } catch (error) {
    console.error('❌ Error fatal en migraciones:', error.message);
    process.exit(1);
  }
}

// Ejecutar si se llama directamente desde terminal
if (require.main === module) {
  runAllMigrations();
}

module.exports = { migrations, runAllMigrations };
