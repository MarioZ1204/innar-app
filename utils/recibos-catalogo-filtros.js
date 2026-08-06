/**
 * Catálogo y coincidencias para filtros de tipo_servicio en recibos/reportes.
 */

const { tipoEstudioElectro } = require('./electro-estudio-tipo');

const RECIBO_FILTRO_OTROS_CONSULTA = '__OTROS_CONSULTA__';
const RECIBO_FILTRO_OTROS_ESTUDIO = '__OTROS_ESTUDIO__';

function normTipoServicio(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function tipoServicioCoincideNombre(valor, nombreCatalogo) {
  const v = normTipoServicio(valor);
  const c = normTipoServicio(nombreCatalogo);
  if (!v || !c) return false;
  return v === c || v.includes(c) || c.includes(v);
}

function subtipoEstudioPsg(norm) {
  if (!norm) return 'general';
  if (norm.includes('cpap')) return 'cpap';
  if (norm.includes('bpap')) return 'bpap';
  if (norm.includes('noche dividida') || norm.includes('split night') || norm.includes('splitnight')) {
    return 'noche_dividida';
  }
  if (norm.includes('basica') || norm.includes('basal')) return 'basica';
  return 'general';
}

/**
 * Coincidencia flexible entre nombre de estudio en recibo y en agenda electro.
 * Ej.: «Polisomnografía Básica» ≈ «PSG Básica»; «Electroencefalograma convencional» ≈ «EEG Convencional».
 */
function estudioServicioCoincide(valorRecibo, valorCita) {
  if (tipoServicioCoincideNombre(valorRecibo, valorCita)) return true;
  const famA = tipoEstudioElectro(valorRecibo);
  const famB = tipoEstudioElectro(valorCita);
  if (famA === 'otro' || famB === 'otro' || famA !== famB) return false;
  if (famA === 'psg') {
    return subtipoEstudioPsg(normTipoServicio(valorRecibo))
      === subtipoEstudioPsg(normTipoServicio(valorCita));
  }
  return true;
}

function tipoServicioCoincideCatalogo(valor, nombresCatalogo) {
  const lista = Array.isArray(nombresCatalogo) ? nombresCatalogo : [];
  if (!normTipoServicio(valor)) return false;
  return lista.some((n) => estudioServicioCoincide(valor, n));
}

function separarValoresUsadosEnOtros(valoresUsados, nombresCatalogo) {
  const catalogo = (Array.isArray(nombresCatalogo) ? nombresCatalogo : [])
    .map((n) => String(n || '').trim())
    .filter(Boolean);
  const otros = [];
  const vistos = new Set();
  for (const raw of valoresUsados || []) {
    const v = String(raw || '').trim();
    if (!v || vistos.has(normTipoServicio(v))) continue;
    if (!tipoServicioCoincideCatalogo(v, catalogo)) {
      vistos.add(normTipoServicio(v));
      otros.push(v);
    }
  }
  otros.sort((a, b) => a.localeCompare(b, 'es'));
  return otros;
}

function expandirSeleccionFiltroServicio(valores, marcadorOtros, listaOtros) {
  const raw = (Array.isArray(valores) ? valores : String(valores || '').split(','))
    .map((v) => String(v).trim())
    .filter(Boolean);
  const expanded = new Set();
  const tieneOtros = raw.includes(marcadorOtros);
  for (const val of raw) {
    if (val === marcadorOtros) continue;
    expanded.add(val);
  }
  if (tieneOtros) {
    (listaOtros || []).forEach((o) => expanded.add(o));
  }
  return [...expanded];
}

module.exports = {
  RECIBO_FILTRO_OTROS_CONSULTA,
  RECIBO_FILTRO_OTROS_ESTUDIO,
  normTipoServicio,
  tipoServicioCoincideNombre,
  estudioServicioCoincide,
  tipoServicioCoincideCatalogo,
  separarValoresUsadosEnOtros,
  expandirSeleccionFiltroServicio
};
