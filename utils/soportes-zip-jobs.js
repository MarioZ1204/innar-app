/**
 * Jobs en segundo plano para ZIP paquete de mes (evita timeout 504 del proxy).
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const archiver = require('archiver');
const {
  zipArchiveSegment,
  queryDiasFacturacionZip,
  collectDiaZipEntries,
  collectPeriodUnifiedEntries,
  appendInnerZipToArchive,
  safeSyncRipsPeriodo
} = require('./soportes-armado-zip');

const ZIP_COMPRESSION = 6;
const JOB_TTL_MS = 2 * 60 * 60 * 1000;
const JOB_DIR = path.join(os.tmpdir(), 'innar-sop-zip-jobs');
const jobs = new Map();

if (!fs.existsSync(JOB_DIR)) fs.mkdirSync(JOB_DIR, { recursive: true });

function cleanupOldJobs() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.createdAt > JOB_TTL_MS) {
      if (job.filePath && fs.existsSync(job.filePath)) {
        try { fs.unlinkSync(job.filePath); } catch (_) { /* ignore */ }
      }
      jobs.delete(id);
    }
  }
}

async function runPeriodPaqueteJob(job, periodo) {
  const periodoId = periodo.id;
  const zipLabel = zipArchiveSegment(periodo.etiqueta || periodo.periodo || `periodo-${periodoId}`);
  const outPath = path.join(JOB_DIR, `${job.id}.zip`);
  job.filePath = outPath;

  try {
    void safeSyncRipsPeriodo(periodoId);
    const dias = await queryDiasFacturacionZip(periodoId);
    if (!dias.length) throw new Error('El mes no tiene carpetas de facturación');

    const totalSteps = Math.max(dias.length + 1, 1);
    let step = 0;

    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(outPath);
      const archive = archiver('zip', { zlib: { level: ZIP_COMPRESSION } });
      let partsAdded = 0;

      archive.on('error', reject);
      output.on('error', reject);
      output.on('close', () => {
        if (!partsAdded) reject(new Error('No hay archivos para descargar en este mes'));
        else resolve();
      });
      archive.pipe(output);

      (async () => {
        try {
          for (const dia of dias) {
            step += 1;
            job.message = `Empaquetando ${dia.nombre_display || 'carpeta'}…`;
            job.progress = Math.min(90, Math.round((step / totalSteps) * 90));
            const entries = await collectDiaZipEntries(dia.id);
            const diaSeg = zipArchiveSegment(dia.nombre_display || `dia-${dia.id}`);
            const added = await appendInnerZipToArchive(archive, `${diaSeg}.zip`, entries);
            if (added) partsAdded++;
          }
          job.message = 'Generando ZIP unificado…';
          job.progress = 95;
          const unifiedEntries = await collectPeriodUnifiedEntries(periodoId);
          if (unifiedEntries.length) {
            const addedUni = await appendInnerZipToArchive(archive, `${zipLabel}-unificado.zip`, unifiedEntries);
            if (addedUni) partsAdded++;
          }
          archive.finalize();
        } catch (e) {
          reject(e);
        }
      })();
    });

    job.status = 'ready';
    job.progress = 100;
    job.message = 'Listo para descargar';
  } catch (e) {
    job.status = 'error';
    job.error = e.message || 'Error al generar ZIP';
    job.progress = 0;
    if (job.filePath && fs.existsSync(job.filePath)) {
      try { fs.unlinkSync(job.filePath); } catch (_) { /* ignore */ }
    }
    job.filePath = null;
  }
}

function createPeriodPaqueteJob(periodo, usuarioId = null) {
  cleanupOldJobs();
  const id = crypto.randomBytes(12).toString('hex');
  const job = {
    id,
    periodoId: periodo.id,
    usuarioId,
    status: 'pending',
    progress: 0,
    message: 'Iniciando generación…',
    error: null,
    filePath: null,
    filename: `${zipArchiveSegment(periodo.etiqueta || periodo.periodo || `periodo-${periodo.id}`)}-paquete.zip`,
    createdAt: Date.now()
  };
  jobs.set(id, job);
  void runPeriodPaqueteJob(job, periodo);
  return job;
}

function getJob(jobId) {
  cleanupOldJobs();
  return jobs.get(jobId) || null;
}

module.exports = {
  createPeriodPaqueteJob,
  getJob,
  JOB_TTL_MS
};
