'use strict';

/**
 * Ruta donde Engine.IO monta el servidor (debe coincidir en cliente y servidor).
 *
 * - Desarrollo (NODE_ENV≠production): /socket.io
 * - Producción sin SOCKET_IO_PATH: /api/socket.io (Hostinger/Apache suele proxear sólo bien /api/*)
 *
 * Sobrescribe con SOCKET_IO_PATH si quieres otra ruta; usa /socket.io si el dominio
 * llega entero al proceso Node sin Apache delante.
 */
function getSocketIoPath() {
  const fromEnv = process.env.SOCKET_IO_PATH;
  const explicit = typeof fromEnv === 'string' && fromEnv.trim() !== '';
  const raw = (explicit ? fromEnv : '').trim();

  let base;
  if (explicit) {
    base = raw;
  } else if (process.env.NODE_ENV === 'production') {
    base = '/api/socket.io';
  } else {
    base = '/socket.io';
  }

  const withSlash = base.startsWith('/') ? base : `/${base}`;
  return withSlash.replace(/\/+$/, '');
}

module.exports = { getSocketIoPath };
