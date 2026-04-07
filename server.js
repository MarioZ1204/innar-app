// server.js
require('dotenv').config();

// Validar variables de entorno requeridas antes de arrancar
const REQUIRED_ENV = ['DB_HOST', 'DB_USER', 'DB_NAME', 'SESSION_SECRET'];
const MISSING_ENV = REQUIRED_ENV.filter(v => process.env[v] === undefined || process.env[v] === null);
if (MISSING_ENV.length > 0) {
  console.error(`[ERROR] Faltan variables de entorno requeridas: ${MISSING_ENV.join(', ')}`);
  console.error('[ERROR] Copie .env.example a .env y configure los valores correctos.');
  process.exit(1);
}

const express = require('express');
const https = require('https');
const http = require('http');
const socketIo = require('socket.io');
const helmet = require('helmet');
const db = require('./utils/db-mysql');
const rateLimiter = require('./modules/rate-limiter');
const validation = require('./modules/validation');
const auditLog = require('./modules/audit-log');
const transactions = require('./utils/transactions');
const logger = require('./utils/logger');
const procesarAgendaExcel = require('./utils/procesar-agenda-excel');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const appointmentsRouter = require('./routes/appointmentsV1');
const { startBackupScheduler } = require('./utils/backup-scheduler');

const app = express();

// Compresión gzip para todas las respuestas
app.use(compression());

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));
// Headers de seguridad HTTP
app.use(helmet({
  contentSecurityPolicy: false,    // La app usa scripts/estilos inline
  hsts: process.env.NODE_ENV === 'production',
  crossOriginEmbedderPolicy: false,
  frameguard: { action: 'sameorigin' },
}));

// Rate limiter global — max 200 requests por minuto por IP
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes, intenta de nuevo en un minuto' }
});
app.use('/api/', apiLimiter);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
// 50mb para rutas que generan PDFs con HTML grande
const jsonLargeBody = express.json({ limit: '50mb' });
const urlencodedLargeBody = express.urlencoded({ limit: '50mb', extended: true });

// Logging de requests  ignora assets estáticos
const EXTENSIONES_ESTATICAS = /\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|map)$/i;
app.use((req, res, next) => {
  if (EXTENSIONES_ESTATICAS.test(req.path)) return next();

  const startTime = Date.now();
  
  // Capturar el método original de res.end/res.send
  const originalEnd = res.end;
  const originalSend = res.send;
  
  res.end = function(data, encoding) {
    const duration = Date.now() - startTime;
    const statusCode = res.statusCode || 200;
    
    logger.api(req.method, req.path, statusCode, duration, {
      ip: req.ip,
      userAgent: req.get('user-agent')?.substring(0, 50)
    });
    
    originalEnd.call(this, data, encoding);
  };
  
  res.send = function(data) {
    const duration = Date.now() - startTime;
    const statusCode = res.statusCode || 200;
    
    logger.api(req.method, req.path, statusCode, duration, {
      ip: req.ip,
      userAgent: req.get('user-agent')?.substring(0, 50)
    });
    
    return originalSend.call(this, data);
  };
  
  next();
});

// Configurar multer para uploads de archivos
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
      const safeName = `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9.\-_]/g,'_')}`;
      cb(null, safeName);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (req, file, cb) => {
    const allowed = ['.xlsx', '.xls', '.csv', '.pdf', '.png', '.jpg', '.jpeg'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Tipo de archivo no permitido: ${ext}`));
    }
  }
});

// Middleware para cerrar sesión por inactividad (60 minutos)
app.use((req, res, next) => {
  try {
    if (req.session) {
      const INACTIVITY_MS = 60 * 60 * 1000; // 60 minutos
      const now = Date.now();
      if (req.session.lastActivity && (now - req.session.lastActivity) > INACTIVITY_MS) {
        // destruir sesión por inactividad
        req.session.destroy(() => {});
      } else {
        req.session.lastActivity = now;
      }
    }
  } catch (e) {
    console.error('session middleware error', e.message);
  }
  next();
});

// Configurar sesiones
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 8 * 60 * 60 * 1000 // 8 horas
  }
}));
// activar rolling session para actualizar cookie en cada respuesta
app.set('trust proxy', 1);

// Rutas de la API v1 de Appointments Service
app.use('/api/v1/appointments', requireAuth, appointmentsRouter);

// Páginas wrapper para reportes (muestran favicon en la pestaña y el PDF en iframe)
app.get('/reportes/diario/vista', requireAuth, (req, res) => {
  const fecha = req.query.fecha || '';
  const pdfUrl = `/api/reportes/diario?fecha=${encodeURIComponent(fecha)}`;
  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Reporte Diario</title>
  <link rel="icon" type="image/png" href="/icon.png"/>
</head>
<body style="margin:0;padding:0;">
  <iframe src="${pdfUrl}" style="width:100%;height:100vh;border:none;" title="Reporte Diario"></iframe>
</body>
</html>`;
  res.type('html').send(html);
});

app.get('/reportes/mensual/vista', requireAuth, (req, res) => {
  const mes = req.query.mes || '';
  const pdfUrl = `/api/reportes/mensual?mes=${encodeURIComponent(mes)}`;
  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Reporte Mensual</title>
  <link rel="icon" type="image/png" href="/icon.png"/>
</head>
<body style="margin:0;padding:0;">
  <iframe src="${pdfUrl}" style="width:100%;height:100vh;border:none;" title="Reporte Mensual"></iframe>
</body>
</html>`;
  res.type('html').send(html);
});

// Middleware simple sin forzar HTTPS - desarrollo local HTTP puro
app.use((req, res, next) => {
  // Limpiar cache HSTS del navegador - decirle que olvide que fue HTTPS
  res.setHeader('Strict-Transport-Security', 'max-age=0; includeSubDomains');
  next();
});

// Headers anti-cache solo para rutas /api (los assets estáticos sí pueden cachearse)
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

app.use(express.static('public'));

// Cargar imagen del logo como base64
let logoBase64 = '';

// Función para obtener la ruta del logo (compatible con pkg)
function getLogoPath() {
  const possiblePaths = [
    path.join(__dirname, 'public', 'images', 'logo.png'),  // ubicación real
    path.join(__dirname, 'public', 'logo.png'),
    path.join(__dirname, '../public/images/logo.png'),
    path.join(__dirname, '../public/logo.png'),
    path.join(process.execPath, '..', 'public', 'images', 'logo.png'),
    path.join(process.execPath, '..', 'public', 'logo.png'),
  ];
  for (let p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// Cargar logo de forma lazy (al primer uso) para tolerar reinicios sin logo
function getLogoBase64() {
  if (logoBase64) return logoBase64;
  const logoPath = getLogoPath();
  if (logoPath) {
    try {
      logoBase64 = fs.readFileSync(logoPath).toString('base64');
    } catch(e) {
      console.warn('Error cargando logo:', e.message);
    }
  }
  return logoBase64;
}

// Intento inicial (no crítico)
try { getLogoBase64(); } catch(_) {}

// Logo específico para recibos (logorecibo.png)
let logoReciboBase64 = null;
function getLogoReciboBase64() {
  if (logoReciboBase64) return logoReciboBase64;
  const possiblePaths = [
    path.join(__dirname, 'public', 'images', 'logorecibo.png'),
    path.join(__dirname, 'public', 'logorecibo.png'),
    path.join(__dirname, '../public/images/logorecibo.png'),
    path.join(__dirname, '../public/logorecibo.png'),
    path.join(process.execPath, '..', 'public', 'images', 'logorecibo.png'),
    path.join(process.execPath, '..', 'public', 'logorecibo.png'),
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      try { logoReciboBase64 = fs.readFileSync(p).toString('base64'); } catch(_) {}
      break;
    }
  }
  return logoReciboBase64 || getLogoBase64(); // fallback al logo genérico
}

// Las tablas de MySQL se inicializan con npm run init-db
// No es necesario db.exec() aquí

// Opciones para Puppeteer (Chrome/Edge del sistema si existe)
function getPuppeteerLaunchOptions() {
  const launchOptions = {
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-zygote', '--single-process'],
    dumpio: false
  };
  const chromePaths = [
    // Linux (Hostinger / servidor)
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    // Windows (desarrollo local)
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  for (const chromePath of chromePaths) {
    if (fs.existsSync(chromePath)) {
      launchOptions.executablePath = chromePath;
      break;
    }
  }
  return launchOptions;
}

// Validar que id sea un entero positivo (para rutas :id)
function parseReciboId(id) {
  const n = parseInt(id, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Helper seguro para emitir eventos de Socket.IO
function emitSocket(eventName, data) {
  try {
    if (app.io) {
      app.io.emit(eventName, data);
    }
  } catch (error) {
    logger.warn(`Socket.IO emit error: ${eventName}`, { error: error.message });
  }
}

// Middleware de autenticación
function requireAuth(req, res, next) {
  if (req.session && req.session.usuarioId) {
    return next();
  }
  return res.status(401).json({ error: 'No autenticado' });
}

// Helper: comprueba si el rol es superadmin (o admin legacy)
function isAdminRol(rol) {
  return rol === 'superadmin' || rol === 'admin';
}
// Helper: roles que gestionan Recepción
function isRecepcionRol(rol) {
  return rol === 'admin_recepcion' || rol === 'recepcion' || isAdminRol(rol);
}
// Helper: roles que gestionan Electrodiagnóstico
function isElectroRol(rol) {
  return rol === 'admin_electro' || rol === 'electro' || rol === 'tecnico_electro' || isAdminRol(rol);
}
// Helper: puede ver auditoría de citas
function canViewAuditoriaCitas(rol) {
  return isAdminRol(rol) || rol === 'admin_recepcion' || rol === 'recepcion' || rol === 'admin_electro' || rol === 'electro';
}

// Middleware: solo rol superadmin (y legacy admin)
function requireAdmin(req, res, next) {
  if (req.session && isAdminRol(req.session.rol)) {
    return next();
  }
  return res.status(403).json({ error: 'Solo super administradores pueden realizar esta acción' });
}

// Middleware: rol permitido (array de roles)
function requireRole(roles) {
  return (req, res, next) => {
    if (req.session && req.session.usuarioId && roles.includes(req.session.rol)) {
      return next();
    }
    return res.status(403).json({ error: 'No tienes permiso para esta acción' });
  };
}

// --- Autenticación ---

// Login
app.post('/api/login', async (req, res) => {
  const { usuario, password } = req.body || {};
  if (!usuario || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
  }

  const clientIP = rateLimiter.getClientIP(req);

  try {
    // Verificar si el IP está bloqueado
    if (await rateLimiter.isBlocked(clientIP)) {
      const blockInfo = await rateLimiter.getBlockInfo(clientIP);
      return res.status(429).json({
        error: 'Demasiados intentos fallidos. Intenta más tarde.',
        bloqueado_hasta: blockInfo.bloqueado_hasta,
        intentos: blockInfo.intentos
      });
    }

    // Buscar usuario en MySQL
    const users = await db.query(
      'SELECT * FROM usuarios WHERE usuario = ? AND activo = 1',
      [usuario]
    );
    
    if (users.length === 0) {
      // Registrar intento fallido
      await rateLimiter.recordFailedAttempt(clientIP, usuario);
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }

    const user = users[0];

    // Verificar contraseña (recibe SHA512 del cliente, compara con bcrypt de SHA512)
    if (!bcrypt.compareSync(password, user.password_hash)) {
      // Registrar intento fallido
      await rateLimiter.recordFailedAttempt(clientIP, usuario);
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }

    // Login exitoso: resetear intentos
    await rateLimiter.resetAttempts(clientIP);

    // Actualizar último acceso
    await db.execute('UPDATE usuarios SET ultimo_acceso = NOW() WHERE id = ?', [user.id]).catch(() => {});

    // Guardar en sesión
    req.session.usuarioId = user.id;
    req.session.usuario = user.usuario;
    req.session.rol = user.rol;
    req.session.permisos = user.permisos || null;

    res.json({ 
      ok: true, 
      usuario: { id: user.id, usuario: user.usuario, nombre: user.nombre, rol: user.rol, especialidad: user.especialidad, permisos: user.permisos || null }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Logout
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

// Verificar sesión actual
app.get('/api/sesion', async (req, res) => {
  if (req.session && req.session.usuarioId) {
    try {
      const users = await db.query(
        'SELECT id, usuario, nombre, rol, especialidad, permisos FROM usuarios WHERE id = ?',
        [req.session.usuarioId]
      );
      const user = users.length > 0 ? users[0] : null;
      if (user) {
        // Refresh permisos in session in case they changed
        req.session.permisos = user.permisos || null;
      }
      res.json({ autenticado: true, usuario: user });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  } else {
    res.json({ autenticado: false });
  }
});

// Cambiar contraseña (cualquier usuario autenticado)
// Datos completos del usuario actual (modal Mi Cuenta)
app.get('/api/mi-cuenta', requireAuth, async (req, res) => {
  try {
    const rows = await db.query(
      'SELECT id, usuario, nombre, rol, especialidad, numero_consultorio, creado_en, ultimo_acceso FROM usuarios WHERE id = ?',
      [req.session.usuarioId]
    );
    if (!rows || rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/cambiar-contrasena', requireAuth, async (req, res) => {
  const { 
    nombre, 
    contrasenaActual, 
    nuevaContrasena, 
    confirmarContrasena 
  } = req.body || {};
  
  // Validar que al menos nombre o contraseña sea proporcionado
  if (!nombre && !nuevaContrasena) {
    return res.status(400).json({ error: 'Debe proporcionar al menos nombre o contraseña nueva' });
  }

  // Si va a cambiar contraseña, validar los campos
  if (nuevaContrasena) {
    if (!contrasenaActual || !confirmarContrasena) {
      return res.status(400).json({ error: 'Se requieren contraseña actual y confirmación' });
    }

    if (nuevaContrasena !== confirmarContrasena) {
      return res.status(400).json({ error: 'Las contraseñas no coinciden' });
    }

    // Nota: Validación de longitud de contraseña (6 caracteres) ya fue hecha en cliente
    // El servidor recibe SHA512 (128 caracteres)
    if (nuevaContrasena.length < 100) {
      return res.status(400).json({ error: 'Contraseña inválida' });
    }

    // Validar nombre si es proporcionado
    if (nombre && nombre.trim().length === 0) {
      return res.status(400).json({ error: 'El nombre no puede estar vacío' });
    }
  }

  try {
    // Obtener usuario actual
    const users = await db.query(
      'SELECT * FROM usuarios WHERE id = ?',
      [req.session.usuarioId]
    );

    if (users.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const user = users[0];

    // Si va a cambiar contraseña, verificar la actual
    if (nuevaContrasena) {
      if (!bcrypt.compareSync(contrasenaActual, user.password_hash)) {
        return res.status(401).json({ error: 'La contraseña actual es incorrecta' });
      }

      if (bcrypt.compareSync(nuevaContrasena, user.password_hash)) {
        return res.status(400).json({ error: 'La nueva contraseña debe ser diferente a la actual' });
      }
    }

    // Preparar actualización
    const updates = [];
    const params = [];

    if (nombre) {
      updates.push('nombre = ?');
      params.push(nombre.trim());
    }

    if (nuevaContrasena) {
      const nuevoHash = bcrypt.hashSync(nuevaContrasena, 10);
      updates.push('password_hash = ?');
      params.push(nuevoHash);
    }

    params.push(req.session.usuarioId);

    // Ejecutar actualización
    await db.execute(
      `UPDATE usuarios SET ${updates.join(', ')} WHERE id = ?`,
      params
    );

    // Si cambió nombre, actualizar en sesión y notificar vía socket
    if (nombre) {
      req.session.nombre = nombre.trim();
      emitSocket('usuario:nombre-actualizado', { id: req.session.usuarioId, nombre: nombre.trim() });
    }

    const mensaje = [];
    if (nombre) mensaje.push('nombre');
    if (nuevaContrasena) mensaje.push('contraseña');
    
    res.json({ 
      ok: true, 
      mensaje: `Tu ${mensaje.join(' y ')} ${mensaje.length > 1 ? 'fueron actualizados' : 'fue actualizado'} correctamente`,
      nombre: nombre
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// --- Usuarios ---
app.get('/api/usuarios', requireAuth, requireAdmin, async (req, res) => {
  try {
    const usuarios = await db.query(
      'SELECT id, usuario, nombre, rol, activo, numero_consultorio, especialidad FROM usuarios ORDER BY usuario ASC'
    );
    res.json(usuarios);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/usuarios', requireAuth, requireAdmin, async (req, res) => {
  const { usuario, password, nombre, rol, numero_consultorio, especialidad } = req.body || {};
  
  // Validaciones básicas
  if (!usuario || !password || !nombre || !rol) {
    return res.status(400).json({ error: 'usuario, password, nombre y rol son obligatorios' });
  }

  // Validar username
  const usernameValidation = validation.validateUsername(usuario);
  if (!usernameValidation.isValid) {
    return res.status(400).json({ error: usernameValidation.messages[0] });
  }

  // Validar contraseña
  // Nota: La validación de fortaleza ya fue hecha en cliente antes de hashear con SHA512
  // El servidor recibe el hash SHA512, no el texto plano
  if (!password || password.length < 100) {
    return res.status(400).json({ error: 'Contraseña inválida' });
  }

  // Validar rol
  const rolesValidos = ['superadmin', 'admin', 'admin_recepcion', 'recepcion', 'admin_electro', 'electro', 'tecnico_electro', 'auxiliar_recepcion', 'doctor', 'contabilidad'];
  if (!rolesValidos.includes(rol)) {
    return res.status(400).json({ error: 'Rol inválido.' });
  }

  // Validar consultorio para doctores
  let consultorioFinal = null;
  let especialidadFinal = null;
  if (rol === 'doctor') {
    const numConsultorio = parseInt(numero_consultorio, 10);
    if (isNaN(numConsultorio) || numConsultorio < 1) {
      return res.status(400).json({ error: 'Número de consultorio debe ser un número válido' });
    }
    consultorioFinal = numConsultorio;
    
    // Validar especialidad
    if (!especialidad || especialidad.trim() === '') {
      return res.status(400).json({ error: 'La especialidad es obligatoria para DOCTOR' });
    }
    especialidadFinal = especialidad.trim();
  }

  try {
    const hash = bcrypt.hashSync(password, 10);
    const result = await db.execute(
      'INSERT INTO usuarios (usuario, password_hash, nombre, rol, numero_consultorio, especialidad) VALUES (?, ?, ?, ?, ?, ?)',
      [usuario, hash, nombre, rol, consultorioFinal, especialidadFinal]
    );
    
    // Registrar en auditoría
    await auditLog.registrarAuditoria({
      usuarioId: result.insertId,
      adminId: req.session.usuarioId,
      adminUsuario: req.session.usuario,
      accion: 'CREAR',
      cambios: { usuario, nombre, rol, numero_consultorio: consultorioFinal, especialidad: especialidadFinal },
      ip: req.ip
    });
    
    // Emitir evento WebSocket
    emitSocket('usuario:creado', { id: result.insertId });
    
    res.json({ ok: true, id: result.insertId });
  } catch (e) {
    if (e.message && e.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'El usuario ya existe' });
    }
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/usuarios/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { usuario, password, nombre, rol, activo, numero_consultorio, especialidad } = req.body || {};
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  try {
    const users = await db.query('SELECT * FROM usuarios WHERE id = ?', [id]);
    const user = users.length > 0 ? users[0] : null;
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    
    const updates = [];
    const params = [];
    
    // Determinar el nuevo rol (si se actualiza) o mantener el actual
    const nuevoRol = rol !== undefined ? rol : user.rol;
    
    if (usuario !== undefined) { updates.push('usuario = ?'); params.push(usuario); }
    if (nombre !== undefined) { updates.push('nombre = ?'); params.push(nombre); }
    if (rol !== undefined) {
      const rolesValidos = ['superadmin', 'admin', 'admin_recepcion', 'recepcion', 'admin_electro', 'electro', 'tecnico_electro', 'auxiliar_recepcion', 'doctor', 'contabilidad'];
      if (!rolesValidos.includes(rol)) return res.status(400).json({ error: 'Rol inválido' });
      if (user.rol === 'superadmin' && rol !== 'superadmin') {
        return res.status(403).json({ error: 'No se puede cambiar el rol del Super Administrador' });
      }
      updates.push('rol = ?'); params.push(rol);
    }
    
    // Manejar numero_consultorio
    if (numero_consultorio !== undefined) {
      let consultorioFinal = null;
      if (numero_consultorio !== null) {
        const num = parseInt(numero_consultorio, 10);
        if (isNaN(num) || num < 1) {
          return res.status(400).json({ error: 'Número de consultorio debe ser un número válido' });
        }
        consultorioFinal = num;
      }
      updates.push('numero_consultorio = ?');
      params.push(consultorioFinal);
    } else if (rol === 'doctor' && user.rol !== 'doctor') {
      // Si cambia A doctor pero no especifica consultorio, pedir que lo haga
      return res.status(400).json({ error: 'Número de consultorio es obligatorio para DOCTOR' });
    } else if (rol !== 'doctor' && user.rol === 'doctor') {
      // Si cambia DE doctor A otro rol, limpiar consultorio
      updates.push('numero_consultorio = ?');
      params.push(null);
    }
    
    // Manejar especialidad
    if (especialidad !== undefined && (nuevoRol === 'doctor' || rol === 'doctor')) {
      let especialidadFinal = null;
      if (especialidad !== null && especialidad.trim() !== '') {
        especialidadFinal = especialidad.trim();
      }
      if (nuevoRol === 'doctor' && !especialidadFinal) {
        return res.status(400).json({ error: 'La especialidad es obligatoria para DOCTOR' });
      }
      updates.push('especialidad = ?');
      params.push(especialidadFinal);
    } else if (rol !== 'doctor' && user.rol === 'doctor') {
      // Si cambia DE doctor A otro rol, limpiar especialidad
      updates.push('especialidad = ?');
      params.push(null);
    }
    
    if (activo !== undefined) { updates.push('activo = ?'); params.push(activo ? 1 : 0); }
    if (password && password.trim()) {
      updates.push('password_hash = ?');
      params.push(bcrypt.hashSync(password, 10));
    }
    
    if (updates.length === 0) return res.status(400).json({ error: 'Nada que actualizar' });
    params.push(id);
    await db.execute(`UPDATE usuarios SET ${updates.join(', ')} WHERE id = ?`, params);
    
    // Construir objeto de cambios para auditoría
    const cambios = {};
    if (usuario !== undefined && usuario !== user.usuario) {
      cambios.usuario = { antes: user.usuario, despues: usuario };
    }
    if (nombre !== undefined && nombre !== user.nombre) {
      cambios.nombre = { antes: user.nombre, despues: nombre };
    }
    if (rol !== undefined && rol !== user.rol) {
      cambios.rol = { antes: user.rol, despues: rol };
    }
    if (numero_consultorio !== undefined && numero_consultorio !== user.numero_consultorio) {
      cambios.numero_consultorio = { antes: user.numero_consultorio, despues: numero_consultorio };
    }
    if (especialidad !== undefined && especialidad !== user.especialidad) {
      cambios.especialidad = { antes: user.especialidad || '', despues: especialidad || '' };
    }
    if (activo !== undefined && (activo ? 1 : 0) !== user.activo) {
      cambios.activo = { antes: user.activo, despues: activo ? 1 : 0 };
    }
    if (password && password.trim()) {
      cambios.password = { antes: '***', despues: '***' };
    }
    
    // Registrar en auditoría si hay cambios
    if (Object.keys(cambios).length > 0) {
      await auditLog.registrarAuditoria({
        usuarioId: id,
        adminId: req.session.usuarioId,
        adminUsuario: req.session.usuario,
        accion: 'ACTUALIZAR',
        cambios,
        ip: req.ip
      });
    }

    // Notificar a todos los clientes conectados
    emitSocket('usuario:actualizado', { id });

    res.json({ ok: true });
  } catch (e) {
    if (e.message && e.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'El usuario ya existe' });
    }
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ── Permisos granulares por usuario (solo superadmin) ──────────────────────
app.get('/api/usuarios/:id/permisos', requireAuth, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  try {
    const rows = await db.query('SELECT id, usuario, nombre, rol, permisos FROM usuarios WHERE id = ?', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });
    const u = rows[0];
    let permisos = null;
    if (u.permisos) {
      try { permisos = typeof u.permisos === 'string' ? JSON.parse(u.permisos) : u.permisos; } catch(_) {}
    }
    res.json({ id: u.id, usuario: u.usuario, nombre: u.nombre, rol: u.rol, permisos });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/usuarios/:id/permisos', requireAuth, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  const { permisos } = req.body;
  if (permisos !== null && !Array.isArray(permisos)) return res.status(400).json({ error: 'permisos debe ser array o null' });
  // Validar que los permisos sean strings
  if (Array.isArray(permisos) && permisos.some(p => typeof p !== 'string')) {
    return res.status(400).json({ error: 'permisos debe contener solo cadenas de texto' });
  }
  try {
    const rows = await db.query('SELECT rol FROM usuarios WHERE id = ?', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (rows[0].rol === 'superadmin') return res.status(403).json({ error: 'No se pueden modificar permisos del superadmin' });
    const value = permisos === null ? null : JSON.stringify(permisos);
    await db.execute('UPDATE usuarios SET permisos = ? WHERE id = ?', [value, id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/usuarios/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  if (id === req.session.usuarioId) {
    return res.status(400).json({ error: 'No puedes eliminar tu propio usuario' });
  }
  try {
    // Obtener usuario antes de eliminar para auditoría
    const userBefore = await db.queryOne('SELECT usuario, nombre, rol FROM usuarios WHERE id = ?', [id]);
    if (!userBefore) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (userBefore.rol === 'superadmin') {
      return res.status(403).json({ error: 'El Super Administrador no puede ser eliminado' });
    }
    
    const result = await db.execute('DELETE FROM usuarios WHERE id = ?', [id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    
    // Registrar en auditoría
    await auditLog.registrarAuditoria({
      usuarioId: id,
      adminId: req.session.usuarioId,
      adminUsuario: req.session.usuario,
      accion: 'ELIMINAR',
      cambios: { usuario: userBefore.usuario, nombre: userBefore.nombre },
      ip: req.ip
    });
    
    // Emitir evento WebSocket
    emitSocket('usuario:eliminado', { id });
    
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Toggle activo/inactivo de usuario
app.patch('/api/usuarios/:id/toggle-estado', requireAuth, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  if (id === req.session.usuarioId) {
    return res.status(400).json({ error: 'No puedes cambiar tu propio estado' });
  }
  
  try {
    // Obtener estado actual
    const user = await db.queryOne('SELECT id, activo FROM usuarios WHERE id = ?', [id]);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    
    // Cambiar estado
    const nuevoEstado = user.activo ? 0 : 1;
    await db.execute('UPDATE usuarios SET activo = ? WHERE id = ?', [nuevoEstado, id]);
    
    // Registrar en auditoría
    await auditLog.registrarAuditoria({
      usuarioId: id,
      adminId: req.session.usuarioId,
      adminUsuario: req.session.usuario,
      accion: nuevoEstado ? 'ACTIVAR' : 'DESACTIVAR',
      cambios: { activo: { antes: user.activo, despues: nuevoEstado } },
      ip: req.ip
    });
    
    // Emitir evento WebSocket
    if (app.io) {
      emitSocket('usuario:actualizado', { id, activo: nuevoEstado });
    }
    
    res.json({ ok: true, activo: nuevoEstado });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Obtener historial de auditoría de un usuario
app.get('/api/usuarios/:id/historial', requireAuth, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  
  try {
    const historial = await auditLog.obtenerHistorial(id, 50);
    res.json(historial);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Obtener historial global de auditoría
app.get('/api/auditoria/historial', requireAuth, requireAdmin, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const historial = await auditLog.obtenerHistorialGlobal(limit);
    res.json(historial);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Búsqueda avanzada en auditoría
app.get('/api/auditoria/buscar', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { usuario_id, accion, admin_id, desde, hasta, limit: reqLimit } = req.query;
    const limit = Math.min(parseInt(reqLimit) || 500, 500); // Max 500
    
    let query = 'SELECT ua.*, u.usuario, u.nombre FROM usuario_auditorias ua LEFT JOIN usuarios u ON ua.usuario_id = u.id WHERE 1=1';
    const params = [];
    
    // Filtros opcionales
    if (usuario_id && usuario_id.trim() !== '') {
      query += ' AND ua.usuario_id = ?';
      params.push(parseInt(usuario_id));
    }
    
    if (accion && accion.trim() !== '') {
      query += ' AND ua.accion = ?';
      params.push(accion.toUpperCase());
    }
    
    if (admin_id && admin_id.trim() !== '') {
      query += ' AND ua.admin_id = ?';
      params.push(parseInt(admin_id));
    }
    
    if (desde && desde.trim() !== '') {
      query += ' AND ua.fecha_cambio >= ?';
      params.push(desde + ' 00:00:00');
    }
    
    if (hasta && hasta.trim() !== '') {
      query += ' AND ua.fecha_cambio <= ?';
      params.push(hasta + ' 23:59:59');
    }
    
    // Ordenar por fecha descendente y limitar (LIMIT debe ser número directo, no parámetro)
    query += ` ORDER BY ua.fecha_cambio DESC LIMIT ${limit}`;
    
    logger.debug('[AUDIT SEARCH] Query: ' + query);
    logger.debug('[AUDIT SEARCH] Params: ' + JSON.stringify(params));

    const results = await db.query(query, params);

    logger.debug('[AUDIT SEARCH] Resultados: ' + results.length);
    
    // Parsear JSON de cambios - IMPORTANTE: el campo cambios viene como STRING de JSON
    const resultsWithParsedChanges = results.map(r => {
      let cambiosParsed = {};
      try {
        if (typeof r.cambios === 'string' && r.cambios) {
          cambiosParsed = JSON.parse(r.cambios);
        } else if (typeof r.cambios === 'object') {
          cambiosParsed = r.cambios;
        }
      } catch (e) {
        console.error('[AUDIT SEARCH] Error parsing cambios:', e.message);
        cambiosParsed = { error: 'No se pudo parsear' };
      }
      
      return {
        ...r,
        cambios: cambiosParsed
      };
    });
    
    res.json({
      ok: true,
      total: results.length,
      results: resultsWithParsedChanges
    });
  } catch (e) {
    console.error('[AUDIT SEARCH ERROR]', e);
    res.status(500).json({ error: e.message });
  }
});

// Generar contraseña temporal aleatoria usando crypto seguro
function generarPasswordTemporal() {
  const caracteres = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%';
  const bytes = require('crypto').randomBytes(12);
  let password = '';
  for (let i = 0; i < 12; i++) {
    password += caracteres[bytes[i] % caracteres.length];
  }
  return password;
}

// Reset password de usuario por admin
app.patch('/api/usuarios/:id/reset-password', requireAuth, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  if (id === req.session.usuarioId) {
    return res.status(400).json({ error: 'No puedes resetear tu propia contraseña' });
  }
  
  try {
    // Obtener usuario
    const user = await db.queryOne('SELECT id, usuario, nombre FROM usuarios WHERE id = ?', [id]);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    
    // Generar contraseña temporal
    const passwordTemporal = generarPasswordTemporal();
    const passwordHash = bcrypt.hashSync(passwordTemporal, 10);
    
    // Actualizar contraseña
    await db.execute('UPDATE usuarios SET password_hash = ? WHERE id = ?', [passwordHash, id]);
    
    // Registrar en auditoría
    await auditLog.registrarAuditoria({
      usuarioId: id,
      adminId: req.session.usuarioId,
      adminUsuario: req.session.usuario,
      accion: 'RESET_PASSWORD',
      cambios: { password: { antes: '***', despues: '***' } },
      ip: req.ip
    });
    
    // Emitir evento WebSocket
    if (app.io) {
      emitSocket('usuario:actualizado', { id, passwordReset: true });
    }
    
    res.json({ 
      ok: true, 
      usuario: user.usuario,
      nombre: user.nombre,
      passwordTemporal: passwordTemporal
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// --- Doctor: llamar siguiente / marcar atendido ---
app.post('/api/turnos/llamar-siguiente', requireAuth, requireRole(['superadmin', 'admin', 'doctor', 'admin_recepcion', 'recepcion']), async (req, res) => {
  const { fecha, doctor_id } = req.body || {};
  if (!fecha || !doctor_id) {
    return res.status(400).json({ error: 'fecha y doctor_id son obligatorios' });
  }
  try {
    // Obtener info del doctor incluyendo numero_consultorio
    const doctor = await db.query(`SELECT numero_consultorio FROM usuarios WHERE id = ?`, [doctor_id]);
    const numeroConsultorio = doctor.length > 0 ? doctor[0].numero_consultorio : null;
    
    // Primero verificar si ya hay un paciente EN_ATENCION
    const enAtencion = await db.query(`
      SELECT * FROM turnos 
      WHERE fecha = ? AND doctor_id = ? AND estado = 'EN_ATENCION'
      LIMIT 1
    `, [fecha, doctor_id]);
    
    // Si hay un paciente EN_ATENCION, devolver el mismo con numero_consultorio
    if (enAtencion.length > 0) {
      // Hay paciente EN_ATENCION: enAtencion[0].paciente_nombre);
      const turnoConConsultorio = { ...enAtencion[0], numero_consultorio: numeroConsultorio };
      return res.json({ ok: true, turno: turnoConConsultorio });
    }
    
    // Si no hay EN_ATENCION, buscar el siguiente EN_SALA
    const turnos = await db.query(`
      SELECT * FROM turnos 
      WHERE fecha = ? AND doctor_id = ? AND estado = 'EN_SALA' AND numero_turno IS NOT NULL
      ORDER BY numero_turno ASC LIMIT 1
    `, [fecha, doctor_id]);
    
    // Turnos EN_SALA para doctor ${doctor_id}:`, turnos.length, turnos);
    
    const turno = turnos.length > 0 ? turnos[0] : null;
    if (!turno) {
      return res.status(404).json({ error: 'No hay más pacientes en espera' });
    }

    // Cambiar estado a EN_ATENCION (solo el primero)
    await db.execute(`
      UPDATE turnos 
      SET estado = 'EN_ATENCION'
      WHERE id = ?
    `, [turno.id]);

    const updated = await db.query(`SELECT * FROM turnos WHERE id = ?`, [turno.id]);
    const turnoConConsultorio = { ...updated[0], numero_consultorio: numeroConsultorio };
    
    // Emitir evento de socket para actualizar todos los clientes
    emitSocket('agenda:turno-llamar-siguiente', { 
      turno_id: turno.id, 
      doctor_id, 
      fecha,
      paciente_nombre: turnoConConsultorio.paciente_nombre,
      numero_turno: turnoConConsultorio.numero_turno
    });
    emitSocket('agenda:turno-estado-cambio', { id: turno.id, estado: 'EN_ATENCION' });
    
    res.json({ ok: true, turno: turnoConConsultorio });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Helper para obtener el siguiente número de turno
async function getNextTurnoNumber(fecha, doctor_id) {
  const result = await db.query(`
    SELECT MAX(CAST(numero_turno AS UNSIGNED)) as max_num FROM turnos 
    WHERE fecha = ? AND doctor_id = ? AND numero_turno IS NOT NULL
  `, [fecha, doctor_id]);
  const maxNum = result[0]?.max_num || 0;
  return maxNum + 1;
}

app.post('/api/turnos/marcar-atendido', requireAuth, requireRole(['superadmin', 'admin', 'doctor', 'admin_recepcion', 'recepcion']), async (req, res) => {
  const { turno_id } = req.body || {};
  if (!turno_id) {
    return res.status(400).json({ error: 'turno_id es obligatorio' });
  }
  try {
    const turnos = await db.query(`SELECT * FROM turnos WHERE id = ? AND estado = 'EN_ATENCION'`, [turno_id]);
    const turno = turnos.length > 0 ? turnos[0] : null;
    
    if (!turno) {
      return res.status(404).json({ error: 'No hay turno en atención actualmente' });
    }
    
    // Marcar como ATENDIDO y limpiar el número de turno
    await db.execute('UPDATE turnos SET estado = ?, numero_turno = NULL WHERE id = ?', ['ATENDIDO', turno_id]);
    
    // Reasignar números de turno a los pacientes EN_SALA del mismo doctor ese día
    // Obtener todos los turnos EN_SALA ordenados por numero_turno
    const enSalaList = await db.query(
      `SELECT id FROM turnos WHERE fecha = ? AND doctor_id = ? AND estado = 'EN_SALA' ORDER BY numero_turno ASC, id ASC`,
      [turno.fecha, turno.doctor_id]
    );
    
    // Reasignar números 1, 2, 3, etc.
    for (let i = 0; i < enSalaList.length; i++) {
      const nuevoNumero = i + 1;
      await db.execute('UPDATE turnos SET numero_turno = ? WHERE id = ?', [nuevoNumero, enSalaList[i].id]);
    }
    
    // Emitir eventos de socket para actualizar todos los clientes
    emitSocket('agenda:turno-marcar-atendido', { 
      turno_id, 
      doctor_id: turno.doctor_id,
      fecha: turno.fecha
    });
    emitSocket('agenda:turno-estado-cambio', { id: turno_id, estado: 'ATENDIDO' });
    
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// --- Pacientes ---

// Listar pacientes (con búsqueda opcional)
app.get('/api/pacientes', requireAuth, async (req, res) => {
  const { buscar } = req.query;
  try {
    let pacientes;
    if (buscar) {
      pacientes = await db.query(`
        SELECT * FROM pacientes 
        WHERE nombre LIKE ? OR documento LIKE ?
        ORDER BY nombre ASC
        LIMIT 50
      `, [`%${buscar}%`, `%${buscar}%`]);
    } else {
      pacientes = await db.query('SELECT * FROM pacientes ORDER BY nombre ASC LIMIT 100');
    }
    res.json(pacientes);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Obtener paciente por ID
app.get('/api/pacientes/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  try {
    const rows = await db.query('SELECT * FROM pacientes WHERE id = ?', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Paciente no encontrado' });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Actualizar paciente (nombre, documento, etc.)
app.patch('/api/pacientes/:id', requireAuth, requireRole(['superadmin', 'admin', 'admin_recepcion', 'recepcion', 'admin_electro', 'electro', 'tecnico_electro', 'auxiliar_recepcion']), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  const { nombre, documento, telefono, email } = req.body || {};
  if (!nombre && !documento && !telefono && !email) {
    return res.status(400).json({ error: 'Nada que actualizar' });
  }
  try {
    const pacs = await db.query('SELECT * FROM pacientes WHERE id = ?', [id]);
    const pac = pacs.length > 0 ? pacs[0] : null;
    if (!pac) return res.status(404).json({ error: 'Paciente no encontrado' });
    const updates = [];
    const params = [];
    if (nombre !== undefined) { updates.push('nombre = ?'); params.push(nombre); }
    if (documento !== undefined) { updates.push('documento = ?'); params.push(documento); }
    if (telefono !== undefined) { updates.push('telefono = ?'); params.push(telefono); }
    if (email !== undefined) { updates.push('email = ?'); params.push(email); }
    params.push(id);
    await db.execute(`UPDATE pacientes SET ${updates.join(', ')} WHERE id = ?`, params);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Crear paciente
app.post('/api/pacientes', requireAuth, requireRole(['superadmin', 'admin', 'admin_recepcion', 'recepcion', 'auxiliar_recepcion', 'admin_electro', 'electro']), async (req, res) => {
  const { nombre, documento, telefono, telefono2, email } = req.body || {};
  if (!nombre) {
    return res.status(400).json({ error: 'Nombre es obligatorio' });
  }

  // Validar nombre: solo letras y espacios
  if (!/^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+$/.test(nombre)) {
    return res.status(400).json({ error: 'El nombre no puede contener números o caracteres especiales' });
  }

  // Validar documento si se proporciona: solo números
  if (documento && !/^\d+$/.test(documento)) {
    return res.status(400).json({ error: 'El documento solo puede contener números' });
  }

  // Validar teléfono si se proporciona: exactamente 10 dígitos
  if (telefono && !/^\d{10}$/.test(telefono)) {
    return res.status(400).json({ error: 'El teléfono debe tener exactamente 10 dígitos' });
  }

  // Validar teléfono 2 si se proporciona: exactamente 10 dígitos
  if (telefono2 && !/^\d{10}$/.test(telefono2)) {
    return res.status(400).json({ error: 'El teléfono 2 debe tener exactamente 10 dígitos' });
  }

  try {
    const result = await db.execute(
      'INSERT INTO pacientes (nombre, documento, telefono, telefono2, email) VALUES (?, ?, ?, ?, ?)',
      [nombre, documento || null, telefono || null, telefono2 || null, email || null]
    );
    res.json({ ok: true, id: result.insertId });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// --- Consultorios ---

// Listar consultorios
app.get('/api/consultorios', requireAuth, async (req, res) => {
  try {
    const consultorios = await db.query('SELECT * FROM consultorios WHERE activo = 1 ORDER BY nombre ASC');
    res.json(consultorios);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Listar medicos (usuarios con rol 'doctor')  accesible a recepcion y doctores
app.get('/api/medicos', requireAuth, async (req, res) => {
  try {
    const medicos = await db.query("SELECT id, nombre, usuario, especialidad FROM usuarios WHERE rol = 'doctor' AND activo = 1 ORDER BY nombre ASC");
    res.json(medicos);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Obtener agenda de un doctor
app.get('/api/doctor-agenda', requireAuth, async (req, res) => {
  const doctorId = parseInt(req.query.doctor_id, 10);
  if (!doctorId) return res.status(400).json({ error: 'doctor_id es obligatorio' });
  try {
    const rows = await db.query('SELECT id, doctor_id, fecha, hora_inicio, hora_fin, disponible FROM doctor_agenda WHERE doctor_id = ? ORDER BY fecha ASC, hora_inicio ASC', [doctorId]);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Crear/actualizar agenda de doctor (reemplaza la agenda del doctor)
app.post('/api/doctor-agenda', requireAuth, async (req, res) => {
  const { doctor_id, slots } = req.body || {};
  if (!Array.isArray(slots)) return res.status(400).json({ error: 'slots debe ser un arreglo' });
  // Permitir que el doctor suba su propia agenda o admin
  const actorId = req.session.usuarioId;
  const isAdminUser = isAdminRol(req.session.rol) || isRecepcionRol(req.session.rol);
  const isDoctorUser = req.session.rol === 'doctor';
  const targetDoctorId = parseInt(doctor_id || actorId, 10);
  if (!targetDoctorId) return res.status(400).json({ error: 'doctor_id inválido' });
  if (!isAdminUser && !isDoctorUser) return res.status(403).json({ error: 'Solo médicos o administradores pueden subir agenda' });
  if (isDoctorUser && targetDoctorId !== actorId) return res.status(403).json({ error: 'Médicos solo pueden modificar su propia agenda' });

  try {
    // Eliminar agenda anterior
    await db.execute('DELETE FROM doctor_agenda WHERE doctor_id = ?', [targetDoctorId]);
    
    // Insertar nuevos slots
    for (const s of slots) {
      const fecha = s.fecha;
      const hi = s.hora_inicio;
      const hf = s.hora_fin || null;
      const disp = s.disponible ? 1 : 0;
      await db.execute(
        'INSERT INTO doctor_agenda (doctor_id, fecha, hora_inicio, hora_fin, disponible) VALUES (?, ?, ?, ?, ?)',
        [targetDoctorId, fecha, hi, hf, disp]
      );
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Upload agenda file using multipart/form-data
app.post('/api/doctor-agenda/upload', requireAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se recibió archivo' });
    }
    
    const doctor_id = req.body.doctor_id || req.session.usuarioId;
    const url = `/uploads/${req.file.filename}`;
    
    // Guardar metadatos en la BD
    const result = await db.execute(
      'INSERT INTO doctor_agenda_files (doctor_id, filename, url, uploaded_by) VALUES (?, ?, ?, ?)',
      [doctor_id, req.file.originalname, url, req.session.usuarioId || null]
    );
    
    res.json({ ok: true, id: result.insertId, url });
  } catch (e) { 
    console.error(e); 
    res.status(500).json({ error: e.message }); 
  }
});

app.get('/api/doctor-agenda-files', requireAuth, async (req, res) => {
  const doctorId = parseInt(req.query.doctor_id, 10);
  if (!doctorId) return res.status(400).json({ error: 'doctor_id es obligatorio' });
  try {
    const rows = await db.query('SELECT id, doctor_id, filename, url, uploaded_by, creado_en FROM doctor_agenda_files WHERE doctor_id = ? ORDER BY creado_en DESC', [doctorId]);
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

app.delete('/api/doctor-agenda-files/:id', requireAuth, async (req, res) => {
  const fileId = parseInt(req.params.id, 10);
  if (!fileId) return res.status(400).json({ error: 'id es obligatorio' });
  try {
    // Obtener el archivo para verificar permisos y obtener la URL
    const files = await db.query('SELECT id, doctor_id, url FROM doctor_agenda_files WHERE id = ?', [fileId]);
    const file = files.length > 0 ? files[0] : null;
    if (!file) return res.status(404).json({ error: 'Archivo no encontrado' });
    
    // Verificar que el usuario sea el doctor o admin
    const isDoctorOwner = req.session.rol === 'doctor' && req.session.usuarioId === file.doctor_id;
    const isAdmin = isAdminRol(req.session.rol);
    if (!isDoctorOwner && !isAdmin) return res.status(403).json({ error: 'No tienes permiso para eliminar este archivo' });
    
    // Eliminar archivo del sistema de archivos con protección contra path traversal
    const publicDir = path.resolve(__dirname, 'public');
    const filePath = path.resolve(publicDir, file.url.replace(/^\//, ''));
    if (!filePath.startsWith(publicDir)) {
      return res.status(400).json({ error: 'Ruta de archivo inválida' });
    }
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    
    // Eliminar registro de la BD
    await db.execute('DELETE FROM doctor_agenda_files WHERE id = ?', [fileId]);
    res.json({ ok: true });
  } catch (e) { 
    console.error(e); 
    res.status(500).json({ error: e.message }); 
  }
});

// --- Días bloqueados ---

// Crear tabla si no existe
app.get('/api/init-doctor-disponibilidad', requireAuth, async (req, res) => {
  try {
    const sql = `
      CREATE TABLE IF NOT EXISTS doctor_disponibilidad_mensual (
        id INT AUTO_INCREMENT PRIMARY KEY,
        doctor_id INT NOT NULL,
        fecha DATE NOT NULL,
        pacientes_proinsalud INT DEFAULT 0,
        pacientes_otros INT DEFAULT 0,
        total_pacientes INT DEFAULT 0,
        disponible BOOLEAN DEFAULT TRUE,
        disponible_manana BOOLEAN DEFAULT TRUE,
        disponible_tarde BOOLEAN DEFAULT TRUE,
        creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_doctor_fecha (doctor_id, fecha),
        FOREIGN KEY (doctor_id) REFERENCES usuarios(id) ON DELETE CASCADE,
        INDEX idx_doctor_fecha (doctor_id, fecha),
        INDEX idx_disponible (disponible)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `;
    await db.execute(sql);
    res.json({ ok: true, message: 'Tabla doctor_disponibilidad_mensual creada/verificada' });
  } catch (e) {
    console.error('[DISPONIBILIDAD] Error creando tabla:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Procesar Excel de disponibilidad mensual
app.post('/api/doctor-disponibilidad/procesar-excel', requireAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se recibió archivo' });
    }

    const doctorId = parseInt(req.body.doctor_id || req.session.usuarioId, 10);
    logger.info(`[DISPONIBILIDAD] Procesando Excel para doctor=${doctorId}, archivo=${req.file.originalname}`);
    
    if (!doctorId) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: 'doctor_id inválido' });
    }

    // Permisos: admin o el doctor puede subir su propia disponibilidad
    const isAdmin = isAdminRol(req.session.rol);
    const isDoctor = req.session.rol === 'doctor' && doctorId === req.session.usuarioId;
    if (!isAdmin && !isDoctor) {
      fs.unlink(req.file.path, () => {});
      logger.warn(`[DISPONIBILIDAD] Acceso denegado: rol=${req.session.rol}, usuarioId=${req.session.usuarioId}`);
      return res.status(403).json({ error: 'No tienes permiso para esto' });
    }

    // Procesar el Excel
    const result = await procesarAgendaExcel.procesarAgendaExcel(req.file.path, doctorId, db);
    logger.debug('[DISPONIBILIDAD] Resultado: ' + JSON.stringify(result));

    if (!result.ok) {
      fs.unlink(req.file.path, () => {});
      logger.warn(`[DISPONIBILIDAD] Error en procesamiento: ${result.error}`);
      return res.status(400).json({ error: result.error });
    }

    // Guardar metadatos del archivo en la BD para poder verlo/descargarlo después
    const url = `/uploads/${req.file.filename}`;
    try {
      const fileResult = await db.execute(
        'INSERT INTO doctor_agenda_files (doctor_id, filename, url, uploaded_by) VALUES (?, ?, ?, ?)',
        [doctorId, req.file.originalname, url, req.session.usuarioId || null]
      );
      logger.info(`[DISPONIBILIDAD] Archivo guardado en BD con ID: ${fileResult.insertId}`);
    } catch (dbErr) {
      console.warn(`[DISPONIBILIDAD] Advertencia: error guardando metadatos del archivo:`, dbErr.message);
      // Continuar aunque falle guardar metadatos - el procesamiento fue exitoso
    }

    // NO borrar el archivo del filesystem para que sea visible en la lista

    // Emitir actualización a través de WebSocket
    if (app.io) {
      emitSocket('agenda:disponibilidad-actualizada', { doctor_id: doctorId });
    }

    res.json({ 
      ok: true, 
      diasGuardados: result.diasGuardados,
      errores: result.errores,
      fileUrl: url,
      message: `âœ“ ${result.diasGuardados} días de disponibilidad guardados` 
    });
  } catch (e) {
    console.error('[DISPONIBILIDAD] Error procesando Excel:', e.message, e.stack);
    if (req.file) fs.unlink(req.file.path, () => {});
    res.status(500).json({ error: e.message });
  }
});

// Obtener disponibilidad mensual de un doctor
app.get('/api/doctor-disponibilidad/:doctorId', requireAuth, async (req, res) => {
  try {
    const doctorId = parseInt(req.params.doctorId, 10);
    const mes = req.query.mes; // Formato: YYYY-MM, opcional
    
    if (!doctorId) {
      return res.status(400).json({ error: 'doctorId inválido' });
    }

    const disponibilidad = await procesarAgendaExcel.obtenerDisponibilidadMensual(doctorId, mes, db);
    res.json({ ok: true, disponibilidad });
  } catch (e) {
    console.error('[DISPONIBILIDAD] Error obteniendo disponibilidad:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Validar si un doctor tiene disponibilidad en una fecha
app.post('/api/doctor-disponibilidad/validar', async (req, res) => {
  try {
    const { doctor_id, fecha } = req.body;
    
    if (!doctor_id || !fecha) {
      return res.status(400).json({ error: 'doctor_id y fecha son obligatorios' });
    }

    const resultado = await procesarAgendaExcel.tieneDisponibilidad(doctor_id, fecha, db);
    
    res.json({ 
      ok: true, 
      fecha,
      doctor_id,
      disponible: resultado.disponible,
      totalPacientes: resultado.totalPacientes || null,
      mensaje: !resultado.disponible ? 'PARA ESTE DÍA NO PUEDES AGENDAR, EL DOCTOR NO CUENTA CON DISPONIBILIDAD' : null
    });
  } catch (e) {
    console.error('[DISPONIBILIDAD] Error validando disponibilidad:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Guardar disponibilidad de un día individual (calendario interactivo)
app.post('/api/doctor-disponibilidad/guardar-dia', requireAuth, async (req, res) => {
  try {
    const { doctor_id, fecha, disponible, disponible_manana, disponible_tarde } = req.body || {};
    const doctorId = parseInt(doctor_id || req.session.usuarioId, 10);
    if (!doctorId || !fecha) return res.status(400).json({ error: 'doctor_id y fecha son requeridos' });

    // Permisos
    const isAdminUser = isAdminRol(req.session.rol) || isRecepcionRol(req.session.rol);
    const isDoctorUser = req.session.rol === 'doctor' && doctorId === req.session.usuarioId;
    if (!isAdminUser && !isDoctorUser) return res.status(403).json({ error: 'Sin permiso' });

    // Validar formato de fecha
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return res.status(400).json({ error: 'Formato de fecha inválido' });

    await db.execute(
      `INSERT INTO doctor_disponibilidad_mensual (doctor_id, fecha, disponible, disponible_manana, disponible_tarde)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE disponible = VALUES(disponible), disponible_manana = VALUES(disponible_manana), disponible_tarde = VALUES(disponible_tarde)`,
      [doctorId, fecha, disponible ? 1 : 0, disponible_manana ? 1 : 0, disponible_tarde ? 1 : 0]
    );

    if (app.io) emitSocket('agenda:disponibilidad-actualizada', { doctor_id: doctorId });
    res.json({ ok: true });
  } catch (e) {
    console.error('[DISPONIBILIDAD] Error guardando día:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Guardar slots de un día individual (calendario interactivo)
app.post('/api/doctor-agenda/guardar-dia', requireAuth, async (req, res) => {
  try {
    const { doctor_id, fecha, slots } = req.body || {};
    const doctorId = parseInt(doctor_id || req.session.usuarioId, 10);
    if (!doctorId || !fecha) return res.status(400).json({ error: 'doctor_id y fecha son requeridos' });

    // Permisos
    const isAdminUser = isAdminRol(req.session.rol) || isRecepcionRol(req.session.rol);
    const isDoctorUser = req.session.rol === 'doctor' && doctorId === req.session.usuarioId;
    if (!isAdminUser && !isDoctorUser) return res.status(403).json({ error: 'Sin permiso' });

    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return res.status(400).json({ error: 'Formato de fecha inválido' });

    // Delete existing slots for this day
    await db.execute('DELETE FROM doctor_agenda WHERE doctor_id = ? AND fecha = ?', [doctorId, fecha]);

    // Insert new slots
    if (Array.isArray(slots)) {
      for (const s of slots) {
        if (!s.hora_inicio || !s.hora_fin) continue;
        // Validate time format
        if (!/^\d{2}:\d{2}$/.test(s.hora_inicio) || !/^\d{2}:\d{2}$/.test(s.hora_fin)) continue;
        await db.execute(
          'INSERT INTO doctor_agenda (doctor_id, fecha, hora_inicio, hora_fin, disponible) VALUES (?, ?, ?, ?, ?)',
          [doctorId, fecha, s.hora_inicio, s.hora_fin, s.disponible ? 1 : 0]
        );
      }
    }

    if (app.io) emitSocket('agenda:disponibilidad-actualizada', { doctor_id: doctorId });
    res.json({ ok: true });
  } catch (e) {
    console.error('[AGENDA] Error guardando slots del día:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Eliminar disponibilidad de un día individual
app.post('/api/doctor-disponibilidad/eliminar-dia', requireAuth, async (req, res) => {
  try {
    const { doctor_id, fecha } = req.body || {};
    const doctorId = parseInt(doctor_id || req.session.usuarioId, 10);
    if (!doctorId || !fecha) return res.status(400).json({ error: 'doctor_id y fecha son requeridos' });

    const isAdminUser = isAdminRol(req.session.rol) || isRecepcionRol(req.session.rol);
    const isDoctorUser = req.session.rol === 'doctor' && doctorId === req.session.usuarioId;
    if (!isAdminUser && !isDoctorUser) return res.status(403).json({ error: 'Sin permiso' });

    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return res.status(400).json({ error: 'Formato de fecha inválido' });

    await db.execute('DELETE FROM doctor_disponibilidad_mensual WHERE doctor_id = ? AND fecha = ?', [doctorId, fecha]);
    await db.execute('DELETE FROM doctor_agenda WHERE doctor_id = ? AND fecha = ?', [doctorId, fecha]);

    if (app.io) emitSocket('agenda:disponibilidad-actualizada', { doctor_id: doctorId });
    res.json({ ok: true });
  } catch (e) {
    console.error('[DISPONIBILIDAD] Error eliminando día:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Limpiar disponibilidad de un doctor
app.delete('/api/doctor-disponibilidad/:doctorId', requireAuth, async (req, res) => {
  try {
    const doctorId = parseInt(req.params.doctorId, 10);
    
    if (!doctorId) {
      return res.status(400).json({ error: 'doctorId inválido' });
    }

    // Permisos: admin o el doctor
    const isAdmin = req.session.rol === 'admin';
    const isDoctor = req.session.rol === 'doctor' && doctorId === req.session.usuarioId;
    if (!isAdmin && !isDoctor) {
      return res.status(403).json({ error: 'No tienes permiso para esto' });
    }

    const result = await procesarAgendaExcel.limpiarDisponibilidad(doctorId, db);
    
    if (result.ok) {
      // Emitir actualización a través de WebSocket
      if (app.io) {
        emitSocket('agenda:disponibilidad-actualizada', { doctor_id: doctorId });
      }
    }

    res.json(result);
  } catch (e) {
    console.error('[DISPONIBILIDAD] Error limpiando disponibilidad:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Rutas heredadas para compatibilidad (redirigen a las nuevas)
app.post('/api/doctor-dias-bloqueados/procesar-excel', requireAuth, upload.single('file'), async (req, res) => {
  // Redirige a la nueva ruta
  req.url = '/api/doctor-disponibilidad/procesar-excel';
  return app._router.handle(req, res);
});

app.get('/api/doctor-dias-bloqueados/:doctorId', async (req, res) => {
  try {
    const doctorId = parseInt(req.params.doctorId, 10);
    const disp = await procesarAgendaExcel.obtenerDiasBloqueados(doctorId, db);
    res.json({ ok: true, dias: disp });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/doctor-dias-bloqueados/validar', async (req, res) => {
  try {
    const { doctor_id, fecha } = req.body;
    const esta_bloqueada = await procesarAgendaExcel.estaFechaBloqueada(doctor_id, fecha, db);
    res.json({ 
      ok: true, 
      fecha,
      doctor_id,
      bloqueada: esta_bloqueada,
      mensaje: esta_bloqueada ? 'PARA ESTE DÍA NO PUEDES AGENDAR, EL DOCTOR NO CUENTA CON DISPONIBILIDAD' : null
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/doctor-dias-bloqueados/:doctorId', requireAuth, async (req, res) => {
  const doctorId = parseInt(req.params.doctorId, 10);
  const isAdmin = isAdminRol(req.session.rol);
  const isDoctor = req.session.rol === 'doctor' && doctorId === req.session.usuarioId;
  if (!isAdmin && !isDoctor) {
    return res.status(403).json({ error: 'No tienes permiso' });
  }
  const result = await procesarAgendaExcel.limpiarDisponibilidad(doctorId, db);
  res.json(result);
});

// --- Turnos (agenda médica) ---

// Listar turnos por fecha y consultorio
app.get('/api/turnos', requireAuth, async (req, res) => {
  const { fecha, doctor_id, buscar } = req.query;
  
  // Si está buscando por documento de paciente
  if (buscar && !fecha) {
    try {
      const turnos = await db.query(`
        SELECT * FROM turnos
        WHERE paciente_documento LIKE ? OR paciente_nombre LIKE ?
        ORDER BY fecha ASC, hora ASC
        LIMIT 50
      `, [`%${buscar}%`, `%${buscar}%`]);
      return res.json(turnos);
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: e.message });
    }
  }
  
  // Si falta fecha (requerida para búsqueda por fecha)
  if (!fecha && !buscar) {
    return res.status(400).json({ error: 'fecha es obligatoria' });
  }

  try {
    const query = doctor_id 
      ? `SELECT * FROM turnos 
         WHERE fecha = ? AND doctor_id = ?
         ORDER BY CASE WHEN hora IS NULL OR hora = '' THEN 1 ELSE 0 END,
                  hora ASC,
                  numero_turno ASC,
                  id ASC`
      : `SELECT * FROM turnos 
         WHERE fecha = ?
         ORDER BY CASE WHEN hora IS NULL OR hora = '' THEN 1 ELSE 0 END,
                  hora ASC,
                  numero_turno ASC,
                  id ASC`;
    
    const params = doctor_id ? [fecha, doctor_id] : [fecha];
    const turnos = await db.query(query, params);
    res.json(turnos);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Export CSV de turnos por fecha
app.get('/api/turnos/export', requireAuth, async (req, res) => {
  const { fecha, doctor_id } = req.query;
  if (!fecha) return res.status(400).json({ error: 'fecha es obligatoria' });
  try {
    const params = doctor_id ? [fecha, doctor_id] : [fecha];
    const whereClause = doctor_id
      ? 'WHERE fecha = ? AND doctor_id = ?'
      : 'WHERE fecha = ?';
    const rows = await db.query(
      `SELECT numero_turno, paciente_nombre, paciente_documento, paciente_telefono,
              estado, hora, tipo_consulta, entidad, notas, fecha
       FROM turnos ${whereClause}
       ORDER BY hora ASC, numero_turno ASC`,
      params
    );
    const headers = ['NÂ° Turno','Paciente','Documento','Teléfono','Estado',
                     'Hora','Tipo Consulta','Entidad','Notas','Fecha'];
    const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [
      headers.join(','),
      ...rows.map(r => [
        r.numero_turno, r.paciente_nombre, r.paciente_documento, r.paciente_telefono,
        r.estado, r.hora, r.tipo_consulta, r.entidad, r.notas, r.fecha
      ].map(escape).join(','))
    ];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="turnos-${fecha}.csv"`);
    res.send('\uFEFF' + lines.join('\r\n'));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Obtener disponibilidad de doctor para una fecha específica
app.get('/api/doctor-disponibilidad', async (req, res) => {
  const { doctor_id, fecha } = req.query;
  
  if (!doctor_id || !fecha) {
    return res.status(400).json({ ok: false, error: 'doctor_id y fecha son obligatorios' });
  }

  try {
    // Consultar intervalos no disponibles
    const {intervalos, existe_registro: tiene_intervalos} = await procesarAgendaExcel.consultarIntervalosNoDisponibles(doctor_id, fecha, db);

    if (tiene_intervalos) {
      // Si hay intervalos, retornar esos
      return res.json({
        ok: true,
        tiene_intervalos: true,
        intervalos: intervalos,
        disponible_manana: true,  // Por defecto disponible (los intervalos definen qué NO está disponible)
        disponible_tarde: true
      });
    }

    // Si no hay intervalos, usar el sistema antiguo de disponible_manana/tarde
    const result = await db.execute(
      `SELECT disponible_manana, disponible_tarde FROM doctor_disponibilidad_mensual
       WHERE doctor_id = ? AND fecha = ?`,
      [doctor_id, fecha]
    );

    if (result.length === 0) {
      return res.json({ 
        ok: true, 
        tiene_intervalos: false,
        intervalos: [],
        disponible_manana: true, 
        disponible_tarde: true,
        razon: 'sin_restricciones' 
      });
    }

    const registro = result[0];
    return res.json({
      ok: true,
      tiene_intervalos: false,
      intervalos: [],
      disponible_manana: Boolean(registro.disponible_manana),
      disponible_tarde: Boolean(registro.disponible_tarde)
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Crear turno
app.post('/api/turnos', requireAuth, requireRole(['superadmin', 'admin', 'admin_recepcion', 'recepcion', 'auxiliar_recepcion']), async (req, res) => {
  const { doctor_id, paciente_nombre, paciente_documento, paciente_telefono, paciente_telefono2, fecha, hora, tipo_consulta, entidad, notas, oportunidad, programado_por } = req.body || {};

  if (!doctor_id || !paciente_nombre || !fecha || !hora) {
    return res.status(400).json({ error: 'doctor_id, paciente_nombre, fecha y hora son obligatorios' });
  }

  try {

    
    // Validar disponibilidad del doctor en esa fecha y hora específica
    const validacion = await procesarAgendaExcel.validarDisponibilidadPorHora(doctor_id, fecha, hora, db);

    
    if (!validacion.valido) {

      return res.status(400).json({ 
        error: validacion.razon,
        valido: false
      });
    }
    
    // Crear turno como PENDIENTE sin número (numero_turno NULL)
    const result = await db.execute(`
      INSERT INTO turnos (numero_turno, doctor_id, paciente_nombre, paciente_documento, paciente_telefono, paciente_telefono2, estado, fecha, hora, tipo_consulta, entidad, notas, oportunidad, programado_por)
      VALUES (NULL, ?, ?, ?, ?, ?, 'PENDIENTE', ?, ?, ?, ?, ?, ?, ?)
    `, [
      doctor_id,
      paciente_nombre,
      paciente_documento || null,
      paciente_telefono || null,
      paciente_telefono2 || null,
      fecha,
      hora,
      tipo_consulta || null,
      entidad || null,
      notas || null,
      oportunidad ? parseInt(oportunidad, 10) : null,
      programado_por || null
    ]);



    // Emitir evento WebSocket
    if (app.io) {
      emitSocket('agenda:turno-creado', { id: result.insertId, doctor_id, paciente_nombre, fecha });
    }

    res.json({ ok: true, id: result.insertId });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Cambiar estado de un turno
// Actualizar turno (campo genérico)
app.patch('/api/turnos/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { paciente_nombre, paciente_telefono, tipo_consulta, fecha, hora, estado, observaciones } = req.body || {};

  if (!id) {
    return res.status(400).json({ error: 'ID inválido' });
  }

  try {
    const turnos = await db.query('SELECT * FROM turnos WHERE id = ?', [id]);
    const turno = turnos.length > 0 ? turnos[0] : null;
    if (!turno) {
      return res.status(404).json({ error: 'Turno no encontrado' });
    }

    // Si ya está ATENDIDO, verificar restrictions según rol
    const userRole = req.session?.rol;
    if (turno.estado === 'ATENDIDO' && userRole === 'recepcion') {
      return res.status(400).json({ error: 'No se puede modificar un turno ya atendido' });
    }

    // Construir query dinámicamente según qué campos se envíen
    const updates = [];
    const values = [];

    if (paciente_nombre !== undefined) {
      updates.push('paciente_nombre = ?');
      values.push(paciente_nombre);
    }
    if (paciente_telefono !== undefined) {
      updates.push('paciente_telefono = ?');
      values.push(paciente_telefono);
    }
    if (tipo_consulta !== undefined) {
      updates.push('tipo_consulta = ?');
      values.push(tipo_consulta);
    }
    if (fecha !== undefined) {
      updates.push('fecha = ?');
      values.push(fecha);
    }
    if (hora !== undefined) {
      updates.push('hora = ?');
      values.push(hora);
    }
    if (estado !== undefined) {
      updates.push('estado = ?');
      values.push(estado);
    }
    if (observaciones !== undefined) {
      updates.push('observaciones = ?');
      values.push(observaciones);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No hay campos para actualizar' });
    }

    values.push(id);
    const query = `UPDATE turnos SET ${updates.join(', ')} WHERE id = ?`;

    await db.execute(query, values);

    // Emitir eventos de socket
    if (app.io) {
      if (paciente_nombre !== undefined || paciente_telefono !== undefined || tipo_consulta !== undefined) {
        emitSocket('agenda:turno-cambio-paciente', {
          id,
          paciente_nombre: paciente_nombre || turno.paciente_nombre,
          doctor_id: turno.doctor_id,
          fecha: turno.fecha
        });
      }
      if (fecha !== undefined || hora !== undefined || estado !== undefined) {
        emitSocket('agenda:turno-estado-cambio', {
          id,
          estado: estado || turno.estado,
          doctor_id: turno.doctor_id,
          fecha: fecha || turno.fecha
        });
      }
    }

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Actualizar estado del turno específicamente
app.patch('/api/turnos/:id/estado', requireAuth, requireRole(['superadmin', 'admin', 'admin_recepcion', 'recepcion', 'doctor', 'auxiliar_recepcion']), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { estado } = req.body || {};
  if (!id || !estado) {
    return res.status(400).json({ error: 'id y estado son obligatorios' });
  }

  try {
    const turnos = await db.query('SELECT * FROM turnos WHERE id = ?', [id]);
    const turno = turnos.length > 0 ? turnos[0] : null;
    if (!turno) {
      return res.status(404).json({ error: 'Turno no encontrado' });
    }

    // Si ya está ATENDIDO, no permitir cambios posteriores
    if (turno.estado === 'ATENDIDO' && estado !== 'ATENDIDO') {
      return res.status(400).json({ error: 'No se puede modificar un turno ya atendido' });
    }

    // Si cambia a EN_SALA y no tiene número de turno, asignar automáticamente
    let numeroAsignado = null;
    if (estado === 'EN_SALA' && !turno.numero_turno) {
      // Obtener el siguiente número disponible
      const result = await db.query(`
        SELECT MAX(CAST(numero_turno AS UNSIGNED)) as max_num FROM turnos 
        WHERE fecha = ? AND doctor_id = ? AND numero_turno IS NOT NULL
      `, [turno.fecha, turno.doctor_id]);
      
      const maxNum = result[0]?.max_num || 0;
      numeroAsignado = maxNum + 1;
      
      // Actualizar estado y número de turno
      await db.execute('UPDATE turnos SET estado = ?, numero_turno = ? WHERE id = ?', [estado, numeroAsignado, id]);
    } else {
      // Solo actualizar estado
      await db.execute('UPDATE turnos SET estado = ? WHERE id = ?', [estado, id]);
    }

    // Emitir evento WebSocket
    if (app.io) {
      emitSocket('agenda:turno-estado-cambio', { id, estado, paciente_nombre: turno.paciente_nombre || null });
      if (numeroAsignado) {
        emitSocket('agenda:turno-numero-cambio', { 
          id, 
          numero_turno: numeroAsignado,
          doctor_id: turno.doctor_id,
          fecha: turno.fecha
        });
      }
    }

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Aviso al doctor para concluir consulta (emite socket, sin cambios en BD)
app.post('/api/turnos/aviso-concluir', requireAuth,
  requireRole(['superadmin', 'admin', 'admin_recepcion', 'recepcion', 'auxiliar_recepcion', 'admin_electro', 'electro', 'tecnico_electro']),
  (req, res) => {
    const { doctor_id } = req.body || {};
    emitSocket('agenda:aviso-concluir-consulta', { doctor_id: doctor_id || null });
    res.json({ ok: true });
  }
);

// Eliminar turno
app.delete('/api/turnos/:id', requireAuth, requireRole(['superadmin', 'admin', 'admin_recepcion', 'recepcion']), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) {
    return res.status(400).json({ error: 'ID inválido' });
  }

  try {
    const turnos = await db.query('SELECT * FROM turnos WHERE id = ?', [id]);
    const turno = turnos.length > 0 ? turnos[0] : null;
    if (!turno) {
      return res.status(404).json({ error: 'Turno no encontrado' });
    }

    // Los admins y recepcion pueden eliminar, pero verificar restricciones para recepcion
    const userRole = req.session?.rol;
    
    // Si es recepcion básica, aplicar restricciones completas
    if (userRole === 'recepcion') {
      // No permitir eliminar un turno que está EN_ATENCION o ATENDIDO
      if (turno.estado === 'EN_ATENCION' || turno.estado === 'ATENDIDO') {
        return res.status(400).json({ error: 'No se puede eliminar un turno en atención o ya atendido' });
      }

      // No permitir eliminar si hay un turno EN_ATENCION en la misma fecha/doctor
      const enAtencion = await db.query(
        'SELECT * FROM turnos WHERE doctor_id = ? AND fecha = ? AND estado = ? AND id != ?',
        [turno.doctor_id, turno.fecha, 'EN_ATENCION', id]
      );
      if (enAtencion.length > 0) {
        return res.status(400).json({ error: 'No se pueden eliminar citas mientras hay un paciente en atención' });
      }
    } else if (userRole === 'admin_recepcion') {
      // Admin recepción: solo bloquear si ya fue ATENDIDO (completado)
      if (turno.estado === 'ATENDIDO') {
        return res.status(400).json({ error: 'No se puede eliminar un turno ya atendido' });
      }
    }
    // admin/superadmin: sin restricciones

    const result = await db.execute('DELETE FROM turnos WHERE id = ?', [id]);
    
    // Emitir evento de socket para actualizar todos los clientes
    if (app.io) {
      emitSocket('agenda:turno-eliminado', { id, doctor_id: turno.doctor_id, fecha: turno.fecha });
    }
    
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Reordenar número de turno (mover arriba/abajo en la cola)
// Obtener siguiente número de turno disponible
app.get('/api/turnos/get-next-number', requireAuth, async (req, res) => {
  const { fecha, doctor_id } = req.query;
  if (!fecha || !doctor_id) {
    return res.status(400).json({ error: 'fecha y doctor_id son obligatorios' });
  }
  try {
    const result = await db.query(`
      SELECT MAX(CAST(numero_turno AS UNSIGNED)) as max_num FROM turnos 
      WHERE fecha = ? AND doctor_id = ? AND numero_turno IS NOT NULL
    `, [fecha, doctor_id]);
    
    const maxNum = result[0]?.max_num || 0;
    res.json({ numero: maxNum + 1 });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/turnos/:id/numero', requireAuth, requireRole(['superadmin', 'admin', 'admin_recepcion', 'recepcion']), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { numero, delta } = req.body || {};
  
  // Debe enviar BIEN numero O delta, no ambos
  if (!id || (!numero && typeof delta !== 'number')) {
    return res.status(400).json({ error: 'Debe enviar numero o delta' });
  }

  try {
    const turnos = await db.query('SELECT * FROM turnos WHERE id = ?', [id]);
    const turno = turnos.length > 0 ? turnos[0] : null;
    if (!turno) {
      return res.status(404).json({ error: 'Turno no encontrado' });
    }
    
    // CASO 1: Asignar número específico (cuando pasa a EN_SALA)
    if (typeof numero === 'number') {
      if (numero <= 0) {
        return res.status(400).json({ error: 'Número debe ser mayor a 0' });
      }
      await db.execute('UPDATE turnos SET numero_turno = ? WHERE id = ?', [numero, id]);
      
      // Emitir evento de socket para actualizar todos los clientes
      if (app.io) {
        emitSocket('agenda:turno-numero-cambio', { 
          id,
          numero_turno: numero,
          doctor_id: turno.doctor_id,
          fecha: turno.fecha
        });
      }
      
      return res.json({ ok: true });
    }

    // CASO 2: Cambiar prioridad con delta (flechas arriba/abajo)
    if (typeof delta === 'number') {
      if ([-1, 1].indexOf(delta) === -1) {
        return res.status(400).json({ error: 'delta debe ser -1 o 1' });
      }

      // No reordenar si ya está ATENDIDO o EN_ATENCION
      if (turno.estado === 'ATENDIDO' || turno.estado === 'EN_ATENCION') {
        return res.status(400).json({ error: 'No se puede reordenar un turno en atención o ya atendido' });
      }

      // Si no tiene número de turno, no puede cambiar prioridad
      if (!turno.numero_turno) {
        return res.status(400).json({ error: 'El turno no tiene número asignado aún' });
      }

      const nuevoNumero = turno.numero_turno + delta;

      // Si intenta subir el primero o bajar el último, denegar
      if (nuevoNumero <= 0) {
        return res.status(400).json({ error: 'No se puede subir más la prioridad' });
      }

      // Buscar si existe un turno con el nuevo número
      const turnoIntercambio = await db.query(
        `SELECT * FROM turnos WHERE numero_turno = ? AND fecha = ? AND doctor_id = ? AND estado IN ('EN_SALA', 'PENDIENTE')`,
        [nuevoNumero, turno.fecha, turno.doctor_id]
      );

      if (turnoIntercambio.length === 0) {
        return res.status(400).json({ error: 'No hay turno para intercambiar' });
      }

      // Intercambiar números: usar número temporal para evitar conflictos
      await db.execute('UPDATE turnos SET numero_turno = -1 WHERE id = ?', [id]);
      await db.execute('UPDATE turnos SET numero_turno = ? WHERE id = ?', [turno.numero_turno, turnoIntercambio[0].id]);
      await db.execute('UPDATE turnos SET numero_turno = ? WHERE id = ?', [nuevoNumero, id]);

      // Emitir evento de socket para actualizar todos los clientes
      if (app.io) {
        emitSocket('agenda:turno-numero-cambio', { 
          id, 
          numero_turno: nuevoNumero,
          doctor_id: turno.doctor_id,
          fecha: turno.fecha 
        });
      }

      return res.json({ ok: true });
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// --- Agenda electrodiagnóstico ---

// Listar equipos de electrodiagnóstico
app.get('/api/equipos-electro', async (req, res) => {
  try {
    const equipos = await db.query('SELECT * FROM equipos_electro WHERE activo = 1 ORDER BY nombre ASC');
    
    // Obtener equipos que están actualmente "En Estudio"
    const equiposEnUso = await db.query(`
      SELECT DISTINCT equipo_id FROM citas_electro WHERE estado = 'En Estudio' AND equipo_id IS NOT NULL AND deleted_at IS NULL
    `);
    
    const equiposEnUsoIds = equiposEnUso.map(e => e.equipo_id);
    
    // Agregar flag "en_uso" a cada equipo y deduplicar por id (por si hay filas repetidas en DB)
    const vistosIds = new Set();
    const equiposConEstado = equipos
      .filter(e => { if (vistosIds.has(e.id)) return false; vistosIds.add(e.id); return true; })
      .map(e => ({
        ...e,
        en_uso: equiposEnUsoIds.map(String).includes(String(e.id))
      }));
    
    res.json(equiposConEstado);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Obtener disponibilidad de CUPOS para una fecha y hora específica
// Obtener duración de un estudio específico
app.get('/api/estudios/duracion', async (req, res) => {
  try {
    const { nombre } = req.query;
    
    if (!nombre) {
      return res.status(400).json({ error: 'nombre del estudio es obligatorio' });
    }

    const estudios = await db.query(
      'SELECT duracion_minutos, duracion_min, duracion_max FROM estudio_duraciones WHERE nombre = ?',
      [nombre]
    );
    
    if (!estudios || estudios.length === 0) {
      return res.status(404).json({ error: 'Estudio no encontrado' });
    }
    
    const est = estudios[0];
    res.json({
      ok: true,
      duracion_minutos: est.duracion_minutos,
      duracion_min: est.duracion_min,
      duracion_max: est.duracion_max,
      esVariable: est.duracion_min !== null && est.duracion_max !== null
    });
  } catch (e) {
    console.error('Error obteniendo duración:', e);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.get('/api/equipos-electro/disponibilidad', async (req, res) => {
  try {
    const { fecha, hora, estudio, duracion_manual } = req.query;
    
    if (!fecha || !hora) {
      return res.status(400).json({ error: 'fecha y hora son obligatorios' });
    }

    // Validar formato
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return res.status(400).json({ error: 'Fecha inválida (YYYY-MM-DD)' });
    }
    if (!/^\d{2}:\d{2}(:\d{2})?$/.test(hora)) {
      return res.status(400).json({ error: 'Hora inválida (HH:MM)' });
    }

    // Obtener duración del estudio
    let duracionMinutos = 30; // default
    
    if (estudio) {
      const estudios = await db.query(
        'SELECT duracion_minutos, duracion_min, duracion_max FROM estudio_duraciones WHERE nombre = ?',
        [estudio]
      );
      
      if (estudios && estudios.length > 0) {
        const est = estudios[0];
        // Si es Estudio4 (duracion_min/max), usar duracion_manual si está provided
        if (est.duracion_min && est.duracion_max) {
          duracionMinutos = duracion_manual ? parseInt(duracion_manual, 10) : est.duracion_min;
        } else {
          duracionMinutos = est.duracion_minutos || 30;
        }
      }
    }

    // Calcular hora_fin y fecha_fin usando la fecha real (soporta durations multi-día)
    const [hh, mm] = hora.split(':').map(x => parseInt(x, 10));
    const startDate = new Date(`${fecha}T${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}:00`);
    startDate.setMinutes(startDate.getMinutes() + duracionMinutos);
    const horaFin = `${String(startDate.getHours()).padStart(2, '0')}:${String(startDate.getMinutes()).padStart(2, '0')}`;
    const fechaFin = startDate.toISOString().slice(0, 10);

    // CRÍTICO: Contar CUPOS OCUPADOS en este rango horario
    // Los cupos se RESERVAN al agendar (Programado), se OCUPAN EN USO (En Estudio)
    // Cuando se completa el estudio (Completado), se LIBERA el cupo
    // NO ocupan cupo: No Asistió, Cancelado
    // Convertir a DATETIME para comparación correcta incluso con cambio de día
    const citasOcupadas = await db.query(`
      SELECT 
        c.id, c.paciente_id, c.fecha, c.hora_agendamiento, c.hora_inicio, c.hora_fin, c.hora_fin_date, 
        c.estudio, c.estado, c.equipo_id,
        e.nombre AS equipo_nombre
      FROM citas_electro c
      LEFT JOIN equipos_electro e ON e.id = c.equipo_id
      WHERE c.estado IN ('Programado', 'En Sala', 'En Estudio', 'Pausado')
      AND c.deleted_at IS NULL
      AND CONCAT(COALESCE(c.hora_fin_date, c.fecha), ' ', c.hora_fin) >= CONCAT(?, ' ', ?)
      AND CONCAT(c.fecha, ' ', c.hora_agendamiento) <= CONCAT(?, ' ', ?)
      ORDER BY c.fecha, c.hora_agendamiento
    `, [fecha, hora, fechaFin, horaFin]);

    const cuposOcupados = citasOcupadas && citasOcupadas.length > 0 ? citasOcupadas.length : 0;
    const cuposaDisponibles = 4 - cuposOcupados;
    const hayDisponibilidad = cuposaDisponibles > 0;

    // Extraer EQUIPOS específicos que están siendo usados
    const equiposEnUso = citasOcupadas
      .filter(cita => cita.equipo_id) // Solo las que tienen equipo asignado
      .map(cita => ({
        equipo_id: String(cita.equipo_id),
        equipo_nombre: cita.equipo_nombre || `Equipo ${cita.equipo_id}`
      }))
      .filter((equipo, index, self) => 
        index === self.findIndex(e => String(e.equipo_id) === String(equipo.equipo_id))
      ); // Eliminar duplicados (usar String para evitar type mismatch)

    // Obtener detalles de las citas que solapan
    const citasEnRango = (citasOcupadas || []).map(cita => {
      const fechaFin = cita.hora_fin_date || cita.fecha;
      
      // Convertir DATE a string YYYY-MM-DD si es necesario
      const convertirFecha = (fecha) => {
        if (typeof fecha === 'string') return fecha;
        if (fecha instanceof Date) return fecha.toISOString().slice(0, 10);
        return String(fecha);
      };
      
      // Convertir TIME a string HH:MM:SS si es necesario
      const convertirHora = (hora) => {
        if (typeof hora === 'string') return hora;
        return String(hora);
      };
      
      return {
        id: cita.id,
        estudio: cita.estudio,
        fechaInicio: convertirFecha(cita.fecha),
        horaInicio: convertirHora(cita.hora_agendamiento),
        horaInicioReal: cita.hora_inicio ? convertirHora(cita.hora_inicio) : null,
        fechaFin: convertirFecha(fechaFin),
        horaFin: convertirHora(cita.hora_fin),
        estado: cita.estado,
        equipo_id: cita.equipo_id,
        equipo_nombre: cita.equipo_nombre,
        hora: `${convertirHora(cita.hora_agendamiento)}-${convertirHora(cita.hora_fin)}`
      };
    });

    // Calcular próximo momento con disponibilidad (si está al máximo)
    let proximaDisponibilidad = null;
    if (!hayDisponibilidad && citasOcupadas.length > 0) {
      // Encontrar la cita que termina más tarde, considerando hora_fin_date
      let maxFechaHoraFin = null;
      citasOcupadas.forEach(cita => {
        const convertirFecha = (f) => {
          if (typeof f === 'string') return f;
          if (f instanceof Date) return f.toISOString().slice(0, 10);
          return String(f);
        };
        const fechaFinCita = convertirFecha(cita.hora_fin_date || cita.fecha);
        const horaFinCita = typeof cita.hora_fin === 'string' ? cita.hora_fin : String(cita.hora_fin);
        const datetimeFin = `${fechaFinCita} ${horaFinCita}`;
        if (!maxFechaHoraFin || datetimeFin > maxFechaHoraFin) {
          maxFechaHoraFin = datetimeFin;
        }
      });
      if (maxFechaHoraFin) {
        const [fechaMax, horaMax] = maxFechaHoraFin.split(' ');
        proximaDisponibilidad = fechaMax !== fecha ? `${fechaMax} ${horaMax}` : horaMax;
      }
    }

    res.json({
      fecha,
      hora,
      horaFin,
      duracionMinutos,
      estudio: estudio || 'Sin especificar',
      capacidad: {
        maxCupos: 4,
        cuposOcupados,
        cuposaDisponibles,
        hayDisponibilidad,
        equiposEnUso: equiposEnUso // Agregar equipos específicos en uso
      },
      citasEnRango,
      proximaDisponibilidad,
      mensaje: !hayDisponibilidad 
        ? `âš ï¸ Sin capacidad. ${cuposOcupados}/4 cupos ocupados (${equiposEnUso.map(e => e.equipo_nombre).join(', ')}). Próxima disponibilidad: ${proximaDisponibilidad}`
        : `Disponibilidad: ${cuposaDisponibles}/${4} cupos libres${equiposEnUso.length > 0 ? ` (En uso: ${equiposEnUso.map(e => e.equipo_nombre).join(', ')})` : ''}`
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Diagnósticos ---

// Listar todos los diagnósticos activos
app.get('/api/diagnosticos', requireAuth, async (req, res) => {
  try {
    const diagnosticos = await db.query(`
      SELECT id, nombre, descripcion, codigo 
      FROM diagnosticos 
      WHERE activo = 1 
      ORDER BY nombre ASC
    `);
    res.json(diagnosticos);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Buscar diagnósticos por término (autocompletado)
app.get('/api/diagnosticos/search', requireAuth, async (req, res) => {
  const { q } = req.query;
  if (!q || q.trim().length < 2) {
    // Si la búsqueda es muy corta, devolver los primeros 10 diagnósticos
    try {
      const diagnosticos = await db.query(`
        SELECT id, nombre, descripcion, codigo 
        FROM diagnosticos 
        WHERE activo = 1 
        ORDER BY nombre ASC 
        LIMIT 10
      `);
      return res.json(diagnosticos);
    } catch (e) {
      console.error('Error en búsqueda:', e);
      return res.status(500).json({ error: e.message });
    }
  }

  try {
    const searchTerm = `%${q}%`;
    const diagnosticos = await db.query(`
      SELECT id, nombre, descripcion, codigo 
      FROM diagnosticos 
      WHERE activo = 1 AND (nombre LIKE ? OR descripcion LIKE ? OR codigo LIKE ?)
      ORDER BY nombre ASC
      LIMIT 20
    `, [searchTerm, searchTerm, searchTerm]);
    res.json(diagnosticos);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Crear nuevo diagnóstico (solo admin)
app.post('/api/diagnosticos', requireAuth, requireAdmin, async (req, res) => {
  const { nombre, descripcion, codigo } = req.body || {};
  
  if (!nombre || nombre.trim().length === 0) {
    return res.status(400).json({ error: 'El nombre del diagnóstico es obligatorio' });
  }

  try {
    const result = await db.execute(`
      INSERT INTO diagnosticos (nombre, descripcion, codigo, activo)
      VALUES (?, ?, ?, 1)
    `, [nombre.trim(), descripcion || null, codigo || null]);
    res.json({ ok: true, id: result.insertId, nombre });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'El diagnóstico ya existe' });
    }
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Actualizar diagnóstico
app.put('/api/diagnosticos/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { nombre, descripcion, codigo, activo } = req.body || {};

  if (!id) {
    return res.status(400).json({ error: 'ID inválido' });
  }

  try {
    await db.execute(`
      UPDATE diagnosticos 
      SET nombre = ?, descripcion = ?, codigo = ?, activo = ?
      WHERE id = ?
    `, [nombre || null, descripcion || null, codigo || null, activo !== undefined ? activo : 1, id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Importar diagnósticos desde archivo Excel
app.post('/api/diagnosticos/import-excel', requireAuth, requireAdmin, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Debes seleccionar un archivo' });
  }

  try {
    const XLSX = require('xlsx');
    const filePath = req.file.path;
    
    // Leer el archivo Excel
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);
    
    // Eliminar archivo temporal
    const fs = require('fs');
    fs.unlinkSync(filePath);
    
    if (!data || data.length === 0) {
      return res.status(400).json({ error: 'El archivo Excel está vacío' });
    }
    
    // Procesar diagnósticos
    let insertados = 0;
    let actualizados = 0;
    let errores = 0;
    
    for (const row of data) {
      try {
        // Buscar las columnas (pueden tener espacios o mayúsculas diferentes)
        let codigo = null, nombre = null;
        
        for (const key of Object.keys(row)) {
          const keyLower = key.toLowerCase().trim();
          if (keyLower.includes('código') || keyLower.includes('codigo')) {
            codigo = row[key] ? String(row[key]).trim() : null;
          }
          if (keyLower.includes('diagnóstico') || keyLower.includes('diagnostico') || keyLower.includes('nombre')) {
            nombre = row[key] ? String(row[key]).trim() : null;
          }
        }
        
        if (!nombre) {
          errores++;
          continue;
        }
        
        // Intentar insertar o actualizar
        const result = await db.execute(`
          INSERT INTO diagnosticos (nombre, codigo, activo) 
          VALUES (?, ?, 1)
          ON DUPLICATE KEY UPDATE activo = 1
        `, [nombre, codigo || null]);
        
        if (result.affectedRows > 0) {
          insertados++;
        } else {
          actualizados++;
        }
      } catch (e) {
        console.error('Error procesando fila:', e.message);
        errores++;
      }
    }
    
    const mensaje = `Se procesaron ${data.length} filas: ${insertados} insertados, ${actualizados} actualizados, ${errores} con error`;
    res.json({ 
      ok: true, 
      insertados, 
      actualizados, 
      errores,
      total: data.length,
      mensaje
    });
  } catch (e) {
    console.error('Error importando Excel:', e);
    res.status(500).json({ error: 'Error procesando archivo: ' + e.message });
  }
});

// Listar citas electro por fecha (solo fecha requerida)
app.get('/api/citas-electro', requireAuth, async (req, res) => {
  const { fecha, equipo_id, buscar } = req.query;
  
  // Si está buscando por documento de paciente
  if (buscar && !fecha) {
    try {
      const citas = await db.query(`
        SELECT c.id, c.equipo_id, c.paciente_id, c.fecha, c.hora_agendamiento, c.hora_inicio, c.hora_fin, c.hora_fin_date,
               c.estudio, c.observaciones, c.diagnostico_id, c.estado, c.programado_por_nombre, c.editado_por_nombre, c.editado_en, c.creado_en, c.actualizado_en,
               c.duracion_minutos,
               p.nombre AS paciente_nombre, 
               p.documento AS paciente_documento,
               p.telefono AS telefono,
               d.nombre AS diagnostico_nombre,
               d.codigo AS diagnostico_codigo,
               e.nombre AS equipo_nombre
        FROM citas_electro c
        JOIN pacientes p ON p.id = c.paciente_id
        LEFT JOIN diagnosticos d ON d.id = c.diagnostico_id
        LEFT JOIN equipos_electro e ON e.id = c.equipo_id
        WHERE (p.documento LIKE ? OR p.nombre LIKE ?) AND c.deleted_at IS NULL
        ORDER BY c.fecha ASC, c.hora_agendamiento ASC
        LIMIT 50
      `, [`%${buscar}%`, `%${buscar}%`]);
      return res.json(citas);
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: e.message });
    }
  }
  
  if (!fecha) {
    return res.status(400).json({ error: 'fecha es obligatoria' });
  }

  try {
    
    // Si hay equipo_id, filtrar por eso también
    let query = `
      SELECT c.id, c.equipo_id, c.paciente_id, c.fecha, c.hora_agendamiento, c.hora_inicio, c.hora_fin, c.hora_fin_date,
             c.estudio, c.observaciones, c.diagnostico_id, c.estado, c.programado_por_nombre, c.editado_por_nombre, c.editado_en, c.creado_en, c.actualizado_en,
             c.duracion_minutos,
             p.nombre AS paciente_nombre, 
             p.documento AS paciente_documento,
             p.telefono AS telefono,
             d.nombre AS diagnostico_nombre,
             d.codigo AS diagnostico_codigo,
             e.nombre AS equipo_nombre
      FROM citas_electro c
      JOIN pacientes p ON p.id = c.paciente_id
      LEFT JOIN diagnosticos d ON d.id = c.diagnostico_id
      LEFT JOIN equipos_electro e ON e.id = c.equipo_id
      WHERE (c.fecha = ? OR c.hora_fin_date = ?) AND c.deleted_at IS NULL
    `;
    let params = [fecha, fecha];
    
    if (equipo_id) {
      query += ` AND c.equipo_id = ?`;
      params.push(equipo_id);
    }
    
    query += ` ORDER BY c.hora_agendamiento ASC, c.hora_inicio ASC, c.id ASC`;
    
    const citas = await db.query(query, params);
    res.json(citas);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Crear cita electrodiagnóstico (con TRANSACCIÓN para garantizar integridad)
app.post('/api/citas-electro', requireAuth, requireRole(['superadmin', 'admin', 'admin_recepcion', 'recepcion', 'admin_electro', 'electro', 'auxiliar_recepcion']), async (req, res) => {
  const { equipo_id, paciente_id, fecha, hora_agendamiento, hora, hora_fin, duracion, estudio, observaciones, diagnostico_id, estado, programado_por_nombre, telefono } = req.body || {};
  
  // 'hora' o 'hora_agendamiento' es la hora programada para el estudio
  const horaAgendamiento = hora_agendamiento || hora;

  if (!paciente_id || !fecha || !horaAgendamiento) {
    return res.status(400).json({ error: 'paciente_id, fecha y hora_agendamiento son obligatorios' });
  }

  // Validar formato de fecha (YYYY-MM-DD)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return res.status(400).json({ error: 'Fecha en formato inválido (debe ser YYYY-MM-DD)' });
  }

  // Validar formato de hora (HH:MM o HH:MM:SS)
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(horaAgendamiento)) {
    return res.status(400).json({ error: 'Hora en formato inválido (debe ser HH:MM o HH:MM:SS)' });
  }

  try {
    // ðŸ”„ Usar transacción para garantizar que la validación de capacidad y la inserción sean atómicas
    const result = await transactions.withTransaction(async (conn) => {
      // Calcular hora_fin y fecha_fin si no están proporcionadas
      let finalHoraFin = hora_fin;
      let finalFechaFin = fecha; // Default: misma fecha
      
      if (!hora_fin) {
        // duracion está en minutos (default: 30 si no se especifica)
        const duracionMinutos = duracion ? parseInt(duracion, 10) : 30;
        const [hh, mm] = horaAgendamiento.split(':').map(x => parseInt(x, 10));
        // Usar la fecha real para calcular correctamente durations multi-día
        const startDate = new Date(`${fecha}T${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}:00`);
        startDate.setMinutes(startDate.getMinutes() + duracionMinutos);
        finalHoraFin = `${String(startDate.getHours()).padStart(2, '0')}:${String(startDate.getMinutes()).padStart(2, '0')}`;
        finalFechaFin = startDate.toISOString().slice(0, 10);
      }

      // VALIDACIÓN: el paciente no puede tener ya una cita activa ese día
      const dupCheck = await transactions.selectForUpdate(conn,
        `SELECT COUNT(*) as cnt FROM citas_electro
         WHERE paciente_id = ? AND fecha = ?
         AND estado IN ('Programado', 'En Sala', 'En Estudio', 'Pausado')
         AND deleted_at IS NULL`,
        [paciente_id, fecha]
      );
      if ((dupCheck[0]?.cnt || 0) > 0) {
        throw new Error('Este paciente ya tiene una cita agendada para esa fecha en Electrodiagnóstico.');
      }

      // VALIDACIÓN DE CAPACIDAD DENTRO DE LA TRANSACCIÓN con SELECT FOR UPDATE
      const overlapCitas = await transactions.selectForUpdate(conn,
        `SELECT COUNT(*) as overlap_count
         FROM citas_electro
         WHERE estado IN ('Programado', 'En Sala', 'En Estudio', 'Pausado')
         AND deleted_at IS NULL
         AND CONCAT(COALESCE(hora_fin_date, fecha), ' ', hora_fin) >= CONCAT(?, ' ', ?)
         AND CONCAT(fecha, ' ', hora_agendamiento) <= CONCAT(?, ' ', ?)`,
        [fecha, horaAgendamiento, finalFechaFin, finalHoraFin]
      );

      const overlapCount = overlapCitas[0]?.overlap_count || 0;

      // Validar capacidad: máximo 4 cupos disponibles
      if (overlapCount >= 4) {
        throw new Error(`Sin capacidad disponible en este horario. Hay ${overlapCount} cupos ocupados. Máximo: 4`);
      }

      // INSERTAR DENTRO DE LA TRANSACCIÓN
      const insertResult = await conn.execute(`
        INSERT INTO citas_electro (equipo_id, paciente_id, fecha, hora_agendamiento, hora_inicio, hora_fin, hora_fin_date, estudio, observaciones, diagnostico_id, estado, programado_por_nombre)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        equipo_id || null,
        paciente_id,
        fecha,
        horaAgendamiento,
        null,
        finalHoraFin,
        finalFechaFin,
        estudio || null,
        observaciones || null,
        diagnostico_id || null,
        estado || 'Programado',
        programado_por_nombre || 'Sistema'
      ]);

      return {
        insertId: insertResult[0].insertId,
        overlapCount,
        finalHoraFin,
        finalFechaFin
      };
    });

    // Emitir evento de socket para actualizar en tiempo real
    if (app.io) {
      emitSocket('electro:cita-creada', {
        id: result.insertId,
        paciente_id,
        fecha,
        hora_agendamiento: horaAgendamiento,
        hora_fin: result.finalHoraFin,
        estudio,
        estado: estado || 'Programado',
        overlap_count: result.overlapCount,
        telefono: telefono || null
      });
      emitSocket('electro:actualizar-lista', { type: 'creada', id: result.insertId });
    }
    
    res.json({ 
      ok: true, 
      id: result.insertId, 
      capacity_info: { 
        active_studies: result.overlapCount, 
        max: 4,
        available: 4 - result.overlapCount - 1 // El que acaba de crearse
      } 
    });
  } catch (e) {
    // La transacción fue automáticamente revertida si hubo error
    const errorMsg = e.message.includes('Sin capacidad') ? e.message : e.message;
    if (e.message.includes('Sin capacidad')) {
      return res.status(409).json({ 
        error: errorMsg,
        details: e.message,
        capacity: { max: 4 }
      });
    }
    logger.error('Error creando cita electro', { error: e.message, paciente_id });
    res.status(500).json({ error: e.message });
  }
});

// Estadísticas de citas por fecha (estado, estudio, equipo)
// IMPORTANTE: debe estar ANTES de /:id para que "stats" no sea interpretado como un ID
app.get('/api/citas-electro/stats', requireAuth, async (req, res) => {
  const { fecha } = req.query;
  if (!fecha) return res.status(400).json({ error: 'fecha es obligatoria' });
  try {
    const [porEstado, porEstudio] = await Promise.all([
      db.query(
        `SELECT estado, COUNT(*) AS total FROM citas_electro
         WHERE (fecha = ? OR hora_fin_date = ?) AND deleted_at IS NULL
         GROUP BY estado`,
        [fecha, fecha]
      ),
      db.query(
        `SELECT estudio, COUNT(*) AS total FROM citas_electro
         WHERE (fecha = ? OR hora_fin_date = ?) AND deleted_at IS NULL
         GROUP BY estudio`,
        [fecha, fecha]
      )
    ]);
    // Totales rápidos
    const total = porEstado.reduce((a, r) => a + r.total, 0);
    const completadas = (porEstado.find(r => r.estado === 'Completado') || {}).total || 0;
    const enEstudio  = (porEstado.find(r => r.estado === 'En Estudio')  || {}).total || 0;
    res.json({ total, completadas, enEstudio, porEstado, porEstudio });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Export CSV de citas electro por fecha
// IMPORTANTE: antes del /:id para que "export" no sea capturado como un ID
app.get('/api/citas-electro/export', requireAuth, async (req, res) => {
  const { fecha } = req.query;
  if (!fecha) return res.status(400).json({ error: 'fecha es obligatoria' });
  try {
    const rows = await db.query(`
      SELECT c.fecha, c.hora_agendamiento, c.hora_inicio, c.hora_fin, c.estudio,
             c.estado, c.programado_por_nombre, c.editado_por_nombre,
             p.nombre AS paciente_nombre, p.documento AS paciente_documento, p.telefono,
             d.codigo AS diagnostico_codigo, d.nombre AS diagnostico_nombre,
             e.nombre AS equipo_nombre
      FROM citas_electro c
      JOIN pacientes p ON p.id = c.paciente_id
      LEFT JOIN diagnosticos d ON d.id = c.diagnostico_id
      LEFT JOIN equipos_electro e ON e.id = c.equipo_id
      WHERE (c.fecha = ? OR c.hora_fin_date = ?) AND c.deleted_at IS NULL
      ORDER BY c.hora_agendamiento ASC
    `, [fecha, fecha]);

    const headers = ['Fecha','Hora Agendamiento','Hora Inicio','Hora Fin','Estudio','Estado',
                     'Paciente','Documento','Teléfono','Diagnóstico Cód','Diagnóstico',
                     'Equipo','Programó','Editó'];
    const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [
      headers.join(','),
      ...rows.map(r => [
        r.fecha, r.hora_agendamiento, r.hora_inicio, r.hora_fin, r.estudio, r.estado,
        r.paciente_nombre, r.paciente_documento, r.telefono,
        r.diagnostico_codigo, r.diagnostico_nombre, r.equipo_nombre,
        r.programado_por_nombre, r.editado_por_nombre
      ].map(escape).join(','))
    ];

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="citas-electro-${fecha}.csv"`);
    res.send('\uFEFF' + lines.join('\r\n')); // BOM para que Excel abra bien en Windows
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Obtener una cita electro por ID
app.get('/api/citas-electro/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  try {
    const rows = await db.query(`
      SELECT c.*, p.nombre AS paciente_nombre, p.documento AS paciente_documento,
             p.telefono AS telefono, d.nombre AS diagnostico_nombre,
             d.codigo AS diagnostico_codigo, e.nombre AS equipo_nombre
      FROM citas_electro c
      JOIN pacientes p ON p.id = c.paciente_id
      LEFT JOIN diagnosticos d ON d.id = c.diagnostico_id
      LEFT JOIN equipos_electro e ON e.id = c.equipo_id
      WHERE c.id = ? AND c.deleted_at IS NULL
    `, [id]);
    if (!rows.length) return res.status(404).json({ error: 'Cita no encontrada' });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Actualizar estado de cita electro (registra quién editó)
app.patch('/api/citas-electro/:id/estado', requireAuth, requireRole(['superadmin', 'admin', 'admin_recepcion', 'recepcion', 'admin_electro', 'electro', 'tecnico_electro']), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { estado } = req.body || {};
  if (!id || !estado) {
    return res.status(400).json({ error: 'id y estado son obligatorios' });
  }

  try {
    const citas = await db.query('SELECT * FROM citas_electro WHERE id = ?', [id]);
    const cita = citas.length > 0 ? citas[0] : null;
    if (!cita) {
      return res.status(404).json({ error: 'Cita no encontrada' });
    }

    const userName = req.session.usuario || 'Usuario';
    const users = await db.query('SELECT nombre FROM usuarios WHERE id = ?', [req.session.usuarioId]);
    const user = users.length > 0 ? users[0] : null;
    const editadoPor = (user && user.nombre) ? user.nombre : userName;

    await db.execute(`
      UPDATE citas_electro 
      SET estado = ?, editado_por_nombre = ?, editado_en = NOW()
      WHERE id = ?
    `, [estado, editadoPor, id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Actualizar cita electro (equipo, estado, horas, etc)
// FLUJO DE ESTADOS:
// "Programado" â†’ "En Estudio" (validar capacidad)
// "En Estudio" â†’ "Completado" (marcar fin)
// Cualquier estado â†’ "En Sala", "No Asistió", "Cancelado" (manual)
app.patch('/api/citas-electro/:id', requireAuth, requireRole(['superadmin', 'admin', 'admin_recepcion', 'recepcion', 'admin_electro', 'electro']), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { equipo_id, estado, hora_inicio, hora_fin, hora_agendamiento, fecha, duracion_minutos } = req.body || {};
  
  if (!id) {
    return res.status(400).json({ error: 'id es obligatorio' });
  }

  try {
    const citasResult = await db.query('SELECT * FROM citas_electro WHERE id = ? AND deleted_at IS NULL', [id]);
    if (citasResult.length === 0) {
      return res.status(404).json({ error: 'Cita no encontrada' });
    }

    const citaActual = citasResult[0];
    const estadoActual = citaActual.estado;

    // ============ VALIDAR TRANSICIÓN DE ESTADOS ============
    if (estado && estado !== estadoActual) {
      // Estados manuales (permitidos desde cualquier estado)
      const estadosManuales = ['En Sala', 'No Asistió', 'Reprogramado', 'Cancelado', 'Adelantado'];
      const esManual = estadosManuales.includes(estado);

      // Transición automática: Programado â†’ En Estudio o En Sala â†’ En Estudio
      const esInicioEstudio = (estadoActual === 'Programado' || estadoActual === 'En Sala') && estado === 'En Estudio';

      // Transición automática: En Estudio â†’ Completado
      const esFinEstudio = estadoActual === 'En Estudio' && estado === 'Completado';

      if (!esManual && !esInicioEstudio && !esFinEstudio) {
        return res.status(400).json({ 
          error: `Transición de estado inválida: ${estadoActual} â†’ ${estado}` 
        });
      }

      // ============ VALIDAR CAPACIDAD AL CAMBIAR A "En Estudio" ============
      if (esInicioEstudio) {
        // Contar CUPOS OCUPADOS por otras citas que se solapan
        // Incluir: Programado, En Sala, En Estudio (NO Completado porque libera el cupo)
        const overlapCitas = await db.query(`
          SELECT COUNT(*) as overlap_count
          FROM citas_electro
          WHERE id != ?
          AND estado IN ('Programado', 'En Sala', 'En Estudio', 'Pausado')
          AND deleted_at IS NULL
          AND CONCAT(COALESCE(hora_fin_date, fecha), ' ', hora_fin) >= CONCAT(?, ' ', ?)
          AND CONCAT(fecha, ' ', hora_agendamiento) <= CONCAT(COALESCE(?, ?), ' ', ?)
        `, [id, citaActual.fecha, citaActual.hora_agendamiento, citaActual.hora_fin_date, citaActual.fecha, citaActual.hora_fin]);

        const overlapCount = overlapCitas[0]?.overlap_count || 0;

        // Validar capacidad: máximo 4 cupos disponibles
        if (overlapCount >= 4) {
          return res.status(409).json({ 
            error: 'Sin capacidad disponible en este horario',
            details: `Hay ${overlapCount} cupos ocupados en este rango. Máximo permitido: 4`,
            capacity: { active: overlapCount, max: 4 }
          });
        }
      }
    }

    const updates = [];
    const values = [];
    
    if (equipo_id !== undefined) {
      updates.push('equipo_id = ?');
      values.push(equipo_id);
    }
    
    if (estado !== undefined) {
      updates.push('estado = ?');
      values.push(estado);
    }
    
    if (hora_inicio !== undefined) {
      updates.push('hora_inicio = ?');
      values.push(hora_inicio);
    }
    
    if (hora_fin !== undefined) {
      updates.push('hora_fin = ?');
      values.push(hora_fin);
      
      // Calcular hora_fin_date si se está actualizando hora_fin
      // hora_fin_date debe estar set si el estudio cruza a otro día
      const horaInicio = hora_inicio || citaActual.hora_inicio;
      const fechaEstudio = fecha || citaActual.fecha;
      
      if (horaInicio && fechaEstudio) {
        // Comparar hora_fin con hora_inicio
        // Si hora_fin < hora_inicio, significa que cruza medianoche
        const [hiI, miI] = horaInicio.split(':').map(Number);
        const [hiF, miF] = hora_fin.split(':').map(Number);
        const minutosInicio = hiI * 60 + miI;
        const minutosFin = hiF * 60 + miF;
        
        if (minutosFin < minutosInicio) {
          // Cruza medianoche, calcular fecha del día siguiente
          const fechaObj = new Date(fechaEstudio);
          fechaObj.setDate(fechaObj.getDate() + 1);
          const horaFinDate = fechaObj.toISOString().split('T')[0];
          updates.push('hora_fin_date = ?');
          values.push(horaFinDate);
        } else {
          // No cruza medianoche, hora_fin_date es NULL
          updates.push('hora_fin_date = NULL');
        }
      }
    }
    
    if (hora_agendamiento !== undefined) {
      updates.push('hora_agendamiento = ?');
      values.push(hora_agendamiento);
    }
    
    if (fecha !== undefined) {
      updates.push('fecha = ?');
      values.push(fecha);
    }
    
    if (duracion_minutos !== undefined) {
      updates.push('duracion_minutos = ?');
      values.push(duracion_minutos);
    }
    
    if (updates.length === 0) {
      return res.json({ ok: true });
    }
    
    updates.push('editado_en = NOW()');
    
    // Siempre registrar quién editó desde la sesión activa
    const editorNombre = req.session.usuarioNombre || req.session.usuario || 'Sistema';
    updates.push('editado_por_nombre = ?');
    values.push(editorNombre);
    
    values.push(id);
    
    // Construir objeto de cambios para logging y socket
    const cambios = {};
    if (equipo_id !== undefined) cambios.equipo_id = equipo_id;
    if (estado !== undefined) cambios.estado = estado;
    if (hora_inicio !== undefined) cambios.hora_inicio = hora_inicio;
    if (hora_fin !== undefined) cambios.hora_fin = hora_fin;
    if (hora_agendamiento !== undefined) cambios.hora_agendamiento = hora_agendamiento;
    if (fecha !== undefined) cambios.fecha = fecha;
    if (duracion_minutos !== undefined) cambios.duracion_minutos = duracion_minutos;
    
    await db.execute(`UPDATE citas_electro SET ${updates.join(', ')} WHERE id = ?`, values);
    
    // Emitir evento de socket para actualizar en tiempo real
    if (app.io) {
      emitSocket('electro:cita-actualizada', {
        id,
        ...cambios,
        editado_por: req.session.usuarioNombre || 'Sistema'
      });
      emitSocket('electro:actualizar-lista', { type: 'actualizada', id, cambios });
    }
    
    res.json({ ok: true, transicion: `${estadoActual} â†’ ${estado || estadoActual}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Eliminar cita electro
app.delete('/api/citas-electro/:id', requireAuth, requireRole(['superadmin', 'admin', 'admin_electro', 'electro']), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) {
    return res.status(400).json({ error: 'ID inválido' });
  }

  try {
    const citas = await db.query('SELECT * FROM citas_electro WHERE id = ? AND deleted_at IS NULL', [id]);
    const cita = citas.length > 0 ? citas[0] : null;
    if (!cita) {
      return res.status(404).json({ error: 'Cita no encontrada' });
    }

    // Admin electro: no puede eliminar estudios ya completados
    const userRoleElectro = req.session?.rol;
    if (userRoleElectro === 'admin_electro' && cita.estado === 'Completado') {
      return res.status(400).json({ error: 'No se puede eliminar un estudio ya completado' });
    }

    // Soft-delete: marcar como eliminada en lugar de borrar físicamente
    const eliminadoPor = req.session.usuarioNombre || req.session.usuario || 'Admin';
    await db.execute(
      "UPDATE citas_electro SET deleted_at = NOW(), editado_por_nombre = ? WHERE id = ?",
      [eliminadoPor, id]
    );
    
    // Emitir evento de socket para actualizar en tiempo real
    if (app.io) {
      emitSocket('electro:cita-eliminada', {
        id,
        cita_info: cita
      });
      emitSocket('electro:actualizar-lista', { type: 'eliminada', id });
    }
    
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Especialidades y tipos de consulta ---

// GET  legible por todos los roles (para poblar selects)
app.get('/api/especialidades', requireAuth, async (req, res) => {
  try {
    const rows = await db.query('SELECT id, nombre FROM especialidades WHERE activo=1 ORDER BY nombre ASC');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/especialidades', requireAuth, requireAdmin, async (req, res) => {
  const { nombre } = req.body || {};
  if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
  try {
    const result = await db.execute('INSERT INTO especialidades (nombre) VALUES (?)', [nombre.trim()]);
    res.json({ ok: true, id: result.insertId });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ya existe una especialidad con ese nombre' });
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/especialidades/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { nombre } = req.body || {};
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
  try {
    await db.execute('UPDATE especialidades SET nombre=? WHERE id=?', [nombre.trim(), id]);
    res.json({ ok: true });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ya existe una especialidad con ese nombre' });
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/especialidades/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  try {
    await db.execute('DELETE FROM especialidades WHERE id=?', [id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET  legible por todos los roles (para poblar selects de agenda)
app.get('/api/tipos-consulta', requireAuth, async (req, res) => {
  const { especialidad_id, especialidad_nombre, medico_id } = req.query;
  try {
    // Prioridad 1: medico_id — 2 queries secuenciales (más robusto que JOIN)
    if (medico_id) {
      const doc = await db.queryOne(
        "SELECT especialidad FROM usuarios WHERE id=? AND rol='doctor'",
        [parseInt(medico_id, 10)]
      );
      const espNombre = (doc?.especialidad || '').trim();
      if (espNombre) {
        // Buscar especialidad_id (sin filtro activo para mayor tolerancia)
        const espRows = await db.query(
          'SELECT id FROM especialidades WHERE LOWER(TRIM(nombre))=LOWER(TRIM(?))',
          [espNombre]
        );
        if (espRows.length > 0) {
          const rows = await db.query(
            'SELECT id, nombre, orden FROM tipos_consulta WHERE especialidad_id=? AND activo=1 ORDER BY orden ASC, id ASC',
            [espRows[0].id]
          );
          return res.json(rows);
        }
      }
      // Especialidad no resuelta: devolver TODOS los tipos de la BD como fallback
      // (mejor que vacío o que los hardcoded del cliente)
      const allRows = await db.query(
        'SELECT id, nombre, orden FROM tipos_consulta WHERE activo=1 ORDER BY orden ASC, id ASC'
      );
      return res.json(allRows);
    }
    // Prioridad 2: especialidad_id directo
    let espId = especialidad_id ? parseInt(especialidad_id, 10) : null;
    // Prioridad 3: buscar por nombre (case-insensitive + trim)
    if (!espId && especialidad_nombre) {
      const rows = await db.query(
        'SELECT id FROM especialidades WHERE LOWER(TRIM(nombre))=LOWER(TRIM(?))',
        [especialidad_nombre]
      );
      espId = rows.length > 0 ? rows[0].id : null;
    }
    if (!espId) {
      const rows = await db.query('SELECT id, nombre, orden FROM tipos_consulta WHERE activo=1 ORDER BY orden ASC, id ASC');
      return res.json(rows);
    }
    const rows = await db.query(
      'SELECT id, nombre, orden FROM tipos_consulta WHERE especialidad_id=? AND activo=1 ORDER BY orden ASC, id ASC',
      [espId]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/tipos-consulta', requireAuth, requireAdmin, async (req, res) => {
  const { especialidad_id, nombre } = req.body || {};
  if (!especialidad_id || !nombre || !nombre.trim())
    return res.status(400).json({ error: 'Especialidad y nombre son obligatorios' });
  try {
    const ordenRows = await db.query(
      'SELECT COALESCE(MAX(orden)+1, 0) AS sig FROM tipos_consulta WHERE especialidad_id=?',
      [especialidad_id]
    );
    const orden = ordenRows[0]?.sig ?? 0;
    const result = await db.execute(
      'INSERT INTO tipos_consulta (especialidad_id, nombre, orden) VALUES (?,?,?)',
      [especialidad_id, nombre.trim(), orden]
    );
    emitSocket('tipos-consulta:actualizado', { especialidad_id });
    res.json({ ok: true, id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/tipos-consulta/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { nombre } = req.body || {};
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
  try {
    await db.execute('UPDATE tipos_consulta SET nombre=? WHERE id=?', [nombre.trim(), id]);
    emitSocket('tipos-consulta:actualizado', { id });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/tipos-consulta/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  try {
    await db.execute('DELETE FROM tipos_consulta WHERE id=?', [id]);
    emitSocket('tipos-consulta:actualizado', { id });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Pacientes en espera (electro) ---

app.get('/api/pacientes-espera', requireAuth, async (req, res) => {
  try {
    const rows = await db.query(
      `SELECT * FROM pacientes_espera
       ORDER BY FIELD(prioridad,'ALTA','MEDIA','BAJA'), creado_en ASC`
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/pacientes-espera', requireAuth, async (req, res) => {
  const { documento, nombres, apellidos, entidad, prioridad, ingresado_por, telefono1, telefono2, tipo_estudio } = req.body || {};
  if (!documento || !nombres || !apellidos || !entidad || !prioridad) {
    return res.status(400).json({ error: 'Todos los campos son obligatorios' });
  }
  const entidadesValidas = ['FOMAG', 'UCQN', 'PARTICULAR', 'PROINSALUD'];
  const prioridadesValidas = ['ALTA', 'MEDIA', 'BAJA'];
  if (!entidadesValidas.includes(entidad)) {
    return res.status(400).json({ error: 'Entidad inválida' });
  }
  if (!prioridadesValidas.includes(prioridad)) {
    return res.status(400).json({ error: 'Prioridad inválida' });
  }
  try {
    const result = await db.execute(
      'INSERT INTO pacientes_espera (documento, nombres, apellidos, entidad, prioridad, ingresado_por, telefono1, telefono2, tipo_estudio) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [documento, nombres, apellidos, entidad, prioridad, ingresado_por || null, telefono1 || null, telefono2 || null, tipo_estudio || null]
    );
    res.json({ ok: true, id: result.insertId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/pacientes-espera/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  try {
    await db.execute('DELETE FROM pacientes_espera WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Servicios (catálogo de recibos) ---

app.get('/api/servicios', requireAuth, async (req, res) => {
  try {
    const rows = await db.query('SELECT id, nombre FROM servicios_recibo WHERE activo=1 ORDER BY nombre ASC');
    res.json(rows);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/servicios', requireAuth, requireAdmin, async (req, res) => {
  const nombre = (req.body.nombre || '').trim();
  if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
  try {
    const result = await db.execute('INSERT INTO servicios_recibo (nombre) VALUES (?)', [nombre]);
    res.json({ ok: true, id: result.insertId });
  } catch(err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'El servicio ya existe' });
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/servicios/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const nombre = (req.body.nombre || '').trim();
  if (!nombre || isNaN(id)) return res.status(400).json({ error: 'Datos inválidos' });
  try {
    await db.execute('UPDATE servicios_recibo SET nombre=? WHERE id=?', [nombre, id]);
    res.json({ ok: true });
  } catch(err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'El servicio ya existe' });
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/servicios/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  try {
    await db.execute('DELETE FROM servicios_recibo WHERE id=?', [id]);
    res.json({ ok: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// --- Recibos ---

// Guardar recibo
app.post('/api/recibos', requireAuth, requireRole(['superadmin', 'admin', 'admin_recepcion', 'recepcion', 'auxiliar_recepcion']), async (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'Cuerpo de la petición inválido' });
  }

  const { cliente, fecha, total, data,
          medico_id, medico_nombre, tipo_pago, nombre_entidad,
          tipo_servicio, turno_id, cita_electro_id, observaciones } = body;

  if (total == null) {
    return res.status(400).json({ error: 'Se requiere el campo total' });
  }

  // Generado por  extraer del usuario en sesión
  let generado_por_id = req.session.usuarioId || null;
  let generado_por_nombre = null;
  try {
    if (generado_por_id) {
      const users = await db.query('SELECT nombre, usuario FROM usuarios WHERE id = ?', [generado_por_id]);
      if (users.length > 0) generado_por_nombre = users[0].nombre || users[0].usuario;
    }
  } catch (_) {}

  // Asignar número de recibo de forma atómica para evitar duplicados concurrentes
  const conn = await db.getPool().getConnection();
  try {
    await conn.beginTransaction();
    // FOR UPDATE bloquea la lectura hasta que la transacción finalice
    const [maxRows] = await conn.execute(
      'SELECT MAX(CAST(numero AS UNSIGNED)) AS maxNum FROM recibos FOR UPDATE'
    );
    const nextNum = (parseInt(maxRows[0]?.maxNum || '0', 10) || 0) + 1;
    const numeroAsignado = String(nextNum).padStart(4, '0');

    const [result] = await conn.execute(
      `INSERT INTO recibos
        (numero, cliente, fecha, total, data,
         medico_id, medico_nombre, tipo_pago, nombre_entidad,
         tipo_servicio, generado_por_id, generado_por_nombre,
         turno_id, cita_electro_id, observaciones)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        numeroAsignado,
        cliente || null,
        fecha || null,
        total || 0,
        data ? JSON.stringify(data) : null,
        medico_id || null,
        medico_nombre || null,
        tipo_pago || null,
        nombre_entidad || null,
        tipo_servicio || null,
        generado_por_id,
        generado_por_nombre,
        turno_id || null,
        cita_electro_id || null,
        observaciones || null
      ]
    );
    await conn.commit();

    if (app.io) {
      emitSocket('recibo:creado', { id: result.insertId, numero: numeroAsignado, cliente, fecha, total });
      emitSocket('recibo:actualizar-lista');
      emitSocket('stats:actualizar');
    }
    res.json({ ok: true, id: result.insertId, numero: numeroAsignado });
  } catch(err) {
    await conn.rollback();
    console.error('[RECIBOS] Error guardando recibo:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// Obtener siguiente número de recibo (server-side)
// Usuarios que han generado al menos un recibo (para el filtro)
app.get('/api/recibos/generadores', requireAuth, async (req, res) => {
  try {
    const rows = await db.query(
      `SELECT DISTINCT generado_por_id AS id, generado_por_nombre AS nombre
       FROM recibos
       WHERE generado_por_id IS NOT NULL
       ORDER BY generado_por_nombre ASC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/recibos/next-number', requireAuth, async (req, res) => {
  try {
    const rows = await db.query('SELECT MAX(CAST(numero AS UNSIGNED)) AS maxNum FROM recibos');
    const maxNum = parseInt(rows[0]?.maxNum || '0', 10) || 0;
    res.json({ nextNumber: maxNum + 1 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Buscar cita para pre-llenar recibo (turnos de hoy/ayer por nombre o documento)
app.get('/api/recibos/buscar-cita', requireAuth, requireRole(['superadmin', 'admin', 'admin_recepcion', 'recepcion', 'auxiliar_recepcion']), async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q || q.length < 2) return res.json([]);
  try {
    const like = `%${q}%`;
    // Turnos de agenda médica (estados atendidos, últimos 7 días)
    const turnos = await db.query(
      `SELECT t.id, t.paciente_nombre, t.paciente_documento, t.fecha, t.hora,
              t.tipo_consulta, t.entidad, u.nombre AS medico_nombre, u.id AS medico_id,
              'turno' AS origen
       FROM turnos t
       LEFT JOIN usuarios u ON u.id = t.doctor_id
       WHERE (t.paciente_nombre LIKE ? OR t.paciente_documento LIKE ?)
         AND t.estado IN ('COMPLETADO','ATENDIDO')
         AND t.fecha >= CURDATE() - INTERVAL 7 DAY
       ORDER BY t.fecha DESC, t.hora DESC
       LIMIT 20`,
      [like, like]
    );
    // Citas electro (completadas, últimos 7 días)
    const citasE = await db.query(
      `SELECT ce.id, p.nombre AS paciente_nombre, p.documento AS paciente_documento,
              ce.fecha, ce.hora_agendamiento AS hora, ce.estudio AS tipo_consulta,
              NULL AS entidad, NULL AS medico_nombre, NULL AS medico_id,
              'electro' AS origen
       FROM citas_electro ce
       JOIN pacientes p ON p.id = ce.paciente_id
       WHERE (p.nombre LIKE ? OR p.documento LIKE ?)
         AND ce.estado = 'Completado'
         AND ce.deleted_at IS NULL
         AND ce.fecha >= CURDATE() - INTERVAL 7 DAY
       ORDER BY ce.fecha DESC, ce.hora_agendamiento DESC
       LIMIT 20`,
      [like, like]
    );
    res.json([...turnos, ...citasE]);
  } catch (err) {
    console.error('[RECIBOS] buscar-cita:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Listar recibos (con filtros opcionales)
app.get('/api/recibos', requireAuth, async (req, res) => {
  try {
    const { fecha_desde, fecha_hasta, tipo_pago, medico_id, generado_por_id } = req.query;
    const conditions = [];
    const params = [];

    if (fecha_desde) { conditions.push('fecha >= ?'); params.push(fecha_desde); }
    if (fecha_hasta) { conditions.push('fecha <= ?'); params.push(fecha_hasta); }
    if (tipo_pago)   { conditions.push('tipo_pago = ?'); params.push(tipo_pago); }
    if (medico_id)   { conditions.push('medico_id = ?'); params.push(parseInt(medico_id, 10)); }
    if (generado_por_id) { conditions.push('generado_por_id = ?'); params.push(parseInt(generado_por_id, 10)); }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const rows = await db.query(
      `SELECT id, numero, cliente, fecha, total, tipo_pago, nombre_entidad,
              medico_id, medico_nombre, tipo_servicio,
              generado_por_id, generado_por_nombre, observaciones,
              turno_id, cita_electro_id, creado_en, data
       FROM recibos ${where} ORDER BY id DESC LIMIT 500`,
      params
    );
    res.json(rows || []);
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// Exportar recibos a Excel (XLSX)
app.get('/api/recibos/export/xlsx', requireAuth, async (req, res) => {
  try {
    const XLSX = require('xlsx');
    const { fecha_desde, fecha_hasta, tipo_pago, medico_id, generado_por_id } = req.query;
    const conditions = [];
    const params = [];
    if (fecha_desde) { conditions.push('fecha >= ?'); params.push(fecha_desde); }
    if (fecha_hasta) { conditions.push('fecha <= ?'); params.push(fecha_hasta); }
    if (tipo_pago)   { conditions.push('tipo_pago = ?'); params.push(tipo_pago); }
    if (medico_id)   { conditions.push('medico_id = ?');  params.push(parseInt(medico_id, 10)); }
    if (generado_por_id) { conditions.push('generado_por_id = ?'); params.push(parseInt(generado_por_id, 10)); }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const rows = await db.query(
      `SELECT numero, fecha, cliente, tipo_pago, nombre_entidad,
              medico_nombre, tipo_servicio, total,
              generado_por_nombre, observaciones, creado_en
       FROM recibos ${where} ORDER BY numero ASC, id ASC`,
      params
    );
    const data = rows.map(r => ({
      'NÂº Recibo': r.numero || '',
      'Fecha': r.fecha ? String(r.fecha).slice(0, 10) : '',
      'Paciente': r.cliente || '',
      'Forma de Pago': r.tipo_pago || '',
      'Entidad': r.nombre_entidad || '',
      'Médico': r.medico_nombre || '',
      'Servicio': r.tipo_servicio || '',
      'Total': Number(r.total || 0),
      'Generado por': r.generado_por_nombre || '',
      'Observaciones': r.observaciones || '',
      'Creado en': r.creado_en ? new Date(r.creado_en).toISOString().slice(0, 19).replace('T', ' ') : ''
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Recibos');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const today = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="recibos-${today}.xlsx"`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Exportar recibos a PDF (página HTML imprimible)
app.get('/api/recibos/export/pdf-reporte', requireAuth, async (req, res) => {
  try {
    const { fecha_desde, fecha_hasta, tipo_pago, medico_id, generado_por_id } = req.query;
    const conditions = [];
    const params = [];
    if (fecha_desde) { conditions.push('fecha >= ?'); params.push(fecha_desde); }
    if (fecha_hasta) { conditions.push('fecha <= ?'); params.push(fecha_hasta); }
    if (tipo_pago)   { conditions.push('tipo_pago = ?'); params.push(tipo_pago); }
    if (medico_id)   { conditions.push('medico_id = ?');  params.push(parseInt(medico_id, 10)); }
    if (generado_por_id) { conditions.push('generado_por_id = ?'); params.push(parseInt(generado_por_id, 10)); }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const rows = await db.query(
      `SELECT numero, fecha, cliente, tipo_pago, nombre_entidad,
              medico_nombre, tipo_servicio, total,
              generado_por_nombre, observaciones
       FROM recibos ${where} ORDER BY numero ASC, id ASC`,
      params
    );
    const total = rows.reduce((s, r) => s + Number(r.total || 0), 0);
    const fmt = (v) => Number(v).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmtFecha = (v) => v ? String(v).slice(0,10) : '-';
    const rowsHTML = rows.map((r, i) => `
      <tr${i%2===0?' style="background:#f9fafb"':''}>
        <td>${escapeHtml(r.numero||'-')}</td>
        <td>${escapeHtml(fmtFecha(r.fecha))}</td>
        <td>${escapeHtml(r.cliente||'-')}</td>
        <td>${escapeHtml(r.tipo_pago||'-')}</td>
        <td>${escapeHtml(r.nombre_entidad||'-')}</td>
        <td>${escapeHtml(r.medico_nombre||'-')}</td>
        <td>${escapeHtml(r.tipo_servicio||'-')}</td>
        <td style="text-align:right">$ ${fmt(r.total)}</td>
        <td>${escapeHtml(r.generado_por_nombre||'-')}</td>
      </tr>`).join('');
    const descFiltros = [
      fecha_desde ? `Desde: ${fecha_desde}` : '',
      fecha_hasta ? `Hasta: ${fecha_hasta}` : '',
      tipo_pago   ? `Tipo pago: ${tipo_pago}` : ''
    ].filter(Boolean).join(' Â· ') || 'Sin filtros';
    const html = `<!doctype html><html><head><meta charset="utf-8"/>
    <title>Reporte Recibos</title>
    <style>
      *{margin:0;padding:0;box-sizing:border-box}
      body{font-family:Arial,sans-serif;font-size:11px;padding:16px;color:#111}
      h1{font-size:16px;margin-bottom:4px}
      .sub{color:#555;font-size:11px;margin-bottom:12px}
      table{width:100%;border-collapse:collapse;font-size:10px}
      th{background:#2d4a47;color:white;padding:6px 8px;text-align:left}
      td{padding:5px 8px;border-bottom:1px solid #e5e7eb}
      .total-row{font-weight:bold;background:#f0f9f4;border-top:2px solid #2d4a47}
      @media print{.no-print{display:none}}
    </style>
    </head><body>
    <h1>Reporte de Recibos  Instituto Neurociencias</h1>
    <div class="sub">${escapeHtml(descFiltros)} Â· ${rows.length} recibos Â· Total: $ ${fmt(total)}</div>
    <div class="no-print" style="margin-bottom:12px">
      <button onclick="window.print()" style="padding:6px 14px;background:#2d4a47;color:white;border:none;border-radius:4px;cursor:pointer">Imprimir / Guardar PDF</button>
    </div>
    <table>
      <thead><tr>
        <th>NÂº</th><th>Fecha</th><th>Paciente</th><th>Tipo Pago</th>
        <th>Entidad</th><th>Médico</th><th>Servicio</th><th>Total</th><th>Generado por</th>
      </tr></thead>
      <tbody>${rowsHTML}
        <tr class="total-row">
          <td colspan="7" style="text-align:right">TOTAL</td>
          <td style="text-align:right">$ ${fmt(total)}</td><td></td>
        </tr>
      </tbody>
    </table>
    <script>window.onload=function(){window.print();}<\/script>
    </body></html>`;
    res.send(html);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Resetear/limpiar todos los recibos (solo admin)
app.delete('/api/recibos/reset', requireAuth, requireAdmin, async (req, res) => {
  try {
    await db.execute('DELETE FROM recibos');
    await db.execute('ALTER TABLE recibos AUTO_INCREMENT = 1');
    res.json({ ok: true, message: 'Todos los recibos han sido eliminados' });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// Eliminar recibo individual (solo admin)
app.delete('/api/recibos/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = parseReciboId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'ID de recibo inválido' });
  try {
    const result = await db.execute('DELETE FROM recibos WHERE id=?', [id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'No encontrado' });
    if (app.io) {
      emitSocket('recibo:eliminado', { id });
      emitSocket('recibo:actualizar-lista');
      emitSocket('stats:actualizar');
    }
    res.json({ ok: true });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// Obtener recibo (por id)
app.get('/api/recibos/:id', requireAuth, async (req, res) => {
  const id = parseReciboId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'ID de recibo inválido' });
  try {
    const rows = await db.query('SELECT * FROM recibos WHERE id=?', [id]);
    const row = rows.length > 0 ? rows[0] : null;
    if (!row) return res.status(404).json({ error: 'No encontrado' });
    try {
      row.data = JSON.parse(row.data);
    } catch (e) {
      return res.status(500).json({ error: 'Datos del recibo corruptos' });
    }
    res.json(row);
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// Generar PDF del recibo
app.get('/api/recibos/:id/pdf', requireAuth, async (req, res) => {
  const id = parseReciboId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'ID de recibo inválido' });
  try {
    const rows = await db.query('SELECT * FROM recibos WHERE id=?', [id]);
    const row = rows.length > 0 ? rows[0] : null;
    if (!row) return res.status(404).json({ error: 'No encontrado' });

    let data;
    try {
      data = JSON.parse(row.data);
    } catch (e) {
      return res.status(500).json({ error: 'Datos del recibo corruptos' });
    }
    const items = Array.isArray(data.items) ? data.items : [];

    const formatCurrency = (value) => {
      const num = Number(value);
      const formatted = num.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      return formatted.endsWith('.00') ? formatted.slice(0, -3) : formatted;
    };

    const itemsRows = items.map(it => {
      const desc = escapeHtml(it.desc || '');
      const price = Number(it.price || 0);
      return `<tr>
        <td style="padding:8px;border:1px solid #000;word-wrap:break-word">${desc}</td>
        <td style="padding:8px;border:1px solid #000;text-align:right">$ ${formatCurrency(price)}</td>
      </tr>`;
    }).join('');

    const subtotal = Number(data.subtotal || 0).toFixed(2);
    const iva = Number(data.iva || 0).toFixed(2);
    const total = Number(data.total || 0).toFixed(2);

    const formatCurrencyValue = (value) => {
      const formatted = value.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      return formatted.endsWith('.00') ? formatted.slice(0, -3) : formatted;
    };

    const subtotalFormatted = formatCurrencyValue(subtotal);
    const ivaFormatted = formatCurrencyValue(iva);
    const totalFormatted = formatCurrencyValue(total);
    const fechaRecibo = typeof row.fecha === 'string' ? row.fecha : new Date(row.fecha).toISOString().split('T')[0];

    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Recibo ${escapeHtml(row.numero)}</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:Arial,Helvetica,sans-serif; color:#000; font-size:12px; padding:6mm; line-height:1.4; max-width:80mm; margin:0 auto; }
    .no-print { text-align:center; margin-bottom:10px; }
    .no-print button { padding:8px 20px; background:#2d4a47; color:#fff; border:none; border-radius:4px; cursor:pointer; font-size:13px; }
    .no-print button:hover { background:#1e3330; }
    .header { margin-bottom:8px; border-bottom:2px solid #000; padding-bottom:5px; }
    .header-logo { text-align:center; margin-bottom:4px; }
    .header-logo img { max-width:50px; max-height:40px; object-fit:contain; }
    .company-info h1 { font-size:12px; font-weight:bold; margin-bottom:1px; }
    .company-info p { font-size:10px; margin:1px 0; }
    .receipt-number { font-size:12px; font-weight:bold; margin-top:4px; }
    .receipt-date { font-size:10px; }
    .client-section { margin:6px 0; font-size:10px; line-height:1.4; background:#f9f9f9; padding:5px; border-radius:2px; }
    .client-section strong.title { font-size:11px; display:block; margin-bottom:3px; }
    .client-section p { margin:1px 0; }
    table { width:100%; border-collapse:collapse; margin:6px 0; font-size:10px; }
    th { background:#f0f0f0; padding:4px; border:1px solid #000; font-size:9px; font-weight:bold; }
    td { padding:4px; border:1px solid #000; font-size:9px; word-break:break-word; }
    .totals-table td { border:none; padding:2px; font-size:10px; font-weight:bold; }
    .totals-table .value { text-align:right; }
    .total-row td { border-top:2px solid #000; border-bottom:2px solid #000; font-size:11px; }
    .observations { margin:6px 0; padding:5px; background:#f9f9f9; border-left:2px solid #000; font-size:9px; line-height:1.3; }
    .signature-line { border-top:1px solid #000; width:100%; margin-top:20px; margin-bottom:2px; }
    .signature-label { font-size:8px; font-weight:bold; text-align:center; }
    .footer { margin-top:8px; text-align:center; font-size:8px; border-top:1px solid #000; padding-top:3px; line-height:1.3; }
    @media print {
      .no-print { display:none !important; }
      body { padding:0; max-width:100%; }
      @page { size: 80mm auto; margin:4mm; }
    }
  </style>
</head>
<body>
  <div class="no-print">
    <button onclick="window.print()">🖨️ Imprimir / Guardar PDF</button>
  </div>

  <div class="header">
    <div class="header-logo">
      <img src="data:image/png;base64,${getLogoReciboBase64()}" alt="Logo" />
    </div>
    <div class="company-info">
      <h1>INSTITUTO NEUROCIENCIAS</h1>
      <p><strong>NIT:</strong> 901164565-1</p>
      <p><strong>Dirección:</strong> Carrera 34 #13-80. B/San Ignacio</p>
      <p><strong>Teléfono:</strong> 305-356-0651 &nbsp;|&nbsp; <strong>Ciudad:</strong> Pasto, Colombia</p>
    </div>
    <div class="receipt-number">Recibo N° ${escapeHtml(row.numero)}</div>
    <div class="receipt-date">Fecha: ${escapeHtml(fechaRecibo)}</div>
  </div>

  <div class="client-section">
    <strong class="title">CLIENTE</strong>
    <p><strong>Nombre:</strong> ${escapeHtml(row.cliente || '-')}</p>
    <p><strong>Documento:</strong> ${escapeHtml(data.doc || '-')}</p>
    <p><strong>Forma de pago:</strong> ${escapeHtml(row.tipo_pago || '-')}</p>
    <p><strong>Entidad:</strong> ${escapeHtml(row.nombre_entidad || data.entidad || '-')}</p>
  </div>

  <table>
    <thead>
      <tr>
        <th style="text-align:left;width:65%">Descripción</th>
        <th style="width:35%;text-align:right">Valor</th>
      </tr>
    </thead>
    <tbody>
      ${itemsRows}
    </tbody>
  </table>

  <table class="totals-table">
    <tr>
      <td>Subtotal:</td>
      <td class="value">$ ${subtotalFormatted}</td>
    </tr>
    ${Number(data.iva || 0) > 0 ? `<tr>
      <td>IVA (${data.tasa_iva || 0}%):</td>
      <td class="value">$ ${ivaFormatted}</td>
    </tr>` : ''}
    <tr class="total-row">
      <td>TOTAL:</td>
      <td class="value">$ ${totalFormatted}</td>
    </tr>
  </table>

  ${data.observ ? `<div class="observations"><strong>Observaciones:</strong><br/>${escapeHtml(data.observ)}</div>` : ''}

  <div style="margin-top:10px">
    <div class="signature-line"></div>
    <div class="signature-label">Quien recibe — Nombre y firma</div>
  </div>

  <div class="footer">
    <p>Documento generado digitalmente el ${new Date().toLocaleString('es-CO')}</p>
    <p>Este recibo es un comprobante de la transacción realizada.</p>
  </div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error generando recibo: ' + e.message });
  }
});

// Generar Reporte Diario
app.get('/api/reportes/diario', async (req, res) => {
  try {
    const fecha = req.query.fecha;
    if(!fecha) return res.status(400).json({ error: 'Fecha requerida' });
    
    const recibos = await db.query('SELECT * FROM recibos WHERE fecha=? ORDER BY id DESC', [fecha]);
    const total = recibos.reduce((sum, r) => sum + (Number(r.total) || 0), 0);
    // Extraer doc y servicios del JSON data de cada recibo
    const recibosConDoc = recibos.map(r => {
      let doc = '-';
      let servicios = '-';
      let fechaFormato = '-';
      
      // Formatear fecha a YYYY-MM-DD
      if (r.fecha) {
        let fechaStr = typeof r.fecha === 'string' ? r.fecha : String(r.fecha);
        
        // Si ya está en formato YYYY-MM-DD, usarlo directamente
        if (/^\d{4}-\d{2}-\d{2}$/.test(fechaStr)) {
          fechaFormato = fechaStr;
        } else {
          // Intentar parsear como Date
          try {
            const d = new Date(fechaStr);
            if (!isNaN(d.getTime())) {
              fechaFormato = d.toISOString().split('T')[0];
            }
          } catch (e) {
            // Si falla, dejar como '-'
          }
        }
      }
      
      try {
        const d = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
        if (d && d.doc != null) doc = String(d.doc);
        if (d && d.items && Array.isArray(d.items)) {
          servicios = d.items.map(item => item.desc || '').filter(s => s).join(', ') || '-';
        }
      } catch (e) { /* ignorar */ }
      return { ...r, doc, servicios, fechaFormato };
    });

    const logoBase64Data = getLogoBase64();

    const html = `
      <!doctype html>
      <html>
      <head>
        <meta charset="utf-8"/>
        <title>Reporte Diario</title>
        <style>
          body { font-family:Arial; margin:18px; color:#000; position:relative; padding:0; }
          .watermark { position:fixed; top:50%; left:50%; transform:translate(-50%, -50%) rotate(-45deg); font-size:120px; opacity:0.1; z-index:0; width:200%; height:200%; pointer-events:none; }
          .content { position:relative; z-index:1; }
          h1 { text-align:center; color:#8AA6A1; font-size:16px; margin:8px 0; }
          .logo-corner { position:absolute; top:0; right:0; width:70px; height:70px; object-fit:contain; object-position:top right; display:block; z-index:2; }
          table { width:100%; border-collapse:collapse; margin:12px 0; font-size:10px; }
          th, td { border:1px solid #ddd; padding:4px 6px; text-align:left; font-size:10px; }
          th { background-color:#f0f0f0; font-weight:bold; }
          .total { font-weight:bold; font-size:14px; }
          .summary { background-color:#f9f9f9; padding:12px; margin:12px 0; border-left:4px solid #8AA6A1; }
          .summary p { margin:4px 0; font-size:12px; }
        </style>
      </head>
      <body>
        <img src="data:image/png;base64,${logoBase64Data}" class="logo-corner" alt="Logo" />
        <div class="watermark">
          <img src="data:image/png;base64,${logoBase64Data}" style="width:100%;opacity:0.15;" />
        </div>
        <div class="content">
          <h1>Reporte Diario</h1>
          <div class="summary">
            <p><strong>Fecha:</strong> ${fecha.includes('-') ? fecha : new Date(fecha).toISOString().split('T')[0]}</p>
            <p><strong>Total de recibos:</strong> ${recibos.length}</p>
            <p class="total"><strong>Total dinero:</strong> $ ${total.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}</p>
          </div>
          
          <table>
            <thead>
              <tr>
                <th>Recibo NÂº</th>
                <th>Documento</th>
                <th>Cliente</th>
                <th>Servicios</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              ${recibosConDoc.map(r => {
                return `<tr>
                  <td>${escapeHtml(r.numero)}</td>
                  <td>${escapeHtml(r.doc)}</td>
                  <td>${escapeHtml(r.cliente)}</td>
                  <td>${escapeHtml(r.servicios)}</td>
                  <td>$ ${Number(r.total).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </body>
      </html>
    `;

    let browser = null;
    try {
      const launchOptions = getPuppeteerLaunchOptions();
      browser = await puppeteer.launch(launchOptions);
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const pdf = await page.pdf({
        format: 'A4',
        margin: { top: '10px', bottom: '10px', left: '10px', right: '10px' }
      });
      await browser.close();

      res.contentType('application/pdf');
      res.setHeader('Content-Disposition', `inline; filename=reporte_diario_${fecha}.pdf`);
      res.send(pdf);
    } catch(e) {
      if (browser) await browser.close().catch(() => {});
      console.error('Error en PDF:', e.message);
      res.status(500).json({ error: 'Error generando PDF: ' + e.message + '. Intenta instalar Google Chrome.' });
    }
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: 'Error generando reporte: ' + e.message });
  }
});

// Generar Reporte Mensual
app.get('/api/reportes/mensual', async (req, res) => {
  try {
    const mes = req.query.mes;
    if(!mes) return res.status(400).json({ error: 'Mes requerido' });
    
    const fechaInicio = mes + '-01';
    const proximoMes = new Date(mes + '-01');
    proximoMes.setMonth(proximoMes.getMonth() + 1);
    const fechaFin = proximoMes.toISOString().slice(0, 10);
    
    const recibos = await db.query('SELECT * FROM recibos WHERE fecha >= ? AND fecha < ? ORDER BY fecha DESC', [fechaInicio, fechaFin]);
    const total = recibos.reduce((sum, r) => sum + (Number(r.total) || 0), 0);
    // Extraer doc y servicios del JSON data de cada recibo
    const recibosConDoc = recibos.map(r => {
      let doc = '-';
      let servicios = '-';
      let fechaFormato = '-';
      
      // Formatear fecha a YYYY-MM-DD
      if (r.fecha) {
        let fechaStr = typeof r.fecha === 'string' ? r.fecha : String(r.fecha);
        
        // Si ya está en formato YYYY-MM-DD, usarlo directamente
        if (/^\d{4}-\d{2}-\d{2}$/.test(fechaStr)) {
          fechaFormato = fechaStr;
        } else {
          // Intentar parsear como Date
          try {
            const d = new Date(fechaStr);
            if (!isNaN(d.getTime())) {
              fechaFormato = d.toISOString().split('T')[0];
            }
          } catch (e) {
            // Si falla, dejar como '-'
          }
        }
      }
      
      try {
        const d = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
        if (d && d.doc != null) doc = String(d.doc);
        if (d && d.items && Array.isArray(d.items)) {
          servicios = d.items.map(item => item.desc || '').filter(s => s).join(', ') || '-';
        }
      } catch (e) { /* ignorar */ }
      return { ...r, doc, servicios, fechaFormato };
    });

    const logoBase64Data = getLogoBase64();

    const html = `
      <!doctype html>
      <html>
      <head>
        <meta charset="utf-8"/>
        <style>
          body { font-family:Arial; margin:18px; color:#000; position:relative; padding:0; }
          .watermark { position:fixed; top:50%; left:50%; transform:translate(-50%, -50%) rotate(-45deg); font-size:120px; opacity:0.1; z-index:0; width:200%; height:200%; pointer-events:none; }
          .content { position:relative; z-index:1; }
          h1 { text-align:center; color:#8AA6A1; font-size:16px; margin:8px 0; }
          .logo-corner { position:absolute; top:0; right:0; width:70px; height:70px; object-fit:contain; object-position:top right; display:block; z-index:2; }
          table { width:100%; border-collapse:collapse; margin:12px 0; font-size:10px; }
          th, td { border:1px solid #ddd; padding:4px 6px; text-align:left; font-size:10px; }
          th { background-color:#f0f0f0; font-weight:bold; }
          .total { font-weight:bold; font-size:14px; }
          .summary { background-color:#f9f9f9; padding:12px; margin:12px 0; border-left:4px solid #8AA6A1; }
          .summary p { margin:4px 0; font-size:12px; }
        </style>
      </head>
      <body>
        <img src="data:image/png;base64,${logoBase64Data}" class="logo-corner" alt="Logo" />
        <div class="watermark">
          <img src="data:image/png;base64,${logoBase64Data}" style="width:100%;opacity:0.15;" />
        </div>
        <div class="content">
          <h1>Reporte Mensual</h1>
          <div class="summary">
            <p><strong>Mes:</strong> ${mes}</p>
            <p><strong>Total de recibos:</strong> ${recibos.length}</p>
            <p class="total"><strong>Total dinero:</strong> $ ${total.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}</p>
          </div>
          
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Recibo NÂº</th>
                <th>Documento</th>
                <th>Cliente</th>
                <th>Servicios</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              ${recibosConDoc.map(r => {
                return `<tr>
                  <td>${escapeHtml(r.fechaFormato)}</td>
                  <td>${escapeHtml(r.numero)}</td>
                  <td>${escapeHtml(r.doc)}</td>
                  <td>${escapeHtml(r.cliente)}</td>
                  <td>${escapeHtml(r.servicios)}</td>
                  <td>$ ${Number(r.total).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </body>
      </html>
    `;

    let browser = null;
    try {
      const launchOptions = getPuppeteerLaunchOptions();
      browser = await puppeteer.launch(launchOptions);
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const pdf = await page.pdf({
        format: 'A4',
        margin: { top: '18px', bottom: '18px', left: '18px', right: '18px' }
      });
      await browser.close();

      res.contentType('application/pdf');
      res.setHeader('Content-Disposition', `inline; filename=reporte_mensual_${mes}.pdf`);
      res.send(pdf);
    } catch(e) {
      if (browser) await browser.close().catch(() => {});
      console.error('Error en PDF:', e.message);
      res.status(500).json({ error: 'Error generando PDF. Verifica que Puppeteer esté instalado.' });
    }
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: 'Error generando reporte: ' + e.message });
  }
});

// ðŸ“Š Dashboard Auditoría de Citas - Ver quién agendó cada cita
app.get('/api/dashboard/citas-auditoria', requireAuth, requireRole(['superadmin', 'admin', 'admin_recepcion', 'recepcion', 'admin_electro', 'electro']), async (req, res) => {
  try {
    const { tipo_cita, fecha_desde, fecha_hasta, programado_por, tipo_estudio } = req.query;
    
    // Construir consultas para ambas tablas
    const citasMedicas = await db.query(`
      SELECT 
        t.id,
        t.fecha,
        t.hora,
        t.paciente_documento,
        t.paciente_nombre,
        t.tipo_consulta,
        t.programado_por,
        t.doctor_id,
        t.estado,
        'AGENDA_MEDICA' as tipo_cita,
        t.numero_turno
      FROM turnos t
      WHERE 1=1
        ${fecha_desde ? 'AND t.fecha >= ?' : ''}
        ${fecha_hasta ? 'AND t.fecha <= ?' : ''}
        ${programado_por ? 'AND t.programado_por LIKE ?' : ''}
      ORDER BY t.fecha DESC, t.hora DESC
    `, [
      ...(fecha_desde ? [fecha_desde] : []),
      ...(fecha_hasta ? [fecha_hasta] : []),
      ...(programado_por ? [`%${programado_por}%`] : [])
    ]);

    const citasElectro = await db.query(`
      SELECT 
        ce.id,
        ce.fecha,
        ce.hora_agendamiento as hora,
        p.documento as paciente_documento,
        p.nombre as paciente_nombre,
        ce.estudio as tipo_consulta,
        ce.programado_por_nombre as programado_por,
        ce.equipo_id as doctor_id,
        ce.estado,
        'ELECTRODIAGNOSTICO' as tipo_cita,
        'N/A' as numero_turno
      FROM citas_electro ce
      LEFT JOIN pacientes p ON p.id = ce.paciente_id
      WHERE 1=1
        ${fecha_desde ? 'AND ce.fecha >= ?' : ''}
        ${fecha_hasta ? 'AND ce.fecha <= ?' : ''}
        ${programado_por ? 'AND ce.programado_por_nombre LIKE ?' : ''}
        ${tipo_estudio ? 'AND ce.estudio = ?' : ''}
      ORDER BY ce.fecha DESC, ce.hora_agendamiento DESC
    `, [
      ...(fecha_desde ? [fecha_desde] : []),
      ...(fecha_hasta ? [fecha_hasta] : []),
      ...(programado_por ? [`%${programado_por}%`] : []),
      ...(tipo_estudio ? [tipo_estudio] : [])
    ]);

    // Combinar y filtrar por tipo_cita si viene en el query
    let citas = [...citasMedicas, ...citasElectro];
    
    if (tipo_cita && tipo_cita !== 'TODOS') {
      citas = citas.filter(c => c.tipo_cita === tipo_cita);
    }

    // Ordenar por fecha descendente
    citas.sort((a, b) => {
      const fechaA = new Date(a.fecha);
      const fechaB = new Date(b.fecha);
      return fechaB - fechaA;
    });

    logger.info('Dashboard auditoría citas', {
      usuario: req.session && req.session.usuario ? req.session.usuario : 'Unknown',
      total_citas: citas.length,
      medicas: citasMedicas.length,
      electro: citasElectro.length
    });

    res.json({
      success: true,
      data: citas,
      resumen: {
        total_citas: citas.length,
        citas_medicas: citasMedicas.length,
        citas_electrodiagnostico: citasElectro.length,
        agendadores: [...new Set(citas.map(c => c.programado_por))].filter(p => p)
      }
    });
  } catch(e) {
    logger.error('Error en dashboard auditoría', { error: e.message, stack: e.stack });
    res.status(500).json({ error: 'Error al cargar auditoría de citas: ' + e.message });
  }
});

// ï¿½ï¸ Módulo de eliminación de registros (solo superadmin)
// GET /api/estudios/lista - lista pública de tipos de estudio (accesible a todos los roles)
app.get('/api/estudios/lista', requireAuth, async (req, res) => {
  try {
    const rows = await db.query('SELECT id, nombre FROM estudio_duraciones ORDER BY nombre ASC');
    res.json({ ok: true, registros: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/datos/:tipo - listar registros de un tipo
app.get('/api/admin/datos/:tipo', requireAuth, requireAdmin, async (req, res) => {
  try {
    const tipo = req.params.tipo;
    const { q, fecha_desde, fecha_hasta, limit: reqLimit } = req.query;
    const limit = Math.min(parseInt(reqLimit) || 100, 500);
    let rows = [];

    if (tipo === 'citas_electro') {
      let where = 'WHERE (ce.deleted_at IS NULL OR ce.deleted_at IS NOT NULL)';
      const params = [];
      if (q) { where += ' AND (p.nombre LIKE ? OR p.documento LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
      if (fecha_desde) { where += ' AND ce.fecha >= ?'; params.push(fecha_desde); }
      if (fecha_hasta) { where += ' AND ce.fecha <= ?'; params.push(fecha_hasta); }
      rows = await db.query(`
        SELECT ce.id, p.nombre AS paciente_nombre, p.documento, ce.fecha,
               ce.hora_agendamiento AS hora, ce.estudio, ce.estado, ce.creado_en
        FROM citas_electro ce LEFT JOIN pacientes p ON p.id=ce.paciente_id
        ${where} ORDER BY ce.fecha DESC, ce.creado_en DESC LIMIT ${limit}`, params);
    } else if (tipo === 'turnos') {
      let where = 'WHERE 1=1';
      const params = [];
      if (q) { where += ' AND (t.paciente_nombre LIKE ? OR t.paciente_documento LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
      if (fecha_desde) { where += ' AND t.fecha >= ?'; params.push(fecha_desde); }
      if (fecha_hasta) { where += ' AND t.fecha <= ?'; params.push(fecha_hasta); }
      rows = await db.query(`
        SELECT t.id, t.paciente_nombre, t.paciente_documento AS documento,
               t.fecha, t.hora, t.tipo_consulta AS tipo, t.estado, t.creado_en
        FROM turnos t ${where} ORDER BY t.fecha DESC, t.creado_en DESC LIMIT ${limit}`, params);
    } else if (tipo === 'recibos') {
      let where = 'WHERE 1=1';
      const params = [];
      if (q) { where += ' AND (cliente LIKE ? OR numero LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
      if (fecha_desde) { where += ' AND fecha >= ?'; params.push(fecha_desde); }
      if (fecha_hasta) { where += ' AND fecha <= ?'; params.push(fecha_hasta); }
      rows = await db.query(`
        SELECT id, numero, cliente, fecha, total, tipo_pago, generado_por_nombre AS creado_por, creado_en
        FROM recibos ${where} ORDER BY id DESC LIMIT ${limit}`, params);
    } else if (tipo === 'estudio_duraciones') {
      rows = await db.query('SELECT id, nombre, duracion_minutos FROM estudio_duraciones ORDER BY nombre ASC');
    } else if (tipo === 'especialidades') {
      rows = await db.query('SELECT id, nombre, activo FROM especialidades ORDER BY nombre ASC');
    } else if (tipo === 'tipos_consulta') {
      rows = await db.query(`
        SELECT tc.id, tc.nombre, e.nombre AS especialidad, tc.activo
        FROM tipos_consulta tc LEFT JOIN especialidades e ON e.id=tc.especialidad_id
        ORDER BY e.nombre ASC, tc.nombre ASC`);
    } else if (tipo === 'diagnosticos') {
      let where = 'WHERE 1=1';
      const params = [];
      if (q) { where += ' AND nombre LIKE ?'; params.push(`%${q}%`); }
      rows = await db.query(`SELECT id, nombre, codigo, activo FROM diagnosticos ${where} ORDER BY nombre ASC LIMIT ${limit}`, params);
    } else {
      return res.status(400).json({ error: 'Tipo no válido' });
    }
    res.json({ ok: true, registros: rows });
  } catch (e) {
    console.error('[ADMIN DELETE]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/datos/:tipo - crear registro en catalogos
app.post('/api/admin/datos/:tipo', requireAuth, requireAdmin, async (req, res) => {
  try {
    const tipo = req.params.tipo;
    const body = req.body || {};
    if (tipo === 'estudio_duraciones') {
      const { nombre, duracion_minutos } = body;
      if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
      const dur = parseInt(duracion_minutos, 10);
      if (isNaN(dur) || dur <= 0) return res.status(400).json({ error: 'La duracion debe ser un numero positivo' });
      const result = await db.execute(
        'INSERT INTO estudio_duraciones (nombre, duracion_minutos) VALUES (?,?)',
        [nombre.trim(), dur]
      );
      if (app.io) emitSocket('estudio:creado', { id: result.insertId });
      res.json({ ok: true, id: result.insertId });
    } else if (tipo === 'especialidades') {
      const { nombre } = body;
      if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
      const result = await db.execute('INSERT INTO especialidades (nombre) VALUES (?)', [nombre.trim()]);
      res.json({ ok: true, id: result.insertId });
    } else if (tipo === 'tipos_consulta') {
      const { especialidad_id, nombre } = body;
      if (!especialidad_id || !nombre || !nombre.trim())
        return res.status(400).json({ error: 'Especialidad y nombre son obligatorios' });
      const ordenRows = await db.query(
        'SELECT COALESCE(MAX(orden)+1, 0) AS sig FROM tipos_consulta WHERE especialidad_id=?',
        [especialidad_id]
      );
      const orden = ordenRows[0]?.sig ?? 0;
      const result = await db.execute(
        'INSERT INTO tipos_consulta (especialidad_id, nombre, orden) VALUES (?,?,?)',
        [especialidad_id, nombre.trim(), orden]
      );
      emitSocket('tipos-consulta:actualizado', { especialidad_id });
      res.json({ ok: true, id: result.insertId });
    } else if (tipo === 'diagnosticos') {
      const { nombre, descripcion, codigo } = body;
      if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
      const result = await db.execute(
        'INSERT INTO diagnosticos (nombre, descripcion, codigo, activo) VALUES (?,?,?,1)',
        [nombre.trim(), descripcion || null, codigo || null]
      );
      res.json({ ok: true, id: result.insertId });
    } else {
      res.status(400).json({ error: 'Tipo no soportado para agregar' });
    }
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ya existe un registro con ese nombre' });
    res.status(500).json({ error: e.message });
  }
});

// ðŸ—‘ï¸ Eliminar en bloque (hasta 50 registros)
app.delete('/api/admin/datos/:tipo/bulk', requireAuth, requireAdmin, async (req, res) => {
  try {
    const tipo = req.params.tipo;
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids requerido' });
    if (ids.length > 50) return res.status(400).json({ error: 'Máximo 50 registros por vez' });
    const tablaMap = {
      citas_electro: 'citas_electro', turnos: 'turnos', recibos: 'recibos',
      estudio_duraciones: 'estudio_duraciones', especialidades: 'especialidades',
      tipos_consulta: 'tipos_consulta', diagnosticos: 'diagnosticos'
    };
    if (!tablaMap[tipo]) return res.status(400).json({ error: 'Tipo no válido' });
    const tabla = tablaMap[tipo];
    const placeholders = ids.map(() => '?').join(',');
    const result = await db.execute(`DELETE FROM ${tabla} WHERE id IN (${placeholders})`, ids);
    res.json({ ok: true, eliminados: result.affectedRows });
  } catch (e) {
    console.error('[ADMIN BULK DELETE]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/admin/datos/:tipo/:id - eliminar un registro
app.delete('/api/admin/datos/:tipo/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const tipo = req.params.tipo;
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

    let affected = 0;
    if (tipo === 'citas_electro') {
      const result = await db.execute('DELETE FROM citas_electro WHERE id=?', [id]);
      affected = result.affectedRows;
      if (affected > 0 && app.io) emitSocket('electro:cita-eliminada', { id });
    } else if (tipo === 'turnos') {
      const result = await db.execute('DELETE FROM turnos WHERE id=?', [id]);
      affected = result.affectedRows;
    } else if (tipo === 'recibos') {
      const result = await db.execute('DELETE FROM recibos WHERE id=?', [id]);
      affected = result.affectedRows;
      if (affected > 0 && app.io) { emitSocket('recibo:eliminado', { id }); emitSocket('recibo:actualizar-lista'); }
    } else if (tipo === 'estudio_duraciones') {
      const result = await db.execute('DELETE FROM estudio_duraciones WHERE id=?', [id]);
      affected = result.affectedRows;
    } else if (tipo === 'especialidades') {
      const result = await db.execute('DELETE FROM especialidades WHERE id=?', [id]);
      affected = result.affectedRows;
    } else if (tipo === 'tipos_consulta') {
      const result = await db.execute('DELETE FROM tipos_consulta WHERE id=?', [id]);
      affected = result.affectedRows;
    } else if (tipo === 'diagnosticos') {
      const result = await db.execute('DELETE FROM diagnosticos WHERE id=?', [id]);
      affected = result.affectedRows;
    } else {
      return res.status(400).json({ error: 'Tipo no válido' });
    }

    if (affected === 0) return res.status(404).json({ error: 'Registro no encontrado' });

    // Registrar en auditoría
    await auditLog.registrarAuditoria({
      usuarioId: req.session.usuarioId, adminId: req.session.usuarioId,
      adminUsuario: req.session.usuario, accion: 'ELIMINAR',
      cambios: { tipo, id }, ip: req.ip
    });

    res.json({ ok: true });
  } catch (e) {
    console.error('[ADMIN DELETE]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ï¿½ðŸ“„ PDF de Agenda del Doctor - Descargar agenda de pacientes
app.post('/api/agenda/pdf', requireAuth, jsonLargeBody, async (req, res) => {
  try {
    const { doctor_id, fecha_inicio, fecha_fin } = req.body;
    const userId = req.session.usuarioId;
    const userRol = req.session.rol;
    
    // Validar permisos: superadmin, admin_recepcion (y equivalentes) o el doctor mismo
    if (!isRecepcionRol(userRol) && !isAdminRol(userRol)) {
      // Si es doctor, solo puede ver su propia agenda
      if (userId !== parseInt(doctor_id)) {
        return res.status(403).json({ error: 'No tienes permiso para ver esta agenda' });
      }
    }
    
    // Obtener información del doctor desde usuarios
    const doctorData = await db.query(
      'SELECT nombre, usuario, numero_consultorio FROM usuarios WHERE id = ?',
      [doctor_id]
    );
    
    if (!doctorData || !doctorData.length) {
      return res.status(404).json({ error: 'Doctor no encontrado' });
    }
    
    const doctor = doctorData[0];
    const nombredoctor = doctor.nombre || doctor.usuario;
    const consultorio = doctor.numero_consultorio || 'N/A';
    
    // Determinar rango de fechas (mes actual por defecto)
    let desde = fecha_inicio;
    let hasta = fecha_fin;
    
    if (!desde || !hasta) {
      const hoy = new Date();
      desde = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().split('T')[0];
      hasta = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).toISOString().split('T')[0];
    }
    
    // Obtener citas del doctor en ese período (excluir canceladas y completadas)
    const citas = await db.query(`
      SELECT 
        t.fecha,
        t.hora,
        t.paciente_nombre,
        t.paciente_documento,
        t.paciente_telefono,
        t.tipo_consulta,
        t.estado,
        t.numero_turno
      FROM turnos t
      WHERE t.doctor_id = ? AND t.fecha BETWEEN ? AND ? AND t.estado NOT IN ('CANCELADO', 'COMPLETADO')
      ORDER BY t.fecha ASC, t.hora ASC
    `, [doctor_id, desde, hasta]);
    
    // Agrupar por fecha
    const citasPorFecha = {};
    citas.forEach(cita => {
      if (!citasPorFecha[cita.fecha]) {
        citasPorFecha[cita.fecha] = [];
      }
      citasPorFecha[cita.fecha].push(cita);
    });
    
    // Obtener logo en base64
    const logoPath = path.join(__dirname, 'public', 'images', 'logo1.png');
    let logoBase64Data = '';
    if (fs.existsSync(logoPath)) {
      const logoBuffer = fs.readFileSync(logoPath);
      logoBase64Data = logoBuffer.toString('base64');
    }
    
    // Formatear fechas
    const fechaDesdeFormato = new Date(desde).toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' });
    const fechaHastaFormato = new Date(hasta).toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' });
    
    // Generar HTML
    const html = `
      <!doctype html>
      <html>
      <head>
        <meta charset="utf-8"/>
        <title>Agenda - ${nombredoctor}</title>
        <style>
          body { font-family:Arial; margin:18px; color:#000; position:relative; padding:0; }
          .watermark { position:fixed; top:50%; left:50%; transform:translate(-50%, -50%) rotate(-45deg); font-size:100px; opacity:0.08; z-index:0; width:200%; height:200%; pointer-events:none; }
          .content { position:relative; z-index:1; }
          .header { text-align:center; margin-bottom:24px; padding-bottom:16px; border-bottom:2px solid #8AA6A1; }
          .logo-corner { width:120px; height:120px; object-fit:contain; display:block; margin:0 auto 12px auto; }
          .doctor-info { background-color:#f0f9ff; padding:12px; border-left:4px solid #8AA6A1; margin-bottom:16px; border-radius:4px; }
          .doctor-info p { margin:4px 0; font-size:11px; }
          .fecha-section { margin-bottom:20px; page-break-inside:avoid; }
          .fecha-titulo { background-color:#8AA6A1; color:white; padding:8px 12px; font-weight:bold; margin-bottom:8px; border-radius:4px; }
          table { width:100%; border-collapse:collapse; margin-bottom:16px; font-size:9px; }
          th { background-color:#e0e7e6; border:1px solid #bbb; padding:6px 4px; text-align:left; font-weight:bold; }
          td { border:1px solid #ddd; padding:4px 6px; text-align:left; }
          .estado-pendiente { color:#f59e0b; font-weight:600; }
          .estado-completado { color:#10b981; font-weight:600; }
          .estado-en-atencion { color:#3b82f6; font-weight:600; }
          .footer { text-align:center; margin-top:24px; padding-top:12px; border-top:1px solid #ddd; font-size:9px; color:#666; }
          .no-data { text-align:center; padding:20px; color:#999; font-style:italic; }
        </style>
      </head>
      <body>
        <div class="watermark">AGENDA</div>
        <div class="content">
          <div class="header">
            ${logoBase64Data ? `<img src="data:image/png;base64,${logoBase64Data}" class="logo-corner" alt="Logo" />` : ''}
            <h1 style="margin:0 0 6px 0; color:#8AA6A1; font-size:14px">AGENDA DE PACIENTES</h1>
            <p style="margin:0; font-size:11px; color:#666">${nombredoctor}</p>
          </div>
          
          <div class="doctor-info">
            <p><strong>Doctor:</strong> ${escapeHtml(nombredoctor)}</p>
            <p><strong>Consultorio:</strong> ${escapeHtml(consultorio)}</p>
            <p><strong>Período:</strong> ${fechaDesdeFormato} al ${fechaHastaFormato}</p>
            <p><strong>Total de citas:</strong> ${citas.length}</p>
          </div>
          
          ${Object.keys(citasPorFecha).length > 0 ? Object.entries(citasPorFecha).map(([fecha, citasDelDia]) => {
            const fechaObj = new Date(fecha);
            const fechaFormato = fechaObj.toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
            return `
              <div class="fecha-section">
                <div class="fecha-titulo">${fechaFormato.charAt(0).toUpperCase() + fechaFormato.slice(1)} (${citasDelDia.length} pacientes)</div>
                <table>
                  <thead>
                    <tr>
                      <th>Hora</th>
                      <th>NÂº Turno</th>
                      <th>Paciente</th>
                      <th>Documento</th>
                      <th>Teléfono</th>
                      <th>Tipo Consulta</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${citasDelDia.map(c => {
                      return `
                        <tr>
                          <td>${c.hora ? c.hora.substring(0, 5) : '-'}</td>
                          <td>${c.numero_turno || '-'}</td>
                          <td>${escapeHtml(c.paciente_nombre || '-')}</td>
                          <td>${escapeHtml(c.paciente_documento || '-')}</td>
                          <td>${escapeHtml(c.paciente_telefono || '-')}</td>
                          <td>${escapeHtml(c.tipo_consulta || '-')}</td>
                        </tr>
                      `;
                    }).join('')}
                  </tbody>
                </table>
              </div>
            `;
          }).join('')
          : `<div class="no-data">No hay citas registradas para este período</div>`}
          
          <div class="footer">
            <p>Generado: ${new Date().toLocaleDateString('es-ES')} - Instituto Neurociencias de Nariño S.A.S.</p>
          </div>
        </div>
      </body>
      </html>
    `;
    
    // Generar PDF
    let browser = null;
    try {
      const launchOptions = getPuppeteerLaunchOptions();
      browser = await puppeteer.launch(launchOptions);
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const pdf = await page.pdf({
        format: 'A4',
        margin: { top: '12px', bottom: '12px', left: '12px', right: '12px' }
      });
      await browser.close();
      
      logger.info('PDF Agenda generado', {
        doctor_id: doctor_id,
        total_citas: citas.length,
        usuario: req.session.usuario
      });
      
      res.contentType('application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=agenda_${nombredoctor.replace(/\s+/g, '_')}_${desde}.pdf`);
      res.send(pdf);
    } catch(e) {
      if (browser) await browser.close().catch(() => {});
      logger.error('Error generando PDF agenda', { error: e.message });
      res.status(500).json({ error: 'Error generando PDF: ' + e.message });
    }
  } catch(e) {
    logger.error('Error en endpoint agenda PDF', { error: e.message, stack: e.stack });
    res.status(500).json({ error: 'Error: ' + e.message });
  }
});

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const PORT = process.env.PORT || 3000;

// Inicializar pool MySQL y luego iniciar servidor
(async () => {
  try {
    await db.initPool();

    // Aplicar índices de rendimiento en background (no bloquea el arranque)
    const { migrations } = require('./migrations/db-migrations');
    const perfMigration = migrations.find(m => m.name === 'performance_indexes');
    if (perfMigration) {
      const stmts = Array.isArray(perfMigration.sql) ? perfMigration.sql : [perfMigration.sql];
      Promise.all(stmts.map(s => db.execute(s).catch(() => {})))
        .then(() => logger.info('[STARTUP] Índices de rendimiento verificados', { type: 'STARTUP' }));
    }

    // â”€â”€â”€ Inicializar tabla de servicios â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    try {
      await db.execute(`CREATE TABLE IF NOT EXISTS servicios_recibo (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nombre VARCHAR(300) NOT NULL UNIQUE,
        activo TINYINT DEFAULT 1,
        creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      const svcRows = await db.query('SELECT COUNT(*) AS n FROM servicios_recibo');
      if (svcRows[0].n === 0) {
        const defaults = [
          'Electroencefalograma Computarizado',
          'Electroencefalograma Convencional',
          'Monitorización Electroencefalográfica por video y radio',
          'Polisomnografía',
          'Polisomnograma en Titulación de CPAP/BPAP',
          'Test de Latencia Múltiple',
          'Polisomnograma Noche Dividida'
        ];
        for (const nombre of defaults) {
          await db.execute('INSERT IGNORE INTO servicios_recibo (nombre) VALUES (?)', [nombre]);
        }
        logger.info('[STARTUP] Tabla servicios_recibo creada y poblada con valores por defecto', { type: 'STARTUP' });
      } else {
        logger.info('[STARTUP] Tabla servicios_recibo lista', { type: 'STARTUP' });
      }
    } catch (svcErr) {
      logger.warn('[STARTUP] Error inicializando servicios_recibo: ' + svcErr.message, { type: 'STARTUP' });
    }
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    // â”€â”€â”€ Auto-migraciones al inicio â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Agregar columna deleted_at a citas_electro si no existe (soft-delete)
    // Compatible con MySQL 5.x y 8.x
    try {
      const colRows = await db.query(
        `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME   = 'citas_electro'
           AND COLUMN_NAME  = 'deleted_at'`
      );
      if (!colRows || !colRows[0] || colRows[0].cnt === 0) {
        await db.execute(
          `ALTER TABLE citas_electro ADD COLUMN deleted_at DATETIME DEFAULT NULL`
        );
        logger.info('[MIGRATION] Columna citas_electro.deleted_at agregada', { type: 'STARTUP' });
      } else {
        logger.info('[MIGRATION] citas_electro.deleted_at ya existe, sin cambios', { type: 'STARTUP' });
      }
    } catch (migErr) {
      logger.warn('[MIGRATION] Advertencia en migración deleted_at: ' + migErr.message, { type: 'STARTUP' });
    }
    // â”€â”€â”€ Migración: paciente_telefono2 en turnos â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    try {
      const colTel2Turnos = await db.query(
        `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME   = 'turnos'
           AND COLUMN_NAME  = 'paciente_telefono2'`
      );
      if (!colTel2Turnos || !colTel2Turnos[0] || colTel2Turnos[0].cnt === 0) {
        await db.execute(`ALTER TABLE turnos ADD COLUMN paciente_telefono2 VARCHAR(20) DEFAULT NULL AFTER paciente_telefono`);
        logger.info('[MIGRATION] Columna turnos.paciente_telefono2 agregada', { type: 'STARTUP' });
      }
    } catch (migErr) {
      logger.warn('[MIGRATION] Advertencia en migración turnos.paciente_telefono2: ' + migErr.message, { type: 'STARTUP' });
    }
    // â”€â”€â”€ Migración: telefono2 en pacientes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    try {
      const colTel2Pac = await db.query(
        `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME   = 'pacientes'
           AND COLUMN_NAME  = 'telefono2'`
      );
      if (!colTel2Pac || !colTel2Pac[0] || colTel2Pac[0].cnt === 0) {
        await db.execute(`ALTER TABLE pacientes ADD COLUMN telefono2 VARCHAR(20) DEFAULT NULL AFTER telefono`);
        logger.info('[MIGRATION] Columna pacientes.telefono2 agregada', { type: 'STARTUP' });
      }
    } catch (migErr) {
      logger.warn('[MIGRATION] Advertencia en migración pacientes.telefono2: ' + migErr.message, { type: 'STARTUP' });
    }
    // ─── Migración: permisos en usuarios ──────────────────────────────────────
    try {
      const colPermisos = await db.query(
        `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME   = 'usuarios'
           AND COLUMN_NAME  = 'permisos'`
      );
      if (!colPermisos || !colPermisos[0] || colPermisos[0].cnt === 0) {
        await db.execute(`ALTER TABLE usuarios ADD COLUMN permisos JSON DEFAULT NULL`);
        logger.info('[MIGRATION] Columna usuarios.permisos agregada', { type: 'STARTUP' });
      }
    } catch (migErr) {
      logger.warn('[MIGRATION] Advertencia en migración usuarios.permisos: ' + migErr.message, { type: 'STARTUP' });
    }

    // ─── Migración: ultimo_acceso en usuarios ────────────────────────────────
    try {
      const colUltAcc = await db.query(
        `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME   = 'usuarios'
           AND COLUMN_NAME  = 'ultimo_acceso'`
      );
      if (!colUltAcc || !colUltAcc[0] || colUltAcc[0].cnt === 0) {
        await db.execute(`ALTER TABLE usuarios ADD COLUMN ultimo_acceso DATETIME DEFAULT NULL`);
        logger.info('[MIGRATION] Columna usuarios.ultimo_acceso agregada', { type: 'STARTUP' });
      }
    } catch (migErr) {
      logger.warn('[MIGRATION] Advertencia en migración usuarios.ultimo_acceso: ' + migErr.message, { type: 'STARTUP' });
    }

    // --- Migracion: convertir usuario 'admin' legacy a 'superadmin' ----------
    try {
      const existingSuperadmin = await db.query("SELECT COUNT(*) AS cnt FROM usuarios WHERE rol = 'superadmin'");
      if (existingSuperadmin?.[0]?.cnt === 0) {
        const legacyAdmin = await db.queryOne("SELECT id FROM usuarios WHERE usuario = 'admin' AND rol = 'admin'");
        if (legacyAdmin) {
          await db.execute("UPDATE usuarios SET rol = 'superadmin', nombre = 'Super Administrador' WHERE id = ?", [legacyAdmin.id]);
          logger.info('[MIGRATION] Usuario admin convertido a superadmin', { type: 'STARTUP' });
        }
      }
    } catch (migErr) {
      logger.warn('[MIGRATION] Advertencia en migracion admin->superadmin: ' + migErr.message, { type: 'STARTUP' });
    }
    // ─── Migración: ENUM rol en usuarios (agregar nuevos roles) ─────────────
    try {
      const enumRow = await db.query(
        `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME   = 'usuarios'
           AND COLUMN_NAME  = 'rol'`
      );
      const currentEnum = enumRow?.[0]?.COLUMN_TYPE || '';
      if (!currentEnum.includes('superadmin') || !currentEnum.includes('admin_recepcion') || !currentEnum.includes('auxiliar_recepcion')) {
        await db.execute(
          `ALTER TABLE usuarios MODIFY COLUMN rol ENUM('doctor','recepcion','admin','electro','contabilidad','superadmin','admin_recepcion','admin_electro','tecnico_electro','auxiliar_recepcion') NOT NULL DEFAULT 'auxiliar_recepcion'`
        );
        logger.info('[MIGRATION] ENUM rol de usuarios actualizado con nuevos roles', { type: 'STARTUP' });
      }
    } catch (migErr) {
      logger.warn('[MIGRATION] Advertencia en migración ENUM rol: ' + migErr.message, { type: 'STARTUP' });
    }
    // ─── Migración: tabla pacientes_espera ───────────────────────────────────
    try {
      const tblEspera = await db.query(
        `SELECT COUNT(*) AS cnt FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME   = 'pacientes_espera'`
      );
      if (!tblEspera || !tblEspera[0] || tblEspera[0].cnt === 0) {
        await db.execute(`
          CREATE TABLE pacientes_espera (
            id           INT AUTO_INCREMENT PRIMARY KEY,
            documento    VARCHAR(20)  NOT NULL,
            nombres      VARCHAR(100) NOT NULL,
            apellidos    VARCHAR(100) NOT NULL,
            entidad      VARCHAR(50)  NOT NULL,
            prioridad    ENUM('ALTA','MEDIA','BAJA') NOT NULL DEFAULT 'MEDIA',
            ingresado_por VARCHAR(100) DEFAULT NULL,
            creado_en    TIMESTAMP   DEFAULT CURRENT_TIMESTAMP
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
        logger.info('[MIGRATION] Tabla pacientes_espera creada', { type: 'STARTUP' });
      } else {
        // Migración: agregar columnas nuevas si no existen
        const colsEspera = await db.query(
          `SELECT COLUMN_NAME FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pacientes_espera'`
        );
        const colNamesEspera = colsEspera.map(c => c.COLUMN_NAME);
        if (!colNamesEspera.includes('telefono1')) {
          await db.execute(`ALTER TABLE pacientes_espera ADD COLUMN telefono1 VARCHAR(20) DEFAULT NULL`);
          logger.info('[MIGRATION] Columna telefono1 agregada a pacientes_espera', { type: 'STARTUP' });
        }
        if (!colNamesEspera.includes('telefono2')) {
          await db.execute(`ALTER TABLE pacientes_espera ADD COLUMN telefono2 VARCHAR(20) DEFAULT NULL`);
          logger.info('[MIGRATION] Columna telefono2 agregada a pacientes_espera', { type: 'STARTUP' });
        }
        if (!colNamesEspera.includes('tipo_estudio')) {
          await db.execute(`ALTER TABLE pacientes_espera ADD COLUMN tipo_estudio VARCHAR(100) DEFAULT NULL`);
          logger.info('[MIGRATION] Columna tipo_estudio agregada a pacientes_espera', { type: 'STARTUP' });
        }
      }
    } catch (migErr) {
      logger.warn('[MIGRATION] Error creando tabla pacientes_espera: ' + migErr.message, { type: 'STARTUP' });
    }
    // â”€â”€â”€ Migración: tabla especialidades â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    try {
      const tblEsp = await db.query(
        `SELECT COUNT(*) AS cnt FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'especialidades'`
      );
      if (!tblEsp || !tblEsp[0] || tblEsp[0].cnt === 0) {
        await db.execute(`
          CREATE TABLE especialidades (
            id        INT AUTO_INCREMENT PRIMARY KEY,
            nombre    VARCHAR(100) NOT NULL,
            activo    TINYINT(1) NOT NULL DEFAULT 1,
            creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uk_esp_nombre (nombre)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
        logger.info('[MIGRATION] Tabla especialidades creada', { type: 'STARTUP' });
        const seedEsp = ['Neurología', 'Epileptología', 'Psicología', 'Neuropsicología', 'Psiquiatría'];
        for (const nombre of seedEsp) {
          await db.execute('INSERT IGNORE INTO especialidades (nombre) VALUES (?)', [nombre]);
        }
        logger.info('[MIGRATION] Especialidades sembradas', { type: 'STARTUP' });
      }
    } catch (migErr) {
      logger.warn('[MIGRATION] Error creando tabla especialidades: ' + migErr.message, { type: 'STARTUP' });
    }
    // â”€â”€â”€ Migración: tabla tipos_consulta â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    try {
      const tblTc = await db.query(
        `SELECT COUNT(*) AS cnt FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tipos_consulta'`
      );
      if (!tblTc || !tblTc[0] || tblTc[0].cnt === 0) {
        await db.execute(`
          CREATE TABLE tipos_consulta (
            id              INT AUTO_INCREMENT PRIMARY KEY,
            especialidad_id INT NOT NULL,
            nombre          VARCHAR(200) NOT NULL,
            orden           INT NOT NULL DEFAULT 0,
            activo          TINYINT(1) NOT NULL DEFAULT 1,
            FOREIGN KEY (especialidad_id) REFERENCES especialidades(id) ON DELETE CASCADE
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
        logger.info('[MIGRATION] Tabla tipos_consulta creada', { type: 'STARTUP' });
        const tiposPorEsp = {
          'Neurología':     ['Consulta de Primera Vez por Neurología','Consulta de Control por Neurología','Consulta Virtual de Primera Vez por Neurología','Consulta Virtual de Control por Neurología','Aplicación de Toxina Botulínica (Botox)','Control de Toxina Botulínica (Botox)','Actigrafía','Rev. Neuroestimulador','Agente Anestésico','Particular','Otra'],
          'Epileptología':  ['Consulta de Primera Vez por Epileptología','Consulta de Control por Epileptología','Consulta Virtual de Primera Vez por Epileptología','Consulta Virtual de Control por Epileptología','Consulta de Primera Vez por Neurología','Consulta de Control por Neurología','Consulta Virtual de Primera Vez por Neurología','Consulta Virtual de Control por Neurología','Aplicación de Toxina Botulínica (Botox)','Control de Toxina Botulínica (Botox)','Actigrafía','Rev. Neuroestimulador','Bloqueo Mioneural','Particular','Otra'],
          'Psicología':     ['Consulta de Primera Vez por Psicología','Consulta de Control por Psicología','Otra'],
          'Neuropsicología':['Consulta de Primera Vez por Neuropsicología','Consulta de Control por Neuropsicología','Otra'],
          'Psiquiatría':    ['Consulta de Primera Vez por Psiquiatría','Consulta de Control por Psiquiatría','Otra'],
        };
        for (const [espNombre, tipos] of Object.entries(tiposPorEsp)) {
          const espRows = await db.query('SELECT id FROM especialidades WHERE nombre = ?', [espNombre]);
          if (espRows && espRows.length > 0) {
            const espId = espRows[0].id;
            for (let i = 0; i < tipos.length; i++) {
              await db.execute(
                'INSERT INTO tipos_consulta (especialidad_id, nombre, orden) VALUES (?,?,?)',
                [espId, tipos[i], i]
              );
            }
          }
        }
        logger.info('[MIGRATION] Tipos de consulta sembrados', { type: 'STARTUP' });
      }
    } catch (migErr) {
      logger.warn('[MIGRATION] Error creando tabla tipos_consulta: ' + migErr.message, { type: 'STARTUP' });
    }
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Detectar certificado autofirmado y usar HTTPS si está configurado
    // NOTA: Deshabilitado para acceso por IP local. Solo funciona en localhost
    const USE_HTTPS = false; // Deshabilitado para desarrollo en red local
    const certPath = path.join(__dirname, 'server.crt');
    const keyPath = path.join(__dirname, 'server.key');
    let httpServer;

    if (USE_HTTPS && fs.existsSync(certPath) && fs.existsSync(keyPath)) {
      // Usar HTTPS con certificado autofirmado
      console.log('ðŸ” Iniciando servidor con HTTPS...');
      const options = {
        cert: fs.readFileSync(certPath),
        key: fs.readFileSync(keyPath)
      };

      httpServer = https.createServer(options, app);

      // Crear servidor HTTP que redirige a HTTPS
      const httpApp = express();
      httpApp.use((req, res) => {
        res.redirect(`https://localhost:${PORT}${req.url}`);
      });
      
      const redirectServer = http.createServer(httpApp);
      const httpPort = 3001;
      
      redirectServer.listen(httpPort, '0.0.0.0', () => {
        logger.info('HTTP â†’ HTTPS redirect server listening on port 3001', { type: 'HTTPS' });
      });

      logger.info('[HTTPS] Activado con certificado autofirmado', { type: 'HTTPS' });
    } else if (USE_HTTPS && !fs.existsSync(certPath)) {
      // Usuario quiere HTTPS pero no tiene certificado
      logger.warn('âš ï¸ USE_HTTPS=true pero no hay certificados. Generando...', { type: 'HTTPS' });
      console.log('\nðŸ” Para generar certificado, ejecuta:');
      console.log('   node utils/generate-cert.js\n');
      
      // Continuar con HTTP por ahora
      httpServer = http.createServer(app);
      logger.warn('Iniciando temporalmente con HTTP (sin certificado)', { type: 'HTTPS' });
    } else {
      // Desarrollo local sin HTTPS (HTTP)
      httpServer = http.createServer(app);
    }

    const io = socketIo(httpServer, {
      cors: {
        origin: process.env.FRONTEND_URL || 'http://localhost:3000',
        methods: ["GET", "POST"],
        credentials: true
      },
      transports: ['websocket', 'polling'],
      allowUpgrades: true,
      pingInterval: 30000,
      pingTimeout: 60000,
      maxHttpBufferSize: 1e6,
      serveClient: true,
      perMessageDeflate: {
        threshold: 32 * 1024
      }
    });

    // Almacenar instancia de io en app para usar en rutas
    app.io = io;

    // Manejar conexiones de WebSocket
    io.on('connection', (socket) => {
      // Evento: Nuevo recibo creado
      socket.on('recibo:crear', (data) => {
        io.emit('recibo:actualizar-lista');
        io.emit('stats:actualizar');
      });

      // Evento: Recibo eliminado
      socket.on('recibo:eliminar', (data) => {
        io.emit('recibo:actualizar-lista');
        io.emit('stats:actualizar');
      });

      // Evento: Nueva cita en agenda médica
      socket.on('cita:crear', (data) => {
        io.emit('agenda:actualizar-consultorio', data.consultorio);
        io.emit('agenda:actualizar-lista');
      });

      // Evento: Cita cancelada/actualizada
      socket.on('cita:actualizar', (data) => {
        io.emit('agenda:actualizar-consultorio', data.consultorio);
        io.emit('agenda:actualizar-lista');
      });

      // Evento: Cita atendida
      socket.on('cita:atender', (data) => {
        io.emit('agenda:actualizar-consultorio', data.consultorio);
        io.emit('agenda:actualizar-lista');
        io.emit('voz:anunciar-siguiente', data);
      });

      // Evento: Nuevo turno en electrodiagnóstico
      socket.on('electro:crear-turno', (data) => {
        io.emit('electro:actualizar-equipo', data.equipo);
        io.emit('electro:actualizar-lista');
      });

      // Evento: Turno completado
      socket.on('electro:completar-turno', (data) => {
        io.emit('electro:actualizar-equipo', data.equipo);
        io.emit('electro:actualizar-lista');
      });

      // Evento: Cita creada en electrodiagnóstico
      socket.on('electro:cita-creada', (data) => {
        io.emit('electro:actualizar-lista');
        io.emit('electro:nueva-cita', data);
      });

      // Evento: Cita actualizada en electrodiagnóstico
      socket.on('electro:cita-actualizada', (data) => {
        io.emit('electro:actualizar-lista');
        io.emit('electro:cita-cambio-estado', data);
      });

      // Evento: Cita eliminada en electrodiagnóstico
      socket.on('electro:cita-eliminada', (data) => {
        io.emit('electro:actualizar-lista');
        io.emit('electro:cita-removida', data);
      });

      // Evento: Estudio iniciado en electrodiagnóstico
      socket.on('electro:estudio-iniciado', (data) => {
        io.emit('electro:actualizar-lista');
      });

      // Evento: Estudio finalizado en electrodiagnóstico
      socket.on('electro:estudio-finalizado', (data) => {
        io.emit('electro:actualizar-lista');
      });

      // Evento: Cambios guardados en electrodiagnóstico
      socket.on('electro:cambios-guardados', (data) => {
        io.emit('electro:actualizar-lista');
      });

      // ========== Eventos para Turnos Médicos (Agenda Médica) ==========
      
      // Evento: Estado de turno médico actualizado
      socket.on('turno-medico:estado-actualizado', (data) => {
        logger.debug('[SOCKET] turno-medico:estado-actualizado');
        io.emit('turno-medico:estado-actualizado', data);
      });

      // Evento: Turno médico reprogramado
      socket.on('turno-medico:reprogramado', (data) => {
        logger.debug('[SOCKET] turno-medico:reprogramado');
        io.emit('turno-medico:reprogramado', data);
      });

      // Evento: Nuevo turno médico creado
      socket.on('turno-medico:creado', (data) => {
        logger.debug('[SOCKET] turno-medico:creado');
        io.emit('turno-medico:creado', data);
      });

      socket.on('disconnect', () => {
        // Usuario desconectado
      });
    });

    httpServer.listen(PORT, '0.0.0.0', () => {
      logger.info(`Servidor corriendo en http://0.0.0.0:${PORT}`);
      logger.cleanOldLogs(); // Rotar logs al iniciar
      startBackupScheduler();
      
      // Backups automáticos desactivados (ejecutar manualmente: node utils/backup.js)
    });

    // Manejo de errores
    httpServer.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`\nâŒ Puerto ${PORT} ya está en uso.\n`);
        console.log(`Intenta con otro puerto:`);
        console.log(`set PORT=3001 && node server.js\n`);
        process.exit(1);
      } else {
        throw error;
      }
    });
  } catch (error) {
    console.error('STARTUP ERROR:', error.message);
    console.error(error.stack);
    try {
      const _fs = require('fs'), _path = require('path');
      const _d = _path.join(__dirname, 'logs');
      if (!_fs.existsSync(_d)) _fs.mkdirSync(_d, { recursive: true });
      _fs.appendFileSync(_path.join(_d, 'startup-error.log'),
        '[' + new Date().toISOString() + '] STARTUP ERROR: ' + error.message + '\n' + error.stack + '\n');
    } catch (_) {}
    process.exit(1);
  }
})();

// Manejo de excepciones no capturadas
process.on('uncaughtException', (error) => {
  console.error('\nâŒ Error no controlado:', error.message);
  console.error('El servidor seguirá funcionando, pero verifica los errores anteriores.\n');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('\nâŒ Promise rechazado:', reason);
});

