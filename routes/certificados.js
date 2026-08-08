'use strict';

const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const {
  requireAuth, requirePermiso, safeError
} = require('../middleware/index');
const {
  tryRenderHtmlToPdf,
  getCertificadoAsistenciaFondo,
  getComprobanteServiciosFondo
} = require('../utils/puppeteer-utils');
const { wrapHtmlDocumentoImprimible } = require('../utils/documento-imprimible');
const {
  validarPayloadCertificado,
  buildCertificadoAsistenciaHtml
} = require('../utils/certificado-asistencia');
const {
  validarPayloadComprobanteServicios,
  buildComprobanteServiciosHtml
} = require('../utils/comprobante-servicios');
const { procesarImagenesFirma } = require('../utils/comprobante-servicios-firma');
const { listarServiciosComprobante } = require('../utils/cups-comprobante-activos');
const { ensureChromiumReady } = require('../scripts/ensure-chromium');

let chromiumWarmupPromise = null;
function warmupChromiumOnce() {
  if (!chromiumWarmupPromise) {
    chromiumWarmupPromise = ensureChromiumReady({ install: true })
      .then(async (r) => {
        if (!r.ok) return { ok: false, error: r.error || 'Chrome no disponible' };
        try {
          const { getSharedBrowser } = require('../utils/puppeteer-utils');
          await getSharedBrowser();
        } catch (e) {
          logger.warn('[CERT] No se pudo precalentar navegador PDF:', e.message);
        }
        return { ok: true, cacheDir: r.cacheDir };
      })
      .catch((e) => ({
        ok: false,
        error: e.message
      }));
  }
  return chromiumWarmupPromise;
}
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

function requireCertificadoComprobante(req, res, next) {
  if (req.session?.rol === 'superadmin') return next();
  const perms = req.session?.permisos;
  const permisosOk = ['agenda.ver', 'electro.ver', 'modulo.anexo_fidu'];
  if (perms === null || perms === undefined) {
    if (req.session?.rol === 'admin' || req.session?.rol === 'administrador') return next();
    return next();
  }
  if (Array.isArray(perms) && permisosOk.some((p) => perms.includes(p))) return next();
  return res.status(403).json({ error: 'No tienes permiso para consultar el catálogo de servicios' });
}

async function responderDocumentoPdfOHtml(res, { html, titulo, filename, logLabel }) {
  const modo = String(process.env.CERTIFICADOS_PDF_MODE || '').trim().toLowerCase();
  if (modo !== 'html') {
    const t0 = Date.now();
    const chrome = await warmupChromiumOnce();
    if (!chrome.ok) {
      logger.warn(`[CERT] ${logLabel} Chrome no listo (${chrome.error || 'desconocido'}), intentando PDF igualmente`);
    }
    const resultado = await tryRenderHtmlToPdf(html);
    if (resultado.ok) {
      const ms = Date.now() - t0;
      res.contentType('application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('X-Documento-Modo', 'pdf');
      res.setHeader('X-Documento-Generacion-Ms', String(ms));
      logger.info(`[CERT] ${logLabel} PDF servidor en ${ms}ms`, { type: 'CERT_PDF', ms });
      return res.send(resultado.pdf);
    }
    logger.warn(`[CERT] ${logLabel} PDF en servidor no disponible, usando HTML imprimible:`, resultado.error);
  }

  const imprimible = wrapHtmlDocumentoImprimible(html, titulo);
  res.contentType('text/html; charset=utf-8');
  res.setHeader('X-Documento-Modo', 'html');
  return res.send(imprimible);
}

function buildAsistenciaPreview(reqBody) {
  const validacion = validarPayloadCertificado(reqBody);
  if (validacion.error) return { error: validacion.error };
  const fondo = getCertificadoAsistenciaFondo();
  const html = buildCertificadoAsistenciaHtml(validacion.data, fondo);
  const doc = validacion.data.paciente_documento.replace(/\D/g, '') || 'sin_doc';
  return {
    data: validacion.data,
    html,
    filename: `certificado_asistencia_${doc}.pdf`,
    titulo: 'Certificado de asistencia'
  };
}

async function buildComprobantePreview(reqBody) {
  const validacion = validarPayloadComprobanteServicios(reqBody);
  if (validacion.error) return { error: validacion.error };
  const datos = await procesarImagenesFirma(validacion.data);
  const fondo = getComprobanteServiciosFondo();
  const html = buildComprobanteServiciosHtml(datos, fondo);
  const doc = validacion.data.paciente_documento.replace(/\D/g, '') || 'sin_doc';
  return {
    data: validacion.data,
    html,
    filename: `comprobante_servicios_${doc}.pdf`,
    titulo: 'Comprobante de servicios FOMAG'
  };
}

/** POST /api/certificados/asistencia/preview — HTML para generador (sin Puppeteer) */
router.post('/certificados/asistencia/preview', requireAuth, (req, res, next) => {
  const origen = String(req.body?.origen || '').trim().toLowerCase();
  if (origen === 'electro') return requirePermiso('electro.ver')(req, res, next);
  if (origen === 'medica') return requirePermiso('agenda.ver')(req, res, next);
  return res.status(400).json({ error: 'Origen inválido (medica o electro)' });
}, async (req, res) => {
  try {
    const built = buildAsistenciaPreview(req.body);
    if (built.error) return res.status(400).json({ error: built.error });
    res.json({ html: built.html, filename: built.filename, titulo: built.titulo });
  } catch (e) {
    logger.error('[CERT] preview asistencia:', e.message);
    res.status(500).json({ error: safeError(e, 'Error generando vista previa: ') });
  }
});

/** POST /api/certificados/comprobante-servicios/preview */
router.post('/certificados/comprobante-servicios/preview', requireAuth, (req, res, next) => {
  const origen = String(req.body?.origen || '').trim().toLowerCase();
  if (origen === 'electro') return requirePermiso('electro.ver')(req, res, next);
  if (origen === 'medica') return requirePermiso('agenda.ver')(req, res, next);
  return res.status(400).json({ error: 'Origen inválido (medica o electro)' });
}, async (req, res) => {
  try {
    const built = await buildComprobantePreview(req.body);
    if (built.error) return res.status(400).json({ error: built.error });
    res.json({ html: built.html, filename: built.filename, titulo: built.titulo });
  } catch (e) {
    logger.error('[CERT] preview comprobante:', e.message);
    res.status(500).json({ error: safeError(e, 'Error generando vista previa: ') });
  }
});

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
    const built = buildAsistenciaPreview(req.body);
    if (built.error) return res.status(400).json({ error: built.error });

    logger.info('[CERT] Asistencia generada', {
      origen: req.body?.origen,
      documento: built.data.paciente_documento,
      usuario: req.session?.usuario
    });

    await responderDocumentoPdfOHtml(res, {
      html: built.html,
      titulo: built.titulo,
      filename: built.filename,
      logLabel: 'Asistencia'
    });
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
    const built = await buildComprobantePreview(req.body);
    if (built.error) return res.status(400).json({ error: built.error });

    logger.info('[CERT] Comprobante servicios generado', {
      origen: req.body?.origen,
      documento: built.data.paciente_documento,
      usuario: req.session?.usuario
    });

    await responderDocumentoPdfOHtml(res, {
      html: built.html,
      titulo: built.titulo,
      filename: built.filename,
      logLabel: 'Comprobante servicios'
    });
  } catch (e) {
    logger.error('[CERT] Error generando comprobante servicios:', e.message, e.stack);
    res.status(500).json({ error: safeError(e, 'Error generando comprobante: ') });
  }
});

/** GET /api/certificados/catalogo-servicios — sugerencias por origen (estudios, consultas o CUPS) */
router.get('/certificados/catalogo-servicios', requireAuth, requireCertificadoComprobante, async (req, res) => {
  try {
    const origen = String(req.query?.origen || '').trim().toLowerCase();
    if (origen === 'electro') {
      const rows = await db.query(
        'SELECT nombre FROM estudio_duraciones WHERE nombre IS NOT NULL AND TRIM(nombre) <> "" ORDER BY nombre ASC'
      );
      return res.json({
        ok: true,
        servicios: rows.map((r) => ({ codigo: '', nombre: String(r.nombre || '').trim() }))
      });
    }
    if (origen === 'medica') {
      const [tipos, cups] = await Promise.all([
        db.query('SELECT nombre FROM tipos_consulta WHERE activo = 1 ORDER BY nombre ASC'),
        listarServiciosComprobante(db)
      ]);
      const vistos = new Set();
      const servicios = [];
      tipos.forEach((r) => {
        const nombre = String(r.nombre || '').trim();
        if (!nombre || vistos.has(nombre.toLowerCase())) return;
        vistos.add(nombre.toLowerCase());
        servicios.push({ codigo: '', nombre });
      });
      cups.forEach((s) => {
        const nombre = String(s.nombre || '').trim();
        if (!nombre || vistos.has(nombre.toLowerCase())) return;
        vistos.add(nombre.toLowerCase());
        servicios.push({ codigo: s.codigo, nombre });
      });
      return res.json({ ok: true, servicios });
    }
    const servicios = await listarServiciosComprobante(db);
    res.json({ ok: true, servicios });
  } catch (e) {
    logger.error('[CERT] catalogo-servicios:', e.message);
    res.status(500).json({ error: safeError(e, 'Error cargando catálogo: ') });
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
