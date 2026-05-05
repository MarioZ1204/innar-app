// Singleton para emitir eventos Socket.IO desde cualquier módulo sin imports circulares
const logger = require('./logger');

let _io = null;

function init(io) {
  _io = io;
}

function emit(eventName, data) {
  try {
    if (_io) {
      _io.emit(eventName, data);
    }
  } catch (error) {
    logger.warn(`Socket.IO emit error: ${eventName}`, { error: error.message });
  }
}

module.exports = { init, emit };
