// db-mysql.js - Manejador de Pool de conexiones MySQL
require('dotenv').config();
const mysql = require('mysql2/promise');

let pool = null;

const DB_QUERY_RETRIES = parseInt(
  process.env.DB_QUERY_RETRIES || (process.env.NODE_ENV === 'production' ? '5' : '3'),
  10
) || 3;
const DB_RETRY_BASE_MS = parseInt(process.env.DB_RETRY_BASE_MS || '150', 10) || 150;
const TRANSIENT_DB_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'EPERM',
  'PROTOCOL_CONNECTION_LOST',
  'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR',
  'PROTOCOL_ENQUEUE_AFTER_QUIT'
]);

function isTransientDbError(err) {
  if (!err) return false;
  if (TRANSIENT_DB_CODES.has(err.code)) return true;
  if (err.fatal) return true;
  const msg = String(err.message || '');
  if (/ECONNRESET|Connection lost|server has gone away|Too many connections/i.test(msg)) return true;
  if (err.code === 'EPERM' && /3306|connect/i.test(msg)) return true;
  return false;
}

function isSqlError(err) {
  if (!err) return false;
  const code = String(err.code || '');
  return code.startsWith('ER_') || !!err.sqlState;
}

/** Error de red/pool al conectar a MySQL (no confundir con EPERM de disco). */
function isDbConnectionError(err) {
  if (!err || isSqlError(err)) return false;
  if (isTransientDbError(err)) return true;
  const msg = String(err.message || '');
  return /3306|mysql|Connection lost|server has gone away|Too many connections/i.test(msg);
}

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(attempt) {
  return DB_RETRY_BASE_MS * (attempt + 1);
}

async function getPooledConnection() {
  let lastErr;
  for (let attempt = 0; attempt < DB_QUERY_RETRIES; attempt++) {
    try {
      return await pool.getConnection();
    } catch (err) {
      lastErr = err;
      if (!isTransientDbError(err) || attempt >= DB_QUERY_RETRIES - 1) throw err;
      await sleepMs(retryDelayMs(attempt));
    }
  }
  throw lastErr;
}

async function withPooledConnection(op, run) {
  assertPool(op);
  let lastErr;
  for (let attempt = 0; attempt < DB_QUERY_RETRIES; attempt++) {
    const connection = await getPooledConnection();
    try {
      const result = await run(connection);
      connection.release();
      return result;
    } catch (err) {
      lastErr = err;
      try { connection.destroy(); } catch (_) { /* ignore */ }
      if (!isTransientDbError(err) || attempt >= DB_QUERY_RETRIES - 1) throw err;
      await sleepMs(retryDelayMs(attempt));
    }
  }
  throw lastErr;
}

// Crear pool de conexiones
async function initPool() {
  if (pool) return pool;
  
  const defaultPoolLimit = process.env.NODE_ENV === 'production' ? 8 : 20;
  const connectionLimit = parseInt(process.env.DB_POOL_LIMIT || String(defaultPoolLimit), 10) || defaultPoolLimit;

  pool = await mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'innar_clinica',
    waitForConnections: true,
    connectionLimit,
    queueLimit: parseInt(process.env.DB_POOL_QUEUE_LIMIT || '50', 10) || 50,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    charset: 'utf8mb4',
    dateStrings: true,
    // Colombia: evita que CURRENT_TIMESTAMP / NOW() queden en UTC del hosting
    timezone: process.env.DB_TIMEZONE || '-05:00'
  });

  pool.on('connection', (connection) => {
    connection.query("SET time_zone = ?", [process.env.DB_TIMEZONE || '-05:00'], () => {});
  });

  console.log(`✓ Pool MySQL conectado: ${process.env.DB_HOST}:${process.env.DB_PORT} (límite ${connectionLimit})`);
  return pool;
}

function assertPool(op) {
  if (!pool) {
    throw new Error(`[db-mysql] Pool no inicializado al ejecutar ${op}. Llama a initPool() antes de cualquier query.`);
  }
}

// Ejecutar query (SELECT) - retorna array de filas
async function query(sql, params = []) {
  return withPooledConnection('query', async (connection) => {
    const [rows] = await connection.execute(sql, params);
    return rows;
  });
}

// Obtener una sola fila
async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

// Ejecutar INSERT/UPDATE/DELETE - retorna resultado (affected rows, lastInsertId)
async function execute(sql, params = []) {
  return withPooledConnection('execute', async (connection) => {
    const [result] = await connection.execute(sql, params);
    return result;
  });
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
  const connection = await getPooledConnection();
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
  getPool: () => pool,
  isTransientDbError,
  isSqlError,
  isDbConnectionError
};
