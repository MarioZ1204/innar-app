// migrate-password-sha512.js
// Script para migrar contraseñas antiguas de bcrypt(texto_plano) a bcrypt(SHA512)

const db = require('./db-mysql');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

async function migratePasswords() {
  try {
    console.log('🔄 Iniciando migración de contraseñas...\n');

    // Inicializar pool de base de datos
    const pool = await db.initPool();
    if (!pool) throw new Error('No se pudo conectar a la base de datos');

    // Obtener todos los usuarios
    const usuarios = await db.query('SELECT id, usuario FROM usuarios');
    
    if (usuarios.length === 0) {
      console.log('❌ No hay usuarios para migrar');
      process.exit(0);
    }

    console.log(`📋 Encontrados ${usuarios.length} usuario(s)\n`);

    // Para migrar, necesitaremos las contraseñas en texto plano
    // Como no las tenemos, crearemos contraseñas temporales hasheadas con el nuevo esquema

    console.log('⚠️  IMPORTANTE: Como no tenemos las contraseñas en texto plano, se crearán contraseñas temporales');
    console.log('    Cada usuario deberá cambiar su contraseña en el próximo login.\n');

    let migrados = 0;
    let errores = 0;

    for (const user of usuarios) {
      try {
        // Generar contraseña temporal
        const passwordTemporal = Math.random().toString(36).substring(2, 15) + 
                                Math.random().toString(36).substring(2, 15);
        
        // Hashear con SHA512 (como lo hace el cliente)
        const sha512Hash = crypto.createHash('sha512').update(passwordTemporal).digest('hex');
        
        // Hashear con bcrypt
        const bcryptHash = bcrypt.hashSync(sha512Hash, 10);

        // Actualizar en BD
        await db.execute(
          'UPDATE usuarios SET password_hash = ? WHERE id = ?',
          [bcryptHash, user.id]
        );

        console.log(`✅ Usuario "${user.usuario}" migrado correctamente`);
        migrados++;
      } catch (e) {
        console.error(`❌ Error migrando usuario "${user.usuario}":`, e.message);
        errores++;
      }
    }

    console.log(`\n📊 Resultado:`);
    console.log(`   ✅ Migrados: ${migrados}`);
    console.log(`   ❌ Errores: ${errores}`);
    console.log(`\n⚠️  Los usuarios deberán usar "Recuperar contraseña" o contactar al administrador`);
    
    process.exit(0);
  } catch (e) {
    console.error('❌ Error fatal:', e.message);
    process.exit(1);
  }
}

migratePasswords();
