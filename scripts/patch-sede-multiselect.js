'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// ─── Helpers ────────────────────────────────────────────────────────────────
function patch(filePath, label, oldStr, newStr) {
  const content = fs.readFileSync(filePath, 'utf8');
  if (!content.includes(oldStr)) {
    console.error(`❌  [${label}] Marker NOT FOUND in ${path.basename(filePath)}`);
    process.exit(1);
  }
  const updated = content.replace(oldStr, newStr);
  fs.writeFileSync(filePath, updated, 'utf8');
  console.log(`✅  [${label}] OK`);
}

// ════════════════════════════════════════════════════════════════════════════
// 1.  app.js — sede modal button labels & addresses
// ════════════════════════════════════════════════════════════════════════════
const APP_JS = path.join(ROOT, 'public', 'app.js');

// 1a. b1 button text (Sede Principal → new address)
patch(
  APP_JS,
  'b1.innerHTML Sede Principal address',
  `b1.innerHTML="Sede Principal<br><small style='font-weight:400;opacity:.9'>Carrera 34 #13-80, San Ignacio</small>";`,
  `b1.innerHTML="Sede Principal<br><small style='font-weight:400;opacity:.9'>Calle 14A #34-13. Edificio esquinero. Barrio San Ignacio. Pasto.</small>";`
);

// 1b. b2 button text (Sede 2 → Sede Servicios Complementarios + new address)
patch(
  APP_JS,
  'b2.innerHTML Sede 2 → Sede Servicios',
  `b2.innerHTML="Sede 2<br><small style='font-weight:400;opacity:.9'>Carrera 34 #13-80, San Ignacio</small>";`,
  `b2.innerHTML="Sede Servicios Complementarios<br><small style='font-weight:400;opacity:.9'>Carrera 33 #13-84. Casa esquinera. Barrio San Ignacio. Pasto.</small>";`
);

// 1c. construirMensajeRecordatorioMedica — addresses
patch(
  APP_JS,
  'construirMensaje addresses',
  `ub=sede==="2"?"Carrera 34 #13-80, Barrio San Ignacio, Pasto, Nari\u00f1o (https://maps.app.goo.gl/YU5GheUmVMDAHFbq8)":"Carrera 34 #13-80, Barrio San Ignacio, Pasto, Nari\u00f1o (https://maps.app.goo.gl/6cX18NUY8i8p5KQe9)"`,
  `ub=sede==="2"?"Sede Servicios Complementarios \u00b7 Carrera 33 #13-84. Casa esquinera. Barrio San Ignacio. Pasto. (https://maps.app.goo.gl/YU5GheUmVMDAHFbq8)":"Sede Principal \u00b7 Calle 14A #34-13. Edificio esquinero. Barrio San Ignacio. Pasto. (https://maps.app.goo.gl/6cX18NUY8i8p5KQe9)"`
);

// ════════════════════════════════════════════════════════════════════════════
// 2.  dashboard-citas.js — multiselect for Entidad & Tipo de Estudio
// ════════════════════════════════════════════════════════════════════════════
const DASH_JS = path.join(ROOT, 'public', 'dashboard-citas.js');

// 2a. buscarCitasAuditoria — read selected values via getMultiSelectValue
patch(
  DASH_JS,
  'buscarCitas entidad/tipoEstudio values',
  `r=document.getElementById("dashboardEntidad")?.value||"",s=document.getElementById("dashboardTipoEstudio")?.value||""`,
  `r=window.getMultiSelectValue(document.getElementById("dashboardEntidad")),s=window.getMultiSelectValue(document.getElementById("dashboardTipoEstudio"))`
);

// 2b. limpiarFiltrosDashboard — clear multiselects instead of .value=""
patch(
  DASH_JS,
  'limpiarFiltros entidad/tipoEstudio',
  `["dashboardMedico","dashboardEspecialidad","dashboardEstado","dashboardEntidad","dashboardAgendadoPor","dashboardTipoEstudio"].forEach(t=>{const e=document.getElementById(t);e&&(e.value="")})`,
  `["dashboardMedico","dashboardEspecialidad","dashboardEstado","dashboardAgendadoPor"].forEach(t=>{const e=document.getElementById(t);e&&(e.value="")});window.clearMultiSelect(document.getElementById("dashboardEntidad"));window.clearMultiSelect(document.getElementById("dashboardTipoEstudio"))`
);

// 2c. cargarEntidadesFiltroAuditoria — init/refresh multiselect after loading
patch(
  DASH_JS,
  'cargarEntidades multiselect init',
  `e&&t.querySelector(\`option[value="\${CSS.escape(e)}"]\`)&&(t.value=e)}catch`,
  `if(!t._ms){window.initMultiSelect(t);window.observeSelectForMulti(t);}else{t._ms.refresh();}}catch`
);

// 2d. cargarTiposEstudioFiltro — init/refresh multiselect after loading
patch(
  DASH_JS,
  'cargarTiposEstudio multiselect init',
  `n&&a.querySelector(\`option[value="\${CSS.escape(n)}"]\`)&&(a.value=n)}catch`,
  `if(!a._ms){window.initMultiSelect(a);window.observeSelectForMulti(a);}else{a._ms.refresh();}}catch`
);

console.log('\n✨  All patches applied successfully!');
