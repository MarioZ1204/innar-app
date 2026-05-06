const c = require('fs').readFileSync('public/app.js', 'utf8');
const i = c.indexOf('async function cargarTurnosMedica');
const chunk = c.slice(i, i+4000);
// Find the count update after rendering
const j = chunk.indexOf('"citasTableCount"');
console.log('citasTableCount at relative:', j);
console.log(JSON.stringify(chunk.slice(j-300, j+100)));
