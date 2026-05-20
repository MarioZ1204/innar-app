/**
 * Parser y normalización de nombres de archivo PDX.
 * Entrada: "Apellido, Nombre  YYYY-MM-DD HH-mm-ss N. ESTUDIO.pdf"
 */

const { detectarTemaCarpeta } = require('./soportes-temas');

const RE_PDX = /^(.+?),\s*(.+?)\s+(\d{4}-\d{2}-\d{2})\s+([\d-]+)\s+(\d+)\.\s*(.+?)\.pdf$/i;

function normalizarNombreBusqueda(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
  parseNombrePdx,
  normalizarNombrePdx,
  normalizarNombreBusqueda,
  fechaEnPeriodo,
  temaCoincideCarpeta
};
