const c = require('fs').readFileSync('public/app.js', 'utf8');

// Find all try{ positions
const tries = [];
let idx = 0;
while ((idx = c.indexOf('try{', idx)) !== -1) {
  tries.push(idx);
  idx++;
}
console.log('Total try{ blocks:', tries.length);

// For each try, scan forward properly to find the matching catch/finally
// We do a simplified scan (no string tracking for speed)
for (const start of tries) {
  let i = start + 4; // skip 'try{'
  let depth = 1;
  let found = false;
  const limit = Math.min(start + 50000, c.length);
  while (i < limit && depth > 0) {
    if (c[i] === '{') depth++;
    else if (c[i] === '}') {
      depth--;
      if (depth === 0) {
        // Check what follows
        const after = c.slice(i + 1, i + 20);
        if (!after.startsWith('catch') && !after.startsWith('finally')) {
          console.log('ORPHAN TRY at offset', start);
          console.log('Context before:', JSON.stringify(c.slice(start - 80, start + 50)));
          console.log('After closing }:', JSON.stringify(c.slice(i, i + 80)));
        }
        found = true;
        break;
      }
    }
    i++;
  }
  if (!found) {
    console.log('UNCLOSED TRY at offset', start);
    console.log('Context:', JSON.stringify(c.slice(start - 80, start + 50)));
  }
}
console.log('Done');
