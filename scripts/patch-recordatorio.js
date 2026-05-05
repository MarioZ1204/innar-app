'use strict';
/**
 * Patch: actualiza funciones de recordatorio WhatsApp en public/app.js
 * - Corrige encoding de caracteres especiales (unicode escapes)
 * - Agrega selección de sede antes de enviar
 * - Actualiza dirección y links de ubicación
 */
const fs = require('fs');
const path = require('path');

const appJsPath = path.join(__dirname, '..', 'public', 'app.js');
let content = fs.readFileSync(appJsPath, 'utf8');

const START_MARKER = 'function construirMensajeRecordatorioMedica(';
const END_MARKER = 'function abrirModalEstadoCitaMedica(';

const startIdx = content.indexOf(START_MARKER);
const endIdx   = content.indexOf(END_MARKER);

if (startIdx === -1 || endIdx === -1 || startIdx >= endIdx) {
  console.error('❌ No se encontraron los marcadores en app.js.');
  console.error('  startIdx:', startIdx, '  endIdx:', endIdx);
  process.exit(1);
}

// New replacement code (unicode escapes guarantee correct encoding regardless of file encoding)
const newCode = [
  // ── construirMensajeRecordatorioMedica ───────────────────────────────────
  'function construirMensajeRecordatorioMedica(e,t,sede){',
    'const o=e?.paciente_nombre||"",',
    'a=e?.fecha?formatearFechaISO(e.fecha):"-",',
    'n=e?.hora?formatearHora(e.hora):"-",',
    'r=t||"Neuropsicolog\u00eda",',
    'i=obtenerNombreEspecialistaRecordatorio(),',
    'ub=sede==="2"',
      '?"Carrera 34 #13-80, Barrio San Ignacio, Pasto, Nari\u00f1o (https://maps.app.goo.gl/YU5GheUmVMDAHFbq8)"',
      ':"Carrera 34 #13-80, Barrio San Ignacio, Pasto, Nari\u00f1o (https://maps.app.goo.gl/6cX18NUY8i8p5KQe9)";',
    'return "\u00a1Hola, buen d\u00eda!. Le recordamos su cita de "',
      '+r+" en el Instituto Neurociencias de Nari\u00f1o IPS S.A.S:\\n"',
      '+"\u25c9 Paciente: "+o+"\\n"',
      '+"\u25c9 Fecha: "+a+"\\n"',
      '+"\u25c9 Hora: "+n+"\\n"',
      '+"\u25c9 Especialista: "+(i||"Por confirmar")+"\\n"',
      '+"\u25c9 Ubicaci\u00f3n: "+ub+"\\n"',
      '+"Cualquier novedad, no dude en comunicarse con nosotros.\\n\\n"',
      '+"NOTA: Por favor confirmar su asistencia lo antes posible. Muchas gracias."',
  '}',

  // ── _crearModalSede (helper interno) ────────────────────────────────────
  'function _crearModalSede(){',
    'const m=document.createElement("div");',
    'm.id="modalSedeRecordatorio";',
    'm.style.cssText="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.5);display:none;align-items:center;justify-content:center;z-index:2000;padding:20px";',
    'const box=document.createElement("div");',
    'box.style.cssText="background:white;border-radius:12px;padding:32px;max-width:400px;width:100%;box-shadow:0 20px 25px -5px rgba(0,0,0,.2)";',
    'const h3=document.createElement("h3");',
    'h3.style.cssText="margin:0 0 8px;color:#1f2937;font-size:1.1rem";',
    'h3.textContent="\u00bfA cu\u00e1l sede va el paciente?";',
    'const p=document.createElement("p");',
    'p.style.cssText="margin:0 0 24px;color:#6b7280;font-size:0.9rem";',
    'p.textContent="Selecciona la sede para incluir la direcci\u00f3n correcta en el recordatorio.";',
    'const wrap=document.createElement("div");',
    'wrap.style.cssText="display:flex;flex-direction:column;gap:12px";',
    'const b1=document.createElement("button");',
    'b1.id="sedeRBtn1";',
    'b1.style.cssText="padding:14px 20px;background:#10b981;color:white;border:none;border-radius:8px;font-size:1rem;cursor:pointer;font-weight:600;text-align:center";',
    'b1.innerHTML="Sede Principal<br><small style=\'font-weight:400;opacity:.9\'>Carrera 34 #13-80, San Ignacio</small>";',
    'const b2=document.createElement("button");',
    'b2.id="sedeRBtn2";',
    'b2.style.cssText="padding:14px 20px;background:#3b82f6;color:white;border:none;border-radius:8px;font-size:1rem;cursor:pointer;font-weight:600;text-align:center";',
    'b2.innerHTML="Sede 2<br><small style=\'font-weight:400;opacity:.9\'>Carrera 34 #13-80, San Ignacio</small>";',
    'const bc=document.createElement("button");',
    'bc.id="sedeRBtnCancel";',
    'bc.style.cssText="padding:10px;background:#f3f4f6;color:#374151;border:none;border-radius:8px;font-size:0.9rem;cursor:pointer";',
    'bc.textContent="Cancelar";',
    'wrap.appendChild(b1);wrap.appendChild(b2);wrap.appendChild(bc);',
    'box.appendChild(h3);box.appendChild(p);box.appendChild(wrap);',
    'm.appendChild(box);document.body.appendChild(m);',
    'return m',
  '}',

  // ── mostrarModalSedeRecordatorio ─────────────────────────────────────────
  'function mostrarModalSedeRecordatorio(cita){',
    'const tel=String(cita.paciente_telefono||"").replace(/\\D/g,"");',
    'if(!tel||tel.length<7)return void showToast("La cita no tiene un tel\u00e9fono v\u00e1lido para enviar recordatorio","error");',
    'let m=document.getElementById("modalSedeRecordatorio");',
    'if(!m)m=_crearModalSede();',
    'm.style.display="flex";',
    'const enviar=sede=>{',
      'const msg=construirMensajeRecordatorioMedica(cita,selectedDoctorEspecialidad||currentUser?.especialidad||"",sede),',
      'num=tel.startsWith("57")?tel:"57"+tel;',
      'window.open("https://wa.me/"+num+"?text="+encodeURIComponent(msg),"_blank");',
      'showToast("Recordatorio listo para enviar por WhatsApp","success");',
      'm.style.display="none"',
    '};',
    'document.getElementById("sedeRBtn1").onclick=()=>enviar("1");',
    'document.getElementById("sedeRBtn2").onclick=()=>enviar("2");',
    'document.getElementById("sedeRBtnCancel").onclick=()=>{m.style.display="none"};',
    'm.onclick=ev=>{if(ev.target===m)m.style.display="none"}',
  '}',

  // ── enviarRecordatorioWhatsAppMedica ─────────────────────────────────────
  'function enviarRecordatorioWhatsAppMedica(e){if(!e)return;mostrarModalSedeRecordatorio(e)}',
].join('');

content = content.slice(0, startIdx) + newCode + content.slice(endIdx);

fs.writeFileSync(appJsPath, content, 'utf8');
console.log('✅ Patch aplicado correctamente.');
console.log('   - Encoding corregido (unicode escapes)');
console.log('   - Selección de sede agregada');
console.log('   - Dirección actualizada: Carrera 34 #13-80, Barrio San Ignacio');
console.log('   - Sede 1: https://maps.app.goo.gl/6cX18NUY8i8p5KQe9');
console.log('   - Sede 2: https://maps.app.goo.gl/YU5GheUmVMDAHFbq8');
