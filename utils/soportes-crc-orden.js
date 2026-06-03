/**
 * Orden canónico al unir PDF en CRC:
 * 2 → Comprobante, Certificado
 * 3 → Comprobante, Consentimiento, Certificado
 * 4 → Comprobante, Cotización, Consentimiento, Certificado
 */
const path = require('path');

const CRC_PARTE_ORDEN = ['comprobante', 'cotizacion', 'consentimiento', 'certificado'];

const ETIQUETAS_PARTE = {
  comprobante: 'Comprobante',
  cotizacion: 'Cotización',
  consentimiento: 'Consentimiento',
  certificado: 'Certificado'
};

const EXPECTED_SETS = {
  2: ['comprobante', 'certificado'],
  3: ['comprobante', 'consentimiento', 'certificado'],
  4: ['comprobante', 'cotizacion', 'consentimiento', 'certificado']
};

function normNombre(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/** Detecta tipo de parte CRC por nombre de archivo. */
function detectarParteCrcTipo(originalName) {
  const base = path.basename(String(originalName || ''));
  const n = normNombre(base);

  if (/\bcomprobante/.test(n) || /^comprobante[\s._-]/.test(n)) return 'comprobante';
  if (/\bcotizaci[oó]n/.test(n) || /\bcotiz\b/.test(n)) return 'cotizacion';
  if (/\bconsentimiento/.test(n) || /\bconsent\b/.test(n)) return 'consentimiento';
  if (/\bcertificado/.test(n) || /\bcertific\b/.test(n)) return 'certificado';

  return null;
}

function resolverTiposPartes(partes) {
  const list = (partes || []).map((p, idx) => ({
    path: p.path,
    originalname: p.originalname || p.originalName || path.basename(p.path || `parte-${idx + 1}.pdf`),
    tipo: detectarParteCrcTipo(p.originalname || p.originalName || p.path)
  }));

  const n = list.length;
  const expected = EXPECTED_SETS[n];
  if (!expected) {
    throw new Error('Para CRC una exactamente 2, 3 o 4 PDF (Comprobante + Certificado, con Consentimiento y/o Cotización según el caso).');
  }

  const asignados = new Map();
  const sinTipo = [];

  for (const item of list) {
    if (item.tipo && !asignados.has(item.tipo)) {
      asignados.set(item.tipo, item);
    } else if (item.tipo && asignados.has(item.tipo)) {
      throw new Error(`Hay más de un archivo tipo «${ETIQUETAS_PARTE[item.tipo]}». Revise los nombres.`);
    } else {
      sinTipo.push(item);
    }
  }

  for (const tipo of expected) {
    if (!asignados.has(tipo) && sinTipo.length) {
      const item = sinTipo.shift();
      item.tipo = tipo;
      asignados.set(tipo, item);
    }
  }

  if (sinTipo.length) {
    throw new Error('No se reconoció el tipo de uno de los PDF. Use nombres con Comprobante, Certificado, Consentimiento o Cotización.');
  }

  const faltantes = expected.filter((t) => !asignados.has(t));
  if (faltantes.length) {
    const labels = faltantes.map((t) => ETIQUETAS_PARTE[t]).join(', ');
    throw new Error(
      n === 2
        ? `Con 2 archivos se requiere: Comprobante y Certificado. Falta: ${labels}.`
        : n === 3
        ? `Con 3 archivos se requiere: Comprobante, Consentimiento y Certificado. Falta: ${labels}.`
        : `Con 4 archivos se requiere: Comprobante, Cotización, Consentimiento y Certificado. Falta: ${labels}.`
    );
  }

  const sobrantes = [...asignados.keys()].filter((t) => !expected.includes(t));
  if (sobrantes.length) {
    throw new Error(
      `Con ${n} archivo(s) no debe incluir «${ETIQUETAS_PARTE[sobrantes[0]]}». ` +
      `Orden esperado: ${expected.map((t) => ETIQUETAS_PARTE[t]).join(' → ')}.`
    );
  }

  const ordenados = expected.map((tipo) => asignados.get(tipo));
  return {
    orden: expected.map((t) => ETIQUETAS_PARTE[t]),
    partes: ordenados,
    paths: ordenados.map((p) => p.path)
  };
}

function hintOrdenCrcPorCantidad(n) {
  const expected = EXPECTED_SETS[n];
  if (!expected) return '2, 3 o 4 PDF según corresponda';
  return expected.map((t) => ETIQUETAS_PARTE[t]).join(' → ');
}

module.exports = {
  CRC_PARTE_ORDEN,
  ETIQUETAS_PARTE,
  EXPECTED_SETS,
  detectarParteCrcTipo,
  resolverTiposPartes,
  hintOrdenCrcPorCantidad
};
