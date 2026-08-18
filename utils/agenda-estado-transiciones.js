/** Transiciones de estado de agenda médica y electro. Evita atajos vía PATCH genérico. */

const ESTADOS_MANUALES_ELECTRO = new Set([
  'Confirmado', 'En Sala', 'No Asistió', 'Reprogramado', 'Cancelado', 'Adelantado', 'Pausado'
]);

const ORIGENES_INICIO_ESTUDIO = new Set([
  'Programado', 'Confirmado', 'En Sala', 'Reprogramado', 'Adelantado'
]);

function evaluarTransicionElectro(estadoActual, estadoNuevo, { rol } = {}) {
  if (!estadoNuevo || estadoNuevo === estadoActual) {
    return { ok: true, tipo: 'noop' };
  }

  const rolNorm = String(rol || '').toLowerCase();
  const esManual = ESTADOS_MANUALES_ELECTRO.has(estadoNuevo);
  const esReanudar = estadoActual === 'Pausado' && estadoNuevo === 'En Estudio';
  const esRevertir = estadoActual === 'Completado' && estadoNuevo === 'En Estudio';
  const esInicioNuevo = ORIGENES_INICIO_ESTUDIO.has(estadoActual) && estadoNuevo === 'En Estudio';
  const esFin = (estadoActual === 'En Estudio' || estadoActual === 'Pausado') && estadoNuevo === 'Completado';

  if (esRevertir && rolNorm !== 'superadmin') {
    return {
      ok: false,
      status: 403,
      error: 'Solo el superadmin puede devolver un estudio completado a En Estudio.'
    };
  }

  if (!esManual && !esInicioNuevo && !esReanudar && !esFin && !esRevertir) {
    return {
      ok: false,
      status: 400,
      error: `Transición de estado inválida: ${estadoActual} → ${estadoNuevo}`
    };
  }

  if (esRevertir) return { ok: true, tipo: 'reabrir' };
  if (esInicioNuevo || esReanudar) return { ok: true, tipo: 'inicio' };
  if (esFin) return { ok: true, tipo: 'fin' };
  return { ok: true, tipo: 'manual' };
}

function requiereFichaElectroParaTransicion(tipo) {
  return tipo === 'inicio' || tipo === 'fin' || tipo === 'reabrir';
}

function validarTransicionEstadoTurno(estadoActual, estadoNuevo) {
  if (!estadoNuevo || estadoNuevo === estadoActual) return { ok: true };

  if (estadoActual === 'ATENDIDO' && estadoNuevo !== 'ATENDIDO') {
    return { ok: false, status: 400, error: 'No se puede modificar un turno ya atendido' };
  }
  if (estadoActual === 'REPROGRAMADO' && estadoNuevo === 'NO_ASISTIO') {
    return { ok: false, status: 400, error: 'Una cita reprogramada no puede marcarse como no asistió' };
  }
  if (estadoNuevo === 'EN_ATENCION' && estadoActual !== 'EN_SALA') {
    return { ok: false, status: 400, error: 'Solo se puede pasar a EN_ATENCION desde EN_SALA' };
  }
  if (estadoNuevo === 'ATENDIDO' && estadoActual !== 'EN_ATENCION') {
    return { ok: false, status: 400, error: 'Solo se puede marcar ATENDIDO desde EN_ATENCION' };
  }
  return { ok: true };
}

module.exports = {
  ESTADOS_MANUALES_ELECTRO,
  evaluarTransicionElectro,
  requiereFichaElectroParaTransicion,
  validarTransicionEstadoTurno
};
