'use strict';

/**
 * Streaming ZIP: envía bytes al navegador mientras se arma el archivo (sin esperar al 100 %).
 */
const fs = require('fs');
const { PassThrough } = require('stream');
const {
  createArchiverInstance,
  bindArchiveStreamGuards,
  appendEntriesToArchiveAsync,
  yieldEventLoop
} = require('./soportes-armado-zip');
const { iteratorForJob } = require('./soportes-zip-job-runner');

async function streamZipBatches(res, job, batchIterator, onProgress = () => {}) {
  let filesAdded = 0;

  return new Promise((resolve, reject) => {
    const archive = createArchiverInstance();
    bindArchiveStreamGuards(archive, res);
    archive.on('error', reject);
    res.on('error', reject);

    let cacheStream = null;
    let cacheDone = Promise.resolve();

    if (job._cachePath) {
      const tee = new PassThrough();
      archive.pipe(tee);
      tee.pipe(res);
      cacheStream = fs.createWriteStream(job._cachePath);
      tee.pipe(cacheStream);
      cacheDone = new Promise((resolveCache, rejectCache) => {
        cacheStream.on('finish', resolveCache);
        cacheStream.on('error', rejectCache);
      });
    } else {
      archive.pipe(res);
    }

    const onArchiveEnd = async () => {
      try {
        if (cacheStream) await cacheDone;
        if (!filesAdded) {
          reject(new Error(job.emptyError || 'No hay archivos para descargar'));
          return;
        }
        resolve({ filesAdded });
      } catch (e) {
        reject(e);
      }
    };

    archive.on('end', () => { void onArchiveEnd(); });

    (async () => {
      try {
        onProgress({ message: 'Preparando descarga…', progress: 5 });
        for await (const batch of batchIterator) {
          if (batch.message != null) onProgress({ message: batch.message });
          if (batch.progress != null) onProgress({ progress: batch.progress });
          if (batch.entries?.length) {
            await appendEntriesToArchiveAsync(archive, batch.entries, 4);
            filesAdded += batch.entries.length;
          }
          await yieldEventLoop();
        }
        onProgress({ message: 'Finalizando ZIP…', progress: 98 });
        archive.finalize();
      } catch (e) {
        try { archive.abort(); } catch (_) { /* ignore */ }
        reject(e);
      }
    })();
  });
}

async function streamZipJobToResponse(res, job, onProgress = () => {}) {
  return streamZipBatches(res, job, iteratorForJob(job), onProgress);
}

module.exports = {
  streamZipBatches,
  streamZipJobToResponse
};
