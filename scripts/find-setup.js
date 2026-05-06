const c = require('fs').readFileSync('public/app.js', 'utf8');
const i = c.indexOf('setupPagination');
// Find the cargarCitasElectro one specifically
let idx = 0;
while ((idx = c.indexOf('setupPagination', idx)) !== -1) {
  const ctx = c.slice(idx, idx + 300);
  if (ctx.includes('citasElectro')) {
    console.log('Found at:', idx);
    console.log(JSON.stringify(ctx));
    break;
  }
  idx++;
}
