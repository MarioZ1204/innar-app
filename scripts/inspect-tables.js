const c = require('fs').readFileSync('public/app.js', 'utf8');

// ---- cargarEsperaElectro ----
{
  const i = c.indexOf('async function cargarEsperaElectro');
  const chunk = c.slice(i, i + 3000);
  const j = chunk.indexOf('esperaTableBody');
  console.log('=== cargarEsperaElectro tbody ctx ===');
  console.log(chunk.slice(j - 20, j + 120));
  
  // Find the final .join("") that closes the render
  const k = chunk.lastIndexOf('.join("")}}');
  console.log('\n=== cargarEsperaElectro render end ===');
  console.log(chunk.slice(k - 60, k + 20));
}

// ---- cargarUcqn ----
{
  const i = c.indexOf('async function cargarUcqn');
  const chunk = c.slice(i, i + 3000);
  // Find the tbody var
  const j = chunk.indexOf('innerHTML');
  console.log('\n=== cargarUcqn first innerHTML ===');
  console.log(chunk.slice(j - 80, j + 80));
  
  // Find the end
  const k = chunk.lastIndexOf('.join("")');
  console.log('\n=== cargarUcqn render end ===');
  console.log(chunk.slice(k - 60, k + 100));
}
