#!/usr/bin/env node
/**
 * INICIALIZACIÓN DE LA APLICACIÓN DE RECIBOS
 * 
 * Este script verifica que todo esté configurado correctamente
 */

const fs = require('fs');
const path = require('path');

console.log('\n📋 === VERIFICACIÓN DE APLICACIÓN DE RECIBOS ===\n');

// Verificar archivos críticos
const archivosRequeridos = [
  'package.json',
  'server.js',
  'public/index.html',
  'public/app.js',
  'public/style.css'
];

let todoOk = true;

console.log('🔍 Verificando archivos...\n');
archivosRequeridos.forEach(archivo => {
  const ruta = path.join(__dirname, archivo);
  if (fs.existsSync(ruta)) {
    console.log(`✅ ${archivo}`);
  } else {
    console.log(`❌ ${archivo} - FALTA`);
    todoOk = false;
  }
});

// Verificar que Node.js versión sea compatible
const nodeVersion = process.version;
const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
console.log(`\n📦 Node.js ${nodeVersion} (Requerido: 16+)`);
if (majorVersion >= 16) {
  console.log('✅ Versión compatible');
} else {
  console.log('❌ Versión no compatible');
  todoOk = false;
}

// Verificar node_modules
console.log(`\n📚 Verificando dependencias...`);
const nodeModulesPath = path.join(__dirname, 'node_modules');
if (fs.existsSync(nodeModulesPath)) {
  console.log('✅ node_modules instalado');
} else {
  console.log('⚠️  node_modules NO instalado');
  console.log('   Ejecuta: npm install');
  todoOk = false;
}

// Resultado final
console.log('\n' + '='.repeat(45));
if (todoOk) {
  console.log('\n✅ TODO LISTO PARA INICIAR\n');
  console.log('Inicia la aplicación con:\n');
  console.log('  npm start\n');
  console.log('Luego abre: http://localhost:3000\n');
} else {
  console.log('\n⚠️  HAY PROBLEMAS QUE RESOLVER\n');
  console.log('Ejecuta: npm install\n');
}
console.log('='.repeat(45) + '\n');
