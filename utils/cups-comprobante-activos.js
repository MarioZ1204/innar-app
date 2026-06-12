'use strict';

const {
  listarServiciosCatalogo,
  recargarCatalogoAnexoFidu,
  normCodigoAlmacen
} = require('./anexo-fidu-servicios');
const { formatoTituloCups } = require('./comprobante-servicio-cups');

/** Códigos CUPS que Innar maneja en comprobante FOMAG (lista autoritativa). */
const CUPS_COMPROBANTE_CODIGOS = [
  '012210', '048201', '053105', '861411',
  '890110', '890111', '890112', '890113',
  '890202', '890208', '890274', '890284', '890297', '890302', '890308',
  '890374', '890384', '890397', '890502',
  '891401', '891402', '891410', '891703', '891704', '891801', '891803', '891806', '891901',
  '930102', '930103', '931001', '931002', '931501', '931601', '933501',
  '934201', '934501', '934601', '936601',
  '940101', '940201', '940301', '940302', '940701',
  '943102', '944002', '944102', '944301',
  '999102'
];

const CUPS_COMPROBANTE_SET = new Set(
  CUPS_COMPROBANTE_CODIGOS.map((c) => normCodigoAlmacen(c))
);

async function listarServiciosComprobante(dbConn) {
  await recargarCatalogoAnexoFidu(dbConn);
  return listarServiciosCatalogo()
    .filter((s) => CUPS_COMPROBANTE_SET.has(normCodigoAlmacen(s.codigo)))
    .map((s) => ({
      codigo: normCodigoAlmacen(s.codigo),
      nombre: formatoTituloCups(String(s.nombre || '').trim())
    }))
    .sort((a, b) => a.codigo.localeCompare(b.codigo));
}

module.exports = {
  CUPS_COMPROBANTE_CODIGOS,
  CUPS_COMPROBANTE_SET,
  listarServiciosComprobante
};
