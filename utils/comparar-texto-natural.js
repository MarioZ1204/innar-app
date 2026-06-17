/**
 * Orden «natural» de textos con números (1, 2, 10, 11 en lugar de 1, 10, 11, 2).
 */
function compararTextoNatural(a, b) {
  return String(a || '').localeCompare(String(b || ''), 'es', { numeric: true, sensitivity: 'base' });
}

function ordenarPorTextoNatural(list, key, dir = 'asc') {
  const mult = dir === 'desc' ? -1 : 1;
  return [...(list || [])].sort((x, y) => {
    const cmp = compararTextoNatural(x?.[key], y?.[key]);
    return cmp * mult;
  });
}

module.exports = { compararTextoNatural, ordenarPorTextoNatural };
