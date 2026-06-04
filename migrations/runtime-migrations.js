// migrations/runtime-migrations.js
// Migraciones que se aplicaban inline en server.js. Se ejecutan al arranque
// para tolerar instalaciones antiguas. Se registran en `schema_migrations`
// para no repetirse.
//
// Cada entrada es { name, description, run: async (db) => ... }.
// Si `run` lanza, se loguea y se continúa con la siguiente (best-effort).

const COLUMN_EXISTS_SQL = `
  SELECT COUNT(*) AS cnt
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = ?
    AND COLUMN_NAME  = ?
`;

const TABLE_EXISTS_SQL = `
  SELECT COUNT(*) AS cnt
  FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
`;

async function columnExists(db, table, column) {
  const rows = await db.query(COLUMN_EXISTS_SQL, [table, column]);
  return !!(rows && rows[0] && rows[0].cnt > 0);
}

async function tableExists(db, table) {
  const rows = await db.query(TABLE_EXISTS_SQL, [table]);
  return !!(rows && rows[0] && rows[0].cnt > 0);
}

const runtimeMigrations = [
  {
    name: 'rt_servicios_recibo_seed',
    description: 'Crea tabla servicios_recibo y siembra defaults',
    run: async (db) => {
      await db.execute(`CREATE TABLE IF NOT EXISTS servicios_recibo (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nombre VARCHAR(300) NOT NULL UNIQUE,
        activo TINYINT DEFAULT 1,
        creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      const rows = await db.query('SELECT COUNT(*) AS n FROM servicios_recibo');
      if (rows[0].n === 0) {
        const defaults = [
          'Electroencefalograma Computarizado',
          'Electroencefalograma Convencional',
          'Monitorización Electroencefalográfica por video y radio',
          'Polisomnografía',
          'Polisomnograma en Titulación de CPAP/BPAP',
          'Test de Latencia Múltiple',
          'Polisomnograma Noche Dividida'
        ];
        for (const nombre of defaults) {
          await db.execute('INSERT IGNORE INTO servicios_recibo (nombre) VALUES (?)', [nombre]);
        }
      }
    }
  },
  {
    name: 'rt_entidades_seed',
    description: 'Crea tabla entidades y siembra defaults',
    run: async (db) => {
      await db.execute(`CREATE TABLE IF NOT EXISTS entidades (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nombre VARCHAR(200) NOT NULL UNIQUE,
        activo TINYINT DEFAULT 1,
        creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      const rows = await db.query('SELECT COUNT(*) AS n FROM entidades');
      if (rows[0].n === 0) {
        const defaults = ['PARTICULAR', 'FOMAG', 'UCQN', 'PROINSALUD', 'FIDUPREVISORA', 'CAFESALUD', 'NUEVA EPS', 'SURA', 'SANITAS', 'COMPENSAR'];
        for (const nombre of defaults) {
          await db.execute('INSERT IGNORE INTO entidades (nombre) VALUES (?)', [nombre]);
        }
      }
    }
  },
  {
    name: 'rt_doctor_disp_collation',
    description: 'Collation utf8mb4_general_ci en doctor_disponibilidad_mensual',
    run: async (db) => {
      if (await tableExists(db, 'doctor_disponibilidad_mensual')) {
        await db.execute('ALTER TABLE doctor_disponibilidad_mensual CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci');
      }
    }
  },
  {
    name: 'rt_doctor_disp_motivo_ausencia',
    description: 'Añade motivo_ausencia a doctor_disponibilidad_mensual',
    run: async (db) => {
      if (!(await columnExists(db, 'doctor_disponibilidad_mensual', 'motivo_ausencia'))) {
        await db.execute('ALTER TABLE doctor_disponibilidad_mensual ADD COLUMN motivo_ausencia VARCHAR(200) DEFAULT NULL');
      }
    }
  },
  {
    name: 'rt_citas_electro_deleted_at',
    description: 'Soft-delete: citas_electro.deleted_at',
    run: async (db) => {
      if (!(await columnExists(db, 'citas_electro', 'deleted_at'))) {
        await db.execute('ALTER TABLE citas_electro ADD COLUMN deleted_at DATETIME DEFAULT NULL');
      }
    }
  },
  {
    name: 'rt_citas_electro_entidad',
    description: 'citas_electro.entidad + índice',
    run: async (db) => {
      if (!(await columnExists(db, 'citas_electro', 'entidad'))) {
        await db.execute('ALTER TABLE citas_electro ADD COLUMN entidad VARCHAR(200) DEFAULT NULL AFTER diagnostico_id');
        await db.execute('ALTER TABLE citas_electro ADD INDEX idx_entidad (entidad)');
      }
    }
  },
  {
    name: 'rt_ucqn_estudios_table',
    description: 'Tabla ucqn_estudios',
    run: async (db) => {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS ucqn_estudios (
          id INT AUTO_INCREMENT PRIMARY KEY,
          cita_electro_id INT NOT NULL,
          fecha_estudio DATE NOT NULL,
          hora_estudio TIME NULL,
          paciente_nombres VARCHAR(150) NOT NULL,
          paciente_apellidos VARCHAR(150) DEFAULT NULL,
          paciente_documento VARCHAR(50) DEFAULT NULL,
          tipo_estudio VARCHAR(255) DEFAULT NULL,
          entidad VARCHAR(100) NOT NULL DEFAULT 'UCQN',
          estado ENUM('PENDIENTE','LEIDO','FACTURADO') NOT NULL DEFAULT 'PENDIENTE',
          estado_actualizado_en DATETIME DEFAULT NULL,
          estado_actualizado_por VARCHAR(150) DEFAULT NULL,
          creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uk_ucqn_cita (cita_electro_id),
          INDEX idx_ucqn_fecha (fecha_estudio),
          INDEX idx_ucqn_estado (estado),
          CONSTRAINT fk_ucqn_cita_electro FOREIGN KEY (cita_electro_id) REFERENCES citas_electro(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    }
  },
  {
    name: 'rt_equipos_5_6_bloqueados',
    description: 'Equipos 5 y 6 inactivos',
    run: async (db) => {
      await db.execute(`INSERT IGNORE INTO equipos_electro (nombre, activo) VALUES ('Equipo 5', 0), ('Equipo 6', 0)`);
    }
  },
  {
    name: 'rt_turnos_paciente_telefono2',
    description: 'turnos.paciente_telefono2',
    run: async (db) => {
      if (!(await columnExists(db, 'turnos', 'paciente_telefono2'))) {
        await db.execute('ALTER TABLE turnos ADD COLUMN paciente_telefono2 VARCHAR(20) DEFAULT NULL AFTER paciente_telefono');
      }
    }
  },
  {
    name: 'rt_pacientes_telefono2',
    description: 'pacientes.telefono2',
    run: async (db) => {
      if (!(await columnExists(db, 'pacientes', 'telefono2'))) {
        await db.execute('ALTER TABLE pacientes ADD COLUMN telefono2 VARCHAR(20) DEFAULT NULL AFTER telefono');
      }
    }
  },
  {
    name: 'rt_usuarios_permisos',
    description: 'usuarios.permisos JSON',
    run: async (db) => {
      if (!(await columnExists(db, 'usuarios', 'permisos'))) {
        await db.execute('ALTER TABLE usuarios ADD COLUMN permisos JSON DEFAULT NULL');
      }
    }
  },
  {
    name: 'rt_usuarios_numero_consultorio',
    description: 'usuarios.numero_consultorio para doctores',
    run: async (db) => {
      if (!(await columnExists(db, 'usuarios', 'numero_consultorio'))) {
        await db.execute('ALTER TABLE usuarios ADD COLUMN numero_consultorio INT NULL DEFAULT NULL');
      }
    }
  },
  {
    name: 'rt_usuarios_especialidad',
    description: 'usuarios.especialidad para doctores',
    run: async (db) => {
      if (!(await columnExists(db, 'usuarios', 'especialidad'))) {
        await db.execute('ALTER TABLE usuarios ADD COLUMN especialidad VARCHAR(100) NULL DEFAULT NULL');
      }
    }
  },
  {
    name: 'rt_usuarios_ultimo_acceso',
    description: 'usuarios.ultimo_acceso',
    run: async (db) => {
      if (!(await columnExists(db, 'usuarios', 'ultimo_acceso'))) {
        await db.execute('ALTER TABLE usuarios ADD COLUMN ultimo_acceso DATETIME DEFAULT NULL');
      }
    }
  },
  {
    name: 'rt_legacy_admin_to_superadmin',
    description: 'Convierte usuario admin legacy a superadmin',
    run: async (db) => {
      const existing = await db.query("SELECT COUNT(*) AS cnt FROM usuarios WHERE rol = 'superadmin'");
      if (existing?.[0]?.cnt === 0) {
        const legacy = await db.queryOne("SELECT id FROM usuarios WHERE usuario = 'admin' AND rol = 'admin'");
        if (legacy) {
          await db.execute("UPDATE usuarios SET rol = 'superadmin', nombre = 'Super Administrador' WHERE id = ?", [legacy.id]);
        }
      }
    }
  },
  {
    name: 'rt_usuarios_rol_enum',
    description: 'ENUM rol en usuarios con todos los roles',
    run: async (db) => {
      const enumRow = await db.query(
        "SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usuarios' AND COLUMN_NAME = 'rol'"
      );
      const current = enumRow?.[0]?.COLUMN_TYPE || '';
      if (!current.includes('superadmin') || !current.includes('admin_recepcion') || !current.includes('auxiliar_recepcion')) {
        await db.execute(
          `ALTER TABLE usuarios MODIFY COLUMN rol ENUM('doctor','recepcion','admin','electro','contabilidad','superadmin','admin_recepcion','admin_electro','tecnico_electro','auxiliar_recepcion') NOT NULL DEFAULT 'auxiliar_recepcion'`
        );
      }
    }
  },
  {
    name: 'rt_pacientes_espera_table',
    description: 'Tabla pacientes_espera y columnas extra',
    run: async (db) => {
      if (!(await tableExists(db, 'pacientes_espera'))) {
        await db.execute(`
          CREATE TABLE pacientes_espera (
            id INT AUTO_INCREMENT PRIMARY KEY,
            documento VARCHAR(20) NOT NULL,
            nombres VARCHAR(100) NOT NULL,
            apellidos VARCHAR(100) NOT NULL,
            entidad VARCHAR(50) NOT NULL,
            prioridad ENUM('ALTA','MEDIA','BAJA') NOT NULL DEFAULT 'MEDIA',
            ingresado_por VARCHAR(100) DEFAULT NULL,
            telefono1 VARCHAR(20) DEFAULT NULL,
            telefono2 VARCHAR(20) DEFAULT NULL,
            tipo_estudio VARCHAR(100) DEFAULT NULL,
            creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
      } else {
        for (const col of ['telefono1', 'telefono2', 'tipo_estudio']) {
          if (!(await columnExists(db, 'pacientes_espera', col))) {
            const sqlType = col === 'tipo_estudio' ? 'VARCHAR(100)' : 'VARCHAR(20)';
            await db.execute(`ALTER TABLE pacientes_espera ADD COLUMN ${col} ${sqlType} DEFAULT NULL`);
          }
        }
      }
    }
  },
  {
    name: 'rt_especialidades_seed',
    description: 'Tabla especialidades + seed',
    run: async (db) => {
      if (!(await tableExists(db, 'especialidades'))) {
        await db.execute(`
          CREATE TABLE especialidades (
            id INT AUTO_INCREMENT PRIMARY KEY,
            nombre VARCHAR(100) NOT NULL,
            activo TINYINT(1) NOT NULL DEFAULT 1,
            creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uk_esp_nombre (nombre)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
        for (const nombre of ['Neurología', 'Epileptología', 'Psicología', 'Neuropsicología', 'Psiquiatría']) {
          await db.execute('INSERT IGNORE INTO especialidades (nombre) VALUES (?)', [nombre]);
        }
      }
    }
  },
  {
    name: 'rt_tipos_consulta_seed',
    description: 'Tabla tipos_consulta + seed',
    run: async (db) => {
      if (!(await tableExists(db, 'tipos_consulta'))) {
        await db.execute(`
          CREATE TABLE tipos_consulta (
            id INT AUTO_INCREMENT PRIMARY KEY,
            especialidad_id INT NOT NULL,
            nombre VARCHAR(200) NOT NULL,
            orden INT NOT NULL DEFAULT 0,
            activo TINYINT(1) NOT NULL DEFAULT 1,
            FOREIGN KEY (especialidad_id) REFERENCES especialidades(id) ON DELETE CASCADE
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
        const tiposPorEsp = {
          'Neurología':     ['Consulta de Primera Vez por Neurología','Consulta de Control por Neurología','Consulta Virtual de Primera Vez por Neurología','Consulta Virtual de Control por Neurología','Aplicación de Toxina Botulínica (Botox)','Control de Toxina Botulínica (Botox)','Actigrafía','Rev. Neuroestimulador','Agente Anestésico','Particular','Otra'],
          'Epileptología':  ['Consulta de Primera Vez por Epileptología','Consulta de Control por Epileptología','Consulta Virtual de Primera Vez por Epileptología','Consulta Virtual de Control por Epileptología','Consulta de Primera Vez por Neurología','Consulta de Control por Neurología','Consulta Virtual de Primera Vez por Neurología','Consulta Virtual de Control por Neurología','Aplicación de Toxina Botulínica (Botox)','Control de Toxina Botulínica (Botox)','Actigrafía','Rev. Neuroestimulador','Bloqueo Mioneural','Particular','Otra'],
          'Psicología':     ['Consulta de Primera Vez por Psicología','Consulta de Control por Psicología','Otra'],
          'Neuropsicología':['Consulta de Primera Vez por Neuropsicología','Consulta de Control por Neuropsicología','Otra'],
          'Psiquiatría':    ['Consulta de Primera Vez por Psiquiatría','Consulta de Control por Psiquiatría','Otra']
        };
        for (const [espNombre, tipos] of Object.entries(tiposPorEsp)) {
          const espRows = await db.query('SELECT id FROM especialidades WHERE nombre = ?', [espNombre]);
          if (espRows.length > 0) {
            const espId = espRows[0].id;
            for (let i = 0; i < tipos.length; i += 1) {
              await db.execute('INSERT INTO tipos_consulta (especialidad_id, nombre, orden) VALUES (?,?,?)', [espId, tipos[i], i]);
            }
          }
        }
      }
    }
  },
  {
    name: 'rt_recibos_anulacion',
    description: 'Columnas de anulación en recibos',
    run: async (db) => {
      await db.execute(`
        ALTER TABLE recibos
        ADD COLUMN IF NOT EXISTS anulado TINYINT(1) DEFAULT 0,
        ADD COLUMN IF NOT EXISTS anulado_razon TEXT NULL,
        ADD COLUMN IF NOT EXISTS anulado_por_id INT NULL,
        ADD COLUMN IF NOT EXISTS anulado_por_nombre VARCHAR(200) NULL,
        ADD COLUMN IF NOT EXISTS anulado_en DATETIME NULL
      `);
    }
  },
  {
    name: 'rt_recibos_estado_pago',
    description: 'Columnas de estado_pago en recibos',
    run: async (db) => {
      await db.execute(`
        ALTER TABLE recibos
        ADD COLUMN IF NOT EXISTS estado_pago VARCHAR(20) DEFAULT 'PAGADO',
        ADD COLUMN IF NOT EXISTS fecha_pago DATETIME NULL,
        ADD COLUMN IF NOT EXISTS pagado_por_id INT NULL,
        ADD COLUMN IF NOT EXISTS pagado_por_nombre VARCHAR(200) NULL
      `);
    }
  },
  {
    name: 'rt_entidades_cleanup',
    description: 'Elimina entidades de prueba, corrige typos y unifica codificación utf8mb4',
    run: async (db) => {
      if (await tableExists(db, 'entidades')) {
        await db.execute('ALTER TABLE entidades CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
        await db.execute(`DELETE FROM entidades WHERE UPPER(TRIM(nombre)) IN ('ABOGADO', 'ABOGADO 2')`);
      }
      const fixes = [
        ['FIDUPREVISORA', 'FIDUPREVISRA'],
        ['PARTICULAR', 'Particular'],
        ['PARTICULAR', 'particular']
      ];
      for (const [canon, typo] of fixes) {
        if (await tableExists(db, 'turnos')) {
          await db.execute(
            'UPDATE turnos SET entidad = ? WHERE TRIM(entidad) = ?',
            [canon, typo]
          );
        }
        if (await tableExists(db, 'recibos')) {
          await db.execute(
            'UPDATE recibos SET nombre_entidad = ? WHERE TRIM(nombre_entidad) = ?',
            [canon, typo]
          );
        }
        if (await tableExists(db, 'citas_electro')) {
          await db.execute(
            'UPDATE citas_electro SET entidad = ? WHERE TRIM(entidad) = ?',
            [canon, typo]
          );
        }
      }
      const agregar = ['PROTEGEMOS', 'MEDICINA PARA TODOS'];
      for (const nombre of agregar) {
        await db.execute('INSERT IGNORE INTO entidades (nombre, activo) VALUES (?, 1)', [nombre]);
      }
    }
  },
  {
    name: 'rt_entidades_historico_cleanup',
    description: 'Reasigna entidades de prueba en turnos/recibos históricos a PARTICULAR',
    run: async (db) => {
      const excluidas = ['ABOGADO', 'ABOGADO 2'];
      for (const typo of excluidas) {
        if (await tableExists(db, 'turnos')) {
          await db.execute(
            'UPDATE turnos SET entidad = ? WHERE UPPER(TRIM(entidad)) = UPPER(TRIM(?))',
            ['PARTICULAR', typo]
          );
        }
        if (await tableExists(db, 'recibos')) {
          await db.execute(
            'UPDATE recibos SET nombre_entidad = ? WHERE UPPER(TRIM(nombre_entidad)) = UPPER(TRIM(?))',
            ['PARTICULAR', typo]
          );
        }
        if (await tableExists(db, 'citas_electro')) {
          await db.execute(
            'UPDATE citas_electro SET entidad = ? WHERE UPPER(TRIM(entidad)) = UPPER(TRIM(?))',
            ['PARTICULAR', typo]
          );
        }
      }
    }
  },
  {
    name: 'rt_entidades_catalogo_estricto',
    description: 'Desactiva entidades fuera del catálogo oficial y normaliza histórico',
    run: async (db) => {
      const {
        CATALOGO_ENTIDADES,
        claveEntidad,
        mapearEntidadHistorica,
        repararCodificacionTexto
      } = require('../utils/catalogo-entidades');
      const catalogoKeys = new Set(CATALOGO_ENTIDADES.map((n) => claveEntidad(n)));

      if (await tableExists(db, 'entidades')) {
        const rows = await db.query('SELECT id, nombre FROM entidades');
        for (const row of rows) {
          const nombreReparado = repararCodificacionTexto(row.nombre).trim();
          const key = claveEntidad(nombreReparado);
          const canon = mapearEntidadHistorica(nombreReparado);
          if (catalogoKeys.has(key)) {
            await db.execute(
              'UPDATE entidades SET nombre = ?, activo = 1 WHERE id = ?',
              [canon, row.id]
            );
          } else {
            await db.execute('UPDATE entidades SET activo = 0 WHERE id = ?', [row.id]);
          }
        }
        for (const nombre of CATALOGO_ENTIDADES) {
          await db.execute('INSERT IGNORE INTO entidades (nombre, activo) VALUES (?, 1)', [nombre]);
        }
      }

      const tablas = [
        ['turnos', 'entidad'],
        ['recibos', 'nombre_entidad'],
        ['citas_electro', 'entidad']
      ];
      for (const [tabla, col] of tablas) {
        if (!(await tableExists(db, tabla))) continue;
        const distintos = await db.query(
          `SELECT DISTINCT TRIM(${col}) AS valor FROM ${tabla} WHERE ${col} IS NOT NULL AND TRIM(${col}) <> ''`
        );
        for (const { valor } of distintos) {
          const canon = mapearEntidadHistorica(valor);
          if (canon && canon !== valor) {
            await db.execute(`UPDATE ${tabla} SET ${col} = ? WHERE TRIM(${col}) = ?`, [canon, valor]);
          }
        }
      }
    }
  },
  {
    name: 'rt_sop_soportes_radicacion',
    description: 'Tablas módulos Reportes PDX y Armado de soportes',
    run: async (db) => {
      if (await tableExists(db, 'sop_pdx_carpetas')) return;
      await db.execute(`CREATE TABLE sop_pdx_carpetas (
        id INT AUTO_INCREMENT PRIMARY KEY,
        periodo CHAR(7) NOT NULL COMMENT 'YYYY-MM',
        nombre_display VARCHAR(160) NOT NULL,
        color_tema VARCHAR(20) NULL,
        estado_visibilidad ENUM('activa','gracia','archivo') NOT NULL DEFAULT 'activa',
        creado_por INT NULL,
        creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_sop_pdx_periodo_nombre (periodo, nombre_display),
        INDEX idx_sop_pdx_periodo (periodo),
        INDEX idx_sop_pdx_vis (estado_visibilidad)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      await db.execute(`CREATE TABLE sop_pdx_archivos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        carpeta_id INT NOT NULL,
        apellidos VARCHAR(120) NULL,
        nombres VARCHAR(120) NULL,
        paciente_nombre VARCHAR(200) NOT NULL,
        paciente_nombre_norm VARCHAR(220) NOT NULL,
        paciente_documento VARCHAR(30) NULL,
        fecha_estudio DATE NULL,
        marca_tiempo VARCHAR(40) NULL,
        sufijo_numero VARCHAR(10) NULL,
        estudio_texto VARCHAR(120) NULL,
        nombre_archivo_original VARCHAR(255) NOT NULL,
        nombre_archivo_display VARCHAR(255) NULL,
        ruta_relativa VARCHAR(500) NOT NULL,
        mime_type VARCHAR(80) DEFAULT 'application/pdf',
        tamano_bytes INT UNSIGNED NOT NULL,
        subido_por INT NULL,
        cita_electro_id INT NULL,
        creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_sop_pdx_carpeta FOREIGN KEY (carpeta_id) REFERENCES sop_pdx_carpetas(id) ON DELETE CASCADE,
        INDEX idx_sop_pdx_nom (paciente_nombre_norm),
        INDEX idx_sop_pdx_doc (paciente_documento),
        INDEX idx_sop_pdx_carpeta (carpeta_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      await db.execute(`CREATE TABLE sop_periodos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        periodo CHAR(7) NOT NULL UNIQUE,
        etiqueta VARCHAR(80) NOT NULL,
        estado_visibilidad ENUM('activa','gracia','archivo') NOT NULL DEFAULT 'activa',
        creado_por INT NULL,
        creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_sop_per_vis (estado_visibilidad)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      await db.execute(`CREATE TABLE sop_dias (
        id INT AUTO_INCREMENT PRIMARY KEY,
        periodo_id INT NOT NULL,
        dia TINYINT UNSIGNED NOT NULL,
        fecha DATE NOT NULL,
        creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_sop_dia (periodo_id, dia),
        CONSTRAINT fk_sop_dia_periodo FOREIGN KEY (periodo_id) REFERENCES sop_periodos(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      await db.execute(`CREATE TABLE sop_expedientes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        dia_id INT NOT NULL,
        codigo VARCHAR(32) NOT NULL,
        numero_factura INT UNSIGNED NOT NULL,
        paciente_nombre VARCHAR(200) NOT NULL,
        paciente_documento VARCHAR(30) NULL,
        tipo_servicio ENUM('electro','consulta') NOT NULL,
        fev_externa_verificada TINYINT(1) NOT NULL DEFAULT 0,
        listo_radicacion TINYINT(1) NOT NULL DEFAULT 0,
        notas TEXT NULL,
        creado_por INT NULL,
        creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_sop_exp_codigo (dia_id, codigo),
        INDEX idx_sop_exp_factura (numero_factura),
        INDEX idx_sop_exp_pac (paciente_documento),
        CONSTRAINT fk_sop_exp_dia FOREIGN KEY (dia_id) REFERENCES sop_dias(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      await db.execute(`CREATE TABLE sop_exp_archivos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        expediente_id INT NOT NULL,
        tipo ENUM('OPF','CRC','FEV','PDX','HEV') NOT NULL,
        nombre_archivo VARCHAR(255) NOT NULL,
        ruta_relativa VARCHAR(500) NOT NULL,
        mime_type VARCHAR(80) DEFAULT 'application/pdf',
        tamano_bytes INT UNSIGNED NOT NULL,
        origen ENUM('upload','copia_pdx') NOT NULL DEFAULT 'upload',
        pdx_archivo_id INT NULL,
        subido_por INT NULL,
        creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_sop_exp_tipo (expediente_id, tipo),
        CONSTRAINT fk_sop_exp_arch_exp FOREIGN KEY (expediente_id) REFERENCES sop_expedientes(id) ON DELETE CASCADE,
        CONSTRAINT fk_sop_exp_arch_pdx FOREIGN KEY (pdx_archivo_id) REFERENCES sop_pdx_archivos(id) ON DELETE SET NULL,
        INDEX idx_sop_exp_arch_tipo (tipo)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      await db.execute(`CREATE TABLE sop_transferencias (
        id INT AUTO_INCREMENT PRIMARY KEY,
        pdx_archivo_id INT NOT NULL,
        expediente_id INT NOT NULL,
        slot_tipo ENUM('PDX') NOT NULL DEFAULT 'PDX',
        usuario_id INT NULL,
        creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_sop_trf_pdx (pdx_archivo_id),
        INDEX idx_sop_trf_exp (expediente_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    }
  },
  {
    name: 'rt_sop_pdx_archivo_log',
    description: 'Auditoría PDX: editado_por y log de eventos',
    run: async (db) => {
      if (!(await tableExists(db, 'sop_pdx_archivo_log'))) {
        await db.execute(`CREATE TABLE sop_pdx_archivo_log (
          id INT AUTO_INCREMENT PRIMARY KEY,
          archivo_id INT NOT NULL,
          tipo ENUM('subida','edicion','reemplazo','movimiento') NOT NULL,
          usuario_id INT NULL,
          detalle VARCHAR(500) NULL,
          creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT fk_sop_pdx_log_arch FOREIGN KEY (archivo_id) REFERENCES sop_pdx_archivos(id) ON DELETE CASCADE,
          INDEX idx_sop_pdx_log_arch (archivo_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      }
      if (await tableExists(db, 'sop_pdx_archivos') && !(await columnExists(db, 'sop_pdx_archivos', 'editado_por'))) {
        await db.execute(
          'ALTER TABLE sop_pdx_archivos ADD COLUMN editado_por INT NULL, ADD COLUMN editado_en TIMESTAMP NULL'
        );
      }
    }
  },
  {
    name: 'rt_sop_pdx_archivos_columns_ensure',
    description: 'Columnas faltantes en sop_pdx_archivos (esquemas parciales)',
    run: async (db) => {
      if (!(await tableExists(db, 'sop_pdx_archivos'))) return;
      const adds = [
        ['apellidos', 'VARCHAR(120) NULL'],
        ['nombres', 'VARCHAR(120) NULL'],
        ['marca_tiempo', 'VARCHAR(40) NULL'],
        ['sufijo_numero', 'VARCHAR(10) NULL'],
        ['estudio_texto', 'VARCHAR(120) NULL'],
        ['nombre_archivo_display', 'VARCHAR(255) NULL'],
        ['editado_por', 'INT NULL'],
        ['editado_en', 'TIMESTAMP NULL']
      ];
      for (const [col, def] of adds) {
        if (!(await columnExists(db, 'sop_pdx_archivos', col))) {
          await db.execute(`ALTER TABLE sop_pdx_archivos ADD COLUMN ${col} ${def}`);
        }
      }
    }
  },
  {
    name: 'rt_sop_pdx_archivos_ensure',
    description: 'Crea sop_pdx_archivos si rt_sop_soportes_radicacion se saltó (solo existía sop_pdx_carpetas)',
    run: async (db) => {
      if (!(await tableExists(db, 'sop_pdx_carpetas'))) return;
      if (await tableExists(db, 'sop_pdx_archivos')) return;
      await db.execute(`CREATE TABLE sop_pdx_archivos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        carpeta_id INT NOT NULL,
        apellidos VARCHAR(120) NULL,
        nombres VARCHAR(120) NULL,
        paciente_nombre VARCHAR(200) NOT NULL,
        paciente_nombre_norm VARCHAR(220) NOT NULL,
        paciente_documento VARCHAR(30) NULL,
        fecha_estudio DATE NULL,
        marca_tiempo VARCHAR(40) NULL,
        sufijo_numero VARCHAR(10) NULL,
        estudio_texto VARCHAR(120) NULL,
        nombre_archivo_original VARCHAR(255) NOT NULL,
        nombre_archivo_display VARCHAR(255) NULL,
        ruta_relativa VARCHAR(500) NOT NULL,
        mime_type VARCHAR(80) DEFAULT 'application/pdf',
        tamano_bytes INT UNSIGNED NOT NULL,
        subido_por INT NULL,
        cita_electro_id INT NULL,
        creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_sop_pdx_carpeta_ensure FOREIGN KEY (carpeta_id) REFERENCES sop_pdx_carpetas(id) ON DELETE CASCADE,
        INDEX idx_sop_pdx_nom (paciente_nombre_norm),
        INDEX idx_sop_pdx_doc (paciente_documento),
        INDEX idx_sop_pdx_carpeta (carpeta_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    }
  },
  {
    name: 'rt_sop_estructura_carpetas_v2',
    description: 'Soportes: carpetas día, RIPS/SOPORTES y FE por contenedor',
    run: async (db) => {
      if (!(await tableExists(db, 'sop_dias'))) return;

      if (!(await columnExists(db, 'sop_dias', 'nombre_display'))) {
        await db.execute(
          "ALTER TABLE sop_dias ADD COLUMN nombre_display VARCHAR(80) NULL AFTER dia, ADD COLUMN estado_facturacion ENUM('facturados','a_facturar') NOT NULL DEFAULT 'a_facturar' AFTER nombre_display"
        );
      }
      await db.execute(
        "UPDATE sop_dias SET nombre_display = CONCAT('Día ', dia) WHERE nombre_display IS NULL OR nombre_display = ''"
      );

      try {
        await db.execute('ALTER TABLE sop_dias DROP INDEX uk_sop_dia');
      } catch (_) { /* ya eliminado */ }
      try {
        await db.execute('ALTER TABLE sop_dias ADD UNIQUE KEY uk_sop_dia_nombre (periodo_id, nombre_display)');
      } catch (_) { /* ya existe */ }

      if (!(await tableExists(db, 'sop_contenedores'))) {
        await db.execute(`CREATE TABLE sop_contenedores (
          id INT AUTO_INCREMENT PRIMARY KEY,
          dia_id INT NOT NULL,
          tipo ENUM('rips','soportes') NOT NULL,
          creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uk_sop_contenedor (dia_id, tipo),
          CONSTRAINT fk_sop_cont_dia FOREIGN KEY (dia_id) REFERENCES sop_dias(id) ON DELETE CASCADE,
          INDEX idx_sop_cont_dia (dia_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      }

      const dias = await db.query('SELECT id FROM sop_dias');
      for (const d of dias) {
        for (const tipo of ['rips', 'soportes']) {
          const ex = await db.query('SELECT id FROM sop_contenedores WHERE dia_id = ? AND tipo = ?', [d.id, tipo]);
          if (!ex.length) {
            await db.execute('INSERT INTO sop_contenedores (dia_id, tipo) VALUES (?,?)', [d.id, tipo]);
          }
        }
      }

      if (await tableExists(db, 'sop_expedientes') && !(await columnExists(db, 'sop_expedientes', 'contenedor_id'))) {
        await db.execute('ALTER TABLE sop_expedientes ADD COLUMN contenedor_id INT NULL AFTER dia_id');
      }

      const sinCont = await db.query('SELECT e.id, e.dia_id FROM sop_expedientes e WHERE e.contenedor_id IS NULL');
      for (const row of sinCont) {
        const c = await db.query(
          "SELECT id FROM sop_contenedores WHERE dia_id = ? AND tipo = 'soportes' LIMIT 1",
          [row.dia_id]
        );
        if (c.length) {
          await db.execute('UPDATE sop_expedientes SET contenedor_id = ? WHERE id = ?', [c[0].id, row.id]);
        }
      }

      try {
        await db.execute('ALTER TABLE sop_expedientes DROP INDEX uk_sop_exp_codigo');
      } catch (_) { /* ignore */ }
      try {
        await db.execute('ALTER TABLE sop_expedientes ADD UNIQUE KEY uk_sop_exp_cont_codigo (contenedor_id, codigo)');
      } catch (_) { /* ignore */ }

      try {
        await db.execute(
          'ALTER TABLE sop_expedientes MODIFY paciente_nombre VARCHAR(200) NULL DEFAULT NULL'
        );
      } catch (_) { /* ignore */ }
    }
  },
  {
    name: 'rt_sop_exp_paciente_factura',
    description: 'Expedientes por paciente: índice por contenedor y factura pendiente NULL',
    run: async (db) => {
      if (!(await tableExists(db, 'sop_expedientes'))) return;

      if (await tableExists(db, 'sop_dias')) {
        const dias = await db.query('SELECT id FROM sop_dias');
        for (const d of dias) {
          for (const tipo of ['rips', 'soportes']) {
            const ex = await db.query('SELECT id FROM sop_contenedores WHERE dia_id = ? AND tipo = ?', [d.id, tipo]);
            if (!ex.length) {
              await db.execute('INSERT INTO sop_contenedores (dia_id, tipo) VALUES (?,?)', [d.id, tipo]);
            }
          }
        }
      }

      const sinCont = await db.query('SELECT e.id, e.dia_id FROM sop_expedientes e WHERE e.contenedor_id IS NULL');
      for (const row of sinCont) {
        const c = await db.query(
          "SELECT id FROM sop_contenedores WHERE dia_id = ? AND tipo = 'soportes' LIMIT 1",
          [row.dia_id]
        );
        if (c.length) {
          await db.execute('UPDATE sop_expedientes SET contenedor_id = ? WHERE id = ?', [c[0].id, row.id]);
        }
      }

      try {
        await db.execute('ALTER TABLE sop_expedientes DROP INDEX uk_sop_exp_codigo');
      } catch (_) { /* ignore */ }
      try {
        await db.execute('ALTER TABLE sop_expedientes DROP INDEX uk_sop_exp_cont_codigo');
      } catch (_) { /* ignore */ }
      try {
        await db.execute(
          'ALTER TABLE sop_expedientes ADD UNIQUE KEY uk_sop_exp_cont_codigo (contenedor_id, codigo)'
        );
      } catch (_) { /* ignore */ }

      try {
        await db.execute(
          'ALTER TABLE sop_expedientes MODIFY numero_factura INT UNSIGNED NULL DEFAULT NULL'
        );
      } catch (_) { /* ignore */ }
      try {
        await db.execute(
          'ALTER TABLE sop_expedientes MODIFY paciente_nombre VARCHAR(200) NULL DEFAULT NULL'
        );
      } catch (_) { /* ignore */ }
    }
  },
  {
    name: 'rt_sop_rips_archivos',
    description: 'Archivos RIPS JSON (integración World Office)',
    run: async (db) => {
      if (!(await tableExists(db, 'sop_rips_archivos'))) {
        await db.execute(`CREATE TABLE sop_rips_archivos (
          id INT AUTO_INCREMENT PRIMARY KEY,
          expediente_id INT NOT NULL,
          contenedor_id INT NOT NULL,
          slot ENUM('json_1','json_2','xml') NOT NULL,
          nombre_archivo VARCHAR(255) NOT NULL,
          nombre_original VARCHAR(500) NULL,
          ruta_relativa VARCHAR(500) NOT NULL,
          tamano_bytes INT UNSIGNED NOT NULL,
          hash_sha256 CHAR(64) NULL,
          origen ENUM('worldoffice_api','manual') NOT NULL DEFAULT 'worldoffice_api',
          subido_por INT NULL,
          creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          actualizado_en TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
          CONSTRAINT fk_sop_rips_exp FOREIGN KEY (expediente_id) REFERENCES sop_expedientes(id) ON DELETE CASCADE,
          CONSTRAINT fk_sop_rips_cont FOREIGN KEY (contenedor_id) REFERENCES sop_contenedores(id) ON DELETE CASCADE,
          UNIQUE KEY uk_sop_rips_exp_slot (expediente_id, slot),
          INDEX idx_sop_rips_cont (contenedor_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      }
      if (await tableExists(db, 'sop_rips_archivos') && !(await columnExists(db, 'sop_rips_archivos', 'slot'))) {
        await db.execute(
          "ALTER TABLE sop_rips_archivos ADD COLUMN slot ENUM('json_1','json_2','xml') NOT NULL DEFAULT 'json_1' AFTER contenedor_id"
        );
      }
      if (await tableExists(db, 'sop_rips_archivos') && !(await columnExists(db, 'sop_rips_archivos', 'nombre_original'))) {
        await db.execute('ALTER TABLE sop_rips_archivos ADD COLUMN nombre_original VARCHAR(500) NULL AFTER nombre_archivo');
      }
      if (await columnExists(db, 'sop_exp_archivos', 'nombre_archivo') && !(await columnExists(db, 'sop_exp_archivos', 'nombre_original'))) {
        await db.execute('ALTER TABLE sop_exp_archivos ADD COLUMN nombre_original VARCHAR(500) NULL AFTER nombre_archivo');
      }
    }
  },
  {
    name: 'rt_tipos_consulta_sesiones_multiples',
    description: 'Flag permite_sesiones_multiples en tipos_consulta y seed TRC Neuropsicología',
    run: async (db) => {
      if (!(await tableExists(db, 'tipos_consulta'))) return;
      if (!(await columnExists(db, 'tipos_consulta', 'permite_sesiones_multiples'))) {
        await db.execute(
          'ALTER TABLE tipos_consulta ADD COLUMN permite_sesiones_multiples TINYINT(1) NOT NULL DEFAULT 0'
        );
      }
      const espRows = await db.query(
        "SELECT id FROM especialidades WHERE LOWER(TRIM(nombre)) LIKE '%neuropsicolog%' LIMIT 1"
      );
      if (!espRows.length) return;
      const espId = espRows[0].id;
      const nombreTrc = 'Terapia de Rehabilitación Cognitiva';
      const existente = await db.query(
        'SELECT id FROM tipos_consulta WHERE especialidad_id=? AND LOWER(TRIM(nombre))=LOWER(TRIM(?)) LIMIT 1',
        [espId, nombreTrc]
      );
      if (existente.length) {
        await db.execute(
          'UPDATE tipos_consulta SET permite_sesiones_multiples=1 WHERE id=?',
          [existente[0].id]
        );
      } else {
        const ordenRows = await db.query(
          'SELECT COALESCE(MAX(orden)+1, 0) AS sig FROM tipos_consulta WHERE especialidad_id=?',
          [espId]
        );
        const orden = ordenRows[0]?.sig ?? 0;
        await db.execute(
          'INSERT INTO tipos_consulta (especialidad_id, nombre, orden, permite_sesiones_multiples) VALUES (?,?,?,1)',
          [espId, nombreTrc, orden]
        );
      }
    }
  },
  {
    name: 'rt_sop_exp_origen_merge_opf',
    description: 'Origen merge_opf en sop_exp_archivos para OPF generado desde ORDEN+HC + autorización',
    run: async (db) => {
      if (!(await tableExists(db, 'sop_exp_archivos'))) return;
      const col = await db.query(
        "SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sop_exp_archivos' AND COLUMN_NAME = 'origen'"
      );
      const type = String(col[0]?.COLUMN_TYPE || '');
      if (type.includes('merge_opf')) return;
      await db.execute(
        "ALTER TABLE sop_exp_archivos MODIFY origen ENUM('upload','copia_pdx','merge_opf') NOT NULL DEFAULT 'upload'"
      );
    }
  },
  {
    name: 'rt_sop_exp_cns_y_vinculos',
    description: 'Tabla sop_exp_vinculos para ORDEN+HC vinculadas al expediente',
    run: async (db) => {
      if (!(await tableExists(db, 'sop_exp_vinculos'))) {
        await db.execute(`CREATE TABLE sop_exp_vinculos (
          id INT AUTO_INCREMENT PRIMARY KEY,
          expediente_id INT NOT NULL,
          pdx_archivo_id INT NOT NULL,
          rol ENUM('orden_hc','consentimiento','comprobante','reporte') NOT NULL DEFAULT 'reporte',
          ruta_relativa VARCHAR(600) NULL,
          nombre_archivo VARCHAR(500) NULL,
          vinculado_por INT NULL,
          creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uq_sop_vinc_exp_pdx (expediente_id, pdx_archivo_id),
          INDEX idx_sop_vinc_exp (expediente_id),
          CONSTRAINT fk_sop_vinc_exp FOREIGN KEY (expediente_id) REFERENCES sop_expedientes(id) ON DELETE CASCADE,
          CONSTRAINT fk_sop_vinc_pdx FOREIGN KEY (pdx_archivo_id) REFERENCES sop_pdx_archivos(id) ON DELETE CASCADE
        )`);
      }
    }
  },
  {
    name: 'rt_electro_revertir_completados_antes_tiempo',
    description: 'Electro: devolver a En Estudio citas Completado cuyo fin programado aún no venció (últimos 14 días)',
    run: async (db) => {
      if (!(await tableExists(db, 'citas_electro'))) return;
      const { sqlEstudioElectroFinProgramadoTs } = require('../utils/electro-fechas');
      const finTs = sqlEstudioElectroFinProgramadoTs();
      await db.execute(`
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
          AND ${finTs} > NOW()
      `);
    }
  },
  {
    name: 'rt_sop_renumerar_dia_quitar_uk_legacy',
    description: 'Soportes armado: quitar uk_sop_dia (periodo_id,dia) y renumerar dia por mes',
    run: async (db) => {
      if (!(await tableExists(db, 'sop_dias'))) return;
      try {
        await db.execute('ALTER TABLE sop_dias DROP INDEX uk_sop_dia');
      } catch (_) { /* ya eliminado */ }
      const periodos = await db.query('SELECT DISTINCT periodo_id FROM sop_dias');
      for (const p of periodos) {
        const dias = await db.query(
          'SELECT id FROM sop_dias WHERE periodo_id = ? ORDER BY id ASC',
          [p.periodo_id]
        );
        let n = 1;
        for (const d of dias) {
          await db.execute('UPDATE sop_dias SET dia = ? WHERE id = ?', [n, d.id]);
          n += 1;
        }
      }
      if (!(await columnExists(db, 'sop_dias', 'nombre_display'))) {
        await db.execute(
          "ALTER TABLE sop_dias ADD COLUMN nombre_display VARCHAR(80) NULL AFTER dia, ADD COLUMN estado_facturacion ENUM('facturados','a_facturar') NOT NULL DEFAULT 'a_facturar' AFTER nombre_display"
        );
      }
      try {
        await db.execute('ALTER TABLE sop_dias ADD UNIQUE KEY uk_sop_dia_nombre (periodo_id, nombre_display)');
      } catch (_) { /* ya existe */ }
    }
  },
  {
    name: 'rt_sop_pdx_carpetas_roles_visibles',
    description: 'Carpetas PDX: visibilidad por rol (JSON)',
    run: async (db) => {
      if (!(await tableExists(db, 'sop_pdx_carpetas'))) return;
      if (!(await columnExists(db, 'sop_pdx_carpetas', 'roles_visibles'))) {
        await db.execute(
          'ALTER TABLE sop_pdx_carpetas ADD COLUMN roles_visibles JSON NULL DEFAULT NULL COMMENT \'Roles que ven la carpeta; NULL=todos\' AFTER color_tema'
        );
      }
    }
  },
  {
    name: 'rt_anexo_fidu_registros',
    description: 'Tabla anexo FIDU (45 columnas tipo Excel)',
    run: async (db) => {
      const { buildAnexoFiduCreateTableSql } = require('../utils/anexo-fidu-columns');
      await db.execute(buildAnexoFiduCreateTableSql());
    }
  }
];

/**
 * Ejecuta migraciones runtime de forma best-effort.
 * Las que ya están registradas en schema_migrations se omiten.
 */
async function runRuntimeMigrations(db, logger) {
  const log = logger || console;

  // Crear schema_migrations si no existe (compartido con db-migrations.js)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(150) NOT NULL UNIQUE,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      description VARCHAR(500),
      statements_count INT DEFAULT 1,
      INDEX idx_name (name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  `);

  for (const m of runtimeMigrations) {
    try {
      const applied = await db.query('SELECT 1 FROM schema_migrations WHERE name = ? LIMIT 1', [m.name]);
      if (applied.length > 0) continue;
      await m.run(db);
      await db.execute(
        'INSERT IGNORE INTO schema_migrations (name, description) VALUES (?, ?)',
        [m.name, m.description || '']
      );
      log.info(`[RT-MIGRATION] ${m.name} aplicada`, { type: 'STARTUP' });
    } catch (err) {
      log.warn(`[RT-MIGRATION] ${m.name} falló: ${err.message}`, { type: 'STARTUP' });
    }
  }
}

module.exports = { runtimeMigrations, runRuntimeMigrations };
