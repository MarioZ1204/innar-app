const db = require('../utils/db-mysql');
const { buildAnexoFiduCreateTableSql } = require('../utils/anexo-fidu-columns');

(async () => {
  await db.initPool();
  await db.execute(buildAnexoFiduCreateTableSql());
  const rows = await db.query("SHOW TABLES LIKE 'anexo_fidu_registros'");
  console.log(rows.length ? 'OK: anexo_fidu_registros creada' : 'ERROR: no se creó la tabla');
  process.exit(rows.length ? 0 : 1);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
