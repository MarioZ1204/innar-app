/**
 * Cupos de pacientes por entidad y día (Programar Agenda → Ver Citas).
 */
const ESTADOS_OCUPAN_CUPO = [
  'PENDIENTE', 'EN_ESPERA', 'EN_SALA', 'EN_ATENCION', 'ATENDIDO', 'NO_ASISTIO', 'COMPLETADO'
];

function normalizarEntidadNombre(raw) {
  return String(raw || '').trim();
}

function claveEntidad(raw) {
  return normalizarEntidadNombre(raw).toUpperCase();
}

const CREATE_CUPOS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS doctor_cupos_entidad_dia (
    id INT AUTO_INCREMENT PRIMARY KEY,
    doctor_id INT NOT NULL,
    fecha DATE NOT NULL,
    entidad VARCHAR(200) NOT NULL,
    cupo_max INT NOT NULL DEFAULT 0,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_doctor_fecha_entidad (doctor_id, fecha, entidad),
    INDEX idx_doctor_fecha (doctor_id, fecha)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
`;

let _tablaCuposVerificada = false;

async function ensureCuposEntidadTable(db) {
  if (_tablaCuposVerificada) return;
  await db.execute(CREATE_CUPOS_TABLE_SQL);
  _tablaCuposVerificada = true;
}

/** Asegura la tabla fuera de transacciones (evita COMMIT implícito por DDL en MySQL). */
async function prepararTablaCuposEntidad(db) {
  try {
    await ensureCuposEntidadTable(db);
    return true;
  } catch (_) {
    _tablaCuposVerificada = false;
    return false;
  }
}

async function listarCuposDia(doctorId, fecha, db) {
  try {
    await ensureCuposEntidadTable(db);
  } catch (_) {
    return [];
  }
  try {
    const rows = await db.execute(
      `SELECT entidad, cupo_max FROM doctor_cupos_entidad_dia
       WHERE doctor_id = ? AND fecha = ?
       ORDER BY entidad ASC`,
      [doctorId, fecha]
    );
    return (rows || []).map((r) => ({
      entidad: normalizarEntidadNombre(r.entidad),
      cupo_max: Math.max(0, parseInt(r.cupo_max, 10) || 0)
    })).filter((r) => r.entidad && r.cupo_max > 0);
  } catch (_) {
    return [];
  }
}

async function listarCuposMes(doctorId, mes, db) {
  if (!mes || !/^\d{4}-\d{2}$/.test(mes)) return [];
  try {
    await ensureCuposEntidadTable(db);
  } catch (_) {
    return [];
  }
  try {
    const rows = await db.execute(
      `SELECT fecha, entidad, cupo_max FROM doctor_cupos_entidad_dia
       WHERE doctor_id = ? AND DATE_FORMAT(fecha, '%Y-%m') = ?
       ORDER BY fecha ASC, entidad ASC`,
      [doctorId, mes]
    );
    return (rows || []).map((r) => ({
      fecha: typeof r.fecha === 'string' ? r.fecha.slice(0, 10) : new Date(r.fecha).toISOString().slice(0, 10),
      entidad: normalizarEntidadNombre(r.entidad),
      cupo_max: Math.max(0, parseInt(r.cupo_max, 10) || 0)
    })).filter((r) => r.entidad && r.cupo_max > 0);
  } catch (_) {
    return [];
  }
}

async function contarOcupadosPorEntidad(doctorId, fecha, db) {
  const placeholders = ESTADOS_OCUPAN_CUPO.map(() => '?').join(',');
  const rows = await db.execute(
    `SELECT entidad, COUNT(*) AS cnt FROM turnos
     WHERE doctor_id = ? AND fecha = ?
       AND estado IN (${placeholders})
     GROUP BY entidad`,
    [doctorId, fecha, ...ESTADOS_OCUPAN_CUPO]
  );
  /** @type {Map<string, { entidad: string, ocupados: number }>} */
  const map = new Map();
  for (const r of rows || []) {
    const key = claveEntidad(r.entidad);
    if (!key) continue;
    const prev = map.get(key);
    const cnt = parseInt(r.cnt, 10) || 0;
    if (prev) prev.ocupados += cnt;
    else map.set(key, { entidad: normalizarEntidadNombre(r.entidad), ocupados: cnt });
  }
  return map;
}

async function resumenCuposDia(doctorId, fecha, db) {
  const cupos = await listarCuposDia(doctorId, fecha, db);
  if (!cupos.length) return [];
  const ocupadosMap = await contarOcupadosPorEntidad(doctorId, fecha, db);
  return cupos.map((c) => {
    const occ = ocupadosMap.get(claveEntidad(c.entidad));
    const ocupados = occ ? occ.ocupados : 0;
    return {
      entidad: c.entidad,
      cupo_max: c.cupo_max,
      ocupados,
      libres: Math.max(0, c.cupo_max - ocupados)
    };
  });
}

async function diaTieneCuposEntidad(doctorId, fecha, db) {
  const cupos = await listarCuposDia(doctorId, fecha, db);
  return cupos.length > 0;
}

/**
 * Valida si se puede agendar `cantidad` citas para entidad en fecha.
 * @returns {{ valido: boolean, razon?: string, resumen?: object[] }}
 */
async function validarCupoEntidad(doctorId, fecha, entidad, db, cantidad = 1) {
  const entidadNorm = normalizarEntidadNombre(entidad);
  if (!entidadNorm) {
    return { valido: false, razon: 'Debe seleccionar una entidad' };
  }

  const cupos = await listarCuposDia(doctorId, fecha, db);
  if (!cupos.length) {
    return { valido: true, sinCuposProgramados: true };
  }

  const cupoEnt = cupos.find((c) => claveEntidad(c.entidad) === claveEntidad(entidadNorm));
  if (!cupoEnt) {
    // Sin cupo programado para esta entidad: agendar con reglas normales (horario).
    return { valido: true, sinCupoProgramadoParaEntidad: true };
  }

  const resumen = await resumenCuposDia(doctorId, fecha, db);
  const fila = resumen.find((r) => claveEntidad(r.entidad) === claveEntidad(entidadNorm));
  const libres = fila ? fila.libres : cupoEnt.cupo_max;

  if (libres < cantidad) {
    return {
      valido: false,
      razon: `Sin cupos de ${entidadNorm} para este día (${fila?.ocupados ?? 0}/${cupoEnt.cupo_max} ocupados)`,
      resumen
    };
  }

  return { valido: true, resumen };
}

async function guardarCuposEntidadDia(conn, doctorId, fecha, cuposEntidad, opts = {}) {
  if (opts.ensureTable !== false) {
    await ensureCuposEntidadTable(conn);
  }
  await conn.execute(
    'DELETE FROM doctor_cupos_entidad_dia WHERE doctor_id = ? AND fecha = ?',
    [doctorId, fecha]
  );

  const items = Array.isArray(cuposEntidad) ? cuposEntidad : [];
  /** @type {Map<string, number>} */
  const dedupe = new Map();
  for (const raw of items) {
    const entidad = normalizarEntidadNombre(raw?.entidad);
    const cupoMax = Math.max(0, parseInt(raw?.cupo_max ?? raw?.cupo, 10) || 0);
    if (!entidad || cupoMax <= 0) continue;
    dedupe.set(claveEntidad(entidad), cupoMax);
  }

  for (const [key, cupoMax] of dedupe) {
    const entidad = items.find((x) => claveEntidad(x.entidad) === key)?.entidad || key;
    await conn.execute(
      `INSERT INTO doctor_cupos_entidad_dia (doctor_id, fecha, entidad, cupo_max)
       VALUES (?, ?, ?, ?)`,
      [doctorId, fecha, normalizarEntidadNombre(entidad), cupoMax]
    );
  }
}

async function eliminarCuposEntidadDia(conn, doctorId, fecha, opts = {}) {
  if (opts.ensureTable !== false) {
    await ensureCuposEntidadTable(conn);
  }
  await conn.execute(
    'DELETE FROM doctor_cupos_entidad_dia WHERE doctor_id = ? AND fecha = ?',
    [doctorId, fecha]
  );
}

function totalesDesdeResumen(resumen) {
  const items = Array.isArray(resumen) ? resumen : [];
  const capacidad = items.reduce((s, r) => s + (r.cupo_max || 0), 0);
  const ocupados = items.reduce((s, r) => s + (r.ocupados || 0), 0);
  return {
    capacidad,
    ocupados,
    libres: Math.max(0, capacidad - ocupados),
    resumen: items
  };
}

module.exports = {
  ESTADOS_OCUPAN_CUPO,
  normalizarEntidadNombre,
  claveEntidad,
  ensureCuposEntidadTable,
  prepararTablaCuposEntidad,
  listarCuposDia,
  listarCuposMes,
  contarOcupadosPorEntidad,
  resumenCuposDia,
  diaTieneCuposEntidad,
  validarCupoEntidad,
  guardarCuposEntidadDia,
  eliminarCuposEntidadDia,
  totalesDesdeResumen
};
