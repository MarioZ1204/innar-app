// utils/add-indexes.js
// Script para agregar índices optimizados en la base de datos
// Mejora significativamente el performance de queries

const db = require('./db-mysql');
const logger = require('./logger');

/**
 * Índices críticos que mejoran performance
 * Agrupados por tabla
 */
const indexes = {
  usuarios: [
    { name: 'idx_usuario_unique', column: 'usuario', unique: true },
    { name: 'idx_email', column: 'email', unique: true },
    { name: 'idx_rol', column: 'rol' },
    { name: 'idx_activo', column: 'activo' }
  ],

  turnos: [
    { name: 'idx_fecha_doctor', columns: ['fecha', 'doctor_id'], composite: true },
    { name: 'idx_estado', column: 'estado' },
    { name: 'idx_doctor_fecha_estado', columns: ['doctor_id', 'fecha', 'estado'], composite: true }
  ],

  citas_electro: [
    { name: 'idx_fecha', column: 'fecha' },
    { name: 'idx_paciente_dni', column: 'paciente_dni' },
    { name: 'idx_estado', column: 'estado' },
    { name: 'idx_equipo_id', column: 'equipo_id' },
    { name: 'idx_fecha_equipo', columns: ['fecha', 'equipo_id'], composite: true },
    { name: 'idx_diagnostico_id', column: 'diagnostico_id' }
  ],

  recibos: [
    { name: 'idx_numero_recibo_unique', column: 'numero_recibo', unique: true },
    { name: 'idx_usuario_id', column: 'usuario_id' },
    { name: 'idx_fecha', column: 'fecha' },
    { name: 'idx_estado', column: 'estado' },
    { name: 'idx_usuario_fecha', columns: ['usuario_id', 'fecha'], composite: true }
  ],

  diagnosticos: [
    { name: 'idx_nombre', column: 'nombre' },
    { name: 'idx_activo', column: 'activo' },
    { name: 'idx_codigo', column: 'codigo' }
  ],

  dias_bloqueados: [
    { name: 'idx_fecha', column: 'fecha' },
    { name: 'idx_doctor_id', column: 'doctor_id' },
    { name: 'idx_doctor_fecha', columns: ['doctor_id', 'fecha'], composite: true }
  ],

  doctor_disponibilidad_mensual: [
    { name: 'idx_doctor_year_month', columns: ['doctor_id', 'year', 'month'], composite: true },
    { name: 'idx_doctor_id', column: 'doctor_id' }
  ],

  doctor_disponibilidad_intervalos: [
    { name: 'idx_doctor_fecha', columns: ['doctor_id', 'fecha'], composite: true },
    { name: 'idx_hora', columns: ['hora_inicio', 'hora_fin'], composite: true }
  ],

  login_attempts: [
    { name: 'idx_ip_address', column: 'ip_address' },
    { name: 'idx_usuario', column: 'usuario' },
    { name: 'idx_ip_timestamp', columns: ['ip_address', 'primer_intento'], composite: true }
  ],

  usuario_auditorias: [
    { name: 'idx_usuario_id', column: 'usuario_id' },
    { name: 'idx_admin_id', column: 'admin_id' },
    { name: 'idx_fecha_cambio', column: 'fecha_cambio' },
    { name: 'idx_usuario_fecha', columns: ['usuario_id', 'fecha_cambio'], composite: true }
  ],

  estados: [
    { name: 'idx_activo', column: 'activo' }
  ]
};

/**
 * Verificar si un índice existe
 */
async function indexExists(table, indexName) {
  try {
    const pool = db.getPool();
    const [results] = await pool.query(
      `SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS 
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?`,
      [process.env.DB_NAME, table, indexName]
    );
    return results.length > 0;
  } catch (error) {
    logger.error('Error checking index existence', { table, indexName, error: error.message });
    return false;
  }
}

/**
 * Crear un índice
 */
async function createIndex(table, indexDef) {
  try {
    const pool = db.getPool();
    
    // Verificar si ya existe
    const exists = await indexExists(table, indexDef.name);
    if (exists) {
      logger.info(`Index ya existe: ${table}.${indexDef.name}`);
      return { success: true, skipped: true };
    }

    // Construir SQL
    let sql;
    const unique = indexDef.unique ? 'UNIQUE' : '';
    
    if (indexDef.composite) {
      const columns = indexDef.columns.join(', ');
      sql = `ALTER TABLE ${table} ADD ${unique} INDEX ${indexDef.name} (${columns})`;
    } else {
      sql = `ALTER TABLE ${table} ADD ${unique} INDEX ${indexDef.name} (${indexDef.column})`;
    }

    // Ejecutar
    await pool.query(sql);
    logger.success(`Index creado: ${table}.${indexDef.name}`, { sql });
    return { success: true, created: true };
  } catch (error) {
    logger.error(`Error creando index ${table}.${indexDef.name}`, { error: error.message });
    return { success: false, error: error.message };
  }
}

/**
 * Crear todos los índices
 */
async function createAllIndexes() {
  logger.info('Iniciando creación de índices...');
  
  const results = {
    total: 0,
    created: 0,
    skipped: 0,
    errors: 0
  };

  try {
    for (const [table, indexDefs] of Object.entries(indexes)) {
      logger.info(`Procesando tabla: ${table}`);

      for (const indexDef of indexDefs) {
        results.total++;
        const result = await createIndex(table, indexDef);

        if (result.success) {
          if (result.created) {
            results.created++;
          } else if (result.skipped) {
            results.skipped++;
          }
        } else {
          results.errors++;
        }
      }
    }

    logger.success('Indexación completada', results);
    return results;
  } catch (error) {
    logger.error('Error en indexación', { error: error.message });
    throw error;
  }
}

/**
 * Mostrar información de índices existentes
 */
async function showIndexInfo(table) {
  try {
    const pool = db.getPool();
    const [results] = await pool.query(
      `SELECT INDEX_NAME, COLUMN_NAME, SEQ_IN_INDEX 
       FROM INFORMATION_SCHEMA.STATISTICS 
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? 
       ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
      [process.env.DB_NAME, table]
    );

    if (results.length === 0) {
      logger.info(`No hay índices en tabla: ${table}`);
      return [];
    }

    logger.info(`Índices en tabla ${table}:`, { count: results.length });
    results.forEach(row => {
      console.log(`  - ${row.INDEX_NAME}: ${row.COLUMN_NAME} (#${row.SEQ_IN_INDEX})`);
    });

    return results;
  } catch (error) {
    logger.error('Error mostrando índices', { table, error: error.message });
    return [];
  }
}

/**
 * Analizar fragmentación de índices (>10% = puede necesitar OPTIMIZE)
 */
async function showIndexFragmentation() {
  try {
    const pool = db.getPool();
    const [results] = await pool.query(
      `SELECT TABLE_NAME, INDEX_NAME, 
              ROUND(STAT_VALUE, 2) as fragmentation_percent
       FROM mysql.innodb_index_stats
       WHERE STAT_NAME = 'n_pages_freed'
       AND STAT_VALUE > 0`,
      []
    );

    if (results.length > 0) {
      logger.warn('Tablas/Índices con fragmentación detectada:');
      results.forEach(row => {
        console.log(`  - ${row.TABLE_NAME}.${row.INDEX_NAME}: ${row.fragmentation_percent}%`);
      });
    }

    return results;
  } catch (error) {
    logger.warn('Fragmentación check no disponible (necesita acceso a mysql.innodb_index_stats)');
    return [];
  }
}

/**
 * Optimizar tabla (desfragmentar)
 */
async function optimizeTable(table) {
  try {
    const pool = db.getPool();
    logger.info(`Optimizando tabla: ${table}`);
    await pool.query(`OPTIMIZE TABLE ${table}`);
    logger.success(`Tabla optimizada: ${table}`);
    return { success: true };
  } catch (error) {
    logger.error(`Error optimizando tabla ${table}`, { error: error.message });
    return { success: false, error: error.message };
  }
}

/**
 * Analizar tabla (actualizar estadísticas)
 */
async function analyzeTable(table) {
  try {
    const pool = db.getPool();
    logger.info(`Analizando tabla: ${table}`);
    await pool.query(`ANALYZE TABLE ${table}`);
    logger.success(`Tabla analizada: ${table}`);
    return { success: true };
  } catch (error) {
    logger.error(`Error analizando tabla ${table}`, { error: error.message });
    return { success: false, error: error.message };
  }
}

/**
 * Ejecutar como script
 * node utils/add-indexes.js [command]
 * 
 * Commands:
 *   create    - Crear todos los índices
 *   info      - Mostrar información de índices
 *   optimize  - Optimizar todas las tablas
 *   analyze   - Analizar todas las tablas
 *   status    - Mostrar estado completo
 */
async function main() {
  const command = process.argv[2] || 'status';

  try {
    switch (command) {
      case 'create':
        await createAllIndexes();
        break;

      case 'info':
        for (const table of Object.keys(indexes)) {
          await showIndexInfo(table);
        }
        break;

      case 'optimize':
        for (const table of Object.keys(indexes)) {
          await optimizeTable(table);
        }
        break;

      case 'analyze':
        for (const table of Object.keys(indexes)) {
          await analyzeTable(table);
        }
        break;

      case 'status':
      default:
        logger.info('Estado de índices por tabla:');
        for (const table of Object.keys(indexes)) {
          await showIndexInfo(table);
        }
        await showIndexFragmentation();
        break;
    }
  } catch (error) {
    logger.error('Error en main', { error: error.message });
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

// Ejecutar si es llamado directamente
if (require.main === module) {
  main().catch(err => {
    logger.error('Fatal error', { error: err.message });
    process.exit(1);
  });
}

module.exports = {
  createAllIndexes,
  createIndex,
  showIndexInfo,
  optimizeTable,
  analyzeTable,
  showIndexFragmentation
};
