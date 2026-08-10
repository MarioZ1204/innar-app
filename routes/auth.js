// routes/auth.js — Login, logout, sesión, mi cuenta, cambiar contraseña
const express = require('express');
const router = express.Router();
const db = require('../utils/db-mysql');
const rateLimiter = require('../modules/rate-limiter');
const logger = require('../utils/logger');
const { requireAuth, safeError, emitSocket } = require('../middleware');
const { isValidClientHash, hashForStorage, compareClientHash } = require('../utils/password');
const { normalizePermisosLista } = require('../config/permisos-legacy');

function parsePermisosUsuario(raw) {
  let v = raw;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch (_) { v = null; }
  }
  if (!Array.isArray(v)) return null;
  return normalizePermisosLista(v).list;
}

// Estas funciones viven en server.js y se inyectan al montar el router
// Se acceden vía req.app.locals para evitar imports circulares
function getEnsureCsrf(req) {
  return req.app.locals.ensureCsrfForSession;
}

// ── Login ───────────────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { usuario, password } = req.body || {};
  if (!usuario || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
  }

  if (typeof usuario !== 'string' || usuario.length > 64 || !/^[a-zA-Z0-9._-]+$/.test(usuario)) {
    return res.status(400).json({ error: 'Usuario o contraseña incorrectos' });
  }

  if (!isValidClientHash(password)) {
    return res.status(400).json({ error: 'Usuario o contraseña incorrectos' });
  }

  const clientIP = rateLimiter.getClientIP(req);

  try {
    if (await rateLimiter.isBlocked(clientIP)) {
      const blockInfo = await rateLimiter.getBlockInfo(clientIP);
      return res.status(429).json({
        error: 'Demasiados intentos fallidos. Intenta más tarde.',
        bloqueado_hasta: blockInfo.bloqueado_hasta,
        intentos: blockInfo.intentos
      });
    }

    const users = await db.query(
      'SELECT id, usuario, nombre, rol, especialidad, permisos, password_hash FROM usuarios WHERE usuario = ? AND activo = 1',
      [usuario]
    );

    if (users.length === 0) {
      await rateLimiter.recordFailedAttempt(clientIP, usuario);
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }

    const user = users[0];

    if (!compareClientHash(password, user.password_hash)) {
      await rateLimiter.recordFailedAttempt(clientIP, usuario);
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }

    await rateLimiter.resetAttempts(clientIP);
    await db.execute('UPDATE usuarios SET ultimo_acceso = NOW() WHERE id = ?', [user.id]).catch(() => {});

    req.session.usuarioId = user.id;
    req.session.usuario = user.usuario;
    req.session.nombre = user.nombre;
    req.session.rol = user.rol;
    const parsedPermisos = parsePermisosUsuario(user.permisos);
    req.session.permisos = parsedPermisos;

    req.session.save((saveErr) => {
      if (saveErr) {
        logger.error('Error al guardar sesión:', saveErr);
        return res.status(500).json({ error: 'Error interno al iniciar sesión' });
      }
      const ensureCsrf = getEnsureCsrf(req);
      if (ensureCsrf) ensureCsrf(req, res);
      res.json({
        ok: true,
        csrfToken: req.session.csrfToken,
        usuario: { id: user.id, usuario: user.usuario, nombre: user.nombre, rol: user.rol, especialidad: user.especialidad, permisos: parsedPermisos }
      });
    });
  } catch (e) {
    logger.error('[AUTH] login', { message: e.message, code: e.code });
    const payload = { error: safeError(e) };
    if (req.session?.rol === 'superadmin' || process.env.NODE_ENV !== 'production') {
      payload.detail = String(e.message || e).slice(0, 300);
      if (e.code) payload.code = e.code;
    }
    res.status(500).json(payload);
  }
});

// ── Logout ──────────────────────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  res.clearCookie('csrf_token', { path: '/' });
  req.session.destroy(() => res.json({ ok: true }));
});

// ── Verificar sesión ─────────────────────────────────────────────────────────
router.get('/sesion', async (req, res) => {
  if (req.session && req.session.usuarioId) {
    try {
      const users = await db.query(
        'SELECT id, usuario, nombre, rol, especialidad, permisos FROM usuarios WHERE id = ?',
        [req.session.usuarioId]
      );
      const user = users.length > 0 ? users[0] : null;
      if (user) {
        user.permisos = parsePermisosUsuario(user.permisos);
        req.session.permisos = user.permisos;
        req.session.nombre = user.nombre;
        req.session.rol = user.rol;
      }
      const ensureCsrf = getEnsureCsrf(req);
      if (ensureCsrf) ensureCsrf(req, res);
      res.json({ autenticado: true, csrfToken: req.session.csrfToken, usuario: user });
    } catch (e) {
      logger.error('[AUTH] sesion', { message: e.message, code: e.code });
      if (req.session) {
        return req.session.destroy(() => res.json({ autenticado: false }));
      }
      res.status(500).json({ error: safeError(e) });
    }
  } else {
    res.json({ autenticado: false });
  }
});

// ── Mi cuenta ───────────────────────────────────────────────────────────────
router.get('/mi-cuenta', requireAuth, async (req, res) => {
  try {
    const rows = await db.query(
      'SELECT id, usuario, nombre, rol, especialidad, numero_consultorio, creado_en, ultimo_acceso FROM usuarios WHERE id = ?',
      [req.session.usuarioId]
    );
    if (!rows || rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: safeError(e) }); }
});

// ── Cambiar contraseña / nombre ─────────────────────────────────────────────
router.post('/cambiar-contrasena', requireAuth, async (req, res) => {
  const { nombre, contrasenaActual, nuevaContrasena, confirmarContrasena } = req.body || {};

  if (!nombre && !nuevaContrasena) {
    return res.status(400).json({ error: 'Debe proporcionar al menos nombre o contraseña nueva' });
  }

  if (nuevaContrasena) {
    if (!contrasenaActual || !confirmarContrasena) {
      return res.status(400).json({ error: 'Se requieren contraseña actual y confirmación' });
    }
    if (nuevaContrasena !== confirmarContrasena) {
      return res.status(400).json({ error: 'Las contraseñas no coinciden' });
    }
    if (!isValidClientHash(nuevaContrasena) || !isValidClientHash(contrasenaActual)) {
      return res.status(400).json({ error: 'Contraseña inválida' });
    }
    if (nombre && nombre.trim().length === 0) {
      return res.status(400).json({ error: 'El nombre no puede estar vacío' });
    }
  }

  try {
    const users = await db.query('SELECT id, password_hash FROM usuarios WHERE id = ?', [req.session.usuarioId]);
    if (users.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    const user = users[0];

    if (nuevaContrasena) {
      if (!compareClientHash(contrasenaActual, user.password_hash)) {
        return res.status(401).json({ error: 'La contraseña actual es incorrecta' });
      }
      if (compareClientHash(nuevaContrasena, user.password_hash)) {
        return res.status(400).json({ error: 'La nueva contraseña debe ser diferente a la actual' });
      }
    }

    const updates = [];
    const params = [];
    if (nombre) { updates.push('nombre = ?'); params.push(nombre.trim()); }
    if (nuevaContrasena) { updates.push('password_hash = ?'); params.push(hashForStorage(nuevaContrasena)); }
    params.push(req.session.usuarioId);

    await db.execute(`UPDATE usuarios SET ${updates.join(', ')} WHERE id = ?`, params);

    if (nombre) {
      req.session.nombre = nombre.trim();
      emitSocket('usuario:nombre-actualizado', { id: req.session.usuarioId, nombre: nombre.trim() });
    }

    const mensaje = [];
    if (nombre) mensaje.push('nombre');
    if (nuevaContrasena) mensaje.push('contraseña');

    res.json({
      ok: true,
      mensaje: `Tu ${mensaje.join(' y ')} ${mensaje.length > 1 ? 'fueron actualizados' : 'fue actualizado'} correctamente`,
      nombre
    });
  } catch (e) {
    logger.error(e.message, { error: e });
    res.status(500).json({ error: safeError(e) });
  }
});

module.exports = router;
