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

const ESTADOS_ELECTRO_AGENDADA = ['Programado', 'Confirmado', 'En Sala', 'En Estudio', 'Pausado'];

function citaElectroEstaArchivadaReprogramacion(cita) {
  if (cita?.reprogramado_en) return true;
  return /\[Reprogramado\]/i.test(String(cita?.observaciones || ''));
}

/** Mismo documento + mismo estudio, cita electro aún vigente (no reprogramada/archivada). */
function citaElectroEsDuplicadaEstudio(cita, filtro = {}) {
  if (!cita || citaElectroEstaArchivadaReprogramacion(cita)) return false;
  const estado = String(cita.estado || '').trim();
  if (!ESTADOS_ELECTRO_AGENDADA.includes(estado)) return false;
  const docFiltro = normalizarDocumento(filtro.paciente_documento);
  const estudioFiltro = normalizarTipoConsulta(filtro.estudio);
  if (!docFiltro || !estudioFiltro) return false;
  if (normalizarDocumento(cita.paciente_documento) !== docFiltro) return false;
  if (normalizarTipoConsulta(cita.estudio) !== estudioFiltro) return false;
  return true;
}

function filtrarCitasElectroMismoEstudio(citas, filtro) {
  return (Array.isArray(citas) ? citas : []).filter((c) => citaElectroEsDuplicadaEstudio(c, filtro));
}

module.exports = {
  ESTADOS_CITA_AGENDADA,
  ESTADOS_ELECTRO_AGENDADA,
  normalizarDocumento,
  normalizarTipoConsulta,
  turnoEsCitaDuplicadaTipo,
  filtrarCitasMismoTipo,
  citaElectroEsDuplicadaEstudio,
  filtrarCitasElectroMismoEstudio
};
