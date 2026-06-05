'use strict';

const { normCodigoServicio } = require('./anexo-fidu-servicios');

/** Colores de fila según tarifario FOMAG (referencia plantilla Innar). ARGB sin # */
const GRUPOS_COLOR_SERVICIO = [
  {
    argb: 'FFF4CBA',
    codigos: ['861411', '890302', '890502']
  },
  {
    argb: 'D6E4F0',
    codigos: ['890202', '890297', '891410', '891901']
  },
  {
    argb: 'FFF2CC',
    codigos: ['890208', '890308', '940701', '943102', '944002', '944102', '944301']
  },
  {
    argb: 'E2EFDA',
    codigos: ['890274', '890374', '891401', '891402', '931002', '931601', '933501', '934201', '934601', '940201']
  },
  {
    argb: 'DAEEF3',
    codigos: ['890284', '890384', '53105', '053105']
  },
  {
    argb: 'FFEB9C',
    codigos: ['891703', '891704']
  },
  {
    argb: 'E4DFEC',
    codigos: ['931001', '931501']
  }
];

const COLOR_POR_CODIGO = new Map();
GRUPOS_COLOR_SERVICIO.forEach((g) => {
  g.codigos.forEach((c) => COLOR_POR_CODIGO.set(c, g.argb));
});

const COLOR_DEFAULT = 'FFFFFFFF';

function colorFilaPorCodigoServicio(codigo) {
  const norm = normCodigoServicio(codigo);
  if (!norm) return COLOR_DEFAULT;
  if (COLOR_POR_CODIGO.has(norm)) return COLOR_POR_CODIGO.get(norm);
  const sinCeros = norm.replace(/^0+/, '') || norm;
  if (COLOR_POR_CODIGO.has(sinCeros)) return COLOR_POR_CODIGO.get(sinCeros);
  const padded = norm.padStart(6, '0');
  if (COLOR_POR_CODIGO.has(padded)) return COLOR_POR_CODIGO.get(padded);
  return COLOR_DEFAULT;
}

function aplicarColorFilaExcel(row, codigoServicio) {
  const argb = colorFilaPorCodigoServicio(codigoServicio);
  if (argb === COLOR_DEFAULT) return;
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb }
    };
  });
}

module.exports = {
  GRUPOS_COLOR_SERVICIO,
  COLOR_DEFAULT,
  colorFilaPorCodigoServicio,
  aplicarColorFilaExcel
};
