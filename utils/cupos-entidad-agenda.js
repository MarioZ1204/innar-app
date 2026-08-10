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

/** Fecha YYYY-MM-DD en zona local (evita desfase UTC con DATE de MySQL). */
function fmtFechaLocal(d) {
  if (d == null || d === '') return '';
  if (typeof d === 'string') return d.slice(0, 10);
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d).slice(0, 10);
  const y = dt.getFullYear();
  const mo = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
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
      fecha: fmtFechaLocal(r.fecha),
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

function _horaAMinutos(hora) {
  const [h, m] = String(hora || '').slice(0, 5).split(':').map((x) => parseInt(x, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

/** 25 min para epileptología/neurología, 40 min para el resto (misma regla que el front). */
async function _intervaloMinDoctor(doctorId, db) {
  try {
    const rows = await db.execute('SELECT especialidad FROM usuarios WHERE id = ?', [doctorId]);
    const espNorm = String(rows?.[0]?.especialidad || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    if (espNorm.includes('epileptolog') || espNorm.includes('neurolog')) return 25;
    return 40;
  } catch (_) {
    return 40;
  }
}

/**
 * Calcula el total de cupos (slots) físicos disponibles en el día, según jornada
 * configurada (mañana/tarde o personalizada), intervalo de la especialidad y bloqueos.
 * @returns {number|null} null si no se pudo calcular (se permite agendar sin tope general).
 */
async function capacidadTotalSlotsDia(doctorId, fecha, db) {
  try {
    const dispRows = await db.execute(
      'SELECT disponible, disponible_manana, disponible_tarde FROM doctor_disponibilidad_mensual WHERE doctor_id = ? AND fecha = ?',
      [doctorId, fecha]
    );
    const reg = dispRows?.[0];
    const parseFlag = (v) => {
      if (v === true || v === 1 || v === '1') return true;
      if (v === false || v === 0 || v === '0') return false;
      return null;
    };
    if (reg && parseFlag(reg.disponible) === false) return 0;
    const mananaOk = reg ? parseFlag(reg.disponible_manana) !== false : true;
    const tardeOk = reg ? parseFlag(reg.disponible_tarde) !== false : true;

    let rangos = [];
    const slotsCustom = await db.execute(
      'SELECT hora_inicio, hora_fin FROM doctor_agenda WHERE doctor_id = ? AND fecha = ? AND disponible = 1 ORDER BY hora_inicio ASC',
      [doctorId, fecha]
    );
    if (slotsCustom && slotsCustom.length) {
      rangos = slotsCustom
        .map((s) => ({ inicio: _horaAMinutos(s.hora_inicio), fin: _horaAMinutos(s.hora_fin) }))
        .filter((r) => r.inicio != null && r.fin != null && r.fin > r.inicio);
    } else {
      if (mananaOk) rangos.push({ inicio: 8 * 60, fin: 12 * 60 });
      if (tardeOk) rangos.push({ inicio: 14 * 60, fin: 18 * 60 });
    }
    if (!rangos.length) return 0;

    const bloqueadosRows = await db.execute(
      'SELECT hora_inicio, hora_fin FROM doctor_disponibilidad_intervalos WHERE doctor_id = ? AND fecha = ?',
      [doctorId, fecha]
    );
    const bloqueados = (bloqueadosRows || [])
      .map((b) => ({ inicio: _horaAMinutos(b.hora_inicio), fin: _horaAMinutos(b.hora_fin) }))
      .filter((r) => r.inicio != null && r.fin != null);

    const intervaloMin = await _intervaloMinDoctor(doctorId, db);
    let total = 0;
    for (const r of rangos) {
      for (let m = r.inicio; m < r.fin; m += intervaloMin) {
        if (!bloqueados.some((b) => m >= b.inicio && m < b.fin)) total++;
      }
    }
    return total;
  } catch (_) {
    return null;
  }
}

/**
 * Valida el cupo "general" (sin entidad reservada específica): solo puede usar los
 * cupos que NO están reservados para las entidades configuradas ese día.
 */
async function validarCupoGeneral(doctorId, fecha, cupos, db, cantidad) {
  const capacidadTotal = await capacidadTotalSlotsDia(doctorId, fecha, db);
  if (capacidadTotal == null) {
    return { valido: true, sinCupoProgramadoParaEntidad: true };
  }
  const reservadoTotal = cupos.reduce((s, c) => s + c.cupo_max, 0);
  const libresGenerales = Math.max(0, capacidadTotal - reservadoTotal);

  const ocupadosMap = await contarOcupadosPorEntidad(doctorId, fecha, db);
  const entidadesConfiguradas = new Set(cupos.map((c) => claveEntidad(c.entidad)));
  let ocupadosGenerales = 0;
  for (const [key, val] of ocupadosMap) {
    if (!entidadesConfiguradas.has(key)) ocupadosGenerales += val.ocupados;
  }

  if (ocupadosGenerales + cantidad > libresGenerales) {
    const nombres = cupos.map((c) => c.entidad).join(', ');
    return {
      valido: false,
      requiereConfirmacion: true,
      razon: `Ya no quedan cupos generales libres este día: los cupos restantes están reservados para ${nombres}. ¿Desea agendar de todos modos en un horario ya asignado a esa entidad?`
    };
  }
  return { valido: true, cupoGeneral: { libres: libresGenerales, ocupados: ocupadosGenerales } };
}

/**
 * Valida si se puede agendar `cantidad` citas para entidad en fecha.
 * @param {{ forzar?: boolean }} [opts] Si `forzar` es true, se omite el aviso de "cupo
 * general agotado" (el usuario ya confirmó que quiere agendar en un horario reservado
 * a otra entidad). El cupo propio de la entidad (si tiene uno configurado) SIEMPRE se valida.
 * @returns {{ valido: boolean, razon?: string, resumen?: object[], requiereConfirmacion?: boolean }}
 */
async function validarCupoEntidad(doctorId, fecha, entidad, db, cantidad = 1, opts = {}) {
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
    if (opts.forzar) {
      return { valido: true, sinCupoProgramadoParaEntidad: true, forzado: true };
    }
    // Sin cupo programado para esta entidad: solo puede usar los cupos generales
    // (los que sobran fuera de lo reservado para las entidades configuradas), salvo
    // que el usuario confirme agendar de todos modos en un horario reservado.
    return validarCupoGeneral(doctorId, fecha, cupos, db, cantidad);
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
  fmtFechaLocal,
  ensureCuposEntidadTable,
  prepararTablaCuposEntidad,
  listarCuposDia,
  listarCuposMes,
  contarOcupadosPorEntidad,
  resumenCuposDia,
  diaTieneCuposEntidad,
  capacidadTotalSlotsDia,
  validarCupoGeneral,
  validarCupoEntidad,
  guardarCuposEntidadDia,
  eliminarCuposEntidadDia,
  totalesDesdeResumen
};
