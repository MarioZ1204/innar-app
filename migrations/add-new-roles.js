// migrations/add-new-roles.js
// Migración para añadir nuevos roles de usuario
// Ejecutar: node migrations/add-new-roles.js

require('dotenv').config();
const mysql = require('mysql2/promise');

async function migrate() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'innar_clinica'
  });

  console.log('🔄 Iniciando migración de roles de usuario...');

  try {
    // 1. Ampliar el ENUM de roles incluyendo los nuevos
    await conn.execute(`
      ALTER TABLE usuarios
      MODIFY COLUMN rol ENUM(
        'doctor',
        'recepcion',
        'admin',
        'electro',
        'contabilidad',
        'superadmin',
        'admin_recepcion',
        'admin_electro',
        'tecnico_electro',
        'auxiliar_recepcion'
      ) NOT NULL DEFAULT 'auxiliar_recepcion'
    `);
    console.log('✓ ENUM de roles ampliado');

    // 2. Migrar usuarios existentes a los nuevos roles
    const [r1] = await conn.execute(
      "UPDATE usuarios SET rol = 'superadmin' WHERE rol = 'admin'"
    );
    console.log(`✓ ${r1.affectedRows} usuario(s) admin → superadmin`);

    const [r2] = await conn.execute(
      "UPDATE usuarios SET rol = 'admin_recepcion' WHERE rol = 'recepcion'"
    );
    console.log(`✓ ${r2.affectedRows} usuario(s) recepcion → admin_recepcion`);

    const [r3] = await conn.execute(
      "UPDATE usuarios SET rol = 'admin_electro' WHERE rol = 'electro'"
    );
    console.log(`✓ ${r3.affectedRows} usuario(s) electro → admin_electro`);

    console.log('\n✅ Migración completada exitosamente');
    console.log('\n📋 Nuevos roles disponibles:');
    console.log('  • superadmin       → Super Administrador (acceso total)');
    console.log('  • admin_recepcion  → Administrador de Recepción');
    console.log('  • admin_electro    → Administrador de Electrodiagnóstico');
    console.log('  • tecnico_electro  → Técnico de Electrodiagnóstico');
    console.log('  • auxiliar_recepcion → Auxiliar de Recepción');
    console.log('  • doctor           → Doctor (sin cambios)');
    console.log('  • contabilidad     → Contabilidad (sin cambios)');

  } catch (e) {
    console.error('❌ Error en migración:', e.message);
    throw e;
  } finally {
    await conn.end();
  }
}

if (require.main === module) {
  migrate().then(() => process.exit(0)).catch(() => process.exit(1));
}

module.exports = { migrate };
