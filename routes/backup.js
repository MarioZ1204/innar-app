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
  resolveFullBackupPath,
  isSafeFullBackupName,
  listFilesOnlyBackups,
  isSafeFilesOnlyBackupName,
  resolveFilesOnlyBackupPath
} = require('../utils/backup-full');
const { BACKUP_DIR } = require('../utils/backup');
const { startBackgroundJob } = require('../utils/background-jobs');
const { readDirNames, pathExists } = require('../utils/fs-async');

const ROLES_BACKUP = ['superadmin', 'admin'];

/** GET /api/backups — listado completo + SQL diarios recientes */
router.get('/backups', requireAuth, requireRoleOrPerm(ROLES_BACKUP, 'sistema.backups'), async (req, res) => {
  try {
    const completos = listFullBackups();
    const archivosDiarios = listFilesOnlyBackups();
    let sqlDiarios = [];
    if (await pathExists(BACKUP_DIR)) {
      const names = await readDirNames(BACKUP_DIR);
      sqlDiarios = names
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

/** POST /api/backups/completo — generar ZIP (BD + uploads) en proceso hijo */
router.post('/backups/completo', requireAuth, requireRoleOrPerm(ROLES_BACKUP, 'sistema.backups'), async (req, res) => {
  try {
    const usuario = req.session?.nombre || req.session?.usuario || `id:${req.session?.usuarioId}`;
    const started = startBackgroundJob('backup-full', {
      triggeredBy: usuario,
      label: req.body?.label || 'Manual desde módulo Backup'
    });
    logger.info('[BACKUP] Completo iniciado en segundo plano', { type: 'BACKUP', user: usuario, pid: started.pid });
    res.status(202).json({
      ok: true,
      background: true,
      message: 'Backup completo iniciado en segundo plano. Actualice la lista en unos minutos.',
      pid: started.pid
    });
  } catch (e) {
    logger.error('[BACKUP] crear completo:', e);
    res.status(500).json({ error: safeError(e) });
  }
});

/** POST /api/backups/archivos — generar ZIP liviano solo de uploads/ (sin BD) en proceso hijo */
router.post('/backups/archivos', requireAuth, requireRoleOrPerm(ROLES_BACKUP, 'sistema.backups'), async (req, res) => {
  try {
    const usuario = req.session?.nombre || req.session?.usuario || `id:${req.session?.usuarioId}`;
    const started = startBackgroundJob('backup-files', {
      triggeredBy: usuario,
      label: req.body?.label || 'Manual desde módulo Backup'
    });
    logger.info('[BACKUP] Archivos iniciado en segundo plano', { type: 'BACKUP', user: usuario, pid: started.pid });
    res.status(202).json({
      ok: true,
      background: true,
      message: 'Backup de archivos iniciado en segundo plano. Actualice la lista en unos minutos.',
      pid: started.pid
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

      const usuario = req.session?.nombre || req.session?.usuario || `id:${req.session?.usuarioId}`;
      const started = startBackgroundJob('restore-all-uploads', { onlyPrefixes });
      logger.info('[BACKUP] Restauración masiva iniciada en segundo plano', {
        type: 'BACKUP_RESTORE',
        user: usuario,
        pid: started.pid
      });

      res.status(202).json({
        ok: true,
        background: true,
        message: 'Restauración iniciada en segundo plano. Revise los logs del servidor para el resultado.',
        pid: started.pid
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

      const usuario = req.session?.nombre || req.session?.usuario || `id:${req.session?.usuarioId}`;
      const started = startBackgroundJob('restore-one-uploads', {
        backupFilename: name,
        overwrite,
        onlyPrefixes
      });
      logger.info('[BACKUP] Restauración desde backup iniciada en segundo plano', {
        type: 'BACKUP_RESTORE',
        filename: name,
        user: usuario,
        pid: started.pid
      });

      res.status(202).json({
        ok: true,
        background: true,
        message: `Restauración desde ${name} iniciada en segundo plano.`,
        pid: started.pid
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
