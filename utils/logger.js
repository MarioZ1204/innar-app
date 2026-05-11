// utils/logger.js
// Sistema de logging centralizado con niveles, timestamps y archivos separados

const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '../logs');
const LOG_FILE = path.join(LOG_DIR, 'app.log');
const ERROR_LOG_FILE = path.join(LOG_DIR, 'errors.log');
const DEBUG_LOG_FILE = path.join(LOG_DIR, 'debug.log');

// Tamaño máximo por archivo de log (en bytes)
const MAX_LOG_SIZE = (parseInt(process.env.LOG_MAX_SIZE_MB) || 10) * 1024 * 1024;
// Máximo de archivos rotados a conservar
const MAX_ROTATED_FILES = 3;

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
  const safeData = redactSensitive(data);
  const dataStr = includeData && Object.keys(safeData).length > 0 
    ? ` | ${JSON.stringify(safeData)}`
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
  const line = formatLogLine('info', message, data);
  console.log(`${Colors.green}\u2139 ${line}${Colors.reset}`);
  appendToLog(LOG_FILE, line);
}

/**
 * Log de errores
 */
function error(message, data = {}) {
  const line = formatLogLine('error', message, data);
  console.error(`${Colors.red}\u2717 ${line}${Colors.reset}`);
  appendToLog(ERROR_LOG_FILE, line);
  appendToLog(LOG_FILE, line);
}

/**
 * Log de advertencias
 */
function warn(message, data = {}) {
  const line = formatLogLine('warn', message, data);
  console.warn(`${Colors.yellow}\u26A0 ${line}${Colors.reset}`);
  appendToLog(LOG_FILE, line);
}

/**
 * Log de debug
 */
function debug(message, data = {}) {
  if (process.env.DEBUG_MODE !== 'true') return;
  const line = formatLogLine('debug', message, data);
  console.log(`${Colors.cyan}\uD83D\uDC1B ${line}${Colors.reset}`);
  appendToLog(DEBUG_LOG_FILE, line);
}

/**
 * Log de éxito
 */
function success(message, data = {}) {
  const line = formatLogLine('success', message, data);
  console.log(`${Colors.green}\u2713 ${line}${Colors.reset}`);
  appendToLog(LOG_FILE, line);
}

/**
 * Log de API (requests/responses)
 */
function api(method, path, status, duration, data = {}) {
  const statusColor = status >= 400 ? Colors.red : status >= 300 ? Colors.yellow : Colors.green;
  const line = formatLogLine('api', `${method} ${path} ${status} (${duration}ms)`, data, false);
  console.log(`${statusColor}\u2192 ${method.padEnd(6)} ${path.padEnd(40)} ${status} ${Colors.gray}${duration}ms${Colors.reset}`);
  appendToLog(LOG_FILE, line);
}

/**
 * Log de SQL/Transacciones
 */
function sql(query, params = [], error = null) {
  if (process.env.DEBUG_MODE !== 'true') return;
  const line = `[${getTimestamp()}] [SQL] ${query.substring(0, 100)}... | params: ${JSON.stringify(params).substring(0, 100)}${error ? ' | ERROR: ' + error : ''}`;
  console.log(`${Colors.gray}SQL: ${query.substring(0, 80)}...${Colors.reset}`);
  appendToLog(DEBUG_LOG_FILE, line);
}

/**
 * Rotar archivo de log si excede el tamaño máximo.
 * nombre.log → nombre.1.log → nombre.2.log → nombre.3.log (borrado)
 */
function rotateIfNeeded(filePath) {
  try {
    if (!fs.existsSync(filePath)) return;
    const stats = fs.statSync(filePath);
    if (stats.size < MAX_LOG_SIZE) return;

    // Borrar el más antiguo
    const oldest = filePath.replace(/\.log$/, `.${MAX_ROTATED_FILES}.log`);
    if (fs.existsSync(oldest)) fs.unlinkSync(oldest);

    // Renombrar hacia arriba: 2→3, 1→2
    for (let i = MAX_ROTATED_FILES - 1; i >= 1; i--) {
      const src = filePath.replace(/\.log$/, `.${i}.log`);
      const dst = filePath.replace(/\.log$/, `.${i + 1}.log`);
      if (fs.existsSync(src)) fs.renameSync(src, dst);
    }

    // Actual → .1
    fs.renameSync(filePath, filePath.replace(/\.log$/, '.1.log'));

    // Crear nuevo archivo vacío con marca de rotación
    fs.writeFileSync(filePath, `[${new Date().toISOString()}] [INFO] Log rotado (anterior excedió ${(MAX_LOG_SIZE / 1024 / 1024).toFixed(0)} MB)\n`, 'utf8');
  } catch (e) {
    console.error('Error en rotación de log:', e.message);
  }
}

/**
 * Campos sensibles que se redactan antes de escribir al log
 */
const SENSITIVE_KEYS = [
  'password', 'contrasena', 'contraseña', 'secret', 'token', 'authorization', 'cookie',
  'password_hash', 'password_temporal', 'hash', 'csrf', 'csrftoken',
  // PII clínica: redactar por defecto
  'documento', 'dni', 'cedula', 'cédula', 'paciente_telefono', 'telefono', 'telefono2',
  'paciente_documento', 'paciente_email', 'email'
];

/**
 * Redactar datos sensibles del objeto de datos
 */
function redactSensitive(data) {
  if (!data || typeof data !== 'object') return data;
  const clean = {};
  for (const [key, value] of Object.entries(data)) {
    if (SENSITIVE_KEYS.some(s => key.toLowerCase().includes(s))) {
      clean[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      clean[key] = redactSensitive(value);
    } else {
      clean[key] = value;
    }
  }
  return clean;
}

/**
 * Cola async de escritura. Un solo stream por archivo, encolamos y vaciamos en
 * el próximo tick para no bloquear el event loop bajo carga.
 *
 * En `production` se usa write stream + cola; en otros entornos seguimos con
 * `appendFileSync` para mantener el comportamiento histórico en tests/dev.
 */
const ASYNC_LOGS = (process.env.LOG_ASYNC || (process.env.NODE_ENV === 'production' ? 'true' : 'false')) === 'true';

const writeStreams = new Map();
const writeQueues = new Map();
let queueFlushScheduled = false;

function getOrCreateStream(filePath) {
  let stream = writeStreams.get(filePath);
  if (stream && !stream.closed) return stream;
  ensureLogDir();
  rotateIfNeeded(filePath);
  stream = fs.createWriteStream(filePath, { flags: 'a', encoding: 'utf8' });
  stream.on('error', (e) => console.error('Log stream error:', e.message));
  writeStreams.set(filePath, stream);
  return stream;
}

function scheduleFlush() {
  if (queueFlushScheduled) return;
  queueFlushScheduled = true;
  setImmediate(flushQueues);
}

function flushQueues() {
  queueFlushScheduled = false;
  for (const [filePath, lines] of writeQueues.entries()) {
    if (lines.length === 0) continue;
    try {
      rotateIfNeeded(filePath);
      const stream = getOrCreateStream(filePath);
      const chunk = lines.join('\n') + '\n';
      writeQueues.set(filePath, []);
      stream.write(chunk);
    } catch (e) {
      console.error('Error vaciando cola de log:', e.message);
    }
  }
}

function appendToLog(filePath, line) {
  if (!ASYNC_LOGS) {
    try {
      ensureLogDir();
      rotateIfNeeded(filePath);
      fs.appendFileSync(filePath, line + '\n', 'utf8');
    } catch (e) {
      console.error('Error escribiendo log:', e.message);
    }
    return;
  }
  let q = writeQueues.get(filePath);
  if (!q) { q = []; writeQueues.set(filePath, q); }
  q.push(line);
  // Si la cola crece demasiado, flushear inmediatamente para no perder eventos
  if (q.length >= 200) {
    flushQueues();
  } else {
    scheduleFlush();
  }
}

function closeLogStreams() {
  try { flushQueues(); } catch (_) {}
  for (const stream of writeStreams.values()) {
    try { stream.end(); } catch (_) {}
  }
  writeStreams.clear();
}

// Asegurar flush en cierre del proceso (best-effort)
if (ASYNC_LOGS) {
  process.on('exit', closeLogStreams);
  process.on('SIGINT', () => { closeLogStreams(); process.exit(130); });
  process.on('SIGTERM', () => { closeLogStreams(); process.exit(143); });
}

/**
 * Limpiar logs antiguos (mantener últimos 30 días)
 */
function cleanOldLogs() {
  try {
    const files = [LOG_FILE, ERROR_LOG_FILE, DEBUG_LOG_FILE];
    files.forEach(file => {
      rotateIfNeeded(file);
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
  ensureLogDir,
  closeLogStreams,
  flushQueues
};
