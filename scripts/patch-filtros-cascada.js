/**
 * patch-filtros-cascada.js
 * Adds specialty cascade filter to Recibos module:
 *   médico → auto-populates especialidad → tipos de consulta
 *   filtroEspecialidad → filters doctors list → loads tipos de consulta
 * Also patches aplicarFiltrosRecibos to filter by specialty when no doctor selected.
 */
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'public', 'app.js');
let content = fs.readFileSync(filePath, 'utf8');
let changes = 0;

// ─────────────────────────────────────────────────────────────────
// PATCH 1: cargarFiltrosMedicos — store window._filtroMedicos,
//          add data-especialidad-id/nombre on options,
//          populate filtroEspecialidad with unique specialties.
// ─────────────────────────────────────────────────────────────────
const OLD1 = `async function cargarFiltrosMedicos(){const e=$("filtroMedico");if(e)try{const t=await apiFetch("/api/medicos"),o=t.ok?await t.json():[];if(!Array.isArray(o))return void console.warn("[cargarFiltrosMedicos] Respuesta no es array");e.innerHTML='<option value="">Todos los médicos</option>',o.forEach(t=>{const o=document.createElement("option");o.value=t.id,o.textContent=t.nombre||t.usuario,e.appendChild(o)});const a=document.createElement("option");a.value="ELECTRODIAGNOSTICOS",a.textContent="ELECTRODIAGNÓSTICOS",e.appendChild(a)}catch(e){console.warn("[cargarFiltrosMedicos] Error:",e.message)}}`;

const NEW1 = `async function cargarFiltrosMedicos(){const e=$("filtroMedico");if(e)try{const t=await apiFetch("/api/medicos"),o=t.ok?await t.json():[];if(!Array.isArray(o))return void console.warn("[cargarFiltrosMedicos] Respuesta no es array");window._filtroMedicos=o;e.innerHTML='<option value="">Todos los médicos</option>';o.forEach(t=>{const o=document.createElement("option");o.value=t.id;o.textContent=t.nombre||t.usuario;t.especialidad_id&&(o.dataset.especialidadId=t.especialidad_id);t.especialidad&&(o.dataset.especialidadNombre=t.especialidad);e.appendChild(o)});const a=document.createElement("option");a.value="ELECTRODIAGNOSTICOS";a.textContent="ELECTRODIAGNÓSTICOS";e.appendChild(a);const f=$("filtroEspecialidad");if(f){const m=new Map();o.forEach(d=>{d.especialidad_id&&d.especialidad&&!m.has(d.especialidad_id)&&m.set(d.especialidad_id,d.especialidad)});f.innerHTML='<option value="">Todas las especialidades</option>';m.forEach((nombre,id)=>{const op=document.createElement("option");op.value=id;op.textContent=nombre;f.appendChild(op)})}}catch(e){console.warn("[cargarFiltrosMedicos] Error:",e.message)}}`;

// ─────────────────────────────────────────────────────────────────
// PATCH 2: médico multiselect onChange — when 1 doctor selected,
//          auto-populate filtroEspecialidad with their specialty.
// ─────────────────────────────────────────────────────────────────
const OLD2 = `o._ms?o._ms.refresh():initMultiSelect(o,{placeholder:"Todos",onChange:()=>{clearMultiSelect($("filtroEstudio")),aplicarFiltrosRecibos()}}),t.style.display=""`;

const NEW2 = `o._ms?o._ms.refresh():initMultiSelect(o,{placeholder:"Todos",onChange:()=>{clearMultiSelect($("filtroEstudio")),aplicarFiltrosRecibos()}}),t.style.display="";const _med=(window._filtroMedicos||[]).find(m=>String(m.id)===String(e[0])),_fesp=$("filtroEspecialidad");_fesp&&_med&&_med.especialidad_id&&(_fesp.value=String(_med.especialidad_id))`;

// ─────────────────────────────────────────────────────────────────
// PATCH 3: Add filtroEspecialidad change listener inside the
//          cargarFiltrosMedicos().then() callback.
//          Uses a very specific context string to avoid false matches.
// ─────────────────────────────────────────────────────────────────
const OLD3 = `aplicarFiltrosRecibos()}}),observeSelectForMulti(e))}),cargarFiltrosUsuarios().then(()=>{const e=$("filtroGeneradoPor")`;

const NEW3 = `aplicarFiltrosRecibos()}}),observeSelectForMulti(e));const _fe=$("filtroEspecialidad");_fe&&!_fe._espBound&&(_fe._espBound=1,_fe.addEventListener("change",async function(){const espId=this.value;const fm=$("filtroMedico");if(fm&&window._filtroMedicos){fm.innerHTML='<option value="">Todos los médicos</option>';window._filtroMedicos.filter(m=>!espId||String(m.especialidad_id)===espId).forEach(m=>{const o=document.createElement("option");o.value=m.id;o.textContent=m.nombre||m.usuario;m.especialidad_id&&(o.dataset.especialidadId=m.especialidad_id);m.especialidad&&(o.dataset.especialidadNombre=m.especialidad);fm.appendChild(o)});if(!espId){const ao=document.createElement("option");ao.value="ELECTRODIAGNOSTICOS";ao.textContent="ELECTRODIAGNÓSTICOS";fm.appendChild(ao)}fm._ms&&fm._ms.refresh();clearMultiSelect(fm)}const ftw=$("filtroTipoConsultaWrap"),ftc=$("filtroTipoConsulta");if(ftw&&ftc){if(espId){try{const tipos=await apiFetch("/api/tipos-consulta?especialidad_id="+encodeURIComponent(espId)).then(r=>r.json());ftc.innerHTML='<option value="">Todos</option>';(Array.isArray(tipos)?tipos:[]).forEach(t=>{const op=document.createElement("option");op.value=t.nombre;op.textContent=t.nombre;ftc.appendChild(op)});ftc._ms?ftc._ms.refresh():initMultiSelect(ftc,{placeholder:"Todos",onChange:()=>{clearMultiSelect($("filtroEstudio"));aplicarFiltrosRecibos()}});ftw.style.display=""}catch(err){ftw.style.display="none";clearMultiSelect(ftc)}}else{ftw.style.display="none";clearMultiSelect(ftc)}}aplicarFiltrosRecibos()}))}),cargarFiltrosUsuarios().then(()=>{const e=$("filtroGeneradoPor")`;

// ─────────────────────────────────────────────────────────────────
// PATCH 4: aplicarFiltrosRecibos — when filtroEspecialidad is set
//          but no specific doctor is selected, send the medico_ids
//          of all doctors with that specialty.
// ─────────────────────────────────────────────────────────────────
const OLD4 = `n&&"ELECTRODIAGNOSTICOS"===n?u.set("medico_nombre","ELECTRODIAGNÓSTICOS"):n&&u.set("medico_id",n)`;

const NEW4 = `n&&"ELECTRODIAGNOSTICOS"===n?u.set("medico_nombre","ELECTRODIAGNÓSTICOS"):n?u.set("medico_id",n):$("filtroEspecialidad")?.value&&(()=>{const _espIds=(window._filtroMedicos||[]).filter(m=>String(m.especialidad_id)===$("filtroEspecialidad").value).map(m=>m.id).join(",");_espIds&&u.set("medico_id",_espIds)})()`;

// ─────────────────────────────────────────────────────────────────
// PATCH 5: limpiarFiltrosRecibos — reset filtroEspecialidad and
//          rebuild the full doctors list in filtroMedico.
// ─────────────────────────────────────────────────────────────────
const OLD5 = `clearMultiSelect($("filtroTipoConsulta")),clearMultiSelect($("filtroEstudio")),$("filtroEstadoPago")&&($("filtroEstadoPago").value=""),$("filtroPalabraClave")&&($("filtroPalabraClave").value="");const e=$("filtroTipoConsultaWrap");e&&(e.style.display="none"),_recibosLastParams="",cargarLista()`;

const NEW5 = `clearMultiSelect($("filtroTipoConsulta")),clearMultiSelect($("filtroEstudio")),$("filtroEstadoPago")&&($("filtroEstadoPago").value=""),$("filtroPalabraClave")&&($("filtroPalabraClave").value="");$("filtroEspecialidad")&&($("filtroEspecialidad").value="");const _fmr=$("filtroMedico");if(_fmr&&window._filtroMedicos){_fmr.innerHTML='<option value="">Todos los médicos</option>';window._filtroMedicos.forEach(m=>{const o=document.createElement("option");o.value=m.id;o.textContent=m.nombre||m.usuario;m.especialidad_id&&(o.dataset.especialidadId=m.especialidad_id);m.especialidad&&(o.dataset.especialidadNombre=m.especialidad);_fmr.appendChild(o)});const ao=document.createElement("option");ao.value="ELECTRODIAGNOSTICOS";ao.textContent="ELECTRODIAGNÓSTICOS";_fmr.appendChild(ao);_fmr._ms&&_fmr._ms.refresh()};const e=$("filtroTipoConsultaWrap");e&&(e.style.display="none"),_recibosLastParams="",cargarLista()`;

// ─────────────────────────────────────────────────────────────────
// Apply all patches
// ─────────────────────────────────────────────────────────────────
const patches = [
  { name: 'cargarFiltrosMedicos + data-attrs + populate filtroEspecialidad', old: OLD1, new: NEW1 },
  { name: 'médico onChange → auto-populate filtroEspecialidad',              old: OLD2, new: NEW2 },
  { name: 'filtroEspecialidad change listener (cascade)',                    old: OLD3, new: NEW3 },
  { name: 'aplicarFiltrosRecibos → specialty fallback medico_ids',          old: OLD4, new: NEW4 },
  { name: 'limpiarFiltrosRecibos → reset especialidad + rebuild doctors',   old: OLD5, new: NEW5 },
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
  console.log(`\n✅ ${changes}/5 patches applied to public/app.js`);
} else {
  console.log('\nℹ No changes made to public/app.js');
}
