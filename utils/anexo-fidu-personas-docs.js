'use strict';

const {
  PERSONAS_CSV_COLUMNS,
  sanitizePersonaBody,
  sanitizeFirmaPaciente,
  upsertPersonaEnDb
} = require('./anexo-fidu-personas');

/** Metadatos de campos (alineado con formulario anexo). */
const PERSONA_FORM_META = [
  { key: 'numero_documento', label: 'Número de documento' },
  { key: 'nombres_1', label: 'Nombres (1)' },
  { key: 'nombres_2', label: 'Nombres (2)' },
  { key: 'apellidos_1', label: 'Apellidos (1)' },
  { key: 'apellidos_2', label: 'Apellidos (2)' },
  { key: 'fecha_nacimiento', label: 'Fecha de nacimiento' },
  { key: 'tipo_documento', label: 'Tipo de documento' },
  { key: 'ciudad_nacimiento', label: 'Ciudad de nacimiento' },
  { key: 'genero', label: 'Género' },
  { key: 'direccion', label: 'Dirección' },
  { key: 'barrio', label: 'Barrio' },
  { key: 'ciudad_residencia', label: 'Ciudad de residencia' },
  { key: 'telefono', label: 'Teléfono' },
  { key: 'correo', label: 'Correo' },
  { key: 'afiliacion', label: 'Afiliación' }
];

const CAMPOS_REQUERIDOS = {
  certificado: ['numero_documento', 'nombres_1', 'apellidos_1', 'tipo_documento'],
  comprobante: [
    'numero_documento', 'nombres_1', 'apellidos_1', 'tipo_documento',
    'fecha_nacimiento', 'direccion', 'telefono', 'correo', 'afiliacion'
  ],
  anexo: [
    'numero_documento', 'nombres_1', 'apellidos_1', 'fecha_nacimiento',
    'tipo_documento', 'ciudad_nacimiento', 'genero', 'direccion',
    'ciudad_residencia', 'telefono', 'correo', 'afiliacion'
  ]
};

function normEspacios(s) {
  return String(s || '').trim().replace(/\s+/g, ' ');
}

function valorCampoVacio(key, val) {
  const s = String(val ?? '').trim();
  if (!s) return true;
  if (key === 'correo' && /^notiene@/i.test(s)) return true;
  return false;
}

function labelCampo(key) {
  return PERSONA_FORM_META.find((f) => f.key === key)?.label || key;
}

function personaRowToPlain(row) {
  if (!row) return null;
  const o = {};
  PERSONAS_CSV_COLUMNS.forEach((k) => {
    o[k] = row[k] != null ? String(row[k]) : '';
  });
  o.firma_paciente = row.firma_paciente != null ? String(row.firma_paciente) : '';
  return o;
}

function nombreCompletoDesdePersona(persona = {}, fallback = '') {
  const parts = [
    persona.nombres_1, persona.nombres_2, persona.apellidos_1, persona.apellidos_2
  ].map((s) => normEspacios(s)).filter(Boolean);
  if (parts.length) return parts.join(' ');
  return normEspacios(fallback);
}

/** Heurística para precargar nombres desde el nombre de la cita. */
function sugerirNombresDesdeTexto(nombreCompleto) {
  const words = normEspacios(nombreCompleto).split(' ').filter(Boolean);
  if (!words.length) {
    return { nombres_1: '', nombres_2: '', apellidos_1: '', apellidos_2: '' };
  }
  if (words.length === 1) {
    return { nombres_1: words[0], nombres_2: '', apellidos_1: '', apellidos_2: '' };
  }
  if (words.length === 2) {
    return { nombres_1: words[0], nombres_2: '', apellidos_1: words[1], apellidos_2: '' };
  }
  return {
    nombres_1: words.slice(0, -2).join(' '),
    nombres_2: '',
    apellidos_1: words[words.length - 2],
    apellidos_2: words[words.length - 1]
  };
}

function detectarCamposFaltantes(persona = {}, contexto = 'anexo') {
  const keys = CAMPOS_REQUERIDOS[contexto] || CAMPOS_REQUERIDOS.anexo;
  const faltantes = [];
  for (const key of keys) {
    if (key === 'tipo_documento') {
      if (valorCampoVacio(key, persona.tipo_documento)
        && valorCampoVacio('fecha_nacimiento', persona.fecha_nacimiento)) {
        faltantes.push({ key, label: labelCampo(key) });
      }
      continue;
    }
    if (valorCampoVacio(key, persona[key])) {
      faltantes.push({ key, label: labelCampo(key) });
    }
  }
  return faltantes;
}

/**
 * Estos 4 campos siempre se recalculan juntos a partir del nombre completo
 * (ver sugerirNombresDesdeTexto). Si se sobrescriben solo los no vacíos,
 * un "nombres_2"/"apellidos_2" viejo en BD queda huérfano y el nombre
 * completo termina duplicando esa palabra (p. ej. "JUAN CARLOS CARLOS PEREZ").
 */
const GRUPO_NOMBRE = ['nombres_1', 'nombres_2', 'apellidos_1', 'apellidos_2'];

function mergePersonaBodies(existing = {}, incoming = {}) {
  const out = { ...existing };
  const incomingTraeNombre = incoming.nombres_1 != null;
  PERSONAS_CSV_COLUMNS.forEach((k) => {
    if (GRUPO_NOMBRE.includes(k) && incomingTraeNombre) {
      out[k] = normEspacios(incoming[k]);
      return;
    }
    const v = incoming[k];
    if (v != null && String(v).trim() !== '') out[k] = normEspacios(v);
  });
  const firma = sanitizeFirmaPaciente(incoming.firma_paciente);
  if (firma) out.firma_paciente = firma;
  else if (existing.firma_paciente) out.firma_paciente = existing.firma_paciente;
  return out;
}

function personaInicialDesdeCita(documento, nombreCita = '', extras = {}) {
  const sugeridos = sugerirNombresDesdeTexto(nombreCita);
  const base = {
    numero_documento: normEspacios(documento),
    ...sugeridos,
    tipo_documento: '',
    fecha_nacimiento: '',
    ciudad_nacimiento: '',
    genero: '',
    direccion: '',
    barrio: '',
    ciudad_residencia: '',
    telefono: '',
    correo: '',
    afiliacion: ''
  };
  return mergePersonaBodies(base, extras);
}

function personaAPrefillCertificado(persona, citaPrefill = {}) {
  const nombre = nombreCompletoDesdePersona(persona, citaPrefill.paciente_nombre);
  return {
    ...citaPrefill,
    paciente_nombre: nombre,
    paciente_documento: persona.numero_documento || citaPrefill.paciente_documento,
    tipo_documento: persona.tipo_documento || citaPrefill.tipo_documento || 'CC'
  };
}

function personaAPrefillComprobante(persona, citaPrefill = {}) {
  const nombre = nombreCompletoDesdePersona(persona, citaPrefill.paciente_nombre);
  return {
    ...citaPrefill,
    paciente_nombre: nombre,
    paciente_documento: persona.numero_documento || citaPrefill.paciente_documento,
    tipo_documento: persona.tipo_documento || citaPrefill.tipo_documento || 'CC',
    fecha_nacimiento: persona.fecha_nacimiento || citaPrefill.fecha_nacimiento || '',
    direccion: persona.direccion || citaPrefill.direccion || '',
    telefono: persona.telefono || citaPrefill.telefono || '',
    correo: persona.correo || citaPrefill.correo || '',
    tipo_afiliacion: persona.afiliacion || citaPrefill.tipo_afiliacion || 'Cotizante',
    firma_paciente: persona.firma_paciente || citaPrefill.firma_paciente || ''
  };
}

/** Convierte campos del modal de comprobante al cuerpo de persona FOMAG. */
function personaBodyDesdeComprobanteModal(modal = {}) {
  const doc = normEspacios(modal.paciente_documento);
  return {
    numero_documento: doc,
    ...sugerirNombresDesdeTexto(modal.paciente_nombre),
    tipo_documento: normEspacios(modal.tipo_documento),
    fecha_nacimiento: normEspacios(modal.fecha_nacimiento),
    direccion: normEspacios(modal.direccion),
    telefono: normEspacios(modal.telefono),
    correo: normEspacios(modal.correo),
    afiliacion: normEspacios(modal.tipo_afiliacion),
    firma_paciente: sanitizeFirmaPaciente(modal.firma_paciente)
  };
}

/** Convierte campos del modal de certificado al cuerpo de persona FOMAG. */
function personaBodyDesdeCertificadoModal(modal = {}) {
  return {
    numero_documento: normEspacios(modal.paciente_documento),
    ...sugerirNombresDesdeTexto(modal.paciente_nombre),
    tipo_documento: normEspacios(modal.tipo_documento)
  };
}

async function buscarPersonaFiduPorDocumento(db, documento, contexto = 'anexo') {
  const doc = normEspacios(documento);
  if (!doc) {
    return { ok: false, error: 'Documento requerido' };
  }
  const rows = await db.query(
    'SELECT * FROM anexo_fidu_personas WHERE numero_documento = ? LIMIT 1',
    [doc]
  );
  if (!rows.length) {
    return {
      ok: true,
      encontrada: false,
      persona: { numero_documento: doc },
      campos_faltantes: detectarCamposFaltantes({ numero_documento: doc }, contexto),
      nombre_completo: ''
    };
  }
  const persona = personaRowToPlain(rows[0]);
  const campos_faltantes = detectarCamposFaltantes(persona, contexto);
  return {
    ok: true,
    encontrada: true,
    persona,
    campos_faltantes,
    nombre_completo: nombreCompletoDesdePersona(persona)
  };
}

async function guardarPersonaFiduMerge(db, body = {}, contexto = 'anexo') {
  const doc = normEspacios(body.numero_documento);
  if (!doc) throw new Error('Número de documento requerido');

  const rows = await db.query(
    'SELECT * FROM anexo_fidu_personas WHERE numero_documento = ? LIMIT 1',
    [doc]
  );
  const existente = rows.length ? personaRowToPlain(rows[0]) : { numero_documento: doc };
  const merged = mergePersonaBodies(existente, body);
  const persona = sanitizePersonaBody(merged);
  const firma = sanitizeFirmaPaciente(merged.firma_paciente);
  if (firma) persona.firma_paciente = firma;
  else if (existente.firma_paciente) persona.firma_paciente = existente.firma_paciente;
  else persona.firma_paciente = '';
  const accion = await upsertPersonaEnDb(db, persona);
  const campos_faltantes = detectarCamposFaltantes(persona, contexto);
  return {
    ok: true,
    accion,
    persona,
    campos_faltantes,
    nombre_completo: nombreCompletoDesdePersona(persona)
  };
}

module.exports = {
  PERSONA_FORM_META,
  CAMPOS_REQUERIDOS,
  personaRowToPlain,
  nombreCompletoDesdePersona,
  sugerirNombresDesdeTexto,
  detectarCamposFaltantes,
  mergePersonaBodies,
  personaInicialDesdeCita,
  personaAPrefillCertificado,
  personaAPrefillComprobante,
  personaBodyDesdeComprobanteModal,
  personaBodyDesdeCertificadoModal,
  buscarPersonaFiduPorDocumento,
  guardarPersonaFiduMerge
};
