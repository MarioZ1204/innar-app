/**
 * Módulo integrado: certificados y comprobantes FOMAG.
 * Flujo: tipo → origen → documento → Generar → modal → Confirmar → PDF.
 */
(function () {
  'use strict';

  let bound = false;
  let _docmodFirmaUi = null;

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

  function setModalError(msg, isInfo) {
    const el = $('docmodModalError');
    if (!el) return;
    el.textContent = msg || '';
    el.classList.toggle('is-info', !!isInfo && !!msg);
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

  function datosDesdePersona(persona, documento) {
    const doc = String(persona?.numero_documento || documento || '').trim();
    const nombre = nombreDesdePersona(persona);
    const afilAnexo = String(persona?.afiliacion || '').trim();
    const mapAfil = window.innarAfiliacionComprobante?.mapearAfiliacionParaComprobante;
    return {
      paciente_nombre: nombre,
      tipo_documento: String(persona?.tipo_documento || 'CC').trim() || 'CC',
      paciente_documento: doc,
      fecha_nacimiento: String(persona?.fecha_nacimiento || '').trim(),
      direccion: String(persona?.direccion || '').trim(),
      telefono: String(persona?.telefono || '').trim(),
      correo: String(persona?.correo || '').trim(),
      tipo_afiliacion: mapAfil
        ? mapAfil(afilAnexo || 'COTIZANTE')
        : (afilAnexo || 'COTIZANTE'),
      afiliacion_anexo: afilAnexo,
      firma_paciente: String(persona?.firma_paciente || '').trim(),
      firma_acudiente: String(persona?.firma_acudiente || '').trim(),
      acudiente_nombre: String(persona?.acudiente_nombre || '').trim(),
      parentesco: String(persona?.parentesco || '').trim()
    };
  }

  function mostrarFirmaPreview(dataUrl) {
    _docmodFirmaUi?.setFirmaPaciente?.(dataUrl);
  }

  function refrescarCombosServicio() {
    window.innarServicioCombo?.setOrigen?.('docmodModalCompServicio', state.origen);
    window.innarServicioCombo?.setOrigen?.('docmodModalCertMotivo', state.origen);
  }

  async function guardarPersonaDesdeModal(tipo, payload) {
    const PF = window.innarPersonaFidu;
    if (!PF || !payload?.paciente_documento) return;
    try {
      if (tipo === 'comprobante' && PF.guardarDesdeComprobanteModal) {
        await PF.guardarDesdeComprobanteModal(payload, 'comprobante');
      } else if (tipo === 'certificado' && PF.guardarDesdeCertificadoModal) {
        await PF.guardarDesdeCertificadoModal(payload, 'certificado');
      }
    } catch (_) {
      toast('PDF generado, pero no se pudo actualizar la base de pacientes', 'warning');
    }
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
        : 'Paso 1: elija certificado o comprobante';
      tipoEl.classList.toggle('is-selected', !!state.tipo);
    }
    if (origenEl) {
      origenEl.textContent = state.origen
        ? `Seleccionado: ${LABEL_ORIGEN[state.origen] || state.origen}`
        : 'Paso 2: elija agenda médica o electro';
      origenEl.classList.toggle('is-selected', !!state.origen);
    }
    actualizarPasosWizard();
    actualizarSummaryChip();
  }

  function actualizarPasosWizard() {
    const s1 = $('docmodStep1');
    const s2 = $('docmodStep2');
    const s3 = $('docmodStep3');
    const pacienteCard = $('docmodPacienteCard');
    const btnGen = $('btnDocmodGenerar');
    const docInput = $('docmodDocumento');

    if (s1) {
      s1.classList.toggle('is-done', !!state.tipo);
      s1.classList.toggle('is-active', !state.tipo);
    }
    if (s2) {
      s2.classList.toggle('is-done', !!state.origen);
      s2.classList.toggle('is-active', !!state.tipo && !state.origen);
      s2.classList.toggle('is-disabled', !state.tipo);
    }
    if (s3) {
      s3.classList.toggle('is-active', !!state.tipo && !!state.origen);
      s3.classList.toggle('is-done', false);
    }

    const listo = !!(state.tipo && state.origen);
    pacienteCard?.classList.toggle('docmod-panel--locked', !listo);
    if (btnGen) btnGen.disabled = !listo;
    if (docInput) docInput.disabled = !listo;
  }

  function actualizarSummaryChip() {
    const chip = $('docmodSummaryChip');
    if (!chip) return;
    if (!state.tipo) {
      chip.textContent = 'Complete los pasos para continuar';
      chip.classList.remove('is-ready');
      return;
    }
    const tipo = LABEL_TIPO[state.tipo] || state.tipo;
    if (!state.origen) {
      chip.textContent = `${tipo} · falta origen`;
      chip.classList.remove('is-ready');
      return;
    }
    const origen = LABEL_ORIGEN[state.origen] || state.origen;
    chip.textContent = `${tipo} · ${origen}`;
    chip.classList.add('is-ready');
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
    actualizarResumenesSeleccion();
    refrescarCombosServicio();
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
    document.body.style.overflow = 'hidden';
  }

  function cerrarModal() {
    const modal = $('modalDocumentosCita');
    if (!modal) return;
    modal.classList.add('hidden');
    document.body.style.overflow = '';
    setModalError('');
    _docmodFirmaUi?.reset?.();
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
    if (window.innarServicioCombo?.setValor) {
      window.innarServicioCombo.setValor('docmodModalCertMotivo', extras?.motivo || defs.motivo);
    } else {
      $('docmodModalCertMotivo').value = String(extras?.motivo || defs.motivo || '').toLocaleUpperCase('es-CO');
    }
    $('docmodModalCertFechaIngreso').value = extras?.fecha_ingreso || defs.fecha_ingreso;
    $('docmodModalCertHoraIngreso').value = extras?.hora_ingreso || defs.hora_ingreso;
    $('docmodModalCertFechaEgreso').value = extras?.fecha_egreso || defs.fecha_egreso;
    $('docmodModalCertHoraEgreso').value = extras?.hora_egreso || defs.hora_egreso;
    $('docmodModalCertFuncionario').value = extras?.funcionario_nombre || defs.funcionario_nombre;
    $('docmodModalCertCargo').value = extras?.funcionario_cargo || defs.funcionario_cargo;
    syncCertObservacionesUi({
      incluir: !!(extras?.incluir_observaciones || extras?.observaciones),
      texto: extras?.observaciones || ''
    });
  }

  function syncCertObservacionesUi(opts = {}) {
    const chk = $('docmodModalCertIncluirObs');
    const wrap = $('docmodModalCertObsWrap');
    const ta = $('docmodModalCertObservaciones');
    if (chk) chk.checked = !!opts.incluir;
    if (ta && opts.texto != null) ta.value = String(opts.texto || '');
    if (wrap) wrap.classList.toggle('hidden', !chk?.checked);
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
    if (window.innarAfiliacionComprobante?.setValor) {
      window.innarAfiliacionComprobante.setValor(
        'docmodModalCompAfiliacion',
        datos.tipo_afiliacion || extras?.tipo_afiliacion,
        datos.afiliacion_anexo || extras?.afiliacion_anexo || ''
      );
    } else {
      $('docmodModalCompAfiliacion').value = datos.tipo_afiliacion || extras?.tipo_afiliacion || 'COTIZANTE';
    }
    if (window.innarServicioCombo?.setValor) {
      window.innarServicioCombo.setValor('docmodModalCompServicio', extras?.servicio || '');
    } else {
      $('docmodModalCompServicio').value = String(extras?.servicio || '').toLocaleUpperCase('es-CO');
    }
    _docmodFirmaUi?.reset?.();
    _docmodFirmaUi?.setFirmaPaciente?.(String(datos.firma_paciente || extras?.firma_paciente || '').trim());
    _docmodFirmaUi?.setAcudienteDatos?.({
      nombre: datos.acudiente_nombre || extras?.acudiente_nombre,
      parentesco: datos.parentesco || extras?.parentesco,
      firma: datos.firma_acudiente || extras?.firma_acudiente
    });
    const chkPdx = $('docmodModalCompEnviarPdx');
    if (chkPdx) chkPdx.checked = false;
    const selPdx = $('docmodModalCompPdxCarpeta');
    if (selPdx) {
      selPdx.disabled = true;
      window.innarComprobantePdx?.poblarSelect?.(selPdx, null, { origen: state.origen });
    }
    refrescarCombosServicio();
  }

  function abrirModalConDatos(persona, extras) {
    const datos = datosDesdePersona(persona, state.documento);
    setModalError('');
    if (state.tipo === 'certificado') {
      llenarModalCertificado(datos, extras);
    } else {
      llenarModalComprobante(datos, extras);
    }
    window.innarPersonaFidu?.bindFechaInputs?.($('modalDocumentosCita'));
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
        const ctx = state.tipo === 'certificado' ? 'certificado' : 'comprobante';
        const data = await PF.fetchPersona(doc, ctx);
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
    const motivo = window.innarServicioCombo?.leerValor?.('docmodModalCertMotivo')
      || String($('docmodModalCertMotivo')?.value || '').trim().toLocaleUpperCase('es-CO');
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
    if ($('docmodModalCertIncluirObs')?.checked) {
      const obs = String($('docmodModalCertObservaciones')?.value || '').trim();
      if (!obs) return 'Escriba la observación o desmarque la opción';
    }
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
    const errFirma = _docmodFirmaUi?.validar?.();
    if (errFirma) return errFirma;
    return null;
  }

  function normFecha(val) {
    return window.innarPersonaFidu?.normalizarFecha?.(val) || String(val || '').trim();
  }

  function buildCertificadoPayload() {
    const incluirObs = !!$('docmodModalCertIncluirObs')?.checked;
    return {
      origen: state.origen,
      paciente_nombre: $('docmodModalCertNombre')?.value?.trim(),
      paciente_documento: $('docmodModalCertDocumento')?.value?.trim(),
      tipo_documento: leerTipoIdRadio('docmodModalCertTipoId'),
      motivo: window.innarServicioCombo?.leerValor?.('docmodModalCertMotivo')
        || String($('docmodModalCertMotivo')?.value || '').trim().toLocaleUpperCase('es-CO'),
      incluir_observaciones: incluirObs,
      observaciones: incluirObs ? String($('docmodModalCertObservaciones')?.value || '').trim() : '',
      fecha_ingreso: normFecha($('docmodModalCertFechaIngreso')?.value),
      hora_ingreso: $('docmodModalCertHoraIngreso')?.value,
      fecha_egreso: normFecha($('docmodModalCertFechaEgreso')?.value),
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
    const extras = await (_docmodFirmaUi?.buildPayloadExtras?.() || {});
    return {
      origen: state.origen,
      fecha: normFecha($('docmodModalCompFecha')?.value),
      paciente_nombre: $('docmodModalCompNombre')?.value?.trim(),
      tipo_documento: leerTipoIdRadio('docmodModalCompTipoId'),
      paciente_documento: $('docmodModalCompDocumento')?.value?.trim(),
      fecha_nacimiento: normFecha($('docmodModalCompFechaNac')?.value),
      direccion: $('docmodModalCompDireccion')?.value?.trim(),
      telefono: $('docmodModalCompTelefono')?.value?.trim(),
      correo: $('docmodModalCompCorreo')?.value?.trim(),
      tipo_afiliacion: window.innarAfiliacionComprobante?.leerValor?.('docmodModalCompAfiliacion')
        || $('docmodModalCompAfiliacion')?.value?.trim(),
      afiliacion_anexo: window.innarAfiliacionComprobante?.leerAnexoOriginal?.('docmodModalCompAfiliacion') || '',
      servicio: window.innarServicioCombo?.leerValor?.('docmodModalCompServicio')
        || String($('docmodModalCompServicio')?.value || '').trim().toLocaleUpperCase('es-CO'),
      ...extras
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

    if (typeof tienePermiso === 'function' && !tienePermiso('modulo.documentos_cita')) {
      toast('No tienes permiso para generar este documento', 'error');
      return;
    }

    const btn = $('btnConfirmarModalDocumentosCita');
    if (btn) btn.disabled = true;
    setModalError('Generando documento…', true);
    let enviadoPdx = false;

    try {
      let payload = state.tipo === 'comprobante'
        ? await buildComprobantePayload()
        : buildCertificadoPayload();
      if (state.tipo === 'comprobante' && window.innarFirmaFondo?.procesarPayloadComprobante) {
        payload = await window.innarFirmaFondo.procesarPayloadComprobante(payload);
      }
      const PDF = window.innarDocumentoPdf;
      if (!PDF) throw new Error('Generador PDF no disponible');
      const doc = payload.paciente_documento?.replace(/\D/g, '') || 'sin_doc';
      const filename = state.tipo === 'comprobante'
        ? `comprobante_servicios_${doc}.pdf`
        : `certificado_asistencia_${doc}.pdf`;

      const enviarPdx = state.tipo === 'comprobante' && !!$('docmodModalCompEnviarPdx')?.checked;
      const carpetaId = enviarPdx ? $('docmodModalCompPdxCarpeta')?.value : '';
      if (enviarPdx && !carpetaId) {
        throw new Error('Seleccione la carpeta de Cargar Reportes');
      }

      let out = { blob: null, modo: 'impresion', filename };
      if (state.tipo === 'comprobante') {
        out = await PDF.generarDocumentoConBlob({
          postUrl: '/api/certificados/comprobante-servicios',
          previewUrl: '/api/certificados/comprobante-servicios/preview',
          payload,
          filename
        });
      } else {
        out = await PDF.generarDocumentoConBlob({
          postUrl: '/api/certificados/asistencia',
          previewUrl: '/api/certificados/asistencia/preview',
          payload,
          filename
        });
      }

      if (enviarPdx && (!out.blob || !out.blob.size)) {
        throw new Error(
          'No se pudo generar el PDF en el servidor para enviarlo a Cargar Reportes. Intente de nuevo.'
        );
      }

      if (out.blob) PDF.descargarBlob(out.blob, out.filename || filename);

      if (carpetaId && out.blob) {
        const opt = $('docmodModalCompPdxCarpeta')?.selectedOptions?.[0];
        try {
          await window.innarComprobantePdx.enviarPdf(carpetaId, out.blob, {
            ...payload,
            filename: out.filename || filename,
            tema: opt?.dataset?.tema || ''
          });
          enviadoPdx = true;
        } catch (ePdx) {
          if (ePdx?.code === 'PDX_CANCELADO') {
            toast('Documento generado (envío a Cargar Reportes cancelado)', 'info');
            await guardarPersonaDesdeModal(state.tipo, payload);
            cerrarModal();
            setStatus('');
            return;
          }
          throw ePdx;
        }
      } else if (enviarPdx) {
        throw new Error('No se generó un PDF para enviar a Cargar Reportes');
      }

      const modoPdf = out.modo;

      if (state.tipo === 'certificado') {
        try {
          localStorage.setItem('innar.certAsistencia.defaults', JSON.stringify({
            funcionario_nombre: payload.funcionario_nombre || '',
            funcionario_cargo: payload.funcionario_cargo || ''
          }));
        } catch (_) { /* ignore */ }
      }

      await guardarPersonaDesdeModal(state.tipo, payload);

      const msgPdx = enviadoPdx ? ' y enviado a Cargar Reportes' : '';
      toast(
        modoPdf === 'impresion'
          ? 'Se abrió la vista de impresión. Use «Guardar como PDF».'
          : `${state.tipo === 'comprobante' ? 'Comprobante' : 'Certificado'} generado${msgPdx}`,
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
    $('docmodModalCertIncluirObs')?.addEventListener('change', () => {
      syncCertObservacionesUi({ incluir: !!$('docmodModalCertIncluirObs')?.checked });
      if ($('docmodModalCertIncluirObs')?.checked) {
        $('docmodModalCertObservaciones')?.focus();
      }
    });
    $('modalDocumentosCita')?.addEventListener('click', (e) => {
      if (e.target?.id === 'modalDocumentosCita') cerrarModal();
    });
  }

  async function initDocumentosCitaModule() {
    bindUi();
    window.innarAfiliacionComprobante?.init?.('docmodModalCompAfiliacion');
    window.innarServicioCombo?.init?.('docmodModalCompServicio', {
      getOrigen: () => state.origen,
      uso: 'comprobante'
    });
    window.innarServicioCombo?.init?.('docmodModalCertMotivo', {
      getOrigen: () => state.origen
    });
    _docmodFirmaUi = window.innarComprobanteFirma?.init?.({
      prefix: 'docmodModalComp',
      btnQuitarPaciente: 'btnDocmodQuitarFirmaPaciente',
      btnQuitarAcudiente: 'btnDocmodQuitarFirmaAcudiente'
    });
    const puedePdx = typeof tienePermiso !== 'function' || tienePermiso('soportes.pdx.ver');
    if (puedePdx) {
      window.innarComprobantePdx?.poblarSelect?.($('docmodModalCompPdxCarpeta'), null, {
        origen: state.origen
      });
      window.innarComprobantePdx?.bindEnviarPdx?.(
        'docmodModalCompEnviarPdx',
        'docmodModalCompPdxCarpeta',
        () => state.origen
      );
    }
    sincronizarUiSeleccion();
  }

  window.initDocumentosCitaModule = initDocumentosCitaModule;
})();
