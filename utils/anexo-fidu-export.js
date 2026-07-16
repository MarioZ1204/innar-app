'use strict';

const { ANEXO_FIDU_COLUMNAS, ANEXO_FIDU_COLUMN_KEYS } = require('./anexo-fidu-columns');
const { aplicarColorFilaExcel } = require('./anexo-fidu-colores');

function celdaExcelValor(val) {
  if (val == null) return '';
  if (typeof val === 'bigint') return String(val);
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  if (Buffer.isBuffer(val)) return val.toString('utf8');
  return String(val);
}

async function buildAnexoFiduExcelBuffer(rows, { nombreArchivo = 'anexo' } = {}) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Anexo FIDU');

  ws.addRow(ANEXO_FIDU_COLUMNAS.map((c) => c.label));
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF627372' }
  };
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  });

  for (const row of rows) {
    const excelRow = ws.addRow(ANEXO_FIDU_COLUMN_KEYS.map((k) => celdaExcelValor(row[k])));
    aplicarColorFilaExcel(excelRow, row.codigo_servicio);
  }

  ANEXO_FIDU_COLUMNAS.forEach((c, i) => {
    ws.getColumn(i + 1).width = Math.min(40, Math.max(10, Math.round((c.width || 90) / 7)));
  });

  const buffer = await wb.xlsx.writeBuffer();
  const safeName = String(nombreArchivo || 'anexo')
    .replace(/[^\w\sáéíóúñÁÉÍÓÚÑ-]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 80) || 'anexo';
  return { buffer, filename: `${safeName}.xlsx` };
}

module.exports = { buildAnexoFiduExcelBuffer };
