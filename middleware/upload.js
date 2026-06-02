// middleware/upload.js
// Configuración compartida de multer + validación de MIME real (magic bytes).
// El acceso a los archivos resultantes se realiza vía `routes/uploads.js` con auth.

const multer = require('multer');
const path = require('path');
const { getUploadsRoot } = require('../config/uploads-path');

const uploadDir = getUploadsRoot();

// Extensiones permitidas → grupos de detección
const EXT_PDF = ['.pdf'];
const EXT_PNG = ['.png'];
const EXT_JPG = ['.jpg', '.jpeg'];
const EXT_ZIP_LIKE = ['.xlsx']; // xlsx es un zip por dentro
const EXT_OLE_LIKE = ['.xls']; // xls antiguo
const EXT_CSV = ['.csv'];

const ALLOWED_EXTENSIONS = [
  ...EXT_PDF, ...EXT_PNG, ...EXT_JPG,
  ...EXT_ZIP_LIKE, ...EXT_OLE_LIKE, ...EXT_CSV
];

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
      const safeName = `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`;
      cb(null, safeName);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXTENSIONS.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Tipo de archivo no permitido: ${ext}`));
    }
  }
});

/**
 * Lee los primeros bytes y verifica que coincidan con la extensión declarada.
 * Si no, borra el archivo y devuelve 400.
 * CSV se acepta por extensión (sin magic bytes).
 */
/** Busca la firma %PDF en los primeros bytes (algunos escáneres dejan espacios/BOM al inicio). */
function findPdfMagicOffset(buf) {
  const max = Math.min(buf.length - 4, 1024);
  for (let i = 0; i <= max; i++) {
    if (buf[i] === 0x25 && buf[i + 1] === 0x50 && buf[i + 2] === 0x44 && buf[i + 3] === 0x46) {
      return i;
    }
  }
  return -1;
}

function bufferLooksLikePdf(buf) {
  return findPdfMagicOffset(buf) >= 0;
}

function fileLooksLikePdf(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(1024);
    const bytesRead = fs.readSync(fd, buf, 0, 1024, 0);
    fs.closeSync(fd);
    return bufferLooksLikePdf(buf.subarray(0, bytesRead));
  } catch (_) {
    return false;
  }
}

function resolveUploadedFilePath(file) {
  if (!file) return null;
  const candidates = [];
  if (file.path) candidates.push(file.path);
  if (file.destination && file.filename) {
    candidates.push(path.join(file.destination, file.filename));
  }
  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p)) return p;
    } catch (_) { /* ignore */ }
  }
  return file.path || (file.destination && file.filename
    ? path.join(file.destination, file.filename)
    : null);
}

function validateMagicBytes(req, res, next) {
  if (!req.file) return next();
  const filePath = resolveUploadedFilePath(req.file);
  const ext = path.extname(req.file.originalname).toLowerCase();
  if (EXT_CSV.includes(ext)) return next();

  if (!filePath) {
    return res.status(500).json({
      error: 'El archivo subido no está en disco. Revise permisos de UPLOADS_DIR.'
    });
  }
  req.file.path = filePath;

  try {
    const fd = fs.openSync(filePath, 'r');
    const scanLen = EXT_PDF.includes(ext) ? 1024 : 12;
    const buf = Buffer.alloc(scanLen);
    const bytesRead = fs.readSync(fd, buf, 0, scanLen, 0);
    fs.closeSync(fd);

    const matches = detectByMagic(buf.subarray(0, bytesRead), ext);
    if (!matches) {
      try {
        fs.unlinkSync(filePath);
      } catch (_) {}
      req.file = null;
      return res.status(400).json({
        error: 'El contenido del archivo no coincide con su extensión'
      });
    }
    return next();
  } catch (e) {
    try {
      fs.unlinkSync(filePath);
    } catch (_) {}
    req.file = null;
    return res.status(500).json({ error: 'No se pudo validar el archivo subido' });
  }
}

function detectByMagic(buf, ext) {
  if (buf.length < 4) return false;

  // PDF: "%PDF-" (puede no estar en el byte 0)
  if (EXT_PDF.includes(ext)) {
    return bufferLooksLikePdf(buf);
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (EXT_PNG.includes(ext)) {
    return buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47
      && buf[4] === 0x0D && buf[5] === 0x0A && buf[6] === 0x1A && buf[7] === 0x0A;
  }
  // JPG: FF D8 FF
  if (EXT_JPG.includes(ext)) {
    return buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF;
  }
  // XLSX (zip): PK\x03\x04 o PK\x05\x06 o PK\x07\x08
  if (EXT_ZIP_LIKE.includes(ext)) {
    return buf[0] === 0x50 && buf[1] === 0x4B
      && (buf[2] === 0x03 || buf[2] === 0x05 || buf[2] === 0x07);
  }
  // XLS (compound document OLE): D0 CF 11 E0 A1 B1 1A E1
  if (EXT_OLE_LIKE.includes(ext)) {
    return buf[0] === 0xD0 && buf[1] === 0xCF && buf[2] === 0x11 && buf[3] === 0xE0
      && buf[4] === 0xA1 && buf[5] === 0xB1 && buf[6] === 0x1A && buf[7] === 0xE1;
  }
  return false;
}

const uploadArmadoSoportes = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
      const safeName = `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`;
      cb(null, safeName);
    }
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const mime = (file.mimetype || '').toLowerCase();
    if (ext === '.pdf' || mime === 'application/pdf') {
      return cb(null, true);
    }
    if (ext === '.json' || ext === '.xml') {
      return cb(null, true);
    }
    cb(new Error('Solo se permiten archivos PDF (SOPORTES) o JSON/XML (RIPS). Use extensión .pdf'));
  }
});

module.exports = {
  upload,
  uploadArmadoSoportes,
  validateMagicBytes,
  resolveUploadedFilePath,
  fileLooksLikePdf,
  bufferLooksLikePdf
};
