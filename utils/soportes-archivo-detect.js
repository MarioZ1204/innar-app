/**
 * Detección de tipo de documento por nombre de archivo y nombres canónicos de radicación.
 */
const path = require('path');

const SOPORTES_SLOTS = ['OPF', 'CRC', 'FEV', 'PDX', 'HEV'];
const RIPS_SLOTS = ['RIPS_JSON_1', 'RIPS_JSON_2', 'RIPS_XML'];

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9+]+/g, ' ');
}

function getNitObligado() {
  const n = String(process.env.SOPORTES_NIT_OBLIGADO || '').replace(/\D/g, '');
  return n || '000000000';
}

/** Etiqueta de factura en nombres de archivo: siempre FE + dígitos (ej. FE14726). */
function formatFeTag(numeroFactura) {
  const raw = String(numeroFactura ?? '').trim().toUpperCase();
  const m = raw.match(/^FE(\d+)$/i);
  if (m) return `FE${m[1]}`;
  const digits = raw.replace(/\D/g, '');
  if (!digits) return 'FE0';
  return `FE${digits}`;
}

function numeroDesdeFeTag(feTag) {
  const m = String(feTag || '').toUpperCase().match(/^FE(\d+)$/);
  return m ? parseInt(m[1], 10) : 0;
}

function fevFilenameHint(numeroEjemplo = '14726') {
  const nit = getNitObligado();
  return `FEV_${nit}_FE${numeroEjemplo}.pdf`;
}

/**
 * Parsea FEV_{NIT}_FE{NUM}.pdf — el número de factura va con prefijo FE (ej. FE14726).
 */
function parseFevFilename(originalName) {
  const base = path.basename(originalName, path.extname(originalName)).toUpperCase();
  const envNit = getNitObligado();
  const ejemplo = `FEV_${envNit}_FE14726.pdf`;

  const mEnvFe = base.match(new RegExp(`^FEV[_-]${envNit}[_-](FE\\d+)$`, 'i'));
  if (mEnvFe) {
    const codigoFe = mEnvFe[1].toUpperCase();
    return {
      ok: true,
      nit: envNit,
      numero: numeroDesdeFeTag(codigoFe),
      codigo_fe: codigoFe,
      razon: 'Formato FEV canónico'
    };
  }

  const mAnyFe = base.match(/^FEV[_-](\d+)[_-](FE\d+)$/i);
  if (mAnyFe) {
    const codigoFe = mAnyFe[2].toUpperCase();
    return {
      ok: true,
      nit: mAnyFe[1],
      numero: numeroDesdeFeTag(codigoFe),
      codigo_fe: codigoFe,
      razon: 'Formato FEV detectado'
    };
  }

  return {
    ok: false,
    error: `Use el nombre ${ejemplo} — el número de factura debe llevar prefijo FE (ej. FE14726, no solo 14726)`
  };
}

function safeOriginalFilename(originalName) {
  const base = path.basename(String(originalName || 'documento.pdf'));
  return base.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 200) || 'documento.pdf';
}

function buildCanonicalName(tipo, numeroFactura, ext) {
  const nit = getNitObligado();
  const feTag = formatFeTag(numeroFactura);
  const t = String(tipo || '').toUpperCase();
  if (t === 'RIPS_JSON_1') return `RIPS_${nit}_${feTag}_1.json`;
  if (t === 'RIPS_JSON_2') return `RIPS_${nit}_${feTag}_2.json`;
  if (t === 'RIPS_XML') return `RIPS_${nit}_${feTag}.xml`;
  const e = (ext || '.pdf').replace(/^\./, '');
  return `${t}_${nit}_${feTag}.${e}`;
}

/** Etiqueta en nombre de archivo: FE{n} si hay factura; si no, código de carpeta (ej. PEREZ_JUAN). */
function etiquetaFacturaExpediente(exp) {
  const num = parseInt(exp?.numero_factura, 10) || 0;
  if (num > 0) return formatFeTag(num);
  const cod = String(exp?.codigo || 'PENDIENTE').trim().toUpperCase();
  if (/^FE\d+$/.test(cod)) return cod;
  const clean = cod.replace(/[^A-Z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 28);
  return clean || 'PENDIENTE';
}

function expedienteTieneFactura(exp) {
  return (parseInt(exp?.numero_factura, 10) || 0) > 0;
}

/** Extrae la etiqueta (paciente o FE) del nombre canónico: OPF_{NIT}_{ETIQUETA}.pdf */
function extractEtiquetaFromSoporteName(nombre) {
  const base = path.basename(String(nombre || ''), path.extname(String(nombre || '')));
  const nit = getNitObligado();
  const mEnv = base.match(new RegExp(`^(OPF|CRC|FEV|PDX|HEV)[_-]${nit}[_-](.+)$`, 'i'));
  if (mEnv) return String(mEnv[2] || '').trim().toUpperCase();
  const mAny = base.match(/^(OPF|CRC|FEV|PDX|HEV)[_-](\d+)[_-](.+)$/i);
  if (mAny) return String(mAny[3] || '').trim().toUpperCase();
  return '';
}

function extractTipoFromSoporteName(nombre) {
  const base = path.basename(String(nombre || ''), path.extname(String(nombre || '')));
  const m = base.match(/^(OPF|CRC|FEV|PDX|HEV)[_-]/i);
  return m ? m[1].toUpperCase() : '';
}

function archivoCoincideConTipoSlot(fileName, tipo) {
  const expected = String(tipo || '').toUpperCase();
  if (!expected) return true;
  // UCQN guarda tipo 'PDF' con el nombre original (no OPF_/CRC_/…).
  if (expected === 'PDF') {
    const ext = path.extname(String(fileName || '')).toLowerCase();
    return !ext || ext === '.pdf';
  }
  return extractTipoFromSoporteName(fileName) === expected;
}

function buildSoportesDiskName(tipo, exp, ext = '.pdf') {
  const nit = getNitObligado();
  const t = String(tipo || '').toUpperCase();
  const tag = etiquetaFacturaExpediente(exp);
  if (t === 'RIPS_JSON_1') return `RIPS_${nit}_${tag}_1.json`;
  if (t === 'RIPS_JSON_2') return `RIPS_${nit}_${tag}_2.json`;
  if (t === 'RIPS_XML') return `RIPS_${nit}_${tag}.xml`;
  const e = (ext || '.pdf').replace(/^\./, '');
  return `${t}_${nit}_${tag}.${e}`;
}

/**
 * Detecta slot SOPORTES desde el nombre original del archivo.
 */
function detectSoportesSlot(originalName, tipoServicio = 'electro') {
  const n = norm(originalName);
  const ext = path.extname(originalName).toLowerCase();

  if (/^opf[\s._-]/.test(n) || n.startsWith('opf ')) {
    return { tipo: 'OPF', razon: 'Prefijo OPF en el nombre' };
  }
  if (/^crc[\s._-]/.test(n) || n.startsWith('crc ')) {
    return { tipo: 'CRC', razon: 'Prefijo CRC en el nombre' };
  }
  if (parseFevFilename(originalName).ok) {
    return { tipo: 'FEV', razon: 'Nombre FEV_{NIT}_{factura}' };
  }
  if (/^fev[\s._-]/.test(n) || n.includes('factura electronica')) {
    return { tipo: 'FEV', razon: 'Factura electrónica / FEV' };
  }
  if (/^pdx[\s._-]/.test(n) || n.includes('psg') || n.includes('eeg') || n.includes('vtm') || n.includes('electro')) {
    if (tipoServicio === 'consulta') return null;
    return { tipo: 'PDX', razon: 'Estudio electro / PDX' };
  }
  if (/^hev[\s._-]/.test(n) || (tipoServicio === 'consulta' && (n.includes('consulta') || n.includes('historia')))) {
    if (tipoServicio !== 'consulta') return null;
    return { tipo: 'HEV', razon: 'Historia consulta / HEV' };
  }

  const hasHc = /\bhc\b/.test(n) || n.includes('historia clinica') || n.includes('historia ');
  const hasOrden = n.includes('orden');
  const hasAut = n.includes('autorizacion') || n.includes('autoriz');
  const hasPaciente = n.includes(' de ') || n.includes(' paciente');

  if ((hasHc && hasOrden) || (hasHc && hasAut) || (hasOrden && hasAut) ||
      (hasOrden && hasPaciente) || (hasHc && hasOrden && hasAut)) {
    return { tipo: 'OPF', razon: 'Historia + orden y/o autorización (OPF)' };
  }

  if (n.includes('comprobante') || n.includes('certificado') || n.includes(' recibo')) {
    return { tipo: 'CRC', razon: 'Comprobante o certificado (CRC)' };
  }

  if (n.includes('factura') && !n.includes('electronica')) {
    return { tipo: 'FEV', razon: 'Documento de factura (FEV)' };
  }

  if (ext === '.json' || ext === '.xml') return null;

  return null;
}

/**
 * Asigna slot RIPS: primer JSON libre, segundo JSON, o XML.
 */
function detectRipsSlot(originalName, slotsOcupados = {}) {
  const ext = path.extname(originalName).toLowerCase();
  if (ext === '.xml') return { tipo: 'RIPS_XML', razon: 'Archivo XML' };
  if (ext === '.json') {
    if (!slotsOcupados.RIPS_JSON_1) return { tipo: 'RIPS_JSON_1', razon: 'Primer JSON RIPS' };
    if (!slotsOcupados.RIPS_JSON_2) return { tipo: 'RIPS_JSON_2', razon: 'Segundo JSON RIPS' };
    return { tipo: 'RIPS_JSON_2', razon: 'Reemplazo segundo JSON (slot lleno)' };
  }
  if (norm(originalName).includes('xml')) return { tipo: 'RIPS_XML', razon: 'Nombre sugiere XML' };
  if (norm(originalName).includes('json') || norm(originalName).includes('rips')) {
    if (!slotsOcupados.RIPS_JSON_1) return { tipo: 'RIPS_JSON_1', razon: 'JSON RIPS' };
    return { tipo: 'RIPS_JSON_2', razon: 'JSON RIPS' };
  }
  return null;
}

function slotRequirements(contenedorTipo, tipoServicio = 'electro') {
  if (contenedorTipo === 'rips') {
    return {
      contenedor: 'rips',
      slots: [
        { key: 'RIPS_JSON_1', label: 'RIPS JSON (1)', ext: '.json', ejemplo: 'RIPS_{NIT}_{FE}_1.json' },
        { key: 'RIPS_JSON_2', label: 'RIPS JSON (2)', ext: '.json', ejemplo: 'RIPS_{NIT}_{FE}_2.json' },
        { key: 'RIPS_XML', label: 'RIPS XML', ext: '.xml', ejemplo: 'RIPS_{NIT}_{FE}.xml' }
      ]
    };
  }
  const slots = [
    { key: 'OPF', label: 'OPF — Historia + orden + autorización', ext: '.pdf', ejemplo: 'OPF_{NIT}_{FE}.pdf' },
    { key: 'CRC', label: 'CRC — Comprobante / certificado', ext: '.pdf', ejemplo: 'CRC_{NIT}_{FE}.pdf' },
    { key: 'FEV', label: 'FEV — Factura electrónica', ext: '.pdf', ejemplo: 'FEV_{NIT}_{FE}.pdf' }
  ];
  if (tipoServicio === 'consulta') {
    slots.push({ key: 'HEV', label: 'HEV — Historia consulta', ext: '.pdf', ejemplo: 'HEV_{NIT}_{FE}.pdf' });
  } else {
    slots.push({ key: 'PDX', label: 'PDX — Reporte electro', ext: '.pdf', ejemplo: 'PDX_{NIT}_{FE}.pdf' });
  }
  return { contenedor: 'soportes', slots };
}

module.exports = {
  SOPORTES_SLOTS,
  RIPS_SLOTS,
  getNitObligado,
  formatFeTag,
  fevFilenameHint,
  buildCanonicalName,
  extractEtiquetaFromSoporteName,
  extractTipoFromSoporteName,
  archivoCoincideConTipoSlot,
  buildSoportesDiskName,
  etiquetaFacturaExpediente,
  expedienteTieneFactura,
  parseFevFilename,
  safeOriginalFilename,
  detectSoportesSlot,
  detectRipsSlot,
  slotRequirements
};
