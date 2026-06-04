/**
 * Tema visual de carpeta PDX por sinónimos en el nombre (no enum fijo).
 */

function normalizarTexto(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function esCarpetaConsultasMedicas(u) {
  return /\bconsultas?\s+medicas?\b/.test(u) || (u.includes('consulta') && u.includes('medica'));
}

function esTemaConsultaMedica(tema) {
  return tema === 'comprobantes_consulta_medica' || tema === 'ordenes_consulta_medica';
}

function esTemaOrdenHcConsultaMedica(tema) {
  return tema === 'ordenes_consulta_medica';
}

function detectarTemaCarpeta(nombreCarpeta) {
  const u = normalizarTexto(nombreCarpeta);
  const consultasMed = esCarpetaConsultasMedicas(u);

  if (consultasMed && /\bcomprobante/.test(u)) {
    return 'comprobantes_consulta_medica';
  }

  if (
    consultasMed &&
    (/\bordenes\b/.test(u) ||
      /\borden\s*\+\s*hc\b/.test(u) ||
      (/\borden\b/.test(u) && /\bhc\b/.test(u)))
  ) {
    return 'ordenes_consulta_medica';
  }

  if (/\bcomprobante/.test(u)) {
    return 'comprobantes';
  }

  if (/\bconsentimiento/.test(u)) {
    return 'consentimientos';
  }

  if (
    /\bordenes\b/.test(u) ||
    /\borden\s*\+\s*hc\b/.test(u) ||
    (/\borden\b/.test(u) && /\bhc\b/.test(u))
  ) {
    return 'ordenes';
  }

  if (
    /\bvtm\b/.test(u) ||
    u.includes('videotelemetria') ||
    u.includes('video telemetria') ||
    u.includes('telemetria') ||
    (u.includes('monitoriz') && (u.includes('video') || u.includes('radio') || u.includes('eeg')))
  ) {
    return 'vtm';
  }

  if (u.includes('actigraf')) {
    return 'actigrafia';
  }

  if (
    u.includes('polisomnog') ||
    /\bpsg\b/.test(u) ||
    u.startsWith('psg ') ||
    u.includes('polisomnografia') ||
    u.includes('polisomnograma') ||
    (u.includes('titulacion') && (u.includes('cpap') || u.includes('bpap') || u.includes('psg'))) ||
    (u.includes('basica') && (u.includes('psg') || u.includes('polisom')))
  ) {
    return 'psg';
  }

  if (
    u.includes('electroencefalog') ||
    (/\beeg\b/.test(u) && !u.includes('monitoriz'))
  ) {
    return 'eeg';
  }

  return 'neutral';
}

function esCarpetaOrdenes(nombreCarpeta) {
  const t = detectarTemaCarpeta(nombreCarpeta);
  return t === 'ordenes' || t === 'ordenes_consulta_medica';
}

function esCarpetaComprobantes(nombreCarpeta) {
  const t = detectarTemaCarpeta(nombreCarpeta);
  return t === 'comprobantes' || t === 'comprobantes_consulta_medica';
}

function esCarpetaConsentimientos(nombreCarpeta) {
  return detectarTemaCarpeta(nombreCarpeta) === 'consentimientos';
}

function esCarpetaFormatoSimple(nombreCarpeta) {
  const t = detectarTemaCarpeta(nombreCarpeta);
  return ['vtm', 'eeg', 'psg', 'actigrafia', 'neutral'].includes(t);
}

const TEMA_LABELS = {
  vtm: 'VTM',
  psg: 'PSG',
  eeg: 'EEG',
  actigrafia: 'Actigrafía',
  ordenes: 'Órdenes',
  comprobantes: 'Comprobantes',
  consentimientos: 'Consentimientos',
  comprobantes_consulta_medica: 'Comprobantes consultas médicas',
  ordenes_consulta_medica: 'Órdenes + HC consultas médicas',
  neutral: 'General'
};

module.exports = {
  detectarTemaCarpeta,
  esCarpetaConsultasMedicas,
  esTemaConsultaMedica,
  esTemaOrdenHcConsultaMedica,
  esCarpetaOrdenes,
  esCarpetaComprobantes,
  esCarpetaConsentimientos,
  esCarpetaFormatoSimple,
  TEMA_LABELS,
  normalizarTexto
};
