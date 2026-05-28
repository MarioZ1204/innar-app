/**
 * Parser y normalización de nombres de archivo PDX.
 * Entrada: "Apellido, Nombre  YYYY-MM-DD HH-mm-ss N. ESTUDIO.pdf"
 */

const { detectarTemaCarpeta } = require('./soportes-temas');

const RE_PDX = /^(.+?),\s*(.+?)\s+(\d{4}-\d{2}-\d{2})\s+([\d-]+)\s+(\d+)\.\s*(.+?)\.pdf$/i;
/** Órdenes: Apellidos, Nombres, documento, fecha, tipo de examen.pdf */
const RE_ORDENES = /^(.+?),\s*(.+?),\s*([\d.\-]+),\s*(\d{4}-\d{2}-\d{2}),\s*(.+?)\.pdf$/i;

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

function parseNombrePdx(originalName) {
  const base = String(originalName || '').trim();
  const m = base.match(RE_PDX);
  if (!m) return { ok: false, original: base };

  const apellidos = m[1].trim();
  const nombres = m[2].trim();
  const fecha = m[3];
  const marcaTiempo = m[4].trim();
  const sufijo = m[5].trim();
  const estudio = m[6].trim();
  const pacienteNombre = `${apellidos}, ${nombres}`;

  return {
    ok: true,
    original: base,
    apellidos,
    nombres,
    paciente_nombre: pacienteNombre,
    paciente_nombre_norm: normalizarNombreBusqueda(pacienteNombre),
    fecha_estudio: fecha,
    marca_tiempo: marcaTiempo,
    sufijo_numero: sufijo,
    estudio_texto: estudio,
    estudio_tema: detectarTemaCarpeta(estudio),
    nombre_display: normalizarNombrePdx({ apellidos, nombres, fecha, marcaTiempo, sufijo, estudio })
  };
}

function normalizarNombrePdx(parts) {
  const { apellidos, nombres, fecha, marcaTiempo, sufijo, estudio } = parts;
  return `${apellidos} - ${nombres} - ${fecha} - ${marcaTiempo} - ${sufijo}. ${estudio}.pdf`;
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
  RE_PDX,
  RE_ORDENES,
  parseNombrePdx,
  parseNombreOrdenes,
  normalizarNombrePdx,
  normalizarNombreOrdenes,
  normalizarNombreBusqueda,
  resolverEstudioDesdeLista,
  fechaEnPeriodo,
  temaCoincideCarpeta
};
