/**
 * Formulario compartido: base de pacientes FOMAG (anexo_fidu_personas).
 * Usado por certificado, comprobante y anexo.
 */
(function () {
  const PERSONA_FORM = [
    { key: 'numero_documento', label: 'Número de documento' },
    { key: 'nombres_1', label: 'Nombres (1)' },
    { key: 'nombres_2', label: 'Nombres (2)' },
    { key: 'apellidos_1', label: 'Apellidos (1)' },
    { key: 'apellidos_2', label: 'Apellidos (2)' },
    { key: 'fecha_nacimiento', label: 'Fecha de nacimiento (AAAA-MM-DD)' },
    { key: 'tipo_documento', label: 'Tipo de documento' },
    { key: 'ciudad_nacimiento', label: 'Ciudad de nacimiento' },
    { key: 'genero', label: 'Género' },
    { key: 'direccion', label: 'Dirección', long: true },
    { key: 'barrio', label: 'Barrio' },
    { key: 'ciudad_residencia', label: 'Ciudad de residencia', long: true },
    { key: 'telefono', label: 'Teléfono' },
    { key: 'correo', label: 'Correo' },
    { key: 'afiliacion', label: 'Afiliación', long: true }
  ];

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function normalizarFecha(val) {
    const s = String(val || '').trim();
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    const m2 = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m2) return `${m2[3]}-${m2[2]}-${m2[1]}`;
    return s;
  }

  function calcularTipoDocumento(fecha) {
    const f = normalizarFecha(fecha);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) return '';
    const birth = new Date(f + 'T12:00:00');
    if (isNaN(birth.getTime())) return '';
    const now = new Date();
    let age = now.getFullYear() - birth.getFullYear();
    const m = now.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age -= 1;
    if (age < 7) return 'RC';
    if (age < 18) return 'TI';
    return 'CC';
  }

  function htmlCampo(f, val, readonly) {
    const ro = readonly ? ' readonly style="opacity:.75"' : '';
    if (f.key === 'fecha_nacimiento') {
      return `<input type="date" id="pfidu-${f.key}" data-key="${f.key}" value="${escapeHtml(val)}"${ro} />`;
    }
    if (f.long) {
      return `<textarea id="pfidu-${f.key}" data-key="${f.key}"${ro}>${escapeHtml(val)}</textarea>`;
    }
    return `<input type="text" id="pfidu-${f.key}" data-key="${f.key}" value="${escapeHtml(val)}"${ro} />`;
  }

  function camposParaFormulario(camposFaltantes, persona, modoCompleto) {
    if (modoCompleto) return PERSONA_FORM;
    const keys = new Set((camposFaltantes || []).map((c) => c.key || c));
    if (!keys.size) return PERSONA_FORM;
    const list = PERSONA_FORM.filter((f) => keys.has(f.key));
    if (!list.some((f) => f.key === 'numero_documento')) {
      list.unshift(PERSONA_FORM[0]);
    }
    return list;
  }

  function renderFormulario(container, opts = {}) {
    const persona = opts.persona || {};
    const campos = camposParaFormulario(opts.camposFaltantes, persona, opts.modoCompleto);
    const docReadonly = opts.documentoReadonly !== false;
    let html = '<div class="pfidu-form-grid">';
    campos.forEach((f) => {
      const v = persona[f.key] != null ? String(persona[f.key]) : '';
      const ro = f.key === 'numero_documento' && docReadonly;
      html += `<div class="pfidu-form-field"><label>${escapeHtml(f.label)}</label>${htmlCampo(f, v, ro)}</div>`;
    });
    html += '</div>';
    container.innerHTML = html;
    bindFechaTipoDocumento(container);
  }

  function bindFechaTipoDocumento(root) {
    const fn = root.querySelector('#pfidu-fecha_nacimiento');
    const tipo = root.querySelector('#pfidu-tipo_documento');
    const sync = () => {
      if (!tipo) return;
      const t = calcularTipoDocumento(fn?.value || '');
      if (t && !tipo.value.trim()) tipo.value = t;
    };
    const syncFecha = () => {
      if (!fn) return;
      const norm = normalizarFecha(fn.value);
      if (norm && norm !== fn.value) fn.value = norm;
      sync();
    };
    fn?.addEventListener('change', syncFecha);
    fn?.addEventListener('blur', syncFecha);
    fn?.addEventListener('input', sync);
  }

  function leerFormulario(root) {
    const persona = {};
    PERSONA_FORM.forEach((f) => {
      const el = root.querySelector(`#pfidu-${f.key}`);
      let val = el ? el.value.trim() : '';
      if (f.key === 'fecha_nacimiento') val = normalizarFecha(val);
      persona[f.key] = val;
    });
    return persona;
  }

  async function fetchPersona(documento, contexto) {
    const doc = String(documento || '').trim();
    const ctx = encodeURIComponent(contexto || 'anexo');
    const res = await apiFetch(`/api/certificados/persona-fidu/${encodeURIComponent(doc)}?contexto=${ctx}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Error consultando paciente');
    return data;
  }

  async function guardarPersona(persona, contexto) {
    const res = await apiFetch('/api/certificados/persona-fidu', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...persona, contexto: contexto || 'anexo' })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Error guardando paciente');
    return data;
  }

  window.innarPersonaFidu = {
    PERSONA_FORM,
    normalizarFecha,
    calcularTipoDocumento,
    renderFormulario,
    leerFormulario,
    fetchPersona,
    guardarPersona,
    camposParaFormulario
  };
})();
