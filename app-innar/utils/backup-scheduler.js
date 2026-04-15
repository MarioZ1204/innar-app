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
  log.info('[BACKUP] Programador de backups iniciado', { type: 'BACKUP' });

  // Backup diario a las 2 AM
  const job = schedule.scheduleJob('0 2 * * *', async () => {
    log.info('[BACKUP] Ejecutando backup automatico diario', { type: 'BACKUP' });
    try {
      await createBackup();
      log.info('[OK] Backup automático completado exitosamente', { type: 'BACKUP' });
    } catch (error) {
      log.error('[BACKUP] Error en backup automatico diario', { error: error.message, type: 'BACKUP' });
    }
  });

  // Schedules adicionales (opcional)
  // Backup cada 6 horas
  const job6h = schedule.scheduleJob('0 */6 * * *', async () => {
    log.info('[BACKUP] Ejecutando backup automatico (6h)', { type: 'BACKUP' });
    try {
      await createBackup();
    } catch (error) {
      log.error('[BACKUP] Error en backup cada 6h', { error: error.message, type: 'BACKUP' });
    }
  });

  log.info('[BACKUP] Activo: diario 2:00 AM, cada 6h (0:00, 6:00, 12:00, 18:00)', { type: 'BACKUP' });

  return { job, job6h };
}

/**
 * Detener scheduler
 */
function stopBackupScheduler(jobs) {
  if (jobs) {
    jobs.job.cancel();
    jobs.job6h.cancel();
    log.info('[BACKUP] Programador de backups detenido', { type: 'BACKUP' });
  }
}

// Exportar para iniciar desde server.js
module.exports = {
  startBackupScheduler,
  stopBackupScheduler
};
