// server.js
require('dotenv').config();
const express = require('express');
const https = require('https');
const http = require('http');
const socketIo = require('socket.io');
const db = require('./db-mysql');  // ← MySQL Pool en lugar de SQLite
const procesarAgendaExcel = require('./procesar-agenda-excel');
const bodyParser = require('body-parser');
const cors = require('cors');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcrypt');
const multer = require('multer');

const app = express();
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

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
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB max
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
  secret: 'innar-clinica-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: { 
    secure: false, // true si usas HTTPS
    maxAge: 24 * 60 * 60 * 1000 // 24 horas
  }
}));
// activar rolling session para actualizar cookie en cada respuesta
app.set('trust proxy', 1);

// Páginas wrapper para reportes (muestran favicon en la pestaña y el PDF en iframe)
app.get('/reportes/diario/vista', (req, res) => {
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

app.get('/reportes/mensual/vista', (req, res) => {
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

app.use(express.static('public'));

// Cargar imagen del logo como base64
let logoBase64 = '';

// Función para obtener la ruta del logo (compatible con pkg)
function getLogoPath() {
  const possiblePaths = [
    path.join(__dirname, 'public', 'logo.png'),
    path.join(__dirname, '../public/logo.png'),
    path.join(__dirname, '../../public/logo.png'),
    path.join(process.execPath, '..', 'public', 'logo.png'),
  ];
  
  for (let p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const logoPath = getLogoPath();
if(logoPath && fs.existsSync(logoPath)) {
  try {
    const logoBuffer = fs.readFileSync(logoPath);
    logoBase64 = logoBuffer.toString('base64')
  } catch(e) {
    console.warn('⚠️ Error cargando logo:', e.message);
  }
}

// Las tablas de MySQL se inicializan con npm run init-db
// No es necesario db.exec() aquí

// Opciones para Puppeteer (Chrome/Edge del sistema si existe)
function getPuppeteerLaunchOptions() {
  const launchOptions = {
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    dumpio: false
  };
  const chromePaths = [
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

// Middleware de autenticación
function requireAuth(req, res, next) {
  if (req.session && req.session.usuarioId) {
    return next();
  }
  return res.status(401).json({ error: 'No autenticado' });
}

// Middleware: solo rol admin
function requireAdmin(req, res, next) {
  if (req.session && req.session.rol === 'admin') {
    return next();
  }
  return res.status(403).json({ error: 'Solo administradores pueden realizar esta acción' });
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

// ============================================
// ENDPOINTS DE AUTENTICACIÓN
// ============================================

// Login
app.post('/api/login', async (req, res) => {
  const { usuario, password } = req.body || {};
  if (!usuario || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
  }

  try {
    // Buscar usuario en MySQL
    const users = await db.query(
      'SELECT * FROM usuarios WHERE usuario = ? AND activo = 1',
      [usuario]
    );
    
    if (users.length === 0) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }

    const user = users[0];

    // Verificar contraseña
    if (!bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }

    // Guardar en sesión
    req.session.usuarioId = user.id;
    req.session.usuario = user.usuario;
    req.session.rol = user.rol;

    res.json({ 
      ok: true, 
      usuario: { id: user.id, usuario: user.usuario, nombre: user.nombre, rol: user.rol }
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
        'SELECT id, usuario, nombre, rol FROM usuarios WHERE id = ?',
        [req.session.usuarioId]
      );
      const user = users.length > 0 ? users[0] : null;
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

    if (nuevaContrasena.length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
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

    // Si cambió nombre, actualizar en sesión
    if (nombre) {
      req.session.nombre = nombre.trim();
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

// ============================================
// ENDPOINTS DE USUARIOS (solo admin)
// ============================================
app.get('/api/usuarios', requireAuth, requireAdmin, async (req, res) => {
  try {
    const usuarios = await db.query(
      'SELECT id, usuario, nombre, rol, activo FROM usuarios ORDER BY usuario ASC'
    );
    res.json(usuarios);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/usuarios', requireAuth, requireAdmin, async (req, res) => {
  const { usuario, password, nombre, rol, numero_consultorio } = req.body || {};
  if (!usuario || !password || !nombre || !rol) {
    return res.status(400).json({ error: 'usuario, password, nombre y rol son obligatorios' });
  }
  const rolesValidos = ['admin', 'recepcion', 'electro', 'doctor'];
  if (!rolesValidos.includes(rol)) {
    return res.status(400).json({ error: 'Rol inválido. Use: admin, recepcion, electro, doctor' });
  }
  let consultorioFinal = null;
  if (rol === 'doctor') {
    const numConsultorio = parseInt(numero_consultorio, 10);
    if (isNaN(numConsultorio) || numConsultorio < 1) {
      return res.status(400).json({ error: 'Número de consultorio debe ser un número válido' });
    }
    consultorioFinal = numConsultorio;
  }
  try {
    const hash = bcrypt.hashSync(password, 10);
    const result = await db.execute(
      'INSERT INTO usuarios (usuario, password_hash, nombre, rol, numero_consultorio) VALUES (?, ?, ?, ?, ?)',
      [usuario, hash, nombre, rol, consultorioFinal]
    );
    // Emitir evento WebSocket
    if (app.io) {
      app.io.emit('usuario:creado', { id: result.insertId });
    }
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
  const { usuario, password, nombre, rol, activo, numero_consultorio } = req.body || {};
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
      const rolesValidos = ['admin', 'recepcion', 'electro', 'doctor'];
      if (!rolesValidos.includes(rol)) return res.status(400).json({ error: 'Rol inválido' });
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
    
    if (activo !== undefined) { updates.push('activo = ?'); params.push(activo ? 1 : 0); }
    if (password && password.trim()) {
      updates.push('password_hash = ?');
      params.push(bcrypt.hashSync(password, 10));
    }
    
    if (updates.length === 0) return res.status(400).json({ error: 'Nada que actualizar' });
    params.push(id);
    await db.execute(`UPDATE usuarios SET ${updates.join(', ')} WHERE id = ?`, params);
    res.json({ ok: true });
  } catch (e) {
    if (e.message && e.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'El usuario ya existe' });
    }
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/usuarios/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  if (id === req.session.usuarioId) {
    return res.status(400).json({ error: 'No puedes eliminar tu propio usuario' });
  }
  try {
    const result = await db.execute('DELETE FROM usuarios WHERE id = ?', [id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ============================================
// ENDPOINTS DOCTOR: Llamar siguiente / Marcar atendido
// ============================================
app.post('/api/turnos/llamar-siguiente', requireAuth, async (req, res) => {
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
      console.log(`[DEBUG] Ya hay paciente EN_ATENCION:`, enAtencion[0].paciente_nombre);
      const turnoConConsultorio = { ...enAtencion[0], numero_consultorio: numeroConsultorio };
      return res.json({ ok: true, turno: turnoConConsultorio });
    }
    
    // Si no hay EN_ATENCION, buscar el siguiente EN_SALA
    const turnos = await db.query(`
      SELECT * FROM turnos 
      WHERE fecha = ? AND doctor_id = ? AND estado = 'EN_SALA' AND numero_turno IS NOT NULL
      ORDER BY numero_turno ASC LIMIT 1
    `, [fecha, doctor_id]);
    
    console.log(`[DEBUG] Turnos EN_SALA para doctor ${doctor_id}:`, turnos.length, turnos);
    
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

app.post('/api/turnos/marcar-atendido', requireAuth, async (req, res) => {
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
    
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ============================================
// ENDPOINTS DE PACIENTES
// ============================================

// Listar pacientes (con búsqueda opcional)
app.get('/api/pacientes', async (req, res) => {
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

// Actualizar paciente (nombre, documento, etc.)
app.patch('/api/pacientes/:id', requireAuth, requireRole(['admin', 'recepcion']), async (req, res) => {
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
app.post('/api/pacientes', async (req, res) => {
  const { nombre, documento, telefono, email } = req.body || {};
  if (!nombre) {
    return res.status(400).json({ error: 'Nombre es obligatorio' });
  }

  try {
    const result = await db.execute(
      'INSERT INTO pacientes (nombre, documento, telefono, email) VALUES (?, ?, ?, ?)',
      [nombre, documento || null, telefono || null, email || null]
    );
    res.json({ ok: true, id: result.insertId });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ============================================
// ENDPOINTS DE CONSULTORIOS
// ============================================

// Listar consultorios
app.get('/api/consultorios', async (req, res) => {
  try {
    const consultorios = await db.query('SELECT * FROM consultorios WHERE activo = 1 ORDER BY nombre ASC');
    res.json(consultorios);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Listar medicos (usuarios con rol 'doctor') — accesible a recepcion y doctores
app.get('/api/medicos', requireAuth, async (req, res) => {
  try {
    const medicos = await db.query("SELECT id, nombre, usuario FROM usuarios WHERE rol = 'doctor' AND activo = 1 ORDER BY nombre ASC");
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
  const isAdminUser = req.session.rol === 'admin';
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
    const isAdmin = req.session.rol === 'admin';
    if (!isDoctorOwner && !isAdmin) return res.status(403).json({ error: 'No tienes permiso para eliminar este archivo' });
    
    // Eliminar archivo del sistema de archivos
    const filePath = path.join(__dirname, 'public', file.url);
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

// ============================================
// ENDPOINTS DÍAS BLOQUEADOS (NO AGENDAR)
// ============================================

// Crear tabla si no existe
app.get('/api/init-doctor-disponibilidad', async (req, res) => {
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
    console.log(`[DISPONIBILIDAD] Procesando Excel para doctor=${doctorId}, archivo=${req.file.originalname}`);
    
    if (!doctorId) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: 'doctor_id inválido' });
    }

    // Permisos: admin o el doctor puede subir su propia disponibilidad
    const isAdmin = req.session.rol === 'admin';
    const isDoctor = req.session.rol === 'doctor' && doctorId === req.session.usuarioId;
    if (!isAdmin && !isDoctor) {
      fs.unlink(req.file.path, () => {});
      console.log(`[DISPONIBILIDAD] Acceso denegado: rol=${req.session.rol}, usuarioId=${req.session.usuarioId}`);
      return res.status(403).json({ error: 'No tienes permiso para esto' });
    }

    // Procesar el Excel
    console.log(`[DISPONIBILIDAD] Llamando a procesarAgendaExcel con path=${req.file.path}`);
    const result = await procesarAgendaExcel.procesarAgendaExcel(req.file.path, doctorId, db);
    console.log(`[DISPONIBILIDAD] Resultado del procesamiento:`, result);

    if (!result.ok) {
      fs.unlink(req.file.path, () => {});
      console.log(`[DISPONIBILIDAD] Error en procesamiento: ${result.error}`);
      return res.status(400).json({ error: result.error });
    }

    // Guardar metadatos del archivo en la BD para poder verlo/descargarlo después
    const url = `/uploads/${req.file.filename}`;
    try {
      const fileResult = await db.execute(
        'INSERT INTO doctor_agenda_files (doctor_id, filename, url, uploaded_by) VALUES (?, ?, ?, ?)',
        [doctorId, req.file.originalname, url, req.session.usuarioId || null]
      );
      console.log(`[DISPONIBILIDAD] Archivo guardado en BD con ID: ${fileResult.insertId}`);
    } catch (dbErr) {
      console.warn(`[DISPONIBILIDAD] Advertencia: error guardando metadatos del archivo:`, dbErr.message);
      // Continuar aunque falle guardar metadatos - el procesamiento fue exitoso
    }

    // NO borrar el archivo del filesystem para que sea visible en la lista

    // Emitir actualización a través de WebSocket
    if (app.io) {
      app.io.emit('agenda:disponibilidad-actualizada', { doctor_id: doctorId });
    }

    res.json({ 
      ok: true, 
      diasGuardados: result.diasGuardados,
      errores: result.errores,
      fileUrl: url,
      message: `✓ ${result.diasGuardados} días de disponibilidad guardados` 
    });
  } catch (e) {
    console.error('[DISPONIBILIDAD] Error procesando Excel:', e.message, e.stack);
    if (req.file) fs.unlink(req.file.path, () => {});
    res.status(500).json({ error: e.message });
  }
});

// Obtener disponibilidad mensual de un doctor
app.get('/api/doctor-disponibilidad/:doctorId', async (req, res) => {
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
        app.io.emit('agenda:disponibilidad-actualizada', { doctor_id: doctorId });
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
  const isAdmin = req.session.rol === 'admin';
  const isDoctor = req.session.rol === 'doctor' && doctorId === req.session.usuarioId;
  if (!isAdmin && !isDoctor) {
    return res.status(403).json({ error: 'No tienes permiso' });
  }
  const result = await procesarAgendaExcel.limpiarDisponibilidad(doctorId, db);
  res.json(result);
});

// ============================================
// ENDPOINTS DE TURNOS (AGENDA)
// ============================================

// Listar turnos por fecha y consultorio
app.get('/api/turnos', async (req, res) => {
  const { fecha, doctor_id } = req.query;
  if (!fecha) {
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

// Crear turno
app.post('/api/turnos', async (req, res) => {
  const { doctor_id, paciente_nombre, paciente_documento, paciente_telefono, fecha, hora, tipo_consulta, entidad, notas, oportunidad, programado_por } = req.body || {};

  if (!doctor_id || !paciente_nombre || !fecha || !hora) {
    return res.status(400).json({ error: 'doctor_id, paciente_nombre, fecha y hora son obligatorios' });
  }

  try {
    console.log(`[DEBUG] Creando turno:`, { doctor_id, paciente_nombre, fecha, hora, tipo_consulta, entidad });
    
    // Validar disponibilidad del doctor en esa fecha
    const disponibilidad = await procesarAgendaExcel.tieneDisponibilidad(doctor_id, fecha, db);
    console.log(`[DEBUG] Validación de disponibilidad para doctor=${doctor_id}, fecha=${fecha}:`, disponibilidad);
    
    if (!disponibilidad.disponible) {
      console.log(`[DEBUG] Rechazo de turno: doctor no disponible`);
      return res.status(400).json({ 
        error: 'El doctor no está disponible en esta fecha',
        razon: disponibilidad.razon,
        disponible: false
      });
    }
    
    // Crear turno como PENDIENTE sin número (numero_turno NULL)
    const result = await db.execute(`
      INSERT INTO turnos (numero_turno, doctor_id, paciente_nombre, paciente_documento, paciente_telefono, estado, fecha, hora, tipo_consulta, entidad, notas, oportunidad, programado_por)
      VALUES (NULL, ?, ?, ?, ?, 'PENDIENTE', ?, ?, ?, ?, ?, ?, ?)
    `, [
      doctor_id,
      paciente_nombre,
      paciente_documento || null,
      paciente_telefono || null,
      fecha,
      hora,
      tipo_consulta || null,
      entidad || null,
      notas || null,
      oportunidad ? parseInt(oportunidad, 10) : null,
      programado_por || null
    ]);

    console.log(`[DEBUG] Turno creado con ID:`, result.insertId);

    // Emitir evento WebSocket
    if (app.io) {
      app.io.emit('agenda:turno-creado', { id: result.insertId, doctor_id, paciente_nombre, fecha });
    }

    res.json({ ok: true, id: result.insertId });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Cambiar estado de un turno
app.patch('/api/turnos/:id/estado', async (req, res) => {
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

    // Actualizar estado
    await db.execute('UPDATE turnos SET estado = ? WHERE id = ?', [estado, id]);

    // Emitir evento WebSocket
    if (app.io) {
      app.io.emit('agenda:turno-estado-cambio', { id, estado });
    }

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Eliminar turno
app.delete('/api/turnos/:id', async (req, res) => {
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

    const result = await db.execute('DELETE FROM turnos WHERE id = ?', [id]);
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

app.patch('/api/turnos/:id/numero', requireAuth, requireRole(['admin', 'recepcion']), async (req, res) => {
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

      return res.json({ ok: true });
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ============================================
// ENDPOINTS AGENDA ELECTRODIAGNÓSTICO
// ============================================

// Listar equipos de electrodiagnóstico
app.get('/api/equipos-electro', async (req, res) => {
  try {
    const equipos = await db.query('SELECT * FROM equipos_electro WHERE activo = 1 ORDER BY nombre ASC');
    res.json(equipos);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Listar citas electro por fecha y equipo
app.get('/api/citas-electro', async (req, res) => {
  const { fecha, equipo_id } = req.query;
  if (!fecha || !equipo_id) {
    return res.status(400).json({ error: 'fecha y equipo_id son obligatorios' });
  }

  try {
    const citas = await db.query(`
      SELECT c.*, 
             p.nombre AS paciente_nombre, 
             p.documento AS paciente_documento,
             e.nombre AS equipo_nombre
      FROM citas_electro c
      JOIN pacientes p ON p.id = c.paciente_id
      JOIN equipos_electro e ON e.id = c.equipo_id
      WHERE c.fecha = ? AND c.equipo_id = ?
      ORDER BY c.hora_inicio ASC, c.id ASC
    `, [fecha, equipo_id]);
    res.json(citas);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Crear cita electrodiagnóstico
app.post('/api/citas-electro', async (req, res) => {
  const { equipo_id, paciente_id, fecha, hora_inicio, hora_fin, estudio, observaciones } = req.body || {};

  if (!equipo_id || !paciente_id || !fecha || !hora_inicio) {
    return res.status(400).json({ error: 'equipo_id, paciente_id, fecha y hora_inicio son obligatorios' });
  }

  try {
    const result = await db.execute(`
      INSERT INTO citas_electro (equipo_id, paciente_id, fecha, hora_inicio, hora_fin, estudio, observaciones, estado)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'PROGRAMADO')
    `, [
      equipo_id,
      paciente_id,
      fecha,
      hora_inicio,
      hora_fin || null,
      estudio || null,
      observaciones || null
    ]);
    res.json({ ok: true, id: result.insertId });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Actualizar estado de cita electro (registra quién editó)
app.patch('/api/citas-electro/:id/estado', requireAuth, async (req, res) => {
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

// Eliminar cita electro
app.delete('/api/citas-electro/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) {
    return res.status(400).json({ error: 'ID inválido' });
  }

  try {
    const citas = await db.query('SELECT * FROM citas_electro WHERE id = ?', [id]);
    const cita = citas.length > 0 ? citas[0] : null;
    if (!cita) {
      return res.status(404).json({ error: 'Cita no encontrada' });
    }

    await db.execute('DELETE FROM citas_electro WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ============================================
// ENDPOINTS DE RECIBOS (EXISTENTES)
// ============================================

// Guardar recibo
app.post('/api/recibos', async (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'Cuerpo de la petición inválido' });
  }
  
  const { numero, cliente, fecha, total, data } = body;
  
  // Validar que al menos el total exista
  if (total == null) {
    return res.status(400).json({ error: 'Se requiere el campo total' });
  }
  
  try {
    const result = await db.execute(
      'INSERT INTO recibos (numero, cliente, fecha, total, data) VALUES (?, ?, ?, ?, ?)',
      [
        numero || null,
        cliente || null,
        fecha || null,
        total || 0,
        data ? JSON.stringify(data) : null
      ]
    );
    // Emitir actualización a través de WebSocket
    if (app.io) {
      const nuevoRecibo = {
        id: result.insertId,
        numero,
        cliente,
        fecha,
        total
      };
      app.io.emit('recibo:creado', nuevoRecibo);
      app.io.emit('recibo:actualizar-lista');
      app.io.emit('stats:actualizar');
    }
    res.json({ ok: true, id: result.insertId });
  } catch(err) {
    console.error('[RECIBOS] Error guardando recibo:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Listar recibos
app.get('/api/recibos', async (req, res) => {
  try {
    const rows = await db.query('SELECT * FROM recibos ORDER BY id DESC');
    res.json(rows || []);
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// Resetear/limpiar todos los recibos (solo admin)
app.delete('/api/recibos/reset', requireAuth, requireAdmin, async (req, res) => {
  try {
    await db.execute('DELETE FROM recibos');
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
    // Emitir actualización a través de WebSocket
    if (app.io) {
      app.io.emit('recibo:eliminado', { id });
      app.io.emit('recibo:actualizar-lista');
      app.io.emit('stats:actualizar');
    }
    res.json({ ok: true });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// Obtener recibo (por id)
app.get('/api/recibos/:id', async (req, res) => {
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
app.get('/api/recibos/:id/pdf', async (req, res) => {
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

    const html = `
      <!doctype html>
      <html>
      <head>
        <meta charset="utf-8"/>
        <title>Recibo ${row.numero}</title>
        <style>
          * { margin: 0; padding: 0; }
          body { font-family:Arial,Helvetica,sans-serif; color:#000; font-size:12px; padding:1mm; line-height:1.4; }
          .header { margin-bottom:8px; border-bottom:2px solid #000; padding-bottom:5px; display:flex; flex-direction:column; }
          .header-top { display:flex; justify-content:center; margin-bottom:1px; }
          .header-logo { width:50px; height:40px; display:flex; align-items:center; justify-content:center; }
          .header-logo img { max-width:50px; max-height:40px; object-fit:contain; }
          .company-info { margin-bottom:2px; }
          .company-info h1 { margin:0 0 1px 0; font-size:12px; color:#000; line-height:1.0; font-weight:bold; }
          .company-info p { margin:0px 0; font-size:10px; color:#000; line-height:1.0 }
          .header-receipt { display:flex; flex-direction:column; align-items:flex-end; margin-top:2px; }
          .receipt-number { font-size:12px; font-weight:bold; color:#000; margin-bottom:1px; }
          .receipt-date { font-size:10px; color:#000; }
          .client-section { margin:1px 0; font-size:10px; line-height:1.3; background:#f9f9f9; padding:4px; border-radius:2px; }
          table { width:100%; border-collapse:collapse; margin:6px 0; font-size:10px; table-layout:fixed; }
          th { background-color:#f0f0f0; padding:3px; border:1px solid #000; text-align:left; font-weight:bold; color:#000; font-size:9px; line-height:1.1; }
          td { padding:3px; border:1px solid #000; font-size:9px; color:#000; line-height:1.1; word-wrap:break-word; word-break:break-word; white-space:normal; }
          .totals-table { margin-left:0; width:100%; margin-right:0; margin-top:4px; margin-bottom:4px; }
          .totals-table td { border:none; padding:2px; font-size:10px; color:#000; }
          .totals-table .label { text-align:left; width:auto; font-weight:bold; }
          .totals-table .value { text-align:right; font-weight:bold; width:auto; font-size:10px; }
          .totals-table .total-row { border-top:2px solid #000; border-bottom:2px solid #000; font-size:11px; font-weight:bold; color:#000; padding:2px 2px; }
          .signatures { margin-top:6px; display:flex; flex-direction:column; gap:8px; font-size:8px; }
          .signature-block { width:100%; text-align:center; page-break-inside:avoid; }
          .signature-block p { margin:2px 0; font-weight:bold; font-size:9px; }
          .signature-line { border-top:1px solid #000; width:100%; margin-top:15px; margin-bottom:1px; }
          .signature-label { margin-top:1px; font-weight:bold; color:#000; font-size:8px; }
          .observations { margin:6px 0; padding:4px; background-color:#f9f9f9; border-left:2px solid #000; font-size:9px; color:#000; line-height:1.2; }
          .observations strong { font-weight:bold; }
          .footer { margin-top:6px; text-align:center; font-size:8px; color:#000; border-top:1px solid #000; padding-top:2px; line-height:1.1; }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="header-top">
            <div class="header-logo">
              <img src="data:image/png;base64,${logoBase64}" alt="Logo" />
            </div>
          </div>
          <div class="company-info">
            <h1>INSTITUTO NEUROCIENCIAS</h1>
            <p><strong>NIT:</strong> 901164565-1</p>
            <p style="margin:0px 0"><strong>Dirección:</strong><br/>Carrera 34 #13 - 80. B/San Ignacio</p>
            <p><strong>Teléfono:</strong> 305-356-0651</p>
            <p><strong>Ciudad:</strong> Pasto, Colombia</p>
          </div>
          <div class="header-receipt">
            <div class="receipt-number">Recibo Nº ${row.numero}</div>
            <div class="receipt-date">Fecha: ${typeof row.fecha === 'string' ? row.fecha : new Date(row.fecha).toISOString().split('T')[0]}</div>
          </div>
        </div>

        <div class="client-section">
          <strong style="font-size:13px;margin:0">CLIENTE</strong>
          <div style="margin-top:2px">
            <p style="margin:1px 0"><strong>Nombre:</strong> ${escapeHtml(row.cliente)}</p>
            <p style="margin:1px 0"><strong>Documento:</strong> ${escapeHtml(data.doc || '-')}</p>
            <p style="margin:1px 0"><strong>Entidad:</strong> ${escapeHtml(data.entidad || '-')}</p>
          </div>
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
            <td class="label">Subtotal:</td>
            <td class="value">$ ${subtotalFormatted}</td>
          </tr>
          <tr>
            <td class="label">IVA (${data.tasa_iva || 0}%):</td>
            <td class="value">$ ${ivaFormatted}</td>
          </tr>
          <tr class="total-row">
            <td class="label">TOTAL:</td>
            <td class="value">$ ${totalFormatted}</td>
          </tr>
        </table>

        ${data.observ ? `<div class="observations"><strong>Observaciones:</strong><br/>${escapeHtml(data.observ)}</div>` : ''}

        <div class="signatures">
          <div class="signature-block">
            <p>Quien recibe</p>
            <div class="signature-line"></div>
            <div class="signature-label">Nombre</div>
          </div>
        </div>

        <div class="footer">
          <p>Documento generado digitalmente el ${new Date().toLocaleString('es-CO')}</p>
          <p>Este recibo es un comprobante de la transacción realizada.</p>
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
        width: '58mm',
        margin: { top: '0', bottom: '0', left: '0', right: '0' }
      });
      await browser.close();

      res.contentType('application/pdf');
      res.setHeader('Content-Disposition', `inline; filename=recibo_${row.numero}.pdf`);
      res.send(pdf);
    } catch (e) {
      if (browser) await browser.close().catch(() => {});
      console.error('Error en PDF:', e.message);
      res.status(500).json({ error: 'Error generando PDF: ' + e.message + '. Intenta instalar Google Chrome.' });
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error generando PDF: ' + e.message });
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

    const logoBase64Data = logoBase64;

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
                <th>Recibo Nº</th>
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
    
    const recibos = await db.query('SELECT * FROM recibos WHERE fecha BETWEEN ? AND ? ORDER BY fecha DESC', [fechaInicio, fechaFin]);
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

    const logoBase64Data = logoBase64;

    const html = `
      <!doctype html>
      <html>
      <head>
        <meta charset="utf-8"/>
        <title>Reporte Mensual</title>
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
                <th>Recibo Nº</th>
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
    
    // Configuración HTTPS
    const certPath = path.join(__dirname, 'server.crt');
    const keyPath = path.join(__dirname, 'server.key');
    let httpServer;

    if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
      // Usar HTTPS con certificado
      const options = {
        cert: fs.readFileSync(certPath),
        key: fs.readFileSync(keyPath)
      };

      // Añadir headers de seguridad
      app.use((req, res, next) => {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('X-XSS-Protection', '1; mode=block');
        res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
        next();
      });

      httpServer = https.createServer(options, app);

      // Crear servidor HTTP que redirige a HTTPS
      const httpApp = express();
      httpApp.use((req, res) => {
        res.redirect(`https://localhost:${PORT}${req.url}`);
      });
      
      const redirectServer = http.createServer(httpApp);
      const httpPort = 3001;
      
      redirectServer.listen(httpPort, () => {});
    } else {
      // Sin HTTPS (desarrollo local)
      httpServer = http.createServer(app);
    }

    // Configurar Socket.IO en el servidor HTTP
    const io = socketIo(httpServer, {
      cors: {
        origin: true,
        credentials: true
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

      // Evento: Nuevo usuario creado
      socket.on('usuario:crear', (data) => {
        io.emit('usuario:actualizar-lista');
      });

      // Evento: Usuario actualizado
      socket.on('usuario:actualizar', (data) => {
        io.emit('usuario:actualizar-lista');
      });

      // Evento: Usuario eliminado
      socket.on('usuario:eliminar', (data) => {
        io.emit('usuario:actualizar-lista');
      });

      // Evento: Solicitar estadísticas
      socket.on('stats:solicitar', () => {
        // El cliente recibirá stats:actualizar
        io.emit('stats:actualizar');
      });

      socket.on('disconnect', () => {
        // Usuario desconectado
      });
    });

    httpServer.listen(PORT, () => {
      console.log('OK');
    });

    // Manejo de errores
    httpServer.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`\n❌ Puerto ${PORT} ya está en uso.\n`);
        console.log(`Intenta con otro puerto:`);
        console.log(`set PORT=3001 && node server.js\n`);
        process.exit(1);
      } else {
        throw error;
      }
    });
  } catch (error) {
    console.error('❌ Error iniciando servidor:', error.message);
    process.exit(1);
  }
})();

// Manejo de excepciones no capturadas
process.on('uncaughtException', (error) => {
  console.error('\n❌ Error no controlado:', error.message);
  console.error('El servidor seguirá funcionando, pero verifica los errores anteriores.\n');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('\n❌ Promise rechazado:', reason);
});
