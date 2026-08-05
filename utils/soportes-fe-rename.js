/**
 * Renombrado de carpeta FE y archivos al vincular número de factura (subida FEV).
 */
const path = require('path');
const fs = require('fs');
const db = require('./db-mysql');
const { getArmadoFeDirFromContext, resolveStoragePath } = require('./soportes-storage');
const { buildCanonicalName, buildSoportesDiskName, extractEtiquetaFromSoporteName, archivoCoincideConTipoSlot } = require('./soportes-archivo-detect');
const { parseLineaPaciente, esExpedientePendienteFactura } = require('./soportes-pacientes-parse');
const {
  loadArchivoExpedienteSlot,
  eliminarArchivoExpedienteSlot,
  repararArchivosExpediente,
  resolveArchivoAbsoluto
} = require('./soportes-exp-archivo');
const { syncRipsCarpetasDia } = require('./soportes-rips-carpetas-sync');
const logger = require('./logger');
const {
  nuevaOperacionId,
  registrarMovimiento,
  actualizarOperacion
} = require('./soportes-fs-journal');

async function loadExpedienteContext(expedienteId) {
  const rows = await db.query(
    `SELECT e.*, c.tipo AS contenedor_tipo, c.id AS contenedor_id,
            d.id AS dia_id, d.dia, d.nombre_display, d.estado_facturacion,
            p.periodo, p.etiqueta AS periodo_etiqueta
     FROM sop_expedientes e
     LEFT JOIN sop_contenedores c ON c.id = e.contenedor_id
     LEFT JOIN sop_dias d ON d.id = COALESCE(c.dia_id, e.dia_id)
     LEFT JOIN sop_periodos p ON p.id = d.periodo_id
     WHERE e.id = ?`,
    [expedienteId]
  );
  return rows[0] || null;
}

async function findExpedientesMismoCodigo(diaId, codigo) {
  return db.query(
    `SELECT e.*, c.tipo AS contenedor_tipo, c.id AS contenedor_id,
            d.dia, d.nombre_display, d.estado_facturacion,
            p.periodo, p.etiqueta AS periodo_etiqueta
     FROM sop_expedientes e
     JOIN sop_contenedores c ON c.id = e.contenedor_id
     JOIN sop_dias d ON d.id = c.dia_id
     JOIN sop_periodos p ON p.id = d.periodo_id
     WHERE e.dia_id = ? AND e.codigo = ?`,
    [diaId, codigo]
  );
}

function renameDirectoryIfExists(oldAbs, newAbs) {
  if (path.resolve(oldAbs) === path.resolve(newAbs)) {
    return { ok: true };
  }
  if (!fs.existsSync(oldAbs)) {
    const parent = path.dirname(newAbs);
    if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
    if (!fs.existsSync(newAbs)) fs.mkdirSync(newAbs, { recursive: true });
    return { ok: true };
  }
  if (fs.existsSync(newAbs)) {
    const existingFiles = fs.readdirSync(newAbs).filter((f) => f && f !== '.' && f !== '..');
    if (existingFiles.length) {
      return {
        ok: false,
        error: `La carpeta destino ya existe y contiene archivos (${existingFiles.slice(0, 3).join(', ')}${existingFiles.length > 3 ? '…' : ''})`
      };
    }
    try { fs.rmdirSync(newAbs); } catch (_) { /* ignore */ }
  }
  const parent = path.dirname(newAbs);
  if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
  fs.renameSync(oldAbs, newAbs);
  return { ok: true };
}

function etiquetasCompatiblesParaRenombrado(preferredName, candidateName) {
  const preferredTag = extractEtiquetaFromSoporteName(preferredName);
  const candidateTag = extractEtiquetaFromSoporteName(candidateName);
  if (!preferredTag || !candidateTag) return true;
  if (preferredTag === candidateTag) return true;
  const preferredIsFe = /^FE\d+$/.test(preferredTag);
  const candidateIsFe = /^FE\d+$/.test(candidateTag);
  if (preferredIsFe && candidateIsFe) return false;
  if (preferredIsFe && !candidateIsFe) return true;
  if (!preferredIsFe && candidateIsFe) return false;
  return preferredTag === candidateTag;
}

function sourceDirForRename(oldDir, newDir) {
  if (oldDir && fs.existsSync(oldDir)) return oldDir;
  if (newDir && fs.existsSync(newDir)) return newDir;
  return oldDir || newDir;
}

function resolveSourceFileForRename(row, oldDir, newDir, options = {}) {
  const preferredName = String(row?.nombre_archivo || '').trim();
  const preferredRel = String(row?.ruta_relativa || '').replace(/\\/g, '/').trim();
  const usedPaths = options?.usedPaths instanceof Set ? options.usedPaths : null;
  const searchDir = sourceDirForRename(oldDir, newDir);
  const candidates = [];

  if (preferredName) {
    const base = path.basename(preferredName);
    if (base) candidates.push(base);
  }
  if (preferredRel) {
    const base = path.basename(preferredRel);
    if (base && !candidates.includes(base)) candidates.push(base);
  }

  const checkPath = (dir, name) => {
    if (!dir || !name) return null;
    if (!archivoCoincideConTipoSlot(name, row?.tipo)) return null;
    const full = path.join(dir, name);
    if (!fs.existsSync(full)) return null;
    if (!etiquetasCompatiblesParaRenombrado(preferredName || name, name)) return null;
    return { fullPath: full, fileName: name };
  };

  const isPathAvailable = (candidate) => {
    if (!candidate?.fullPath) return false;
    if (!usedPaths) return true;
    return !usedPaths.has(path.resolve(candidate.fullPath));
  };

  for (const name of candidates) {
    const fromDir = checkPath(searchDir, name);
    if (fromDir && isPathAvailable(fromDir)) return fromDir;
  }

  if (preferredRel) {
    const relNorm = preferredRel.replace(/^uploads\//, '').replace(/\\/g, '/');
    const joined = relNorm.startsWith('soportes/')
      ? relNorm
      : path.join('soportes', relNorm).replace(/\\/g, '/');
    const fromRel = resolveStoragePath(joined);
    if (fromRel && fs.existsSync(fromRel)) {
      const name = path.basename(fromRel);
      if (archivoCoincideConTipoSlot(name, row?.tipo)
        && etiquetasCompatiblesParaRenombrado(preferredName || name, name)) {
        const match = { fullPath: fromRel, fileName: name };
        if (isPathAvailable(match)) return match;
      }
    }
  }

  if (searchDir && fs.existsSync(searchDir)) {
    const files = fs.readdirSync(searchDir).filter((f) => !!f && f !== '.' && f !== '..');
    const ext = preferredName ? path.extname(preferredName).toLowerCase() : '';
    const prefix = String(row?.tipo || '').toUpperCase();
    const exact = files.find((f) => f.toLowerCase() === preferredName.toLowerCase());
    if (exact) {
      const match = { fullPath: path.join(searchDir, exact), fileName: exact };
      if (isPathAvailable(match)) return match;
    }

    const preferredTag = extractEtiquetaFromSoporteName(preferredName);
    const typeMatches = files.filter((f) => {
      if (!archivoCoincideConTipoSlot(f, row?.tipo)) return false;
      const lower = f.toLowerCase();
      if (prefix && !lower.startsWith(`${prefix.toLowerCase()}_`)) return false;
      if (ext && path.extname(f).toLowerCase() !== ext) return false;
      if (preferredTag) {
        const fileTag = extractEtiquetaFromSoporteName(f);
        return fileTag && fileTag === preferredTag;
      }
      return true;
    });
    if (typeMatches.length === 1) {
      const match = { fullPath: path.join(searchDir, typeMatches[0]), fileName: typeMatches[0] };
      if (isPathAvailable(match)) return match;
    }

    const soloTipo = files.filter((f) => {
      if (!archivoCoincideConTipoSlot(f, row?.tipo)) return false;
      if (!etiquetasCompatiblesParaRenombrado(preferredName || f, f)) return false;
      const lower = f.toLowerCase();
      if (prefix && !lower.startsWith(`${prefix.toLowerCase()}_`)) return false;
      if (ext && path.extname(f).toLowerCase() !== ext) return false;
      return true;
    });
    if (soloTipo.length === 1) {
      const match = { fullPath: path.join(searchDir, soloTipo[0]), fileName: soloTipo[0] };
      if (isPathAvailable(match)) return match;
    }
  }

  const expediente = options?.expediente;
  if (expediente) {
    const abs = resolveArchivoAbsoluto(row, { expediente });
    if (abs && fs.existsSync(abs)) {
      const name = path.basename(abs);
      if (archivoCoincideConTipoSlot(name, row?.tipo)
        && etiquetasCompatiblesParaRenombrado(preferredName || name, name)) {
        const match = { fullPath: abs, fileName: name };
        if (isPathAvailable(match)) return match;
      }
    }
  }

  return null;
}

function moveFileSafely(sourcePath, targetPath) {
  if (!sourcePath || !targetPath) return false;
  if (!fs.existsSync(sourcePath)) return false;
  if (path.resolve(sourcePath) === path.resolve(targetPath)) return true;

  const parent = path.dirname(targetPath);
  if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });

  if (fs.existsSync(targetPath)) {
    const backupPath = `${targetPath}.bak.${Date.now()}`;
    fs.copyFileSync(targetPath, backupPath);
    fs.unlinkSync(targetPath);
  }

  fs.renameSync(sourcePath, targetPath);
  return true;
}

function buildUniqueTargetPathForRename(targetDir, canonicalName, sourcePath, expedienteId) {
  const ext = path.extname(canonicalName || '');
  const base = path.basename(canonicalName || '', ext);
  const suffix = expedienteId ? `_${expedienteId}` : '';
  let candidate = path.join(targetDir, canonicalName);
  if (!fs.existsSync(candidate) && (!sourcePath || path.resolve(sourcePath) !== path.resolve(candidate))) {
    return candidate;
  }

  let index = 1;
  while (true) {
    const altName = `${base}${suffix}${index > 1 ? `_${index}` : ''}${ext}`;
    const altPath = path.join(targetDir, altName);
    if (!fs.existsSync(altPath)) return altPath;
    index += 1;
  }
}

function ordenarArchivosParaRenombrado(archivos) {
  const order = { OPF: 1, CRC: 2, PDX: 3, HEV: 3, FEV: 9 };
  return [...archivos].sort((a, b) => {
    const ta = order[String(a?.tipo || '').toUpperCase()] || 5;
    const tb = order[String(b?.tipo || '').toUpperCase()] || 5;
    return ta - tb || String(a?.id || 0) - String(b?.id || 0);
  });
}

async function renombrarArchivosExpedienteEnDisco(archivos, ctx, oldCodigo, newCodigo, newRel, num, herId) {
  const { abs: oldDir } = getArmadoFeDirFromContext(ctx, oldCodigo);
  const { abs: newDir } = getArmadoFeDirFromContext(ctx, newCodigo);
  const resumen = [];
  const usedPaths = new Set();
  const isRips = ctx.contenedor_tipo !== 'soportes';

  for (const a of ordenarArchivosParaRenombrado(archivos)) {
    const slotKey = isRips
      ? (a.slot === 'json_1' ? 'RIPS_JSON_1' : a.slot === 'json_2' ? 'RIPS_JSON_2' : 'RIPS_XML')
      : a.tipo;
    const ext = path.extname(a.nombre_archivo || (isRips ? '.json' : '.pdf')).toLowerCase() || (isRips ? '.json' : '.pdf');
    const targetName = buildCanonicalName(slotKey, num, ext);
    const diskMatch = resolveSourceFileForRename(a, oldDir, newDir, { usedPaths });
    const currentPath = diskMatch?.fullPath || null;

    if (!currentPath || !fs.existsSync(currentPath)) {
      resumen.push({ tipo: slotKey, nombre: a.nombre_archivo, renombrado: false, omitido: true });
      continue;
    }

    usedPaths.add(path.resolve(currentPath));
    const targetPath = buildUniqueTargetPathForRename(newDir, targetName, currentPath, herId);
    if (path.resolve(currentPath) !== path.resolve(targetPath)) {
      moveFileSafely(currentPath, targetPath);
    }

    const finalName = path.basename(targetPath);
    const rutaRelativa = path.join(newRel, finalName).replace(/\\/g, '/');
    if (isRips) {
      await db.execute(
        'UPDATE sop_rips_archivos SET nombre_archivo = ?, ruta_relativa = ? WHERE id = ?',
        [finalName, rutaRelativa, a.id]
      );
    } else {
      await db.execute(
        'UPDATE sop_exp_archivos SET nombre_archivo = ?, ruta_relativa = ? WHERE id = ?',
        [finalName, rutaRelativa, a.id]
      );
    }
    resumen.push({ tipo: slotKey, nombre: finalName, renombrado: finalName !== a.nombre_archivo });
  }

  return resumen;
}

/**
 * Tras subir FEV_{NIT}_{num}.pdf: carpeta → FE{num} y archivos OPF/CRC/PDX/HEV al formato canónico.
 */
async function aplicarRenombradoPorFev(expedienteId, numeroFactura) {
  const num = parseInt(numeroFactura, 10);
  if (!num || num < 1) {
    return { ok: false, error: 'Número de factura inválido en el nombre FEV' };
  }

  const exp = await loadExpedienteContext(expedienteId);
  if (!exp) return { ok: false, error: 'Expediente no encontrado' };

  const oldCodigo = exp.codigo;
  const newCodigo = `FE${num}`;
  const carpetaYaFacturada = oldCodigo === newCodigo && (parseInt(exp.numero_factura, 10) || 0) === num;

  const hermanos = await findExpedientesMismoCodigo(exp.dia_id, oldCodigo);
  const ids = hermanos.map((h) => h.id);
  const conflictSql = ids.length
    ? `SELECT e.id FROM sop_expedientes e WHERE e.dia_id = ? AND e.codigo = ? AND e.id NOT IN (${ids.map(() => '?').join(',')})`
    : 'SELECT e.id FROM sop_expedientes e WHERE e.dia_id = ? AND e.codigo = ?';
  const conflict = await db.query(conflictSql, [exp.dia_id, newCodigo, ...ids]);
  if (conflict.length) {
    return { ok: false, error: `Ya existe la carpeta ${newCodigo} en este día` };
  }

  const resumen = { carpetas: [], archivos: [] };
  const operacionId = nuevaOperacionId();
  const planes = [];

  // Fase 1: comprobar todos los registros y destinos antes de tocar disco o BD.
  for (const her of hermanos) {
    const ctx = her;
    const { abs: oldDir } = getArmadoFeDirFromContext(ctx, oldCodigo);
    const { abs: newDir, rel: newRel } = getArmadoFeDirFromContext(ctx, newCodigo);
    const isRips = ctx.contenedor_tipo !== 'soportes';
    let archivos = [];
    if (isRips) {
      try {
        archivos = await db.query('SELECT * FROM sop_rips_archivos WHERE expediente_id = ?', [her.id]);
      } catch (_) { /* tabla opcional */ }
    } else {
      archivos = await db.query('SELECT * FROM sop_exp_archivos WHERE expediente_id = ?', [her.id]);
    }

    const usedPaths = new Set();
    const filePlans = [];
    for (const a of ordenarArchivosParaRenombrado(archivos)) {
      const slotKey = isRips
        ? (a.slot === 'json_1' ? 'RIPS_JSON_1' : a.slot === 'json_2' ? 'RIPS_JSON_2' : 'RIPS_XML')
        : a.tipo;
      const ext = path.extname(a.nombre_archivo || (isRips ? '.json' : '.pdf')).toLowerCase() || (isRips ? '.json' : '.pdf');
      const expedienteCtx = { ...her, codigo: oldCodigo };
      const source = resolveSourceFileForRename(a, oldDir, newDir, { usedPaths, expediente: expedienteCtx });
      if (!source?.fullPath || !fs.existsSync(source.fullPath)) {
        logger.warn('[SOPORTES] Slot faltante al preparar renombrado FEV', {
          expedienteId: her.id,
          slot: slotKey,
          nombre: a.nombre_archivo,
          ruta_relativa: a.ruta_relativa,
          oldDir,
          newDir
        });
        return {
          ok: false,
          error: `No se vinculó la factura porque falta en disco el slot ${slotKey} (${a.nombre_archivo || 'sin nombre'}). Ejecute recuperación antes de reintentar.`
        };
      }
      usedPaths.add(path.resolve(source.fullPath));
      filePlans.push({
        row: a,
        slotKey,
        sourcePath: source.fullPath,
        canonicalName: buildCanonicalName(slotKey, num, ext),
        isRips
      });
    }
    planes.push({ her, ctx, oldDir, newDir, newRel, filePlans });
  }

  const dirMoves = [];
  const fileMoves = [];
  try {
    // Fase 2A: journal + movimientos físicos reversibles.
    for (const plan of planes) {
      await registrarMovimiento({
        operacionId,
        expedienteId: plan.her.id,
        tipo: 'RENOMBRAR_CARPETA_FEV',
        rutaAnterior: plan.oldDir,
        rutaNueva: plan.newDir
      });
      const sameDir = path.resolve(plan.oldDir) === path.resolve(plan.newDir);
      if (!sameDir) {
        if (fs.existsSync(plan.newDir)) {
          const existing = fs.readdirSync(plan.newDir).filter(Boolean);
          if (existing.length) throw new Error(`La carpeta destino ${newCodigo} ya contiene archivos`);
        } else {
          fs.mkdirSync(plan.newDir, { recursive: true });
        }
      }
      resumen.carpetas.push({ contenedor: plan.ctx.contenedor_tipo, de: oldCodigo, a: newCodigo });

      for (const fp of plan.filePlans) {
        const currentPath = fp.sourcePath;
        const targetPath = buildUniqueTargetPathForRename(
          plan.newDir,
          fp.canonicalName,
          currentPath,
          plan.her.id
        );
        await registrarMovimiento({
          operacionId,
          expedienteId: plan.her.id,
          tipo: `RENOMBRAR_${fp.slotKey}`,
          rutaAnterior: currentPath,
          rutaNueva: targetPath
        });
        if (path.resolve(currentPath) !== path.resolve(targetPath)) {
          moveFileSafely(currentPath, targetPath);
          fileMoves.push({ from: currentPath, to: targetPath });
        }
        fp.finalPath = targetPath;
        fp.finalName = path.basename(targetPath);
        fp.rutaRelativa = path.join(plan.newRel, fp.finalName).replace(/\\/g, '/');
        resumen.archivos.push({
          tipo: fp.slotKey,
          nombre: fp.finalName,
          renombrado: fp.finalName !== fp.row.nombre_archivo
        });
      }
      if (!sameDir && fs.existsSync(plan.oldDir) && fs.readdirSync(plan.oldDir).length === 0) {
        fs.rmdirSync(plan.oldDir);
        dirMoves.push({ from: plan.oldDir, to: plan.newDir, removedOnly: true });
      }
    }

    // Fase 2B: una sola transacción para rutas y expedientes.
    const runTransaction = typeof db.transaction === 'function'
      ? db.transaction.bind(db)
      : async (callback) => callback(db);
    await runTransaction(async (conn) => {
      for (const plan of planes) {
        for (const fp of plan.filePlans) {
          if (fp.isRips) {
            await conn.execute(
              'UPDATE sop_rips_archivos SET nombre_archivo = ?, ruta_relativa = ? WHERE id = ?',
              [fp.finalName, fp.rutaRelativa, fp.row.id]
            );
          } else {
            await conn.execute(
              'UPDATE sop_exp_archivos SET nombre_archivo = ?, ruta_relativa = ? WHERE id = ?',
              [fp.finalName, fp.rutaRelativa, fp.row.id]
            );
          }
        }
        await conn.execute(
          'UPDATE sop_expedientes SET codigo = ?, numero_factura = ? WHERE id = ?',
          [newCodigo, num, plan.her.id]
        );
      }
    });
    await actualizarOperacion(operacionId, 'completado');
  } catch (e) {
    logger.error('[SOPORTES] Falló renombrado FEV atómico', { expedienteId, operacionId, error: e.message });
    // Rollback físico en orden inverso; la transacción BD ya se revierte sola.
    for (const move of [...dirMoves].reverse()) {
      try {
        if (move.removedOnly && !fs.existsSync(move.from)) fs.mkdirSync(move.from, { recursive: true });
      } catch (_) { /* se registra abajo */ }
    }
    for (const move of [...fileMoves].reverse()) {
      try {
        if (fs.existsSync(move.to) && !fs.existsSync(move.from)) fs.renameSync(move.to, move.from);
      } catch (_) { /* se registra abajo */ }
    }
    await actualizarOperacion(operacionId, 'revertido', e.message);
    return { ok: false, error: `No se vinculó la factura; se revirtieron los cambios: ${e.message}` };
  }

  for (const her of hermanos) {
    try {
      await repararArchivosExpediente(her.id, { ...her, codigo: newCodigo, numero_factura: num });
    } catch (_) { /* las rutas canónicas ya quedaron persistidas */ }
  }

  try {
    await syncRipsCarpetasDia(db, exp.dia_id);
  } catch (_) { /* ignore */ }

  return {
    ok: true,
    codigo: newCodigo,
    numero_factura: num,
    paciente_nombre: exp.paciente_nombre,
    ...resumen,
    ya_renombrado: carpetaYaFacturada
  };
}

/**
 * Corrige carpeta facturada (FE{n}): quita vínculo de factura, elimina FEV y vuelve al nombre del paciente.
 */
async function revertirRenombradoPorFev(expedienteId, { paciente_linea, paciente_nombre } = {}) {
  const exp = await loadExpedienteContext(expedienteId);
  if (!exp) return { ok: false, error: 'Expediente no encontrado' };
  if (esExpedientePendienteFactura(exp)) {
    return { ok: false, error: 'La carpeta ya está sin factura vinculada' };
  }

  const parsed = parseLineaPaciente(paciente_linea || paciente_nombre || exp.paciente_nombre);
  if (!parsed) {
    return { ok: false, error: 'Indique nombre y apellido válidos para renombrar la carpeta' };
  }

  const oldCodigo = exp.codigo;
  const newCodigo = parsed.codigo;
  if (oldCodigo === newCodigo) {
    return { ok: false, error: 'El nombre del paciente coincide con el código actual de carpeta' };
  }

  const hermanos = await findExpedientesMismoCodigo(exp.dia_id, oldCodigo);
  const ids = hermanos.map((h) => h.id);
  const conflictSql = ids.length
    ? `SELECT e.id FROM sop_expedientes e WHERE e.dia_id = ? AND e.codigo = ? AND e.id NOT IN (${ids.map(() => '?').join(',')})`
    : 'SELECT e.id FROM sop_expedientes e WHERE e.dia_id = ? AND e.codigo = ?';
  const conflict = await db.query(conflictSql, [exp.dia_id, newCodigo, ...ids]);
  if (conflict.length) {
    return { ok: false, error: `Ya existe la carpeta "${newCodigo}" en este día` };
  }

  const resumen = { carpetas: [], archivos: [], fev_eliminado: false };

  for (const her of hermanos) {
    const fev = await loadArchivoExpedienteSlot(her.id, 'FEV');
    if (fev.ok) {
      await eliminarArchivoExpedienteSlot(her.id, 'FEV');
      resumen.fev_eliminado = true;
    }

    const ctx = her;
    const { abs: oldDir } = getArmadoFeDirFromContext(ctx, oldCodigo);
    const { abs: newDir, rel: newRel } = getArmadoFeDirFromContext(ctx, newCodigo);
    const dirRename = renameDirectoryIfExists(oldDir, newDir);
    if (!dirRename.ok) {
      return { ok: false, error: dirRename.error || `No se pudo renombrar la carpeta ${oldCodigo} → ${newCodigo}` };
    }
    resumen.carpetas.push({ contenedor: ctx.contenedor_tipo, de: oldCodigo, a: newCodigo });

    const pendingExp = { ...her, numero_factura: 0, codigo: newCodigo, paciente_nombre: parsed.paciente_nombre };

    if (ctx.contenedor_tipo === 'soportes') {
      const archivos = await db.query(
        'SELECT * FROM sop_exp_archivos WHERE expediente_id = ?',
        [her.id]
      );
      const usedPaths = new Set();
      for (const a of archivos) {
        const ext = path.extname(a.nombre_archivo || '.pdf').toLowerCase() || '.pdf';
        const targetName = a.tipo === 'FEV' ? buildSoportesDiskName(a.tipo, pendingExp, ext) : buildSoportesDiskName(a.tipo, pendingExp, ext);
        const diskMatch = resolveSourceFileForRename(a, oldDir, newDir, { usedPaths });
        const currentPath = diskMatch?.fullPath || null;
        if (currentPath) usedPaths.add(path.resolve(currentPath));
        const targetPath = buildUniqueTargetPathForRename(newDir, targetName, currentPath, her.id);
        if (currentPath && currentPath !== targetPath && fs.existsSync(currentPath)) {
          moveFileSafely(currentPath, targetPath);
        }
        const finalName = path.basename(targetPath);
        const rutaRelativa = path.join(newRel, finalName).replace(/\\/g, '/');
        await db.execute(
          'UPDATE sop_exp_archivos SET nombre_archivo = ?, ruta_relativa = ? WHERE id = ?',
          [finalName, rutaRelativa, a.id]
        );
        resumen.archivos.push({ tipo: a.tipo, nombre: targetName, renombrado: targetName !== a.nombre_archivo });
      }
    } else {
      let ripsArchivos = [];
      try {
        ripsArchivos = await db.query(
          'SELECT * FROM sop_rips_archivos WHERE expediente_id = ?',
          [her.id]
        );
      } catch (_) { /* tabla opcional */ }
      const usedPaths = new Set();
      for (const a of ripsArchivos) {
        const slotKey = a.slot === 'json_1' ? 'RIPS_JSON_1' : a.slot === 'json_2' ? 'RIPS_JSON_2' : 'RIPS_XML';
        const ext = path.extname(a.nombre_archivo || '.json').toLowerCase();
        const targetName = buildSoportesDiskName(slotKey, pendingExp, ext);
        const diskMatch = resolveSourceFileForRename(a, oldDir, newDir, { usedPaths });
        const currentPath = diskMatch?.fullPath || null;
        if (currentPath) usedPaths.add(path.resolve(currentPath));
        const targetPath = buildUniqueTargetPathForRename(newDir, targetName, currentPath, her.id);
        if (currentPath && currentPath !== targetPath && fs.existsSync(currentPath)) {
          moveFileSafely(currentPath, targetPath);
        }
        const finalName = path.basename(targetPath);
        const rutaRelativa = path.join(newRel, finalName).replace(/\\/g, '/');
        await db.execute(
          'UPDATE sop_rips_archivos SET nombre_archivo = ?, ruta_relativa = ? WHERE id = ?',
          [finalName, rutaRelativa, a.id]
        );
        resumen.archivos.push({ tipo: slotKey, nombre: targetName, renombrado: targetName !== a.nombre_archivo });
      }
    }

    await db.execute(
      'UPDATE sop_expedientes SET codigo = ?, numero_factura = 0, paciente_nombre = ?, fev_externa_verificada = 0 WHERE id = ?',
      [newCodigo, parsed.paciente_nombre, her.id]
    );
  }

  return {
    ok: true,
    codigo: newCodigo,
    numero_factura: 0,
    paciente_nombre: parsed.paciente_nombre,
    ...resumen
  };
}

module.exports = {
  aplicarRenombradoPorFev,
  revertirRenombradoPorFev,
  findExpedientesMismoCodigo,
  sourceDirForRename,
  resolveSourceFileForRename,
  buildUniqueTargetPathForRename,
  etiquetasCompatiblesParaRenombrado,
  renameDirectoryIfExists
};
