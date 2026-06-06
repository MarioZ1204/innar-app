/**
 * Renombrado de carpeta FE y archivos al vincular número de factura (subida FEV).
 */
const path = require('path');
const fs = require('fs');
const db = require('./db-mysql');
const { getArmadoFeDirFromContext } = require('./soportes-storage');
const { buildCanonicalName, buildSoportesDiskName } = require('./soportes-archivo-detect');
const { parseLineaPaciente, esExpedientePendienteFactura } = require('./soportes-pacientes-parse');
const { loadArchivoExpedienteSlot, eliminarArchivoExpedienteSlot } = require('./soportes-exp-archivo');
const { syncRipsCarpetasDia } = require('./soportes-rips-carpetas-sync');

async function loadExpedienteContext(expedienteId) {
  const rows = await db.query(
    `SELECT e.*, c.tipo AS contenedor_tipo, c.id AS contenedor_id,
            d.id AS dia_id, d.nombre_display, d.estado_facturacion,
            p.periodo
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
            d.nombre_display, d.estado_facturacion, p.periodo
     FROM sop_expedientes e
     JOIN sop_contenedores c ON c.id = e.contenedor_id
     JOIN sop_dias d ON d.id = c.dia_id
     JOIN sop_periodos p ON p.id = d.periodo_id
     WHERE e.dia_id = ? AND e.codigo = ?`,
    [diaId, codigo]
  );
}

function renameDirectoryIfExists(oldAbs, newAbs) {
  if (!fs.existsSync(oldAbs)) {
    const parent = path.dirname(newAbs);
    if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
    if (!fs.existsSync(newAbs)) fs.mkdirSync(newAbs, { recursive: true });
    return;
  }
  if (fs.existsSync(newAbs)) {
    const files = fs.readdirSync(oldAbs);
    for (const f of files) {
      const src = path.join(oldAbs, f);
      const dst = path.join(newAbs, f);
      if (fs.existsSync(dst)) fs.unlinkSync(dst);
      fs.renameSync(src, dst);
    }
    try { fs.rmdirSync(oldAbs); } catch (_) { /* ignore */ }
  } else {
    const parent = path.dirname(newAbs);
    if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
    fs.renameSync(oldAbs, newAbs);
  }
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

  if (oldCodigo === newCodigo && (parseInt(exp.numero_factura, 10) || 0) === num) {
    return { ok: true, ya_renombrado: true, codigo: newCodigo, numero_factura: num };
  }

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

  for (const her of hermanos) {
    const ctx = her;
    const { abs: oldDir } = getArmadoFeDirFromContext(ctx, oldCodigo);
    const { abs: newDir, rel: newRel } = getArmadoFeDirFromContext(ctx, newCodigo);
    renameDirectoryIfExists(oldDir, newDir);
    resumen.carpetas.push({ contenedor: ctx.contenedor_tipo, de: oldCodigo, a: newCodigo });

    if (ctx.contenedor_tipo === 'soportes') {
      const archivos = await db.query(
        'SELECT * FROM sop_exp_archivos WHERE expediente_id = ?',
        [her.id]
      );
      for (const a of archivos) {
        const ext = path.extname(a.nombre_archivo || '.pdf').toLowerCase() || '.pdf';
        const newName = a.tipo === 'FEV'
          ? buildCanonicalName('FEV', num, ext)
          : buildCanonicalName(a.tipo, num, ext);
        const oldPath = path.join(newDir, a.nombre_archivo);
        const newPath = path.join(newDir, newName);
        if (fs.existsSync(oldPath) && oldPath !== newPath) {
          if (fs.existsSync(newPath)) fs.unlinkSync(newPath);
          fs.renameSync(oldPath, newPath);
        }
        const rutaRelativa = path.join(newRel, newName).replace(/\\/g, '/');
        await db.execute(
          'UPDATE sop_exp_archivos SET nombre_archivo = ?, ruta_relativa = ? WHERE id = ?',
          [newName, rutaRelativa, a.id]
        );
        resumen.archivos.push({ tipo: a.tipo, nombre: newName });
      }
    } else {
      let ripsArchivos = [];
      try {
        ripsArchivos = await db.query(
          'SELECT * FROM sop_rips_archivos WHERE expediente_id = ?',
          [her.id]
        );
      } catch (_) { /* tabla opcional */ }
      for (const a of ripsArchivos) {
        const slotKey = a.slot === 'json_1' ? 'RIPS_JSON_1' : a.slot === 'json_2' ? 'RIPS_JSON_2' : 'RIPS_XML';
        const ext = path.extname(a.nombre_archivo || '.json').toLowerCase();
        const newName = buildCanonicalName(slotKey, num, ext);
        const oldPath = path.join(newDir, a.nombre_archivo);
        const newPath = path.join(newDir, newName);
        if (fs.existsSync(oldPath) && oldPath !== newPath) {
          if (fs.existsSync(newPath)) fs.unlinkSync(newPath);
          fs.renameSync(oldPath, newPath);
        }
        const rutaRelativa = path.join(newRel, newName).replace(/\\/g, '/');
        await db.execute(
          'UPDATE sop_rips_archivos SET nombre_archivo = ?, ruta_relativa = ? WHERE id = ?',
          [newName, rutaRelativa, a.id]
        );
        resumen.archivos.push({ tipo: slotKey, nombre: newName });
      }
    }

    await db.execute(
      'UPDATE sop_expedientes SET codigo = ?, numero_factura = ? WHERE id = ?',
      [newCodigo, num, her.id]
    );
  }

  try {
    await syncRipsCarpetasDia(db, exp.dia_id);
  } catch (_) { /* ignore */ }

  return {
    ok: true,
    codigo: newCodigo,
    numero_factura: num,
    paciente_nombre: exp.paciente_nombre,
    ...resumen
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
    renameDirectoryIfExists(oldDir, newDir);
    resumen.carpetas.push({ contenedor: ctx.contenedor_tipo, de: oldCodigo, a: newCodigo });

    const pendingExp = { ...her, numero_factura: 0, codigo: newCodigo, paciente_nombre: parsed.paciente_nombre };

    if (ctx.contenedor_tipo === 'soportes') {
      const archivos = await db.query(
        'SELECT * FROM sop_exp_archivos WHERE expediente_id = ?',
        [her.id]
      );
      for (const a of archivos) {
        const ext = path.extname(a.nombre_archivo || '.pdf').toLowerCase() || '.pdf';
        const newName = buildSoportesDiskName(a.tipo, pendingExp, ext);
        const oldPath = path.join(newDir, a.nombre_archivo);
        const newPath = path.join(newDir, newName);
        if (fs.existsSync(oldPath) && oldPath !== newPath) {
          if (fs.existsSync(newPath)) fs.unlinkSync(newPath);
          fs.renameSync(oldPath, newPath);
        }
        const rutaRelativa = path.join(newRel, newName).replace(/\\/g, '/');
        await db.execute(
          'UPDATE sop_exp_archivos SET nombre_archivo = ?, ruta_relativa = ? WHERE id = ?',
          [newName, rutaRelativa, a.id]
        );
        resumen.archivos.push({ tipo: a.tipo, nombre: newName });
      }
    } else {
      let ripsArchivos = [];
      try {
        ripsArchivos = await db.query(
          'SELECT * FROM sop_rips_archivos WHERE expediente_id = ?',
          [her.id]
        );
      } catch (_) { /* tabla opcional */ }
      for (const a of ripsArchivos) {
        const slotKey = a.slot === 'json_1' ? 'RIPS_JSON_1' : a.slot === 'json_2' ? 'RIPS_JSON_2' : 'RIPS_XML';
        const ext = path.extname(a.nombre_archivo || '.json').toLowerCase();
        const newName = buildSoportesDiskName(slotKey, pendingExp, ext);
        const oldPath = path.join(newDir, a.nombre_archivo);
        const newPath = path.join(newDir, newName);
        if (fs.existsSync(oldPath) && oldPath !== newPath) {
          if (fs.existsSync(newPath)) fs.unlinkSync(newPath);
          fs.renameSync(oldPath, newPath);
        }
        const rutaRelativa = path.join(newRel, newName).replace(/\\/g, '/');
        await db.execute(
          'UPDATE sop_rips_archivos SET nombre_archivo = ?, ruta_relativa = ? WHERE id = ?',
          [newName, rutaRelativa, a.id]
        );
        resumen.archivos.push({ tipo: slotKey, nombre: newName });
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
  findExpedientesMismoCodigo
};
