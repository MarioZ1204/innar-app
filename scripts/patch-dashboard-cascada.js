/**
 * patch-dashboard-cascada.js
 * Improves cascade in Dashboard de Citas:
 *  1. cargarMedicosFiltro: stores all doctors in window._dashboardMedicos
 *  2. dashboardEspecialidad.change: also filters the doctors dropdown
 *  3. limpiarFiltrosDashboard: rebuilds full doctors list on clear
 */
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'public', 'dashboard-citas.js');
let content = fs.readFileSync(filePath, 'utf8');
let changes = 0;

// ─────────────────────────────────────────────────────────────────
// PATCH 1: cargarMedicosFiltro — store full list in window._dashboardMedicos
// ─────────────────────────────────────────────────────────────────
const OLD1 = `async function cargarMedicosFiltro(){const t=document.getElementById("dashboardMedico");if(t)try{const e=await apiFetch("/api/medicos");if(!e.ok)return;const a=await e.json(),o=t.value;t.innerHTML='<option value="">Todos los médicos</option>',(Array.isArray(a)?a:[]).forEach(e=>{const a=document.createElement("option");a.value=e.id,a.textContent=e.nombre,e.especialidad_id&&(a.dataset.especialidadId=e.especialidad_id),t.appendChild(a)}),o&&(t.value=o)}catch(t){console.warn("[DASHBOARD CITAS] No se pudieron cargar médicos:",t.message)}}`;

const NEW1 = `async function cargarMedicosFiltro(){const t=document.getElementById("dashboardMedico");if(t)try{const e=await apiFetch("/api/medicos");if(!e.ok)return;const a=await e.json(),o=t.value;window._dashboardMedicos=Array.isArray(a)?a:[];t.innerHTML='<option value="">Todos los médicos</option>';window._dashboardMedicos.forEach(e=>{const a=document.createElement("option");a.value=e.id;a.textContent=e.nombre;e.especialidad_id&&(a.dataset.especialidadId=e.especialidad_id);t.appendChild(a)});o&&(t.value=o)}catch(t){console.warn("[DASHBOARD CITAS] No se pudieron cargar médicos:",t.message)}}`;

// ─────────────────────────────────────────────────────────────────
// PATCH 2: dashboardEspecialidad.change — also filter doctors list
// ─────────────────────────────────────────────────────────────────
const OLD2 = `const n=document.getElementById("dashboardEspecialidad");n&&n.addEventListener("change",function(){cargarTiposEstudioFiltro(document.getElementById("dashboardTipoCita")?.value||"AGENDA_MEDICA",this.value)})`;

const NEW2 = `const n=document.getElementById("dashboardEspecialidad");n&&n.addEventListener("change",function(){const espId=this.value;cargarTiposEstudioFiltro(document.getElementById("dashboardTipoCita")?.value||"AGENDA_MEDICA",espId);const dm=document.getElementById("dashboardMedico");if(dm&&window._dashboardMedicos){const prev=dm.value;dm.innerHTML='<option value="">Todos los médicos</option>';window._dashboardMedicos.filter(m=>!espId||String(m.especialidad_id)===espId).forEach(m=>{const op=document.createElement("option");op.value=m.id;op.textContent=m.nombre;m.especialidad_id&&(op.dataset.especialidadId=m.especialidad_id);dm.appendChild(op)});espId&&!dm.querySelector('option[value="'+prev+'"]')?dm.value="":!espId&&prev&&(dm.value=prev)}})`;

// ─────────────────────────────────────────────────────────────────
// PATCH 3: limpiarFiltrosDashboard — rebuild full doctors list on clear
// ─────────────────────────────────────────────────────────────────
const OLD3 = `["dashboardMedico","dashboardEspecialidad","dashboardEstado","dashboardAgendadoPor"].forEach(t=>{const e=document.getElementById(t);e&&(e.value="")});window.clearMultiSelect(document.getElementById("dashboardEntidad"))`;

const NEW3 = `["dashboardMedico","dashboardEspecialidad","dashboardEstado","dashboardAgendadoPor"].forEach(t=>{const e=document.getElementById(t);e&&(e.value="")});if(window._dashboardMedicos){const _dm=document.getElementById("dashboardMedico");if(_dm){_dm.innerHTML='<option value="">Todos los médicos</option>';window._dashboardMedicos.forEach(m=>{const op=document.createElement("option");op.value=m.id;op.textContent=m.nombre;m.especialidad_id&&(op.dataset.especialidadId=m.especialidad_id);_dm.appendChild(op)})}};window.clearMultiSelect(document.getElementById("dashboardEntidad"))`;

// ─────────────────────────────────────────────────────────────────
// Apply all patches
// ─────────────────────────────────────────────────────────────────
const patches = [
  { name: 'cargarMedicosFiltro → store window._dashboardMedicos', old: OLD1, new: NEW1 },
  { name: 'dashboardEspecialidad.change → filter doctors list',    old: OLD2, new: NEW2 },
  { name: 'limpiarFiltrosDashboard → rebuild doctors list',        old: OLD3, new: NEW3 },
];

for (const patch of patches) {
  if (content.includes(patch.old)) {
    content = content.replace(patch.old, patch.new);
    changes++;
    console.log(`✓ [${changes}] ${patch.name}`);
  } else {
    console.warn(`⚠ NOT FOUND: ${patch.name}`);
    console.warn(`  First 100 chars: ${patch.old.substring(0, 100)}`);
  }
}

if (changes > 0) {
  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`\n✅ ${changes}/3 patches applied to public/dashboard-citas.js`);
} else {
  console.log('\nℹ No changes made to public/dashboard-citas.js');
}
