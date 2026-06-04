const { isSafeFullBackupName, resolveFullBackupPath } = require('../utils/backup-full');
const path = require('path');

describe('backup-full', () => {
  test('isSafeFullBackupName acepta nombres válidos', () => {
    expect(isSafeFullBackupName('innar-completo-2026-05-01T03-00-00.zip')).toBe(true);
    expect(isSafeFullBackupName('../innar-completo-2026-05-01T03-00-00.zip')).toBe(false);
    expect(isSafeFullBackupName('backup-innar.sql')).toBe(false);
  });

  test('resolveFullBackupPath evita path traversal', () => {
    const p = resolveFullBackupPath('innar-completo-2026-05-01T03-00-00.zip');
    expect(p).toBeTruthy();
    expect(path.basename(p)).toBe('innar-completo-2026-05-01T03-00-00.zip');
    expect(resolveFullBackupPath('../../../etc/passwd')).toBeNull();
  });
});
