/**
 * patch-A-fix-syntax.js
 * Fixes syntax errors introduced by open try{} blocks without catch/finally
 */
const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, '..', 'public', 'app.js');
let content = fs.readFileSync(filePath, 'utf8');
let changes = 0;

// ─── FIX 1: crearCitaElectro — outer try needs catch+finally before function ends
// The inner try ends with: }catch(...){...}finally{setLoading(g,!1)}}$("electroDiagnostico")
// Add outer catch+finally between inner close and the }} 
const OLD1 = `}catch(e){showToast("Error creando cita: "+e.message,"error")}finally{setLoading(g,!1)}}$("electroDiagnostico")`;
const NEW1 = `}catch(e){showToast("Error creando cita: "+e.message,"error")}finally{setLoading(g,!1)}}catch(e){console.error("[crearCitaElectro] Error:",e)}finally{crearCitaElectro._saving=!1}}$("electroDiagnostico")`;

// ─── FIX 2: crearTurnoMedica — outer try needs catch+finally before function ends
// The function ends with the last else and then the function close }
const OLD2 = `}else showToast("Escribe los nombres del paciente","error")}function descargarPla`;
const NEW2 = `}else showToast("Escribe los nombres del paciente","error")}catch(e){console.error("[crearTurnoMedica] Error:",e)}finally{crearTurnoMedica._saving=!1;setLoading($("crearTurnoMedica"),!1)}}function descargarPla`;

// ─── FIX 3: confirmarFinalizarEstudio — _saving flag never reset (no finally was added)
// Find the catch block and convert }} to } finally {} }
const OLD3 = `}catch(e){console.error("[FINALIZAR] Error:",e),showToast("Error finalizando estudio","error")}}function cancelarFinalizarEstudio()`;
const NEW3 = `}catch(e){console.error("[FINALIZAR] Error:",e),showToast("Error finalizando estudio","error")}finally{confirmarFinalizarEstudio._saving=!1;setLoading($("btnConfirmarFinalizarSi"),!1)}}function cancelarFinalizarEstudio()`;

const patches = [
  { name: 'crearCitaElectro: close outer try + reset _saving',          old: OLD1, new: NEW1 },
  { name: 'crearTurnoMedica: close outer try + reset _saving + button', old: OLD2, new: NEW2 },
  { name: 'confirmarFinalizarEstudio: add finally to reset _saving',     old: OLD3, new: NEW3 },
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
  console.log(`\n✅ ${changes}/${patches.length} syntax fixes applied`);
} else {
  console.log('\nℹ No changes made');
}
