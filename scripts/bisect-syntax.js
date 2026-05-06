const c = require('fs').readFileSync('public/app.js', 'utf8');
const half = Math.floor(c.length / 2);
try {
  new Function(c.slice(0, half) + '\n})');
  console.log('First half OK, error in second half');
} catch(e) {
  try {
    new Function(c.slice(half));
    console.log('Second half OK, error in first half');
  } catch(e2) {
    console.log('Error in both halves, trying quarters...');
  }
}
// Try quarters
const q1 = Math.floor(c.length / 4);
const q3 = Math.floor(c.length * 3 / 4);
[0, q1, half, q3].forEach((start, idx) => {
  const end = [q1, half, q3, c.length][idx];
  try {
    new Function(c.slice(start, end) + '\n})');
    console.log(`Quarter ${idx+1} (${start}-${end}): OK`);
  } catch(e) {
    console.log(`Quarter ${idx+1} (${start}-${end}): ERROR - ${e.message}`);
  }
});
