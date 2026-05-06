const c = require('fs').readFileSync('public/app.js', 'utf8');
// Binary search within 249031-332042
let lo = 249031, hi = 332042;
while (hi - lo > 500) {
  const mid = Math.floor((lo + hi) / 2);
  try {
    new Function(c.slice(lo, mid) + '\n})');
    lo = mid; // ok, error is later
  } catch(e) {
    hi = mid; // error is earlier
  }
}
console.log(`Error near offset ${lo}-${hi}`);
console.log(JSON.stringify(c.slice(lo, hi)));
