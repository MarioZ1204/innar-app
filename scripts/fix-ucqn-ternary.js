const fs = require('fs');
let c = fs.readFileSync('public/app.js', 'utf8');

// Replace broken ternary (two requestAnimationFrame calls) with if/else
const RESTORE = '_restoreScrollSnapshot(_scrollUcqn)';
const r1 = c.indexOf(RESTORE);
const r2 = c.indexOf(RESTORE, r1 + 1);

if (r1 < 0 || r2 < 0) { console.log('RESTORE not found'); process.exit(1); }

// The full region from c.length? to end of second restore
const TERNARY_START = 'c.length?i.innerHTML=c.map(e=>`';
const startIdx = c.indexOf(TERNARY_START);
const regionEnd = r2 + RESTORE.length + 1; // end of last )
const region = c.slice(startIdx, regionEnd);

// The region has form:
// c.length?i.innerHTML=c.map(...)  .join("");requestAnimationFrame(()=>_rest...) 
//   :i.innerHTML='...(empty state)';requestAnimationFrame(()=>_rest...)
// 
// Find the split point: the : of the ternary
// which is between the first restore and i.innerHTML=
const firstRestoreEnd = r1 - startIdx + RESTORE.length + 1; // +1 for )
// the : comes after requestAnimationFrame(()=>RESTORE)
// find :i.innerHTML= after first restore
const colonIdx = region.indexOf(':i.innerHTML=', firstRestoreEnd);
console.log('colonIdx:', colonIdx, 'firstRestoreEnd:', firstRestoreEnd);

const mapPart = region.slice('c.length?'.length, firstRestoreEnd); // the map HTML part through first restore
const elsePart = region.slice(colonIdx + 1); // from i.innerHTML='...' through second restore

console.log('mapPart ends:', mapPart.slice(-50));
console.log('elsePart starts:', elsePart.slice(0, 60));
console.log('elsePart ends:', elsePart.slice(-50));

// Build the replacement: if(c.length){i.innerHTML=...; rAF} else {i.innerHTML=...; rAF}
const replacement = 'if(c.length){i.innerHTML=' + mapPart + '}else{' + elsePart + '}';

c = c.slice(0, startIdx) + replacement + c.slice(regionEnd);
fs.writeFileSync('public/app.js', c, 'utf8');
console.log('\nFixed! Replaced', region.length, 'chars with', replacement.length, 'chars');

