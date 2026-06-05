/**
 * Base de personas FOMAG/FIDU — importación CSV Lista_Personas.
 * Columna J = DIRECCION (índice 9); se limpian repeticiones por error de origen.
 */

const PERSONAS_CSV_COLUMNS = [
  'numero_documento',
  'nombres_1',
  'nombres_2',
  'apellidos_1',
  'apellidos_2',
  'tipo_documento',
  'fecha_nacimiento',
  'ciudad_nacimiento',
  'genero',
  'direccion',
  'barrio',
  'ciudad_residencia',
  'telefono',
  'correo',
  'afiliacion'
];

function parseCsvLine(line) {
  const row = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQ = !inQ; continue; }
    if (ch === ',' && !inQ) { row.push(cur); cur = ''; continue; }
    cur += ch;
  }
  row.push(cur);
  return row;
}

function normEspacios(s) {
  return String(s || '').trim().replace(/\s+/g, ' ');
}

/**
 * Colapsa frases consecutivas duplicadas en la dirección (error típico columna J).
 */
function limpiarDireccionRepetida(dir) {
  const d = normEspacios(dir);
  if (!d) return '';
  const words = d.split(' ');
  if (words.length < 2) return d;

  let changed = true;
  while (changed && words.length >= 2) {
    changed = false;
    for (let len = Math.min(8, Math.floor(words.length / 2)); len >= 1; len--) {
      for (let i = 0; i <= words.length - len * 2; i++) {
        const phrase = words.slice(i, i + len).join(' ');
        let j = i + len;
        let reps = 1;
        while (j + len <= words.length && words.slice(j, j + len).join(' ') === phrase) {
          reps += 1;
          j += len;
        }
        if (reps > 1) {
          words.splice(i + len, len * (reps - 1));
          changed = true;
          break;
        }
      }
      if (changed) break;
    }
  }
  return words.join(' ').trim();
}

function normalizarGenero(val) {
  const v = String(val || '').trim().toUpperCase();
  if (v.startsWith('FEM')) return 'FEMENINO';
  if (v.startsWith('MAS')) return 'MASCULINO';
  return val ? String(val).trim() : '';
}

function normalizarCorreo(val) {
  let c = String(val || '').trim();
  if (!c) return '';
  c = c.replace(/^["']|["']$/g, '');
  if (/^notiene@/i.test(c)) return '';
  c = c.replace(/,COM$/i, '.COM').replace(/,com$/i, '.com');
  c = c.replace(/,@/g, '@');
  return c;
}

function normalizarFecha(val) {
  const s = String(val || '').trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return s;
}

function mapCsvRowToPersona(cells) {
  const raw = {};
  PERSONAS_CSV_COLUMNS.forEach((key, i) => {
    raw[key] = normEspacios(cells[i]);
  });

  const direccion = limpiarDireccionRepetida(raw.direccion);
  let direccionFinal = direccion;
  if (raw.barrio && direccion && direccion.toUpperCase() !== raw.barrio.toUpperCase()) {
    if (!direccion.toUpperCase().includes(raw.barrio.toUpperCase())) {
      direccionFinal = `${direccion} — ${raw.barrio}`;
    }
  } else if (!direccion && raw.barrio) {
    direccionFinal = raw.barrio;
  }

  return {
    numero_documento: raw.numero_documento,
    nombres_1: raw.nombres_1,
    nombres_2: raw.nombres_2,
    apellidos_1: raw.apellidos_1,
    apellidos_2: raw.apellidos_2,
    tipo_documento: raw.tipo_documento,
    fecha_nacimiento: normalizarFecha(raw.fecha_nacimiento),
    ciudad_nacimiento: raw.ciudad_nacimiento,
    genero: normalizarGenero(raw.genero),
    direccion: direccionFinal,
    barrio: raw.barrio,
    ciudad_residencia: raw.ciudad_residencia,
    telefono: raw.telefono.replace(/\D/g, '').length >= 7 ? raw.telefono.replace(/\s/g, '') : raw.telefono,
    correo: normalizarCorreo(raw.correo),
    afiliacion: raw.afiliacion
  };
}

function parsePersonasCsvContent(content) {
  const lines = String(content || '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { personas: [], errores: ['Archivo vacío'] };

  const header = parseCsvLine(lines[0]).map((h) => normEspacios(h).toUpperCase());
  const expectedStart = 'NUMERODOCUMENTO';
  if (!header[0] || !header[0].includes('NUMERODOCUMENTO')) {
    return { personas: [], errores: ['Encabezado inválido: se espera NUMERODOCUMENTO en columna A'] };
  }

  const personas = [];
  const errores = [];
  const seenDocs = new Map();

  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    if (!cells.some((c) => normEspacios(c))) continue;
    const p = mapCsvRowToPersona(cells);
    if (!p.numero_documento) {
      errores.push(`Fila ${i + 1}: sin número de documento`);
      continue;
    }
    if (seenDocs.has(p.numero_documento)) {
      errores.push(`Fila ${i + 1}: documento duplicado ${p.numero_documento} (ya en fila ${seenDocs.get(p.numero_documento)})`);
      continue;
    }
    seenDocs.set(p.numero_documento, i + 1);
    personas.push(p);
  }

  return { personas, errores };
}

function parsePersonasCsvLine(line) {
  return mapCsvRowToPersona(parseCsvLine(line));
}

/** Campos del anexo (45 col.) que provienen de la base de personas. */
const ANEXO_KEYS_DESDE_PERSONA = [
  'numero_documento', 'nombres_1', 'nombres_2', 'apellidos_1', 'apellidos_2',
  'tipo_documento', 'fecha_nacimiento', 'ciudad_nacimiento', 'genero',
  'direccion', 'telefono', 'correo', 'especiales_excepcion_cotizante', 'ciudad_residencia', 'edad'
];

function personaToAnexoPaciente(persona) {
  const { calcularEdadDesdeFecha } = require('./anexo-fidu-import');
  return {
    nombres_1: persona.nombres_1 || '',
    nombres_2: persona.nombres_2 || '',
    apellidos_1: persona.apellidos_1 || '',
    apellidos_2: persona.apellidos_2 || '',
    tipo_documento: persona.tipo_documento || '',
    numero_documento: persona.numero_documento || '',
    genero: persona.genero || '',
    edad: calcularEdadDesdeFecha(persona.fecha_nacimiento),
    direccion: persona.direccion || '',
    telefono: persona.telefono || '',
    correo: persona.correo || '',
    especiales_excepcion_cotizante: persona.afiliacion || '',
    fecha_nacimiento: persona.fecha_nacimiento || '',
    ciudad_nacimiento: persona.ciudad_nacimiento || '',
    ciudad_residencia: persona.ciudad_residencia || ''
  };
}

function separarDireccionYBarrio(direccion, barrioFallback = '') {
  const d = normEspacios(direccion);
  const sep = d.indexOf(' — ');
  if (sep >= 0) {
    return {
      direccion: d.slice(0, sep).trim(),
      barrio: d.slice(sep + 3).trim() || barrioFallback
    };
  }
  return { direccion: d, barrio: normEspacios(barrioFallback) };
}

function anexoRegistroToPersona(registro = {}) {
  const { direccion, barrio } = separarDireccionYBarrio(registro.direccion);
  return {
    numero_documento: normEspacios(registro.numero_documento),
    nombres_1: normEspacios(registro.nombres_1),
    nombres_2: normEspacios(registro.nombres_2),
    apellidos_1: normEspacios(registro.apellidos_1),
    apellidos_2: normEspacios(registro.apellidos_2),
    tipo_documento: normEspacios(registro.tipo_documento),
    fecha_nacimiento: normalizarFecha(registro.fecha_nacimiento),
    ciudad_nacimiento: normEspacios(registro.ciudad_nacimiento),
    genero: normalizarGenero(registro.genero),
    direccion: limpiarDireccionRepetida(direccion),
    barrio,
    ciudad_residencia: normEspacios(registro.ciudad_residencia),
    telefono: normEspacios(registro.telefono),
    correo: normalizarCorreo(registro.correo),
    afiliacion: normEspacios(registro.especiales_excepcion_cotizante)
  };
}

function sanitizePersonaBody(body = {}) {
  const p = {};
  PERSONAS_CSV_COLUMNS.forEach((k) => {
    p[k] = body[k] != null ? normEspacios(body[k]) : '';
  });
  if (!p.numero_documento) throw new Error('Número de documento requerido');
  p.fecha_nacimiento = normalizarFecha(p.fecha_nacimiento);
  p.genero = normalizarGenero(p.genero);
  p.correo = normalizarCorreo(p.correo);
  p.direccion = limpiarDireccionRepetida(p.direccion);
  return p;
}

function armarRegistroAnexo(documento, codigoServicio, personaRow = null) {
  const { ANEXO_FIDU_COLUMN_KEYS } = require('./anexo-fidu-columns');
  const { enriquecerRegistroAnexoFidu, buscarServicioPorCodigo } = require('./anexo-fidu-servicios');

  const registro = {};
  ANEXO_FIDU_COLUMN_KEYS.forEach((k) => { registro[k] = ''; });

  if (personaRow) {
    Object.assign(registro, personaToAnexoPaciente(personaRow));
  } else {
    registro.numero_documento = normEspacios(documento);
  }

  registro.codigo_servicio = normEspacios(codigoServicio);
  const enriched = enriquecerRegistroAnexoFidu(registro);

  if (codigoServicio && !buscarServicioPorCodigo(codigoServicio)) {
    return { registro: enriched, servicio_encontrado: false };
  }
  return { registro: enriched, servicio_encontrado: true };
}

function buildAnexoFiduPersonasCreateTableSql() {
  return `CREATE TABLE IF NOT EXISTS anexo_fidu_personas (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      numero_documento VARCHAR(30) NOT NULL,
      nombres_1 VARCHAR(120) NULL,
      nombres_2 VARCHAR(120) NULL,
      apellidos_1 VARCHAR(120) NULL,
      apellidos_2 VARCHAR(120) NULL,
      tipo_documento VARCHAR(20) NULL,
      fecha_nacimiento VARCHAR(20) NULL,
      ciudad_nacimiento VARCHAR(200) NULL,
      genero VARCHAR(30) NULL,
      direccion TEXT NULL,
      barrio VARCHAR(200) NULL,
      ciudad_residencia VARCHAR(200) NULL,
      telefono VARCHAR(40) NULL,
      correo VARCHAR(200) NULL,
      afiliacion VARCHAR(200) NULL,
      creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_anexo_persona_documento (numero_documento),
      INDEX idx_anexo_persona_nombre (apellidos_1, nombres_1)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
}

module.exports = {
  PERSONAS_CSV_COLUMNS,
  ANEXO_KEYS_DESDE_PERSONA,
  parseCsvLine,
  limpiarDireccionRepetida,
  mapCsvRowToPersona,
  parsePersonasCsvContent,
  parsePersonasCsvLine,
  personaToAnexoPaciente,
  anexoRegistroToPersona,
  sanitizePersonaBody,
  armarRegistroAnexo,
  buildAnexoFiduPersonasCreateTableSql
};
