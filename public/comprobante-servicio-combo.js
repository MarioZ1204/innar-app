/**
 * Combo servicio comprobante: escribir libremente + lista CUPS (código y nombre).
 */
(function (root) {
  'use strict';

  let catalogo = null;
  let promesaCarga = null;

  function normBusqueda(val) {
    return String(val || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normCodigo(val) {
    const raw = String(val || '').replace(/\D/g, '');
    if (!raw) return '';
    return raw.length >= 6 ? raw : raw.padStart(6, '0');
  }

  function escHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function cargarCatalogo() {
    if (catalogo) return catalogo;
    if (promesaCarga) return promesaCarga;
    if (typeof apiFetch !== 'function') return [];

    promesaCarga = apiFetch('/api/certificados/catalogo-servicios')
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'No se pudo cargar el catálogo CUPS');
        catalogo = (data.servicios || []).map((s) => {
          const codigo = normCodigo(s.codigo);
          const nombre = String(s.nombre || '').trim();
          return {
            codigo,
            nombre,
            buscar: normBusqueda(`${codigo} ${nombre}`)
          };
        });
        return catalogo;
      })
      .catch((e) => {
        promesaCarga = null;
        throw e;
      });

    return promesaCarga;
  }

  function buscarPorCodigo(valor) {
    if (!catalogo?.length) return null;
    const cod = normCodigo(valor);
    if (cod.length < 5) return null;
    return catalogo.find((s) => s.codigo === cod || s.codigo.replace(/^0+/, '') === cod.replace(/^0+/, '')) || null;
  }

  function filtrarCatalogo(texto) {
    if (!catalogo?.length) return [];
    const q = normBusqueda(texto);
    const soloDigitos = String(texto || '').replace(/\D/g, '');
    if (!q) return catalogo.slice(0, 20);
    return catalogo.filter((s) => {
      if (soloDigitos && s.codigo.includes(soloDigitos)) return true;
      return s.buscar.includes(q);
    }).slice(0, 20);
  }

  function resolverCodigoEnInput(input) {
    const v = String(input.value || '').trim();
    if (!v) return;
    if (/[a-zA-ZáéíóúñÁÉÍÓÚÑ]/.test(v)) return;
    const hit = buscarPorCodigo(v);
    if (hit) input.value = hit.nombre;
  }

  function init(inputId) {
    const input = document.getElementById(inputId);
    if (!input || input.dataset.innarServicioCombo === '1') return;
    input.dataset.innarServicioCombo = '1';

    const wrap = document.createElement('div');
    wrap.className = 'innar-servicio-combo';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    const list = document.createElement('ul');
    list.className = 'innar-servicio-combo-list hidden';
    list.setAttribute('role', 'listbox');
    wrap.appendChild(list);

    const hint = document.createElement('p');
    hint.className = 'innar-servicio-combo-hint';
    hint.textContent = 'Escriba el código CUPS, busque en la lista o ingrese texto libre.';
    wrap.appendChild(hint);

    input.setAttribute('autocomplete', 'off');
    if (!input.getAttribute('placeholder')) {
      input.setAttribute('placeholder', 'Código CUPS o nombre del servicio');
    }

    function pintarLista(items) {
      if (!items.length) {
        list.classList.add('hidden');
        list.innerHTML = '';
        return;
      }
      list.innerHTML = items.map((s) => (
        `<li role="option" tabindex="-1" data-nombre="${escHtml(s.nombre)}">`
        + `<span class="innar-servicio-combo-cod">${escHtml(s.codigo)}</span>`
        + `<span class="innar-servicio-combo-nom">${escHtml(s.nombre)}</span>`
        + '</li>'
      )).join('');
      list.classList.remove('hidden');
    }

    async function mostrarSugerencias() {
      try {
        await cargarCatalogo();
        pintarLista(filtrarCatalogo(input.value));
      } catch (_) {
        list.classList.add('hidden');
      }
    }

    input.addEventListener('focus', () => { mostrarSugerencias(); });
    input.addEventListener('input', () => { mostrarSugerencias(); });
    input.addEventListener('blur', () => {
      setTimeout(() => list.classList.add('hidden'), 160);
      resolverCodigoEnInput(input);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') list.classList.add('hidden');
      if (e.key === 'Enter') {
        const first = list.querySelector('li');
        if (first && !list.classList.contains('hidden')) {
          e.preventDefault();
          input.value = first.dataset.nombre || '';
          list.classList.add('hidden');
        }
      }
    });

    list.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const li = e.target.closest('li');
      if (!li) return;
      input.value = li.dataset.nombre || '';
      list.classList.add('hidden');
    });
  }

  function initAll() {
    // El campo de comprobante ahora acepta texto libre sin autocompletado de CUPS.
    if (document.getElementById('compServServicio')) {
      document.getElementById('compServServicio').dataset.innarServicioCombo = '1';
    }
    if (document.getElementById('docmodModalCompServicio')) {
      document.getElementById('docmodModalCompServicio').dataset.innarServicioCombo = '1';
    }
  }

  function leerValor(inputId) {
    const input = document.getElementById(inputId);
    if (!input) return '';
    resolverCodigoEnInput(input);
    return String(input.value || '').trim();
  }

  root.innarServicioCombo = {
    init,
    initAll,
    cargarCatalogo,
    buscarPorCodigo,
    leerValor
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll);
  } else {
    initAll();
  }
})(typeof window !== 'undefined' ? window : globalThis);
