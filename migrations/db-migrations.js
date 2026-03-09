// db-migrations.js - Archivo consolidado de todas las migraciones
const db = require('../utils/db-mysql');

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
    sql: `ALTER TABLE usuarios ADD COLUMN activo TINYINT DEFAULT 1`
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
    sql: `ALTER TABLE usuarios ADD COLUMN numero_consultorio INT`
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
  },
  {
    name: 'doctor_disponibilidad_turnos',
    description: 'Agregar columnas de disponibilidad por turno (mañana/tarde) a tabla doctor_disponibilidad_mensual',
    sql: `
      ALTER TABLE doctor_disponibilidad_mensual 
      ADD COLUMN disponible_manana BOOLEAN DEFAULT TRUE,
      ADD COLUMN disponible_tarde BOOLEAN DEFAULT TRUE
    `
  },
  {
    name: 'doctor_disponibilidad_intervalos',
    description: 'Tabla para almacenar intervalos de disponibilidad por hora con razones',
    sql: `
      CREATE TABLE IF NOT EXISTS doctor_disponibilidad_intervalos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        doctor_id INT NOT NULL,
        fecha DATE NOT NULL,
        hora_inicio TIME NOT NULL,
        hora_fin TIME NOT NULL,
        razon VARCHAR(255),
        creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
        actualizado_en DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_doctor_fecha (doctor_id, fecha),
        INDEX idx_hora (hora_inicio, hora_fin),
        FOREIGN KEY (doctor_id) REFERENCES usuarios(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `
  },
  {
    name: 'especialidad_doctor',
    description: 'Agregar columna especialidad a tabla usuarios para doctors',
    sql: `ALTER TABLE usuarios ADD COLUMN especialidad VARCHAR(100)`
  },
  {
    name: 'diagnosticos',
    description: 'Tabla para gestión de diagnósticos',
    sql: `
      CREATE TABLE IF NOT EXISTS diagnosticos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nombre VARCHAR(255) NOT NULL UNIQUE,
        descripcion TEXT,
        codigo VARCHAR(50),
        activo TINYINT DEFAULT 1,
        fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_nombre (nombre),
        INDEX idx_activo (activo)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `
  },
  {
    name: 'citas_electro_diagnostico',
    description: 'Agregar columna diagnóstico a tabla citas_electro',
    sql: `ALTER TABLE citas_electro ADD COLUMN diagnostico_id INT, ADD FOREIGN KEY (diagnostico_id) REFERENCES diagnosticos(id) ON DELETE SET NULL`
  },
  {
    name: 'citas_electro_equipo_nullable',
    description: 'Hacer que equipo_id sea nullable en citas_electro (se selecciona después)',
    sql: `ALTER TABLE citas_electro MODIFY COLUMN equipo_id INT NULL`
  },
  {
    name: 'citas_electro_estado_enum_fix',
    description: 'Actualizar valores ENUM de estado en citas_electro',
    sql: [
      "UPDATE citas_electro SET estado = 'Programado' WHERE estado = 'PROGRAMADO'",
      "UPDATE citas_electro SET estado = 'Completado' WHERE estado = 'REALIZADO'",
      "UPDATE citas_electro SET estado = 'Cancelado' WHERE estado = 'CANCELADO'",
      "ALTER TABLE citas_electro MODIFY COLUMN estado ENUM('Programado', 'En Sala', 'En Estudio', 'Completado', 'No Asistió', 'Cancelado') NOT NULL DEFAULT 'Programado'",
      "ALTER TABLE citas_electro ADD COLUMN programado_por_nombre VARCHAR(150) AFTER diagnostico_id"
    ]
  },
  {
    name: 'citas_electro_hora_agendamiento',
    description: 'Agregar columna hora_agendamiento para almacenar hora de programación',
    sql: `ALTER TABLE citas_electro ADD COLUMN hora_agendamiento TIME AFTER fecha`
  },
  {
    name: 'citas_electro_hora_inicio_nullable',
    description: 'Hacer hora_inicio nullable (solo se asigna al iniciar estudio)',
    sql: `
      ALTER TABLE citas_electro 
      MODIFY COLUMN hora_inicio TIME NULL
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

        // sql puede ser string o array de statements
        const statements = Array.isArray(migration.sql) ? migration.sql : [migration.sql];
        for (const stmt of statements) {
          await db.execute(stmt.trim());
        }

        console.log(`✅ ${migration.name} - OK\n`);
        successCount++;
      } catch (error) {
        // Columna/tabla ya existe → migración ya fue aplicada antes, no es un error real
        if (error.errno === 1060 || error.errno === 1061 || error.errno === 1050) {
          console.log(`⏭️  ${migration.name} - ya aplicada (${error.message.split(':')[0]})\n`);
          successCount++;
        } else {
          console.error(`❌ ERROR en ${migration.name}: ${error.message}\n`);
          errorCount++;
        }
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
