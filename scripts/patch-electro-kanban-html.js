const fs = require('fs');
const path = require('path');
const D = 'di' + 'v';
const file = path.join(__dirname, '..', 'public', 'index.html');
let html = fs.readFileSync(file, 'utf8');

if (!html.includes('id="citasElectroTable"')) {
  console.error('citasElectroTable no encontrada');
  process.exit(1);
}

if (html.includes('id="electroKanban"')) {
  console.log('Kanban ya aplicado');
  process.exit(0);
}

html = html.replace(
  `            <!-- PESTA\u00d1AS DE ESTUDIOS -->
            <div class="tabs-container" id="tabsElectroContainer">
              <button class="tab-electro-btn active" data-estudio="todas">Todas</button>
            </div>`,
  `            <${D} class="electro-filtros-bar">
              <label for="filtroEstudiosElectro" class="electro-filtro-label">Tipo de estudio</label>
              <select id="filtroEstudiosElectro" multiple style="display:none" aria-label="Filtrar por tipo de estudio"></select>
            </${D}>`
);

const tableMarker = '            <div class="table-wrapper">\n              <table id="citasElectroTable"';
const start = html.indexOf(tableMarker);
if (start < 0) {
  console.error('Bloque tabla electro no encontrado');
  process.exit(1);
}
const controlsIdx = html.indexOf('id="citasElectroTableControls"', start);
const end = html.indexOf('</div>', controlsIdx) + 6;

const kanban = [
  `            <${D} class="electro-kanban" id="electroKanban">`,
  `              <${D} class="electro-kanban-col electro-kanban-col-pendientes">`,
  `                <${D} class="electro-kanban-header">`,
  '                  <span class="electro-kanban-title">Pendientes</span>',
  '                  <span class="electro-kanban-count" id="electroKanbanCountPendientes">0</span>',
  `                </${D}>`,
  `                <${D} class="electro-kanban-body" id="citasElectroBodyPendientes">`,
  `                  <${D} class="electro-kanban-empty">Selecciona una fecha para ver las citas</${D}>`,
  `                </${D}>`,
  `              </${D}>`,
  `              <${D} class="electro-kanban-col electro-kanban-col-activos">`,
  `                <${D} class="electro-kanban-header">`,
  '                  <span class="electro-kanban-title">En estudio</span>',
  '                  <span class="electro-kanban-count" id="electroKanbanCountActivos">0</span>',
  `                </${D}>`,
  `                <${D} class="electro-kanban-body" id="citasElectroBodyActivos">`,
  `                  <${D} class="electro-kanban-empty">\u2014</${D}>`,
  `                </${D}>`,
  `              </${D}>`,
  `              <${D} class="electro-kanban-col electro-kanban-col-completados">`,
  `                <${D} class="electro-kanban-header">`,
  '                  <span class="electro-kanban-title">Completados</span>',
  '                  <span class="electro-kanban-count" id="electroKanbanCountCompletados">0</span>',
  `                </${D}>`,
  `                <${D} class="electro-kanban-body" id="citasElectroBodyCompletados">`,
  `                  <${D} class="electro-kanban-empty">\u2014</${D}>`,
  `                </${D}>`,
  `              </${D}>`,
  `            </${D}>`
].join('\n');

html = html.slice(0, start) + kanban + html.slice(end);
fs.writeFileSync(file, html, 'utf8');
console.log('OK: electro kanban en view-electro');
