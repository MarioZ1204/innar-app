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

function parseListaPacientes(text) {
  const lines = String(text || '').split(/\r?\n/);
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

module.exports = {
  parseLineaPaciente,
  parseListaPacientes,
  codigoCarpetaPaciente,
  esExpedientePendienteFactura
};
