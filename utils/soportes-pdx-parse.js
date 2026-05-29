/**
 * Parser y normalización de nombres de archivo PDX.
 * Formato mínimo (todas las carpetas salvo Órdenes):
 *   Apellido, Nombre   YYYY-MM-DD.pdf
 * Tras la fecha puede haber hora, número, tipo de estudio, etc.
 */

const { detectarTemaCarpeta } = require('./soportes-temas');

/** Mínimo obligatorio; el resto del nombre antes de .pdf es opcional. */
const RE_REPORTE_BASE = /^(.+?),\s*(.+?)\s+(\d{4}-\d{2}-\d{2})(?:\s+.+)?\.pdf$/i;
/** Compatibilidad: formato extendido histórico */
const RE_PDX = /^(.+?),\s*(.+?)\s+(\d{4}-\d{2}-\d{2})\s+([\d-]+)\s+(\d+)\.\s*(.+?)\.pdf$/i;
/** Órdenes: Apellidos, Nombres, documento, fecha, tipo de examen.pdf */
const RE_ORDENES = /^(.+?),\s*(.+?),\s*([\d.\-]+),\s*(\d{4}-\d{2}-\d{2}),\s*(.+?)\.pdf$/i;

const MSG_FORMATO_REPORTE =
  'El archivo debe llamarse: Apellido, Nombre   YYYY-MM-DD.pdf (puede incluir hora, número y estudio después de la fecha).';

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

function extraerSufijoDesdeNombre(base, fecha) {
  const idx = base.toLowerCase().indexOf(fecha.toLowerCase());
  if (idx < 0) return '';
  return base.slice(idx + fecha.length).replace(/\.pdf$/i, '').trim();
}

function parseSufijoReporte(sufijoRaw) {
  const sufijo = String(sufijoRaw || '').trim();
  if (!sufijo) {
    return { marca_tiempo: '', sufijo_numero: '', estudio_texto: '' };
  }
  const ext = sufijo.match(/^([\d-]+)\s+(\d+)\.\s*(.+)$/i);
  if (ext) {
    return {
      marca_tiempo: ext[1].trim(),
      sufijo_numero: ext[2].trim(),
      estudio_texto: ext[3].trim()
    };
  }
  const soloEstudio = sufijo.replace(/^\d+\.\s*/, '').trim();
  return { marca_tiempo: '', sufijo_numero: '', estudio_texto: soloEstudio };
}

function parseNombreReporte(originalName) {
  const base = String(originalName || '').trim();
  let apellidos;
  let nombres;
  let fecha;
  let sufijoRaw = '';

  const mExt = base.match(RE_PDX);
  if (mExt) {
    apellidos = mExt[1].trim();
    nombres = mExt[2].trim();
    fecha = mExt[3];
    return buildParseReporteOk(base, apellidos, nombres, fecha, {
      marca_tiempo: mExt[4].trim(),
      sufijo_numero: mExt[5].trim(),
      estudio_texto: mExt[6].trim()
    });
  }

  const m = base.match(RE_REPORTE_BASE);
  if (!m) return { ok: false, original: base, error: MSG_FORMATO_REPORTE };

  apellidos = m[1].trim();
  nombres = m[2].trim();
  fecha = m[3];
  sufijoRaw = extraerSufijoDesdeNombre(base, fecha);
  const partes = parseSufijoReporte(sufijoRaw);
  return buildParseReporteOk(base, apellidos, nombres, fecha, partes);
}

function buildParseReporteOk(base, apellidos, nombres, fecha, partes) {
  const pacienteNombre = `${apellidos}, ${nombres}`;
  const estudio = partes.estudio_texto || '';
  return {
    ok: true,
    original: base,
    apellidos,
    nombres,
    paciente_nombre: pacienteNombre,
    paciente_nombre_norm: normalizarNombreBusqueda(pacienteNombre),
    fecha_estudio: fecha,
    marca_tiempo: partes.marca_tiempo || '',
    sufijo_numero: partes.sufijo_numero || '',
    estudio_texto: estudio,
    estudio_tema: detectarTemaCarpeta(estudio),
    nombre_display: normalizarNombreReporte({
      apellidos,
      nombres,
      fecha,
      marcaTiempo: partes.marca_tiempo,
      sufijo: partes.sufijo_numero,
      estudio
    })
  };
}

function parseNombrePdx(originalName) {
  return parseNombreReporte(originalName);
}

function normalizarNombreReporte(parts) {
  const { apellidos, nombres, fecha, marcaTiempo, sufijo, estudio } = parts;
  let nombre = `${apellidos}, ${nombres}   ${fecha}`;
  if (marcaTiempo && sufijo && estudio) {
    nombre += ` ${marcaTiempo} ${sufijo}. ${estudio}`;
  } else if (estudio) {
    nombre += ` ${estudio}`;
  }
  return `${nombre}.pdf`;
}

function normalizarNombrePdx(parts) {
  return normalizarNombreReporte(parts);
}

function parseNombreOrdenes(originalName, estudios) {
  const base = String(originalName || '').trim();
  const m = base.match(RE_ORDENES);
  if (!m) return { ok: false, original: base };

  const apellidos = m[1].trim();
  const nombres = m[2].trim();
  const paciente_documento = m[3].trim().replace(/\s/g, '');
  const fecha = m[4];
  const estudioRaw = m[5].trim();
  const estudio = resolverEstudioDesdeLista(estudioRaw, estudios);
  const pacienteNombre = `${apellidos}, ${nombres}`;

  return {
    ok: true,
    original: base,
    apellidos,
    nombres,
    paciente_documento,
    paciente_nombre: pacienteNombre,
    paciente_nombre_norm: normalizarNombreBusqueda(pacienteNombre),
    fecha_estudio: fecha,
    marca_tiempo: '',
    sufijo_numero: '',
    estudio_texto: estudio,
    estudio_tema: 'ordenes',
    nombre_display: normalizarNombreOrdenes({ apellidos, nombres, paciente_documento, fecha, estudio })
  };
}

function normalizarNombreOrdenes(parts) {
  const { apellidos, nombres, paciente_documento, fecha, estudio } = parts;
  return `${apellidos}, ${nombres}, ${paciente_documento}, ${fecha}, ${estudio}.pdf`;
}

function fechaEnPeriodo(fechaStr, periodoYYYYMM) {
  if (!fechaStr || !periodoYYYYMM) return true;
  return String(fechaStr).slice(0, 7) === periodoYYYYMM;
}

function temaCoincideCarpeta(estudioTema, carpetaTema) {
  if (!estudioTema || !carpetaTema) return true;
  if (carpetaTema === 'neutral' || estudioTema === 'neutral') return true;
  return estudioTema === carpetaTema;
}

module.exports = {
  RE_REPORTE_BASE,
  RE_PDX,
  RE_ORDENES,
  MSG_FORMATO_REPORTE,
  parseNombreReporte,
  parseNombrePdx,
  parseNombreOrdenes,
  normalizarNombreReporte,
  normalizarNombrePdx,
  normalizarNombreOrdenes,
  normalizarNombreBusqueda,
  resolverEstudioDesdeLista,
  fechaEnPeriodo,
  temaCoincideCarpeta
};
