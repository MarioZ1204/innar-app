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

  if (
    /\bvtm\b/.test(u) ||
    u.includes('videotelemetria') ||
    u.includes('video telemetria') ||
    u.includes('telemetria') ||
    (u.includes('monitoriz') && (u.includes('video') || u.includes('radio') || u.includes('eeg')))
  ) {
    return 'vtm';
  }

  if (
    u.includes('actigraf')
  ) {
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

  if (/\bordenes\b/.test(u)) {
    return 'ordenes';
  }

  return 'neutral';
}

function esCarpetaOrdenes(nombreCarpeta) {
  return detectarTemaCarpeta(nombreCarpeta) === 'ordenes';
}

const TEMA_LABELS = {
  vtm: 'VTM',
  psg: 'PSG',
  eeg: 'EEG',
  actigrafia: 'Actigrafía',
  ordenes: 'Órdenes',
  neutral: 'General'
};

module.exports = {
  detectarTemaCarpeta,
  esCarpetaOrdenes,
  TEMA_LABELS,
  normalizarTexto
};
