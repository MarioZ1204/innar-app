/**
 * Misma lógica que utils/comprobante-servicio-cups.js (prellenado en modal).
 * Mantener reglas alineadas con el servidor.
 */
(function (root) {
  'use strict';

  const CUPS_NOMBRES = {
    '890202': 'Consulta de primera vez por otras especialidades médicas',
    '890302': 'Consulta de control o de seguimiento por otras especialidades médicas',
    '890274': 'Consulta ambulatoria de medicina especializada neurologia primera vez',
    '890374': 'Consulta ambulatoria de medicina especializada neurologia control',
    '890284': 'Consulta ambulatoria de medicina especializada de psiquiatria primera vez',
    '890384': 'Consulta ambulatoria de medicina especializada de psiquiatria control',
    '890208': 'Consulta ambulatoria de primera vez por psicologia',
    '890308': 'Consulta ambulatoria de control por psicologia',
    '890297': 'Consulta de primera vez por otras especialidades de psicologia',
    '861411': 'Inyeccion de material miorelajante (toxina botulinica) no incluye la toxina botulinica',
    '053105': 'Bloqueo union mioneural',
    '891901': 'Monitorizacion electroencefalografica por video y radio x horas de examen',
    '891410': 'Electroencefalograma digital con mapeo cerebral',
    '891402': 'Electroencefalograma computarizado',
    '891401': 'Electroencefalograma convencional',
    '891703': 'Polisomnograma en titulacion de dispositivo medico',
    '891704': 'Estudio fisiologico completo del sueño (polisomnografia basica)',
    '940701': 'Aplicacion de prueba neuropsicologica',
    '944301': 'Terapias de rehabilitacion cognitiva',
    '943102': 'Psicoterapia individual por psicologia',
    '931001': 'Terapia fisica integral'
  };

  const CUPS_CON_SUFIJO = new Set(['890202', '890302']);

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
    { re: /bloqueo\s+mioneural/i, cups: '053105' }
  ];

  const REGLAS_ESTUDIO = [
    { re: /video\s*telemetr|\bvtm\b|monitoreo.*video.*radio/i, cups: '891901' },
    { re: /mapeo\s*cerebral/i, cups: '891410' },
    { re: /eeg\s*comput|electroencefalograma\s*comput/i, cups: '891402' },
    { re: /polisomn.*titul|titulaci[oó]n.*dispositivo/i, cups: '891703' },
    { re: /polisomn.*b[aá]sica|psg\s*b[aá]sica|sueño\s*b[aá]sico/i, cups: '891704' },
    { re: /electroencefal|\beeg\b/i, cups: '891401' }
  ];

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
      .replace(/\bpsiquiatria\b/gi, 'psiquiatría');
  }

  function formatoTituloCups(texto) {
    const base = String(texto || '').trim().replace(/\s+/g, ' ');
    if (!base) return '';
    const titulo = base.charAt(0).toUpperCase() + base.slice(1).toLowerCase();
    return restaurarAcentosCups(titulo);
  }

  function nombreDesdeCodigo(codigo, sufijoEspecialidad) {
    const base = CUPS_NOMBRES[codigo];
    if (!base) return null;
    let out = formatoTituloCups(base);
    const sufijo = String(sufijoEspecialidad || '').trim();
    if (sufijo && CUPS_CON_SUFIJO.has(codigo)) {
      out = `${out} (${sufijo.charAt(0).toUpperCase()}${sufijo.slice(1)})`;
    }
    return out;
  }

  function nombreServicioComprobanteCups(servicioInterno) {
    const raw = String(servicioInterno || '').trim();
    if (!raw) return raw;

    const n = String(raw)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (n === 'consulta de primera vez por otras especialidades medicas (epileptologia)') {
      return 'Consulta de Primera Vez por Otras Especialidades Médicas (Epileptología)';
    }
    if (n === 'consulta de control por otras especialidades medicas (epileptologia)') {
      return 'Consulta de Control por Otras Especialidades Médicas (Epileptología)';
    }

    for (const regla of REGLAS_CONSULTA) {
      if (!regla.re.test(raw)) continue;
      const nombre = nombreDesdeCodigo(regla.cups, regla.sufijo ? extraerEspecialidadPor(raw) : '');
      if (nombre) return nombre;
    }

    for (const regla of REGLAS_ESTUDIO) {
      if (!regla.re.test(raw)) continue;
      const nombre = nombreDesdeCodigo(regla.cups);
      if (nombre) return nombre;
    }

    return raw;
  }

  root.innarComprobanteCups = { nombreServicioComprobanteCups };
})(typeof window !== 'undefined' ? window : globalThis);
