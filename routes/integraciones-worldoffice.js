/**
 * Integración World Office → RIPS JSON (API key, sin sesión).
 * Activar con WORLDOFFICE_RIPS_API_KEY en .env
 */
const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const { safeError } = require('../middleware/index');
const { getWorldOfficeRipsConfig, requireWorldOfficeRipsApiKey } = require('../middleware/api-key');
const { ingestRipsJson } = require('../utils/worldoffice-rips-ingest');

/** Estado público (no revela la clave; útil para monitoreo interno). */
router.get('/integraciones/worldoffice/status', (req, res) => {
  const cfg = getWorldOfficeRipsConfig();
  res.json({
    provider: 'worldoffice',
    integration: 'rips-json',
    configured: cfg.configured,
    enabled: cfg.enabled,
    auto_create_estructura: cfg.autoCreate,
    ip_allowlist: cfg.ipAllowlist.length > 0,
    auth: {
      header_api_key: 'X-API-Key',
      header_bearer: 'Authorization: Bearer <clave>'
    },
    endpoint_ingesta: 'POST /api/integraciones/worldoffice/rips',
    documentacion: 'docs/INTEGRACION-WORLDOFFICE-RIPS.md'
  });
});

/**
 * Contrato de ingesta (listo cuando World Office entregue API key y formato final).
 * Body JSON:
 * {
 *   "periodo": "2026-05",
 *   "nombre_carpeta_dia": "MAYO 1",
 *   "estado_facturacion": "facturados" | "a_facturar",
 *   "codigo_fe": "FE12",
 *   "contenido": { ... RIPS ... },
 *   "nombre_archivo": "opcional.json",
 *   "reemplazar": false
 * }
 */
router.post('/integraciones/worldoffice/rips', requireWorldOfficeRipsApiKey, async (req, res) => {
  try {
    const cfg = getWorldOfficeRipsConfig();
    const result = await ingestRipsJson(req.body || {}, { autoCreate: cfg.autoCreate });
    if (!result.ok) {
      return res.status(result.status || 400).json({
        error: result.error,
        code: 'INGEST_FAILED',
        ...(result.codigo_fe ? { codigo_fe: result.codigo_fe } : {})
      });
    }
    res.status(result.status || 201).json({
      ok: true,
      message: 'RIPS guardado en carpeta Soportes',
      ...result
    });
  } catch (e) {
    logger.error('[WORLDOFFICE] ingest rips:', e);
    res.status(500).json({ error: safeError(e), code: 'SERVER_ERROR' });
  }
});

module.exports = router;
