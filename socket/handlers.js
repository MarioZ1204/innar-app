// Compatibilidad: antes enganchaba Socket.IO. En Hostinger/Passenger se usa solo HTTP polling.
const logger = require('../utils/logger');

function attachSockets() {
  logger.info('[Realtime] Canal SSE /api/eventos/stream (poll HTTP de respaldo). Socket.IO no se monta en Hostinger.', { type: 'STARTUP' });
}

module.exports = { attachSockets };
