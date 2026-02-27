#!/usr/bin/env node
// utils/generate-cert.js
// Generar certificado autofirmado para HTTPS (OPCIONAL en desarrollo)

const fs = require('fs');
const path = require('path');

const KEY_FILE = path.join(process.cwd(), 'server.key');
const CERT_FILE = path.join(process.cwd(), 'server.crt');

console.log('\n🔐 GENERADOR DE CERTIFICADO (OPCIONAL)\n');

if (fs.existsSync(KEY_FILE) && fs.existsSync(CERT_FILE)) {
  console.log('✅ Certificados ya existen\n');
  process.exit(0);
}

console.log('⚠️ Para generar certificado en Windows:\n');
console.log('OPCIÓN 1: Instalar OpenSSL (recomendado)');
console.log('   1. Descargar: https://slproweb.com/products/Win32OpenSSL.html');
console.log('   2. Instalar (agregar a PATH)');
console.log('   3. Ejecutar este script nuevamente\n');

console.log('OPCIÓN 2: Usar Git Bash (si tienes Git instalado)');
console.log('   1. Abrir Git Bash');
console.log('   2. Navegar a: cd c:\\xampp\\htdocs\\innar-app\\innar-app');
console.log('   3. Ejecutar:');
console.log('      openssl req -x509 -newkey rsa:2048 \\');
console.log('      -keyout server.key -out server.crt \\');
console.log('      -days 365 -nodes -subj "/CN=localhost"\n');

console.log('OPCIÓN 3: Usar WSL2 (Windows Subsystem for Linux)');
console.log('   1. wsl openssl req -x509 -newkey rsa:2048 \\');
console.log('      -keyout server.key -out server.crt \\');
console.log('      -days 365 -nodes -subj "/CN=localhost"\n');

console.log('⚠️ PARA DESARROLLO: No es necesario HTTPS');
console.log('   npm start  →  http://localhost:3000 (funciona perfecto)\n');

process.exit(1);
