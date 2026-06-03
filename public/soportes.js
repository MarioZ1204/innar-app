/**
 * Módulos Cargar reportes (PDX) y Armado de soportes — UI (Lucide + design system sop-*)
 */
(function () {
  'use strict';

  let initPdxDone = false;
  let initArmadoDone = false;
  let pdxState = {
    carpetas: [],
    carpetaId: null,
    carpetaActual: null,
    archivos: [],
    periodoActual: null,
    filtros: { texto: '', periodo: '', tema: '', orden: 'periodo_desc' }
  };

  const PDX_LOG_LABEL = {
    subida: 'Subida',
    edicion: 'Edición de metadatos',
    reemplazo: 'Reemplazo de PDF',
    movimiento: 'Movido de carpeta'
  };

  const RE_REPORTE_BASE_CLIENT = /^(.+?),\s*(.+?)\s+(\d{4}-\d{2}-\d{2})(?:\s+.+)?\.pdf$/i;
  const RE_PDX_EXT_CLIENT = /^(.+?),\s*(.+?)\s+(\d{4}-\d{2}-\d{2})\s+([\d-]+)\s+(\d+)\.\s*(.+?)\.pdf$/i;
  const SEP_CLIENT = '\\s*-\\s*';
  const RE_ORDEN_HC_CLIENT = new RegExp(
    `^ORDEN\\s*\\+\\s*HC${SEP_CLIENT}(.+?)${SEP_CLIENT}(.+?)${SEP_CLIENT}(.+?)${SEP_CLIENT}([\\d.\\-]+)${SEP_CLIENT}(\\d{4}-\\d{2}-\\d{2})${SEP_CLIENT}(.+?)\\.pdf$`,
    'i'
  );
  const RE_COMPROBANTE_CLIENT = new RegExp(
    `^COMPROBANTE${SEP_CLIENT}(.+?)${SEP_CLIENT}(.+?)${SEP_CLIENT}(.+?)${SEP_CLIENT}([\\d.\\-]+)${SEP_CLIENT}(\\d{4}-\\d{2}-\\d{2})${SEP_CLIENT}(.+?)\\.pdf$`,
    'i'
  );
  const RE_CONSENTIMIENTO_CLIENT = new RegExp(
    `^(.+?)${SEP_CLIENT}(.+?)${SEP_CLIENT}(.+?)${SEP_CLIENT}([\\d.\\-]+)${SEP_CLIENT}(\\d{4}-\\d{2}-\\d{2})${SEP_CLIENT}(.+?)\\.pdf$`,
    'i'
  );

  const FORMATOS_AYUDA_CLIENT = {
    vtm: {
      pattern: 'Apellidos, Nombres   YYYY-MM-DD.pdf',
      ejemplo: 'García López, Juan Carlos   2026-05-27.pdf',
      nota: 'Al descargar se añade el tipo de estudio (VTM) al nombre del archivo.'
    },
    eeg: {
      pattern: 'Apellidos, Nombres   YYYY-MM-DD.pdf',
      ejemplo: 'García López, Juan Carlos   2026-05-27.pdf',
      nota: 'Al descargar se añade el tipo de estudio (EEG) al nombre del archivo.'
    },
    psg: {
      pattern: 'Apellidos, Nombres   YYYY-MM-DD.pdf (también Apellidos - Nombres - YYYY-MM-DD.pdf)',
      ejemplo: 'García López, Juan Carlos   2026-05-27.pdf',
      nota: 'No incluya número de documento. Al descargar se añade el tipo de estudio PSG según la carpeta.'
    },
    actigrafia: {
      pattern: 'Apellidos, Nombres   YYYY-MM-DD.pdf',
      ejemplo: 'García López, Juan Carlos   2026-05-27.pdf',
      nota: 'Al descargar se añade el tipo de estudio al nombre del archivo.'
    },
    ordenes: {
      pattern: 'ORDEN + HC - APELLIDOS - NOMBRES - TIPO DE DOCUMENTO - DOCUMENTO - FECHA - TIPO DE ESTUDIO.pdf',
      ejemplo: 'ORDEN + HC - García López - Juan Carlos - CC - 1234567890 - 2026-05-27 - PSG Basal.pdf'
    },
    comprobantes: {
      pattern: 'COMPROBANTE - APELLIDOS - NOMBRES - TIPO DE DOCUMENTO - DOCUMENTO - FECHA - TIPO DE ESTUDIO.pdf',
      ejemplo: 'COMPROBANTE - García López - Juan Carlos - CC - 1234567890 - 2026-05-27 - PSG Basal.pdf'
    },
    consentimientos: {
      pattern: 'APELLIDOS - NOMBRES - TIPO DE DOCUMENTO - DOCUMENTO - FECHA - TIPO DE ESTUDIO.pdf',
      ejemplo: 'García López - Juan Carlos - CC - 1234567890 - 2026-05-27 - PSG Basal.pdf'
    },
    neutral: {
      pattern: 'Apellidos, Nombres   YYYY-MM-DD.pdf',
      ejemplo: 'García López, Juan Carlos   2026-05-27.pdf'
    }
  };

  function detectarTemaCarpetaCliente(nombreCarpeta) {
    const u = String(nombreCarpeta || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (/\bcomprobante/.test(u)) return 'comprobantes';
    if (/\bconsentimiento/.test(u)) return 'consentimientos';
    if (/\bordenes\b/.test(u)) return 'ordenes';
    if (/\bvtm\b/.test(u) || u.includes('videotelemetria') || u.includes('telemetria')) return 'vtm';
    if (u.includes('actigraf')) return 'actigrafia';
    if (u.includes('polisomnog') || /\bpsg\b/.test(u) || u.startsWith('psg ') || u.includes('cpap') || u.includes('bpap')) return 'psg';
    if (u.includes('electroencefalog') || (/\beeg\b/.test(u) && !u.includes('monitoriz'))) return 'eeg';
    return 'neutral';
  }

  function esCarpetaEstructuradaPdx(carpetaOrNombre) {
    const t = detectarTemaCarpetaCliente(typeof carpetaOrNombre === 'string' ? carpetaOrNombre : carpetaOrNombre?.nombre_display);
    return ['ordenes', 'comprobantes', 'consentimientos'].includes(t);
  }

  function esCarpetaPsgReportePdx(carpetaOrNombre) {
    return detectarTemaCarpetaCliente(typeof carpetaOrNombre === 'string' ? carpetaOrNombre : carpetaOrNombre?.nombre_display) === 'psg';
  }

  function splitSegmentosGuionesEspaciadosCliente(texto) {
    return String(texto || '').split(/\s+-\s+/).map((p) => p.trim()).filter(Boolean);
  }

  function esSegmentoDocumentoCliente(seg) {
    const d = String(seg || '').replace(/\s/g, '');
    return /^[\d.\-]{4,20}$/.test(d);
  }

  /** Partes del nombre con guiones (ordenes, comprobantes, consentimientos). */
  function splitPartesGuionesCliente(originalName) {
    const sinPdf = String(originalName || '').trim().replace(/\.pdf$/i, '');
    return splitSegmentosGuionesEspaciadosCliente(sinPdf);
  }

  function esCarpetaOrdenesPdx(carpetaOrNombre) {
    return detectarTemaCarpetaCliente(typeof carpetaOrNombre === 'string' ? carpetaOrNombre : carpetaOrNombre?.nombre_display) === 'ordenes';
  }

  function ayudaFormatoCliente(tema) {
    return FORMATOS_AYUDA_CLIENT[tema] || FORMATOS_AYUDA_CLIENT.neutral;
  }

  function mensajeErrorFormatoCliente(tema) {
    const ayuda = ayudaFormatoCliente(tema);
    return `El archivo no cumple la estructura requerida. Formato: ${ayuda.pattern}`;
  }

  const PSG_TIPOS_ESTUDIO_CLIENT = ['PSG Básica', 'PSG CPAP', 'PSG BPAP', 'PSG Basal'];

  function inferirEstudioCliente(carpeta) {
    const nombre = carpeta?.nombre_display || '';
    const tema = detectarTemaCarpetaCliente(nombre);
    if (tema === 'eeg') return 'EEG';
    if (tema === 'vtm') return 'VTM';
    if (tema === 'actigrafia') return 'Actigrafía';
    if (tema === 'psg') {
      const u = nombre.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (u.includes('cpap')) return 'PSG CPAP';
      if (u.includes('bpap')) return 'PSG BPAP';
      if (u.includes('basal') || u.includes('basica')) return 'PSG Basal';
      return 'PSG Básica';
    }
    return '';
  }

  function estudioPsgReconocidoCliente(texto) {
    if (!texto || !String(texto).trim()) return false;
    const u = String(texto).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return u.includes('cpap') || u.includes('bpap') || u.includes('basal') || u.includes('basica');
  }

  function extraerDatosParcialesCliente(originalName, carpeta) {
    const base = String(originalName || '').trim();
    const tema = detectarTemaCarpetaCliente(carpeta?.nombre_display || '');
    const parcial = {
      apellidos: '',
      nombres: '',
      tipo_documento: 'CC',
      paciente_documento: '',
      fecha_estudio: '',
      estudio_texto: ''
    };
    const fechaMatch = base.match(/(\d{4}-\d{2}-\d{2})/);
    if (fechaMatch) parcial.fecha_estudio = fechaMatch[1];

    const esReporte = ['vtm', 'eeg', 'psg', 'actigrafia', 'neutral'].includes(tema);
    if (esReporte) {
      const parsedTry = parseNombrePdxCliente(base);
      if (parsedTry.ok) {
        parcial.apellidos = parsedTry.apellidos;
        parcial.nombres = parsedTry.nombres;
        parcial.fecha_estudio = parsedTry.fecha_estudio;
        parcial.estudio_texto = parsedTry.estudio_texto;
      }
      if (tema === 'psg' && !estudioPsgReconocidoCliente(parcial.estudio_texto)) {
        parcial.estudio_texto = inferirEstudioCliente(carpeta);
      } else if (!parcial.estudio_texto && ['vtm', 'eeg', 'actigrafia'].includes(tema)) {
        parcial.estudio_texto = inferirEstudioCliente(carpeta);
      }
    } else if (esCarpetaEstructuradaPdx(carpeta)) {
      const parts = splitPartesGuionesCliente(base);
      let offset = 0;
      if (tema === 'ordenes' && parts[0] && /orden/i.test(parts[0])) offset = 1;
      if (tema === 'comprobantes' && parts[0] && /comprobante/i.test(parts[0])) offset = 1;
      if (parts.length > offset) parcial.apellidos = parts[offset] || '';
      if (parts.length > offset + 1) parcial.nombres = parts[offset + 1] || '';
      if (parts.length > offset + 2) parcial.tipo_documento = parts[offset + 2] || 'CC';
      if (parts.length > offset + 3) parcial.paciente_documento = String(parts[offset + 3] || '').replace(/\s/g, '');
      if (parts.length > offset + 4 && /^\d{4}-\d{2}-\d{2}$/.test(parts[offset + 4])) {
        parcial.fecha_estudio = parts[offset + 4];
      }
      const ultimo = parts[parts.length - 1];
      if (ultimo && !/^\d{4}-\d{2}-\d{2}$/.test(ultimo) && !/^(orden|comprobante)/i.test(ultimo)) {
        parcial.estudio_texto = ultimo;
      }
    }
    return parcial;
  }

  function analizarNombreArchivoCliente(originalName, carpeta) {
    const tema = detectarTemaCarpetaCliente(carpeta?.nombre_display || '');
    const parsed = parseNombrePorCarpetaCliente(originalName, carpeta);
    const parcial = extraerDatosParcialesCliente(originalName, carpeta);

    if (!parsed.ok) {
      return {
        ok: false,
        requiere_correccion: true,
        motivo: 'formato',
        error: parsed.error || mensajeErrorFormatoCliente(tema),
        tema,
        parcial
      };
    }
    if (tema === 'psg' && !estudioPsgReconocidoCliente(parsed.estudio_texto)) {
      const inferido = inferirEstudioCliente(carpeta);
      if (estudioPsgReconocidoCliente(inferido)) {
        parsed.estudio_texto = parsed.estudio_texto || inferido;
        return { ok: true, requiere_correccion: false, tema, parsed, parcial: parsed };
      }
      return {
        ok: false,
        requiere_correccion: true,
        motivo: 'falta_estudio_psg',
        error: 'No se pudo determinar el tipo de estudio PSG. Selecciónelo para continuar.',
        tema,
        parcial: {
          ...parcial,
          apellidos: parsed.apellidos || parcial.apellidos,
          nombres: parsed.nombres || parcial.nombres,
          fecha_estudio: parsed.fecha_estudio || parcial.fecha_estudio,
          estudio_texto: inferido || 'PSG Básica'
        }
      };
    }
    return { ok: true, requiere_correccion: false, tema, parsed, parcial: parsed };
  }

  function poblarSelectEstudioPsgCliente(selectEl, selected) {
    if (!selectEl) return;
    const sel = String(selected || '');
    selectEl.innerHTML = '<option value="">Seleccionar tipo PSG</option>' +
      PSG_TIPOS_ESTUDIO_CLIENT.map((o) =>
        `<option value="${escapeHtml(o)}"${o === sel ? ' selected' : ''}>${escapeHtml(o)}</option>`
      ).join('');
  }

  function parseNombreEstructuradoCliente(originalName, regex, tema) {
    const base = String(originalName || '').trim();
    const m = base.match(regex);
    if (!m) return { ok: false, original: base, error: mensajeErrorFormatoCliente(tema) };
    const apellidos = m[1].trim();
    const nombres = m[2].trim();
    return {
      ok: true,
      original: base,
      apellidos,
      nombres,
      tipo_documento: m[3].trim(),
      paciente_documento: m[4].trim().replace(/\s/g, ''),
      fecha_estudio: m[5],
      estudio_texto: m[6].trim(),
      paciente_nombre: `${apellidos}, ${nombres}`
    };
  }

  function parseNombreOrdenesCliente(originalName) {
    return parseNombreEstructuradoCliente(originalName, RE_ORDEN_HC_CLIENT, 'ordenes');
  }

  function parseNombreComprobanteCliente(originalName) {
    return parseNombreEstructuradoCliente(originalName, RE_COMPROBANTE_CLIENT, 'comprobantes');
  }

  function parseNombreConsentimientoCliente(originalName) {
    return parseNombreEstructuradoCliente(originalName, RE_CONSENTIMIENTO_CLIENT, 'consentimientos');
  }

  function parseNombrePorCarpetaCliente(originalName, carpeta) {
    const tema = detectarTemaCarpetaCliente(carpeta?.nombre_display || '');
    switch (tema) {
      case 'ordenes': return parseNombreOrdenesCliente(originalName);
      case 'comprobantes': return parseNombreComprobanteCliente(originalName);
      case 'consentimientos': return parseNombreConsentimientoCliente(originalName);
      default: {
        const parsed = parseNombrePdxCliente(originalName);
        if (parsed.ok && ['vtm', 'eeg', 'psg', 'actigrafia'].includes(tema) && !parsed.estudio_texto) {
          parsed.estudio_texto = inferirEstudioCliente(carpeta);
        }
        return parsed;
      }
    }
  }

  async function obtenerEstudiosPdx() {
    if (_cacheEstudiosPdx) return _cacheEstudiosPdx;
    try {
      const res = await apiFetch('/api/estudios/lista');
      const data = res.ok ? await res.json() : {};
      const lista = (Array.isArray(data) ? data : (data.registros || data.estudios || []))
        .map((e) => (typeof e === 'string' ? { nombre: e } : e))
        .filter((e) => e?.nombre)
        .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es', { sensitivity: 'base' }));
      _cacheEstudiosPdx = lista.length ? lista : null;
    } catch (_) {
      _cacheEstudiosPdx = null;
    }
    return _cacheEstudiosPdx || [];
  }

  async function poblarSelectEstudioPdx(selectEl, selected) {
    if (!selectEl) return;
    const estudios = await obtenerEstudiosPdx();
    const sel = String(selected || '');
    selectEl.innerHTML = '<option value="">Seleccionar tipo de examen</option>' +
      estudios.map((e) => {
        const nom = e.nombre || '';
        return `<option value="${escapeHtml(nom)}"${nom === sel ? ' selected' : ''}>${escapeHtml(nom)}</option>`;
      }).join('');
  }

  function camposMinimosAyudaCliente(tema) {
    const oblig = ['Apellidos', 'Nombres', 'Fecha del estudio'];
    const opc = [];
    if (esCarpetaEstructuradaPdx({ nombre_display: tema })) {
      return { oblig: [...oblig, 'Número de documento', 'Tipo de examen'], opc: ['Tipo de documento (CC, TI…)'] };
    }
    if (tema === 'psg') {
      return { oblig: [...oblig, 'Tipo PSG (Básica, CPAP, BPAP)'], opc: ['Documento'] };
    }
    if (['vtm', 'eeg', 'actigrafia'].includes(tema)) {
      return { oblig, opc: ['Estudio (se completa según la carpeta)'] };
    }
    return { oblig, opc: [] };
  }

  function actualizarAyudaFormatoPdx() {
    const el = $('sopPdxFormatHelp');
    if (!el) return;
    const tema = detectarTemaCarpetaCliente(pdxState.carpetaActual?.nombre_display || '');
    const ayuda = ayudaFormatoCliente(tema);
    const min = camposMinimosAyudaCliente(tema);
    el.innerHTML = `
      <p class="sop-pdx-format-pattern"><strong>Nombre ideal:</strong> <code>${escapeHtml(ayuda.pattern)}</code></p>
      <p class="sop-pdx-format-ejemplo"><strong>Ejemplo:</strong> ${escapeHtml(ayuda.ejemplo)}</p>
      <p class="sop-pdx-format-minimos"><strong>Mínimo para subir:</strong> ${escapeHtml(min.oblig.join(' · '))}${min.opc.length ? ` <span style="color:#64748b">(opcional: ${escapeHtml(min.opc.join(', '))})</span>` : ''}</p>
      <p class="sop-pdx-format-nota" style="margin:6px 0 0;font-size:.82rem;color:#0d9488">Si el nombre no trae todo, el sistema detecta lo que pueda y le pedirá solo los campos que falten.</p>
      ${ayuda.nota ? `<p class="sop-pdx-format-nota" style="margin:4px 0 0;font-size:.82rem;color:#64748b">${escapeHtml(ayuda.nota)}</p>` : ''}`;
    sopIcons(el);
  }

  async function preAnalizarArchivoPdx(carpetaId, nombre) {
    const res = await apiFetch(`/api/soportes/pdx/carpetas/${carpetaId}/pre-analizar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo analizar el archivo');
    return data;
  }

  function badgeEstadoCampoPdx(c) {
    if (c.estado === 'ok') return '<span class="sop-campo-badge ok">Detectado en el nombre</span>';
    if (c.estado === 'auto') return '<span class="sop-campo-badge auto">Automático</span>';
    if (c.estado === 'falta') return '<span class="sop-campo-badge falta">Complete este dato</span>';
    return '<span class="sop-campo-badge opc">Opcional</span>';
  }

  function htmlInputCampoPdx(c, datos) {
    const val = escapeHtml(c.valor || datos[c.key] || c.defecto || '');
    const wrapCls = `sop-campo-row sop-campo-row--${c.estado}`;
    if (c.input === 'date') {
      return `<div class="${wrapCls}" data-campo="${c.key}">
        <label>${escapeHtml(c.label)}${c.requerido ? ' *' : ''} ${badgeEstadoCampoPdx(c)}</label>
        <input type="date" class="sop-pdx-campo-input" data-key="${c.key}" value="${val}"></div>`;
    }
    if (c.input === 'estudio') {
      return `<div class="${wrapCls}" data-campo="${c.key}">
        <label>${escapeHtml(c.label)} * ${badgeEstadoCampoPdx(c)}</label>
        <select class="sop-pdx-campo-input" data-key="${c.key}" data-tipo="estudio"></select></div>`;
    }
    if (c.input === 'psg_estudio') {
      return `<div class="${wrapCls}" data-campo="${c.key}">
        <label>${escapeHtml(c.label)} * ${badgeEstadoCampoPdx(c)}</label>
        <select class="sop-pdx-campo-input" data-key="${c.key}" data-tipo="psg"></select></div>`;
    }
    if (c.input === 'inferred') {
      return `<div class="${wrapCls}" data-campo="${c.key}">
        <label>${escapeHtml(c.label)} ${badgeEstadoCampoPdx(c)}</label>
        <div class="sop-campo-inferred">${escapeHtml(c.valor || '—')}</div>
        <input type="hidden" class="sop-pdx-campo-input" data-key="${c.key}" value="${val}"></div>`;
    }
    return `<div class="${wrapCls}" data-campo="${c.key}">
      <label>${escapeHtml(c.label)}${c.requerido ? ' *' : ''} ${badgeEstadoCampoPdx(c)}</label>
      <input type="text" class="sop-pdx-campo-input" data-key="${c.key}" value="${val}"${c.key === 'paciente_documento' ? ' inputmode="numeric"' : ''}></div>`;
  }

  function leerCamposDesdeModal(modal) {
    const body = { confirmacion_manual: '1' };
    modal.querySelectorAll('.sop-pdx-campo-input').forEach((inp) => {
      const k = inp.dataset.key;
      if (!k) return;
      body[k] = inp.tagName === 'SELECT' ? inp.value?.trim() : inp.value?.trim();
    });
    if (body.paciente_documento) body.paciente_documento = body.paciente_documento.replace(/\s/g, '');
    return body;
  }

  function validarCamposModal(body, campos) {
    for (const c of campos || []) {
      if (!c.requerido) continue;
      const v = String(body[c.key] || '').trim();
      if (!v) return `Complete: ${c.label}`;
    }
    return null;
  }

  async function poblarSelectsCamposPdx(modal, campos, datos) {
    for (const c of campos || []) {
      const sel = modal.querySelector(`[data-key="${c.key}"][data-tipo="estudio"], [data-key="${c.key}"][data-tipo="psg"]`);
      if (!sel) continue;
      if (sel.dataset.tipo === 'psg') poblarSelectEstudioPsgCliente(sel, datos.estudio_texto || c.valor);
      else await poblarSelectEstudioPdx(sel, datos.estudio_texto || c.valor);
    }
  }

  function modalDatosArchivoPdx(file, carpetaId, analisis) {
    const carpeta = pdxState.carpetaActual || pdxState.carpetas.find((c) => c.id === carpetaId);
    const campos = analisis.campos || [];
    const datos = analisis.parcial || {};
    const esCorreccion = !!analisis.requiere_correccion;
    const titulo = esCorreccion ? 'Completar datos del archivo' : 'Confirmar y subir';
    const lead = esCorreccion
      ? (analisis.error || 'Faltan datos en el nombre del archivo. Rellene solo lo que no se detectó.')
      : (analisis.formato_completo
        ? 'El nombre cumple la estructura. Revise los datos detectados y suba el PDF.'
        : 'Se detectaron los datos mínimos en el nombre. Revise y ajuste si hace falta.');

    return new Promise((resolve, reject) => {
      const camposHtml = campos.map((c) => htmlInputCampoPdx(c, datos)).join('');
      const modal = openSopModal(`
        <h3><i data-lucide="${esCorreccion ? 'file-warning' : 'file-check'}"></i> ${titulo}</h3>
        <p style="font-size:.85rem;color:#64748b;margin:-8px 0 10px">${escapeHtml(lead)}</p>
        <dl class="sop-upload-preview" style="margin-bottom:12px">
          <dt>Archivo</dt><dd style="word-break:break-all">${escapeHtml(file.name)}</dd>
          <dt>Carpeta</dt><dd>${escapeHtml(carpeta?.nombre_display || '')}</dd>
        </dl>
        <div class="sop-pdx-campos-form">${camposHtml}</div>
        <div class="sop-dialog-actions">
          <button type="button" class="sop-btn sop-btn-ghost" id="sopPdxDatosCancel">Cancelar</button>
          <button type="button" class="sop-btn sop-btn-primary" id="sopPdxDatosOk">Subir PDF</button>
        </div>`);
      poblarSelectsCamposPdx(modal, campos, datos).then(() => sopIcons(modal));
      modal.querySelector('#sopPdxDatosCancel').onclick = () => { closeSopModal(modal); reject(new Error('cancelado')); };
      modal.querySelector('#sopPdxDatosOk').onclick = async () => {
        const body = leerCamposDesdeModal(modal);
        const err = validarCamposModal(body, campos);
        if (err) return sopToast(err, 'warning');
        try {
          await subirArchivoPdx(file, carpetaId, body);
          closeSopModal(modal);
          sopToast('Archivo subido', 'success');
          resolve();
        } catch (e) { sopToast(e.message, 'error'); }
      };
    });
  }

  let _cacheEstudiosPdx = null;

  function finishSimpleParseCliente(base, apellidos, nombres, fecha, tail) {
    if (!apellidos || !nombres || !fecha) {
      return { ok: false, original: base, error: mensajeErrorFormatoCliente('neutral') };
    }
    let marcaTiempo = (tail && tail.marca_tiempo) || '';
    let sufijo = (tail && tail.sufijo_numero) || '';
    let estudio = (tail && tail.estudio_texto) || '';
    if (!estudio && !marcaTiempo && !sufijo) {
      const idx = base.toLowerCase().indexOf(fecha.toLowerCase());
      const rest = idx >= 0 ? base.slice(idx + fecha.length).replace(/\.pdf$/i, '').trim() : '';
      const ext = rest.match(/^([\d-]+)\s+(\d+)\.\s*(.+)$/i);
      if (ext) {
        marcaTiempo = ext[1].trim();
        sufijo = ext[2].trim();
        estudio = ext[3].trim();
      } else if (rest.includes(' - ')) {
        const ap = splitSegmentosGuionesEspaciadosCliente(rest);
        if (ap.length) {
          estudio = ap[ap.length - 1].trim();
          if (ap.length > 1) marcaTiempo = ap.slice(0, -1).join(' - ');
        }
      } else if (rest) {
        estudio = rest.replace(/^\d+\.\s*/, '').trim();
      }
    }
    return {
      ok: true,
      original: base,
      apellidos,
      nombres,
      paciente_nombre: `${apellidos}, ${nombres}`,
      paciente_documento: '',
      tipo_documento: '',
      fecha_estudio: fecha,
      marca_tiempo: marcaTiempo,
      sufijo_numero: sufijo,
      estudio_texto: estudio
    };
  }

  function parseRestoDespuesFechaCliente(afterFecha) {
    if (!afterFecha) return {};
    const ext = afterFecha.match(/^([\d-]+)\s+(\d+)\.\s*(.+)$/i);
    if (ext) {
      return { marca_tiempo: ext[1].trim(), sufijo_numero: ext[2].trim(), estudio_texto: ext[3].trim() };
    }
    const ap = splitSegmentosGuionesEspaciadosCliente(afterFecha);
    if (!ap.length) return { estudio_texto: afterFecha.replace(/^\d+\.\s*/, '').trim() };
    return {
      estudio_texto: ap[ap.length - 1].trim(),
      marca_tiempo: ap.length > 1 ? ap.slice(0, -1).join(' - ') : ''
    };
  }

  function parseNombrePdxDesdeFechaCliente(originalName) {
    const base = String(originalName || '').trim();
    const fechaMatch = base.match(/(\d{4}-\d{2}-\d{2})/);
    if (!fechaMatch) {
      return { ok: false, original: base, error: mensajeErrorFormatoCliente('neutral') };
    }
    const fecha = fechaMatch[1];
    const sinPdf = base.replace(/\.pdf$/i, '');
    const beforeFecha = sinPdf.slice(0, fechaMatch.index).replace(/[\s\-–]+$/,'').trim();
    const afterFecha = sinPdf.slice(fechaMatch.index + fecha.length).replace(/^[\s\-–]+/,'').trim();
    let apellidos = '';
    let nombres = '';
    if (beforeFecha.includes(',')) {
      const c = beforeFecha.indexOf(',');
      apellidos = beforeFecha.slice(0, c).trim();
      nombres = beforeFecha.slice(c + 1).trim();
    } else if (beforeFecha) {
      const segs = splitSegmentosGuionesEspaciadosCliente(beforeFecha);
      const nameSegs = segs.filter((s) => !esSegmentoDocumentoCliente(s));
      const tuvoDocumento = segs.length > nameSegs.length;
      if (nameSegs.length >= 2) {
        if (tuvoDocumento || segs.length >= 3) {
          nombres = nameSegs[0];
          apellidos = nameSegs[1];
        } else {
          apellidos = nameSegs[0];
          nombres = nameSegs[1];
        }
      }
    }
    return finishSimpleParseCliente(base, apellidos, nombres, fecha, parseRestoDespuesFechaCliente(afterFecha));
  }

  function parseNombrePdxCliente(originalName) {
    const base = String(originalName || '').trim();
    const mExt = base.match(RE_PDX_EXT_CLIENT);
    if (mExt) {
      return finishSimpleParseCliente(base, mExt[1].trim(), mExt[2].trim(), mExt[3], {
        marca_tiempo: mExt[4].trim(),
        sufijo_numero: mExt[5].trim(),
        estudio_texto: mExt[6].trim()
      });
    }
    const m = base.match(RE_REPORTE_BASE_CLIENT);
    if (m) return finishSimpleParseCliente(base, m[1].trim(), m[2].trim(), m[3]);
    const mGuion = base.match(/^([^-]+?)\s+-\s+([^-]+?)\s+-\s+(\d{4}-\d{2}-\d{2})(?:\s+.+)?\.pdf$/i);
    if (mGuion && !esSegmentoDocumentoCliente(mGuion[1]) && !esSegmentoDocumentoCliente(mGuion[2])) {
      return finishSimpleParseCliente(base, mGuion[1].trim(), mGuion[2].trim(), mGuion[3]);
    }
    return parseNombrePdxDesdeFechaCliente(originalName);
  }

  function fechaEnPeriodoCliente(fechaStr, periodoYYYYMM) {
    if (!fechaStr || !periodoYYYYMM) return true;
    return String(fechaStr).slice(0, 7) === periodoYYYYMM;
  }

  function htmlEstudioBadge(texto, tema) {
    const t = tema || 'neutral';
    const colors = {
      vtm: '#2563eb', psg: '#7c3aed', eeg: '#ca8a04', actigrafia: '#0891b2',
      ordenes: '#0d9488', comprobantes: '#ea580c', consentimientos: '#9333ea', neutral: '#64748b'
    };
    return `<span class="sop-estudio-badge" style="--sop-estudio-color:${colors[t] || colors.neutral}">${escapeHtml(texto || '—')}</span>`;
  }

  function pdxUploadWarnings(parsed, carpeta) {
    const w = [];
    if (esCarpetaEstructuradaPdx(carpeta)) return w;
    if (carpeta && parsed.fecha_estudio && !fechaEnPeriodoCliente(parsed.fecha_estudio, carpeta.periodo)) {
      w.push(`La fecha del estudio (${parsed.fecha_estudio}) no corresponde al mes de la carpeta (${carpeta.periodo}).`);
    }
    return w;
  }
  let armState = {
    periodos: [],
    periodoId: null,
    periodoLabel: null,
    dias: [],
    diaId: null,
    diaLabel: null,
    diaFacturacion: null,
    contenedores: [],
    contenedorId: null,
    contenedorTipo: null,
    expedienteId: null,
    expedienteCodigo: null,
    vista: 'empty'
  };

  function badgeFacturacionArmado(estado) {
    if (estado === 'facturados') {
      return '<span class="sop-badge sop-badge-listo" style="margin:0;font-size:.7rem">Facturados</span>';
    }
    return '<span class="sop-badge sop-badge-pendiente" style="margin:0;font-size:.7rem">A facturar</span>';
  }

  function labelContenedorArmado(tipo) {
    return tipo === 'rips' ? 'RIPS' : 'SOPORTES';
  }

  function renderSopBreadcrumbs(containerEl, crumbs) {
    if (!containerEl || !crumbs?.length) return;
    containerEl.innerHTML = crumbs.map((c, i) => {
      const sep = i > 0 ? '<span class="sop-crumb-sep" aria-hidden="true">›</span>' : '';
      if (c.current) {
        return `${sep}<span class="sop-crumb is-current">${escapeHtml(c.label)}</span>`;
      }
      if (c.onClick) {
        return `${sep}<button type="button" class="sop-crumb is-link" data-crumb-idx="${i}">${escapeHtml(c.label)}</button>`;
      }
      return `${sep}<span class="sop-crumb">${escapeHtml(c.label)}</span>`;
    }).join('');
    containerEl.querySelectorAll('[data-crumb-idx]').forEach((btn) => {
      const idx = parseInt(btn.dataset.crumbIdx, 10);
      const crumb = crumbs[idx];
      if (crumb?.onClick) btn.addEventListener('click', crumb.onClick);
    });
  }

  function calcExpedienteProgress(expediente, slots) {
    const ordered = ['OPF', 'CRC', 'FEV'];
    const pdxOn = slots.PDX?.habilitado !== false;
    const hevOn = slots.HEV?.habilitado !== false;
    if (pdxOn && hevOn) ordered.push('PDX/HEV');
    else if (pdxOn) ordered.push('PDX');
    else if (hevOn) ordered.push('HEV');
    const items = ordered.map((key) => {
      let done = false;
      if (key === 'FEV') done = !!(expediente.fev_externa_verificada || slots.FEV?.completo);
      else if (key === 'PDX/HEV') done = !!(slots.PDX?.completo || slots.HEV?.completo);
      else done = !!slots[key]?.completo;
      return { key, done };
    });
    const done = items.filter((i) => i.done).length;
    const total = items.length || 1;
    return { items, done, total, pct: Math.round((done / total) * 100) };
  }

  function htmlExpedienteProgress(expediente, slots) {
    const p = calcExpedienteProgress(expediente, slots);
    const complete = p.done >= p.total;
    return `<div class="sop-exp-progress" role="status" aria-label="Progreso del expediente">
      <div class="sop-exp-progress-head">
        <span>Documentos del expediente</span>
        <strong>${p.done} de ${p.total} completos</strong>
      </div>
      <div class="sop-exp-progress-track">
        <div class="sop-exp-progress-fill${complete ? ' is-complete' : ''}" style="width:${p.pct}%"></div>
      </div>
      <div class="sop-exp-progress-slots">
        ${p.items.map((i) => `<span class="sop-exp-progress-slot${i.done ? ' done' : ''}">${i.key}</span>`).join('')}
      </div>
    </div>`;
  }

  function renderArmadoContextBar() {
    const el = $('sopArmContextBar');
    if (!el) return;
    if (!armState.periodoId) {
      el.innerHTML = '<span class="sop-context-label">Navegación</span><span>Seleccione un mes en el panel izquierdo</span>';
      return;
    }
    const crumbs = [{
      label: armState.periodoLabel || 'Mes',
      current: armState.vista === 'period',
      onClick: armState.vista !== 'period' ? () => seleccionarPeriodoArmado(armState.periodoId) : null
    }];
    if (armState.diaId != null) {
      crumbs.push({
        label: armState.diaLabel || 'Carpeta de día',
        current: armState.vista === 'day',
        onClick: ['contenedor', 'expediente'].includes(armState.vista) ? () => seleccionarDiaArmado(armState.diaId) : null
      });
    }
    if (armState.contenedorId != null) {
      crumbs.push({
        label: labelContenedorArmado(armState.contenedorTipo),
        current: armState.vista === 'contenedor',
        onClick: armState.vista === 'expediente' ? () => seleccionarContenedorArmado(armState.contenedorId) : null
      });
    }
    if (armState.vista === 'expediente' && armState.expedienteCodigo) {
      crumbs.push({ label: armState.expedienteCodigo, current: true });
    } else if (armState.contenedorId) {
      crumbs.push({ label: 'Carpetas FE', current: true });
    } else if (armState.diaId) {
      crumbs.push({ label: 'RIPS / SOPORTES', current: true });
    } else {
      crumbs.push({ label: 'Seleccione carpeta de día', current: true });
    }
    el.innerHTML = '<span class="sop-context-label">Ubicación</span>';
    const trail = document.createElement('span');
    trail.className = 'sop-breadcrumbs';
    trail.style.margin = '0';
    trail.style.flex = '1';
    renderSopBreadcrumbs(trail, crumbs);
    el.appendChild(trail);
  }

  function renderPdxBreadcrumbLista() {
    renderSopBreadcrumbs($('sopPdxBreadcrumbLista'), [
      { label: 'Cargar reportes', current: true }
    ]);
  }

  function renderPdxBreadcrumbDetalle(carpeta) {
    if (!carpeta) return;
    renderSopBreadcrumbs($('sopPdxBreadcrumbDetalle'), [
      { label: 'Cargar reportes', onClick: volverListaPdx },
      { label: carpeta.nombre_display || 'Carpeta', current: true }
    ]);
  }

  function renderPdxDetalleAcciones(carpeta) {
    const wrap = $('sopPdxDetalleAcciones');
    if (!wrap || !carpeta) return;
    const enArchivo = carpeta.estado_visibilidad === 'archivo';
    wrap.innerHTML = `
      ${sopPerm('soportes.pdx.editar') && !enArchivo ? '<button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" id="btnSopPdxEditCarpeta"><i data-lucide="pencil"></i> Editar carpeta</button>' : ''}
      ${sopPerm('soportes.pdx.eliminar') ? `<button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" id="btnSopPdxDelCarpeta" style="color:#dc2626"><i data-lucide="trash-2"></i> Eliminar carpeta</button>` : ''}`;
    wrap.querySelector('#btnSopPdxEditCarpeta')?.addEventListener('click', () => modalEditarCarpetaPdx(carpeta));
    wrap.querySelector('#btnSopPdxDelCarpeta')?.addEventListener('click', () => eliminarCarpetaPdx(carpeta));
    sopIcons(wrap);
  }

  const TEMA_ICON = {
    vtm: 'video',
    psg: 'moon',
    eeg: 'activity',
    actigrafia: 'watch',
    ordenes: 'clipboard-list',
    comprobantes: 'receipt',
    consentimientos: 'file-signature',
    neutral: 'folder'
  };

  function destinoImportDesdeTema(tema) {
    if (tema === 'comprobantes') return 'CRC';
    if (tema === 'consentimientos') return null;
    if (tema === 'ordenes') return 'ORDEN+HC';
    return 'PDX';
  }

  function puedeVincularArchivoAFe(a, temaCarpeta) {
    if (a?.puede_vincular_fe === false) return false;
    return temaCarpeta !== 'consentimientos';
  }

  const TEMA_LABEL = {
    vtm: 'VTM',
    psg: 'PSG',
    eeg: 'EEG',
    actigrafia: 'Actigrafía',
    ordenes: 'Órdenes',
    comprobantes: 'Comprobantes',
    consentimientos: 'Consentimientos',
    neutral: 'General'
  };

  function renderPdxTemaLegend() {
    const el = $('sopPdxTemaLegend');
    if (!el) return;
    const temas = ['vtm', 'psg', 'eeg', 'actigrafia', 'ordenes', 'comprobantes', 'consentimientos', 'neutral'];
    el.innerHTML = `<span class="sop-tema-legend-title">Modalidades:</span>${temas.map((t) =>
      `<span class="sop-tema-legend-item" data-tema="${t}">${TEMA_LABEL[t]}</span>`
    ).join('')}`;
  }

  function htmlArmadoSummaryChips({ total = 0, listos = 0, pendientes = 0, extra = '' } = {}) {
    const pend = pendientes != null ? pendientes : Math.max(0, total - listos);
    return `<div class="sop-summary-row">
      ${extra}
      <span class="sop-summary-chip"><i data-lucide="file-stack"></i> <strong>${total}</strong> FE</span>
      <span class="sop-summary-chip ok"><i data-lucide="circle-check"></i> <strong>${listos}</strong> listos</span>
      <span class="sop-summary-chip warn"><i data-lucide="clock"></i> <strong>${pend}</strong> pendientes</span>
    </div>`;
  }

  function badgeEstadoFe(listo) {
    return listo
      ? '<span class="sop-badge sop-badge-listo"><i data-lucide="circle-check" style="width:12px;height:12px"></i> Listo</span>'
      : '<span class="sop-badge sop-badge-pendiente"><i data-lucide="clock" style="width:12px;height:12px"></i> Pendiente</span>';
  }

  function showSkeletonFolderGrid(container, count = 6) {
    if (!container) return;
    container.innerHTML = `<div class="sop-grid sop-skeleton-grid">${Array.from({ length: count }, () =>
      '<div class="sop-skeleton-block sop-skeleton-folder-card"></div>'
    ).join('')}</div>`;
  }

  function showSkeletonNavList(container, count = 5) {
    if (!container) return;
    container.innerHTML = Array.from({ length: count }, () =>
      '<div class="sop-skeleton-block sop-skeleton-nav-item"></div>'
    ).join('');
  }

  function showSkeletonTableRows(tbody, cols, rows = 5) {
    if (!tbody) return;
    tbody.innerHTML = Array.from({ length: rows }, () =>
      `<tr class="sop-skeleton-table-row">${Array.from({ length: cols }, () =>
        '<td><div class="sop-skeleton-block"></div></td>'
      ).join('')}</tr>`
    ).join('');
  }

  function sopDebounce(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  function cerrarResultadosPdx(clearInput = true) {
    const el = $('sopPdxResultados');
    if (!el) return;
    el.classList.add('hidden');
    el.innerHTML = '';
    if (clearInput) {
      const inp = $('sopPdxBuscar');
      if (inp) inp.value = '';
    }
  }

  function cerrarResultadosArmado(clearInput = true) {
    const el = $('sopArmBuscarResultados');
    if (!el) return;
    el.classList.add('hidden');
    el.innerHTML = '';
    if (clearInput) {
      const inp = $('sopArmBuscarPaciente');
      if (inp) inp.value = '';
    }
  }

  function renderArmadoPeriodoSummary() {
    const el = $('sopArmPeriodoSummary');
    if (!el) return;
    if (!armState.periodoId) {
      el.classList.add('hidden');
      el.innerHTML = '';
      return;
    }
    const totalDias = armState.dias.length;
    const totalFe = armState.dias.reduce((s, d) => s + (d.expedientes_count || 0), 0);
    el.classList.remove('hidden');
    el.innerHTML = `<div class="sop-summary-row" style="margin-bottom:12px">
      <span class="sop-summary-chip"><i data-lucide="folder"></i> <strong>${totalDias}</strong> carpetas de día</span>
      <span class="sop-summary-chip"><i data-lucide="file-stack"></i> <strong>${totalFe}</strong> FE en el mes</span>
    </div>`;
    sopIcons(el);
  }

  function $(id) { return document.getElementById(id); }

  function sopIcons(root) {
    if (typeof lucide !== 'undefined' && lucide.createIcons) {
      const opts = { attrs: { 'stroke-width': 2 }, nameAttr: 'data-lucide' };
      if (root) opts.root = root;
      try { lucide.createIcons(opts); } catch (_) { lucide.createIcons(); }
    }
  }

  function sopPerm(key) {
    if (typeof window.tienePermiso !== 'function') return false;
    if (window.tienePermiso(key)) return true;
    if (key === 'soportes.pdx.ver' || key === 'soportes.pdx.crear_carpeta' || key === 'soportes.pdx.editar') {
      return window.tienePermiso('soportes.pdx.subir');
    }
    return false;
  }

  function periodoActual() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  function badgeVis(estado, dias) {
    const labels = {
      activa: 'Activo',
      gracia: `Restan ${dias || 0}d para la eliminación de esta carpeta`,
      archivo: 'Archivo'
    };
    const icon = estado === 'activa' ? 'circle-check' : estado === 'gracia' ? 'clock' : 'archive';
    return `<span class="sop-badge sop-badge-${estado}"><i data-lucide="${icon}" style="width:12px;height:12px"></i> ${escapeHtml(labels[estado] || estado)}</span>`;
  }

  function closeSopModal(wrap) {
    if (!wrap || !wrap.isConnected) return;
    if (wrap._sopKeyHandler) {
      document.removeEventListener('keydown', wrap._sopKeyHandler);
      wrap._sopKeyHandler = null;
    }
    const finish = () => {
      if (wrap.isConnected) wrap.remove();
      const prev = wrap._sopPrevFocus;
      if (prev && typeof prev.focus === 'function') prev.focus();
    };
    if (typeof window.innarCloseConfirm === 'function') {
      window.innarCloseConfirm(wrap, finish);
    } else {
      finish();
    }
  }

  function openSopModal(html) {
    const wrap = document.createElement('div');
    wrap.className = 'sop-dialog-backdrop';
    wrap.setAttribute('role', 'presentation');
    const dialog = document.createElement('div');
    dialog.className = 'sop-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.tabIndex = -1;
    dialog.innerHTML = html;
    wrap.appendChild(dialog);
    wrap._sopPrevFocus = document.activeElement;
    wrap._sopClose = () => closeSopModal(wrap);
    wrap.addEventListener('click', (e) => { if (e.target === wrap) closeSopModal(wrap); });
    const onKey = (e) => {
      if (e.key === 'Escape') closeSopModal(wrap);
    };
    wrap._sopKeyHandler = onKey;
    document.addEventListener('keydown', onKey);
    const focusables = [...dialog.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
    )].filter((el) => el.offsetParent !== null || el === document.activeElement);
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    dialog.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab' || !focusables.length) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });
    document.body.appendChild(wrap);
    sopIcons(wrap);
    requestAnimationFrame(() => { if (first) first.focus(); else dialog.focus(); });
    return wrap;
  }

  function sopAnimateModuleIn(viewId) {
    const el = $(viewId);
    if (el && typeof window.innarAnimateViewIn === 'function') {
      requestAnimationFrame(() => window.innarAnimateViewIn(el));
    }
  }

  function sopArmNavOpen(open) {
    const layout = $('sopArmLayout');
    const backdrop = $('sopArmNavBackdrop');
    const btn = $('btnSopArmToggleNav');
    if (!layout) return;
    if (open) {
      layout.classList.add('sop-nav-open');
      backdrop?.classList.remove('hidden');
      backdrop?.setAttribute('aria-hidden', 'false');
      btn?.setAttribute('aria-expanded', 'true');
    } else {
      layout.classList.remove('sop-nav-open');
      backdrop?.classList.add('hidden');
      backdrop?.setAttribute('aria-hidden', 'true');
      btn?.setAttribute('aria-expanded', 'false');
    }
  }

  function sopToast(msg, type) {
    if (typeof showToast === 'function') showToast(msg, type || 'info');
    else alert(msg);
  }

  function setupDropzone() {
    const zone = $('sopPdxDropzone');
    const input = $('sopPdxUploadInput');
    if (!zone || !input) return;
    zone.addEventListener('click', () => input.click());
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('sop-dropzone-active'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('sop-dropzone-active'));
    zone.addEventListener('drop', async (e) => {
      e.preventDefault();
      zone.classList.remove('sop-dropzone-active');
      if (!pdxState.carpetaId || !e.dataTransfer?.files?.length) return;
      await procesarArchivosPdx([...e.dataTransfer.files], pdxState.carpetaId);
    });
  }

  // ─── Reportes PDX ─────────────────────────────────────────────────────────

  function pdxCarpetasFiltradas() {
    let list = [...pdxState.carpetas];
    const { texto, periodo, tema, orden } = pdxState.filtros;
    const t = (texto || '').trim().toLowerCase();
    if (t) {
      list = list.filter((c) =>
        (c.nombre_display || '').toLowerCase().includes(t) ||
        (c.periodo || '').includes(t)
      );
    }
    if (periodo) list = list.filter((c) => c.periodo === periodo);
    if (tema) list = list.filter((c) => (c.color_tema || 'neutral') === tema);
    const cmpStr = (a, b) => String(a).localeCompare(String(b), 'es');
    switch (orden) {
      case 'periodo_asc':
        list.sort((a, b) => cmpStr(a.periodo, b.periodo));
        break;
      case 'nombre_asc':
        list.sort((a, b) => cmpStr(a.nombre_display, b.nombre_display));
        break;
      case 'nombre_desc':
        list.sort((a, b) => cmpStr(b.nombre_display, a.nombre_display));
        break;
      case 'archivos_desc':
        list.sort((a, b) => (b.archivos_count || 0) - (a.archivos_count || 0));
        break;
      default:
        list.sort((a, b) => cmpStr(b.periodo, a.periodo));
    }
    return list;
  }

  function actualizarFiltroPeriodosPdx() {
    const sel = $('sopPdxFiltroPeriodo');
    if (!sel) return;
    const cur = pdxState.filtros.periodo;
    const periodos = [...new Set(pdxState.carpetas.map((c) => c.periodo).filter(Boolean))].sort().reverse();
    sel.innerHTML = '<option value="">Todos los periodos</option>' +
      periodos.map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');
    if (cur && periodos.includes(cur)) sel.value = cur;
  }

  function setupPdxFiltros() {
    const sync = () => {
      pdxState.filtros.texto = $('sopPdxFiltroTexto')?.value || '';
      pdxState.filtros.periodo = $('sopPdxFiltroPeriodo')?.value || '';
      pdxState.filtros.tema = $('sopPdxFiltroTema')?.value || '';
      pdxState.filtros.orden = $('sopPdxFiltroOrden')?.value || 'periodo_desc';
      renderListaCarpetasPdx();
    };
    $('sopPdxFiltroTexto')?.addEventListener('input', sync);
    $('sopPdxFiltroPeriodo')?.addEventListener('change', sync);
    $('sopPdxFiltroTema')?.addEventListener('change', sync);
    $('sopPdxFiltroOrden')?.addEventListener('change', sync);
    const ordenSel = $('sopPdxFiltroOrden');
    if (ordenSel) ordenSel.value = pdxState.filtros.orden;
  }

  async function cargarCarpetasPdx() {
    showSkeletonFolderGrid($('sopPdxLista'), 6);
    const res = await apiFetch('/api/soportes/pdx/carpetas');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al cargar carpetas');
    pdxState.carpetas = data.carpetas || [];
    pdxState.periodoActual = data.periodo_actual || periodoActual();
    const chip = $('sopPdxChipPeriodo');
    if (chip) {
      chip.innerHTML = `<span class="sop-stat-chip"><i data-lucide="calendar"></i> Periodo en curso: <strong>${escapeHtml(pdxState.periodoActual)}</strong></span>
        <span class="sop-stat-chip"><i data-lucide="folder"></i> <strong>${pdxState.carpetas.length}</strong> carpetas</span>`;
      sopIcons(chip);
    }
    actualizarFiltroPeriodosPdx();
    return data;
  }

  function renderListaCarpetasPdx() {
    renderPdxBreadcrumbLista();
    renderPdxTemaLegend();
    const el = $('sopPdxLista');
    if (!el) return;
    const lista = pdxCarpetasFiltradas();
    if (!pdxState.carpetas.length) {
      el.innerHTML = `<div class="sop-empty"><i data-lucide="folder-open" class="sop-empty-icon"></i>No hay carpetas.<br><span style="font-size:.85rem">Use «Nueva carpeta» para comenzar.</span></div>`;
      sopIcons(el);
      return;
    }
    if (!lista.length) {
      el.innerHTML = `<div class="sop-empty"><i data-lucide="filter-x" class="sop-empty-icon"></i>Ninguna carpeta coincide con los filtros.</div>`;
      sopIcons(el);
      return;
    }
    const canEdit = sopPerm('soportes.pdx.editar');
    const canDel = sopPerm('soportes.pdx.eliminar');
    el.innerHTML = `<div class="sop-grid">${lista.map((c) => {
      const tema = c.color_tema || 'neutral';
      const icon = TEMA_ICON[tema] || 'folder';
      const enArchivo = c.estado_visibilidad === 'archivo';
      return `<article class="sop-folder-card" data-tema="${escapeHtml(tema)}" data-pdx-carpeta="${c.id}">
        <div class="sop-folder-icon"><i data-lucide="${icon}"></i></div>
        <div class="sop-folder-title">${escapeHtml(c.nombre_display)}</div>
        <div class="sop-folder-meta">${escapeHtml(c.periodo)} · ${c.archivos_count || 0} archivo(s)</div>
        ${badgeVis(c.estado_visibilidad, c.dias_restantes_gracia)}
        ${(canEdit || canDel) ? `<div class="sop-folder-actions">
          ${canEdit && !enArchivo ? `<button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-pdx-edit="${c.id}"><i data-lucide="pencil"></i></button>` : ''}
          ${canDel ? `<button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-pdx-del-carpeta="${c.id}" title="Eliminar carpeta" style="color:#dc2626"><i data-lucide="trash-2"></i></button>` : ''}
        </div>` : ''}
      </article>`;
    }).join('')}</div>`;
    el.querySelectorAll('[data-pdx-carpeta]').forEach((card) => {
      card.addEventListener('click', (ev) => {
        if (ev.target.closest('.sop-folder-actions')) return;
        abrirCarpetaPdx(parseInt(card.dataset.pdxCarpeta, 10));
      });
    });
    el.querySelectorAll('[data-pdx-edit]').forEach((b) => {
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const c = pdxState.carpetas.find((x) => x.id === parseInt(b.dataset.pdxEdit, 10));
        if (c) modalEditarCarpetaPdx(c);
      });
    });
    el.querySelectorAll('[data-pdx-del-carpeta]').forEach((b) => {
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const c = pdxState.carpetas.find((x) => x.id === parseInt(b.dataset.pdxDelCarpeta, 10));
        if (c) eliminarCarpetaPdx(c);
      });
    });
    sopIcons(el);
  }

  async function eliminarArchivoPdx(archivoId, nombre) {
    if (!sopPerm('soportes.pdx.eliminar')) return;
    const label = nombre || `archivo #${archivoId}`;
    if (!window.confirm(`¿Eliminar "${label}"? Esta acción no se puede deshacer.`)) return;
    const res = await apiFetch(`/api/soportes/pdx/archivos/${archivoId}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { sopToast(data.error || 'No se pudo eliminar', 'error'); return; }
    sopToast('Archivo eliminado', 'success');
    if (pdxState.carpetaId) abrirCarpetaPdx(pdxState.carpetaId);
  }

  async function abrirCarpetaPdx(id) {
    pdxState.carpetaId = id;
    $('sopPdxVistaLista')?.classList.add('hidden');
    $('sopPdxVistaDetalle')?.classList.remove('hidden');
    showSkeletonTableRows($('sopPdxArchivosBody'), 4, 4);
    const res = await apiFetch(`/api/soportes/pdx/carpetas/${id}/archivos`);
    const data = await res.json();
    if (!res.ok) { sopToast(data.error || 'Error', 'error'); return; }
    pdxState.archivos = data.archivos || [];
    const c = data.carpeta;
    pdxState.carpetaActual = c;
    renderPdxBreadcrumbDetalle(c);
    renderPdxDetalleAcciones(c);
    $('sopPdxDetalleTitulo').textContent = c.nombre_display;
    $('sopPdxDetalleMeta').innerHTML = `${escapeHtml(c.periodo)} ${badgeVis(c.estado_visibilidad, c.dias_restantes_gracia)}`;
    sopIcons($('sopPdxDetalleMeta'));
    actualizarAyudaFormatoPdx();
    const tbody = $('sopPdxArchivosBody');
    if (!pdxState.archivos.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="sop-empty" style="padding:24px">Sin archivos en esta carpeta</td></tr>';
      return;
    }
    const canDelete = sopPerm('soportes.pdx.eliminar');
    const canEdit = sopPerm('soportes.pdx.editar');
    const canVer = sopPerm('soportes.pdx.ver');
    const canSubir = sopPerm('soportes.pdx.subir');
    const enArchivo = c.estado_visibilidad === 'archivo';
    const temaCarpeta = c.color_tema || 'neutral';
    tbody.innerHTML = pdxState.archivos.map((a) => {
      const metaUser = a.editado_por_nombre
        ? `Editado por ${escapeHtml(a.editado_por_nombre)}`
        : (a.subido_por_nombre ? `Subido por ${escapeHtml(a.subido_por_nombre)}` : '');
      const nomArch = a.nombre_descarga || a.nombre_archivo_display || a.nombre_archivo_original || '';
      return `<tr>
      <td>
        <strong>${escapeHtml(a.paciente_nombre)}</strong>
        ${metaUser ? `<div class="sop-pdx-meta-user">${metaUser}</div>` : ''}
      </td>
      <td>${escapeHtml(a.fecha_estudio || '—')}</td>
      <td>${htmlEstudioBadge(a.estudio_texto, temaCarpeta)}</td>
      <td><span class="sop-pdx-archivo-nombre" title="${escapeHtml(nomArch)}">${escapeHtml(nomArch)}</span></td>
      <td><div class="sop-actions-row">
        ${canVer ? `<button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-pdx-ver="${a.id}" title="Vista previa"><i data-lucide="eye"></i></button>
        <button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-pdx-dl="${a.id}" title="Descargar"><i data-lucide="download"></i></button>` : ''}
        ${canEdit && !enArchivo ? `<button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-pdx-edit-arch="${a.id}" title="Editar datos"><i data-lucide="pencil"></i></button>` : ''}
        ${canEdit && !enArchivo ? `<button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-pdx-replace="${a.id}" title="Reemplazar PDF"><i data-lucide="file-up"></i></button>` : ''}
        ${canEdit && !enArchivo ? `<button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-pdx-move="${a.id}" title="Mover a otra carpeta"><i data-lucide="folder-input"></i></button>` : ''}
        ${canVer ? `<button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-pdx-hist="${a.id}" title="Historial"><i data-lucide="history"></i></button>` : ''}
        ${sopPerm('soportes.armado.importar_pdx') && puedeVincularArchivoAFe(a, temaCarpeta) ? `<button type="button" class="sop-btn sop-btn-primary sop-btn-sm" data-pdx-link="${a.id}" data-pdx-dest="${escapeHtml(a.destino_importacion || destinoImportDesdeTema(temaCarpeta) || 'PDX')}" title="Vincular a carpeta FE"><i data-lucide="link-2"></i></button>` : ''}
        ${canDelete ? `<button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-pdx-del="${a.id}" title="Eliminar" style="color:#dc2626"><i data-lucide="trash-2"></i></button>` : ''}
      </div></td>
    </tr>`;
    }).join('');
    tbody.querySelectorAll('[data-pdx-ver]').forEach((b) => {
      b.addEventListener('click', () => modalVerPdfPdx(parseInt(b.dataset.pdxVer, 10)));
    });
    tbody.querySelectorAll('[data-pdx-dl]').forEach((b) => {
      b.addEventListener('click', () => descargarArchivoPdx(parseInt(b.dataset.pdxDl, 10)));
    });
    tbody.querySelectorAll('[data-pdx-link]').forEach((b) => {
      b.addEventListener('click', () => modalVincularDeposito(parseInt(b.dataset.pdxLink, 10), {
        destino_importacion: b.dataset.pdxDest
      }));
    });
    tbody.querySelectorAll('[data-pdx-edit-arch]').forEach((b) => {
      b.addEventListener('click', () => {
        const row = pdxState.archivos.find((x) => x.id === parseInt(b.dataset.pdxEditArch, 10));
        if (row) modalEditarArchivoPdx(row);
      });
    });
    tbody.querySelectorAll('[data-pdx-replace]').forEach((b) => {
      b.addEventListener('click', () => {
        const row = pdxState.archivos.find((x) => x.id === parseInt(b.dataset.pdxReplace, 10));
        if (row) modalReemplazarPdx(row);
      });
    });
    tbody.querySelectorAll('[data-pdx-move]').forEach((b) => {
      b.addEventListener('click', () => {
        const row = pdxState.archivos.find((x) => x.id === parseInt(b.dataset.pdxMove, 10));
        if (row) modalMoverCarpetaPdx(row);
      });
    });
    tbody.querySelectorAll('[data-pdx-hist]').forEach((b) => {
      b.addEventListener('click', () => modalHistorialPdx(parseInt(b.dataset.pdxHist, 10)));
    });
    tbody.querySelectorAll('[data-pdx-del]').forEach((b) => {
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const aid = parseInt(b.dataset.pdxDel, 10);
        const row = pdxState.archivos.find((x) => x.id === aid);
        eliminarArchivoPdx(aid, row?.paciente_nombre);
      });
    });
    const zone = $('sopPdxDropzone');
    const inputUp = $('sopPdxUploadInput');
    const dropDisabled = enArchivo || !canSubir;
    if (zone) {
      zone.classList.toggle('sop-dropzone-disabled', dropDisabled);
      zone.style.display = canSubir ? '' : 'none';
    }
    if (inputUp) inputUp.disabled = dropDisabled;
    sopIcons($('sopPdxVistaDetalle'));
  }

  async function eliminarCarpetaPdx(carpeta) {
    if (!sopPerm('soportes.pdx.eliminar')) return;
    const n = carpeta.archivos_count || 0;
    const msg = n > 0
      ? `¿Eliminar la carpeta «${carpeta.nombre_display}» y sus ${n} archivo(s)? No se puede deshacer.`
      : `¿Eliminar la carpeta vacía «${carpeta.nombre_display}»?`;
    if (!window.confirm(msg)) return;
    const res = await apiFetch(`/api/soportes/pdx/carpetas/${carpeta.id}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (res.status === 409) {
      sopToast(data.error || 'No se puede eliminar (archivos vinculados a FE)', 'error');
      return;
    }
    if (!res.ok) { sopToast(data.error || 'Error', 'error'); return; }
    sopToast('Carpeta eliminada', 'success');
    if (pdxState.carpetaId === carpeta.id) volverListaPdx();
    else {
      await cargarCarpetasPdx();
      renderListaCarpetasPdx();
    }
  }

  function modalEditarCarpetaPdx(carpeta) {
    const modal = openSopModal(`
      <h3><i data-lucide="pencil"></i> Editar carpeta</h3>
      <div class="sop-field"><label>Periodo (mes)</label><input type="month" id="sopPdxEditPer" value="${escapeHtml(carpeta.periodo)}"></div>
      <div class="sop-field"><label>Nombre visible</label><input type="text" id="sopPdxEditNom" value="${escapeHtml(carpeta.nombre_display)}"></div>
      <p style="font-size:.8rem;color:#64748b;margin:0">El tema de color (VTM, PSG, etc.) se detecta del nombre.</p>
      <div class="sop-dialog-actions">
        <button type="button" class="sop-btn sop-btn-ghost" id="sopPdxEditCancel">Cancelar</button>
        <button type="button" class="sop-btn sop-btn-primary" id="sopPdxEditOk">Guardar</button>
      </div>`);
    modal.querySelector('#sopPdxEditCancel').onclick = () => closeSopModal(modal);
    modal.querySelector('#sopPdxEditOk').onclick = async () => {
      const res = await apiFetch(`/api/soportes/pdx/carpetas/${carpeta.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          periodo: $('sopPdxEditPer').value,
          nombre_display: $('sopPdxEditNom').value.trim()
        })
      });
      const data = await res.json();
      if (!res.ok) { sopToast(data.error || 'Error', 'error'); return; }
      closeSopModal(modal);
      sopToast('Carpeta actualizada', 'success');
      await cargarCarpetasPdx();
      if (pdxState.carpetaId === carpeta.id) abrirCarpetaPdx(carpeta.id);
      else renderListaCarpetasPdx();
    };
  }

  async function descargarArchivoPdx(archivoId) {
    try {
      const res = await apiFetch(`/api/soportes/pdx/archivos/${archivoId}/descargar`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        sopToast(data.error || 'No se pudo descargar el archivo', 'error');
        return;
      }
      const blob = await res.blob();
      let filename = 'archivo.pdf';
      const cd = res.headers.get('Content-Disposition') || '';
      const utf8Match = cd.match(/filename\*=UTF-8''([^;\s]+)/i);
      if (utf8Match) {
        try { filename = decodeURIComponent(utf8Match[1]); } catch (_) { /* ignore */ }
      } else {
        const plainMatch = cd.match(/filename="([^"]+)"/i) || cd.match(/filename=([^;\s]+)/i);
        if (plainMatch) filename = plainMatch[1].trim();
      }
      const row = pdxState.archivos.find((x) => x.id === archivoId);
      if (row) {
        filename = row.nombre_descarga || row.nombre_archivo_display || row.nombre_archivo_original || filename;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      sopToast(e.message || 'Error al descargar', 'error');
    }
  }

  function modalVerPdfPdx(archivoId) {
    const url = `/api/soportes/pdx/archivos/${archivoId}/ver`;
    const modal = openSopModal(`
      <h3><i data-lucide="eye"></i> Vista previa del PDF</h3>
      <iframe class="sop-pdf-frame" src="${url}" title="Vista previa PDF"></iframe>
      <div class="sop-dialog-actions" style="margin-top:12px">
        <a href="${url}" target="_blank" rel="noopener" class="sop-btn sop-btn-ghost">Abrir en pestaña</a>
        <button type="button" class="sop-btn sop-btn-primary" id="sopPdxPdfClose">Cerrar</button>
      </div>`);
    modal.querySelector('#sopPdxPdfClose').onclick = () => closeSopModal(modal);
    const dlg = modal.querySelector('.sop-dialog');
    if (dlg) dlg.classList.add('sop-dialog-pdf');
  }

  async function modalHistorialPdx(archivoId) {
    const row = pdxState.archivos.find((x) => x.id === archivoId);
    const modal = openSopModal(`
      <h3><i data-lucide="history"></i> Historial</h3>
      <p style="font-size:.85rem;color:#64748b;margin:-6px 0 12px">${escapeHtml(row?.paciente_nombre || 'Reporte')}</p>
      <div id="sopPdxHistBody"><div class="sop-empty" style="padding:16px"><i data-lucide="loader"></i></div></div>
      <div class="sop-dialog-actions">
        <button type="button" class="sop-btn sop-btn-primary" id="sopPdxHistClose">Cerrar</button>
      </div>`);
    modal.querySelector('#sopPdxHistClose').onclick = () => closeSopModal(modal);
    const body = modal.querySelector('#sopPdxHistBody');
    try {
      const res = await apiFetch(`/api/soportes/pdx/archivos/${archivoId}/historial`);
      const data = await res.json();
      const evs = data.eventos || [];
      if (!evs.length) {
        body.innerHTML = '<p class="sop-empty" style="padding:12px">Sin eventos registrados.</p>';
      } else {
        body.innerHTML = `<ul class="sop-hist-list">${evs.map((e) => {
          const tipo = PDX_LOG_LABEL[e.tipo] || e.tipo;
          const cuando = e.creado_en ? new Date(e.creado_en).toLocaleString('es-CO') : '';
          const quien = e.usuario_nombre ? escapeHtml(e.usuario_nombre) : 'Sistema';
          return `<li>
            <div class="sop-hist-tipo">${escapeHtml(tipo)}</div>
            <div class="sop-hist-meta">${quien} · ${escapeHtml(cuando)}${e.detalle ? ` · ${escapeHtml(e.detalle)}` : ''}</div>
          </li>`;
        }).join('')}</ul>`;
      }
      sopIcons(body);
    } catch (err) {
      body.innerHTML = `<p class="sop-empty" style="color:#dc2626">${escapeHtml(err.message)}</p>`;
    }
  }

  function modalReemplazarPdx(archivo) {
    const carpeta = pdxState.carpetaActual;
    const esEstruct = esCarpetaEstructuradaPdx(carpeta);
    const modal = openSopModal(`
      <h3><i data-lucide="file-up"></i> Reemplazar PDF</h3>
      <p style="font-size:.85rem;color:#64748b">Se actualiza el mismo registro (${escapeHtml(archivo.paciente_nombre)}). El PDF anterior se elimina del disco.</p>
      <div class="sop-field"><label>Nuevo archivo PDF</label><input type="file" id="sopPdxRepFile" accept=".pdf"></div>
      ${esEstruct ? '' : `<label class="sop-toggle sop-pdx-rep-opt" style="margin:8px 0"><input type="checkbox" id="sopPdxRepCorregir"> Corregir nombre del estudio</label>
      <div class="sop-field hidden sop-pdx-rep-opt" id="sopPdxRepEstWrap"><input type="text" id="sopPdxRepEst" value="${escapeHtml(archivo.estudio_texto || '')}" placeholder="PSG BASAL…"></div>`}
      <div class="sop-dialog-actions">
        <button type="button" class="sop-btn sop-btn-ghost" id="sopPdxRepCancel">Cancelar</button>
        <button type="button" class="sop-btn sop-btn-primary" id="sopPdxRepOk">Reemplazar</button>
      </div>`);
    const repFile = modal.querySelector('#sopPdxRepFile');
    modal.querySelector('#sopPdxRepCorregir')?.addEventListener('change', (e) => {
      modal.querySelector('#sopPdxRepEstWrap')?.classList.toggle('hidden', !e.target.checked);
    });
    modal.querySelector('#sopPdxRepCancel').onclick = () => closeSopModal(modal);
    modal.querySelector('#sopPdxRepOk').onclick = async () => {
      const file = repFile?.files?.[0];
      if (!file) return sopToast('Seleccione un PDF', 'warning');
      const parsed = parseNombrePorCarpetaCliente(file.name, carpeta);
      if (!parsed.ok) {
        return sopToast(parsed.error || mensajeErrorFormatoCliente(detectarTemaCarpetaCliente(carpeta?.nombre_display)), 'error');
      }
      const fd = new FormData();
      fd.append('file', file);
      if (!esEstruct && modal.querySelector('#sopPdxRepCorregir')?.checked) {
        const est = modal.querySelector('#sopPdxRepEst')?.value?.trim();
        if (est) fd.append('estudio_texto', est);
      }
      const res = await apiFetch(`/api/soportes/pdx/archivos/${archivo.id}/reemplazar`, { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) { sopToast(data.error || 'Error', 'error'); return; }
      if (data.warnings?.length) sopToast(data.warnings.join(' · '), 'warning');
      closeSopModal(modal);
      sopToast('PDF reemplazado', 'success');
      if (pdxState.carpetaId) abrirCarpetaPdx(pdxState.carpetaId);
    };
  }

  async function modalMoverCarpetaPdx(archivo) {
    if (!pdxState.carpetas.length) {
      await cargarCarpetasPdx();
    }
    const opts = pdxState.carpetas
      .filter((c) => c.id !== archivo.carpeta_id && c.estado_visibilidad !== 'archivo')
      .map((c) => `<option value="${c.id}">${escapeHtml(c.nombre_display)} (${escapeHtml(c.periodo)})</option>`)
      .join('');
    if (!opts) return sopToast('No hay otra carpeta abierta disponible', 'warning');
    const modal = openSopModal(`
      <h3><i data-lucide="folder-input"></i> Mover a otra carpeta</h3>
      <p style="font-size:.85rem;color:#64748b">${escapeHtml(archivo.paciente_nombre)}</p>
      <div class="sop-field"><label>Carpeta destino</label>
        <select id="sopPdxMoveDest"><option value="">— Seleccione —</option>${opts}</select></div>
      <div class="sop-dialog-actions">
        <button type="button" class="sop-btn sop-btn-ghost" id="sopPdxMoveCancel">Cancelar</button>
        <button type="button" class="sop-btn sop-btn-primary" id="sopPdxMoveOk">Mover</button>
      </div>`);
    modal.querySelector('#sopPdxMoveCancel').onclick = () => closeSopModal(modal);
    modal.querySelector('#sopPdxMoveOk').onclick = async () => {
      const dest = parseInt(modal.querySelector('#sopPdxMoveDest')?.value, 10);
      if (!dest) return sopToast('Seleccione carpeta destino', 'warning');
      const res = await apiFetch(`/api/soportes/pdx/archivos/${archivo.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ carpeta_id: dest })
      });
      const data = await res.json();
      if (!res.ok) { sopToast(data.error || 'Error', 'error'); return; }
      if (data.warnings?.length) sopToast(data.warnings.join(' · '), 'warning');
      closeSopModal(modal);
      sopToast('Archivo movido', 'success');
      if (pdxState.carpetaId) abrirCarpetaPdx(pdxState.carpetaId);
    };
  }

  function modalEditarArchivoPdx(archivo) {
    const esEstruct = esCarpetaEstructuradaPdx(pdxState.carpetaActual);
    const esPsg = esCarpetaPsgReportePdx(pdxState.carpetaActual);
    const modal = openSopModal(`
      <h3><i data-lucide="pencil"></i> Editar datos del reporte</h3>
      <div class="sop-field"><label>Apellidos</label><input type="text" id="sopPdxEdApe" value="${escapeHtml(archivo.apellidos || '')}"></div>
      <div class="sop-field"><label>Nombres</label><input type="text" id="sopPdxEdNom" value="${escapeHtml(archivo.nombres || '')}"></div>
      <div class="sop-field"><label>Fecha del estudio</label><input type="date" id="sopPdxEdFecha" value="${escapeHtml(archivo.fecha_estudio || '')}"></div>
      ${esEstruct || esPsg
        ? '<div class="sop-field"><label>Tipo de examen *</label><select id="sopPdxEdEst"></select></div>'
        : `<div class="sop-field"><label>Nombre del estudio</label><input type="text" id="sopPdxEdEst" value="${escapeHtml(archivo.estudio_texto || '')}" placeholder="PSG BASAL, EEG, VTM…"></div>`}
      <div class="sop-field"><label>Documento${(esEstruct || esPsg) ? ' *' : ' (opcional)'}</label><input type="text" id="sopPdxEdDoc" value="${escapeHtml(archivo.paciente_documento || '')}"></div>
      <p style="margin:8px 0 0"><button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" id="sopPdxEdHist"><i data-lucide="history"></i> Ver historial</button></p>
      <div class="sop-dialog-actions">
        <button type="button" class="sop-btn sop-btn-ghost" id="sopPdxEdCancel">Cancelar</button>
        <button type="button" class="sop-btn sop-btn-primary" id="sopPdxEdOk">Guardar</button>
      </div>`);
    if (esPsg) poblarSelectEstudioPsgCliente(modal.querySelector('#sopPdxEdEst'), archivo.estudio_texto);
    else if (esEstruct) poblarSelectEstudioPdx(modal.querySelector('#sopPdxEdEst'), archivo.estudio_texto);
    modal.querySelector('#sopPdxEdHist')?.addEventListener('click', () => {
      closeSopModal(modal);
      modalHistorialPdx(archivo.id);
    });
    modal.querySelector('#sopPdxEdCancel').onclick = () => closeSopModal(modal);
    modal.querySelector('#sopPdxEdOk').onclick = async () => {
      const estEl = modal.querySelector('#sopPdxEdEst');
      const body = {
        apellidos: $('sopPdxEdApe').value.trim(),
        nombres: $('sopPdxEdNom').value.trim(),
        fecha_estudio: $('sopPdxEdFecha').value,
        estudio_texto: (estEl?.tagName === 'SELECT' ? estEl.value : estEl?.value)?.trim(),
        paciente_documento: $('sopPdxEdDoc').value.trim().replace(/\s/g, '') || null
      };
      if (!body.apellidos || !body.nombres || !body.fecha_estudio || !body.estudio_texto) {
        return sopToast('Complete todos los campos obligatorios', 'warning');
      }
      if (esEstruct && !body.paciente_documento) {
        return sopToast('El número de documento es obligatorio', 'warning');
      }
      const res = await apiFetch(`/api/soportes/pdx/archivos/${archivo.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) { sopToast(data.error || 'Error', 'error'); return; }
      if (data.warnings?.length) sopToast(data.warnings.join(' · '), 'warning');
      closeSopModal(modal);
      sopToast('Reporte actualizado', 'success');
      if (pdxState.carpetaId) abrirCarpetaPdx(pdxState.carpetaId);
    };
  }

  function volverListaPdx() {
    pdxState.carpetaId = null;
    pdxState.carpetaActual = null;
    $('sopPdxVistaDetalle')?.classList.add('hidden');
    $('sopPdxVistaLista')?.classList.remove('hidden');
    cargarCarpetasPdx().then(renderListaCarpetasPdx).catch((e) => sopToast(e.message, 'error'));
    sopIcons($('view-reportes-pdx'));
  }

  function modalNuevaCarpetaPdx() {
    const per = periodoActual();
    const modal = openSopModal(`
      <h3><i data-lucide="folder-plus" style="vertical-align:-3px;width:22px"></i> Nueva carpeta de reportes</h3>
      <div class="sop-field"><label>Periodo</label><input type="month" id="sopPdxNewPeriodo" value="${per}"></div>
      <div class="sop-field"><label>Nombre de carpeta</label>
        <input type="text" id="sopPdxNewNombre" placeholder="REPORTES VTM, ORDENES, COMPROBANTES o CONSENTIMIENTOS…"></div>
      <div class="sop-dialog-actions">
        <button type="button" class="sop-btn sop-btn-ghost" id="sopPdxNewCancel">Cancelar</button>
        <button type="button" class="sop-btn sop-btn-primary" id="sopPdxNewOk">Crear carpeta</button>
      </div>`);
    modal.querySelector('#sopPdxNewCancel').onclick = () => closeSopModal(modal);
    modal.querySelector('#sopPdxNewOk').onclick = async () => {
      const periodo = $('sopPdxNewPeriodo').value;
      const nombre_display = $('sopPdxNewNombre').value.trim();
      const res = await apiFetch('/api/soportes/pdx/carpetas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ periodo, nombre_display })
      });
      const data = await res.json();
      if (!res.ok) { sopToast(data.error || 'Error', 'error'); return; }
      closeSopModal(modal);
      sopToast('Carpeta creada', 'success');
      await cargarCarpetasPdx();
      renderListaCarpetasPdx();
    };
  }

  async function subirArchivoPdx(file, carpetaId, extra) {
    const fd = new FormData();
    fd.append('file', file);
    if (extra) Object.keys(extra).forEach((k) => fd.append(k, extra[k]));
    const res = await apiFetch(`/api/soportes/pdx/carpetas/${carpetaId}/archivos`, { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) {
      const msg = [data.error, data.detail, data.step].filter(Boolean).join(' — ');
      throw new Error(msg || 'Error al subir');
    }
    if (data.warnings?.length) sopToast(data.warnings.join(' · '), 'warning');
    return data;
  }

  async function flujoSubidaPdx(file, carpetaId) {
    const analisis = await preAnalizarArchivoPdx(carpetaId, file.name);
    return modalDatosArchivoPdx(file, carpetaId, analisis);
  }

  function modalCorregirDatosPdx(file, carpetaId, carpeta, analisis, resolve, reject) {
    const tema = analisis.tema || detectarTemaCarpetaCliente(carpeta?.nombre_display || '');
    const p = analisis.parcial || {};
    const ayuda = ayudaFormatoCliente(tema);
    const esEstruct = esCarpetaEstructuradaPdx(carpeta);
    const esPsg = tema === 'psg';
    const motivoTxt = analisis.motivo === 'falta_estudio_psg'
      ? 'El nombre no incluye el tipo de estudio PSG (Básica, CPAP o BPAP). Complételo para continuar.'
      : `El nombre del archivo no cumple la estructura requerida. Complételo o corríjalo para subir el PDF.`;

    const modal = openSopModal(`
      <h3><i data-lucide="file-warning"></i> Completar datos del archivo</h3>
      <p style="font-size:.85rem;color:#64748b;margin:-8px 0 10px">${escapeHtml(motivoTxt)}</p>
      <p style="font-size:.8rem;color:#94a3b8;margin:0 0 10px"><strong>Formato esperado:</strong> <code>${escapeHtml(ayuda.pattern)}</code></p>
      <dl class="sop-upload-preview" style="margin-bottom:12px">
        <dt>Archivo</dt><dd>${escapeHtml(file.name)}</dd>
      </dl>
      <div class="sop-field"><label>Apellidos *</label><input type="text" id="sopPdxCorrApe" value="${escapeHtml(p.apellidos || '')}"></div>
      <div class="sop-field"><label>Nombres *</label><input type="text" id="sopPdxCorrNom" value="${escapeHtml(p.nombres || '')}"></div>
      ${esEstruct ? `
      <div class="sop-field"><label>Tipo de documento</label><input type="text" id="sopPdxCorrTipoDoc" value="${escapeHtml(p.tipo_documento || 'CC')}"></div>
      <div class="sop-field"><label>Número de documento *</label><input type="text" id="sopPdxCorrDoc" value="${escapeHtml(p.paciente_documento || '')}" inputmode="numeric"></div>` : `
      <div class="sop-field"><label>Documento (opcional)</label><input type="text" id="sopPdxCorrDoc" value="${escapeHtml(p.paciente_documento || '')}" inputmode="numeric"></div>`}
      <div class="sop-field"><label>Fecha del estudio *</label><input type="date" id="sopPdxCorrFecha" value="${escapeHtml(p.fecha_estudio || '')}"></div>
      ${(esEstruct || esPsg) ? '<div class="sop-field"><label>Tipo de examen *</label><select id="sopPdxCorrEst"></select></div>' : ''}
      <div class="sop-dialog-actions">
        <button type="button" class="sop-btn sop-btn-ghost" id="sopPdxCorrCancel">Cancelar</button>
        <button type="button" class="sop-btn sop-btn-primary" id="sopPdxCorrOk">Subir PDF</button>
      </div>`);

    const estSel = modal.querySelector('#sopPdxCorrEst');
    if (esPsg) poblarSelectEstudioPsgCliente(estSel, p.estudio_texto);
    else if (esEstruct) poblarSelectEstudioPdx(estSel, p.estudio_texto);

    modal.querySelector('#sopPdxCorrCancel').onclick = () => { closeSopModal(modal); reject(new Error('cancelado')); };
    modal.querySelector('#sopPdxCorrOk').onclick = async () => {
      const body = {
        confirmacion_manual: '1',
        apellidos: modal.querySelector('#sopPdxCorrApe')?.value?.trim(),
        nombres: modal.querySelector('#sopPdxCorrNom')?.value?.trim(),
        tipo_documento: modal.querySelector('#sopPdxCorrTipoDoc')?.value?.trim() || 'CC',
        paciente_documento: modal.querySelector('#sopPdxCorrDoc')?.value?.trim().replace(/\s/g, '') || '',
        fecha_estudio: modal.querySelector('#sopPdxCorrFecha')?.value,
        estudio_texto: estSel?.value?.trim() || ''
      };
      if (!body.apellidos || !body.nombres || !body.fecha_estudio) {
        return sopToast('Complete apellidos, nombres y fecha', 'warning');
      }
      if (esEstruct && (!body.paciente_documento || !body.estudio_texto)) {
        return sopToast('Complete documento y tipo de examen', 'warning');
      }
      if (esPsg && !body.estudio_texto) {
        return sopToast('Seleccione el tipo de estudio PSG', 'warning');
      }
      try {
        await subirArchivoPdx(file, carpetaId, body);
        closeSopModal(modal);
        sopToast('Archivo subido', 'success');
        resolve();
      } catch (e) { sopToast(e.message, 'error'); }
    };
  }

  function modalSubidaPsgCompleto(file, carpetaId, carpeta, parsed, resolve, reject) {
    const modal = openSopModal(`
      <h3><i data-lucide="file-check"></i> Confirmar reporte PSG</h3>
      <p style="font-size:.85rem;color:#64748b;margin:-8px 0 12px">El nombre cumple la estructura PSG. Revise los datos:</p>
      <dl class="sop-upload-preview">
        <dt>Archivo</dt><dd>${escapeHtml(file.name)}</dd>
      </dl>
      <div class="sop-field"><label>Nombres *</label><input type="text" id="sopPdxPsgNom" value="${escapeHtml(parsed.nombres)}"></div>
      <div class="sop-field"><label>Apellidos *</label><input type="text" id="sopPdxPsgApe" value="${escapeHtml(parsed.apellidos)}"></div>
      <div class="sop-field"><label>Número de documento *</label><input type="text" id="sopPdxPsgDoc" value="${escapeHtml(parsed.paciente_documento || '')}" inputmode="numeric"></div>
      <div class="sop-field"><label>Fecha del estudio *</label><input type="date" id="sopPdxPsgFecha" value="${escapeHtml(parsed.fecha_estudio || '')}"></div>
      <div class="sop-field"><label>Tipo de PSG *</label><select id="sopPdxPsgEst"></select></div>
      <div class="sop-dialog-actions">
        <button type="button" class="sop-btn sop-btn-ghost" id="sopPdxPsgUpCancel">Cancelar</button>
        <button type="button" class="sop-btn sop-btn-primary" id="sopPdxPsgUpOk">Subir PDF</button>
      </div>`);
    poblarSelectEstudioPsgCliente(modal.querySelector('#sopPdxPsgEst'), parsed.estudio_texto);
    modal.querySelector('#sopPdxPsgUpCancel').onclick = () => { closeSopModal(modal); reject(new Error('cancelado')); };
    modal.querySelector('#sopPdxPsgUpOk').onclick = async () => {
      const body = {
        apellidos: modal.querySelector('#sopPdxPsgApe')?.value?.trim(),
        nombres: modal.querySelector('#sopPdxPsgNom')?.value?.trim(),
        paciente_documento: modal.querySelector('#sopPdxPsgDoc')?.value?.trim().replace(/\s/g, ''),
        fecha_estudio: modal.querySelector('#sopPdxPsgFecha')?.value,
        estudio_texto: modal.querySelector('#sopPdxPsgEst')?.value?.trim()
      };
      if (!body.apellidos || !body.nombres || !body.paciente_documento || !body.fecha_estudio || !body.estudio_texto) {
        return sopToast('Complete nombres, apellidos, documento, fecha y tipo PSG', 'warning');
      }
      try {
        await subirArchivoPdx(file, carpetaId, body);
        closeSopModal(modal);
        sopToast('Archivo subido', 'success');
        resolve();
      } catch (e) { sopToast(e.message, 'error'); }
    };
  }

  function modalSubidaEstructuradaCompleto(file, carpetaId, carpeta, parsed, resolve, reject) {
    const tema = detectarTemaCarpetaCliente(carpeta?.nombre_display || '');
    const label = TEMA_LABEL[tema] || 'Documento';
    const modal = openSopModal(`
      <h3><i data-lucide="file-check"></i> Confirmar ${escapeHtml(label.toLowerCase())}</h3>
      <p style="font-size:.85rem;color:#64748b;margin:-8px 0 12px">El nombre del archivo cumple la estructura requerida. Revise o ajuste los datos:</p>
      <dl class="sop-upload-preview">
        <dt>Archivo</dt><dd>${escapeHtml(file.name)}</dd>
      </dl>
      <div class="sop-field"><label>Apellidos *</label><input type="text" id="sopPdxOrdApe" value="${escapeHtml(parsed.apellidos)}"></div>
      <div class="sop-field"><label>Nombres *</label><input type="text" id="sopPdxOrdNom" value="${escapeHtml(parsed.nombres)}"></div>
      <div class="sop-field"><label>Tipo de documento</label><input type="text" id="sopPdxOrdTipoDoc" value="${escapeHtml(parsed.tipo_documento || '')}" readonly></div>
      <div class="sop-field"><label>Número de documento *</label><input type="text" id="sopPdxOrdDoc" value="${escapeHtml(parsed.paciente_documento || '')}" inputmode="numeric"></div>
      <div class="sop-field"><label>Fecha *</label><input type="date" id="sopPdxOrdFecha" value="${escapeHtml(parsed.fecha_estudio || '')}"></div>
      <div class="sop-field"><label>Tipo de examen *</label><select id="sopPdxOrdEst"></select></div>
      <div class="sop-dialog-actions">
        <button type="button" class="sop-btn sop-btn-ghost" id="sopPdxOrdUpCancel">Cancelar</button>
        <button type="button" class="sop-btn sop-btn-primary" id="sopPdxOrdUpOk">Subir PDF</button>
      </div>`);
    poblarSelectEstudioPdx(modal.querySelector('#sopPdxOrdEst'), parsed.estudio_texto);
    modal.querySelector('#sopPdxOrdUpCancel').onclick = () => { closeSopModal(modal); reject(new Error('cancelado')); };
    modal.querySelector('#sopPdxOrdUpOk').onclick = async () => {
      const body = {
        apellidos: modal.querySelector('#sopPdxOrdApe')?.value?.trim(),
        nombres: modal.querySelector('#sopPdxOrdNom')?.value?.trim(),
        paciente_documento: modal.querySelector('#sopPdxOrdDoc')?.value?.trim().replace(/\s/g, ''),
        fecha_estudio: modal.querySelector('#sopPdxOrdFecha')?.value,
        estudio_texto: modal.querySelector('#sopPdxOrdEst')?.value?.trim()
      };
      if (!body.apellidos || !body.nombres || !body.paciente_documento || !body.fecha_estudio || !body.estudio_texto) {
        return sopToast('Complete apellidos, nombres, documento, fecha y tipo de examen', 'warning');
      }
      try {
        await subirArchivoPdx(file, carpetaId, body);
        closeSopModal(modal);
        sopToast('Archivo subido', 'success');
        resolve();
      } catch (e) { sopToast(e.message, 'error'); }
    };
  }

  function modalSubidaPdxNombreCompleto(file, carpetaId, carpeta, parsed, resolve, reject) {
    const warns = pdxUploadWarnings(parsed, carpeta);
    const estudioInferido = parsed.estudio_texto || inferirEstudioCliente(carpeta);
    const modal = openSopModal(`
      <h3><i data-lucide="file-check"></i> Confirmar carga</h3>
      <p style="font-size:.85rem;color:#64748b;margin:-8px 0 12px">El nombre del archivo cumple la estructura mínima. Revise los datos detectados:</p>
      <dl class="sop-upload-preview">
        <dt>Archivo</dt><dd>${escapeHtml(file.name)}</dd>
        <dt>Paciente</dt><dd>${escapeHtml(parsed.paciente_nombre)}</dd>
        <dt>Fecha estudio</dt><dd>${escapeHtml(parsed.fecha_estudio)}</dd>
        <dt>Estudio al descargar</dt><dd><strong>${escapeHtml(estudioInferido || '—')}</strong></dd>
      </dl>
      ${warns.length ? `<div class="sop-upload-warn">${escapeHtml(warns.join(' '))}</div>` : '<div class="sop-upload-ok">Los datos se leyeron del nombre del archivo. El tipo de estudio se añadirá al descargar.</div>'}
      <div class="sop-dialog-actions">
        <button type="button" class="sop-btn sop-btn-ghost" id="sopPdxUpCancel">Cancelar</button>
        <button type="button" class="sop-btn sop-btn-primary" id="sopPdxUpOk">Subir PDF</button>
      </div>`);
    modal.querySelector('#sopPdxUpCancel').onclick = () => { closeSopModal(modal); reject(new Error('cancelado')); };
    modal.querySelector('#sopPdxUpOk').onclick = async () => {
      try {
        await subirArchivoPdx(file, carpetaId);
        closeSopModal(modal);
        sopToast('Archivo subido', 'success');
        resolve();
      } catch (e) { sopToast(e.message, 'error'); }
    };
  }

  async function modalSubidaLotePdx(files, carpetaId) {
    const carpeta = pdxState.carpetaActual || pdxState.carpetas.find((c) => c.id === carpetaId);
    const tema = detectarTemaCarpetaCliente(carpeta?.nombre_display || '');
    const items = await Promise.all(files.map(async (file, idx) => {
      let analisis;
      try {
        analisis = await preAnalizarArchivoPdx(carpetaId, file.name);
      } catch (e) {
        analisis = { requiere_correccion: true, error: e.message, campos: [], parcial: {} };
      }
      return {
        idx,
        file,
        analisis,
        parsed: analisis.parsed,
        necesitaCorreccion: !!analisis.requiere_correccion
      };
    }));
    const listos = items.filter((it) => !it.necesitaCorreccion);
    if (!listos.length) {
      return (async () => {
        for (const it of items) {
          await flujoSubidaPdx(it.file, carpetaId);
        }
      })();
    }
    const filas = items.map((it) => {
      if (!it.necesitaCorreccion) {
        const d = it.analisis.parcial || it.parsed || {};
        const paciente = (d.apellidos && d.nombres) ? `${d.apellidos}, ${d.nombres}` : (it.parsed?.paciente_nombre || '—');
        const w = pdxUploadWarnings(it.parsed || d, carpeta);
        const est = d.estudio_texto || it.parsed?.estudio_texto || inferirEstudioCliente(carpeta);
        return `<tr data-lote-idx="${it.idx}">
          <td>${escapeHtml(it.file.name)}</td>
          <td>${escapeHtml(paciente)}</td>
          <td>${escapeHtml(d.fecha_estudio || '—')}</td>
          <td>${escapeHtml(est || '—')}</td>
          <td>${w.length ? '<span style="color:#b45309">Revisar</span>' : '<span style="color:#059669">OK</span>'}</td>
        </tr>`;
      }
      const ayuda = ayudaFormatoCliente(tema);
      return `<tr class="sop-lote-invalid" data-lote-idx="${it.idx}">
        <td>${escapeHtml(it.file.name)}</td>
        <td colspan="3" style="color:#b45309;font-size:.85rem">${escapeHtml(it.analisis.error || 'Datos incompletos')}</td>
        <td><button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-lote-corregir="${it.idx}">Completar datos</button></td>
      </tr>`;
    }).join('');

    return new Promise((resolve, reject) => {
      const pendientes = items.length - listos.length;
      const modal = openSopModal(`
        <h3><i data-lucide="files"></i> Confirmar carga (${listos.length} PDF)</h3>
        <p style="font-size:.85rem;color:#64748b;margin:-6px 0 12px">Carpeta: <strong>${escapeHtml(carpeta?.nombre_display || '')}</strong>${pendientes ? ` — ${pendientes} archivo(s) requieren completar datos antes de subir.` : ''}</p>
        <div style="max-height:50vh;overflow:auto">
          <table class="sop-lote-table">
            <thead><tr><th>Archivo</th><th>Paciente</th><th>Fecha</th><th>Estudio</th><th></th></tr></thead>
            <tbody>${filas}</tbody>
          </table>
        </div>
        <div class="sop-dialog-actions" style="margin-top:14px">
          <button type="button" class="sop-btn sop-btn-ghost" id="sopPdxLoteCancel">Cancelar</button>
          <button type="button" class="sop-btn sop-btn-primary" id="sopPdxLoteOk"${listos.length ? '' : ' disabled'}>Subir ${listos.length} archivo(s)</button>
        </div>`);
      modal.querySelectorAll('[data-lote-corregir]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const idx = parseInt(btn.dataset.loteCorregir, 10);
          const it = items.find((x) => x.idx === idx);
          if (!it) return;
          try {
            await modalDatosArchivoPdx(it.file, carpetaId, it.analisis);
            btn.closest('tr')?.remove();
            it.necesitaCorreccion = false;
            const restantes = items.filter((x) => x.necesitaCorreccion).length;
            const okBtn = modal.querySelector('#sopPdxLoteOk');
            const nuevosListos = items.filter((x) => !x.necesitaCorreccion).length;
            if (okBtn) {
              okBtn.disabled = nuevosListos === 0;
              okBtn.textContent = `Subir ${nuevosListos} archivo(s)`;
            }
            if (!restantes) {
              closeSopModal(modal);
              resolve();
            }
          } catch (e) {
            if (e.message !== 'cancelado') sopToast(e.message, 'error');
          }
        });
      });
      modal.querySelector('#sopPdxLoteCancel').onclick = () => { closeSopModal(modal); reject(new Error('cancelado')); };
      modal.querySelector('#sopPdxLoteOk').onclick = async () => {
        const extras = listos.map((it) => {
          const extra = it.analisis.formato_completo ? undefined : {
            confirmacion_manual: '1',
            ...(it.analisis.parcial || {})
          };
          return { file: it.file, extra };
        });
        const btn = modal.querySelector('#sopPdxLoteOk');
        btn.disabled = true;
        let ok = 0;
        let fail = 0;
        for (const { file, extra } of extras) {
          try {
            await subirArchivoPdx(file, carpetaId, extra);
            ok++;
          } catch (e) {
            fail++;
            sopToast(`${file.name}: ${e.message}`, 'error');
          }
        }
        closeSopModal(modal);
        if (ok) sopToast(`${ok} archivo(s) subido(s)${fail ? `, ${fail} con error` : ''}`, fail ? 'warning' : 'success');
        resolve();
      };
    });
  }

  async function procesarArchivosPdx(files, carpetaId) {
    if (!files?.length || !carpetaId) return;
    const pdfs = [...files].filter((f) => {
      if (!f.name.toLowerCase().endsWith('.pdf')) {
        sopToast(`${f.name}: solo PDF`, 'warning');
        return false;
      }
      return true;
    });
    if (!pdfs.length) return;
    try {
      if (pdfs.length === 1) {
        await flujoSubidaPdx(pdfs[0], carpetaId);
      } else {
        await modalSubidaLotePdx(pdfs, carpetaId);
      }
    } catch (e) {
      if (e.message !== 'cancelado') sopToast(e.message, 'error');
      return;
    }
    abrirCarpetaPdx(carpetaId);
  }

  async function buscarPdx() {
    const q = $('sopPdxBuscar')?.value?.trim();
    if (!q || q.length < 2) {
      cerrarResultadosPdx(false);
      return;
    }
    const el = $('sopPdxResultados');
    el.classList.remove('hidden');
    el.innerHTML = `<div class="sop-search-results-head"><h4>Resultados de búsqueda</h4><span class="sop-search-results-meta">Buscando…</span></div>
      <div class="sop-search-results-body"><div class="sop-empty" style="padding:24px"><i data-lucide="loader" class="sop-empty-icon"></i></div></div>`;
    sopIcons(el);
    const res = await apiFetch(`/api/soportes/pdx/buscar?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    const list = data.resultados || [];
    if (!list.length) {
      el.innerHTML = `<div class="sop-search-results-head">
          <h4>Resultados de búsqueda</h4>
          <span class="sop-search-results-meta">Sin coincidencias</span>
          <button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-close-pdx-search><i data-lucide="x"></i> Cerrar</button>
        </div>
        <div class="sop-search-results-body"><div class="sop-empty" style="padding:20px">No se encontraron archivos para «${escapeHtml(q)}»</div></div>`;
      el.querySelector('[data-close-pdx-search]')?.addEventListener('click', cerrarResultadosPdx);
      sopIcons(el);
      return;
    }
    el.innerHTML = `<div class="sop-search-results-head">
        <h4>Resultados de búsqueda</h4>
        <span class="sop-search-results-meta">${list.length} encontrado${list.length !== 1 ? 's' : ''}</span>
        <button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-close-pdx-search><i data-lucide="x"></i> Cerrar</button>
      </div>
      <div class="sop-search-results-body">
        <div class="sop-table-wrap"><table class="sop-table"><thead><tr>
          <th>Paciente</th><th>Fecha</th><th>Carpeta</th><th></th></tr></thead><tbody>
          ${list.map((r) => `<tr>
            <td>${escapeHtml(r.paciente_nombre)}</td>
            <td>${escapeHtml(r.fecha_estudio || '—')}</td>
            <td>${escapeHtml(r.carpeta_nombre)} <span class="sop-search-results-meta">(${escapeHtml(r.periodo)})</span></td>
            <td><button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-open-carpeta="${r.carpeta_id}"><i data-lucide="folder-open"></i> Abrir</button></td>
          </tr>`).join('')}
        </tbody></table></div>
      </div>`;
    el.querySelector('[data-close-pdx-search]')?.addEventListener('click', cerrarResultadosPdx);
    el.querySelectorAll('[data-open-carpeta]').forEach((b) => {
      b.addEventListener('click', () => { cerrarResultadosPdx(); abrirCarpetaPdx(parseInt(b.dataset.openCarpeta, 10)); });
    });
    sopIcons(el);
  }

  const buscarPdxPredictivo = sopDebounce(() => buscarPdx(), 320);

  async function buscarArmadoPaciente() {
    const q = $('sopArmBuscarPaciente')?.value?.trim();
    const el = $('sopArmBuscarResultados');
    if (!el) return;
    if (!q || q.length < 2) {
      cerrarResultadosArmado(false);
      return;
    }
    el.classList.remove('hidden');
    el.innerHTML = `<div class="sop-search-results-head"><h4>Resultados de búsqueda</h4><span class="sop-search-results-meta">Buscando…</span></div>
      <div class="sop-search-results-body"><div class="sop-empty" style="padding:24px"><i data-lucide="loader" class="sop-empty-icon"></i></div></div>`;
    sopIcons(el);
    try {
      const res = await apiFetch(`/api/soportes/armado/buscar?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      const list = data.resultados || [];
      if (!list.length) {
        el.innerHTML = `<div class="sop-search-results-head">
            <h4>Resultados de búsqueda</h4>
            <span class="sop-search-results-meta">Sin coincidencias</span>
            <button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-close-arm-search><i data-lucide="x"></i> Cerrar</button>
          </div>
          <div class="sop-search-results-body"><div class="sop-empty" style="padding:20px">No se encontraron expedientes para «${escapeHtml(q)}»</div></div>`;
        el.querySelector('[data-close-arm-search]')?.addEventListener('click', () => cerrarResultadosArmado());
        sopIcons(el);
        return;
      }
      el.innerHTML = `<div class="sop-search-results-head">
          <h4>Resultados de búsqueda</h4>
          <span class="sop-search-results-meta">${list.length} encontrado${list.length !== 1 ? 's' : ''}</span>
          <button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-close-arm-search><i data-lucide="x"></i> Cerrar</button>
        </div>
        <div class="sop-search-results-body">
          <div class="sop-table-wrap"><table class="sop-table"><thead><tr>
            <th>Paciente</th><th>Carpeta</th><th>Ubicación</th><th></th></tr></thead><tbody>
            ${list.map((r) => {
              const factura = (r.numero_factura != null && Number(r.numero_factura) > 0)
                ? ` · FE${r.numero_factura}` : '';
              const tipo = r.contenedor_tipo === 'rips' ? 'RIPS' : 'SOPORTES';
              return `<tr>
                <td><strong>${escapeHtml(r.paciente_nombre || r.codigo)}</strong>
                  ${r.paciente_documento ? `<div class="sop-search-results-meta">Doc. ${escapeHtml(r.paciente_documento)}</div>` : ''}</td>
                <td>${escapeHtml(r.codigo || '—')}${factura}</td>
                <td>${escapeHtml(r.periodo_etiqueta || r.periodo)} · ${escapeHtml(r.dia_nombre)} · ${tipo}</td>
                <td><button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-open-exp="${r.expediente_id}"
                  data-periodo-id="${r.periodo_id}" data-dia-id="${r.dia_id}" data-contenedor-id="${r.contenedor_id}">
                  <i data-lucide="folder-open"></i> Abrir</button></td>
              </tr>`;
            }).join('')}
          </tbody></table></div>
        </div>`;
      el.querySelector('[data-close-arm-search]')?.addEventListener('click', () => cerrarResultadosArmado());
      el.querySelectorAll('[data-open-exp]').forEach((b) => {
        b.addEventListener('click', () => {
          navegarAExpedienteArmado({
            expediente_id: parseInt(b.dataset.openExp, 10),
            periodo_id: parseInt(b.dataset.periodoId, 10),
            dia_id: parseInt(b.dataset.diaId, 10),
            contenedor_id: parseInt(b.dataset.contenedorId, 10)
          });
        });
      });
      sopIcons(el);
    } catch (e) {
      el.innerHTML = `<div class="sop-search-results-body"><div class="sop-empty" style="padding:20px;color:#dc2626">${escapeHtml(e.message)}</div></div>`;
    }
  }

  const buscarArmadoPacientePredictivo = sopDebounce(() => buscarArmadoPaciente(), 320);

  async function navegarAExpedienteArmado(r) {
    if (!r?.expediente_id) return;
    cerrarResultadosArmado(false);
    try {
      if (!armState.periodos.length) await cargarPeriodosArmado();
      if (armState.periodoId !== r.periodo_id) await seleccionarPeriodoArmado(r.periodo_id);
      if (armState.diaId !== r.dia_id) await seleccionarDiaArmado(r.dia_id);
      if (armState.contenedorId !== r.contenedor_id) await seleccionarContenedorArmado(r.contenedor_id);
      await abrirExpedienteArmado(r.expediente_id);
      sopArmNavOpen(false);
    } catch (e) {
      sopToast(e.message || 'No se pudo abrir el expediente', 'error');
    }
  }

  async function modalVincularDeposito(pdxArchivoId, meta = {}) {
    const res = await apiFetch('/api/soportes/armado/expedientes-select');
    const data = await res.json();
    if (!res.ok) { sopToast(data.error || 'Error', 'error'); return; }
    const destLabel = meta.destino_importacion || 'expediente';
    const opts = (data.expedientes || []).map((e) =>
      `<option value="${e.id}">${escapeHtml(e.codigo)} · ${escapeHtml(e.paciente_nombre || 'Sin paciente')} (${escapeHtml(e.periodo)} · ${escapeHtml(e.dia_nombre || '')})</option>`
    ).join('');
    const modal = openSopModal(`
      <h3><i data-lucide="link-2" style="vertical-align:-3px;width:20px"></i> Vincular a carpeta FE</h3>
      <p style="font-size:.85rem;color:#64748b;margin:-6px 0 12px">Se copiará al expediente como <strong>${escapeHtml(destLabel)}</strong> (carpeta SOPORTES).</p>
      <div class="sop-field"><label>Carpeta FE (SOPORTES)</label>
        <select id="sopLinkExp"><option value="">— Seleccione —</option>${opts}</select></div>
      <div class="sop-dialog-actions">
        <button type="button" class="sop-btn sop-btn-ghost" id="sopLinkCancel">Cancelar</button>
        <button type="button" class="sop-btn sop-btn-primary" id="sopLinkOk">Vincular</button>
      </div>`);
    modal.querySelector('#sopLinkCancel').onclick = () => closeSopModal(modal);
    modal.querySelector('#sopLinkOk').onclick = async () => {
      const expId = parseInt($('sopLinkExp').value, 10);
      if (!expId) return sopToast('Seleccione un expediente', 'warning');
      const btn = modal.querySelector('#sopLinkOk');
      btn.disabled = true;
      const r2 = await apiFetch(`/api/soportes/armado/expedientes/${expId}/importar-deposito`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdx_archivo_id: pdxArchivoId })
      });
      const d2 = await r2.json();
      btn.disabled = false;
      if (!r2.ok) { sopToast(d2.error || 'Error al vincular', 'error'); return; }
      if (d2.warnings?.length) sopToast(d2.warnings.join(' · '), 'warning');
      closeSopModal(modal);
      sopToast(d2.message || 'Archivo vinculado', 'success');
    };
  }

  window.initReportesPdx = function initReportesPdx() {
    sopIcons($('view-reportes-pdx'));
    sopAnimateModuleIn('view-reportes-pdx');
    if (initPdxDone) {
      cargarCarpetasPdx().then(renderListaCarpetasPdx).catch(console.error);
      return;
    }
    initPdxDone = true;
    setupPdxFiltros();
    sopIcons($('sopPdxFiltrosBar'));
    const btnNueva = $('btnSopPdxNuevaCarpeta');
    if (btnNueva) btnNueva.style.display = sopPerm('soportes.pdx.crear_carpeta') ? '' : 'none';
    $('btnVolverReportesPdx')?.addEventListener('click', goToMenu);
    $('btnSopPdxNuevaCarpeta')?.addEventListener('click', modalNuevaCarpetaPdx);
    $('btnSopPdxBuscar')?.addEventListener('click', buscarPdx);
    $('sopPdxBuscar')?.addEventListener('input', buscarPdxPredictivo);
    $('sopPdxBuscar')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); buscarPdx(); }
      if (e.key === 'Escape') cerrarResultadosPdx();
    });
    renderPdxTemaLegend();
    $('sopPdxUploadInput')?.addEventListener('change', async (e) => {
      const files = e.target.files;
      if (!files?.length || !pdxState.carpetaId) return;
      await procesarArchivosPdx([...files], pdxState.carpetaId);
      e.target.value = '';
    });
    setupDropzone();
    cargarCarpetasPdx(false).then(renderListaCarpetasPdx).catch((e) => sopToast(e.message, 'error'));
  };

  // ─── Armado de soportes ───────────────────────────────────────────────────

  async function cargarPeriodosArmado() {
    showSkeletonNavList($('sopArmPeriodos'), 5);
    const res = await apiFetch('/api/soportes/armado/periodos');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error');
    armState.periodos = data.periodos || [];
    return data;
  }

  function renderPeriodosArmado() {
    const el = $('sopArmPeriodos');
    if (!armState.periodos.length) {
      el.innerHTML = '<div class="sop-empty" style="padding:16px;font-size:.85rem">Sin periodos</div>';
      return;
    }
    el.innerHTML = armState.periodos.map((p) =>
      `<div class="sop-nav-item${armState.periodoId === p.id ? ' active' : ''}" data-periodo-id="${p.id}">
        <span>${escapeHtml(p.etiqueta || p.periodo)}</span>
        ${badgeVis(p.estado_visibilidad, p.dias_restantes_gracia)}
      </div>`
    ).join('');
    el.querySelectorAll('[data-periodo-id]').forEach((item) => {
      item.addEventListener('click', () => seleccionarPeriodoArmado(parseInt(item.dataset.periodoId, 10)));
    });
    sopIcons(el);
  }

  async function seleccionarPeriodoArmado(id) {
    armState.periodoId = id;
    armState.diaId = null;
    armState.diaLabel = null;
    armState.diaFacturacion = null;
    armState.contenedores = [];
    armState.contenedorId = null;
    armState.contenedorTipo = null;
    armState.expedienteId = null;
    armState.expedienteCodigo = null;
    armState.vista = 'period';
    const per = armState.periodos.find((p) => p.id === id);
    armState.periodoLabel = per?.etiqueta || per?.periodo || 'Mes';
    renderPeriodosArmado();
    const diasEl = $('sopArmDias');
    if (diasEl) diasEl.innerHTML = '<div class="sop-empty" style="padding:12px;font-size:.78rem;color:#94a3b8">Carpetas del mes → panel principal</div>';
    const res = await apiFetch(`/api/soportes/armado/periodos/${id}/dias`);
    const data = await res.json();
    armState.dias = data.dias || [];
    renderArmadoPeriodoSummary();
    renderArmadoDiasExplorer();
    renderArmadoContextBar();
    sopArmNavOpen(false);
  }

  function renderArmadoDiasExplorer() {
    const panel = $('sopArmExpedientePanel');
    if (!panel || !armState.periodoId) return;
    armState.vista = 'period';
    const puedeGestionarDia = sopPerm('soportes.armado.crear_estructura');
    panel.innerHTML = `<div class="sop-panel-head">
        <div>
          <h3 style="margin:0"><i data-lucide="calendar"></i> ${escapeHtml(armState.periodoLabel || 'Mes')}</h3>
          <p style="margin:6px 0 0;font-size:.85rem;color:#64748b">Elija una carpeta de día. Dentro encontrará RIPS y SOPORTES con las carpetas FE.</p>
        </div>
        ${puedeGestionarDia ? `<button type="button" class="sop-btn sop-btn-teal" id="btnSopArmNuevoDiaInline"><i data-lucide="folder-plus"></i> Carpeta de día</button>` : ''}
      </div>
      <div class="sop-panel-body">
        <div id="sopArmDiasGrid" class="sop-folder-explorer-grid"></div>
      </div>`;
    const grid = panel.querySelector('#sopArmDiasGrid');
    if (!armState.dias.length) {
      grid.innerHTML = '<div class="sop-empty" style="grid-column:1/-1;padding:32px"><i data-lucide="folder-plus" class="sop-empty-icon"></i>Sin carpetas de día — cree la primera</div>';
    } else {
      grid.innerHTML = armState.dias.map((d) => `
        <article class="sop-folder-card${armState.diaId === d.id ? ' is-active' : ''}" data-dia-id="${d.id}" tabindex="0">
          <div class="sop-folder-card-icon"><i data-lucide="folder"></i></div>
          <div class="sop-folder-card-title">${escapeHtml(d.nombre_display)}</div>
          <div class="sop-folder-card-meta">${badgeFacturacionArmado(d.estado_facturacion)}</div>
          <div class="sop-folder-card-count"><strong>${d.expedientes_count || 0}</strong> expediente(s) FE</div>
          ${puedeGestionarDia ? `<div class="sop-folder-card-actions">
            <button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-dia-edit="${d.id}" title="Editar"><i data-lucide="pencil"></i></button>
            <button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-dia-del="${d.id}" data-dia-nom="${escapeHtml(d.nombre_display)}" title="Eliminar"><i data-lucide="trash-2"></i></button>
          </div>` : ''}
        </article>`).join('');
      grid.querySelectorAll('[data-dia-id]').forEach((card) => {
        const open = () => seleccionarDiaArmado(parseInt(card.dataset.diaId, 10));
        card.addEventListener('click', (ev) => {
          if (ev.target.closest('[data-dia-edit],[data-dia-del]')) return;
          open();
        });
        card.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') open(); });
      });
      grid.querySelectorAll('[data-dia-edit]').forEach((btn) => {
        btn.addEventListener('click', (ev) => { ev.stopPropagation(); modalEditarDiaArmado(parseInt(btn.dataset.diaEdit, 10)); });
      });
      grid.querySelectorAll('[data-dia-del]').forEach((btn) => {
        btn.addEventListener('click', (ev) => { ev.stopPropagation(); modalEliminarDiaArmado(parseInt(btn.dataset.diaDel, 10), btn.dataset.diaNom); });
      });
    }
    panel.querySelector('#btnSopArmNuevoDiaInline')?.addEventListener('click', modalNuevoDiaArmado);
    sopIcons(panel);
  }

  function renderArmadoPlaceholder(msg) {
    armState.vista = armState.periodoId ? (armState.diaId ? 'day' : 'period') : 'empty';
    armState.expedienteId = null;
    armState.expedienteCodigo = null;
    if (!armState.periodoId) {
      const sum = $('sopArmPeriodoSummary');
      if (sum) { sum.classList.add('hidden'); sum.innerHTML = ''; }
    }
    $('sopArmExpedientePanel').innerHTML = `<div class="sop-panel-body"><div class="sop-empty">
      <i data-lucide="layers" class="sop-empty-icon"></i>${escapeHtml(msg)}</div></div>`;
    sopIcons($('sopArmExpedientePanel'));
    renderArmadoContextBar();
  }

  async function seleccionarDiaArmado(id) {
    armState.diaId = id;
    armState.contenedorId = null;
    armState.contenedorTipo = null;
    armState.expedienteId = null;
    armState.expedienteCodigo = null;
    armState.vista = 'day';
    const diaRow = armState.dias.find((d) => d.id === id);
    armState.diaLabel = diaRow?.nombre_display || 'Carpeta';
    armState.diaFacturacion = diaRow?.estado_facturacion || 'a_facturar';
    const panel = $('sopArmExpedientePanel');
    panel.innerHTML = `<div class="sop-panel-head">
        <div>
          <h3 style="margin:0"><i data-lucide="folder-open"></i> ${escapeHtml(armState.diaLabel)}</h3>
          <div style="margin-top:6px">${badgeFacturacionArmado(armState.diaFacturacion)}</div>
        </div>
        <button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" id="btnSopArmVolverMes"><i data-lucide="arrow-left"></i> ${escapeHtml(armState.periodoLabel || 'Mes')}</button>
      </div>
      <div class="sop-panel-body">
        <p class="sop-explorer-hint">Dos carpetas por día: <strong>RIPS</strong> (JSON/XML) y <strong>SOPORTES</strong> (PDF del expediente).</p>
        <div id="sopArmContenedoresGrid" class="sop-folder-explorer-grid sop-folder-explorer-grid--2"><div class="sop-empty"><i data-lucide="loader"></i></div></div>
      </div>`;
    panel.querySelector('#btnSopArmVolverMes')?.addEventListener('click', () => seleccionarPeriodoArmado(armState.periodoId));
    const res = await apiFetch(`/api/soportes/armado/dias/${id}/contenedores`);
    const data = await res.json();
    armState.contenedores = data.contenedores || [];
    const grid = panel.querySelector('#sopArmContenedoresGrid');
    if (!armState.contenedores.length) {
      grid.innerHTML = '<div class="sop-empty">No se encontraron carpetas RIPS/SOPORTES</div>';
    } else {
      grid.innerHTML = armState.contenedores.map((c) => {
        const label = labelContenedorArmado(c.tipo);
        const icon = c.tipo === 'rips' ? 'file-spreadsheet' : 'folder-archive';
        const desc = c.tipo === 'rips' ? 'JSON y XML de facturación' : 'OPF, CRC, FEV, PDX…';
        return `<article class="sop-folder-card sop-folder-card--wide" data-contenedor-id="${c.id}" data-contenedor-tipo="${c.tipo}" tabindex="0">
          <div class="sop-folder-card-icon sop-folder-card-icon--lg"><i data-lucide="${icon}"></i></div>
          <div class="sop-folder-card-title">${label}</div>
          <div class="sop-folder-card-meta">${escapeHtml(desc)}</div>
          <div class="sop-folder-card-count"><strong>${c.expedientes_count || 0}</strong> carpeta(s) FE</div>
        </article>`;
      }).join('');
      grid.querySelectorAll('[data-contenedor-id]').forEach((card) => {
        card.addEventListener('click', () => seleccionarContenedorArmado(parseInt(card.dataset.contenedorId, 10)));
      });
    }
    sopIcons(panel);
    renderArmadoContextBar();
  }

  async function seleccionarContenedorArmado(id) {
    armState.contenedorId = id;
    armState.expedienteId = null;
    armState.expedienteCodigo = null;
    armState.vista = 'contenedor';
    const cont = armState.contenedores.find((c) => c.id === id);
    armState.contenedorTipo = cont?.tipo || null;
    const panel = $('sopArmExpedientePanel');
    const tipoLabel = labelContenedorArmado(armState.contenedorTipo);
    panel.innerHTML = `<div class="sop-panel-head">
        <div>
          <h3 style="margin:0"><i data-lucide="folder-tree"></i> ${escapeHtml(tipoLabel)}</h3>
          <p style="margin:4px 0 0;font-size:.85rem;color:#64748b">${escapeHtml(armState.diaLabel || '')}</p>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" id="btnSopArmVolverDia"><i data-lucide="arrow-left"></i> Día</button>
        ${sopPerm('soportes.armado.crear_estructura') ? `<button type="button" class="sop-btn sop-btn-teal sop-btn-sm" id="btnSopArmNuevoFe"><i data-lucide="folder-plus"></i> Nuevas carpetas</button>` : ''}
        </div>
      </div>
      <div class="sop-panel-body">
        <div id="sopArmContenedorSummary"></div>
        <div id="sopArmExpedientesGrid" class="sop-folder-explorer-grid"><div class="sop-skeleton-block sop-skeleton-folder-card"></div></div>
      </div>`;
    const gridSk = panel.querySelector('#sopArmExpedientesGrid');
    if (gridSk) gridSk.innerHTML = '<div class="sop-skeleton-block sop-skeleton-folder-card"></div><div class="sop-skeleton-block sop-skeleton-folder-card"></div>';
    const res = await apiFetch(`/api/soportes/armado/contenedores/${id}/expedientes`);
    const data = await res.json();
    const list = data.expedientes || [];
    const summary = panel.querySelector('#sopArmContenedorSummary');
    if (summary) {
      summary.innerHTML = htmlArmadoSummaryChips({ total: list.length, listos: 0, pendientes: list.length });
      sopIcons(summary);
    }
    const grid = panel.querySelector('#sopArmExpedientesGrid');
    if (!list.length) {
      grid.innerHTML = '<div class="sop-empty" style="grid-column:1/-1;padding:28px">Sin carpetas FE — use «Nuevas carpetas»</div>';
    } else {
      grid.innerHTML = list.map((e) => {
        const factura = (e.numero_factura != null && Number(e.numero_factura) > 0)
          ? `FE${e.numero_factura}`
          : null;
        const puedeEditar = sopPerm('soportes.armado.subir');
        const puedeEliminar = sopPerm('soportes.armado.crear_estructura');
        return `<article class="sop-folder-card sop-folder-card--fe" data-exp-id="${e.id}" tabindex="0">
          <div class="sop-folder-card-icon"><i data-lucide="folder"></i></div>
          <div class="sop-folder-card-title">${escapeHtml(e.codigo)}</div>
          <div class="sop-folder-card-meta">${escapeHtml(e.paciente_nombre || 'Sin paciente')}</div>
          <div class="sop-folder-card-count">${factura ? escapeHtml(factura) : '<span class="sop-badge sop-badge-pendiente" style="margin:0">Pendiente FEV</span>'}</div>
          <div class="sop-folder-card-actions">
            <button type="button" class="sop-btn sop-btn-teal sop-btn-sm" data-exp-open="${e.id}"><i data-lucide="folder-open"></i> Abrir</button>
            ${puedeEditar ? `<button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-exp-edit="${e.id}"><i data-lucide="pencil"></i></button>` : ''}
            ${puedeEliminar ? `<button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-exp-del="${e.id}" data-exp-codigo="${escapeHtml(e.codigo)}" style="color:#dc2626"><i data-lucide="trash-2"></i></button>` : ''}
          </div>
        </article>`;
      }).join('');
      grid.querySelectorAll('.sop-folder-card--fe').forEach((card) => {
        const open = () => abrirExpedienteArmado(parseInt(card.dataset.expId, 10));
        card.addEventListener('click', (ev) => {
          if (ev.target.closest('.sop-folder-card-actions')) return;
          open();
        });
        card.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') open(); });
      });
      grid.querySelectorAll('[data-exp-open]').forEach((b) => {
        b.addEventListener('click', (ev) => { ev.stopPropagation(); abrirExpedienteArmado(parseInt(b.dataset.expOpen, 10)); });
      });
      grid.querySelectorAll('[data-exp-edit]').forEach((b) => {
        b.addEventListener('click', (ev) => { ev.stopPropagation(); modalEditarExpediente(parseInt(b.dataset.expEdit, 10)); });
      });
      grid.querySelectorAll('[data-exp-del]').forEach((b) => {
        b.addEventListener('click', (ev) => { ev.stopPropagation(); modalEliminarExpediente(parseInt(b.dataset.expDel, 10), b.dataset.expCodigo); });
      });
    }
    panel.querySelector('#btnSopArmVolverDia')?.addEventListener('click', () => seleccionarDiaArmado(armState.diaId));
    panel.querySelector('#btnSopArmNuevoFe')?.addEventListener('click', modalNuevoExpediente);
    sopIcons(panel);
    renderArmadoContextBar();
  }

  function htmlSlotArchivoActions(expId, key, slot, opts = {}) {
    if (!expId || !slot.completo || !slot.archivo_id) return '';
    if (!sopPerm('modulo.armado_soportes')) return '';
    const canEdit = sopPerm('soportes.armado.subir');
    const accept = escapeHtml(opts.accept || '.pdf,application/pdf');
    const verUrl = `/api/soportes/armado/expedientes/${expId}/archivos/${key}/descargar?inline=1`;
    const unirBtn = key === 'CRC' && canEdit
      ? `<button type="button" class="sop-btn sop-btn-ghost sop-btn-sm sop-slot-unir" data-slot-unir="CRC" title="Unir varios PDF y reemplazar"><i data-lucide="layers"></i></button>`
      : '';
    return `<div class="sop-slot-actions">
      <a class="sop-btn sop-btn-ghost sop-btn-sm" href="${verUrl}" target="_blank" rel="noopener" title="Ver"><i data-lucide="eye"></i></a>
      ${canEdit ? `<button type="button" class="sop-btn sop-btn-ghost sop-btn-sm sop-slot-del" data-slot-del="${key}" title="Eliminar"><i data-lucide="trash-2"></i></button>
      <label class="sop-btn sop-btn-ghost sop-btn-sm" style="cursor:pointer" title="Reemplazar"><i data-lucide="refresh-cw"></i>
        <input type="file" data-replace-slot="${key}" class="sop-file-input-hidden" accept="${accept}"></label>
      ${unirBtn}` : ''}
    </div>`;
  }

  function htmlFeSlotCard(key, slot, opts = {}) {
    const ok = slot.completo;
    const dis = slot.habilitado === false;
    const icons = {
      OPF: 'file-text', CRC: 'clipboard-list', FEV: 'receipt', PDX: 'file-output', HEV: 'stethoscope',
      RIPS_JSON_1: 'file-json', RIPS_JSON_2: 'file-json', RIPS_XML: 'file-code'
    };
    const labels = {
      OPF: 'OPF', CRC: 'CRC', FEV: 'FEV', PDX: 'PDX', HEV: 'HEV',
      RIPS_JSON_1: 'JSON 1', RIPS_JSON_2: 'JSON 2', RIPS_XML: 'XML RIPS'
    };
    const sub = slot.nombre_original
      ? `<div class="sop-slot-file" title="${escapeHtml(slot.nombre_original)}">${escapeHtml(slot.nombre_archivo || slot.nombre_original)}</div>`
      : `<div class="sop-slot-file">${ok ? escapeHtml(slot.nombre_archivo || 'Cargado') : 'Pendiente'}</div>`;
    const opfHint = key === 'OPF' && !ok && !dis
      ? '<p class="sop-pdx-format-nota" style="margin:8px 0 0;font-size:.78rem">Unir ORDEN+HC + autorización, subir OPF listo, o PDF manual (sin factura: se renombra al subir FEV).</p>'
      : '';
    const crcHint = key === 'CRC' && !ok && !dis
      ? '<p class="sop-pdx-format-nota" style="margin:8px 0 0;font-size:.78rem">Suba un PDF, enlace desde reportes o <strong>una 2+ PDF</strong> en un solo CRC.</p>'
      : '';
    const allowUpload = opts.upload && !dis && !(ok && slot.archivo_id);
    return `<div class="sop-slot-card ${ok ? 'ok' : ''} ${dis ? 'disabled' : ''}" data-slot="${key}">
      <div class="sop-slot-head">
        <span class="sop-slot-label"><i data-lucide="${icons[key] || 'file'}"></i> ${labels[key] || key}</span>
        <span class="sop-slot-status"></span>
      </div>
      ${sub}
      ${htmlSlotArchivoActions(opts.expId, key, slot, opts)}
      ${opfHint}
      ${crcHint}
      ${allowUpload ? `<label class="sop-btn sop-btn-ghost sop-btn-sm" style="margin-top:8px;cursor:pointer">
        <i data-lucide="upload"></i> Subir<input type="file" data-upload-slot="${key}" class="sop-file-input-hidden" accept="${opts.accept || ''}"></label>` : ''}
      ${key === 'OPF' && !dis && !ok && sopPerm('soportes.armado.subir') ? '<button type="button" class="sop-btn sop-btn-primary sop-btn-sm" id="btnSopGenerarOpf" style="margin-top:8px"><i data-lucide="layers"></i> Generar OPF</button>' : ''}
      ${key === 'PDX' && !dis && !ok && sopPerm('soportes.armado.importar_pdx') ? '<button type="button" class="sop-btn sop-btn-primary sop-btn-sm" id="btnSopImportPdx"><i data-lucide="link-2"></i> Enlazar reporte</button>' : ''}
      ${key === 'CRC' && !dis && !ok && sopPerm('soportes.armado.importar_pdx') ? '<button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" id="btnSopImportCrc" style="margin-top:8px"><i data-lucide="link-2"></i> Enlazar</button>' : ''}
      ${key === 'CRC' && !dis && !ok && sopPerm('soportes.armado.subir') ? '<button type="button" class="sop-btn sop-btn-primary sop-btn-sm" id="btnSopUnirCrc" style="margin-top:8px"><i data-lucide="layers"></i> Unir PDFs</button>' : ''}
    </div>`;
  }

  function esPdfSubidaArmado(file, esRips) {
    if (!file) return false;
    const name = (file.name || '').toLowerCase();
    const mime = (file.type || '').toLowerCase();
    if (esRips) {
      return name.endsWith('.json') || name.endsWith('.xml') || mime.includes('json') || mime.includes('xml');
    }
    return name.endsWith('.pdf') || mime === 'application/pdf';
  }

  async function confirmEliminarArchivoSlot(expId, tipo) {
    const modal = openSopModal(`
      <h3><i data-lucide="trash-2"></i> Eliminar ${escapeHtml(tipo)}</h3>
      <p class="sop-dialog-lead">Se quitará el archivo <strong>${escapeHtml(tipo)}</strong> de este expediente. Podrá volver a subirlo después.</p>
      <div class="sop-dialog-actions">
        <button type="button" class="sop-btn sop-btn-ghost" id="sopSlotDelCancel">Cancelar</button>
        <button type="button" class="sop-btn sop-btn-danger" id="sopSlotDelOk">Eliminar</button>
      </div>`);
    modal.querySelector('#sopSlotDelCancel').onclick = () => closeSopModal(modal);
    modal.querySelector('#sopSlotDelOk').onclick = async () => {
      const btn = modal.querySelector('#sopSlotDelOk');
      btn.disabled = true;
      const res = await apiFetch(`/api/soportes/armado/expedientes/${expId}/archivos/${tipo}`, { method: 'DELETE' });
      let data = {};
      try { data = await res.json(); } catch (_) { /* ignore */ }
      if (!res.ok) {
        sopToast(data.error || 'No se pudo eliminar', 'error');
        btn.disabled = false;
        return;
      }
      closeSopModal(modal);
      sopToast(data.message || 'Archivo eliminado', 'success');
      abrirExpedienteArmado(expId);
    };
    sopIcons(modal);
  }

  function bindSlotArchivoActions(panel, expId, ctx = {}) {
    panel.querySelectorAll('.sop-slot-del').forEach((btn) => {
      btn.addEventListener('click', () => confirmEliminarArchivoSlot(expId, btn.dataset.slotDel));
    });
    panel.querySelectorAll('[data-replace-slot]').forEach((inp) => {
      inp.addEventListener('change', async (ev) => {
        const f = ev.target.files?.[0];
        if (!f) return;
        await subirArchivoFeSmart(expId, f, ev.target.dataset.replaceSlot, ctx);
        ev.target.value = '';
      });
    });
    panel.querySelectorAll('.sop-slot-unir').forEach((btn) => {
      btn.addEventListener('click', () => {
        const info = armState.expedienteDetalle || {};
        modalUnirPdfSlot(expId, btn.dataset.slotUnir || 'CRC', info, { reemplazar: true });
      });
    });
  }

  function modalUnirPdfSlot(expId, tipo, expInfo, { reemplazar = false } = {}) {
    const ejemplo = expInfo?.ejemplos_nombre?.[tipo] || `${tipo}_{NIT}.pdf`;
    const titulo = reemplazar ? `Reemplazar ${tipo} (unir PDFs)` : `Unir PDFs — ${tipo}`;
    const modal = openSopModal(`
      <h3><i data-lucide="layers" style="vertical-align:-3px;width:22px"></i> ${escapeHtml(titulo)}</h3>
      <p style="font-size:.85rem;color:#64748b;margin:-8px 0 12px">Seleccione <strong>2 o más</strong> PDF. Se guardarán en orden como un solo archivo <strong>${escapeHtml(tipo)}</strong>.</p>
      <p class="sop-pdx-format-nota" style="margin-bottom:12px">Nombre: <code>${escapeHtml(ejemplo)}</code></p>
      <div class="sop-field">
        <label>Archivos PDF</label>
        <input type="file" id="sopUnirPdfFiles" accept=".pdf,application/pdf" multiple class="sop-file-input-visible">
        <div id="sopUnirPdfList" class="sop-search-results-meta" style="margin-top:8px"></div>
      </div>
      <div class="sop-dialog-actions">
        <button type="button" class="sop-btn sop-btn-ghost" id="sopUnirPdfCancel">Cancelar</button>
        <button type="button" class="sop-btn sop-btn-primary" id="sopUnirPdfOk" disabled>Guardar ${escapeHtml(tipo)}</button>
      </div>`);
    const listEl = modal.querySelector('#sopUnirPdfList');
    const input = modal.querySelector('#sopUnirPdfFiles');
    const btnOk = modal.querySelector('#sopUnirPdfOk');
    let files = [];

    function refreshList() {
      if (!files.length) {
        listEl.textContent = '';
        btnOk.disabled = true;
        return;
      }
      listEl.innerHTML = `<ol style="margin:0;padding-left:1.2rem;font-size:.85rem">${files.map((f, i) =>
        `<li>${i + 1}. ${escapeHtml(f.name)}</li>`).join('')}</ol>`;
      btnOk.disabled = files.length < 2;
    }

    input?.addEventListener('change', () => {
      files = Array.from(input.files || []);
      refreshList();
    });

    modal.querySelector('#sopUnirPdfCancel').onclick = () => closeSopModal(modal);
    btnOk.onclick = async () => {
      if (files.length < 2) return;
      btnOk.disabled = true;
      btnOk.textContent = 'Uniendo…';
      const fd = new FormData();
      files.forEach((f) => fd.append('partes', f));
      if (reemplazar) fd.append('reemplazar', '1');
      try {
        const res = await apiFetch(`/api/soportes/armado/expedientes/${expId}/unir-pdf/${tipo}`, { method: 'POST', body: fd });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          sopToast(data.error || `Error al unir ${tipo}`, 'error');
          btnOk.disabled = false;
          btnOk.textContent = `Guardar ${tipo}`;
          return;
        }
        closeSopModal(modal);
        sopToast(data.message || `${tipo} guardado`, 'success');
        abrirExpedienteArmado(expId);
      } catch (e) {
        sopToast(e.message || 'Error de conexión', 'error');
        btnOk.disabled = false;
        btnOk.textContent = `Guardar ${tipo}`;
      }
    };
    sopIcons(modal);
  }

  async function subirArchivoFeSmart(expId, file, tipoManual, opts = {}) {
    const esRips = opts.esRips ?? (armState.contenedorTipo === 'rips');
    if (!esPdfSubidaArmado(file, esRips)) {
      sopToast(
        esRips
          ? 'En RIPS solo JSON o XML. Los PDF van en la carpeta SOPORTES.'
          : 'Solo se permiten archivos PDF (.pdf).',
        'error'
      );
      return;
    }
    const fd = new FormData();
    fd.append('file', file);
    if (tipoManual) fd.append('tipo', tipoManual);
    const res = await apiFetch(`/api/soportes/armado/expedientes/${expId}/upload`, { method: 'POST', body: fd });
    let data = {};
    try { data = await res.json(); } catch (_) {
      sopToast('Error al subir el archivo', 'error');
      return;
    }
    if (!res.ok) {
      if (data.requiere_tipo) return modalElegirTipoArchivo(expId, file, data.nombre_original, { esRips, tipoServicio: opts.tipoServicio });
      sopToast(data.error || 'Error al subir', 'error');
      return;
    }
    sopToast(data.message || 'Archivo guardado', 'success');
    abrirExpedienteArmado(expId);
  }

  function modalElegirTipoArchivo(expId, file, nombreOriginal, ctx = {}) {
    const esRips = ctx.esRips ?? (armState.contenedorTipo === 'rips');
    const esConsulta = ctx.tipoServicio === 'consulta';
    const opciones = esRips
      ? [['RIPS_JSON_1', 'JSON 1'], ['RIPS_JSON_2', 'JSON 2'], ['RIPS_XML', 'XML']]
      : [
        ['OPF', 'OPF'],
        ['CRC', 'CRC'],
        ['FEV', 'FEV'],
        ...(esConsulta ? [] : [['PDX', 'PDX']]),
        ...(esConsulta ? [['HEV', 'HEV']] : [])
      ];
    const opts = opciones.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
    const modal = openSopModal(`
      <h3><i data-lucide="help-circle"></i> Elija el tipo de archivo</h3>
      <p class="sop-dialog-lead">No se detectó automáticamente:<br><strong>${escapeHtml(nombreOriginal || file.name)}</strong></p>
      <div class="sop-field"><label>Tipo de documento</label><select id="sopTipoManual">${opts}</select></div>
      <div class="sop-dialog-actions">
        <button type="button" class="sop-btn sop-btn-ghost" id="sopTipoCancel">Cancelar</button>
        <button type="button" class="sop-btn sop-btn-teal" id="sopTipoOk">Subir</button>
      </div>`);
    modal.querySelector('#sopTipoCancel').onclick = () => closeSopModal(modal);
    modal.querySelector('#sopTipoOk').onclick = async () => {
      const t = modal.querySelector('#sopTipoManual').value;
      closeSopModal(modal);
      await subirArchivoFeSmart(expId, file, t, ctx);
    };
  }

  async function abrirExpedienteArmado(id) {
    armState.expedienteId = id;
    armState.vista = 'expediente';
    armState.expedienteDetalle = null;
    const res = await apiFetch(`/api/soportes/armado/expedientes/${id}`);
    const data = await res.json();
    if (!res.ok) { sopToast(data.error, 'error'); return; }
    const e = data.expediente;
    armState.expedienteDetalle = e;
    armState.expedienteCodigo = e.codigo || `FE${id}`;
    const panel = $('sopArmExpedientePanel');
    const tipoLabel = labelContenedorArmado(armState.contenedorTipo);
    const esRips = e.contenedor_tipo === 'rips';
    const nit = e.nit_obligado || '—';
    const slots = e.slots || {};

    let slotsHtml = '';
    const acceptRips = '.json,.xml,application/json,text/xml,application/xml';
    const acceptPdf = '.pdf,application/pdf';
    if (esRips) {
      slotsHtml = htmlFeSlotCard('RIPS_JSON_1', slots.RIPS_JSON_1 || {}, { upload: true, accept: acceptRips, expId: id })
        + htmlFeSlotCard('RIPS_JSON_2', slots.RIPS_JSON_2 || {}, { upload: true, accept: acceptRips, expId: id })
        + htmlFeSlotCard('RIPS_XML', slots.RIPS_XML || {}, { upload: true, accept: acceptRips, expId: id });
    } else {
      const showPdx = slots.PDX?.habilitado !== false;
      const showHev = slots.HEV?.habilitado !== false;
      slotsHtml = htmlFeSlotCard('OPF', slots.OPF || {}, { upload: true, accept: acceptPdf, expId: id })
        + htmlFeSlotCard('CRC', slots.CRC || {}, { upload: true, accept: acceptPdf, expId: id })
        + htmlFeSlotCard('FEV', slots.FEV || {}, { upload: true, accept: acceptPdf, expId: id })
        + (showPdx ? htmlFeSlotCard('PDX', slots.PDX || {}, { upload: true, accept: acceptPdf, expId: id }) : '')
        + (showHev ? htmlFeSlotCard('HEV', slots.HEV || {}, { upload: true, accept: acceptPdf, expId: id }) : '');
    }
    const vinculos = e.vinculos || [];
    const vinculosHtml = vinculos.length ? `<div class="sop-vinculos-block" style="margin-top:18px">
      <div class="sop-pdx-format-title"><i data-lucide="link-2"></i> Enlaces desde reportes</div>
      <ul class="sop-vinculos-list">${vinculos.map((v) =>
        `<li><span class="sop-badge sop-badge-pendiente" style="margin:0">${escapeHtml(v.rol === 'orden_hc' ? 'ORDEN+HC' : v.rol)}</span>
          ${escapeHtml(v.paciente_nombre || v.nombre_archivo_original || '')}
          <span style="font-size:.78rem;color:#64748b">${escapeHtml(v.fecha_estudio || '')}</span></li>`
      ).join('')}</ul>
      ${vinculos.some((v) => v.rol === 'orden_hc') && !slots.OPF?.completo ? '<p class="sop-pdx-format-nota">Tiene ORDEN+HC vinculado: use «Generar OPF» con la autorización.</p>' : ''}
    </div>` : '';

    panel.innerHTML = `
      <div class="sop-panel-head">
        <div>
          <h3 style="margin:0"><i data-lucide="folder"></i> ${escapeHtml(e.codigo)}</h3>
          <div style="font-size:.85rem;color:#64748b;margin-top:4px">${escapeHtml(tipoLabel)} · NIT ${escapeHtml(nit)}${e.paciente_nombre ? ` · ${escapeHtml(e.paciente_nombre)}` : ''}${e.numero_factura != null && Number(e.numero_factura) > 0 ? ` · FE${e.numero_factura}` : ' · sin factura'}</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" id="btnSopArmVolverCont"><i data-lucide="arrow-left"></i> ${escapeHtml(tipoLabel)}</button>
        ${sopPerm('soportes.armado.subir') ? `<button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" id="btnSopExpEditar"><i data-lucide="pencil"></i> Editar</button>` : ''}
        ${sopPerm('soportes.armado.crear_estructura') ? `<button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" id="btnSopExpEliminar" style="color:#dc2626"><i data-lucide="trash-2"></i> Eliminar</button>` : ''}
        ${sopPerm('soportes.descargar_zip') ? `<a class="sop-btn sop-btn-teal sop-btn-sm" href="/api/soportes/armado/expedientes/${id}/zip" target="_blank"><i data-lucide="archive"></i> ZIP</a>` : ''}
        </div>
      </div>
      <div class="sop-panel-body">
        ${!esRips ? htmlExpedienteProgress(e, slots) : ''}
        <div class="sop-pdx-format-help" style="margin-bottom:14px">
          <div class="sop-pdx-format-title"><i data-lucide="sparkles"></i> Subida inteligente</div>
          <div id="sopFeDropzone" class="sop-dropzone sop-dropzone-compact">
            <div class="sop-dropzone-label"><i data-lucide="upload-cloud"></i> Subir PDF</div>
            <input type="file" id="sopFeUploadInput" class="sop-file-input-hidden" accept=".pdf,application/pdf">
          </div>
        </div>
        ${!esRips ? `<div class="sop-flags" style="margin-bottom:12px">
          <label class="sop-toggle"><input type="checkbox" id="sopFevCheck" ${e.fev_externa_verificada ? 'checked' : ''}> FEV verificada (externo)</label>
        </div>` : ''}
        <div class="sop-slots">${slotsHtml}</div>
        ${vinculosHtml}
      </div>`;

    panel.querySelector('#btnSopArmVolverCont')?.addEventListener('click', () => {
      if (armState.contenedorId) seleccionarContenedorArmado(armState.contenedorId);
    });
    panel.querySelector('#btnSopExpEditar')?.addEventListener('click', () => modalEditarExpediente(id, e));
    panel.querySelector('#btnSopExpEliminar')?.addEventListener('click', () => modalEliminarExpediente(id, e.codigo));
    const dz = panel.querySelector('#sopFeDropzone');
    const inp = panel.querySelector('#sopFeUploadInput');
    if (dz && inp) {
      dz.addEventListener('click', () => inp.click());
      inp.addEventListener('change', async () => {
        const f = inp.files?.[0];
        if (f) await subirArchivoFeSmart(id, f, null, { esRips: false, tipoServicio: e.tipo_servicio });
        inp.value = '';
      });
    }
    if (!esRips) {
      $('sopFevCheck')?.addEventListener('change', async () => {
        await apiFetch(`/api/soportes/armado/expedientes/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fev_externa_verificada: $('sopFevCheck').checked })
        });
        abrirExpedienteArmado(id);
      });
    }
    panel.querySelectorAll('[data-upload-slot]').forEach((inp) => {
      inp.addEventListener('change', async (ev) => {
        const f = ev.target.files?.[0];
        if (!f) return;
        await subirArchivoFeSmart(id, f, ev.target.dataset.uploadSlot, { esRips, tipoServicio: e.tipo_servicio });
        ev.target.value = '';
      });
    });
    const openImportDep = (filtro) => modalImportDepositoEnExpediente(id, filtro);
    panel.querySelector('#btnSopImportPdx')?.addEventListener('click', () => openImportDep('PDX'));
    panel.querySelector('#btnSopImportCrc')?.addEventListener('click', () => openImportDep('CRC'));
    panel.querySelector('#btnSopUnirCrc')?.addEventListener('click', () => modalUnirPdfSlot(id, 'CRC', e, { reemplazar: false }));
    panel.querySelector('#btnSopGenerarOpf')?.addEventListener('click', () => modalGenerarOpf(id, e));
    bindSlotArchivoActions(panel, id, { esRips, tipoServicio: e.tipo_servicio });
    sopIcons(panel);
    renderArmadoContextBar();
  }

  function modalGenerarOpf(expId, expInfo) {
    let selectedOrdenId = null;
    let authFile = null;
    let ordenManualFile = null;
    let opfUnidoFile = null;
    let searchTimer = null;
    const opfEjemplo = expInfo?.ejemplos_nombre?.OPF || 'OPF_{NIT}_{código}.pdf';
    const sinFactura = expInfo?.tiene_factura === false;
    const modal = openSopModal(`
      <h3><i data-lucide="layers" style="vertical-align:-3px;width:22px"></i> Generar / subir OPF</h3>
      <p style="font-size:.85rem;color:#64748b;margin:-8px 0 12px">Puede <strong>unir</strong> ORDEN+HC con autorización (depósito o PDF manual), o subir el <strong>OPF ya listo</strong>. No hace falta tener la factura antes; al subir la FEV se renombra con NIT y número FE.</p>
      <p class="sop-pdx-format-nota" style="margin-bottom:12px">Nombre provisional: <code>${escapeHtml(opfEjemplo)}</code>${sinFactura ? ' <span style="color:#b45309">(sin factura aún)</span>' : ''}.</p>
      <div class="sop-field">
        <label>OPF ya unido (opcional — un solo PDF)</label>
        <input type="file" id="sopOpfUnidoFile" accept=".pdf,application/pdf" class="sop-file-input-visible">
        <div id="sopOpfUnidoName" class="sop-search-results-meta" style="margin-top:6px"></div>
      </div>
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:14px 0">
      <div class="sop-field">
        <label>ORDEN + HC desde reportes (opcional)</label>
        <div class="sop-search-wrap" style="max-width:none">
          <i data-lucide="search"></i>
          <input type="search" id="sopOpfOrdenBuscar" class="sop-search" placeholder="Paciente, documento o nombre de archivo…" autocomplete="off">
        </div>
      </div>
      <div id="sopOpfOrdenResults" class="sop-import-results">
        <div class="sop-empty" style="padding:16px;font-size:.85rem">Busque en depósito o use PDF manual abajo</div>
      </div>
      <div class="sop-field" style="margin-top:10px">
        <label>ORDEN + HC manual (PDF, si no está en el sistema)</label>
        <input type="file" id="sopOpfOrdenManual" accept=".pdf,application/pdf" class="sop-file-input-visible">
        <div id="sopOpfOrdenManualName" class="sop-search-results-meta" style="margin-top:6px"></div>
      </div>
      <div class="sop-field" style="margin-top:14px">
        <label>Autorización (PDF, opcional si ya unió todo en un archivo)</label>
        <input type="file" id="sopOpfAuthFile" accept=".pdf,application/pdf" class="sop-file-input-visible">
        <div id="sopOpfAuthName" class="sop-search-results-meta" style="margin-top:6px"></div>
      </div>
      <div class="sop-dialog-actions">
        <button type="button" class="sop-btn sop-btn-ghost" id="sopOpfCancel">Cancelar</button>
        <button type="button" class="sop-btn sop-btn-primary" id="sopOpfOk" disabled>Guardar OPF</button>
      </div>`);
    const resultsEl = modal.querySelector('#sopOpfOrdenResults');
    const btnOk = modal.querySelector('#sopOpfOk');
    const inputSearch = modal.querySelector('#sopOpfOrdenBuscar');
    const inputAuth = modal.querySelector('#sopOpfAuthName');
    const authInput = modal.querySelector('#sopOpfAuthFile');

    function refreshOk() {
      btnOk.disabled = !(opfUnidoFile || selectedOrdenId || ordenManualFile);
    }

    function renderOrdenResults(list) {
      if (!list?.length) {
        resultsEl.innerHTML = '<div class="sop-empty" style="padding:16px;font-size:.85rem">Sin ORDEN+HC en carpetas de órdenes</div>';
        selectedOrdenId = null;
        refreshOk();
        return;
      }
      resultsEl.innerHTML = list.map((r) => `
        <div class="sop-import-item${selectedOrdenId === r.archivo_id ? ' selected' : ''}" data-orden-archivo="${r.archivo_id}">
          <div>
            <strong>${escapeHtml(r.paciente_nombre)}</strong>
            <div class="sop-import-item-meta">${escapeHtml(r.fecha_estudio || '—')} · ${escapeHtml(r.estudio_texto || '—')}</div>
            <div class="sop-import-item-meta">${escapeHtml(r.carpeta_nombre)} (${escapeHtml(r.periodo)})</div>
            <div class="sop-import-item-meta" style="font-size:.75rem">${escapeHtml(r.nombre_archivo_original || '')}</div>
          </div>
          <i data-lucide="clipboard-list" style="width:18px;height:18px;color:#94a3b8;flex-shrink:0"></i>
        </div>`).join('');
      resultsEl.querySelectorAll('.sop-import-item').forEach((row) => {
        row.addEventListener('click', () => {
          selectedOrdenId = parseInt(row.dataset.ordenArchivo, 10);
          resultsEl.querySelectorAll('.sop-import-item').forEach((el) => {
            el.classList.toggle('selected', parseInt(el.dataset.ordenArchivo, 10) === selectedOrdenId);
          });
          refreshOk();
        });
      });
      sopIcons(resultsEl);
    }

    async function runOrdenSearch() {
      const q = inputSearch.value.trim();
      if (q.length < 2) {
        resultsEl.innerHTML = '<div class="sop-empty" style="padding:16px;font-size:.85rem">Escriba al menos 2 caracteres</div>';
        selectedOrdenId = null;
        refreshOk();
        return;
      }
      resultsEl.innerHTML = '<div class="sop-empty" style="padding:16px"><i data-lucide="loader" class="sop-empty-icon"></i> Buscando…</div>';
      sopIcons(resultsEl);
      try {
        const res = await apiFetch(`/api/soportes/pdx/buscar-ordenes?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        renderOrdenResults(data.resultados || []);
      } catch (err) {
        resultsEl.innerHTML = `<div class="sop-empty" style="padding:16px;color:#dc2626">${escapeHtml(err.message)}</div>`;
      }
    }

    inputSearch.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(runOrdenSearch, 320);
    });

    authInput?.addEventListener('change', () => {
      authFile = authInput.files?.[0] || null;
      if (inputAuth) inputAuth.textContent = authFile ? authFile.name : '';
      refreshOk();
    });

    const ordenManualInput = modal.querySelector('#sopOpfOrdenManual');
    const ordenManualNameEl = modal.querySelector('#sopOpfOrdenManualName');
    ordenManualInput?.addEventListener('change', () => {
      ordenManualFile = ordenManualInput.files?.[0] || null;
      if (ordenManualNameEl) ordenManualNameEl.textContent = ordenManualFile ? ordenManualFile.name : '';
      if (ordenManualFile) selectedOrdenId = null;
      refreshOk();
    });

    const opfUnidoInput = modal.querySelector('#sopOpfUnidoFile');
    const opfUnidoNameEl = modal.querySelector('#sopOpfUnidoName');
    opfUnidoInput?.addEventListener('change', () => {
      opfUnidoFile = opfUnidoInput.files?.[0] || null;
      if (opfUnidoNameEl) opfUnidoNameEl.textContent = opfUnidoFile ? opfUnidoFile.name : '';
      refreshOk();
    });

    modal.querySelector('#sopOpfCancel').onclick = () => closeSopModal(modal);
    btnOk.onclick = async () => {
      btnOk.disabled = true;
      btnOk.textContent = 'Guardando…';
      const fd = new FormData();
      if (opfUnidoFile) fd.append('opf_unido', opfUnidoFile);
      if (selectedOrdenId) fd.append('pdx_orden_archivo_id', String(selectedOrdenId));
      if (ordenManualFile) fd.append('orden_manual', ordenManualFile);
      if (authFile) fd.append('autorizacion', authFile);
      try {
        const res = await apiFetch(`/api/soportes/armado/expedientes/${expId}/generar-opf`, { method: 'POST', body: fd });
        const data = await res.json();
        if (!res.ok) {
          sopToast(data.error || 'Error al generar OPF', 'error');
          btnOk.disabled = false;
          btnOk.textContent = 'Guardar OPF';
          return;
        }
        if (data.warnings?.length) sopToast(data.warnings.join(' · '), 'warning');
        closeSopModal(modal);
        sopToast(data.message || 'OPF guardado', 'success');
        abrirExpedienteArmado(expId);
      } catch (e) {
        sopToast(e.message || 'Error de conexión', 'error');
        btnOk.disabled = false;
        btnOk.textContent = 'Guardar OPF';
      }
    };
    sopIcons(modal);
  }

  function modalImportDepositoEnExpediente(expId, filtroSlot = null) {
    let selectedId = null;
    let searchTimer = null;
    const titulos = { PDX: 'reporte (PDX)', CRC: 'comprobante (CRC)' };
    const titulo = filtroSlot ? titulos[filtroSlot] || filtroSlot : 'archivo del depósito';
    const modal = openSopModal(`
      <h3><i data-lucide="link-2" style="vertical-align:-3px;width:22px"></i> Enlazar ${escapeHtml(titulo)}</h3>
      <p style="font-size:.85rem;color:#64748b;margin:-8px 0 12px">Busque en reportes y seleccione el archivo. Se copiará a la carpeta FE según su tipo.</p>
      <div class="sop-field">
        <label>Paciente</label>
        <div class="sop-search-wrap" style="max-width:none">
          <i data-lucide="search"></i>
          <input type="search" id="sopImpPdxBuscar" class="sop-search" placeholder="Mínimo 2 caracteres…" autocomplete="off">
        </div>
      </div>
      <div id="sopImpPdxResults" class="sop-import-results">
        <div class="sop-empty" style="padding:20px;font-size:.85rem">Escriba para buscar en el depósito PDX</div>
      </div>
      <div class="sop-dialog-actions">
        <button type="button" class="sop-btn sop-btn-ghost" id="sopImpCancel">Cancelar</button>
        <button type="button" class="sop-btn sop-btn-primary" id="sopImpOk" disabled>Importar seleccionado</button>
      </div>`);
    const resultsEl = modal.querySelector('#sopImpPdxResults');
    const btnOk = modal.querySelector('#sopImpOk');
    const input = modal.querySelector('#sopImpPdxBuscar');

    function renderImportResults(list) {
      let items = (list || []).filter((r) => r.puede_vincular_fe !== false && r.destino_modo !== 'no_soportes');
      if (filtroSlot) {
        items = items.filter((r) => {
          const d = String(r.destino_importacion || '').toUpperCase();
          if (filtroSlot === 'PDX') return d === 'PDX' || d.includes('REPORTE');
          return d === filtroSlot || d.includes(filtroSlot);
        });
      }
      if (!items.length) {
        resultsEl.innerHTML = '<div class="sop-empty" style="padding:20px;font-size:.85rem">Sin resultados para este tipo</div>';
        selectedId = null;
        btnOk.disabled = true;
        return;
      }
      resultsEl.innerHTML = items.map((r) => `
        <div class="sop-import-item${selectedId === r.archivo_id ? ' selected' : ''}" data-pdx-archivo="${r.archivo_id}">
          <div>
            <strong>${escapeHtml(r.paciente_nombre)}</strong>
            <span class="sop-badge sop-badge-pendiente" style="margin:0 0 0 6px;font-size:.7rem">→ ${escapeHtml(r.destino_importacion || 'PDX')}</span>
            <div class="sop-import-item-meta">${escapeHtml(r.fecha_estudio || '—')} · ${escapeHtml(r.estudio_texto || '—')}</div>
            <div class="sop-import-item-meta">${escapeHtml(r.carpeta_nombre)} (${escapeHtml(r.periodo)})</div>
          </div>
          <i data-lucide="file-text" style="width:18px;height:18px;color:#94a3b8;flex-shrink:0"></i>
        </div>`).join('');
      resultsEl.querySelectorAll('.sop-import-item').forEach((row) => {
        row.addEventListener('click', () => {
          selectedId = parseInt(row.dataset.pdxArchivo, 10);
          resultsEl.querySelectorAll('.sop-import-item').forEach((el) => el.classList.toggle('selected', parseInt(el.dataset.pdxArchivo, 10) === selectedId));
          btnOk.disabled = !selectedId;
        });
      });
      sopIcons(resultsEl);
    }

    async function runImportSearch() {
      const q = input.value.trim();
      if (q.length < 2) {
        resultsEl.innerHTML = '<div class="sop-empty" style="padding:20px;font-size:.85rem">Escriba al menos 2 caracteres</div>';
        selectedId = null;
        btnOk.disabled = true;
        return;
      }
      resultsEl.innerHTML = '<div class="sop-empty" style="padding:20px"><i data-lucide="loader" class="sop-empty-icon"></i> Buscando…</div>';
      sopIcons(resultsEl);
      try {
        const res = await apiFetch(`/api/soportes/pdx/buscar?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        renderImportResults(data.resultados || []);
      } catch (e) {
        resultsEl.innerHTML = `<div class="sop-empty" style="padding:20px;color:#dc2626">${escapeHtml(e.message)}</div>`;
      }
    }

    input.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(runImportSearch, 320);
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); runImportSearch(); } });

    modal.querySelector('#sopImpCancel').onclick = () => closeSopModal(modal);
    btnOk.onclick = async () => {
      if (!selectedId) return sopToast('Seleccione un archivo', 'warning');
      btnOk.disabled = true;
      const r = await apiFetch(`/api/soportes/armado/expedientes/${expId}/importar-deposito`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdx_archivo_id: selectedId })
      });
      const d = await r.json();
      btnOk.disabled = false;
      if (!r.ok) { sopToast(d.error || 'Error al enlazar', 'error'); return; }
      if (d.warnings?.length) sopToast(d.warnings.join(' · '), 'warning');
      closeSopModal(modal);
      sopToast(d.message || 'Archivo enlazado', 'success');
      abrirExpedienteArmado(expId);
    };
    input.focus();
  }

  function modalEditarExpediente(expId, expData) {
    const cargar = expData
      ? Promise.resolve({ expediente: expData })
      : apiFetch(`/api/soportes/armado/expedientes/${expId}`).then((r) => r.json());
    cargar.then((data) => {
      const ex = data.expediente || data;
      if (!ex?.id && !expId) return sopToast('No se pudo cargar la carpeta', 'error');
      const id = ex.id || expId;
      const pendiente = ex.numero_factura == null || Number(ex.numero_factura) <= 0;
      const modal = openSopModal(`
        <h3><i data-lucide="pencil"></i> Editar carpeta</h3>
        <p class="sop-dialog-lead">Código actual: <strong>${escapeHtml(ex.codigo)}</strong>${ex.paciente_nombre ? ` · ${escapeHtml(ex.paciente_nombre)}` : ''}</p>
        ${pendiente ? `<div class="sop-field"><label>Paciente (nombre y apellido)</label>
          <input type="text" id="sopExpEditPaciente" value="${escapeHtml(ex.paciente_nombre || '')}" placeholder="Nombre Apellido"></div>` : ''}
        <div class="sop-field"><label>Documento paciente <span class="sop-label-opt">(opcional)</span></label>
          <input type="text" id="sopExpEditDoc" value="${escapeHtml(ex.paciente_documento || '')}"></div>
        <div class="sop-field"><label>Notas</label>
          <textarea id="sopExpEditNotas" rows="3">${escapeHtml(ex.notas || '')}</textarea></div>
        ${!pendiente ? '<p class="sop-pdx-format-nota">Con factura vinculada no puede cambiar el nombre de la carpeta del paciente.</p>' : ''}
        <div class="sop-dialog-actions">
          <button type="button" class="sop-btn sop-btn-ghost" id="sopExpEditCancel">Cancelar</button>
          <button type="button" class="sop-btn sop-btn-teal" id="sopExpEditOk">Guardar</button>
        </div>`);
      modal.querySelector('#sopExpEditCancel').onclick = () => closeSopModal(modal);
      modal.querySelector('#sopExpEditOk').onclick = async () => {
        const body = {
          paciente_documento: modal.querySelector('#sopExpEditDoc')?.value?.trim() || null,
          notas: modal.querySelector('#sopExpEditNotas')?.value?.trim() || null
        };
        if (pendiente) {
          const linea = modal.querySelector('#sopExpEditPaciente')?.value?.trim();
          if (linea) body.paciente_linea = linea;
        }
        const res = await apiFetch(`/api/soportes/armado/expedientes/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const d = await res.json();
        if (!res.ok) { sopToast(d.error, 'error'); return; }
        closeSopModal(modal);
        sopToast('Carpeta actualizada', 'success');
        if (armState.contenedorId) await seleccionarContenedorArmado(armState.contenedorId);
        if (armState.expedienteId === id) abrirExpedienteArmado(id);
      };
    });
  }

  function modalEliminarExpediente(expId, codigoLabel) {
    const modal = openSopModal(`
      <h3><i data-lucide="trash-2" style="color:#dc2626"></i> Eliminar carpeta</h3>
      <p class="sop-dialog-lead">Se eliminará <strong>${escapeHtml(codigoLabel || 'esta carpeta')}</strong> en SOPORTES y RIPS, con todos sus archivos. Esta acción no se puede deshacer.</p>
      <div class="sop-dialog-actions">
        <button type="button" class="sop-btn sop-btn-ghost" id="sopExpDelCancel">Cancelar</button>
        <button type="button" class="sop-btn sop-btn-danger" id="sopExpDelOk">Eliminar</button>
      </div>`);
    modal.querySelector('#sopExpDelCancel').onclick = () => closeSopModal(modal);
    modal.querySelector('#sopExpDelOk').onclick = async () => {
      const res = await apiFetch(`/api/soportes/armado/expedientes/${expId}`, { method: 'DELETE' });
      const d = await res.json();
      if (!res.ok) { sopToast(d.error, 'error'); return; }
      closeSopModal(modal);
      sopToast('Carpeta eliminada', 'success');
      armState.expedienteId = null;
      if (armState.contenedorId) await seleccionarContenedorArmado(armState.contenedorId);
    };
  }

  function modalNuevoExpediente() {
    if (!armState.contenedorId) return sopToast('Seleccione RIPS o SOPORTES', 'warning');
    const tipoLabel = labelContenedorArmado(armState.contenedorTipo);
    const modal = openSopModal(`
      <h3><i data-lucide="folder-plus"></i> Carpetas por paciente</h3>
      <p class="sop-dialog-lead">Ubicación: <strong>${escapeHtml(tipoLabel)}</strong> · ${escapeHtml(armState.diaLabel || '')}.</p>
      <div class="sop-field">
        <label for="sopFeLista">Lista de pacientes <span class="sop-label-opt">(un nombre por línea)</span></label>
        <textarea id="sopFeLista" rows="8" placeholder="Juan Pérez&#10;María García&#10;Pérez, Luis"></textarea>
      </div>
      <div class="sop-field" style="border-top:1px solid var(--sop-border,#e2e8f0);padding-top:12px">
        <label for="sopFeUnPaciente">Un solo paciente <span class="sop-label-opt">(opcional)</span></label>
        <input type="text" id="sopFeUnPaciente" autocomplete="off" placeholder="Nombre Apellido">
      </div>
      <div class="sop-dialog-actions">
        <button type="button" class="sop-btn sop-btn-ghost" id="sopFeCancel">Cancelar</button>
        <button type="button" class="sop-btn sop-btn-teal" id="sopFeSiguiente">Crear carpetas</button>
      </div>`);
    modal.querySelector('#sopFeCancel').onclick = () => closeSopModal(modal);
    modal.querySelector('#sopFeSiguiente').onclick = async () => {
      const lista = $('sopFeLista')?.value?.trim() || '';
      const uno = $('sopFeUnPaciente')?.value?.trim() || '';
      const texto = lista || (uno ? uno : '');
      if (!texto) { sopToast('Escriba al menos un paciente', 'warning'); return; }
      const lineas = texto.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const esLote = lineas.length > 1;
      const url = esLote
        ? `/api/soportes/armado/contenedores/${armState.contenedorId}/expedientes/lote`
        : `/api/soportes/armado/contenedores/${armState.contenedorId}/expedientes`;
      const body = esLote ? { lista: texto } : { paciente_linea: lineas[0] || texto };
      const res = await apiFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      let data = {};
      try { data = await res.json(); } catch (_) { /* ignore */ }
      if (!res.ok) { sopToast(data.error || `Error ${res.status} al crear carpetas`, 'error'); return; }
      closeSopModal(modal);
      const n = data.creados?.length || (data.expediente ? 1 : 0);
      if (data.errores?.length) {
        sopToast(`${n} creada(s), ${data.errores.length} con error`, 'warning');
      } else {
        sopToast(`${n} carpeta(s) creada(s)`, 'success');
      }
      const pid = armState.periodoId;
      const did = armState.diaId;
      const cid = armState.contenedorId;
      await seleccionarPeriodoArmado(pid);
      await seleccionarDiaArmado(did);
      await seleccionarContenedorArmado(cid);
      const first = data.expediente?.id || data.creados?.[0]?.id;
      if (first && n === 1) abrirExpedienteArmado(first);
    };
  }

  function modalNuevoPeriodoArmado() {
    const per = periodoActual();
    const [y, m] = per.split('-').map(Number);
    const meses = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];
    const defEti = `${meses[(m || 1) - 1]} ${y}`;
    const modal = openSopModal(`
      <h3><i data-lucide="calendar-range"></i> Nuevo mes</h3>
      <div class="sop-field"><label>Mes (periodo)</label><input type="month" id="sopArmNewPer" value="${per}"></div>
      <div class="sop-field"><label>Nombre de la carpeta del mes</label><input id="sopArmNewEti" value="${escapeHtml(defEti)}" placeholder="MAYO 2026"></div>
      <div class="sop-dialog-actions">
        <button type="button" class="sop-btn sop-btn-ghost" id="sopArmPerCancel">Cancelar</button>
        <button type="button" class="sop-btn sop-btn-teal" id="sopArmPerOk">Crear</button>
      </div>`);
    modal.querySelector('#sopArmPerCancel').onclick = () => closeSopModal(modal);
    modal.querySelector('#sopArmPerOk').onclick = async () => {
      const periodo = $('sopArmNewPer').value;
      const etiqueta = $('sopArmNewEti').value.trim() || periodo;
      const res = await apiFetch('/api/soportes/armado/periodos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ periodo, etiqueta })
      });
      const data = await res.json();
      if (!res.ok) { sopToast(data.error, 'error'); return; }
      closeSopModal(modal);
      sopToast('Periodo creado', 'success');
      await cargarPeriodosArmado();
      renderPeriodosArmado();
      if (data.periodo?.id) seleccionarPeriodoArmado(data.periodo.id);
    };
  }

  function modalEditarDiaArmado(diaId) {
    const d = armState.dias.find((x) => x.id === diaId);
    if (!d) return sopToast('Carpeta no encontrada', 'warning');
    const modal = openSopModal(`
      <h3><i data-lucide="pencil"></i> Editar carpeta de día</h3>
      <div class="sop-field"><label>Nombre de la carpeta</label>
        <input id="sopArmDiaEditNom" value="${escapeHtml(d.nombre_display)}"></div>
      <div class="sop-field"><label>Estado de facturación</label>
        <select id="sopArmDiaEditFact">
          <option value="a_facturar"${d.estado_facturacion !== 'facturados' ? ' selected' : ''}>A facturar</option>
          <option value="facturados"${d.estado_facturacion === 'facturados' ? ' selected' : ''}>Facturados</option>
        </select></div>
      <p class="sop-pdx-format-nota" style="margin:8px 0 0">Si cambia el nombre o el estado, las carpetas en disco se renombran automáticamente.</p>
      <div class="sop-dialog-actions">
        <button type="button" class="sop-btn sop-btn-ghost" id="sopArmDiaEditCancel">Cancelar</button>
        <button type="button" class="sop-btn sop-btn-teal" id="sopArmDiaEditOk">Guardar</button>
      </div>`);
    modal.querySelector('#sopArmDiaEditCancel').onclick = () => closeSopModal(modal);
    modal.querySelector('#sopArmDiaEditOk').onclick = async () => {
      const nombre_display = $('sopArmDiaEditNom')?.value?.trim();
      const estado_facturacion = $('sopArmDiaEditFact')?.value;
      if (!nombre_display) return sopToast('Indique el nombre', 'warning');
      const res = await apiFetch(`/api/soportes/armado/dias/${diaId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre_display, estado_facturacion })
      });
      const data = await res.json();
      if (!res.ok) { sopToast(data.error, 'error'); return; }
      closeSopModal(modal);
      sopToast('Carpeta actualizada', 'success');
      await seleccionarPeriodoArmado(armState.periodoId);
      if (data.dia?.id) seleccionarDiaArmado(data.dia.id);
    };
  }

  function modalEliminarDiaArmado(diaId, nombre) {
    const d = armState.dias.find((x) => x.id === diaId);
    const feCount = d?.expedientes_count || 0;
    const modal = openSopModal(`
      <h3><i data-lucide="trash-2" style="color:#dc2626"></i> Eliminar carpeta de día</h3>
      <p class="sop-dialog-lead">Se eliminará <strong>${escapeHtml(nombre || '')}</strong> con <strong>${feCount}</strong> expediente(s) FE, todos sus archivos en SOPORTES y RIPS. No se puede deshacer.</p>
      <div class="sop-dialog-actions">
        <button type="button" class="sop-btn sop-btn-ghost" id="sopArmDiaDelCancel">Cancelar</button>
        <button type="button" class="sop-btn sop-btn-danger" id="sopArmDiaDelOk">Eliminar todo</button>
      </div>`);
    modal.querySelector('#sopArmDiaDelCancel').onclick = () => closeSopModal(modal);
    modal.querySelector('#sopArmDiaDelOk').onclick = async () => {
      const res = await apiFetch(`/api/soportes/armado/dias/${diaId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) { sopToast(data.error, 'error'); return; }
      closeSopModal(modal);
      sopToast('Carpeta de día eliminada', 'success');
      armState.diaId = null;
      await seleccionarPeriodoArmado(armState.periodoId);
      renderArmadoPlaceholder('Seleccione una carpeta de día');
    };
  }

  function modalNuevoDiaArmado() {
    if (!armState.periodoId) return sopToast('Seleccione un mes primero', 'warning');
    const perLabel = armState.periodoLabel || '';
    const modal = openSopModal(`
      <h3><i data-lucide="folder-plus"></i> Nueva carpeta de día</h3>
      <p style="font-size:.85rem;color:#64748b;margin:-6px 0 12px">Dentro de <strong>${escapeHtml(perLabel)}</strong>. Se crearán automáticamente las carpetas <strong>RIPS</strong> y <strong>SOPORTES</strong>.</p>
      <div class="sop-field"><label>Nombre de la carpeta</label>
        <input id="sopArmDiaNom" placeholder="Ej: MAYO 1, MAYO 2-3"></div>
      <div class="sop-field"><label>Estado de facturación</label>
        <select id="sopArmDiaFact">
          <option value="a_facturar">A facturar</option>
          <option value="facturados">Facturados</option>
        </select></div>
      <div class="sop-dialog-actions">
        <button type="button" class="sop-btn sop-btn-ghost" id="sopArmDiaCancel">Cancelar</button>
        <button type="button" class="sop-btn sop-btn-teal" id="sopArmDiaOk">Crear carpeta</button>
      </div>`);
    modal.querySelector('#sopArmDiaCancel').onclick = () => closeSopModal(modal);
    modal.querySelector('#sopArmDiaOk').onclick = async () => {
      const nombre_display = $('sopArmDiaNom').value.trim();
      const estado_facturacion = $('sopArmDiaFact').value;
      if (!nombre_display) return sopToast('Indique el nombre de la carpeta', 'warning');
      const res = await apiFetch(`/api/soportes/armado/periodos/${armState.periodoId}/dias`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre_display, estado_facturacion })
      });
      const data = await res.json();
      if (!res.ok) { sopToast(data.error, 'error'); return; }
      closeSopModal(modal);
      sopToast('Carpeta creada con RIPS y SOPORTES', 'success');
      await seleccionarPeriodoArmado(armState.periodoId);
      if (data.dia?.id) seleccionarDiaArmado(data.dia.id);
    };
  }

  window.initArmadoSoportes = function initArmadoSoportes() {
    sopIcons($('view-armado-soportes'));
    sopAnimateModuleIn('view-armado-soportes');
    if (initArmadoDone) {
      cargarPeriodosArmado().then(renderPeriodosArmado).catch(console.error);
      return;
    }
    initArmadoDone = true;
    $('btnVolverArmadoSoportes')?.addEventListener('click', () => {
      sopArmNavOpen(false);
      goToMenu();
    });
    $('btnSopArmToggleNav')?.addEventListener('click', () => {
      const layout = $('sopArmLayout');
      sopArmNavOpen(!layout?.classList.contains('sop-nav-open'));
    });
    $('sopArmNavBackdrop')?.addEventListener('click', () => sopArmNavOpen(false));
    $('btnSopArmNuevoPeriodo')?.addEventListener('click', modalNuevoPeriodoArmado);
    $('btnSopArmNuevoDia')?.addEventListener('click', modalNuevoDiaArmado);
    $('sopArmBuscarPaciente')?.addEventListener('input', buscarArmadoPacientePredictivo);
    $('sopArmBuscarPaciente')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); buscarArmadoPaciente(); }
      if (e.key === 'Escape') cerrarResultadosArmado();
    });
    renderArmadoContextBar();
    cargarPeriodosArmado().then(renderPeriodosArmado).catch((e) => sopToast(e.message, 'error'));
  };
})();
