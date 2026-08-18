/**
 * Enviar comprobante PDF generado a una carpeta de Cargar Reportes (PDX).
 * Solo carpetas de comprobantes (electro / consultas médicas).
 * Consultas médicas: pide ESPECIALIDAD y TIPO DE CONSULTA antes de subir
 * (nombre y documento ya vienen del comprobante).
 */
(function (root) {
  'use strict';

  const TEMAS_COMPROBANTE = new Set(['comprobantes', 'comprobantes_consulta_medica']);
  const LABEL_TEMA = {
    comprobantes: 'Comprobantes Electrodiagnóstico',
    comprobantes_consulta_medica: 'Comprobantes Consultas Médicas'
  };

  let _cacheEsp = null;
  let _cacheEstudios = null;
  const _cacheTipos = {};

  function esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function normNombre(s) {
    return String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

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

  async function cargarEspecialidades() {
    if (_cacheEsp) return _cacheEsp;
    if (typeof apiFetch !== 'function') return [];
    try {
      const res = await apiFetch('/api/especialidades');
      const data = res.ok ? await res.json() : [];
      _cacheEsp = (Array.isArray(data) ? data : [])
        .map((e) => (typeof e === 'string' ? { nombre: e } : e))
        .filter((e) => e?.nombre)
        .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es', { sensitivity: 'base' }));
      return _cacheEsp;
    } catch (_) {
      return [];
    }
  }

  async function cargarTiposConsulta(especialidad) {
    const esp = String(especialidad || '').trim();
    if (!esp) return [];
    if (_cacheTipos[esp]) return _cacheTipos[esp];
    if (typeof apiFetch !== 'function') return [];
    try {
      const res = await apiFetch(`/api/tipos-consulta?especialidad_nombre=${encodeURIComponent(esp)}`);
      const data = res.ok ? await res.json() : [];
      const lista = (Array.isArray(data) ? data : [])
        .map((e) => (typeof e === 'string' ? { nombre: e } : e))
        .filter((e) => e?.nombre);
      _cacheTipos[esp] = lista;
      return lista;
    } catch (_) {
      return [];
    }
  }

  async function cargarEstudiosElectro() {
    if (_cacheEstudios) return _cacheEstudios;
    if (typeof apiFetch !== 'function') return [];
    try {
      const res = await apiFetch('/api/certificados/catalogo-servicios?origen=electro');
      const data = res.ok ? await res.json() : {};
      _cacheEstudios = (data.servicios || [])
        .map((s) => String(s.nombre || '').trim())
        .filter(Boolean);
      return _cacheEstudios;
    } catch (_) {
      return [];
    }
  }

  /**
   * Modal electro: paciente (solo lectura) + tipo de estudio.
   */
  function pedirTipoEstudio(meta = {}) {
    return new Promise(async (resolve) => {
      const nombre = String(meta.paciente_nombre || '').trim() || '—';
      const doc = String(meta.paciente_documento || '').trim() || '—';
      const tipoDoc = String(meta.tipo_documento || 'CC').trim() || 'CC';
      const preEst = String(meta.servicio || meta.estudio_texto || '').trim();

      const backdrop = document.createElement('div');
      backdrop.className = 'confirm-backdrop';
      backdrop.style.zIndex = '10050';
      backdrop.innerHTML = `
        <div class="confirm-box" style="text-align:left;max-width:440px;width:92vw">
          <div class="confirm-icon" style="font-size:1.4rem">📋</div>
          <div class="confirm-msg" style="margin-bottom:12px;font-weight:600">Datos para Cargar Reportes</div>
          <p style="margin:0 0 12px;font-size:.85rem;color:#64748b;line-height:1.4">
            El comprobante ya tiene los datos del paciente. Indique el tipo de estudio.
          </p>
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;margin-bottom:14px;font-size:.88rem">
            <div><strong>Paciente:</strong> ${esc(nombre)}</div>
            <div style="margin-top:4px"><strong>Documento:</strong> ${esc(tipoDoc)} ${esc(doc)}</div>
          </div>
          <div style="margin-bottom:16px">
            <label for="cmpPdxEstudio" style="display:block;font-size:.8rem;font-weight:600;color:#475569;margin-bottom:4px">Tipo de estudio *</label>
            <select id="cmpPdxEstudio" style="width:100%;padding:8px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:.9rem">
              <option value="">Cargando…</option>
            </select>
          </div>
          <div id="cmpPdxEstErr" style="display:none;color:#b91c1c;font-size:.82rem;margin:-6px 0 10px"></div>
          <div class="confirm-actions">
            <button type="button" class="btn-cancel" id="cmpPdxEstCancel">Cancelar</button>
            <button type="button" class="btn-ok" id="cmpPdxEstOk" style="background:#0d9488">Enviar a la carpeta</button>
          </div>
        </div>`;
      document.body.appendChild(backdrop);

      const sel = backdrop.querySelector('#cmpPdxEstudio');
      const errEl = backdrop.querySelector('#cmpPdxEstErr');
      const cerrar = (val) => { backdrop.remove(); resolve(val); };
      const mostrarErr = (msg) => {
        if (!errEl) return;
        errEl.style.display = 'block';
        errEl.textContent = msg;
      };

      const estudios = await cargarEstudiosElectro();
      if (!estudios.length) {
        sel.innerHTML = '<option value="">No hay estudios en el catálogo</option>';
      } else {
        sel.innerHTML = '<option value="">Seleccionar tipo de estudio</option>'
          + estudios.map((n) => (
            `<option value="${esc(n)}"${n === preEst ? ' selected' : ''}>${esc(n)}</option>`
          )).join('');
      }

      backdrop.querySelector('#cmpPdxEstCancel')?.addEventListener('click', () => cerrar(null));
      backdrop.addEventListener('click', (e) => { if (e.target === backdrop) cerrar(null); });
      backdrop.querySelector('#cmpPdxEstOk')?.addEventListener('click', () => {
        const estudio = sel.value.trim();
        if (!estudio) {
          mostrarErr('Seleccione el tipo de estudio');
          sel.focus();
          return;
        }
        cerrar({ estudio_texto: estudio, servicio: estudio });
      });
    });
  }

  /**
   * Modal: datos del paciente (solo lectura) + especialidad + tipo de consulta.
   */
  function pedirEspecialidadYTipoConsulta(meta = {}) {
    return new Promise(async (resolve) => {
      const nombre = String(meta.paciente_nombre || '').trim() || '—';
      const doc = String(meta.paciente_documento || '').trim() || '—';
      const tipoDoc = String(meta.tipo_documento || 'CC').trim() || 'CC';
      const preEsp = String(meta.especialidad || '').trim();
      const preTipo = String(meta.tipo_consulta || '').trim();

      const backdrop = document.createElement('div');
      backdrop.className = 'confirm-backdrop';
      backdrop.style.zIndex = '10050';
      backdrop.innerHTML = `
        <div class="confirm-box" style="text-align:left;max-width:440px;width:92vw">
          <div class="confirm-icon" style="font-size:1.4rem">📋</div>
          <div class="confirm-msg" style="margin-bottom:12px;font-weight:600">Datos para Cargar Reportes</div>
          <p style="margin:0 0 12px;font-size:.85rem;color:#64748b;line-height:1.4">
            El comprobante ya tiene los datos del paciente. Indique especialidad y tipo de consulta.
          </p>
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;margin-bottom:14px;font-size:.88rem">
            <div><strong>Paciente:</strong> ${esc(nombre)}</div>
            <div style="margin-top:4px"><strong>Documento:</strong> ${esc(tipoDoc)} ${esc(doc)}</div>
          </div>
          <div style="margin-bottom:12px">
            <label for="cmpPdxEsp" style="display:block;font-size:.8rem;font-weight:600;color:#475569;margin-bottom:4px">Especialidad *</label>
            <select id="cmpPdxEsp" style="width:100%;padding:8px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:.9rem">
              <option value="">Cargando…</option>
            </select>
          </div>
          <div style="margin-bottom:16px">
            <label for="cmpPdxTipo" style="display:block;font-size:.8rem;font-weight:600;color:#475569;margin-bottom:4px">Tipo de consulta *</label>
            <select id="cmpPdxTipo" style="width:100%;padding:8px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:.9rem" disabled>
              <option value="">Seleccione especialidad primero</option>
            </select>
          </div>
          <div id="cmpPdxErr" style="display:none;color:#b91c1c;font-size:.82rem;margin:-6px 0 10px"></div>
          <div class="confirm-actions">
            <button type="button" class="btn-cancel" id="cmpPdxCancel">Cancelar</button>
            <button type="button" class="btn-ok" id="cmpPdxOk" style="background:#0d9488">Enviar a la carpeta</button>
          </div>
        </div>`;
      document.body.appendChild(backdrop);

      const selEsp = backdrop.querySelector('#cmpPdxEsp');
      const selTipo = backdrop.querySelector('#cmpPdxTipo');
      const errEl = backdrop.querySelector('#cmpPdxErr');

      const cerrar = (val) => {
        backdrop.remove();
        resolve(val);
      };

      const mostrarErr = (msg) => {
        if (!errEl) return;
        errEl.style.display = 'block';
        errEl.textContent = msg;
      };

      const poblarTipos = async (esp, selected) => {
        if (!esp) {
          selTipo.disabled = true;
          selTipo.innerHTML = '<option value="">Seleccione especialidad primero</option>';
          return;
        }
        selTipo.disabled = true;
        selTipo.innerHTML = '<option value="">Cargando…</option>';
        const tipos = await cargarTiposConsulta(esp);
        if (!tipos.length) {
          selTipo.innerHTML = '<option value="">Sin tipos — puede escribir abajo</option>';
          selTipo.disabled = false;
          // Permitir texto libre vía option editable: usamos input extra si vacío
          return;
        }
        const sel = String(selected || '');
        selTipo.innerHTML = '<option value="">Seleccionar tipo de consulta</option>'
          + tipos.map((t) => {
            const n = t.nombre || '';
            return `<option value="${esc(n)}"${n === sel ? ' selected' : ''}>${esc(n)}</option>`;
          }).join('');
        selTipo.disabled = false;
      };

      const especialidades = await cargarEspecialidades();
      if (!especialidades.length) {
        selEsp.innerHTML = '<option value="">No hay especialidades</option>';
      } else {
        selEsp.innerHTML = '<option value="">Seleccionar especialidad</option>'
          + especialidades.map((e) => {
            const n = e.nombre || '';
            return `<option value="${esc(n)}"${n === preEsp ? ' selected' : ''}>${esc(n)}</option>`;
          }).join('');
      }

      selEsp.addEventListener('change', () => {
        errEl.style.display = 'none';
        poblarTipos(selEsp.value.trim(), '');
      });

      if (preEsp) await poblarTipos(preEsp, preTipo);
      else await poblarTipos('', '');

      backdrop.querySelector('#cmpPdxCancel')?.addEventListener('click', () => cerrar(null));
      backdrop.addEventListener('click', (e) => { if (e.target === backdrop) cerrar(null); });
      backdrop.querySelector('#cmpPdxOk')?.addEventListener('click', () => {
        const especialidad = selEsp.value.trim();
        const tipo_consulta = selTipo.value.trim();
        if (!especialidad) {
          mostrarErr('Seleccione la especialidad');
          selEsp.focus();
          return;
        }
        if (!tipo_consulta) {
          mostrarErr('Seleccione el tipo de consulta');
          selTipo.focus();
          return;
        }
        cerrar({ especialidad, tipo_consulta });
      });
    });
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

  async function enviarPdfDirecto(carpetaId, pdfBlob, meta = {}) {
    const tema = String(meta.tema || '').trim();
    const fd = new FormData();
    const filename = meta.filename || `comprobante_${meta.paciente_documento || 'paciente'}.pdf`;
    fd.append('file', pdfBlob, filename);
    fd.append('confirmacion_manual', '1');
    fd.append('fecha_estudio', meta.fecha || meta.fecha_estudio || '');

    // Siempre enviar identificación del paciente (viene del comprobante)
    fd.append('tipo_documento', meta.tipo_documento || 'CC');
    fd.append('paciente_documento', meta.paciente_documento || '');
    const { apellidos, nombres } = splitNombrePdx(meta.paciente_nombre);
    fd.append('apellidos', apellidos);
    fd.append('nombres', nombres);

    if (tema === 'comprobantes_consulta_medica') {
      fd.append('paciente_nombre_completo', meta.paciente_nombre || '');
      fd.append('estudio_texto', meta.especialidad || '');
      fd.append('tipo_consulta', meta.tipo_consulta || '');
    } else {
      fd.append('estudio_texto', meta.servicio || meta.estudio_texto || '');
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

  /**
   * Envío completo:
   * - Consultas médicas → pide especialidad + tipo de consulta
   * - Electro → pide tipo de estudio
   */
  async function enviarPdf(carpetaId, pdfBlob, meta = {}) {
    if (!carpetaId) throw new Error('Seleccione la carpeta de Cargar Reportes');
    if (!pdfBlob || !pdfBlob.size) {
      throw new Error('No hay PDF para enviar a Cargar Reportes (el documento no se generó como archivo)');
    }

    let metaFinal = { ...meta };
    const tema = String(metaFinal.tema || '').trim();

    if (tema === 'comprobantes_consulta_medica') {
      const extras = await pedirEspecialidadYTipoConsulta({
        paciente_nombre: metaFinal.paciente_nombre,
        paciente_documento: metaFinal.paciente_documento,
        tipo_documento: metaFinal.tipo_documento,
        especialidad: metaFinal.especialidad
          || (typeof root.selectedDoctorEspecialidad !== 'undefined' ? root.selectedDoctorEspecialidad : '')
          || '',
        tipo_consulta: metaFinal.tipo_consulta || ''
      });
      if (!extras) {
        const err = new Error('Envío a Cargar Reportes cancelado');
        err.code = 'PDX_CANCELADO';
        throw err;
      }
      metaFinal.especialidad = extras.especialidad;
      metaFinal.tipo_consulta = extras.tipo_consulta;
    } else {
      const extras = await pedirTipoEstudio({
        paciente_nombre: metaFinal.paciente_nombre,
        paciente_documento: metaFinal.paciente_documento,
        tipo_documento: metaFinal.tipo_documento,
        servicio: metaFinal.servicio || metaFinal.estudio_texto || ''
      });
      if (!extras) {
        const err = new Error('Envío a Cargar Reportes cancelado');
        err.code = 'PDX_CANCELADO';
        throw err;
      }
      metaFinal.servicio = extras.servicio;
      metaFinal.estudio_texto = extras.estudio_texto;
    }

    return enviarPdfDirecto(carpetaId, pdfBlob, metaFinal);
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
    pedirEspecialidadYTipoConsulta,
    pedirTipoEstudio,
    splitNombrePdx,
    bindEnviarPdx,
    invalidarEspecialidades() { _cacheEsp = null; },
    invalidarEstudios() { _cacheEstudios = null; },
    invalidarTipos() {
      Object.keys(_cacheTipos).forEach((k) => { delete _cacheTipos[k]; });
    },
    invalidarCache() {
      _cacheEsp = null;
      _cacheEstudios = null;
      Object.keys(_cacheTipos).forEach((k) => { delete _cacheTipos[k]; });
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
