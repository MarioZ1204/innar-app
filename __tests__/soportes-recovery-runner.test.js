const path = require('path');
const { EventEmitter } = require('events');

jest.mock('child_process', () => ({
  spawn: jest.fn()
}));

const { spawn } = require('child_process');
const { runSoportesRecoveryScript } = require('../utils/soportes-recovery-runner');

describe('runSoportesRecoveryScript', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lanza el script de recuperación con el runtime actual', async () => {
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    const child = new EventEmitter();
    child.stdout = stdout;
    child.stderr = stderr;

    spawn.mockReturnValue(child);

    const promise = runSoportesRecoveryScript({ cwd: '/tmp/app' });
    stdout.emit('data', Buffer.from('ok'));
    stderr.emit('data', Buffer.from(''));
    child.emit('exit', 0, null);

    const result = await promise;

    expect(spawn).toHaveBeenCalledWith(
      process.execPath,
      [path.join('/tmp/app', 'scripts', 'recuperar-rutas-soportes-historicas.js')],
      expect.objectContaining({ cwd: '/tmp/app' })
    );
    expect(result.ok).toBe(true);
    expect(result.stdout).toContain('ok');
  });
});
