/**
 * Normalización de tipo y número de documento en carpetas PDX.
 * Número: solo dígitos (sin puntos, guiones ni espacios).
 * Tipo: códigos conocidos (CC, TI, RC, NUIP, …).
 */
const TIPOS_DOC = ['CC', 'TI', 'CE', 'PA', 'RC', 'NUIP', 'PEP', 'PT'];

const TIPOS_DOC_2_LETRAS = TIPOS_DOC.filter((t) => t.length === 2);

function normalizarNumeroDocumentoPdx(raw) {
  return String(raw || '').replace(/\D/g, '');
}

function numeroDocumentoValidoPdx(doc) {
  const n = normalizarNumeroDocumentoPdx(doc);
  return n.length >= 4 && n.length <= 20;
}

function detectarTipoDocumentoEnTexto(seg) {
  const raw = String(seg || '').trim();
  const u = raw.toUpperCase().replace(/\./g, '').replace(/\s+/g, '');
  if (TIPOS_DOC.includes(u)) return u;
  if (/^(CC|CEDULA|CIUDADANIA|CEDULA DE CIUDADANIA)$/.test(u)) return 'CC';
  if (/^(TI|TARJETA DE IDENTIDAD)$/.test(u)) return 'TI';
  if (/^(CE|CEDULA DE EXTRANJERIA)$/.test(u)) return 'CE';
  if (/^(PA|PASAPORTE)$/.test(u)) return 'PA';
  if (/^(RC|REGISTRO CIVIL)$/.test(u)) return 'RC';
  if (/^(NUIP)$/.test(u)) return 'NUIP';
  if (/^(PEP|PT)$/.test(u)) return u.split(' ')[0];
  const soloLetras = u.replace(/[^A-Z]/g, '');
  if (soloLetras.length >= 4 && TIPOS_DOC.includes(soloLetras.slice(0, 4))) return soloLetras.slice(0, 4);
  if (soloLetras.length >= 2 && TIPOS_DOC.includes(soloLetras.slice(0, 2))) return soloLetras.slice(0, 2);
  return '';
}

function normalizarTipoDocumentoPdx(raw) {
  const det = detectarTipoDocumentoEnTexto(raw);
  if (det) return det;
  const letters = String(raw || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (letters.length >= 2) {
    if (letters.length >= 4 && TIPOS_DOC.includes(letters.slice(0, 4))) return letters.slice(0, 4);
    if (TIPOS_DOC.includes(letters.slice(0, 2))) return letters.slice(0, 2);
  }
  return 'CC';
}

/** Segmento del nombre de archivo interpretado como número de documento (solo dígitos, 4–20). */
function esSegmentoDocumento(seg) {
  return numeroDocumentoValidoPdx(seg);
}

/** Segmento interpretado como tipo de documento (CC, TI, …). */
function esSegmentoTipoDocumento(seg) {
  const t = normalizarTipoDocumentoPdx(seg);
  return !!t && TIPOS_DOC.includes(t);
}

function normalizarParDocumentoPdx(tipoRaw, docRaw, { tipoPorDefecto = 'CC' } = {}) {
  const paciente_documento = normalizarNumeroDocumentoPdx(docRaw);
  let tipo_documento = normalizarTipoDocumentoPdx(tipoRaw);
  if (!tipo_documento && !paciente_documento) tipo_documento = tipoPorDefecto;
  else if (!tipo_documento && paciente_documento) tipo_documento = tipoPorDefecto;
  return { tipo_documento, paciente_documento };
}

module.exports = {
  TIPOS_DOC,
  TIPOS_DOC_2_LETRAS,
  normalizarNumeroDocumentoPdx,
  numeroDocumentoValidoPdx,
  normalizarTipoDocumentoPdx,
  detectarTipoDocumentoEnTexto,
  esSegmentoDocumento,
  esSegmentoTipoDocumento,
  normalizarParDocumentoPdx
};
