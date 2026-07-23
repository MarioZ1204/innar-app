/**
 * Jobs en segundo plano para ZIP de Armado (evita bloquear el servidor / timeout 504).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db-mysql');
const {
  zipArchiveSegment,
  queryDiasFacturacionZip,
  collectDiaZipEntries,
  collectCarpetaZipEntries,
  collectPeriodUnifiedEntries,
  collectPeriodFacturadosEntries,
  collectContenedorZipEntries,
  collectExpedienteZipEntries,
  appendEntriesToArchive,
  getSopZipWorkDir,
  createArchiverInstance,
  bindArchiveStreamGuards,
  facturaFolderName,
  yieldEventLoop
} = require('./soportes-armado-zip');

const JOB_TTL_MS = 2 * 60 * 60 * 1000;
const jobs = new Map();

function jobDir() {
  return getSopZipWorkDir();
}

function ensureJobDir() {
  const dir = jobDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

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

async function writeZipBatches(job, iterateBatches) {
  ensureJobDir();
  const outPath = path.join(jobDir(), `${job.id}.zip`);
  job.filePath = outPath;
  let filesAdded = 0;

  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outPath);
    const archive = createArchiverInstance();
    bindArchiveStreamGuards(archive, null);
    archive.on('error', reject);
    output.on('error', reject);
    output.on('close', () => {
      if (!filesAdded) reject(new Error(job.emptyError || 'No hay archivos para descargar'));
      else resolve();
    });
    archive.pipe(output);

    (async () => {
      try {
        for await (const batch of iterateBatches(job)) {
          if (batch.message != null) job.message = batch.message;
          if (batch.progress != null) job.progress = batch.progress;
          if (batch.entries?.length) {
            appendEntriesToArchive(archive, batch.entries);
            filesAdded += batch.entries.length;
          }
          await yieldEventLoop();
        }
        job.message = 'Finalizando ZIP…';
        job.progress = Math.max(job.progress || 0, 98);
        archive.finalize();
      } catch (e) {
        try { archive.abort(); } catch (_) { /* ignore */ }
        reject(e);
      }
    })();
  });

  return filesAdded;
}

async function* batchesPeriodoPaquete(job) {
  const dias = await queryDiasFacturacionZip(job.periodoId);
  if (!dias.length) throw new Error('El mes no tiene carpetas de facturación');
  const total = dias.length;
  const usedPaths = new Set();
  let step = 0;
  for (const dia of dias) {
    step += 1;
    const diaSeg = zipArchiveSegment(dia.nombre_display || `dia-${dia.id}`);
    const part = await collectDiaZipEntries(dia.id, null, { repair: false });
    const entries = [];
    for (const e of part) {
      let name = `${diaSeg}/${e.name}`;
      if (usedPaths.has(name)) name = `${diaSeg}/${diaSeg}_${path.basename(e.name)}`;
      usedPaths.add(name);
      entries.push({ ...e, name });
    }
    yield {
      message: `Empaquetando ${dia.nombre_display || 'carpeta'}…`,
      progress: Math.min(95, Math.round((step / total) * 95)),
      entries
    };
  }
}

async function* batchesPeriodoUnificado(job) {
  job.message = 'Recopilando archivos del mes…';
  job.progress = 10;
  const entries = await collectPeriodUnifiedEntries(job.periodoId);
  yield { message: 'Comprimiendo…', progress: 80, entries };
}

async function* batchesPeriodoFacturados(job) {
  job.message = 'Recopilando facturados…';
  job.progress = 15;
  const entries = await collectPeriodFacturadosEntries(job.periodoId);
  if (!entries.length) throw new Error('No hay carpetas FE facturadas con archivos');
  yield { message: 'Comprimiendo…', progress: 85, entries };
}

async function* batchesDia(job) {
  job.message = 'Recopilando archivos del día…';
  job.progress = 20;
  const entries = await collectDiaZipEntries(job.diaId, null, { repair: false });
  if (!entries.length) throw new Error('La carpeta no tiene archivos para descargar');
  yield { message: 'Comprimiendo…', progress: 85, entries };
}

async function* batchesDiaCarpeta(job) {
  job.message = 'Recopilando carpeta y subcarpetas…';
  job.progress = 15;
  const entries = await collectCarpetaZipEntries(job.diaId);
  if (!entries.length) throw new Error('La carpeta no tiene archivos para descargar');
  yield { message: 'Comprimiendo…', progress: 85, entries };
}

async function* batchesContenedor(job) {
  const contRows = await db.query(
    `SELECT c.tipo, d.nombre_display FROM sop_contenedores c JOIN sop_dias d ON d.id = c.dia_id WHERE c.id = ?`,
    [job.contenedorId]
  );
  const cont = contRows[0];
  if (!cont) throw new Error('Contenedor no encontrado');
  const label = cont.tipo === 'rips' ? 'RIPS' : 'SOPORTES';
  job.message = `Recopilando ${label}…`;
  job.progress = 20;
  let entries = await collectContenedorZipEntries(job.contenedorId);
  if (!entries.length && cont.tipo === 'rips') {
    const exps = await db.query('SELECT codigo, numero_factura, id FROM sop_expedientes WHERE contenedor_id = ?', [job.contenedorId]);
    entries = exps.map((exp) => ({
      placeholder: true,
      name: `RIPS/${facturaFolderName(exp)}/`,
      content: Buffer.alloc(0)
    }));
  }
  if (!entries.length) throw new Error(`La carpeta ${label} no tiene archivos para descargar`);
  yield { message: 'Comprimiendo…', progress: 85, entries };
}

async function* batchesExpediente(job) {
  job.message = 'Recopilando expediente…';
  job.progress = 25;
  const entries = await collectExpedienteZipEntries(job.expedienteId);
  if (!entries.length) throw new Error('El expediente no tiene archivos para descargar');
  yield { message: 'Comprimiendo…', progress: 85, entries };
}

function iteratorForJob(job) {
  switch (job.kind) {
    case 'periodo-paquete': return batchesPeriodoPaquete(job);
    case 'periodo-unificado': return batchesPeriodoUnificado(job);
    case 'periodo-facturados': return batchesPeriodoFacturados(job);
    case 'dia': return batchesDia(job);
    case 'dia-carpeta': return batchesDiaCarpeta(job);
    case 'contenedor': return batchesContenedor(job);
    case 'expediente': return batchesExpediente(job);
    default: throw new Error(`Tipo de ZIP no soportado: ${job.kind}`);
  }
}

async function runZipJob(job) {
  job.status = 'running';
  try {
    await writeZipBatches(job, iteratorForJob(job));
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

function createZipJob(spec, usuarioId = null) {
  cleanupOldJobs();
  const id = crypto.randomBytes(12).toString('hex');
  const job = {
    id,
    kind: spec.kind,
    periodoId: spec.periodoId || null,
    diaId: spec.diaId || null,
    contenedorId: spec.contenedorId || null,
    expedienteId: spec.expedienteId || null,
    usuarioId,
    status: 'pending',
    progress: 0,
    message: 'Iniciando generación…',
    error: null,
    filePath: null,
    filename: spec.filename || 'descarga.zip',
    emptyError: spec.emptyError || null,
    createdAt: Date.now()
  };
  jobs.set(id, job);
  void runZipJob(job);
  return job;
}

function createPeriodPaqueteJob(periodo, usuarioId = null) {
  return createZipJob({
    kind: 'periodo-paquete',
    periodoId: periodo.id,
    filename: `${zipArchiveSegment(periodo.etiqueta || periodo.periodo || `periodo-${periodo.id}`)}-paquete.zip`,
    emptyError: 'No hay archivos para descargar en este mes'
  }, usuarioId);
}

function getJob(jobId) {
  cleanupOldJobs();
  return jobs.get(jobId) || null;
}

module.exports = {
  createZipJob,
  createPeriodPaqueteJob,
  getJob,
  JOB_TTL_MS
};
