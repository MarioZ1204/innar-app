// server.js
const express = require('express');
const Database = require('better-sqlite3');
const bodyParser = require('body-parser');
const cors = require('cors');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcrypt');

const app = express();
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(bodyParser.json({ limit: '5mb' }));

// Configurar sesiones
app.use(session({
  secret: 'innar-clinica-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: false, // true si usas HTTPS
    maxAge: 24 * 60 * 60 * 1000 // 24 horas
  }
}));

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
    logoBase64 = logoBuffer.toString('base64');
    console.log('✅ Logo cargado correctamente');
  } catch(e) {
    console.warn('⚠️ Error cargando logo:', e.message);
  }
}

const db = new Database('./database.db');

db.exec(`
CREATE TABLE IF NOT EXISTS recibos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  numero TEXT,
  cliente TEXT,
  fecha TEXT,
  total REAL,
  data TEXT
)`);

// TABLAS PARA AGENDA Y LOGIN
db.exec(`
CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  nombre TEXT,
  rol TEXT DEFAULT 'secretaria',
  activo INTEGER DEFAULT 1
)`);

db.exec(`
CREATE TABLE IF NOT EXISTS pacientes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  documento TEXT,
  telefono TEXT,
  email TEXT,
  creado_en TEXT DEFAULT (datetime('now'))
)`);

db.exec(`
CREATE TABLE IF NOT EXISTS consultorios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE,
  descripcion TEXT,
  activo INTEGER DEFAULT 1
)`);

db.exec(`
CREATE TABLE IF NOT EXISTS turnos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  numero_turno INTEGER NOT NULL,
  paciente_id INTEGER NOT NULL,
  consultorio_id INTEGER NOT NULL,
  entidad TEXT,
  prioridad INTEGER DEFAULT 2,
  estado TEXT NOT NULL DEFAULT 'PROGRAMADO',
  fecha TEXT NOT NULL,
  hora_programada TEXT,
  hora_llamado TEXT,
  observaciones TEXT,
  creado_en TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (paciente_id) REFERENCES pacientes(id),
  FOREIGN KEY (consultorio_id) REFERENCES consultorios(id)
)`);

// Tablas para Agenda Electrodiagnóstico (4 equipos)
db.exec(`
CREATE TABLE IF NOT EXISTS equipos_electro (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE,
  descripcion TEXT,
  activo INTEGER DEFAULT 1
)`);

db.exec(`
CREATE TABLE IF NOT EXISTS citas_electro (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  equipo_id INTEGER NOT NULL,
  paciente_id INTEGER NOT NULL,
  fecha TEXT NOT NULL,
  hora_inicio TEXT NOT NULL,
  hora_fin TEXT,
  estudio TEXT,
  observaciones TEXT,
  estado TEXT NOT NULL DEFAULT 'PROGRAMADO',
  editado_por_nombre TEXT,
  editado_en TEXT,
  creado_en TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (equipo_id) REFERENCES equipos_electro(id),
  FOREIGN KEY (paciente_id) REFERENCES pacientes(id)
)`);
// Migración: agregar columnas editado_por si no existen (para BD antiguas)
try {
  db.prepare('SELECT editado_por_nombre FROM citas_electro LIMIT 1').get();
} catch (e) {
  try {
    db.exec('ALTER TABLE citas_electro ADD COLUMN editado_por_nombre TEXT');
    db.exec('ALTER TABLE citas_electro ADD COLUMN editado_en TEXT');
    console.log('✅ Columnas editado_por agregadas a citas_electro');
  } catch (e2) { /* ya existen */ }
}

// Crear usuarios por defecto si no existen
const usersDefault = [
  { usuario: 'admin', password: 'admin123', nombre: 'Administrador', rol: 'admin' },
  { usuario: 'recepcion', password: 'recepcion123', nombre: 'Recepción', rol: 'recepcion' },
  { usuario: 'electro', password: 'electro123', nombre: 'Electrodiagnóstico', rol: 'electro' },
  { usuario: 'doctor', password: 'doctor123', nombre: 'Doctor', rol: 'doctor' },
];
usersDefault.forEach(u => {
  const exists = db.prepare('SELECT id FROM usuarios WHERE usuario = ?').get(u.usuario);
  if (!exists) {
    const hash = bcrypt.hashSync(u.password, 10);
    db.prepare('INSERT INTO usuarios (usuario, password_hash, nombre, rol) VALUES (?, ?, ?, ?)')
      .run(u.usuario, hash, u.nombre, u.rol);
    console.log(`✅ Usuario ${u.rol} creado (usuario: ${u.usuario}, password: ${u.password})`);
  }
});

// Crear consultorios por defecto si no existen
const consultoriosExisten = db.prepare('SELECT COUNT(*) as count FROM consultorios').get();
if (consultoriosExisten.count === 0) {
  db.prepare('INSERT INTO consultorios (nombre, descripcion) VALUES (?, ?)').run('204', 'Consultorio 204');
  db.prepare('INSERT INTO consultorios (nombre, descripcion) VALUES (?, ?)').run('205', 'Consultorio 205');
  console.log('✅ Consultorios por defecto creados');
}

// Crear 4 equipos de electrodiagnóstico por defecto si no existen
const equiposExisten = db.prepare('SELECT COUNT(*) as count FROM equipos_electro').get();
if (equiposExisten.count === 0) {
  db.prepare('INSERT INTO equipos_electro (nombre, descripcion) VALUES (?, ?)').run('Equipo 1', 'Electrodiagnóstico 1');
  db.prepare('INSERT INTO equipos_electro (nombre, descripcion) VALUES (?, ?)').run('Equipo 2', 'Electrodiagnóstico 2');
  db.prepare('INSERT INTO equipos_electro (nombre, descripcion) VALUES (?, ?)').run('Equipo 3', 'Electrodiagnóstico 3');
  db.prepare('INSERT INTO equipos_electro (nombre, descripcion) VALUES (?, ?)').run('Equipo 4', 'Electrodiagnóstico 4');
  console.log('✅ Equipos de electrodiagnóstico creados (4 equipos)');
}

// Opciones para Puppeteer (Chrome/Edge del sistema si existe)
function getPuppeteerLaunchOptions() {
  const launchOptions = {
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
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
      console.log('✅ Chrome/Edge encontrado:', chromePath);
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

// Función para recompactar la cola de turnos (solo pacientes EN_SALA)
function recompactarCola(fecha, consultorioId) {
  const turnos = db.prepare(`
    SELECT id FROM turnos 
    WHERE fecha = ? AND consultorio_id = ? 
    AND estado = 'EN_SALA'
    ORDER BY numero_turno ASC, id ASC
  `).all(fecha, consultorioId);

  const update = db.prepare('UPDATE turnos SET numero_turno = ? WHERE id = ?');
  let n = 1;
  const tx = db.transaction(() => {
    for (const t of turnos) {
      update.run(n, t.id);
      n++;
    }
  });
  tx();
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
app.post('/api/login', (req, res) => {
  const { usuario, password } = req.body || {};
  if (!usuario || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
  }

  try {
    const user = db.prepare('SELECT * FROM usuarios WHERE usuario = ? AND activo = 1').get(usuario);
    if (!user) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }

    if (!bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }

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
app.get('/api/sesion', (req, res) => {
  if (req.session && req.session.usuarioId) {
    const user = db.prepare('SELECT id, usuario, nombre, rol FROM usuarios WHERE id = ?').get(req.session.usuarioId);
    res.json({ autenticado: true, usuario: user });
  } else {
    res.json({ autenticado: false });
  }
});

// ============================================
// ENDPOINTS DE USUARIOS (solo admin)
// ============================================
app.get('/api/usuarios', requireAuth, requireAdmin, (req, res) => {
  try {
    const usuarios = db.prepare('SELECT id, usuario, nombre, rol, activo FROM usuarios ORDER BY usuario ASC').all();
    res.json(usuarios);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/usuarios', requireAuth, requireAdmin, (req, res) => {
  const { usuario, password, nombre, rol } = req.body || {};
  if (!usuario || !password || !nombre || !rol) {
    return res.status(400).json({ error: 'usuario, password, nombre y rol son obligatorios' });
  }
  const rolesValidos = ['admin', 'recepcion', 'electro', 'doctor'];
  if (!rolesValidos.includes(rol)) {
    return res.status(400).json({ error: 'Rol inválido. Use: admin, recepcion, electro, doctor' });
  }
  try {
    const hash = bcrypt.hashSync(password, 10);
    const result = db.prepare('INSERT INTO usuarios (usuario, password_hash, nombre, rol) VALUES (?, ?, ?, ?)')
      .run(usuario, hash, nombre, rol);
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (e) {
    if (e.message && e.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'El usuario ya existe' });
    }
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/usuarios/:id', requireAuth, requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { usuario, password, nombre, rol, activo } = req.body || {};
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  try {
    const user = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    const updates = [];
    const params = [];
    if (usuario !== undefined) { updates.push('usuario = ?'); params.push(usuario); }
    if (nombre !== undefined) { updates.push('nombre = ?'); params.push(nombre); }
    if (rol !== undefined) {
      const rolesValidos = ['admin', 'recepcion', 'electro', 'doctor'];
      if (!rolesValidos.includes(rol)) return res.status(400).json({ error: 'Rol inválido' });
      updates.push('rol = ?'); params.push(rol);
    }
    if (activo !== undefined) { updates.push('activo = ?'); params.push(activo ? 1 : 0); }
    if (password && password.trim()) {
      updates.push('password_hash = ?');
      params.push(bcrypt.hashSync(password, 10));
    }
    if (updates.length === 0) return res.status(400).json({ error: 'Nada que actualizar' });
    params.push(id);
    db.prepare(`UPDATE usuarios SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    res.json({ ok: true });
  } catch (e) {
    if (e.message && e.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'El usuario ya existe' });
    }
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/usuarios/:id', requireAuth, requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  if (id === req.session.usuarioId) {
    return res.status(400).json({ error: 'No puedes eliminar tu propio usuario' });
  }
  try {
    const result = db.prepare('DELETE FROM usuarios WHERE id = ?').run(id);
    if (result.changes === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ============================================
// ENDPOINTS DOCTOR: Llamar siguiente / Marcar atendido
// ============================================
app.post('/api/turnos/llamar-siguiente', requireAuth, (req, res) => {
  const { fecha, consultorio_id } = req.body || {};
  if (!fecha || !consultorio_id) {
    return res.status(400).json({ error: 'fecha y consultorio_id son obligatorios' });
  }
  try {
    const turno = db.prepare(`
      SELECT * FROM turnos 
      WHERE fecha = ? AND consultorio_id = ? AND estado = 'EN_SALA' AND numero_turno IS NOT NULL
      ORDER BY numero_turno ASC, id ASC LIMIT 1
    `).get(fecha, consultorio_id);
    if (!turno) {
      return res.status(404).json({ error: 'No hay más pacientes en espera' });
    }
    // Pasar a EN_ATENCION, \"sacar\" de la cola (numero_turno = 0 para respetar NOT NULL)
    db.prepare(`
      UPDATE turnos 
      SET estado = 'EN_ATENCION', hora_llamado = datetime('now'), numero_turno = 0 
      WHERE id = ?
    `).run(turno.id);

    // Recompactar cola de EN_SALA para que el siguiente pase a turno 1
    recompactarCola(fecha, consultorio_id);

    const updated = db.prepare(`
      SELECT t.*, 
             p.nombre AS paciente_nombre, 
             p.documento AS paciente_documento,
             c.nombre AS consultorio_nombre
      FROM turnos t 
      JOIN pacientes p ON p.id = t.paciente_id 
      JOIN consultorios c ON c.id = t.consultorio_id
      WHERE t.id = ?
    `).get(turno.id);
    res.json({ ok: true, turno: updated });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/turnos/marcar-atendido', requireAuth, (req, res) => {
  const { fecha, consultorio_id } = req.body || {};
  if (!fecha || !consultorio_id) {
    return res.status(400).json({ error: 'fecha y consultorio_id son obligatorios' });
  }
  try {
    const turno = db.prepare(`
      SELECT * FROM turnos 
      WHERE fecha = ? AND consultorio_id = ? AND estado = 'EN_ATENCION'
      ORDER BY numero_turno ASC, id ASC LIMIT 1
    `).get(fecha, consultorio_id);
    if (!turno) {
      return res.status(404).json({ error: 'No hay paciente en atención actualmente' });
    }
    db.prepare('UPDATE turnos SET estado = ? WHERE id = ?').run('ATENDIDO', turno.id);
    recompactarCola(fecha, consultorio_id);
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
app.get('/api/pacientes', (req, res) => {
  const { buscar } = req.query;
  try {
    let pacientes;
    if (buscar) {
      pacientes = db.prepare(`
        SELECT * FROM pacientes 
        WHERE nombre LIKE ? OR documento LIKE ?
        ORDER BY nombre ASC
        LIMIT 50
      `).all(`%${buscar}%`, `%${buscar}%`);
    } else {
      pacientes = db.prepare('SELECT * FROM pacientes ORDER BY nombre ASC LIMIT 100').all();
    }
    res.json(pacientes);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Actualizar paciente (nombre, documento, etc.)
app.patch('/api/pacientes/:id', requireAuth, requireRole(['admin', 'recepcion']), (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  const { nombre, documento, telefono, email } = req.body || {};
  if (!nombre && !documento && !telefono && !email) {
    return res.status(400).json({ error: 'Nada que actualizar' });
  }
  try {
    const pac = db.prepare('SELECT * FROM pacientes WHERE id = ?').get(id);
    if (!pac) return res.status(404).json({ error: 'Paciente no encontrado' });
    const updates = [];
    const params = [];
    if (nombre !== undefined) { updates.push('nombre = ?'); params.push(nombre); }
    if (documento !== undefined) { updates.push('documento = ?'); params.push(documento); }
    if (telefono !== undefined) { updates.push('telefono = ?'); params.push(telefono); }
    if (email !== undefined) { updates.push('email = ?'); params.push(email); }
    params.push(id);
    db.prepare(`UPDATE pacientes SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Crear paciente
app.post('/api/pacientes', (req, res) => {
  const { nombre, documento, telefono, email } = req.body || {};
  if (!nombre) {
    return res.status(400).json({ error: 'Nombre es obligatorio' });
  }

  try {
    const stmt = db.prepare('INSERT INTO pacientes (nombre, documento, telefono, email) VALUES (?, ?, ?, ?)');
    const result = stmt.run(nombre, documento || null, telefono || null, email || null);
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ============================================
// ENDPOINTS DE CONSULTORIOS
// ============================================

// Listar consultorios
app.get('/api/consultorios', (req, res) => {
  try {
    const consultorios = db.prepare('SELECT * FROM consultorios WHERE activo = 1 ORDER BY nombre ASC').all();
    res.json(consultorios);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ============================================
// ENDPOINTS DE TURNOS (AGENDA)
// ============================================

// Listar turnos por fecha y consultorio
app.get('/api/turnos', (req, res) => {
  const { fecha, consultorio_id } = req.query;
  if (!fecha || !consultorio_id) {
    return res.status(400).json({ error: 'fecha y consultorio_id son obligatorios' });
  }

  try {
    const turnos = db.prepare(`
      SELECT t.*, 
             p.nombre AS paciente_nombre, 
             p.documento AS paciente_documento,
             p.telefono AS paciente_telefono,
             c.nombre AS consultorio_nombre
      FROM turnos t
      JOIN pacientes p ON p.id = t.paciente_id
      JOIN consultorios c ON c.id = t.consultorio_id
      WHERE t.fecha = ? AND t.consultorio_id = ?
      ORDER BY t.numero_turno ASC, t.id ASC
    `).all(fecha, consultorio_id);
    res.json(turnos);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Crear turno
app.post('/api/turnos', (req, res) => {
  const { paciente_id, consultorio_id, entidad, prioridad = 2, fecha, hora_programada } = req.body || {};

  if (!paciente_id || !consultorio_id || !fecha) {
    return res.status(400).json({ error: 'paciente_id, consultorio_id y fecha son obligatorios' });
  }

  try {
    // Obtener siguiente numero_turno
    const row = db.prepare(
      'SELECT MAX(numero_turno) AS maxNum FROM turnos WHERE fecha = ? AND consultorio_id = ?'
    ).get(fecha, consultorio_id);
    const siguiente = (row?.maxNum || 0) + 1;

    const stmt = db.prepare(`
      INSERT INTO turnos (numero_turno, paciente_id, consultorio_id, entidad, prioridad, estado, fecha, hora_programada)
      VALUES (?, ?, ?, ?, ?, '', ?, ?)
    `);
    const result = stmt.run(
      siguiente,
      paciente_id,
      consultorio_id,
      entidad || '',
      prioridad,
      fecha,
      hora_programada || null
    );

    // Recompactar cola después de crear
    recompactarCola(fecha, consultorio_id);

    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Cambiar estado de un turno (con recompactación automática)
app.patch('/api/turnos/:id/estado', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { estado } = req.body || {};
  if (!id || !estado) {
    return res.status(400).json({ error: 'id y estado son obligatorios' });
  }

  try {
    const turno = db.prepare('SELECT * FROM turnos WHERE id = ?').get(id);
    if (!turno) {
      return res.status(404).json({ error: 'Turno no encontrado' });
    }

    // Si ya está ATENDIDO, no permitir cambios posteriores
    if (turno.estado === 'ATENDIDO' && estado !== 'ATENDIDO') {
      return res.status(400).json({ error: 'No se puede modificar un turno ya atendido' });
    }

    // Actualizar estado y hora_llamado si pasa a EN_ATENCION
    const stmt = db.prepare(`
      UPDATE turnos 
      SET estado = ?, 
          hora_llamado = CASE WHEN ? = 'EN_ATENCION' THEN datetime('now') ELSE hora_llamado END
      WHERE id = ?
    `);
    stmt.run(estado, estado, id);

    // Si el turno pasa a ATENDIDO/CANCELADO/NO_ASISTIO, recompactar cola
    if (['ATENDIDO', 'CANCELADO', 'NO_ASISTIO'].includes(estado)) {
      recompactarCola(turno.fecha, turno.consultorio_id);
    }

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Eliminar turno
app.delete('/api/turnos/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) {
    return res.status(400).json({ error: 'ID inválido' });
  }

  try {
    const turno = db.prepare('SELECT * FROM turnos WHERE id = ?').get(id);
    if (!turno) {
      return res.status(404).json({ error: 'Turno no encontrado' });
    }

    db.prepare('DELETE FROM turnos WHERE id = ?').run(id);
    recompactarCola(turno.fecha, turno.consultorio_id);

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Reordenar número de turno (mover arriba/abajo en la cola)
app.patch('/api/turnos/:id/numero', requireAuth, requireRole(['admin', 'recepcion']), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { delta, numero } = req.body || {};
  if (!id) {
    return res.status(400).json({ error: 'id es obligatorio' });
  }

  try {
    const turno = db.prepare('SELECT * FROM turnos WHERE id = ?').get(id);
    if (!turno) {
      return res.status(404).json({ error: 'Turno no encontrado' });
    }
    // No reordenar si ya está ATENDIDO
    if (turno.estado === 'ATENDIDO') {
      return res.status(400).json({ error: 'No se puede reordenar un turno ya atendido' });
    }

    let nuevoNumero;
    if (Number.isInteger(numero)) {
      nuevoNumero = numero;
    } else if (Number.isInteger(delta)) {
      nuevoNumero = (turno.numero_turno || 1) + delta;
    } else {
      return res.status(400).json({ error: 'Se requiere delta o numero (entero)' });
    }

    if (nuevoNumero < 1) nuevoNumero = 1;

    db.prepare('UPDATE turnos SET numero_turno = ? WHERE id = ?').run(nuevoNumero, id);
    recompactarCola(turno.fecha, turno.consultorio_id);

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ============================================
// ENDPOINTS AGENDA ELECTRODIAGNÓSTICO
// ============================================

// Listar equipos de electrodiagnóstico
app.get('/api/equipos-electro', (req, res) => {
  try {
    const equipos = db.prepare('SELECT * FROM equipos_electro WHERE activo = 1 ORDER BY nombre ASC').all();
    res.json(equipos);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Listar citas electro por fecha y equipo
app.get('/api/citas-electro', (req, res) => {
  const { fecha, equipo_id } = req.query;
  if (!fecha || !equipo_id) {
    return res.status(400).json({ error: 'fecha y equipo_id son obligatorios' });
  }

  try {
    const citas = db.prepare(`
      SELECT c.*, 
             p.nombre AS paciente_nombre, 
             p.documento AS paciente_documento,
             e.nombre AS equipo_nombre
      FROM citas_electro c
      JOIN pacientes p ON p.id = c.paciente_id
      JOIN equipos_electro e ON e.id = c.equipo_id
      WHERE c.fecha = ? AND c.equipo_id = ?
      ORDER BY c.hora_inicio ASC, c.id ASC
    `).all(fecha, equipo_id);
    res.json(citas);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Crear cita electrodiagnóstico
app.post('/api/citas-electro', (req, res) => {
  const { equipo_id, paciente_id, fecha, hora_inicio, hora_fin, estudio, observaciones } = req.body || {};

  if (!equipo_id || !paciente_id || !fecha || !hora_inicio) {
    return res.status(400).json({ error: 'equipo_id, paciente_id, fecha y hora_inicio son obligatorios' });
  }

  try {
    const stmt = db.prepare(`
      INSERT INTO citas_electro (equipo_id, paciente_id, fecha, hora_inicio, hora_fin, estudio, observaciones, estado)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'PROGRAMADO')
    `);
    const result = stmt.run(
      equipo_id,
      paciente_id,
      fecha,
      hora_inicio,
      hora_fin || null,
      estudio || null,
      observaciones || null
    );
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Actualizar estado de cita electro (registra quién editó)
app.patch('/api/citas-electro/:id/estado', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { estado } = req.body || {};
  if (!id || !estado) {
    return res.status(400).json({ error: 'id y estado son obligatorios' });
  }

  try {
    const cita = db.prepare('SELECT * FROM citas_electro WHERE id = ?').get(id);
    if (!cita) {
      return res.status(404).json({ error: 'Cita no encontrada' });
    }

    const userName = req.session.usuario || 'Usuario';
    const user = db.prepare('SELECT nombre FROM usuarios WHERE id = ?').get(req.session.usuarioId);
    const editadoPor = (user && user.nombre) ? user.nombre : userName;

    db.prepare(`
      UPDATE citas_electro 
      SET estado = ?, editado_por_nombre = ?, editado_en = datetime('now')
      WHERE id = ?
    `).run(estado, editadoPor, id);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Eliminar cita electro
app.delete('/api/citas-electro/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) {
    return res.status(400).json({ error: 'ID inválido' });
  }

  try {
    const cita = db.prepare('SELECT * FROM citas_electro WHERE id = ?').get(id);
    if (!cita) {
      return res.status(404).json({ error: 'Cita no encontrada' });
    }

    db.prepare('DELETE FROM citas_electro WHERE id = ?').run(id);
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
app.post('/api/recibos', (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'Cuerpo de la petición inválido' });
  }
  const { numero, cliente, fecha, total, data } = body;
  if (numero == null || cliente == null || fecha == null || total == null || data == null) {
    return res.status(400).json({ error: 'Faltan campos requeridos: numero, cliente, fecha, total, data' });
  }
  try {
    const stmt = db.prepare(
      'INSERT INTO recibos (numero, cliente, fecha, total, data) VALUES (?,?,?,?,?)'
    );
    const result = stmt.run(numero, cliente, fecha, total, JSON.stringify(data));
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// Listar recibos
app.get('/api/recibos', (req, res) => {
  try {
    const stmt = db.prepare('SELECT * FROM recibos ORDER BY id DESC');
    const rows = stmt.all();
    res.json(rows || []);
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// Resetear/limpiar todos los recibos (solo admin)
app.delete('/api/recibos/reset', requireAuth, requireAdmin, (req, res) => {
  try {
    db.prepare('DELETE FROM recibos').run();
    res.json({ ok: true, message: 'Todos los recibos han sido eliminados' });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// Eliminar recibo individual (solo admin)
app.delete('/api/recibos/:id', requireAuth, requireAdmin, (req, res) => {
  const id = parseReciboId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'ID de recibo inválido' });
  try {
    const result = db.prepare('DELETE FROM recibos WHERE id=?').run(id);
    if (result.changes === 0) return res.status(404).json({ error: 'No encontrado' });
    res.json({ ok: true });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// Obtener recibo (por id)
app.get('/api/recibos/:id', (req, res) => {
  const id = parseReciboId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'ID de recibo inválido' });
  try {
    const stmt = db.prepare('SELECT * FROM recibos WHERE id=?');
    const row = stmt.get(id);
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
    const stmt = db.prepare('SELECT * FROM recibos WHERE id=?');
    const row = stmt.get(id);
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
            <div class="receipt-date">Fecha: ${row.fecha}</div>
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
    
    const stmt = db.prepare('SELECT * FROM recibos WHERE fecha=? ORDER BY id DESC');
    const recibos = stmt.all(fecha);
    const total = recibos.reduce((sum, r) => sum + (Number(r.total) || 0), 0);
    // Extraer doc del JSON data de cada recibo (la tabla no tiene columna doc)
    const recibosConDoc = recibos.map(r => {
      let doc = '-';
      try {
        const d = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
        if (d && d.doc != null) doc = String(d.doc);
      } catch (e) { /* ignorar */ }
      return { ...r, doc };
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
          table { width:100%; border-collapse:collapse; margin:12px 0; font-size:11px; }
          th, td { border:1px solid #ddd; padding:6px 8px; text-align:left; font-size:11px; }
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
            <p><strong>Fecha:</strong> ${fecha}</p>
            <p><strong>Total de recibos:</strong> ${recibos.length}</p>
            <p class="total"><strong>Total dinero:</strong> $ ${total.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}</p>
          </div>
          
          <table>
            <thead>
              <tr>
                <th>Recibo Nº</th>
                <th>Documento</th>
                <th>Cliente</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              ${recibosConDoc.map(r => {
                return `<tr>
                  <td>${escapeHtml(r.numero)}</td>
                  <td>${escapeHtml(r.doc)}</td>
                  <td>${escapeHtml(r.cliente)}</td>
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
    
    const stmt = db.prepare('SELECT * FROM recibos WHERE fecha BETWEEN ? AND ? ORDER BY fecha DESC');
    const recibos = stmt.all(fechaInicio, fechaFin);
    const total = recibos.reduce((sum, r) => sum + (Number(r.total) || 0), 0);
    // Extraer doc del JSON data de cada recibo
    const recibosConDoc = recibos.map(r => {
      let doc = '-';
      try {
        const d = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
        if (d && d.doc != null) doc = String(d.doc);
      } catch (e) { /* ignorar */ }
      return { ...r, doc };
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
          table { width:100%; border-collapse:collapse; margin:12px 0; font-size:11px; }
          th, td { border:1px solid #ddd; padding:6px 8px; text-align:left; font-size:11px; }
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
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              ${recibosConDoc.map(r => {
                return `<tr>
                  <td>${escapeHtml(r.fecha)}</td>
                  <td>${escapeHtml(r.numero)}</td>
                  <td>${escapeHtml(r.doc)}</td>
                  <td>${escapeHtml(r.cliente)}</td>
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

const server = app.listen(PORT, () => {
  console.log('');
  console.log('═══════════════════════════════════════════');
  console.log('✅ APLICACIÓN INICIADA CORRECTAMENTE');
  console.log('═══════════════════════════════════════════');
  console.log(`🌐 URL: http://localhost:${PORT}`);
  console.log('📌 Cierra esta ventana para detener');
  console.log('═══════════════════════════════════════════');
  console.log('');
});

// Manejo de errores
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`\n❌ Puerto ${PORT} ya está en uso.\n`);
    console.log(`Intenta con otro puerto:`);
    console.log(`set PORT=3001 && node server.js\n`);
    process.exit(1);
  } else {
    throw error;
  }
});

// Manejo de excepciones no capturadas
process.on('uncaughtException', (error) => {
  console.error('\n❌ Error no controlado:', error.message);
  console.error('El servidor seguirá funcionando, pero verifica los errores anteriores.\n');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('\n❌ Promise rechazado:', reason);
});
