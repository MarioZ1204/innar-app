#!/usr/bin/env node
/**
 * diagnose-socketio.js
 * Verifica que Socket.IO esté correctamente montado y accesible
 */

const http = require('http');
const socketIo = require('socket.io');

const PORT = process.env.PORT || 3000;

// Crea un servidor HTTP simple
const app = require('express')();
const httpServer = http.createServer(app);

// Monta Socket.IO exactamente como en socket/handlers.js
const io = socketIo(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    methods: ['GET', 'POST'],
    credentials: true
  },
  transports: ['polling'],
  allowUpgrades: false,
  pingInterval: 30000,
  pingTimeout: 60000,
  serveClient: true  // ← IMPORTANTE: esto sirve el cliente en /socket.io/socket.io.js
});

// Middleware de diagnóstico
app.get('/diagnose', (req, res) => {
  res.json({
    socketio: {
      mounted: !!io,
      path: '/socket.io/',
      transports: ['polling'],
      serveClient: true,
      cors: {
        origin: process.env.FRONTEND_URL || 'http://localhost:3000'
      }
    },
    server: {
      port: PORT,
      https: false,
      timestamp: new Date().toISOString()
    }
  });
});

app.get('/socket.io/', (req, res) => {
  res.status(200).send('Socket.IO endpoint is available');
});

io.on('connection', (socket) => {
  console.log('✓ Cliente conectado:', socket.id);
  socket.emit('test', { message: 'Hello from server' });
});

httpServer.listen(PORT, () => {
  console.log(`\n✓ Servidor de diagnóstico en http://localhost:${PORT}`);
  console.log(`  - GET /diagnose → JSON con estado de Socket.IO`);
  console.log(`  - GET /socket.io/ → Verifica disponibilidad`);
  console.log(`  - Socket.IO listening en /socket.io/ con transports: ['polling']\n`);
});
