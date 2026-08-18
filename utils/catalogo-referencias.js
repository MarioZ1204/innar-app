/**
 * Catálogos guardados como texto en citas/recibos (sin FK).
 * Renombrar actualiza referencias en transacción; borrar se bloquea si hay usos.
 */
'use strict';

const { httpError } = require('./locks-concurrencia');

const TIPOS_CATALOGO = new Set([
  'estudio_duraciones',
  'especialidades',
  'tipos_consulta',
  'diagnosticos',
  'entidades',
  'anexo_fidu_servicios'
]);

const USO_LABELS = {
  turnos: 'turno(s)',
  citas_electro: 'cita(s) de electro',
  recibos: 'recibo(s)',
  cupos: 'cupo(s) de agenda',
  usuarios: 'usuario(s)',
  tipos_consulta: 'tipo(s) de consulta',
  pacientes_espera: 'paciente(s) en espera'
};

function esTipoCatalogoGestion(tipo) {
  return TIPOS_CATALOGO.has(tipo);
}

function limiteListadoGestion(tipo, reqLimit) {
  const catalogo = esTipoCatalogoGestion(tipo);
  const max = catalogo ? 5000 : 500;
  const fallback = catalogo ? 2000 : 100;
  const n = parseInt(reqLimit, 10);
  return Math.min(Number.isFinite(n) && n > 0 ? n : fallback, max);
}

function throwEnUso(mensaje, usos) {
  throw httpError(409, mensaje, { en_uso: true, usos: usos || {} });
}

function formatUsos(usos) {
  return Object.entries(usos || {})
    .filter(([, n]) => Number(n) > 0)
    .map(([k, n]) => `${n} ${USO_LABELS[k] || k}`)
    .join(', ');
}

function totalUsos(usos) {
  return Object.values(usos || {}).reduce((acc, n) => acc + Number(n || 0), 0);
}

async function countWhere(db, sql, params = []) {
  try {
    const rows = await db.query(sql, params);
    return Number(rows?.[0]?.c || 0);
  } catch (e) {
    if (e && (e.code === 'ER_NO_SUCH_TABLE' || e.code === 'ER_BAD_FIELD_ERROR')) return 0;
    throw e;
  }
}

async function executeQuiet(conn, sql, params = []) {
  try {
    return await conn.execute(sql, params);
  } catch (e) {
    if (e && (e.code === 'ER_NO_SUCH_TABLE' || e.code === 'ER_BAD_FIELD_ERROR')) return { affectedRows: 0 };
    throw e;
  }
}

async function queryQuiet(conn, sql, params = []) {
  try {
    return await conn.query(sql, params);
  } catch (e) {
    if (e && (e.code === 'ER_NO_SUCH_TABLE' || e.code === 'ER_BAD_FIELD_ERROR')) return [];
    throw e;
  }
}

async function queryOne(db, sql, params = []) {
  if (typeof db.queryOne === 'function') {
    return db.queryOne(sql, params);
  }
  const rows = await db.query(sql, params);
  return rows && rows[0] ? rows[0] : null;
}

function nombresDistintos(a, b) {
  return String(a || '').trim().toLowerCase() !== String(b || '').trim().toLowerCase();
}

async function usosEntidadPorNombre(db, nombre) {
  const n = String(nombre || '').trim();
  if (!n) {
    return { turnos: 0, citas_electro: 0, recibos: 0, cupos: 0, pacientes_espera: 0 };
  }
  const [turnos, citas_electro, recibos, cupos, pacientes_espera] = await Promise.all([
    countWhere(db, 'SELECT COUNT(*) AS c FROM turnos WHERE UPPER(TRIM(COALESCE(entidad, ""))) = UPPER(TRIM(?))', [n]),
    countWhere(db, 'SELECT COUNT(*) AS c FROM citas_electro WHERE deleted_at IS NULL AND UPPER(TRIM(COALESCE(entidad, ""))) = UPPER(TRIM(?))', [n]),
    countWhere(db, 'SELECT COUNT(*) AS c FROM recibos WHERE UPPER(TRIM(COALESCE(nombre_entidad, ""))) = UPPER(TRIM(?))', [n]),
    countWhere(db, 'SELECT COUNT(*) AS c FROM doctor_cupos_entidad_dia WHERE UPPER(TRIM(COALESCE(entidad, ""))) = UPPER(TRIM(?))', [n]),
    countWhere(db, 'SELECT COUNT(*) AS c FROM pacientes_espera WHERE UPPER(TRIM(COALESCE(entidad, ""))) = UPPER(TRIM(?))', [n])
  ]);
  return { turnos, citas_electro, recibos, cupos, pacientes_espera };
}

async function fusionarCuposEntidad(conn, anterior, nuevo) {
  const rows = await queryQuiet(
    conn,
    'SELECT id, doctor_id, fecha, cupo_max FROM doctor_cupos_entidad_dia WHERE UPPER(TRIM(entidad)) = UPPER(TRIM(?))',
    [anterior]
  );
  for (const row of rows || []) {
    const dest = await queryQuiet(
      conn,
      `SELECT id, cupo_max FROM doctor_cupos_entidad_dia
       WHERE doctor_id = ? AND fecha = ? AND UPPER(TRIM(entidad)) = UPPER(TRIM(?)) LIMIT 1`,
      [row.doctor_id, row.fecha, nuevo]
    );
    if (dest[0] && Number(dest[0].id) !== Number(row.id)) {
      const merged = Math.max(Number(dest[0].cupo_max || 0), Number(row.cupo_max || 0));
      await executeQuiet(conn, 'UPDATE doctor_cupos_entidad_dia SET cupo_max = ? WHERE id = ?', [merged, dest[0].id]);
      await executeQuiet(conn, 'DELETE FROM doctor_cupos_entidad_dia WHERE id = ?', [row.id]);
    } else {
      await executeQuiet(conn, 'UPDATE doctor_cupos_entidad_dia SET entidad = ? WHERE id = ?', [nuevo, row.id]);
    }
  }
}

async function propagarTextosEntidad(conn, anterior, nuevo) {
  await fusionarCuposEntidad(conn, anterior, nuevo);
  await conn.execute(
    'UPDATE turnos SET entidad = ? WHERE UPPER(TRIM(COALESCE(entidad, ""))) = UPPER(TRIM(?))',
    [nuevo, anterior]
  );
  await conn.execute(
    'UPDATE citas_electro SET entidad = ? WHERE UPPER(TRIM(COALESCE(entidad, ""))) = UPPER(TRIM(?))',
    [nuevo, anterior]
  );
  await conn.execute(
    'UPDATE recibos SET nombre_entidad = ? WHERE UPPER(TRIM(COALESCE(nombre_entidad, ""))) = UPPER(TRIM(?))',
    [nuevo, anterior]
  );
  await executeQuiet(
    conn,
    'UPDATE pacientes_espera SET entidad = ? WHERE UPPER(TRIM(COALESCE(entidad, ""))) = UPPER(TRIM(?))',
    [nuevo, anterior]
  );
}

async function usosTipoConsultaPorNombre(db, nombre, especialidadNombre) {
  const n = String(nombre || '').trim();
  if (!n) return { turnos: 0, recibos: 0 };
  const esp = String(especialidadNombre || '').trim();
  let turnos;
  if (esp) {
    turnos = await countWhere(
      db,
      `SELECT COUNT(*) AS c FROM turnos t
       LEFT JOIN usuarios u ON u.id = t.doctor_id
       WHERE LOWER(TRIM(COALESCE(t.tipo_consulta, ""))) = LOWER(TRIM(?))
         AND LOWER(TRIM(COALESCE(u.especialidad, ""))) = LOWER(TRIM(?))`,
      [n, esp]
    );
  } else {
    turnos = await countWhere(
      db,
      'SELECT COUNT(*) AS c FROM turnos WHERE LOWER(TRIM(COALESCE(tipo_consulta, ""))) = LOWER(TRIM(?))',
      [n]
    );
  }
  const recibos = await countWhere(
    db,
    'SELECT COUNT(*) AS c FROM recibos WHERE LOWER(TRIM(COALESCE(tipo_servicio, ""))) = LOWER(TRIM(?))',
    [n]
  );
  return { turnos, recibos };
}

async function propagarTextosTipoConsulta(conn, anterior, nuevo, especialidadNombre) {
  const esp = String(especialidadNombre || '').trim();
  if (esp) {
    await conn.execute(
      `UPDATE turnos t
       JOIN usuarios u ON u.id = t.doctor_id
       SET t.tipo_consulta = ?
       WHERE LOWER(TRIM(COALESCE(t.tipo_consulta, ""))) = LOWER(TRIM(?))
         AND LOWER(TRIM(COALESCE(u.especialidad, ""))) = LOWER(TRIM(?))`,
      [nuevo, anterior, esp]
    );
  } else {
    await conn.execute(
      'UPDATE turnos SET tipo_consulta = ? WHERE LOWER(TRIM(COALESCE(tipo_consulta, ""))) = LOWER(TRIM(?))',
      [nuevo, anterior]
    );
  }
  await conn.execute(
    'UPDATE recibos SET tipo_servicio = ? WHERE LOWER(TRIM(COALESCE(tipo_servicio, ""))) = LOWER(TRIM(?))',
    [nuevo, anterior]
  );
}

async function usosEspecialidad(db, id, nombre) {
  const [tipos_consulta, usuarios] = await Promise.all([
    countWhere(db, 'SELECT COUNT(*) AS c FROM tipos_consulta WHERE especialidad_id = ?', [id]),
    countWhere(
      db,
      'SELECT COUNT(*) AS c FROM usuarios WHERE LOWER(TRIM(COALESCE(especialidad, ""))) = LOWER(TRIM(?))',
      [nombre]
    )
  ]);
  return { tipos_consulta, usuarios };
}

async function usosEstudioPorNombre(db, nombre) {
  const n = String(nombre || '').trim();
  if (!n) return { citas_electro: 0, recibos: 0, pacientes_espera: 0 };
  const [citas_electro, recibos, pacientes_espera] = await Promise.all([
    countWhere(
      db,
      'SELECT COUNT(*) AS c FROM citas_electro WHERE deleted_at IS NULL AND LOWER(TRIM(COALESCE(estudio, ""))) = LOWER(TRIM(?))',
      [n]
    ),
    countWhere(
      db,
      'SELECT COUNT(*) AS c FROM recibos WHERE LOWER(TRIM(COALESCE(tipo_servicio, ""))) = LOWER(TRIM(?))',
      [n]
    ),
    countWhere(
      db,
      'SELECT COUNT(*) AS c FROM pacientes_espera WHERE LOWER(TRIM(COALESCE(tipo_estudio, ""))) = LOWER(TRIM(?))',
      [n]
    )
  ]);
  return { citas_electro, recibos, pacientes_espera };
}

async function usosDiagnostico(db, id) {
  const citas_electro = await countWhere(
    db,
    'SELECT COUNT(*) AS c FROM citas_electro WHERE deleted_at IS NULL AND diagnostico_id = ?',
    [id]
  );
  return { citas_electro };
}

async function assertEntidadEliminable(db, id) {
  const row = await queryOne(db, 'SELECT id, nombre FROM entidades WHERE id = ?', [id]);
  if (!row) throw httpError(404, 'Entidad no encontrada');
  const usos = await usosEntidadPorNombre(db, row.nombre);
  if (totalUsos(usos) > 0) {
    throwEnUso(`No se puede eliminar la entidad: está en uso (${formatUsos(usos)}). Renómbrela en su lugar.`, usos);
  }
  return row;
}

async function assertTipoConsultaEliminable(db, id) {
  const row = await queryOne(
    db,
    `SELECT tc.id, tc.nombre, e.nombre AS especialidad
     FROM tipos_consulta tc LEFT JOIN especialidades e ON e.id = tc.especialidad_id
     WHERE tc.id = ?`,
    [id]
  );
  if (!row) throw httpError(404, 'Tipo de consulta no encontrado');
  const usos = await usosTipoConsultaPorNombre(db, row.nombre, row.especialidad);
  if (totalUsos(usos) > 0) {
    throwEnUso(`No se puede eliminar el tipo de consulta: está en uso (${formatUsos(usos)}). Renómbrelo en su lugar.`, usos);
  }
  return row;
}

async function assertEspecialidadEliminable(db, id) {
  const row = await queryOne(db, 'SELECT id, nombre FROM especialidades WHERE id = ?', [id]);
  if (!row) throw httpError(404, 'Especialidad no encontrada');
  const usos = await usosEspecialidad(db, id, row.nombre);
  if (totalUsos(usos) > 0) {
    throwEnUso(
      `No se puede eliminar la especialidad: está en uso (${formatUsos(usos)}). Borre primero los tipos de consulta o renómbrela.`,
      usos
    );
  }
  return row;
}

async function assertEstudioEliminable(db, id) {
  const row = await queryOne(db, 'SELECT id, nombre FROM estudio_duraciones WHERE id = ?', [id]);
  if (!row) throw httpError(404, 'Tipo de estudio no encontrado');
  const usos = await usosEstudioPorNombre(db, row.nombre);
  if (totalUsos(usos) > 0) {
    throwEnUso(`No se puede eliminar el tipo de estudio: está en uso (${formatUsos(usos)}). Renómbrelo en su lugar.`, usos);
  }
  return row;
}

async function assertDiagnosticoEliminable(db, id) {
  const row = await queryOne(db, 'SELECT id, nombre FROM diagnosticos WHERE id = ?', [id]);
  if (!row) throw httpError(404, 'Diagnóstico no encontrado');
  const usos = await usosDiagnostico(db, id);
  if (totalUsos(usos) > 0) {
    throwEnUso(`No se puede eliminar el diagnóstico: está en uso (${formatUsos(usos)}).`, usos);
  }
  return row;
}

async function assertCatalogoEliminable(db, tipo, id) {
  if (tipo === 'entidades') return assertEntidadEliminable(db, id);
  if (tipo === 'tipos_consulta') return assertTipoConsultaEliminable(db, id);
  if (tipo === 'especialidades') return assertEspecialidadEliminable(db, id);
  if (tipo === 'estudio_duraciones') return assertEstudioEliminable(db, id);
  if (tipo === 'diagnosticos') return assertDiagnosticoEliminable(db, id);
  return null;
}

async function assertCatalogoEliminableBulk(db, tipo, ids) {
  if (!esTipoCatalogoGestion(tipo) || tipo === 'anexo_fidu_servicios') return;
  for (const id of ids) {
    await assertCatalogoEliminable(db, tipo, id);
  }
}

async function conTransaccion(db, fn) {
  if (typeof db.transaction === 'function') {
    return db.transaction(fn);
  }
  return fn(db);
}

async function persistirEntidadConReferencias(db, { id, nombreNuevo, camposSql, values }) {
  await conTransaccion(db, async (conn) => {
    const actual = (await conn.query('SELECT nombre FROM entidades WHERE id = ?', [id]))[0];
    if (!actual) throw httpError(404, 'Entidad no encontrada');
    const result = await conn.execute(`UPDATE entidades SET ${camposSql} WHERE id = ?`, values);
    if (!result.affectedRows) throw httpError(404, 'Entidad no encontrada');
    if (nombreNuevo && nombresDistintos(actual.nombre, nombreNuevo)) {
      await propagarTextosEntidad(conn, actual.nombre, nombreNuevo);
    }
  });
}

async function persistirTipoConsultaConReferencias(db, { id, nombreNuevo, camposSql, values }) {
  await conTransaccion(db, async (conn) => {
    const actual = (await conn.query(
      `SELECT tc.nombre, e.nombre AS especialidad
       FROM tipos_consulta tc LEFT JOIN especialidades e ON e.id = tc.especialidad_id
       WHERE tc.id = ?`,
      [id]
    ))[0];
    if (!actual) throw httpError(404, 'Tipo de consulta no encontrado');
    const result = await conn.execute(`UPDATE tipos_consulta SET ${camposSql} WHERE id = ?`, values);
    if (!result.affectedRows) throw httpError(404, 'Tipo de consulta no encontrado');
    if (nombreNuevo && nombresDistintos(actual.nombre, nombreNuevo)) {
      await propagarTextosTipoConsulta(conn, actual.nombre, nombreNuevo, actual.especialidad);
    }
  });
}

async function persistirEspecialidadConReferencias(db, { id, nombreNuevo }) {
  const nuevo = String(nombreNuevo || '').trim();
  if (!nuevo) throw httpError(400, 'El nombre es obligatorio');
  await conTransaccion(db, async (conn) => {
    const actual = (await conn.query('SELECT nombre FROM especialidades WHERE id = ?', [id]))[0];
    if (!actual) throw httpError(404, 'Especialidad no encontrada');
    const result = await conn.execute('UPDATE especialidades SET nombre = ? WHERE id = ?', [nuevo, id]);
    if (!result.affectedRows) throw httpError(404, 'Especialidad no encontrada');
    if (nombresDistintos(actual.nombre, nuevo)) {
      await conn.execute(
        'UPDATE usuarios SET especialidad = ? WHERE LOWER(TRIM(COALESCE(especialidad, ""))) = LOWER(TRIM(?))',
        [nuevo, actual.nombre]
      );
    }
  });
}

async function persistirEstudioConReferencias(db, { id, nombreNuevo, camposSql, values }) {
  await conTransaccion(db, async (conn) => {
    const actual = (await conn.query('SELECT nombre FROM estudio_duraciones WHERE id = ?', [id]))[0];
    if (!actual) throw httpError(404, 'Tipo de estudio no encontrado');
    const result = await conn.execute(`UPDATE estudio_duraciones SET ${camposSql} WHERE id = ?`, values);
    if (!result.affectedRows) throw httpError(404, 'Tipo de estudio no encontrado');
    if (nombreNuevo && nombresDistintos(actual.nombre, nombreNuevo)) {
      await conn.execute(
        'UPDATE citas_electro SET estudio = ? WHERE LOWER(TRIM(COALESCE(estudio, ""))) = LOWER(TRIM(?))',
        [nombreNuevo, actual.nombre]
      );
      await conn.execute(
        'UPDATE recibos SET tipo_servicio = ? WHERE LOWER(TRIM(COALESCE(tipo_servicio, ""))) = LOWER(TRIM(?))',
        [nombreNuevo, actual.nombre]
      );
      await executeQuiet(
        conn,
        'UPDATE pacientes_espera SET tipo_estudio = ? WHERE LOWER(TRIM(COALESCE(tipo_estudio, ""))) = LOWER(TRIM(?))',
        [nombreNuevo, actual.nombre]
      );
    }
  });
}

module.exports = {
  TIPOS_CATALOGO,
  esTipoCatalogoGestion,
  limiteListadoGestion,
  formatUsos,
  totalUsos,
  usosEntidadPorNombre,
  usosTipoConsultaPorNombre,
  usosEspecialidad,
  usosEstudioPorNombre,
  usosDiagnostico,
  assertCatalogoEliminable,
  assertCatalogoEliminableBulk,
  persistirEntidadConReferencias,
  persistirTipoConsultaConReferencias,
  persistirEspecialidadConReferencias,
  persistirEstudioConReferencias,
  throwEnUso
};
