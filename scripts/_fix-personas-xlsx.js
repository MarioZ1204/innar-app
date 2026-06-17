'use strict';

const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');
const {
  PERSONAS_CSV_COLUMNS,
  mapCsvRowToPersona
} = require('../utils/anexo-fidu-personas');

const INPUT = process.argv[2] || 'c:/Users/Usuario/Downloads/Base de Datos - Facturación (1).xlsx';
const OUT_CSV = process.argv[3] || 'c:/Users/Usuario/Downloads/Lista_Personas_limpio.csv';
const OUT_XLSX = process.argv[4] || 'c:/Users/Usuario/Downloads/Base de Datos - Facturación_limpio.xlsx';
const REPORT = process.argv[5] || 'c:/Users/Usuario/Downloads/Lista_Personas_reporte.txt';

const CSV_HEADER = [
  'NUMERODOCUMENTO', 'NOMBRES', '', 'APELLIDOS', '', 'TIPODOCUMENTO',
  'FECHANACIMIENTO', 'CIUDADDENACIMIENTO', 'GENERO', 'DIRECCION', 'BARRIO',
  'CIUDADDERESIDENCIA', 'TELEFONO', 'CORREO', 'AFILIACION'
];

function excelDateToStr(val) {
  if (val == null || val === '') return '';
  if (val instanceof Date) {
    const y = val.getUTCFullYear();
    const m = String(val.getUTCMonth() + 1).padStart(2, '0');
    const d = String(val.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(val).trim();
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  return s;
}

function rowToCells(row) {
  const v = row.values;
  const cells = [];
  for (let i = 1; i <= 15; i++) {
    let c = v[i];
    if (c == null) c = '';
    else if (i === 7) c = excelDateToStr(c);
    else if (typeof c === 'number' && i === 1) c = String(Math.trunc(c));
    else if (typeof c === 'number' && i === 13) c = String(c);
    else c = String(c).trim();
    cells.push(c);
  }
  return cells;
}

function personaToCsvCells(p) {
  return [
    p.numero_documento,
    p.nombres_1,
    p.nombres_2,
    p.apellidos_1,
    p.apellidos_2,
    p.tipo_documento,
    p.fecha_nacimiento,
    p.ciudad_nacimiento,
    p.genero,
    p.direccion,
    p.barrio,
    p.ciudad_residencia,
    p.telefono,
    p.correo,
    p.afiliacion
  ];
}

function escCsv(s) {
  const t = String(s ?? '');
  if (/[",\n\r]/.test(t)) return `"${t.replace(/"/g, '""')}"`;
  return t;
}

function scorePersona(p) {
  let s = 0;
  PERSONAS_CSV_COLUMNS.forEach((k) => { if (p[k]) s += 1; });
  return s;
}

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(INPUT);
  const ws = wb.worksheets.find((w) => w.name === 'Lista_Personas') || wb.worksheets[0];

  const report = [];
  const byDoc = new Map();
  let vacias = 0;
  let sinDoc = 0;

  for (let r = 2; r <= ws.rowCount; r++) {
    const cells = rowToCells(ws.getRow(r));
    if (!cells.some((c) => String(c).trim())) {
      vacias += 1;
      continue;
    }
    const p = mapCsvRowToPersona(cells);
    if (!p.numero_documento) {
      sinDoc += 1;
      report.push(`Fila ${r}: omitida — sin número de documento`);
      continue;
    }
    const entry = { row: r, p, score: scorePersona(p) };
    if (!byDoc.has(p.numero_documento)) {
      byDoc.set(p.numero_documento, entry);
      continue;
    }
    const prev = byDoc.get(p.numero_documento);
    if (entry.score > prev.score) {
      report.push(`Fila ${prev.row}: omitida — duplicado de ${p.numero_documento} (se conserva fila ${r}, más completa)`);
      byDoc.set(p.numero_documento, entry);
    } else {
      report.push(`Fila ${r}: omitida — duplicado de ${p.numero_documento} (se conserva fila ${prev.row})`);
    }
  }

  const personas = [...byDoc.values()].sort((a, b) => a.row - b.row);

  const csvLines = [CSV_HEADER.map(escCsv).join(',')];
  personas.forEach(({ p }) => {
    csvLines.push(personaToCsvCells(p).map(escCsv).join(','));
  });
  fs.writeFileSync(OUT_CSV, `\uFEFF${csvLines.join('\r\n')}`, 'utf8');

  const outWb = new ExcelJS.Workbook();
  const outWs = outWb.addWorksheet('Lista_Personas');
  outWs.addRow(CSV_HEADER);
  personas.forEach(({ p }) => outWs.addRow(personaToCsvCells(p)));
  outWs.getColumn(7).numFmt = 'yyyy-mm-dd';
  await outWb.xlsx.writeFile(OUT_XLSX);

  const summary = [
    `Archivo origen: ${INPUT}`,
    `Filas en Excel (sin encabezado): ${ws.rowCount - 1}`,
    `Filas vacías omitidas: ${vacias}`,
    `Filas sin documento omitidas: ${sinDoc}`,
    `Duplicados resueltos: ${report.filter((l) => l.includes('duplicado')).length}`,
    `Registros válidos exportados: ${personas.length}`,
    '',
    'Salida CSV (subir en Anexo → Subir base personas):',
    OUT_CSV,
    '',
    'Salida Excel limpio:',
    OUT_XLSX,
    '',
    '--- Detalle ---',
    ...report
  ];
  fs.writeFileSync(REPORT, summary.join('\r\n'), 'utf8');

  console.log(`OK: ${personas.length} personas → ${OUT_CSV}`);
  console.log(`Excel: ${OUT_XLSX}`);
  console.log(`Reporte: ${REPORT}`);
  console.log(`Duplicados: ${report.filter((l) => l.includes('duplicado')).length}, sin doc: ${sinDoc}, vacías: ${vacias}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
