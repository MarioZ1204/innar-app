/**
 * Tema visual de carpeta PDX por sinónimos en el nombre (no enum fijo).
 */

function normalizarTexto(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function detectarTemaCarpeta(nombreCarpeta) {
  const u = normalizarTexto(nombreCarpeta);

  if (/\bcomprobante/.test(u)) {
    return 'comprobantes';
  }

  if (/\bconsentimiento/.test(u)) {
    return 'consentimientos';
  }

  if (/\bordenes\b/.test(u)) {
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
  return detectarTemaCarpeta(nombreCarpeta) === 'ordenes';
}

function esCarpetaComprobantes(nombreCarpeta) {
  return detectarTemaCarpeta(nombreCarpeta) === 'comprobantes';
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
  neutral: 'General'
};

module.exports = {
  detectarTemaCarpeta,
  esCarpetaOrdenes,
  esCarpetaComprobantes,
  esCarpetaConsentimientos,
  esCarpetaFormatoSimple,
  TEMA_LABELS,
  normalizarTexto
};
