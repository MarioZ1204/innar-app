// config/rate-limit.js
// Rate limiters globales + para login (express-rate-limit)

const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

function getTrustedIps() {
  return (process.env.RATE_LIMIT_TRUSTED_IPS || '')
    .split(',')
    .map(ip => ip.trim())
    .filter(Boolean);
}

function isTrustedIp(trustedIps, ip) {
  return !!ip && trustedIps.includes(ip);
}

function applyRateLimiters(app) {
  const trustedIps = getTrustedIps();

  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: Number(process.env.API_RATE_LIMIT_MAX || 500),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiadas solicitudes, intenta de nuevo en un minuto' },
    skip: (req) => {
      if (req.path === '/health' || req.path === '/version') return true;
      return isTrustedIp(trustedIps, req.ip);
    },
    keyGenerator: (req, res) => {
      if (req.session?.usuarioId) return `user:${req.session.usuarioId}`;
      if (req.user?.id) return `user:${req.user.id}`;
      if (req.sessionID) return `session:${req.sessionID}`;
      return ipKeyGenerator(req, res);
    }
  });
  app.use('/api/', apiLimiter);

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: Number(process.env.LOGIN_RATE_LIMIT_MAX || 40),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiados intentos de inicio de sesión. Intenta más tarde.' },
    keyGenerator: (req, res) => ipKeyGenerator(req, res),
    skip: (req) => isTrustedIp(trustedIps, req.ip)
  });
  app.use('/api/login', authLimiter);

  return { apiLimiter, authLimiter };
}

module.exports = { applyRateLimiters, isTrustedIp, getTrustedIps };
