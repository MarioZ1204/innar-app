/**
 * Parser y normalización de nombres de archivo PDX por tipo de carpeta.
 */

const {
  detectarTemaCarpeta,
  normalizarTexto
} = require('./soportes-temas');

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

/** APELLIDOS - NOMBRES - TIPO DOC - DOCUMENTO - FECHA - ESTUDIO.pdf (consentimientos) */
const RE_CONSENTIMIENTO = new RegExp(
  `^(.+?)${SEP}(.+?)${SEP}(.+?)${SEP}([\\d.\\-]+)${SEP}(\\d{4}-\\d{2}-\\d{2})${SEP}(.+?)\\.pdf$`,
  'i'
);

const FORMATOS_AYUDA = {
  vtm: {
    pattern: 'Apellidos, Nombres   YYYY-MM-DD.pdf',
    ejemplo: 'García López, Juan Carlos   2026-05-27.pdf',
    nota: 'Al descargar se añade el tipo de estudio (VTM) al nombre del archivo.'
  },
  eeg: {
    pattern: 'Apellidos, Nombres   YYYY-MM-DD.pdf',
    ejemplo: 'García López, Juan Carlos   2026-05-27.pdf',
    nota: 'Al descargar se añade el tipo de estudio (EEG) al nombre del archivo.'
  },
  psg: {
    pattern: 'Apellidos, Nombres   YYYY-MM-DD.pdf',
    ejemplo: 'García López, Juan Carlos   2026-05-27.pdf',
    nota: 'Al descargar se añade el tipo de estudio (PSG Básica, PSG CPAP o PSG BPAP según la carpeta).'
  },
  actigrafia: {
    pattern: 'Apellidos, Nombres   YYYY-MM-DD.pdf',
    ejemplo: 'García López, Juan Carlos   2026-05-27.pdf',
    nota: 'Al descargar se añade el tipo de estudio al nombre del archivo.'
  },
  ordenes: {
    pattern: 'ORDEN + HC - APELLIDOS - NOMBRES - TIPO DE DOCUMENTO - DOCUMENTO - FECHA - TIPO DE ESTUDIO.pdf',
    ejemplo: 'ORDEN + HC - García López - Juan Carlos - CC - 1234567890 - 2026-05-27 - PSG Basal.pdf'
  },
  comprobantes: {
    pattern: 'COMPROBANTE - APELLIDOS - NOMBRES - TIPO DE DOCUMENTO - DOCUMENTO - FECHA - TIPO DE ESTUDIO.pdf',
    ejemplo: 'COMPROBANTE - García López - Juan Carlos - CC - 1234567890 - 2026-05-27 - PSG Basal.pdf'
  },
  consentimientos: {
    pattern: 'APELLIDOS - NOMBRES - TIPO DE DOCUMENTO - DOCUMENTO - FECHA - TIPO DE ESTUDIO.pdf',
    ejemplo: 'García López - Juan Carlos - CC - 1234567890 - 2026-05-27 - PSG Basal.pdf'
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
  return ['ordenes', 'comprobantes', 'consentimientos'].includes(tema);
}

function inferirEstudioDesdeCarpeta(carpeta) {
  const nombre = carpeta?.nombre_display || carpeta || '';
  const tema = detectarTemaCarpeta(nombre);
  if (tema === 'eeg') return 'EEG';
  if (tema === 'vtm') return 'VTM';
  if (tema === 'actigrafia') return 'Actigrafía';
  if (tema === 'psg') return inferirEstudioPsgDesdeCarpeta(nombre);
  return '';
}

function parseNombreSimple(originalName) {
  const base = String(originalName || '').trim();
  const m = base.match(RE_SIMPLE_MIN);
  if (!m) {
    return { ok: false, original: base, error: mensajeErrorFormato('neutral') };
  }
  const apellidos = m[1].trim();
  const nombres = m[2].trim();
  const fecha = m[3];
  let marca_tiempo = '';
  let sufijo_numero = '';
  let estudio_texto = '';
  const idx = base.toLowerCase().indexOf(fecha.toLowerCase());
  const rest = idx >= 0 ? base.slice(idx + fecha.length).replace(/\.pdf$/i, '').trim() : '';
  if (rest) {
    const ext = rest.match(/^([\d-]+)\s+(\d+)\.\s*(.+)$/i);
    if (ext) {
      marca_tiempo = ext[1].trim();
      sufijo_numero = ext[2].trim();
      estudio_texto = ext[3].trim();
    } else {
      estudio_texto = rest.replace(/^\d+\.\s*/, '').trim();
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

function buildStructuredOk(original, parts) {
  const pacienteNombre = `${parts.apellidos}, ${parts.nombres}`;
  return {
    ok: true,
    original,
    apellidos: parts.apellidos,
    nombres: parts.nombres,
    paciente_nombre: pacienteNombre,
    paciente_nombre_norm: normalizarNombreBusqueda(pacienteNombre),
    paciente_documento: parts.paciente_documento,
    tipo_documento: parts.tipo_documento,
    fecha_estudio: parts.fecha,
    marca_tiempo: '',
    sufijo_numero: '',
    estudio_texto: parts.estudio,
    estudio_tema: detectarTemaCarpeta(parts.estudio),
    formato: parts.formato,
    nombre_display: parts.nombre_display
  };
}

function parseNombreOrdenHc(originalName, estudios = []) {
  const base = String(originalName || '').trim();
  const m = base.match(RE_ORDEN_HC);
  if (!m) return { ok: false, original: base, error: mensajeErrorFormato('ordenes') };
  const apellidos = m[1].trim();
  const nombres = m[2].trim();
  const tipo_documento = m[3].trim();
  const paciente_documento = m[4].trim().replace(/\s/g, '');
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
  const base = String(originalName || '').trim();
  const m = base.match(RE_COMPROBANTE);
  if (!m) return { ok: false, original: base, error: mensajeErrorFormato('comprobantes') };
  const apellidos = m[1].trim();
  const nombres = m[2].trim();
  const tipo_documento = m[3].trim();
  const paciente_documento = m[4].trim().replace(/\s/g, '');
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
  const base = String(originalName || '').trim();
  const m = base.match(RE_CONSENTIMIENTO);
  if (!m) return { ok: false, original: base, error: mensajeErrorFormato('consentimientos') };
  const apellidos = m[1].trim();
  const nombres = m[2].trim();
  const tipo_documento = m[3].trim();
  const paciente_documento = m[4].trim().replace(/\s/g, '');
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
  return `ORDEN + HC - ${apellidos} - ${nombres} - ${tipo_documento} - ${paciente_documento} - ${fecha} - ${estudio}.pdf`;
}

function normalizarNombreComprobante(parts) {
  const { apellidos, nombres, tipo_documento, paciente_documento, fecha, estudio } = parts;
  return `COMPROBANTE - ${apellidos} - ${nombres} - ${tipo_documento} - ${paciente_documento} - ${fecha} - ${estudio}.pdf`;
}

function normalizarNombreConsentimiento(parts) {
  const { apellidos, nombres, tipo_documento, paciente_documento, fecha, estudio } = parts;
  return `${apellidos} - ${nombres} - ${tipo_documento} - ${paciente_documento} - ${fecha} - ${estudio}.pdf`;
}

function parseNombrePorCarpeta(originalName, carpeta, estudios = []) {
  const tema = detectarTemaCarpeta(carpeta?.nombre_display || '');
  switch (tema) {
    case 'ordenes':
      return parseNombreOrdenHc(originalName, estudios);
    case 'comprobantes':
      return parseNombreComprobante(originalName, estudios);
    case 'consentimientos':
      return parseNombreConsentimiento(originalName, estudios);
    default:
      return parseNombreSimple(originalName);
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
  if (['ordenes', 'comprobantes', 'consentimientos'].includes(tema)) {
    return meta.nombre_archivo_display || original;
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
  if (['ordenes', 'comprobantes', 'consentimientos'].includes(carpetaTema)) return true;
  if (['vtm', 'eeg', 'psg', 'actigrafia'].includes(carpetaTema)) return true;
  return estudioTema === carpetaTema;
}

/** Intenta leer datos del nombre aunque no cumpla el formato completo. */
function extraerDatosParcialesNombre(originalName, carpeta, estudios = []) {
  const base = String(originalName || '').trim();
  const tema = detectarTemaCarpeta(carpeta?.nombre_display || '');
  const parcial = {
    apellidos: '',
    nombres: '',
    tipo_documento: 'CC',
    paciente_documento: '',
    fecha_estudio: '',
    estudio_texto: ''
  };

  const fechaMatch = base.match(/(\d{4}-\d{2}-\d{2})/);
  if (fechaMatch) parcial.fecha_estudio = fechaMatch[1];

  if (esTemaEstructurado(tema)) {
    const sinPdf = base.replace(/\.pdf$/i, '').trim();
    const parts = sinPdf.split(/\s*-\s*/).map((p) => p.trim()).filter(Boolean);
    let offset = 0;
    if (tema === 'ordenes' && parts[0] && /orden/i.test(parts[0])) offset = 1;
    if (tema === 'comprobantes' && parts[0] && /comprobante/i.test(parts[0])) offset = 1;
    if (parts.length > offset) parcial.apellidos = parts[offset] || '';
    if (parts.length > offset + 1) parcial.nombres = parts[offset + 1] || '';
    if (parts.length > offset + 2) parcial.tipo_documento = parts[offset + 2] || 'CC';
    if (parts.length > offset + 3) parcial.paciente_documento = String(parts[offset + 3] || '').replace(/\s/g, '');
    if (parts.length > offset + 4 && /^\d{4}-\d{2}-\d{2}$/.test(parts[offset + 4])) {
      parcial.fecha_estudio = parts[offset + 4];
    }
    const ultimo = parts[parts.length - 1];
    if (ultimo && !/^\d{4}-\d{2}-\d{2}$/.test(ultimo) && !/^(orden|comprobante)/i.test(ultimo)) {
      parcial.estudio_texto = resolverEstudioDesdeLista(ultimo, estudios) || ultimo;
    }
  } else {
    const m = base.match(RE_SIMPLE_MIN);
    if (m) {
      parcial.apellidos = m[1].trim();
      parcial.nombres = m[2].trim();
      parcial.fecha_estudio = m[3];
      const idx = base.toLowerCase().indexOf(m[3].toLowerCase());
      const rest = idx >= 0 ? base.slice(idx + m[3].length).replace(/\.pdf$/i, '').trim() : '';
      const ext = rest.match(/^([\d-]+)\s+(\d+)\.\s*(.+)$/i);
      if (ext) parcial.estudio_texto = ext[3].trim();
      else if (rest) parcial.estudio_texto = rest.replace(/^\d+\.\s*/, '').trim();
    } else {
      const coma = base.match(/^(.+?),\s*(.+?)(?:\s+\d{4}-\d{2}-\d{2})?/i);
      if (coma) {
        parcial.apellidos = coma[1].trim();
        parcial.nombres = coma[2].trim().replace(/\s+\d{4}-\d{2}-\d{2}.*$/i, '').trim();
      }
    }
    if (tema === 'psg' && !estudioPsgReconocido(parcial.estudio_texto)) {
      parcial.estudio_texto = inferirEstudioDesdeCarpeta(carpeta?.nombre_display || '');
    } else if (!parcial.estudio_texto && ['vtm', 'eeg', 'actigrafia'].includes(tema)) {
      parcial.estudio_texto = inferirEstudioDesdeCarpeta(carpeta);
    }
  }

  return parcial;
}

/**
 * Analiza si el nombre requiere modal de corrección antes de subir.
 */
function analizarNombreArchivo(originalName, carpeta, estudios = []) {
  const tema = detectarTemaCarpeta(carpeta?.nombre_display || '');
  const parsed = parseNombrePorCarpeta(originalName, carpeta, estudios);
  const parcial = extraerDatosParcialesNombre(originalName, carpeta, estudios);

  if (!parsed.ok) {
    return {
      ok: false,
      requiere_correccion: true,
      motivo: 'formato',
      error: parsed.error || mensajeErrorFormato(tema),
      tema,
      parcial
    };
  }

  if (tema === 'psg' && !estudioPsgReconocido(parsed.estudio_texto)) {
    return {
      ok: false,
      requiere_correccion: true,
      motivo: 'falta_estudio_psg',
      error: 'Falta el tipo de estudio PSG en el nombre (Básica, CPAP o BPAP).',
      tema,
      parcial: {
        ...parcial,
        apellidos: parsed.apellidos || parcial.apellidos,
        nombres: parsed.nombres || parcial.nombres,
        fecha_estudio: parsed.fecha_estudio || parcial.fecha_estudio,
        estudio_texto: inferirEstudioDesdeCarpeta(carpeta?.nombre_display || '') || 'PSG Básica'
      },
      parsed
    };
  }

  return { ok: true, requiere_correccion: false, tema, parsed, parcial: parsed };
}

function buildMetaDesdeCamposManuales(originalName, body, carpeta) {
  const estudios = carpeta?._estudiosLista || [];
  const tema = detectarTemaCarpeta(carpeta?.nombre_display || '');
  const apellidos = String(body.apellidos || '').trim();
  const nombres = String(body.nombres || '').trim();
  const fecha = String(body.fecha_estudio || '').trim();
  const tipo_documento = String(body.tipo_documento || 'CC').trim();
  const paciente_documento = String(body.paciente_documento || '').trim().replace(/\s/g, '');

  if (!apellidos || !nombres) {
    return { ok: false, error: 'Apellidos y nombres son obligatorios' };
  }
  if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return { ok: false, error: 'La fecha del estudio es obligatoria (YYYY-MM-DD)' };
  }

  let estudio = String(body.estudio_texto || '').trim();
  if (esTemaEstructurado(tema)) {
    estudio = resolverEstudioDesdeLista(estudio, estudios);
    if (!estudio) return { ok: false, error: 'Seleccione el tipo de examen' };
    if (!paciente_documento) return { ok: false, error: 'El número de documento es obligatorio' };
  } else if (tema === 'psg') {
    estudio = resolverEstudioDesdeLista(estudio, estudios) || estudio;
    if (!estudioPsgReconocido(estudio)) {
      return { ok: false, error: 'Seleccione el tipo de estudio PSG (Básica, CPAP o BPAP)' };
    }
  } else if (['vtm', 'eeg', 'actigrafia'].includes(tema)) {
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
  } else if (tema === 'consentimientos') {
    base.formato = 'consentimientos';
    base.nombre_display = normalizarNombreConsentimiento({
      apellidos, nombres, tipo_documento, paciente_documento, fecha, estudio
    });
  } else {
    base.formato = 'simple';
  }

  base.nombre_archivo_display = nombreArchivoDescarga(base, carpeta);
  return base;
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
  extraerDatosParcialesNombre,
  analizarNombreArchivo,
  buildMetaDesdeCamposManuales,
  nombreArchivoDescarga,
  appendEstudioAlNombre,
  normalizarNombreBusqueda,
  resolverEstudioDesdeLista,
  fechaEnPeriodo,
  temaCoincideCarpeta
};
