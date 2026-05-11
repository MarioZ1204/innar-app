'use strict';

/**
 * Ruta donde Engine.IO monta el servidor (debe coincidir en cliente y servidor).
 * En Hostinger, si /socket.io da 404 pero /api/* funciona, define:
 *   SOCKET_IO_PATH=/api/socket.io
 */
function getSocketIoPath() {
  const raw = (process.env.SOCKET_IO_PATH || '/socket.io').trim();
  const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
  return withSlash.replace(/\/+$/, '');
}

module.exports = { getSocketIoPath };
