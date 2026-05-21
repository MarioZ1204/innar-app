/**
 * Autenticación por API key para integraciones externas (sin sesión de usuario).
 * World Office → RIPS JSON.
 */
const crypto = require('crypto');

function getWorldOfficeRipsConfig() {
  const apiKey = String(process.env.WORLDOFFICE_RIPS_API_KEY || '').trim();
  const enabledFlag = String(process.env.WORLDOFFICE_RIPS_ENABLED || '').toLowerCase();
  const explicitlyOff = enabledFlag === 'false' || enabledFlag === '0';
  const configured = apiKey.length >= 16;
  const enabled = configured && !explicitlyOff;
  const allowlistRaw = String(process.env.WORLDOFFICE_RIPS_IP_ALLOWLIST || '').trim();
  const ipAllowlist = allowlistRaw
    ? allowlistRaw.split(',').map((s) => s.trim()).filter(Boolean)
    : [];
  return {
    apiKey,
    configured,
    enabled,
    autoCreate: String(process.env.WORLDOFFICE_RIPS_AUTO_CREATE || 'true').toLowerCase() !== 'false',
    ipAllowlist
  };
}

function extractApiKey(req) {
  const header = req.headers['x-api-key'];
  if (header && typeof header === 'string') return header.trim();
  const auth = req.headers.authorization;
  if (auth && /^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim();
  return null;
}

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (xf) return String(xf).split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || '';
}

function requireWorldOfficeRipsApiKey(req, res, next) {
  const cfg = getWorldOfficeRipsConfig();
  if (!cfg.configured) {
    return res.status(503).json({
      error: 'Integración World Office RIPS no configurada en el servidor',
      code: 'INTEGRATION_NOT_CONFIGURED',
      hint: 'Defina WORLDOFFICE_RIPS_API_KEY en .env cuando World Office entregue la clave'
    });
  }
  if (!cfg.enabled) {
    return res.status(503).json({
      error: 'Integración World Office RIPS desactivada',
      code: 'INTEGRATION_DISABLED',
      hint: 'Establezca WORLDOFFICE_RIPS_ENABLED=true en .env'
    });
  }
  if (cfg.ipAllowlist.length) {
    const ip = clientIp(req);
    if (!cfg.ipAllowlist.includes(ip)) {
      return res.status(403).json({ error: 'IP no autorizada', code: 'IP_NOT_ALLOWED' });
    }
  }
  const provided = extractApiKey(req);
  if (!provided || !timingSafeEqual(provided, cfg.apiKey)) {
    return res.status(401).json({ error: 'API key inválida', code: 'INVALID_API_KEY' });
  }
  req.integration = { provider: 'worldoffice', scope: 'rips' };
  return next();
}

module.exports = {
  getWorldOfficeRipsConfig,
  requireWorldOfficeRipsApiKey,
  extractApiKey
};
