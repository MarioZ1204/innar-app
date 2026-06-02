/**
 * Valores seguros para res.json() (BigInt, Buffer, etc.).
 */
function jsonSafeValue(v) {
  if (v == null) return v;
  if (typeof v === 'bigint') return Number(v);
  if (Buffer.isBuffer(v)) return v.toString('utf8');
  if (v instanceof Date) return v.toISOString();
  return v;
}

function jsonSafeRow(row) {
  if (!row || typeof row !== 'object') return row;
  const out = {};
  for (const [k, val] of Object.entries(row)) {
    out[k] = jsonSafeValue(val);
  }
  return out;
}

module.exports = { jsonSafeValue, jsonSafeRow };
