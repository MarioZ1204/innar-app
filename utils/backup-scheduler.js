#!/usr/bin/env node
// utils/backup-scheduler.js
// Programador de backups automáticos.
//
// Estrategia (configurable por env):
//   BACKUP_DAILY_CRON  - cron para backup principal (default: "0 2 * * *", 2 AM)
//   BACKUP_INTRA_CRON  - cron para backup intra-día opcional (default: vacío = deshabilitado)
//
// Antes ejecutábamos un backup diario + uno cada 6h, lo que generaba ~5 archivos/día
// sin valor adicional. Ahora un único backup diario por defecto; intra-día opt-in.

const schedule = require('node-schedule');
const { createBackup } = require('./backup');
const { createFullBackup } = require('./backup-full');
const log = require('./logger.js');

function startBackupScheduler() {
  const dailyCron = process.env.BACKUP_DAILY_CRON || '0 2 * * *';
  const intraCron = process.env.BACKUP_INTRA_CRON || '';

  log.info('[BACKUP] Programador de backups iniciado', { type: 'BACKUP' });

  const job = schedule.scheduleJob(dailyCron, async () => {
    log.info('[BACKUP] Ejecutando backup automatico diario', { type: 'BACKUP' });
    try {
      await createBackup();
      log.info('[OK] Backup automático completado exitosamente', { type: 'BACKUP' });
    } catch (error) {
      log.error('[BACKUP] Error en backup automatico diario', { error: error.message, type: 'BACKUP' });
    }
  });

  let intraJob = null;
  if (intraCron) {
    intraJob = schedule.scheduleJob(intraCron, async () => {
      log.info('[BACKUP] Ejecutando backup intra-día', { type: 'BACKUP', cron: intraCron });
      try {
        await createBackup();
      } catch (error) {
        log.error('[BACKUP] Error en backup intra-día', { error: error.message, type: 'BACKUP' });
      }
    });
  }

  const monthlyCron = process.env.BACKUP_MONTHLY_CRON || '0 3 1 * *';
  const monthlyJob = schedule.scheduleJob(monthlyCron, async () => {
    log.info('[BACKUP] Ejecutando backup completo mensual (BD + archivos)', { type: 'BACKUP' });
    try {
      const result = await createFullBackup({
        triggeredBy: 'programador',
        label: 'Backup mensual automático'
      });
      log.info('[OK] Backup completo mensual', {
        type: 'BACKUP',
        filename: result.filename,
        size: result.size_bytes
      });
    } catch (error) {
      log.error('[BACKUP] Error backup completo mensual', { error: error.message, type: 'BACKUP' });
    }
  });

  log.info(
    `[BACKUP] Activo: diario SQL "${dailyCron}"${intraCron ? `, intra-día "${intraCron}"` : ''}, completo mensual "${monthlyCron}"`,
    { type: 'BACKUP' }
  );

  return { job, intraJob, monthlyJob };
}

function stopBackupScheduler(jobs) {
  if (jobs) {
    if (jobs.job) jobs.job.cancel();
    if (jobs.intraJob) jobs.intraJob.cancel();
    if (jobs.monthlyJob) jobs.monthlyJob.cancel();
    log.info('[BACKUP] Programador de backups detenido', { type: 'BACKUP' });
  }
}

module.exports = {
  startBackupScheduler,
  stopBackupScheduler
};
