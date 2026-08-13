'use strict';

const ESTADOS_CITA_AGENDADA = ['PENDIENTE', 'EN_ESPERA', 'EN_SALA', 'EN_ATENCION'];

function normalizarDocumento(val) {
  return String(val || '').replace(/\D/g, '');
}

function normalizarTipoConsulta(val) {
  return String(val || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

/**
 * Misma persona (documento) + mismo tipo de consulta, cita aún vigente.
 */
function turnoEsCitaDuplicadaTipo(turno, filtro = {}) {
  if (!turno) return false;
  const estado = String(turno.estado || '').trim().toUpperCase();
  if (!ESTADOS_CITA_AGENDADA.includes(estado)) return false;

  const docFiltro = normalizarDocumento(filtro.paciente_documento);
  const tipoFiltro = normalizarTipoConsulta(filtro.tipo_consulta);
  if (!docFiltro || !tipoFiltro) return false;
  if (normalizarDocumento(turno.paciente_documento) !== docFiltro) return false;
  if (normalizarTipoConsulta(turno.tipo_consulta) !== tipoFiltro) return false;
  return true;
}

function filtrarCitasMismoTipo(turnos, filtro) {
  return (Array.isArray(turnos) ? turnos : []).filter((t) => turnoEsCitaDuplicadaTipo(t, filtro));
}

module.exports = {
  ESTADOS_CITA_AGENDADA,
  normalizarDocumento,
  normalizarTipoConsulta,
  turnoEsCitaDuplicadaTipo,
  filtrarCitasMismoTipo
};
