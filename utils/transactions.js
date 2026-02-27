// utils/transactions.js
// Módulo para manejar transacciones en BD con ACID properties

const mysql = require('mysql2/promise');
const logger = require('./logger');

/**
 * Ejecutar una operación dentro de una transacción
 * Si algo falla, hace ROLLBACK automático
 * 
 * @param {Function} operation - Función async que recibe connection y ejecuta la operación
 * @param {String} description - Descripción de la transacción (ej: "Insert cita")
 * @returns {Promise} Resultado de la operación
 * 
 * @example
 * const result = await withTransaction(async (conn) => {
 *   await conn.execute('INSERT INTO citas...', [data])
 *   await conn.execute('UPDATE cupos...')
 *   return { success: true }
 * }, 'Crear nueva cita')
 */
async function withTransaction(operation, description = 'Transaction') {
  const pool = require('./db-mysql').getPool();
  const connection = await pool.getConnection();
  const startTime = Date.now();
  
  try {
    // Iniciar transacción
    await connection.beginTransaction();
    logger.debug(`START Transaction: ${description}`);
    
    // Ejecutar operación
    const result = await operation(connection);
    
    // Si todo OK, hacer COMMIT
    await connection.commit();
    const duration = Date.now() - startTime;
    logger.success(`COMMIT: ${description}`, { duration: `${duration}ms` });
    return result;
  } catch (error) {
    // Si hay error, hacer ROLLBACK
    await connection.rollback();
    const duration = Date.now() - startTime;
    logger.error(`ROLLBACK: ${description}`, { 
      error: error.message,
      duration: `${duration}ms`
    });
    throw error; // Re-lanzar error para que controller lo maneje
  } finally {
    // Siempre liberar la conexión
    connection.release();
  }
}

/**
 * Ejecutar múltiples queries dentro de una transacción
 * Útil para operaciones simples sin lógica compleja
 * 
 * @param {Array} queries - Array de {sql, params, description}
 * @param {String} transactionName - Nombre de la transacción
 * @returns {Promise} Array de resultados
 * 
 * @example
 * const results = await executeTransaction([
 *   { sql: 'INSERT INTO citas...', params: [...], description: 'Insert cita' },
 *   { sql: 'UPDATE cupos...', params: [...], description: 'Update cupos' }
 * ], 'Crear cita completa')
 */
async function executeTransaction(queries, transactionName = 'Multi-query transaction') {
  return withTransaction(async (conn) => {
    const results = [];
    for (let i = 0; i < queries.length; i++) {
      const query = queries[i];
      try {
        const result = await conn.execute(query.sql, query.params);
        logger.debug(`Query ${i + 1}/${queries.length}: ${query.description || 'Executed'}`);
        results.push(result);
      } catch (e) {
        logger.error(`Query ${i + 1}/${queries.length} failed: ${query.description || 'Unknown'}`, {
          error: e.message
        });
        throw e;
      }
    }
    return results;
  }, transactionName);
}

/**
 * Helper: Obtener valor con SELECT FOR UPDATE (row-level lock)
 * Previene race conditions
 */
async function selectForUpdate(conn, sql, params) {
  const query = sql.replace(/;$/, '') + ' FOR UPDATE';
  const [rows] = await conn.execute(query, params);
  return rows;
}

module.exports = {
  withTransaction,
  executeTransaction,
  selectForUpdate
};
