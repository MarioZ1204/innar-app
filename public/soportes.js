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

  const ARM_DRAG_HOLD_MS = 300;
  let armDragSession = null;
  let armBlockClickUntil = 0;

  const PDX_LOG_LABEL = {
    subida: 'Subida',
    edicion: 'Edición de metadatos',
    reemplazo: 'Reemplazo de PDF',
    resaltado: 'Resaltado en PDF',
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

  const TIPOS_DOC_CLIENT = ['CC', 'TI', 'CE', 'PA', 'RC', 'NUIP', 'PEP', 'PT'];

  function normalizarNumeroDocumentoCliente(raw) {
    return String(raw || '').replace(/\D/g, '');
  }

  function normalizarTipoDocumentoCliente(raw) {
    const u = String(raw || '').trim().toUpperCase().replace(/[^A-Z]/g, '');
    if (TIPOS_DOC_CLIENT.includes(u)) return u;
    if (TIPOS_DOC_CLIENT.includes(u.slice(0, 4))) return u.slice(0, 4);
    if (TIPOS_DOC_CLIENT.includes(u.slice(0, 2))) return u.slice(0, 2);
    return 'CC';
  }

  function normalizarParDocumentoCliente(tipoRaw, docRaw) {
    return {
      tipo_documento: normalizarTipoDocumentoCliente(tipoRaw),
      paciente_documento: normalizarNumeroDocumentoCliente(docRaw)
    };
  }

  function esInputTipoDocumentoPdx(el) {
    return el && el.tagName === 'INPUT' && (
      el.dataset.campoTipo === 'tipo_doc' || el.dataset.key === 'tipo_documento'
    );
  }

  function esInputNumeroDocumentoPdx(el) {
    return el && el.tagName === 'INPUT' && (
      el.dataset.campoTipo === 'doc_numero' || el.dataset.key === 'paciente_documento'
    );
  }

  /** Convierte a mayúsculas y solo letras A–Z (máx. 4, p. ej. NUIP). */
  function aplicarEntradaTipoDocumentoPdx(inp) {
    if (!inp) return;
    const prev = String(inp.value || '');
    const next = prev.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
    if (prev === next) return;
    const pos = inp.selectionStart;
    inp.value = next;
    try {
      const p = Math.min(pos, next.length);
      inp.setSelectionRange(p, p);
    } catch (_) { /* ignore */ }
  }

  /** Solo dígitos mientras se escribe (máx. 20). */
  function aplicarEntradaNumeroDocumentoPdx(inp) {
    if (!inp) return;
    const prev = String(inp.value || '');
    const next = prev.replace(/\D/g, '').slice(0, 20);
    if (prev === next) return;
    const pos = inp.selectionStart;
    inp.value = next;
    try {
      const p = Math.min(pos, next.length);
      inp.setSelectionRange(p, p);
    } catch (_) { /* ignore */ }
  }

  function valorTipoDocEnInput(inp, selected) {
    if (!inp) return;
    inp.value = normalizarTipoDocumentoCliente(selected || 'CC');
  }

  function setupEntradaDocumentoPdx() {
    if (document.body.dataset.pdxDocInputBound) return;
    document.body.dataset.pdxDocInputBound = '1';
    document.body.addEventListener('input', (e) => {
      if (!e.target?.closest?.('.sop-dialog')) return;
      const t = e.target;
      if (esInputTipoDocumentoPdx(t)) aplicarEntradaTipoDocumentoPdx(t);
      else if (esInputNumeroDocumentoPdx(t)) aplicarEntradaNumeroDocumentoPdx(t);
    });
    document.body.addEventListener('blur', (e) => {
      if (!e.target?.closest?.('.sop-dialog')) return;
      const t = e.target;
      if (esInputTipoDocumentoPdx(t)) {
        t.value = normalizarTipoDocumentoCliente(t.value);
      } else if (esInputNumeroDocumentoPdx(t)) {
        t.value = normalizarNumeroDocumentoCliente(t.value);
      }
    }, true);
  }

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
      pattern: 'Apellidos, Nombres   YYYY-MM-DD.pdf',
      ejemplo: 'García López, Juan Carlos   2026-05-27.pdf',
      nota: 'No incluya número de documento. Separe con espacios (no use guiones entre campos). Al descargar se añade el tipo de estudio PSG según la carpeta.'
    },
    actigrafia: {
      pattern: 'Apellidos, Nombres   YYYY-MM-DD.pdf',
      ejemplo: 'García López, Juan Carlos   2026-05-27.pdf',
      nota: 'Al descargar se añade el tipo de estudio al nombre del archivo.'
    },
    latencia: {
      pattern: 'Apellidos, Nombres   YYYY-MM-DD.pdf',
      ejemplo: 'García López, Juan Carlos   2026-05-27.pdf',
      nota: 'Al descargar se añade el tipo de estudio (prueba de latencia múltiple del sueño) al nombre del archivo.'
    },
    ordenes: {
      pattern: 'ORDEN + HC APELLIDOS NOMBRES TIPO DOC (CC, TI…) DOCUMENTO (solo números) FECHA TIPO DE ESTUDIO.pdf',
      ejemplo: 'ORDEN + HC García López Juan Carlos CC 1234567890 2026-05-27 PSG Basal.pdf',
      nota: 'Tipo: 2 letras (CC, TI, RC…). Documento: solo dígitos, sin puntos ni guiones. Separe los campos con espacios (no use guiones entre campos).'
    },
    comprobantes: {
      pattern: 'COMPROBANTE APELLIDOS NOMBRES TIPO DOC (CC, TI…) DOCUMENTO (solo números) FECHA TIPO DE ESTUDIO.pdf',
      ejemplo: 'COMPROBANTE García López Juan Carlos CC 1234567890 2026-05-27 PSG Basal.pdf',
      nota: 'Tipo: 2 letras. Documento: solo dígitos. Separe los campos con espacios (no use guiones entre campos).'
    },
    comprobantes_consulta_medica: {
      pattern: 'COMPROBANTE NOMBRES APELLIDOS YYYY-MM-DD ESPECIALIDAD.pdf',
      ejemplo: 'COMPROBANTE Juan Carlos García López 2026-05-27 Neurología.pdf',
      nota: 'Carpeta COMPROBANTE. CONSULTAS MÉDICAS. Sin documento; use especialidad (Neurología, Epileptología…).'
    },
    ordenes_consulta_medica: {
      pattern: 'ORDEN + HC NOMBRES APELLIDOS YYYY-MM-DD ESPECIALIDAD.pdf',
      ejemplo: 'ORDEN + HC Juan Carlos García López 2026-05-27 Neurología.pdf',
      nota: 'Sin documento. Puede subir 2 o más PDF (p. ej. orden y HC por separado); ordénelos y se unifican en uno solo.'
    },
    consentimientos: {
      pattern: 'CONSENTIMIENTO APELLIDOS NOMBRES TIPO DOC (CC, TI…) DOCUMENTO (solo números) FECHA TIPO DE ESTUDIO.pdf',
      ejemplo: 'CONSENTIMIENTO García López Juan Carlos CC 1234567890 2026-05-27 PSG Basal.pdf',
      nota: 'Tipo: 2 letras; documento: solo dígitos. El nombre guardado empieza por CONSENTIMIENTO. Separe los campos con espacios (no use guiones entre campos).'
    },
    neutral: {
      pattern: 'Apellidos, Nombres   YYYY-MM-DD.pdf',
      ejemplo: 'García López, Juan Carlos   2026-05-27.pdf'
    }
  };

  function detectarTemaCarpetaCliente(nombreCarpeta) {
    const u = String(nombreCarpeta || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const consultasMed = /\bconsultas?\s+medicas?\b/.test(u) || (u.includes('consulta') && u.includes('medica'));
    if (consultasMed && /\bcomprobante/.test(u)) return 'comprobantes_consulta_medica';
    if (consultasMed && (/\bordenes\b/.test(u) || /\borden\s*\+\s*hc\b/.test(u) || (/\borden\b/.test(u) && /\bhc\b/.test(u)))) {
      return 'ordenes_consulta_medica';
    }
    if (/\bcomprobante/.test(u)) return 'comprobantes';
    if (/\bconsentimiento/.test(u)) return 'consentimientos';
    if (/\bordenes\b/.test(u) || /\borden\s*\+\s*hc\b/.test(u) || (/\borden\b/.test(u) && /\bhc\b/.test(u))) return 'ordenes';
    if (/\bvtm\b/.test(u) || u.includes('videotelemetria') || u.includes('telemetria')) return 'vtm';
    if (u.includes('actigraf')) return 'actigrafia';
    if (
      u.includes('mslt') ||
      u.includes('test de latencia') ||
      (u.includes('latencia') && (u.includes('sueno') || u.includes('multiple') || u.includes('tlm')))
    ) {
      return 'latencia';
    }
    if (u.includes('polisomnog') || /\bpsg\b/.test(u) || u.startsWith('psg ') || u.includes('cpap') || u.includes('bpap')) return 'psg';
    if (u.includes('electroencefalog') || (/\beeg\b/.test(u) && !u.includes('monitoriz'))) return 'eeg';
    return 'neutral';
  }

  function esCarpetaEstructuradaPdx(carpetaOrNombre) {
    const t = detectarTemaCarpetaCliente(typeof carpetaOrNombre === 'string' ? carpetaOrNombre : carpetaOrNombre?.nombre_display);
    return ['ordenes', 'comprobantes', 'consentimientos', 'comprobantes_consulta_medica', 'ordenes_consulta_medica'].includes(t);
  }

  function esCarpetaConsultaMedicaPdx(carpetaOrNombre) {
    const t = detectarTemaCarpetaCliente(typeof carpetaOrNombre === 'string' ? carpetaOrNombre : carpetaOrNombre?.nombre_display);
    return t === 'comprobantes_consulta_medica' || t === 'ordenes_consulta_medica';
  }

  function esCarpetaComprobanteConsultaMedicaPdx(carpetaOrNombre) {
    const t = detectarTemaCarpetaCliente(typeof carpetaOrNombre === 'string' ? carpetaOrNombre : carpetaOrNombre?.nombre_display);
    return t === 'comprobantes_consulta_medica';
  }

  function esCarpetaPsgReportePdx(carpetaOrNombre) {
    return detectarTemaCarpetaCliente(typeof carpetaOrNombre === 'string' ? carpetaOrNombre : carpetaOrNombre?.nombre_display) === 'psg';
  }

  function esCarpetaReporteClinicoPdx(carpetaOrNombre) {
    const t = detectarTemaCarpetaCliente(typeof carpetaOrNombre === 'string' ? carpetaOrNombre : carpetaOrNombre?.nombre_display);
    return ['vtm', 'psg', 'eeg', 'actigrafia', 'latencia'].includes(t);
  }

  function esCarpetaSubidaMultipleIndividualPdx(carpetaOrNombre) {
    const t = detectarTemaCarpetaCliente(typeof carpetaOrNombre === 'string' ? carpetaOrNombre : carpetaOrNombre?.nombre_display);
    if (['comprobantes', 'comprobantes_consulta_medica', 'consentimientos'].includes(t)) return true;
    return esCarpetaReporteClinicoPdx(carpetaOrNombre);
  }

  function splitSegmentosGuionesEspaciadosCliente(texto) {
    return String(texto || '').split(/\s+-\s+/).map((p) => p.trim()).filter(Boolean);
  }

  function esSegmentoDocumentoCliente(seg) {
    const n = normalizarNumeroDocumentoCliente(seg);
    return n.length >= 4 && n.length <= 20;
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
      if (parts.length > offset + 2) {
        const doc = normalizarParDocumentoCliente(parts[offset + 2], parts[offset + 3] || '');
        parcial.tipo_documento = doc.tipo_documento;
        parcial.paciente_documento = doc.paciente_documento;
      }
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

  function separarNombreCompletoConsultaMedicaCliente(texto) {
    const t = String(texto || '').trim().replace(/\.pdf$/i, '').replace(/[\s\-.]+$/g, '');
    if (!t) return { nombres: '', apellidos: '' };
    if (t.includes(',')) {
      const c = t.indexOf(',');
      return { apellidos: t.slice(0, c).trim(), nombres: t.slice(c + 1).trim() };
    }
    const tokens = t.split(/\s+/).filter(Boolean);
    if (tokens.length < 2) return { nombres: t, apellidos: '' };
    const mid = Math.ceil(tokens.length / 2);
    return {
      nombres: tokens.slice(0, mid).join(' '),
      apellidos: tokens.slice(mid).join(' ')
    };
  }

  function parseNombreEstructuradoCliente(originalName, regex, tema) {
    const base = String(originalName || '').trim();
    const m = base.match(regex);
    if (!m) return { ok: false, original: base, error: mensajeErrorFormatoCliente(tema) };
    const apellidos = m[1].trim();
    const nombres = m[2].trim();
    const doc = normalizarParDocumentoCliente(m[3], m[4]);
    return {
      ok: true,
      original: base,
      apellidos,
      nombres,
      tipo_documento: doc.tipo_documento,
      paciente_documento: doc.paciente_documento,
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
      case 'comprobantes_consulta_medica':
      case 'ordenes_consulta_medica': {
        const parsed = parseNombrePdxCliente(originalName);
        if (parsed.ok) {
          const { nombres, apellidos } = parsed;
          if (!nombres || !apellidos) {
            const split = separarNombreCompletoConsultaMedicaCliente(originalName);
            if (split.nombres || split.apellidos) {
              parsed.nombres = split.nombres;
              parsed.apellidos = split.apellidos;
            }
          }
          if (!parsed.estudio_texto) parsed.estudio_texto = inferirEstudioCliente(carpeta);
          if (parsed.ok && parsed.nombres && parsed.apellidos) {
            parsed.paciente_nombre = `${parsed.apellidos}, ${parsed.nombres}`;
          }
        }
        return parsed;
      }
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

  let _cacheTiposConsultaPdx = {};

  async function obtenerTiposConsultaPdx(especialidad) {
    const esp = String(especialidad || '').trim();
    if (!esp) return [];
    if (_cacheTiposConsultaPdx[esp]) return _cacheTiposConsultaPdx[esp];
    try {
      const res = await apiFetch(`/api/tipos-consulta?especialidad_nombre=${encodeURIComponent(esp)}`);
      const data = res.ok ? await res.json() : [];
      const lista = (Array.isArray(data) ? data : [])
        .map((e) => (typeof e === 'string' ? { nombre: e } : e))
        .filter((e) => e?.nombre)
        .sort((a, b) => {
          const oa = a.orden ?? 999;
          const ob = b.orden ?? 999;
          if (oa !== ob) return oa - ob;
          return String(a.nombre).localeCompare(String(b.nombre), 'es', { sensitivity: 'base' });
        });
      _cacheTiposConsultaPdx[esp] = lista;
      return lista;
    } catch (_) {
      return [];
    }
  }

  async function poblarSelectTipoConsultaPdx(selectEl, selected, especialidad) {
    if (!selectEl) return;
    const esp = String(especialidad || '').trim();
    const sel = String(selected || '');
    if (!esp) {
      selectEl.innerHTML = '<option value="">Seleccione especialidad primero</option>';
      selectEl.disabled = true;
      return;
    }
    selectEl.disabled = false;
    const tipos = await obtenerTiposConsultaPdx(esp);
    if (!tipos.length) {
      selectEl.innerHTML = '<option value="">Sin tipos para esta especialidad</option>';
      return;
    }
    selectEl.innerHTML = '<option value="">Seleccionar tipo de consulta</option>' +
      tipos.map((e) => {
        const nom = e.nombre || '';
        return `<option value="${escapeHtml(nom)}"${nom === sel ? ' selected' : ''}>${escapeHtml(nom)}</option>`;
      }).join('');
  }

  async function enlazarEspecialidadConTipoConsultaPdx(espSel, tipoSel, selectedTipo) {
    if (!espSel || !tipoSel) return;
    let tipoInicial = String(selectedTipo || '').trim();
    const refrescar = async (resetTipo) => {
      const esp = espSel.value?.trim();
      const prev = resetTipo ? '' : tipoInicial;
      tipoInicial = '';
      await poblarSelectTipoConsultaPdx(tipoSel, prev, esp);
    };
    espSel.addEventListener('change', () => refrescar(true));
    await refrescar(false);
  }

  let _cacheEspecialidadesPdx = null;

  async function obtenerEspecialidadesPdx() {
    if (_cacheEspecialidadesPdx) return _cacheEspecialidadesPdx;
    try {
      const res = await apiFetch('/api/especialidades');
      const data = res.ok ? await res.json() : [];
      const lista = (Array.isArray(data) ? data : [])
        .map((e) => (typeof e === 'string' ? { nombre: e } : e))
        .filter((e) => e?.nombre)
        .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es', { sensitivity: 'base' }));
      _cacheEspecialidadesPdx = lista.length ? lista : null;
    } catch (_) {
      _cacheEspecialidadesPdx = null;
    }
    return _cacheEspecialidadesPdx || [];
  }

  async function poblarSelectEspecialidadPdx(selectEl, selected) {
    if (!selectEl) return;
    const lista = await obtenerEspecialidadesPdx();
    const sel = String(selected || '');
    selectEl.innerHTML = '<option value="">Seleccionar especialidad</option>' +
      lista.map((e) => {
        const nom = e.nombre || '';
        return `<option value="${escapeHtml(nom)}"${nom === sel ? ' selected' : ''}>${escapeHtml(nom)}</option>`;
      }).join('');
  }

  function camposMinimosAyudaCliente(tema) {
    const oblig = ['Apellidos', 'Nombres', 'Fecha del estudio'];
    const opcUnificar = ['Varios PDF: ordénelos y se unifican en un solo archivo'];
    const opcMulti = ['Varios PDF: cada uno con sus propios datos (no se unifican)'];
    if (tema === 'comprobantes_consulta_medica') {
      return { oblig: ['Nombre completo', 'Fecha del estudio', 'Especialidad', 'Tipo de consulta'], opc: opcMulti };
    }
    if (tema === 'ordenes_consulta_medica') {
      return { oblig: ['Nombre completo', 'Fecha del estudio', 'Especialidad'], opc: opcUnificar };
    }
    if (esCarpetaEstructuradaPdx({ nombre_display: tema }) && !esCarpetaConsultaMedicaPdx({ nombre_display: tema })) {
      return { oblig: [...oblig, 'Número de documento (solo dígitos)', 'Tipo de examen'], opc: [...opcUnificar, 'Tipo de documento (CC, TI, RC…)'] };
    }
    if (tema === 'psg') {
      return { oblig: [...oblig, 'Tipo PSG (Básica, CPAP, BPAP)'], opc: [...opcMulti, 'Documento'] };
    }
    if (['vtm', 'eeg', 'actigrafia', 'latencia'].includes(tema)) {
      return { oblig, opc: [...opcMulti, 'Estudio (se completa según la carpeta)'] };
    }
    return { oblig, opc: opcUnificar };
  }

  function camposFallbackUnificarPdx(tema) {
    if (tema === 'comprobantes_consulta_medica') {
      return [
        { key: 'paciente_nombre_completo', label: 'Nombre completo', requerido: true, input: 'nombre_completo', estado: 'falta' },
        { key: 'fecha_estudio', label: 'Fecha del estudio', requerido: true, input: 'date', estado: 'falta' },
        { key: 'estudio_texto', label: 'Especialidad', requerido: true, input: 'especialidad', estado: 'falta' },
        { key: 'tipo_consulta', label: 'Tipo de consulta', requerido: true, input: 'tipo_consulta', estado: 'falta' }
      ];
    }
    if (tema === 'ordenes_consulta_medica') {
      return [
        { key: 'paciente_nombre_completo', label: 'Nombre completo', requerido: true, input: 'nombre_completo', estado: 'falta' },
        { key: 'fecha_estudio', label: 'Fecha del estudio', requerido: true, input: 'date', estado: 'falta' },
        { key: 'estudio_texto', label: 'Especialidad', requerido: true, input: 'especialidad', estado: 'falta' }
      ];
    }
    const base = [
      { key: 'apellidos', label: 'Apellidos', requerido: true, input: 'text', estado: 'falta' },
      { key: 'nombres', label: 'Nombres', requerido: true, input: 'text', estado: 'falta' },
      { key: 'fecha_estudio', label: 'Fecha del estudio', requerido: true, input: 'date', estado: 'falta' }
    ];
    if (esCarpetaEstructuradaPdx({ nombre_display: tema }) && !esCarpetaConsultaMedicaPdx({ nombre_display: tema })) {
      base.push(
        { key: 'tipo_documento', label: 'Tipo de documento', requerido: false, input: 'tipo_doc', estado: 'opc', defecto: 'CC' },
        { key: 'paciente_documento', label: 'Número de documento', requerido: true, input: 'doc_numero', estado: 'falta' },
        { key: 'estudio_texto', label: 'Tipo de examen', requerido: true, input: 'estudio', estado: 'falta' }
      );
    } else if (tema === 'psg') {
      base.push(
        { key: 'paciente_documento', label: 'Número de documento', requerido: true, input: 'doc_numero', estado: 'falta' },
        { key: 'estudio_texto', label: 'Tipo de PSG', requerido: true, input: 'psg_estudio', estado: 'falta' }
      );
    }
    return base;
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
    if (c.input === 'tipo_doc') {
      const tipoVal = escapeHtml(normalizarTipoDocumentoCliente(c.valor || datos[c.key] || c.defecto || 'CC'));
      return `<div class="${wrapCls}" data-campo="${c.key}">
        <label>${escapeHtml(c.label)}${c.requerido ? ' *' : ''} ${badgeEstadoCampoPdx(c)}</label>
        <input type="text" class="sop-pdx-campo-input" data-key="${c.key}" data-campo-tipo="tipo_doc"
          value="${tipoVal}" maxlength="4" autocomplete="off" spellcheck="false"
          style="text-transform:uppercase" placeholder="CC" title="CC, TI, RC… (2 letras)"></div>`;
    }
    if (c.input === 'estudio' || c.input === 'tipo_consulta' || c.input === 'especialidad') {
      const tipoSel = c.input === 'tipo_consulta' ? 'tipo_consulta' : (c.input === 'especialidad' ? 'especialidad' : 'estudio');
      return `<div class="${wrapCls}" data-campo="${c.key}">
        <label>${escapeHtml(c.label)} * ${badgeEstadoCampoPdx(c)}</label>
        <select class="sop-pdx-campo-input" data-key="${c.key}" data-tipo="${tipoSel}"></select></div>`;
    }
    if (c.input === 'psg_estudio') {
      return `<div class="${wrapCls}" data-campo="${c.key}">
        <label>${escapeHtml(c.label)} * ${badgeEstadoCampoPdx(c)}</label>
        <select class="sop-pdx-campo-input" data-key="${c.key}" data-tipo="psg"></select></div>`;
    }
    if (c.input === 'nombre_completo') {
      const full = c.valor || datos.paciente_nombre_completo
        || ((datos.apellidos && datos.nombres) ? `${datos.nombres} ${datos.apellidos}`.trim() : (datos.paciente_nombre || ''));
      return `<div class="${wrapCls}" data-campo="${c.key}">
        <label>${escapeHtml(c.label)}${c.requerido ? ' *' : ''} ${badgeEstadoCampoPdx(c)}</label>
        <input type="text" class="sop-pdx-campo-input" data-key="${c.key}" value="${escapeHtml(full)}" placeholder="Nombres y apellidos"></div>`;
    }
    if (c.input === 'inferred') {
      return `<div class="${wrapCls}" data-campo="${c.key}">
        <label>${escapeHtml(c.label)} ${badgeEstadoCampoPdx(c)}</label>
        <div class="sop-campo-inferred">${escapeHtml(c.valor || '—')}</div>
        <input type="hidden" class="sop-pdx-campo-input" data-key="${c.key}" value="${val}"></div>`;
    }
    return `<div class="${wrapCls}" data-campo="${c.key}">
      <label>${escapeHtml(c.label)}${c.requerido ? ' *' : ''} ${badgeEstadoCampoPdx(c)}</label>
      <input type="text" class="sop-pdx-campo-input" data-key="${c.key}" value="${val}"${c.input === 'doc_numero' || c.key === 'paciente_documento' ? ' data-campo-tipo="doc_numero" inputmode="numeric" pattern="[0-9]*"' : ''}></div>`;
  }

  function leerCamposDesdeModal(modal) {
    const body = { confirmacion_manual: '1' };
    modal.querySelectorAll('.sop-pdx-campo-input').forEach((inp) => {
      const k = inp.dataset.key;
      if (!k) return;
      body[k] = inp.tagName === 'SELECT' ? inp.value?.trim() : inp.value?.trim();
    });
    if (body.paciente_documento != null) {
      body.paciente_documento = normalizarNumeroDocumentoCliente(body.paciente_documento);
    }
    if (body.tipo_documento != null) {
      body.tipo_documento = normalizarTipoDocumentoCliente(body.tipo_documento);
    }
    if (body.paciente_nombre_completo != null) {
      const full = String(body.paciente_nombre_completo || '').trim();
      if (full) {
        const split = separarNombreCompletoConsultaMedicaCliente(full);
        if (split.nombres) body.nombres = split.nombres;
        if (split.apellidos) body.apellidos = split.apellidos;
      }
    }
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
    let espSel = null;
    let tipoSel = null;
    let selectedTipo = '';
    for (const c of campos || []) {
      if (c.input === 'tipo_doc') {
        valorTipoDocEnInput(
          modal.querySelector(`[data-key="${c.key}"][data-campo-tipo="tipo_doc"]`),
          datos.tipo_documento || c.valor
        );
        continue;
      }
      const sel = modal.querySelector(`[data-key="${c.key}"][data-tipo="estudio"], [data-key="${c.key}"][data-tipo="psg"], [data-key="${c.key}"][data-tipo="tipo_consulta"], [data-key="${c.key}"][data-tipo="especialidad"]`);
      if (!sel) continue;
      if (sel.dataset.tipo === 'psg') poblarSelectEstudioPsgCliente(sel, datos.estudio_texto || c.valor);
      else if (sel.dataset.tipo === 'tipo_consulta') {
        tipoSel = sel;
        selectedTipo = datos.tipo_consulta || datos.marca_tiempo || c.valor || '';
      } else if (sel.dataset.tipo === 'especialidad') {
        await poblarSelectEspecialidadPdx(sel, datos.estudio_texto || c.valor);
        espSel = sel;
      } else await poblarSelectEstudioPdx(sel, datos.estudio_texto || c.valor);
    }
    if (espSel && tipoSel) {
      await enlazarEspecialidadConTipoConsultaPdx(espSel, tipoSel, selectedTipo);
    }
  }

  function modalDatosArchivoPdx(file, carpetaId, analisis) {
    const carpeta = pdxState.carpetaActual || pdxState.carpetas.find((c) => c.id === carpetaId);
    const campos = analisis.campos || [];
    const datos = analisis.parcial || {};
    const esCorreccion = !!analisis.requiere_correccion;
    const esDuplicado = !!analisis.duplicado;
    const titulo = esDuplicado ? 'Archivo duplicado' : (esCorreccion ? 'Completar datos del archivo' : 'Confirmar y subir');
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
        ${esDuplicado ? `<div class="sop-upload-warn" style="margin-bottom:12px">${escapeHtml(analisis.duplicado.mensaje || 'Ya existe en esta carpeta')}</div>` : ''}
        <div class="sop-pdx-campos-form"${esDuplicado ? ' style="opacity:.55;pointer-events:none"' : ''}>${camposHtml}</div>
        <div class="sop-dialog-actions">
          <button type="button" class="sop-btn sop-btn-ghost" id="sopPdxDatosCancel">Cerrar</button>
          ${esDuplicado ? '' : '<button type="button" class="sop-btn sop-btn-primary" id="sopPdxDatosOk">Subir PDF</button>'}
        </div>`, { closeOnBackdrop: false, closeOnEscape: false });
      poblarSelectsCamposPdx(modal, campos, datos).then(() => sopIcons(modal));
      modal.querySelector('#sopPdxDatosCancel').onclick = () => { closeSopModal(modal); reject(new Error('cancelado')); };
      if (esDuplicado) return;
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
      ordenes: '#0d9488', comprobantes: '#ea580c', consentimientos: '#9333ea',
      comprobantes_consulta_medica: '#c2410c', ordenes_consulta_medica: '#059669', neutral: '#64748b'
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
    vista: 'empty',
    expedientesLista: [],
    diasParentId: 0,
    diaModo: 'facturacion'
  };

  const SOP_VIEW_LS = { pdx: 'innar.sop.pdx.folderView', arm: 'innar.sop.arm.folderView' };

  function sopFolderViewMode(mod) {
    try {
      return localStorage.getItem(SOP_VIEW_LS[mod]) === 'list' ? 'list' : 'grid';
    } catch (_) {
      return 'grid';
    }
  }

  function setSopFolderViewMode(mod, mode) {
    const next = mode === 'list' ? 'list' : 'grid';
    try { localStorage.setItem(SOP_VIEW_LS[mod], next); } catch (_) { /* ignore */ }
    if (mod === 'pdx') {
      renderListaCarpetasPdx();
      return;
    }
    if (!armState.periodoId) return;
    if (armState.vista === 'period') renderArmadoDiasExplorer();
    else if (armState.vista === 'contenedor' && armState.contenedorId) {
      renderArmadoExpedientesGrid(armState.expedientesLista);
    }
  }

  function htmlSopFolderViewToggle(mod) {
    const mode = sopFolderViewMode(mod);
    return `<div class="sop-view-toggle" role="group" aria-label="Vista de carpetas">
      <button type="button" class="sop-btn sop-btn-ghost sop-btn-sm${mode === 'grid' ? ' is-active' : ''}" data-sop-view="${mod}" data-sop-view-mode="grid" title="Vista en cuadrícula"><i data-lucide="layout-grid"></i></button>
      <button type="button" class="sop-btn sop-btn-ghost sop-btn-sm${mode === 'list' ? ' is-active' : ''}" data-sop-view="${mod}" data-sop-view-mode="list" title="Vista en lista"><i data-lucide="list"></i></button>
    </div>`;
  }

  function bindSopFolderViewToggle(root, mod) {
    if (!root) return;
    root.querySelectorAll(`[data-sop-view="${mod}"]`).forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        setSopFolderViewMode(mod, btn.dataset.sopViewMode);
      });
    });
  }

  function parseZipFilenameFromResponse(res, fallback) {
    let filename = fallback || 'descarga.zip';
    const cd = res.headers.get('Content-Disposition') || '';
    const utf8Match = cd.match(/filename\*=UTF-8''([^;\s]+)/i);
    if (utf8Match) {
      try { filename = decodeURIComponent(utf8Match[1]); } catch (_) { /* ignore */ }
    } else {
      const plainMatch = cd.match(/filename="([^"]+)"/i) || cd.match(/filename=([^;\s]+)/i);
      if (plainMatch) filename = plainMatch[1].trim();
    }
    return filename;
  }

  function parseZipFilenameFromXhr(xhr, fallback) {
    return parseZipFilenameFromResponse({
      headers: { get: (k) => xhr.getResponseHeader(k) }
    }, fallback);
  }

  function formatearBytesDescarga(n) {
    const v = Number(n) || 0;
    if (v < 1024) return `${v} B`;
    if (v < 1024 * 1024) return `${Math.round(v / 1024)} KB`;
    return `${(v / (1024 * 1024)).toFixed(1)} MB`;
  }

  function descargarArchivoConProgreso(apiPath, fallbackFilename, opts = {}) {
    const title = opts.title || 'Descargando';
    const triggerBtn = opts.triggerBtn || null;
    if (triggerBtn) triggerBtn.disabled = true;
    const liberar = () => { if (triggerBtn) triggerBtn.disabled = false; };

    sopUploadBegin({ title, total: 1 });
    sopUploadSetFile(1, 1, fallbackFilename || 'descarga.zip');

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', apiPath, true);
      xhr.responseType = 'blob';
      xhr.withCredentials = true;
      let indeterminatePct = 8;
      xhr.onprogress = (e) => {
        if (e.lengthComputable && e.total > 0) {
          const pct = Math.max(1, Math.round((e.loaded / e.total) * 100));
          sopUploadUpdateBar(1, 1, pct, 'Recibiendo archivo…');
        } else {
          indeterminatePct = Math.min(92, indeterminatePct + 2);
          sopUploadUpdateBar(1, 1, indeterminatePct, `Generando / recibidos ${formatearBytesDescarga(e.loaded)}…`);
        }
      };
      xhr.onload = async () => {
        const ct = (xhr.getResponseHeader('Content-Type') || '').toLowerCase();
        if (xhr.status < 200 || xhr.status >= 300) {
          let errMsg = `Error ${xhr.status}`;
          try {
            const text = await xhr.response.text();
            const data = sopUploadParseJson(text);
            errMsg = data.error || data.detail || errMsg;
          } catch (_) { /* ignore */ }
          sopUploadFinish({ state: 'error', message: errMsg });
          liberar();
          reject(new Error(errMsg));
          return;
        }
        if (ct.includes('application/json') || ct.includes('text/html')) {
          let errMsg = 'No se pudo descargar el archivo';
          try {
            const text = await xhr.response.text();
            const data = sopUploadParseJson(text);
            errMsg = data.error || data.detail || errMsg;
          } catch (_) { /* ignore */ }
          sopUploadFinish({ state: 'error', message: errMsg });
          liberar();
          reject(new Error(errMsg));
          return;
        }
        const blob = xhr.response;
        if (!blob || !blob.size) {
          sopUploadFinish({ state: 'error', message: 'Archivo vacío' });
          liberar();
          reject(new Error('Archivo vacío'));
          return;
        }
        const filename = parseZipFilenameFromXhr(xhr, fallbackFilename);
        dispararDescargaBlob(blob, filename);
        sopUploadFinish({ state: 'success', message: 'Descarga completa' });
        liberar();
        resolve({ ok: true, filename });
      };
      xhr.onerror = () => {
        sopUploadFinish({ state: 'error', message: 'Error de conexión' });
        liberar();
        reject(new Error('Error de conexión'));
      };
      xhr.onabort = () => {
        sopUploadFinish({ state: 'error', message: 'Descarga cancelada' });
        liberar();
        reject(new Error('Descarga cancelada'));
      };
      xhr.send();
    });
  }

  function iniciarDescargaArchivoIframe(apiPath, ttlMs = 180000) {
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'display:none;width:0;height:0;border:0';
    iframe.setAttribute('aria-hidden', 'true');
    iframe.src = apiPath;
    document.body.appendChild(iframe);
    setTimeout(() => iframe.remove(), ttlMs);
  }

  function iniciarDescargaArchivoEnlace(apiPath, filename) {
    const a = document.createElement('a');
    a.href = apiPath;
    a.rel = 'noopener';
    if (filename) a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function dispararDescargaBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'descarga.bin';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  }

  function sleepMs(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function descargarZipDirecto(apiPath, fallbackFilename, triggerBtn = null) {
    if (triggerBtn) triggerBtn.disabled = true;
    const liberar = () => { if (triggerBtn) triggerBtn.disabled = false; };
    sopUploadBegin({ title: 'Descargando ZIP', total: 1 });
    sopUploadSetFile(1, 1, fallbackFilename || 'descarga.zip');
    sopUploadUpdateBar(1, 1, 15, 'Preparando descarga…');
    try {
      iniciarDescargaArchivoIframe(apiPath);
      sopUploadUpdateBar(1, 1, 100, 'Descarga iniciada en el navegador');
      sopUploadFinish({ state: 'success', message: 'Descarga iniciada' });
      liberar();
      return Promise.resolve({ ok: true, filename: fallbackFilename });
    } catch (e) {
      sopUploadFinish({ state: 'error', message: e.message || 'No se pudo iniciar la descarga' });
      liberar();
      return Promise.reject(e);
    }
  }

  async function descargarZipPaquetePorJob(apiPath, fallbackFilename, triggerBtn = null) {
    const m = apiPath.match(/\/periodos\/(\d+)\/zip-paquete/);
    const periodoId = m ? parseInt(m[1], 10) : null;
    if (!periodoId) throw new Error('Periodo inválido');

    if (triggerBtn) triggerBtn.disabled = true;
    const liberar = () => { if (triggerBtn) triggerBtn.disabled = false; };

    sopUploadBegin({ title: 'Generando ZIP del mes', total: 1 });
    sopUploadSetFile(1, 1, fallbackFilename || 'paquete.zip');
    sopUploadUpdateBar(1, 1, 2, 'Preparando en el servidor…');

    try {
      const startRes = await apiFetch(`/api/soportes/armado/periodos/${periodoId}/zip-paquete/job`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      });
      const startData = await startRes.json().catch(() => ({}));
      if (!startRes.ok || !startData.job_id) {
        throw new Error(startData.error || 'No se pudo iniciar la generación del ZIP');
      }

      const jobId = startData.job_id;
      let ready = false;
      for (let i = 0; i < 900; i++) {
        await sleepMs(i < 3 ? 800 : 1500);
        const stRes = await apiFetch(`/api/soportes/armado/periodos/${periodoId}/zip-paquete/job/${jobId}`);
        const st = await stRes.json().catch(() => ({}));
        if (!stRes.ok) throw new Error(st.error || 'Error consultando progreso');
        const pct = Math.max(0, Math.min(100, parseInt(st.progress, 10) || 0));
        sopUploadUpdateBar(1, 1, pct, st.message || 'Generando ZIP…');
        if (st.status === 'ready') {
          ready = true;
          break;
        }
        if (st.status === 'error') throw new Error(st.error || 'No se pudo generar el ZIP');
      }
      if (!ready) throw new Error('La generación del ZIP tardó demasiado. Intente de nuevo.');

      await descargarZipDirecto(
        `/api/soportes/armado/periodos/${periodoId}/zip-paquete/job/${jobId}/descargar`,
        fallbackFilename,
        null
      );
      liberar();
    } catch (e) {
      sopUploadFinish({ state: 'error', message: e.message || 'Error al descargar' });
      liberar();
      throw e;
    }
  }

  async function descargarZipArmado(apiPath, fallbackFilename, triggerBtn = null) {
    const esPaqueteMes = /\/zip-paquete(?:\?|$)/.test(apiPath) && !/\/zip-paquete\/job\//.test(apiPath);
    try {
      if (esPaqueteMes) {
        await descargarZipPaquetePorJob(apiPath, fallbackFilename, triggerBtn);
      } else {
        await descargarZipDirecto(apiPath, fallbackFilename, triggerBtn);
      }
      sopToast('Descarga iniciada', 'success');
    } catch (e) {
      try {
        iniciarDescargaArchivoIframe(apiPath);
        sopToast('Descarga iniciada en segundo plano…', 'info');
      } catch (_) {
        sopToast(e.message || 'No se pudo descargar el ZIP', 'error');
      }
    }
  }

  function htmlArmZipBtn({ apiPath, fallbackName, title, icon = 'archive', label = '', variant = 'ghost' } = {}) {
    if (!apiPath || !sopPerm('soportes.descargar_zip')) return '';
    const cls = variant === 'teal' ? 'sop-btn sop-btn-teal sop-btn-sm' : 'sop-btn sop-btn-ghost sop-btn-sm';
    return `<button type="button" class="${cls}" data-arm-zip="${apiPath}" data-arm-zip-fallback="${escapeHtml(fallbackName || 'descarga.zip')}" title="${escapeHtml(title)}"><i data-lucide="${icon}"></i>${label}</button>`;
  }

  function bindArmZipButtons(root) {
    const scope = root || document;
    scope.querySelectorAll('[data-arm-zip]').forEach((btn) => {
      if (btn.dataset.armZipBound) return;
      btn.dataset.armZipBound = '1';
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        void descargarZipArmado(btn.dataset.armZip, btn.dataset.armZipFallback, btn);
      });
    });
  }

  async function migrarRipsDesdeContenedor(contenedorId, { btn = null } = {}) {
    if (btn) btn.disabled = true;
    sopToast('Creando carpetas espejo en RIPS…', 'info');
    try {
      const res = await apiFetch(`/api/soportes/armado/contenedores/${contenedorId}/sync-rips-carpetas`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        sopToast(data.error || 'No se pudo migrar a RIPS', 'error');
        return false;
      }
      const count = Number(data.count || 0);
      sopToast(count ? `Migradas ${count} carpeta(s) a RIPS` : 'Carpetas espejo actualizadas en RIPS', 'success');
      try {
        if (armState.diaId) {
          await seleccionarDiaArmado(armState.diaId);
          const ripsContenedorId = data.rips_contenedor_id || armState.contenedores?.find((c) => c.tipo === 'rips' && c.id !== contenedorId)?.id;
          if (ripsContenedorId) {
            await seleccionarContenedorArmado(ripsContenedorId);
            return true;
          }
        }
        if (armState.contenedores?.length) {
          const ripsContenedorId = data.rips_contenedor_id || armState.contenedores.find((c) => c.tipo === 'rips' && c.id !== contenedorId)?.id;
          if (ripsContenedorId) {
            await seleccionarContenedorArmado(ripsContenedorId);
            return true;
          }
        }
        await refrescarVistaArmadoActual().catch(() => {});
      } catch (refreshErr) {
        console.error('[SOPORTES] refresh after RIPS migration', refreshErr);
      }
      return true;
    } catch (e) {
      sopToast(e.message || 'No se pudo migrar a RIPS', 'error');
      return false;
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function bindArmMigrarRipsButtons(root) {
    const scope = root || document;
    scope.querySelectorAll('[data-arm-migrar-rips]').forEach((btn) => {
      if (btn.dataset.armMigrarRipsBound) return;
      btn.dataset.armMigrarRipsBound = '1';
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        void migrarRipsDesdeContenedor(btn.dataset.armMigrarRips, { btn });
      });
    });
  }

  function htmlArmMigrarRipsContenedorBtn(contenedorId, { labeled = false, variant = 'ghost' } = {}) {
    if (!contenedorId || !sopPerm('soportes.armado.crear_estructura')) return '';
    const cls = variant === 'teal' ? 'sop-btn sop-btn-teal sop-btn-sm' : 'sop-btn sop-btn-ghost sop-btn-sm';
    return `<button type="button" class="${cls}" data-arm-migrar-rips="${contenedorId}" title="Crear/actualizar carpetas espejo en RIPS para las carpetas FE de esta carpeta SOPORTES"><i data-lucide="refresh-cw"></i>${labeled ? ' Migrar FE a RIPS' : ''}</button>`;
  }

  function htmlArmZipFacturadosBtn() {
    if (!armState.periodoId || !sopPerm('soportes.descargar_zip')) return '';
    const diasFact = armState.dias.filter((d) => d.estado_facturacion === 'facturados');
    if (!diasFact.length) return '';
    const feCount = diasFact.reduce((s, d) => s + (d.expedientes_count || 0), 0);
    const title = `Descargar ZIP de ${diasFact.length} carpeta(s) de día facturada(s) y ${feCount} expediente(s) FE`;
    const fallback = `${armState.periodoLabel || 'mes'}-facturados.zip`;
    return htmlArmZipBtn({
      apiPath: `/api/soportes/armado/periodos/${armState.periodoId}/zip-facturados`,
      fallbackName: fallback,
      title,
      icon: 'archive',
      label: ' ZIP facturados'
    });
  }

  function htmlArmZipPaqueteBtn() {
    if (!armState.periodoId || !armState.dias.length || !sopPerm('soportes.descargar_zip')) return '';
    const label = escapeHtml(armState.periodoLabel || 'Mes');
    const title = `Paquete ZIP del mes: carpetas por día con SOPORTES y RIPS. Tras subir la FEV los archivos llevan nombre FE{n}; use «ZIP unificado» si prefiere una sola estructura`;
    return htmlArmZipBtn({
      apiPath: `/api/soportes/armado/periodos/${armState.periodoId}/zip-paquete`,
      fallbackName: `${armState.periodoLabel || 'mes'}-paquete.zip`,
      title,
      icon: 'package',
      label: ` Paquete ${label}`,
      variant: 'teal'
    });
  }

  function htmlArmZipUnificadoBtn() {
    if (!armState.periodoId || !armState.dias.length || !sopPerm('soportes.descargar_zip')) return '';
    const label = escapeHtml(armState.periodoLabel || 'Mes');
    const title = 'ZIP unificado: carpetas RIPS y SOPORTES de todas las subcarpetas, agrupadas por factura (FE)';
    return htmlArmZipBtn({
      apiPath: `/api/soportes/armado/periodos/${armState.periodoId}/zip-unificado`,
      fallbackName: `${armState.periodoLabel || 'mes'}-unificado.zip`,
      title,
      icon: 'layers',
      label: ` Unificado ${label}`
    });
  }

  function htmlArmZipCarpetaBtn(dia, { labeled = false, variant = 'ghost' } = {}) {
    if (!dia?.id || !sopPerm('soportes.descargar_zip')) return '';
    const nom = dia.nombre_display || 'Carpeta';
    const title = dia.es_contenedor
      ? `Descargar ZIP de la carpeta ${nom} (todo su contenido y subcarpetas)`
      : `Descargar ZIP de ${nom}`;
    return htmlArmZipBtn({
      apiPath: `/api/soportes/armado/dias/${dia.id}/zip-carpeta`,
      fallbackName: `${nom}.zip`,
      title,
      icon: 'archive',
      label: labeled ? ' ZIP' : '',
      variant
    });
  }

  function htmlArmZipDiaBtn(dia, { labeled = false, variant = 'ghost' } = {}) {
    if (!dia?.id || !sopPerm('soportes.descargar_zip')) return '';
    if (dia.es_contenedor) return htmlArmZipCarpetaBtn(dia, { labeled, variant });
    const nom = dia.nombre_display || 'Carpeta';
    const fe = dia.expedientes_count || 0;
    const modo = dia.modo || 'facturacion';
    if (modo === 'ucqn' || modo === 'anexo_fidu') {
      return htmlArmZipCarpetaBtn(dia, { labeled, variant });
    }
    const title = `Descargar ZIP de ${nom} (RIPS y SOPORTES por factura FE, ${fe} expediente(s))`;
    return htmlArmZipBtn({
      apiPath: `/api/soportes/armado/dias/${dia.id}/zip`,
      fallbackName: `${nom}.zip`,
      title,
      icon: 'archive',
      label: labeled ? ' ZIP' : '',
      variant
    });
  }

  function htmlArmZipCarpetaActualBtn() {
    if (!armState.diasParentId || !sopPerm('soportes.descargar_zip')) return '';
    const carpeta = armDiaById(armState.diasParentId);
    if (!carpeta) return '';
    return htmlArmZipCarpetaBtn(carpeta, { labeled: true, variant: 'teal' });
  }

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
    const enExplorer = armState.vista === 'period';
    const crumbs = [{
      label: armState.periodoLabel || 'Mes',
      current: enExplorer && !armState.diasParentId,
      onClick: !enExplorer || armState.diasParentId
        ? () => {
          armState.diasParentId = 0;
          if (enExplorer) {
            renderArmadoDiasExplorer();
            renderArmadoContextBar();
          } else {
            seleccionarPeriodoArmado(armState.periodoId);
          }
        }
        : null,
      dropParentId: enExplorer ? 0 : undefined
    }];
    if (enExplorer && armState.diasParentId) {
      armRutaExplorerChain().forEach((d, i, arr) => {
        const isLast = i === arr.length - 1;
        crumbs.push({
          label: d.nombre_display,
          current: isLast,
          onClick: isLast ? null : () => navegarArmDiasExplorer(d.id),
          dropParentId: d.id
        });
      });
    }
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
    } else if (!enExplorer || !armState.diasParentId) {
      crumbs.push({ label: 'Seleccione carpeta de día', current: true });
    }
    el.innerHTML = '<span class="sop-context-label">Ubicación</span>';
    const trail = document.createElement('span');
    trail.className = 'sop-breadcrumbs';
    trail.style.margin = '0';
    trail.style.flex = '1';
    renderSopBreadcrumbs(trail, crumbs);
    if (armPuedeArrastrarDia()) {
      trail.querySelectorAll('.sop-crumb').forEach((crumb, idx) => {
        const c = crumbs[idx];
        if (c?.dropParentId === undefined) return;
        crumb.dataset.armDropParent = String(c.dropParentId);
        crumb.classList.add('sop-pdx-crumb-drop');
      });
    }
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
    comprobantes_consulta_medica: 'receipt',
    consentimientos: 'file-signature',
    ordenes_consulta_medica: 'clipboard-list',
    neutral: 'folder'
  };

  function destinoImportDesdeTema(tema) {
    if (tema === 'comprobantes' || tema === 'comprobantes_consulta_medica') return 'CRC';
    if (tema === 'consentimientos') return null;
    if (tema === 'ordenes' || tema === 'ordenes_consulta_medica') return 'ORDEN+HC';
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
    latencia: 'Latencia múltiple del sueño',
    ordenes: 'Órdenes',
    comprobantes: 'Comprobantes',
    comprobantes_consulta_medica: 'Comprobante. consultas médicas',
    ordenes_consulta_medica: 'Órdenes + HC consultas médicas',
    consentimientos: 'Consentimientos',
    neutral: 'General'
  };

  function renderPdxTemaLegend() {
    const el = $('sopPdxTemaLegend');
    if (!el) return;
    const temas = ['vtm', 'psg', 'eeg', 'actigrafia', 'latencia', 'ordenes', 'comprobantes', 'comprobantes_consulta_medica', 'ordenes_consulta_medica', 'consentimientos', 'neutral'];
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

  function resumenExpedientesLista(list) {
    const total = list.length;
    const listos = list.filter((e) => e.documentos_completos).length;
    return { total, listos, pendientes: Math.max(0, total - listos) };
  }

  function htmlFeExpedienteProgressMini(e) {
    const done = Number(e.progreso_done) || 0;
    const total = Number(e.progreso_total) || 1;
    const pct = Math.min(100, Math.round((done / total) * 100));
    const complete = !!e.documentos_completos;
    return `<div class="sop-fe-card-progress" role="status" aria-label="Documentos del expediente">
      <div class="sop-fe-card-progress-track"><div class="sop-fe-card-progress-fill${complete ? ' is-complete' : ''}" style="width:${pct}%"></div></div>
      <span class="sop-fe-card-progress-label"><strong>${done}/${total}</strong> documentos</span>
    </div>`;
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
    if (typeof window.innarLucideIcons === 'function') {
      window.innarLucideIcons(root || document);
      return;
    }
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

  function puedeResaltarPdx() {
    const c = pdxState.carpetaActual;
    if (!c || c.estado_visibilidad === 'archivo') return false;
    return sopPerm('soportes.pdx.ver') && sopPerm('soportes.pdx.subir');
  }

  function puedeResaltarArmado() {
    return sopPerm('modulo.armado_soportes') && sopPerm('soportes.armado.subir');
  }

  function abrirPdfEnNavegador(url, titulo) {
    if (!url) return;
    const src = String(url).trim();
    if (!src.startsWith('/api/soportes/')) {
      window.open(src, '_blank', 'noopener');
      return;
    }
    const q = new URLSearchParams();
    q.set('src', src);
    if (titulo) q.set('titulo', String(titulo).slice(0, 200));
    window.open(`/soportes/pdf-vista?${q.toString()}`, '_blank', 'noopener');
  }

  function abrirVisorPdfEnPagina(cfg) {
    if (!window.SopPdfEditor?.openPage) {
      sopToast('Visor PDF no disponible. Recargue la página (Ctrl+F5).', 'error');
      return;
    }
    window.SopPdfEditor.openPage(cfg);
  }

  function periodoActual() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  function badgeVis(estado, dias) {
    const labels = {
      activa: 'Activo',
      gracia: dias ? `Pasa a Archivo en ${dias}d` : 'Próximo a archivar',
      archivo: 'En módulo Archivo'
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

  function openSopModal(html, opts = {}) {
    const closeOnBackdrop = opts.closeOnBackdrop !== false;
    const closeOnEscape = opts.closeOnEscape !== false;
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
    if (closeOnBackdrop) {
      wrap.addEventListener('click', (e) => { if (e.target === wrap) closeSopModal(wrap); });
    }
    const onKey = (e) => {
      if (closeOnEscape && e.key === 'Escape') closeSopModal(wrap);
    };
    wrap._sopKeyHandler = onKey;
    if (closeOnEscape) document.addEventListener('keydown', onKey);
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

  let sopUploadUi = null;
  let sopUploadHideTimer = null;

  function sopUploadPanelEl() {
    if (sopUploadUi?.panel?.isConnected) return sopUploadUi.panel;
    const panel = document.createElement('div');
    panel.id = 'sopUploadProgressPanel';
    panel.className = 'sop-upload-progress-panel';
    panel.setAttribute('role', 'status');
    panel.setAttribute('aria-live', 'polite');
    panel.innerHTML = `
      <div class="sop-upload-progress-head">
        <span class="sop-upload-progress-title" id="sopUploadProgressTitle">Subiendo…</span>
        <span class="sop-upload-progress-pct" id="sopUploadProgressPct">0%</span>
      </div>
      <div class="sop-upload-progress-bar-wrap" aria-hidden="true">
        <div class="sop-upload-progress-bar" id="sopUploadProgressBar"></div>
      </div>
      <div class="sop-upload-progress-file" id="sopUploadProgressFile">—</div>
      <div class="sop-upload-progress-status" id="sopUploadProgressStatus"></div>`;
    document.body.appendChild(panel);
    sopUploadUi = {
      panel,
      title: panel.querySelector('#sopUploadProgressTitle'),
      pct: panel.querySelector('#sopUploadProgressPct'),
      bar: panel.querySelector('#sopUploadProgressBar'),
      file: panel.querySelector('#sopUploadProgressFile'),
      status: panel.querySelector('#sopUploadProgressStatus')
    };
    return panel;
  }

  function sopUploadClearHideTimer() {
    if (sopUploadHideTimer) {
      clearTimeout(sopUploadHideTimer);
      sopUploadHideTimer = null;
    }
  }

  function sopUploadShowPanel() {
    sopUploadClearHideTimer();
    const panel = sopUploadPanelEl();
    panel.classList.remove('is-success', 'is-error');
    panel.classList.add('is-visible');
  }

  function sopUploadHidePanel(delayMs = 0) {
    sopUploadClearHideTimer();
    const hide = () => {
      const panel = sopUploadUi?.panel;
      if (!panel) return;
      panel.classList.remove('is-visible', 'is-success', 'is-error');
    };
    if (delayMs > 0) sopUploadHideTimer = setTimeout(hide, delayMs);
    else hide();
  }

  function sopUploadCalcOverallPercent(fileIndex, batchTotal, filePercent) {
    const idx = Math.max(1, fileIndex || 1);
    const tot = Math.max(1, batchTotal || 1);
    const pct = Math.max(0, Math.min(100, filePercent ?? 0));
    if (tot <= 1) return pct;
    return Math.round(((idx - 1) + pct / 100) / tot * 100);
  }

  function sopUploadUpdateBar(fileIndex, batchTotal, filePercent, statusText) {
    if (!sopUploadUi) return;
    const overall = sopUploadCalcOverallPercent(fileIndex, batchTotal, filePercent);
    sopUploadUi.bar.style.width = `${overall}%`;
    sopUploadUi.pct.textContent = `${overall}%`;
    if (statusText != null) sopUploadUi.status.textContent = statusText;
  }

  function sopUploadBegin({ title = 'Subiendo archivos', total = 1 } = {}) {
    sopUploadShowPanel();
    if (sopUploadUi.title) sopUploadUi.title.textContent = title;
    if (sopUploadUi.file) {
      sopUploadUi.file.textContent = total > 1 ? `Preparando lote (${total} archivo(s))…` : 'Preparando…';
    }
    if (sopUploadUi.status) sopUploadUi.status.textContent = 'Iniciando subida…';
    sopUploadUpdateBar(1, total, 0, null);
  }

  function sopUploadSetFile(fileIndex, batchTotal, fileName) {
    if (!sopUploadUi) return;
    const idx = Math.max(1, fileIndex || 1);
    const tot = Math.max(1, batchTotal || 1);
    const name = String(fileName || 'Archivo');
    sopUploadUi.file.textContent = tot > 1 ? `${idx}/${tot}: ${name}` : name;
    sopUploadUi.status.textContent = 'Enviando al servidor…';
    sopUploadUpdateBar(idx, tot, 0, 'Enviando al servidor…');
  }

  function sopUploadFinish({ state = 'success', message = '', delayMs } = {}) {
    if (!sopUploadUi) return;
    const ok = state === 'success';
    const panel = sopUploadUi.panel;
    panel.classList.toggle('is-success', ok);
    panel.classList.toggle('is-error', !ok);
    sopUploadUi.bar.style.width = ok ? '100%' : sopUploadUi.bar.style.width || '0%';
    sopUploadUi.pct.textContent = ok ? '100%' : sopUploadUi.pct.textContent;
    if (message) sopUploadUi.status.textContent = message;
    sopUploadHidePanel(delayMs ?? (ok ? 2600 : 4500));
  }

  function sopUploadParseJson(text) {
    try { return JSON.parse(text || '{}'); } catch (_) { return {}; }
  }

  async function sopUploadRefreshCsrf() {
    try {
      const rs = await fetch('/api/sesion', { credentials: 'include' });
      const sd = await rs.json();
      if (sd && sd.csrfToken && typeof window.innarCsrfToken !== 'undefined') {
        window.innarCsrfToken = sd.csrfToken;
      }
      return sd?.csrfToken || '';
    } catch (_) {
      return '';
    }
  }

  function apiUploadFormData(url, formData, opts = {}) {
    const fileIndex = opts.fileIndex || 1;
    const batchTotal = opts.batchTotal || 1;
    const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;

    return new Promise((resolve, reject) => {
      const send = (csrf, isRetry) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', url, true);
        xhr.withCredentials = true;
        if (csrf) xhr.setRequestHeader('x-csrf-token', csrf);
        xhr.upload.addEventListener('progress', (e) => {
          if (!onProgress) return;
          if (e.lengthComputable && e.total > 0) {
            const percent = Math.round((e.loaded / e.total) * 100);
            onProgress({ loaded: e.loaded, total: e.total, percent });
            sopUploadUpdateBar(fileIndex, batchTotal, percent, 'Enviando al servidor…');
          } else {
            onProgress({ loaded: e.loaded, total: 0, percent: null });
            sopUploadUpdateBar(fileIndex, batchTotal, 50, 'Enviando al servidor…');
          }
        });
        xhr.onload = async () => {
          const data = sopUploadParseJson(xhr.responseText);
          if (xhr.status === 403 && data.code === 'CSRF_INVALID' && !isRetry) {
            const newCsrf = await sopUploadRefreshCsrf();
            if (newCsrf) return send(newCsrf, true);
          }
          resolve({
            ok: xhr.status >= 200 && xhr.status < 300,
            status: xhr.status,
            data
          });
        };
        xhr.onerror = () => reject(new Error('Error de conexión al subir'));
        xhr.onabort = () => reject(new Error('Subida cancelada'));
        xhr.send(formData);
      };
      const csrf = typeof getCsrfForRequest === 'function' ? getCsrfForRequest() : '';
      send(csrf, false);
    });
  }

  async function subirFormDataConProgreso(url, formData, ctx = {}) {
    const {
      title = 'Subiendo archivo',
      fileName = 'Archivo',
      fileIndex = 1,
      batchTotal = 1,
      manageSession = true
    } = ctx;

    if (manageSession && fileIndex === 1) {
      sopUploadBegin({ title, total: batchTotal });
    }
    sopUploadSetFile(fileIndex, batchTotal, fileName);

    try {
      const res = await apiUploadFormData(url, formData, {
        fileIndex,
        batchTotal,
        onProgress: ({ percent }) => {
          sopUploadUpdateBar(fileIndex, batchTotal, percent ?? 0, 'Enviando al servidor…');
        }
      });
      if (manageSession && fileIndex === batchTotal) {
        if (res.ok) {
          sopUploadFinish({
            state: 'success',
            message: batchTotal > 1 ? 'Lote enviado correctamente' : 'Archivo subido correctamente'
          });
        }
      }
      return res;
    } catch (e) {
      if (manageSession) {
        sopUploadFinish({ state: 'error', message: e.message || 'Error al subir' });
      }
      throw e;
    }
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

  function compararTextoNatural(a, b) {
    return String(a || '').localeCompare(String(b || ''), 'es', { numeric: true, sensitivity: 'base' });
  }

  function numeroFeExpedienteCliente(exp) {
    const n = parseInt(exp?.numero_factura, 10);
    if (n > 0) return n;
    const m = String(exp?.codigo || '').trim().match(/^FE(\d+)$/i);
    return m ? parseInt(m[1], 10) : 0;
  }

  function ordenarExpedientesFeArmado(list) {
    return [...(list || [])].sort((a, b) => {
      const na = numeroFeExpedienteCliente(a);
      const nb = numeroFeExpedienteCliente(b);
      const aPend = na === 0;
      const bPend = nb === 0;
      if (aPend && bPend) {
        const la = String(a.paciente_nombre || a.codigo || '').trim();
        const lb = String(b.paciente_nombre || b.codigo || '').trim();
        return compararTextoNatural(la, lb);
      }
      if (aPend !== bPend) return aPend ? -1 : 1;
      return na - nb;
    });
  }

  function moverItemArray(arr, idx, delta) {
    const j = idx + delta;
    if (j < 0 || j >= arr.length) return false;
    [arr[idx], arr[j]] = [arr[j], arr[idx]];
    return true;
  }

  function bindReordenLista(container, arr, onRefresh) {
    if (!container) return;
    container.querySelectorAll('[data-orden-subir]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.dataset.ordenSubir, 10);
        if (moverItemArray(arr, i, -1)) onRefresh();
      });
    });
    container.querySelectorAll('[data-orden-bajar]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.dataset.ordenBajar, 10);
        if (moverItemArray(arr, i, 1)) onRefresh();
      });
    });
  }

  function htmlItemOrdenPdf(i, total, titulo, meta, opts = {}) {
    const quitar = opts.quitarIdx != null
      ? `<button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-orden-quitar="${opts.quitarIdx}" title="Quitar"><i data-lucide="x"></i></button>`
      : '';
    return `<li class="sop-opf-parte-item sop-pdf-orden-item">
      <span class="sop-opf-parte-num">${i + 1}</span>
      <div class="sop-opf-parte-body">
        <strong title="${escapeHtml(titulo)}">${escapeHtml(titulo)}</strong>
        ${meta ? `<span class="sop-opf-parte-meta">${escapeHtml(meta)}</span>` : ''}
      </div>
      <div class="sop-pdf-orden-actions">
        <button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-orden-subir="${i}" title="Subir" ${i === 0 ? 'disabled' : ''}><i data-lucide="chevron-up"></i></button>
        <button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-orden-bajar="${i}" title="Bajar" ${i >= total - 1 ? 'disabled' : ''}><i data-lucide="chevron-down"></i></button>
        ${quitar}
      </div>
    </li>`;
  }

  function ordenarArchivosPdxPorFecha(archivos) {
    return [...(archivos || [])].sort((a, b) => {
      const fa = String(a.fecha_estudio || '');
      const fb = String(b.fecha_estudio || '');
      if (fa !== fb) return fb.localeCompare(fa);
      return compararTextoNatural(a.paciente_nombre, b.paciente_nombre);
    });
  }

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
    const cmpPer = (a, b) => compararTextoNatural(a.periodo, b.periodo);
    const cmpNom = (a, b) => compararTextoNatural(a.nombre_display, b.nombre_display);
    switch (orden) {
      case 'periodo_asc':
        list.sort((a, b) => cmpPer(a, b) || cmpNom(a, b));
        break;
      case 'nombre_asc':
        list.sort((a, b) => cmpNom(a, b) || cmpPer(a, b));
        break;
      case 'nombre_desc':
        list.sort((a, b) => cmpNom(b, a) || cmpPer(b, a));
        break;
      case 'archivos_desc':
        list.sort((a, b) => (b.archivos_count || 0) - (a.archivos_count || 0) || cmpNom(a, b));
        break;
      default:
        list.sort((a, b) => cmpPer(b, a) || cmpNom(a, b));
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
      pdxState.filtros.orden = $('sopPdxFiltroOrden')?.value || 'nombre_asc';
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

  function ensurePdxViewToggleInBar() {
    const bar = $('sopPdxFiltrosBar');
    if (!bar) return;
    let wrap = bar.querySelector('[data-sop-view-toggle-wrap="pdx"]');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.dataset.sopViewToggleWrap = 'pdx';
      bar.appendChild(wrap);
    }
    wrap.innerHTML = htmlSopFolderViewToggle('pdx');
    bindSopFolderViewToggle(wrap, 'pdx');
    sopIcons(wrap);
  }

  function bindPdxCarpetaCardEvents(root) {
    if (!root) return;
    root.querySelectorAll('[data-pdx-carpeta]').forEach((card) => {
      const open = () => abrirCarpetaPdx(parseInt(card.dataset.pdxCarpeta, 10));
      card.addEventListener('click', (ev) => {
        if (ev.target.closest('.sop-folder-actions, .sop-folder-list-actions')) return;
        open();
      });
      card.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') open(); });
    });
    root.querySelectorAll('[data-pdx-edit]').forEach((b) => {
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const c = pdxState.carpetas.find((x) => x.id === parseInt(b.dataset.pdxEdit, 10));
        if (c) modalEditarCarpetaPdx(c);
      });
    });
    root.querySelectorAll('[data-pdx-del-carpeta]').forEach((b) => {
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const c = pdxState.carpetas.find((x) => x.id === parseInt(b.dataset.pdxDelCarpeta, 10));
        if (c) eliminarCarpetaPdx(c);
      });
    });
  }

  function renderListaCarpetasPdx() {
    renderPdxBreadcrumbLista();
    renderPdxTemaLegend();
    ensurePdxViewToggleInBar();
    const el = $('sopPdxLista');
    if (!el) return;
    const lista = pdxCarpetasFiltradas();
    const viewMode = sopFolderViewMode('pdx');
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
    if (viewMode === 'list') {
      el.innerHTML = `<div class="sop-table-wrap sop-folder-list-mode"><table class="sop-table sop-folder-list-table">
        <thead><tr><th style="width:40px"></th><th>Carpeta</th><th>Periodo</th><th>Archivos</th><th>Estado</th><th class="sop-folder-list-actions">Acciones</th></tr></thead>
        <tbody>${lista.map((c) => {
          const tema = c.color_tema || 'neutral';
          const icon = TEMA_ICON[tema] || 'folder';
          const enArchivo = c.estado_visibilidad === 'archivo';
          return `<tr data-pdx-carpeta="${c.id}" tabindex="0">
            <td><span class="sop-folder-icon" style="width:32px;height:32px;margin:0" data-tema="${escapeHtml(tema)}"><i data-lucide="${icon}"></i></span></td>
            <td><strong>${escapeHtml(c.nombre_display)}</strong></td>
            <td>${escapeHtml(c.periodo)}</td>
            <td>${c.archivos_count || 0}</td>
            <td>${badgeVis(c.estado_visibilidad, c.dias_restantes_gracia)}</td>
            <td class="sop-folder-list-actions">
              ${canEdit && !enArchivo ? `<button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-pdx-edit="${c.id}"><i data-lucide="pencil"></i></button>` : ''}
              ${canDel ? `<button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-pdx-del-carpeta="${c.id}" style="color:#dc2626"><i data-lucide="trash-2"></i></button>` : ''}
            </td>
          </tr>`;
        }).join('')}</tbody></table></div>`;
    } else {
      el.innerHTML = `<div class="sop-grid">${lista.map((c) => {
        const tema = c.color_tema || 'neutral';
        const icon = TEMA_ICON[tema] || 'folder';
        const enArchivo = c.estado_visibilidad === 'archivo';
        return `<article class="sop-folder-card" data-tema="${escapeHtml(tema)}" data-pdx-carpeta="${c.id}" tabindex="0">
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
    }
    bindPdxCarpetaCardEvents(el);
    sopIcons(el);
  }

  async function eliminarArchivoPdx(archivoId, nombre) {
    if (!sopPerm('soportes.pdx.eliminar')) return;
    const label = nombre || `archivo #${archivoId}`;
    const run = async () => {
    const res = await apiFetch(`/api/soportes/pdx/archivos/${archivoId}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { sopToast(data.error || 'No se pudo eliminar', 'error'); return; }
    sopToast('Archivo eliminado', 'success');
    if (pdxState.carpetaId) abrirCarpetaPdx(pdxState.carpetaId);
    };
    if (typeof window.confirmEliminar === 'function') {
      window.confirmEliminar(`el archivo «${label}»`, run);
    } else if (!window.confirm(`¿Está seguro de eliminar «${label}»?`)) return;
    else await run();
  }

  async function abrirCarpetaPdx(id) {
    pdxState.carpetaId = id;
    $('sopPdxVistaLista')?.classList.add('hidden');
    $('sopPdxVistaDetalle')?.classList.remove('hidden');
    showSkeletonTableRows($('sopPdxArchivosBody'), 4, 4);
    const res = await apiFetch(`/api/soportes/pdx/carpetas/${id}/archivos`);
    const data = await res.json();
    if (!res.ok) { sopToast(data.error || 'Error', 'error'); return; }
    pdxState.archivos = ordenarArchivosPdxPorFecha(data.archivos || []);
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
        ${canVer ? `<button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-pdx-ver="${a.id}" title="Ver en el navegador"><i data-lucide="eye"></i></button>
        <button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-pdx-dl="${a.id}" title="Descargar"><i data-lucide="download"></i></button>` : ''}
        ${canEdit && !enArchivo ? `<button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-pdx-edit-arch="${a.id}" title="Editar datos"><i data-lucide="pencil"></i></button>` : ''}
        ${canEdit && !enArchivo ? `<button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-pdx-pagina="${a.id}" title="Editar PDF (resaltar, añadir páginas)"><i data-lucide="external-link"></i></button>
        <button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-pdx-replace="${a.id}" title="Reemplazar PDF"><i data-lucide="file-up"></i></button>` : ''}
        ${canEdit && !enArchivo ? `<button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-pdx-move="${a.id}" title="Mover a otra carpeta"><i data-lucide="folder-input"></i></button>` : ''}
        ${canVer ? `<button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-pdx-hist="${a.id}" title="Historial"><i data-lucide="history"></i></button>` : ''}
        ${sopPerm('soportes.armado.importar_pdx') && puedeVincularArchivoAFe(a, temaCarpeta) ? `<button type="button" class="sop-btn sop-btn-primary sop-btn-sm" data-pdx-link="${a.id}" data-pdx-dest="${escapeHtml(a.destino_importacion || destinoImportDesdeTema(temaCarpeta) || 'PDX')}" title="Vincular a carpeta FE"><i data-lucide="link-2"></i></button>` : ''}
        ${canDelete ? `<button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-pdx-del="${a.id}" title="Eliminar" style="color:#dc2626"><i data-lucide="trash-2"></i></button>` : ''}
      </div></td>
    </tr>`;
    }).join('');
    tbody.querySelectorAll('[data-pdx-ver]').forEach((b) => {
      b.addEventListener('click', () => {
        abrirPdfEnNavegador(`/api/soportes/pdx/archivos/${parseInt(b.dataset.pdxVer, 10)}/ver`);
      });
    });
    tbody.querySelectorAll('[data-pdx-pagina]').forEach((b) => {
      b.addEventListener('click', () => {
        const row = pdxState.archivos.find((x) => x.id === parseInt(b.dataset.pdxPagina, 10));
        abrirVisorPdfEnPagina({
          fuente: 'pdx',
          id: parseInt(b.dataset.pdxPagina, 10),
          titulo: row?.paciente_nombre || row?.nombre_archivo_display || 'PDF',
          edit: puedeResaltarPdx()
        });
      });
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
    const hint = zone?.querySelector('.sop-dropzone-hint');
    if (hint) {
      hint.textContent = 'Solo PDF. Un archivo: el sistema lee el nombre y pide lo que falte. Varios archivos (2 o más): se revisan y suben por separado, uno a uno.';
    }
    sopIcons($('sopPdxVistaDetalle'));
    requestAnimationFrame(() => {
      sopIcons(tbody);
      sopIcons($('sopPdxVistaDetalle'));
    });
  }

  async function eliminarCarpetaPdx(carpeta) {
    if (!sopPerm('soportes.pdx.eliminar')) return;
    const n = carpeta.archivos_count || 0;
    const label = carpeta.nombre_display || 'esta carpeta';
    const msg = n > 0
      ? `la carpeta «${label}» y sus ${n} archivo(s)`
      : `la carpeta vacía «${label}»`;
    const run = async () => {
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
    };
    if (typeof window.confirmEliminar === 'function') {
      window.confirmEliminar(msg, run);
    } else if (!window.confirm(`¿Está seguro de eliminar ${msg}?`)) return;
    else await run();
  }

  function modalEditarCarpetaPdx(carpeta) {
    const modal = openSopModal(`
      <h3><i data-lucide="pencil"></i> Editar carpeta</h3>
      <div class="sop-field"><label>Periodo (mes)</label><input type="month" id="sopPdxEditPer" value="${escapeHtml(carpeta.periodo)}"></div>
      <div class="sop-field"><label>Nombre visible</label><input type="text" id="sopPdxEditNom" value="${escapeHtml(carpeta.nombre_display)}"></div>
      <p style="font-size:.8rem;color:#64748b;margin:0">El tema de color (VTM, PSG, etc.) se detecta del nombre. La visibilidad por usuario se configura en <strong>Usuarios → Permisos</strong>.</p>
      <div class="sop-dialog-actions">
        <button type="button" class="sop-btn sop-btn-ghost" id="sopPdxEditCancel">Cancelar</button>
        <button type="button" class="sop-btn sop-btn-primary" id="sopPdxEditOk">Guardar</button>
      </div>`);
    sopIcons(modal);
    modal.querySelector('#sopPdxEditCancel').onclick = () => closeSopModal(modal);
    modal.querySelector('#sopPdxEditOk').onclick = async () => {
      const body = {
        periodo: $('sopPdxEditPer').value,
        nombre_display: $('sopPdxEditNom').value.trim()
      };
      const res = await apiFetch(`/api/soportes/pdx/carpetas/${carpeta.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
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
    const apiPath = `/api/soportes/pdx/archivos/${archivoId}/descargar`;
    const row = pdxState.archivos.find((x) => x.id === archivoId);
    let filename = row?.nombre_descarga || row?.nombre_archivo_display || row?.nombre_archivo_original || 'archivo.pdf';
    try {
      const res = await apiFetch(apiPath);
      const ct = (res.headers.get('Content-Type') || '').toLowerCase();
      if (!res.ok || ct.includes('application/json') || ct.includes('text/html')) {
        const data = await res.json().catch(() => ({}));
        sopToast(data.error || data.detail || 'No se pudo descargar el archivo', 'error');
        return;
      }
      const cd = res.headers.get('Content-Disposition') || '';
      const utf8Match = cd.match(/filename\*=UTF-8''([^;\s]+)/i);
      if (utf8Match) {
        try { filename = decodeURIComponent(utf8Match[1]); } catch (_) { /* ignore */ }
      } else {
        const plainMatch = cd.match(/filename="([^"]+)"/i) || cd.match(/filename=([^;\s]+)/i);
        if (plainMatch) filename = plainMatch[1].trim();
      }
      const blob = await res.blob();
      if (!blob.size) {
        iniciarDescargaArchivoEnlace(apiPath, filename);
        sopToast('Descarga iniciada…', 'info');
        return;
      }
      dispararDescargaBlob(blob, filename);
      sopToast('Descarga iniciada', 'success');
    } catch (e) {
      iniciarDescargaArchivoIframe(apiPath);
      sopToast('Descarga iniciada…', 'info');
    }
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
      const res = await subirFormDataConProgreso(
        `/api/soportes/pdx/archivos/${archivo.id}/reemplazar`,
        fd,
        { title: 'Cargar reportes', fileName: file.name }
      );
      const data = res.data || {};
      if (!res.ok) {
        sopUploadFinish({ state: 'error', message: data.error || 'Error al reemplazar' });
        sopToast(data.error || 'Error', 'error');
        return;
      }
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
      .sort((a, b) => compararTextoNatural(a.nombre_display, b.nombre_display))
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
    const esConsultaMed = esCarpetaConsultaMedicaPdx(pdxState.carpetaActual);
    const esEstructConDoc = esCarpetaEstructuradaPdx(pdxState.carpetaActual) && !esConsultaMed;
    const esPsg = esCarpetaPsgReportePdx(pdxState.carpetaActual);
    const modal = openSopModal(`
      <h3><i data-lucide="pencil"></i> Editar datos del reporte</h3>
      <div class="sop-field"><label>Apellidos</label><input type="text" id="sopPdxEdApe" value="${escapeHtml(archivo.apellidos || '')}"></div>
      <div class="sop-field"><label>Nombres</label><input type="text" id="sopPdxEdNom" value="${escapeHtml(archivo.nombres || '')}"></div>
      <div class="sop-field"><label>Fecha del estudio</label><input type="date" id="sopPdxEdFecha" value="${escapeHtml(archivo.fecha_estudio || '')}"></div>
      ${esConsultaMed
        ? '<div class="sop-field"><label>Especialidad *</label><select id="sopPdxEdEst" data-tipo="especialidad"></select></div>'
        : (esEstructConDoc || esPsg
          ? '<div class="sop-field"><label>Tipo de examen *</label><select id="sopPdxEdEst"></select></div>'
          : `<div class="sop-field"><label>Nombre del estudio</label><input type="text" id="sopPdxEdEst" value="${escapeHtml(archivo.estudio_texto || '')}" placeholder="PSG BASAL, EEG, VTM…"></div>`)}
      ${esEstructConDoc ? `<div class="sop-field"><label>Tipo de documento</label><input type="text" id="sopPdxEdTipoDoc" data-campo-tipo="tipo_doc" value="${escapeHtml(normalizarTipoDocumentoCliente(archivo.tipo_documento || 'CC'))}" maxlength="4" autocomplete="off" spellcheck="false" style="text-transform:uppercase" placeholder="CC"></div>` : ''}
      <div class="sop-field"><label>Número de documento${(esEstructConDoc || esPsg) ? ' *' : ' (opcional)'}</label><input type="text" id="sopPdxEdDoc" data-campo-tipo="doc_numero" value="${escapeHtml(archivo.paciente_documento || '')}" inputmode="numeric" pattern="[0-9]*"></div>
      <p style="margin:8px 0 0"><button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" id="sopPdxEdHist"><i data-lucide="history"></i> Ver historial</button></p>
      <div class="sop-dialog-actions">
        <button type="button" class="sop-btn sop-btn-ghost" id="sopPdxEdCancel">Cancelar</button>
        <button type="button" class="sop-btn sop-btn-primary" id="sopPdxEdOk">Guardar</button>
      </div>`);
    if (esPsg) poblarSelectEstudioPsgCliente(modal.querySelector('#sopPdxEdEst'), archivo.estudio_texto);
    else if (esConsultaMed) poblarSelectEspecialidadPdx(modal.querySelector('#sopPdxEdEst'), archivo.estudio_texto);
    else if (esEstructConDoc) {
      poblarSelectEstudioPdx(modal.querySelector('#sopPdxEdEst'), archivo.estudio_texto);
    }
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
        tipo_documento: esEstructConDoc ? normalizarTipoDocumentoCliente($('sopPdxEdTipoDoc')?.value) : undefined,
        paciente_documento: normalizarNumeroDocumentoCliente($('sopPdxEdDoc').value) || null
      };
      if (!body.apellidos || !body.nombres || !body.fecha_estudio || !body.estudio_texto) {
        return sopToast('Complete todos los campos obligatorios', 'warning');
      }
      if (esEstructConDoc && (!body.paciente_documento || body.paciente_documento.length < 4)) {
        return sopToast('El número de documento es obligatorio (solo dígitos, 4 a 20)', 'warning');
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
      <p style="font-size:.8rem;color:#64748b;margin:0">Asigne qué usuarios ven esta carpeta en <strong>Usuarios → Permisos</strong> (bloque «Carpetas visibles»).</p>
      <div class="sop-dialog-actions">
        <button type="button" class="sop-btn sop-btn-ghost" id="sopPdxNewCancel">Cancelar</button>
        <button type="button" class="sop-btn sop-btn-primary" id="sopPdxNewOk">Crear carpeta</button>
      </div>`);
    sopIcons(modal);
    modal.querySelector('#sopPdxNewCancel').onclick = () => closeSopModal(modal);
    modal.querySelector('#sopPdxNewOk').onclick = async () => {
      const periodo = $('sopPdxNewPeriodo').value;
      const nombre_display = $('sopPdxNewNombre').value.trim();
      const body = { periodo, nombre_display };
      const res = await apiFetch('/api/soportes/pdx/carpetas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) { sopToast(data.error || 'Error', 'error'); return; }
      closeSopModal(modal);
      sopToast('Carpeta creada', 'success');
      await cargarCarpetasPdx();
      renderListaCarpetasPdx();
    };
  }

  async function subirArchivoPdx(file, carpetaId, extra, uploadCtx = {}) {
    const fd = new FormData();
    fd.append('file', file);
    if (extra) Object.keys(extra).forEach((k) => fd.append(k, extra[k]));
    const fileIndex = uploadCtx.fileIndex || 1;
    const batchTotal = uploadCtx.batchTotal || 1;
    const manageSession = uploadCtx.manageSession !== false && batchTotal === 1;
    const res = await subirFormDataConProgreso(
      `/api/soportes/pdx/carpetas/${carpetaId}/archivos`,
      fd,
      {
        title: uploadCtx.title || 'Cargar reportes',
        fileName: file.name,
        fileIndex,
        batchTotal,
        manageSession
      }
    );
    const data = res.data || {};
    if (!res.ok) {
      if (data.codigo === 'PDX_CARPETA_INEXISTENTE') {
        await cargarCarpetasPdx();
        volverListaPdx();
      }
      const msg = data.codigo === 'PDX_DUPLICADO'
        ? (data.error || 'Ya existe un archivo con los mismos datos en esta carpeta')
        : [data.error, data.detail, data.step].filter(Boolean).join(' — ');
      const err = new Error(msg || 'Error al subir');
      err.codigo = data.codigo;
      if (manageSession) sopUploadFinish({ state: 'error', message: msg || 'Error al subir' });
      throw err;
    }
    if (data.warnings?.length) sopToast(data.warnings.join(' · '), 'warning');
    return data;
  }

  async function subirArchivosUnificadosPdx(files, carpetaId, extra) {
    const fd = new FormData();
    files.forEach((f) => fd.append('files', f));
    if (extra) Object.keys(extra).forEach((k) => fd.append(k, extra[k]));
    const label = files.length > 1 ? `Unificando ${files.length} PDF` : (files[0]?.name || 'PDF');
    const res = await subirFormDataConProgreso(
      `/api/soportes/pdx/carpetas/${carpetaId}/archivos/unificar`,
      fd,
      { title: 'Cargar reportes', fileName: label, fileIndex: 1, batchTotal: 1, manageSession: true }
    );
    const data = res.data || {};
    if (!res.ok) {
      const msg = [data.error, data.detail, data.step].filter(Boolean).join(' — ');
      if (msg) sopUploadFinish({ state: 'error', message: msg });
      throw new Error(msg || 'Error al unificar');
    }
    if (data.warnings?.length) sopToast(data.warnings.join(' · '), 'warning');
    return data;
  }

  function flujoUnificarPdfsPdx(files, carpetaId) {
    const carpeta = pdxState.carpetaActual || pdxState.carpetas.find((c) => c.id === carpetaId);
    const tema = detectarTemaCarpetaCliente(carpeta?.nombre_display || '');
    const ordenados = [...files];
    let analisis = { campos: [], parcial: {} };
    return preAnalizarArchivoPdx(carpetaId, ordenados[0].name)
      .then((a) => { analisis = a; })
      .catch(() => {})
      .then(() => new Promise((resolve, reject) => {
        const campos = analisis.campos?.length
          ? analisis.campos
          : camposFallbackUnificarPdx(tema);
        const camposHtml = campos.map((c) => htmlInputCampoPdx(c, analisis.parcial || {})).join('');
        const tituloCarpeta = TEMA_LABEL[tema] || carpeta?.nombre_display || 'reporte';
        const modal = openSopModal(`
          <h3><i data-lucide="layers"></i> Unificar PDF (${ordenados.length} archivos)</h3>
          <p style="font-size:.85rem;color:#64748b;margin:-6px 0 10px">Se combinarán en un solo PDF para <strong>${escapeHtml(tituloCarpeta)}</strong>. Ordene las partes con las flechas y complete los datos del paciente:</p>
          <div class="sop-opf-progress" style="margin-bottom:12px">
            <div class="sop-opf-progress-head">
              <span class="sop-opf-progress-title">Orden de unión</span>
            </div>
            <ul class="sop-opf-partes-list" id="sopPdxUniOrdenList"></ul>
          </div>
          <div class="sop-pdx-campos-form">${camposHtml}</div>
          <div class="sop-dialog-actions">
            <button type="button" class="sop-btn sop-btn-ghost" id="sopPdxUniCancel">Cancelar</button>
            <button type="button" class="sop-btn sop-btn-primary" id="sopPdxUniOk">Unificar y guardar</button>
          </div>`);
        const listEl = modal.querySelector('#sopPdxUniOrdenList');
        const refreshOrden = () => {
          listEl.innerHTML = ordenados.map((f, i) => htmlItemOrdenPdf(i, ordenados.length, f.name)).join('');
          bindReordenLista(listEl, ordenados, refreshOrden);
          sopIcons(listEl);
        };
        refreshOrden();
        poblarSelectsCamposPdx(modal, campos, analisis.parcial || {}).then(() => sopIcons(modal));
        modal.querySelector('#sopPdxUniCancel').onclick = () => { closeSopModal(modal); reject(new Error('cancelado')); };
        modal.querySelector('#sopPdxUniOk').onclick = async () => {
          const body = leerCamposDesdeModal(modal);
          const err = validarCamposModal(body, campos);
          if (err) return sopToast(err, 'warning');
          try {
            const data = await subirArchivosUnificadosPdx(ordenados, carpetaId, body);
            closeSopModal(modal);
            sopToast(`PDF unificado (${data.unificados || ordenados.length} parte(s))`, 'success');
            resolve();
          } catch (e) { sopToast(e.message, 'error'); }
        };
      }));
  }

  async function flujoSubidaPdx(file, carpetaId) {
    const analisis = await preAnalizarArchivoPdx(carpetaId, file.name);
    return modalDatosArchivoPdx(file, carpetaId, analisis);
  }

  async function flujoSubidaMultiplePdx(files, carpetaId) {
    // Analizar todos los archivos
    const analisisLista = [];
    for (const file of files) {
      try {
        const analisis = await preAnalizarArchivoPdx(carpetaId, file.name);
        analisisLista.push({ file, analisis });
      } catch (e) {
        sopToast(`Error analizando ${file.name}: ${e.message}`, 'warning');
      }
    }

    if (!analisisLista.length) throw new Error('No se pudieron analizar los archivos');

    return new Promise((resolve, reject) => {
      const carpeta = pdxState.carpetaActual || pdxState.carpetas.find((c) => c.id === carpetaId);
      const tema = detectarTemaCarpetaCliente(carpeta?.nombre_display || '');
      const esReporteClinico = esCarpetaReporteClinicoPdx(carpeta);
      const esPsg = tema === 'psg';
      const esComprobanteConsultaMed = esCarpetaComprobanteConsultaMedicaPdx(carpeta);
      const esConsultaMedica = esCarpetaConsultaMedicaPdx(carpeta);
      const esConsentimiento = tema === 'consentimientos';
      const badgeTipo = esReporteClinico ? 'Reporte' : (esConsentimiento ? 'Consentimiento' : 'Comprobante');
      const itemLabel = esReporteClinico ? 'reporte' : (esConsentimiento ? 'consentimiento' : (esComprobanteConsultaMed ? 'comprobante de consulta médica' : 'comprobante'));
      const tipoEntidad = esReporteClinico ? 'reporte(s)' : (esConsentimiento ? 'consentimiento(s)' : (esComprobanteConsultaMed ? 'comprobante(s) de consulta médica' : 'comprobante(s)'));
      const titulo = tipoEntidad;

      // Crear lista de cards para cada archivo
      const cardsHtml = analisisLista.map((item, idx) => {
        const parsed = item.analisis.parsed || item.analisis.parcial || {};
        const docFieldsHtml = esReporteClinico
          ? (esPsg ? `
          <div class="sop-field"><label>Documento (opcional)</label><input type="text" class="sopMultiDoc" data-idx="${idx}" value="${escapeHtml(parsed.paciente_documento || '')}" inputmode="numeric" pattern="[0-9]*"></div>
        ` : '')
          : ((esConsultaMedica && !esComprobanteConsultaMed) ? '' : (!esConsultaMedica ? `
          <div class="sop-field"><label>Tipo de documento</label><input type="text" class="sopMultiTipoDoc" data-idx="${idx}" value="${escapeHtml(normalizarTipoDocumentoCliente(parsed.tipo_documento || 'CC'))}" maxlength="4" style="text-transform:uppercase" placeholder="CC"></div>
          <div class="sop-field"><label>Número de documento *</label><input type="text" class="sopMultiDoc" data-idx="${idx}" value="${escapeHtml(parsed.paciente_documento || '')}" inputmode="numeric" pattern="[0-9]*"></div>
        ` : ''));

        const nombreSingleFieldHtml = esComprobanteConsultaMed ? `
          <div class="sop-field" style="grid-column:1 / -1"><label>Nombre completo *</label><input type="text" class="sopMultiNombreCompleto" data-idx="${idx}" value="${escapeHtml((parsed.apellidos && parsed.nombres) ? `${parsed.nombres} ${parsed.apellidos}` : (parsed.paciente_nombre || parsed.paciente_nombre_completo || ''))}" placeholder="Nombres y apellidos"></div>
        ` : '';

        const estudioFieldsHtml = esReporteClinico
          ? (esPsg ? `<div class="sop-field"><label>Tipo PSG *</label><select class="sopMultiPsgEst" data-idx="${idx}"><option value="">-- Seleccione --</option></select></div>` : '')
          : `<div class="sop-field"><label>${esConsultaMedica ? 'Especialidad' : 'Especialidad/Tipo examen'} *</label><select class="sopMultiEst" data-idx="${idx}"><option value="">-- Seleccione --</option></select></div>
            ${esComprobanteConsultaMed ? `<div class="sop-field"><label>Tipo de consulta *</label><select class="sopMultiTipoConsulta" data-idx="${idx}"><option value="">-- Seleccione --</option></select></div>` : ''}`;

        const fieldsHtml = `
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            ${esComprobanteConsultaMed ? nombreSingleFieldHtml : `
              <div class="sop-field"><label>Apellidos *</label><input type="text" class="sopMultiApe" data-idx="${idx}" value="${escapeHtml(parsed.apellidos || '')}"></div>
              <div class="sop-field"><label>Nombres *</label><input type="text" class="sopMultiNom" data-idx="${idx}" value="${escapeHtml(parsed.nombres || '')}"></div>
            `}
            ${docFieldsHtml}
            <div class="sop-field"><label>Fecha *</label><input type="date" class="sopMultiFecha" data-idx="${idx}" value="${escapeHtml(parsed.fecha_estudio || '')}"></div>
            ${estudioFieldsHtml}
          </div>
        `;

        return `
          <div class="sop-multi-card" style="border:1px solid #e2e8f0;border-radius:8px;padding:14px;margin-bottom:12px;background:#f9fafb">
            <div style="display:flex;align-items:center;margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid #e5e7eb">
              <i data-lucide="file-pdf" style="width:20px;height:20px;color:#dc2626;margin-right:8px"></i>
              <strong style="flex:1;font-size:.95rem;color:#1f2937">${escapeHtml(item.file.name)}</strong>
              <span style="background:#e5e7eb;padding:4px 8px;border-radius:4px;font-size:.8rem;color:#6b7280">${badgeTipo} ${idx + 1}/${analisisLista.length}</span>
            </div>
            ${fieldsHtml}
          </div>
        `;
      }).join('');

      const modal = openSopModal(`
        <h3><i data-lucide="files"></i> Subir ${analisisLista.length} ${titulo}</h3>
        <p style="font-size:.85rem;color:#64748b;margin:-8px 0 14px">Verifique y/o edite los datos de cada ${itemLabel}. Se subirán de forma individual.</p>
        <div style="max-height:600px;overflow-y:auto;border:1px solid #e2e8f0;border-radius:8px;padding:12px;background:#fafbfc">
          ${cardsHtml}
        </div>
        <div class="sop-dialog-actions" style="margin-top:16px">
          <button type="button" class="sop-btn sop-btn-ghost" id="sopMultiCancel">Cancelar</button>
          <button type="button" class="sop-btn sop-btn-primary" id="sopMultiOk">Subir todos</button>
        </div>
      `, { closeOnBackdrop: false, closeOnEscape: false });

      // Populate selects
      (async () => {
        for (let idx = 0; idx < analisisLista.length; idx++) {
          const parsed = analisisLista[idx].analisis.parsed || analisisLista[idx].analisis.parcial || {};
          if (esReporteClinico) {
            if (esPsg) {
              const psgSel = modal.querySelector(`.sopMultiPsgEst[data-idx="${idx}"]`);
              if (psgSel) poblarSelectEstudioPsgCliente(psgSel, parsed.estudio_texto);
            }
            continue;
          }
          const estSelect = modal.querySelector(`.sopMultiEst[data-idx="${idx}"]`);
          const tipoSel = modal.querySelector(`.sopMultiTipoConsulta[data-idx="${idx}"]`);
          if (estSelect) {
            if (esConsultaMedica) {
              await poblarSelectEspecialidadPdx(estSelect, parsed.estudio_texto);
            } else {
              await poblarSelectEstudioPdx(estSelect, parsed.estudio_texto);
            }
          }
          if (esComprobanteConsultaMed && estSelect && tipoSel) {
            await enlazarEspecialidadConTipoConsultaPdx(
              estSelect,
              tipoSel,
              parsed.tipo_consulta || parsed.marca_tiempo
            );
          }
        }
        sopIcons(modal);
      })();

      modal.querySelector('#sopMultiCancel').onclick = () => { closeSopModal(modal); reject(new Error('cancelado')); };
      modal.querySelector('#sopMultiOk').onclick = async () => {
        const uploads = [];
        let hasError = false;

        for (let idx = 0; idx < analisisLista.length; idx++) {
          const nombreCompleto = modal.querySelector(`.sopMultiNombreCompleto[data-idx="${idx}"]`)?.value?.trim();
          const ape = modal.querySelector(`.sopMultiApe[data-idx="${idx}"]`)?.value?.trim();
          const nom = modal.querySelector(`.sopMultiNom[data-idx="${idx}"]`)?.value?.trim();
          const doc = modal.querySelector(`.sopMultiDoc[data-idx="${idx}"]`)?.value?.trim();
          const fecha = modal.querySelector(`.sopMultiFecha[data-idx="${idx}"]`)?.value;
          const est = modal.querySelector(`.sopMultiEst[data-idx="${idx}"]`)?.value?.trim();
          const psgEst = esPsg ? modal.querySelector(`.sopMultiPsgEst[data-idx="${idx}"]`)?.value?.trim() : '';
          const tipoConsulta = esComprobanteConsultaMed
            ? modal.querySelector(`.sopMultiTipoConsulta[data-idx="${idx}"]`)?.value?.trim()
            : '';

          let nombres = nom || '';
          let apellidos = ape || '';
          const itemRef = `${badgeTipo} ${idx + 1} (${analisisLista[idx].file.name})`;

          if (esReporteClinico) {
            if (!ape || !nom || !fecha) {
              sopToast(`${itemRef}: Complete apellidos, nombres y fecha`, 'warning');
              hasError = true;
              break;
            }
            if (esPsg && !psgEst) {
              sopToast(`${itemRef}: Seleccione el tipo PSG`, 'warning');
              hasError = true;
              break;
            }
            const body = {
              apellidos,
              nombres,
              fecha_estudio: fecha,
              confirmacion_manual: '1'
            };
            if (esPsg) {
              body.estudio_texto = psgEst;
              const docNorm = normalizarNumeroDocumentoCliente(doc);
              if (docNorm) body.paciente_documento = docNorm;
            }
            uploads.push({ file: analisisLista[idx].file, body });
            continue;
          }

          if (esComprobanteConsultaMed) {
            const full = nombreCompleto || '';
            if (!full) {
              sopToast(`${itemRef}: Complete el nombre completo`, 'warning');
              hasError = true;
              break;
            }
            const parsedFull = parseNombrePdxCliente(full, carpeta);
            if (parsedFull.ok && parsedFull.nombres && parsedFull.apellidos) {
              nombres = parsedFull.nombres;
              apellidos = parsedFull.apellidos;
            } else {
              const split = separarNombreCompletoConsultaMedicaCliente(full);
              if (split.nombres || split.apellidos) {
                nombres = split.nombres;
                apellidos = split.apellidos;
              } else {
                nombres = full;
                apellidos = '';
              }
            }
          }

          if (!esComprobanteConsultaMed && (!esConsultaMedica && (!ape || !nom || !fecha || !est || !doc))) {
            sopToast(`${itemRef}: Complete todos los campos obligatorios`, 'warning');
            hasError = true;
            break;
          }
          if (esComprobanteConsultaMed && (!nombres || !apellidos || !fecha || !est || !tipoConsulta)) {
            sopToast(`${itemRef}: Complete todos los campos obligatorios`, 'warning');
            hasError = true;
            break;
          }
          if (esConsultaMedica && !esComprobanteConsultaMed && (!ape || !nom || !fecha || !est)) {
            sopToast(`${itemRef}: Complete todos los campos obligatorios`, 'warning');
            hasError = true;
            break;
          }

          const body = {
            apellidos,
            nombres,
            fecha_estudio: fecha,
            estudio_texto: est,
            confirmacion_manual: '1'
          };
          if (esComprobanteConsultaMed) {
            body.paciente_nombre_completo = nombreCompleto || `${nombres} ${apellidos}`.trim();
            body.tipo_consulta = tipoConsulta;
          }
          if (!esConsultaMedica) {
            body.paciente_documento = normalizarNumeroDocumentoCliente(doc);
            body.tipo_documento = modal.querySelector(`.sopMultiTipoDoc[data-idx="${idx}"]`)?.value?.toUpperCase() || 'CC';
          }

          uploads.push({ file: analisisLista[idx].file, body });
        }

        if (hasError) return;

        try {
          let contador = 0;
          let fallos = 0;
          sopUploadBegin({ title: 'Cargar reportes', total: uploads.length });
          for (let i = 0; i < uploads.length; i++) {
            const { file, body } = uploads[i];
            try {
              await subirArchivoPdx(file, carpetaId, body, {
                fileIndex: i + 1,
                batchTotal: uploads.length,
                manageSession: false
              });
              contador++;
            } catch (e) {
              if (e.codigo === 'PDX_DUPLICADO') {
                sopToast(`${file.name}: ${e.message}`, 'warning');
                fallos++;
                continue;
              }
              sopUploadFinish({ state: 'error', message: e.message || 'Error al subir' });
              throw e;
            }
          }
          sopUploadFinish({
            state: contador ? 'success' : 'error',
            message: contador
              ? `${contador} ${tipoEntidad} subido(s)${fallos ? `, ${fallos} omitido(s)` : ''}`
              : 'No se subió ningún archivo'
          });
          closeSopModal(modal);
          if (contador) sopToast(`${contador} ${tipoEntidad} subido(s)${fallos ? `, ${fallos} omitido(s)` : ''}`, fallos ? 'warning' : 'success');
          resolve();
        } catch (e) {
          sopToast(e.message, 'error');
        }
      };
    });
  }

  function modalCorregirDatosPdx(file, carpetaId, carpeta, analisis, resolve, reject) {
    const tema = analisis.tema || detectarTemaCarpetaCliente(carpeta?.nombre_display || '');
    const p = analisis.parcial || {};
    const ayuda = ayudaFormatoCliente(tema);
    const esEstruct = esCarpetaEstructuradaPdx(carpeta);
    const esComprobanteConsultaMed = esCarpetaComprobanteConsultaMedicaPdx(carpeta);
    const esConsultaMedica = esCarpetaConsultaMedicaPdx(carpeta);
    const esPsg = tema === 'psg';
    const motivoTxt = analisis.motivo === 'falta_estudio_psg'
      ? 'El nombre no incluye el tipo de estudio PSG (Básica, CPAP o BPAP). Complételo para continuar.'
      : `El nombre del archivo no cumple la estructura requerida. Complételo o corríjalo para subir el PDF.`;
    const nombreCompletoVal = (p.apellidos && p.nombres) ? `${p.nombres} ${p.apellidos}` : (p.paciente_nombre || p.paciente_nombre_completo || '');

    const modal = openSopModal(`
      <h3><i data-lucide="file-warning"></i> Completar datos del archivo</h3>
      <p style="font-size:.85rem;color:#64748b;margin:-8px 0 10px">${escapeHtml(motivoTxt)}</p>
      <p style="font-size:.8rem;color:#94a3b8;margin:0 0 10px"><strong>Formato esperado:</strong> <code>${escapeHtml(ayuda.pattern)}</code></p>
      <dl class="sop-upload-preview" style="margin-bottom:12px">
        <dt>Archivo</dt><dd>${escapeHtml(file.name)}</dd>
      </dl>
      ${esComprobanteConsultaMed ? `
      <div class="sop-field"><label>Nombre completo *</label><input type="text" id="sopPdxCorrNombreCompleto" value="${escapeHtml(nombreCompletoVal)}" placeholder="Nombres y apellidos"></div>` : `
      <div class="sop-field"><label>Apellidos *</label><input type="text" id="sopPdxCorrApe" value="${escapeHtml(p.apellidos || '')}"></div>
      <div class="sop-field"><label>Nombres *</label><input type="text" id="sopPdxCorrNom" value="${escapeHtml(p.nombres || '')}"></div>`}
      ${esEstruct ? `
      <div class="sop-field"><label>Tipo de documento</label><input type="text" id="sopPdxCorrTipoDoc" data-campo-tipo="tipo_doc" value="${escapeHtml(normalizarTipoDocumentoCliente(p.tipo_documento || 'CC'))}" maxlength="4" autocomplete="off" spellcheck="false" style="text-transform:uppercase" placeholder="CC"></div>
      <div class="sop-field"><label>Número de documento *</label><input type="text" id="sopPdxCorrDoc" data-campo-tipo="doc_numero" value="${escapeHtml(p.paciente_documento || '')}" inputmode="numeric" pattern="[0-9]*"></div>` : `
      <div class="sop-field"><label>Documento (opcional)</label><input type="text" id="sopPdxCorrDoc" data-campo-tipo="doc_numero" value="${escapeHtml(p.paciente_documento || '')}" inputmode="numeric" pattern="[0-9]*"></div>`}
      <div class="sop-field"><label>Fecha del estudio *</label><input type="date" id="sopPdxCorrFecha" value="${escapeHtml(p.fecha_estudio || '')}"></div>
      ${esComprobanteConsultaMed ? `
      <div class="sop-field"><label>Especialidad *</label><select id="sopPdxCorrEst"></select></div>
      <div class="sop-field"><label>Tipo de consulta *</label><select id="sopPdxCorrTipoConsulta"></select></div>` : ''}
      ${(esEstruct || esPsg) ? '<div class="sop-field"><label>Tipo de examen *</label><select id="sopPdxCorrEst"></select></div>' : ''}
      <div class="sop-dialog-actions">
        <button type="button" class="sop-btn sop-btn-ghost" id="sopPdxCorrCancel">Cancelar</button>
        <button type="button" class="sop-btn sop-btn-primary" id="sopPdxCorrOk">Subir PDF</button>
      </div>`, { closeOnBackdrop: false, closeOnEscape: false });

    const estSel = modal.querySelector('#sopPdxCorrEst');
    if (esPsg) poblarSelectEstudioPsgCliente(estSel, p.estudio_texto);
    else if (esComprobanteConsultaMed) {
      poblarSelectEspecialidadPdx(estSel, p.estudio_texto).then(() => {
        enlazarEspecialidadConTipoConsultaPdx(
          estSel,
          modal.querySelector('#sopPdxCorrTipoConsulta'),
          p.tipo_consulta || p.marca_tiempo
        );
      });
    } else if (esConsultaMedica) poblarSelectEspecialidadPdx(estSel, p.estudio_texto);
    else if (esEstruct) poblarSelectEstudioPdx(estSel, p.estudio_texto);

    modal.querySelector('#sopPdxCorrCancel').onclick = () => { closeSopModal(modal); reject(new Error('cancelado')); };
    modal.querySelector('#sopPdxCorrOk').onclick = async () => {
      let apellidos = modal.querySelector('#sopPdxCorrApe')?.value?.trim() || '';
      let nombres = modal.querySelector('#sopPdxCorrNom')?.value?.trim() || '';
      if (esComprobanteConsultaMed) {
        const full = modal.querySelector('#sopPdxCorrNombreCompleto')?.value?.trim() || '';
        if (!full) return sopToast('Complete el nombre completo', 'warning');
        const split = separarNombreCompletoConsultaMedicaCliente(full);
        if (split.nombres && split.apellidos) {
          nombres = split.nombres;
          apellidos = split.apellidos;
        } else {
          nombres = split.nombres || full;
          apellidos = split.apellidos || '';
        }
        if (!nombres || !apellidos) return sopToast('Indique nombre y apellido en el campo nombre completo', 'warning');
      }
      const body = {
        confirmacion_manual: '1',
        apellidos,
        nombres,
        tipo_documento: normalizarTipoDocumentoCliente(modal.querySelector('#sopPdxCorrTipoDoc')?.value || 'CC'),
        paciente_documento: normalizarNumeroDocumentoCliente(modal.querySelector('#sopPdxCorrDoc')?.value || ''),
        fecha_estudio: modal.querySelector('#sopPdxCorrFecha')?.value,
        estudio_texto: estSel?.value?.trim() || ''
      };
      if (esComprobanteConsultaMed) {
        body.paciente_nombre_completo = modal.querySelector('#sopPdxCorrNombreCompleto')?.value?.trim() || `${nombres} ${apellidos}`.trim();
        body.estudio_texto = estSel?.value?.trim() || '';
        body.tipo_consulta = modal.querySelector('#sopPdxCorrTipoConsulta')?.value?.trim() || '';
        if (!body.estudio_texto || !body.tipo_consulta) {
          return sopToast('Complete especialidad y tipo de consulta', 'warning');
        }
      }
      if (!esComprobanteConsultaMed && (!body.apellidos || !body.nombres || !body.fecha_estudio)) {
        return sopToast('Complete apellidos, nombres y fecha', 'warning');
      }
      if (esEstruct && (!body.paciente_documento || body.paciente_documento.length < 4 || !body.estudio_texto)) {
        return sopToast('Complete documento (solo dígitos) y tipo de examen', 'warning');
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
      <div class="sop-field"><label>Número de documento *</label><input type="text" id="sopPdxPsgDoc" data-campo-tipo="doc_numero" value="${escapeHtml(parsed.paciente_documento || '')}" inputmode="numeric" pattern="[0-9]*"></div>
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
        paciente_documento: normalizarNumeroDocumentoCliente(modal.querySelector('#sopPdxPsgDoc')?.value || ''),
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
      <div class="sop-field"><label>Tipo de documento</label><input type="text" id="sopPdxOrdTipoDoc" data-campo-tipo="tipo_doc" value="${escapeHtml(normalizarTipoDocumentoCliente(parsed.tipo_documento || 'CC'))}" maxlength="4" autocomplete="off" spellcheck="false" style="text-transform:uppercase" placeholder="CC"></div>
      <div class="sop-field"><label>Número de documento *</label><input type="text" id="sopPdxOrdDoc" data-campo-tipo="doc_numero" value="${escapeHtml(parsed.paciente_documento || '')}" inputmode="numeric" pattern="[0-9]*"></div>
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
        tipo_documento: normalizarTipoDocumentoCliente(modal.querySelector('#sopPdxOrdTipoDoc')?.value),
        paciente_documento: normalizarNumeroDocumentoCliente(modal.querySelector('#sopPdxOrdDoc')?.value || ''),
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
        necesitaCorreccion: !!analisis.requiere_correccion,
        esDuplicado: !!analisis.duplicado
      };
    }));
    const listos = items.filter((it) => !it.necesitaCorreccion && !it.esDuplicado);
    if (!listos.length) {
      return (async () => {
        for (const it of items) {
          await flujoSubidaPdx(it.file, carpetaId);
        }
      })();
    }
    const filas = items.map((it) => {
      if (it.esDuplicado) {
        return `<tr class="sop-lote-invalid" data-lote-idx="${it.idx}">
          <td>${escapeHtml(it.file.name)}</td>
          <td colspan="3" style="color:#b45309;font-size:.85rem">${escapeHtml(it.analisis.duplicado?.mensaje || 'Duplicado en esta carpeta')}</td>
          <td><span style="color:#b45309">Duplicado</span></td>
        </tr>`;
      }
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
        sopUploadBegin({ title: 'Cargar reportes', total: extras.length });
        for (let i = 0; i < extras.length; i++) {
          const { file, extra } = extras[i];
          try {
            await subirArchivoPdx(file, carpetaId, extra, {
              fileIndex: i + 1,
              batchTotal: extras.length,
              manageSession: false
            });
            ok++;
          } catch (e) {
            fail++;
            sopToast(`${file.name}: ${e.message}`, 'error');
          }
        }
        sopUploadFinish({
          state: ok ? 'success' : 'error',
          message: ok
            ? `${ok} archivo(s) subido(s)${fail ? `, ${fail} con error` : ''}`
            : 'Ningún archivo se subió correctamente'
        });
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
      if (pdfs.length >= 2) {
        const carpeta = pdxState.carpetaActual || pdxState.carpetas.find((c) => c.id === carpetaId);
        if (esCarpetaSubidaMultipleIndividualPdx(carpeta)) {
          await flujoSubidaMultiplePdx(pdfs, carpetaId);
        } else {
          await flujoUnificarPdfsPdx(pdfs, carpetaId);
        }
      } else {
        await flujoSubidaPdx(pdfs[0], carpetaId);
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
            <td><button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-open-archivo="${r.archivo_id}" title="Ver PDF en nueva pestaña"><i data-lucide="external-link"></i> Abrir</button></td>
          </tr>`).join('')}
        </tbody></table></div>
      </div>`;
    el.querySelector('[data-close-pdx-search]')?.addEventListener('click', cerrarResultadosPdx);
    el.querySelectorAll('[data-open-archivo]').forEach((b) => {
      b.addEventListener('click', () => {
        const id = parseInt(b.dataset.openArchivo, 10);
        const row = list.find((x) => x.archivo_id === id);
        const titulo = row?.nombre_descarga || row?.paciente_nombre || row?.nombre_archivo_display || 'Reporte';
        abrirPdfEnNavegador(`/api/soportes/pdx/archivos/${id}/ver`, titulo);
      });
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

  async function refrescarVistaPdxActual() {
    await cargarCarpetasPdx();
    if (pdxState.carpetaId) await abrirCarpetaPdx(pdxState.carpetaId);
    else renderListaCarpetasPdx();
  }

  window.initReportesPdx = function initReportesPdx() {
    sopIcons($('view-reportes-pdx'));
    sopAnimateModuleIn('view-reportes-pdx');
    if (initPdxDone) {
      setupEntradaDocumentoPdx();
      refrescarVistaPdxActual().catch(console.error);
      return;
    }
    initPdxDone = true;
    setupEntradaDocumentoPdx();
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
    armState.diasParentId = 0;
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

  function armDiaParentId(dia) {
    const n = parseInt(dia?.parent_id, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function armDiaById(id) {
    return armState.dias.find((d) => d.id === id);
  }

  function armModoContenedoraActual() {
    const parentId = armState.diasParentId || 0;
    if (!parentId) return 'facturacion';
    const p = armDiaById(parentId);
    return p?.modo || 'facturacion';
  }

  function armLabelNuevaCarpetaModo(modo) {
    if (modo === 'anexo_fidu') return 'Nuevo anexo';
    if (modo === 'ucqn') return 'Nueva persona';
    return 'Carpeta de día';
  }

  function armContenedorasRaiz() {
    return armState.dias.filter((d) => !armDiaParentId(d) && d.es_contenedor);
  }

  function armDiasVisibles() {
    const parentId = armState.diasParentId || 0;
    const lista = armState.dias.filter((d) => armDiaParentId(d) === parentId);
    if (!parentId) {
      return lista.slice().sort((a, b) => {
        if (!!a.es_contenedor !== !!b.es_contenedor) return a.es_contenedor ? -1 : 1;
        const ord = (a.orden || 0) - (b.orden || 0);
        if (ord !== 0) return ord;
        return compararTextoNatural(a.nombre_display, b.nombre_display);
      });
    }
    return lista.slice().sort((a, b) => {
      const ord = (a.orden || 0) - (b.orden || 0);
      if (ord !== 0) return ord;
      return compararTextoNatural(a.nombre_display, b.nombre_display);
    });
  }

  function armRutaExplorerChain() {
    const chain = [];
    let id = armState.diasParentId || 0;
    const seen = new Set();
    while (id && !seen.has(id)) {
      seen.add(id);
      const d = armDiaById(id);
      if (!d) break;
      chain.unshift(d);
      id = armDiaParentId(d);
    }
    return chain;
  }

  function navegarArmDiasExplorer(parentId) {
    armState.diasParentId = parentId || 0;
    armState.diaId = null;
    armState.diaLabel = null;
    armState.contenedorId = null;
    armState.contenedorTipo = null;
    armState.expedienteId = null;
    armState.expedienteCodigo = null;
    armState.vista = 'period';
    renderArmadoDiasExplorer();
    renderArmadoContextBar();
  }

  function armVolverExplorerUnNivel() {
    const cur = armDiaById(armState.diasParentId);
    const parentId = cur ? armDiaParentId(cur) : 0;
    navegarArmDiasExplorer(parentId);
  }

  function armLabelVolverDesdeDia() {
    const diaRow = armDiaById(armState.diaId);
    const parent = diaRow?.parent_id ? armDiaById(diaRow.parent_id) : null;
    return parent?.nombre_display || armState.periodoLabel || 'Mes';
  }

  function armVolverDesdeDia() {
    const diaRow = armDiaById(armState.diaId);
    const parentId = diaRow ? armDiaParentId(diaRow) : (armState.diasParentId || 0);
    armState.diaId = null;
    armState.diaLabel = null;
    armState.diaModo = null;
    armState.diaFacturacion = null;
    armState.contenedores = [];
    armState.contenedorId = null;
    armState.contenedorTipo = null;
    armState.expedienteId = null;
    armState.expedienteCodigo = null;
    armState.expedienteDetalle = null;
    armState.vista = 'period';
    if (parentId) navegarArmDiasExplorer(parentId);
    else {
      armState.diasParentId = 0;
      renderArmadoDiasExplorer();
      renderArmadoContextBar();
    }
  }

  function htmlArmDiaMeta(d) {
    if (d.es_contenedor) {
      const n = d.hijos_count || 0;
      return `${n} carpeta${n === 1 ? '' : 's'} dentro`;
    }
    return `${badgeFacturacionArmado(d.estado_facturacion)} · <strong>${d.expedientes_count || 0}</strong> expediente(s) FE`;
  }

  function htmlArmDiaIcon(d) {
    return d.es_contenedor ? 'folder-tree' : 'folder';
  }

  function armEsAncestroEnCliente(posibleAncestroId, diaId) {
    const map = {};
    armState.dias.forEach((d) => { map[d.id] = armDiaParentId(d); });
    let cur = diaId;
    const seen = new Set();
    while (cur) {
      const p = map[cur] || 0;
      if (!p) return false;
      if (p === posibleAncestroId) return true;
      if (seen.has(p)) return false;
      seen.add(p);
      cur = p;
    }
    return false;
  }

  async function armMoverDiaApi(diaId, parentId) {
    const res = await apiFetch(`/api/soportes/armado/dias/${diaId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent_id: parentId || 0 })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'No se pudo mover la carpeta');
    return data;
  }

  function armFinalizarDragSession() {
    if (armDragSession?.ghost?.parentNode) armDragSession.ghost.remove();
    document.querySelectorAll('.sop-folder-dragging, .sop-folder-drop-over, .sop-pdx-crumb-drop-over').forEach((el) => {
      el.classList.remove('sop-folder-dragging', 'sop-folder-drop-over', 'sop-pdx-crumb-drop-over');
    });
    armDragSession = null;
  }

  function armPuedeArrastrarDia() {
    return sopPerm('soportes.armado.crear_estructura');
  }

  function armFindDropTargetAt(clientX, clientY, srcId) {
    const stack = typeof document.elementsFromPoint === 'function'
      ? document.elementsFromPoint(clientX, clientY)
      : [document.elementFromPoint(clientX, clientY)].filter(Boolean);
    for (const el of stack) {
      const dropEl = el?.closest?.('[data-arm-drop-parent]');
      if (!dropEl) continue;
      const targetParent = Number.parseInt(dropEl.dataset.armDropParent, 10);
      const dest = Number.isFinite(targetParent) ? targetParent : 0;
      if (dest !== srcId && !armEsAncestroEnCliente(srcId, dest)) {
        return { dropEl, targetParent: dest };
      }
    }
    return null;
  }

  async function armRecargarDiasTrasMover(targetParent) {
    const res = await apiFetch(`/api/soportes/armado/periodos/${armState.periodoId}/dias`);
    const data = await res.json();
    if (res.ok) armState.dias = data.dias || [];
    if (armState.diasParentId && !armDiaById(armState.diasParentId)) {
      armState.diasParentId = targetParent;
    }
    renderArmadoDiasExplorer();
    renderArmadoContextBar();
  }

  async function armEjecutarMoverDia(srcId, targetParent) {
    const d = armDiaById(srcId);
    if (!d || armDiaParentId(d) === targetParent) return false;
    await armMoverDiaApi(srcId, targetParent);
    sopToast('Carpeta movida', 'success');
    await armRecargarDiasTrasMover(targetParent);
    return true;
  }

  function armOpcionesDestinoMover(excludeId) {
    const opts = [{ value: 0, label: `${armState.periodoLabel || 'Mes'} (raíz)` }];
    armState.dias
      .filter((d) => d.es_contenedor && d.id !== excludeId)
      .filter((d) => !armEsAncestroEnCliente(excludeId, d.id))
      .sort((a, b) => compararTextoNatural(a.nombre_display, b.nombre_display))
      .forEach((d) => {
        const chain = [];
        let p = armDiaParentId(d);
        const seen = new Set();
        while (p && !seen.has(p)) {
          seen.add(p);
          const parent = armDiaById(p);
          if (!parent) break;
          chain.unshift(parent.nombre_display);
          p = armDiaParentId(parent);
        }
        const prefix = chain.length ? `${chain.join(' / ')} / ` : '';
        opts.push({ value: d.id, label: `${prefix}${d.nombre_display}` });
      });
    return opts;
  }

  function modalMoverDiaArmado(diaId) {
    if (!armPuedeArrastrarDia()) return;
    const d = armDiaById(diaId);
    if (!d) return sopToast('Carpeta no encontrada', 'warning');
    const opts = armOpcionesDestinoMover(diaId);
    const actual = armDiaParentId(d);
    const modal = openSopModal(`
      <h3><i data-lucide="folder-input"></i> Mover carpeta</h3>
      <p style="font-size:.85rem;color:#64748b;margin:-6px 0 12px">Mueva <strong>${escapeHtml(d.nombre_display)}</strong> dentro de una carpeta contenedora o a la raíz del mes.</p>
      <div class="sop-field"><label>Carpeta contenedora destino</label>
        <select id="sopArmMoveDest">${opts.map((o) =>
          `<option value="${o.value}"${o.value === actual ? ' selected' : ''}>${escapeHtml(o.label)}</option>`
        ).join('')}</select></div>
      <p style="font-size:.8rem;color:#64748b;margin:0">También puede mantener pulsada la carpeta y soltarla sobre un contenedor.</p>
      <div class="sop-dialog-actions">
        <button type="button" class="sop-btn sop-btn-ghost" id="sopArmMoveCancel">Cancelar</button>
        <button type="button" class="sop-btn sop-btn-teal" id="sopArmMoveOk">Mover</button>
      </div>`);
    modal.querySelector('#sopArmMoveCancel').onclick = () => closeSopModal(modal);
    modal.querySelector('#sopArmMoveOk').onclick = async () => {
      const dest = Number.parseInt(modal.querySelector('#sopArmMoveDest')?.value, 10);
      const targetParent = Number.isFinite(dest) ? dest : 0;
      try {
        const moved = await armEjecutarMoverDia(diaId, targetParent);
        if (moved) closeSopModal(modal);
      } catch (e) {
        sopToast(e.message, 'error');
      }
    };
    sopIcons(modal);
  }

  function bindArmFolderDragSource(card, diaId) {
    if (!armPuedeArrastrarDia()) return;
    let holdTimer = null;
    let active = false;
    let moved = false;

    const cancelHold = () => {
      if (holdTimer) clearTimeout(holdTimer);
      holdTimer = null;
    };

    const onMove = (ev) => {
      if (!active || !armDragSession) return;
      moved = true;
      ev.preventDefault();
      const g = armDragSession.ghost;
      if (g) {
        g.style.left = `${ev.clientX + 12}px`;
        g.style.top = `${ev.clientY + 12}px`;
      }
      document.querySelectorAll('.sop-folder-drop-over, .sop-pdx-crumb-drop-over').forEach((el) => {
        el.classList.remove('sop-folder-drop-over', 'sop-pdx-crumb-drop-over');
      });
      const hit = armFindDropTargetAt(ev.clientX, ev.clientY, diaId);
      if (hit) {
        hit.dropEl.classList.add(hit.dropEl.classList.contains('sop-pdx-crumb-drop') ? 'sop-pdx-crumb-drop-over' : 'sop-folder-drop-over');
        armDragSession.hoverParentId = hit.targetParent;
      } else {
        armDragSession.hoverParentId = null;
      }
    };

    const onUp = async (ev) => {
      cancelHold();
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.classList.remove('sop-arm-drag-active');
      if (!active) return;
      active = false;
      const targetParent = armDragSession?.hoverParentId;
      const srcId = armDragSession?.diaId;
      armFinalizarDragSession();
      if (moved) {
        armBlockClickUntil = Date.now() + 450;
        ev?.preventDefault?.();
        ev?.stopPropagation?.();
      }
      if (targetParent == null || srcId == null) return;
      try {
        await armEjecutarMoverDia(srcId, targetParent);
      } catch (e) {
        sopToast(e.message, 'error');
      }
    };

    card.addEventListener('mousedown', (ev) => {
      if (ev.button !== 0 || ev.target.closest('.sop-folder-card-actions, .sop-folder-list-actions, [data-dia-move]')) return;
      cancelHold();
      holdTimer = setTimeout(() => {
        active = true;
        moved = false;
        card.classList.add('sop-folder-dragging');
        document.body.classList.add('sop-arm-drag-active');
        const ghost = card.cloneNode(true);
        ghost.classList.add('sop-pdx-drag-ghost');
        ghost.classList.remove('sop-folder-dragging');
        document.body.appendChild(ghost);
        armDragSession = { diaId, ghost, hoverParentId: null };
        onMove(ev);
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      }, ARM_DRAG_HOLD_MS);
    });
    card.addEventListener('mouseup', cancelHold);
    card.addEventListener('mouseleave', cancelHold);
  }

  function bindArmFolderDropTarget(card, diaId) {
    card.dataset.armContenedor = '1';
    card.dataset.armDropParent = String(diaId);
  }

  function bindArmadoDiaCardEvents(root) {
    if (!root) return;
    root.querySelectorAll('[data-dia-id]').forEach((card) => {
      const id = parseInt(card.dataset.diaId, 10);
      const open = () => {
        const d = armDiaById(id);
        if (d?.es_contenedor) navegarArmDiasExplorer(id);
        else seleccionarDiaArmado(id);
      };
      card.addEventListener('click', (ev) => {
        if (ev.target.closest('[data-dia-edit],[data-dia-del],[data-dia-move],.sop-folder-card-actions,.sop-folder-list-actions')) return;
        if (card.classList.contains('sop-folder-dragging')) return;
        if (Date.now() < armBlockClickUntil) return;
        open();
      });
      card.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') open(); });
      bindArmFolderDragSource(card, id);
      if (card.dataset.armContenedor === '1') bindArmFolderDropTarget(card, id);
    });
    root.querySelectorAll('[data-dia-edit]').forEach((btn) => {
      btn.addEventListener('click', (ev) => { ev.stopPropagation(); modalEditarDiaArmado(parseInt(btn.dataset.diaEdit, 10)); });
    });
    root.querySelectorAll('[data-dia-move]').forEach((btn) => {
      btn.addEventListener('click', (ev) => { ev.stopPropagation(); modalMoverDiaArmado(parseInt(btn.dataset.diaMove, 10)); });
    });
    root.querySelectorAll('[data-dia-del]').forEach((btn) => {
      btn.addEventListener('click', (ev) => { ev.stopPropagation(); modalEliminarDiaArmado(parseInt(btn.dataset.diaDel, 10), btn.dataset.diaNom); });
    });
  }

  function renderArmadoDiasExplorer() {
    const panel = $('sopArmExpedientePanel');
    if (!panel || !armState.periodoId) return;
    armState.vista = 'period';
    const puedeGestionarDia = sopPerm('soportes.armado.crear_estructura');
    const viewMode = sopFolderViewMode('arm');
    const lista = armDiasVisibles();
    const huerfanasRaiz = !armState.diasParentId ? lista.filter((d) => !d.es_contenedor) : [];
    const faltanContenedorasRaiz = !armState.diasParentId && armContenedorasRaiz().length < 3;
    const dragHint = armPuedeArrastrarDia() ? 'Mantenga pulsado para mover' : '';
    const parentExplorer = armState.diasParentId ? armDiaById(armState.diasParentId) : null;
    const volverExplorerLabel = parentExplorer
      ? (armDiaParentId(parentExplorer) ? parentExplorer.nombre_display : (armState.periodoLabel || 'Mes'))
      : '';
    panel.innerHTML = `<div class="sop-panel-head">
        <div>
          <h3 style="margin:0"><i data-lucide="calendar"></i> ${escapeHtml(armState.periodoLabel || 'Mes')}</h3>
        </div>
        <div class="sop-panel-head-tools">
          ${armState.diasParentId ? `<button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" id="btnSopArmVolverExplorer"><i data-lucide="arrow-left"></i> ${escapeHtml(volverExplorerLabel)}</button>` : ''}
          ${htmlSopFolderViewToggle('arm')}
          ${armState.diasParentId ? htmlArmZipCarpetaActualBtn() : `${htmlArmZipPaqueteBtn()}${htmlArmZipUnificadoBtn()}${htmlArmZipFacturadosBtn()}`}
          ${puedeGestionarDia && armState.diasParentId && armModoContenedoraActual() === 'anexo_fidu' ? `<button type="button" class="sop-btn sop-btn-ghost" id="btnSopArmSyncAnexoModulo"><i data-lucide="refresh-cw"></i> Sincronizar desde Anexo</button>` : ''}
          ${puedeGestionarDia && armState.diasParentId ? `<button type="button" class="sop-btn sop-btn-teal" id="btnSopArmNuevoDiaInline"><i data-lucide="folder-plus"></i> ${escapeHtml(armLabelNuevaCarpetaModo(armModoContenedoraActual()))}</button>` : ''}
        </div>
      </div>
      <div class="sop-panel-body">
        ${faltanContenedorasRaiz ? `<div class="sop-panel-warn" style="margin-bottom:12px;padding:10px 12px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;font-size:.85rem;color:#991b1b">
          Faltan las carpetas fijas del mes (<strong>Anexo FIDU</strong>, <strong>Facturas FIDU</strong>, <strong>U C Q N</strong>).
          <button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" id="btnSopArmRepararContenedoras" style="margin-left:8px">Reparar ahora</button>
        </div>` : ''}
        ${!armState.diasParentId ? `<p style="font-size:.82rem;color:#64748b;margin:0 0 12px">Abra una contenedora para crear carpetas de día, anexos o personas (UCQN). Las tres contenedoras del mes se crean automáticamente.</p>` : ''}
        ${armState.diasParentId && armModoContenedoraActual() === 'anexo_fidu' ? `<p style="font-size:.82rem;color:#64748b;margin:0 0 12px">Los anexos se leen del módulo <strong>Anexo FIDU</strong> (carpeta del mes creada allí por usted). Soportes no crea carpetas en Anexo. Use <strong>Sincronizar desde Anexo</strong> tras crear archivos en el módulo.</p>` : ''}
        ${huerfanasRaiz.length ? `<div class="sop-panel-warn" style="margin-bottom:12px;padding:10px 12px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;font-size:.85rem;color:#92400e">
          <strong>${huerfanasRaiz.length} carpeta(s) de facturación</strong> siguen en la raíz del mes (no se borraron). Abra <strong>Facturas FIDU</strong> o arrástrelas ahí. Los archivos en disco no se eliminaron.
        </div>` : ''}
        ${armPuedeArrastrarDia() ? `<p class="sop-arm-drag-hint" style="font-size:.8rem;color:#64748b;margin:0 0 10px"><i data-lucide="move" style="width:14px;height:14px;vertical-align:-2px"></i> Mantenga pulsada una carpeta y suéltela sobre un <strong>contenedor</strong>, o use <strong>Mover</strong> para elegir destino.</p>` : ''}
        <div id="sopArmDiasDropRoot" class="sop-arm-dias-drop-root${armState.diasParentId ? '' : ' hidden'}" data-arm-drop-parent="0" title="Soltar aquí para mover a la raíz del mes"></div>
        <div id="sopArmDiasGrid" class="sop-folder-explorer-grid${viewMode === 'list' ? ' sop-folder-list-mode' : ''}"></div>
      </div>`;
    bindSopFolderViewToggle(panel, 'arm');
    panel.querySelector('#btnSopArmVolverExplorer')?.addEventListener('click', armVolverExplorerUnNivel);
    const grid = panel.querySelector('#sopArmDiasGrid');
    panel.querySelector('#btnSopArmRepararContenedoras')?.addEventListener('click', () => {
      seleccionarPeriodoArmado(armState.periodoId).catch((e) => sopToast(e.message, 'error'));
    });
    if (!armState.dias.length) {
      grid.innerHTML = '<div class="sop-empty" style="grid-column:1/-1;padding:32px"><i data-lucide="folder-tree" class="sop-empty-icon"></i>Preparando estructura del mes…<br><span style="font-size:.85rem">Deben aparecer Anexo FIDU, Facturas FIDU y U C Q N.</span></div>';
    } else if (!lista.length) {
      const enContenedor = (armState.diasParentId || 0) > 0;
      grid.innerHTML = enContenedor
        ? '<div class="sop-empty" style="grid-column:1/-1;padding:32px"><i data-lucide="folder-open" class="sop-empty-icon"></i>Esta carpeta está vacía.<br><span style="font-size:.85rem">Arrastre carpetas aquí o cree una nueva.</span></div>'
        : '<div class="sop-empty" style="grid-column:1/-1;padding:32px"><i data-lucide="folder-tree" class="sop-empty-icon"></i>Debe ver aquí <strong>Anexo FIDU</strong>, <strong>Facturas FIDU</strong> y <strong>U C Q N</strong>.<br><span style="font-size:.85rem">Use <strong>Reparar ahora</strong> si no aparecen.</span></div>';
    } else if (viewMode === 'list') {
      grid.innerHTML = `<div class="sop-table-wrap"><table class="sop-table sop-folder-list-table">
        <thead><tr><th style="width:40px"></th><th>Carpeta</th><th>Facturación</th><th>Contenido</th><th class="sop-folder-list-actions">Acciones</th></tr></thead>
        <tbody>${lista.map((d) => {
          const icon = htmlArmDiaIcon(d);
          return `<tr class="${armState.diaId === d.id ? 'is-active' : ''}${d.es_contenedor ? ' sop-folder-row-contenedor' : ''}" data-dia-id="${d.id}" data-arm-contenedor="${d.es_contenedor ? '1' : '0'}" tabindex="0" title="${dragHint}">
            <td><span class="sop-folder-icon" style="width:32px;height:32px;margin:0"><i data-lucide="${icon}"></i></span></td>
            <td><strong>${escapeHtml(d.nombre_display)}</strong>${d.es_contenedor ? ' <span class="sop-badge sop-badge-muted">Contenedor</span>' : ''}</td>
            <td>${d.es_contenedor ? '—' : badgeFacturacionArmado(d.estado_facturacion)}</td>
            <td>${d.es_contenedor ? (d.hijos_count || 0) : `<strong>${d.expedientes_count || 0}</strong> expediente(s)`}</td>
            <td class="sop-folder-list-actions">
              ${htmlArmZipDiaBtn(d)}
              ${puedeGestionarDia ? `
              <button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-dia-move="${d.id}" title="Mover"><i data-lucide="folder-input"></i></button>
              <button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-dia-edit="${d.id}" title="Editar"><i data-lucide="pencil"></i></button>
              <button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-dia-del="${d.id}" data-dia-nom="${escapeHtml(d.nombre_display)}" title="Eliminar" style="color:#dc2626"><i data-lucide="trash-2"></i></button>` : ''}
            </td>
          </tr>`;
        }).join('')}</tbody></table></div>`;
      bindArmadoDiaCardEvents(grid);
    } else {
      grid.innerHTML = lista.map((d) => {
        const icon = htmlArmDiaIcon(d);
        return `<article class="sop-folder-card${d.es_contenedor ? ' sop-folder-card-contenedor' : ''}${armState.diaId === d.id ? ' is-active' : ''}" data-dia-id="${d.id}" data-arm-contenedor="${d.es_contenedor ? '1' : '0'}" tabindex="0" title="${dragHint}">
          <div class="sop-folder-card-icon"><i data-lucide="${icon}"></i></div>
          <div class="sop-folder-card-title">${escapeHtml(d.nombre_display)}${d.es_contenedor ? '<span class="sop-badge sop-badge-muted">Contenedor</span>' : ''}</div>
          <div class="sop-folder-card-meta">${htmlArmDiaMeta(d)}</div>
          <div class="sop-folder-card-actions">
            ${htmlArmZipDiaBtn(d)}
            ${puedeGestionarDia ? `
            <button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-dia-move="${d.id}" title="Mover a contenedora"><i data-lucide="folder-input"></i></button>
            <button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-dia-edit="${d.id}" title="Editar"><i data-lucide="pencil"></i></button>
            <button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-dia-del="${d.id}" data-dia-nom="${escapeHtml(d.nombre_display)}" title="Eliminar" style="color:#dc2626"><i data-lucide="trash-2"></i></button>` : ''}
          </div>
        </article>`;
      }).join('');
      bindArmadoDiaCardEvents(grid);
    }
    panel.querySelector('#btnSopArmSyncAnexoModulo')?.addEventListener('click', async () => {
      if (!armState.periodoId) return;
      const res = await apiFetch(`/api/soportes/armado/periodos/${armState.periodoId}/sync-anexo-modulo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ forzar_export: true })
      });
      const data = await res.json();
      if (!res.ok) { sopToast(data.error || 'Error al sincronizar', 'error'); return; }
      const msg = `${data.total_modulo || 0} anexo(s): ${data.creadas || 0} nueva(s), ${data.vinculadas || 0} vinculada(s), ${data.exportadas || 0} Excel en disco`;
      sopToast(msg, 'success');
      const savedParent = armState.diasParentId;
      await seleccionarPeriodoArmado(armState.periodoId);
      armState.diasParentId = savedParent;
      renderArmadoDiasExplorer();
      renderArmadoContextBar();
    });
    panel.querySelector('#btnSopArmNuevoDiaInline')?.addEventListener('click', modalNuevoDiaArmado);
    sopIcons(panel);
    bindArmMigrarRipsButtons(panel);
    bindArmZipButtons(panel);
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

  function renderAnexoDiaPanel(diaRow, anexo) {
    const panel = $('sopArmExpedientePanel');
    const parent = diaRow?.parent_id ? armDiaById(diaRow.parent_id) : null;
    const volverLabel = parent?.nombre_display || armState.periodoLabel || 'Mes';
    const tieneExport = !!(anexo?.ruta_export);
    panel.innerHTML = `<div class="sop-panel-head">
        <div>
          <h3 style="margin:0"><i data-lucide="file-spreadsheet"></i> ${escapeHtml(diaRow?.nombre_display || 'Anexo')}</h3>
          <div style="font-size:.85rem;color:#64748b;margin-top:4px">${anexo?.total_registros || 0} fila(s) en el módulo Anexo</div>
        </div>
        <div class="sop-panel-head-tools" style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" class="sop-btn sop-btn-teal sop-btn-sm" id="btnSopAnexoAbrirModulo"><i data-lucide="external-link"></i> Abrir en Anexo</button>
          <button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" id="btnSopAnexoDescargar"${tieneExport ? '' : ' disabled'}><i data-lucide="download"></i> Descargar Excel</button>
          <button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" id="btnSopAnexoSync"><i data-lucide="refresh-cw"></i> Actualizar Excel</button>
          <button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" id="btnSopArmVolverAnexoCont"><i data-lucide="arrow-left"></i> ${escapeHtml(volverLabel)}</button>
        </div>
      </div>
      <div class="sop-panel-body">
        <div class="sop-empty" style="padding:28px;text-align:left;max-width:520px;margin:0 auto">
          <p style="margin:0 0 10px">Este anexo está vinculado al módulo <strong>Anexo FIDU</strong>. Edite filas allí; al exportar, el Excel queda guardado aquí para descarga.</p>
          ${tieneExport ? `<p style="margin:0;font-size:.85rem;color:#64748b">Último export: <code>${escapeHtml(anexo.ruta_export.split('/').pop())}</code></p>` : '<p style="margin:0;font-size:.85rem;color:#64748b">Aún no hay Excel exportado — use «Actualizar Excel» o exporte desde Anexo.</p>'}
        </div>
      </div>`;
    panel.querySelector('#btnSopArmVolverAnexoCont')?.addEventListener('click', armVolverDesdeDia);
    panel.querySelector('#btnSopAnexoAbrirModulo')?.addEventListener('click', () => {
      if (!anexo?.archivo_id) return sopToast('Sin anexo vinculado', 'warning');
      if (typeof window.abrirAnexoFiduArchivo === 'function') {
        window.abrirAnexoFiduArchivo(anexo.archivo_id);
      } else {
        sopToast('Módulo Anexo no disponible', 'error');
      }
    });
    panel.querySelector('#btnSopAnexoDescargar')?.addEventListener('click', () => {
      if (!diaRow?.id) return;
      iniciarDescargaArchivoEnlace(`/api/soportes/armado/dias/${diaRow.id}/descargar-anexo`);
    });
    panel.querySelector('#btnSopAnexoSync')?.addEventListener('click', async () => {
      const res = await apiFetch(`/api/soportes/armado/dias/${diaRow.id}/sync-anexo-export`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) { sopToast(data.error || 'Error', 'error'); return; }
      sopToast('Excel actualizado en Soportes', 'success');
      await seleccionarDiaArmado(diaRow.id);
    });
    sopIcons(panel);
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
    armState.diaModo = diaRow?.modo || 'facturacion';
    armState.diaFacturacion = diaRow?.estado_facturacion || 'a_facturar';
    const panel = $('sopArmExpedientePanel');
    panel.innerHTML = `<div class="sop-panel-body"><div class="sop-empty"><i data-lucide="loader"></i></div></div>`;
    const res = await apiFetch(`/api/soportes/armado/dias/${id}/contenedores`);
    const data = await res.json();
    if (!res.ok) { sopToast(data.error || 'Error', 'error'); return; }
    armState.diaModo = data.modo || armState.diaModo;
    if (data.modo === 'anexo_fidu') {
      renderAnexoDiaPanel(diaRow, data.anexo);
      return;
    }
    if (data.modo === 'ucqn' && data.ucqn_expediente_id) {
      armState.contenedorId = data.contenedores?.[0]?.id || null;
      armState.contenedorTipo = 'soportes';
      await abrirExpedienteArmado(data.ucqn_expediente_id);
      return;
    }
    panel.innerHTML = `<div class="sop-panel-head">
        <div>
          <h3 style="margin:0"><i data-lucide="folder-open"></i> ${escapeHtml(armState.diaLabel)}</h3>
          <div style="margin-top:6px">${badgeFacturacionArmado(armState.diaFacturacion)}</div>
        </div>
        <div class="sop-panel-head-tools" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          ${htmlArmZipDiaBtn(diaRow, { labeled: true, variant: 'teal' })}
          <button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" id="btnSopArmVolverMes"><i data-lucide="arrow-left"></i> ${escapeHtml(armLabelVolverDesdeDia())}</button>
        </div>
      </div>
      <div class="sop-panel-body">
        <div id="sopArmContenedoresGrid" class="sop-folder-explorer-grid sop-folder-explorer-grid--2"></div>
      </div>`;
    panel.querySelector('#btnSopArmVolverMes')?.addEventListener('click', armVolverDesdeDia);
    bindArmMigrarRipsButtons(panel);
    bindArmZipButtons(panel);
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

  function bindArmadoFeCardEvents(root) {
    if (!root) return;
    root.querySelectorAll('[data-exp-id]').forEach((card) => {
      const open = () => abrirExpedienteArmado(parseInt(card.dataset.expId, 10));
      card.addEventListener('click', (ev) => {
        if (ev.target.closest('.sop-folder-card-actions, .sop-folder-list-actions')) return;
        open();
      });
      card.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') open(); });
    });
    root.querySelectorAll('[data-exp-open]').forEach((b) => {
      b.addEventListener('click', (ev) => { ev.stopPropagation(); abrirExpedienteArmado(parseInt(b.dataset.expOpen, 10)); });
    });
    root.querySelectorAll('[data-exp-edit]').forEach((b) => {
      b.addEventListener('click', (ev) => { ev.stopPropagation(); modalEditarExpediente(parseInt(b.dataset.expEdit, 10)); });
    });
    root.querySelectorAll('[data-exp-del]').forEach((b) => {
      b.addEventListener('click', (ev) => { ev.stopPropagation(); modalEliminarExpediente(parseInt(b.dataset.expDel, 10), b.dataset.expCodigo); });
    });
  }

  function renderArmadoExpedientesGrid(list) {
    const panel = $('sopArmExpedientePanel');
    const grid = panel?.querySelector('#sopArmExpedientesGrid');
    if (!grid) return;
    const sorted = ordenarExpedientesFeArmado(list);
    const viewMode = sopFolderViewMode('arm');
    grid.classList.toggle('sop-folder-list-mode', viewMode === 'list');
    if (!sorted.length) {
      grid.innerHTML = '<div class="sop-empty" style="grid-column:1/-1;padding:28px">Sin carpetas FE — use «Nuevas carpetas»</div>';
      return;
    }
    const puedeEditar = sopPerm('soportes.armado.subir');
    const puedeEliminar = sopPerm('soportes.armado.crear_estructura');
    const facturaCell = (e) => {
      const factura = (e.numero_factura != null && Number(e.numero_factura) > 0) ? `FE${e.numero_factura}` : null;
      return factura ? escapeHtml(factura) : '<span class="sop-badge sop-badge-pendiente" style="margin:0">Pendiente FEV</span>';
    };
    if (viewMode === 'list') {
      grid.innerHTML = `<div class="sop-table-wrap"><table class="sop-table sop-folder-list-table">
        <thead><tr><th>Código FE</th><th>Paciente</th><th>Factura</th><th>Documentos</th><th class="sop-folder-list-actions">Acciones</th></tr></thead>
        <tbody>${sorted.map((e) => `<tr class="${e.documentos_completos ? 'sop-fe-list-row--listo' : ''}" data-exp-id="${e.id}" tabindex="0">
          <td><strong>${escapeHtml(e.codigo)}</strong></td>
          <td>${escapeHtml(e.paciente_nombre || 'Sin paciente')}</td>
          <td>${facturaCell(e)}</td>
          <td>${htmlFeExpedienteProgressMini(e)} ${badgeEstadoFe(e.documentos_completos)}</td>
          <td class="sop-folder-list-actions">
            <button type="button" class="sop-btn sop-btn-teal sop-btn-sm" data-exp-open="${e.id}"><i data-lucide="folder-open"></i></button>
            ${puedeEditar ? `<button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-exp-edit="${e.id}" title="Renombrar carpeta"><i data-lucide="pencil"></i></button>` : ''}
            ${puedeEliminar ? `<button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-exp-del="${e.id}" data-exp-codigo="${escapeHtml(e.codigo)}" style="color:#dc2626"><i data-lucide="trash-2"></i></button>` : ''}
          </td>
        </tr>`).join('')}</tbody></table></div>`;
    } else {
      grid.innerHTML = sorted.map((e) => `<article class="sop-folder-card sop-folder-card--fe${e.documentos_completos ? ' sop-folder-card--fe-listo' : ''}" data-exp-id="${e.id}" tabindex="0">
          <div class="sop-folder-card-icon"><i data-lucide="folder${e.documentos_completos ? '-check' : ''}"></i></div>
          <div class="sop-folder-card-title">${escapeHtml(e.codigo)}</div>
          <div class="sop-folder-card-meta">${escapeHtml(e.paciente_nombre || 'Sin paciente')}</div>
          ${htmlFeExpedienteProgressMini(e)}
          <div class="sop-folder-card-count">${facturaCell(e)}</div>
          <div class="sop-folder-card-actions">
            <button type="button" class="sop-btn sop-btn-teal sop-btn-sm" data-exp-open="${e.id}"><i data-lucide="folder-open"></i> Abrir</button>
            ${puedeEditar ? `<button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-exp-edit="${e.id}" title="Renombrar carpeta"><i data-lucide="pencil"></i></button>` : ''}
            ${puedeEliminar ? `<button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-exp-del="${e.id}" data-exp-codigo="${escapeHtml(e.codigo)}" style="color:#dc2626"><i data-lucide="trash-2"></i></button>` : ''}
          </div>
        </article>`).join('');
    }
    bindArmadoFeCardEvents(grid);
    sopIcons(grid);
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
    const viewMode = sopFolderViewMode('arm');
    panel.innerHTML = `<div class="sop-panel-head">
        <div>
          <h3 style="margin:0"><i data-lucide="folder-tree"></i> ${escapeHtml(tipoLabel)}</h3>
          <p style="margin:4px 0 0;font-size:.85rem;color:#64748b">${escapeHtml(armState.diaLabel || '')}</p>
        </div>
        <div class="sop-panel-head-tools">
          ${htmlSopFolderViewToggle('arm')}
          ${armState.contenedorTipo === 'soportes' && sopPerm('soportes.armado.crear_estructura') ? htmlArmMigrarRipsContenedorBtn(armState.contenedorId, { labeled: true, variant: 'teal' }) : ''}
          <button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" id="btnSopArmVolverDia"><i data-lucide="arrow-left"></i> ${escapeHtml(armState.diaLabel || 'Carpeta')}</button>
          ${sopPerm('soportes.armado.crear_estructura') ? `<button type="button" class="sop-btn sop-btn-teal sop-btn-sm" id="btnSopArmNuevoFe"><i data-lucide="folder-plus"></i> Nuevas carpetas</button>` : ''}
        </div>
      </div>
      <div class="sop-panel-body">
        <div id="sopArmContenedorSummary"></div>
        <div id="sopArmExpedientesGrid" class="sop-folder-explorer-grid${viewMode === 'list' ? ' sop-folder-list-mode' : ''}"><div class="sop-skeleton-block sop-skeleton-folder-card"></div></div>
      </div>`;
    bindSopFolderViewToggle(panel, 'arm');
    bindArmMigrarRipsButtons(panel);
    const gridSk = panel.querySelector('#sopArmExpedientesGrid');
    if (gridSk) gridSk.innerHTML = '<div class="sop-skeleton-block sop-skeleton-folder-card"></div><div class="sop-skeleton-block sop-skeleton-folder-card"></div>';
    const res = await apiFetch(`/api/soportes/armado/contenedores/${id}/expedientes`);
    const data = await res.json();
    const list = ordenarExpedientesFeArmado(data.expedientes || []);
    armState.expedientesLista = list;
    const summary = panel.querySelector('#sopArmContenedorSummary');
    if (summary) {
      summary.innerHTML = htmlArmadoSummaryChips(resumenExpedientesLista(list));
      sopIcons(summary);
    }
    renderArmadoExpedientesGrid(list);
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
    const anexarBtn = (key === 'CRC' || key === 'OPF') && canEdit
      ? `<button type="button" class="sop-btn sop-btn-ghost sop-btn-sm sop-slot-anexar" data-slot-anexar="${key}" title="Añadir un PDF al ${key} cargado"><i data-lucide="layers"></i></button>`
      : '';
    return `<div class="sop-slot-actions">
      <button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-slot-ver="${key}" title="Ver en el navegador"><i data-lucide="eye"></i></button>
      ${canEdit ? `<button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-slot-pagina="${key}" title="Editar PDF (resaltar, añadir páginas)"><i data-lucide="external-link"></i></button>
      <button type="button" class="sop-btn sop-btn-ghost sop-btn-sm sop-slot-del" data-slot-del="${key}" title="Eliminar"><i data-lucide="trash-2"></i></button>
      <label class="sop-btn sop-btn-ghost sop-btn-sm" style="cursor:pointer" title="Reemplazar"><i data-lucide="refresh-cw"></i>
        <input type="file" data-replace-slot="${key}" class="sop-file-input-hidden" accept="${accept}"></label>
      ${anexarBtn}` : ''}
    </div>`;
  }

  function htmlFeSlotCard(key, slot, opts = {}) {
    const ok = slot.completo;
    const dis = slot.habilitado === false;
    const conFactura = !!opts.conFactura;
    const numFe = opts.numeroFactura > 0 ? Number(opts.numeroFactura) : 0;
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
    const feHint = conFactura && numFe && ['OPF', 'CRC', 'PDX', 'HEV'].includes(key)
      ? `<p class="sop-pdx-format-nota" style="margin:8px 0 0;font-size:.78rem">Vinculado a <strong>FE${numFe}</strong>: el archivo se guardará con esa etiqueta.</p>`
      : '';
    const opfHint = key === 'OPF' && !ok && !dis
      ? `<p class="sop-pdx-format-nota" style="margin:8px 0 0;font-size:.78rem">Use <strong>Armar OPF</strong> para elegir <strong>2 o más PDF</strong> y definir el orden de unión. También puede subir el OPF ya listo en un solo archivo.${conFactura ? '' : ' Sin factura: se renombra al subir FEV o al indicar el número FE en <strong>Renombrar carpeta</strong>.'}</p>`
      : '';
    const crcHint = key === 'CRC' && !ok && !dis
      ? `<p class="sop-pdx-format-nota" style="margin:8px 0 0;font-size:.78rem">En <strong>Unir PDFs</strong> seleccione <strong>2 a 4</strong> archivos y ordénelos antes de guardar el CRC.${conFactura ? '' : ' Sin factura vinculada, el nombre llevará el paciente hasta subir FEV.'}</p>`
      : '';
    const pdxHevHint = (key === 'PDX' || key === 'HEV') && !ok && !dis && !conFactura
      ? '<p class="sop-pdx-format-nota" style="margin:8px 0 0;font-size:.78rem">Sin factura: el archivo se guarda con el nombre del paciente; pasa a FE al subir FEV.</p>'
      : '';
    const allowUpload = opts.upload && !dis && !(ok && slot.archivo_id) && key !== 'OPF';
    return `<div class="sop-slot-card ${ok ? 'ok' : ''} ${dis ? 'disabled' : ''}" data-slot="${key}">
      <div class="sop-slot-head">
        <span class="sop-slot-label"><i data-lucide="${icons[key] || 'file'}"></i> ${labels[key] || key}</span>
        <span class="sop-slot-status"></span>
      </div>
      ${sub}
      ${htmlSlotArchivoActions(opts.expId, key, slot, opts)}
      ${opfHint}
      ${crcHint}
      ${pdxHevHint}
      ${feHint}
      ${allowUpload ? `<label class="sop-btn sop-btn-ghost sop-btn-sm" style="margin-top:8px;cursor:pointer">
        <i data-lucide="upload"></i> Subir<input type="file" data-upload-slot="${key}" class="sop-file-input-hidden" accept="${opts.accept || ''}"></label>` : ''}
      ${key === 'OPF' && !dis && !ok && sopPerm('soportes.armado.subir') ? '<button type="button" class="sop-btn sop-btn-primary sop-btn-sm" id="btnSopGenerarOpf" style="margin-top:8px"><i data-lucide="layers"></i> Armar OPF</button>' : ''}
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
    panel.querySelectorAll('.sop-slot-anexar').forEach((btn) => {
      btn.addEventListener('click', () => {
        modalAnexarPdfSlot(expId, btn.dataset.slotAnexar || 'CRC');
      });
    });
    panel.querySelectorAll('[data-slot-ver]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tipo = btn.dataset.slotVer;
        abrirPdfEnNavegador(
          `/api/soportes/armado/expedientes/${expId}/archivos/${encodeURIComponent(tipo)}/descargar?inline=1`
        );
      });
    });
    panel.querySelectorAll('[data-slot-pagina]').forEach((btn) => {
      btn.addEventListener('click', () => abrirPdfSlotArmado(expId, btn.dataset.slotPagina));
    });
  }

  function abrirPdfSlotArmado(expId, tipo) {
    const det = armState.expedienteDetalle || {};
    const slot = det.slots?.[tipo] || {};
    const titulo = `${armState.expedienteCodigo || 'Expediente'} — ${tipo}`;
    const sub = slot.nombre_archivo || slot.nombre_original || '';
    abrirVisorPdfEnPagina({
      fuente: 'armado',
      expId,
      tipo,
      titulo: sub ? `${titulo}: ${sub}` : titulo,
      edit: puedeResaltarArmado()
    });
  }

  function detectarParteCrcTipoCliente(name) {
    const n = String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (/\bcomprobante/.test(n) || /^comprobante[\s._-]/.test(n)) return 'comprobante';
    if (/\bcotizaci[oó]n/.test(n) || /\bcotiz\b/.test(n)) return 'cotizacion';
    if (/\bconsentimiento/.test(n) || /\bconsent\b/.test(n)) return 'consentimiento';
    if (/\bcertificado/.test(n) || /\bcertific\b/.test(n)) return 'certificado';
    return null;
  }

  function previewOrdenCrcArchivos(fileList) {
    const expectedSets = {
      2: ['comprobante', 'certificado'],
      3: ['comprobante', 'consentimiento', 'certificado'],
      4: ['comprobante', 'cotizacion', 'consentimiento', 'certificado']
    };
    const labels = { comprobante: 'Comprobante', cotizacion: 'Cotización', consentimiento: 'Consentimiento', certificado: 'Certificado' };
    const n = fileList.length;
    const expected = expectedSets[n];
    if (!expected) return { ok: false, error: 'Seleccione 2, 3 o 4 PDF.' };
    const asignados = new Map();
    const sinTipo = [];
    for (const f of fileList) {
      const t = detectarParteCrcTipoCliente(f.name);
      if (t && !asignados.has(t)) asignados.set(t, f);
      else if (!t) sinTipo.push(f);
      else return { ok: false, error: `Hay más de un «${labels[t]}».` };
    }
    for (const tipo of expected) {
      if (!asignados.has(tipo) && sinTipo.length) {
        asignados.set(tipo, sinTipo.shift());
      }
    }
    if ([...asignados.keys()].some((t) => !expected.includes(t))) {
      return { ok: false, error: `Con ${n} PDF no corresponde ese tipo de documento.` };
    }
    const faltantes = expected.filter((t) => !asignados.has(t));
    if (faltantes.length) {
      return { ok: false, error: `Falta: ${faltantes.map((t) => labels[t]).join(', ')}.` };
    }
    return {
      ok: true,
      orden: expected.map((t) => labels[t]),
      files: expected.map((t) => asignados.get(t))
    };
  }

  function modalAnexarPdfSlot(expId, tipo) {
    const t = String(tipo || '').toUpperCase();
    const modal = openSopModal(`
      <h3><i data-lucide="layers" style="vertical-align:-3px;width:22px"></i> Añadir PDF a ${escapeHtml(t)}</h3>
      <p class="sop-dialog-lead">Seleccione <strong>un PDF</strong>. Se añadirá al final del ${escapeHtml(t)} que ya tiene este expediente (no reemplaza el archivo).</p>
      <div class="sop-field">
        <label>PDF a añadir</label>
        <input type="file" id="sopAnexarPdfFile" accept=".pdf,application/pdf" class="sop-file-input-visible">
        <div id="sopAnexarPdfNombre" class="sop-search-results-meta" style="margin-top:8px"></div>
      </div>
      <div class="sop-dialog-actions">
        <button type="button" class="sop-btn sop-btn-ghost" id="sopAnexarPdfCancel">Cancelar</button>
        <button type="button" class="sop-btn sop-btn-primary" id="sopAnexarPdfOk" disabled>Añadir al ${escapeHtml(t)}</button>
      </div>`);
    const input = modal.querySelector('#sopAnexarPdfFile');
    const nombreEl = modal.querySelector('#sopAnexarPdfNombre');
    const btnOk = modal.querySelector('#sopAnexarPdfOk');
    let file = null;

    input?.addEventListener('change', () => {
      file = input.files?.[0] || null;
      if (nombreEl) nombreEl.textContent = file ? file.name : '';
      if (btnOk) btnOk.disabled = !file;
    });

    modal.querySelector('#sopAnexarPdfCancel').onclick = () => closeSopModal(modal);
    btnOk.onclick = async () => {
      if (!file) return;
      btnOk.disabled = true;
      btnOk.textContent = 'Añadiendo…';
      const fd = new FormData();
      fd.append('partes', file);
      try {
        const res = await subirFormDataConProgreso(
          `/api/soportes/armado/expedientes/${expId}/archivos/${encodeURIComponent(t)}/anexar-pdf`,
          fd,
          { title: 'Soportes', fileName: file.name }
        );
        const data = res.data || {};
        if (!res.ok || !data.ok) {
          const msg = data.error || `No se pudo añadir al ${t}`;
          sopUploadFinish({ state: 'error', message: msg });
          sopToast(msg, 'error');
          btnOk.disabled = false;
          btnOk.textContent = `Añadir al ${t}`;
          return;
        }
        closeSopModal(modal);
        sopToast(data.message || `PDF añadido al ${t}`, 'success');
        abrirExpedienteArmado(expId);
      } catch (e) {
        sopToast(e.message || 'Error de conexión', 'error');
        btnOk.disabled = false;
        btnOk.textContent = `Añadir al ${t}`;
      }
    };
    sopIcons(modal);
  }

  function modalUnirPdfSlot(expId, tipo, expInfo, { reemplazar = false } = {}) {
    const ejemplo = expInfo?.ejemplos_nombre?.[tipo] || `${tipo}_{NIT}.pdf`;
    const titulo = reemplazar ? `Reemplazar ${tipo} (unir PDFs)` : `Unir PDFs — ${tipo}`;
    const modal = openSopModal(`
      <h3><i data-lucide="layers" style="vertical-align:-3px;width:22px"></i> ${escapeHtml(titulo)}</h3>
      <p style="font-size:.85rem;color:#64748b;margin:-8px 0 12px">Seleccione <strong>2, 3 o 4</strong> PDF y ordénelos con las flechas antes de guardar.</p>
      <p class="sop-pdx-format-nota" style="margin-bottom:12px">Nombre: <code>${escapeHtml(ejemplo)}</code></p>
      <div class="sop-field">
        <label>Archivos PDF</label>
        <input type="file" id="sopUnirPdfFiles" accept=".pdf,application/pdf" multiple class="sop-file-input-visible">
      </div>
      <div class="sop-opf-progress" style="margin:12px 0">
        <div class="sop-opf-progress-head">
          <span class="sop-opf-progress-title">Orden de unión</span>
        </div>
        <ul class="sop-opf-partes-list" id="sopUnirPdfList"></ul>
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
        listEl.innerHTML = '<li class="sop-empty" style="padding:10px;font-size:.82rem;border:none">Seleccione los PDF arriba.</li>';
        btnOk.disabled = true;
        return;
      }
      if (files.length < 2 || files.length > 4) {
        listEl.innerHTML = `<li class="sop-empty" style="padding:10px;font-size:.82rem;border:none;color:#b45309">Seleccione entre 2 y 4 PDF.</li>`;
        btnOk.disabled = true;
        return;
      }
      listEl.innerHTML = files.map((f, i) => htmlItemOrdenPdf(i, files.length, f.name)).join('');
      bindReordenLista(listEl, files, refreshList);
      sopIcons(listEl);
      btnOk.disabled = false;
    }

    input?.addEventListener('change', () => {
      files = Array.from(input.files || []);
      refreshList();
    });

    modal.querySelector('#sopUnirPdfCancel').onclick = () => closeSopModal(modal);
    btnOk.onclick = async () => {
      if (files.length < 2 || files.length > 4) return;
      btnOk.disabled = true;
      btnOk.textContent = 'Uniendo…';
      const fd = new FormData();
      files.forEach((f) => fd.append('partes', f));
      fd.append('orden_manual', '1');
      if (reemplazar) fd.append('reemplazar', '1');
      try {
        const res = await subirFormDataConProgreso(
          `/api/soportes/armado/expedientes/${expId}/unir-pdf/${tipo}`,
          fd,
          { title: 'Soportes', fileName: `Unir ${files.length} PDF → ${tipo}` }
        );
        const data = res.data || {};
        if (!res.ok) {
          const msg = data.error || `Error al unir ${tipo}`;
          sopUploadFinish({ state: 'error', message: msg });
          sopToast(msg, 'error');
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
    refreshList();
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
    const uploadCtx = {
      title: 'Soportes',
      fileName: file.name,
      fileIndex: opts.fileIndex || 1,
      batchTotal: opts.batchTotal || 1,
      manageSession: opts.manageSession !== false && (opts.batchTotal || 1) === 1
    };
    let res;
    try {
      res = await subirFormDataConProgreso(
        `/api/soportes/armado/expedientes/${expId}/upload`,
        fd,
        uploadCtx
      );
    } catch (e) {
      sopToast(e.message || 'Error de conexión', 'error');
      return;
    }
    const data = res.data || {};
    if (!res.ok) {
      if (data.requiere_tipo) {
        sopUploadHidePanel();
        return modalElegirTipoArchivo(expId, file, data.nombre_original, { esRips, tipoServicio: opts.tipoServicio });
      }
      const msg = data.error || 'Error al subir';
      if (uploadCtx.manageSession) sopUploadFinish({ state: 'error', message: msg });
      sopToast(msg, 'error');
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

  function renderUcqnExpedientePanel(expId, e) {
    const panel = $('sopArmExpedientePanel');
    const pdfs = e.pdfs || [];
    const diaPersona = armDiaById(armState.diaId);
    const parent = diaPersona?.parent_id ? armDiaById(diaPersona.parent_id) : null;
    const volverCont = parent?.nombre_display || 'UCQN';
    panel.innerHTML = `<div class="sop-panel-head">
        <div>
          <h3 style="margin:0"><i data-lucide="user"></i> ${escapeHtml(e.paciente_nombre || e.codigo || 'Persona')}</h3>
          <div style="font-size:.85rem;color:#64748b;margin-top:4px">UCQN · ${pdfs.length} PDF</div>
        </div>
        <div class="sop-panel-head-tools" style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" id="btnSopUcqnVolver"><i data-lucide="arrow-left"></i> ${escapeHtml(volverCont)}</button>
        </div>
      </div>
      <div class="sop-panel-body">
        ${sopPerm('soportes.armado.subir') ? `<div id="sopUcqnDropzone" class="sop-dropzone sop-dropzone-compact" style="margin-bottom:16px">
          <div class="sop-dropzone-label"><i data-lucide="upload-cloud"></i> Subir PDF (varios permitidos)</div>
          <input type="file" id="sopUcqnUploadInput" class="sop-file-input-hidden" accept=".pdf,application/pdf" multiple>
        </div>` : ''}
        <div id="sopUcqnPdfList" class="sop-table-wrap">${pdfs.length ? `<table class="sop-table">
          <thead><tr><th>Archivo</th><th>Tamaño</th><th class="sop-folder-list-actions">Acciones</th></tr></thead>
          <tbody>${pdfs.map((p) => `<tr>
            <td>${escapeHtml(p.nombre_original || p.nombre_archivo)}</td>
            <td>${Math.round((p.tamano_bytes || 0) / 1024)} KB</td>
            <td class="sop-folder-list-actions">
              <button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-ucqn-ver="${p.id}"><i data-lucide="eye"></i></button>
              <button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-ucqn-dl="${p.id}"><i data-lucide="download"></i></button>
              ${sopPerm('soportes.armado.crear_estructura') ? `<button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" data-ucqn-del="${p.id}" style="color:#dc2626"><i data-lucide="trash-2"></i></button>` : ''}
            </td>
          </tr>`).join('')}</tbody></table>` : '<div class="sop-empty">Sin PDF — suba el primero</div>'}
        </div>
      </div>`;
    panel.querySelector('#btnSopUcqnVolver')?.addEventListener('click', armVolverDesdeDia);
    const dz = panel.querySelector('#sopUcqnDropzone');
    const inp = panel.querySelector('#sopUcqnUploadInput');
    if (dz && inp) {
      dz.addEventListener('click', () => inp.click());
      inp.addEventListener('change', async () => {
        const files = [...(inp.files || [])];
        inp.value = '';
        if (!files.length) return;
        sopUploadBegin({ title: 'Soportes', total: files.length });
        let ok = 0;
        let fail = 0;
        for (let i = 0; i < files.length; i++) {
          const f = files[i];
          const fd = new FormData();
          fd.append('file', f);
          try {
            const res = await subirFormDataConProgreso(
              `/api/soportes/armado/expedientes/${expId}/upload`,
              fd,
              { title: 'Soportes', fileName: f.name, fileIndex: i + 1, batchTotal: files.length, manageSession: false }
            );
            const data = res.data || {};
            if (!res.ok) {
              fail++;
              sopToast(data.error || `Error: ${f.name}`, 'error');
            } else ok++;
          } catch (e) {
            fail++;
            sopToast(e.message || `Error: ${f.name}`, 'error');
          }
        }
        sopUploadFinish({
          state: ok ? 'success' : 'error',
          message: ok
            ? `${ok} archivo(s) subido(s)${fail ? `, ${fail} con error` : ''}`
            : 'No se subió ningún archivo'
        });
        await abrirExpedienteArmado(expId);
      });
    }
    panel.querySelectorAll('[data-ucqn-ver]').forEach((b) => {
      b.addEventListener('click', () => abrirPdfEnNavegador(`/api/soportes/armado/expedientes/${expId}/pdfs/${parseInt(b.dataset.ucqnVer, 10)}/ver`));
    });
    panel.querySelectorAll('[data-ucqn-dl]').forEach((b) => {
      b.addEventListener('click', () => iniciarDescargaArchivoEnlace(`/api/soportes/armado/expedientes/${expId}/pdfs/${parseInt(b.dataset.ucqnDl, 10)}/descargar`));
    });
    panel.querySelectorAll('[data-ucqn-del]').forEach((b) => {
      b.addEventListener('click', async () => {
        if (!confirm('¿Eliminar este PDF?')) return;
        const res = await apiFetch(`/api/soportes/armado/expedientes/${expId}/pdfs/${parseInt(b.dataset.ucqnDel, 10)}`, { method: 'DELETE' });
        if (!res.ok) { const d = await res.json(); sopToast(d.error, 'error'); return; }
        await abrirExpedienteArmado(expId);
      });
    });
    sopIcons(panel);
    renderArmadoContextBar();
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
    if (e.modo === 'ucqn' || armState.diaModo === 'ucqn') {
      renderUcqnExpedientePanel(id, e);
      return;
    }
    const tipoLabel = labelContenedorArmado(armState.contenedorTipo);
    const esRips = e.contenedor_tipo === 'rips';
    const nit = e.nit_obligado || '—';
    const slots = e.slots || {};

    let slotsHtml = '';
    const acceptRips = '.json,.xml,application/json,text/xml,application/xml';
    const acceptPdf = '.pdf,application/pdf';
    const slotOpts = { upload: true, accept: acceptRips, expId: id, conFactura: Number(e.numero_factura) > 0, numeroFactura: e.numero_factura };
    if (esRips) {
      slotsHtml = htmlFeSlotCard('RIPS_JSON_1', slots.RIPS_JSON_1 || {}, slotOpts)
        + htmlFeSlotCard('RIPS_JSON_2', slots.RIPS_JSON_2 || {}, slotOpts)
        + htmlFeSlotCard('RIPS_XML', slots.RIPS_XML || {}, slotOpts);
    } else {
      const showPdx = slots.PDX?.habilitado !== false;
      const showHev = slots.HEV?.habilitado !== false;
      const pdfOpts = { upload: true, accept: acceptPdf, expId: id, conFactura: Number(e.numero_factura) > 0, numeroFactura: e.numero_factura };
      slotsHtml = htmlFeSlotCard('OPF', slots.OPF || {}, { ...pdfOpts, upload: false })
        + htmlFeSlotCard('CRC', slots.CRC || {}, pdfOpts)
        + htmlFeSlotCard('FEV', slots.FEV || {}, pdfOpts)
        + (showPdx ? htmlFeSlotCard('PDX', slots.PDX || {}, pdfOpts) : '')
        + (showHev ? htmlFeSlotCard('HEV', slots.HEV || {}, pdfOpts) : '');
    }
    const vinculos = e.vinculos || [];
    const vinculosHtml = vinculos.length ? `<div class="sop-vinculos-block" style="margin-top:18px">
      <div class="sop-pdx-format-title"><i data-lucide="link-2"></i> Enlaces desde reportes</div>
      <ul class="sop-vinculos-list">${vinculos.map((v) =>
        `<li><span class="sop-badge sop-badge-pendiente" style="margin:0">${escapeHtml(v.rol === 'orden_hc' ? 'ORDEN+HC' : v.rol)}</span>
          ${escapeHtml(v.paciente_nombre || v.nombre_archivo_original || '')}
          <span style="font-size:.78rem;color:#64748b">${escapeHtml(v.fecha_estudio || '')}</span></li>`
      ).join('')}</ul>
      ${vinculos.some((v) => v.rol === 'orden_hc') && !slots.OPF?.completo ? '<p class="sop-pdx-format-nota">Tiene ORDEN+HC vinculado: en «Armar OPF» añada la autorización (u otro PDF) hasta completar 2 archivos.</p>' : ''}
    </div>` : '';

    panel.innerHTML = `
      <div class="sop-panel-head">
        <div>
          <h3 style="margin:0"><i data-lucide="folder"></i> ${escapeHtml(e.codigo)}</h3>
          <div style="font-size:.85rem;color:#64748b;margin-top:4px">${escapeHtml(tipoLabel)} · NIT ${escapeHtml(nit)}${e.paciente_nombre ? ` · ${escapeHtml(e.paciente_nombre)}` : ''}${e.numero_factura != null && Number(e.numero_factura) > 0 ? ` · FE${e.numero_factura}` : ' · sin factura'}</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" id="btnSopArmVolverCont"><i data-lucide="arrow-left"></i> ${escapeHtml(tipoLabel)}</button>
        ${sopPerm('soportes.armado.subir') ? `<button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" id="btnSopExpEditar"><i data-lucide="pencil"></i> Renombrar</button>` : ''}
        ${sopPerm('soportes.armado.crear_estructura') ? `<button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" id="btnSopExpEliminar" style="color:#dc2626"><i data-lucide="trash-2"></i> Eliminar</button>` : ''}
        ${htmlArmZipBtn({
          apiPath: `/api/soportes/armado/expedientes/${id}/zip`,
          fallbackName: `${e.codigo || 'expediente'}.zip`,
          title: `Descargar ZIP del expediente ${e.codigo || ''}`,
          icon: 'archive',
          label: ' ZIP',
          variant: 'teal'
        })}
        </div>
      </div>
      <div class="sop-panel-body">
        ${!esRips && !(e.numero_factura != null && Number(e.numero_factura) > 0) ? `<div class="sop-pdx-format-help" style="margin-bottom:14px;border-color:#93c5fd;background:#eff6ff">
          <div class="sop-pdx-format-title"><i data-lucide="receipt"></i> Sin factura vinculada</div>
          <p class="sop-pdx-format-nota" style="margin:0">Los soportes se guardan con el nombre del paciente. Use <strong>Renombrar</strong> e indique el número FE <em>antes</em> de subirlos si ya lo conoce, o vincúlelo al subir la FEV.</p>
        </div>` : ''}
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
        const slot = ev.target.dataset.uploadSlot;
        const f = ev.target.files?.[0];
        ev.target.value = '';
        if (!f) return;
        await subirArchivoFeSmart(id, f, slot, { esRips, tipoServicio: e.tipo_servicio });
      });
    });
    const openImportDep = (filtro) => modalImportDepositoEnExpediente(id, filtro);
    panel.querySelector('#btnSopImportPdx')?.addEventListener('click', () => openImportDep('PDX'));
    panel.querySelector('#btnSopImportCrc')?.addEventListener('click', () => openImportDep('CRC'));
    panel.querySelector('#btnSopUnirCrc')?.addEventListener('click', () => modalUnirPdfSlot(id, 'CRC', e, { reemplazar: false }));
    panel.querySelector('#btnSopGenerarOpf')?.addEventListener('click', () => modalGenerarOpf(id, e));
    bindSlotArchivoActions(panel, id, { esRips, tipoServicio: e.tipo_servicio });
    sopIcons(panel);
    bindArmZipButtons(panel);
    renderArmadoContextBar();
  }

  function modalGenerarOpf(expId, expInfo) {
    const OPF_MIN_PARTES = 2;
    /** @type {{ tipo: 'pdx'|'file', pdxId?: number, file?: File, titulo: string, meta?: string }[]} */
    const partes = [];
    let opfUnidoFile = null;
    let searchTimer = null;
    let modoUnirActivo = true;

    const opfEjemplo = expInfo?.ejemplos_nombre?.OPF || 'OPF_{NIT}_{código}.pdf';
    const sinFactura = expInfo?.tiene_factura === false;

    (expInfo?.vinculos || []).forEach((v) => {
      if (v.rol !== 'orden_hc' || !v.pdx_archivo_id) return;
      if (partes.some((p) => p.tipo === 'pdx' && p.pdxId === v.pdx_archivo_id)) return;
      partes.push({
        tipo: 'pdx',
        pdxId: v.pdx_archivo_id,
        titulo: v.paciente_nombre || v.nombre_archivo_original || 'ORDEN+HC',
        meta: `Depósito · ${v.fecha_estudio || ''} · vinculado`
      });
    });

    const modal = openSopModal(`
      <h3><i data-lucide="layers" style="vertical-align:-3px;width:22px"></i> Armar OPF</h3>
      <p style="font-size:.85rem;color:#64748b;margin:-8px 0 12px">Seleccione <strong>2 o más PDF</strong>, ordénelos con las flechas y guárdelos unidos. También puede usar el depósito o subir el <strong>OPF ya listo</strong> en un solo archivo.</p>
      <p class="sop-pdx-format-nota" style="margin-bottom:12px">Nombre provisional: <code>${escapeHtml(opfEjemplo)}</code>${sinFactura ? ' <span style="color:#b45309">(sin factura aún)</span>' : ''}.</p>
      <details class="sop-opf-unido-details" style="margin-bottom:14px">
        <summary style="cursor:pointer;font-weight:600;font-size:.85rem;color:#475569">OPF ya unido (un solo PDF)</summary>
        <div class="sop-field" style="margin-top:10px">
          <input type="file" id="sopOpfUnidoFile" accept=".pdf,application/pdf" class="sop-file-input-visible">
          <div id="sopOpfUnidoName" class="sop-search-results-meta" style="margin-top:6px"></div>
        </div>
      </details>
      <div id="sopOpfUnirBlock">
        <div class="sop-opf-progress" id="sopOpfProgress">
          <div class="sop-opf-progress-head">
            <span class="sop-opf-progress-title">Archivos para unir</span>
            <span class="sop-opf-progress-badge pending" id="sopOpfBadge">0 / ${OPF_MIN_PARTES}</span>
          </div>
          <ul class="sop-opf-partes-list" id="sopOpfPartesList"></ul>
        </div>
        <div class="sop-field" style="margin-top:10px">
          <label>Añadir PDF desde el equipo (2 o más a la vez)</label>
          <input type="file" id="sopOpfManualFile" accept=".pdf,application/pdf" multiple class="sop-file-input-visible">
        </div>
        <div class="sop-opf-add-row">
          <button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" id="sopOpfBtnBuscar"><i data-lucide="search"></i> Desde depósito</button>
        </div>
        <div class="sop-opf-search-panel" id="sopOpfSearchPanel" style="display:none">
          <div class="sop-field" style="margin:0">
            <label>Buscar en reportes (PDX)</label>
            <div class="sop-search-wrap" style="max-width:none">
              <i data-lucide="search"></i>
              <input type="search" id="sopOpfDepBuscar" class="sop-search" placeholder="Paciente, documento o nombre de archivo…" autocomplete="off">
            </div>
          </div>
          <div id="sopOpfDepResults" class="sop-import-results" style="margin-top:8px;max-height:200px;overflow:auto">
            <div class="sop-empty" style="padding:12px;font-size:.82rem">Escriba al menos 2 caracteres</div>
          </div>
          <button type="button" class="sop-btn sop-btn-ghost sop-btn-sm" id="sopOpfCerrarBuscar" style="margin-top:8px">Ocultar búsqueda</button>
        </div>
      </div>
      <div class="sop-dialog-actions">
        <button type="button" class="sop-btn sop-btn-ghost" id="sopOpfCancel">Cancelar</button>
        <button type="button" class="sop-btn sop-btn-primary" id="sopOpfOk" disabled>Guardar OPF</button>
      </div>`);

    const btnOk = modal.querySelector('#sopOpfOk');
    const progressEl = modal.querySelector('#sopOpfProgress');
    const badgeEl = modal.querySelector('#sopOpfBadge');
    const listEl = modal.querySelector('#sopOpfPartesList');
    const searchPanel = modal.querySelector('#sopOpfSearchPanel');
    const resultsEl = modal.querySelector('#sopOpfDepResults');
    const inputSearch = modal.querySelector('#sopOpfDepBuscar');
    const unirBlock = modal.querySelector('#sopOpfUnirBlock');
    const unidoDetails = modal.querySelector('.sop-opf-unido-details');

    function refreshUi() {
      const n = partes.length;
      const listo = n >= OPF_MIN_PARTES;
      if (progressEl) progressEl.classList.toggle('is-ready', listo && modoUnirActivo);
      if (badgeEl) {
        badgeEl.textContent = listo ? 'Puede generar OPF' : `${n} / ${OPF_MIN_PARTES} archivos`;
        badgeEl.className = `sop-opf-progress-badge ${listo ? 'ready' : 'pending'}`;
      }
      if (listEl) {
        if (!n) {
          listEl.innerHTML = '<li class="sop-empty" style="padding:10px;font-size:.82rem;border:none">Añada ORDEN+HC, autorización u otros PDF en orden.</li>';
        } else {
          listEl.innerHTML = partes.map((p, i) => htmlItemOrdenPdf(
            i,
            partes.length,
            p.titulo,
            p.meta || (p.tipo === 'pdx' ? 'Depósito' : 'Desde equipo'),
            { quitarIdx: i }
          )).join('');
          bindReordenLista(listEl, partes, refreshUi);
          listEl.querySelectorAll('[data-orden-quitar]').forEach((b) => {
            b.addEventListener('click', () => {
              partes.splice(parseInt(b.dataset.ordenQuitar, 10), 1);
              refreshUi();
            });
          });
          sopIcons(listEl);
        }
      }
      if (modoUnirActivo) {
        btnOk.disabled = !listo;
        btnOk.textContent = listo ? 'Unir y guardar OPF' : 'Guardar OPF';
      }
    }

    function agregarPartePdx(r) {
      const id = r.archivo_id;
      if (partes.some((p) => p.tipo === 'pdx' && p.pdxId === id)) {
        sopToast('Ese archivo ya está en la lista', 'warning');
        return;
      }
      partes.push({
        tipo: 'pdx',
        pdxId: id,
        titulo: r.paciente_nombre || r.nombre_archivo_original || 'PDF',
        meta: `${r.carpeta_nombre || 'Depósito'} · ${r.periodo || ''}`
      });
      refreshUi();
      sopToast('Añadido a la lista', 'success');
    }

    function renderDepResults(list) {
      if (!list?.length) {
        resultsEl.innerHTML = '<div class="sop-empty" style="padding:12px;font-size:.82rem">Sin resultados</div>';
        return;
      }
      resultsEl.innerHTML = list.map((r) => `
        <div class="sop-import-item" data-add-pdx="${r.archivo_id}">
          <div>
            <strong>${escapeHtml(r.paciente_nombre)}</strong>
            <div class="sop-import-item-meta">${escapeHtml(r.fecha_estudio || '—')} · ${escapeHtml(r.estudio_texto || '—')}</div>
            <div class="sop-import-item-meta">${escapeHtml(r.carpeta_nombre || '')} (${escapeHtml(r.periodo || '')})</div>
            <div class="sop-import-item-meta" style="font-size:.75rem">${escapeHtml(r.nombre_archivo_original || '')}</div>
          </div>
          <i data-lucide="plus-circle" style="width:18px;height:18px;color:#0d9488;flex-shrink:0"></i>
        </div>`).join('');
      resultsEl.querySelectorAll('[data-add-pdx]').forEach((row) => {
        row.addEventListener('click', () => {
          const id = parseInt(row.dataset.addPdx, 10);
          const r = list.find((x) => x.archivo_id === id);
          if (r) agregarPartePdx(r);
        });
      });
      sopIcons(resultsEl);
    }

    async function runDepSearch() {
      const q = inputSearch.value.trim();
      if (q.length < 2) {
        resultsEl.innerHTML = '<div class="sop-empty" style="padding:12px;font-size:.82rem">Escriba al menos 2 caracteres</div>';
        return;
      }
      resultsEl.innerHTML = '<div class="sop-empty" style="padding:12px"><i data-lucide="loader"></i> Buscando…</div>';
      sopIcons(resultsEl);
      try {
        const res = await apiFetch(`/api/soportes/pdx/buscar?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        renderDepResults(data.resultados || []);
      } catch (err) {
        resultsEl.innerHTML = `<div class="sop-empty" style="padding:12px;color:#dc2626">${escapeHtml(err.message)}</div>`;
      }
    }

    modal.querySelector('#sopOpfBtnBuscar')?.addEventListener('click', () => {
      searchPanel.style.display = 'block';
      inputSearch?.focus();
    });
    modal.querySelector('#sopOpfCerrarBuscar')?.addEventListener('click', () => {
      searchPanel.style.display = 'none';
    });
    inputSearch?.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(runDepSearch, 320);
    });

    modal.querySelector('#sopOpfManualFile')?.addEventListener('change', (ev) => {
      const nuevos = Array.from(ev.target.files || []);
      ev.target.value = '';
      if (!nuevos.length) return;
      let añadidos = 0;
      nuevos.forEach((f) => {
        if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') return;
        partes.push({ tipo: 'file', file: f, titulo: f.name, meta: 'Desde equipo' });
        añadidos += 1;
      });
      if (!añadidos) {
        sopToast('Seleccione archivos PDF', 'warning');
        return;
      }
      refreshUi();
    });

    const opfUnidoInput = modal.querySelector('#sopOpfUnidoFile');
    const opfUnidoNameEl = modal.querySelector('#sopOpfUnidoName');
    opfUnidoInput?.addEventListener('change', () => {
      opfUnidoFile = opfUnidoInput.files?.[0] || null;
      if (opfUnidoNameEl) opfUnidoNameEl.textContent = opfUnidoFile ? opfUnidoFile.name : '';
      modoUnirActivo = !opfUnidoFile;
      if (unirBlock) unirBlock.style.opacity = opfUnidoFile ? '0.45' : '1';
      if (unirBlock) unirBlock.style.pointerEvents = opfUnidoFile ? 'none' : '';
      if (opfUnidoFile) {
        btnOk.disabled = false;
        btnOk.textContent = 'Guardar OPF unido';
      } else {
        refreshUi();
      }
    });

    modal.querySelector('#sopOpfCancel').onclick = () => closeSopModal(modal);
    btnOk.onclick = async () => {
      btnOk.disabled = true;
      const prevLabel = btnOk.textContent;
      btnOk.textContent = 'Guardando…';
      const fd = new FormData();
      try {
        if (opfUnidoFile) {
          fd.append('opf_unido', opfUnidoFile);
        } else {
          const spec = [];
          let fileIdx = 0;
          partes.forEach((p) => {
            if (p.tipo === 'pdx') spec.push({ t: 'pdx', id: p.pdxId });
            else {
              spec.push({ t: 'file', i: fileIdx });
              fd.append('parte_archivo', p.file);
              fileIdx += 1;
            }
          });
          fd.append('partes_json', JSON.stringify(spec));
        }
        const progLabel = opfUnidoFile ? opfUnidoFile.name : `Generar OPF (${partes.length} parte(s))`;
        const res = await subirFormDataConProgreso(
          `/api/soportes/armado/expedientes/${expId}/generar-opf`,
          fd,
          { title: 'Soportes', fileName: progLabel }
        );
        const data = res.data || {};
        if (!res.ok) {
          const msg = data.error || 'Error al generar OPF';
          sopUploadFinish({ state: 'error', message: msg });
          sopToast(msg, 'error');
          btnOk.disabled = false;
          btnOk.textContent = prevLabel;
          return;
        }
        if (data.warnings?.length) sopToast(data.warnings.join(' · '), 'warning');
        closeSopModal(modal);
        sopToast(data.message || 'OPF guardado', 'success');
        abrirExpedienteArmado(expId);
      } catch (e) {
        sopToast(e.message || 'Error de conexión', 'error');
        btnOk.disabled = false;
        btnOk.textContent = prevLabel;
      }
    };

    refreshUi();
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
      const numFe = Number(ex.numero_factura) > 0 ? Number(ex.numero_factura) : '';
      const modal = openSopModal(`
        <h3><i data-lucide="pencil"></i> Renombrar carpeta</h3>
        <p class="sop-dialog-lead">Carpeta actual: <strong>${escapeHtml(ex.codigo)}</strong>${ex.paciente_nombre ? ` · ${escapeHtml(ex.paciente_nombre)}` : ''}</p>
        <div class="sop-field"><label>Paciente (nombre y apellido)</label>
          <input type="text" id="sopExpEditPaciente" value="${escapeHtml(ex.paciente_nombre || ex.codigo || '')}" placeholder="Nombre Apellido" autocomplete="off"></div>
        <div class="sop-field"><label>Número de factura (FE)${pendiente ? ' <span class="sop-label-opt">(opcional)</span>' : ''}</label>
          <input type="number" id="sopExpEditFe" min="1" step="1" value="${numFe}" placeholder="Ej. 14726"></div>
        ${pendiente
          ? `<p class="sop-pdx-format-nota">Si ya conoce el número de factura, indíquelo aquí <strong>antes de subir soportes</strong>: la carpeta y los archivos existentes pasarán a <strong>FE{número}</strong> y los nuevos se guardarán con esa etiqueta. También puede vincularla al subir la FEV.</p>
          <p class="sop-pdx-format-nota">Si deja FE vacío, al guardar solo se actualiza el nombre del paciente en la carpeta.</p>`
          : `<p class="sop-pdx-format-nota">Si la FEV se subió con el número equivocado, corríjalo aquí. La carpeta y los archivos pasarán a <strong>FE{nuevo}</strong>.</p>
          <label class="sop-toggle" style="display:flex;align-items:flex-start;gap:8px;margin:10px 0 4px">
            <input type="checkbox" id="sopExpEditRevert" style="margin-top:3px">
            <span><strong>Quitar factura y volver al nombre del paciente</strong><br>
            <span style="font-size:.78rem;color:#64748b">Elimina la FEV, desvincula el número FE y renombra la carpeta (si la factura quedó en la carpeta incorrecta).</span></span>
          </label>`}
        <div class="sop-field"><label>Documento paciente <span class="sop-label-opt">(opcional)</span></label>
          <input type="text" id="sopExpEditDoc" value="${escapeHtml(ex.paciente_documento || '')}"></div>
        <div class="sop-field"><label>Notas</label>
          <textarea id="sopExpEditNotas" rows="3">${escapeHtml(ex.notas || '')}</textarea></div>
        <div class="sop-dialog-actions">
          <button type="button" class="sop-btn sop-btn-ghost" id="sopExpEditCancel">Cancelar</button>
          <button type="button" class="sop-btn sop-btn-teal" id="sopExpEditOk">Guardar cambios</button>
        </div>`);
      const feInput = modal.querySelector('#sopExpEditFe');
      const revertChk = modal.querySelector('#sopExpEditRevert');
      const syncFeRevert = () => {
        if (!feInput || !revertChk) return;
        feInput.disabled = revertChk.checked;
        if (revertChk.checked) feInput.style.opacity = '0.5';
        else feInput.style.opacity = '';
      };
      revertChk?.addEventListener('change', syncFeRevert);
      syncFeRevert();
      modal.querySelector('#sopExpEditCancel').onclick = () => closeSopModal(modal);
      modal.querySelector('#sopExpEditOk').onclick = async () => {
        const linea = modal.querySelector('#sopExpEditPaciente')?.value?.trim();
        if (!linea) return sopToast('Indique el nombre del paciente', 'warning');
        const body = {
          paciente_linea: linea,
          paciente_documento: modal.querySelector('#sopExpEditDoc')?.value?.trim() || null,
          notas: modal.querySelector('#sopExpEditNotas')?.value?.trim() || null
        };
        if (revertChk?.checked) {
          body.revertir_factura = true;
        } else {
          const feVal = modal.querySelector('#sopExpEditFe')?.value?.trim();
          if (feVal) body.numero_factura = parseInt(feVal, 10);
        }
        const res = await apiFetch(`/api/soportes/armado/expedientes/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const d = await res.json();
        if (!res.ok) { sopToast(d.error, 'error'); return; }
        closeSopModal(modal);
        let msg = 'Carpeta actualizada';
        if (d.renombrado?.codigo) {
          msg = body.revertir_factura
            ? `Factura desvinculada. Carpeta renombrada a ${d.renombrado.codigo}`
            : `Carpeta renombrada a ${d.renombrado.codigo}`;
        }
        sopToast(msg, 'success');
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
      const body = esLote ? { lista: lineas } : { paciente_linea: lineas[0] || texto };
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
    if (d?.es_contenedor && (d.hijos_count || 0) > 0) {
      sopToast('La carpeta contiene otras carpetas. Muévalas o elimínelas primero.', 'error');
      return;
    }
    const feCount = d?.expedientes_count || 0;
    const tipoLabel = d?.es_contenedor ? 'carpeta contenedora' : 'carpeta de día';
    const detalle = d?.es_contenedor
      ? 'Se eliminará la carpeta contenedora vacía.'
      : `Se eliminará con <strong>${feCount}</strong> expediente(s) FE, todos sus archivos en SOPORTES y RIPS.`;
    const modal = openSopModal(`
      <h3><i data-lucide="trash-2" style="color:#dc2626"></i> Eliminar ${tipoLabel}</h3>
      <p class="sop-dialog-lead">Se eliminará <strong>${escapeHtml(nombre || '')}</strong>. ${detalle} No se puede deshacer.</p>
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

  function modalNuevaContenedoraArmado() {
    if (!armState.periodoId) return sopToast('Seleccione un mes primero', 'warning');
    const parentId = armState.diasParentId || 0;
    if (!parentId) {
      return sopToast('En la raíz del mes solo existen Anexo FIDU, Facturas FIDU y U C Q N (automáticas). Entre en una para crear carpetas.', 'info');
    }
    const dentroDe = parentId ? armDiaById(parentId) : null;
    const perLabel = armState.periodoLabel || '';
    const modal = openSopModal(`
      <h3><i data-lucide="folder-tree"></i> Nueva carpeta contenedora</h3>
      ${dentroDe
        ? `<p style="font-size:.85rem;color:#64748b;margin:-6px 0 12px">Dentro de <strong>${escapeHtml(dentroDe.nombre_display)}</strong>. Agrupa otras carpetas de día.</p>`
        : `<p style="font-size:.85rem;color:#64748b;margin:-6px 0 12px">Dentro de <strong>${escapeHtml(perLabel)}</strong>. Agrupa carpetas de día.</p>`}
      <div class="sop-field"><label>Nombre</label>
        <input id="sopArmContNom" placeholder="Ej. Mayo 1era quincena, Electrodiagnóstico…"></div>
      <p style="font-size:.8rem;color:#64748b;margin:0">Puede arrastrar carpetas sobre un contenedor para reorganizarlas.</p>
      <div class="sop-dialog-actions">
        <button type="button" class="sop-btn sop-btn-ghost" id="sopArmContCancel">Cancelar</button>
        <button type="button" class="sop-btn sop-btn-teal" id="sopArmContOk">Crear contenedora</button>
      </div>`);
    modal.querySelector('#sopArmContCancel').onclick = () => closeSopModal(modal);
    modal.querySelector('#sopArmContOk').onclick = async () => {
      const nombre_display = $('sopArmContNom')?.value?.trim();
      if (!nombre_display) return sopToast('Indique el nombre', 'warning');
      const res = await apiFetch(`/api/soportes/armado/periodos/${armState.periodoId}/dias`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre_display, es_contenedor: true, parent_id: parentId })
      });
      const data = await res.json();
      if (!res.ok) { sopToast(data.error, 'error'); return; }
      closeSopModal(modal);
      sopToast('Carpeta contenedora creada', 'success');
      await seleccionarPeriodoArmado(armState.periodoId);
      if (data.dia?.id) navegarArmDiasExplorer(data.dia.id);
    };
  }

  function modalNuevoDiaArmado() {
    if (!armState.periodoId) return sopToast('Seleccione un mes primero', 'warning');
    const parentId = armState.diasParentId || 0;
    if (!parentId) return sopToast('Entre en Facturas FIDU, Anexo FIDU o U C Q N para crear carpetas', 'warning');
    const dentroDe = armDiaById(parentId);
    const modo = dentroDe?.modo || 'facturacion';
    const titulo = armLabelNuevaCarpetaModo(modo);
    const hint = modo === 'anexo_fidu'
      ? 'Se vinculará al módulo <strong>Anexo FIDU</strong> para editar filas y exportar Excel.'
      : modo === 'ucqn'
        ? 'Carpeta de persona para guardar varios PDF sin tipificación.'
        : 'Se crearán automáticamente las carpetas <strong>RIPS</strong> y <strong>SOPORTES</strong>.';
    const placeholder = modo === 'ucqn' ? 'Ej: Juan Pérez García' : modo === 'anexo_fidu' ? 'Ej: ANEXO 1 JUNIO' : 'Ej: MAYO 1, MAYO 2-3';
    const modal = openSopModal(`
      <h3><i data-lucide="folder-plus"></i> ${escapeHtml(titulo)}</h3>
      <p style="font-size:.85rem;color:#64748b;margin:-6px 0 12px">Dentro de <strong>${escapeHtml(dentroDe?.nombre_display || '')}</strong>. ${hint}</p>
      <div class="sop-field"><label>Nombre</label>
        <input id="sopArmDiaNom" placeholder="${escapeHtml(placeholder)}"></div>
      ${modo === 'facturacion' ? `<div class="sop-field"><label>Estado de facturación</label>
        <select id="sopArmDiaFact">
          <option value="a_facturar">A facturar</option>
          <option value="facturados">Facturados</option>
        </select></div>` : ''}
      <div class="sop-dialog-actions">
        <button type="button" class="sop-btn sop-btn-ghost" id="sopArmDiaCancel">Cancelar</button>
        <button type="button" class="sop-btn sop-btn-teal" id="sopArmDiaOk">Crear carpeta</button>
      </div>`);
    modal.querySelector('#sopArmDiaCancel').onclick = () => closeSopModal(modal);
    modal.querySelector('#sopArmDiaOk').onclick = async () => {
      const nombre_display = $('sopArmDiaNom').value.trim();
      const estado_facturacion = $('sopArmDiaFact')?.value || 'a_facturar';
      if (!nombre_display) return sopToast('Indique el nombre', 'warning');
      const res = await apiFetch(`/api/soportes/armado/periodos/${armState.periodoId}/dias`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre_display, estado_facturacion, parent_id: parentId })
      });
      const data = await res.json();
      if (!res.ok) { sopToast(data.error, 'error'); return; }
      closeSopModal(modal);
      sopToast(modo === 'ucqn' ? 'Persona creada' : modo === 'anexo_fidu' ? 'Anexo creado y vinculado' : 'Carpeta creada con RIPS y SOPORTES', 'success');
      const savedParent = armState.diasParentId;
      await seleccionarPeriodoArmado(armState.periodoId);
      armState.diasParentId = savedParent;
      if (data.dia?.id) seleccionarDiaArmado(data.dia.id);
      else {
        renderArmadoDiasExplorer();
        renderArmadoContextBar();
      }
    };
  }

  async function refrescarVistaArmadoActual() {
    const snap = {
      periodoId: armState.periodoId,
      diasParentId: armState.diasParentId,
      diaId: armState.diaId,
      contenedorId: armState.contenedorId,
      expedienteId: armState.expedienteId,
      vista: armState.vista
    };
    await cargarPeriodosArmado();
    renderPeriodosArmado();
    if (!snap.periodoId) return;
    const per = armState.periodos.find((p) => p.id === snap.periodoId);
    if (!per) return;
    armState.periodoId = snap.periodoId;
    armState.periodoLabel = per.etiqueta || per.periodo || 'Mes';
    const res = await apiFetch(`/api/soportes/armado/periodos/${snap.periodoId}/dias`);
    const data = await res.json();
    if (!res.ok) return;
    armState.dias = data.dias || [];
    armState.diasParentId = snap.diasParentId || 0;
    if (armState.diasParentId && !armDiaById(armState.diasParentId)) {
      armState.diasParentId = 0;
    }
    if (snap.vista === 'expediente' && snap.expedienteId) {
      armState.diaId = snap.diaId;
      armState.contenedorId = snap.contenedorId;
      await abrirExpedienteArmado(snap.expedienteId);
    } else if (snap.vista === 'contenedor' && snap.contenedorId && snap.diaId) {
      await seleccionarDiaArmado(snap.diaId);
      await seleccionarContenedorArmado(snap.contenedorId);
    } else if (snap.vista === 'day' && snap.diaId) {
      await seleccionarDiaArmado(snap.diaId);
    } else {
      renderArmadoPeriodoSummary();
      renderArmadoDiasExplorer();
      renderArmadoContextBar();
    }
  }

  window.initArmadoSoportes = function initArmadoSoportes() {
    sopIcons($('view-armado-soportes'));
    sopAnimateModuleIn('view-armado-soportes');
    if (initArmadoDone) {
      refrescarVistaArmadoActual().catch(console.error);
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
    $('btnSopArmRecuperarArchivos')?.addEventListener('click', () => {
      const expedienteId = armState?.expedienteId;
      const mensaje = expedienteId
        ? '¿Desea recuperar los archivos asociados a este expediente? La acción intentará restaurar rutas y nombres de archivo y actualizar los registros afectados.'
        : '¿Desea recuperar los archivos de SOPORTES? La acción intentará restaurar rutas y nombres de archivo y actualizar los registros afectados.';
      const confirmFn = typeof showConfirm === 'function' ? showConfirm : (typeof window.showConfirm === 'function' ? window.showConfirm : null);
      const ejecutar = async () => {
        const btn = $('btnSopArmRecuperarArchivos');
        if (btn) {
          btn.disabled = true;
          btn.innerHTML = '<i data-lucide="loader"></i> Recuperando…';
          sopIcons(btn);
        }
        try {
          const body = expedienteId ? { expedienteId } : undefined;
          const res = await apiFetch('/api/soportes/armado/recuperar-archivos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: body ? JSON.stringify(body) : undefined
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || 'No se pudo recuperar');
          sopToast(data.message || 'Recuperación completada', 'success');
        } catch (error) {
          sopToast(error.message || 'No se pudo completar la recuperación', 'error');
        } finally {
          if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i data-lucide="refresh-cw"></i> Recuperar archivos';
            sopIcons(btn);
          }
        }
      };

      if (confirmFn) {
        confirmFn(mensaje, ejecutar, { okText: 'Sí, recuperar', cancelText: 'Cancelar', danger: false, icon: '🔄' });
      } else if (window.confirm(mensaje)) {
        ejecutar();
      }
    });
    const canEstructura = sopPerm('soportes.armado.crear_estructura');
    const btnCont = $('btnSopArmNuevaContenedora');
    const btnDia = $('btnSopArmNuevoDia');
    if (btnCont) btnCont.style.display = 'none';
    if (btnDia) btnDia.style.display = canEstructura ? '' : 'none';
    $('btnSopArmNuevoDia')?.addEventListener('click', modalNuevoDiaArmado);
    $('sopArmBuscarPaciente')?.addEventListener('input', buscarArmadoPacientePredictivo);
    $('sopArmBuscarPaciente')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); buscarArmadoPaciente(); }
      if (e.key === 'Escape') cerrarResultadosArmado();
    });
    renderArmadoContextBar();
    cargarPeriodosArmado().then(renderPeriodosArmado).catch((e) => sopToast(e.message, 'error'));
  };

  window.refreshReportesPdx = refrescarVistaPdxActual;
  window.refreshArmadoSoportes = refrescarVistaArmadoActual;
})();
