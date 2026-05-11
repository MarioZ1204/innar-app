// db-mysql.js - Manejador de Pool de conexiones MySQL
require('dotenv').config();
const mysql = require('mysql2/promise');

let pool = null;

// Crear pool de conexiones
async function initPool() {
  if (pool) return pool;
  
  pool = await mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'innar_clinica',
    waitForConnections: true,
    connectionLimit: 20,
    queueLimit: 100,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    charset: 'utf8mb4',
    dateStrings: true
  });

  console.log(`✓ Pool MySQL conectado: ${process.env.DB_HOST}:${process.env.DB_PORT}`);
  return pool;
}

function assertPool(op) {
  if (!pool) {
    throw new Error(`[db-mysql] Pool no inicializado al ejecutar ${op}. Llama a initPool() antes de cualquier query.`);
  }
}

// Ejecutar query (SELECT) - retorna array de filas
async function query(sql, params = []) {
  assertPool('query');
  const connection = await pool.getConnection();
  try {
    const [rows] = await connection.execute(sql, params);
    return rows;
  } finally {
    connection.release();
  }
}

// Obtener una sola fila
async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

// Ejecutar INSERT/UPDATE/DELETE - retorna resultado (affected rows, lastInsertId)
async function execute(sql, params = []) {
  assertPool('execute');
  const connection = await pool.getConnection();
  try {
    const [result] = await connection.execute(sql, params);
    return result;
  } finally {
    connection.release();
  }
}

// Preparar statement (retorna promise-based prepared statement)
function prepare(sql) {
  return {
    run: async (params) => execute(sql, params),
    get: async (params) => queryOne(sql, params),
    all: async (params) => query(sql, params)
  };
}

/**
 * Ejecutar operaciones dentro de una transacción.
 * Uso: await db.transaction(async (conn) => { await conn.execute(sql, params); });
 * Si el callback lanza, hace ROLLBACK automáticamente.
 */
async function transaction(callback) {
  assertPool('transaction');
  const connection = await pool.getConnection();
  await connection.beginTransaction();
  try {
    const result = await callback({
      query: async (sql, params = []) => {
        const [rows] = await connection.execute(sql, params);
        return rows;
      },
      execute: async (sql, params = []) => {
        const [result] = await connection.execute(sql, params);
        return result;
      }
    });
    await connection.commit();
    return result;
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

// Cerrar pool
async function closePool() {
  if (pool) {
    await pool.end();
    console.log('Pool MySQL cerrado');
  }
}

module.exports = {
  initPool,
  query,
  queryOne,
  execute,
  prepare,
  transaction,
  closePool,
  getPool: () => pool
};
