/**
 * Mueve un archivo entre rutas; si rename falla por EXDEV (tmp vs otro disco), copia y borra.
 */
const fs = require('fs');
const path = require('path');
const fsp = fs.promises;

function moveFileSafe(src, dest) {
  if (!src || !dest) throw new Error('Ruta de origen o destino inválida');
  if (path.resolve(src) === path.resolve(dest)) return;
  if (fs.existsSync(dest)) fs.unlinkSync(dest);
  try {
    fs.renameSync(src, dest);
  } catch (e) {
    if (e.code === 'EXDEV') {
      fs.copyFileSync(src, dest);
      fs.unlinkSync(src);
    } else {
      throw e;
    }
  }
}

async function pathExists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch (_) {
    return false;
  }
}

async function unlinkIfExists(p) {
  try {
    await fsp.unlink(p);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
}

async function moveFileSafeAsync(src, dest) {
  if (!src || !dest) throw new Error('Ruta de origen o destino inválida');
  if (path.resolve(src) === path.resolve(dest)) return;
  await unlinkIfExists(dest);
  try {
    await fsp.rename(src, dest);
  } catch (e) {
    if (e.code === 'EXDEV') {
      await fsp.copyFile(src, dest);
      await fsp.unlink(src);
    } else {
      throw e;
    }
  }
}

module.exports = { moveFileSafe, moveFileSafeAsync, pathExists, unlinkIfExists };
