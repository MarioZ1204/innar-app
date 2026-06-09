/**
 * Importación pacientes (Google Sheets / Excel) → columnas anexo FIDU.
 */
const { ANEXO_FIDU_COLUMN_KEYS } = require('./anexo-fidu-columns');
const { enriquecerRegistroAnexoFidu } = require('./anexo-fidu-servicios');

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
  afiliacion: 'especiales_excepcion_cotizante',
  codigoservicio: 'codigo_servicio',
  codigo_servicio: 'codigo_servicio',
  cups: 'codigo_servicio',
  servicio: '_servicio_texto',
  tiposervicio: '_servicio_texto',
  nombreservicio: 'nombre_servicio'
};

function splitNombrePartes(texto) {
  const parts = String(texto || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { a: '', b: '' };
  if (parts.length === 1) return { a: parts[0], b: '' };
  return { a: parts[0], b: parts.slice(1).join(' ') };
}

/** Alias extra para cabeceras de Excel del anexo (nombres/apellidos combinados, etc.) */
const IMPORT_HEADER_ALIASES = {
  nombres: '_nombres',
  nombrescompletos: '_nombres',
  nombre: '_nombres',
  apellidos: '_apellidos',
  apellidoscompletos: '_apellidos',
  apellido: '_apellidos',
  barrio: '_barrio',
  tipodedocumento: 'tipo_documento',
  especialesodeexcepcioncotizanteben: 'especiales_excepcion_cotizante',
  especialesodeexcepcioncotizante: 'especiales_excepcion_cotizante',
  afiliacion: 'especiales_excepcion_cotizante',
  cantidades: 'cantidad',
  fechaaautorizacionyhora: 'fecha_autorizacion_hora',
  fechadeautorizacionyhora: 'fecha_autorizacion_hora'
};

function aplicarCamposCombinadosImport(out, { nombresRaw = '', apellidosRaw = '', barrioRaw = '' } = {}) {
  if (!out.nombres_1 && nombresRaw) {
    const n = splitNombrePartes(nombresRaw);
    out.nombres_1 = n.a;
    out.nombres_2 = n.b;
  }
  if (!out.apellidos_1 && apellidosRaw) {
    const a = splitNombrePartes(apellidosRaw);
    out.apellidos_1 = a.a;
    out.apellidos_2 = a.b;
  }
  const barrio = barrioRaw || '';
  if (barrio && out.direccion && !String(out.direccion).toUpperCase().includes(barrio.toUpperCase())) {
    out.direccion = `${out.direccion} — ${barrio}`;
  } else if (barrio && !out.direccion) {
    out.direccion = barrio;
  }
  if (out.fecha_nacimiento) {
    out.fecha_nacimiento = formatFechaParaCelda(out.fecha_nacimiento);
    if (!out.edad) out.edad = calcularEdadDesdeFecha(out.fecha_nacimiento);
    if (!out.tipo_documento) out.tipo_documento = calcularTipoDocumentoDesdeFecha(out.fecha_nacimiento);
  }
  if (out.fecha_autorizacion_hora) {
    out.fecha_autorizacion_hora = formatFechaAutorizacionHora(out.fecha_autorizacion_hora);
  }
  return out;
}

/** Formato canónico: AAAA-MM-DD.HH:MM */
function formatFechaAutorizacionHora(val) {
  if (val == null || val === '') return '';
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    const y = val.getFullYear();
    const mo = String(val.getMonth() + 1).padStart(2, '0');
    const da = String(val.getDate()).padStart(2, '0');
    const hh = String(val.getHours()).padStart(2, '0');
    const mm = String(val.getMinutes()).padStart(2, '0');
    return `${y}-${mo}-${da}.${hh}:${mm}`;
  }
  const s = String(val).trim();
  const ok = s.match(/^(\d{4})-(\d{2})-(\d{2})\.(\d{2}):(\d{2})$/);
  if (ok) return `${ok[1]}-${ok[2]}-${ok[3]}.${ok[4]}:${ok[5]}`;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})[\sT](\d{2}):(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}.${iso[4]}:${iso[5]}`;
  const soloFecha = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (soloFecha) return `${soloFecha[1]}-${soloFecha[2]}-${soloFecha[3]}.00:00`;
  const dm = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[\s.](\d{2}):(\d{2}))?/);
  if (dm) {
    const hh = dm[4] != null ? dm[4] : '00';
    const mm = dm[5] != null ? dm[5] : '00';
    return `${dm[3]}-${String(dm[2]).padStart(2, '0')}-${String(dm[1]).padStart(2, '0')}.${hh}:${mm}`;
  }
  return s;
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

/** CC >=18 años; TI 7-17; REGISTRO CIVIL <7 años */
function calcularTipoDocumentoDesdeFecha(val) {
  const edadStr = calcularEdadDesdeFecha(val);
  if (!edadStr) return '';
  const edad = parseInt(edadStr, 10);
  if (Number.isNaN(edad) || edad < 0) return '';
  if (edad < 7) return 'REGISTRO CIVIL';
  if (edad < 18) return 'TI';
  return 'CC';
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
  const dm = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (dm) {
    return `${dm[3]}-${String(dm[2]).padStart(2, '0')}-${String(dm[1]).padStart(2, '0')}`;
  }
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
    else if (alias === '_servicio_texto' && val && !out.codigo_servicio) out._servicio_texto = val;
    else if (ANEXO_FIDU_COLUMN_KEYS.includes(alias)) out[alias] = val;
  }

  aplicarCamposCombinadosImport(out, { nombresRaw, apellidosRaw, barrioRaw: barrio });

  if (out._servicio_texto) {
    const m = String(out._servicio_texto).match(/\b(\d{5,6})\b/);
    if (m) out.codigo_servicio = m[1];
    delete out._servicio_texto;
  }

  return enriquecerRegistroAnexoFidu(out);
}

/**
 * Parsea filas Excel (array de objetos header→valor).
 */
function mapExcelRowsToAnexoFidu(dataRows) {
  return (dataRows || []).map((row) => mapSheetsRowToAnexoFidu(row));
}

module.exports = {
  normHeader,
  IMPORT_HEADER_ALIASES,
  splitNombrePartes,
  aplicarCamposCombinadosImport,
  mapSheetsRowToAnexoFidu,
  mapExcelRowsToAnexoFidu,
  calcularEdadDesdeFecha,
  calcularTipoDocumentoDesdeFecha,
  formatFechaParaCelda,
  formatFechaAutorizacionHora,
  cellToString
};
