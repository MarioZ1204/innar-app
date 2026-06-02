// routes/uploads.js
// Sirve archivos subidos a `public/uploads/` SOLO con autenticación + verificación de
// propiedad. Reemplaza el acceso directo vía `express.static` (privacidad clínica).
//
// Compatibilidad: las URLs guardadas en BD (`/uploads/<filename>`) siguen funcionando.

const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();

const db = require('../utils/db-mysql');
const logger = require('../utils/logger');
const {
  requireAuth, safeError, isAdminRol, isRecepcionRol
} = require('../middleware');

const { getUploadsRoot, isInsideUploadsRoot } = require('../config/uploads-path');
const UPLOADS_DIR = getUploadsRoot();

function isSafeFilename(name) {
  if (typeof name !== 'string') return false;
  if (name.length < 1 || name.length > 255) return false;
  if (name.includes('/') || name.includes('\\') || name.includes('..')) return false;
  return /^[\w\-. ()]+$/.test(name);
}

async function userCanAccessFile(req, filename) {
  const rol = req.session?.rol;
  if (isAdminRol(rol)) return true;
  if (isRecepcionRol(rol)) return true;

  // Si el archivo está vinculado a un doctor en doctor_agenda_files,
  // sólo ese doctor (o admin/recep) puede leerlo.
  const url = `/uploads/${filename}`;
  const rows = await db.query(
    'SELECT doctor_id, uploaded_by FROM doctor_agenda_files WHERE url = ? LIMIT 1',
    [url]
  );
  if (rows.length === 0) {
    // Archivos no rastreados (Excel temporales, etc.): solo admin/recep pasan.
    return false;
  }
  const file = rows[0];
  const uid = req.session?.usuarioId;
  if (rol === 'doctor' && file.doctor_id === uid) return true;
  if (file.uploaded_by === uid) return true;
  return false;
}

router.get('/uploads/:filename', requireAuth, async (req, res) => {
  try {
    const name = req.params.filename;
    if (!isSafeFilename(name)) {
      return res.status(400).json({ error: 'Nombre de archivo inválido' });
    }
    const filePath = path.resolve(UPLOADS_DIR, name);
    if (!isInsideUploadsRoot(filePath)) {
      return res.status(400).json({ error: 'Ruta de archivo inválida' });
    }
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }
    const allowed = await userCanAccessFile(req, name);
    if (!allowed) {
      return res.status(403).json({ error: 'Sin permiso para este archivo' });
    }
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(filePath);
  } catch (e) {
    logger.error('[UPLOADS] Error sirviendo archivo:', e.message);
    res.status(500).json({ error: safeError(e) });
  }
});

module.exports = router;
