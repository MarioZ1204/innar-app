/** insertId de mysql2 (puede ser number o bigint). */
function insertRowId(result) {
  if (!result) return 0;
  const id = result.insertId;
  if (id == null || id === 0) return 0;
  return typeof id === 'bigint' ? Number(id) : Number(id);
}

module.exports = { insertRowId };
