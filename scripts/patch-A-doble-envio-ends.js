/**
 * patch-A-doble-envio-ends.js
 * Completa los finally blocks que el primer patch no encontró
 */
const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, '..', 'public', 'app.js');
let content = fs.readFileSync(filePath, 'utf8');
let changes = 0;

// ─── PATCH 2-fix: saveToDatabase end — '}catch(e){...}}function resetFormulario'
const OLD2 = `}catch(e){console.error(e),showToast("Error de conexión al guardar recibo","error")}}function resetFormulario()`;
const NEW2 = `}catch(e){console.error(e),showToast("Error de conexión al guardar recibo","error")}finally{generatePreview._saving=!1;setLoading($("generate"),!1)}}function resetFormulario()`;

// ─── PATCH 4b-fix: guardarCambiosCitaElectro end
// The actual text: 'showToast("No hay cambios para guardar","info"),cerrarModalDetallesCita()}catch(e){showToast("Error guardando cambios: "+e.message,"error")}}'
// followed by 'function abrirModalReprogramar'
const OLD4b = `showToast("No hay cambios para guardar","info"),cerrarModalDetallesCita()}catch(e){showToast("Error guardando cambios: "+e.message,"error")}}function abrirModalReprogramar()`;
const NEW4b = `showToast("No hay cambios para guardar","info"),cerrarModalDetallesCita()}catch(e){showToast("Error guardando cambios: "+e.message,"error")}finally{guardarCambiosCitaElectro._saving=!1;setLoading($("btnGuardarCambios"),!1)}}function abrirModalReprogramar()`;

// ─── PATCH 3b-fix: crearCitaElectro end — need to find it
// Search for exact end of crearCitaElectro
// From the grep I see it ends with a catch that shows "Error al crear la cita" 
// Let me look for what comes AFTER it
// We need to look at what function comes after crearCitaElectro
// From the search we see: the try block was patched to have try{ at beginning
// The catch ends: showToast("Error al crear la cita","error")
// But we need the exact surrounding text since there may be multiple similar toasts

// Let me find context around crearCitaElectro end by searching for unique text in that function
const OLD3b = `showToast("Cita programada correctamente","success"),cargarCitasElectro(),$("electroPacienteNombres").value="",$("electroPacienteApellidos").value="",$("electroDocumento").value="",$("electroTelefono").value=""}catch(e){showToast("Error al crear la cita","error")}async function iniciarEstudioModal()`;
const NEW3b = `showToast("Cita programada correctamente","success"),cargarCitasElectro(),$("electroPacienteNombres").value="",$("electroPacienteApellidos").value="",$("electroDocumento").value="",$("electroTelefono").value=""}catch(e){showToast("Error al crear la cita","error")}finally{crearCitaElectro._saving=!1;setLoading($("crearCitaElectro"),!1)}}async function iniciarEstudioModal()`;

// ─── confirmarFinalizarEstudio end ───
const OLD5b = `showToast("Error al finalizar el estudio","error")}}async function finalizarEstudioModal()`;
const NEW5b = `showToast("Error al finalizar el estudio","error")}finally{confirmarFinalizarEstudio._saving=!1;setLoading($("btnConfirmarFinalizarSi"),!1)}}async function finalizarEstudioModal()`;

// ─── crearTurnoMedica end ───
const OLD6b = `showToast("Error al crear la cita","error")}}async function guardarNombrePacienteMedica()`;
const NEW6b = `showToast("Error al crear la cita","error")}finally{crearTurnoMedica._saving=!1;setLoading($("crearTurnoMedica"),!1)}}async function guardarNombrePacienteMedica()`;

const patches = [
  { name: 'saveToDatabase: finally block',                  old: OLD2,  new: NEW2  },
  { name: 'guardarCambiosCitaElectro: finally block',       old: OLD4b, new: NEW4b },
  { name: 'crearCitaElectro: finally block',                old: OLD3b, new: NEW3b },
  { name: 'confirmarFinalizarEstudio: finally block',        old: OLD5b, new: NEW5b },
  { name: 'crearTurnoMedica: finally block',                old: OLD6b, new: NEW6b },
];

for (const p of patches) {
  if (content.includes(p.old)) {
    content = content.replace(p.old, p.new);
    changes++;
    console.log(`✓ [${changes}] ${p.name}`);
  } else {
    console.warn(`⚠ NOT FOUND: ${p.name}`);
    console.warn(`  Snippet: ${p.old.substring(0, 100)}`);
  }
}

if (changes > 0) {
  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`\n✅ ${changes}/${patches.length} end-patches applied`);
} else {
  console.log('\nℹ No changes made');
}
