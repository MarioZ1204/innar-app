const c = require('fs').readFileSync('public/app.js', 'utf8');
// Check areas around my changes
const checkpoints = [
  {label:'_scrollTurnos area', start: 88100, end: 88700},
  {label:'_restoreScrollSnapshot(scrollTurnos) area', start: 91100, end: 91800},
  {label:'_scrollElectro area', start: 148400, end: 149100},
  {label:'setupPagination+restore area', start: 149800, end: 150300},
  {label:'_scrollRecibos area', start: 214600, end: 215200},
  {label:'_restoreScrollSnapshot(scrollRecibos) area', start: 220100, end: 220900},
];

for (const {label, start, end} of checkpoints) {
  const chunk = c.slice(start, end);
  console.log(`\n=== ${label} (${start}-${end}) ===`);
  console.log(chunk);
}
