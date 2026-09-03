/**
 * Parser y normalización de nombres de archivo PDX por tipo de carpeta.
 */

const {
  detectarTemaCarpeta,
  normalizarTexto,
  esTemaConsultaMedica
} = require('./soportes-temas');
const {
  normalizarNumeroDocumentoPdx,
  normalizarTipoDocumentoPdx,
  normalizarParDocumentoPdx,
  numeroDocumentoValidoPdx,
  detectarTipoDocumentoEnTexto,
  esSegmentoDocumento
} = require('./soportes-pdx-documento');

const SEP = '\\s*-\\s*';

/** VTM / EEG / PSG mínimo: Apellidos, Nombres   YYYY-MM-DD.pdf */
const RE_SIMPLE_MIN = /^(.+?),\s*(.+?)\s+(\d{4}-\d{2}-\d{2})(?:\s+.+)?\.pdf$/i;

/** ORDEN + HC - APELLIDOS - NOMBRES - TIPO DOC - DOCUMENTO - FECHA - ESTUDIO.pdf */
const RE_ORDEN_HC = new RegExp(
  `^ORDEN\\s*\\+\\s*HC${SEP}(.+?)${SEP}(.+?)${SEP}(.+?)${SEP}([\\d.\\-]+)${SEP}(\\d{4}-\\d{2}-\\d{2})${SEP}(.+?)\\.pdf$`,
  'i'
);

/** COMPROBANTE - APELLIDOS - NOMBRES - TIPO DOC - DOCUMENTO - FECHA - ESTUDIO.pdf */
const RE_COMPROBANTE = new RegExp(
  `^COMPROBANTE${SEP}(.+?)${SEP}(.+?)${SEP}(.+?)${SEP}([\\d.\\-]+)${SEP}(\\d{4}-\\d{2}-\\d{2})${SEP}(.+?)\\.pdf$`,
  'i'
);

/** CONSENTIMIENTO - APELLIDOS - NOMBRES - TIPO DOC - DOCUMENTO - FECHA - ESTUDIO.pdf */
const RE_CONSENTIMIENTO = new RegExp(
  `^CONSENTIMIENTO${SEP}(.+?)${SEP}(.+?)${SEP}(.+?)${SEP}([\\d.\\-]+)${SEP}(\\d{4}-\\d{2}-\\d{2})${SEP}(.+?)\\.pdf$`,
  'i'
);

const FORMATOS_AYUDA = {
  vtm: {
    pattern: 'Apellidos, Nombres   YYYY-MM-DD.pdf',
    ejemplo: 'García López, Juan Carlos   2026-05-27.pdf',
    nota: 'El número de documento es obligatorio al subir (solo dígitos, 4 a 20). Al descargar se añade el tipo de estudio (VTM) al nombre.'
  },
  eeg: {
    pattern: 'Apellidos, Nombres   YYYY-MM-DD.pdf',
    ejemplo: 'García López, Juan Carlos   2026-05-27.pdf',
    nota: 'El número de documento es obligatorio al subir (solo dígitos, 4 a 20). Al descargar se añade el tipo de estudio (EEG) al nombre.'
  },
  psg: {
    pattern: 'Apellidos, Nombres   YYYY-MM-DD.pdf',
    ejemplo: 'García López, Juan Carlos   2026-05-27.pdf',
    nota: 'El número de documento es obligatorio al subir (solo dígitos). Separe con espacios (no use guiones entre campos). Al descargar se añade el tipo PSG según la carpeta.'
  },
  actigrafia: {
    pattern: 'Apellidos, Nombres   YYYY-MM-DD.pdf',
    ejemplo: 'García López, Juan Carlos   2026-05-27.pdf',
    nota: 'El número de documento es obligatorio al subir (solo dígitos, 4 a 20). Al descargar se añade el tipo de estudio al nombre.'
  },
  latencia: {
    pattern: 'Apellidos, Nombres   YYYY-MM-DD.pdf',
    ejemplo: 'García López, Juan Carlos   2026-05-27.pdf',
    nota: 'El número de documento es obligatorio al subir (solo dígitos, 4 a 20). Al descargar se añade el tipo de estudio (latencia múltiple) al nombre.'
  },
  ordenes: {
    pattern: 'ORDEN + HC APELLIDOS NOMBRES TIPO DOC (CC, TI…) DOCUMENTO (solo números) FECHA TIPO DE ESTUDIO.pdf',
    ejemplo: 'ORDEN + HC García López Juan Carlos CC 1234567890 2026-05-27 PSG Basal.pdf',
    nota: 'Tipo de documento: 2 letras (CC, TI, RC…). Número: solo dígitos, sin puntos ni guiones. Separe los campos con espacios (no use guiones entre campos).'
  },
  comprobantes: {
    pattern: 'COMPROBANTE APELLIDOS NOMBRES TIPO DOC (CC, TI…) DOCUMENTO (solo números) FECHA TIPO DE ESTUDIO.pdf',
    ejemplo: 'COMPROBANTE García López Juan Carlos CC 1234567890 2026-05-27 PSG Basal.pdf',
    nota: 'Tipo de documento: 2 letras (CC, TI, RC…). Número: solo dígitos. Separe los campos con espacios (no use guiones entre campos).'
  },
  consentimientos: {
    pattern: 'CONSENTIMIENTO APELLIDOS NOMBRES TIPO DOC (CC, TI…) DOCUMENTO (solo números) FECHA TIPO DE ESTUDIO.pdf',
    ejemplo: 'CONSENTIMIENTO García López Juan Carlos CC 1234567890 2026-05-27 PSG Basal.pdf',
    nota: 'Tipo: 2 letras; documento: solo números. El nombre guardado empieza por CONSENTIMIENTO. Separe los campos con espacios (no use guiones entre campos).'
  },
  comprobantes_consulta_medica: {
    pattern: 'COMPROBANTE NOMBRES APELLIDOS YYYY-MM-DD ESPECIALIDAD TIPO DE CONSULTA.pdf',
    ejemplo: 'COMPROBANTE Juan Carlos García López 2026-05-27 Neurología Control.pdf',
    nota: 'Sin número de documento. Indique especialidad y tipo de consulta; puede subir varios comprobantes del mismo paciente en el mismo día si el tipo de consulta es distinto.'
  },
  ordenes_consulta_medica: {
    pattern: 'ORDEN + HC NOMBRES APELLIDOS YYYY-MM-DD ESPECIALIDAD.pdf',
    ejemplo: 'ORDEN + HC Juan Carlos García López 2026-05-27 Neurología.pdf',
    nota: 'Sin documento. Use especialidad (Neurología, Epileptología…). Puede subir 2+ PDF (orden y HC) para unificarlos.'
  },
  neutral: {
    pattern: 'Apellidos, Nombres   YYYY-MM-DD.pdf',
    ejemplo: 'García López, Juan Carlos   2026-05-27.pdf'
  }
};

function ayudaFormatoPorTema(tema) {
  return FORMATOS_AYUDA[tema] || FORMATOS_AYUDA.neutral;
}

function mensajeErrorFormato(tema) {
  const ayuda = ayudaFormatoPorTema(tema);
  return `El archivo no cumple la estructura requerida. Formato: ${ayuda.pattern}`;
}

function normalizarNombreBusqueda(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolverEstudioDesdeLista(texto, estudios) {
  const raw = String(texto || '').trim();
  if (!raw) return raw;
  const norm = (s) => String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
  const n = norm(raw);
  const lista = Array.isArray(estudios) ? estudios : [];
  const exact = lista.find((e) => norm(e.nombre) === n);
  if (exact) return exact.nombre;
  const partial = lista.find((e) => {
    const en = norm(e.nombre);
    return en && (n.includes(en) || en.includes(n));
  });
  return partial ? partial.nombre : raw;
}

/** Tras la fecha: especialidad (lista) + resto como tipo de consulta. */
function separarEspecialidadYTipoConsulta(after, especialidades = []) {
  const raw = String(after || '').trim();
  if (!raw) return { estudio: '', tipo_consulta: '' };

  const norm = (s) => String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

  const lista = (Array.isArray(especialidades) ? especialidades : [])
    .map((e) => (typeof e === 'string' ? { nombre: e } : e))
    .filter((e) => e?.nombre)
    .sort((a, b) => String(b.nombre).length - String(a.nombre).length);

  const nRaw = norm(raw);
  for (const esp of lista) {
    const nom = String(esp.nombre).trim();
    const nEsp = norm(nom);
    if (!nEsp) continue;
    if (nRaw === nEsp) return { estudio: nom, tipo_consulta: '' };
    if (nRaw.startsWith(`${nEsp} `) || nRaw.startsWith(`${nEsp}-`)) {
      const rest = raw.slice(nom.length).replace(/^[\s\-–]+/, '').trim();
      return { estudio: nom, tipo_consulta: rest };
    }
  }

  return { estudio: raw, tipo_consulta: '' };
}

const PSG_TIPOS_ESTUDIO = ['PSG Básica', 'PSG CPAP', 'PSG BPAP', 'PSG Basal'];

function inferirEstudioPsgDesdeCarpeta(nombreCarpeta) {
  const u = normalizarTexto(nombreCarpeta);
  if (u.includes('cpap')) return 'PSG CPAP';
  if (u.includes('bpap')) return 'PSG BPAP';
  if (u.includes('basal') || u.includes('basica')) return 'PSG Basal';
  return 'PSG Básica';
}

function estudioPsgReconocido(texto) {
  if (!texto || !String(texto).trim()) return false;
  const u = normalizarTexto(texto);
  if (u.includes('cpap')) return true;
  if (u.includes('bpap')) return true;
  if (u.includes('basal') || u.includes('basica')) return true;
  return false;
}

function esTemaEstructurado(tema) {
  return ['ordenes', 'comprobantes', 'consentimientos', 'comprobantes_consulta_medica', 'ordenes_consulta_medica'].includes(tema);
}

function esTemaEstructuradoConDocumento(tema) {
  return ['ordenes', 'comprobantes', 'consentimientos'].includes(tema);
}

function esTemaPsgReporte(tema) {
  return tema === 'psg';
}

function esTemaFormatoGuionesCompleto(tema) {
  return esTemaEstructurado(tema);
}

function esTemaReporteClinico(tema) {
  return ['vtm', 'eeg', 'psg', 'actigrafia', 'latencia'].includes(tema);
}

function fechaDmyValida(d, m) {
  const day = parseInt(d, 10);
  const month = parseInt(m, 10);
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

/** Busca fecha ISO (YYYY-MM-DD) o latina (DD-MM-YYYY / DD-MM-YY) en un texto. */
function buscarFechaEnTextoPdx(texto) {
  const t = String(texto || '');
  let m = t.match(/(\d{4}-\d{2}-\d{2})/);
  if (m) return { fecha: m[1], index: m.index, raw: m[0] };
  m = t.match(/\b(\d{1,2})-(\d{1,2})-(\d{4})\b/);
  if (m && fechaDmyValida(m[1], m[2])) {
    const fecha = `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
    return { fecha, index: m.index, raw: m[0] };
  }
  m = t.match(/\b(\d{1,2})-(\d{1,2})-(\d{2})\b/);
  if (m && fechaDmyValida(m[1], m[2])) {
    const yy = parseInt(m[3], 10);
    const year = yy >= 50 ? 1900 + yy : 2000 + yy;
    const fecha = `${year}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
    return { fecha, index: m.index, raw: m[0] };
  }
  return null;
}

function quitarPrefijosEstructuradosInicio(texto) {
  let t = String(texto || '').trim();
  while (t) {
    const original = t;
    t = t
      .replace(/^(?:ORDEN\s*\+\s*HC|ORDEN|COMPROBANTE|CONSENTIMIENTO|HC)\b[\s\-.]*/i, '')
      .trim();
    if (t === original) break;
  }
  return t;
}

/** Quita prefijos ORDEN/COMPROBANTE/CONSENTIMIENTO al inicio de tokens (parseo tolerante). */
function quitarPrefijosCruzadosPdx(tokens) {
  let i = 0;
  while (i < tokens.length) {
    const u = String(tokens[i] || '').toUpperCase();
    if (u === 'ORDEN' || u === 'COMPROBANTE' || u === 'CONSENTIMIENTO' || u === '+' || u === 'HC') {
      i++;
      continue;
    }
    break;
  }
  return tokens.slice(i);
}

/**
 * Extrae campos de órdenes/comprobantes/consentimientos token a token
 * (sin depender de guiones ni de posiciones fijas por palabra).
 */
function extraerCamposTokenizadosEstructurados(tokens, estudios = []) {
  const toks = quitarPrefijosCruzadosPdx(Array.isArray(tokens) ? tokens : []);
  const out = {
    apellidos: '',
    nombres: '',
    tipo_documento: 'CC',
    paciente_documento: '',
    fecha_estudio: '',
    estudio_texto: ''
  };
  if (!toks.length) return out;

  let tipoIdx = -1;
  for (let i = 0; i < toks.length; i++) {
    if (detectarTipoDocumentoEnTexto(toks[i])) {
      tipoIdx = i;
      break;
    }
  }

  if (tipoIdx >= 0) {
    out.tipo_documento = normalizarTipoDocumentoPdx(toks[tipoIdx]);
    if (tipoIdx + 1 < toks.length && esSegmentoDocumento(toks[tipoIdx + 1])) {
      out.paciente_documento = normalizarNumeroDocumentoPdx(toks[tipoIdx + 1]);
    }
  } else {
    for (let i = toks.length - 1; i >= 0; i--) {
      if (!esSegmentoDocumento(toks[i])) continue;
      out.paciente_documento = normalizarNumeroDocumentoPdx(toks[i]);
      if (i > 0 && detectarTipoDocumentoEnTexto(toks[i - 1])) {
        out.tipo_documento = normalizarTipoDocumentoPdx(toks[i - 1]);
        tipoIdx = i - 1;
      }
      break;
    }
  }

  let fechaIdx = -1;
  for (let i = 0; i < toks.length; i++) {
    const hit = buscarFechaEnTextoPdx(toks[i]);
    if (hit) {
      out.fecha_estudio = hit.fecha;
      fechaIdx = i;
      break;
    }
  }

  const nameEnd = tipoIdx >= 0 ? tipoIdx : (fechaIdx >= 0 ? fechaIdx : toks.length);
  const nameTokens = toks.slice(0, Math.max(0, nameEnd));
  if (nameTokens.length >= 2) {
    const mid = Math.ceil(nameTokens.length / 2);
    out.apellidos = nameTokens.slice(0, mid).join(' ');
    out.nombres = nameTokens.slice(mid).join(' ');
  } else if (nameTokens.length === 1) {
    out.apellidos = nameTokens[0];
  }

  if (fechaIdx >= 0 && fechaIdx + 1 < toks.length) {
    out.estudio_texto = toks.slice(fechaIdx + 1).join(' ');
  } else if (tipoIdx >= 0) {
    const restStart = out.paciente_documento ? tipoIdx + 2 : tipoIdx + 1;
    if (restStart < toks.length) {
      out.estudio_texto = toks.slice(restStart).join(' ');
    }
  }
  if (out.estudio_texto) {
    out.estudio_texto = resolverEstudioDesdeLista(out.estudio_texto, estudios) || out.estudio_texto;
  }

  return out;
}

/** Segmentos separados por guión con espacios (no parte de fechas ni horas 21-21-12). */
function splitSegmentosGuionesEspaciados(texto) {
  return String(texto || '')
    .split(/\s+-\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function splitPartesNombreGuiones(originalName) {
  return splitPartesNombreArchivo(originalName);
}

/** Partes del nombre: guiones con espacios o, si no hay guiones, segmentación por fecha. */
function splitPartesNombreArchivo(originalName) {
  const sinPdf = String(originalName || '').trim().replace(/\.pdf$/i, '');
  if (/\s+-\s+/.test(sinPdf)) {
    return splitSegmentosGuionesEspaciados(sinPdf);
  }
  const fechaMatch = buscarFechaEnTextoPdx(sinPdf);
  if (!fechaMatch) {
    return sinPdf.split(/\s+/).filter(Boolean);
  }
  const fecha = fechaMatch.fecha;
  const idx = fechaMatch.index;
  const rawFechaLen = String(fechaMatch.raw || fecha).length;
  let before = sinPdf.slice(0, idx).replace(/[\s\-.]+$/,'').trim();
  const after = sinPdf.slice(idx + rawFechaLen).replace(/^[\s\-.]+/,'').trim();
  const parts = [];
  if (/^ORDEN\s*\+\s*HC/i.test(before)) {
    parts.push('ORDEN + HC');
    before = before.replace(/^ORDEN\s*\+\s*HC[\s\-.]*/i, '').trim();
  } else if (/^COMPROBANTE/i.test(before)) {
    parts.push('COMPROBANTE');
    before = before.replace(/^COMPROBANTE[\s\-.]*/i, '').trim();
  } else if (/^CONSENTIMIENTO/i.test(before)) {
    parts.push('CONSENTIMIENTO');
    before = before.replace(/^CONSENTIMIENTO[\s\-.]*/i, '').trim();
  }
  if (before.includes(' - ')) {
    parts.push(...splitSegmentosGuionesEspaciados(before));
  } else if (before.includes(',')) {
    const c = before.indexOf(',');
    parts.push(before.slice(0, c).trim(), before.slice(c + 1).trim());
  } else if (before) {
    parts.push(before);
  }
  parts.push(fecha);
  if (after) parts.push(after);
  return parts.filter(Boolean);
}

function separarNombreCompletoConsultaMedica(texto) {
  const t = quitarPrefijosEstructuradosInicio(String(texto || '').replace(/[\s\-.]+$/,'').trim());
  if (!t) return { nombres: '', apellidos: '' };
  if (t.includes(' - ')) {
    const parts = splitSegmentosGuionesEspaciados(t);
    if (parts.length >= 2) {
      return { nombres: parts[0], apellidos: parts.slice(1).join(' - ') };
    }
  }
  if (t.includes(',')) {
    const c = t.indexOf(',');
    return { apellidos: t.slice(0, c).trim(), nombres: t.slice(c + 1).trim() };
  }
  const tokens = t.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return { nombres: t, apellidos: '' };
  const mid = Math.ceil(tokens.length / 2);
  return {
    nombres: tokens.slice(0, mid).join(' '),
    apellidos: tokens.slice(mid).join(' ')
  };
}

/** Nombres primero, apellidos después (consultas médicas). */
function extraerNombreApellidoConsultaMedica(texto) {
  return separarNombreCompletoConsultaMedica(texto);
}

function extraerCamposEstructuradosAntesFecha(before) {
  let t = quitarPrefijosEstructuradosInicio(String(before || '').trim());
  if (!t) {
    return { apellidos: '', nombres: '', tipo_documento: 'CC', paciente_documento: '' };
  }
  if (t.includes(' - ')) {
    const parts = splitSegmentosGuionesEspaciados(t);
    if (parts.length >= 4) {
      const doc = normalizarParDocumentoPdx(parts[2], parts[3]);
      return {
        apellidos: parts[0],
        nombres: parts[1],
        tipo_documento: doc.tipo_documento,
        paciente_documento: doc.paciente_documento
      };
    }
    if (parts.length === 3 && esSegmentoDocumento(parts[2])) {
      return {
        apellidos: parts[0],
        nombres: parts[1],
        tipo_documento: 'CC',
        paciente_documento: normalizarNumeroDocumentoPdx(parts[2])
      };
    }
    if (parts.length === 2) {
      return { apellidos: parts[0], nombres: parts[1], tipo_documento: 'CC', paciente_documento: '' };
    }
  }
  const tokens = t.split(/\s+/).filter(Boolean);
  let docIdx = -1;
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (esSegmentoDocumento(tokens[i])) {
      docIdx = i;
      break;
    }
  }
  if (docIdx >= 2) {
    const paciente_documento = normalizarNumeroDocumentoPdx(tokens[docIdx]);
    const tipoSeg = tokens[docIdx - 1];
    const tipo_documento = normalizarTipoDocumentoPdx(tipoSeg);
    const nameEnd = detectarTipoDocumentoEnTexto(tipoSeg) ? docIdx - 1 : docIdx;
    const nameTokens = tokens.slice(0, nameEnd);
    if (nameTokens.length >= 2) {
      const mid = Math.ceil(nameTokens.length / 2);
      return {
        apellidos: nameTokens.slice(0, mid).join(' '),
        nombres: nameTokens.slice(mid).join(' '),
        tipo_documento,
        paciente_documento
      };
    }
  }
  const na = extraerNombreApellidoConsultaMedica(t);
  return {
    apellidos: na.apellidos,
    nombres: na.nombres,
    tipo_documento: 'CC',
    paciente_documento: ''
  };
}

function parseNombreEstructuradoDesdeFecha(tema, originalName, estudios = []) {
  const base = normalizarNombreParaParseo(originalName);
  const fechaMatch = buscarFechaEnTextoPdx(base);
  if (!fechaMatch) return { ok: false, original: base };

  const fecha = fechaMatch.fecha;
  const sinPdf = base.replace(/\.pdf$/i, '');
  const rawFechaLen = String(fechaMatch.raw || fecha).length;
  let after = sinPdf.slice(fechaMatch.index + rawFechaLen).replace(/^[\s\-.]+/,'').trim();
  let before = sinPdf.slice(0, fechaMatch.index).replace(/[\s\-.]+$/,'').trim();

  before = quitarPrefijosEstructuradosInicio(before);

  if (esTemaConsultaMedica(tema)) {
    const { nombres, apellidos } = extraerNombreApellidoConsultaMedica(before);
    if (!nombres || !apellidos) return { ok: false, original: base };

    let estudio = '';
    let tipo_consulta = '';
    if (tema === 'comprobantes_consulta_medica') {
      const split = separarEspecialidadYTipoConsulta(after, estudios);
      estudio = split.estudio;
      tipo_consulta = split.tipo_consulta;
    } else {
      estudio = resolverEstudioDesdeLista(after, estudios) || after.trim();
    }
    if (!estudio) return { ok: false, original: base };

    const partsNorm = {
      nombres,
      apellidos,
      tipo_documento: '',
      paciente_documento: '',
      fecha,
      estudio,
      tipo_consulta,
      formato: tema
    };
    if (tema === 'comprobantes_consulta_medica') {
      partsNorm.nombre_display = normalizarNombreComprobanteConsultaMedica(partsNorm);
    } else {
      partsNorm.nombre_display = normalizarNombreOrdenHcConsultaMedica(partsNorm);
    }
    return buildStructuredOk(base, partsNorm);
  }

  const estudio = resolverEstudioDesdeLista(after, estudios) || after.trim();
  if (!estudio) return { ok: false, original: base };

  const campos = extraerCamposEstructuradosAntesFecha(before);
  if (!campos.apellidos || !campos.nombres || !campos.paciente_documento) {
    return { ok: false, original: base };
  }
  const partsNorm = {
    apellidos: campos.apellidos,
    nombres: campos.nombres,
    tipo_documento: campos.tipo_documento,
    paciente_documento: campos.paciente_documento,
    fecha,
    estudio,
    formato: tema
  };
  if (tema === 'ordenes') {
    partsNorm.nombre_display = normalizarNombreOrdenHc(partsNorm);
  } else if (tema === 'comprobantes') {
    partsNorm.nombre_display = normalizarNombreComprobante(partsNorm);
  } else if (tema === 'consentimientos') {
    partsNorm.nombre_display = normalizarNombreConsentimiento(partsNorm);
  } else {
    return { ok: false, original: base };
  }
  return buildStructuredOk(base, partsNorm);
}

function documentoValidoPsg(doc) {
  return numeroDocumentoValidoPdx(doc);
}

function inferirEstudioDesdeCarpeta(carpeta) {
  const nombre = carpeta?.nombre_display || carpeta || '';
  const tema = detectarTemaCarpeta(nombre);
  if (tema === 'eeg') return 'EEG';
  if (tema === 'vtm') return 'VTM';
  if (tema === 'actigrafia') return 'Actigrafía';
  if (tema === 'latencia') return 'Prueba de latencia múltiple del sueño';
  if (tema === 'psg') return inferirEstudioPsgDesdeCarpeta(nombre);
  return '';
}

function finishSimpleParse(base, apellidos, nombres, fecha, tail = {}) {
  if (!apellidos || !nombres || !fecha) {
    return { ok: false, original: base, error: mensajeErrorFormato('neutral') };
  }
  let marca_tiempo = tail.marca_tiempo || '';
  let sufijo_numero = tail.sufijo_numero || '';
  let estudio_texto = tail.estudio_texto || '';
  if (!estudio_texto && !marca_tiempo && !sufijo_numero) {
    const fechaHit = buscarFechaEnTextoPdx(base);
    const rest = fechaHit
      ? base.slice(fechaHit.index + String(fechaHit.raw || fechaHit.fecha).length).replace(/\.pdf$/i, '').trim()
      : '';
    if (rest) {
      const ext = rest.match(/^([\d-]+)\s+(\d+)\.\s*(.+)$/i);
      if (ext) {
        marca_tiempo = ext[1].trim();
        sufijo_numero = ext[2].trim();
        estudio_texto = ext[3].trim();
      } else if (rest.includes(' - ')) {
        const ap = splitSegmentosGuionesEspaciados(rest);
        if (ap.length) {
          estudio_texto = ap[ap.length - 1].trim();
          if (ap.length > 1) marca_tiempo = ap.slice(0, -1).join(' - ');
        }
      } else {
        estudio_texto = rest.replace(/^\d+\.\s*/, '').trim();
      }
    }
  }
  const pacienteNombre = `${apellidos}, ${nombres}`;
  return {
    ok: true,
    original: base,
    apellidos,
    nombres,
    paciente_nombre: pacienteNombre,
    paciente_nombre_norm: normalizarNombreBusqueda(pacienteNombre),
    paciente_documento: '',
    tipo_documento: '',
    fecha_estudio: fecha,
    marca_tiempo,
    sufijo_numero,
    estudio_texto,
    formato: 'simple'
  };
}

function parseRestoDespuesFecha(afterFecha) {
  if (!afterFecha) return {};
  const ext = afterFecha.match(/^([\d-]+)\s+(\d+)\.\s*(.+)$/i);
  if (ext) {
    return { marca_tiempo: ext[1].trim(), sufijo_numero: ext[2].trim(), estudio_texto: ext[3].trim() };
  }
  const ap = splitSegmentosGuionesEspaciados(afterFecha);
  if (!ap.length) return { estudio_texto: afterFecha.replace(/^\d+\.\s*/, '').trim() };
  return {
    estudio_texto: ap[ap.length - 1].trim(),
    marca_tiempo: ap.length > 1 ? ap.slice(0, -1).join(' - ') : ''
  };
}

function parseNombreSimpleDesdeFecha(originalName) {
  const base = normalizarNombreParaParseo(originalName);
  const fechaMatch = buscarFechaEnTextoPdx(base);
  if (!fechaMatch) {
    return { ok: false, original: base, error: mensajeErrorFormato('neutral') };
  }
  const fecha = fechaMatch.fecha;
  const sinPdf = base.replace(/\.pdf$/i, '');
  const rawFechaLen = String(fechaMatch.raw || fecha).length;
  const beforeFecha = sinPdf.slice(0, fechaMatch.index).replace(/[\s\-–]+$/,'').trim();
  const afterFecha = sinPdf.slice(fechaMatch.index + rawFechaLen).replace(/^[\s\-–]+/,'').trim();

  let apellidos = '';
  let nombres = '';
  if (beforeFecha.includes(',')) {
    const c = beforeFecha.indexOf(',');
    apellidos = beforeFecha.slice(0, c).trim();
    nombres = beforeFecha.slice(c + 1).trim();
  } else if (beforeFecha) {
    const extra = extraerNombresAntesDeFecha(beforeFecha);
    apellidos = extra.apellidos;
    nombres = extra.nombres;
  }

  const tail = parseRestoDespuesFecha(afterFecha);
  return finishSimpleParse(base, apellidos, nombres, fecha, tail);
}

function parseNombreSimple(originalName) {
  const base = String(originalName || '').trim();
  const m = base.match(RE_SIMPLE_MIN);
  if (m) {
    return finishSimpleParse(base, m[1].trim(), m[2].trim(), m[3]);
  }
  const mGuion = base.match(/^([^-]+?)\s+-\s+([^-]+?)\s+-\s+(\d{4}-\d{2}-\d{2})(?:\s+.+)?\.pdf$/i);
  if (mGuion && !esSegmentoDocumento(mGuion[1]) && !esSegmentoDocumento(mGuion[2])) {
    return finishSimpleParse(base, mGuion[1].trim(), mGuion[2].trim(), mGuion[3]);
  }
  return parseNombreSimpleDesdeFecha(originalName);
}

function buildStructuredOk(original, parts) {
  const doc = normalizarParDocumentoPdx(parts.tipo_documento, parts.paciente_documento);
  const pacienteNombre = `${parts.apellidos}, ${parts.nombres}`;
  const tipoConsulta = String(parts.tipo_consulta || '').trim();
  return {
    ok: true,
    original,
    apellidos: parts.apellidos,
    nombres: parts.nombres,
    paciente_nombre: pacienteNombre,
    paciente_nombre_norm: normalizarNombreBusqueda(pacienteNombre),
    paciente_documento: doc.paciente_documento,
    tipo_documento: doc.tipo_documento,
    fecha_estudio: parts.fecha,
    marca_tiempo: tipoConsulta,
    tipo_consulta: tipoConsulta,
    sufijo_numero: '',
    estudio_texto: parts.estudio,
    estudio_tema: detectarTemaCarpeta(parts.estudio),
    formato: parts.formato,
    nombre_display: parts.nombre_display
  };
}

function parseNombreOrdenHcConsultaMedica(originalName, tiposLista = []) {
  const base = normalizarNombreParaParseo(originalName);
  const desdeFecha = parseNombreEstructuradoDesdeFecha('ordenes_consulta_medica', base, tiposLista);
  if (desdeFecha.ok) return desdeFecha;
  return { ok: false, original: base, error: mensajeErrorFormato('ordenes_consulta_medica') };
}

function parseNombreComprobanteConsultaMedica(originalName, tiposLista = []) {
  const base = normalizarNombreParaParseo(originalName);
  const desdeFecha = parseNombreEstructuradoDesdeFecha('comprobantes_consulta_medica', base, tiposLista);
  if (desdeFecha.ok) return desdeFecha;
  return { ok: false, original: base, error: mensajeErrorFormato('comprobantes_consulta_medica') };
}

function parseNombreOrdenHc(originalName, estudios = []) {
  const base = normalizarNombreParaParseo(originalName);
  const desdeFecha = parseNombreEstructuradoDesdeFecha('ordenes', base, estudios);
  if (desdeFecha.ok) return desdeFecha;
  const flex = parseNombreEstructuradoFallback('ordenes', base, estudios);
  if (flex.ok) return flex;
  const m = base.match(RE_ORDEN_HC);
  if (!m) {
    return { ok: false, original: base, error: mensajeErrorFormato('ordenes') };
  }
  const apellidos = m[1].trim();
  const nombres = m[2].trim();
  const { tipo_documento, paciente_documento } = normalizarParDocumentoPdx(m[3], m[4]);
  const fecha = m[5];
  const estudio = resolverEstudioDesdeLista(m[6].trim(), estudios);
  return buildStructuredOk(base, {
    apellidos,
    nombres,
    tipo_documento,
    paciente_documento,
    fecha,
    estudio,
    formato: 'ordenes',
    nombre_display: normalizarNombreOrdenHc({ apellidos, nombres, tipo_documento, paciente_documento, fecha, estudio })
  });
}

function parseNombreComprobante(originalName, estudios = []) {
  const base = normalizarNombreParaParseo(originalName);
  const desdeFecha = parseNombreEstructuradoDesdeFecha('comprobantes', base, estudios);
  if (desdeFecha.ok) return desdeFecha;
  const flex = parseNombreEstructuradoFallback('comprobantes', base, estudios);
  if (flex.ok) return flex;
  const m = base.match(RE_COMPROBANTE);
  if (!m) {
    return { ok: false, original: base, error: mensajeErrorFormato('comprobantes') };
  }
  const apellidos = m[1].trim();
  const nombres = m[2].trim();
  const { tipo_documento, paciente_documento } = normalizarParDocumentoPdx(m[3], m[4]);
  const fecha = m[5];
  const estudio = resolverEstudioDesdeLista(m[6].trim(), estudios);
  return buildStructuredOk(base, {
    apellidos,
    nombres,
    tipo_documento,
    paciente_documento,
    fecha,
    estudio,
    formato: 'comprobantes',
    nombre_display: normalizarNombreComprobante({ apellidos, nombres, tipo_documento, paciente_documento, fecha, estudio })
  });
}

function parseNombreConsentimiento(originalName, estudios = []) {
  const base = normalizarNombreParaParseo(originalName);
  const desdeFecha = parseNombreEstructuradoDesdeFecha('consentimientos', base, estudios);
  if (desdeFecha.ok) return desdeFecha;
  const flex = parseNombreEstructuradoFallback('consentimientos', base, estudios);
  if (flex.ok) return flex;
  const m = base.match(RE_CONSENTIMIENTO);
  if (!m) {
    return { ok: false, original: base, error: mensajeErrorFormato('consentimientos') };
  }
  const apellidos = m[1].trim();
  const nombres = m[2].trim();
  const { tipo_documento, paciente_documento } = normalizarParDocumentoPdx(m[3], m[4]);
  const fecha = m[5];
  const estudio = resolverEstudioDesdeLista(m[6].trim(), estudios);
  return buildStructuredOk(base, {
    apellidos,
    nombres,
    tipo_documento,
    paciente_documento,
    fecha,
    estudio,
    formato: 'consentimientos',
    nombre_display: normalizarNombreConsentimiento({ apellidos, nombres, tipo_documento, paciente_documento, fecha, estudio })
  });
}

function normalizarNombreOrdenHc(parts) {
  const { apellidos, nombres, tipo_documento, paciente_documento, fecha, estudio } = parts;
  return `ORDEN + HC ${apellidos} ${nombres} ${tipo_documento} ${paciente_documento} ${fecha} ${estudio}.pdf`;
}

function normalizarNombreComprobante(parts) {
  const { apellidos, nombres, tipo_documento, paciente_documento, fecha, estudio } = parts;
  return `COMPROBANTE ${apellidos} ${nombres} ${tipo_documento} ${paciente_documento} ${fecha} ${estudio}.pdf`;
}

function normalizarNombreConsentimiento(parts) {
  const { apellidos, nombres, tipo_documento, paciente_documento, fecha, estudio } = parts;
  return `CONSENTIMIENTO ${apellidos} ${nombres} ${tipo_documento} ${paciente_documento} ${fecha} ${estudio}.pdf`;
}

function normalizarNombreComprobanteConsultaMedica(parts) {
  const { nombres, apellidos, fecha, estudio, tipo_consulta } = parts;
  const tipo = String(tipo_consulta || '').trim();
  const tipoPart = tipo ? ` ${tipo}` : '';
  return `COMPROBANTE ${nombres} ${apellidos} ${fecha} ${estudio}${tipoPart}.pdf`;
}

function normalizarNombreOrdenHcConsultaMedica(parts) {
  const { nombres, apellidos, fecha, estudio } = parts;
  return `ORDEN + HC ${nombres} ${apellidos} ${fecha} ${estudio}.pdf`;
}

/** PSG reportes (legacy con documento): normaliza al formato simple sin guiones. */
function normalizarNombrePsg(parts) {
  const { nombres, apellidos, fecha, estudio, extras } = parts;
  const mid = extras ? ` ${extras}` : '';
  return `${apellidos}, ${nombres}   ${fecha}${mid} ${estudio}.pdf`;
}

function parseNombrePsg(originalName, estudios = []) {
  const base = String(originalName || '').trim();
  const fechaMatch = base.match(/(\d{4}-\d{2}-\d{2})/);
  if (!fechaMatch) {
    return { ok: false, original: base, error: mensajeErrorFormato('psg') };
  }
  const fecha = fechaMatch[1];
  const sinPdf = base.replace(/\.pdf$/i, '');
  const idxFecha = fechaMatch.index;
  const beforeFecha = sinPdf.slice(0, idxFecha).replace(/\s*-\s*$/,'').trim();
  const afterFecha = sinPdf.slice(idxFecha + fecha.length).replace(/^\s*-\s*/, '').trim();

  const beforeParts = splitSegmentosGuionesEspaciados(beforeFecha);
  if (beforeParts.length < 3) {
    return { ok: false, original: base, error: mensajeErrorFormato('psg') };
  }
  const nombres = beforeParts[0];
  const apellidos = beforeParts[1];
  const paciente_documento = normalizarNumeroDocumentoPdx(beforeParts[2]);
  if (!documentoValidoPsg(paciente_documento)) {
    return { ok: false, original: base, error: mensajeErrorFormato('psg') };
  }

  const afterParts = afterFecha ? splitSegmentosGuionesEspaciados(afterFecha) : [];
  if (!afterParts.length) {
    return { ok: false, original: base, error: mensajeErrorFormato('psg') };
  }
  const estudioRaw = afterParts[afterParts.length - 1];
  const extras = afterParts.length > 1 ? afterParts.slice(0, -1).join(' - ') : '';
  const estudio = resolverEstudioDesdeLista(estudioRaw, estudios) || estudioRaw.trim();
  const pacienteNombre = `${apellidos}, ${nombres}`;
  return {
    ok: true,
    original: base,
    apellidos,
    nombres,
    paciente_nombre: pacienteNombre,
    paciente_nombre_norm: normalizarNombreBusqueda(pacienteNombre),
    paciente_documento,
    tipo_documento: '',
    fecha_estudio: fecha,
    marca_tiempo: extras,
    sufijo_numero: '',
    estudio_texto: estudio,
    formato: 'psg',
    nombre_display: normalizarNombrePsg({ nombres, apellidos, paciente_documento, fecha, estudio, extras })
  };
}

function parseNombrePorCarpeta(originalName, carpeta, estudios = []) {
  const tema = detectarTemaCarpeta(carpeta?.nombre_display || '', originalName);
  switch (tema) {
    case 'ordenes_consulta_medica':
      return parseNombreOrdenHcConsultaMedica(originalName, estudios);
    case 'comprobantes_consulta_medica':
      return parseNombreComprobanteConsultaMedica(originalName, estudios);
    case 'ordenes':
      return parseNombreOrdenHc(originalName, estudios);
    case 'comprobantes':
      return parseNombreComprobante(originalName, estudios);
    case 'consentimientos':
      return parseNombreConsentimiento(originalName, estudios);
    default: {
      const parsed = parseNombreSimple(originalName);
      if (parsed.ok && esTemaReporteClinico(tema) && !parsed.estudio_texto) {
        parsed.estudio_texto = inferirEstudioDesdeCarpeta(carpeta);
      }
      return parsed;
    }
  }
}

function parseNombreReporte(originalName) {
  return parseNombreSimple(originalName);
}

function parseNombrePdx(originalName) {
  return parseNombreSimple(originalName);
}

function parseNombreOrdenes(originalName, estudios) {
  return parseNombreOrdenHc(originalName, estudios);
}

function nombreYaContieneEstudio(nombreArchivo, estudio) {
  const n = normalizarTexto(String(nombreArchivo || '').replace(/\.pdf$/i, ''));
  const e = normalizarTexto(estudio);
  return e && n.includes(e);
}

function appendEstudioAlNombre(nombreArchivo, estudio) {
  const base = String(nombreArchivo || '').trim();
  if (!estudio) return base;
  if (nombreYaContieneEstudio(base, estudio)) return base;
  const sinPdf = base.replace(/\.pdf$/i, '');
  return `${sinPdf} ${estudio}.pdf`;
}

function nombreArchivoDescarga(meta, carpeta) {
  const original = meta.nombre_archivo_original || meta.original || '';
  const tema = detectarTemaCarpeta(carpeta?.nombre_display || '');
  if (esTemaFormatoGuionesCompleto(tema)) {
    return meta.nombre_display || meta.nombre_archivo_display || original;
  }
  const estudio = meta.estudio_texto || inferirEstudioDesdeCarpeta(carpeta);
  if (!estudio) return original;
  return appendEstudioAlNombre(original, estudio);
}

function fechaEnPeriodo(fechaStr, periodoYYYYMM) {
  if (!fechaStr || !periodoYYYYMM) return true;
  return String(fechaStr).slice(0, 7) === periodoYYYYMM;
}

function temaCoincideCarpeta(estudioTema, carpetaTema) {
  if (!estudioTema || !carpetaTema) return true;
  if (carpetaTema === 'neutral' || estudioTema === 'neutral') return true;
  if (esTemaEstructurado(carpetaTema)) return true;
  if (['vtm', 'eeg', 'psg', 'actigrafia'].includes(carpetaTema)) return true;
  return estudioTema === carpetaTema;
}

function normalizarNombreParaParseo(originalName) {
  return String(originalName || '')
    .trim()
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ');
}

/**
 * Parser por segmentos ( - ) cuando el regex estricto no coincide.
 */
function parseNombreEstructuradoFallback(tema, originalName, estudios = []) {
  const base = normalizarNombreParaParseo(originalName);
  if (esTemaConsultaMedica(tema)) {
    return parseNombreEstructuradoDesdeFecha(tema, base, estudios);
  }
  const parts = splitPartesNombreArchivo(base);
  let offset = 0;
  if (tema === 'ordenes' && parts[0] && /orden/i.test(parts[0])) offset = 1;
  if (tema === 'comprobantes' && parts[0] && /comprobante/i.test(parts[0])) offset = 1;
  if (tema === 'consentimientos' && parts[0] && /consentimiento/i.test(parts[0])) offset = 1;
  const need = 6;
  if (parts.length < offset + need) {
    return parseNombreEstructuradoDesdeFecha(tema, base, estudios);
  }

  const apellidos = parts[offset];
  const nombres = parts[offset + 1];
  const { tipo_documento, paciente_documento } = normalizarParDocumentoPdx(parts[offset + 2], parts[offset + 3]);
  const fecha = parts[offset + 4];
  const estudioRaw = parts[offset + 5];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return { ok: false, original: base };
  if (!apellidos || !nombres || !numeroDocumentoValidoPdx(paciente_documento) || !estudioRaw) {
    return { ok: false, original: base };
  }

  const estudio = resolverEstudioDesdeLista(estudioRaw, estudios) || estudioRaw.trim();
  const partsNorm = {
    apellidos,
    nombres,
    tipo_documento,
    paciente_documento,
    fecha,
    estudio,
    formato: tema
  };
  if (tema === 'ordenes') {
    partsNorm.nombre_display = normalizarNombreOrdenHc(partsNorm);
  } else if (tema === 'comprobantes') {
    partsNorm.nombre_display = normalizarNombreComprobante(partsNorm);
  } else if (tema === 'consentimientos') {
    partsNorm.nombre_display = normalizarNombreConsentimiento(partsNorm);
  } else {
    return { ok: false, original: base };
  }
  return buildStructuredOk(base, partsNorm);
}

function extraerNombresAntesDeFecha(beforeFecha) {
  const t = String(beforeFecha || '').trim();
  if (!t) return { apellidos: '', nombres: '' };
  if (t.includes(',')) {
    const c = t.indexOf(',');
    return { apellidos: t.slice(0, c).trim(), nombres: t.slice(c + 1).trim() };
  }
  if (t.includes(' - ')) {
    const rawParts = splitSegmentosGuionesEspaciados(t);
    const parts = rawParts.filter((p) => !esSegmentoDocumento(p));
    if (parts.length >= 2) {
      const hayDocumento = rawParts.some((p) => esSegmentoDocumento(p));
      if (hayDocumento && parts.length === 2) {
        return { nombres: parts[0], apellidos: parts[1] };
      }
      return { apellidos: parts[0], nombres: parts.slice(1).join(' - ') };
    }
  }
  const tokens = t.split(/\s+/).filter(Boolean);
  if (tokens.length >= 2) {
    const mid = Math.ceil(tokens.length / 2);
    return {
      apellidos: tokens.slice(0, mid).join(' '),
      nombres: tokens.slice(mid).join(' ')
    };
  }
  return { apellidos: tokens[0] || '', nombres: '' };
}

/** Intenta leer datos del nombre aunque no cumpla el formato completo. */
function extraerDatosParcialesNombre(originalName, carpeta, estudios = []) {
  const base = normalizarNombreParaParseo(originalName);
  const tema = detectarTemaCarpeta(carpeta?.nombre_display || '', originalName);
  const parcial = {
    apellidos: '',
    nombres: '',
    tipo_documento: 'CC',
    paciente_documento: '',
    fecha_estudio: '',
    estudio_texto: '',
    tipo_consulta: ''
  };

  const fechaHit = buscarFechaEnTextoPdx(base);
  if (fechaHit) parcial.fecha_estudio = fechaHit.fecha;

  if (esTemaReporteClinico(tema) || tema === 'neutral') {
    const parsedTry = parseNombreSimple(base);
    if (parsedTry.ok) {
      parcial.apellidos = parsedTry.apellidos;
      parcial.nombres = parsedTry.nombres;
      parcial.fecha_estudio = parsedTry.fecha_estudio;
      parcial.estudio_texto = parsedTry.estudio_texto;
    } else if (fechaHit) {
      const sinPdf = base.replace(/\.pdf$/i, '');
      const rawFechaLen = String(fechaHit.raw || fechaHit.fecha).length;
      const beforeFecha = sinPdf.slice(0, fechaHit.index).replace(/[\s\-–]+$/,'').trim();
      const nombresExtra = extraerNombresAntesDeFecha(beforeFecha);
      parcial.apellidos = parcial.apellidos || nombresExtra.apellidos;
      parcial.nombres = parcial.nombres || nombresExtra.nombres;
      const afterFecha = sinPdf.slice(fechaHit.index + rawFechaLen).replace(/^[\s\-–]+/,'').trim();
      const tail = parseRestoDespuesFecha(afterFecha);
      if (tail.estudio_texto) parcial.estudio_texto = tail.estudio_texto;
    }
    if (tema === 'psg' && !estudioPsgReconocido(parcial.estudio_texto)) {
      parcial.estudio_texto = inferirEstudioDesdeCarpeta(carpeta?.nombre_display || '');
    } else if (!parcial.estudio_texto && ['vtm', 'eeg', 'actigrafia'].includes(tema)) {
      parcial.estudio_texto = inferirEstudioDesdeCarpeta(carpeta);
    }
  } else if (esTemaConsultaMedica(tema)) {
    const parsedTry = parseNombreEstructuradoDesdeFecha(tema, base, estudios);
    if (parsedTry.ok) {
      parcial.nombres = parsedTry.nombres;
      parcial.apellidos = parsedTry.apellidos;
      parcial.fecha_estudio = parsedTry.fecha_estudio;
      parcial.estudio_texto = parsedTry.estudio_texto;
      parcial.tipo_consulta = parsedTry.tipo_consulta || parsedTry.marca_tiempo || '';
    } else if (fechaHit) {
      const sinPdf = base.replace(/\.pdf$/i, '');
      const rawFechaLen = String(fechaHit.raw || fechaHit.fecha).length;
      let before = sinPdf.slice(0, fechaHit.index).replace(/[\s\-.]+$/,'').trim();
      before = before.replace(/^(?:ORDEN\s*\+\s*HC|ORDEN|COMPROBANTE|CONSENTIMIENTO)[\s\-.]*/i, '').trim();
      const na = extraerNombreApellidoConsultaMedica(before);
      parcial.nombres = na.nombres;
      parcial.apellidos = na.apellidos;
      const after = sinPdf.slice(fechaHit.index + rawFechaLen).replace(/^[\s\-.]+/,'').trim();
      if (after) {
        if (tema === 'comprobantes_consulta_medica') {
          const split = separarEspecialidadYTipoConsulta(after, estudios);
          parcial.estudio_texto = split.estudio;
          parcial.tipo_consulta = split.tipo_consulta;
        } else {
          parcial.estudio_texto = resolverEstudioDesdeLista(after, estudios) || after;
        }
      }
    }
  } else if (esTemaEstructurado(tema)) {
    const tokens = base.replace(/\.pdf$/i, '').split(/\s+/).filter(Boolean);
    const tokenized = extraerCamposTokenizadosEstructurados(tokens, estudios);
    parcial.apellidos = tokenized.apellidos;
    parcial.nombres = tokenized.nombres;
    parcial.tipo_documento = tokenized.tipo_documento;
    parcial.paciente_documento = tokenized.paciente_documento;
    parcial.fecha_estudio = tokenized.fecha_estudio || parcial.fecha_estudio;
    parcial.estudio_texto = tokenized.estudio_texto;
  }

  return parcial;
}

/**
 * Analiza si el nombre requiere modal de corrección antes de subir.
 * Criterio: campos mínimos por tipo de carpeta (no solo coincidencia estricta con regex).
 */
function analizarNombreArchivo(originalName, carpeta, estudios = []) {
  const { evaluarCamposMinimos, ayudaCamposPorTema } = require('./soportes-pdx-campos');
  const tema = detectarTemaCarpeta(carpeta?.nombre_display || '', originalName);
  const parsed = parseNombrePorCarpeta(originalName, carpeta, estudios);
  const parcial = extraerDatosParcialesNombre(originalName, carpeta, estudios);
  const evaluacion = evaluarCamposMinimos(tema, parcial, parsed, carpeta);
  const ayudaCampos = ayudaCamposPorTema(tema);

  if (!evaluacion.completo) {
    const faltan = evaluacion.faltantes.map((c) => c.label).join(', ');
    return {
      ok: false,
      requiere_correccion: true,
      motivo: 'campos_faltantes',
      error: `Complete los datos obligatorios: ${faltan}`,
      tema,
      parcial: evaluacion.datos,
      parsed: parsed.ok ? parsed : null,
      campos: evaluacion.campos,
      ayuda_campos: ayudaCampos,
      formato_completo: parsed.ok
    };
  }

  const datos = evaluacion.datos;
  let finalParsed = parsed;
  if (!parsed.ok) {
    const meta = buildMetaDesdeCamposManuales(originalName, {
      confirmacion_manual: '1',
      apellidos: datos.apellidos,
      nombres: datos.nombres,
      paciente_nombre_completo: datos.paciente_nombre_completo,
      tipo_documento: datos.tipo_documento,
      paciente_documento: datos.paciente_documento,
      fecha_estudio: datos.fecha_estudio,
      estudio_texto: datos.estudio_texto,
      tipo_consulta: datos.tipo_consulta
    }, { ...carpeta, _estudiosLista: estudios });
    if (!meta.ok) {
      return {
        ok: false,
        requiere_correccion: true,
        motivo: 'formato',
        error: meta.error || mensajeErrorFormato(tema),
        tema,
        parcial: datos,
        parsed: parsed.ok ? parsed : null,
        campos: evaluacion.campos,
        ayuda_campos: ayudaCampos
      };
    }
    finalParsed = meta;
  } else if (tema === 'psg' && datos.estudio_texto && !parsed.estudio_texto) {
    finalParsed = { ...parsed, estudio_texto: datos.estudio_texto };
  }

  return {
    ok: true,
    requiere_correccion: false,
    tema,
    parsed: finalParsed,
    parcial: datos,
    campos: evaluacion.campos,
    ayuda_campos: ayudaCampos,
    formato_completo: parsed.ok
  };
}

function buildMetaDesdeCamposManuales(originalName, body, carpeta) {
  const estudios = carpeta?._estudiosLista || [];
  const tema = detectarTemaCarpeta(carpeta?.nombre_display || '', originalName);
  let apellidos = String(body.apellidos || '').trim();
  let nombres = String(body.nombres || '').trim();
  const fecha = String(body.fecha_estudio || '').trim();
  const { tipo_documento, paciente_documento } = normalizarParDocumentoPdx(
    body.tipo_documento,
    body.paciente_documento
  );

  if (esTemaConsultaMedica(tema)) {
    const nombreCompleto = String(body.paciente_nombre_completo || '').trim();
    if (nombreCompleto) {
      const split = separarNombreCompletoConsultaMedica(nombreCompleto);
      if (split.nombres && split.apellidos) {
        nombres = split.nombres;
        apellidos = split.apellidos;
      } else if (split.nombres || split.apellidos) {
        nombres = split.nombres || nombres;
        apellidos = split.apellidos || apellidos;
      }
    }
  }

  if (!apellidos || !nombres) {
    return {
      ok: false,
      error: esTemaConsultaMedica(tema)
        ? 'El nombre completo del paciente es obligatorio'
        : 'Apellidos y nombres son obligatorios'
    };
  }
  if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return { ok: false, error: 'La fecha del estudio es obligatoria (YYYY-MM-DD)' };
  }

  let estudio = String(body.estudio_texto || '').trim();
  if (tema === 'ordenes_consulta_medica') {
    estudio = resolverEstudioDesdeLista(estudio, estudios);
    if (!estudio) return { ok: false, error: 'Indique la especialidad' };
  } else if (tema === 'comprobantes_consulta_medica') {
    estudio = resolverEstudioDesdeLista(estudio, estudios);
    if (!estudio) return { ok: false, error: 'Indique la especialidad' };
  } else if (esTemaEstructuradoConDocumento(tema)) {
    estudio = resolverEstudioDesdeLista(estudio, estudios);
    if (!estudio) return { ok: false, error: 'Indique el tipo de examen' };
    if (!numeroDocumentoValidoPdx(paciente_documento)) {
      return { ok: false, error: 'El número de documento es obligatorio (solo dígitos, 4 a 20)' };
    }
  } else if (tema === 'psg') {
    if (!numeroDocumentoValidoPdx(paciente_documento)) {
      return { ok: false, error: 'El número de documento es obligatorio (solo dígitos, 4 a 20)' };
    }
    estudio = resolverEstudioDesdeLista(estudio, estudios) || estudio;
    if (!estudio) estudio = inferirEstudioDesdeCarpeta(carpeta);
    if (!estudioPsgReconocido(estudio)) {
      return { ok: false, error: 'Seleccione el tipo de estudio PSG (Básica, CPAP o BPAP)' };
    }
  } else if (['vtm', 'eeg', 'actigrafia', 'latencia'].includes(tema)) {
    if (!numeroDocumentoValidoPdx(paciente_documento)) {
      return { ok: false, error: 'El número de documento es obligatorio (solo dígitos, 4 a 20)' };
    }
    if (!estudio) estudio = inferirEstudioDesdeCarpeta(carpeta);
  }

  const pacienteNombre = `${apellidos}, ${nombres}`;
  const base = {
    ok: true,
    original: String(originalName || '').trim(),
    apellidos,
    nombres,
    paciente_nombre: pacienteNombre,
    paciente_nombre_norm: normalizarNombreBusqueda(pacienteNombre),
    paciente_documento,
    tipo_documento,
    fecha_estudio: fecha,
    marca_tiempo: '',
    sufijo_numero: '',
    estudio_texto: estudio,
    estudio_tema: detectarTemaCarpeta(estudio || tema),
    nombre_archivo_original: originalName,
    confirmacion_manual: true
  };

  if (tema === 'ordenes') {
    base.formato = 'ordenes';
    base.nombre_display = normalizarNombreOrdenHc({
      apellidos, nombres, tipo_documento, paciente_documento, fecha, estudio
    });
  } else if (tema === 'comprobantes') {
    base.formato = 'comprobantes';
    base.nombre_display = normalizarNombreComprobante({
      apellidos, nombres, tipo_documento, paciente_documento, fecha, estudio
    });
  } else if (tema === 'comprobantes_consulta_medica') {
    const tipoConsulta = String(body.tipo_consulta || body.marca_tiempo || '').trim();
    if (!tipoConsulta) return { ok: false, error: 'Indique el tipo de consulta' };
    base.marca_tiempo = tipoConsulta;
    base.formato = 'comprobantes_consulta_medica';
    base.nombre_display = normalizarNombreComprobanteConsultaMedica({
      nombres, apellidos, fecha, estudio, tipo_consulta: tipoConsulta
    });
  } else if (tema === 'ordenes_consulta_medica') {
    base.formato = 'ordenes_consulta_medica';
    base.nombre_display = normalizarNombreOrdenHcConsultaMedica({
      nombres, apellidos, fecha, estudio
    });
  } else if (tema === 'consentimientos') {
    base.formato = 'consentimientos';
    base.nombre_display = normalizarNombreConsentimiento({
      apellidos, nombres, tipo_documento, paciente_documento, fecha, estudio
    });
  } else {
    base.formato = 'simple';
    if (tema === 'psg') {
      base.marca_tiempo = String(body.extras_opcionales || body.marca_tiempo || '').trim();
    }
  }

  base.nombre_archivo_display = nombreArchivoDescarga(base, carpeta);
  return base;
}

function mergeMetaPdxDesdeRow(row, carpetaCtx) {
  const original = String(row?.nombre_archivo_original || '').trim();
  const reparsed = original ? parseNombrePorCarpeta(original, carpetaCtx) : { ok: false };
  const rp = reparsed.ok ? reparsed : {};
  return {
    original,
    reparsed,
    apellidos: String(row?.apellidos || rp.apellidos || '').trim(),
    nombres: String(row?.nombres || rp.nombres || '').trim(),
    fecha: row?.fecha_estudio
      ? String(row.fecha_estudio).slice(0, 10)
      : (rp.fecha_estudio ? String(rp.fecha_estudio).slice(0, 10) : ''),
    doc: normalizarNumeroDocumentoPdx(row?.paciente_documento || rp.paciente_documento || ''),
    tipoDoc: normalizarTipoDocumentoPdx(rp.tipo_documento || row?.tipo_documento || 'CC'),
    estudio: String(row?.estudio_texto || rp.estudio_texto || '').trim(),
    marca_tiempo: String(row?.marca_tiempo || rp.marca_tiempo || '').trim(),
    sufijo_numero: String(row?.sufijo_numero || rp.sufijo_numero || '').trim()
  };
}

function buildNombreReporteClinicoDescarga(meta, carpetaCtx, tema) {
  const { apellidos, nombres, fecha, estudio, marca_tiempo, sufijo_numero, original } = meta;
  let estudioFin = estudio;
  if (!estudioFin) estudioFin = inferirEstudioDesdeCarpeta(carpetaCtx);
  if (tema === 'psg' && estudioFin && !estudioPsgReconocido(estudioFin)) {
    estudioFin = inferirEstudioPsgDesdeCarpeta(carpetaCtx.nombre_display || '') || estudioFin;
  }

  let base = original;
  if (apellidos && nombres && fecha) {
    if (marca_tiempo && sufijo_numero && estudioFin) {
      base = `${apellidos}, ${nombres}   ${fecha}   ${marca_tiempo}   ${sufijo_numero}.   ${estudioFin}.pdf`;
    } else {
      base = `${apellidos}, ${nombres}   ${fecha}.pdf`;
    }
  }

  return nombreArchivoDescarga({
    nombre_archivo_original: base,
    original: base,
    estudio_texto: estudioFin
  }, carpetaCtx);
}

/**
 * Nombre de archivo al descargar, según tema de carpeta y metadatos guardados.
 * VTM, EEG, PSG, actigrafía, órdenes, comprobantes y consentimientos.
 */
function buildNombreDescargaPdxDesdeRow(row, carpeta) {
  const carpetaCtx = typeof carpeta === 'string'
    ? { nombre_display: carpeta }
    : (carpeta || { nombre_display: row?.carpeta_nombre || '' });
  const tema = detectarTemaCarpeta(carpetaCtx.nombre_display || '');
  const m = mergeMetaPdxDesdeRow(row, carpetaCtx);

  let estudio = m.estudio;
  if (!estudio && m.reparsed.ok && m.reparsed.estudio_texto) {
    estudio = String(m.reparsed.estudio_texto).trim();
  }
  if (!estudio && esTemaEstructurado(tema) && m.reparsed.ok) {
    estudio = String(m.reparsed.estudio_texto || '').trim();
  }

  const partsEstruct = {
    apellidos: m.apellidos,
    nombres: m.nombres,
    tipo_documento: m.tipoDoc,
    paciente_documento: m.doc,
    fecha: m.fecha,
    estudio: estudio || m.estudio
  };

  if (tema === 'ordenes' && partsEstruct.apellidos && partsEstruct.nombres && partsEstruct.fecha && partsEstruct.estudio && partsEstruct.paciente_documento) {
    return normalizarNombreOrdenHc(partsEstruct);
  }
  if (tema === 'comprobantes' && partsEstruct.apellidos && partsEstruct.nombres && partsEstruct.fecha && partsEstruct.estudio && partsEstruct.paciente_documento) {
    return normalizarNombreComprobante(partsEstruct);
  }
  if (tema === 'comprobantes_consulta_medica' && partsEstruct.nombres && partsEstruct.apellidos && partsEstruct.fecha && partsEstruct.estudio) {
    return normalizarNombreComprobanteConsultaMedica({
      nombres: partsEstruct.nombres,
      apellidos: partsEstruct.apellidos,
      fecha: partsEstruct.fecha,
      estudio: partsEstruct.estudio,
      tipo_consulta: partsEstruct.tipo_consulta || partsEstruct.marca_tiempo || ''
    });
  }
  if (tema === 'ordenes_consulta_medica' && partsEstruct.nombres && partsEstruct.apellidos && partsEstruct.fecha && partsEstruct.estudio) {
    return normalizarNombreOrdenHcConsultaMedica({
      nombres: partsEstruct.nombres,
      apellidos: partsEstruct.apellidos,
      fecha: partsEstruct.fecha,
      estudio: partsEstruct.estudio
    });
  }
  if (tema === 'consentimientos' && partsEstruct.apellidos && partsEstruct.nombres && partsEstruct.fecha && partsEstruct.estudio && partsEstruct.paciente_documento) {
    return normalizarNombreConsentimiento(partsEstruct);
  }

  if (esTemaEstructurado(tema) && m.reparsed.ok && m.reparsed.nombre_display) {
    return m.reparsed.nombre_display;
  }

  if (['vtm', 'eeg', 'psg', 'actigrafia', 'neutral'].includes(tema)) {
    return buildNombreReporteClinicoDescarga(m, carpetaCtx, tema);
  }

  if (m.reparsed.ok && m.reparsed.nombre_display) return m.reparsed.nombre_display;
  return row?.nombre_archivo_display || m.original || 'archivo.pdf';
}

module.exports = {
  RE_SIMPLE_MIN,
  RE_ORDEN_HC,
  RE_COMPROBANTE,
  RE_CONSENTIMIENTO,
  FORMATOS_AYUDA,
  ayudaFormatoPorTema,
  mensajeErrorFormato,
  parseNombrePorCarpeta,
  parseNombreSimple,
  parseNombreOrdenHc,
  parseNombreComprobante,
  parseNombreConsentimiento,
  parseNombreReporte,
  parseNombrePdx,
  parseNombreOrdenes,
  normalizarNombreOrdenHc,
  normalizarNombreComprobante,
  normalizarNombreConsentimiento,
  inferirEstudioDesdeCarpeta,
  inferirEstudioPsgDesdeCarpeta,
  PSG_TIPOS_ESTUDIO,
  estudioPsgReconocido,
  esTemaEstructurado,
  esTemaEstructuradoConDocumento,
  esTemaPsgReporte,
  esTemaFormatoGuionesCompleto,
  parseNombrePsg,
  normalizarNombrePsg,
  splitPartesNombreGuiones,
  splitPartesNombreArchivo,
  parseNombreComprobanteConsultaMedica,
  parseNombreOrdenHcConsultaMedica,
  normalizarNombreComprobanteConsultaMedica,
  normalizarNombreOrdenHcConsultaMedica,
  documentoValidoPsg,
  extraerDatosParcialesNombre,
  extraerNombresAntesDeFecha,
  extraerNombreApellidoConsultaMedica,
  separarNombreCompletoConsultaMedica,
  normalizarNombreParaParseo,
  analizarNombreArchivo,
  buildMetaDesdeCamposManuales,
  nombreArchivoDescarga,
  buildNombreDescargaPdxDesdeRow,
  mergeMetaPdxDesdeRow,
  appendEstudioAlNombre,
  normalizarNombreBusqueda,
  resolverEstudioDesdeLista,
  fechaEnPeriodo,
  temaCoincideCarpeta
};
