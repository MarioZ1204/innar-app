/**
 * Enviar comprobante PDF generado a una carpeta de Cargar Reportes (PDX).
 * Solo carpetas de comprobantes (electro / consultas médicas).
 */
(function (root) {
  'use strict';

  const TEMAS_COMPROBANTE = new Set(['comprobantes', 'comprobantes_consulta_medica']);
  const LABEL_TEMA = {
    comprobantes: 'Comprobantes Electrodiagnóstico',
    comprobantes_consulta_medica: 'Comprobantes Consultas Médicas'
  };

  function normNombre(s) {
    return String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  /** Misma lógica que utils/soportes-temas (no confiar solo en color_tema de BD). */
  function detectarTemaComprobante(nombreDisplay) {
    const u = normNombre(nombreDisplay);
    const consultasMed = /\bconsultas?\s+medicas?\b/.test(u)
      || (u.includes('consulta') && u.includes('medica'));
    if (consultasMed && /\bcomprobante/.test(u)) return 'comprobantes_consulta_medica';
    if (/\bcomprobante/.test(u)) return 'comprobantes';
    return '';
  }

  function temaDeCarpeta(c) {
    return detectarTemaComprobante(c?.nombre_display)
      || (TEMAS_COMPROBANTE.has(c?.color_tema) ? c.color_tema : '');
  }

  function splitNombrePdx(nombreCompleto) {
    const parts = String(nombreCompleto || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return { apellidos: 'SIN', nombres: 'NOMBRE' };
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
    return (data.carpetas || [])
      .map((c) => ({ ...c, color_tema: temaDeCarpeta(c) || c.color_tema }))
      .filter((c) => TEMAS_COMPROBANTE.has(c.color_tema))
      .sort((a, b) => {
        const oa = a.color_tema === 'comprobantes' ? 0 : 1;
        const ob = b.color_tema === 'comprobantes' ? 0 : 1;
        if (oa !== ob) return oa - ob;
        return String(a.periodo || '').localeCompare(String(b.periodo || ''));
      });
  }

  async function poblarSelect(selectEl, selectedId, opts = {}) {
    if (!selectEl) return [];
    const preferTema = opts.preferTema
      || (opts.origen === 'medica'
        ? 'comprobantes_consulta_medica'
        : (opts.origen === 'electro' ? 'comprobantes' : ''));
    selectEl.innerHTML = '<option value="">— Seleccione carpeta —</option>';
    try {
      const carpetas = await cargarCarpetasComprobante();
      carpetas.forEach((c) => {
        const opt = document.createElement('option');
        opt.value = String(c.id);
        const tema = c.color_tema || '';
        const temaLabel = LABEL_TEMA[tema] || c.nombre_display || tema;
        opt.textContent = `${temaLabel} · ${c.periodo}${c.nombre_display && c.nombre_display !== temaLabel ? ` (${c.nombre_display})` : ''}`;
        opt.dataset.tema = tema;
        opt.dataset.nombre = c.nombre_display || '';
        selectEl.appendChild(opt);
      });
      if (selectedId) {
        selectEl.value = String(selectedId);
      } else if (preferTema) {
        const match = carpetas.find((c) => c.color_tema === preferTema);
        if (match) selectEl.value = String(match.id);
      }
      return carpetas;
    } catch (e) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = e.message || 'Sin acceso a carpetas PDX';
      selectEl.appendChild(opt);
      return [];
    }
  }

  async function enviarPdf(carpetaId, pdfBlob, meta = {}) {
    if (!carpetaId) throw new Error('Seleccione la carpeta de Cargar Reportes');
    if (!pdfBlob || !pdfBlob.size) {
      throw new Error('No hay PDF para enviar a Cargar Reportes (el documento no se generó como archivo)');
    }

    const tema = String(meta.tema || '').trim();
    const fd = new FormData();
    const filename = meta.filename || `comprobante_${meta.paciente_documento || 'paciente'}.pdf`;
    fd.append('file', pdfBlob, filename);
    fd.append('confirmacion_manual', '1');
    fd.append('fecha_estudio', meta.fecha || meta.fecha_estudio || '');

    if (tema === 'comprobantes_consulta_medica') {
      // Formato consultas médicas: nombre completo + especialidad + tipo de consulta
      fd.append('paciente_nombre_completo', meta.paciente_nombre || '');
      fd.append(
        'estudio_texto',
        meta.especialidad || meta.estudio_texto || 'Consulta médica'
      );
      fd.append(
        'tipo_consulta',
        meta.tipo_consulta || meta.servicio || 'Consulta'
      );
    } else {
      // Formato electro / comprobantes con documento
      fd.append('tipo_documento', meta.tipo_documento || 'CC');
      fd.append('paciente_documento', meta.paciente_documento || '');
      fd.append('estudio_texto', meta.servicio || meta.estudio_texto || '');
      const { apellidos, nombres } = splitNombrePdx(meta.paciente_nombre);
      fd.append('apellidos', apellidos);
      fd.append('nombres', nombres);
    }

    const res = await apiFetch(`/api/soportes/pdx/carpetas/${carpetaId}/archivos`, {
      method: 'POST',
      body: fd
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || data.detail || 'Error al enviar a Cargar Reportes');
    }
    return data;
  }

  function bindEnviarPdx(chkId, selId, getOrigen) {
    const chk = document.getElementById(chkId);
    const sel = document.getElementById(selId);
    if (!chk || !sel) return;
    chk.addEventListener('change', () => {
      sel.disabled = !chk.checked;
      if (chk.checked) {
        const origen = typeof getOrigen === 'function' ? getOrigen() : null;
        poblarSelect(sel, sel.value || '', { origen });
      }
    });
  }

  root.innarComprobantePdx = {
    TEMAS_COMPROBANTE,
    LABEL_TEMA,
    detectarTemaComprobante,
    cargarCarpetasComprobante,
    poblarSelect,
    enviarPdf,
    splitNombrePdx,
    bindEnviarPdx
  };
})(typeof window !== 'undefined' ? window : globalThis);
