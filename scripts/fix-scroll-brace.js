const fs = require('fs');
let c = fs.readFileSync('public/app.js', 'utf8');

const TARGET = ';requestAnimationFrame(()=>_restoreScrollSnapshot(_scrollRecibos))';
const idx = c.indexOf(TARGET);
if (idx < 0) { console.log('TARGET NOT FOUND'); process.exit(1); }

// Before `;` we have: } } ) } ) } ) 
// pos-7 pos-6 pos-5 pos-4 pos-3 pos-2 pos-1
// The } at pos-2 is the extra one — remove it
const chars = [...c.slice(idx-7,idx)].map((ch,i)=>`[${i}:${ch}]`).join('');
console.log('7 chars before ;rAF:', chars);
console.log('Removing } at idx-2...');
c = c.slice(0, idx - 2) + c.slice(idx - 1);
fs.writeFileSync('public/app.js', c, 'utf8');
console.log('Fixed!');

