/**
 * Carga el cliente Socket.IO desde la misma base path que el servidor (véase GET /api/socket-status).
 * Útil cuando index.html llega desde Apache como estático y no pasa por buildIndexHandler de Node:
 * así no quedamos atrapados en /socket.io/ con 404.
 */
(function () {
  function normalizeBasePath(p) {
    var s = String(p || '/api/socket.io/').trim();
    if (!s.startsWith('/')) s = '/' + s;
    if (!s.endsWith('/')) s += '/';
    return s;
  }

  function loadScript(src, onLoad, onError) {
    var s = document.createElement('script');
    s.async = false;
    s.src = src;
    s.onload = onLoad || function () {};
    s.onerror = onError || function () {};
    (document.head || document.documentElement).appendChild(s);
  }

  var vPart = encodeURIComponent(window.APP_VERSION || '');
  fetch('/api/socket-status', { cache: 'no-store', credentials: 'omit' })
    .then(function (r) {
      return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status));
    })
    .then(function (data) {
      var baseSlash = normalizeBasePath(data && data.socketio && data.socketio.path);
      window.SOCKET_IO_PATH = baseSlash;
      var noTrail = baseSlash.replace(/\/+$/, '');
      var src = noTrail + '/socket.io.js' + (vPart ? '?v=' + vPart : '');
      loadScript(
        src,
        function () {
          if (typeof window.io !== 'function') {
            console.error('[SOCKET-BOOT] script cargado pero window.io sigue indefinido');
          }
          window.dispatchEvent(new CustomEvent('innar:socket-client-ready'));
        },
        function () {
          console.error('[SOCKET-BOOT] Falló la carga de', src);
        }
      );
    })
    .catch(function () {
      window.SOCKET_IO_PATH = normalizeBasePath('/api/socket.io/');
      var src =
        '/api/socket.io/socket.io.js' + (vPart ? '?v=' + vPart : '');
      loadScript(
        src,
        function () {
          window.dispatchEvent(new CustomEvent('innar:socket-client-ready'));
        },
        function () {
          console.error('[SOCKET-BOOT] Fallback de carga falló:', src);
        }
      );
    });
})();
