// rate-limiter.js - Módulo para Rate Limiting de Login
const db = require('./db-mysql');

const MAX_INTENTOS = 3;
const TIEMPO_BLOQUEO_MIN = 5; // 5 minutos en milisegundos, pero se multiplica por 60*1000, así que debe ser ajustado

/**
 * Obtener IP del cliente (considerando proxies)
 */
function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0].trim() ||
         req.socket?.remoteAddress ||
         'unknown';
}

/**
 * Verificar si el IP está bloqueado
 */
async function isBlocked(ip) {
  try {
    const attempts = await db.queryOne(
      'SELECT * FROM login_attempts WHERE ip_address = ?',
      [ip]
    );
    
    if (!attempts) return false;
    if (attempts.intentos_fallidos < MAX_INTENTOS) return false;
    
    if (attempts.bloqueado_hasta && attempts.bloqueado_hasta > Math.floor(Date.now() / 1000)) {
      return true; // Aún bloqueado
    }
    
    // Bloqueo expiró, resetear
    await db.execute(
      'UPDATE login_attempts SET intentos_fallidos = 0, bloqueado_hasta = NULL WHERE ip_address = ?',
      [ip]
    );
    return false;
  } catch (error) {
    console.error('[RATE LIMIT] Error verificando bloqueo:', error.message);
    return false;
  }
}

/**
 * Registrar intento fallido
 */
async function recordFailedAttempt(ip, usuario) {
  try {
    const attempts = await db.queryOne(
      'SELECT * FROM login_attempts WHERE ip_address = ?',
      [ip]
    );
    
    if (!attempts) {
      // Primer intento fallido desde este IP
      await db.execute(
        'INSERT INTO login_attempts (ip_address, usuario, intentos_fallidos, ultimo_intento) VALUES (?, ?, 1, NOW())',
        [ip, usuario || null]
      );
    } else {
      // Incrementar contador
      const nuevos_intentos = attempts.intentos_fallidos + 1;
      let bloqueado_hasta = null;
      
      if (nuevos_intentos >= MAX_INTENTOS) {
        // Calcular tiempo de bloqueo (5 minutos desde ahora, en UNIX timestamp)
        bloqueado_hasta = Math.floor((Date.now() + TIEMPO_BLOQUEO_MIN * 60 * 1000) / 1000);
      }
      
      await db.execute(
        'UPDATE login_attempts SET intentos_fallidos = ?, bloqueado_hasta = ?, usuario = ?, ultimo_intento = NOW() WHERE ip_address = ?',
        [nuevos_intentos, bloqueado_hasta, usuario || attempts.usuario, ip]
      );
    }
    
    console.log(`[RATE LIMIT] Intento fallido registrado para IP: ${ip}`);
  } catch (error) {
    console.error('[RATE LIMIT] Error registrando intento fallido:', error.message);
  }
}

/**
 * Resetear intentos después de login exitoso
 */
async function resetAttempts(ip) {
  try {
    await db.execute(
      'DELETE FROM login_attempts WHERE ip_address = ?',
      [ip]
    );
    console.log(`[RATE LIMIT] Intentos reseteados para IP: ${ip}`);
  } catch (error) {
    console.error('[RATE LIMIT] Error reseteando intentos:', error.message);
  }
}

/**
 * Obtener información de bloqueo
 */
async function getBlockInfo(ip) {
  try {
    const attempts = await db.queryOne(
      'SELECT * FROM login_attempts WHERE ip_address = ?',
      [ip]
    );
    
    if (!attempts) return null;
    
    return {
      intentos: attempts.intentos_fallidos,
      bloqueado_hasta: attempts.bloqueado_hasta,
      usuario: attempts.usuario
    };
  } catch (error) {
    console.error('[RATE LIMIT] Error obteniendo info de bloqueo:', error.message);
    return null;
  }
}

module.exports = {
  getClientIP,
  isBlocked,
  recordFailedAttempt,
  resetAttempts,
  getBlockInfo,
  MAX_INTENTOS,
  TIEMPO_BLOQUEO_MIN
};
