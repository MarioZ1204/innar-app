(function () {
  function noop() {}

  function createSocketStub() {
    var handlers = {};
    return {
      connected: false,
      id: null,
      io: { engine: { transport: { name: 'fallback' } } },
      on: function (event, cb) {
        handlers[event] = cb;
        return this;
      },
      emit: noop,
      connect: function () {
        this.connected = false;
        return this;
      },
      disconnect: noop
    };
  }

  function installStub() {
    if (typeof window.io === 'function') return;
    window.io = function () {
      console.warn(
        '[SOCKET] Sin cliente Socket.IO (timeout). Modo degradado sin tiempo real.'
      );
      return createSocketStub();
    };
  }

  // Dar tiempo a socket-path-bootstrap.js (fetch + carga asíncrona del script real).
  setTimeout(installStub, 8000);
})();
