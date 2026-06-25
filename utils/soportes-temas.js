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

function detectarTemaCarpeta(nombreCarpeta, nombreArchivo = '') {
  const u = normalizarTexto(nombreCarpeta);
  const archivo = normalizarTexto(nombreArchivo);
  const contexto = `${u} ${archivo}`.trim();
  const consultasMed = esCarpetaConsultasMedicas(u) || (archivo.includes('consulta') && archivo.includes('medica'));

  if (consultasMed && /\bcomprobante/.test(contexto)) {
    return 'comprobantes_consulta_medica';
  }

  if (
    consultasMed &&
    (/\bordenes\b/.test(contexto) ||
      /\borden\s*\+\s*hc\b/.test(contexto) ||
      (/\borden\b/.test(contexto) && /\bhc\b/.test(contexto)))
  ) {
    return 'ordenes_consulta_medica';
  }

  if (/\bcomprobante/.test(contexto)) {
    return 'comprobantes';
  }

  if (/\bconsentimiento/.test(contexto)) {
    return 'consentimientos';
  }

  if (
    /\bordenes\b/.test(contexto) ||
    /\borden\s*\+\s*hc\b/.test(contexto) ||
    (/\borden\b/.test(contexto) && /\bhc\b/.test(contexto))
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
  comprobantes_consulta_medica: 'Comprobante. consultas médicas',
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
