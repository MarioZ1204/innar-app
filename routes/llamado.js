/**
 * API del módulo Llamado de pacientes (voz neural).
 */
const express = require('express');
const router = express.Router();
const { requireAuth, requireRoleOrPerm, safeError } = require('../middleware/index');
const { synthesizeLlamadoTts } = require('../utils/llamado-tts');

router.get(
  '/llamado/tts',
  requireAuth,
  requireRoleOrPerm([], 'modulo.llamado_pacientes'),
  async (req, res) => {
    const text = String(req.query.text || '').trim();
    if (!text) return res.status(400).json({ error: 'Indique el texto a sintetizar' });
    if (text.length > 500) return res.status(400).json({ error: 'Texto demasiado largo' });
    try {
      const { buffer, contentType } = await synthesizeLlamadoTts(text);
      res.setHeader('Content-Type', contentType || 'audio/mpeg');
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.send(buffer);
    } catch (e) {
      res.status(503).json({ error: safeError(e) || 'No se pudo generar el audio' });
    }
  }
);

module.exports = router;
