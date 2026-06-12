/**
 * Módulo integrado: certificados y comprobantes FOMAG.
 * Flujo: tipo → origen → documento → Generar → modal → Confirmar → PDF.
 */
(function () {
  'use strict';

  let bound = false;
  let firmaPacienteDataUrl = '';

  const state = {
    tipo: null,
    origen: null,
    documento: '',
    encontrada: false
  };

  function $(id) { return document.getElementById(id); }

  function toast(msg, type) {
    if (typeof showToast === 'function') showToast(msg, type || 'info');
  }

  function setStatus(msg, isError, elId) {
    const el = $(elId || 'docmodBuscarMsg');
    if (!el) return;
    el.textContent = msg || '';
    el.classList.toggle('is-error', !!isError);
  }

  function setModalError(msg) {
    const el = $('docmodModalError');
    if (!el) return;
    el.textContent = msg || '';
  }

  function hoyYmd() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function horaActual() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function nombreDesdePersona(persona) {
    const parts = [
      persona?.nombres_1, persona?.nombres_2, persona?.apellidos_1, persona?.apellidos_2
    ].map((s) => String(s || '').trim()).filter(Boolean);
    return parts.join(' ');
  }

  function leerTipoIdRadio(name) {
    const checked = document.querySelector(`input[name="${name}"]:checked`);
    return checked?.value || 'CC';
  }

  function setTipoIdRadio(name, value) {
    const val = value || 'CC';
    document.querySelectorAll(`input[name="${name}"]`).forEach((el) => {
      el.checked = el.value === val;
    });
  }

  function defaultsCertificado() {
    const PF = window.innarDocPrefill;
    const defaults = PF?.leerDefaultsCertificado?.() || {};
    const nombreUsuario = (typeof currentUser !== 'undefined' && currentUser)
      ? (currentUser.nombre || currentUser.usuario || '').trim()
      : '';
    const hoy = hoyYmd();
    const hora = horaActual();
    return {
      motivo: '',
      fecha_ingreso: hoy,
      hora_ingreso: hora,
      fecha_egreso: hoy,
      hora_egreso: hora,
      funcionario_nombre: defaults.funcionario_nombre || nombreUsuario,
      funcionario_cargo: defaults.funcionario_cargo || ''
    };
  }

  const LABEL_TIPO = {
    certificado: 'Certificado de asistencia',
    comprobante: 'Comprobante de servicios'
  };

  const LABEL_ORIGEN = {
    medica: 'Cita médica',
    electro: 'Electrodiagnóstico'
  };

  function servicioSugerido() {
    return state.origen === 'electro' ? 'Electrodiagnóstico' : 'Consulta médica';
  }

  function datosDesdePersona(persona, documento) {
    const doc = String(persona?.numero_documento || documento || '').trim();
    const nombre = nombreDesdePersona(persona);
    return {
      paciente_nombre: nombre,
      tipo_documento: String(persona?.tipo_documento || 'CC').trim() || 'CC',
      paciente_documento: doc,
      fecha_nacimiento: String(persona?.fecha_nacimiento || '').trim(),
      direccion: String(persona?.direccion || '').trim(),
      telefono: String(persona?.telefono || '').trim(),
      correo: String(persona?.correo || '').trim(),
      tipo_afiliacion: String(persona?.afiliacion || 'Cotizante').trim() || 'Cotizante'
    };
  }

  function marcarBotonesGrupo(selector, attr, value) {
    document.querySelectorAll(selector).forEach((btn) => {
      const selected = value != null && btn.getAttribute(attr) === value;
      btn.classList.toggle('active', selected);
      btn.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
  }

  function actualizarResumenesSeleccion() {
    const tipoEl = $('docmodTipoResumen');
    const origenEl = $('docmodOrigenResumen');
    if (tipoEl) {
      tipoEl.textContent = state.tipo
        ? `Seleccionado: ${LABEL_TIPO[state.tipo] || state.tipo}`
        : 'Ninguna opción seleccionada';
      tipoEl.classList.toggle('is-selected', !!state.tipo);
    }
    if (origenEl) {
      origenEl.textContent = state.origen
        ? `Seleccionado: ${LABEL_ORIGEN[state.origen] || state.origen}`
        : 'Ninguna opción seleccionada';
      origenEl.classList.toggle('is-selected', !!state.origen);
    }
  }

  function actualizarSeccionOrigen() {
    $('docmodOrigenSection')?.classList.toggle('hidden', !state.tipo);
    actualizarResumenesSeleccion();
  }

  function seleccionarTipo(tipo) {
    const cambio = state.tipo !== tipo;
    state.tipo = tipo;
    if (cambio) {
      state.origen = null;
      marcarBotonesGrupo('[data-docmod-origen]', 'data-docmod-origen', null);
      setStatus('');
    }
    marcarBotonesGrupo('[data-docmod-tipo]', 'data-docmod-tipo', state.tipo);
    actualizarSeccionOrigen();
  }

  function seleccionarOrigen(origen) {
    state.origen = origen;
    marcarBotonesGrupo('[data-docmod-origen]', 'data-docmod-origen', state.origen);
  }

  function sincronizarUiSeleccion() {
    marcarBotonesGrupo('[data-docmod-tipo]', 'data-docmod-tipo', state.tipo);
    marcarBotonesGrupo('[data-docmod-origen]', 'data-docmod-origen', state.origen);
    actualizarSeccionOrigen();
    actualizarResumenesSeleccion();
  }

  function validarSeleccion() {
    if (!state.tipo) {
      setStatus('Seleccione el tipo de documento', true);
      return false;
    }
    if (!state.origen) {
      setStatus('Seleccione el origen del servicio', true);
      return false;
    }
    return true;
  }

  function abrirModal() {
    const modal = $('modalDocumentosCita');
    if (!modal) return;
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
  }

  function cerrarModal() {
    const modal = $('modalDocumentosCita');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.style.display = 'none';
    setModalError('');
    firmaPacienteDataUrl = '';
    $('docmodModalCompFirma') && ($('docmodModalCompFirma').value = '');
  }

  function llenarModalCertificado(datos, extras) {
    const defs = { ...defaultsCertificado(), ...(extras || {}) };
    $('docmodModalCert').classList.remove('hidden');
    $('docmodModalComp').classList.add('hidden');
    $('docmodModalTitulo').textContent = 'Certificado de asistencia';
    $('docmodModalHint').textContent = state.encontrada
      ? 'Revise los datos del paciente y del certificado. Puede editarlos antes de confirmar.'
      : 'Complete los datos del paciente y del certificado para generar el PDF.';

    $('docmodModalCertNombre').value = datos.paciente_nombre || extras?.paciente_nombre || '';
    setTipoIdRadio('docmodModalCertTipoId', datos.tipo_documento || extras?.tipo_documento);
    $('docmodModalCertDocumento').value = datos.paciente_documento || state.documento;
    $('docmodModalCertMotivo').value = extras?.motivo || defs.motivo;
    $('docmodModalCertFechaIngreso').value = extras?.fecha_ingreso || defs.fecha_ingreso;
    $('docmodModalCertHoraIngreso').value = extras?.hora_ingreso || defs.hora_ingreso;
    $('docmodModalCertFechaEgreso').value = extras?.fecha_egreso || defs.fecha_egreso;
    $('docmodModalCertHoraEgreso').value = extras?.hora_egreso || defs.hora_egreso;
    $('docmodModalCertFuncionario').value = extras?.funcionario_nombre || defs.funcionario_nombre;
    $('docmodModalCertCargo').value = extras?.funcionario_cargo || defs.funcionario_cargo;
  }

  function llenarModalComprobante(datos, extras) {
    $('docmodModalCert').classList.add('hidden');
    $('docmodModalComp').classList.remove('hidden');
    $('docmodModalTitulo').textContent = 'Comprobante de servicios';
    $('docmodModalHint').textContent = state.encontrada
      ? 'Datos del paciente cargados desde la base. Revise y complete lo que falte.'
      : 'El paciente no está en la base. Ingrese los datos del comprobante FOMAG.';

    $('docmodModalCompFecha').value = extras?.fecha || hoyYmd();
    $('docmodModalCompNombre').value = datos.paciente_nombre || extras?.paciente_nombre || '';
    setTipoIdRadio('docmodModalCompTipoId', datos.tipo_documento || extras?.tipo_documento);
    $('docmodModalCompDocumento').value = datos.paciente_documento || state.documento;
    $('docmodModalCompFechaNac').value = datos.fecha_nacimiento || extras?.fecha_nacimiento || '';
    $('docmodModalCompDireccion').value = datos.direccion || extras?.direccion || '';
    $('docmodModalCompTelefono').value = datos.telefono || extras?.telefono || '';
    $('docmodModalCompCorreo').value = datos.correo || extras?.correo || '';
    $('docmodModalCompAfiliacion').value = datos.tipo_afiliacion || extras?.tipo_afiliacion || 'Cotizante';
    $('docmodModalCompServicio').value = extras?.servicio || servicioSugerido();
    if (extras?.firma_paciente) firmaPacienteDataUrl = extras.firma_paciente;
  }

  function abrirModalConDatos(persona, extras) {
    const datos = datosDesdePersona(persona, state.documento);
    setModalError('');
    if (state.tipo === 'certificado') {
      llenarModalCertificado(datos, extras);
    } else {
      llenarModalComprobante(datos, extras);
    }
    abrirModal();
  }

  async function iniciarGeneracion() {
    if (!validarSeleccion()) return;
    const doc = $('docmodDocumento')?.value?.trim();
    if (!doc) {
      setStatus('Ingrese el número de documento', true);
      return;
    }

    state.documento = doc;
    setStatus('');
    const btn = $('btnDocmodGenerar');
    if (btn) btn.disabled = true;

    let persona = null;
    state.encontrada = false;

    try {
      const PF = window.innarPersonaFidu;
      if (PF) {
        const data = await PF.fetchPersona(doc, 'anexo');
        if (data?.persona) {
          persona = data.persona;
          state.encontrada = !!data.encontrada;
        }
      }
    } catch (_) {
      /* sin base: modal vacío */
    }

    abrirModalConDatos(persona || { numero_documento: doc }, null);
    if (btn) btn.disabled = false;
  }

  function validarModalCertificado() {
    const nombre = $('docmodModalCertNombre')?.value?.trim();
    const doc = $('docmodModalCertDocumento')?.value?.trim();
    const motivo = $('docmodModalCertMotivo')?.value?.trim();
    const fi = $('docmodModalCertFechaIngreso')?.value;
    const hi = $('docmodModalCertHoraIngreso')?.value;
    const fe = $('docmodModalCertFechaEgreso')?.value;
    const he = $('docmodModalCertHoraEgreso')?.value;
    const func = $('docmodModalCertFuncionario')?.value?.trim();
    const cargo = $('docmodModalCertCargo')?.value?.trim();
    if (!nombre) return 'El nombre del paciente es obligatorio';
    if (!doc) return 'El número de identificación es obligatorio';
    if (!motivo) return 'El motivo / servicio es obligatorio';
    if (!fi || !hi || !fe || !he) return 'Complete las fechas y horas de ingreso y egreso';
    if (!func || !cargo) return 'Complete funcionario y cargo';
    return null;
  }

  function validarModalComprobante() {
    const fecha = $('docmodModalCompFecha')?.value;
    const nombre = $('docmodModalCompNombre')?.value?.trim();
    const doc = $('docmodModalCompDocumento')?.value?.trim();
    const fn = $('docmodModalCompFechaNac')?.value;
    const dir = $('docmodModalCompDireccion')?.value?.trim();
    const tel = $('docmodModalCompTelefono')?.value?.trim();
    const correo = $('docmodModalCompCorreo')?.value?.trim();
    const afil = $('docmodModalCompAfiliacion')?.value?.trim();
    const servicio = $('docmodModalCompServicio')?.value?.trim();
    if (!fecha) return 'La fecha es obligatoria';
    if (!nombre) return 'El campo Yo (nombre) es obligatorio';
    if (!doc) return 'El número de identificación es obligatorio';
    if (!fn) return 'La fecha de nacimiento es obligatoria';
    if (!dir) return 'La dirección es obligatoria';
    if (!tel) return 'El teléfono es obligatorio';
    if (!correo) return 'El correo es obligatorio';
    if (!afil) return 'El tipo de afiliación es obligatorio';
    if (!servicio) return 'El motivo / servicio es obligatorio';
    if (!firmaPacienteDataUrl && !$('docmodModalCompFirma')?.files?.[0]) {
      return 'Debe cargar la firma del paciente (imagen)';
    }
    return null;
  }

  function buildCertificadoPayload() {
    return {
      origen: state.origen,
      paciente_nombre: $('docmodModalCertNombre')?.value?.trim(),
      paciente_documento: $('docmodModalCertDocumento')?.value?.trim(),
      tipo_documento: leerTipoIdRadio('docmodModalCertTipoId'),
      motivo: $('docmodModalCertMotivo')?.value?.trim(),
      fecha_ingreso: $('docmodModalCertFechaIngreso')?.value,
      hora_ingreso: $('docmodModalCertHoraIngreso')?.value,
      fecha_egreso: $('docmodModalCertFechaEgreso')?.value,
      hora_egreso: $('docmodModalCertHoraEgreso')?.value,
      funcionario_nombre: $('docmodModalCertFuncionario')?.value?.trim(),
      funcionario_cargo: $('docmodModalCertCargo')?.value?.trim()
    };
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

  async function buildComprobantePayload() {
    const filePac = $('docmodModalCompFirma')?.files?.[0];
    if (filePac) firmaPacienteDataUrl = await readFileAsDataUrl(filePac);
    return {
      origen: state.origen,
      fecha: $('docmodModalCompFecha')?.value,
      paciente_nombre: $('docmodModalCompNombre')?.value?.trim(),
      tipo_documento: leerTipoIdRadio('docmodModalCompTipoId'),
      paciente_documento: $('docmodModalCompDocumento')?.value?.trim(),
      fecha_nacimiento: $('docmodModalCompFechaNac')?.value,
      direccion: $('docmodModalCompDireccion')?.value?.trim(),
      telefono: $('docmodModalCompTelefono')?.value?.trim(),
      correo: $('docmodModalCompCorreo')?.value?.trim(),
      tipo_afiliacion: $('docmodModalCompAfiliacion')?.value?.trim(),
      servicio: $('docmodModalCompServicio')?.value?.trim(),
      firma_paciente: firmaPacienteDataUrl
    };
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
    if (!res.ok) throw new Error(data.error || 'Error generando el documento');
    return data;
  }

  async function generarPdfDesdePreview(preview) {
    const PDF = window.innarDocumentoPdf;
    if (!PDF) throw new Error('Generador PDF no disponible');
    return PDF.generarPdfDesdeHtml(preview.html, preview.filename);
  }

  async function confirmarModal() {
    const err = state.tipo === 'certificado'
      ? validarModalCertificado()
      : validarModalComprobante();
    if (err) {
      setModalError(err);
      return;
    }

    const btn = $('btnConfirmarModalDocumentosCita');
    if (btn) btn.disabled = true;
    setModalError('Generando PDF…');

    try {
      const payload = state.tipo === 'comprobante'
        ? await buildComprobantePayload()
        : buildCertificadoPayload();
      const preview = await fetchPreview(payload);
      const modoPdf = await generarPdfDesdePreview(preview);

      if (state.tipo === 'certificado') {
        try {
          localStorage.setItem('innar.certAsistencia.defaults', JSON.stringify({
            funcionario_nombre: payload.funcionario_nombre || '',
            funcionario_cargo: payload.funcionario_cargo || ''
          }));
        } catch (_) { /* ignore */ }
      }

      toast(
        modoPdf === 'impresion'
          ? 'Se abrió la vista de impresión. Use «Guardar como PDF».'
          : 'PDF generado correctamente',
        modoPdf === 'impresion' ? 'info' : 'success'
      );
      cerrarModal();
      setStatus('');
    } catch (e) {
      setModalError(e.message || 'Error generando el PDF');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function bindUi() {
    if (bound) return;
    bound = true;

    document.querySelectorAll('[data-docmod-tipo]').forEach((btn) => {
      btn.addEventListener('click', () => seleccionarTipo(btn.dataset.docmodTipo));
    });
    document.querySelectorAll('[data-docmod-origen]').forEach((btn) => {
      btn.addEventListener('click', () => seleccionarOrigen(btn.dataset.docmodOrigen));
    });

    $('btnDocmodGenerar')?.addEventListener('click', () => iniciarGeneracion());
    $('docmodDocumento')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        iniciarGeneracion();
      }
    });

    $('btnConfirmarModalDocumentosCita')?.addEventListener('click', () => confirmarModal());
    $('btnCancelarModalDocumentosCita')?.addEventListener('click', cerrarModal);
    $('btnCerrarModalDocumentosCita')?.addEventListener('click', cerrarModal);
    $('modalDocumentosCita')?.addEventListener('click', (e) => {
      if (e.target?.id === 'modalDocumentosCita') cerrarModal();
    });
  }

  async function initDocumentosCitaModule() {
    bindUi();
    sincronizarUiSeleccion();
  }

  window.initDocumentosCitaModule = initDocumentosCitaModule;
})();
