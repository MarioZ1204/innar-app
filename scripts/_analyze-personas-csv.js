const fs = require('fs');
const { limpiarDireccionRepetida, parsePersonasCsvLine } = require('../utils/anexo-fidu-personas');

const path = process.argv[2] || 'c:/Users/Usuario/Downloads/Base de Datos - Facturación - Lista_Personas.csv';

function parseCsvLine(line) {
  const row = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQ = !inQ; continue; }
    if (ch === ',' && !inQ) { row.push(cur); cur = ''; continue; }
    cur += ch;
  }
  row.push(cur);
  return row;
}

const raw = fs.readFileSync(path, 'utf8');
const lines = raw.split(/\r?\n/).filter((l) => l.trim());
const stats = { total: lines.length - 1, empty: 0, long: 0, dup: 0, samples: [], docsDup: {} };

for (let i = 1; i < lines.length; i++) {
  const row = parseCsvLine(lines[i]);
  const dir = row[9] || '';
  if (!dir.trim()) stats.empty++;
  if (dir.length > 100) stats.long++;
  const cleaned = limpiarDireccionRepetida(dir);
  if (cleaned !== dir.trim()) {
    stats.dup++;
    if (stats.samples.length < 10) {
      stats.samples.push({ line: i + 1, before: dir.slice(0, 100), after: cleaned });
    }
  }
  const doc = (row[0] || '').trim();
  if (doc) stats.docsDup[doc] = (stats.docsDup[doc] || 0) + 1;
}

const dupDocs = Object.entries(stats.docsDup).filter(([, n]) => n > 1);
delete stats.docsDup;
stats.duplicateDocuments = dupDocs.length;
console.log(JSON.stringify(stats, null, 2));
