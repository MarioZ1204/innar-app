const fs = require('fs');
const os = require('os');
const path = require('path');

const { shouldRunRecovery } = require('../scripts/auto-run-recuperacion-soportes');

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
