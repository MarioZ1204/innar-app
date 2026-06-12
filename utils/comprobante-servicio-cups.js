'use strict';

const {
  buscarServicioPorCodigo,
  listarServiciosCatalogo,
  ANEXO_FIDU_CATALOGO_SERVICIOS,
  usarCatalogoEstatico
} = require('./anexo-fidu-servicios');

usarCatalogoEstatico(ANEXO_FIDU_CATALOGO_SERVICIOS);

const CUPS_CON_SUFIJO_ESPECIALIDAD = new Set(['890202', '890302']);

/** @type {Array<{ re: RegExp, cups: string, sufijo?: boolean }>} */
const REGLAS_CONSULTA = [
  { re: /^consulta(?:\s+virtual)?\s+de\s+primera\s+vez\s+por\s+neurolog[ií]a$/i, cups: '890274' },
  { re: /^consulta(?:\s+virtual)?\s+de\s+control\s+por\s+neurolog[ií]a$/i, cups: '890374' },
  { re: /^consulta(?:\s+virtual)?\s+de\s+primera\s+vez\s+por\s+epileptolog[ií]a$/i, cups: '890202', sufijo: true },
  { re: /^consulta(?:\s+virtual)?\s+de\s+control\s+por\s+epileptolog[ií]a$/i, cups: '890302', sufijo: true },
  { re: /^consulta(?:\s+virtual)?\s+de\s+primera\s+vez\s+por\s+psiquiatr[ií]a$/i, cups: '890284' },
  { re: /^consulta(?:\s+virtual)?\s+de\s+control\s+por\s+psiquiatr[ií]a$/i, cups: '890384' },
  { re: /^consulta(?:\s+virtual)?\s+de\s+primera\s+vez\s+por\s+psicolog[ií]a$/i, cups: '890208' },
  { re: /^consulta(?:\s+virtual)?\s+de\s+control\s+por\s+psicolog[ií]a$/i, cups: '890308' },
  { re: /^consulta(?:\s+virtual)?\s+de\s+primera\s+vez\s+por\s+neuropsicolog[ií]a$/i, cups: '890297' },
  { re: /^consulta(?:\s+virtual)?\s+de\s+control\s+por\s+neuropsicolog[ií]a$/i, cups: '890297' },
  { re: /toxina\s+botul|botox|aplicaci[oó]n\s+de\s+toxina/i, cups: '861411' },
  { re: /control\s+de\s+toxina|control\s+toxina/i, cups: '861411' },
  { re: /bloqueo\s+mioneural/i, cups: '053105' },
  { re: /rev\.?\s*neuroestimulador/i, cups: '890302', sufijo: true },
  { re: /agente\s+anest[eé]sico/i, cups: '890302', sufijo: true }
];

/** @type {Array<{ re: RegExp, cups: string }>} */
const REGLAS_ESTUDIO = [
  { re: /video\s*telemetr|\bvtm\b|monitoreo.*video.*radio/i, cups: '891901' },
  { re: /mapeo\s*cerebral/i, cups: '891410' },
  { re: /eeg\s*comput|electroencefalograma\s*comput/i, cups: '891402' },
  { re: /polisomn.*titul|titulaci[oó]n.*dispositivo/i, cups: '891703' },
  { re: /polisomn.*b[aá]sica|psg\s*b[aá]sica|sueño\s*b[aá]sico/i, cups: '891704' },
  { re: /electroencefal|\beeg\b/i, cups: '891401' },
  { re: /prueba\s*neuropsicol/i, cups: '940701' },
  { re: /terapia.*rehabilitaci[oó]n\s*cognitiva/i, cups: '944301' },
  { re: /psicoterapia\s*individual/i, cups: '943102' },
  { re: /terapia\s*f[ií]sica\s*integral/i, cups: '931001' }
];

function normTexto(val) {
  return String(val || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function extraerEspecialidadPor(nombre) {
  const m = String(nombre || '').trim()
    .match(/^consulta(?:\s+virtual)?\s+de\s+(?:primera\s+vez|control)\s+por\s+(.+)$/i);
  return m ? m[1].trim() : '';
}

function restaurarAcentosCups(texto) {
  return String(texto || '')
    .replace(/\bespecialidades medicas\b/gi, 'especialidades médicas')
    .replace(/\bpsicologia\b/gi, 'psicología')
    .replace(/\bneurologia\b/gi, 'neurología')
    .replace(/\bpsiquiatria\b/gi, 'psiquiatría')
    .replace(/\binyeccion\b/gi, 'inyección')
    .replace(/\bmiorelajante\b/gi, 'miorelajante')
    .replace(/\bbotulinica\b/gi, 'botulínica')
    .replace(/\belectroencefalograma\b/gi, 'electroencefalograma')
    .replace(/\bpolisomnografia\b/gi, 'polisomnografía')
    .replace(/\bsueño\b/gi, 'sueño');
}

function formatoTituloCups(texto) {
  const base = String(texto || '').trim().replace(/\s+/g, ' ');
  if (!base) return '';
  const titulo = base.charAt(0).toUpperCase() + base.slice(1).toLowerCase();
  return restaurarAcentosCups(titulo);
}

function formatoSufijoEspecialidad(texto) {
  const t = String(texto || '').trim();
  if (!t) return '';
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function nombreDesdeCodigoCups(codigo, sufijoEspecialidad) {
  const svc = buscarServicioPorCodigo(codigo);
  if (!svc?.nombre) return null;
  let out = formatoTituloCups(svc.nombre);
  const sufijo = formatoSufijoEspecialidad(sufijoEspecialidad);
  if (sufijo && CUPS_CON_SUFIJO_ESPECIALIDAD.has(String(codigo))) {
    out = `${out} (${sufijo})`;
  }
  return out;
}

function buscarCupsPorPalabrasClave(norm) {
  if (!norm || norm.length < 4) return null;
  const tokens = norm.split(' ').filter((t) => t.length > 3);
  if (!tokens.length) return null;

  let mejor = null;
  let mejorPuntaje = 0;
  for (const svc of listarServiciosCatalogo()) {
    const cat = normTexto(svc.nombre);
    let puntaje = 0;
    for (const tok of tokens) {
      if (cat.includes(tok)) puntaje += 1;
    }
    if (puntaje > mejorPuntaje) {
      mejorPuntaje = puntaje;
      mejor = svc;
    }
  }
  return mejorPuntaje >= 2 ? mejor : null;
}

/**
 * Convierte el nombre interno del sistema al texto CUPS para el comprobante FOMAG.
 */
function nombreServicioComprobanteCups(servicioInterno) {
  const raw = String(servicioInterno || '').trim();
  if (!raw) return raw;

  for (const regla of REGLAS_CONSULTA) {
    if (!regla.re.test(raw)) continue;
    const sufijo = regla.sufijo ? extraerEspecialidadPor(raw) : '';
    const nombre = nombreDesdeCodigoCups(regla.cups, sufijo);
    if (nombre) return nombre;
  }

  const norm = normTexto(raw);
  for (const regla of REGLAS_ESTUDIO) {
    if (!regla.re.test(raw) && !regla.re.test(norm)) continue;
    const nombre = nombreDesdeCodigoCups(regla.cups);
    if (nombre) return nombre;
  }

  const fuzzy = buscarCupsPorPalabrasClave(norm);
  if (fuzzy) return formatoTituloCups(fuzzy.nombre);

  return raw;
}

module.exports = {
  nombreServicioComprobanteCups,
  normTexto,
  formatoTituloCups
};
