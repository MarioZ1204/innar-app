/**
 * Patch temporal: doble asterisco, tooltip calendario, toggle slots vacíos
 * Ejecutar: node scripts/_patch-ui.js
 */
const fs = require('fs');
let ok = 0, fail = 0;

function patch(file, desc, oldStr, newStr) {
  let c = fs.readFileSync(file, 'utf8');
  if (c.includes(oldStr)) {
    c = c.replace(oldStr, newStr);
    fs.writeFileSync(file, c, 'utf8');
    console.log(`✓ [${++ok}] ${desc}`);
  } else {
    console.warn(`⚠ NOT FOUND: ${desc}`);
    fail++;
  }
}

// ─── 1. CSS: quitar asterisco doble (CSS auto-add conflicta con HTML explícito) ─
patch(
  'public/style.css',
  'CSS: eliminar label:has(+[required])::after',
  '.campo-requerido::after,label:has(+[required])::after,label:has(>[required])::after{content:" *";color:#dc2626;font-weight:700}',
  '.campo-requerido::after{content:" *";color:#dc2626;font-weight:700}'
);

// ─── 2. Backend: incluir disponible_manana/tarde en query del calendario ───
patch(
  'routes/turnos.js',
  'Backend: SELECT disponible_manana/tarde en calendario',
  `'SELECT fecha, disponible, motivo_ausencia FROM doctor_disponibilidad_mensual WHERE doctor_id = ? AND fecha >= ? AND fecha < ?'`,
  `'SELECT fecha, disponible, disponible_manana, disponible_tarde, motivo_ausencia FROM doctor_disponibilidad_mensual WHERE doctor_id = ? AND fecha >= ? AND fecha < ?'`
);

// ─── 3. calendario-agenda.js: guardar manana/tarde en disp cache ──────────
patch(
  'public/calendario-agenda.js',
  'Calendario: añadir manana/tarde al cache',
  '_citasCalDispCache[e]={disponible:parseInt(a.disponible),motivo:a.motivo_ausencia||null}',
  '_citasCalDispCache[e]={disponible:parseInt(a.disponible),motivo:a.motivo_ausencia||null,manana:a.disponible_manana!=null?parseInt(a.disponible_manana):1,tarde:a.disponible_tarde!=null?parseInt(a.disponible_tarde):1}'
);

// ─── 4. calendario-agenda.js: añadir vars de tooltip + title en celda ────
patch(
  'public/calendario-agenda.js',
  'Calendario: añadir tooltip hover en celdas',
  `;var f="UCQN"===_,h=_&&""!==_,b="ccal-rojo";if(!y&&f?b=p>10?"ccal-verde":"ccal-ucqn":y&&f?b="ccal-ucqn":y&&h?b="ccal-noasiste":y?b="ccal-bloqueado":C&&((C.no_asistieron||0)>0||(C.canceladas||0)>0)?b="ccal-rojo":C&&(C.reprogramadas||0)>0?b="ccal-azul":p>10?b="ccal-verde":p>=1&&(b="ccal-amarillo"),d+='<div class="ccal-cell '+b+(v?" ccal-hoy":"")+'" data-fecha="'+g+'"'+(!y||h?" onclick=\\"citasCalClickDia('"+g+"', this)\\"":"")+'><div class="ccal-dia-num">'+o+'</div><div class="ccal-dia-info">',h){`,
  `;var f="UCQN"===_,h=_&&""!==_,b="ccal-rojo",_ccalDur=(typeof selectedDoctorEspecialidad!=="undefined"&&selectedDoctorEspecialidad)?((selectedDoctorEspecialidad||"").toLowerCase().includes("neurolog")||(selectedDoctorEspecialidad||"").toLowerCase().includes("epileptolog")?25:40):40,_ccalMax=m?((m.manana!==0?Math.floor(240/_ccalDur):0)+(m.tarde!==0?Math.floor(240/_ccalDur):0)):0,_ccalLib=_ccalMax>0&&C?Math.max(0,_ccalMax-p):null,_ccalTip=C?"Agendadas: "+(C.agendadas||0)+(_ccalLib!==null?" | Libres: "+_ccalLib:"")+(C.atendidas?" | Atendidas: "+C.atendidas:"")+(C.no_asistieron?" | No asist.: "+C.no_asistieron:"")+(C.canceladas?" | Canceladas: "+C.canceladas:"")+(C.reprogramadas?" | Reprog.: "+C.reprogramadas:""):"";if(!y&&f?b=p>10?"ccal-verde":"ccal-ucqn":y&&f?b="ccal-ucqn":y&&h?b="ccal-noasiste":y?b="ccal-bloqueado":C&&((C.no_asistieron||0)>0||(C.canceladas||0)>0)?b="ccal-rojo":C&&(C.reprogramadas||0)>0?b="ccal-azul":p>10?b="ccal-verde":p>=1&&(b="ccal-amarillo"),d+='<div class="ccal-cell '+b+(v?" ccal-hoy":"")+'" data-fecha="'+g+'"'+(_ccalTip?' title="'+_ccalTip+'"':'')+(!y||h?" onclick=\\"citasCalClickDia('"+g+"', this)\\"":"")+'><div class="ccal-dia-num">'+o+'</div><div class="ccal-dia-info">',h){`
);

// ─── 5. app.js: añadir función toggleSlotVacio + _applySlotVacioVisibility ─
patch(
  'public/app.js',
  'App.js: añadir toggleSlotVacio y _applySlotVacioVisibility',
  'function crearFilaSlotVacio(e,t,o){const a=document.createElement("tr");a.className="turno-row turno-slot-vacio"',
  'let _mostrarSlotVacio=localStorage.getItem("agenda_mostrar_slots")!=="0";function toggleSlotVacio(){_mostrarSlotVacio=!_mostrarSlotVacio;localStorage.setItem("agenda_mostrar_slots",_mostrarSlotVacio?"1":"0");_applySlotVacioVisibility()}function _applySlotVacioVisibility(){const rows=document.querySelectorAll("#turnosTableBodyMedica .turno-slot-vacio");rows.forEach(r=>{r.style.display=_mostrarSlotVacio?"":"none"});const btn=document.getElementById("btnToggleSlotVacio");if(btn)btn.style.display=rows.length>0?"":"none";const lbl=document.getElementById("lblToggleSlot");if(lbl)lbl.textContent=_mostrarSlotVacio?"Ocultar libres":"Mostrar libres"}function crearFilaSlotVacio(e,t,o){const a=document.createElement("tr");a.className="turno-row turno-slot-vacio"'
);

// ─── 6. app.js: llamar _applySlotVacioVisibility tras cargar turnos ───────
patch(
  'public/app.js',
  'App.js: llamar _applySlotVacioVisibility en cargarTurnosMedica',
  'adjustColumnsForRole()}catch(B){showToast("Error cargando citas","error")',
  'adjustColumnsForRole();_applySlotVacioVisibility()}catch(B){showToast("Error cargando citas","error")'
);

console.log(`\n${ok} OK, ${fail} failed`);
