/**
 * Módulo Anexo FIDU — grilla tipo Excel (45 columnas).
 */
(function () {
  let _columnas = [];
  let _page = 1;
  let _total = 0;
  let _limit = 50;
  let _editId = null;

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

  function renderThead() {
    const thead = $('afiduGridHead');
    if (!thead) return;
    let html = '<tr><th class="afidu-col-acciones">Acciones</th>';
    _columnas.forEach((c) => {
      html += `<th title="${escapeHtml(c.label)}" style="min-width:${c.width || 90}px">${escapeHtml(c.label)}</th>`;
    });
    html += '</tr>';
    thead.innerHTML = html;
  }

  function renderBody(registros) {
    const tbody = $('afiduGridBody');
    if (!tbody) return;
    if (!registros.length) {
      tbody.innerHTML = `<tr><td colspan="${_columnas.length + 1}" style="padding:24px;text-align:center;color:#94a3b8">Sin registros. Importa pacientes desde Excel o crea una fila nueva.</td></tr>`;
      return;
    }
    tbody.innerHTML = registros.map((r) => {
      let cells = `<td class="afidu-col-acciones">
        <button type="button" class="btn-secondary btn-sm afidu-btn-edit" data-id="${r.id}">Editar</button>
        <button type="button" class="btn-secondary btn-sm afidu-btn-del" data-id="${r.id}" style="margin-top:4px">Borrar</button>
      </td>`;
      _columnas.forEach((c) => {
        const v = r[c.key] != null ? String(r[c.key]) : '';
        cells += `<td title="${escapeHtml(v)}">${escapeHtml(v) || '<span style="color:#cbd5e1">—</span>'}</td>`;
      });
      return `<tr data-id="${r.id}">${cells}</tr>`;
    }).join('');

    tbody.querySelectorAll('.afidu-btn-edit').forEach((btn) => {
      btn.addEventListener('click', () => abrirModalRegistro(btn.dataset.id));
    });
    tbody.querySelectorAll('.afidu-btn-del').forEach((btn) => {
      btn.addEventListener('click', () => eliminarRegistro(btn.dataset.id));
    });
  }

  async function cargarRegistros() {
    const q = ($('afiduBuscar') && $('afiduBuscar').value.trim()) || '';
    const qs = new URLSearchParams({ page: String(_page), limit: String(_limit) });
    if (q) qs.set('q', q);
    const data = await apiAnexo(`/api/anexo-fidu/registros?${qs}`);
    _total = data.total || 0;
    renderBody(data.registros || []);
    const info = $('afiduPagerInfo');
    if (info) {
      const from = _total === 0 ? 0 : (_page - 1) * _limit + 1;
      const to = Math.min(_page * _limit, _total);
      info.textContent = `Mostrando ${from}–${to} de ${_total} (${_columnas.length} columnas)`;
    }
    const prev = $('afiduPagerPrev');
    const next = $('afiduPagerNext');
    if (prev) prev.disabled = _page <= 1;
    if (next) next.disabled = _page * _limit >= _total;
  }

  function buildModalFields(registro = {}) {
    const form = $('afiduModalForm');
    if (!form) return;
    const groups = { factura: 'Factura / autorización', paciente: 'Paciente', servicio: 'Servicio', diagnostico: 'Diagnóstico', medico: 'Médico', rips: 'Códigos RIPS' };
    let html = '';
    let lastGroup = '';
    _columnas.forEach((c) => {
      if (c.group && c.group !== lastGroup) {
        lastGroup = c.group;
        html += `<div style="grid-column:1/-1;font-weight:700;font-size:.8rem;color:#475569;margin-top:8px">${escapeHtml(groups[c.group] || c.group)}</div>`;
      }
      const v = registro[c.key] != null ? String(registro[c.key]) : '';
      const isLong = ['direccion', 'nombre_servicio', 'nombre_diagnostico', 'causa_atencion', 'ciudad_residencia'].includes(c.key);
      html += `<div>
        <label for="afidu-f-${c.key}">${escapeHtml(c.label)}</label>
        ${isLong
          ? `<textarea id="afidu-f-${c.key}" data-key="${c.key}">${escapeHtml(v)}</textarea>`
          : `<input type="text" id="afidu-f-${c.key}" data-key="${c.key}" value="${escapeHtml(v)}" />`}
      </div>`;
    });
    form.innerHTML = html;
  }

  function leerModalForm() {
    const body = {};
    _columnas.forEach((c) => {
      const el = document.getElementById(`afidu-f-${c.key}`);
      body[c.key] = el ? el.value.trim() : '';
    });
    return body;
  }

  async function abrirModalRegistro(id) {
    _editId = id || null;
    const title = $('afiduModalTitle');
    if (title) title.textContent = _editId ? 'Editar fila del anexo' : 'Nueva fila del anexo';
    if (_editId) {
      const data = await apiAnexo(`/api/anexo-fidu/registros/${_editId}`);
      buildModalFields(data.registro || {});
    } else {
      buildModalFields({});
    }
    $('modalAnexoFidu')?.classList.remove('hidden');
  }

  function cerrarModal() {
    $('modalAnexoFidu')?.classList.add('hidden');
    _editId = null;
  }

  async function guardarModal() {
    const body = leerModalForm();
    try {
      if (_editId) {
        await apiAnexo(`/api/anexo-fidu/registros/${_editId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        if (typeof showToast === 'function') showToast('Registro actualizado', 'success');
      } else {
        await apiAnexo('/api/anexo-fidu/registros', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        if (typeof showToast === 'function') showToast('Registro creado', 'success');
      }
      cerrarModal();
      await cargarRegistros();
    } catch (e) {
      if (typeof showToast === 'function') showToast(e.message, 'error');
    }
  }

  async function eliminarRegistro(id) {
    if (!confirm('¿Eliminar este registro del anexo?')) return;
    try {
      await apiAnexo(`/api/anexo-fidu/registros/${id}`, { method: 'DELETE' });
      if (typeof showToast === 'function') showToast('Registro eliminado', 'success');
      await cargarRegistros();
    } catch (e) {
      if (typeof showToast === 'function') showToast(e.message, 'error');
    }
  }

  async function importarExcel() {
    const input = $('afiduFileInput');
    if (!input?.files?.length) {
      if (typeof showToast === 'function') showToast('Selecciona un archivo .xlsx', 'error');
      return;
    }
    const fd = new FormData();
    fd.append('file', input.files[0]);
    const hdr = new Headers();
    if (typeof getCsrfForRequest === 'function') {
      const csrf = getCsrfForRequest();
      if (csrf) hdr.set('x-csrf-token', csrf);
    }
    try {
      const res = await fetch('/api/anexo-fidu/importar', {
        method: 'POST',
        headers: hdr,
        body: fd,
        credentials: 'include'
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Error al importar');
      input.value = '';
      if (typeof showToast === 'function') showToast(data.mensaje || 'Importación OK', 'success');
      _page = 1;
      await cargarRegistros();
    } catch (e) {
      if (typeof showToast === 'function') showToast(e.message, 'error');
    }
  }

  function bindEvents() {
    $('btnVolverAnexoFidu')?.addEventListener('click', () => {
      if (typeof goToMenu === 'function') goToMenu();
    });
    $('btnAfiduNuevo')?.addEventListener('click', () => abrirModalRegistro(null));
    $('btnAfiduImportar')?.addEventListener('click', () => $('afiduFileInput')?.click());
    $('afiduFileInput')?.addEventListener('change', importarExcel);
    $('btnAfiduBuscar')?.addEventListener('click', () => { _page = 1; cargarRegistros(); });
    $('afiduBuscar')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { _page = 1; cargarRegistros(); }
    });
    $('afiduPagerPrev')?.addEventListener('click', () => { if (_page > 1) { _page -= 1; cargarRegistros(); } });
    $('afiduPagerNext')?.addEventListener('click', () => {
      if (_page * _limit < _total) { _page += 1; cargarRegistros(); }
    });
    $('btnAfiduModalGuardar')?.addEventListener('click', guardarModal);
    $('btnAfiduModalCerrar')?.addEventListener('click', cerrarModal);
    $('modalAnexoFidu')?.addEventListener('click', (e) => {
      if (e.target === $('modalAnexoFidu')) cerrarModal();
    });
  }

  async function initAnexoFidu() {
    bindEvents();
    try {
      await cargarColumnas();
      renderThead();
      await cargarRegistros();
    } catch (e) {
      if (typeof showToast === 'function') showToast('Error cargando anexo: ' + e.message, 'error');
    }
  }

  window.initAnexoFidu = initAnexoFidu;
})();
