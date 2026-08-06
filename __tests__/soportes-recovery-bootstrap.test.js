const fs = require('fs');
const os = require('os');
const path = require('path');

const { shouldRunRecovery, shouldRunFileRestore, runFileRestoreBootstrap } = require('../scripts/auto-run-recuperacion-soportes');

describe('auto-run recovery bootstrap', () => {
  it('no ejecuta la recuperación si la variable de despliegue está desactivada', () => {
    const result = shouldRunRecovery({
      env: {},
      cwd: process.cwd(),
      version: '1.0.0'
    });

    expect(result.shouldRun).toBe(false);
    expect(result.reason).toBe('disabled');
  });

  it('ejecuta la recuperación cuando hay una versión nueva de despliegue', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soportes-recovery-'));
    const markerPath = path.join(tempDir, '.deploy-state', 'soportes-recovery.json');
    fs.mkdirSync(path.dirname(markerPath), { recursive: true });
    fs.writeFileSync(markerPath, JSON.stringify({ version: '1.0.0', updatedAt: new Date().toISOString() }));

    const result = shouldRunRecovery({
      env: {
        SOPORTES_RECOVERY_ON_DEPLOY: '1',
        APP_BUILD_VERSION: '2.0.0'
      },
      cwd: tempDir,
      version: '2.0.0'
    });

    expect(result.shouldRun).toBe(true);
    expect(result.reason).toBe('new-version');
    expect(result.markerPath).toBe(path.join(tempDir, '.deploy-state', 'soportes-recovery.json'));
  });
});

describe('shouldRunFileRestore', () => {
  it('está desactivado por defecto', () => {
    const result = shouldRunFileRestore({ env: {}, cwd: process.cwd(), version: '1.0.0' });
    expect(result.shouldRun).toBe(false);
    expect(result.reason).toBe('disabled');
  });

  it('se activa con SOPORTES_RESTORE_FILES_ON_DEPLOY en una versión nueva', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soportes-restore-'));
    const result = shouldRunFileRestore({
      env: { SOPORTES_RESTORE_FILES_ON_DEPLOY: '1' },
      cwd: tempDir,
      version: '2.0.0'
    });
    expect(result.shouldRun).toBe(true);
    expect(result.reason).toBe('first-run');
    expect(result.markerPath).toBe(path.join(tempDir, '.deploy-state', 'soportes-restore-files.json'));
  });

  it('no se repite para la misma versión una vez marcada', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soportes-restore-'));
    const markerPath = path.join(tempDir, '.deploy-state', 'soportes-restore-files.json');
    fs.mkdirSync(path.dirname(markerPath), { recursive: true });
    fs.writeFileSync(markerPath, JSON.stringify({ version: '2.0.0' }));

    const result = shouldRunFileRestore({
      env: { SOPORTES_RESTORE_FILES_ON_DEPLOY: '1' },
      cwd: tempDir,
      version: '2.0.0'
    });
    expect(result.shouldRun).toBe(false);
    expect(result.reason).toBe('same-version');
  });
});

describe('runFileRestoreBootstrap', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  it('no hace nada si la variable de entorno está desactivada', async () => {
    delete process.env.SOPORTES_RESTORE_FILES_ON_DEPLOY;
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await runFileRestoreBootstrap();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('desactivado'));
    logSpy.mockRestore();
  });
});
