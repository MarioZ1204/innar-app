const c = require('fs').readFileSync('public/app.js', 'utf8');
const idx = c.indexOf('.btn-eliminar.delete');
if (idx < 0) { console.log('NOT FOUND'); process.exit(1); }

// Track brace depth from forEach start
let depth = 0;
let parenDepth = 0;
const start = c.indexOf('forEach', idx);
let i = start;
const chars = [];
while (i < start + 600) {
  const ch = c[i];
  if (ch === '{') depth++;
  else if (ch === '}') depth--;
  else if (ch === '(') parenDepth++;
  else if (ch === ')') parenDepth--;
  chars.push(ch);
  if (parenDepth < 0) {
    console.log('Paren closed at offset', i - start, 'depth=', depth);
    console.log('Chars so far end:', chars.slice(-30).join(''));
    console.log('Context:', JSON.stringify(c.slice(i-10,i+60)));
    break;
  }
  i++;
}
