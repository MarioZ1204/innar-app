/**
 * Campo servicio/motivo: escriba y filtra (catálogo según origen).
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

  function highlight(texto, q) {
    const raw = String(texto || '');
    if (!q) return escHtml(raw);
    const nRaw = normBusqueda(raw);
    const nQ = normBusqueda(q);
    const idx = nRaw.indexOf(nQ);
    if (idx < 0) return escHtml(raw);
    // Aprox. sobre string original (sin acentos puede desfasar; fallback seguro)
    try {
      const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig');
      return escHtml(raw).replace(re, '<mark>$1</mark>');
    } catch (_) {
      return escHtml(raw);
    }
  }

  function tituloLista(origen) {
    if (origen === 'electro') return 'Estudios de electrodiagnóstico';
    if (origen === 'medica') return 'Tipos de consulta';
    return 'Servicios';
  }

  function cacheKey(origen, uso) {
    return `_cache_${origen || 'todos'}__${uso || 'default'}`;
  }

  async function cargarSugerencias(origen, uso) {
    const key = cacheKey(origen, uso);
    if (root.innarServicioCombo?.[key]) return root.innarServicioCombo[key];
    if (typeof apiFetch !== 'function') return [];

    const params = new URLSearchParams();
    if (origen) params.set('origen', origen);
    if (uso) params.set('uso', uso);
    const qs = params.toString();
    const url = qs
      ? `/api/certificados/catalogo-servicios?${qs}`
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
            buscar: normBusqueda(`${s.codigo || ''} ${nombre}`)
          };
        }).filter((s) => s.nombre);
        root.innarServicioCombo[key] = items;
        return items;
      });

    return prom;
  }

  function filtrarLista(catalogo, texto) {
    if (!catalogo?.length) return [];
    const q = normBusqueda(texto);
    if (!q) return catalogo.slice(0, 40);
    return catalogo.filter((s) => s.buscar.includes(q)).slice(0, 40);
  }

  function insertarSugerencia(input, nombre) {
    const texto = String(nombre || '').trim();
    if (!texto) return;
    input.value = texto;
    input.focus();
    try {
      const len = input.value.length;
      input.setSelectionRange(len, len);
    } catch (_) { /* ignore */ }
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function init(inputId, options = {}) {
    const input = document.getElementById(inputId);
    if (!input) return;
    if (input.dataset.innarServicioComboInit === '1') {
      const prev = instancias.get(inputId);
      if (prev) {
        if (options.origen != null) prev.origen = options.origen;
        if (options.uso != null) prev.uso = options.uso;
      }
      return;
    }
    input.dataset.innarServicioComboInit = '1';

    const state = {
      origen: options.origen || null,
      uso: options.uso || null,
      getOrigen: typeof options.getOrigen === 'function' ? options.getOrigen : null,
      catalogo: [],
      activeIdx: -1
    };
    instancias.set(inputId, state);

    const wrap = document.createElement('div');
    wrap.className = 'innar-servicio-combo';
    input.parentNode.insertBefore(wrap, input);

    const field = document.createElement('div');
    field.className = 'innar-servicio-combo-field';
    wrap.appendChild(field);
    field.appendChild(input);

    const icon = document.createElement('span');
    icon.className = 'innar-servicio-combo-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3-3"/></svg>';
    field.appendChild(icon);

    const list = document.createElement('ul');
    list.className = 'innar-servicio-combo-list hidden';
    list.setAttribute('role', 'listbox');
    wrap.appendChild(list);

    const hint = document.createElement('p');
    hint.className = 'innar-servicio-combo-hint';
    hint.textContent = 'Escriba para filtrar el catálogo o deje un texto libre.';
    wrap.appendChild(hint);

    input.classList.add('innar-servicio-combo-input');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    if (!input.getAttribute('placeholder')) {
      input.setAttribute('placeholder', 'Buscar servicio…');
    }

    function origenActual() {
      if (state.getOrigen) return state.getOrigen() || state.origen;
      return state.origen;
    }

    function setExpanded(open) {
      input.setAttribute('aria-expanded', open ? 'true' : 'false');
      list.classList.toggle('hidden', !open);
    }

    function pintarLista(items) {
      const origen = origenActual();
      const q = input.value;
      if (!items.length) {
        list.innerHTML = `<li class="innar-servicio-combo-empty">Sin coincidencias — puede dejar el texto escrito</li>`;
        setExpanded(true);
        state.activeIdx = -1;
        return;
      }
      const titulo = tituloLista(origen);
      list.innerHTML = `<li class="innar-servicio-combo-head" aria-hidden="true">${escHtml(titulo)} · ${items.length}</li>`
        + items.map((s, i) => (
          `<li role="option" tabindex="-1" data-idx="${i}" data-nombre="${escHtml(s.nombre)}" class="innar-servicio-combo-opt">`
          + (s.codigo ? `<span class="innar-servicio-combo-cod">${escHtml(s.codigo)}</span>` : '')
          + `<span class="innar-servicio-combo-nom">${highlight(s.nombre, q)}</span>`
          + '</li>'
        )).join('');
      setExpanded(true);
      state.activeIdx = -1;
    }

    async function mostrarSugerencias() {
      try {
        state.catalogo = await cargarSugerencias(origenActual(), state.uso);
        pintarLista(filtrarLista(state.catalogo, input.value));
      } catch (_) {
        setExpanded(false);
      }
    }

    function optsVisibles() {
      return [...list.querySelectorAll('li[role="option"]')];
    }

    function highlightActive() {
      optsVisibles().forEach((li, i) => {
        li.classList.toggle('is-active', i === state.activeIdx);
      });
    }

    input.addEventListener('focus', () => { void mostrarSugerencias(); });
    input.addEventListener('input', () => { void mostrarSugerencias(); });
    input.addEventListener('blur', () => {
      setTimeout(() => setExpanded(false), 160);
    });
    input.addEventListener('keydown', (e) => {
      const opts = optsVisibles();
      if (e.key === 'Escape') {
        setExpanded(false);
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (list.classList.contains('hidden')) void mostrarSugerencias();
        state.activeIdx = Math.min(opts.length - 1, state.activeIdx + 1);
        highlightActive();
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        state.activeIdx = Math.max(0, state.activeIdx - 1);
        highlightActive();
        return;
      }
      if (e.key === 'Enter') {
        const pick = state.activeIdx >= 0 ? opts[state.activeIdx] : opts[0];
        if (pick && !list.classList.contains('hidden')) {
          e.preventDefault();
          insertarSugerencia(input, pick.dataset.nombre || '');
          setExpanded(false);
        }
      }
    });

    list.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const li = e.target.closest('li[role="option"]');
      if (!li) return;
      insertarSugerencia(input, li.dataset.nombre || '');
      setExpanded(false);
    });
  }

  function setOrigen(inputId, origen) {
    const state = instancias.get(inputId);
    if (state) {
      state.origen = origen;
      delete root.innarServicioCombo?.[cacheKey(origen, state.uso)];
    }
  }

  function leerValor(inputId) {
    const input = document.getElementById(inputId);
    return String(input?.value || '').trim();
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
