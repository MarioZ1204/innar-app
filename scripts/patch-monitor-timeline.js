const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '../docs/legacy/app.pre-minify.js');
const replacementPath = path.join(__dirname, 'patch-monitor-timeline-replacement.txt');

let s = fs.readFileSync(target, 'utf8');
let replacement = fs.readFileSync(replacementPath, 'utf8');
replacement = replacement.replace(/<\/?motion\b/g, (tag) => tag.replace(/motion/g, 'div'));

const startMarker = '  function histEstadoClass(estado) {';
const endMarker = '  grid.innerHTML = html;';
const start = s.indexOf(startMarker);
const end = s.indexOf(endMarker, start);
if (start < 0 || end < 0) {
  console.error('Markers not found', { start, end });
  process.exit(1);
}
const endPos = end + endMarker.length;

s = s.slice(0, start) + replacement + s.slice(endPos);
fs.writeFileSync(target, s);
console.log('Patched renderMonitorEquipos timeline');
