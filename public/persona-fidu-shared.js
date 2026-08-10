/**
 * Formulario compartido: base de pacientes FOMAG (anexo_fidu_personas).
 * Usado por certificado, comprobante y anexo.
 * Siempre muestra el formulario completo; resalta los campos faltantes.
 */
(function () {
  const PERSONA_FORM = [
    { key: 'numero_documento', label: 'Número de documento', required: true },
    { key: 'nombres_1', label: 'Primer nombre', required: true },
    { key: 'nombres_2', label: 'Segundo nombre' },
    { key: 'apellidos_1', label: 'Primer apellido', required: true },
    { key: 'apellidos_2', label: 'Segundo apellido' },
    { key: 'fecha_nacimiento', label: 'Fecha de nacimiento', required: true },
    { key: 'tipo_documento', label: 'Tipo de documento', required: true },
    { key: 'ciudad_nacimiento', label: 'Ciudad de nacimiento', required: true },
    { key: 'genero', label: 'Género', required: true },
    { key: 'direccion', label: 'Dirección', long: true, required: true },
    { key: 'barrio', label: 'Barrio' },
    { key: 'ciudad_residencia', label: 'Ciudad de residencia', long: true, required: true },
    { key: 'telefono', label: 'Teléfono', required: true },
    { key: 'correo', label: 'Correo', required: true },
    { key: 'afiliacion', label: 'Afiliación', required: true }
  ];

  const OPCIONES_GENERO = [
    { value: '', label: '— Seleccionar —' },
    { value: 'Masculino', label: 'Masculino' },
    { value: 'Femenino', label: 'Femenino' },
    { value: 'Otro', label: 'Otro' }
  ];

  const OPCIONES_AFILIACION = [
    { value: '', label: '— Seleccionar —' },
    { value: 'Cotizante', label: 'Cotizante' },
    { value: 'Beneficiario', label: 'Beneficiario' },
    { value: 'Adicional', label: 'Adicional' },
    { value: 'Estudiante', label: 'Estudiante' },
    { value: 'Pensionado', label: 'Pensionado' }
  ];

  const OPCIONES_TIPO_DOC = [
    { value: '', label: '— Auto / seleccionar —' },
    { value: 'CC', label: 'CC — Cédula de ciudadanía' },
    { value: 'TI', label: 'TI — Tarjeta de identidad' },
    { value: 'RC', label: 'RC — Registro civil' },
    { value: 'CE', label: 'CE — Cédula de extranjería' },
    { value: 'PA', label: 'PA — Pasaporte' }
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

  function keysFaltantesSet(camposFaltantes) {
    return new Set((camposFaltantes || []).map((c) => c.key || c).filter(Boolean));
  }

  function labelsFaltantes(camposFaltantes) {
    return (camposFaltantes || [])
      .map((c) => c.label || labelDeCampo(c.key || c))
      .filter(Boolean);
  }

  function labelDeCampo(key) {
    return PERSONA_FORM.find((f) => f.key === key)?.label || key;
  }

  function htmlSelect(id, key, val, options, readonly) {
    const ro = readonly ? ' disabled' : '';
    const opts = options.map((o) => {
      const selected = String(o.value) === String(val || '') ? ' selected' : '';
      return `<option value="${escapeHtml(o.value)}"${selected}>${escapeHtml(o.label)}</option>`;
    }).join('');
    // Si el valor actual no está en la lista, lo añadimos para no perderlo
    const known = options.some((o) => String(o.value) === String(val || ''));
    const extra = (!known && val)
      ? `<option value="${escapeHtml(val)}" selected>${escapeHtml(val)}</option>`
      : '';
    return `<select id="${id}" data-key="${key}"${ro}>${extra}${opts}</select>`;
  }

  function htmlCampo(f, val, readonly) {
    const ro = readonly ? ' readonly style="opacity:.75"' : '';
    const id = `pfidu-${f.key}`;
    if (f.key === 'fecha_nacimiento') {
      return `<input type="text" class="innar-fecha-input" id="${id}" data-key="${f.key}" value="${escapeHtml(val)}" placeholder="AAAA-MM-DD o DD/MM/AAAA" autocomplete="off"${ro} />`;
    }
    if (f.key === 'genero') {
      return htmlSelect(id, f.key, val, OPCIONES_GENERO, readonly);
    }
    if (f.key === 'afiliacion') {
      return htmlSelect(id, f.key, val, OPCIONES_AFILIACION, readonly);
    }
    if (f.key === 'tipo_documento') {
      return htmlSelect(id, f.key, val, OPCIONES_TIPO_DOC, readonly);
    }
    if (f.long) {
      return `<textarea id="${id}" data-key="${f.key}"${ro}>${escapeHtml(val)}</textarea>`;
    }
    return `<input type="text" id="${id}" data-key="${f.key}" value="${escapeHtml(val)}"${ro} />`;
  }

  /**
   * Siempre devuelve el formulario completo.
   * (Antes filtraba por fases; eso provocaba “pide un dato y luego aparecen más”.)
   */
  function camposParaFormulario(_camposFaltantes, _persona, _modoCompleto) {
    return PERSONA_FORM;
  }

  function htmlListaFaltantes(camposFaltantes) {
    const labels = labelsFaltantes(camposFaltantes);
    if (!labels.length) return '';
    return `<div class="pfidu-faltantes-list" role="status">
      <strong>Complete estos datos obligatorios:</strong>
      <ul>${labels.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>
    </div>`;
  }

  function renderFormulario(container, opts = {}) {
    const persona = opts.persona || {};
    const faltantesKeys = keysFaltantesSet(opts.camposFaltantes);
    const campos = PERSONA_FORM;
    const docReadonly = opts.documentoReadonly !== false;
    let html = htmlListaFaltantes(opts.camposFaltantes);
    html += '<div class="pfidu-form-grid">';
    campos.forEach((f) => {
      const v = persona[f.key] != null ? String(persona[f.key]) : '';
      const ro = f.key === 'numero_documento' && docReadonly;
      const missClass = faltantesKeys.has(f.key) ? ' is-missing' : '';
      const reqMark = f.required ? ' <span class="pfidu-req" title="Obligatorio">*</span>' : '';
      html += `<div class="pfidu-form-field${missClass}" data-field="${f.key}">
        <label for="pfidu-${f.key}">${escapeHtml(f.label)}${reqMark}</label>
        ${htmlCampo(f, v, ro)}
      </div>`;
    });
    html += '</div>';
    container.innerHTML = html;
    bindFechaTipoDocumento(container);
    bindFechaInputs(container);
    // Scroll al primer faltante
    const firstMiss = container.querySelector('.pfidu-form-field.is-missing');
    if (firstMiss) {
      try { firstMiss.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (_) { /* noop */ }
      const input = firstMiss.querySelector('input, select, textarea');
      if (input && !input.readOnly && !input.disabled) {
        setTimeout(() => { try { input.focus(); } catch (_) { /* noop */ } }, 80);
      }
    }
  }

  function bindFechaInputs(root = document) {
    const scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll('.innar-fecha-input').forEach((el) => {
      if (el.dataset.innarFechaBound) return;
      el.dataset.innarFechaBound = '1';
      const norm = () => {
        const n = normalizarFecha(el.value);
        if (n && n !== el.value) el.value = n;
      };
      el.addEventListener('blur', norm);
      el.addEventListener('change', norm);
    });
  }

  function bindFechaTipoDocumento(root) {
    const fn = root.querySelector('#pfidu-fecha_nacimiento');
    const tipo = root.querySelector('#pfidu-tipo_documento');
    const sync = () => {
      if (!tipo) return;
      const t = calcularTipoDocumento(fn?.value || '');
      if (t && !String(tipo.value || '').trim()) tipo.value = t;
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

  function sugerirNombresDesdeTexto(nombreCompleto) {
    const words = String(nombreCompleto || '').trim().replace(/\s+/g, ' ').split(' ').filter(Boolean);
    if (!words.length) {
      return { nombres_1: '', nombres_2: '', apellidos_1: '', apellidos_2: '' };
    }
    if (words.length === 1) {
      return { nombres_1: words[0], nombres_2: '', apellidos_1: '', apellidos_2: '' };
    }
    if (words.length === 2) {
      return { nombres_1: words[0], nombres_2: '', apellidos_1: words[1], apellidos_2: '' };
    }
    return {
      nombres_1: words.slice(0, -2).join(' '),
      nombres_2: '',
      apellidos_1: words[words.length - 2],
      apellidos_2: words[words.length - 1]
    };
  }

  function personaDesdeComprobanteModal(modal) {
    const doc = String(modal?.paciente_documento || '').trim();
    return {
      numero_documento: doc,
      ...sugerirNombresDesdeTexto(modal?.paciente_nombre),
      tipo_documento: String(modal?.tipo_documento || '').trim(),
      fecha_nacimiento: normalizarFecha(modal?.fecha_nacimiento),
      direccion: String(modal?.direccion || '').trim(),
      telefono: String(modal?.telefono || '').trim(),
      correo: String(modal?.correo || '').trim(),
      afiliacion: String(modal?.tipo_afiliacion || '').trim(),
      firma_paciente: String(modal?.firma_paciente || '').trim()
    };
  }

  function personaDesdeCertificadoModal(modal) {
    const doc = String(modal?.paciente_documento || '').trim();
    return {
      numero_documento: doc,
      ...sugerirNombresDesdeTexto(modal?.paciente_nombre),
      tipo_documento: String(modal?.tipo_documento || '').trim()
    };
  }

  async function guardarDesdeComprobanteModal(modal, contexto) {
    return guardarPersona(personaDesdeComprobanteModal(modal), contexto || 'comprobante');
  }

  async function guardarDesdeCertificadoModal(modal, contexto) {
    return guardarPersona(personaDesdeCertificadoModal(modal), contexto || 'certificado');
  }

  function initFechaInputsGlobal() {
    bindFechaInputs(document);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFechaInputsGlobal);
  } else {
    initFechaInputsGlobal();
  }

  window.innarPersonaFidu = {
    PERSONA_FORM,
    normalizarFecha,
    bindFechaInputs,
    calcularTipoDocumento,
    renderFormulario,
    leerFormulario,
    fetchPersona,
    guardarPersona,
    sugerirNombresDesdeTexto,
    personaDesdeComprobanteModal,
    personaDesdeCertificadoModal,
    guardarDesdeComprobanteModal,
    guardarDesdeCertificadoModal,
    camposParaFormulario,
    labelsFaltantes
  };
})();
