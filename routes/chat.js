/**
 * API Chat Messenger — DMs recepción ↔ doctores / recepción ↔ recepción.
 */
const express = require('express');
const multer = require('multer');
const db = require('../utils/db-mysql');
const { insertRowId } = require('../utils/db-insert-id');
const { requireAuth, safeError } = require('../middleware');
const { validateSchema } = require('../modules/validation-schemas');
const {
  requireChatUsar,
  puedeHablarCon,
  pairOrdenado,
  parsePermisosCampo,
  esRolAdmin
} = require('../utils/chat-acceso');
const eventPollQueue = require('../utils/event-poll-queue');
const socketEmitter = require('../utils/socket-emitter');
const logger = require('../utils/logger');
const {
  chatMediaPackForUser,
  stickerCuerpoPreview,
  saveUploadedSticker,
  deleteUserSticker,
  listUserStickers,
  getStickerMediaPath,
  canSendSticker,
  listUsersStickerCounts,
  resolveChatSticker
} = require('../utils/chat-stickers');

const router = express.Router();

const uploadChatSticker = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const ok = /^(image\/(png|webp|gif|jpeg|jpg|svg\+xml))$/i.test(file.mimetype || '');
    if (ok) cb(null, true);
    else cb(new Error('Solo imágenes PNG, WebP, GIF, JPG o SVG'));
  }
});

function puedeGestionarStickers(req) {
  const rol = String(req.session?.rol || '').toLowerCase();
  return esRolAdmin(rol) || rol === 'admin_recepcion';
}

const ROL_LABEL = {
  superadmin: 'Super Admin',
  admin: 'Administrador',
  admin_recepcion: 'Admin Recepción',
  recepcion: 'Recepción',
  auxiliar_recepcion: 'Auxiliar Recepción',
  doctor: 'Doctor',
  admin_electro: 'Admin Electro',
  electro: 'Electrodiagnóstico',
  tecnico_electro: 'Técnico Electro',
  contabilidad: 'Contabilidad'
};

function sessionUser(req) {
  return {
    id: req.session.usuarioId,
    rol: req.session.rol,
    permisos: req.session.permisos,
    nombre: req.session.nombre || req.session.usuario || ''
  };
}

async function sessionUserFull(req) {
  const base = sessionUser(req);
  if (base.nombre && base.nombre !== req.session.usuario) return base;
  try {
    const u = await cargarUsuario(base.id);
    if (u?.nombre) {
      base.nombre = u.nombre;
      req.session.nombre = u.nombre;
    }
  } catch (_) { /* noop */ }
  return base;
}

function mapUsuarioChat(row) {
  return {
    id: row.id,
    nombre: row.nombre || row.usuario || '',
    usuario: row.usuario || '',
    rol: row.rol,
    rol_label: ROL_LABEL[row.rol] || row.rol,
    especialidad: row.especialidad || null,
    online: eventPollQueue.isUserOnline(row.id),
    permisos: parsePermisosCampo(row.permisos)
  };
}

async function cargarUsuario(id) {
  const rows = await db.query(
    'SELECT id, usuario, nombre, rol, especialidad, permisos, activo FROM usuarios WHERE id = ? LIMIT 1',
    [id]
  );
  return rows[0] || null;
}

async function obtenerOCrearConversacion(id1, id2) {
  const pair = pairOrdenado(id1, id2);
  const existing = await db.query(
    'SELECT * FROM chat_conversaciones WHERE usuario_a_id = ? AND usuario_b_id = ? LIMIT 1',
    [pair.usuario_a_id, pair.usuario_b_id]
  );
  if (existing[0]) return existing[0];
  const result = await db.execute(
    'INSERT INTO chat_conversaciones (usuario_a_id, usuario_b_id) VALUES (?, ?)',
    [pair.usuario_a_id, pair.usuario_b_id]
  );
  const id = insertRowId(result);
  const rows = await db.query('SELECT * FROM chat_conversaciones WHERE id = ? LIMIT 1', [id]);
  return rows[0];
}

async function assertParticipante(conversacionId, usuarioId) {
  const rows = await db.query(
    'SELECT * FROM chat_conversaciones WHERE id = ? LIMIT 1',
    [conversacionId]
  );
  const conv = rows[0];
  if (!conv) return { error: 404, message: 'Conversación no encontrada' };
  const uid = Number(usuarioId);
  if (Number(conv.usuario_a_id) !== uid && Number(conv.usuario_b_id) !== uid) {
    return { error: 403, message: 'No eres participante de esta conversación' };
  }
  return { conv };
}

function ahoraBogotaMysql() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(new Date());
  const g = (t) => parts.find((p) => p.type === t)?.value || '00';
  return `${g('year')}-${g('month')}-${g('day')} ${g('hour')}:${g('minute')}:${g('second')}`;
}

function otroId(conv, yo) {
  return Number(conv.usuario_a_id) === Number(yo) ? Number(conv.usuario_b_id) : Number(conv.usuario_a_id);
}

async function serializeMensaje(row) {
  const tipo = String(row.tipo || 'text') === 'sticker' ? 'sticker' : 'text';
  const st = tipo === 'sticker' ? await resolveChatSticker(row.sticker_id) : null;
  return {
    id: row.id,
    conversacion_id: row.conversacion_id,
    autor_id: row.autor_id,
    autor_nombre: row.autor_nombre || null,
    tipo,
    cuerpo: row.cuerpo,
    sticker_id: row.sticker_id || null,
    sticker_kind: st?.kind || null,
    sticker_src: st?.src || null,
    sticker_emoji: st?.emoji || null,
    sticker_label: st?.label || null,
    paciente_id: row.paciente_id || null,
    turno_id: row.turno_id || null,
    cita_electro_id: row.cita_electro_id || null,
    paciente_nombre: row.paciente_nombre || null,
    contexto_label: row.contexto_label || null,
    leido_at: row.leido_at || null,
    creado_en: row.creado_en
  };
}

router.get('/chat/pack', requireAuth, requireChatUsar, async (req, res) => {
  try {
    const yo = sessionUser(req);
    const pack = await chatMediaPackForUser(yo.id, { canManage: puedeGestionarStickers(req) });
    res.json({ ok: true, ...pack });
  } catch (e) {
    res.status(500).json({ error: safeError(e) });
  }
});

router.get('/chat/stickers/media/:key', requireAuth, requireChatUsar, async (req, res) => {
  try {
    const fp = await getStickerMediaPath(req.params.key);
    if (!fp) return res.status(404).json({ error: 'Sticker no encontrado' });
    res.sendFile(fp);
  } catch (e) {
    res.status(500).json({ error: safeError(e) });
  }
});

router.post(
  '/chat/stickers',
  requireAuth,
  requireChatUsar,
  (req, res, next) => {
    uploadChatSticker.single('sticker')(req, res, (err) => {
      if (err) {
        const msg = err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE'
          ? 'Máximo 3 MB por sticker'
          : (err.message || 'No se pudo subir el sticker');
        return res.status(400).json({ error: msg });
      }
      next();
    });
  },
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'Selecciona una imagen' });
      const yo = sessionUser(req);
      let ownerId = yo.id;
      const requestedOwner = parseInt(req.body?.usuario_id, 10);
      if (requestedOwner && requestedOwner !== yo.id) {
        if (!puedeGestionarStickers(req)) {
          return res.status(403).json({ error: 'Solo un administrador puede subir stickers a otro usuario' });
        }
        ownerId = requestedOwner;
      }
      const label = req.body?.label ? String(req.body.label).trim().slice(0, 80) : '';
      const saved = await saveUploadedSticker({
        buffer: req.file.buffer,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        label,
        ownerUserId: ownerId,
        creadoPor: yo.id
      });
      logger.info('[CHAT] sticker personal', { id: saved.id, owner: ownerId, by: yo.id });
      const pack = await chatMediaPackForUser(
        requestedOwner && puedeGestionarStickers(req) ? ownerId : yo.id,
        { canManage: puedeGestionarStickers(req) }
      );
      res.json({ ok: true, sticker: saved, pack, owner_user_id: ownerId });
    } catch (e) {
      logger.warn('[CHAT] sticker upload:', e.message);
      res.status(400).json({ error: e.message || safeError(e) });
    }
  }
);

router.delete('/chat/stickers/:key', requireAuth, requireChatUsar, async (req, res) => {
  try {
    const yo = sessionUser(req);
    const asAdmin = puedeGestionarStickers(req);
    await deleteUserSticker(req.params.key, { asUserId: yo.id, asAdmin });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message || safeError(e) });
  }
});

router.get('/chat/stickers/admin/usuarios', requireAuth, requireChatUsar, async (req, res) => {
  try {
    if (!puedeGestionarStickers(req)) {
      return res.status(403).json({ error: 'Sin permiso para gestionar packs' });
    }
    const usuarios = await listUsersStickerCounts();
    res.json({ ok: true, usuarios });
  } catch (e) {
    res.status(500).json({ error: safeError(e) });
  }
});

router.get('/chat/stickers/admin/usuarios/:id', requireAuth, requireChatUsar, async (req, res) => {
  try {
    if (!puedeGestionarStickers(req)) {
      return res.status(403).json({ error: 'Sin permiso para gestionar packs' });
    }
    const userId = parseInt(req.params.id, 10);
    if (!userId) return res.status(400).json({ error: 'Usuario inválido' });
    const user = await cargarUsuario(userId);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    const stickers = await listUserStickers(userId);
    res.json({
      ok: true,
      usuario: { id: user.id, nombre: user.nombre || user.usuario, usuario: user.usuario, rol: user.rol },
      stickers
    });
  } catch (e) {
    res.status(500).json({ error: safeError(e) });
  }
});

// ── Contactos ───────────────────────────────────────────────────────────────
router.get('/chat/contactos', requireAuth, requireChatUsar, async (req, res) => {
  try {
    const yo = sessionUser(req);
    const rows = await db.query(
      `SELECT id, usuario, nombre, rol, especialidad, permisos, activo
       FROM usuarios WHERE activo = 1 AND id <> ? ORDER BY nombre ASC`,
      [yo.id]
    );
    const contactos = [];
    for (const row of rows) {
      const dest = mapUsuarioChat(row);
      if (!puedeHablarCon(yo, { ...dest, activo: 1 })) continue;
      contactos.push({
        id: dest.id,
        nombre: dest.nombre,
        usuario: dest.usuario,
        rol: dest.rol,
        rol_label: dest.rol_label,
        especialidad: dest.especialidad,
        online: dest.online
      });
    }

    // No leídos por contacto
    const unreadRows = await db.query(
      `SELECT
         CASE WHEN c.usuario_a_id = ? THEN c.usuario_b_id ELSE c.usuario_a_id END AS peer_id,
         COUNT(m.id) AS no_leidos
       FROM chat_conversaciones c
       INNER JOIN chat_mensajes m ON m.conversacion_id = c.id
         AND m.autor_id <> ? AND m.leido_at IS NULL
       WHERE c.usuario_a_id = ? OR c.usuario_b_id = ?
       GROUP BY peer_id`,
      [yo.id, yo.id, yo.id, yo.id]
    );
    const unreadMap = {};
    unreadRows.forEach((r) => { unreadMap[r.peer_id] = parseInt(r.no_leidos, 10) || 0; });

    const previewRows = await db.query(
      `SELECT c.id AS conversacion_id,
         CASE WHEN c.usuario_a_id = ? THEN c.usuario_b_id ELSE c.usuario_a_id END AS peer_id,
         c.ultimo_mensaje_at,
         (SELECT CASE
            WHEN tipo = 'sticker' THEN COALESCE(cuerpo, '🎨 Sticker')
            ELSE cuerpo
          END FROM chat_mensajes WHERE conversacion_id = c.id ORDER BY id DESC LIMIT 1) AS preview
       FROM chat_conversaciones c
       WHERE c.usuario_a_id = ? OR c.usuario_b_id = ?`,
      [yo.id, yo.id, yo.id]
    );
    const previewMap = {};
    previewRows.forEach((r) => {
      previewMap[r.peer_id] = {
        conversacion_id: r.conversacion_id,
        preview: r.preview || '',
        ultimo_mensaje_at: r.ultimo_mensaje_at
      };
    });

    const lista = contactos.map((c) => ({
      ...c,
      no_leidos: unreadMap[c.id] || 0,
      conversacion_id: previewMap[c.id]?.conversacion_id || null,
      preview: previewMap[c.id]?.preview || '',
      ultimo_mensaje_at: previewMap[c.id]?.ultimo_mensaje_at || null
    }));

    lista.sort((a, b) => {
      const ta = a.ultimo_mensaje_at ? new Date(a.ultimo_mensaje_at).getTime() : 0;
      const tb = b.ultimo_mensaje_at ? new Date(b.ultimo_mensaje_at).getTime() : 0;
      if (tb !== ta) return tb - ta;
      if (b.no_leidos !== a.no_leidos) return b.no_leidos - a.no_leidos;
      return String(a.nombre).localeCompare(String(b.nombre), 'es');
    });

    res.json({ ok: true, contactos: lista });
  } catch (e) {
    logger.error('[CHAT] contactos', e.message, { error: e });
    res.status(500).json({ error: safeError(e) });
  }
});

// ── Conversaciones ──────────────────────────────────────────────────────────
router.get('/chat/conversaciones', requireAuth, requireChatUsar, async (req, res) => {
  try {
    const yo = sessionUser(req);
    const rows = await db.query(
      `SELECT c.*,
         CASE WHEN c.usuario_a_id = ? THEN c.usuario_b_id ELSE c.usuario_a_id END AS peer_id,
         (SELECT CASE
            WHEN tipo = 'sticker' THEN COALESCE(cuerpo, '🎨 Sticker')
            ELSE cuerpo
          END FROM chat_mensajes WHERE conversacion_id = c.id ORDER BY id DESC LIMIT 1) AS preview,
         (SELECT COUNT(*) FROM chat_mensajes m
            WHERE m.conversacion_id = c.id AND m.autor_id <> ? AND m.leido_at IS NULL) AS no_leidos
       FROM chat_conversaciones c
       WHERE c.usuario_a_id = ? OR c.usuario_b_id = ?
       ORDER BY COALESCE(c.ultimo_mensaje_at, c.creado_en) DESC`,
      [yo.id, yo.id, yo.id, yo.id]
    );
    const peerIds = rows.map((r) => r.peer_id);
    let peers = {};
    if (peerIds.length) {
      const placeholders = peerIds.map(() => '?').join(',');
      const peerRows = await db.query(
        `SELECT id, usuario, nombre, rol, especialidad, permisos, activo
         FROM usuarios WHERE id IN (${placeholders})`,
        peerIds
      );
      peerRows.forEach((p) => { peers[p.id] = mapUsuarioChat(p); });
    }
    const conversaciones = rows.map((r) => {
      const peer = peers[r.peer_id] || { id: r.peer_id, nombre: 'Usuario', rol: '', online: false };
      return {
        id: r.id,
        peer: {
          id: peer.id,
          nombre: peer.nombre,
          usuario: peer.usuario,
          rol: peer.rol,
          rol_label: peer.rol_label || ROL_LABEL[peer.rol] || peer.rol,
          especialidad: peer.especialidad || null,
          online: eventPollQueue.isUserOnline(peer.id)
        },
        preview: r.preview || '',
        no_leidos: parseInt(r.no_leidos, 10) || 0,
        ultimo_mensaje_at: r.ultimo_mensaje_at
      };
    });
    res.json({ ok: true, conversaciones });
  } catch (e) {
    logger.error('[CHAT] conversaciones', e.message, { error: e });
    res.status(500).json({ error: safeError(e) });
  }
});

router.post('/chat/conversaciones', requireAuth, requireChatUsar, validateSchema('apiChatAbrir'), async (req, res) => {
  try {
    const yo = sessionUser(req);
    const destId = parseInt(req.body.destinatario_id, 10);
    const dest = await cargarUsuario(destId);
    if (!dest || !dest.activo) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (!puedeHablarCon(yo, dest)) {
      return res.status(403).json({ error: 'No puedes chatear con este usuario' });
    }
    const conv = await obtenerOCrearConversacion(yo.id, destId);
    res.json({
      ok: true,
      conversacion: {
        id: conv.id,
        peer: {
          id: dest.id,
          nombre: dest.nombre || dest.usuario,
          usuario: dest.usuario,
          rol: dest.rol,
          rol_label: ROL_LABEL[dest.rol] || dest.rol,
          especialidad: dest.especialidad || null,
          online: eventPollQueue.isUserOnline(dest.id)
        }
      }
    });
  } catch (e) {
    logger.error('[CHAT] abrir', e.message, { error: e });
    res.status(500).json({ error: safeError(e) });
  }
});

router.get('/chat/conversaciones/:id/mensajes', requireAuth, requireChatUsar, async (req, res) => {
  try {
    const yo = sessionUser(req);
    const convId = parseInt(req.params.id, 10);
    if (!convId) return res.status(400).json({ error: 'ID inválido' });
    const check = await assertParticipante(convId, yo.id);
    if (check.error) return res.status(check.error).json({ error: check.message });

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 40, 1), 100);
    const before = parseInt(req.query.before, 10) || null;
    const params = [convId];
    let sql = `
      SELECT m.*, u.nombre AS autor_nombre
      FROM chat_mensajes m
      LEFT JOIN usuarios u ON u.id = m.autor_id
      WHERE m.conversacion_id = ?`;
    if (before) {
      sql += ' AND m.id < ?';
      params.push(before);
    }
    sql += ' ORDER BY m.id DESC LIMIT ?';
    params.push(limit);

    const rows = await db.query(sql, params);
    const mensajes = [];
    for (const row of rows.reverse()) {
      mensajes.push(await serializeMensaje(row));
    }
    res.json({
      ok: true,
      mensajes,
      has_more: rows.length === limit
    });
  } catch (e) {
    logger.error('[CHAT] mensajes', e.message, { error: e });
    res.status(500).json({ error: safeError(e) });
  }
});

router.post('/chat/conversaciones/:id/mensajes', requireAuth, requireChatUsar, validateSchema('apiChatMensaje'), async (req, res) => {
  try {
    const yo = await sessionUserFull(req);
    const convId = parseInt(req.params.id, 10);
    if (!convId) return res.status(400).json({ error: 'ID inválido' });
    const check = await assertParticipante(convId, yo.id);
    if (check.error) return res.status(check.error).json({ error: check.message });
    const conv = check.conv;
    const peerId = otroId(conv, yo.id);
    const peer = await cargarUsuario(peerId);
    if (!peer || !peer.activo) return res.status(404).json({ error: 'Destinatario no disponible' });
    if (!puedeHablarCon(yo, peer)) {
      return res.status(403).json({ error: 'No puedes enviar mensajes a este usuario' });
    }

    const tipo = String(req.body.tipo || 'text') === 'sticker' ? 'sticker' : 'text';
    let cuerpo = String(req.body.cuerpo || '').trim();
    let stickerId = null;
    if (tipo === 'sticker') {
      const checkSt = await canSendSticker(req.body.sticker_id, yo.id);
      if (!checkSt.ok) return res.status(400).json({ error: checkSt.error });
      const st = checkSt.sticker;
      stickerId = st.id;
      cuerpo = stickerCuerpoPreview(st);
    } else if (!cuerpo) {
      return res.status(400).json({ error: 'El mensaje no puede estar vacío' });
    }

    const pacienteId = req.body.paciente_id != null ? parseInt(req.body.paciente_id, 10) || null : null;
    const turnoId = req.body.turno_id != null ? parseInt(req.body.turno_id, 10) || null : null;
    const citaElectroId = req.body.cita_electro_id != null ? parseInt(req.body.cita_electro_id, 10) || null : null;
    const pacienteNombre = req.body.paciente_nombre ? String(req.body.paciente_nombre).trim().slice(0, 200) : null;
    const contextoLabel = req.body.contexto_label ? String(req.body.contexto_label).trim().slice(0, 240) : null;

    const result = await db.execute(
      `INSERT INTO chat_mensajes
        (conversacion_id, autor_id, tipo, cuerpo, sticker_id, paciente_id, turno_id, cita_electro_id, paciente_nombre, contexto_label)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [convId, yo.id, tipo, cuerpo, stickerId, pacienteId, turnoId, citaElectroId, pacienteNombre, contextoLabel]
    );
    const msgId = insertRowId(result);
    await db.execute(
      'UPDATE chat_conversaciones SET ultimo_mensaje_at = NOW() WHERE id = ?',
      [convId]
    );

    const msgRows = await db.query(
      `SELECT m.*, u.nombre AS autor_nombre
       FROM chat_mensajes m
       LEFT JOIN usuarios u ON u.id = m.autor_id
       WHERE m.id = ? LIMIT 1`,
      [msgId]
    );
    const mensaje = await serializeMensaje(msgRows[0] || {
      id: msgId,
      conversacion_id: convId,
      autor_id: yo.id,
      autor_nombre: yo.nombre,
      tipo,
      cuerpo,
      sticker_id: stickerId,
      paciente_id: pacienteId,
      turno_id: turnoId,
      cita_electro_id: citaElectroId,
      paciente_nombre: pacienteNombre,
      contexto_label: contextoLabel,
      leido_at: null,
      creado_en: ahoraBogotaMysql()
    });

    const payload = {
      conversacion_id: convId,
      mensaje,
      from: { id: yo.id, nombre: yo.nombre, rol: yo.rol }
    };
    socketEmitter.emitToUser(peerId, 'chat:mensaje', payload);
    socketEmitter.emitToUser(yo.id, 'chat:mensaje_echo', payload);

    res.json({ ok: true, mensaje });
  } catch (e) {
    logger.error('[CHAT] enviar', e.message, { error: e });
    res.status(500).json({ error: safeError(e) });
  }
});

router.post('/chat/conversaciones/:id/leer', requireAuth, requireChatUsar, async (req, res) => {
  try {
    const yo = sessionUser(req);
    const convId = parseInt(req.params.id, 10);
    if (!convId) return res.status(400).json({ error: 'ID inválido' });
    const check = await assertParticipante(convId, yo.id);
    if (check.error) return res.status(check.error).json({ error: check.message });
    const peerId = otroId(check.conv, yo.id);

    await db.execute(
      `UPDATE chat_mensajes SET leido_at = NOW()
       WHERE conversacion_id = ? AND autor_id <> ? AND leido_at IS NULL`,
      [convId, yo.id]
    );

    socketEmitter.emitToUser(peerId, 'chat:leido', {
      conversacion_id: convId,
      lector_id: yo.id
    });

    res.json({ ok: true });
  } catch (e) {
    logger.error('[CHAT] leer', e.message, { error: e });
    res.status(500).json({ error: safeError(e) });
  }
});

router.get('/chat/no-leidos', requireAuth, requireChatUsar, async (req, res) => {
  try {
    const yo = sessionUser(req);
    const rows = await db.query(
      `SELECT COUNT(*) AS total
       FROM chat_mensajes m
       INNER JOIN chat_conversaciones c ON c.id = m.conversacion_id
       WHERE (c.usuario_a_id = ? OR c.usuario_b_id = ?)
         AND m.autor_id <> ? AND m.leido_at IS NULL`,
      [yo.id, yo.id, yo.id]
    );
    res.json({ ok: true, total: parseInt(rows[0]?.total, 10) || 0 });
  } catch (e) {
    res.status(500).json({ error: safeError(e) });
  }
});

module.exports = router;
