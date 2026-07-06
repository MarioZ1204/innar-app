/**
 * API del módulo Archivo (reportes PDX, soportes armado, anexo FIDU archivados).
 */
const express = require('express');
const fs = require('fs');
const router = express.Router();
const db = require('../utils/db-mysql');
const logger = require('../utils/logger');
const { requireAuth, requireRoleOrPerm, safeError } = require('../middleware/index');
const {
  listarModuloArchivo,
  resolveArchivoBackupPath,
  regenerarBackup,
  archivarPdxPeriodo,
  archivarArmadoPeriodo,
  archivarAnexoCarpeta,
  setVisibleEnSoportes
} = require('../utils/soportes-modulo-archivo');

const PERM_ARCHIVO = ['modulo.archivo_soportes', 'soportes.ver_archivo'];

router.get('/archivo-modulo', requireAuth, requireRoleOrPerm(
  ['superadmin', 'admin', 'admin_recepcion', 'recepcion', 'contabilidad', 'admin_electro'],
  PERM_ARCHIVO
), async (req, res) => {
  try {
    const items = await listarModuloArchivo();
    res.json({ ok: true, items });
  } catch (e) {
    logger.error('[ARCHIVO-MODULO] list:', e);
    res.status(500).json({ error: safeError(e) });
  }
});

router.get('/archivo-modulo/:id/descargar', requireAuth, requireRoleOrPerm(
  ['superadmin', 'admin', 'admin_recepcion', 'recepcion', 'contabilidad', 'admin_electro'],
  PERM_ARCHIVO
), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const rows = await db.query('SELECT * FROM sop_modulo_archivo WHERE id = ? LIMIT 1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Registro no encontrado' });
    const reg = rows[0];
    if (!reg.backup_filename) return res.status(404).json({ error: 'Este registro aún no tiene copia de seguridad ZIP' });
    const fp = resolveArchivoBackupPath(reg.backup_filename);
    if (!fp) return res.status(404).json({ error: 'Archivo de respaldo no encontrado en disco' });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${reg.backup_filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    fs.createReadStream(fp).pipe(res);
  } catch (e) {
    logger.error('[ARCHIVO-MODULO] descargar:', e);
    res.status(500).json({ error: safeError(e) });
  }
});

router.post('/archivo-modulo/:id/regenerar-backup', requireAuth, requireRoleOrPerm(
  ['superadmin', 'admin', 'admin_recepcion'],
  PERM_ARCHIVO
), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const backup = await regenerarBackup(id, req.session?.usuarioId || null);
    res.json({ ok: true, backup: backup ? { filename: backup.filename, size_bytes: backup.size_bytes } : null });
  } catch (e) {
    logger.error('[ARCHIVO-MODULO] regenerar:', e);
    res.status(500).json({ error: safeError(e) });
  }
});

router.patch('/archivo-modulo/:id/visible-soportes', requireAuth, requireRoleOrPerm(
  ['superadmin', 'admin', 'admin_recepcion'],
  PERM_ARCHIVO
), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Registro inválido' });
    const visible = req.body?.visible === true || req.body?.visible === 1 || req.body?.visible === '1';
    const result = await setVisibleEnSoportes(id, visible);
    res.json({
      ok: true,
      visible: result.visible,
      mensaje: result.visible
        ? 'La carpeta volverá a mostrarse en el módulo Soportes.'
        : 'La carpeta ya no se mostrará en el módulo Soportes (sigue disponible aquí en Archivo).'
    });
  } catch (e) {
    logger.error('[ARCHIVO-MODULO] visible-soportes:', e);
    res.status(e.message === 'Registro no encontrado' ? 404 : 500).json({ error: safeError(e) });
  }
});

router.post('/archivo-modulo/archivar-manual', requireAuth, requireRoleOrPerm(
  ['superadmin', 'admin'],
  PERM_ARCHIVO
), async (req, res) => {
  try {
    const { modulo, periodo, ref_id } = req.body || {};
    const uid = req.session?.usuarioId || null;
    let result = null;
    if (modulo === 'pdx' && periodo) {
      result = await archivarPdxPeriodo(periodo, uid);
    } else if (modulo === 'armado' && ref_id) {
      const pr = await db.query('SELECT * FROM sop_periodos WHERE id = ? LIMIT 1', [parseInt(ref_id, 10)]);
      if (!pr.length) return res.status(404).json({ error: 'Periodo armado no encontrado' });
      result = await archivarArmadoPeriodo(pr[0], uid);
    } else if (modulo === 'anexo' && ref_id) {
      const cr = await db.query('SELECT * FROM anexo_fidu_carpetas WHERE id = ? LIMIT 1', [parseInt(ref_id, 10)]);
      if (!cr.length) return res.status(404).json({ error: 'Carpeta Anexo no encontrada' });
      result = await archivarAnexoCarpeta(cr[0], uid);
    } else {
      return res.status(400).json({ error: 'Indique modulo y periodo o ref_id válidos' });
    }
    if (!result) return res.json({ ok: true, omitido: true, mensaje: 'Ya estaba archivado' });
    res.json({ ok: true, registro_id: result.id, backup: result.backup || null });
  } catch (e) {
    logger.error('[ARCHIVO-MODULO] archivar-manual:', e);
    res.status(500).json({ error: safeError(e) });
  }
});

module.exports = router;
