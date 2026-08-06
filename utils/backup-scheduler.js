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
const { startBackgroundJob } = require('./background-jobs');
const log = require('./logger.js');

function startBackupScheduler() {
  const dailyCron = process.env.BACKUP_DAILY_CRON || '0 2 * * *';
  const intraCron = process.env.BACKUP_INTRA_CRON || '';

  log.info('[BACKUP] Programador de backups iniciado', { type: 'BACKUP' });

  const job = schedule.scheduleJob(dailyCron, () => {
    log.info('[BACKUP] Ejecutando backup automatico diario (proceso hijo)', { type: 'BACKUP' });
    startBackgroundJob('backup-sql', { triggeredBy: 'programador', label: 'Backup SQL diario' });
  });

  let intraJob = null;
  if (intraCron) {
    intraJob = schedule.scheduleJob(intraCron, () => {
      log.info('[BACKUP] Ejecutando backup intra-día (proceso hijo)', { type: 'BACKUP', cron: intraCron });
      startBackgroundJob('backup-sql', { triggeredBy: 'programador', label: 'Backup intra-día' });
    });
  }

  const monthlyCron = process.env.BACKUP_MONTHLY_CRON || '0 3 1 * *';
  const monthlyJob = schedule.scheduleJob(monthlyCron, () => {
    log.info('[BACKUP] Ejecutando backup completo mensual en proceso hijo', { type: 'BACKUP' });
    startBackgroundJob('backup-full', {
      triggeredBy: 'programador',
      label: 'Backup mensual automático'
    });
  });

  const filesCron = process.env.BACKUP_FILES_CRON || '0 4 * * *';
  const filesJob = schedule.scheduleJob(filesCron, () => {
    log.info('[BACKUP] Ejecutando backup diario de archivos en proceso hijo', { type: 'BACKUP' });
    startBackgroundJob('backup-files', {
      triggeredBy: 'programador',
      label: 'Backup diario de archivos'
    });
  });

  log.info(
    `[BACKUP] Activo: diario SQL "${dailyCron}"${intraCron ? `, intra-día "${intraCron}"` : ''}, diario archivos "${filesCron}", completo mensual "${monthlyCron}"`,
    { type: 'BACKUP' }
  );

  return { job, intraJob, monthlyJob, filesJob };
}

function stopBackupScheduler(jobs) {
  if (jobs) {
    if (jobs.job) jobs.job.cancel();
    if (jobs.intraJob) jobs.intraJob.cancel();
    if (jobs.monthlyJob) jobs.monthlyJob.cancel();
    if (jobs.filesJob) jobs.filesJob.cancel();
    log.info('[BACKUP] Programador de backups detenido', { type: 'BACKUP' });
  }
}

module.exports = {
  startBackupScheduler,
  stopBackupScheduler
};
