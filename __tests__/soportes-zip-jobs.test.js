jest.mock('../utils/soportes-zip-job-runner', () => ({
  runZipJobToDisk: jest.fn()
}));

jest.mock('../utils/soportes-zip-cache', () => ({
  tryGetCachedZipForSpec: jest.fn().mockResolvedValue(null),
  saveToCacheForSpec: jest.fn().mockResolvedValue(null),
  PERIOD_ZIP_KINDS: new Set(['periodo-paquete', 'periodo-unificado', 'periodo-facturados'])
}));

const { runZipJobToDisk } = require('../utils/soportes-zip-job-runner');
const {
  createZipJob,
  createPeriodPaqueteJob,
  cancelZipJob,
  getJob,
  USE_CHILD_PROCESS
} = require('../utils/soportes-zip-jobs');

describe('soportes-zip-jobs', () => {
  beforeEach(() => {
    runZipJobToDisk.mockReset();
    runZipJobToDisk.mockResolvedValue({ filePath: '/tmp/test.zip', filesAdded: 1 });
  });

  test('createZipJob registra trabajo con kind y filename', () => {
    const job = createZipJob({
      kind: 'dia',
      diaId: 99,
      filename: 'test-dia.zip'
    }, 1);
    expect(job.id).toMatch(/^[a-f0-9]{24}$/);
    expect(job.kind).toBe('dia');
    expect(job.diaId).toBe(99);
    expect(job.filename).toBe('test-dia.zip');
    expect(['pending', 'running', 'ready', 'error', 'queued']).toContain(job.status);
    expect(getJob(job.id)).toBe(job);
  });

  test('createZipJob retorna de inmediato aunque la generación sea lenta', async () => {
    let resolveSlow;
    runZipJobToDisk.mockReturnValue(new Promise((resolve) => { resolveSlow = resolve; }));

    const t0 = Date.now();
    const job = createZipJob({ kind: 'periodo-paquete', periodoId: 5, filename: 'mes.zip' });
    const elapsed = Date.now() - t0;

    expect(elapsed).toBeLessThan(250);
    expect(job.status).not.toBe('ready');

    resolveSlow({ filePath: '/tmp/mes.zip', filesAdded: 10 });
    await new Promise((r) => setTimeout(r, 80));

    const updated = getJob(job.id);
    expect(updated.status).toBe('ready');
    expect(updated.progress).toBe(100);
  });

  test('en Jest corre inline; en producción usa proceso hijo (fork)', () => {
    expect(USE_CHILD_PROCESS).toBe(false);
  });

  describe('cancelación', () => {
    test('cancelZipJob marca el trabajo y descarta el resultado tardío', async () => {
      let resolveSlow;
      runZipJobToDisk.mockReturnValue(new Promise((resolve) => { resolveSlow = resolve; }));

      const job = createZipJob({ kind: 'dia', diaId: 42, filename: 'cancelar.zip' });
      const r = cancelZipJob(job.id);

      expect(r.ok).toBe(true);
      expect(r.status).toBe('cancelled');
      expect(getJob(job.id).status).toBe('cancelled');
      expect(getJob(job.id).progress).toBe(0);

      // El ZIP termina después de cancelar: no debe revivir como 'ready'.
      resolveSlow({ filePath: '/tmp/cancelar.zip', filesAdded: 3 });
      await new Promise((r2) => setTimeout(r2, 80));

      expect(getJob(job.id).status).toBe('cancelled');
      expect(getJob(job.id).filePath).toBeNull();
    });

    test('cancelZipJob no libera el cupo dos veces', async () => {
      let resolveSlow;
      runZipJobToDisk.mockReturnValue(new Promise((resolve) => { resolveSlow = resolve; }));
      const job = createZipJob({ kind: 'dia', diaId: 7, filename: 'cupo.zip' });

      expect(cancelZipJob(job.id).ok).toBe(true);
      expect(job.slotLibre).toBe(true);
      // Repetir la cancelación es inocuo y no vuelve a tocar el contador.
      expect(cancelZipJob(job.id)).toEqual({ ok: true, status: 'cancelled' });

      resolveSlow({ filePath: '/tmp/cupo.zip', filesAdded: 1 });
      await new Promise((r2) => setTimeout(r2, 60));
      expect(job.slotLibre).toBe(true);
    });

    test('cancelZipJob responde not_found si el trabajo no existe', () => {
      expect(cancelZipJob('inexistente')).toEqual({ ok: false, reason: 'not_found' });
    });
  });

  // Devuelve promesa: quien lo llame debe await, o el job_id sale undefined.
  test('createPeriodPaqueteJob resuelve a un job con id utilizable', async () => {
    const job = await createPeriodPaqueteJob({ id: 7, etiqueta: 'MARZO 2026' }, 1);
    expect(job.id).toMatch(/^[a-f0-9]{24}$/);
    expect(job.kind).toBe('periodo-paquete');
    expect(job.periodoId).toBe(7);
    expect(job.filename).toMatch(/paquete\.zip$/);
    expect(job.status).toBeDefined();
  });
});
