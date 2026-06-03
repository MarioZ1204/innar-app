/**
 * Calendario mensual — agenda electrodiagnóstico (conteos por día y por tipo).
 */
(function () {
  'use strict';

  const MESES_ES = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
  ];
  const DIAS_SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

  const TIPOS = [
    { key: 'psg', label: 'PSG', color: '#7c3aed' },
    { key: 'eeg', label: 'EEG', color: '#ca8a04' },
    { key: 'vtm', label: 'VTM', color: '#2563eb' },
    { key: 'actigrafia', label: 'Actigrafía', color: '#0891b2' },
    { key: 'otro', label: 'Otros', color: '#64748b' }
  ];

  let calAno = new Date().getFullYear();
  let calMes = new Date().getMonth();
  let calDatos = {};
  let calIniciado = false;

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function hoyISO() {
    if (typeof hoyColombiaISO === 'function') return hoyColombiaISO();
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function getFechaSeleccionada() {
    const inp = document.getElementById('electroFecha');
    return (inp && inp.value) ? inp.value : hoyISO();
  }

  function renderLeyendaDia(fecha) {
    const el = document.getElementById('electroCalLegend');
    if (!el) return;
    const dia = calDatos[fecha] || { total: 0, porTipo: {} };
    const parts = TIPOS.map((t) => {
      const n = parseInt(dia.porTipo?.[t.key], 10) || 0;
      if (!n) return '';
      return `<span class="ecal-legend-item" title="${escapeHtml(t.label)}">
        <span class="ecal-legend-dot" style="background:${t.color}"></span>
        <span class="ecal-legend-label">${escapeHtml(t.label)}</span>
        <strong class="ecal-legend-num">${n}</strong>
      </span>`;
    }).filter(Boolean);
    const total = parseInt(dia.total, 10) || 0;
    el.innerHTML = parts.length
      ? `<span class="ecal-legend-title">${escapeHtml(fecha)} · ${total} estudio(s)</span>${parts.join('')}`
      : `<span class="ecal-legend-title">${escapeHtml(fecha)} · sin estudios</span>`;
  }

  function marcarDiaSeleccionado(fecha) {
    document.querySelectorAll('#electroCalGrid .ecal-cell').forEach((cell) => {
      cell.classList.toggle('ecal-selected', cell.dataset.fecha === fecha);
    });
    renderLeyendaDia(fecha);
  }

  function intensidadCelda(total) {
    if (total >= 8) return 'ecal-alto';
    if (total >= 4) return 'ecal-medio';
    if (total >= 1) return 'ecal-bajo';
    return 'ecal-vacio';
  }

  function chipsPorTipo(porTipo) {
    return TIPOS.map((t) => {
      const n = parseInt(porTipo?.[t.key], 10) || 0;
      if (!n) return '';
      return `<span class="ecal-chip" style="--ecal-chip:${t.color}" title="${escapeHtml(t.label)}: ${n}">${n}</span>`;
    }).join('');
  }

  function renderGrid() {
    const grid = document.getElementById('electroCalGrid');
    if (!grid) return;

    const ano = calAno;
    const mes = calMes;
    const hoy = hoyISO();
    const offset = (new Date(ano, mes, 1).getDay() + 6) % 7;
    const diasMes = new Date(ano, mes + 1, 0).getDate();
    const sel = getFechaSeleccionada();

    let html = '';
    DIAS_SEMANA.forEach((d) => {
      html += `<div class="ecal-weekday">${d}</div>`;
    });
    for (let i = 0; i < offset; i++) {
      html += '<div class="ecal-cell ecal-empty"></div>';
    }
    for (let d = 1; d <= diasMes; d++) {
      const fecha = `${ano}-${String(mes + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const info = calDatos[fecha] || { total: 0, porTipo: {} };
      const total = parseInt(info.total, 10) || 0;
      const esHoy = fecha === hoy;
      const esSel = fecha === sel;
      const chips = chipsPorTipo(info.porTipo || {});
      html += `<button type="button" class="ecal-cell ${intensidadCelda(total)}${esHoy ? ' ecal-hoy' : ''}${esSel ? ' ecal-selected' : ''}" data-fecha="${fecha}" title="${total} estudio(s)">
        <span class="ecal-dia-num">${d}</span>
        <span class="ecal-total">${total || '—'}</span>
        <span class="ecal-chips">${chips || '<span class="ecal-chips-empty">·</span>'}</span>
      </button>`;
    }
    const resto = (offset + diasMes) % 7;
    if (resto) {
      for (let i = resto; i < 7; i++) html += '<div class="ecal-cell ecal-empty"></div>';
    }
    grid.innerHTML = html;

    grid.querySelectorAll('.ecal-cell[data-fecha]').forEach((btn) => {
      btn.addEventListener('click', () => electroCalClickDia(btn.dataset.fecha));
    });
    renderLeyendaDia(sel);
  }

  async function cargarElectroCalendario() {
    const mes = `${calAno}-${String(calMes + 1).padStart(2, '0')}`;
    const title = document.getElementById('electroCalMonthTitle');
    if (title) title.textContent = `${MESES_ES[calMes]} ${calAno}`;

    try {
      const res = await apiFetch(`/api/citas-electro/calendario?mes=${encodeURIComponent(mes)}`);
      const data = await res.json();
      calDatos = {};
      if (data.ok && Array.isArray(data.dias)) {
        data.dias.forEach((row) => {
          const f = String(row.fecha || '').slice(0, 10);
          calDatos[f] = {
            total: parseInt(row.total, 10) || 0,
            porTipo: row.porTipo || {}
          };
        });
      }
      renderGrid();
    } catch (e) {
      console.error('[Electro calendario]', e);
    }
  }

  function electroCalClickDia(fecha) {
    const inp = document.getElementById('electroFecha');
    if (inp) {
      inp.value = fecha;
      inp.dispatchEvent(new Event('change'));
    }
    marcarDiaSeleccionado(fecha);
    if (typeof cargarCitasElectro === 'function') cargarCitasElectro();
    if (typeof checkEquiposDisponibilidad === 'function') checkEquiposDisponibilidad();
  }

  function initElectroCalendario() {
    const prev = document.getElementById('electroCalPrevMonth');
    const next = document.getElementById('electroCalNextMonth');

    if (prev && !prev.dataset.ecalBound) {
      prev.dataset.ecalBound = '1';
      prev.addEventListener('click', () => {
        calMes -= 1;
        if (calMes < 0) { calMes = 11; calAno -= 1; }
        cargarElectroCalendario();
      });
    }
    if (next && !next.dataset.ecalBound) {
      next.dataset.ecalBound = '1';
      next.addEventListener('click', () => {
        calMes += 1;
        if (calMes > 11) { calMes = 0; calAno += 1; }
        cargarElectroCalendario();
      });
    }

    const fechaInp = document.getElementById('electroFecha');
    if (fechaInp && !fechaInp.dataset.ecalLegend) {
      fechaInp.dataset.ecalLegend = '1';
      fechaInp.addEventListener('change', () => {
        const f = fechaInp.value;
        if (f && /^\d{4}-\d{2}-\d{2}$/.test(f)) {
          const [y, m] = f.split('-').map(Number);
          const mesCambio = y !== calAno || m - 1 !== calMes;
          calAno = y;
          calMes = m - 1;
          if (mesCambio) cargarElectroCalendario();
          else marcarDiaSeleccionado(f);
        }
      });
    }

    if (!calIniciado) {
      const f = getFechaSeleccionada();
      if (/^\d{4}-\d{2}-\d{2}$/.test(f)) {
        const [y, m] = f.split('-').map(Number);
        calAno = y;
        calMes = m - 1;
      }
      calIniciado = true;
    }
    cargarElectroCalendario();
  }

  function refrescarElectroCalendarioSiVisible() {
    if (window.currentModule !== 'electro') return;
    const page = document.querySelector('.electro-page[data-electro-page="agenda"]');
    if (!page || !page.classList.contains('active')) return;
    cargarElectroCalendario();
  }

  window.initElectroCalendario = initElectroCalendario;
  window.cargarElectroCalendario = cargarElectroCalendario;
  window.refrescarElectroCalendarioSiVisible = refrescarElectroCalendarioSiVisible;
})();
