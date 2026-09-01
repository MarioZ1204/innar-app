const fs = require('fs');
const path = require('path');
const os = require('os');
const { moveFileSafe, moveFileSafeAsync } = require('../utils/fs-move-safe');

describe('moveFileSafe', () => {
  test('mueve archivo en el mismo directorio', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'innar-move-'));
    const src = path.join(dir, 'a.txt');
    const dest = path.join(dir, 'b.txt');
    fs.writeFileSync(src, 'ok');
    moveFileSafe(src, dest);
    expect(fs.existsSync(dest)).toBe(true);
    expect(fs.readFileSync(dest, 'utf8')).toBe('ok');
    expect(fs.existsSync(src)).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('si rename lanza EXDEV, copia y borra origen', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'innar-move-'));
    const src = path.join(dir, 'src.txt');
    const dest = path.join(dir, 'dest.txt');
    fs.writeFileSync(src, 'cross');
    const renameSpy = jest.spyOn(fs, 'renameSync').mockImplementation(() => {
      const err = new Error('EXDEV: cross-device link not permitted');
      err.code = 'EXDEV';
      throw err;
    });
    moveFileSafe(src, dest);
    expect(fs.readFileSync(dest, 'utf8')).toBe('cross');
    expect(fs.existsSync(src)).toBe(false);
    renameSpy.mockRestore();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('moveFileSafeAsync', () => {
  test('mueve archivo en el mismo directorio', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'innar-move-async-'));
    const src = path.join(dir, 'a.txt');
    const dest = path.join(dir, 'b.txt');
    fs.writeFileSync(src, 'ok');
    await moveFileSafeAsync(src, dest);
    expect(fs.existsSync(dest)).toBe(true);
    expect(fs.readFileSync(dest, 'utf8')).toBe('ok');
    expect(fs.existsSync(src)).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('si rename lanza EXDEV, copia y borra origen', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'innar-move-async-'));
    const src = path.join(dir, 'src.txt');
    const dest = path.join(dir, 'dest.txt');
    fs.writeFileSync(src, 'cross');
    const renameSpy = jest.spyOn(fs.promises, 'rename').mockImplementation(async () => {
      const err = new Error('EXDEV: cross-device link not permitted');
      err.code = 'EXDEV';
      throw err;
    });
    await moveFileSafeAsync(src, dest);
    expect(fs.readFileSync(dest, 'utf8')).toBe('cross');
    expect(fs.existsSync(src)).toBe(false);
    renameSpy.mockRestore();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
