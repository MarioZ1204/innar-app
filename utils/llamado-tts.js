/**
 * Síntesis de voz para llamado de pacientes (Microsoft Edge neural TTS).
 * Voz por defecto: es-CO-SalomeNeural — natural, clara, acento colombiano.
 */
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { EdgeTTS } = require('node-edge-tts');

const VOICE = process.env.LLAMADO_TTS_VOICE || 'es-CO-SalomeNeural';
const RATE = process.env.LLAMADO_TTS_RATE || '+8%';
const PITCH = process.env.LLAMADO_TTS_PITCH || '+0Hz';
const VOLUME = process.env.LLAMADO_TTS_VOLUME || '+12%';
const TIMEOUT_MS = Math.min(Math.max(parseInt(process.env.LLAMADO_TTS_TIMEOUT_MS || '15000', 10) || 15000, 5000), 30000);

const DIGITOS_ES = ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve'];

/** Lee consultorio dígito a dígito (302 → "tres cero dos") para mayor claridad en TV. */
function consultorioParaVoz(numero) {
  const s = String(numero ?? '').trim();
  if (!s) return 'sin número';
  if (!/^\d+$/.test(s)) return s;
  return s.split('').map((d) => DIGITOS_ES[parseInt(d, 10)]).join(' ');
}

/** Texto optimizado para anuncio en pantalla de llamado. */
function textoAnuncioLlamado(pacienteNombre, numeroConsultorio) {
  const nombre = String(pacienteNombre || 'paciente').trim();
  const cons = consultorioParaVoz(numeroConsultorio);
  return `Atención. Paciente ${nombre}. Diríjase al consultorio ${cons}.`;
}

const cache = new Map();
const CACHE_MAX = 48;

function cacheKey(text) {
  return crypto.createHash('sha256').update(`${VOICE}|${RATE}|${PITCH}|${text}`).digest('hex');
}

async function synthesizeLlamadoTts(text) {
  const normalized = String(text || '').trim().slice(0, 500);
  if (!normalized) throw new Error('Texto vacío');

  const key = cacheKey(normalized);
  if (cache.has(key)) return cache.get(key);

  const tts = new EdgeTTS({
    voice: VOICE,
    rate: RATE,
    pitch: PITCH,
    volume: VOLUME,
    timeout: TIMEOUT_MS
  });

  const tmp = path.join(os.tmpdir(), `innar-llamado-${key.slice(0, 20)}.mp3`);
  try {
    await tts.ttsPromise(normalized, tmp);
    const buffer = await fs.readFile(tmp);
    if (!buffer?.length) throw new Error('Audio vacío');
    const result = { buffer, contentType: 'audio/mpeg' };
    if (cache.size >= CACHE_MAX) {
      const oldest = cache.keys().next().value;
      cache.delete(oldest);
    }
    cache.set(key, result);
    return result;
  } finally {
    await fs.unlink(tmp).catch(() => {});
  }
}

function clearLlamadoTtsCache() {
  cache.clear();
}

module.exports = {
  synthesizeLlamadoTts,
  textoAnuncioLlamado,
  consultorioParaVoz,
  clearLlamadoTtsCache,
  LLAMADO_TTS_VOICE: VOICE
};
