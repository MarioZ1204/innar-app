jest.mock('../utils/soportes-zip-job-runner', () => ({
  runZipJobToDisk: jest.fn()
}));

const { runZipJobToDisk } = require('../utils/soportes-zip-job-runner');
const { createZipJob, getJob, USE_CHILD_PROCESS } = require('../utils/soportes-zip-jobs');

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
});
