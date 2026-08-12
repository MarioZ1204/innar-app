/**
 * Firmas del comprobante: paciente, acudiente, selector y quitar imagen.
 */
(function (root) {
  'use strict';

  const instancias = new Map();

  function $(id) { return document.getElementById(id); }

  function leerArchivo(file) {
    return new Promise((resolve, reject) => {
      if (!file) { resolve(''); return; }
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('No se pudo leer la imagen'));
      reader.readAsDataURL(file);
    });
  }

  function mostrarPreview(imgId, dataUrl) {
    const img = $(imgId);
    if (!img) return;
    if (dataUrl) {
      img.src = dataUrl;
      img.style.display = 'block';
    } else {
      img.removeAttribute('src');
      img.style.display = 'none';
    }
  }

  function init(config) {
    const prefix = config.prefix;
    if (!prefix || instancias.has(prefix)) return instancias.get(prefix);

    const ids = {
      firmaPacInput: config.firmaPacInput || `${prefix}FirmaPaciente`,
      firmaPacPreview: config.firmaPacPreview || `${prefix}FirmaPreview`,
      btnQuitarPac: config.btnQuitarPaciente || `btn${prefix}QuitarFirmaPaciente`,
      chkAcud: `${prefix}MostrarAcudiente`,
      panelAcud: `${prefix}AcudientePanel`,
      acudNombre: `${prefix}AcudienteNombre`,
      acudParentesco: `${prefix}Parentesco`,
      firmaAcudInput: `${prefix}FirmaAcudiente`,
      firmaAcudPreview: `${prefix}FirmaAcudPreview`,
      btnQuitarAcud: config.btnQuitarAcudiente || `btn${prefix}QuitarFirmaAcudiente`,
      rowFirmaUsar: `${prefix}FirmaUsarRow`,
      radioName: `${prefix}FirmaUsar`
    };

    const state = { prefix, ids, firmaPaciente: '', firmaAcudiente: '' };
    instancias.set(prefix, state);

    function actualizarFirmaUsarRow() {
      const row = $(ids.rowFirmaUsar);
      if (!row) return;
      row.classList.add('hidden');
      row.style.display = 'none';
    }

    function quitarFirmaPaciente() {
      state.firmaPaciente = '';
      const inp = $(ids.firmaPacInput);
      if (inp) inp.value = '';
      mostrarPreview(ids.firmaPacPreview, '');
      actualizarFirmaUsarRow();
    }

    function quitarFirmaAcudiente() {
      state.firmaAcudiente = '';
      const inp = $(ids.firmaAcudInput);
      if (inp) inp.value = '';
      mostrarPreview(ids.firmaAcudPreview, '');
      actualizarFirmaUsarRow();
    }

    $(ids.firmaPacInput)?.addEventListener('change', async (e) => {
      try {
        state.firmaPaciente = await leerArchivo(e.target.files?.[0]);
        mostrarPreview(ids.firmaPacPreview, state.firmaPaciente);
        actualizarFirmaUsarRow();
      } catch (err) {
        if (typeof showToast === 'function') showToast(err.message || 'Error leyendo firma', 'error');
      }
    });

    $(ids.firmaAcudInput)?.addEventListener('change', async (e) => {
      try {
        state.firmaAcudiente = await leerArchivo(e.target.files?.[0]);
        mostrarPreview(ids.firmaAcudPreview, state.firmaAcudiente);
        actualizarFirmaUsarRow();
      } catch (err) {
        if (typeof showToast === 'function') showToast(err.message || 'Error leyendo firma acudiente', 'error');
      }
    });

    $(ids.btnQuitarPac)?.addEventListener('click', quitarFirmaPaciente);
    $(ids.btnQuitarAcud)?.addEventListener('click', quitarFirmaAcudiente);
    $(ids.chkAcud)?.addEventListener('change', (e) => {
      const panel = $(ids.panelAcud);
      if (panel) panel.style.display = e.target.checked ? 'block' : 'none';
      actualizarFirmaUsarRow();
    });

    state.reset = () => {
      state.firmaPaciente = '';
      state.firmaAcudiente = '';
      quitarFirmaPaciente();
      quitarFirmaAcudiente();
      const chk = $(ids.chkAcud);
      if (chk) chk.checked = false;
      const panel = $(ids.panelAcud);
      if (panel) panel.style.display = 'none';
      const radioPac = document.querySelector(`input[name="${ids.radioName}"][value="paciente"]`);
      if (radioPac) radioPac.checked = true;
      actualizarFirmaUsarRow();
    };

    state.setFirmaPaciente = (dataUrl) => {
      state.firmaPaciente = String(dataUrl || '').trim();
      mostrarPreview(ids.firmaPacPreview, state.firmaPaciente);
      actualizarFirmaUsarRow();
    };

    state.leerFirmaUsar = () => {
      const checked = document.querySelector(`input[name="${ids.radioName}"]:checked`);
      return checked?.value === 'acudiente' ? 'acudiente' : 'paciente';
    };

    state.validar = () => {
      if (!state.firmaPaciente) {
        return 'Debe cargar la firma del paciente (imagen)';
      }
      return null;
    };

    state.buildPayloadExtras = async () => {
      const inpPac = $(ids.firmaPacInput);
      if (inpPac?.files?.[0]) {
        state.firmaPaciente = await leerArchivo(inpPac.files[0]);
      }
      const inpAcud = $(ids.firmaAcudInput);
      if (inpAcud?.files?.[0]) {
        state.firmaAcudiente = await leerArchivo(inpAcud.files[0]);
      }
      const payload = {
        firma_paciente: state.firmaPaciente
      };
      if ($(ids.chkAcud)?.checked) {
        payload.acudiente_nombre = $(ids.acudNombre)?.value?.trim() || '';
        payload.parentesco = $(ids.acudParentesco)?.value?.trim() || '';
        if (state.firmaAcudiente) payload.firma_acudiente = state.firmaAcudiente;
      }
      return payload;
    };

    actualizarFirmaUsarRow();
    return state;
  }

  root.innarComprobanteFirma = { init, get: (prefix) => instancias.get(prefix) };
})(typeof window !== 'undefined' ? window : globalThis);
