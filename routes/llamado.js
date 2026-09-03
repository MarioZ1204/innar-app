/**
 * API del módulo Llamado de pacientes (voz neural + config TV compartida).
 */
const express = require('express');
const router = express.Router();
const { requireAuth, requireRoleOrPerm, safeError, emitSocket } = require('../middleware/index');
const { synthesizeLlamadoTts } = require('../utils/llamado-tts');
const db = require('../utils/db-mysql');
const {
  getTvConfigPayload,
  setConsultoriosActivos,
  setConsultorioJornada,
  clearConsultorioJornada,
  getConsultoriosJornadaMap,
  hoyColombiaISO
} = require('../utils/llamado-tv-config');

function emitTvConfig(payload) {
  emitSocket('llamado:tv-config', payload);
}

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

/** Estado compartido: doctores activos en TV + números de consultorio de hoy. */
router.get(
  '/llamado/tv-config',
  requireAuth,
  requireRoleOrPerm([], 'modulo.llamado_pacientes'),
  async (req, res) => {
    try {
      const payload = await getTvConfigPayload(db);
      res.json(payload);
    } catch (e) {
      res.status(500).json({ error: safeError(e) });
    }
  }
);

router.put(
  '/llamado/consultorios-activos',
  requireAuth,
  requireRoleOrPerm([], ['llamado.configurar', 'modulo.llamado_pacientes']),
  async (req, res) => {
    try {
      const ids = Array.isArray(req.body?.doctor_ids) ? req.body.doctor_ids : null;
      if (!ids) return res.status(400).json({ error: 'doctor_ids debe ser un arreglo' });
      const result = await setConsultoriosActivos(db, ids, req.session?.usuarioId);
      const payload = await getTvConfigPayload(db);
      emitTvConfig(payload);
      res.json({ ok: true, ...result, ...payload });
    } catch (e) {
      res.status(500).json({ error: safeError(e) });
    }
  }
);

router.put(
  '/llamado/consultorio-jornada',
  requireAuth,
  requireRoleOrPerm([], ['llamado.configurar', 'modulo.llamado_pacientes']),
  async (req, res) => {
    try {
      const result = await setConsultorioJornada(
        db,
        req.body?.doctor_id,
        req.body?.numero_consultorio,
        req.body?.fecha,
        req.session?.usuarioId
      );
      if (result.error) return res.status(result.status || 400).json({ error: result.error });
      const payload = await getTvConfigPayload(db);
      emitTvConfig(payload);
      emitSocket('agenda:medicos-consultorio', {
        doctor_id: result.doctor_id,
        fecha: result.fecha,
        numero_consultorio: result.numero_consultorio
      });
      res.json({ ok: true, ...result, ...payload });
    } catch (e) {
      res.status(500).json({ error: safeError(e) });
    }
  }
);

router.delete(
  '/llamado/consultorio-jornada/:doctorId',
  requireAuth,
  requireRoleOrPerm([], ['llamado.configurar', 'modulo.llamado_pacientes']),
  async (req, res) => {
    try {
      const result = await clearConsultorioJornada(db, req.params.doctorId, req.query?.fecha);
      if (result.error) return res.status(result.status || 400).json({ error: result.error });
      const payload = await getTvConfigPayload(db);
      emitTvConfig(payload);
      emitSocket('agenda:medicos-consultorio', {
        doctor_id: result.doctor_id,
        fecha: result.fecha,
        numero_consultorio: null,
        restaurado: true
      });
      res.json({ ok: true, ...result, ...payload });
    } catch (e) {
      res.status(500).json({ error: safeError(e) });
    }
  }
);

/** Utilidad: mapa de jornada (misma fecha Colombia o ?fecha=). */
router.get(
  '/llamado/consultorio-jornada',
  requireAuth,
  requireRoleOrPerm([], 'modulo.llamado_pacientes'),
  async (req, res) => {
    try {
      const fecha = req.query?.fecha || hoyColombiaISO();
      const data = await getConsultoriosJornadaMap(db, fecha);
      res.json({ fecha: data.fecha, consultorios_jornada: data.map });
    } catch (e) {
      res.status(500).json({ error: safeError(e) });
    }
  }
);

module.exports = router;
