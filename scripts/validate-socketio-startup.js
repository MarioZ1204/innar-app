#!/usr/bin/env node
/**
 * scripts/validate-socketio-startup.js
 * Valida que Socket.IO esté correctamente configurado ANTES de iniciar el servidor
 * Se ejecuta como primer paso del startup
 */

const path = require('path');
const fs = require('fs');

console.log('\n🔍 Validando configuración Socket.IO...\n');

const checks = {
  socketio_installed: false,
  socket_handlers_exists: false,
  socket_emitter_exists: false,
  frontend_url_env: false,
  node_env: false,
  htaccess_configured: false
};

// 1. ¿Está socket.io instalado?
try {
  require.resolve('socket.io');
  checks.socketio_installed = true;
  console.log('✓ socket.io está instalado');
} catch (e) {
  console.error('✗ socket.io NO está instalado. Ejecuta: npm install');
}

// 2. ¿Existe socket/handlers.js?
try {
  const handlersPath = path.join(__dirname, '../socket/handlers.js');
  if (fs.existsSync(handlersPath)) {
    checks.socket_handlers_exists = true;
    console.log('✓ socket/handlers.js existe');
  }
} catch (e) {
  console.error('✗ socket/handlers.js no encontrado');
}

// 3. ¿Existe utils/socket-emitter.js?
try {
  const emitterPath = path.join(__dirname, '../utils/socket-emitter.js');
  if (fs.existsSync(emitterPath)) {
    checks.socket_emitter_exists = true;
    console.log('✓ utils/socket-emitter.js existe');
  }
} catch (e) {
  console.error('✗ utils/socket-emitter.js no encontrado');
}

// 4. ¿FRONTEND_URL está configurado?
if (process.env.FRONTEND_URL) {
  checks.frontend_url_env = true;
  console.log(`✓ FRONTEND_URL=${process.env.FRONTEND_URL}`);
} else {
  console.warn('⚠ FRONTEND_URL no configurado. Usando default: http://localhost:3000');
}

// 5. ¿NODE_ENV está configurado?
if (process.env.NODE_ENV) {
  checks.node_env = true;
  console.log(`✓ NODE_ENV=${process.env.NODE_ENV}`);
} else {
  console.warn('⚠ NODE_ENV no configurado. Usando default: development');
}

// 6. ¿.htaccess está configurado?
try {
  const htaccessPath = path.join(__dirname, '../.htaccess');
  const htaccessContent = fs.readFileSync(htaccessPath, 'utf8');
  if (htaccessContent.includes('/socket.io/')) {
    checks.htaccess_configured = true;
    console.log('✓ .htaccess tiene reglas de proxy para Socket.IO');
  } else {
    console.warn('⚠ .htaccess NO tiene reglas de proxy para Socket.IO');
  }
} catch (e) {
  console.warn('⚠ .htaccess no encontrado (ok si estás en local)');
}

console.log('');

const allOk = Object.values(checks).filter(v => v === true).length >= 4;
if (allOk) {
  console.log('✅ Socket.IO está correctamente configurado. Iniciando servidor...\n');
  process.exit(0);
} else {
  console.log('❌ Socket.IO NO está completamente configurado. Revisa los errores arriba.\n');
  process.exit(1);
}
