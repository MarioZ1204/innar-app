/**
 * Módulo Anexo FIDU — grilla editable tipo Excel (doble clic).
 */
(function () {
  let _columnas = [];
  let _servicios = [];
  let _page = 1;
  let _total = 0;
  let _limit = 50;
  let _celdaEditando = null;
  let _pendingCodigo = '';

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

  async function guardarFila(tr) {
    const body = leerRegistroDesdeFila(tr);
    const payload = { ...body, actualizar_persona: true };
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
      if (typeof showToast === 'function') showToast('Fila agregada — doble clic para editar', 'success');
    } catch (e) {
      if (typeof showToast === 'function') showToast(e.message, 'error');
    }
  }

  async function cargarRegistros() {
    cancelarEdicionCelda();
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
      info.textContent = `Mostrando ${from}–${to} de ${_total} · doble clic para editar`;
    }
    const prev = $('afiduPagerPrev');
    const next = $('afiduPagerNext');
    if (prev) prev.disabled = _page <= 1;
    if (next) next.disabled = _page * _limit >= _total;
  }

  async function eliminarRegistro(id, tr) {
    if (!confirm('¿Eliminar esta fila del anexo?')) return;
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
  }

  async function cargarResumenPersonas() {
    try {
      const data = await apiAnexo('/api/anexo-fidu/personas/resumen');
      const el = $('afiduPersonasInfo');
      if (el) el.textContent = `${data.total || 0} persona(s) en base maestra (MySQL)`;
    } catch (_) { /* ignore */ }
  }

  async function importarPersonasCsv() {
    const input = $('afiduPersonasFileInput');
    if (!input?.files?.length) {
      if (typeof showToast === 'function') showToast('Selecciona un archivo .csv', 'error');
      return;
    }
    if (!confirm('Esto reemplazará toda la base de personas en el servidor. ¿Continuar?')) {
      input.value = '';
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
      const res = await fetch('/api/anexo-fidu/personas/importar', {
        method: 'POST',
        headers: hdr,
        body: fd,
        credentials: 'include'
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Error al importar');
      input.value = '';
      if (typeof showToast === 'function') showToast(data.mensaje || 'Base actualizada en MySQL', 'success');
      await cargarResumenPersonas();
    } catch (e) {
      if (typeof showToast === 'function') showToast(e.message, 'error');
    }
  }

  function exportarExcel() {
    window.location.href = '/api/anexo-fidu/exportar';
  }

  function bindGridEvents() {
    const tbody = $('afiduGridBody');
    if (!tbody) return;
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

  async function initAnexoFidu() {
    bindEvents();
    try {
      await cargarColumnas();
      await cargarServicios();
      renderThead();
      await cargarRegistros();
      await cargarResumenPersonas();
    } catch (e) {
      if (typeof showToast === 'function') showToast('Error cargando anexo: ' + e.message, 'error');
    }
  }

  window.initAnexoFidu = initAnexoFidu;
})();
