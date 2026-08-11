/**
 * Afiliación en Comprobante de Servicios:
 * - Select + texto libre
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
    // Texto libre del Anexo: se muestra tal cual en el campo (editable)
    return String(rawAnexo || '').trim() || 'COTIZANTE';
  }

  /**
   * Qué afiliación escribir en Anexo al guardar desde comprobante.
   * null/'' = no tocar el valor existente (merge ignora vacío).
   */
  function afiliacionSeguraParaAnexo(valorUi, afiliacionAnexoOriginal) {
    const original = String(afiliacionAnexoOriginal || '').trim();
    if (esAfiliacionProtegidaAnexo(original)) return '';
    const can = canonica(valorUi);
    if (!can) return ''; // texto libre del PDF: no dañar Anexo
    return can;
  }

  function escHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function setValor(inputId, valorUi, afiliacionAnexoOriginal) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const anexo = String(afiliacionAnexoOriginal || '').trim();
    const ui = valorUi != null ? String(valorUi).trim() : '';
    if (ui && canonica(ui)) {
      input.value = canonica(ui);
    } else if (anexo) {
      input.value = mapearAfiliacionParaComprobante(anexo);
    } else if (ui) {
      input.value = mapearAfiliacionParaComprobante(ui);
    } else {
      input.value = 'COTIZANTE';
    }
    input.dataset.afiliacionAnexo = anexo;
    input.dispatchEvent(new Event('input', { bubbles: true }));
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
    const input = document.getElementById(inputId);
    if (!input || input.dataset.innarAfilCombo === '1') return;
    input.dataset.innarAfilCombo = '1';
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('list', `${inputId}__list`);
    input.setAttribute('placeholder', 'Elija o escriba…');
    if (!input.value) input.value = 'COTIZANTE';

    let list = document.getElementById(`${inputId}__list`);
    if (!list) {
      list = document.createElement('datalist');
      list.id = `${inputId}__list`;
      OPCIONES.forEach((opt) => {
        const o = document.createElement('option');
        o.value = opt;
        list.appendChild(o);
      });
      input.insertAdjacentElement('afterend', list);
    }

    const wrap = document.createElement('div');
    wrap.className = 'innar-afil-combo';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    const chips = document.createElement('div');
    chips.className = 'innar-afil-chips';
    chips.innerHTML = OPCIONES.map((opt) => (
      `<button type="button" class="innar-afil-chip" data-val="${escHtml(opt)}">${escHtml(opt)}</button>`
    )).join('');
    wrap.appendChild(chips);

    const syncChips = () => {
      const cur = canonica(input.value) || '';
      chips.querySelectorAll('.innar-afil-chip').forEach((btn) => {
        btn.classList.toggle('is-on', btn.dataset.val === cur);
      });
    };
    input.addEventListener('input', syncChips);
    input.addEventListener('change', syncChips);
    chips.addEventListener('click', (e) => {
      const btn = e.target.closest('.innar-afil-chip');
      if (!btn) return;
      input.value = btn.dataset.val || '';
      syncChips();
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    syncChips();
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
