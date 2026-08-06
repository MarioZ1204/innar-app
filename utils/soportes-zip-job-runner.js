/**
 * Generación de ZIP en disco (usado por proceso hijo para no bloquear el servidor web).
 */
const fs = require('fs');
const path = require('path');
const db = require('./db-mysql');
const { resolverArchivoExpedienteRow } = require('./soportes-exp-archivo');
const {
  zipArchiveSegment,
  queryDiasFacturacionZip,
  collectDiaZipEntries,
  collectCarpetaZipEntries,
  collectContenedorZipEntries,
  collectExpedienteZipEntries,
  appendEntriesToArchive,
  filterValidZipEntries,
  loadArchivosByExpedienteIds,
  loadRipsArchivosByExpedienteIds,
  getSopZipWorkDir,
  createArchiverInstance,
  bindArchiveStreamGuards,
  facturaFolderName,
  yieldEventLoop
} = require('./soportes-armado-zip');

function ensureJobDir() {
  const dir = getSopZipWorkDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function writeZipBatches(job, batchIterator, onProgress) {
  ensureJobDir();
  const outPath = path.join(getSopZipWorkDir(), `${job.id}.zip`);
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
        for await (const batch of batchIterator) {
          if (batch.message != null) onProgress({ message: batch.message });
          if (batch.progress != null) onProgress({ progress: batch.progress });
          if (batch.entries?.length) {
            appendEntriesToArchive(archive, batch.entries);
            filesAdded += batch.entries.length;
          }
          await yieldEventLoop();
        }
        onProgress({ message: 'Finalizando ZIP…', progress: Math.max(job.progress || 0, 98) });
        archive.finalize();
      } catch (e) {
        try { archive.abort(); } catch (_) { /* ignore */ }
        reject(e);
      }
    })();
  });

  return { filePath: outPath, filesAdded };
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
    await yieldEventLoop();
  }
}

async function* batchesPeriodoUnificado(job) {
  const dias = await queryDiasFacturacionZip(job.periodoId);
  if (!dias.length) throw new Error('No hay archivos para el ZIP unificado');
  const usedPaths = new Set();
  const total = dias.length;
  let step = 0;
  for (const dia of dias) {
    step += 1;
    const part = await collectDiaZipEntries(dia.id, usedPaths);
    yield {
      message: `Recopilando ${dia.nombre_display || 'carpeta'}…`,
      progress: Math.min(90, Math.round((step / total) * 90)),
      entries: part
    };
    await yieldEventLoop();
  }
}

async function* batchesPeriodoFacturados(job) {
  const expedientes = await db.query(
    `SELECT e.id, e.codigo, e.numero_factura, e.paciente_nombre, d.nombre_display AS dia_nombre, c.tipo AS contenedor_tipo
     FROM sop_expedientes e
     JOIN sop_contenedores c ON c.id = e.contenedor_id
     JOIN sop_dias d ON d.id = c.dia_id
     WHERE d.periodo_id = ? AND d.estado_facturacion = 'facturados'
     ORDER BY d.nombre_display ASC, c.tipo ASC, e.codigo ASC`,
    [job.periodoId]
  );
  if (!expedientes.length) throw new Error('No hay carpetas FE facturadas con archivos');

  const expIds = expedientes.map((e) => e.id);
  const archivosByExp = await loadArchivosByExpedienteIds(expIds);
  const ripsByExp = await loadRipsArchivosByExpedienteIds(expIds);

  const total = expedientes.length;
  let step = 0;
  for (const exp of expedientes) {
    step += 1;
    const diaSeg = zipArchiveSegment(exp.dia_nombre);
    const tipoSeg = exp.contenedor_tipo === 'rips' ? 'RIPS' : 'SOPORTES';
    const codSeg = zipArchiveSegment(exp.codigo);
    const prefix = `${diaSeg}/${tipoSeg}/${codSeg}`;
    const expedienteCtx = {
      codigo: exp.codigo,
      numero_factura: exp.numero_factura,
      paciente_nombre: exp.paciente_nombre,
      nombre_display: exp.dia_nombre
    };
    const entries = [];
    for (const a of archivosByExp.get(exp.id) || []) {
      const fp = resolverArchivoExpedienteRow(a, expedienteCtx);
      if (fp) entries.push({ absPath: fp, name: `${prefix}/${a.nombre_archivo}` });
    }
    for (const a of ripsByExp.get(exp.id) || []) {
      const fp = resolverArchivoExpedienteRow(a, expedienteCtx);
      if (fp) entries.push({ absPath: fp, name: `${prefix}/${a.nombre_archivo}` });
    }

    if (entries.length) {
      yield {
        message: `Facturados: ${exp.codigo || exp.paciente_nombre || 'expediente'}…`,
        progress: Math.min(92, Math.round((step / total) * 92)),
        entries: filterValidZipEntries(entries)
      };
    }
    if (step % 20 === 0) await yieldEventLoop();
  }
}

async function* batchesDia(job) {
  const entries = await collectDiaZipEntries(job.diaId, null, { repair: false });
  if (!entries.length) throw new Error('La carpeta no tiene archivos para descargar');
  yield { message: 'Comprimiendo…', progress: 85, entries };
}

async function* batchesDiaCarpeta(job) {
  yield { message: 'Recopilando carpeta y subcarpetas…', progress: 15, entries: [] };
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
  const entries = await collectExpedienteZipEntries(job.expedienteId);
  if (!entries.length) throw new Error('El expediente no tiene archivos para descargar');
  yield { message: 'Comprimiendo…', progress: 85, entries };
}

function onProgressSafe(job, patch) {
  if (patch.message != null) job.message = patch.message;
  if (patch.progress != null) job.progress = patch.progress;
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

/**
 * @param {object} job spec con id, kind, periodoId, etc.
 * @param {(patch: {message?: string, progress?: number}) => void} onProgress
 */
async function runZipJobToDisk(job, onProgress = () => {}) {
  const state = { ...job, progress: job.progress || 0, message: job.message || 'Generando…' };
  const report = (patch) => {
    onProgressSafe(state, patch);
    onProgress({ message: state.message, progress: state.progress });
  };
  report({ message: 'Generando ZIP…', progress: 5 });
  const result = await writeZipBatches(state, iteratorForJob(state), report);
  report({ message: 'Listo para descargar', progress: 100 });
  return result;
}

module.exports = { runZipJobToDisk, iteratorForJob };
