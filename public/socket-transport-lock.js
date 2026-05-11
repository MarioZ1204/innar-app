// Fija opciones Socket.IO antes de socket-client.js (evita cliente cacheado con opciones rotas).
// Hosting compartido: polling primero (HTTP normal hacia Node); websocket si el proxy permite upgrade.
'use strict';
window.INNAR_SOCKET_BASE = Object.assign(
  {
    path: '/socket.io/',
    transports: ['polling', 'websocket'],
    withCredentials: true,
    upgrade: true,
    rememberUpgrade: true
  },
  typeof window.INNAR_SOCKET_BASE === 'object' && window.INNAR_SOCKET_BASE !== null ? window.INNAR_SOCKET_BASE : {}
);
