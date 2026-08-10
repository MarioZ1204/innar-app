/**
 * Motivos de día en agenda médica — colores y clases CSS compartidas.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    Object.assign(root, api);
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this, function () {
  const MOTIVOS_AGENDA_DIA = [
    { id: 'ucqn', label: 'UCQN', ccal: 'ccal-motivo-ucqn', cal: 'cal-motivo-ucqn' },
    { id: 'hospital', label: 'Hospital departamental', ccal: 'ccal-motivo-hospital', cal: 'cal-motivo-hospital' },
    { id: 'personal', label: 'Cita médica personal', ccal: 'ccal-motivo-personal', cal: 'cal-motivo-personal' },
    { id: 'vacaciones', label: 'Vacaciones', ccal: 'ccal-motivo-vacaciones', cal: 'cal-motivo-vacaciones' },
    { id: 'capacitacion', label: 'Capacitación', ccal: 'ccal-motivo-capacitacion', cal: 'cal-motivo-capacitacion' },
    { id: 'festivo', label: 'Festivo', ccal: 'ccal-motivo-festivo', cal: 'cal-motivo-festivo', ausencia: true }
  ];

  const OPCIONES_MOTIVO_AGENDA = [
    '',
    ...MOTIVOS_AGENDA_DIA.map((m) => m.label),
    'Otro'
  ];

  const POR_LABEL = new Map(
    MOTIVOS_AGENDA_DIA.flatMap((m) => [
      [m.label.toUpperCase(), m],
      [m.label.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase(), m]
    ])
  );

  function normalizarTextoMotivo(motivo) {
    return String(motivo || '')
      .trim()
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toUpperCase();
  }

  function idMotivoAgenda(motivo) {
    const t = String(motivo || '').trim();
    if (!t) return null;
    const hit = POR_LABEL.get(t.toUpperCase()) || POR_LABEL.get(normalizarTextoMotivo(t));
    return hit ? hit.id : 'otro';
  }

  function metaMotivoAgenda(motivo) {
    const id = idMotivoAgenda(motivo);
    if (!id || id === 'otro') return null;
    return MOTIVOS_AGENDA_DIA.find((m) => m.id === id) || null;
  }

  /** Día bloqueado (no asiste) → rojo; festivo → rojo; resto por motivo. */
  function claseCcalPorDiaAgenda({
    motivo,
    bloqueado,
    esDomingo,
    hayDispConfig,
    datos,
    citasActivas,
    totalDia
  }) {
    const meta = metaMotivoAgenda(motivo);
    const id = meta?.id || (motivo ? 'otro' : null);

    if (bloqueado && !esDomingo) return 'ccal-ausente';
    if (id === 'festivo') return 'ccal-motivo-festivo';
    if (meta) return meta.ccal;
    if (motivo) return 'ccal-motivo-otro';

    if (esDomingo || (hayDispConfig && bloqueado)) return 'ccal-bloqueado';

    const E = citasActivas != null ? citasActivas : 0;
    const total = totalDia != null ? totalDia : 0;
    if (datos && ((datos.no_asistieron > 0) || (datos.canceladas > 0))) return 'ccal-rojo';
    if (datos && datos.reprogramadas > 0) return 'ccal-azul';
    if (E > 10 || total > 10) return 'ccal-verde';
    if (E >= 1 || total >= 1) return 'ccal-amarillo';
    return 'ccal-neutro';
  }

  function claseCalProgramarPorDia({ motivo, estadoDia }) {
    const meta = metaMotivoAgenda(motivo);
    if (meta) return meta.cal;
    if (motivo) return 'cal-motivo-otro';
    if (estadoDia === 'unavailable') return 'cal-unavailable';
    if (estadoDia === 'full') return 'cal-available';
    if (estadoDia === 'partial') return 'cal-partial';
    return 'cal-none';
  }

  function etiquetaMotivoAgenda(motivo) {
    const t = String(motivo || '').trim();
    return t || 'Sin observación';
  }

  function esMotivoListaPredefinida(motivo) {
    const t = String(motivo || '').trim();
    return OPCIONES_MOTIVO_AGENDA.includes(t) && t !== 'Otro';
  }

  return {
    MOTIVOS_AGENDA_DIA,
    OPCIONES_MOTIVO_AGENDA,
    idMotivoAgenda,
    metaMotivoAgenda,
    claseCcalPorDiaAgenda,
    claseCalProgramarPorDia,
    etiquetaMotivoAgenda,
    esMotivoListaPredefinida
  };
});
