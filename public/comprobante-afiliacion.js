/**
 * Afiliación en Comprobante de Servicios:
 * - Select fijo (mismas 4 opciones si el paciente existe o no)
 * - Mapeo visual desde Anexo (Especiales… → COTIZANTE/BENEFICIARIO)
 * - Al guardar en Anexo no se pisan valores protegidos ni texto libre
 */
(function (root) {
  'use strict';

  const OPCIONES = [
    'COTIZANTE',
    'COTIZANTE PENSIONADO',
    'BENEFICIARIO',
    'SUSTITUTO PENSIONAL'
  ];

  function norm(val) {
    return String(val || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function canonica(val) {
    const n = norm(val);
    for (const opt of OPCIONES) {
      if (norm(opt) === n) return opt;
    }
    return null;
  }

  function esAfiliacionProtegidaAnexo(raw) {
    const n = norm(raw);
    if (!n) return false;
    return n.includes('especial') || n.includes('excepcion');
  }

  /**
   * Valor a mostrar en el comprobante (no muta Anexo).
   * "Especiales o de Excepcion cotizante" → COTIZANTE
   * "Especiales o de Excepcion beneficiario" → BENEFICIARIO
   */
  function mapearAfiliacionParaComprobante(rawAnexo) {
    const n = norm(rawAnexo);
    if (!n) return 'COTIZANTE';
    const ya = canonica(rawAnexo);
    if (ya) return ya;
    if (n.includes('beneficiario') && (n.includes('especial') || n.includes('excepcion'))) {
      return 'BENEFICIARIO';
    }
    if (n.includes('cotizante') && (n.includes('especial') || n.includes('excepcion'))) {
      return 'COTIZANTE';
    }
    if (n.includes('sustituto')) return 'SUSTITUTO PENSIONAL';
    if (n.includes('pensionado') && n.includes('cotizante')) return 'COTIZANTE PENSIONADO';
    if (n.includes('beneficiario')) return 'BENEFICIARIO';
    if (n.includes('cotizante')) return 'COTIZANTE';
    return String(rawAnexo || '').trim() || 'COTIZANTE';
  }

  function valorParaSelect(valorUi, afiliacionAnexoOriginal) {
    const ui = valorUi != null ? String(valorUi).trim() : '';
    const anexo = String(afiliacionAnexoOriginal || '').trim();
    if (ui && canonica(ui)) return canonica(ui);
    if (anexo) return mapearAfiliacionParaComprobante(anexo);
    if (ui) return mapearAfiliacionParaComprobante(ui);
    return 'COTIZANTE';
  }

  /**
   * Qué afiliación escribir en Anexo al guardar desde comprobante.
   * null/'' = no tocar el valor existente (merge ignora vacío).
   */
  function afiliacionSeguraParaAnexo(valorUi, afiliacionAnexoOriginal) {
    const original = String(afiliacionAnexoOriginal || '').trim();
    if (esAfiliacionProtegidaAnexo(original)) return '';
    const can = canonica(valorUi);
    if (!can) return '';
    return can;
  }

  function escHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function asegurarSelect(el) {
    if (!el) return null;
    if (el.tagName === 'SELECT') return el;
    const sel = document.createElement('select');
    sel.id = el.id;
    if (el.className) sel.className = el.className;
    const style = el.getAttribute('style');
    if (style) sel.setAttribute('style', style);
    if (el.name) sel.name = el.name;
    if (el.disabled || el.readOnly) sel.disabled = true;
    if (el.dataset.afiliacionAnexo) sel.dataset.afiliacionAnexo = el.dataset.afiliacionAnexo;
    sel.required = true;
    el.replaceWith(sel);
    return sel;
  }

  function poblarOpciones(select, current) {
    const chosen = canonica(current) || String(current || '').trim() || 'COTIZANTE';
    const opts = OPCIONES.slice();
    if (chosen && !opts.includes(chosen)) opts.push(chosen);
    const anexo = select.dataset.afiliacionAnexo || '';
    select.innerHTML = opts.map((opt) => {
      const sel = opt === chosen ? ' selected' : '';
      return `<option value="${escHtml(opt)}"${sel}>${escHtml(opt)}</option>`;
    }).join('');
    if (anexo) select.dataset.afiliacionAnexo = anexo;
    select.value = chosen;
  }

  function setValor(inputId, valorUi, afiliacionAnexoOriginal) {
    let el = document.getElementById(inputId);
    if (!el) return;
    el = asegurarSelect(el);
    const anexo = String(afiliacionAnexoOriginal || '').trim();
    const val = valorParaSelect(valorUi, anexo);
    poblarOpciones(el, val);
    el.dataset.afiliacionAnexo = anexo;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function leerValor(inputId) {
    const input = document.getElementById(inputId);
    return String(input?.value || '').trim();
  }

  function leerAnexoOriginal(inputId) {
    const input = document.getElementById(inputId);
    return String(input?.dataset?.afiliacionAnexo || '').trim();
  }

  function init(inputId) {
    let el = document.getElementById(inputId);
    if (!el) return;
    el = asegurarSelect(el);
    if (!el) return;
    if (el.dataset.innarAfilSelect === '1') return;
    el.dataset.innarAfilSelect = '1';
    el.classList.add('innar-afil-select');
    poblarOpciones(el, el.value || 'COTIZANTE');
  }

  root.innarAfiliacionComprobante = {
    OPCIONES,
    mapearAfiliacionParaComprobante,
    afiliacionSeguraParaAnexo,
    esAfiliacionProtegidaAnexo,
    canonica,
    init,
    setValor,
    leerValor,
    leerAnexoOriginal
  };
})(typeof window !== 'undefined' ? window : globalThis);
