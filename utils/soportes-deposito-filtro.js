'use strict';

const {
  detectarTemaCarpeta,
  esCarpetaOrdenes,
  esCarpetaComprobantes,
  normalizarTexto
} = require('./soportes-temas');
const { esArchivoOrdenHcPdx } = require('./soportes-opf-merge');

const PDX_TEMAS_CARPETA = new Set(['psg', 'vtm', 'eeg', 'latencia']);

function temaCarpetaDeposito(row) {
  const carpeta = row?.carpeta_nombre || row?.nombre_display || '';
  const archivo = row?.nombre_archivo_original || '';
  return row?.color_tema || detectarTemaCarpeta(carpeta, archivo);
}

function carpetaCoincideSlotDeposito(slot, row) {
  const slotKey = String(slot || '').toUpperCase();
  if (!slotKey) return true;

  const carpeta = row?.carpeta_nombre || row?.nombre_display || '';
  const tema = temaCarpetaDeposito(row);

  if (slotKey === 'OPF') {
    return esCarpetaOrdenes(carpeta) || esArchivoOrdenHcPdx(row);
  }
  if (slotKey === 'CRC') {
    return esCarpetaComprobantes(carpeta);
  }
  if (slotKey === 'PDX') {
    return PDX_TEMAS_CARPETA.has(tema);
  }
  return true;
}

function etiquetaFiltroDepositoSlot(slot) {
  const slotKey = String(slot || '').toUpperCase();
  if (slotKey === 'OPF') return 'carpetas ORDEN + HC y similares';
  if (slotKey === 'CRC') return 'carpetas COMPROBANTES';
  if (slotKey === 'PDX') return 'carpetas PSG, VTM, EEG y TEST DE LATENCIA';
  return 'archivos cargados';
}

function carpetaNombreVisibleCoincideSlot(slot, nombreCarpeta) {
  const u = normalizarTexto(nombreCarpeta);
  const slotKey = String(slot || '').toUpperCase();
  if (slotKey === 'OPF') {
    return /\bordenes?\b/.test(u)
      || /\borden\s*\+\s*hc\b/.test(u)
      || (/\borden\b/.test(u) && /\bhc\b/.test(u));
  }
  if (slotKey === 'CRC') {
    return /\bcomprobante/.test(u);
  }
  if (slotKey === 'PDX') {
    return /\bpsg\b/.test(u)
      || u.includes('polisomnog')
      || /\bvtm\b/.test(u)
      || u.includes('videotelemetria')
      || u.includes('telemetria')
      || /\beeg\b/.test(u)
      || u.includes('electroencefalog')
      || u.includes('test de latencia')
      || (u.includes('latencia') && (u.includes('sueno') || u.includes('multiple') || u.includes('tlm')));
  }
  return true;
}

module.exports = {
  PDX_TEMAS_CARPETA,
  temaCarpetaDeposito,
  carpetaCoincideSlotDeposito,
  carpetaNombreVisibleCoincideSlot,
  etiquetaFiltroDepositoSlot
};
