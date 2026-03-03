#!/usr/bin/env node
// utils/backup-scheduler.js
// Programador de backups automáticos
// Crea un backup cada día a las 2 AM
// Uso: node utils/backup-scheduler.js

const schedule = require('node-schedule');
const { createBackup } = require('./backup');
const log = require('./logger.js');

/**
 * Programar backups automáticos
 * Expresión cron: "0 2 * * *" = cada día a las 2 AM
 */
function startBackupScheduler() {
  console.log('⏰ Iniciando programador de backups automáticos...\n');

  // Backup diario a las 2 AM
  const job = schedule.scheduleJob('0 2 * * *', async () => {
    console.log(`\n📅 [${new Date().toLocaleString()}] Ejecutando backup automático...`);
    try {
      await createBackup();
      log.info('[OK] Backup automático completado exitosamente', { type: 'BACKUP' });
    } catch (error) {
      console.error('❌ Error en backup automático:', error.message);
      log.error('❌ Falló backup automático', { error: error.message, type: 'BACKUP' });
    }
  });

  // Schedules adicionales (opcional)
  // Backup cada 6 horas
  const job6h = schedule.scheduleJob('0 */6 * * *', async () => {
    console.log(`\n📅 [${new Date().toLocaleString()}] Ejecutando backup cada 6 horas...`);
    try {
      await createBackup();
    } catch (error) {
      console.error('❌ Error en backup cada 6h:', error.message);
    }
  });

  console.log('[OK] Programador iniciado:');
  console.log('   - Backup diario: 2:00 AM');
  console.log('   - Backup cada 6h: 0:00, 6:00, 12:00, 18:00');
  console.log('   - Última 7 días mantenidos en carpeta backups/\n');

  return { job, job6h };
}

/**
 * Detener scheduler
 */
function stopBackupScheduler(jobs) {
  if (jobs) {
    jobs.job.cancel();
    jobs.job6h.cancel();
    console.log('⏹️ Programador de backups detenido');
  }
}

// Exportar para iniciar desde server.js
module.exports = {
  startBackupScheduler,
  stopBackupScheduler
};
