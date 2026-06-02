/**
 * Visibilidad de carpetas por mes: activa, gracia (5 días), archivo.
 */

const GRACE_DAYS = parseInt(process.env.SOPORTES_GRACE_DAYS || '5', 10);

const RE_PERIODO = /^\d{4}-\d{2}$/;

function isValidPeriodo(periodo) {
  return typeof periodo === 'string' && RE_PERIODO.test(periodo);
}

function periodoFromDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function addMonthsToPeriodo(periodo, delta) {
  if (!isValidPeriodo(periodo)) return periodoFromDate(new Date());
  const [y, m] = periodo.split('-').map(Number);
  const dt = new Date(y, m - 1 + delta, 1);
  return periodoFromDate(dt);
}

function calcularVisibilidadPeriodo(periodo, hoy = new Date()) {
  if (!isValidPeriodo(periodo)) return 'activa';
  const actual = periodoFromDate(hoy);
  if (periodo === actual) return 'activa';
  const anterior = addMonthsToPeriodo(actual, -1);
  if (periodo === anterior && hoy.getDate() <= GRACE_DAYS) return 'gracia';
  return 'archivo';
}

function diasRestantesGracia(periodo, hoy = new Date()) {
  const vis = calcularVisibilidadPeriodo(periodo, hoy);
  if (vis !== 'gracia') return null;
  return GRACE_DAYS - hoy.getDate() + 1;
}

function filtrarPeriodosVisibles(periodos, incluirArchivo) {
  const hoy = new Date();
  return periodos.filter((p) => {
    const v = calcularVisibilidadPeriodo(p.periodo || p, hoy);
    if (v === 'activa' || v === 'gracia') return true;
    return incluirArchivo && v === 'archivo';
  });
}

module.exports = {
  GRACE_DAYS,
  isValidPeriodo,
  periodoFromDate,
  calcularVisibilidadPeriodo,
  diasRestantesGracia,
  filtrarPeriodosVisibles
};
