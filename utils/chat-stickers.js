/**
 * Stickers del chat:
 * - emoji (globales, built-in)
 * - imágenes globales en public/chat-stickers/ (pack clínica)
 * - imágenes personales por usuario (uploads/chat-stickers/{userId}/ + BD)
 */
const fs = require('fs');
const path = require('path');
const db = require('./db-mysql');
const { getUploadsRoot } = require('../config/uploads-path');
const { insertRowId } = require('./db-insert-id');

const PUBLIC_STICKERS_DIR = path.join(__dirname, '..', 'public', 'chat-stickers');
const PACK_JSON = path.join(PUBLIC_STICKERS_DIR, 'pack.json');
const SAFE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const SAFE_FILE = /^[a-z0-9][a-z0-9_-]{0,63}\.(webp|png|gif|svg|jpg|jpeg)$/i;
const SAFE_KEY = /^[a-z0-9][a-z0-9_-]{0,79}$/i;

const CHAT_EMOJI_STICKERS = [
  { id: 'ok', kind: 'emoji', emoji: '👍', label: 'Ok' },
  { id: 'clap', kind: 'emoji', emoji: '👏', label: 'Aplausos' },
  { id: 'thanks', kind: 'emoji', emoji: '🙏', label: 'Gracias' },
  { id: 'heart', kind: 'emoji', emoji: '❤️', label: 'Corazón' },
  { id: 'smile', kind: 'emoji', emoji: '😊', label: 'Sonrisa' },
  { id: 'laugh', kind: 'emoji', emoji: '😂', label: 'Risa' },
  { id: 'wink', kind: 'emoji', emoji: '😉', label: 'Guiño' },
  { id: 'cool', kind: 'emoji', emoji: '😎', label: 'Genial' },
  { id: 'think', kind: 'emoji', emoji: '🤔', label: 'Pensando' },
  { id: 'wow', kind: 'emoji', emoji: '😮', label: 'Wow' },
  { id: 'sad', kind: 'emoji', emoji: '😔', label: 'Triste' },
  { id: 'fire', kind: 'emoji', emoji: '🔥', label: 'Fuego' },
  { id: 'check', kind: 'emoji', emoji: '✅', label: 'Listo' },
  { id: 'cross', kind: 'emoji', emoji: '❌', label: 'No' },
  { id: 'wait', kind: 'emoji', emoji: '⏳', label: 'Espera' },
  { id: 'run', kind: 'emoji', emoji: '🏃', label: 'En camino' },
  { id: 'coffee', kind: 'emoji', emoji: '☕', label: 'Café' },
  { id: 'star', kind: 'emoji', emoji: '⭐', label: 'Estrella' },
  { id: 'party', kind: 'emoji', emoji: '🎉', label: 'Festejo' },
  { id: 'wave', kind: 'emoji', emoji: '👋', label: 'Hola' },
  { id: 'doc', kind: 'emoji', emoji: '🩺', label: 'Clínica' },
  { id: 'pill', kind: 'emoji', emoji: '💊', label: 'Medicamento' },
  { id: 'note', kind: 'emoji', emoji: '📝', label: 'Nota' },
  { id: 'phone', kind: 'emoji', emoji: '📞', label: 'Llamar' }
];

const CHAT_EMOJIS = [
  '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇',
  '🙂', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚', '😋',
  '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🤩', '🥳',
  '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '☹️', '😣', '😖',
  '😫', '😩', '🥺', '😢', '😭', '😤', '😠', '😡', '🤬', '🤯',
  '😳', '🥵', '🥶', '😱', '😨', '😰', '😥', '😓', '🤗', '🤔',
  '🤭', '🤫', '🤥', '😶', '😐', '😑', '😬', '🙄', '😯', '😦',
  '😧', '😮', '😲', '🥱', '😴', '🤤', '😪', '😵', '🤐', '🥴',
  '🤢', '🤮', '🤧', '😷', '🤒', '🤕', '🤑', '🤠', '😈', '👿',
  '👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞',
  '🤟', '🤘', '🤙', '👈', '👉', '👆', '👇', '☝️', '👍', '👎',
  '✊', '👊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🤝', '🙏',
  '💪', '🦾', '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍',
  '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟',
  '💤', '💢', '💬', '👁️', '👀', '🦴', '🦷', '👅', '👄', '💋',
  '✅', '❌', '⭐', '🌟', '✨', '⚡', '🔥', '💯', '🎉', '🎊',
  '⏰', '📅', '📌', '📎', '📝', '📞', '📱', '💻', '🩺', '💊',
  '🏥', '🚑', '☕', '🍵', '🥤', '🍎', '🍌', '🚗', '🏠', '☀️'
];

const emojiById = new Map(CHAT_EMOJI_STICKERS.map((s) => [s.id, { ...s, owner_user_id: null, scope: 'emoji' }]));

function userStickersRoot(userId) {
  return path.join(getUploadsRoot(), 'chat-stickers', String(userId));
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadGlobalImageStickers() {
  ensureDir(PUBLIC_STICKERS_DIR);
  let metaStickers = [];
  try {
    if (fs.existsSync(PACK_JSON)) {
      const raw = JSON.parse(fs.readFileSync(PACK_JSON, 'utf8'));
      metaStickers = Array.isArray(raw?.stickers) ? raw.stickers : [];
    }
  } catch (_) { /* noop */ }

  const metaById = new Map();
  for (const s of metaStickers) {
    const id = String(s.id || '').trim();
    if (SAFE_ID.test(id)) metaById.set(id, s);
  }

  let files = [];
  try {
    files = fs.readdirSync(PUBLIC_STICKERS_DIR).filter((f) => SAFE_FILE.test(f));
  } catch (_) {
    files = [];
  }

  const list = [];
  for (const file of files) {
    const id = path.basename(file, path.extname(file));
    if (!SAFE_ID.test(id) || emojiById.has(id)) continue;
    const m = metaById.get(id) || {};
    list.push({
      id,
      kind: 'image',
      scope: 'global',
      owner_user_id: null,
      label: String(m.label || id.replace(/[-_]/g, ' ')),
      file,
      src: `/chat-stickers/${file}`,
      emoji: null
    });
  }
  list.sort((a, b) => String(a.label).localeCompare(String(b.label), 'es'));
  return list;
}

function mapDbSticker(row) {
  if (!row) return null;
  return {
    id: row.sticker_key,
    kind: 'image',
    scope: 'personal',
    owner_user_id: Number(row.usuario_id),
    label: row.label || row.sticker_key,
    file: row.filename,
    src: `/api/chat/stickers/media/${encodeURIComponent(row.sticker_key)}`,
    emoji: null,
    db_id: row.id,
    size_bytes: row.size_bytes || null
  };
}

async function listUserStickers(userId) {
  const uid = parseInt(userId, 10);
  if (!uid) return [];
  try {
    const rows = await db.query(
      `SELECT * FROM chat_user_stickers WHERE usuario_id = ? ORDER BY creado_en DESC, id DESC`,
      [uid]
    );
    return rows.map(mapDbSticker);
  } catch (e) {
    if (e.code === 'ER_NO_SUCH_TABLE') return [];
    throw e;
  }
}

async function getDbStickerByKey(stickerKey) {
  const key = String(stickerKey || '').trim();
  if (!SAFE_KEY.test(key)) return null;
  try {
    const rows = await db.query(
      'SELECT * FROM chat_user_stickers WHERE sticker_key = ? LIMIT 1',
      [key]
    );
    return rows[0] ? mapDbSticker(rows[0]) : null;
  } catch (e) {
    if (e.code === 'ER_NO_SUCH_TABLE') return null;
    throw e;
  }
}

async function resolveChatSticker(stickerId) {
  const id = String(stickerId || '').trim();
  if (!id) return null;
  if (emojiById.has(id)) return emojiById.get(id);
  const global = loadGlobalImageStickers().find((s) => s.id === id);
  if (global) return global;
  return getDbStickerByKey(id);
}

async function chatMediaPackForUser(userId, { canManage = false } = {}) {
  const personal = await listUserStickers(userId);
  const global = loadGlobalImageStickers();
  const emoji = CHAT_EMOJI_STICKERS.map((s) => ({
    id: s.id,
    kind: 'emoji',
    scope: 'emoji',
    label: s.label,
    emoji: s.emoji,
    src: null,
    owner_user_id: null
  }));
  return {
    stickers: [...personal, ...global, ...emoji],
    personal,
    global,
    emojis: CHAT_EMOJIS.slice(),
    can_upload: true,
    can_manage: Boolean(canManage)
  };
}

function stickerCuerpoPreview(st) {
  if (!st) return '🎨 Sticker';
  if (st.kind === 'emoji' && st.emoji) return st.emoji;
  return `🎨 ${st.label || st.id}`;
}

function previewTextoMensaje(row) {
  if (String(row?.tipo || 'text') !== 'sticker') return String(row?.cuerpo || '');
  return String(row?.cuerpo || '🎨 Sticker');
}

function slugifyStickerId(raw) {
  const base = String(raw || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base || `sticker-${Date.now()}`;
}

function detectExt(buffer, originalName, mimeType) {
  const mime = String(mimeType || '').toLowerCase();
  const extFromMime = {
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/svg+xml': '.svg'
  }[mime];
  const origExt = path.extname(String(originalName || '')).toLowerCase();
  const ext = extFromMime || (['.png', '.webp', '.gif', '.jpg', '.jpeg', '.svg'].includes(origExt)
    ? (origExt === '.jpeg' ? '.jpg' : origExt)
    : null);
  if (!ext) throw new Error('Solo PNG, WebP, GIF, JPG o SVG');

  if (ext === '.png' && !(buffer[0] === 0x89 && buffer[1] === 0x50)) throw new Error('PNG inválido');
  if (ext === '.jpg' && !(buffer[0] === 0xff && buffer[1] === 0xd8)) throw new Error('JPG inválido');
  if (ext === '.gif' && buffer.slice(0, 3).toString('ascii') !== 'GIF') throw new Error('GIF inválido');
  if (ext === '.webp' && buffer.slice(0, 4).toString('ascii') !== 'RIFF') throw new Error('WebP inválido');
  if (ext === '.svg') {
    const head = buffer.slice(0, 400).toString('utf8').toLowerCase();
    if (!head.includes('<svg') || /<script|onload=|javascript:/i.test(head)) {
      throw new Error('SVG no permitido o inseguro');
    }
  }
  return ext;
}

async function uniquePersonalKey(userId, desiredBase) {
  const base = `u${userId}-${slugifyStickerId(desiredBase)}`.slice(0, 70);
  let key = base;
  let n = 2;
  while (n < 999) {
    const rows = await db.query(
      'SELECT id FROM chat_user_stickers WHERE sticker_key = ? LIMIT 1',
      [key]
    ).catch((e) => {
      if (e.code === 'ER_NO_SUCH_TABLE') return [];
      throw e;
    });
    if (!rows.length && !emojiById.has(key)) return key;
    key = `${base}-${n}`.slice(0, 79);
    n += 1;
  }
  return `u${userId}-${Date.now()}`;
}

/**
 * Guarda sticker en el pack personal de un usuario.
 */
async function saveUploadedSticker({
  buffer,
  originalName,
  mimeType,
  label,
  ownerUserId,
  creadoPor = null
}) {
  const uid = parseInt(ownerUserId, 10);
  if (!uid) throw new Error('Usuario destino inválido');
  if (!buffer || !buffer.length) throw new Error('Archivo vacío');
  if (buffer.length > 3 * 1024 * 1024) throw new Error('Máximo 3 MB por sticker');

  const ext = detectExt(buffer, originalName, mimeType);
  const baseName = path.basename(String(originalName || 'sticker'), path.extname(String(originalName || '')));
  const stickerKey = await uniquePersonalKey(uid, baseName);
  const filename = `${stickerKey}${ext}`;
  if (!SAFE_FILE.test(filename) && !/^[a-z0-9][a-z0-9_-]{0,79}\.(webp|png|gif|svg|jpg)$/i.test(filename)) {
    throw new Error('Nombre de archivo no válido');
  }

  const dir = userStickersRoot(uid);
  ensureDir(dir);
  const dest = path.join(dir, filename);
  fs.writeFileSync(dest, buffer);

  const niceLabel = String(label || baseName || stickerKey).trim().slice(0, 80) || stickerKey;
  const result = await db.execute(
    `INSERT INTO chat_user_stickers
      (usuario_id, sticker_key, filename, label, mime_type, size_bytes, creado_por)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [uid, stickerKey, filename, niceLabel, mimeType || null, buffer.length, creadoPor || uid]
  );

  return {
    id: stickerKey,
    kind: 'image',
    scope: 'personal',
    owner_user_id: uid,
    label: niceLabel,
    file: filename,
    src: `/api/chat/stickers/media/${encodeURIComponent(stickerKey)}`,
    emoji: null,
    db_id: insertRowId(result)
  };
}

async function deleteUserSticker(stickerKey, { asUserId = null, asAdmin = false } = {}) {
  const st = await getDbStickerByKey(stickerKey);
  if (!st) throw new Error('Sticker no encontrado');
  if (!asAdmin && Number(asUserId) !== Number(st.owner_user_id)) {
    throw new Error('No puedes eliminar este sticker');
  }
  const rows = await db.query('SELECT * FROM chat_user_stickers WHERE sticker_key = ? LIMIT 1', [stickerKey]);
  const row = rows[0];
  if (!row) throw new Error('Sticker no encontrado');
  await db.execute('DELETE FROM chat_user_stickers WHERE id = ?', [row.id]);
  try {
    const fp = path.join(userStickersRoot(row.usuario_id), row.filename);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  } catch (_) { /* noop */ }
  return true;
}

function resolveUserStickerFilePath(row) {
  if (!row?.usuario_id || !row?.filename) return null;
  if (!SAFE_FILE.test(row.filename) && !/^[a-z0-9][a-z0-9_-]{0,79}\.(webp|png|gif|svg|jpg|jpeg)$/i.test(row.filename)) {
    return null;
  }
  const fp = path.resolve(userStickersRoot(row.usuario_id), row.filename);
  const root = path.resolve(userStickersRoot(row.usuario_id));
  if (!fp.startsWith(root + path.sep) && fp !== root) return null;
  if (!fs.existsSync(fp)) return null;
  return fp;
}

async function getStickerMediaPath(stickerKey) {
  const key = String(stickerKey || '').trim();
  if (!SAFE_KEY.test(key)) return null;
  const rows = await db.query(
    'SELECT * FROM chat_user_stickers WHERE sticker_key = ? LIMIT 1',
    [key]
  ).catch((e) => {
    if (e.code === 'ER_NO_SUCH_TABLE') return [];
    throw e;
  });
  if (!rows[0]) return null;
  return resolveUserStickerFilePath(rows[0]);
}

async function canSendSticker(stickerId, senderUserId) {
  const st = await resolveChatSticker(stickerId);
  if (!st) return { ok: false, error: 'Sticker no válido' };
  if (st.scope === 'personal' && Number(st.owner_user_id) !== Number(senderUserId)) {
    return { ok: false, error: 'Ese sticker no está en tu pack' };
  }
  return { ok: true, sticker: st };
}

async function listUsersStickerCounts() {
  try {
    const rows = await db.query(
      `SELECT u.id, u.nombre, u.usuario, u.rol,
              COUNT(s.id) AS stickers_count
       FROM usuarios u
       LEFT JOIN chat_user_stickers s ON s.usuario_id = u.id
       WHERE u.activo = 1
       GROUP BY u.id, u.nombre, u.usuario, u.rol
       ORDER BY u.nombre ASC`
    );
    return rows.map((r) => ({
      id: r.id,
      nombre: r.nombre || r.usuario,
      usuario: r.usuario,
      rol: r.rol,
      stickers_count: parseInt(r.stickers_count, 10) || 0
    }));
  } catch (e) {
    if (e.code === 'ER_NO_SUCH_TABLE') {
      const users = await db.query(
        'SELECT id, nombre, usuario, rol FROM usuarios WHERE activo = 1 ORDER BY nombre ASC'
      );
      return users.map((u) => ({
        id: u.id,
        nombre: u.nombre || u.usuario,
        usuario: u.usuario,
        rol: u.rol,
        stickers_count: 0
      }));
    }
    throw e;
  }
}

module.exports = {
  PUBLIC_STICKERS_DIR,
  CHAT_EMOJI_STICKERS,
  CHAT_EMOJIS,
  resolveChatSticker,
  chatMediaPackForUser,
  stickerCuerpoPreview,
  previewTextoMensaje,
  saveUploadedSticker,
  deleteUserSticker,
  listUserStickers,
  getStickerMediaPath,
  canSendSticker,
  listUsersStickerCounts,
  // compat
  chatMediaPack: () => ({
    stickers: [...loadGlobalImageStickers(), ...CHAT_EMOJI_STICKERS.map((s) => ({ ...s, src: null, scope: 'emoji' }))],
    emojis: CHAT_EMOJIS.slice()
  }),
  rebuildCache: () => {}
};
