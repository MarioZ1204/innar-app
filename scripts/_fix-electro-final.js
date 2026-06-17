const fs = require('fs');
const path = require('path');

// Fix showElectroKanbanLoading
const jsPath = path.join(__dirname, '..', 'docs', 'legacy', 'app.pre-minify.js');
let js = fs.readFileSync(jsPath, 'utf8');
const start = js.indexOf('function showElectroKanbanLoading() {');
const end = js.indexOf('function renderCitasElectroKanban');
if (start >= 0 && end > start) {
  const rep = `function showElectroKanbanLoading() {
  const t = 'di' + 'v';
  const loadingHtml = '<' + t + ' class="electro-kanban-empty">Cargando\\u2026</' + t + '>';
  ['citasElectroBodyPendientes', 'citasElectroBodyActivos', 'citasElectroBodyCompletados'].forEach((id) => {
    const el = typeof $ === 'function' ? $(id) : document.getElementById(id);
    if (el) el.innerHTML = loadingHtml;
  });
}

`;
  js = js.slice(0, start) + rep + js.slice(end);
  fs.writeFileSync(jsPath, js, 'utf8');
  console.log('fixed loading');
} else {
  console.log('loading skip', start, end);
}

// Patch index.html
const htmlPath = path.join(__dirname, '..', 'public', 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');
if (!html.includes('id="electroKanban"')) {
  html = html.replace(
    /<!-- PESTA[\s\S]*?-->\s*<motion class="tabs-container" id="tabsElectroContainer">[\s\S]*?<\/motion>\s*\n\s*<!-- Contador de citas -->/
      .source.replace(/motion/g, 'div'),
    `<!-- Filtro estudios -->
            <div class="electro-filtros-bar">
              <label for="filtroEstudiosElectro" class="electro-filtro-label">Tipo de estudio</label>
              <select id="filtroEstudiosElectro" multiple style="display:none" aria-label="Filtrar por tipo de estudio"></select>
            </div>

            <!-- Contador de citas -->`
  );
  // simpler regex without motion typo
  html = html.replace(
    /<!-- PESTA.NAS DE ESTUDIOS -->\s*<div class="tabs-container" id="tabsElectroContainer">[\s\S]*?<\/motion>\s*\n\s*<!-- Contador de citas -->/
      .toString(),
    ''
  );
}

// Use index-based replace for tabs
if (!html.includes('filtroEstudiosElectro')) {
  const tabsStart = html.indexOf('<!-- PESTA');
  const tabsEnd = html.indexOf('<!-- Contador de citas -->', tabsStart);
  if (tabsStart >= 0 && tabsEnd > tabsStart) {
    const filtros = `            <div class="electro-filtros-bar">
              <label for="filtroEstudiosElectro" class="electro-filtro-label">Tipo de estudio</label>
              <select id="filtroEstudiosElectro" multiple style="display:none" aria-label="Filtrar por tipo de estudio"></select>
            </div>

            `;
    html = html.slice(0, tabsStart) + filtros + html.slice(tabsEnd);
    console.log('tabs replaced');
  }
}

if (!html.includes('id="electroKanban"')) {
  const tbl = html.indexOf('id="citasElectroTable"');
  const wrap = html.lastIndexOf('<div class="table-wrapper">', tbl);
  const ctrl = html.indexOf('id="citasElectroTableControls"', tbl);
  const end = html.indexOf('</div>', ctrl) + 6;
  const D = 'di' + 'v';
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
  if (wrap >= 0 && end > wrap) {
    html = html.slice(0, wrap) + kanban + html.slice(end);
    console.log('kanban inserted');
  } else {
    console.error('kanban markers', wrap, end, tbl);
  }
}

fs.writeFileSync(htmlPath, html, 'utf8');

// Copy to public/app.js
const appOut = path.join(__dirname, '..', 'public', 'app.js');
fs.copyFileSync(jsPath, appOut);
console.log('copied app.js from pre-minify');
