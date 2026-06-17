const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'docs', 'legacy', 'app.pre-minify.js');
let js = fs.readFileSync(file, 'utf8');

js = js.replace(
  /function showElectroKanbanLoading\(\) \{[\s\S]*?\n\}\n\nfunction renderCitasElectroKanban/,
  `function showElectroKanbanLoading() {
  const t = 'di' + 'v';
  const loadingHtml = '<' + t + ' class="electro-kanban-empty">Cargando\\u2026</' + t + '>';
  ['citasElectroBodyPendientes', 'citasElectroBodyActivos', 'citasElectroBodyCompletados'].forEach((id) => {
    const el = $(id);
    if (el) el.innerHTML = loadingHtml;
  });
}

function renderCitasElectroKanban`
);

js = js.replace('generarTabsElectro(_estudiosCache || []);', 'initFiltroEstudiosElectro(_estudiosCache || []);');

if (!js.includes('function renderCitaElectroCard')) {
  const insertAt = js.indexOf('function renderCitaElectroRow(tbody, c) {');
  const cardFn = `
function renderCitaElectroCard(container, c) {
  if (!container) return;
  const card = document.createElement('article');
  card.className = 'electro-cita-card';
  card.dataset.citaId = String(c.id || '');
  const estado = c.estado || 'Programado';
  const estadoClasses = {
    'En Sala': 'estado-en-sala',
    'En Estudio': 'estado-en-estudio',
    'Pausado': 'estado-pausado',
    'Completado': 'estado-completado',
    'Cancelado': 'estado-cancelado',
    'No Asisti\\u00f3': 'estado-no-asistio'
  };
  if (estadoClasses[estado]) card.classList.add(estadoClasses[estado]);
  const equipoDisplay = c.equipo_nombre ? escapeHtml(c.equipo_nombre) : (c.equipo_id ? 'Equipo ' + c.equipo_id : '\\u2014');
  const estudioCorto = abreviarEstudio(c.estudio);
  let duracionTxt = '';
  if (c.duracion_minutos) {
    const dHrs = Math.floor(c.duracion_minutos / 60);
    const dMin = c.duracion_minutos % 60;
    duracionTxt = dHrs > 0 ? (dMin > 0 ? dHrs + 'h ' + dMin + 'm' : dHrs + 'h') : dMin + 'm';
  }
  const t = 'di' + 'v';
  card.innerHTML =
    '<' + t + ' class="electro-cita-card-top">' +
      '<span class="electro-cita-card-hora">' + formatearHora(c.hora_agendamiento) + '</span>' +
      estadoBadge(estado) +
    '</' + t + '>' +
    '<' + t + ' class="electro-cita-card-paciente">' + escapeHtml(c.paciente_nombre || '-') + '</' + t + '>' +
    '<' + t + ' class="electro-cita-card-meta">' +
      '<span>' + escapeHtml(c.paciente_documento || '-') + '</span>' +
      (equipoDisplay !== '\\u2014' ? '<span>' + equipoDisplay + '</span>' : '') +
      (duracionTxt ? '<span>' + duracionTxt + '</span>' : '') +
    '</' + t + '>' +
    '<' + t + ' class="electro-cita-card-estudio" title="' + escapeHtml(c.estudio || '') + '">' + escapeHtml(estudioCorto) + '</' + t + '>';
  card.addEventListener('click', () => {
    if (!tienePermiso('electro.editar') && !tienePermiso('electro.cambiar_estado')) return;
    if (estado === 'Completado' && !tienePermiso('electro.eliminar')) {
      showToast('Esta cita ya est\\u00e1 completada - No se puede modificar', 'info');
      return;
    }
    abrirModalDetallesCita(c);
  });
  if (estado === 'Completado') {
    card.classList.add('electro-cita-card-done');
    if (!tienePermiso('electro.eliminar')) card.style.cursor = 'not-allowed';
  }
  container.appendChild(card);
}

`;
  js = js.slice(0, insertAt) + cardFn + js.slice(insertAt);
}

js = js.replace("  showSkeletonRows($('citasElectroBody'), 10, 6);", '  showElectroKanbanLoading();');

js = js.replace(
  `    if (filtroEstudioElectro !== 'todas') {
      citasFiltradas = citasNormalizadas.filter(c => c.estudio === filtroEstudioElectro);
    }`,
  `    const estudiosFiltro = getFiltroEstudiosElectroActivos();
    if (estudiosFiltro.length > 0) {
      citasFiltradas = citasNormalizadas.filter((c) => estudiosFiltro.includes(c.estudio));
    }
    window._citasElectroAllData = citasNormalizadas;
    window._citasElectroKanbanData = citasFiltradas;`
);

js = js.replace(
  /if \(citasFiltradas\.length === 0\) \{\s*const tbody = \$\('citasElectroBody'\);[\s\S]*?return;\s*\}/,
  `if (citasFiltradas.length === 0) {
      renderCitasElectroKanban([]);
      const contador = $('citasElectroContador');
      if (contador) contador.textContent = 'Sin citas';
      $('electroUsuarioProgramo').textContent = '-';
      $('electroUsuarioEdito').textContent = '-';
      actualizarStatsElectro(citasNormalizadas);
      return;
    }`
);

js = js.replace(
  `    setupPagination('citasElectro', citasFiltradas, renderCitaElectroRow, {
      itemsPerPageDefault: 20,
      tbodyId: 'citasElectroBody',
      containerSelector: '#citasElectroTableControls'
    });`,
  '    renderCitasElectroKanban(citasFiltradas);'
);

js = js.replace(
  /function actualizarEstadoFilaTablaElectro\(citaId, nuevoEstado\) \{[\s\S]*?\n\}/,
  `function actualizarEstadoFilaTablaElectro(citaId, nuevoEstado) {
  const data = window._citasElectroKanbanData;
  if (!data) return;
  const idStr = String(citaId);
  const idx = data.findIndex((c) => String(c.id) === idStr);
  if (idx < 0) return;
  data[idx] = { ...data[idx], estado: normalizarEstadoElectro(nuevoEstado) };
  renderCitasElectroKanban(data);
  if (window._citasElectroAllData) actualizarStatsElectro(window._citasElectroAllData);
}`
);

js = js.replace(
  /function aplicarCambioCitaElectroRealtime\(payload = \{\}\) \{[\s\S]*?window\.aplicarCambioCitaElectroRealtime = aplicarCambioCitaElectroRealtime;/,
  `function aplicarCambioCitaElectroRealtime(payload = {}) {
  const data = window._citasElectroKanbanData;
  if (!data) return;
  const id = payload?.id;
  if (!id) return;
  const idStr = String(id);
  const idx = data.findIndex((c) => String(c.id) === idStr);

  if (payload.type === 'eliminada' || payload.type === 'eliminado') {
    if (idx >= 0) data.splice(idx, 1);
  } else {
    const cambios = payload.cambios || payload;
    const next = {
      ...(idx >= 0 ? data[idx] : { id }),
      ...cambios
    };
    if (next.estado !== undefined) next.estado = normalizarEstadoElectro(next.estado);
    if (idx >= 0) data[idx] = next;
    else data.push(next);
  }
  renderCitasElectroKanban(data);
  if (window._citasElectroAllData) actualizarStatsElectro(window._citasElectroAllData);
}

window.aplicarCambioCitaElectroRealtime = aplicarCambioCitaElectroRealtime;`
);

fs.writeFileSync(file, js, 'utf8');
console.log('OK: JS kanban');
