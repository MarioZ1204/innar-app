/**
 * Operaciones de disco no bloqueantes (fs.promises).
 * Usar en handlers HTTP para no congelar el event loop con readFileSync/writeFileSync.
 */
const fs = require('fs');
const fsp = fs.promises;

async function pathExists(filePath) {
  if (!filePath) return false;
  try {
    await fsp.access(filePath, fs.constants.F_OK);
    return true;
  } catch (_) {
    return false;
  }
}

async function readFileBuffer(filePath) {
  return fsp.readFile(filePath);
}

async function writeFileAtomic(filePath, buffer) {
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fsp.writeFile(tmp, buffer);
  await fsp.rename(tmp, filePath);
}

async function readDirNames(dirPath) {
  try {
    return await fsp.readdir(dirPath);
  } catch (_) {
    return [];
  }
}

module.exports = {
  fsp,
  pathExists,
  readFileBuffer,
  writeFileAtomic,
  readDirNames
};
