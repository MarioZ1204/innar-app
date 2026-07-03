/**
 * Campo servicio/motivo: texto libre + sugerencias según origen (estudios o consultas).
 */
(function (root) {
  'use strict';

  const instancias = new Map();

  function normBusqueda(val) {
    return String(val || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function escHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function tituloLista(origen) {
    if (origen === 'electro') return 'Estudios de electrodiagnóstico';
    if (origen === 'medica') return 'Tipos de consulta';
    return 'Sugerencias';
  }

  async function cargarSugerencias(origen) {
    const key = origen || 'todos';
    const cacheKey = `_cache_${key}`;
    if (root.innarServicioCombo?.[cacheKey]) return root.innarServicioCombo[cacheKey];

    if (typeof apiFetch !== 'function') return [];

    const url = origen
      ? `/api/certificados/catalogo-servicios?origen=${encodeURIComponent(origen)}`
      : '/api/certificados/catalogo-servicios';

    const prom = apiFetch(url)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'No se pudo cargar sugerencias');
        const items = (data.servicios || []).map((s) => {
          const nombre = String(s.nombre || '').trim();
          return {
            codigo: String(s.codigo || '').trim(),
            nombre,
            buscar: normBusqueda(nombre)
          };
        }).filter((s) => s.nombre);
        root.innarServicioCombo[cacheKey] = items;
        return items;
      });

    return prom;
  }

  function filtrarLista(catalogo, texto) {
    if (!catalogo?.length) return [];
    const q = normBusqueda(texto);
    if (!q) return catalogo.slice(0, 25);
    return catalogo.filter((s) => s.buscar.includes(q)).slice(0, 25);
  }

  function insertarSugerencia(input, nombre) {
    const texto = String(nombre || '').trim();
    if (!texto) return;
    input.value = texto;
    input.focus();
    const len = input.value.length;
    try {
      input.setSelectionRange(len, len);
    } catch (_) { /* ignore */ }
  }

  function init(inputId, options = {}) {
    const input = document.getElementById(inputId);
    if (!input) return;
    if (input.dataset.innarServicioComboInit === '1') {
      const prev = instancias.get(inputId);
      if (prev && options.origen != null) prev.origen = options.origen;
      return;
    }
    input.dataset.innarServicioComboInit = '1';

    const state = {
      origen: options.origen || null,
      getOrigen: typeof options.getOrigen === 'function' ? options.getOrigen : null,
      catalogo: []
    };
    instancias.set(inputId, state);

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
    hint.textContent = 'Escriba libremente o elija una sugerencia de la lista (puede completar el texto después).';
    wrap.appendChild(hint);

    input.setAttribute('autocomplete', 'off');
    if (!input.getAttribute('placeholder')) {
      input.setAttribute('placeholder', 'Escriba o elija de la lista…');
    }

    function origenActual() {
      if (state.getOrigen) return state.getOrigen() || state.origen;
      return state.origen;
    }

    function pintarLista(items) {
      const origen = origenActual();
      if (!items.length) {
        list.classList.add('hidden');
        list.innerHTML = '';
        return;
      }
      const titulo = tituloLista(origen);
      list.innerHTML = `<li class="innar-servicio-combo-head" aria-hidden="true">${escHtml(titulo)}</li>`
        + items.map((s) => (
          `<li role="option" tabindex="-1" data-nombre="${escHtml(s.nombre)}">`
          + (s.codigo ? `<span class="innar-servicio-combo-cod">${escHtml(s.codigo)}</span>` : '')
          + `<span class="innar-servicio-combo-nom">${escHtml(s.nombre)}</span>`
          + '</li>'
        )).join('');
      list.classList.remove('hidden');
    }

    async function mostrarSugerencias() {
      try {
        state.catalogo = await cargarSugerencias(origenActual());
        pintarLista(filtrarLista(state.catalogo, input.value));
      } catch (_) {
        list.classList.add('hidden');
      }
    }

    input.addEventListener('focus', () => { mostrarSugerencias(); });
    input.addEventListener('input', () => { mostrarSugerencias(); });
    input.addEventListener('blur', () => {
      setTimeout(() => list.classList.add('hidden'), 180);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') list.classList.add('hidden');
      if (e.key === 'Enter') {
        const first = list.querySelector('li[role="option"]');
        if (first && !list.classList.contains('hidden')) {
          e.preventDefault();
          insertarSugerencia(input, first.dataset.nombre || '');
          list.classList.add('hidden');
        }
      }
    });

    list.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const li = e.target.closest('li[role="option"]');
      if (!li) return;
      insertarSugerencia(input, li.dataset.nombre || '');
      list.classList.add('hidden');
    });
  }

  function setOrigen(inputId, origen) {
    const state = instancias.get(inputId);
    if (state) {
      state.origen = origen;
      delete root.innarServicioCombo?.[`_cache_${origen || 'todos'}`];
    }
  }

  function leerValor(inputId) {
    const input = document.getElementById(inputId);
    if (!input) return '';
    return String(input.value || '').trim();
  }

  function invalidarCache() {
    Object.keys(root.innarServicioCombo || {}).forEach((k) => {
      if (k.startsWith('_cache_')) delete root.innarServicioCombo[k];
    });
  }

  root.innarServicioCombo = {
    init,
    setOrigen,
    leerValor,
    invalidarCache,
    cargarSugerencias
  };
})(typeof window !== 'undefined' ? window : globalThis);
