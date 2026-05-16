// routes/recibos.js
// Recibos, servicios, entidades
const express = require('express');
const router = express.Router();
const db = require('../utils/db-mysql');
const logger = require('../utils/logger');
const { getLogoReciboBase64 } = require('../utils/puppeteer-utils');
const {
  requireAuth, requireRoleOrPerm,
  safeError, emitSocket, parseReciboId
} = require('../middleware/index');
const { fusionarListaEntidades, normalizarNombreEntidad } = require('../utils/catalogo-entidades');

// Helper local
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// --- Alias de estudios para filtrado flexible ---
const ESTUDIO_ALIAS_GROUPS = [
  {
    keywords: ['psg basica', 'psg básica', 'psg b', 'polisomnografia', 'polisomnografía', 'polisomnografia basica', 'polisomnografía básica'],
    patterns: ['PSG B%sica', 'Polisomnograf%a']
  },
  {
    keywords: ['psg cpap', 'psg titulacion cpap', 'psg titulación cpap', 'cpap'],
    patterns: ['%Titulaci%n%CPAP%', '%PSG%CPAP%']
  },
  {
    keywords: ['psg bpap', 'psg titulacion bpap', 'psg titulación bpap', 'bpap'],
    patterns: ['%Titulaci%n%BPAP%', '%PSG%BPAP%']
  },
  {
    keywords: ['psg noche dividida', 'noche dividida', 'split night'],
    patterns: ['%Noche Dividida%', '%split night%']
  },
  {
    keywords: ['eeg', 'electroencefalograma', 'electroencefalograma computarizado', 'electroencefalograma convencional'],
    patterns: ['Electroencefalograma%']
  },
  {
    keywords: ['vtm', 'monitorizacion', 'monitorización', 'video eeg', 'video-eeg', 'monitorizacion eeg', 'monitorización eeg'],
    patterns: ['Monitorizaci%n%']
  },
  {
    keywords: ['mslt', 'tlm', 'test de latencia', 'latencia multiple', 'latencia múltiple'],
    patterns: ['%Latencia M%ltiple%']
  }
];

function expandTipoServicioFilter(values) {
  const expanded = new Set();
  for (const val of values) {
    const norm = val.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    let matched = false;
    for (const group of ESTUDIO_ALIAS_GROUPS) {
      if (group.keywords.some(k => k.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() === norm)) {
        group.patterns.forEach(p => expanded.add(p));
        matched = true;
        break;
      }
    }
    if (!matched) expanded.add(val);
  }
  return [...expanded];
}

function buildRecibosFilter(query) {
  const { fecha_desde, fecha_hasta, tipo_pago, medico_id, medico_nombre, generado_por_id, nombre_entidad, tipo_servicio, q, estado_pago, anulado } = query;
  const conditions = [];
  const params = [];
  if (fecha_desde) { conditions.push('fecha >= ?'); params.push(fecha_desde); }
  if (fecha_hasta) { conditions.push('fecha <= ?'); params.push(fecha_hasta); }
  if (tipo_pago) {
    const arr = tipo_pago.split(',').filter(Boolean);
    if (arr.length === 1) { conditions.push('tipo_pago = ?'); params.push(arr[0]); }
    else if (arr.length > 1) { conditions.push(`tipo_pago IN (${arr.map(() => '?').join(',')})`); params.push(...arr); }
  }
  if (medico_id) {
    const arr = medico_id.split(',').filter(Boolean);
    if (arr.length === 1) { conditions.push('medico_id = ?'); params.push(parseInt(arr[0], 10)); }
    else if (arr.length > 1) { conditions.push(`medico_id IN (${arr.map(() => '?').join(',')})`); params.push(...arr.map(v => parseInt(v, 10))); }
  }
  if (medico_nombre) { conditions.push('medico_nombre = ?'); params.push(medico_nombre); }
  if (generado_por_id) {
    const arr = generado_por_id.split(',').filter(Boolean);
    if (arr.length === 1) { conditions.push('generado_por_id = ?'); params.push(parseInt(arr[0], 10)); }
    else if (arr.length > 1) { conditions.push(`generado_por_id IN (${arr.map(() => '?').join(',')})`); params.push(...arr.map(v => parseInt(v, 10))); }
  }
  if (nombre_entidad) {
    const arr = nombre_entidad.split(',').filter(Boolean);
    if (arr.length === 1) { conditions.push('UPPER(TRIM(nombre_entidad)) = UPPER(TRIM(?))'); params.push(arr[0]); }
    else if (arr.length > 1) { conditions.push(`UPPER(TRIM(nombre_entidad)) IN (${arr.map(() => 'UPPER(TRIM(?))').join(',')})`); params.push(...arr); }
  }
  if (tipo_servicio) {
    const raw = tipo_servicio.split(',').filter(Boolean);
    const expanded = expandTipoServicioFilter(raw);
    if (expanded.length === 1) { conditions.push('tipo_servicio LIKE ?'); params.push(expanded[0].includes('%') ? expanded[0] : `%${expanded[0]}%`); }
    else if (expanded.length > 1) { conditions.push(`(${expanded.map(() => 'tipo_servicio LIKE ?').join(' OR ')})`); params.push(...expanded.map(v => v.includes('%') ? v : `%${v}%`)); }
  }
  if (estado_pago && (estado_pago === 'PAGADO' || estado_pago === 'PENDIENTE')) { conditions.push('estado_pago = ?'); params.push(estado_pago); }
  if (anulado === 'si') { conditions.push('anulado = 1'); }
  else if (anulado === 'no') { conditions.push('(anulado = 0 OR anulado IS NULL)'); }
  if (q) {
    conditions.push('(cliente LIKE ? OR numero LIKE ? OR observaciones LIKE ? OR medico_nombre LIKE ? OR nombre_entidad LIKE ? OR tipo_servicio LIKE ? OR generado_por_nombre LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like, like, like, like, like);
  }
  return { where: conditions.length ? 'WHERE ' + conditions.join(' AND ') : '', params };
}

// --- Servicios ---

router.get('/servicios', requireAuth, async (req, res) => {
  try {
    const rows = await db.query('SELECT id, nombre FROM servicios_recibo WHERE activo=1 ORDER BY nombre ASC');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: safeError(err) }); }
});

router.post('/servicios', requireAuth, requireRoleOrPerm(['superadmin', 'admin'], 'recibos.gestionar_servicios'), async (req, res) => {
  const nombre = (req.body.nombre || '').trim();
  if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
  try {
    const result = await db.execute('INSERT INTO servicios_recibo (nombre) VALUES (?)', [nombre]);
    res.json({ ok: true, id: result.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'El servicio ya existe' });
    res.status(500).json({ error: safeError(err) });
  }
});

router.put('/servicios/:id', requireAuth, requireRoleOrPerm(['superadmin', 'admin'], 'recibos.gestionar_servicios'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const nombre = (req.body.nombre || '').trim();
  if (!nombre || isNaN(id)) return res.status(400).json({ error: 'Datos inválidos' });
  try {
    await db.execute('UPDATE servicios_recibo SET nombre=? WHERE id=?', [nombre, id]);
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'El servicio ya existe' });
    res.status(500).json({ error: safeError(err) });
  }
});

router.delete('/servicios/:id', requireAuth, requireRoleOrPerm(['superadmin', 'admin'], 'recibos.gestionar_servicios'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  try {
    await db.execute('DELETE FROM servicios_recibo WHERE id=?', [id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: safeError(err) }); }
});

// --- Entidades ---

router.get('/entidades', requireAuth, async (req, res) => {
  try {
    const rows = await db.query('SELECT id, nombre FROM entidades WHERE activo=1 ORDER BY nombre ASC');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: safeError(err) }); }
});

router.post('/entidades', requireAuth, requireRoleOrPerm(['superadmin', 'admin'], 'modulo.gestion_datos'), async (req, res) => {
  const nombre = normalizarNombreEntidad(req.body?.nombre).toUpperCase();
  if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
  try {
    const result = await db.execute('INSERT INTO entidades (nombre, activo) VALUES (?, 1)', [nombre]);
    res.json({ ok: true, id: result.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'La entidad ya existe' });
    res.status(500).json({ error: safeError(err) });
  }
});

router.put('/entidades/:id', requireAuth, requireRoleOrPerm(['superadmin', 'admin'], 'modulo.gestion_datos'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const nombre = normalizarNombreEntidad(req.body?.nombre).toUpperCase();
  if (!nombre || isNaN(id)) return res.status(400).json({ error: 'Datos inválidos' });
  try {
    await db.execute('UPDATE entidades SET nombre=? WHERE id=?', [nombre, id]);
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'La entidad ya existe' });
    res.status(500).json({ error: safeError(err) });
  }
});

router.delete('/entidades/:id', requireAuth, requireRoleOrPerm(['superadmin', 'admin'], 'modulo.gestion_datos'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  try {
    await db.execute('DELETE FROM entidades WHERE id=?', [id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: safeError(err) }); }
});

// --- Recibos ---

// POST /api/recibos
router.post('/recibos', requireAuth, requireRoleOrPerm(['superadmin', 'admin', 'admin_recepcion', 'recepcion', 'auxiliar_recepcion'], 'recibos.crear'), async (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Cuerpo de la petición inválido' });
  const { cliente, fecha, total, data, medico_id, medico_nombre, tipo_pago, nombre_entidad, tipo_servicio, turno_id, cita_electro_id, observaciones, estado_pago } = body;
  const totalNum = Number(total);
  if (!Number.isFinite(totalNum) || totalNum < 0) {
    return res.status(400).json({ error: 'Se requiere el campo total con un valor numérico válido' });
  }
  if (data && typeof data === 'object' && Array.isArray(data.items)) {
    const sumaItems = data.items.reduce((acc, it) => acc + Number(it?.price || 0), 0);
    const subtotal = Number(data.subtotal || 0);
    const iva = Number(data.iva || 0);
    if (Math.abs(sumaItems - subtotal) > 0.5) {
      return res.status(400).json({ error: 'El subtotal no coincide con la suma de los ítems' });
    }
    if (Math.abs((subtotal + iva) - totalNum) > 0.5) {
      return res.status(400).json({ error: 'El total no coincide con subtotal + IVA' });
    }
  }
  const estadoPagoVal = (estado_pago === 'PENDIENTE') ? 'PENDIENTE' : 'PAGADO';

  let generado_por_id = req.session.usuarioId || null;
  let generado_por_nombre = null;
  try {
    if (generado_por_id) {
      const users = await db.query('SELECT nombre, usuario FROM usuarios WHERE id = ?', [generado_por_id]);
      if (users.length > 0) generado_por_nombre = users[0].nombre || users[0].usuario;
    }
  } catch (_) {}

  const conn = await db.getPool().getConnection();
  try {
    await conn.beginTransaction();
    const [maxRows] = await conn.execute('SELECT MAX(CAST(numero AS UNSIGNED)) AS maxNum FROM recibos FOR UPDATE');
    const nextNum = (parseInt(maxRows[0]?.maxNum || '0', 10) || 0) + 1;
    const numeroAsignado = String(nextNum).padStart(4, '0');

    const [result] = await conn.execute(
      `INSERT INTO recibos (numero, cliente, fecha, total, data, medico_id, medico_nombre, tipo_pago, nombre_entidad, tipo_servicio, generado_por_id, generado_por_nombre, turno_id, cita_electro_id, observaciones, estado_pago, fecha_pago)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        numeroAsignado, cliente || null, fecha || null, total || 0,
        data ? JSON.stringify(data) : null, medico_id || null, medico_nombre || null,
        tipo_pago || null, nombre_entidad || null, tipo_servicio || null,
        generado_por_id, generado_por_nombre, turno_id || null, cita_electro_id || null,
        observaciones || null, estadoPagoVal,
        estadoPagoVal === 'PAGADO' ? new Date() : null
      ]
    );
    await conn.commit();

    emitSocket('recibo:creado', { id: result.insertId, numero: numeroAsignado, cliente, fecha, total });
    emitSocket('recibo:actualizar-lista');
    emitSocket('stats:actualizar');
    res.json({ ok: true, id: result.insertId, numero: numeroAsignado });
  } catch (err) {
    await conn.rollback();
    logger.error('[RECIBOS] Error guardando recibo:', err.message);
    res.status(500).json({ error: safeError(err) });
  } finally {
    conn.release();
  }
});

// GET /api/recibos/generadores — BEFORE /:id
router.get('/recibos/generadores', requireAuth, async (req, res) => {
  try {
    const rows = await db.query(
      `SELECT DISTINCT generado_por_id AS id, generado_por_nombre AS nombre FROM recibos WHERE generado_por_id IS NOT NULL ORDER BY generado_por_nombre ASC`
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: safeError(err) }); }
});

// GET /api/recibos/opciones — BEFORE /:id
router.get('/recibos/opciones', requireAuth, async (req, res) => {
  try {
    const [catalogoRows, usadasRows] = await Promise.all([
      db.query('SELECT nombre AS valor FROM entidades WHERE activo=1 ORDER BY nombre ASC'),
      db.query(`
        SELECT DISTINCT valor FROM (
          SELECT TRIM(entidad) AS valor FROM turnos WHERE entidad IS NOT NULL AND TRIM(entidad) <> ''
          UNION
          SELECT TRIM(nombre_entidad) AS valor FROM recibos WHERE nombre_entidad IS NOT NULL AND TRIM(nombre_entidad) <> ''
        ) AS t ORDER BY valor ASC
      `)
    ]);
    const entidades = fusionarListaEntidades(
      catalogoRows.map((r) => r.valor),
      usadasRows.map((r) => r.valor)
    );
    const [serviciosRows, usadosTipoRows] = await Promise.all([
      db.query('SELECT DISTINCT nombre AS valor FROM servicios_recibo WHERE activo=1 AND nombre IS NOT NULL AND nombre <> "" ORDER BY nombre ASC').catch(() => []),
      db.query('SELECT DISTINCT TRIM(tipo_servicio) AS valor FROM recibos WHERE tipo_servicio IS NOT NULL AND TRIM(tipo_servicio) <> "" ORDER BY valor ASC').catch(() => [])
    ]);
    const serviciosSet = new Set(serviciosRows.map(r => (r.valor || '').toUpperCase()));
    const extrasEstudios = usadosTipoRows.filter(r => !serviciosSet.has((r.valor || '').toUpperCase()));
    const estudios = [...serviciosRows.map(r => r.valor), ...extrasEstudios.map(r => r.valor)].sort((a, b) => a.localeCompare(b));
    res.json({ entidades, estudios });
  } catch (err) { res.status(500).json({ error: safeError(err) }); }
});

// GET /api/recibos/next-number — BEFORE /:id
router.get('/recibos/next-number', requireAuth, async (req, res) => {
  try {
    const rows = await db.query('SELECT MAX(CAST(numero AS UNSIGNED)) AS maxNum FROM recibos');
    const maxNum = parseInt(rows[0]?.maxNum || '0', 10) || 0;
    res.json({ nextNumber: maxNum + 1 });
  } catch (err) { res.status(500).json({ error: safeError(err) }); }
});

// GET /api/recibos/buscar-cita — BEFORE /:id
router.get('/recibos/buscar-cita', requireAuth, requireRoleOrPerm(['superadmin', 'admin', 'admin_recepcion', 'recepcion', 'auxiliar_recepcion'], 'recibos.ver'), async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q || q.length < 2) return res.json([]);
  try {
    const like = `%${q}%`;
    const turnos = await db.query(
      `SELECT t.id, t.paciente_nombre, t.paciente_documento, t.fecha, t.hora,
              t.tipo_consulta, t.entidad, u.nombre AS medico_nombre, u.id AS medico_id, 'turno' AS origen
       FROM turnos t LEFT JOIN usuarios u ON u.id = t.doctor_id
       WHERE (t.paciente_nombre LIKE ? OR t.paciente_documento LIKE ?) AND t.estado IN ('COMPLETADO','ATENDIDO') AND t.fecha >= CURDATE() - INTERVAL 7 DAY
       ORDER BY t.fecha DESC, t.hora DESC LIMIT 20`,
      [like, like]
    );
    const citasE = await db.query(
      `SELECT ce.id, p.nombre AS paciente_nombre, p.documento AS paciente_documento,
              ce.fecha, ce.hora_agendamiento AS hora, ce.estudio AS tipo_consulta,
              NULL AS entidad, NULL AS medico_nombre, NULL AS medico_id, 'electro' AS origen
       FROM citas_electro ce JOIN pacientes p ON p.id = ce.paciente_id
       WHERE (p.nombre LIKE ? OR p.documento LIKE ?) AND ce.estado = 'Completado' AND ce.deleted_at IS NULL AND ce.fecha >= CURDATE() - INTERVAL 7 DAY
       ORDER BY ce.fecha DESC, ce.hora_agendamiento DESC LIMIT 20`,
      [like, like]
    );
    res.json([...turnos, ...citasE]);
  } catch (err) {
    logger.error('[RECIBOS] buscar-cita:', err.message);
    res.status(500).json({ error: safeError(err) });
  }
});

// GET /api/recibos
router.get('/recibos', requireAuth, requireRoleOrPerm(['superadmin', 'admin', 'admin_recepcion', 'recepcion', 'auxiliar_recepcion', 'contabilidad'], 'recibos.ver'), async (req, res) => {
  try {
    const rawLimit = parseInt(req.query.limit, 10);
    const safeLimit = Math.max(1, Math.min(Number.isFinite(rawLimit) ? rawLimit : 500, 500));
    const rawOffset = parseInt(req.query.offset, 10);
    const safeOffset = Math.max(0, Number.isFinite(rawOffset) ? rawOffset : 0);
    const { where, params } = buildRecibosFilter(req.query);
    const [rows, countRows] = await Promise.all([
      db.query(
        `SELECT id, numero, cliente, fecha, total, tipo_pago, nombre_entidad, medico_id, medico_nombre, tipo_servicio, generado_por_id, generado_por_nombre, observaciones, turno_id, cita_electro_id, creado_en, data, estado_pago, fecha_pago, pagado_por_nombre, anulado, anulado_razon, anulado_por_nombre, anulado_en FROM recibos ${where} ORDER BY id DESC LIMIT ${safeLimit} OFFSET ${safeOffset}`,
        params
      ),
      db.query(`SELECT COUNT(*) AS total FROM recibos ${where}`, params)
    ]);
    const totalCount = parseInt(countRows[0]?.total, 10) || 0;
    res.json({ rows: rows || [], totalCount, limit: safeLimit, offset: safeOffset });
  } catch (err) {
    logger.error('[RECIBOS] list error:', err.message);
    res.status(500).json({ error: safeError(err) });
  }
});

// GET /api/recibos/export/xlsx — BEFORE /:id
router.get('/recibos/export/xlsx', requireAuth, requireRoleOrPerm(['superadmin', 'admin', 'admin_recepcion', 'recepcion', 'auxiliar_recepcion', 'contabilidad'], 'recibos.ver'), async (req, res) => {
  try {
    const { where, params } = buildRecibosFilter(req.query);
    const rows = await db.query(
      `SELECT numero, fecha, cliente, tipo_pago, nombre_entidad, medico_nombre, tipo_servicio, total, generado_por_nombre, observaciones, creado_en, anulado, anulado_razon, estado_pago, fecha_pago, pagado_por_nombre FROM recibos ${where} ORDER BY numero ASC, id ASC`,
      params
    );
    const data = rows.map(r => ({
      'Nº Recibo': r.numero || '',
      'Fecha': r.fecha ? String(r.fecha).slice(0, 10) : '',
      'Paciente': r.cliente || '',
      'Forma de Pago': r.tipo_pago || '',
      'Entidad': r.nombre_entidad || '',
      'Médico': r.medico_nombre || '',
      'Servicio': r.tipo_servicio || '',
      'Total': Number(r.total || 0),
      'Estado': r.anulado ? 'ANULADO' : 'Activo',
      'Estado Pago': r.anulado ? '-' : (r.estado_pago || 'PAGADO'),
      'Fecha Pago': r.fecha_pago ? new Date(r.fecha_pago).toISOString().slice(0, 19).replace('T', ' ') : '',
      'Pagado por': r.pagado_por_nombre || '',
      'Razón Anulación': r.anulado ? (r.anulado_razon || '') : '',
      'Generado por': r.generado_por_nombre || '',
      'Observaciones': r.observaciones || '',
      'Creado en': r.creado_en ? new Date(r.creado_en).toISOString().slice(0, 19).replace('T', ' ') : ''
    }));
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Recibos');
    if (data.length > 0) {
      ws.columns = Object.keys(data[0]).map(key => ({ header: key, key, width: 20 }));
      data.forEach(row => ws.addRow(row));
    }
    const buffer = await wb.xlsx.writeBuffer();
    const today = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="recibos-${today}.xlsx"`);
    res.send(buffer);
  } catch (err) { res.status(500).json({ error: safeError(err) }); }
});

// GET /api/recibos/export/pdf-reporte — HTML imprimible, BEFORE /:id
router.get('/recibos/export/pdf-reporte', requireAuth, requireRoleOrPerm(['superadmin', 'admin', 'admin_recepcion', 'recepcion', 'auxiliar_recepcion', 'contabilidad'], 'recibos.ver'), async (req, res) => {
  try {
    const { where, params } = buildRecibosFilter(req.query);
    const rows = await db.query(
      `SELECT numero, fecha, cliente, tipo_pago, nombre_entidad, medico_nombre, tipo_servicio, total, generado_por_nombre, observaciones, anulado, anulado_razon, estado_pago FROM recibos ${where} ORDER BY numero ASC, id ASC`,
      params
    );
    const recibosActivos = rows.filter(r => !r.anulado);
    const totalActivos = recibosActivos.reduce((s, r) => s + Number(r.total || 0), 0);
    const cantAnulados = rows.length - recibosActivos.length;
    const recibosPendientes = recibosActivos.filter(r => r.estado_pago === 'PENDIENTE');
    const totalPendientes = recibosPendientes.reduce((s, r) => s + Number(r.total || 0), 0);
    const fmt = (v) => Number(v).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmtFecha = (v) => v ? String(v).slice(0, 10) : '-';

    const rowsHTML = rows.map((r, i) => {
      const esAnulado = r.anulado == 1;
      const anulTag = esAnulado ? ' <span style="background:#dc2626;color:#fff;font-size:7px;padding:1px 5px;border-radius:3px;font-weight:700;letter-spacing:0.5px">ANULADO</span>' : '';
      const esPendiente = !esAnulado && r.estado_pago === 'PENDIENTE';
      const pendienteTag = esPendiente ? ' <span style="background:#fff7ed;color:#c2410c;font-size:7px;padding:1px 5px;border-radius:3px;font-weight:700;letter-spacing:0.5px;border:1px solid #fed7aa">PENDIENTE</span>' : '';
      const rowStyle = esAnulado ? 'background:#fef2f2;border-left:3px solid #dc2626;color:#991b1b;text-decoration:line-through' : esPendiente ? 'background:#fff7ed;border-left:3px solid #f97316' : (i % 2 === 0 ? 'background:#f9fafb' : '');
      return `<tr style="${rowStyle}">
        <td>${escapeHtml(r.numero || '-')}${anulTag}${pendienteTag}</td>
        <td>${escapeHtml(fmtFecha(r.fecha))}</td>
        <td>${escapeHtml(r.cliente || '-')}</td>
        <td>${escapeHtml(r.tipo_pago || '-')}</td>
        <td>${escapeHtml(r.nombre_entidad || '-')}</td>
        <td>${escapeHtml(r.medico_nombre || '-')}</td>
        <td>${escapeHtml(r.tipo_servicio || '-')}</td>
        <td style="text-align:right">$ ${fmt(r.total)}</td>
        <td>${escapeHtml(r.generado_por_nombre || '-')}</td>
      </tr>`;
    }).join('');

    const descFiltros = [
      fecha_desde ? `Desde: ${fecha_desde}` : '',
      fecha_hasta ? `Hasta: ${fecha_hasta}` : '',
      tipo_pago ? `Tipo pago: ${tipo_pago}` : ''
    ].filter(Boolean).join(' · ') || 'Sin filtros';

    const resumenAnulados = cantAnulados > 0 ? `<span style="color:#dc2626;margin-left:10px">(${cantAnulados} anulado${cantAnulados > 1 ? 's' : ''})</span>` : '';
    const resumenPendientes = recibosPendientes.length > 0 ? `<span class="stat" style="color:#c2410c;background:#fff7ed">${recibosPendientes.length} pendiente${recibosPendientes.length > 1 ? 's' : ''}: $ ${fmt(totalPendientes)}</span>` : '';

    const html = `<!doctype html><html><head><meta charset="utf-8"/>
    <title>Reporte Recibos</title>
    <style>
      *{margin:0;padding:0;box-sizing:border-box}
      body{font-family:'Segoe UI',Arial,sans-serif;font-size:11px;padding:20px 24px;color:#111}
      .report-header{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #2d4a47;padding-bottom:10px;margin-bottom:14px}
      .report-header h1{font-size:17px;color:#2d4a47;font-weight:700}
      .report-header .date{font-size:10px;color:#6b7280}
      .sub{color:#555;font-size:10.5px;margin-bottom:14px;display:flex;gap:16px;flex-wrap:wrap;align-items:center}
      .sub .stat{background:#f0f9f7;padding:4px 12px;border-radius:6px;font-weight:600;color:#2d4a47}
      table{width:100%;border-collapse:collapse;font-size:9.5px;border:1px solid #d1d5db}
      th{background:#2d4a47;color:white;padding:7px 8px;text-align:left;font-size:9px;text-transform:uppercase;letter-spacing:0.04em}
      td{padding:6px 8px;border-bottom:1px solid #e5e7eb}
      tr:nth-child(even){background:#f9fafb}
      .total-row{font-weight:bold;background:#f0f9f4;border-top:2px solid #2d4a47}
      .footer{margin-top:14px;text-align:center;font-size:8px;color:#9ca3af;border-top:1px solid #e5e7eb;padding-top:6px}
      @media print{.no-print{display:none}}
    </style>
    </head><body>
    <div class="report-header">
      <h1>Reporte de Recibos &mdash; Instituto Neurociencias</h1>
      <span class="date">Generado: ${new Date().toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
    </div>
    <div class="sub">
      <span>${escapeHtml(descFiltros)}</span>
      <span class="stat">${recibosActivos.length} recibos activos</span>
      <span class="stat" style="color:#059669">Total: $ ${fmt(totalActivos)}</span>
      ${resumenAnulados}${resumenPendientes}
    </div>
    <div class="no-print" style="margin-bottom:14px">
      <button onclick="window.print()" style="padding:8px 18px;background:#2d4a47;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:600;font-size:12px">🖨️ Imprimir / Guardar PDF</button>
    </div>
    <table>
      <thead><tr>
        <th>N°</th><th>Fecha</th><th>Paciente</th><th>Tipo Pago</th>
        <th>Entidad</th><th>Médico</th><th>Servicio</th><th style="text-align:right">Total</th><th>Generado por</th>
      </tr></thead>
      <tbody>${rowsHTML}
        <tr class="total-row">
          <td colspan="7" style="text-align:right;padding-right:12px">TOTAL (activos)</td>
          <td style="text-align:right">$ ${fmt(totalActivos)}</td><td></td>
        </tr>
      </tbody>
    </table>
    <div class="footer">Instituto Neurociencias &middot; NIT 901164565-1 &middot; Reporte generado automáticamente</div>
    <script>window.onload=function(){window.print();}<\/script>
    </body></html>`;

    res.send(html);
  } catch (err) { res.status(500).json({ error: safeError(err) }); }
});

// DELETE /api/recibos/reset — BEFORE /:id
router.delete('/recibos/reset', requireAuth, requireRoleOrPerm(['superadmin', 'admin'], 'recibos.resetear'), async (req, res) => {
  try {
    await db.execute('DELETE FROM recibos');
    await db.execute('ALTER TABLE recibos AUTO_INCREMENT = 1');
    res.json({ ok: true, message: 'Todos los recibos han sido eliminados' });
  } catch (err) { res.status(500).json({ error: safeError(err) }); }
});

// PUT /api/recibos/:id
router.put('/recibos/:id', requireAuth, requireRoleOrPerm(['superadmin'], 'recibos.editar'), async (req, res) => {
  const id = parseReciboId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'ID de recibo inválido' });
  const { cliente, medico_nombre, tipo_servicio, nombre_entidad } = req.body || {};
  try {
    const rows = await db.query('SELECT id, anulado FROM recibos WHERE id=?', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Recibo no encontrado' });
    if (rows[0].anulado) return res.status(400).json({ error: 'No se puede editar un recibo anulado' });
    const updates = [];
    const params = [];
    if (cliente !== undefined) { updates.push('cliente = ?'); params.push(String(cliente).trim()); }
    if (medico_nombre !== undefined) { updates.push('medico_nombre = ?'); params.push(String(medico_nombre).trim()); }
    if (tipo_servicio !== undefined) { updates.push('tipo_servicio = ?'); params.push(String(tipo_servicio).trim()); }
    if (nombre_entidad !== undefined) { updates.push('nombre_entidad = ?'); params.push(String(nombre_entidad).trim()); }
    if (!updates.length) return res.status(400).json({ error: 'No hay campos para actualizar' });
    params.push(id);
    await db.execute(`UPDATE recibos SET ${updates.join(', ')} WHERE id = ?`, params);
    emitSocket('recibo:actualizar-lista'); emitSocket('stats:actualizar');
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: safeError(err) }); }
});

// PATCH /api/recibos/:id/anular
router.patch('/recibos/:id/anular', requireAuth, requireRoleOrPerm(['superadmin'], 'recibos.anular'), async (req, res) => {
  const id = parseReciboId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'ID de recibo inválido' });
  const { razon } = req.body || {};
  if (!razon || !razon.trim()) return res.status(400).json({ error: 'Debe indicar la razón de anulación' });
  try {
    const rows = await db.query('SELECT id, anulado FROM recibos WHERE id=?', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Recibo no encontrado' });
    if (rows[0].anulado) return res.status(400).json({ error: 'Este recibo ya está anulado' });
    const usuario = await db.query('SELECT nombre FROM usuarios WHERE id=?', [req.session.usuarioId]);
    const nombreUsuario = usuario.length ? usuario[0].nombre : 'Desconocido';
    await db.execute(
      'UPDATE recibos SET anulado=1, anulado_razon=?, anulado_por_id=?, anulado_por_nombre=?, anulado_en=NOW() WHERE id=?',
      [razon.trim(), req.session.usuarioId, nombreUsuario, id]
    );
    emitSocket('recibo:actualizar-lista'); emitSocket('stats:actualizar');
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: safeError(err) }); }
});

// PATCH /api/recibos/:id/pagar
router.patch('/recibos/:id/pagar', requireAuth, requireRoleOrPerm(['superadmin', 'admin', 'admin_recepcion', 'recepcion', 'auxiliar_recepcion', 'contabilidad'], 'recibos.editar'), async (req, res) => {
  const id = parseReciboId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'ID de recibo inválido' });
  try {
    const rows = await db.query('SELECT id, anulado, estado_pago FROM recibos WHERE id=?', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Recibo no encontrado' });
    if (rows[0].anulado) return res.status(400).json({ error: 'No se puede marcar como pagado un recibo anulado' });
    if (rows[0].estado_pago === 'PAGADO') return res.status(400).json({ error: 'Este recibo ya está pagado' });
    const usuario = await db.query('SELECT nombre FROM usuarios WHERE id=?', [req.session.usuarioId]);
    const nombreUsuario = usuario.length ? usuario[0].nombre : 'Desconocido';
    await db.execute(
      'UPDATE recibos SET estado_pago=?, fecha_pago=NOW(), pagado_por_id=?, pagado_por_nombre=? WHERE id=?',
      ['PAGADO', req.session.usuarioId, nombreUsuario, id]
    );
    emitSocket('recibo:actualizar-lista'); emitSocket('stats:actualizar');
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: safeError(err) }); }
});

// DELETE /api/recibos/:id
router.delete('/recibos/:id', requireAuth, requireRoleOrPerm(['superadmin', 'admin'], 'recibos.eliminar'), async (req, res) => {
  const id = parseReciboId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'ID de recibo inválido' });
  try {
    const result = await db.execute('DELETE FROM recibos WHERE id=?', [id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'No encontrado' });
    emitSocket('recibo:eliminado', { id }); emitSocket('recibo:actualizar-lista'); emitSocket('stats:actualizar');
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: safeError(err) }); }
});

// GET /api/recibos/:id
router.get('/recibos/:id', requireAuth, requireRoleOrPerm(['superadmin', 'admin', 'admin_recepcion', 'recepcion', 'auxiliar_recepcion', 'contabilidad'], 'recibos.ver'), async (req, res) => {
  const id = parseReciboId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'ID de recibo inválido' });
  try {
    const rows = await db.query(
      `SELECT id, numero, cliente, fecha, total, data, medico_id, medico_nombre,
              tipo_pago, nombre_entidad, tipo_servicio, generado_por_id, generado_por_nombre,
              turno_id, cita_electro_id, observaciones, anulado, anulado_razon,
              anulado_por_id, anulado_por_nombre, anulado_en,
              estado_pago, fecha_pago, pagado_por_id, pagado_por_nombre, creado_en
       FROM recibos WHERE id=?`, [id]);
    const row = rows.length > 0 ? rows[0] : null;
    if (!row) return res.status(404).json({ error: 'No encontrado' });
    try { row.data = JSON.parse(row.data); } catch (e) { return res.status(500).json({ error: 'Datos del recibo corruptos' }); }
    res.json(row);
  } catch (err) { res.status(500).json({ error: safeError(err) }); }
});

// GET /api/recibos/:id/pdf — HTML imprimible con logo
router.get('/recibos/:id/pdf', requireAuth, requireRoleOrPerm(['superadmin', 'admin', 'admin_recepcion', 'recepcion', 'auxiliar_recepcion', 'contabilidad'], 'recibos.ver'), async (req, res) => {
  const id = parseReciboId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'ID de recibo inválido' });
  try {
    const rows = await db.query(
      `SELECT id, numero, cliente, fecha, total, data, tipo_pago, nombre_entidad,
              anulado, anulado_razon, anulado_por_nombre, anulado_en
       FROM recibos WHERE id=?`, [id]);
    const row = rows.length > 0 ? rows[0] : null;
    if (!row) return res.status(404).json({ error: 'No encontrado' });
    let data;
    try { data = JSON.parse(row.data); } catch (e) { return res.status(500).json({ error: 'Datos del recibo corruptos' }); }
    const items = Array.isArray(data.items) ? data.items : [];

    const formatCurrency = (value) => {
      const num = Number(value);
      const formatted = num.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      return formatted.endsWith('.00') ? formatted.slice(0, -3) : formatted;
    };

    const itemsRows = items.map(it => `<tr>
      <td style="padding:8px;border:1px solid #000;word-wrap:break-word">${escapeHtml(it.desc || '')}</td>
      <td style="padding:8px;border:1px solid #000;text-align:right">$ ${formatCurrency(Number(it.price || 0))}</td>
    </tr>`).join('');

    const subtotal = Number(data.subtotal || 0).toFixed(2);
    const iva = Number(data.iva || 0).toFixed(2);
    const total = Number(data.total || 0).toFixed(2);
    const fmtVal = (v) => { const f = v.replace(/\B(?=(\d{3})+(?!\d))/g, ','); return f.endsWith('.00') ? f.slice(0, -3) : f; };
    const fechaRecibo = typeof row.fecha === 'string' ? row.fecha : new Date(row.fecha).toISOString().split('T')[0];
    const anuladoWatermark = row.anulado ? `
  <div style="text-align:center;padding:8px;margin:5px 0;background:#fee2e2;border:2px solid #dc2626;border-radius:4px">
    <strong style="color:#dc2626;font-size:14px;letter-spacing:2px">ANULADO</strong><br/>
    <span style="font-size:7px;color:#991b1b">Razón: ${escapeHtml(row.anulado_razon || '-')}</span><br/>
    <span style="font-size:7px;color:#991b1b">Por: ${escapeHtml(row.anulado_por_nombre || '-')} el ${row.anulado_en ? new Date(row.anulado_en).toLocaleString('es-CO') : '-'}</span>
  </div>` : '';

    const html = `<!doctype html><html><head><meta charset="utf-8"/>
<title>Recibo ${escapeHtml(row.numero)}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:Arial,Helvetica,sans-serif;color:#000;font-size:10px;padding:3mm;line-height:1.3;max-width:58mm;margin:0 auto}
  .no-print{text-align:center;margin-bottom:8px}
  .no-print button{padding:7px 18px;background:#2d4a47;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px}
  .header{margin-bottom:5px;border-bottom:2px solid #000;padding-bottom:4px}
  .header-logo{text-align:center;margin-bottom:3px}
  .header-logo img{max-width:40px;max-height:32px;object-fit:contain}
  .company-info h1{font-size:10px;font-weight:bold;margin-bottom:1px}
  .company-info p{font-size:8px;margin:1px 0}
  .receipt-number{font-size:10px;font-weight:bold;margin-top:3px}
  .receipt-date{font-size:8px}
  .client-section{margin:4px 0;font-size:8px;line-height:1.3;background:#f9f9f9;padding:3px;border-radius:2px}
  .client-section strong.title{font-size:9px;display:block;margin-bottom:2px}
  .client-section p{margin:1px 0}
  table{width:100%;border-collapse:collapse;margin:4px 0;font-size:8px}
  th{background:#f0f0f0;padding:2px 3px;border:1px solid #000;font-size:8px;font-weight:bold}
  td{padding:2px 3px;border:1px solid #000;font-size:8px;word-break:break-word}
  .totals-table td{border:none;padding:1px 2px;font-size:9px;font-weight:bold}
  .totals-table .value{text-align:right}
  .total-row td{border-top:2px solid #000;border-bottom:2px solid #000;font-size:10px}
  .signature-line{border-top:1px solid #000;width:100%;margin-top:16px;margin-bottom:2px}
  .signature-label{font-size:7px;font-weight:bold;text-align:center}
  .footer{margin-top:5px;text-align:center;font-size:7px;border-top:1px solid #000;padding-top:2px;line-height:1.3}
  @media print{.no-print{display:none !important}body{padding:1mm;max-width:100%}@page{size:58mm auto;margin:2mm}}
</style>
</head><body>
<div class="no-print"><button onclick="window.print()">🖨️ Imprimir / Guardar PDF</button></div>
<div class="header">
  <div class="header-logo"><img src="data:image/png;base64,${getLogoReciboBase64()}" alt="Logo"/></div>
  <div class="company-info">
    <h1>INSTITUTO NEUROCIENCIAS</h1>
    <p><strong>NIT:</strong> 901164565-1</p>
    <p><strong>Dirección:</strong> Carrera 34 #13-80. B/San Ignacio</p>
    <p><strong>Teléfono:</strong> 305-356-0651 &nbsp;|&nbsp; <strong>Ciudad:</strong> Pasto, Colombia</p>
  </div>
  <div class="receipt-number">Recibo N° ${escapeHtml(row.numero)}</div>
  <div class="receipt-date">Fecha: ${escapeHtml(fechaRecibo)}</div>
</div>
${anuladoWatermark}
<div class="client-section">
  <strong class="title">CLIENTE</strong>
  <p><strong>Nombre:</strong> ${escapeHtml(row.cliente || '-')}</p>
  <p><strong>Documento:</strong> ${escapeHtml(data.doc || '-')}</p>
  <p><strong>Forma de pago:</strong> ${escapeHtml(row.tipo_pago || '-')}</p>
  <p><strong>Entidad:</strong> ${escapeHtml(row.nombre_entidad || data.entidad || '-')}</p>
</div>
<table>
  <thead><tr><th style="text-align:left;width:65%">Descripción</th><th style="width:35%;text-align:right">Valor</th></tr></thead>
  <tbody>${itemsRows}</tbody>
</table>
<table class="totals-table">
  <tr><td>Subtotal:</td><td class="value">$ ${fmtVal(subtotal)}</td></tr>
  ${Number(data.iva || 0) > 0 ? `<tr><td>IVA (${data.tasa_iva || 0}%):</td><td class="value">$ ${fmtVal(iva)}</td></tr>` : ''}
  <tr class="total-row"><td>TOTAL:</td><td class="value">$ ${fmtVal(total)}</td></tr>
</table>
${data.observ ? `<div style="margin:4px 0;padding:3px;background:#f9f9f9;border-left:2px solid #000;font-size:8px"><strong>Observaciones:</strong><br/>${escapeHtml(data.observ)}</div>` : ''}
<div style="margin-top:10px">
  <div class="signature-line"></div>
  <div class="signature-label">Quien recibe — Nombre y firma</div>
</div>
<div class="footer">
  <p>Documento generado digitalmente el ${new Date().toLocaleString('es-CO')}</p>
  <p>Este recibo es un comprobante de la transacción realizada.</p>
</div>
</body></html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (e) {
    logger.error(e.message, { error: e });
    res.status(500).json({ error: safeError(e, 'Error generando recibo: ') });
  }
});

module.exports = router;
