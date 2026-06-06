'use strict';

const { normCodigoServicio } = require('./anexo-fidu-servicios');

/** Colores de fila según tarifario FOMAG — tonos pastel suaves (ARGB 6 hex, sin #). */
const GRUPOS_COLOR_SERVICIO = [
  {
    argb: 'FFF7F2',
    codigos: ['861411', '890302', '890502']
  },
  {
    argb: 'ECF2F8',
    codigos: ['890202', '890297', '891410', '891901']
  },
  {
    argb: 'FFF9ED',
    codigos: ['890208', '890308', '940701', '943102', '944002', '944102', '944301']
  },
  {
    argb: 'EEF6EB',
    codigos: ['890274', '890374', '891401', '891402', '931002', '931601', '933501', '934201', '934601', '940201']
  },
  {
    argb: 'E8F3F8',
    codigos: ['890284', '890384', '53105', '053105']
  },
  {
    argb: 'FFF5E0',
    codigos: ['891703', '891704']
  },
  {
    argb: 'F2EEF7',
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

/** Hex CSS #RRGGBB para la grilla en el navegador. */
function colorCssFilaPorCodigoServicio(codigo) {
  const argb = colorFilaPorCodigoServicio(codigo);
  if (argb === COLOR_DEFAULT) return null;
  return `#${argb}`;
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
  colorCssFilaPorCodigoServicio,
  aplicarColorFilaExcel
};
