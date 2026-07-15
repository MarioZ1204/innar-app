/**
 * Parseo de listas de pacientes (nombre + apellido) para carpetas de soportes.
 */
const { sanitizePathSegment } = require('./soportes-armado-structure');

function parseLineaPaciente(line) {
  const raw = String(line || '').trim();
  if (!raw) return null;

  let nombre = '';
  let apellido = '';

  if (raw.includes(',')) {
    const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length < 2) return null;
    apellido = parts[0];
    nombre = parts.slice(1).join(' ');
  } else {
    const parts = raw.split(/\s+/).filter(Boolean);
    if (parts.length < 2) return null;
    nombre = parts[0];
    apellido = parts.slice(1).join(' ');
  }

  nombre = nombre.trim();
  apellido = apellido.trim();
  if (!nombre || !apellido) return null;

  const paciente_nombre = `${nombre} ${apellido}`;
  const codigo = codigoCarpetaPaciente(nombre, apellido);
  return { nombre, apellido, paciente_nombre, codigo };
}

function normalizarLineasEntrada(input) {
  if (Array.isArray(input)) {
    return input
      .map((item) => (typeof item === 'string' ? item : (item && typeof item === 'object' ? (item.paciente_nombre || item.nombre || item.apellido || '') : '')))
      .map((item) => String(item || '').trim())
      .filter(Boolean);
  }

  if (typeof input === 'string') {
    return input.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  }

  if (input && typeof input === 'object') {
    if (Array.isArray(input.lista)) return normalizarLineasEntrada(input.lista);
    if (Array.isArray(input.lines)) return normalizarLineasEntrada(input.lines);
    if (typeof input.lista === 'string') return normalizarLineasEntrada(input.lista);
    if (typeof input.texto === 'string') return normalizarLineasEntrada(input.texto);
    if (typeof input.paciente_linea === 'string') return normalizarLineasEntrada(input.paciente_linea);
  }

  return [];
}

function parseListaPacientes(text) {
  const lines = normalizarLineasEntrada(text);
  const out = [];
  const used = new Set();

  for (const line of lines) {
    const p = parseLineaPaciente(line);
    if (!p) continue;

    let codigo = p.codigo;
    let n = 2;
    while (used.has(codigo)) {
      codigo = `${p.codigo}_${n}`.slice(0, 32);
      n += 1;
    }
    used.add(codigo);
    out.push({ ...p, codigo });
  }
  return out;
}

function codigoCarpetaPaciente(nombre, apellido) {
  const slug = sanitizePathSegment(`${apellido}_${nombre}`)
    .replace(/\s+/g, '_')
    .toUpperCase();
  return slug.slice(0, 32) || 'PACIENTE';
}

function esExpedientePendienteFactura(exp) {
  const num = exp?.numero_factura;
  if (num === null || num === undefined || num === '') return true;
  return (parseInt(num, 10) || 0) === 0;
}

/** Código de carpeta del paciente (PEREZ_JUAN), aunque el expediente ya esté facturado como FE{n}. */
function codigoPacienteFromExpediente(exp) {
  if (!exp) return '';
  const codigo = String(exp.codigo || '').trim().toUpperCase();
  if (codigo && !/^FE\d+$/.test(codigo)) return codigo;
  const parsed = parseLineaPaciente(exp.paciente_nombre);
  return parsed?.codigo || '';
}

module.exports = {
  parseLineaPaciente,
  parseListaPacientes,
  codigoCarpetaPaciente,
  esExpedientePendienteFactura,
  codigoPacienteFromExpediente
};
