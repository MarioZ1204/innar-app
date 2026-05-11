(function () {
  if (typeof window.io === 'function') return;

  // Fallback de emergencia:
  // Si /socket.io/socket.io.js falla por proxy (404), evitamos que la app se caiga
  // por "io is not defined". Este stub mantiene la app funcional sin tiempo real.
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

  window.io = function () {
    console.warn('[SOCKET] /socket.io/socket.io.js no disponible. Ejecutando en modo fallback sin tiempo real.');
    return createSocketStub();
  };
})();
