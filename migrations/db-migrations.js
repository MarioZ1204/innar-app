// db-migrations.js - Archivo consolidado de todas las migraciones
//
// Cada migración tiene un `name` único. Antes de ejecutarla se consulta
// `schema_migrations` para saber si ya fue aplicada y, de ser así, se omite.
// Después de ejecutarse exitosamente se inserta una fila. Esto reemplaza el
// patrón anterior de "intentar y atrapar errno 1060/1061/1050".

const db = require('../utils/db-mysql');

const MIGRATIONS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(150) NOT NULL UNIQUE,
    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    description VARCHAR(500),
    statements_count INT DEFAULT 1,
    INDEX idx_name (name)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
`;

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
    name: 'doctor_disponibilidad_mensual',
    description: 'Tabla para disponibilidad mensual de doctores',
    sql: `
      CREATE TABLE IF NOT EXISTS doctor_disponibilidad_mensual (
        id INT AUTO_INCREMENT PRIMARY KEY,
        doctor_id INT NOT NULL,
        fecha DATE NOT NULL,
        pacientes_proinsalud INT DEFAULT 0,
        pacientes_otros INT DEFAULT 0,
        total_pacientes INT DEFAULT 0,
        disponible BOOLEAN DEFAULT TRUE,
        disponible_manana BOOLEAN DEFAULT TRUE,
        disponible_tarde BOOLEAN DEFAULT TRUE,
        creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_doctor_fecha (doctor_id, fecha),
        FOREIGN KEY (doctor_id) REFERENCES usuarios(id) ON DELETE CASCADE,
        INDEX idx_doctor_fecha (doctor_id, fecha),
        INDEX idx_disponible (disponible)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `
  },
  {
    name: 'doctor_disponibilidad_turnos',
    description: 'Agregar columnas de disponibilidad por turno (mañana/tarde) a tabla doctor_disponibilidad_mensual',
    sql: `
      ALTER TABLE doctor_disponibilidad_mensual 
      ADD COLUMN IF NOT EXISTS disponible_manana BOOLEAN DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS disponible_tarde BOOLEAN DEFAULT TRUE
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
  },
  {
    name: 'citas_electro_hora_fin_date',
    description: 'Agregar columna hora_fin_date para citas que cruzan medianoche',
    sql: `ALTER TABLE citas_electro ADD COLUMN hora_fin_date DATE NULL AFTER hora_fin`
  },
  {
    name: 'citas_electro_estado_enum_completo',
    description: 'Ampliar ENUM de estado para incluir Reprogramado y Adelantado',
    sql: `ALTER TABLE citas_electro MODIFY COLUMN estado ENUM('Programado','Confirmado','En Sala','En Estudio','Pausado','Completado','No Asistió','Cancelado','Reprogramado','Adelantado') NOT NULL DEFAULT 'Programado'`  },
  // citas_electro_estado_enum_pausado y citas_electro_estado_enum_confirmado eliminados:
  // ejecutaban el mismo ALTER TABLE que citas_electro_estado_enum_completo. Redundantes.
  {
    name: 'equipos_electro_unique_nombre',
    description: 'Agregar restricci\u00f3n UNIQUE en equipos_electro.nombre para evitar duplicados',
    sql: `ALTER TABLE equipos_electro ADD UNIQUE KEY uk_equipos_nombre (nombre)`  },
  {
    name: 'recibos_esquema_contable',
    description: 'Ampliar tabla recibos con campos contables: medico, tipo_pago, entidad, tipo_servicio, generado_por, turno_id, cita_electro_id, observaciones',
    sql: `ALTER TABLE recibos
      ADD COLUMN IF NOT EXISTS medico_id INT NULL,
      ADD COLUMN IF NOT EXISTS medico_nombre VARCHAR(200) NULL,
      ADD COLUMN IF NOT EXISTS tipo_pago VARCHAR(50) NULL,
      ADD COLUMN IF NOT EXISTS nombre_entidad VARCHAR(200) NULL,
      ADD COLUMN IF NOT EXISTS tipo_servicio VARCHAR(200) NULL,
      ADD COLUMN IF NOT EXISTS generado_por_id INT NULL,
      ADD COLUMN IF NOT EXISTS generado_por_nombre VARCHAR(200) NULL,
      ADD COLUMN IF NOT EXISTS turno_id INT NULL,
      ADD COLUMN IF NOT EXISTS cita_electro_id INT NULL,
      ADD COLUMN IF NOT EXISTS observaciones TEXT NULL`
  },
  {
    name: 'performance_indexes',
    description: 'Agregar índices de rendimiento en tablas principales para consultas frecuentes',
    sql: [
      // turnos: consultas por fecha, doctor, estado, paciente
      'CREATE INDEX IF NOT EXISTS idx_turnos_fecha ON turnos(fecha)',
      'CREATE INDEX IF NOT EXISTS idx_turnos_doctor_id ON turnos(doctor_id)',
      'CREATE INDEX IF NOT EXISTS idx_turnos_estado ON turnos(estado)',
      'CREATE INDEX IF NOT EXISTS idx_turnos_fecha_doctor ON turnos(fecha, doctor_id)',
      // citas_electro: consultas por fecha, estado, equipo
      'CREATE INDEX IF NOT EXISTS idx_citas_electro_fecha ON citas_electro(fecha)',
      'CREATE INDEX IF NOT EXISTS idx_citas_electro_estado ON citas_electro(estado)',
      'CREATE INDEX IF NOT EXISTS idx_citas_electro_equipo ON citas_electro(equipo_id)',
      'CREATE INDEX IF NOT EXISTS idx_citas_electro_fecha_estado ON citas_electro(fecha, estado)',
      // recibos: consultas por fecha, cliente
      'CREATE INDEX IF NOT EXISTS idx_recibos_fecha ON recibos(fecha)',
      'CREATE INDEX IF NOT EXISTS idx_recibos_cliente ON recibos(cliente(100))',
      // pacientes: búsqueda por nombre y documento
      'CREATE INDEX IF NOT EXISTS idx_pacientes_nombre ON pacientes(nombre(100))',
      'CREATE INDEX IF NOT EXISTS idx_pacientes_documento ON pacientes(documento)',
      // auditorias: consultas por fecha
      'CREATE INDEX IF NOT EXISTS idx_auditorias_fecha ON usuario_auditorias(fecha_cambio)'
    ]
  },
  {
    name: 'recibos_anulacion',
    description: 'Agregar columnas para anulación de recibos: anulado, anulado_razon, anulado_por, anulado_en',
    sql: `ALTER TABLE recibos
      ADD COLUMN IF NOT EXISTS anulado TINYINT(1) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS anulado_razon TEXT NULL,
      ADD COLUMN IF NOT EXISTS anulado_por_id INT NULL,
      ADD COLUMN IF NOT EXISTS anulado_por_nombre VARCHAR(200) NULL,
      ADD COLUMN IF NOT EXISTS anulado_en DATETIME NULL`
  },
  {
    name: 'recibos_estado_pago',
    description: 'Agregar estado de pago: PAGADO o PENDIENTE, con fecha de pago y quién marcó como pagado',
    sql: `ALTER TABLE recibos
      ADD COLUMN IF NOT EXISTS estado_pago VARCHAR(20) DEFAULT 'PAGADO',
      ADD COLUMN IF NOT EXISTS fecha_pago DATETIME NULL,
      ADD COLUMN IF NOT EXISTS pagado_por_id INT NULL,
      ADD COLUMN IF NOT EXISTS pagado_por_nombre VARCHAR(200) NULL`
  },
  {
    name: 'recibos_fks_integridad',
    description: 'Patch B Sección 8g: FK constraints en recibos (medico_id, generado_por_id, anulado_por_id, pagado_por_id, turno_id, cita_electro_id)',
    sql: [
      // Limpiar huérfanos primero, idempotente
      "UPDATE recibos SET turno_id=NULL WHERE turno_id IS NOT NULL AND turno_id NOT IN (SELECT id FROM turnos)",
      "UPDATE recibos SET cita_electro_id=NULL WHERE cita_electro_id IS NOT NULL AND cita_electro_id NOT IN (SELECT id FROM citas_electro)",
      "UPDATE recibos SET medico_id=NULL WHERE medico_id IS NOT NULL AND medico_id NOT IN (SELECT id FROM usuarios)",
      "UPDATE recibos SET generado_por_id=NULL WHERE generado_por_id IS NOT NULL AND generado_por_id NOT IN (SELECT id FROM usuarios)",
      "UPDATE recibos SET anulado_por_id=NULL WHERE anulado_por_id IS NOT NULL AND anulado_por_id NOT IN (SELECT id FROM usuarios)",
      "UPDATE recibos SET pagado_por_id=NULL WHERE pagado_por_id IS NOT NULL AND pagado_por_id NOT IN (SELECT id FROM usuarios)",
      // Crear FK solo si la columna existe y aún no hay otra FK con ese nombre.
      // MariaDB no soporta `ADD CONSTRAINT IF NOT EXISTS` para FOREIGN KEY,
      // así que catch ER_FK_DUP_NAME (1826) lo trataremos como ya aplicado.
      "ALTER TABLE recibos ADD CONSTRAINT fk_recibos_medico FOREIGN KEY (medico_id) REFERENCES usuarios(id) ON DELETE SET NULL",
      "ALTER TABLE recibos ADD CONSTRAINT fk_recibos_generado_por FOREIGN KEY (generado_por_id) REFERENCES usuarios(id) ON DELETE SET NULL",
      "ALTER TABLE recibos ADD CONSTRAINT fk_recibos_anulado_por FOREIGN KEY (anulado_por_id) REFERENCES usuarios(id) ON DELETE SET NULL",
      "ALTER TABLE recibos ADD CONSTRAINT fk_recibos_pagado_por FOREIGN KEY (pagado_por_id) REFERENCES usuarios(id) ON DELETE SET NULL",
      "ALTER TABLE recibos ADD CONSTRAINT fk_recibos_turno FOREIGN KEY (turno_id) REFERENCES turnos(id) ON DELETE SET NULL",
      "ALTER TABLE recibos ADD CONSTRAINT fk_recibos_cita_electro FOREIGN KEY (cita_electro_id) REFERENCES citas_electro(id) ON DELETE SET NULL"
    ]
  },
  {
    name: 'dias_bloqueados_unique_fecha_doctor',
    description: 'Patch B Sección 5: UNIQUE por (fecha, doctor_id) en dias_bloqueados',
    sql: [
      // Eliminar UNIQUE antiguo solo si existe
      `SET @sql := IF(
        (SELECT COUNT(*) FROM information_schema.STATISTICS
          WHERE table_schema=DATABASE() AND table_name='dias_bloqueados' AND index_name='fecha') > 0,
        'ALTER TABLE dias_bloqueados DROP INDEX \`fecha\`',
        'SELECT 1'
      )`,
      'PREPARE stmt FROM @sql',
      'EXECUTE stmt',
      'DEALLOCATE PREPARE stmt',
      "ALTER TABLE dias_bloqueados ADD UNIQUE KEY IF NOT EXISTS unique_fecha_doctor (fecha, doctor_id)"
    ]
  },
  {
    name: 'electro_revertir_auto_completados_hoy_20260527',
    description: 'Electro: devolver a En Estudio los de hoy cerrados por Sistema (Auto) sin cumplir tiempo',
    sql: `
      UPDATE citas_electro
      SET
        estado = 'En Estudio',
        editado_por_nombre = 'Sistema (Corrección)',
        editado_en = NOW(),
        hora_fin = DATE_FORMAT(
          DATE_ADD(NOW(), INTERVAL COALESCE(NULLIF(duracion_minutos, 0), 480) MINUTE),
          '%H:%i'
        ),
        hora_fin_date = DATE(
          DATE_ADD(NOW(), INTERVAL COALESCE(NULLIF(duracion_minutos, 0), 480) MINUTE)
        )
      WHERE fecha = CURDATE()
        AND estado = 'Completado'
        AND editado_por_nombre = 'Sistema (Auto)'
        AND deleted_at IS NULL
    `
  },
  {
    name: 'electro_revertir_completados_antes_tiempo_20260527b',
    description: 'Electro: En Estudio si Completado pero el fin programado aún no venció (14 días)',
    sql: `
      UPDATE citas_electro
      SET
        estado = 'En Estudio',
        editado_por_nombre = 'Sistema (Corrección)',
        editado_en = NOW(),
        hora_fin = DATE_FORMAT(
          DATE_ADD(NOW(), INTERVAL COALESCE(NULLIF(duracion_minutos, 0), 480) MINUTE),
          '%H:%i'
        ),
        hora_fin_date = DATE(
          DATE_ADD(NOW(), INTERVAL COALESCE(NULLIF(duracion_minutos, 0), 480) MINUTE)
        )
      WHERE deleted_at IS NULL
        AND estado = 'Completado'
        AND fecha >= DATE_SUB(CURDATE(), INTERVAL 14 DAY)
        AND (
          CASE
            WHEN duracion_minutos > 0 AND hora_inicio IS NOT NULL AND TRIM(hora_inicio) <> '' THEN
              DATE_ADD(TIMESTAMP(fecha, TIME(hora_inicio)), INTERVAL duracion_minutos MINUTE)
            WHEN duracion_minutos > 0 AND hora_agendamiento IS NOT NULL AND TRIM(hora_agendamiento) <> '' THEN
              DATE_ADD(TIMESTAMP(fecha, TIME(hora_agendamiento)), INTERVAL duracion_minutos MINUTE)
            ELSE
              TIMESTAMP(COALESCE(hora_fin_date, fecha), COALESCE(hora_fin, '23:59:59'))
          END
        ) > NOW()
    `
  },
  {
    name: 'agenda_reprogramado_en_20260706',
    description: 'Columna reprogramado_en en turnos y citas_electro (fantasma 3 días)',
    sql: [
      `ALTER TABLE turnos ADD COLUMN reprogramado_en DATETIME NULL DEFAULT NULL AFTER actualizado_en`,
      `ALTER TABLE citas_electro ADD COLUMN reprogramado_en DATETIME NULL DEFAULT NULL AFTER editado_en`
    ]
  },
  {
    name: 'doctor_cupos_entidad_dia_20260717',
    description: 'Cupos de pacientes por entidad y día (programar agenda)',
    sql: `
      CREATE TABLE IF NOT EXISTS doctor_cupos_entidad_dia (
        id INT AUTO_INCREMENT PRIMARY KEY,
        doctor_id INT NOT NULL,
        fecha DATE NOT NULL,
        entidad VARCHAR(200) NOT NULL,
        cupo_max INT NOT NULL DEFAULT 0,
        creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_doctor_fecha_entidad (doctor_id, fecha, entidad),
        INDEX idx_doctor_fecha (doctor_id, fecha)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `
  }
];

// Errores que tratamos como "ya aplicado" si una migración legacy se aplicó por
// fuera del registro `schema_migrations`. Permite migrar instalaciones existentes.
const LEGACY_ALREADY_APPLIED_ERRNOS = new Set([
  1060, // ER_DUP_FIELDNAME (columna ya existe)
  1061, // ER_DUP_KEYNAME (índice ya existe)
  1050, // ER_TABLE_EXISTS_ERROR (tabla ya existe)
  1826, // ER_DUP_CONSTRAINT_NAME (FK ya existe en MariaDB)
  1022, // ER_DUP_KEY
  1091, // ER_CANT_DROP_FIELD_OR_KEY (drop de algo inexistente)
]);

async function isMigrationApplied(name) {
  try {
    const rows = await db.query('SELECT 1 FROM schema_migrations WHERE name = ? LIMIT 1', [name]);
    return rows.length > 0;
  } catch (e) {
    // Tabla todavía no existe
    if (e.errno === 1146) return false;
    throw e;
  }
}

async function recordMigration(migration, statementsCount) {
  await db.execute(
    'INSERT IGNORE INTO schema_migrations (name, description, statements_count) VALUES (?, ?, ?)',
    [migration.name, migration.description || '', statementsCount]
  );
}

async function runAllMigrations() {
  try {
    await db.initPool();

    console.log('\n╔════════════════════════════════════════╗');
    console.log('║  INICIANDO MIGRACIONES DE BASE DE DATOS  ║');
    console.log('╚════════════════════════════════════════╝\n');

    await db.execute(MIGRATIONS_TABLE_SQL);
    console.log('✓ Tabla schema_migrations lista\n');

    let appliedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const migration of migrations) {
      const alreadyApplied = await isMigrationApplied(migration.name);
      if (alreadyApplied) {
        console.log(`⏭️  ${migration.name} - ya registrada\n`);
        skippedCount++;
        continue;
      }

      console.log(`⏳ Ejecutando: ${migration.name}`);
      console.log(`   📝 ${migration.description}`);

      const statements = Array.isArray(migration.sql) ? migration.sql : [migration.sql];
      let statementErrors = 0;
      for (const stmt of statements) {
        try {
          await db.execute(stmt.trim());
        } catch (error) {
          if (LEGACY_ALREADY_APPLIED_ERRNOS.has(error.errno)) {
            console.log(`   ⏭️  statement ya aplicado (errno=${error.errno})`);
          } else {
            console.error(`   ❌ ${error.message}`);
            statementErrors++;
          }
        }
      }

      if (statementErrors === 0) {
        await recordMigration(migration, statements.length);
        console.log(`✅ ${migration.name} - OK\n`);
        appliedCount++;
      } else {
        console.error(`❌ ${migration.name} con ${statementErrors} errores; NO se registra como aplicada\n`);
        errorCount++;
      }
    }

    console.log('╔════════════════════════════════════════╗');
    console.log('║           RESUMEN DE EJECUCIÓN         ║');
    console.log('╚════════════════════════════════════════╝');
    console.log(`✅ Aplicadas:       ${appliedCount}`);
    console.log(`⏭️  Ya aplicadas:   ${skippedCount}`);
    console.log(`❌ Con errores:     ${errorCount}`);
    console.log(`📊 Total:           ${migrations.length}\n`);

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

module.exports = { migrations, runAllMigrations, MIGRATIONS_TABLE_SQL, isMigrationApplied, recordMigration };
