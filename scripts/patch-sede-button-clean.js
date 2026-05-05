// patch-sede-button-clean.js
// Removes <br><small> address text from sede modal buttons in app.js
// so buttons only show "Sede Principal" and "Sede Servicios Complementarios"

const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'public', 'app.js');
let content = fs.readFileSync(filePath, 'utf8');

const OLD_B1 = `b1.innerHTML="Sede Principal<br><small style='font-weight:400;opacity:.9'>Calle 14A #34-13. Edificio esquinero. Barrio San Ignacio. Pasto.</small>";`;
const NEW_B1 = `b1.innerHTML="Sede Principal";`;

const OLD_B2 = `b2.innerHTML="Sede Servicios Complementarios<br><small style='font-weight:400;opacity:.9'>Carrera 33 #13-84. Casa esquinera. Barrio San Ignacio. Pasto.</small>";`;
const NEW_B2 = `b2.innerHTML="Sede Servicios Complementarios";`;

let changed = 0;

if (content.includes(OLD_B1)) {
  content = content.replace(OLD_B1, NEW_B1);
  changed++;
  console.log('✓ Patched b1.innerHTML (Sede Principal)');
} else {
  console.warn('⚠ b1.innerHTML OLD string not found - may already be patched or changed');
}

if (content.includes(OLD_B2)) {
  content = content.replace(OLD_B2, NEW_B2);
  changed++;
  console.log('✓ Patched b2.innerHTML (Sede Servicios Complementarios)');
} else {
  console.warn('⚠ b2.innerHTML OLD string not found - may already be patched or changed');
}

if (changed > 0) {
  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`\n✅ ${changed} patch(es) applied to public/app.js`);
} else {
  console.log('\nℹ No changes needed - file may already be patched');
}
