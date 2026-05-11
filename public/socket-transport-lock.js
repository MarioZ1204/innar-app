// Fija opciones Socket.IO antes de socket-client.js (evita cliente cacheado con opciones rotas).
// Hosting compartido / Passenger: sólo long-polling (sin upgrade WebSocket).
'use strict';
window.INNAR_SOCKET_BASE = Object.assign(
  {
    path: '/socket.io/',
    transports: ['polling'],
    withCredentials: true,
    upgrade: false,
    rememberUpgrade: false
  },
  typeof window.INNAR_SOCKET_BASE === 'object' && window.INNAR_SOCKET_BASE !== null ? window.INNAR_SOCKET_BASE : {}
);
