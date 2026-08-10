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

function emitToUser(usuarioId, eventName, data) {
  try {
    eventPollQueue.enqueueToUser(usuarioId, eventName, data);
  } catch (error) {
    logger.warn(`Realtime emitToUser error: ${eventName}`, { error: error.message, usuarioId });
  }
}

module.exports = { init, emit, emitToUser };
