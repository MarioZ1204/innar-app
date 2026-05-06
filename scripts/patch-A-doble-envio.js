/**
 * patch-A-doble-envio.js
 * Previene doble envío en los formularios principales:
 *  1. Generar Recibo (button #generate → generatePreview → saveToDatabase)
 *  2. Crear Cita Electro (button #crearCitaElectro)
 *  3. Guardar Cambios Cita Electro (button #btnGuardarCambios)
 *  4. Confirmar Finalizar Estudio (button #btnConfirmarFinalizarSi)
 *  5. Crear Turno Agenda Médica (button #crearTurnoMedica)
 */
const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, '..', 'public', 'app.js');
let content = fs.readFileSync(filePath, 'utf8');
let changes = 0;

// ─── PATCH 1: generatePreview — add _saving guard + disable #generate button ───
const OLD1 = `function generatePreview(){if(!validarFormulario())return;const e=collectFormData();`;
const NEW1 = `function generatePreview(){if(generatePreview._saving)return;if(!validarFormulario())return;const _genBtn=$("generate");setLoading(_genBtn,!0,"Guardando...");generatePreview._saving=!0;const e=collectFormData();`;

// ─── PATCH 2: saveToDatabase — clear the flag and button after save ───
const OLD2 = `}else showToast("Error guardando: "+(a.error||"desconocido"),"error")}catch(e){console.error(e),showToast("Error de conexión al guardar recibo","error")}}function validarFormulario()`;
const NEW2 = `}else showToast("Error guardando: "+(a.error||"desconocido"),"error")}catch(e){console.error(e),showToast("Error de conexión al guardar recibo","error")}finally{generatePreview._saving=!1;setLoading($("generate"),!1)}}function validarFormulario()`;

// ─── PATCH 3: crearCitaElectro — add _saving guard ───
const OLD3 = `async function crearCitaElectro(){const e=$("electroEstudio").value;if(!e)return showToast("Debes seleccionar un estudio para programar la cita","error"),$("electroEstudio").focus(),void($("electroEstudio").style.borderColor="#dc2626");`;
const NEW3 = `async function crearCitaElectro(){if(crearCitaElectro._saving)return;crearCitaElectro._saving=!0;const _btn=$("crearCitaElectro");setLoading(_btn,!0,"Programando...");try{const e=$("electroEstudio").value;if(!e){setLoading(_btn,!1);crearCitaElectro._saving=!1;showToast("Debes seleccionar un estudio para programar la cita","error");$("electroEstudio").focus();$("electroEstudio").style.borderColor="#dc2626";return;}`;

// We need to patch the end of crearCitaElectro too — find a unique string near its end
const OLD3b = `showToast("Error al crear la cita","error")}}async function iniciarEstudioModal()`;
const NEW3b = `showToast("Error al crear la cita","error")}finally{crearCitaElectro._saving=!1;setLoading($("crearCitaElectro"),!1)}}async function iniciarEstudioModal()`;

// ─── PATCH 4: guardarCambiosCitaElectro — add _saving guard ───
const OLD4 = `async function guardarCambiosCitaElectro(){if(citaElectroSeleccionada)try{const e=citaElectroSeleccionada.estado||"";if("En Estudio"===e||"Pausado"===e)return void showToast("No puedes cambiar el equipo mientras el estudio está activo","error");`;
const NEW4 = `async function guardarCambiosCitaElectro(){if(guardarCambiosCitaElectro._saving)return;if(citaElectroSeleccionada)try{guardarCambiosCitaElectro._saving=!0;setLoading($("btnGuardarCambios"),!0);const e=citaElectroSeleccionada.estado||"";if("En Estudio"===e||"Pausado"===e){guardarCambiosCitaElectro._saving=!1;setLoading($("btnGuardarCambios"),!1);return void showToast("No puedes cambiar el equipo mientras el estudio está activo","error");}`;

// Find end of guardarCambiosCitaElectro
const OLD4b = `showToast("Sin cambios que guardar","info")}function renderFlujoEstado`;
const NEW4b = `showToast("Sin cambios que guardar","info")}finally{guardarCambiosCitaElectro._saving=!1;setLoading($("btnGuardarCambios"),!1)}}function renderFlujoEstado`;

// ─── PATCH 5: confirmarFinalizarEstudio — add _saving guard ───
const OLD5 = `async function confirmarFinalizarEstudio(){if(!citaElectroSeleccionada)return;const e=$("modalConfirmarFinalizarEstudio");e&&e.classList.add("hidden");try{const e=new Date,t=`;
const NEW5 = `async function confirmarFinalizarEstudio(){if(confirmarFinalizarEstudio._saving)return;if(!citaElectroSeleccionada)return;confirmarFinalizarEstudio._saving=!0;const _fbtn=$("btnConfirmarFinalizarSi");setLoading(_fbtn,!0,"Finalizando...");const e=$("modalConfirmarFinalizarEstudio");e&&e.classList.add("hidden");try{const e=new Date,t=`;

// Find end of confirmarFinalizarEstudio
const OLD5b = `showToast("Error al finalizar el estudio","error")}}async function finalizarEstudioModal()`;
const NEW5b = `showToast("Error al finalizar el estudio","error")}finally{confirmarFinalizarEstudio._saving=!1;setLoading($("btnConfirmarFinalizarSi"),!1)}}async function finalizarEstudioModal()`;

// ─── PATCH 6: crearTurnoMedica — add _saving guard ───
const OLD6 = `async function crearTurnoMedica(){const e=$("nuevoPacienteNombresMedica")?.value.trim()||"",t=$("nuevoPacienteApellidosMedica")?.value.trim()||""`;
const NEW6 = `async function crearTurnoMedica(){if(crearTurnoMedica._saving)return;crearTurnoMedica._saving=!0;const _tb=$("crearTurnoMedica");setLoading(_tb,!0,"Creando...");try{const e=$("nuevoPacienteNombresMedica")?.value.trim()||"",t=$("nuevoPacienteApellidosMedica")?.value.trim()||""`;

// Find end of crearTurnoMedica
const OLD6b = `showToast("Error al crear la cita","error")}}async function guardarNombrePacienteMedica()`;
const NEW6b = `showToast("Error al crear la cita","error")}finally{crearTurnoMedica._saving=!1;setLoading($("crearTurnoMedica"),!1)}}async function guardarNombrePacienteMedica()`;

// ─────────────────────────────────────────────────────────────────
const patches = [
  { name: 'generatePreview: add _saving guard + setLoading',             old: OLD1,  new: NEW1  },
  { name: 'saveToDatabase: clear flag + button in finally',               old: OLD2,  new: NEW2  },
  { name: 'crearCitaElectro: add _saving guard (start)',                  old: OLD3,  new: NEW3  },
  { name: 'crearCitaElectro: clear flag in finally (end)',                old: OLD3b, new: NEW3b },
  { name: 'guardarCambiosCitaElectro: add _saving guard (start)',         old: OLD4,  new: NEW4  },
  { name: 'guardarCambiosCitaElectro: clear flag in finally (end)',       old: OLD4b, new: NEW4b },
  { name: 'confirmarFinalizarEstudio: add _saving guard + setLoading',    old: OLD5,  new: NEW5  },
  { name: 'confirmarFinalizarEstudio: clear flag in finally (end)',        old: OLD5b, new: NEW5b },
  { name: 'crearTurnoMedica: add _saving guard (start)',                  old: OLD6,  new: NEW6  },
  { name: 'crearTurnoMedica: clear flag in finally (end)',                old: OLD6b, new: NEW6b },
];

for (const p of patches) {
  if (content.includes(p.old)) {
    content = content.replace(p.old, p.new);
    changes++;
    console.log(`✓ [${changes}] ${p.name}`);
  } else {
    console.warn(`⚠ NOT FOUND: ${p.name}`);
    console.warn(`  Snippet: ${p.old.substring(0, 80)}`);
  }
}

if (changes > 0) {
  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`\n✅ ${changes}/${patches.length} patches applied`);
} else {
  console.log('\nℹ No changes made');
}
