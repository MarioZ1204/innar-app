/**
 * Colores fijos por tipo de estudio electro (kanban, monitor, etc.).
 * Misma lógica que el cliente: nombre exacto → mapa → familia → hash estable.
 */
const { tipoEstudioElectro, normEstudioNombre } = require('./electro-estudio-tipo');

const PALETTE = [
  { accent: '#7c3aed', bg: '#f5f3ff', border: '#c4b5fd' },
  { accent: '#2563eb', bg: '#eff6ff', border: '#93c5fd' },
  { accent: '#ca8a04', bg: '#fefce8', border: '#fde047' },
  { accent: '#0d9488', bg: '#f0fdfa', border: '#5eead4' },
  { accent: '#db2777', bg: '#fdf2f8', border: '#f9a8d4' },
  { accent: '#ea580c', bg: '#fff7ed', border: '#fdba74' },
  { accent: '#4f46e5', bg: '#eef2ff', border: '#a5b4fc' },
  { accent: '#059669', bg: '#ecfdf5', border: '#6ee7b7' },
  { accent: '#dc2626', bg: '#fef2f2', border: '#fca5a5' },
  { accent: '#0891b2', bg: '#ecfeff', border: '#67e8f9' }
];

const TIPO_COLORS = {
  psg: { accent: '#7c3aed', bg: '#f5f3ff', border: '#c4b5fd' },
  psg_titulacion: { accent: '#6d28d9', bg: '#ede9fe', border: '#a78bfa' },
  eeg: { accent: '#ca8a04', bg: '#fefce8', border: '#fde047' },
  vtm: { accent: '#2563eb', bg: '#eff6ff', border: '#93c5fd' },
  actigrafia: { accent: '#db2777', bg: '#fdf2f8', border: '#f9a8d4' },
  mslt: { accent: '#0d9488', bg: '#f0fdfa', border: '#5eead4' }
};

const EXACT_MAP = {
  'psg basica': TIPO_COLORS.psg,
  'psg básica': TIPO_COLORS.psg,
  'psg con titulacion de dispositivo medico cpap': TIPO_COLORS.psg_titulacion,
  'psg con titulación de dispositivo médico cpap': TIPO_COLORS.psg_titulacion,
  'psg con titulacion de dispositivo medico bpap': { accent: '#5b21b6', bg: '#f3e8ff', border: '#c4b5fd' },
  'psg con titulación de dispositivo médico bpap': { accent: '#5b21b6', bg: '#f3e8ff', border: '#c4b5fd' },
  'psg cpap/bpap': TIPO_COLORS.psg_titulacion,
  'polisomnografia basica': TIPO_COLORS.psg,
  'polisomnografía básica': TIPO_COLORS.psg,
  'titulacion cpap/bpap': TIPO_COLORS.psg_titulacion,
  'electroencefalograma': TIPO_COLORS.eeg,
  eeg: TIPO_COLORS.eeg,
  vtm: TIPO_COLORS.vtm,
  'monitorizacion electroencefalografica por video y radio': TIPO_COLORS.vtm,
  'monitorización electroencefalográfica por video y radio': TIPO_COLORS.vtm,
  'test de latencia de sueño multiple': TIPO_COLORS.mslt,
  'test de latencia de sueño múltiple': TIPO_COLORS.mslt,
  actigrafia: TIPO_COLORS.actigrafia,
  actigrafía: TIPO_COLORS.actigrafia
};

const registry = new Map();

function hashPaletteIndex(nombre) {
  const s = normEstudioNombre(nombre);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h) % PALETTE.length;
}

function cloneColor(c) {
  return { accent: c.accent, bg: c.bg, border: c.border };
}

function resolverColorPorFamilia(key) {
  const tipo = tipoEstudioElectro(key);
  if (tipo === 'psg') {
    if (key.includes('cpap') || key.includes('bpap') || key.includes('titul')) {
      return cloneColor(TIPO_COLORS.psg_titulacion);
    }
    return cloneColor(TIPO_COLORS.psg);
  }
  if (tipo === 'eeg') return cloneColor(TIPO_COLORS.eeg);
  if (tipo === 'vtm') return cloneColor(TIPO_COLORS.vtm);
  if (tipo === 'actigrafia') return cloneColor(TIPO_COLORS.actigrafia);
  if (key.includes('latencia') && key.includes('sueno')) return cloneColor(TIPO_COLORS.mslt);
  return cloneColor(PALETTE[hashPaletteIndex(key)]);
}

function resolveEstudioElectroColor(nombre) {
  const exact = String(nombre || '').trim();
  if (!exact) return cloneColor(PALETTE[0]);
  if (registry.has(exact)) return registry.get(exact);

  const key = normEstudioNombre(exact);
  let color = EXACT_MAP[key] ? cloneColor(EXACT_MAP[key]) : resolverColorPorFamilia(key);
  registry.set(exact, color);
  return color;
}

function registrarColoresCatalogo(nombres = []) {
  nombres.forEach((n) => resolveEstudioElectroColor(n));
  return registry;
}

module.exports = {
  PALETTE,
  TIPO_COLORS,
  resolveEstudioElectroColor,
  registrarColoresCatalogo
};
