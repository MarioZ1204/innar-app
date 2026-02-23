// utils/generate-temp-passwords.js
// Script para generar y mostrar contraseñas temporales para todos los usuarios

const db = require('./db-mysql');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

async function generateTempPasswords() {
  try {
    console.log('🔐 Generando contraseñas temporales...\n');

    // Inicializar pool
    await db.initPool();

    // Obtener todos los usuarios
    const usuarios = await db.query('SELECT id, usuario, nombre FROM usuarios');
    
    if (usuarios.length === 0) {
      console.log('❌ No hay usuarios');
      process.exit(0);
    }

    console.log('📋 Usuarios y Contraseñas Temporales:\n');
    console.log('═'.repeat(70));

    const credentials = [];

    for (const user of usuarios) {
      try {
        // Generar contraseña temporal fuerte
        const passwordTemporal = crypto.randomBytes(8).toString('hex');
        
        // Hashear con SHA512 (como lo hace el cliente)
        const sha512Hash = crypto.createHash('sha512').update(passwordTemporal).digest('hex');
        
        // Hashear con bcrypt
        const bcryptHash = bcrypt.hashSync(sha512Hash, 10);

        // Actualizar en BD
        await db.execute(
          'UPDATE usuarios SET password_hash = ? WHERE id = ?',
          [bcryptHash, user.id]
        );

        credentials.push({
          usuario: user.usuario,
          nombre: user.nombre,
          password: passwordTemporal
        });

        console.log(`\n👤 Usuario: ${user.usuario}`);
        console.log(`   Nombre: ${user.nombre}`);
        console.log(`   🔑 Contraseña Temporal: ${passwordTemporal}`);

      } catch (e) {
        console.error(`❌ Error con usuario "${user.usuario}":`, e.message);
      }
    }

    console.log('\n' + '═'.repeat(70));
    console.log('\n📊 Resumen:\n');
    console.log('┌─ CREDENCIALES DE ACCESO TEMPORAL ─┐');
    console.log('│                                   │');
    credentials.forEach((cred, idx) => {
      console.log(`│ ${idx + 1}. Usuario: ${cred.usuario.padEnd(20)}'│`);
      console.log(`│    Contraseña: ${cred.password.padEnd(18)}'│`);
      console.log(`│                                   │`);
    });
    console.log('└───────────────────────────────────┘');

    console.log('\n⚠️  IMPORTANTE:');
    console.log('  • Estas contraseñas son TEMPORALES');
    console.log('  • Cada usuario DEBE cambiarlas al primer login');
    console.log('  • Guarda este list en un lugar seguro');
    console.log('  • Elimina este archivo después de compartir\n');

    process.exit(0);
  } catch (e) {
    console.error('❌ Error fatal:', e.message);
    process.exit(1);
  }
}

generateTempPasswords();
