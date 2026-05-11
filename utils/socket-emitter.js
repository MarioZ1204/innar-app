// Emisión tiempo-real desde el servidor → cola HTTP (sin Socket.IO).
const logger = require('./logger');
const eventPollQueue = require('./event-poll-queue');

/** @deprecated ya no inicializa Socket.IO; compatibilidad con código que llamaba init(). */
function init() {}

function emit(eventName, data) {
  try {
    eventPollQueue.broadcast(eventName, data);
  } catch (error) {
    logger.warn(`Realtime emit error: ${eventName}`, { error: error.message });
  }
}

module.exports = { init, emit };
