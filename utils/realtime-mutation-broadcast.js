'use strict';

/**
 * Tras un POST/PUT/PATCH/DELETE exitoso, avisa a los demás usuarios
 * para que recarguen el módulo que están viendo.
 */

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const SKIP_PATH_STARTS = [
  '/eventos/',
  '/login',
  '/logout',
  '/sesion',
  '/cambiar-contrasena',
  '/health',
  '/version',
  '/chat/',
  '/integraciones/'
];

const SKIP_PATH_INCLUDES = [
  '/preview',
  '/validar',
  '/descargar',
  '/zip',
  '/asistencia',
  '/comprobante-servicios',
  '/agenda/pdf'
];

function normalizeApiPath(req) {
  let p = String(req.originalUrl || req.url || req.path || '').split('?')[0];
  if (p.startsWith('/api/v1/appointments')) return '/turnos';
  if (p.startsWith('/api')) p = p.slice(4) || '/';
  if (!p.startsWith('/')) p = `/${p}`;
  return p;
}

function shouldSkipPath(path) {
  const p = String(path || '').toLowerCase();
  if (!p || p === '/') return true;
  if (SKIP_PATH_STARTS.some((s) => p === s.replace(/\/$/, '') || p.startsWith(s))) return true;
  if (SKIP_PATH_INCLUDES.some((s) => p.includes(s))) return true;
  return false;
}

function isSuccessJson(status, body) {
  if (Number(status) >= 400) return false;
  if (body == null || typeof body !== 'object') return true;
  if (body.ok === false) return false;
  if (body.error) return false;
  return true;
}

function inferModulo(path) {
  const p = String(path || '').toLowerCase();
  if (
    p.startsWith('/turnos')
    || p.startsWith('/doctor-')
    || p.includes('disponibilidad')
    || p.includes('dias-bloqueados')
  ) return 'agenda-medica';
  if (
    p.startsWith('/citas-electro')
    || p.startsWith('/electro')
    || p.startsWith('/equipos')
    || p.startsWith('/pacientes-espera')
  ) return 'electro';
  if (p.startsWith('/recibos') || p.startsWith('/servicios')) return 'recibos';
  if (p.startsWith('/usuarios')) return 'usuarios';
  if (p.startsWith('/soportes/pdx/papelera')) return 'papelera-pdx';
  if (p.startsWith('/soportes/pdx')) return 'reportes-pdx';
  if (p.startsWith('/soportes/armado')) return 'armado-soportes';
  if (p.startsWith('/anexo-fidu')) return 'anexo-fidu';
  if (p.startsWith('/backups')) return 'backup';
  if (
    p.startsWith('/admin/datos')
    || p.startsWith('/especialidades')
    || p.startsWith('/tipos-consulta')
    || p.startsWith('/entidades')
    || p.startsWith('/diagnosticos')
  ) return 'gestion-datos';
  if (p.startsWith('/pacientes')) return 'agenda-medica';
  if (p.startsWith('/llamado')) return 'llamado-pacientes';
  if (p.startsWith('/certificados')) return 'documentos-cita';
  if (p.startsWith('/chat')) return 'chat';
  return 'app';
}

function extraFromBody(body) {
  if (!body || typeof body !== 'object') return {};
  const out = {};
  const did = body.doctor_id != null ? body.doctor_id : body.doctorId;
  const n = parseInt(did, 10);
  if (Number.isFinite(n) && n > 0) out.doctor_id = n;

  const archivoId = body.archivo_id != null ? body.archivo_id : body.archivoId;
  const aid = parseInt(archivoId, 10);
  if (Number.isFinite(aid) && aid > 0) out.archivo_id = aid;

  const carpetaId = body.carpeta_id != null ? body.carpeta_id : body.carpetaId;
  const cid = parseInt(carpetaId, 10);
  if (Number.isFinite(cid) && cid > 0) out.carpeta_id = cid;

  const reg = body.registro;
  if (reg && typeof reg === 'object') {
    const raid = parseInt(reg.archivo_id, 10);
    if (Number.isFinite(raid) && raid > 0) out.archivo_id = raid;
  }

  const archivo = body.archivo;
  if (archivo && typeof archivo === 'object') {
    const arid = parseInt(archivo.id, 10);
    if (Number.isFinite(arid) && arid > 0) out.archivo_id = arid;
    const acid = parseInt(archivo.carpeta_id, 10);
    if (Number.isFinite(acid) && acid > 0) out.carpeta_id = acid;
  }

  return out;
}

function extraFromPath(path) {
  const out = {};
  const p = String(path || '');
  const archivo = p.match(/\/anexo-fidu\/archivos\/(\d+)/i);
  if (archivo) {
    const id = parseInt(archivo[1], 10);
    if (Number.isFinite(id) && id > 0) out.archivo_id = id;
  }
  const carpeta = p.match(/\/anexo-fidu\/carpetas\/(\d+)/i);
  if (carpeta) {
    const id = parseInt(carpeta[1], 10);
    if (Number.isFinite(id) && id > 0) out.carpeta_id = id;
  }
  return out;
}

function buildEventPayload(req, path, responseBody) {
  const method = String(req.method || '').toUpperCase();
  return {
    modulo: inferModulo(path),
    method,
    path: String(path || '').slice(0, 120),
    ...extraFromPath(path),
    ...extraFromBody(req.body),
    ...extraFromBody(responseBody)
  };
}

function shouldBroadcast(req, res, body) {
  const method = String(req.method || '').toUpperCase();
  if (!MUTATING.has(method)) return false;
  const path = normalizeApiPath(req);
  if (shouldSkipPath(path)) return false;
  return isSuccessJson(res.statusCode || 200, body);
}

function attachMutationBroadcast(app, emitFn) {
  if (!app || typeof emitFn !== 'function') return;
  app.use('/api', (req, res, next) => {
    const method = String(req.method || '').toUpperCase();
    if (!MUTATING.has(method)) return next();
    const origJson = res.json.bind(res);
    let emitted = false;
    res.json = function wrappedJson(body) {
      if (!emitted) {
        emitted = true;
        try {
          if (shouldBroadcast(req, res, body)) {
            emitFn('app:datos-actualizados', buildEventPayload(req, normalizeApiPath(req), body));
          }
        } catch (_) { /* noop */ }
      }
      return origJson(body);
    };
    next();
  });
}

module.exports = {
  MUTATING,
  normalizeApiPath,
  shouldSkipPath,
  isSuccessJson,
  inferModulo,
  shouldBroadcast,
  buildEventPayload,
  attachMutationBroadcast
};
