// Compatibilidad: antes enganchaba Socket.IO. En Hostinger/Passenger se usa solo HTTP polling.
const logger = require('../utils/logger');

function attachSockets() {
  logger.info('[Realtime] Modo HTTP poll (/api/eventos/poll); Socket.IO no se monta.', { type: 'STARTUP' });
}

module.exports = { attachSockets };
