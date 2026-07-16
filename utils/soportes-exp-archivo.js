/**
 * Ver, eliminar y resolver rutas de archivos en expedientes de armado (SOPORTES y RIPS).
 */
const path = require('path');
const fs = require('fs');
const db = require('./db-mysql');
const { getSoportesRoot } = require('../config/uploads-path');
const { resolveStoragePath } = require('./soportes-storage');
const { buildSoportesDiskName, etiquetaFacturaExpediente, getNitObligado, extractEtiquetaFromSoporteName, archivoCoincideConTipoSlot } = require('./soportes-archivo-detect');
const { codigoPacienteFromExpediente } = require('./soportes-pacientes-parse');

const SOPORTES_SLOT_TIPOS = ['OPF', 'CRC', 'FEV', 'PDX', 'HEV'];

const RIPS_TIPO_TO_SLOT = {
  RIPS_JSON_1: 'json_1',
  RIPS_JSON_2: 'json_2',
  RIPS_XML: 'xml'
};

function normalizarTipoArchivo(tipo) {
  const t = String(tipo || '').toUpperCase();
  if (SOPORTES_SLOT_TIPOS.includes(t)) return { contenedor: 'soportes', tipo: t };
  if (RIPS_TIPO_TO_SLOT[t]) return { contenedor: 'rips', tipo: t, slotDb: RIPS_TIPO_TO_SLOT[t] };
  return null;
}

async function loadArchivoExpedienteSlot(expedienteId, tipoParam) {
  const norm = normalizarTipoArchivo(tipoParam);
  if (!norm) return { error: 'Tipo de archivo no válido', status: 400 };

  if (norm.contenedor === 'soportes') {
    const rows = await db.query(
      'SELECT * FROM sop_exp_archivos WHERE expediente_id = ? AND tipo = ? LIMIT 1',
      [expedienteId, norm.tipo]
    );
    if (!rows.length) return { error: 'Archivo no encontrado', status: 404 };
    return { ok: true, row: rows[0], contenedor: 'soportes', tipo: norm.tipo };
  }

  const rows = await db.query(
    'SELECT * FROM sop_rips_archivos WHERE expediente_id = ? AND slot = ? LIMIT 1',
    [expedienteId, norm.slotDb]
  );
  if (!rows.length) return { error: 'Archivo no encontrado', status: 404 };
  return { ok: true, row: rows[0], contenedor: 'rips', tipo: norm.tipo, slotDb: norm.slotDb };
}

function buildStoredRutaRelativa(absPath) {
  if (!absPath) return null;
  const rel = path.relative(getSoportesRoot(), absPath).replace(/\\/g, '/');
  if (!rel || rel === '.' || rel.startsWith('..')) return null;
  return rel;
}

function listarCarpetasExpediente(expediente, baseRoot = getSoportesRoot()) {
  if (!expediente) return [];
  const codigo = String(expediente.codigo || '').trim().toUpperCase();
  const pacienteCodigo = String(codigoPacienteFromExpediente(expediente) || '').trim().toUpperCase();
  const carpetas = new Set();
  if (codigo) carpetas.add(codigo);
  if (pacienteCodigo) carpetas.add(pacienteCodigo);

  const dirs = [];
  const armadoRoot = path.join(baseRoot, 'armado');
  for (const folder of carpetas) {
    dirs.push(path.join(baseRoot, folder));
    dirs.push(path.join(armadoRoot, folder));
    if (fs.existsSync(armadoRoot)) {
      const periodos = fs.readdirSync(armadoRoot, { withFileTypes: true }).filter((e) => e.isDirectory());
      for (const periodo of periodos) {
        const periodoPath = path.join(armadoRoot, periodo.name);
        const dias = fs.readdirSync(periodoPath, { withFileTypes: true }).filter((e) => e.isDirectory());
        for (const dia of dias) {
          for (const estado of ['A_FACTURAR', 'FACTURADOS']) {
            for (const cont of ['SOPORTES', 'RIPS']) {
              dirs.push(path.join(periodoPath, dia.name, estado, cont, folder));
            }
          }
        }
      }
    }
  }
  return dirs.filter((dir, index, all) => dir && all.indexOf(dir) === index);
}

function buscarArchivoPorTipoEnCarpetasExpediente(row, expediente, baseRoot = getSoportesRoot()) {
  const tipo = String(row?.tipo || '').toUpperCase();
  if (!tipo || !expediente) return null;

  const nit = inferNitDesdeNombre(row?.nombre_archivo || row?.ruta_relativa) || getNitObligado();
  const pacienteCodigo = String(codigoPacienteFromExpediente(expediente) || '').trim().toUpperCase();
  const expedienteTag = String(etiquetaFacturaExpediente(expediente)).toUpperCase();
  const ext = path.extname(String(row?.nombre_archivo || '.pdf')).toLowerCase() || '.pdf';
  const candidatosNombre = [];

  if (pacienteCodigo) candidatosNombre.push(`${tipo}_${nit}_${pacienteCodigo}${ext}`);
  if (expedienteTag) candidatosNombre.push(`${tipo}_${nit}_${expedienteTag}${ext}`);
  if (row?.nombre_archivo) candidatosNombre.push(path.basename(String(row.nombre_archivo)));

  for (const dir of listarCarpetasExpediente(expediente, baseRoot)) {
    if (!fs.existsSync(dir)) continue;
    for (const name of candidatosNombre) {
      const full = path.join(dir, name);
      if (fs.existsSync(full) && archivoCoincideConTipoSlot(name, tipo)) return full;
    }
    const files = fs.readdirSync(dir).filter((f) => archivoCoincideConTipoSlot(f, tipo));
    const tagged = files.filter((f) => {
      const tag = extractEtiquetaFromSoporteName(f);
      return (pacienteCodigo && tag === pacienteCodigo) || (expedienteTag && tag === expedienteTag);
    });
    if (tagged.length === 1) return path.join(dir, tagged[0]);
  }

  return null;
}

function buscarRutaHistoricaArchivo(row, baseRoot = getSoportesRoot()) {
  const nombre = String(row?.nombre_archivo || '').trim();
  const tipo = String(row?.tipo || '').toUpperCase();
  const rel = String(row?.ruta_relativa || '').replace(/\\/g, '/').trim();
  const base = path.basename(nombre);
  const relBase = rel ? path.basename(rel) : '';
  const tokens = [];

  if (base) tokens.push(base);
  if (relBase && relBase !== base) tokens.push(relBase);
  if (tipo) tokens.push(`${tipo.toLowerCase()}_`);
  if (nombre) tokens.push(path.basename(nombre, path.extname(nombre)));

  const roots = [baseRoot, path.join(baseRoot, 'armado'), path.resolve(__dirname, '..', 'public', 'uploads', 'soportes')];

  const walk = (currentDir) => {
    if (!fs.existsSync(currentDir)) return null;
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        const found = walk(full);
        if (found) return found;
        continue;
      }
      const lower = entry.name.toLowerCase();
      if (tipo && !archivoCoincideConTipoSlot(entry.name, tipo)) continue;
      const matches = tokens.some((token) => {
        if (!token) return false;
        if (token.endsWith('_')) return lower.startsWith(token);
        return lower === token.toLowerCase() || lower.includes(token.toLowerCase());
      });
      if (matches) return full;
    }
    return null;
  };

  for (const root of roots) {
    const found = walk(root);
    if (found) return found;
  }

  return null;
}

function inferNitDesdeNombre(nombre) {
  const base = path.basename(String(nombre || '')).toUpperCase();
  const match = base.match(/^(OPF|CRC|FEV|PDX|HEV)[_-](\d+)[_-]/i);
  if (match) return match[2];
  return null;
}

function construirNombreEsperado(row, expediente, ext = null) {
  const tipo = String(row?.tipo || '').toUpperCase();
  if (!tipo) return null;
  const resolvedExt = ext || path.extname(String(row?.nombre_archivo || row?.ruta_relativa || '') || '.pdf') || '.pdf';
  const nit = inferNitDesdeNombre(row?.nombre_archivo || row?.ruta_relativa) || getNitObligado();
  const tag = expediente ? etiquetaFacturaExpediente(expediente) : null;
  if (!tag) return null;
  return `${tipo}_${nit}_${tag}${resolvedExt.startsWith('.') ? resolvedExt : `.${resolvedExt}`}`;
}

function normalizarTokensBusqueda(value) {
  const text = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return text ? text.split(/\s+/).filter(Boolean) : [];
}

function obtenerTokensBusqueda(row, expediente) {
  const tokens = new Set();
  const push = (value) => {
    for (const token of normalizarTokensBusqueda(value)) {
      if (token && token.length > 2) tokens.add(token);
    }
  };

  push(row?.tipo);
  push(row?.nombre_archivo);
  push(row?.ruta_relativa);

  if (expediente) {
    push(expediente?.codigo);
    push(expediente?.numero_factura ? `FE${String(expediente.numero_factura).replace(/\D/g, '')}` : null);
    push(expediente?.nombre_display);
    push(expediente?.paciente_nombre);
    push(expediente?.nombre);
  }

  const relParts = String(row?.ruta_relativa || '').replace(/\\/g, '/').split('/').filter(Boolean);
  relParts.forEach(push);
  return Array.from(tokens);
}

function buscarRutaPorPatronExpediente(row, expediente, baseRoot = getSoportesRoot()) {
  const tipo = String(row?.tipo || '').toUpperCase();
  const rel = String(row?.ruta_relativa || '').replace(/\\/g, '/').trim();
  const relDir = rel ? path.dirname(rel).replace(/^soportes\//, '') : '';
  const rowName = String(row?.nombre_archivo || '').trim();
  const rowBase = rowName ? path.basename(rowName) : '';
  const expectedName = construirNombreEsperado(row, expediente);
  const expectedStem = expectedName ? path.basename(expectedName, path.extname(expectedName)) : '';
  const typePrefix = tipo ? `${tipo.toLowerCase()}_` : '';
  const tokens = obtenerTokensBusqueda(row, expediente);
  const expedienteCodigo = String(expediente?.codigo || '').trim().toUpperCase();
  const expedienteTag = expediente ? String(etiquetaFacturaExpediente(expediente)).toUpperCase() : '';
  const pacienteCodigo = expediente ? String(codigoPacienteFromExpediente(expediente) || '').trim().toUpperCase() : '';
  const rowTag = extractEtiquetaFromSoporteName(rowName);

  const roots = [
    baseRoot,
    path.join(baseRoot, 'armado'),
    path.join(baseRoot, relDir),
    path.join(baseRoot, 'armado', relDir),
    path.resolve(__dirname, '..', 'public', 'uploads', 'soportes')
  ].filter(Boolean);

  const scorePath = (entryName, absPath) => {
    const lower = entryName.toLowerCase();
    const ext = path.extname(entryName).toLowerCase();
    const dirName = path.basename(path.dirname(absPath)).toUpperCase();
    const fileTag = extractEtiquetaFromSoporteName(entryName);
    let score = 0;

    if (expedienteCodigo && dirName === expedienteCodigo) score += 500;
    if (pacienteCodigo && dirName === pacienteCodigo) score += 480;
    if (pacienteCodigo && fileTag && fileTag === pacienteCodigo) score += 460;
    if (expedienteTag && fileTag && fileTag === expedienteTag) score += 400;
    if (rowTag && fileTag && fileTag === rowTag) score += 350;
    if (expedienteTag && fileTag && /^FE\d+$/.test(fileTag) && /^FE\d+$/.test(expedienteTag) && fileTag !== expedienteTag) {
      return 0;
    }
    if (expectedName && lower === expectedName.toLowerCase()) return 1000;
    if (expectedStem && lower.includes(expectedStem.toLowerCase())) score += 300;
    if (tipo && lower.startsWith(typePrefix)) score += 180;
    if (rowBase && lower === rowBase.toLowerCase()) score += 120;
    if (rowBase && lower.includes(path.basename(rowBase, path.extname(rowBase)).toLowerCase())) score += 80;
    if (expedienteTag) {
      if (lower.includes(expedienteTag.toLowerCase())) score += 200;
      if (dirName.includes(expedienteTag)) score += 180;
    }
    for (const token of tokens) {
      if (!token) continue;
      const tokenLower = token.toLowerCase();
      if (lower.includes(tokenLower)) score += 120;
      if (dirName.toLowerCase().includes(tokenLower)) score += 180;
    }
    if (ext === '.pdf') score += 20;
    if (absPath && relDir && absPath.includes(`/${relDir}/`)) score += 40;
    return score;
  };

  const matches = [];
  const walk = (currentDir) => {
    if (!fs.existsSync(currentDir)) return;
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const score = scorePath(entry.name, full);
      if (score > 0) matches.push({ path: full, score });
    }
  };

  for (const root of roots) {
    walk(root);
  }

  matches.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  const best = matches[0];
  if (!best || best.score < 200) return null;
  return best.path || null;
}

function archivoCompatibleConExpediente(absPath, row, expediente) {
  if (!absPath || !expediente) return true;

  const entryName = path.basename(absPath);
  const tipo = String(row?.tipo || '').toUpperCase();
  if (tipo && !archivoCoincideConTipoSlot(entryName, tipo)) return false;

  const dirName = path.basename(path.dirname(absPath)).toUpperCase();
  const expedienteCodigo = String(expediente?.codigo || '').trim().toUpperCase();
  const expedienteTag = String(etiquetaFacturaExpediente(expediente)).toUpperCase();
  const pacienteCodigo = String(codigoPacienteFromExpediente(expediente) || '').trim().toUpperCase();
  const fileTag = extractEtiquetaFromSoporteName(entryName);

  if (pacienteCodigo && fileTag === pacienteCodigo) return true;
  if (expedienteTag && fileTag && /^FE\d+$/.test(fileTag) && /^FE\d+$/.test(expedienteTag) && fileTag !== expedienteTag) {
    return false;
  }
  if (expedienteCodigo && /^FE\d+$/.test(expedienteCodigo) && /^FE\d+$/.test(dirName) && dirName !== expedienteCodigo) {
    return false;
  }
  return true;
}

function resolveArchivoAbsoluto(row, options = {}) {
  const rel = String(row?.ruta_relativa || '').replace(/\\/g, '/').trim();
  const nombre = String(row?.nombre_archivo || '');
  const tipo = String(row?.tipo || '').toUpperCase();
  const base = path.basename(nombre);
  const candidates = [];
  let joined = null;

  if (rel) {
    joined = rel.startsWith('soportes/') ? rel : path.join('soportes', rel).replace(/\\/g, '/');
    const resolved = resolveStoragePath(joined);
    if (resolved && archivoCompatibleConExpediente(resolved, row, options.expediente)) return resolved;
  }

  if (base) {
    if (joined) {
      candidates.push(path.join(path.dirname(joined), base));
      candidates.push(path.join(getSoportesRoot(), path.basename(joined)));
      candidates.push(path.join(getSoportesRoot(), path.dirname(joined).replace(/^soportes\//, ''), base));
      candidates.push(path.join(getSoportesRoot(), 'armado', path.basename(joined)));
      candidates.push(path.join(getSoportesRoot(), 'armado', path.dirname(joined).replace(/^soportes\//, ''), base));
    }
    candidates.push(path.join(getSoportesRoot(), base));
    candidates.push(path.join(getSoportesRoot(), 'armado', base));
  }

  const nombreSinExt = base ? path.basename(base, path.extname(base)) : '';
  const tipoPrefix = tipo ? `${tipo.toLowerCase()}_` : '';
  const buscarPorPrefijo = (dir) => {
    if (!dir || !fs.existsSync(dir)) return null;

    const walk = (currentDir) => {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          const found = walk(full);
          if (found) return found;
          continue;
        }
        const lower = entry.name.toLowerCase();
        if (tipo && !archivoCoincideConTipoSlot(entry.name, tipo)) continue;
        const matches =
          lower === base.toLowerCase() ||
          lower.includes(nombreSinExt.toLowerCase()) ||
          (tipoPrefix && lower.startsWith(tipoPrefix)) ||
          (nombreSinExt && lower.includes(nombreSinExt.replace(/_/g, '').toLowerCase()));
        if (matches) return full;
      }
      return null;
    };

    return walk(dir);
  };

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && archivoCompatibleConExpediente(candidate, row, options.expediente)) return candidate;
  }

  const byExpedienteFolder = buscarArchivoPorTipoEnCarpetasExpediente(row, options.expediente);
  if (byExpedienteFolder && archivoCompatibleConExpediente(byExpedienteFolder, row, options.expediente)) {
    return byExpedienteFolder;
  }

  const relDir = joined ? path.dirname(joined).replace(/^soportes\//, '') : '';
  const scanRoots = [
    getSoportesRoot(),
    path.join(getSoportesRoot(), 'armado'),
    ...(relDir ? [path.join(getSoportesRoot(), 'armado', relDir), path.join(getSoportesRoot(), relDir)] : []),
    path.resolve(__dirname, '..', 'public', 'uploads', 'soportes')
  ];
  const historical = buscarRutaHistoricaArchivo(row);
  if (historical && archivoCompatibleConExpediente(historical, row, options.expediente)) return historical;
  const byPattern = buscarRutaPorPatronExpediente(row, options.expediente);
  if (byPattern && archivoCompatibleConExpediente(byPattern, row, options.expediente)) return byPattern;
  for (const root of scanRoots) {
    const found = buscarPorPrefijo(root);
    if (found && archivoCompatibleConExpediente(found, row, options.expediente)) return found;
  }

  if (base) {
    const dirCandidates = [
      path.join(path.dirname(joined)),
      path.join('soportes', 'armado'),
      path.resolve(__dirname, '..', 'public', 'uploads', 'soportes')
    ];
    for (const dir of dirCandidates) {
      const full = path.join(dir, base);
      if (fs.existsSync(full) && archivoCompatibleConExpediente(full, row, options.expediente)) return full;
    }
  }

  return null;
}

function archivoResueltoValido(fp, row, expediente) {
  return Boolean(fp && fs.existsSync(fp) && archivoCompatibleConExpediente(fp, row, expediente));
}

function registroArchivoDesincronizado(row, fp) {
  if (!row || !fp) return false;
  const base = path.basename(fp);
  const rel = buildStoredRutaRelativa(fp);
  const rowName = String(row?.nombre_archivo || '').trim();
  const rowRel = String(row?.ruta_relativa || '').replace(/\\/g, '/').trim();
  return rowName !== base || (rel && rowRel !== rel);
}

async function resolverArchivoExpedienteSlot(expedienteId, tipoParam) {
  const loaded = await loadArchivoExpedienteSlot(expedienteId, tipoParam);
  if (!loaded.ok) {
    return { ok: false, error: loaded.error, status: loaded.status || 404, fp: null };
  }

  const expediente = await obtenerExpedienteContext(expedienteId);
  let row = loaded.row;
  let fp = resolveArchivoAbsoluto(row, { expediente });

  if (!archivoResueltoValido(fp, row, expediente) || registroArchivoDesincronizado(row, fp)) {
    await repararArchivosExpediente(expedienteId, expediente);
    const reloaded = await loadArchivoExpedienteSlot(expedienteId, tipoParam);
    if (reloaded.ok) {
      row = reloaded.row;
      fp = resolveArchivoAbsoluto(row, { expediente });
    }
  }

  if (!archivoResueltoValido(fp, row, expediente)) {
    return {
      ok: false,
      error: 'El archivo no está en disco',
      status: 404,
      fp: null,
      row,
      contenedor: loaded.contenedor,
      tipo: loaded.tipo
    };
  }

  return {
    ok: true,
    fp,
    row,
    contenedor: loaded.contenedor,
    tipo: loaded.tipo,
    expediente
  };
}

function resolverArchivoExpedienteRow(row, expediente) {
  const fp = resolveArchivoAbsoluto(row, { expediente });
  return archivoResueltoValido(fp, row, expediente) ? fp : null;
}

async function obtenerExpedienteContext(expedienteId) {
  if (!expedienteId) return null;

  try {
    const columnas = await db.query('SHOW COLUMNS FROM sop_expedientes');
    const columnasSet = new Set((columnas || []).map((col) => String(col?.Field || '').toLowerCase()));
    const selectParts = [
      'e.id',
      'e.codigo',
      'e.numero_factura',
      'e.paciente_nombre',
      'e.paciente_documento',
      'e.tipo_servicio',
      'e.dia_id',
      'e.contenedor_id',
      'e.fev_externa_verificada',
      'e.listo_radicacion',
      'e.notas',
      'e.creado_por',
      'e.creado_en'
    ];

    if (columnasSet.has('nombre_display')) {
      selectParts.push('e.nombre_display');
    }
    if (columnasSet.has('periodo')) {
      selectParts.push('e.periodo');
    }
    if (columnasSet.has('estado_facturacion')) {
      selectParts.push('e.estado_facturacion');
    }

    const sql = `SELECT ${selectParts.join(', ')} FROM sop_expedientes e WHERE e.id = ? LIMIT 1`;
    const rows = await db.query(sql, [expedienteId]);
    return rows?.[0] || null;
  } catch (error) {
    try {
      const rows = await db.query(
        'SELECT id, codigo, numero_factura, paciente_nombre, paciente_documento, tipo_servicio, dia_id, contenedor_id, fev_externa_verificada, listo_radicacion, notas, creado_por, creado_en FROM sop_expedientes WHERE id = ? LIMIT 1',
        [expedienteId]
      );
      return rows?.[0] || null;
    } catch (fallbackError) {
      return null;
    }
  }
}

async function repararArchivoExpedienteRow(row, { contenedor = 'soportes', usedPaths = null, expedienteId = null, expediente = null } = {}) {
  if (!row?.id) return { ok: false, repaired: false, path: null };

  const expedienteContext = expediente || (await obtenerExpedienteContext(expedienteId || row?.expediente_id));
  let resolved = resolveArchivoAbsoluto(row, { expediente: expedienteContext });

  if (resolved && !archivoCompatibleConExpediente(resolved, row, expedienteContext)) {
    resolved = null;
  }

  if (!resolved || !fs.existsSync(resolved)) {
    return { ok: false, repaired: false, path: null };
  }

  const fromDb = row?.ruta_relativa ? resolveStoragePath(String(row.ruta_relativa).replace(/\\/g, '/')) : null;
  const samePath = fromDb && fs.existsSync(fromDb) && path.resolve(fromDb) === path.resolve(resolved);
  let finalPath = resolved;
  let finalName = path.basename(resolved);
  let finalRel = buildStoredRutaRelativa(resolved);

  if (!finalRel) {
    return { ok: false, repaired: false, path: resolved };
  }

  const expectedName = construirNombreEsperado(row, expedienteContext);
  if (expectedName && finalName !== expectedName && fs.existsSync(finalPath)) {
    const targetPath = path.join(path.dirname(finalPath), expectedName);
    if (!fs.existsSync(targetPath)) {
      try {
        fs.renameSync(finalPath, targetPath);
        finalPath = targetPath;
        finalName = expectedName;
        finalRel = buildStoredRutaRelativa(targetPath);
      } catch (_) {
        // conservar el archivo encontrado aunque no se haya podido renombrar
      }
    }
  }

  if (usedPaths instanceof Set) {
    const resolvedAbs = path.resolve(finalPath);
    if (usedPaths.has(resolvedAbs)) {
      return { ok: false, repaired: false, path: null, error: 'archivo_duplicado' };
    }
    usedPaths.add(resolvedAbs);
  }

  const needsUpdate = !samePath || String(row?.nombre_archivo || '') !== finalName || String(row?.ruta_relativa || '').replace(/\\/g, '/') !== finalRel;
  if (!needsUpdate) {
    return { ok: true, repaired: false, path: finalPath, nombre_archivo: finalName, ruta_relativa: finalRel };
  }

  if (contenedor === 'soportes') {
    await db.execute(
      'UPDATE sop_exp_archivos SET nombre_archivo = ?, ruta_relativa = ? WHERE id = ?',
      [finalName, finalRel, row.id]
    );
  } else {
    await db.execute(
      'UPDATE sop_rips_archivos SET nombre_archivo = ?, ruta_relativa = ? WHERE id = ?',
      [finalName, finalRel, row.id]
    );
  }

  return { ok: true, repaired: true, path: finalPath, nombre_archivo: finalName, ruta_relativa: finalRel };
}

async function repararArchivosExpediente(expedienteId, expedienteOverride = null) {
  const soportesRows = await db.query('SELECT * FROM sop_exp_archivos WHERE expediente_id = ?', [expedienteId]);
  const reparaciones = [];
  const usedPaths = new Set();
  const expediente = expedienteOverride || (await obtenerExpedienteContext(expedienteId));
  for (const row of soportesRows) {
    reparaciones.push(await repararArchivoExpedienteRow(row, { contenedor: 'soportes', usedPaths, expedienteId, expediente }));
  }

  try {
    const ripsRows = await db.query('SELECT * FROM sop_rips_archivos WHERE expediente_id = ?', [expedienteId]);
    for (const row of ripsRows) {
      reparaciones.push(await repararArchivoExpedienteRow(row, { contenedor: 'rips', usedPaths, expedienteId, expediente }));
    }
  } catch (_) {
    // La tabla puede no existir o no estar preparada en todos los entornos.
  }

  return reparaciones;
}


async function eliminarArchivoExpedienteSlot(expedienteId, tipoParam) {
  const loaded = await loadArchivoExpedienteSlot(expedienteId, tipoParam);
  if (!loaded.ok) return loaded;

  const expediente = await obtenerExpedienteContext(expedienteId);
  const fp = resolverArchivoExpedienteRow(loaded.row, expediente) || resolveArchivoAbsoluto(loaded.row, { expediente });
  if (fp && fs.existsSync(fp)) {
    try { fs.unlinkSync(fp); } catch (_) { /* ignore */ }
  }

  if (loaded.contenedor === 'soportes') {
    await db.execute('DELETE FROM sop_exp_archivos WHERE id = ?', [loaded.row.id]);
    if (loaded.tipo === 'FEV') {
      await db.execute('UPDATE sop_expedientes SET fev_externa_verificada = 0 WHERE id = ?', [expedienteId]);
    }
  } else {
    await db.execute('DELETE FROM sop_rips_archivos WHERE id = ?', [loaded.row.id]);
  }

  return {
    ok: true,
    tipo: loaded.tipo,
    nombre_archivo: loaded.row.nombre_archivo
  };
}

module.exports = {
  SOPORTES_SLOT_TIPOS,
  RIPS_TIPO_TO_SLOT,
  normalizarTipoArchivo,
  loadArchivoExpedienteSlot,
  resolveArchivoAbsoluto,
  resolverArchivoExpedienteSlot,
  resolverArchivoExpedienteRow,
  archivoResueltoValido,
  buscarRutaHistoricaArchivo,
  construirNombreEsperado,
  repararArchivoExpedienteRow,
  repararArchivosExpediente,
  eliminarArchivoExpedienteSlot,
  obtenerExpedienteContext
};
