'use strict';

const express = require('express');
const router = express.Router();
const puppeteer = require('puppeteer-core');
const logger = require('../utils/logger');
const {
  requireAuth, requirePermiso, safeError
} = require('../middleware/index');
const {
  getPuppeteerLaunchOptions,
  getCertificadoAsistenciaFondo
} = require('../utils/puppeteer-utils');
const {
  validarPayloadCertificado,
  buildCertificadoAsistenciaHtml
} = require('../utils/certificado-asistencia');

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
  let browser = null;
  try {
    const validacion = validarPayloadCertificado(req.body);
    if (validacion.error) return res.status(400).json({ error: validacion.error });

    const fondo = getCertificadoAsistenciaFondo();
    const html = buildCertificadoAsistenciaHtml(validacion.data, fondo);

    const launchOptions = getPuppeteerLaunchOptions();
    browser = await puppeteer.launch(launchOptions);
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', bottom: '0', left: '0', right: '0' }
    });
    await browser.close();
    browser = null;

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
    if (browser) await browser.close().catch(() => {});
    logger.error('[CERT] Error generando asistencia:', e.message);
    res.status(500).json({ error: safeError(e, 'Error generando certificado: ') });
  }
});

module.exports = router;
