/**
 * Módulo Anexo FIDU — tabla editable tipo Excel (doble clic).
 */
(function () {
  let _columnas = [];
  let _servicios = [];
  let _page = 1;
  let _total = 0;
  let _limit = 50;
  let _celdaEditando = null;
  let _pendingCodigo = '';
  let _carpetaId = null;
  let _archivoId = null;
  let _archivosCache = [];

  const AFIDU_VIEW_LS = 'innar.afidu.folderView';

  let afiduState = {
    carpetas: [],
    carpetaId: null,
    carpetaNombre: null,
    archivos: [],
    archivoId: null,
    archivoNombre: null,
    vista: 'root'
  };

  function syncAfiduIds() {
    _carpetaId = afiduState.carpetaId;
    _archivoId = afiduState.archivoId;
    _archivosCache = afiduState.archivos;
  }

  function afiduIcons(root) {
    if (typeof window.innarLucideIcons === 'function') {
      window.innarLucideIcons(root || document);
    }
  }

  function afiduFolderViewMode() {
    try {
      return localStorage.getItem(AFIDU_VIEW_LS) === 'list' ? 'list' : 'grid';
    } catch (_) {
      return 'grid';
    }
  }

  function setAfiduFolderViewMode(mode) {
    const next = mode === 'list' ? 'list' : 'grid';
    try { localStorage.setItem(AFIDU_VIEW_LS, next); } catch (_) { /* ignore */ }
    if (afiduState.vista === 'root') renderAfiduRootExplorer();
    else if (afiduState.vista === 'carpeta') renderAfiduArchivosExplorer();
  }

  function htmlAfiduFolderViewToggle() {
    const mode = afiduFolderViewMode();
    return `<div class="sop-view-toggle" role="group" aria-label="Vista de carpetas">
      <button type="button" class="sop-btn sop-btn-ghost sop-btn-sm${mode === 'grid' ? ' is-active' : ''}" data-afidu-view-mode="grid" title="Vista en cuadrícula"><i data-lucide="layout-grid"></i></button>
      <button type="button" class="sop-btn sop-btn-ghost sop-btn-sm${mode === 'list' ? ' is-active' : ''}" data-afidu-view-mode="list" title="Vista en lista"><i data-lucide="list"></i></button>
    </div>`;
  }

  function bindAfiduFolderViewToggle(root) {
    if (!root) return;
    root.querySelectorAll('[data-afidu-view-mode]').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        setAfiduFolderViewMode(btn.dataset.afiduViewMode);
      });
    });
  }

  function renderAfiduBreadcrumbs(containerEl, crumbs) {
    if (!containerEl || !crumbs?.length) return;
    containerEl.innerHTML = crumbs.map((c, i) => {
      const sep = i > 0 ? '<span class="sop-crumb-sep" aria-hidden="true">›</span>' : '';
      if (c.current) {
        return `${sep}<span class="sop-crumb is-current">${escapeHtml(c.label)}</span>`;
      }
      if (c.onClick) {
        return `${sep}<button type="button" class="sop-crumb is-link" data-crumb-idx="${i}">${escapeHtml(c.label)}</button>`;
      }
      return `${sep}<span class="sop-crumb">${escapeHtml(c.label)}</span>`;
    }).join('');
    containerEl.querySelectorAll('[data-crumb-idx]').forEach((btn) => {
      const idx = parseInt(btn.dataset.crumbIdx, 10);
      const crumb = crumbs[idx];
      if (crumb?.onClick) btn.addEventListener('click', crumb.onClick);
    });
  }

  function renderAfiduContextBar() {
    const el = $('afiduContextBar');
    if (!el) return;
    el.classList.remove('hidden');
    const crumbs = [{ label: 'Anexo', current: afiduState.vista === 'root', onClick: afiduState.vista !== 'root' ? volverAfiduRoot : null }];
    if (afiduState.carpetaId != null) {
      crumbs.push({
        label: afiduState.carpetaNombre || 'Carpeta',
        current: afiduState.vista === 'carpeta',
        onClick: afiduState.vista === 'archivo' ? volverAfiduCarpeta : null
      });
    }
    if (afiduState.vista === 'archivo' && afiduState.archivoNombre) {
      crumbs.push({ label: afiduState.archivoNombre, current: true });
    } else if (afiduState.carpetaId != null && afiduState.vista === 'carpeta') {
      crumbs.push({ label: 'Seleccione un anexo', current: true });
    } else if (afiduState.vista === 'root') {
      crumbs.push({ label: 'Seleccione una carpeta', current: true });
    }
    el.innerHTML = '<span class="sop-context-label">Ubicación</span>';
    const trail = document.createElement('span');
    trail.className = 'sop-breadcrumbs';
    trail.style.margin = '0';
    trail.style.flex = '1';
    renderAfiduBreadcrumbs(trail, crumbs);
    el.appendChild(trail);
  }

  function mostrarAfiduExplorer() {
    $('afiduMainPanel')?.classList.remove('hidden');
    $('afiduArchivoWorkspace')?.classList.add('hidden');
  }

  function mostrarAfiduArchivoWorkspace() {
    $('afiduMainPanel')?.classList.add('hidden');
    $('afiduArchivoWorkspace')?.classList.remove('hidden');
  }

  function confirmEliminarAfidu(msg, onOk) {
    if (typeof window.confirmEliminar === 'function') {
      window.confirmEliminar(msg, onOk);
    } else if (typeof showConfirm === 'function') {
      showConfirm(msg, onOk);
    } else if (window.confirm(msg)) {
      onOk();
    }
  }

  function promptNombreAfidu(msg, defaultValue, onOk) {
    if (typeof window.showPromptInput === 'function') {
      window.showPromptInput(msg, (nombre) => onOk(nombre), {
        defaultValue: defaultValue || '',
        okText: 'Guardar',
        cancelText: 'Cancelar',
        danger: false,
        icon: '✏️',
        placeholder: 'Nombre'
      });
      return;
    }
    const nombre = window.prompt(msg, defaultValue || '');
    if (nombre?.trim()) onOk(nombre.trim());
  }

  let initAfiduDone = false;
  let afiduEventsBound = false;

  function htmlAfiduCarpetaActions(c) {
    return `<div class="sop-folder-card-actions">
      <button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-afidu-carpeta-edit="${c.id}" title="Editar nombre"><i data-lucide="pencil"></i></button>
      <button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-afidu-carpeta-del="${c.id}" data-afidu-carpeta-nom="${escapeHtml(c.nombre)}" data-afidu-carpeta-arch="${c.total_archivos || 0}" title="Eliminar" style="color:#dc2626"><i data-lucide="trash-2"></i></button>
    </div>`;
  }

  function htmlAfiduArchivoActions(a) {
    return `<div class="sop-folder-card-actions">
      <button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-afidu-archivo-edit="${a.id}" title="Editar nombre"><i data-lucide="pencil"></i></button>
      <button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-afidu-archivo-del="${a.id}" data-afidu-archivo-nom="${escapeHtml(a.nombre)}" data-afidu-archivo-filas="${a.total_registros || 0}" title="Eliminar" style="color:#dc2626"><i data-lucide="trash-2"></i></button>
    </div>`;
  }

  function bindAfiduCarpetaCardEvents(root) {
    if (!root) return;
    root.querySelectorAll('[data-afidu-carpeta]').forEach((card) => {
      const open = () => seleccionarCarpetaAfidu(parseInt(card.dataset.afiduCarpeta, 10));
      card.addEventListener('click', (ev) => {
        if (ev.target.closest('.sop-folder-card-actions, .sop-folder-list-actions')) return;
        open();
      });
      card.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') open(); });
    });
    root.querySelectorAll('[data-afidu-carpeta-edit]').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const id = parseInt(btn.dataset.afiduCarpetaEdit, 10);
        const row = afiduState.carpetas.find((c) => c.id === id);
        if (row) editarCarpetaAfidu(row);
      });
    });
    root.querySelectorAll('[data-afidu-carpeta-del]').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        eliminarCarpetaAfidu({
          id: parseInt(btn.dataset.afiduCarpetaDel, 10),
          nombre: btn.dataset.afiduCarpetaNom || '',
          total_archivos: parseInt(btn.dataset.afiduCarpetaArch, 10) || 0
        });
      });
    });
  }

  function bindAfiduArchivoCardEvents(root) {
    if (!root) return;
    root.querySelectorAll('[data-afidu-archivo]').forEach((card) => {
      const open = () => abrirArchivoAfidu(parseInt(card.dataset.afiduArchivo, 10));
      card.addEventListener('click', (ev) => {
        if (ev.target.closest('.sop-folder-card-actions, .sop-folder-list-actions')) return;
        open();
      });
      card.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') open(); });
    });
    root.querySelectorAll('[data-afidu-archivo-edit]').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const id = parseInt(btn.dataset.afiduArchivoEdit, 10);
        const row = afiduState.archivos.find((a) => a.id === id);
        if (row) editarArchivoAfidu(row);
      });
    });
    root.querySelectorAll('[data-afidu-archivo-del]').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        eliminarArchivoAfidu({
          id: parseInt(btn.dataset.afiduArchivoDel, 10),
          nombre: btn.dataset.afiduArchivoNom || '',
          total_registros: parseInt(btn.dataset.afiduArchivoFilas, 10) || 0
        });
      });
    });
  }

  function renderAfiduRootExplorer() {
    const panel = $('afiduMainPanel');
    if (!panel) return;
    afiduState.vista = 'root';
    afiduState.carpetaId = null;
    afiduState.carpetaNombre = null;
    afiduState.archivoId = null;
    afiduState.archivoNombre = null;
    syncAfiduIds();
    mostrarAfiduExplorer();
    const viewMode = afiduFolderViewMode();
    panel.innerHTML = `<div class="sop-panel">
      <div class="sop-panel-head">
        <div>
          <h3 style="margin:0"><i data-lucide="folders"></i> Carpetas por periodo</h3>
        </div>
        <div class="sop-panel-head-tools">${htmlAfiduFolderViewToggle()}</div>
      </div>
      <div class="sop-panel-body">
        <div id="afiduCarpetasGrid" class="sop-folder-explorer-grid${viewMode === 'list' ? ' sop-folder-list-mode' : ''}"></div>
      </div>
    </div>`;
    bindAfiduFolderViewToggle(panel);
    const grid = panel.querySelector('#afiduCarpetasGrid');
    if (!afiduState.carpetas.length) {
      grid.innerHTML = '<div class="sop-empty" style="grid-column:1/-1;padding:32px"><i data-lucide="folder-plus" class="sop-empty-icon"></i>Sin carpetas — cree la primera con «Nueva carpeta»</div>';
    } else if (viewMode === 'list') {
      grid.innerHTML = `<div class="sop-table-wrap"><table class="sop-table sop-folder-list-table">
        <thead><tr><th>Carpeta</th><th>Anexos</th><th class="sop-folder-list-actions">Acciones</th></tr></thead>
        <tbody>${afiduState.carpetas.map((c) => `
          <tr data-afidu-carpeta="${c.id}" tabindex="0">
            <td><strong>${escapeHtml(c.nombre)}</strong></td>
            <td><strong>${c.total_archivos || 0}</strong></td>
            <td class="sop-folder-list-actions">${htmlAfiduCarpetaActions(c)}</td>
          </tr>`).join('')}</tbody></table></div>`;
      bindAfiduCarpetaCardEvents(grid);
    } else {
      grid.innerHTML = afiduState.carpetas.map((c) => `
        <article class="sop-folder-card" data-afidu-carpeta="${c.id}" tabindex="0">
          <div class="sop-folder-card-icon"><i data-lucide="folder"></i></div>
          <div class="sop-folder-card-title">${escapeHtml(c.nombre)}</div>
          <div class="sop-folder-card-meta">Periodo / mes</div>
          <div class="sop-folder-card-count"><strong>${c.total_archivos || 0}</strong> anexo(s)</div>
          ${htmlAfiduCarpetaActions(c)}
        </article>`).join('');
      bindAfiduCarpetaCardEvents(grid);
    }
    afiduIcons(panel);
    renderAfiduContextBar();
  }

  function renderAfiduArchivosExplorer() {
    const panel = $('afiduMainPanel');
    if (!panel || !afiduState.carpetaId) return;
    afiduState.vista = 'carpeta';
    afiduState.archivoId = null;
    afiduState.archivoNombre = null;
    syncAfiduIds();
    mostrarAfiduExplorer();
    const viewMode = afiduFolderViewMode();
    panel.innerHTML = `<div class="sop-panel">
      <div class="sop-panel-head">
        <div>
          <h3 style="margin:0"><i data-lucide="folder-open"></i> ${escapeHtml(afiduState.carpetaNombre || 'Carpeta')}</h3>
        </div>
        <div class="sop-panel-head-tools">
          ${htmlAfiduFolderViewToggle()}
          <button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" id="btnAfiduEditarCarpeta"><i data-lucide="pencil"></i> Editar carpeta</button>
          <button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" id="btnAfiduEliminarCarpeta" style="color:#dc2626"><i data-lucide="trash-2"></i> Eliminar carpeta</button>
          <button type="button" class="sop-btn sop-btn-teal" id="btnAfiduNuevoArchivo"><i data-lucide="file-plus"></i> Nuevo anexo</button>
          <button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" id="btnAfiduVolverRoot"><i data-lucide="arrow-left"></i> Carpetas</button>
        </div>
      </div>
      <div class="sop-panel-body">
        <div id="afiduArchivosGrid" class="sop-folder-explorer-grid${viewMode === 'list' ? ' sop-folder-list-mode' : ''}"></div>
      </div>
    </div>`;
    bindAfiduFolderViewToggle(panel);
    panel.querySelector('#btnAfiduEditarCarpeta')?.addEventListener('click', () => {
      const row = afiduState.carpetas.find((c) => c.id === afiduState.carpetaId);
      if (row) editarCarpetaAfidu(row);
    });
    panel.querySelector('#btnAfiduEliminarCarpeta')?.addEventListener('click', () => {
      eliminarCarpetaAfidu({
        id: afiduState.carpetaId,
        nombre: afiduState.carpetaNombre || '',
        total_archivos: afiduState.archivos.length
      });
    });
    panel.querySelector('#btnAfiduNuevoArchivo')?.addEventListener('click', crearArchivo);
    panel.querySelector('#btnAfiduVolverRoot')?.addEventListener('click', volverAfiduRoot);
    const grid = panel.querySelector('#afiduArchivosGrid');
    if (!afiduState.archivos.length) {
      grid.innerHTML = '<div class="sop-empty" style="grid-column:1/-1;padding:32px"><i data-lucide="file-plus" class="sop-empty-icon"></i>Sin anexos — cree el primero para empezar a cargar filas</div>';
    } else if (viewMode === 'list') {
      grid.innerHTML = `<div class="sop-table-wrap"><table class="sop-table sop-folder-list-table">
        <thead><tr><th>Anexo</th><th>Filas</th><th class="sop-folder-list-actions">Acciones</th></tr></thead>
        <tbody>${afiduState.archivos.map((a) => `
          <tr data-afidu-archivo="${a.id}" tabindex="0">
            <td><strong>${escapeHtml(a.nombre)}</strong></td>
            <td><strong>${a.total_registros || 0}</strong></td>
            <td class="sop-folder-list-actions">${htmlAfiduArchivoActions(a)}</td>
          </tr>`).join('')}</tbody></table></div>`;
      bindAfiduArchivoCardEvents(grid);
    } else {
      grid.innerHTML = afiduState.archivos.map((a) => `
        <article class="sop-folder-card" data-afidu-archivo="${a.id}" tabindex="0">
          <div class="sop-folder-card-icon"><i data-lucide="file-spreadsheet"></i></div>
          <div class="sop-folder-card-title">${escapeHtml(a.nombre)}</div>
          <div class="sop-folder-card-meta">Tabla Excel FOMAG</div>
          <div class="sop-folder-card-count"><strong>${a.total_registros || 0}</strong> fila(s)</div>
          ${htmlAfiduArchivoActions(a)}
        </article>`).join('');
      bindAfiduArchivoCardEvents(grid);
    }
    afiduIcons(panel);
    renderAfiduContextBar();
  }

  async function refrescarCarpetas() {
    const data = await apiAnexo('/api/anexo-fidu/carpetas');
    afiduState.carpetas = data.carpetas || [];
    return afiduState.carpetas;
  }

  async function refrescarArchivos(carpetaId) {
    if (!carpetaId) {
      afiduState.archivos = [];
      syncAfiduIds();
      return [];
    }
    const data = await apiAnexo(`/api/anexo-fidu/carpetas/${carpetaId}/archivos`);
    afiduState.archivos = data.archivos || [];
    syncAfiduIds();
    return afiduState.archivos;
  }

  async function seleccionarCarpetaAfidu(id) {
    const row = afiduState.carpetas.find((c) => c.id === id);
    afiduState.carpetaId = id;
    afiduState.carpetaNombre = row?.nombre || 'Carpeta';
    syncAfiduIds();
    const panel = $('afiduMainPanel');
    if (panel) {
      panel.innerHTML = `<div class="sop-panel"><div class="sop-panel-body"><div class="sop-empty"><i data-lucide="loader" class="sop-empty-icon"></i>Cargando anexos…</div></div></div>`;
      afiduIcons(panel);
    }
    await refrescarArchivos(id);
    renderAfiduArchivosExplorer();
  }

  async function abrirArchivoAfidu(id) {
    const row = afiduState.archivos.find((a) => a.id === id);
    afiduState.archivoId = id;
    afiduState.archivoNombre = row?.nombre || 'Anexo';
    afiduState.vista = 'archivo';
    syncAfiduIds();
    mostrarAfiduArchivoWorkspace();
    const titulo = $('afiduArchivoTitulo');
    if (titulo) {
      titulo.innerHTML = `<i data-lucide="file-spreadsheet"></i> ${escapeHtml(afiduState.archivoNombre)}`;
    }
    try {
      const data = await apiAnexo(`/api/anexo-fidu/archivos/${_archivoId}`);
      const a = data.archivo || {};
      actualizarInfoArchivo(`${a.total_registros || 0} fila(s)`);
      _page = 1;
      await cargarRegistros();
    } catch (e) {
      actualizarInfoArchivo(e.message);
      renderBody([]);
    }
    afiduIcons($('afiduArchivoWorkspace'));
    renderAfiduContextBar();
  }

  function volverAfiduRoot() {
    cancelarEdicionCelda();
    renderAfiduRootExplorer();
  }

  async function volverAfiduCarpeta() {
    cancelarEdicionCelda();
    if (!afiduState.carpetaId) {
      volverAfiduRoot();
      return;
    }
    await refrescarArchivos(afiduState.carpetaId);
    renderAfiduArchivosExplorer();
  }

  const PERSONA_FORM = [
    { key: 'numero_documento', label: 'NUMERODOCUMENTO' },
    { key: 'nombres_1', label: 'NOMBRES (1)' },
    { key: 'nombres_2', label: 'NOMBRES (2)' },
    { key: 'apellidos_1', label: 'APELLIDOS (1)' },
    { key: 'apellidos_2', label: 'APELLIDOS (2)' },
    { key: 'tipo_documento', label: 'TIPODOCUMENTO' },
    { key: 'fecha_nacimiento', label: 'FECHANACIMIENTO' },
    { key: 'ciudad_nacimiento', label: 'CIUDADDENACIMIENTO' },
    { key: 'genero', label: 'GENERO' },
    { key: 'direccion', label: 'DIRECCION', long: true },
    { key: 'barrio', label: 'BARRIO' },
    { key: 'ciudad_residencia', label: 'CIUDADDERESIDENCIA', long: true },
    { key: 'telefono', label: 'TELEFONO' },
    { key: 'correo', label: 'CORREO' },
    { key: 'afiliacion', label: 'AFILIACION', long: true }
  ];

  const CAMPOS_PACIENTE_ANEXO = new Set([
    'numero_documento', 'nombres_1', 'nombres_2', 'apellidos_1', 'apellidos_2',
    'tipo_documento', 'fecha_nacimiento', 'ciudad_nacimiento', 'genero',
    'direccion', 'telefono', 'correo', 'especiales_excepcion_cotizante', 'ciudad_residencia', 'edad'
  ]);

  const CAMPOS_LARGOS = new Set([
    'direccion', 'nombre_servicio', 'nombre_diagnostico', 'causa_atencion',
    'ciudad_residencia', 'ciudad_nacimiento', 'especiales_excepcion_cotizante'
  ]);

  function parseValorMoneda(val) {
    const digits = String(val || '').replace(/\D/g, '');
    return parseInt(digits, 10) || 0;
  }

  function parseCantidad(val) {
    const s = String(val || '').trim().replace(',', '.');
    if (!s) return 0;
    const n = parseFloat(s);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }

  function formatValorMoneda(num) {
    const n = Math.round(Number(num) || 0);
    return `$ ${n.toLocaleString('es-CO')}`;
  }

  function recalcularTotalEnFila(tr) {
    const body = leerRegistroDesdeFila(tr);
    const total = formatValorMoneda(parseValorMoneda(body.valor_unitario) * parseCantidad(body.cantidad));
    setValorCelda(tr, 'valor_total_fact', total);
  }

  const CAMPOS_SERVICIO_AUTO = new Set([
    'nit', 'prefijo_fact', 'ciudad', 'nombre_servicio', 'plan', 'valor_unitario',
    'cantidad', 'valor_total_fact', 'condicion_destino_persona', 'prioridad_atencion',
    'tipo_atencion_solicitada', 'grupo_servicio', 'modalidad_tecnologia_salud', 'codigo_servicio_referencia'
  ]);

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(str) {
    if (str == null) return '';
    const d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML;
  }

  async function apiAnexo(path, opts = {}) {
    if (typeof apiFetch === 'function') {
      const res = await apiFetch(path, opts);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText || 'Error');
      return data;
    }
    throw new Error('apiFetch no disponible');
  }

  async function cargarColumnas() {
    const data = await apiAnexo('/api/anexo-fidu/columnas');
    _columnas = data.columnas || [];
    return _columnas;
  }

  async function cargarServicios() {
    const data = await apiAnexo('/api/anexo-fidu/servicios');
    _servicios = data.servicios || [];
    return _servicios;
  }

  function valorCeldaTexto(val) {
    const v = val != null ? String(val) : '';
    return v ? escapeHtml(v) : '<span class="afidu-cell-empty">—</span>';
  }

  function renderThead() {
    const thead = $('afiduGridHead');
    if (!thead) return;
    let html = '<tr><th class="afidu-col-acciones" title="Borrar fila">✕</th>';
    _columnas.forEach((c) => {
      html += `<th title="${escapeHtml(c.label)}" style="min-width:${c.width || 90}px">${escapeHtml(c.label)}</th>`;
    });
    html += '</tr>';
    thead.innerHTML = html;
  }

  function crearFilaHtml(registro, opts = {}) {
    const id = registro.id != null ? String(registro.id) : '';
    const isNew = opts.isNew || !id;
    const trClass = isNew ? 'afidu-row afidu-row-new' : 'afidu-row';
    let cells = `<td class="afidu-col-acciones">
      <button type="button" class="afidu-btn-del" data-id="${escapeHtml(id)}" title="Eliminar fila">✕</button>
    </td>`;
    _columnas.forEach((c) => {
      const v = registro[c.key] != null ? String(registro[c.key]) : '';
      const pacCls = CAMPOS_PACIENTE_ANEXO.has(c.key) ? ' afidu-cell-paciente' : '';
      cells += `<td class="afidu-cell${pacCls}" data-key="${c.key}" title="${escapeHtml(c.label)}: ${escapeHtml(v)}">
        <span class="afidu-cell-text">${valorCeldaTexto(v)}</span>
      </td>`;
    });
    return `<tr class="${trClass}" data-id="${escapeHtml(id)}" data-new="${isNew ? '1' : '0'}">${cells}</tr>`;
  }

  function renderBody(registros) {
    const tbody = $('afiduGridBody');
    if (!tbody) return;
    if (!registros.length) {
      tbody.innerHTML = `<tr><td colspan="${_columnas.length + 1}" class="afidu-empty-msg">Sin filas. Use documento + código arriba para agregar la primera fila. Doble clic en una celda para editar.</td></tr>`;
      return;
    }
    tbody.innerHTML = registros.map((r) => crearFilaHtml(r)).join('');
  }

  function leerRegistroDesdeFila(tr) {
    const body = {};
    _columnas.forEach((c) => { body[c.key] = ''; });
    tr.querySelectorAll('.afidu-cell[data-key]').forEach((td) => {
      const key = td.dataset.key;
      const txt = td.querySelector('.afidu-cell-text');
      if (!txt) return;
      body[key] = txt.textContent.trim() === '—' ? '' : txt.textContent.trim();
    });
    return body;
  }

  function setValorCelda(tr, key, value) {
    const td = tr.querySelector(`.afidu-cell[data-key="${key}"]`);
    if (!td) return;
    const v = value != null ? String(value) : '';
    const txt = td.querySelector('.afidu-cell-text');
    if (txt) txt.innerHTML = valorCeldaTexto(v);
    const col = _columnas.find((c) => c.key === key);
    td.title = `${col?.label || key}: ${v}`;
  }

  async function lookupNombreDiagnostico(codigoCie10) {
    const cod = String(codigoCie10 || '').trim();
    if (cod.length < 2) return '';
    const data = await apiAnexo(`/api/anexo-fidu/diagnostico-por-codigo?codigo=${encodeURIComponent(cod)}`);
    return String(data.nombre || '').trim();
  }

  async function aplicarNombreDiagnosticoDesdeCie10(tr, codigoCie10) {
    const cod = String(codigoCie10 || '').trim();
    if (!cod) {
      setValorCelda(tr, 'nombre_diagnostico', '');
      return '';
    }
    const nombre = await lookupNombreDiagnostico(cod);
    if (nombre) setValorCelda(tr, 'nombre_diagnostico', nombre);
    return nombre;
  }

  function aplicarRegistroAFila(tr, registro) {
    _columnas.forEach((c) => setValorCelda(tr, c.key, registro[c.key]));
  }

  function cancelarEdicionCelda() {
    if (!_celdaEditando) return;
    const { td, valorOriginal } = _celdaEditando;
    td.classList.remove('afidu-cell-editing');
    td.innerHTML = `<span class="afidu-cell-text">${valorCeldaTexto(valorOriginal)}</span>`;
    _celdaEditando = null;
  }

  function iniciarEdicionCelda(td) {
    if (td.closest('.afidu-col-acciones')) return;
    if (_celdaEditando?.td === td) return;
    if (_celdaEditando) finalizarEdicionCelda(true);

    const key = td.dataset.key;
    const txt = td.querySelector('.afidu-cell-text');
    const valorOriginal = txt?.textContent.trim() === '—' ? '' : (txt?.textContent.trim() || '');
    td.classList.add('afidu-cell-editing');
    const isLong = CAMPOS_LARGOS.has(key);
    const input = document.createElement(isLong ? 'textarea' : 'input');
    input.className = 'afidu-cell-input';
    if (!isLong) input.type = 'text';
    input.value = valorOriginal;
    td.innerHTML = '';
    td.appendChild(input);
    input.focus();
    if (isLong) input.select();
    else input.setSelectionRange(input.value.length, input.value.length);

    _celdaEditando = { td, input, key, valorOriginal, tr: td.closest('tr') };

    if (key === 'codigo_cie10') {
      let cieTimer;
      input.addEventListener('input', () => {
        clearTimeout(cieTimer);
        cieTimer = setTimeout(async () => {
          if (_celdaEditando?.input !== input) return;
          try {
            await aplicarNombreDiagnosticoDesdeCie10(tr, input.value);
          } catch (_) { /* ignore mientras escribe */ }
        }, 320);
      });
    }

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (!isLong || e.ctrlKey)) {
        e.preventDefault();
        finalizarEdicionCelda(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelarEdicionCelda();
      }
    });
    input.addEventListener('blur', () => {
      setTimeout(() => {
        if (_celdaEditando?.input === input) finalizarEdicionCelda(true);
      }, 80);
    });
  }

  async function finalizarEdicionCelda(guardar) {
    if (!_celdaEditando) return;
    const { td, input, key, valorOriginal, tr } = _celdaEditando;
    const nuevoValor = input.value.trim();
    _celdaEditando = null;
    td.classList.remove('afidu-cell-editing');
    td.innerHTML = `<span class="afidu-cell-text">${valorCeldaTexto(nuevoValor)}</span>`;

    if (!guardar || nuevoValor === valorOriginal) return;

    tr.classList.add('afidu-row-saving');
    try {
      if (key === 'codigo_servicio' || key === 'numero_documento') {
        await recargarServicioYPacienteEnFila(tr);
      } else if (key === 'codigo_cie10') {
        const nombre = await aplicarNombreDiagnosticoDesdeCie10(tr, nuevoValor);
        if (!nombre && nuevoValor.length >= 2) {
          if (typeof showToast === 'function') {
            showToast('No se encontró diagnóstico para ese código CIE-10', 'warning');
          }
        }
      } else if (key === 'valor_unitario' || key === 'cantidad') {
        recalcularTotalEnFila(tr);
      }
      await guardarFila(tr);
    } catch (e) {
      setValorCelda(tr, key, valorOriginal);
      if (typeof showToast === 'function') showToast(e.message, 'error');
    } finally {
      tr.classList.remove('afidu-row-saving');
    }
  }

  async function recargarServicioYPacienteEnFila(tr) {
    const body = leerRegistroDesdeFila(tr);
    const doc = body.numero_documento;
    const codigo = body.codigo_servicio;
    if (!doc || !codigo) return;
    const data = await apiAnexo('/api/anexo-fidu/armar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ numero_documento: doc, codigo_servicio: codigo })
    });
    if (!data.persona_encontrada) {
      mostrarPanelNuevaPersona(doc, codigo);
      throw new Error('Paciente no registrado — complete los datos abajo');
    }
    const reg = data.registro || {};
    const manual = {};
    _columnas.forEach((c) => {
      if (!CAMPOS_SERVICIO_AUTO.has(c.key) && !CAMPOS_PACIENTE_ANEXO.has(c.key)) {
        manual[c.key] = body[c.key];
      }
    });
    aplicarRegistroAFila(tr, { ...reg, ...manual });
    recalcularTotalEnFila(tr);
  }

  function requireArchivoActivo() {
    if (_archivoId) return _archivoId;
    if (typeof showToast === 'function') showToast('Seleccione o cree un anexo primero', 'warning');
    throw new Error('Sin anexo seleccionado');
  }

  function actualizarInfoArchivo(texto) {
    const el = $('afiduArchivoInfo');
    if (el) el.textContent = texto || '—';
  }


  function crearCarpeta() {
    promptNombreAfidu('Nombre de la carpeta (ej. Junio):', '', async (nombre) => {
      try {
        const data = await apiAnexo('/api/anexo-fidu/carpetas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nombre })
        });
        await refrescarCarpetas();
        if (data.carpeta?.id) await seleccionarCarpetaAfidu(data.carpeta.id);
        else renderAfiduRootExplorer();
        if (typeof showToast === 'function') showToast(`Carpeta «${data.carpeta?.nombre}» creada`, 'success');
      } catch (e) {
        if (e.message?.includes('409') || e.message?.includes('Ya existe')) {
          if (typeof showToast === 'function') showToast('Esa carpeta ya existe', 'warning');
        } else if (typeof showToast === 'function') showToast(e.message, 'error');
      }
    });
  }

  function editarCarpetaAfidu(carpeta) {
    if (!carpeta?.id) return;
    promptNombreAfidu('Nombre de la carpeta:', carpeta.nombre || '', async (nombre) => {
      if (nombre === carpeta.nombre) return;
      try {
      const data = await apiAnexo(`/api/anexo-fidu/carpetas/${carpeta.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre: nombre.trim() })
      });
      await refrescarCarpetas();
      if (afiduState.carpetaId === carpeta.id) {
        afiduState.carpetaNombre = data.carpeta?.nombre || nombre.trim();
        syncAfiduIds();
        renderAfiduArchivosExplorer();
      } else {
        renderAfiduRootExplorer();
      }
      if (typeof showToast === 'function') showToast('Carpeta actualizada', 'success');
      } catch (e) {
        if (typeof showToast === 'function') showToast(e.message, 'error');
      }
    });
  }

  async function eliminarCarpetaAfidu(carpeta) {
    if (!carpeta?.id) return;
    const nArch = carpeta.total_archivos ?? afiduState.archivos.length ?? 0;
    const label = carpeta.nombre || 'esta carpeta';
    const msg = nArch > 0
      ? `la carpeta «${label}» y sus ${nArch} anexo(s) con todas las filas`
      : `la carpeta «${label}»`;
    confirmEliminarAfidu(msg, async () => {
      try {
        const estabaAbierta = afiduState.carpetaId === carpeta.id;
        await apiAnexo(`/api/anexo-fidu/carpetas/${carpeta.id}`, { method: 'DELETE' });
        if (estabaAbierta) {
          afiduState.carpetaId = null;
          afiduState.carpetaNombre = null;
          afiduState.archivoId = null;
          afiduState.archivoNombre = null;
          syncAfiduIds();
        }
        await refrescarCarpetas();
        if (estabaAbierta) {
          renderAfiduRootExplorer();
        } else {
          renderAfiduRootExplorer();
        }
        if (typeof showToast === 'function') showToast('Carpeta eliminada', 'success');
      } catch (e) {
        if (typeof showToast === 'function') showToast(e.message, 'error');
      }
    });
  }

  function editarArchivoAfidu(archivo) {
    if (!archivo?.id) return;
    promptNombreAfidu('Nombre del anexo:', archivo.nombre || '', async (nombre) => {
      if (nombre === archivo.nombre) return;
      try {
      const data = await apiAnexo(`/api/anexo-fidu/archivos/${archivo.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre: nombre.trim() })
      });
      await refrescarArchivos(afiduState.carpetaId);
      if (afiduState.archivoId === archivo.id) {
        afiduState.archivoNombre = data.archivo?.nombre || nombre.trim();
        const titulo = $('afiduArchivoTitulo');
        if (titulo) {
          titulo.innerHTML = `<i data-lucide="file-spreadsheet"></i> ${escapeHtml(afiduState.archivoNombre)}`;
          afiduIcons($('afiduArchivoWorkspace'));
        }
        renderAfiduContextBar();
      } else {
        renderAfiduArchivosExplorer();
      }
      if (typeof showToast === 'function') showToast('Anexo actualizado', 'success');
      } catch (e) {
        if (typeof showToast === 'function') showToast(e.message, 'error');
      }
    });
  }

  async function eliminarArchivoAfidu(archivo) {
    if (!archivo?.id) return;
    const filas = archivo.total_registros || 0;
    const label = archivo.nombre || 'este anexo';
    const msg = filas > 0
      ? `el anexo «${label}» y sus ${filas} fila(s)`
      : `el anexo «${label}»`;
    confirmEliminarAfidu(msg, async () => {
      try {
        await apiAnexo(`/api/anexo-fidu/archivos/${archivo.id}`, { method: 'DELETE' });
        if (afiduState.archivoId === archivo.id) {
          afiduState.archivoId = null;
          afiduState.archivoNombre = null;
          syncAfiduIds();
          volverAfiduCarpeta();
        } else {
          await refrescarArchivos(afiduState.carpetaId);
          renderAfiduArchivosExplorer();
        }
        if (typeof showToast === 'function') showToast('Anexo eliminado', 'success');
      } catch (e) {
        if (typeof showToast === 'function') showToast(e.message, 'error');
      }
    });
  }

  function crearArchivo() {
    if (!afiduState.carpetaId) {
      if (typeof showToast === 'function') showToast('Abra una carpeta primero', 'warning');
      return;
    }
    promptNombreAfidu('Nombre del anexo (ej. ANEXO 1 JUNIO):', '', async (nombre) => {
      try {
        const data = await apiAnexo('/api/anexo-fidu/archivos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ carpeta_id: afiduState.carpetaId, nombre })
        });
        await refrescarArchivos(afiduState.carpetaId);
        if (data.archivo?.id) await abrirArchivoAfidu(data.archivo.id);
        else renderAfiduArchivosExplorer();
        if (typeof showToast === 'function') showToast(`Anexo «${data.archivo?.nombre}» listo — empiece a agregar filas`, 'success');
      } catch (e) {
        const msg = e.message || '';
        if (msg.includes('Ya existe')) {
          await refrescarArchivos(afiduState.carpetaId);
          const existente = afiduState.archivos.find(
            (a) => a.nombre.toLowerCase() === nombre.toLowerCase()
          );
          const abrirExistente = async () => {
            if (existente) await abrirArchivoAfidu(existente.id);
            else renderAfiduArchivosExplorer();
          };
          if (existente && typeof showConfirm === 'function') {
            showConfirm(
              'Ese anexo ya existe. ¿Desea abrirlo para continuar o importar?',
              abrirExistente,
              { okText: 'Abrir anexo', cancelText: 'Cancelar', danger: false, icon: '📄' }
            );
          } else if (existente) {
            await abrirExistente();
          } else {
            renderAfiduArchivosExplorer();
          }
        } else if (typeof showToast === 'function') showToast(msg, 'error');
      }
    });
  }

  async function importarExcelAnexo() {
    requireArchivoActivo();
    const input = $('afiduImportFileInput');
    if (!input) return;
    input.value = '';
    input.click();
  }

  async function ejecutarImportExcel(file, reemplazar) {
    const input = $('afiduImportFileInput');
    const fd = new FormData();
    fd.append('file', file);
    fd.append('reemplazar', reemplazar);
    const hdr = new Headers();
    if (typeof getCsrfForRequest === 'function') {
      const csrf = getCsrfForRequest();
      if (csrf) hdr.set('x-csrf-token', csrf);
    }
    const res = await fetch(`/api/anexo-fidu/archivos/${_archivoId}/importar`, {
      method: 'POST',
      headers: hdr,
      body: fd,
      credentials: 'include'
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Error al importar');
    if (input) input.value = '';
    if (typeof showToast === 'function') showToast(data.mensaje || 'Importación completada', 'success');
    await refrescarArchivos(afiduState.carpetaId);
    await abrirArchivoAfidu(_archivoId);
  }

  async function onImportFileSelected() {
    const input = $('afiduImportFileInput');
    if (!input?.files?.length || !_archivoId) return;
    const file = input.files[0];
    const limpiarInput = () => { if (input) input.value = ''; };
    try {
      const meta = await apiAnexo(`/api/anexo-fidu/archivos/${_archivoId}`);
      const total = meta.archivo?.total_registros || 0;
      if (total > 0) {
        const msg = `Este anexo tiene ${total} fila(s). ¿Cómo desea importar el Excel?`;
        if (typeof window.showConfirmChoice === 'function') {
          window.showConfirmChoice(
            msg,
            () => ejecutarImportExcel(file, '1').catch((e) => {
              if (typeof showToast === 'function') showToast(e.message, 'error');
            }),
            () => ejecutarImportExcel(file, '0').catch((e) => {
              if (typeof showToast === 'function') showToast(e.message, 'error');
            }),
            {
              primaryText: 'Reemplazar todo',
              secondaryText: 'Agregar al final',
              cancelText: 'Cancelar',
              icon: '📊',
              onCancel: limpiarInput
            }
          );
          return;
        }
        const reemplazar = window.confirm(
          `${msg}\n\nAceptar = reemplazar todo con el Excel\nCancelar = agregar al final`
        ) ? '1' : '0';
        await ejecutarImportExcel(file, reemplazar);
      } else {
        await ejecutarImportExcel(file, '0');
      }
    } catch (e) {
      limpiarInput();
      if (typeof showToast === 'function') showToast(e.message, 'error');
    }
  }

  async function guardarFila(tr) {
    const body = leerRegistroDesdeFila(tr);
    const payload = { ...body, actualizar_persona: true, archivo_id: requireArchivoActivo() };
    const isNew = tr.dataset.new === '1' || !tr.dataset.id;
    tr.classList.add('afidu-row-saving');
    try {
      if (isNew) {
        const data = await apiAnexo('/api/anexo-fidu/registros', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const reg = data.registro || {};
        tr.dataset.id = reg.id;
        tr.dataset.new = '0';
        tr.classList.remove('afidu-row-new');
        _total += 1;
      } else {
        await apiAnexo(`/api/anexo-fidu/registros/${tr.dataset.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      }
      tr.classList.remove('afidu-row-dirty');
      await cargarResumenPersonas();
    } finally {
      tr.classList.remove('afidu-row-saving');
    }
  }

  function prependFila(registro) {
    const tbody = $('afiduGridBody');
    if (!tbody) return null;
    const empty = tbody.querySelector('.afidu-empty-msg');
    if (empty) tbody.innerHTML = '';
    const wrap = document.createElement('tbody');
    wrap.innerHTML = crearFilaHtml(registro, { isNew: true });
    const tr = wrap.firstElementChild;
    tbody.insertBefore(tr, tbody.firstChild);
    return tr;
  }

  function ocultarPanelNuevaPersona() {
    const panel = $('afiduPanelNuevaPersona');
    if (panel) {
      panel.classList.add('hidden');
      panel.innerHTML = '';
    }
  }

  function mostrarPanelNuevaPersona(doc, codigo) {
    const panel = $('afiduPanelNuevaPersona');
    if (!panel) return;
    _pendingCodigo = codigo;
    let html = `<div class="afidu-step-banner afidu-step-banner-warn">Paciente <strong>${escapeHtml(doc)}</strong> no está en la base. Complete los 15 datos y guarde para continuar.</div><div class="afidu-panel-form">`;
    PERSONA_FORM.forEach((f) => {
      const v = f.key === 'numero_documento' ? doc : '';
      const ro = f.key === 'numero_documento' ? ' readonly' : '';
      html += `<div><label>${escapeHtml(f.label)}</label>${f.long
        ? `<textarea id="afidu-p-${f.key}" data-key="${f.key}"${ro}>${escapeHtml(v)}</textarea>`
        : `<input type="text" id="afidu-p-${f.key}" data-key="${f.key}" value="${escapeHtml(v)}"${ro} />`}</div>`;
    });
    html += `</div><div class="afidu-panel-actions"><button type="button" class="btn-primary" id="btnAfiduGuardarPersona">Guardar paciente y agregar fila</button><button type="button" class="btn-secondary" id="btnAfiduCancelarPersona">Cancelar</button></div>`;
    panel.innerHTML = html;
    panel.classList.remove('hidden');
    $('btnAfiduGuardarPersona')?.addEventListener('click', guardarPersonaYAgregarFila);
    $('btnAfiduCancelarPersona')?.addEventListener('click', ocultarPanelNuevaPersona);
  }

  async function guardarPersonaYAgregarFila() {
    const persona = {};
    PERSONA_FORM.forEach((f) => {
      const el = document.getElementById(`afidu-p-${f.key}`);
      persona[f.key] = el ? el.value.trim() : '';
    });
    const codigo = _pendingCodigo || ($('afiduEntradaCodigo')?.value || '').trim();
    try {
      await apiAnexo('/api/anexo-fidu/personas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(persona)
      });
      ocultarPanelNuevaPersona();
      await cargarResumenPersonas();
      $('afiduEntradaDoc').value = persona.numero_documento;
      $('afiduEntradaCodigo').value = codigo;
      await agregarFilaDesdeEntrada();
      if (typeof showToast === 'function') showToast('Paciente registrado y fila agregada', 'success');
    } catch (e) {
      if (typeof showToast === 'function') showToast(e.message, 'error');
    }
  }

  async function agregarFilaDesdeEntrada() {
    try { requireArchivoActivo(); } catch (_) { return; }
    const doc = ($('afiduEntradaDoc')?.value || '').trim();
    const codigo = ($('afiduEntradaCodigo')?.value || '').trim();
    if (!doc) {
      if (typeof showToast === 'function') showToast('Ingresa el número de documento', 'error');
      return;
    }
    if (!codigo) {
      if (typeof showToast === 'function') showToast('Ingresa el código del servicio', 'error');
      return;
    }
    try {
      const data = await apiAnexo('/api/anexo-fidu/armar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ numero_documento: doc, codigo_servicio: codigo })
      });
      if (!data.persona_encontrada) {
        mostrarPanelNuevaPersona(doc, codigo);
        if (typeof showToast === 'function') showToast('Paciente no registrado — complete los datos', 'info');
        return;
      }
      ocultarPanelNuevaPersona();
      const reg = { ...(data.registro || {}) };
      delete reg.id;
      const tr = prependFila(reg);
      if (tr) {
        await guardarFila(tr);
        tr.classList.add('afidu-row-highlight');
        setTimeout(() => tr.classList.remove('afidu-row-highlight'), 2000);
        tr.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
      $('afiduEntradaDoc').value = '';
      $('afiduEntradaCodigo').value = '';
      $('afiduEntradaDoc')?.focus();
      if (typeof showToast === 'function') showToast('Fila agregada', 'success');
    } catch (e) {
      if (typeof showToast === 'function') showToast(e.message, 'error');
    }
  }

  async function cargarRegistros() {
    cancelarEdicionCelda();
    if (!_archivoId) {
      renderBody([]);
      _total = 0;
      return;
    }
    const q = ($('afiduBuscar') && $('afiduBuscar').value.trim()) || '';
    const qs = new URLSearchParams({ page: String(_page), limit: String(_limit), archivo_id: String(_archivoId) });
    if (q) qs.set('q', q);
    const data = await apiAnexo(`/api/anexo-fidu/registros?${qs}`);
    _total = data.total || 0;
    renderBody(data.registros || []);
    const info = $('afiduPagerInfo');
    if (info) {
      const from = _total === 0 ? 0 : (_page - 1) * _limit + 1;
      const to = Math.min(_page * _limit, _total);
      info.textContent = `Mostrando ${from}–${to} de ${_total}`;
    }
    const prev = $('afiduPagerPrev');
    const next = $('afiduPagerNext');
    if (prev) prev.disabled = _page <= 1;
    if (next) next.disabled = _page * _limit >= _total;
  }

  async function eliminarRegistro(id, tr) {
    confirmEliminarAfidu('esta fila del anexo', async () => {
      try {
        if (id) await apiAnexo(`/api/anexo-fidu/registros/${id}`, { method: 'DELETE' });
        tr?.remove();
        if (typeof showToast === 'function') showToast('Fila eliminada', 'success');
        const tbody = $('afiduGridBody');
        if (tbody && !tbody.querySelector('.afidu-row')) {
          await cargarRegistros();
        }
      } catch (e) {
        if (typeof showToast === 'function') showToast(e.message, 'error');
      }
    });
  }

  async function cargarResumenPersonas() {
    try {
      await apiAnexo('/api/anexo-fidu/personas/resumen');
    } catch (_) { /* ignore */ }
  }

  async function importarPersonasCsv() {
    const input = $('afiduPersonasFileInput');
    if (!input?.files?.length) {
      if (typeof showToast === 'function') showToast('Selecciona un archivo .csv', 'error');
      return;
    }
    const file = input.files[0];
    const limpiarInput = () => { input.value = ''; };
    const ejecutar = async () => {
      const fd = new FormData();
      fd.append('file', file);
      const hdr = new Headers();
      if (typeof getCsrfForRequest === 'function') {
        const csrf = getCsrfForRequest();
        if (csrf) hdr.set('x-csrf-token', csrf);
      }
      try {
        const res = await fetch('/api/anexo-fidu/personas/importar', {
          method: 'POST',
          headers: hdr,
          body: fd,
          credentials: 'include'
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Error al importar');
        limpiarInput();
        if (typeof showToast === 'function') showToast(data.mensaje || 'Base de personas actualizada', 'success');
        await cargarResumenPersonas();
      } catch (e) {
        limpiarInput();
        if (typeof showToast === 'function') showToast(e.message, 'error');
      }
    };
    const aviso = 'Esto reemplazará toda la base de personas en el servidor.\n\n¿Desea continuar?';
    if (typeof showConfirm === 'function') {
      showConfirm(aviso, ejecutar, {
        okText: 'Continuar',
        cancelText: 'Cancelar',
        danger: true,
        icon: '⚠️',
        onCancel: limpiarInput
      });
      return;
    }
    if (!window.confirm(aviso)) {
      limpiarInput();
      return;
    }
    await ejecutar();
  }

  function exportarExcel() {
    try {
      const id = requireArchivoActivo();
      window.location.href = `/api/anexo-fidu/exportar?archivo_id=${id}`;
    } catch (_) { /* toast ya mostrado */ }
  }

  function bindGridEvents() {
    const tbody = $('afiduGridBody');
    if (!tbody || tbody.dataset.afiduGridBound) return;
    tbody.dataset.afiduGridBound = '1';
    tbody.addEventListener('dblclick', (e) => {
      const td = e.target.closest('.afidu-cell');
      if (td) iniciarEdicionCelda(td);
    });
    tbody.addEventListener('click', (e) => {
      const btn = e.target.closest('.afidu-btn-del');
      if (!btn) return;
      const tr = btn.closest('tr');
      eliminarRegistro(btn.dataset.id || tr?.dataset.id, tr);
    });
  }

  function bindEvents() {
    if (afiduEventsBound) return;
    afiduEventsBound = true;
    $('btnVolverAnexoFidu')?.addEventListener('click', () => {
      if (typeof goToMenu === 'function') goToMenu();
    });
    $('btnAfiduAgregarFila')?.addEventListener('click', agregarFilaDesdeEntrada);
    const onEnter = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); agregarFilaDesdeEntrada(); }
    };
    $('afiduEntradaDoc')?.addEventListener('keydown', onEnter);
    $('afiduEntradaCodigo')?.addEventListener('keydown', onEnter);
    $('btnAfiduSubirPersonas')?.addEventListener('click', () => $('afiduPersonasFileInput')?.click());
    $('afiduPersonasFileInput')?.addEventListener('change', importarPersonasCsv);
    $('btnAfiduExportar')?.addEventListener('click', exportarExcel);
    $('btnAfiduNuevaCarpeta')?.addEventListener('click', crearCarpeta);
    $('btnAfiduVolverCarpeta')?.addEventListener('click', volverAfiduCarpeta);
    $('btnAfiduImportarAnexo')?.addEventListener('click', importarExcelAnexo);
    $('afiduImportFileInput')?.addEventListener('change', onImportFileSelected);
    $('btnAfiduBuscar')?.addEventListener('click', () => { _page = 1; cargarRegistros(); });
    $('afiduBuscar')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { _page = 1; cargarRegistros(); }
    });
    $('afiduPagerPrev')?.addEventListener('click', () => { if (_page > 1) { _page -= 1; cargarRegistros(); } });
    $('afiduPagerNext')?.addEventListener('click', () => {
      if (_page * _limit < _total) { _page += 1; cargarRegistros(); }
    });
    bindGridEvents();
  }

  async function refrescarVistaAfiduActual() {
    await refrescarCarpetas();
    if (afiduState.vista === 'archivo' && afiduState.archivoId) {
      if (afiduState.carpetaId) await refrescarArchivos(afiduState.carpetaId);
      const row = afiduState.archivos.find((a) => a.id === afiduState.archivoId);
      if (row) {
        afiduState.archivoNombre = row.nombre;
        syncAfiduIds();
        await abrirArchivoAfidu(afiduState.archivoId);
      } else {
        afiduState.archivoId = null;
        afiduState.archivoNombre = null;
        afiduState.vista = afiduState.carpetaId ? 'carpeta' : 'root';
        syncAfiduIds();
        if (afiduState.carpetaId) renderAfiduArchivosExplorer();
        else renderAfiduRootExplorer();
      }
    } else if (afiduState.vista === 'carpeta' && afiduState.carpetaId) {
      const row = afiduState.carpetas.find((c) => c.id === afiduState.carpetaId);
      if (row) {
        afiduState.carpetaNombre = row.nombre;
        syncAfiduIds();
        await refrescarArchivos(afiduState.carpetaId);
        renderAfiduArchivosExplorer();
      } else {
        afiduState.carpetaId = null;
        afiduState.carpetaNombre = null;
        afiduState.vista = 'root';
        syncAfiduIds();
        renderAfiduRootExplorer();
      }
    } else {
      renderAfiduRootExplorer();
    }
  }

  async function initAnexoFidu() {
    if (!initAfiduDone) {
      bindEvents();
      try {
        await cargarColumnas();
        await cargarServicios();
        renderThead();
        initAfiduDone = true;
      } catch (e) {
        if (typeof showToast === 'function') showToast('Error cargando anexo: ' + e.message, 'error');
        return;
      }
    }
    try {
      await refrescarVistaAfiduActual();
      await cargarResumenPersonas();
    } catch (e) {
      if (typeof showToast === 'function') showToast('Error cargando anexo: ' + e.message, 'error');
    }
  }

  window.initAnexoFidu = initAnexoFidu;
  window.refreshAnexoFidu = refrescarVistaAfiduActual;
})();
