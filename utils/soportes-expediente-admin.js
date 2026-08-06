/**
 * Edición y eliminación de carpetas FE (expedientes armado).
 */
const path = require('path');
const fs = require('fs');
const db = require('./db-mysql');
const { getArmadoFeDirFromContext, getArmadoFeDirForExpediente } = require('./soportes-storage');
const { parseLineaPaciente, esExpedientePendienteFactura } = require('./soportes-pacientes-parse');
const { findExpedientesMismoCodigo, aplicarRenombradoPorFev, revertirRenombradoPorFev } = require('./soportes-fe-rename');

async function loadExpedienteContext(expedienteId) {
  const rows = await db.query(
    `SELECT e.*, c.tipo AS contenedor_tipo, c.id AS contenedor_id,
            d.id AS dia_id, d.nombre_display, d.estado_facturacion, p.periodo
     FROM sop_expedientes e
     LEFT JOIN sop_contenedores c ON c.id = e.contenedor_id
     LEFT JOIN sop_dias d ON d.id = COALESCE(c.dia_id, e.dia_id)
     LEFT JOIN sop_periodos p ON p.id = d.periodo_id
     WHERE e.id = ?`,
    [expedienteId]
  );
  return rows[0] || null;
}

function renameDirectoryIfExists(oldAbs, newAbs) {
  if (!fs.existsSync(oldAbs)) {
    const parent = path.dirname(newAbs);
    if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
    if (!fs.existsSync(newAbs)) fs.mkdirSync(newAbs, { recursive: true });
    return;
  }
  if (fs.existsSync(newAbs)) {
    for (const f of fs.readdirSync(oldAbs)) {
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

async function renombrarCodigoCarpetas(diaId, codigoViejo, codigoNuevo) {
  const hermanos = await findExpedientesMismoCodigo(diaId, codigoViejo);
  for (const her of hermanos) {
    // Si ya tiene carpeta física inmutable (ID incluido en el nombre), NUNCA se
    // renombra en disco: solo se actualiza el código de negocio en BD. Así se
    // evita el riesgo de perder/mover archivos al cambiar paciente/factura.
    if (her.carpeta_fisica) {
      await db.execute('UPDATE sop_expedientes SET codigo = ? WHERE id = ?', [codigoNuevo, her.id]);
      continue;
    }

    const { abs: oldDir } = getArmadoFeDirFromContext(her, codigoViejo);
    const { abs: newDir, rel: newRel } = getArmadoFeDirFromContext(her, codigoNuevo);
    renameDirectoryIfExists(oldDir, newDir);

    const archivos = await db.query('SELECT * FROM sop_exp_archivos WHERE expediente_id = ?', [her.id]);
    for (const a of archivos) {
      const rutaRelativa = path.join(newRel, a.nombre_archivo).replace(/\\/g, '/');
      await db.execute('UPDATE sop_exp_archivos SET ruta_relativa = ? WHERE id = ?', [rutaRelativa, a.id]);
    }
    let ripsArchivos = [];
    try {
      ripsArchivos = await db.query('SELECT * FROM sop_rips_archivos WHERE expediente_id = ?', [her.id]);
    } catch (_) { /* ignore */ }
    for (const a of ripsArchivos) {
      const rutaRelativa = path.join(newRel, a.nombre_archivo).replace(/\\/g, '/');
      await db.execute('UPDATE sop_rips_archivos SET ruta_relativa = ? WHERE id = ?', [rutaRelativa, a.id]);
    }

    await db.execute('UPDATE sop_expedientes SET codigo = ? WHERE id = ?', [codigoNuevo, her.id]);
  }
  return hermanos.length;
}

async function actualizarExpediente(expedienteId, body) {
  let exp = await loadExpedienteContext(expedienteId);
  if (!exp) return { error: 'Expediente no encontrado', status: 404 };

  const lineaPaciente = body.paciente_linea || body.paciente_nombre;
  let renombrado = null;

  if (body.revertir_factura === true || body.revertir_factura === '1' || body.revertir_factura === 1) {
    renombrado = await revertirRenombradoPorFev(expedienteId, {
      paciente_linea: lineaPaciente,
      paciente_nombre: body.paciente_nombre
    });
    if (!renombrado.ok) return { error: renombrado.error, status: 400 };
    if (body.paciente_documento != null || body.notas != null) {
      const codigo = renombrado.codigo;
      await db.execute(
        `UPDATE sop_expedientes SET
          paciente_documento = COALESCE(?, paciente_documento),
          notas = COALESCE(?, notas)
         WHERE dia_id = ? AND codigo = ?`,
        [body.paciente_documento || null, body.notas != null ? body.notas : null, exp.dia_id, codigo]
      );
    }
    return { ok: true, renombrado };
  }

  if (body.numero_factura != null && body.numero_factura !== '') {
    const numNuevo = parseInt(body.numero_factura, 10);
    const numActual = parseInt(exp.numero_factura, 10) || 0;
    if (numNuevo > 0 && numNuevo !== numActual) {
      renombrado = await aplicarRenombradoPorFev(expedienteId, numNuevo);
      if (!renombrado.ok) return { error: renombrado.error, status: 400 };
      exp = await loadExpedienteContext(expedienteId);
    }
  }

  if (lineaPaciente && esExpedientePendienteFactura(exp)) {
    const parsed = parseLineaPaciente(lineaPaciente);
    if (!parsed) {
      return { error: 'Indique nombre y apellido válidos', status: 400 };
    }
    const nuevoCodigo = body.codigo || parsed.codigo;
    if (nuevoCodigo !== exp.codigo) {
      const dup = await db.query(
        'SELECT id FROM sop_expedientes WHERE contenedor_id = ? AND codigo = ? AND dia_id = ?',
        [exp.contenedor_id, nuevoCodigo, exp.dia_id]
      );
      if (dup.length) {
        return { error: `Ya existe la carpeta "${nuevoCodigo}"`, status: 409 };
      }
      await renombrarCodigoCarpetas(exp.dia_id, exp.codigo, nuevoCodigo);
    }
    await db.execute(
      'UPDATE sop_expedientes SET paciente_nombre = ? WHERE dia_id = ? AND codigo = ?',
      [parsed.paciente_nombre, exp.dia_id, nuevoCodigo]
    );
  } else if (lineaPaciente && !esExpedientePendienteFactura(exp)) {
    const parsed = parseLineaPaciente(lineaPaciente);
    if (!parsed) {
      return { error: 'Indique nombre y apellido válidos', status: 400 };
    }
    await db.execute(
      'UPDATE sop_expedientes SET paciente_nombre = ? WHERE dia_id = ? AND codigo = ?',
      [parsed.paciente_nombre, exp.dia_id, exp.codigo]
    );
  }

  const { fev_externa_verificada, listo_radicacion, paciente_documento, notas } = body;
  const tieneMeta = fev_externa_verificada != null || listo_radicacion != null
    || paciente_documento != null || notas != null;
  if (tieneMeta) {
    await db.execute(
      `UPDATE sop_expedientes SET
        fev_externa_verificada = COALESCE(?, fev_externa_verificada),
        listo_radicacion = COALESCE(?, listo_radicacion),
        paciente_documento = COALESCE(?, paciente_documento),
        notas = COALESCE(?, notas)
       WHERE id = ?`,
      [
        fev_externa_verificada != null ? (fev_externa_verificada ? 1 : 0) : null,
        listo_radicacion != null ? (listo_radicacion ? 1 : 0) : null,
        paciente_documento || null,
        notas != null ? notas : null,
        expedienteId
      ]
    );
  }

  return { ok: true, renombrado };
}

async function eliminarExpediente(expedienteId) {
  const exp = await loadExpedienteContext(expedienteId);
  if (!exp) return { error: 'Expediente no encontrado', status: 404 };

  const hermanos = await findExpedientesMismoCodigo(exp.dia_id, exp.codigo);
  let archivosBorrados = 0;

  for (const her of hermanos) {
    const { abs: feDir } = getArmadoFeDirForExpediente(her, her);
    if (fs.existsSync(feDir)) {
      try {
        fs.rmSync(feDir, { recursive: true, force: true });
      } catch (_) { /* ignore */ }
    }
    const arch = await db.query('SELECT id FROM sop_exp_archivos WHERE expediente_id = ?', [her.id]);
    archivosBorrados += arch.length;
    await db.execute('DELETE FROM sop_exp_archivos WHERE expediente_id = ?', [her.id]);
    try {
      await db.execute('DELETE FROM sop_rips_archivos WHERE expediente_id = ?', [her.id]);
    } catch (_) { /* ignore */ }
    await db.execute('DELETE FROM sop_expedientes WHERE id = ?', [her.id]);
  }

  return {
    ok: true,
    codigo: exp.codigo,
    expedientes_eliminados: hermanos.length,
    archivos_eliminados: archivosBorrados
  };
}

module.exports = {
  actualizarExpediente,
  eliminarExpediente,
  renombrarCodigoCarpetas
};
