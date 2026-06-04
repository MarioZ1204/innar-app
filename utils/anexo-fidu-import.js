/**
 * Importación pacientes (Google Sheets / Excel) → columnas anexo FIDU.
 */
const { ANEXO_FIDU_COLUMN_KEYS } = require('./anexo-fidu-columns');

function normHeader(h) {
  return String(h || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

const SHEETS_ALIASES = {
  numerodocumento: 'numero_documento',
  tipodocumento: 'tipo_documento',
  nombres: '_nombres',
  apellidos: '_apellidos',
  fechanacimiento: 'fecha_nacimiento',
  fechadenacimiento: 'fecha_nacimiento',
  ciudadnacimiento: 'ciudad_nacimiento',
  ciudaddenacimiento: 'ciudad_nacimiento',
  genero: 'genero',
  direccion: 'direccion',
  barrio: '_barrio',
  ciudadresidencia: 'ciudad_residencia',
  ciudadderesidencia: 'ciudad_residencia',
  telefono: 'telefono',
  correo: 'correo',
  afiliacion: 'especiales_excepcion_cotizante'
};

function splitNombrePartes(texto) {
  const parts = String(texto || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { a: '', b: '' };
  if (parts.length === 1) return { a: parts[0], b: '' };
  return { a: parts[0], b: parts.slice(1).join(' ') };
}

function calcularEdadDesdeFecha(val) {
  if (!val) return '';
  const s = String(val).trim();
  let d = null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  else {
    const parsed = new Date(s);
    if (!Number.isNaN(parsed.getTime())) d = parsed;
  }
  if (!d || Number.isNaN(d.getTime())) return '';
  const hoy = new Date();
  let edad = hoy.getFullYear() - d.getFullYear();
  const mDiff = hoy.getMonth() - d.getMonth();
  if (mDiff < 0 || (mDiff === 0 && hoy.getDate() < d.getDate())) edad -= 1;
  return edad >= 0 ? String(edad) : '';
}

function formatFechaParaCelda(val) {
  if (val == null || val === '') return '';
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    const y = val.getFullYear();
    const mo = String(val.getMonth() + 1).padStart(2, '0');
    const da = String(val.getDate()).padStart(2, '0');
    return `${y}-${mo}-${da}`;
  }
  const s = String(val).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return s;
}

function cellToString(val) {
  if (val == null || val === '') return '';
  if (val instanceof Date) return formatFechaParaCelda(val);
  if (typeof val === 'object' && val.text != null) return String(val.text).trim();
  if (typeof val === 'object' && val.result != null) return String(val.result).trim();
  return String(val).trim();
}

/**
 * @param {Record<string, unknown>} row — claves = headers normalizados o originales
 */
function mapSheetsRowToAnexoFidu(row) {
  const out = {};
  ANEXO_FIDU_COLUMN_KEYS.forEach((k) => { out[k] = ''; });

  let nombresRaw = '';
  let apellidosRaw = '';
  let barrio = '';

  for (const [rawKey, rawVal] of Object.entries(row)) {
    const nk = normHeader(rawKey);
    const alias = SHEETS_ALIASES[nk];
    const val = cellToString(rawVal);
    if (!alias) continue;
    if (alias === '_nombres') nombresRaw = val;
    else if (alias === '_apellidos') apellidosRaw = val;
    else if (alias === '_barrio') barrio = val;
    else if (ANEXO_FIDU_COLUMN_KEYS.includes(alias)) out[alias] = val;
  }

  const n = splitNombrePartes(nombresRaw);
  const a = splitNombrePartes(apellidosRaw);
  out.nombres_1 = n.a;
  out.nombres_2 = n.b;
  out.apellidos_1 = a.a;
  out.apellidos_2 = a.b;

  if (barrio && out.direccion) {
    out.direccion = `${out.direccion} — ${barrio}`;
  } else if (barrio) {
    out.direccion = barrio;
  }

  out.fecha_nacimiento = formatFechaParaCelda(out.fecha_nacimiento);
  out.edad = calcularEdadDesdeFecha(out.fecha_nacimiento);

  return out;
}

/**
 * Parsea filas Excel (array de objetos header→valor).
 */
function mapExcelRowsToAnexoFidu(dataRows) {
  return (dataRows || []).map((row) => mapSheetsRowToAnexoFidu(row));
}

module.exports = {
  normHeader,
  mapSheetsRowToAnexoFidu,
  mapExcelRowsToAnexoFidu,
  calcularEdadDesdeFecha,
  formatFechaParaCelda,
  cellToString
};
