'use strict';

/**
 * Ruta donde Engine.IO monta el servidor (debe coincidir en cliente y servidor).
 *
 * - Sin SOCKET_IO_PATH: `NODE_ENV=development` → /socket.io; en cualquier otro caso → /api/socket.io
 *   (muchos paneles no definen NODE_ENV=production pero sí despliegan como prod; esa ruta evita el 404 tras Apache.)
 * - Sobrescribe con SOCKET_IO_PATH si quieres otra ruta (p. ej. /socket.io si todo el dominio va al proceso Node).
 */
function getSocketIoPath() {
  const fromEnv = process.env.SOCKET_IO_PATH;
  const explicit = typeof fromEnv === 'string' && fromEnv.trim() !== '';
  const raw = (explicit ? fromEnv : '').trim();

  let base;
  if (explicit) {
    base = raw;
  } else if (process.env.NODE_ENV === 'development') {
    base = '/socket.io';
  } else {
    base = '/api/socket.io';
  }

  const withSlash = base.startsWith('/') ? base : `/${base}`;
  return withSlash.replace(/\/+$/, '');
}

module.exports = { getSocketIoPath };
