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

  it('inicia la recuperación en segundo plano cuando se solicita', async () => {
    const child = {
      pid: 1234,
      unref: jest.fn()
    };

    spawn.mockReturnValue(child);

    const result = await runSoportesRecoveryScript({
      cwd: '/tmp/app',
      expedienteIds: [77],
      background: true
    });

    expect(result.ok).toBe(true);
    expect(result.background).toBe(true);
    expect(result.pid).toBe(1234);
    expect(child.unref).toHaveBeenCalled();
    expect(spawn).toHaveBeenCalledWith(
      process.execPath,
      [path.join('/tmp/app', 'scripts', 'recuperar-rutas-soportes-historicas.js'), '77'],
      expect.objectContaining({
        cwd: '/tmp/app',
        detached: true,
        stdio: ['ignore', 'ignore', 'ignore']
      })
    );
  });
});
