'use strict';

const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const {
  requireAuth, requirePermiso, safeError
} = require('../middleware/index');
const {
  renderHtmlToPdf,
  getCertificadoAsistenciaFondo,
  getComprobanteServiciosFondo
} = require('../utils/puppeteer-utils');
const {
  validarPayloadCertificado,
  buildCertificadoAsistenciaHtml
} = require('../utils/certificado-asistencia');
const {
  validarPayloadComprobanteServicios,
  buildComprobanteServiciosHtml
} = require('../utils/comprobante-servicios');
const { procesarImagenesFirma } = require('../utils/comprobante-servicios-firma');
const db = require('../utils/db-mysql');
const {
  buscarPersonaFiduPorDocumento,
  guardarPersonaFiduMerge
} = require('../utils/anexo-fidu-personas-docs');

const CONTEXTOS_PERSONA_FIDU = new Set(['certificado', 'comprobante', 'anexo']);

function requirePersonaFiduLectura(req, res, next) {
  if (req.session?.rol === 'superadmin') return next();
  const perms = req.session?.permisos;
  const permisosOk = ['agenda.ver', 'electro.ver', 'modulo.anexo_fidu'];
  if (perms === null || perms === undefined) {
    if (req.session?.rol === 'admin' || req.session?.rol === 'administrador') return next();
    return next();
  }
  if (Array.isArray(perms) && permisosOk.some((p) => perms.includes(p))) return next();
  return res.status(403).json({ error: 'No tienes permiso para consultar la base de pacientes' });
}

function parseContextoPersonaFidu(val) {
  const ctx = String(val || 'anexo').trim().toLowerCase();
  return CONTEXTOS_PERSONA_FIDU.has(ctx) ? ctx : 'anexo';
}

/** POST /api/certificados/asistencia — genera PDF de certificación de asistencia */
router.post('/certificados/asistencia', requireAuth, (req, res, next) => {
  const origen = String(req.body?.origen || '').trim().toLowerCase();
  if (origen === 'electro') {
    return requirePermiso('electro.ver')(req, res, next);
  }
  if (origen === 'medica') {
    return requirePermiso('agenda.ver')(req, res, next);
  }
  return res.status(400).json({ error: 'Origen inválido (medica o electro)' });
}, async (req, res) => {
  try {
    const validacion = validarPayloadCertificado(req.body);
    if (validacion.error) return res.status(400).json({ error: validacion.error });

    const fondo = getCertificadoAsistenciaFondo();
    const html = buildCertificadoAsistenciaHtml(validacion.data, fondo);
    const pdf = await renderHtmlToPdf(html);

    const doc = validacion.data.paciente_documento.replace(/\D/g, '') || 'sin_doc';
    const filename = `certificado_asistencia_${doc}.pdf`;

    logger.info('[CERT] Asistencia generada', {
      origen: req.body?.origen,
      documento: validacion.data.paciente_documento,
      usuario: req.session?.usuario
    });

    res.contentType('application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdf);
  } catch (e) {
    logger.error('[CERT] Error generando asistencia:', e.message, e.stack);
    res.status(500).json({ error: safeError(e, 'Error generando certificado: ') });
  }
});

/** POST /api/certificados/comprobante-servicios — genera PDF comprobante FOMAG */
router.post('/certificados/comprobante-servicios', requireAuth, (req, res, next) => {
  const origen = String(req.body?.origen || '').trim().toLowerCase();
  if (origen === 'electro') {
    return requirePermiso('electro.ver')(req, res, next);
  }
  if (origen === 'medica') {
    return requirePermiso('agenda.ver')(req, res, next);
  }
  return res.status(400).json({ error: 'Origen inválido (medica o electro)' });
}, async (req, res) => {
  try {
    const validacion = validarPayloadComprobanteServicios(req.body);
    if (validacion.error) return res.status(400).json({ error: validacion.error });

    const datos = await procesarImagenesFirma(validacion.data);
    const fondo = getComprobanteServiciosFondo();
    const html = buildComprobanteServiciosHtml(datos, fondo);
    const pdf = await renderHtmlToPdf(html);

    const doc = validacion.data.paciente_documento.replace(/\D/g, '') || 'sin_doc';
    const filename = `comprobante_servicios_${doc}.pdf`;

    logger.info('[CERT] Comprobante servicios generado', {
      origen: req.body?.origen,
      documento: validacion.data.paciente_documento,
      usuario: req.session?.usuario
    });

    res.contentType('application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdf);
  } catch (e) {
    logger.error('[CERT] Error generando comprobante servicios:', e.message, e.stack);
    res.status(500).json({ error: safeError(e, 'Error generando comprobante: ') });
  }
});

/** GET /api/certificados/persona-fidu/:documento — lookup en base anexo (certificado/comprobante/anexo) */
router.get('/certificados/persona-fidu/:documento', requireAuth, requirePersonaFiduLectura, async (req, res) => {
  try {
    const contexto = parseContextoPersonaFidu(req.query?.contexto);
    const result = await buscarPersonaFiduPorDocumento(db, req.params.documento, contexto);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json(result);
  } catch (e) {
    logger.error('[CERT] persona-fidu GET:', e.message);
    res.status(500).json({ error: safeError(e, 'Error consultando paciente: ') });
  }
});

/** PUT /api/certificados/persona-fidu — alta/actualización parcial en base anexo */
router.put('/certificados/persona-fidu', requireAuth, requirePersonaFiduLectura, async (req, res) => {
  try {
    const contexto = parseContextoPersonaFidu(req.body?.contexto);
    const result = await guardarPersonaFiduMerge(db, req.body || {}, contexto);
    res.json(result);
  } catch (e) {
    if (e.message === 'Número de documento requerido') {
      return res.status(400).json({ error: e.message });
    }
    logger.error('[CERT] persona-fidu PUT:', e.message);
    res.status(500).json({ error: safeError(e, 'Error guardando paciente: ') });
  }
});

module.exports = router;
