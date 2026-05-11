// middleware/upload.js
// Configuración compartida de multer + validación de MIME real (magic bytes).
// El acceso a los archivos resultantes se realiza vía `routes/uploads.js` con auth.

const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadDir = path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

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
function validateMagicBytes(req, res, next) {
  if (!req.file) return next();
  const filePath = req.file.path;
  const ext = path.extname(req.file.originalname).toLowerCase();
  if (EXT_CSV.includes(ext)) return next();

  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(12);
    const bytesRead = fs.readSync(fd, buf, 0, 12, 0);
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

  // PDF: "%PDF-"
  if (EXT_PDF.includes(ext)) {
    return buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46;
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

module.exports = { upload, validateMagicBytes };
