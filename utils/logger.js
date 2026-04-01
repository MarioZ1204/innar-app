// utils/logger.js
// Sistema de logging centralizado con niveles, timestamps y archivos separados

const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '../logs');
const LOG_FILE = path.join(LOG_DIR, 'app.log');
const ERROR_LOG_FILE = path.join(LOG_DIR, 'errors.log');
const DEBUG_LOG_FILE = path.join(LOG_DIR, 'debug.log');

// Colores ANSI para terminal
const Colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m'
};

/**
 * Crear carpeta de logs si no existe
 */
function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

/**
 * Obtener timestamp formateado
 */
function getTimestamp() {
  return new Date().toISOString();
}

/**
 * Formatear línea de log
 */
function formatLogLine(level, message, data = {}, includeData = true) {
  const timestamp = getTimestamp();
  const dataStr = includeData && Object.keys(data).length > 0 
    ? ` | ${JSON.stringify(data)}`
    : '';
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${dataStr}`;
}

/**
 * Obtener color por nivel
 */
function getLevelColor(level) {
  switch (level.toLowerCase()) {
    case 'error': return Colors.red;
    case 'warn': return Colors.yellow;
    case 'info': return Colors.green;
    case 'debug': return Colors.cyan;
    case 'success': return Colors.green;
    default: return Colors.reset;
  }
}

/**
 * Log de información
 */
function info(message, data = {}) {
  ensureLogDir();
  const line = formatLogLine('info', message, data);
  
  // Terminal con color
  console.log(`${Colors.green}ℹ ${line}${Colors.reset}`);
  
  // Archivo
  fs.appendFileSync(LOG_FILE, line + '\n', 'utf8');
}

/**
 * Log de errores
 */
function error(message, data = {}) {
  ensureLogDir();
  const line = formatLogLine('error', message, data);
  
  // Terminal con color
  console.error(`${Colors.red}✗ ${line}${Colors.reset}`);
  
  // Archivos
  fs.appendFileSync(ERROR_LOG_FILE, line + '\n', 'utf8');
  fs.appendFileSync(LOG_FILE, line + '\n', 'utf8');
}

/**
 * Log de advertencias
 */
function warn(message, data = {}) {
  ensureLogDir();
  const line = formatLogLine('warn', message, data);
  
  // Terminal con color
  console.warn(`${Colors.yellow}⚠ ${line}${Colors.reset}`);
  
  // Archivo
  fs.appendFileSync(LOG_FILE, line + '\n', 'utf8');
}

/**
 * Log de debug
 */
function debug(message, data = {}) {
  if (process.env.DEBUG_MODE !== 'true') return;
  
  ensureLogDir();
  const line = formatLogLine('debug', message, data);
  
  // Terminal
  console.log(`${Colors.cyan}🐛 ${line}${Colors.reset}`);
  
  // Archivo
  fs.appendFileSync(DEBUG_LOG_FILE, line + '\n', 'utf8');
}

/**
 * Log de éxito
 */
function success(message, data = {}) {
  ensureLogDir();
  const line = formatLogLine('success', message, data);
  
  // Terminal
  console.log(`${Colors.green}✓ ${line}${Colors.reset}`);
  
  // Archivo
  fs.appendFileSync(LOG_FILE, line + '\n', 'utf8');
}

/**
 * Log de API (requests/responses)
 */
function api(method, path, status, duration, data = {}) {
  ensureLogDir();
  const statusColor = status >= 400 ? Colors.red : status >= 300 ? Colors.yellow : Colors.green;
  const line = formatLogLine('api', `${method} ${path} ${status} (${duration}ms)`, data, false);
  
  // Terminal
  console.log(`${statusColor}→ ${method.padEnd(6)} ${path.padEnd(40)} ${status} ${Colors.gray}${duration}ms${Colors.reset}`);
  
  // Archivo
  fs.appendFileSync(LOG_FILE, line + '\n', 'utf8');
}

/**
 * Log de SQL/Transacciones
 */
function sql(query, params = [], error = null) {
  if (process.env.DEBUG_MODE !== 'true') return;
  
  ensureLogDir();
  const line = `[${getTimestamp()}] [SQL] ${query.substring(0, 100)}... | params: ${JSON.stringify(params).substring(0, 100)}${error ? ' | ERROR: ' + error : ''}`;
  
  console.log(`${Colors.gray}SQL: ${query.substring(0, 80)}...${Colors.reset}`);
  
  fs.appendFileSync(DEBUG_LOG_FILE, line + '\n', 'utf8');
}

/**
 * Limpiar logs antiguos (mantener últimos 30 días)
 */
function cleanOldLogs() {
  try {
    const files = [LOG_FILE, ERROR_LOG_FILE, DEBUG_LOG_FILE];
    const maxSizeMB = parseInt(process.env.LOG_MAX_SIZE_MB) || 10;
    
    files.forEach(file => {
      if (fs.existsSync(file)) {
        const stats = fs.statSync(file);
        const sizeMB = stats.size / (1024 * 1024);
        
        if (sizeMB > maxSizeMB) {
          // Truncar archivo (no archivar — evita acumulación)
          fs.writeFileSync(file, `[${new Date().toISOString()}] [INFO] Log truncado por rotación (era ${sizeMB.toFixed(1)} MB)\n`, 'utf8');
        }
      }
    });
  } catch (e) {
    console.error('Error limpiando logs:', e.message);
  }
}

/**
 * Obtener últimas líneas de un log
 */
function getTail(logFile = LOG_FILE, lines = 50) {
  try {
    if (!fs.existsSync(logFile)) return [];
    const content = fs.readFileSync(logFile, 'utf8');
    return content.split('\n').slice(-lines).filter(l => l.trim());
  } catch (e) {
    return [`Error leyendo ${logFile}: ${e.message}`];
  }
}

// Limpiar logs al iniciar
cleanOldLogs();

module.exports = {
  info,
  error,
  warn,
  debug,
  success,
  api,
  sql,
  getTail,
  cleanOldLogs,
  ensureLogDir
};
