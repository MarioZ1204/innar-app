// migrate-turnos.js - Script para asegurar tabla de turnos tiene configuración correcta
require('dotenv').config();
const db = require('./db-mysql');

async function migrate() {
  try {
    console.log('[MIGRATE TURNOS] Iniciando migración...');
    
    // Inicializar pool de conexiones
    await db.initPool();
    console.log('[MIGRATE TURNOS] Pool MySQL inicializado');

    // Función auxiliar para checking columnas
    const columnExists = async (tableName, columnName) => {
      const result = await db.query(`
        SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_NAME = ? AND COLUMN_NAME = ? AND TABLE_SCHEMA = DATABASE()
      `, [tableName, columnName]);
      return result.length > 0;
    };

    // Columnas que deben existir en turnos
    const columnsToAdd = [
      { name: 'numero_turno', definition: 'INT NULL' },
      { name: 'doctor_id', definition: 'INT NOT NULL' },
      { name: 'paciente_nombre', definition: 'VARCHAR(255) NULL' },
      { name: 'paciente_documento', definition: 'VARCHAR(50) NULL' },
      { name: 'paciente_telefono', definition: 'VARCHAR(20) NULL' },
      { name: 'estado', definition: "VARCHAR(50) DEFAULT 'EN_SALA'" },
      { name: 'fecha', definition: 'DATE NOT NULL' },
      { name: 'hora', definition: 'TIME NULL' },
      { name: 'tipo_consulta', definition: 'VARCHAR(200) NULL' },
      { name: 'entidad', definition: 'VARCHAR(200) NULL' },
      { name: 'notas', definition: 'TEXT NULL' },
      { name: 'oportunidad', definition: 'INT NULL' },
      { name: 'programado_por', definition: 'VARCHAR(255) NULL' },
      { name: 'creado_en', definition: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' },
      { name: 'actualizado_en', definition: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP' }
    ];

    for (const col of columnsToAdd) {
      const exists = await columnExists('turnos', col.name);
      if (!exists) {
        console.log(`[MIGRATE TURNOS] Agregando columna ${col.name}...`);
        try {
          await db.execute(`ALTER TABLE turnos ADD COLUMN ${col.name} ${col.definition}`);
          console.log(`[MIGRATE TURNOS] ✓ Columna ${col.name} agregada exitosamente`);
        } catch (err) {
          if (err.code === 'ER_DUP_FIELDNAME') {
            console.log(`[MIGRATE TURNOS] ✓ Columna ${col.name} ya existe (error ignorado)`);
          } else {
            console.error(`[MIGRATE TURNOS] Error agregando ${col.name}:`, err.message);
          }
        }
      } else {
        console.log(`[MIGRATE TURNOS] ✓ Columna ${col.name} ya existe`);
      }
    }

    // Modificar columnas específicas para permitir NULL (sin requeridas)
    try {
      console.log('[MIGRATE TURNOS] Modificando columnas para permitir valores NULL...');
      const nullableColumns = [
        'paciente_nombre',
        'paciente_documento',
        'paciente_telefono',
        'hora',
        'tipo_consulta',
        'entidad',
        'notas',
        'oportunidad',
        'programado_por'
      ];

      for (const col of nullableColumns) {
        try {
          // Obtener el tipo actual de la columna
          const colInfo = await db.query(`
            SELECT COLUMN_TYPE 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_NAME = 'turnos' AND COLUMN_NAME = ? AND TABLE_SCHEMA = DATABASE()
          `, [col]);

          if (colInfo.length > 0) {
            const colType = colInfo[0].COLUMN_TYPE;
            await db.execute(`ALTER TABLE turnos MODIFY ${col} ${colType} NULL`);
            console.log(`[MIGRATE TURNOS] ✓ Columna ${col} modificada a NULL`);
          }
        } catch (err) {
          console.log(`[MIGRATE TURNOS] Columna ${col} ya es NULL o error ignorado`);
        }
      }
    } catch (err) {
      console.log('[MIGRATE TURNOS] Error al modificar columnas:', err.message);
    }

    console.log('[MIGRATE TURNOS] ✓ Migración completada');
    await db.closePool();
    process.exit(0);
  } catch (e) {
    console.error('[MIGRATE TURNOS] ✗ Error:', e.message);
    console.error(e);
    await db.closePool();
    process.exit(1);
  }
}

migrate();
