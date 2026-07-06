/** Días que la cita original permanece visible en su fecha tras reprogramar */
const DIAS_FANTASMA_REPROGRAMADO = 3;

/**
 * Fantasma reprogramado visible si aún no pasaron DIAS_FANTASMA_REPROGRAMADO días
 * desde reprogramado_en (día 0 = día de la reprogramación).
 */
function sqlFantasmaReprogramadoReciente(alias = 't', { estadoCol = 'estado', estadoValor = 'REPROGRAMADO' } = {}) {
  const a = alias;
  return `(
    ${a}.${estadoCol} <> '${estadoValor}'
    OR ${a}.reprogramado_en IS NULL
    OR DATEDIFF(CURDATE(), DATE(${a}.reprogramado_en)) < ${DIAS_FANTASMA_REPROGRAMADO}
  )`;
}

module.exports = {
  DIAS_FANTASMA_REPROGRAMADO,
  sqlFantasmaReprogramadoReciente
};
