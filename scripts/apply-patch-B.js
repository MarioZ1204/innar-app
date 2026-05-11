#!/usr/bin/env node
// scripts/apply-patch-B.js
// Aplicador seguro de scripts/patch-B-db-integrity.sql en bloques verificables.
//
// Uso:
//   node scripts/apply-patch-B.js preflight           - solo verifica (read-only)
//   node scripts/apply-patch-B.js apply --section 1   - aplica solo sección N
//   node scripts/apply-patch-B.js apply --all         - todas las secciones (pide backup previo)
//
// REQUIERE backup previo. Antes de --all el script verifica que exista un
// backup en BACKUP_DIR creado en las últimas 2 horas.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const db = require('../utils/db-mysql');

const BACKUP_DIR = process.env.BACKUP_DIR
  ? path.resolve(process.env.BACKUP_DIR)
  : path.join(__dirname, '..', 'backups');

const SECTIONS = [
  {
    id: 1,
    name: 'Diagnósticos: Ñ corrupta',
    preCount: "SELECT COUNT(*) AS c FROM diagnosticos WHERE nombre LIKE '%—%'",
    statements: [
      "UPDATE diagnosticos SET nombre = REPLACE(nombre, '—', 'Ñ') WHERE nombre LIKE '%—%'"
    ]
  },
  {
    id: 2,
    name: 'Turnos zombi',
    preCount: "SELECT COUNT(*) AS c FROM turnos WHERE estado IN ('EN_SALA','EN_ATENCION') AND fecha < DATE_SUB(CURDATE(), INTERVAL 30 DAY)",
    statements: [
      "UPDATE turnos SET estado = 'COMPLETADO' WHERE estado IN ('EN_SALA','EN_ATENCION') AND fecha < DATE_SUB(CURDATE(), INTERVAL 30 DAY)"
    ]
  },
  {
    id: 3,
    name: 'Citas electro: Programado sin equipo (>14 días)',
    preCount: "SELECT COUNT(*) AS c FROM citas_electro WHERE estado='Programado' AND equipo_id IS NULL AND fecha < DATE_SUB(CURDATE(), INTERVAL 14 DAY) AND deleted_at IS NULL",
    statements: [
      "UPDATE citas_electro SET estado='Cancelado' WHERE estado='Programado' AND equipo_id IS NULL AND fecha < DATE_SUB(CURDATE(), INTERVAL 14 DAY) AND deleted_at IS NULL"
    ]
  },
  {
    id: 4,
    name: 'Citas electro: hora_fin_date nocturno',
    preCount: "SELECT COUNT(*) AS c FROM citas_electro WHERE hora_inicio IS NOT NULL AND hora_fin IS NOT NULL AND hora_fin < hora_inicio AND hora_fin_date = fecha AND deleted_at IS NULL",
    statements: [
      "UPDATE citas_electro SET hora_fin_date = DATE_ADD(fecha, INTERVAL 1 DAY) WHERE hora_inicio IS NOT NULL AND hora_fin IS NOT NULL AND hora_fin < hora_inicio AND hora_fin_date = fecha AND deleted_at IS NULL"
    ]
  },
  {
    id: 5,
    name: 'dias_bloqueados: UNIQUE (fecha, doctor_id)',
    idempotent: true,
    statements: [
      "ALTER TABLE dias_bloqueados DROP INDEX IF EXISTS `fecha`",
      "ALTER TABLE dias_bloqueados ADD UNIQUE KEY IF NOT EXISTS `unique_fecha_doctor` (`fecha`, `doctor_id`)"
    ]
  },
  {
    id: 7,
    name: 'pacientes: dedupe por documento + UNIQUE',
    idempotent: false,
    extraCheck: async () => {
      // Antes de borrar duplicados, asegúrate de que NINGUNA otra tabla además
      // de citas_electro referencia a `pacientes.id` (en cuyo caso habría que
      // ampliar el patch).
      const rows = await db.query(`
        SELECT TABLE_NAME, COLUMN_NAME
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE table_schema = DATABASE()
          AND referenced_table_name = 'pacientes'
      `);
      const desconocidas = rows.filter(r => r.TABLE_NAME !== 'citas_electro');
      if (desconocidas.length > 0) {
        throw new Error(
          'Se detectaron FKs adicionales a pacientes desde tablas no contempladas: '
          + desconocidas.map(r => `${r.TABLE_NAME}.${r.COLUMN_NAME}`).join(', ')
          + '. Amplíe el patch antes de continuar.'
        );
      }
    },
    statements: [
      // Redirigir citas_electro al canónico
      `UPDATE citas_electro ce
       INNER JOIN pacientes p ON ce.paciente_id = p.id
       INNER JOIN (
         SELECT documento, MIN(id) AS canonical_id
         FROM pacientes
         WHERE documento IS NOT NULL AND documento <> ''
         GROUP BY documento
         HAVING COUNT(*) > 1
       ) dup ON p.documento = dup.documento AND p.id <> dup.canonical_id
       SET ce.paciente_id = dup.canonical_id`,
      // Eliminar duplicados
      `DELETE p FROM pacientes p
       INNER JOIN (
         SELECT documento, MIN(id) AS canonical_id
         FROM pacientes
         WHERE documento IS NOT NULL AND documento <> ''
         GROUP BY documento
         HAVING COUNT(*) > 1
       ) dup ON p.documento = dup.documento AND p.id <> dup.canonical_id`,
      // UNIQUE
      "ALTER TABLE pacientes ADD UNIQUE KEY IF NOT EXISTS `uk_documento` (`documento`)"
    ]
  },
  {
    id: 8,
    name: 'recibos: anular huérfanos y agregar FKs',
    idempotent: true,
    statements: [
      "UPDATE recibos SET turno_id = NULL WHERE turno_id IS NOT NULL AND turno_id NOT IN (SELECT id FROM turnos)",
      "UPDATE recibos SET cita_electro_id = NULL WHERE cita_electro_id IS NOT NULL AND cita_electro_id NOT IN (SELECT id FROM citas_electro)",
      "UPDATE recibos SET medico_id = NULL WHERE medico_id IS NOT NULL AND medico_id NOT IN (SELECT id FROM usuarios)",
      "UPDATE recibos SET generado_por_id = NULL WHERE generado_por_id IS NOT NULL AND generado_por_id NOT IN (SELECT id FROM usuarios)",
      "UPDATE recibos SET anulado_por_id = NULL WHERE anulado_por_id IS NOT NULL AND anulado_por_id NOT IN (SELECT id FROM usuarios)",
      "UPDATE recibos SET pagado_por_id = NULL WHERE pagado_por_id IS NOT NULL AND pagado_por_id NOT IN (SELECT id FROM usuarios)"
      // Las FKs se aplican en una migración formal (ver migrations/db-migrations.js)
      // para mantener un único punto de verdad.
    ]
  }
];

function ask(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); });
  });
}

function getMostRecentBackupAgeMinutes() {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('backup-') && f.endsWith('.sql'))
      .map(f => ({ f, mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    if (!files.length) return Infinity;
    return Math.floor((Date.now() - files[0].mtime) / 60000);
  } catch (_) { return Infinity; }
}

async function runSection(section) {
  console.log(`\n▶ Sección ${section.id}: ${section.name}`);

  if (section.extraCheck) {
    try {
      await section.extraCheck();
    } catch (e) {
      console.error(`  ✗ Bloqueo: ${e.message}`);
      throw e;
    }
  }

  if (section.preCount) {
    const rows = await db.query(section.preCount);
    const c = rows[0]?.c || 0;
    console.log(`  • Filas afectadas estimadas: ${c}`);
    if (c === 0 && !section.idempotent) {
      console.log('  ✓ No hay nada que hacer, omitiendo.');
      return { skipped: true };
    }
  }

  for (const sql of section.statements) {
    console.log(`  → ${sql.slice(0, 80)}...`);
    try {
      const res = await db.execute(sql);
      console.log(`  ✓ Afectadas: ${res.affectedRows ?? 'n/a'}`);
    } catch (e) {
      console.error(`  ✗ Error: ${e.message}`);
      throw e;
    }
  }
  return { ok: true };
}

async function main() {
  const cmd = process.argv[2];

  await db.initPool();

  if (cmd === 'preflight') {
    const sqlPath = path.join(__dirname, 'preflight-patch-B.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    // Ejecutar cada statement separado por `;`
    const statements = sql.split(/;\s*\n/).map(s => s.trim()).filter(s => s && !s.startsWith('--'));
    for (const stmt of statements) {
      try {
        const rows = await db.query(stmt);
        console.log(JSON.stringify(rows, null, 2));
      } catch (e) {
        console.error(`  ✗ ${e.message}`);
      }
    }
    await db.closePool();
    return;
  }

  if (cmd !== 'apply') {
    console.error('Uso: node scripts/apply-patch-B.js [preflight|apply --section N|apply --all]');
    process.exit(1);
  }

  const sectionFlag = process.argv.indexOf('--section');
  const targetSection = sectionFlag !== -1 ? parseInt(process.argv[sectionFlag + 1], 10) : null;
  const all = process.argv.includes('--all');

  if (all) {
    const ageMin = getMostRecentBackupAgeMinutes();
    if (ageMin > 120) {
      console.error(`No hay un backup reciente (último: ${ageMin === Infinity ? 'ninguno' : ageMin + ' min'}).`);
      console.error('Ejecuta `node utils/backup.js` antes de continuar.');
      process.exit(2);
    }
    console.log(`✓ Backup más reciente: hace ${ageMin} min`);
    const confirm = await ask('Esto modifica datos en PRODUCCIÓN. Escribe "APLICAR" para continuar: ');
    if (confirm !== 'APLICAR') {
      console.log('Cancelado.');
      await db.closePool();
      return;
    }
    for (const section of SECTIONS) {
      try {
        await runSection(section);
      } catch (e) {
        console.error(`Detenido en sección ${section.id}. Revisa el error y reanuda con --section ${section.id}`);
        await db.closePool();
        process.exit(3);
      }
    }
  } else if (targetSection != null) {
    const section = SECTIONS.find(s => s.id === targetSection);
    if (!section) {
      console.error(`Sección desconocida: ${targetSection}`);
      process.exit(1);
    }
    const confirm = await ask(`¿Aplicar sección ${section.id} (${section.name})? Escribe "SI": `);
    if (confirm !== 'SI') { console.log('Cancelado.'); await db.closePool(); return; }
    await runSection(section);
  }

  await db.closePool();
  console.log('\n✓ Listo.');
}

if (require.main === module) {
  main().catch(err => {
    console.error('Error fatal:', err.message);
    process.exit(1);
  });
}

module.exports = { SECTIONS };
