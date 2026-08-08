(function () {
  'use strict';

  const LS_JOB = 'innar.docJob';
  const PF = () => window.innarDocPrefill;

  let csrfToken = '';
  let sessionUser = null;
  let state = {
    tipo: null,
    origen: null,
    fecha: '',
    doctorId: '',
    citas: [],
    citaSeleccionada: null,
    currentPreview: null
  };
  let firmaPacienteDataUrl = '';
  let firmaAcudienteDataUrl = '';

  function $(id) { return document.getElementById(id); }

  function labelTipo(t) {
    return t === 'comprobante' ? 'Comprobante de servicios' : 'Certificado de asistencia';
  }

  function labelOrigen(o) {
    return o === 'electro' ? 'Electrodiagnóstico' : 'Cita médica';
  }

  function getCookie(name) {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : '';
  }

  async function apiFetch(url, opts = {}) {
    const method = ((opts.method || 'GET') + '').toUpperCase();
    const headers = new Headers(opts.headers || {});
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      const csrf = csrfToken || getCookie('csrf_token');
      if (csrf) headers.set('x-csrf-token', csrf);
    }
    const res = await fetch(url, { ...opts, headers, credentials: 'include' });
    if (res.status === 401) {
      window.location.href = '/';
      throw new Error('Sesión expirada');
    }
    return res;
  }

  async function ensureSession() {
    const res = await fetch('/api/sesion', { credentials: 'include' });
    const data = await res.json();
    if (!data.autenticado) {
      window.location.href = '/';
      throw new Error('No autenticado');
    }
    if (data.csrfToken) csrfToken = data.csrfToken;
    sessionUser = data.usuario || null;
    return data;
  }

  function setStatus(msg, isError, elId) {
    const el = $(elId || 'docStatus');
    if (!el) return;
    el.textContent = msg || '';
    el.style.color = isError ? '#b91c1c' : '#6b7280';
  }

  function showStep(step) {
    $('stepTipo').hidden = step !== 'tipo';
    $('stepOrigen').hidden = step !== 'origen';
    $('stepLista').hidden = step !== 'lista';
    $('stepGenerar').hidden = step !== 'generar';
    $('docTopbarActions').hidden = step !== 'generar';
  }

  function updateBreadcrumbs() {
    const t = labelTipo(state.tipo);
    const o = labelOrigen(state.origen);
    if ($('crumbOrigen')) {
      $('crumbOrigen').innerHTML = `<strong>${t}</strong>`;
    }
    if ($('crumbLista')) {
      $('crumbLista').innerHTML = `<strong>${t}</strong> <span class="sep">›</span> <strong>${o}</strong>`;
    }
    if ($('crumbGenerar')) {
      const pac = state.citaSeleccionada?.paciente_nombre || '';
      $('crumbGenerar').innerHTML = `<strong>${t}</strong> <span class="sep">›</span> <strong>${o}</strong> <span class="sep">›</span> ${pac}`;
    }
  }

  function hoyYmd() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function horaLista(item) {
    if (state.origen === 'electro') {
      return String(item.hora_inicio || item.hora_agendamiento || '—').slice(0, 5);
    }
    return String(item.hora || '—').slice(0, 5);
  }

  function servicioLista(item) {
    return state.origen === 'electro'
      ? (item.estudio || '—')
      : (item.tipo_consulta || '—');
  }

  function estadoLista(item) {
    const e = String(item.estado || '—');
    const ok = /ATENDID|COMPLETAD/i.test(e);
    return `<span class="doc-badge${ok ? ' doc-badge--ok' : ''}">${e}</span>`;
  }

  async function cargarMedicos() {
    const sel = $('filtroMedico');
    if (!sel) return;
    const res = await apiFetch('/api/medicos');
    const medicos = await res.json();
    sel.innerHTML = '<option value="">— Seleccione médico —</option>';
    if (!Array.isArray(medicos)) return;
    medicos.forEach((m) => {
      const opt = document.createElement('option');
      opt.value = String(m.id);
      opt.textContent = m.nombre || m.usuario || `Médico ${m.id}`;
      sel.appendChild(opt);
    });
    if (sessionUser?.rol === 'doctor' && sessionUser.id) {
      sel.value = String(sessionUser.id);
      state.doctorId = sel.value;
    }
  }

  async function cargarCitas() {
    const fecha = $('filtroFecha')?.value;
    if (!fecha) {
      setStatus('Seleccione una fecha', true, 'docStatusLista');
      return;
    }
    state.fecha = fecha;
    setStatus('Cargando citas…', false, 'docStatusLista');

    try {
      let citas = [];
      if (state.origen === 'electro') {
        const res = await apiFetch(`/api/citas-electro?fecha=${encodeURIComponent(fecha)}&_t=${Date.now()}`);
        citas = await res.json();
        if (!res.ok || !Array.isArray(citas)) throw new Error(citas?.error || 'Error cargando electro');
      } else {
        const doctorId = $('filtroMedico')?.value;
        if (!doctorId) {
          setStatus('Seleccione el médico', true, 'docStatusLista');
          return;
        }
        state.doctorId = doctorId;
        const res = await apiFetch(`/api/turnos?fecha=${encodeURIComponent(fecha)}&doctor_id=${encodeURIComponent(doctorId)}`);
        citas = await res.json();
        if (!res.ok || !Array.isArray(citas)) throw new Error(citas?.error || 'Error cargando turnos');
      }
      state.citas = citas;
      renderTablaCitas();
      setStatus(`${citas.length} cita(s) encontrada(s).`, false, 'docStatusLista');
    } catch (e) {
      state.citas = [];
      renderTablaCitas();
      setStatus(e.message || 'Error cargando citas', true, 'docStatusLista');
    }
  }

  function renderTablaCitas() {
    const tbody = $('tablaCitasBody');
    const empty = $('listaCitasEmpty');
    const btnCont = $('btnContinuarLista');
    if (!tbody) return;
    tbody.innerHTML = '';
    state.citaSeleccionada = null;
    if (btnCont) btnCont.disabled = true;

    if (!state.citas.length) {
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;

    state.citas.forEach((cita) => {
      const tr = document.createElement('tr');
      tr.dataset.citaId = String(cita.id || '');
      tr.innerHTML = `
        <td>${horaLista(cita)}</td>
        <td>${escapeHtml(cita.paciente_nombre || '—')}</td>
        <td>${escapeHtml(cita.paciente_documento || '—')}</td>
        <td>${escapeHtml(servicioLista(cita))}</td>
        <td>${estadoLista(cita)}</td>`;
      tr.addEventListener('click', () => {
        tbody.querySelectorAll('tr').forEach((r) => r.classList.remove('selected'));
        tr.classList.add('selected');
        state.citaSeleccionada = cita;
        if (btnCont) btnCont.disabled = false;
      });
      tbody.appendChild(tr);
    });
  }

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function enriquecerComprobantePersonaFidu(payload) {
    const doc = String(payload.paciente_documento || '').trim();
    if (!doc) return payload;
    try {
      const res = await apiFetch(`/api/certificados/persona-fidu/${encodeURIComponent(doc)}?contexto=comprobante`);
      const data = await res.json();
      if (!res.ok || !data.persona) return payload;
      const p = data.persona;
      const parts = [p.nombres_1, p.nombres_2, p.apellidos_1, p.apellidos_2].filter(Boolean).join(' ');
      return {
        ...payload,
        paciente_nombre: parts || payload.paciente_nombre,
        paciente_documento: p.numero_documento || payload.paciente_documento,
        tipo_documento: p.tipo_documento || payload.tipo_documento,
        fecha_nacimiento: p.fecha_nacimiento || payload.fecha_nacimiento,
        direccion: p.direccion || payload.direccion,
        telefono: p.telefono || payload.telefono,
        correo: p.correo || payload.correo,
        tipo_afiliacion: p.afiliacion || payload.tipo_afiliacion
      };
    } catch (_) {
      return payload;
    }
  }

  async function aplicarCitaAlFormulario() {
    const pre = PF().prefillDesdeCita(state.tipo, state.origen, state.citaSeleccionada, sessionUser);
    let payload = pre;
    if (state.tipo === 'comprobante') {
      payload = await enriquecerComprobantePersonaFidu(pre);
    }
    applyPayloadToForm(payload);
    state.currentPreview = null;
    $('btnDocDownload').disabled = true;
    $('btnDocPrint').disabled = true;
    $('docPreviewWrap').hidden = true;
    $('docPreviewEmpty').hidden = false;

    $('formTitulo').textContent = labelTipo(state.tipo);
    $('formHint').textContent = state.tipo === 'certificado'
      ? 'Revise los datos del certificado. Puede editar antes de descargar.'
      : 'Complete los datos FOMAG y cargue la firma del paciente.';
    $('formCertificado').hidden = state.tipo !== 'certificado';
    $('formComprobante').hidden = state.tipo !== 'comprobante';
  }

  function applyPayloadToForm(p) {
    firmaPacienteDataUrl = p.firma_paciente || '';
    firmaAcudienteDataUrl = p.firma_acudiente || '';

    if (state.tipo === 'certificado') {
      $('certPacienteNombre').value = p.paciente_nombre || '';
      $('certTipoDoc').value = p.tipo_documento || 'CC';
      $('certDocumento').value = p.paciente_documento || '';
      $('certMotivo').value = p.motivo || '';
      $('certFechaIngreso').value = p.fecha_ingreso || '';
      $('certHoraIngreso').value = p.hora_ingreso || '';
      $('certFechaEgreso').value = p.fecha_egreso || '';
      $('certHoraEgreso').value = p.hora_egreso || '';
      $('certFuncionarioNombre').value = p.funcionario_nombre || '';
      $('certFuncionarioCargo').value = p.funcionario_cargo || '';
      return;
    }

    $('compPacienteNombre').value = p.paciente_nombre || '';
    $('compTipoDoc').value = p.tipo_documento || 'CC';
    $('compDocumento').value = p.paciente_documento || '';
    $('compFecha').value = p.fecha || '';
    $('compFechaNac').value = p.fecha_nacimiento || '';
    $('compDireccion').value = p.direccion || '';
    $('compTelefono').value = p.telefono || '';
    $('compCorreo').value = p.correo || '';
    $('compAfiliacion').value = p.tipo_afiliacion || 'Cotizante';
    $('compServicio').value = p.servicio || '';
    $('compFirmaPaciente').value = '';
    $('compMostrarAcudiente').checked = false;
    $('compAcudientePanel').hidden = true;
    if (p.acudiente_nombre) {
      $('compMostrarAcudiente').checked = true;
      $('compAcudientePanel').hidden = false;
      $('compAcudienteNombre').value = p.acudiente_nombre;
      $('compParentesco').value = p.parentesco || '';
    }
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      if (!file) { resolve(''); return; }
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result || '');
      reader.onerror = () => reject(new Error('No se pudo leer la imagen'));
      reader.readAsDataURL(file);
    });
  }

  function buildCertificadoPayload() {
    return {
      origen: state.origen,
      paciente_nombre: $('certPacienteNombre')?.value?.trim(),
      paciente_documento: $('certDocumento')?.value?.trim(),
      tipo_documento: $('certTipoDoc')?.value || 'CC',
      motivo: $('certMotivo')?.value?.trim(),
      fecha_ingreso: $('certFechaIngreso')?.value,
      hora_ingreso: $('certHoraIngreso')?.value,
      fecha_egreso: $('certFechaEgreso')?.value,
      hora_egreso: $('certHoraEgreso')?.value,
      funcionario_nombre: $('certFuncionarioNombre')?.value?.trim(),
      funcionario_cargo: $('certFuncionarioCargo')?.value?.trim()
    };
  }

  async function buildComprobantePayload() {
    const filePac = $('compFirmaPaciente')?.files?.[0];
    if (filePac) firmaPacienteDataUrl = await readFileAsDataUrl(filePac);
    if ($('compMostrarAcudiente')?.checked) {
      const fileAcud = $('compFirmaAcudiente')?.files?.[0];
      if (fileAcud) firmaAcudienteDataUrl = await readFileAsDataUrl(fileAcud);
    }
    const payload = {
      origen: state.origen,
      fecha: $('compFecha')?.value,
      paciente_nombre: $('compPacienteNombre')?.value?.trim(),
      tipo_documento: $('compTipoDoc')?.value || 'CC',
      paciente_documento: $('compDocumento')?.value?.trim(),
      fecha_nacimiento: $('compFechaNac')?.value,
      direccion: $('compDireccion')?.value?.trim(),
      telefono: $('compTelefono')?.value?.trim(),
      correo: $('compCorreo')?.value?.trim(),
      tipo_afiliacion: $('compAfiliacion')?.value?.trim(),
      servicio: $('compServicio')?.value?.trim(),
      firma_paciente: firmaPacienteDataUrl
    };
    if ($('compMostrarAcudiente')?.checked) {
      payload.acudiente_nombre = $('compAcudienteNombre')?.value?.trim();
      payload.parentesco = $('compParentesco')?.value?.trim();
      if (firmaAcudienteDataUrl) payload.firma_acudiente = firmaAcudienteDataUrl;
    }
    return payload;
  }

  function previewUrl() {
    return state.tipo === 'comprobante'
      ? '/api/certificados/comprobante-servicios/preview'
      : '/api/certificados/asistencia/preview';
  }

  async function fetchPreview(payload) {
    const res = await apiFetch(previewUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Error generando vista previa');
    return data;
  }

  function esperarImagenes(doc, timeoutMs) {
    return new Promise((resolve) => {
      const imgs = doc.querySelectorAll('img');
      if (!imgs.length) { resolve(); return; }
      let pendientes = imgs.length;
      const listo = () => { pendientes -= 1; if (pendientes <= 0) resolve(); };
      imgs.forEach((img) => {
        if (img.complete) listo();
        else {
          img.addEventListener('load', listo, { once: true });
          img.addEventListener('error', listo, { once: true });
        }
      });
      setTimeout(resolve, timeoutMs || 8000);
    });
  }

  async function renderPreviewHtml(html) {
    const frame = $('docPreviewFrame');
    const doc = frame.contentDocument || frame.contentWindow?.document;
    doc.open();
    doc.write(html);
    doc.close();
    await esperarImagenes(doc, 8000);
    if (doc.fonts?.ready) {
      await Promise.race([doc.fonts.ready, new Promise((r) => setTimeout(r, 4000))]);
    }
    await new Promise((r) => setTimeout(r, 400));
    $('docPreviewWrap').hidden = false;
    $('docPreviewEmpty').hidden = true;
    $('btnDocDownload').disabled = false;
    $('btnDocPrint').disabled = false;
  }

  async function cargarVistaPrevia(silent) {
    try {
      setStatus(silent ? '' : 'Generando vista previa…');
      const payload = state.tipo === 'comprobante'
        ? await buildComprobantePayload()
        : buildCertificadoPayload();
      if (state.tipo === 'comprobante' && !payload.firma_paciente) {
        throw new Error('Debe cargar la firma del paciente');
      }
      const data = await fetchPreview(payload);
      state.currentPreview = data;
      await renderPreviewHtml(data.html);
      setStatus('Vista previa lista.');
      return data;
    } catch (e) {
      setStatus(e.message || 'Error en vista previa', true);
      if (!silent) throw e;
      return null;
    }
  }

  function postUrlPdf() {
    return state.tipo === 'comprobante'
      ? '/api/certificados/comprobante-servicios'
      : '/api/certificados/asistencia';
  }

  async function descargarPdf() {
    setStatus('Generando PDF…');
    $('btnDocDownload').disabled = true;
    try {
      const payload = state.tipo === 'comprobante'
        ? await buildComprobantePayload()
        : buildCertificadoPayload();
      if (state.tipo === 'comprobante' && !payload.firma_paciente) {
        throw new Error('Debe cargar la firma del paciente');
      }
      const PDF = window.innarDocumentoPdf;
      if (!PDF) throw new Error('Generador PDF no disponible');
      const doc = payload.paciente_documento?.replace(/\D/g, '') || 'sin_doc';
      const filename = state.tipo === 'comprobante'
        ? `comprobante_servicios_${doc}.pdf`
        : `certificado_asistencia_${doc}.pdf`;
      const modo = await PDF.generarDocumento({
        postUrl: postUrlPdf(),
        previewUrl: previewUrl(),
        payload,
        filename
      });
      setStatus(modo === 'pdf-servidor' ? 'PDF descargado.' : 'Documento generado.');
      if (state.tipo === 'certificado') {
        try {
          localStorage.setItem('innar.certAsistencia.defaults', JSON.stringify({
            funcionario_nombre: $('certFuncionarioNombre')?.value || '',
            funcionario_cargo: $('certFuncionarioCargo')?.value || ''
          }));
        } catch (_) { /* ignore */ }
      }
    } finally {
      $('btnDocDownload').disabled = false;
    }
  }

  function imprimir() {
    const frame = $('docPreviewFrame');
    if (!frame?.contentWindow) return;
    frame.contentWindow.focus();
    frame.contentWindow.print();
  }

  function irATipo() {
    state.tipo = null;
    state.origen = null;
    state.citaSeleccionada = null;
    showStep('tipo');
  }

  function irAOrigen() {
    state.origen = null;
    state.citaSeleccionada = null;
    updateBreadcrumbs();
    showStep('origen');
  }

  async function irALista() {
    updateBreadcrumbs();
    $('wrapFiltroMedico').hidden = state.origen !== 'medica';
    if (!$('filtroFecha').value) $('filtroFecha').value = hoyYmd();
    if (state.origen === 'medica' && $('filtroMedico').options.length <= 1) {
      await cargarMedicos();
    }
    showStep('lista');
    if (state.citas.length === 0) await cargarCitas();
  }

  async function irAGenerar() {
    if (!state.citaSeleccionada) return;
    updateBreadcrumbs();
    await aplicarCitaAlFormulario();
    showStep('generar');
  }

  function applyJobFromApp(job) {
    if (!job?.tipo || !job?.payload) return false;
    state.tipo = job.tipo;
    state.origen = job.payload.origen || 'medica';
    state.citaSeleccionada = { ...job.payload, id: 'job' };
    applyPayloadToForm(job.payload);
    $('formTitulo').textContent = labelTipo(state.tipo);
    $('formHint').textContent = 'Datos enviados desde la agenda. Revise y descargue el PDF.';
    $('formCertificado').hidden = state.tipo !== 'certificado';
    $('formComprobante').hidden = state.tipo !== 'comprobante';
    updateBreadcrumbs();
    showStep('generar');
    return true;
  }

  function readJobFromStorage() {
    try {
      const raw = sessionStorage.getItem(LS_JOB);
      if (!raw) return null;
      sessionStorage.removeItem(LS_JOB);
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  function bindUi() {
    document.querySelectorAll('[data-pick-tipo]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.tipo = btn.dataset.pickTipo;
        updateBreadcrumbs();
        showStep('origen');
      });
    });

    document.querySelectorAll('[data-pick-origen]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        state.origen = btn.dataset.pickOrigen;
        await irALista();
      });
    });

    $('btnBackOrigen')?.addEventListener('click', irATipo);
    $('btnBackLista')?.addEventListener('click', irAOrigen);
    $('btnCargarCitas')?.addEventListener('click', () => cargarCitas());
    $('filtroFecha')?.addEventListener('change', () => cargarCitas());
    $('filtroMedico')?.addEventListener('change', () => cargarCitas());
    $('btnContinuarLista')?.addEventListener('click', () => irAGenerar());
    $('btnBackGenerar')?.addEventListener('click', () => irALista());

    $('compMostrarAcudiente')?.addEventListener('change', (e) => {
      $('compAcudientePanel').hidden = !e.target.checked;
    });

    $('btnDocPreview')?.addEventListener('click', () => cargarVistaPrevia(false).catch(() => {}));
    $('btnDocDownload')?.addEventListener('click', () => {
      descargarPdf().catch((e) => setStatus(e.message, true));
    });
    $('btnDocPrint')?.addEventListener('click', imprimir);
  }

  async function init() {
    bindUi();
    await ensureSession();
    $('filtroFecha').value = hoyYmd();

    const job = readJobFromStorage();
    if (job && applyJobFromApp(job)) {
      await cargarVistaPrevia(true);
      if (job.autoDownload) {
        await descargarPdf().catch((e) => setStatus(e.message, true));
      }
      return;
    }
    showStep('tipo');
  }

  init().catch((e) => setStatus(e.message || 'Error iniciando', true));
})();
