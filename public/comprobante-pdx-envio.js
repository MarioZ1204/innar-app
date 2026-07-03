/**
 * Enviar comprobante PDF generado a una carpeta de Cargar Reportes (PDX).
 */
(function (root) {
  'use strict';

  const TEMAS_COMPROBANTE = new Set(['comprobantes', 'comprobantes_consulta_medica']);

  function splitNombrePdx(nombreCompleto) {
    const parts = String(nombreCompleto || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return { apellidos: 'SIN', nombres: 'APELLIDO' };
    if (parts.length === 1) return { apellidos: parts[0], nombres: parts[0] };
    if (parts.length === 2) return { apellidos: parts[0], nombres: parts[1] };
    return {
      apellidos: parts.slice(0, -2).join(' '),
      nombres: parts.slice(-2).join(' ')
    };
  }

  async function cargarCarpetasComprobante() {
    if (typeof apiFetch !== 'function') return [];
    const res = await apiFetch('/api/soportes/pdx/carpetas');
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'No se pudieron cargar carpetas');
    return (data.carpetas || []).filter((c) => TEMAS_COMPROBANTE.has(c.color_tema));
  }

  async function poblarSelect(selectEl, selectedId) {
    if (!selectEl) return;
    selectEl.innerHTML = '<option value="">— Seleccione carpeta —</option>';
    try {
      const carpetas = await cargarCarpetasComprobante();
      carpetas.forEach((c) => {
        const opt = document.createElement('option');
        opt.value = String(c.id);
        opt.textContent = `${c.nombre_display} (${c.periodo})`;
        opt.dataset.tema = c.color_tema || '';
        selectEl.appendChild(opt);
      });
      if (selectedId) selectEl.value = String(selectedId);
    } catch (e) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'Sin acceso a carpetas PDX';
      selectEl.appendChild(opt);
    }
  }

  async function enviarPdf(carpetaId, pdfBlob, meta) {
    if (!carpetaId || !pdfBlob?.size) return null;
    const fd = new FormData();
    const filename = meta.filename || `comprobante_${meta.paciente_documento || 'paciente'}.pdf`;
    fd.append('file', pdfBlob, filename);
    fd.append('confirmacion_manual', '1');
    fd.append('tipo_documento', meta.tipo_documento || 'CC');
    fd.append('paciente_documento', meta.paciente_documento || '');
    fd.append('fecha_estudio', meta.fecha || '');
    fd.append('estudio_texto', meta.servicio || meta.estudio_texto || '');

    if (meta.origen === 'medica' && meta.tema === 'comprobantes_consulta_medica') {
      fd.append('paciente_nombre_completo', meta.paciente_nombre || '');
    } else {
      const { apellidos, nombres } = splitNombrePdx(meta.paciente_nombre);
      fd.append('apellidos', apellidos);
      fd.append('nombres', nombres);
    }

    const res = await apiFetch(`/api/soportes/pdx/carpetas/${carpetaId}/archivos`, {
      method: 'POST',
      body: fd
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Error al enviar a Cargar Reportes');
    return data;
  }

  function bindEnviarPdx(chkId, selId) {
    const chk = document.getElementById(chkId);
    const sel = document.getElementById(selId);
    if (!chk || !sel) return;
    chk.addEventListener('change', () => {
      sel.disabled = !chk.checked;
      if (chk.checked && sel.options.length <= 1) {
        poblarSelect(sel);
      }
    });
  }

  root.innarComprobantePdx = {
    cargarCarpetasComprobante,
    poblarSelect,
    enviarPdf,
    splitNombrePdx,
    bindEnviarPdx
  };
})(typeof window !== 'undefined' ? window : globalThis);
