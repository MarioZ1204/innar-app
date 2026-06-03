/**
 * Mueve un archivo entre rutas; si rename falla por EXDEV (tmp vs otro disco), copia y borra.
 */
const fs = require('fs');
const path = require('path');

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

module.exports = { moveFileSafe };
