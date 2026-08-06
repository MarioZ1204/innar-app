/**
 * API módulo Backup — listar, generar y descargar backups completos (BD + uploads).
 */
const express = require('express');
const fs = require('fs');
const router = express.Router();
const { requireAuth, requireRoleOrPerm, safeError } = require('../middleware/index');
const logger = require('../utils/logger');
const {
  listFullBackups,
  createFullBackup,
  resolveFullBackupPath,
  isSafeFullBackupName,
  listFilesOnlyBackups,
  createFilesOnlyBackup,
  isSafeFilesOnlyBackupName,
  resolveFilesOnlyBackupPath
} = require('../utils/backup-full');
const { BACKUP_DIR } = require('../utils/backup');
const {
  restoreMissingUploadsFromBackup,
  restoreMissingUploadsFromAllBackups
} = require('../utils/soportes-backup-restore');

const ROLES_BACKUP = ['superadmin', 'admin'];

/** GET /api/backups — listado completo + SQL diarios recientes */
router.get('/backups', requireAuth, requireRoleOrPerm(ROLES_BACKUP, 'sistema.backups'), async (req, res) => {
  try {
    const completos = listFullBackups();
    const archivosDiarios = listFilesOnlyBackups();
    let sqlDiarios = [];
    if (fs.existsSync(BACKUP_DIR)) {
      sqlDiarios = fs.readdirSync(BACKUP_DIR)
        .filter((f) => f.startsWith('backup-') && f.endsWith('.sql'))
        .map((filename) => {
          const fp = require('path').join(BACKUP_DIR, filename);
          const st = fs.statSync(fp);
          return {
            filename,
            size_bytes: st.size,
            size_mb: (st.size / (1024 * 1024)).toFixed(2),
            created_at: st.mtime.toISOString(),
            tipo: 'sql_diario'
          };
        })
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, 5);
    }
    res.json({
      ok: true,
      backup_dir: BACKUP_DIR,
      completos,
      archivos_diarios: archivosDiarios,
      sql_diarios: sqlDiarios,
      max_completos: parseInt(process.env.MAX_FULL_BACKUPS || '12', 10),
      max_archivos_diarios: parseInt(process.env.MAX_FILES_ONLY_BACKUPS || '14', 10)
    });
  } catch (e) {
    logger.error('[BACKUP] list:', e);
    res.status(500).json({ error: safeError(e) });
  }
});

/** POST /api/backups/completo — generar ZIP (BD + uploads) */
router.post('/backups/completo', requireAuth, requireRoleOrPerm(ROLES_BACKUP, 'sistema.backups'), async (req, res) => {
  try {
    const usuario = req.session?.nombre || req.session?.usuario || `id:${req.session?.usuarioId}`;
    const result = await createFullBackup({
      triggeredBy: usuario,
      label: req.body?.label || 'Manual desde módulo Backup'
    });
    logger.info('[BACKUP] Completo creado', {
      type: 'BACKUP',
      filename: result.filename,
      size: result.size_bytes,
      user: usuario
    });
    res.json({
      ok: true,
      message: 'Backup completo generado correctamente',
      backup: {
        filename: result.filename,
        size_bytes: result.size_bytes,
        size_mb: (result.size_bytes / (1024 * 1024)).toFixed(2),
        created_at: result.manifest.created_at,
        tipo: 'completo'
      }
    });
  } catch (e) {
    logger.error('[BACKUP] crear completo:', e);
    res.status(500).json({ error: safeError(e) });
  }
});

/** POST /api/backups/archivos — generar ZIP liviano solo de uploads/ (sin BD) */
router.post('/backups/archivos', requireAuth, requireRoleOrPerm(ROLES_BACKUP, 'sistema.backups'), async (req, res) => {
  try {
    const usuario = req.session?.nombre || req.session?.usuario || `id:${req.session?.usuarioId}`;
    const result = await createFilesOnlyBackup({
      triggeredBy: usuario,
      label: req.body?.label || 'Manual desde módulo Backup'
    });
    logger.info('[BACKUP] Archivos creado', {
      type: 'BACKUP',
      filename: result.filename,
      size: result.size_bytes,
      user: usuario
    });
    res.json({
      ok: true,
      message: 'Backup de archivos generado correctamente',
      backup: {
        filename: result.filename,
        size_bytes: result.size_bytes,
        size_mb: (result.size_bytes / (1024 * 1024)).toFixed(2),
        created_at: result.manifest.created_at,
        tipo: 'archivos'
      }
    });
  } catch (e) {
    logger.error('[BACKUP] crear archivos:', e);
    res.status(500).json({ error: safeError(e) });
  }
});

/**
 * POST /api/backups/restaurar-archivos
 * Revisa TODOS los backups disponibles (completos + solo archivos), del más
 * reciente al más antiguo, y restaura cualquier archivo de uploads/ que no
 * exista actualmente en disco. No toca la base de datos ni sobreescribe
 * archivos existentes.
 */
router.post(
  '/backups/restaurar-archivos',
  requireAuth,
  requireRoleOrPerm(['superadmin'], 'sistema.backups'),
  async (req, res) => {
    try {
      const onlyPrefixes = Array.isArray(req.body?.onlyPrefixes)
        ? req.body.onlyPrefixes.filter((v) => typeof v === 'string' && v.trim())
        : [];

      const result = await restoreMissingUploadsFromAllBackups({ onlyPrefixes });

      const usuario = req.session?.nombre || req.session?.usuario || `id:${req.session?.usuarioId}`;
      logger.info('[BACKUP] Restauración de archivos faltantes (todos los backups)', {
        type: 'BACKUP_RESTORE',
        backupsRevisados: result.backupsRevisados,
        restaurados: result.restaurados.length,
        omitidos: result.omitidos,
        errores: result.errores.length,
        user: usuario
      });

      res.json({
        ok: true,
        message: result.backupsRevisados.length
          ? `Restauración completada: ${result.restaurados.length} archivo(s) recuperado(s), ${result.omitidos} ya existían.`
          : 'No hay backups disponibles para restaurar.',
        ...result
      });
    } catch (e) {
      logger.error('[BACKUP] restaurar archivos (todos):', e);
      res.status(500).json({ error: safeError(e) });
    }
  }
);

/** GET /api/backups/completo/:filename/descargar */
router.get(
  '/backups/completo/:filename/descargar',
  requireAuth,
  requireRoleOrPerm(ROLES_BACKUP, 'sistema.backups'),
  (req, res) => {
    try {
      const name = req.params.filename;
      if (!isSafeFullBackupName(name)) {
        return res.status(400).json({ error: 'Nombre de archivo no válido' });
      }
      const fp = resolveFullBackupPath(name);
      if (!fp || !fs.existsSync(fp)) {
        return res.status(404).json({ error: 'Backup no encontrado' });
      }
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
      const stream = fs.createReadStream(fp);
      stream.on('error', () => {
        if (!res.headersSent) res.status(500).json({ error: 'Error al leer el archivo' });
      });
      stream.pipe(res);
    } catch (e) {
      logger.error('[BACKUP] descargar:', e);
      res.status(500).json({ error: safeError(e) });
    }
  }
);

/**
 * POST /api/backups/completo/:filename/restaurar-archivos
 * Restaura desde el ZIP de backup los archivos de uploads/ que no existan
 * actualmente en disco (útil tras un redespliegue en Hostinger que haya
 * perdido archivos). No toca la base de datos ni sobreescribe archivos
 * existentes salvo que se envíe { overwrite: true }.
 */
router.post(
  '/backups/completo/:filename/restaurar-archivos',
  requireAuth,
  requireRoleOrPerm(['superadmin'], 'sistema.backups'),
  async (req, res) => {
    try {
      const name = req.params.filename;
      if (!isSafeFullBackupName(name) && !isSafeFilesOnlyBackupName(name)) {
        return res.status(400).json({ error: 'Nombre de archivo no válido' });
      }
      const fp = resolveFullBackupPath(name) || resolveFilesOnlyBackupPath(name);
      if (!fp || !fs.existsSync(fp)) {
        return res.status(404).json({ error: 'Backup no encontrado' });
      }
      const overwrite = req.body?.overwrite === true;
      const onlyPrefixes = Array.isArray(req.body?.onlyPrefixes)
        ? req.body.onlyPrefixes.filter((v) => typeof v === 'string' && v.trim())
        : [];

      const result = await restoreMissingUploadsFromBackup({ backupFilename: name, overwrite, onlyPrefixes });

      const usuario = req.session?.nombre || req.session?.usuario || `id:${req.session?.usuarioId}`;
      logger.info('[BACKUP] Restauración de archivos faltantes', {
        type: 'BACKUP_RESTORE',
        filename: name,
        restaurados: result.restaurados.length,
        omitidos: result.omitidos,
        errores: result.errores.length,
        user: usuario
      });

      res.json({
        ok: true,
        message: `Restauración completada: ${result.restaurados.length} archivo(s) recuperado(s), ${result.omitidos} ya existían.`,
        ...result
      });
    } catch (e) {
      logger.error('[BACKUP] restaurar archivos:', e);
      res.status(500).json({ error: safeError(e) });
    }
  }
);

/** DELETE /api/backups/completo/:filename */
router.delete(
  '/backups/completo/:filename',
  requireAuth,
  requireRoleOrPerm(['superadmin'], 'sistema.backups'),
  (req, res) => {
    try {
      const name = req.params.filename;
      if (!isSafeFullBackupName(name)) {
        return res.status(400).json({ error: 'Nombre de archivo no válido' });
      }
      const fp = resolveFullBackupPath(name);
      if (!fp || !fs.existsSync(fp)) {
        return res.status(404).json({ error: 'Backup no encontrado' });
      }
      fs.unlinkSync(fp);
      res.json({ ok: true, message: 'Backup eliminado' });
    } catch (e) {
      logger.error('[BACKUP] eliminar:', e);
      res.status(500).json({ error: safeError(e) });
    }
  }
);

module.exports = router;
