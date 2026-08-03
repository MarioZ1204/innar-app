const { createZipJob, getJob } = require('../utils/soportes-zip-jobs');

describe('soportes-zip-jobs', () => {
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
});
