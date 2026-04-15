// multiselect.js — Componente reutilizable de selección múltiple
// Convierte un <select> normal en dropdown con checkboxes

(function() {
  'use strict';

  /**
   * Convierte un <select> en multi-select con checkboxes.
   * @param {HTMLSelectElement} selectEl - El <select> original
   * @param {Object} opts - Opciones
   * @param {string} opts.placeholder - Texto cuando no hay selección (default: primera opción "Todas/Todos")
   * @param {Function} opts.onChange - Callback cuando cambia la selección
   * @returns {Object} API: { getValues(), setValues(arr), clear(), refresh(), destroy() }
   */
  function initMultiSelect(selectEl, opts) {
    if (!selectEl || selectEl.dataset.msInit) return null;
    opts = opts || {};

    selectEl.dataset.msInit = '1';
    selectEl.style.display = 'none';

    var placeholder = opts.placeholder || selectEl.options[0]?.textContent || 'Todos';
    var wrapper = document.createElement('div');
    wrapper.className = 'ms-wrap';

    var trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'ms-trigger';
    trigger.innerHTML = '<span class="ms-text">' + _esc(placeholder) + '</span><svg class="ms-arrow" viewBox="0 0 12 8" width="12" height="8"><path d="M1 1l5 5 5-5" stroke="currentColor" fill="none" stroke-width="1.5"/></svg>';

    var dropdown = document.createElement('div');
    dropdown.className = 'ms-dropdown';

    wrapper.appendChild(trigger);
    wrapper.appendChild(dropdown);
    selectEl.parentNode.insertBefore(wrapper, selectEl);

    var selected = new Set();
    var optionEls = [];

    function _esc(s) {
      var d = document.createElement('div');
      d.textContent = s;
      return d.innerHTML;
    }

    function buildOptions() {
      dropdown.innerHTML = '';
      optionEls = [];
      var opts_list = selectEl.options;

      for (var i = 0; i < opts_list.length; i++) {
        var opt = opts_list[i];
        if (!opt.value) continue; // Skip "Todos/Todas" placeholder option

        var item = document.createElement('label');
        item.className = 'ms-item';

        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = opt.value;
        cb.checked = selected.has(opt.value);

        var span = document.createElement('span');
        span.textContent = opt.textContent;

        item.appendChild(cb);
        item.appendChild(span);
        dropdown.appendChild(item);
        optionEls.push({ cb: cb, value: opt.value, label: opt.textContent });

        cb.addEventListener('change', function() {
          if (this.checked) {
            selected.add(this.value);
          } else {
            selected.delete(this.value);
          }
          updateDisplay();
          if (opts.onChange) opts.onChange(getValues());
        });
      }
    }

    function updateDisplay() {
      var textEl = trigger.querySelector('.ms-text');
      if (selected.size === 0) {
        textEl.textContent = placeholder;
        trigger.classList.remove('ms-has-value');
      } else if (selected.size === 1) {
        var val = Array.from(selected)[0];
        var found = optionEls.find(function(o) { return o.value === val; });
        textEl.textContent = found ? found.label : val;
        trigger.classList.add('ms-has-value');
      } else {
        textEl.textContent = selected.size + ' seleccionados';
        trigger.classList.add('ms-has-value');
      }
    }

    function getValues() {
      return Array.from(selected);
    }

    function setValues(arr) {
      selected = new Set(arr || []);
      optionEls.forEach(function(o) {
        o.cb.checked = selected.has(o.value);
      });
      updateDisplay();
    }

    function clear() {
      selected.clear();
      optionEls.forEach(function(o) { o.cb.checked = false; });
      updateDisplay();
      if (opts.onChange) opts.onChange([]);
    }

    function refresh() {
      buildOptions();
      updateDisplay();
    }

    function destroy() {
      wrapper.parentNode.insertBefore(selectEl, wrapper);
      wrapper.remove();
      selectEl.style.display = '';
      delete selectEl.dataset.msInit;
    }

    // Toggle dropdown
    trigger.addEventListener('click', function(e) {
      e.stopPropagation();
      var isOpen = wrapper.classList.contains('ms-open');
      // Close all other multi-selects
      document.querySelectorAll('.ms-wrap.ms-open').forEach(function(w) {
        if (w !== wrapper) w.classList.remove('ms-open');
      });
      wrapper.classList.toggle('ms-open', !isOpen);
    });

    // Close on outside click
    document.addEventListener('click', function(e) {
      if (!wrapper.contains(e.target)) {
        wrapper.classList.remove('ms-open');
      }
    });

    buildOptions();
    updateDisplay();

    // Store API on the select element for easy access
    var api = { getValues: getValues, setValues: setValues, clear: clear, refresh: refresh, destroy: destroy, wrapper: wrapper };
    selectEl._ms = api;
    return api;
  }

  // Observe mutations on select to auto-refresh options
  function observeSelect(selectEl) {
    if (!selectEl || !selectEl._ms) return;
    var observer = new MutationObserver(function() {
      if (selectEl._ms) selectEl._ms.refresh();
    });
    observer.observe(selectEl, { childList: true, subtree: true });
    selectEl._msObserver = observer;
  }

  // Export globally
  window.initMultiSelect = initMultiSelect;
  window.observeSelectForMulti = observeSelect;

  // Helper: get multi-select values as comma-separated string (or empty)
  window.getMultiSelectValue = function(selectEl) {
    if (!selectEl) return '';
    if (selectEl._ms) return selectEl._ms.getValues().join(',');
    return selectEl.value || '';
  };

  // Helper: clear a multi-select
  window.clearMultiSelect = function(selectEl) {
    if (!selectEl) return;
    if (selectEl._ms) { selectEl._ms.clear(); return; }
    selectEl.value = '';
  };
})();
