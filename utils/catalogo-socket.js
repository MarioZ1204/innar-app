/**
 * Eventos de catálogo para invalidar cachés en otras pestañas/usuarios.
 */
'use strict';

const socketEmitter = require('./socket-emitter');

const EVENTOS_POR_TIPO = {
  especialidades: 'especialidades:actualizado',
  tipos_consulta: 'tipos-consulta:actualizado',
  entidades: 'entidades:actualizado',
  estudio_duraciones: 'estudio:actualizado',
  diagnosticos: 'diagnosticos:actualizado',
  anexo_fidu_servicios: 'anexo-fidu:servicios-actualizado'
};

function eventoCatalogo(tipo) {
  return EVENTOS_POR_TIPO[tipo] || null;
}

function emitCatalogoActualizado(tipo, extra = {}) {
  const eventName = eventoCatalogo(tipo);
  if (!eventName) return false;
  socketEmitter.emit(eventName, extra);
  return true;
}

module.exports = {
  EVENTOS_POR_TIPO,
  eventoCatalogo,
  emitCatalogoActualizado
};
