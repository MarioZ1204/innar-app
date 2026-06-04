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

  function ensureTipoLegend() {
    const wrap = document.querySelector('.electro-cal-wrap .ecal-container');
    if (!wrap || document.getElementById('electroCalTipoLegend')) return;
    const el = document.createElement('div');
    el.id = 'electroCalTipoLegend';
    el.className = 'ecal-tipo-legend';
    el.innerHTML =
      TIPOS.map((t) =>
        `<span class="ecal-tipo-pill"><span class="ecal-tipo-dot" style="background:${t.color}"></span>${escapeHtml(t.label)}</span>`
      ).join('') +
      '<span class="ecal-tipo-pill ecal-tipo-pill--cont"><span class="ecal-tipo-dot ecal-tipo-dot--cont"></span>Continúa de otro día</span>';
    const grid = document.getElementById('electroCalGrid');
    if (grid) wrap.insertBefore(el, grid);
  }

  function renderLeyendaDia(fecha) {
    const el = document.getElementById('electroCalLegend');
    if (!el) return;
    const dia = calDatos[fecha] || { total: 0, inicio: 0, continuacion: 0, porTipo: {}, porTipoInicio: {}, porTipoCont: {} };
    const parts = TIPOS.map((t) => {
      const n = parseInt(dia.porTipo?.[t.key], 10) || 0;
      if (!n) return '';
      const ni = parseInt(dia.porTipoInicio?.[t.key], 10) || 0;
      const nc = parseInt(dia.porTipoCont?.[t.key], 10) || 0;
      const detalle = nc > 0 && ni > 0 ? ` (${ni} inicio, ${nc} cont.)` : (nc > 0 ? ` (${nc} cont.)` : '');
      return `<span class="ecal-legend-item" title="${escapeHtml(t.label)}${escapeHtml(detalle)}">
        <span class="ecal-legend-dot" style="background:${t.color}"></span>
        <span class="ecal-legend-label">${escapeHtml(t.label)}</span>
        <strong class="ecal-legend-num">${n}</strong>
      </span>`;
    }).filter(Boolean);
    const total = parseInt(dia.total, 10) || 0;
    const cont = parseInt(dia.continuacion, 10) || 0;
    const contBadge = cont > 0
      ? `<span class="ecal-legend-cont-badge" title="Estudios que siguen desde un día anterior">${cont} en continuación</span>`
      : '';
    el.innerHTML = parts.length
      ? `<span class="ecal-legend-title">${escapeHtml(fecha)} · ${total} estudio(s)${contBadge}</span>${parts.join('')}`
      : `<span class="ecal-legend-title">${escapeHtml(fecha)} · sin estudios</span>`;
  }

  function marcarDiaSeleccionado(fecha) {
    document.querySelectorAll('#electroCalGrid .ecal-cell').forEach((cell) => {
      cell.classList.toggle('ecal-selected', cell.dataset.fecha === fecha);
    });
    renderLeyendaDia(fecha);
  }

  /** Segmentos de barra: sólido = inicio ese día, rayado = continuación. */
  function segmentosDia(info) {
    const segs = [];
    const inicio = info.porTipoInicio || info.porTipo || {};
    const cont = info.porTipoCont || {};
    TIPOS.forEach((t) => {
      const ni = parseInt(inicio[t.key], 10) || 0;
      const nc = parseInt(cont[t.key], 10) || 0;
      for (let i = 0; i < ni; i++) segs.push({ color: t.color, cont: false, label: t.label });
      for (let i = 0; i < nc; i++) segs.push({ color: t.color, cont: true, label: t.label });
    });
    return segs;
  }

  function htmlBarraEstudios(segs, total) {
    if (!total) return '<span class="ecal-track" aria-hidden="true"></span>';
    const maxVis = 10;
    const vis = segs.slice(0, maxVis);
    const extra = segs.length - maxVis;
    let html = '<span class="ecal-track" aria-hidden="true">';
    vis.forEach((s) => {
      html += `<span class="ecal-seg${s.cont ? ' ecal-seg--cont' : ''}" style="--c:${s.color}" title="${escapeHtml(s.label)}${s.cont ? ' (continúa)' : ''}"></span>`;
    });
    if (extra > 0) html += `<span class="ecal-seg ecal-seg--more" title="+${extra} más">+</span>`;
    html += '</span>';
    return html;
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
      const info = calDatos[fecha] || { total: 0, inicio: 0, continuacion: 0, porTipo: {}, porTipoInicio: {}, porTipoCont: {} };
      const total = parseInt(info.total, 10) || 0;
      const cont = parseInt(info.continuacion, 10) || 0;
      const esHoy = fecha === hoy;
      const esSel = fecha === sel;
      const segs = segmentosDia(info);
      const inicio = parseInt(info.inicio, 10) || 0;
      const clases = [
        'ecal-cell',
        total > 0 ? 'ecal-cell--busy' : 'ecal-cell--idle',
        esHoy ? 'ecal-hoy' : '',
        esSel ? 'ecal-selected' : '',
        cont > 0 && inicio === 0 ? 'ecal-cell--solo-cont' : '',
        cont > 0 && inicio > 0 ? 'ecal-cell--mix' : ''
      ].filter(Boolean).join(' ');
      const title = cont > 0
        ? `${total} estudio(s) (${inicio} inicio, ${cont} continuación)`
        : (total > 0 ? `${total} estudio(s)` : 'Sin estudios');
      const badge = total > 0
        ? `<span class="ecal-count" aria-label="${total} estudios">${total}</span>`
        : '';
      html += `<button type="button" class="${clases}" data-fecha="${fecha}" title="${escapeHtml(title)}">
        <span class="ecal-day">
          <span class="ecal-dia-num">${d}</span>
          ${badge}
        </span>
        ${htmlBarraEstudios(segs, total)}
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
            inicio: parseInt(row.inicio, 10) || 0,
            continuacion: parseInt(row.continuacion, 10) || 0,
            porTipo: row.porTipo || {},
            porTipoInicio: row.porTipoInicio || {},
            porTipoCont: row.porTipoCont || {}
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
    ensureTipoLegend();
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
