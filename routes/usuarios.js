// routes/usuarios.js — CRUD de usuarios, permisos, auditoría y reset password
const express = require('express');
const router = express.Router();
const db = require('../utils/db-mysql');
const auditLog = require('../modules/audit-log');
const validation = require('../modules/validation');
const logger = require('../utils/logger');
const { requireAuth, requireRoleOrPerm, safeError, emitSocket } = require('../middleware');
const {
  isValidClientHash,
  hashForStorage,
  generarPasswordTemporal,
  hashTemporalParaAlmacenar
} = require('../utils/password');
const { validateSchema } = require('../modules/validation-schemas');

const ROLES_VALIDOS = ['superadmin', 'admin', 'admin_recepcion', 'recepcion', 'admin_electro', 'electro', 'tecnico_electro', 'auxiliar_recepcion', 'doctor', 'contabilidad'];

const PERMISOS_VALIDOS = new Set([
  'modulo.recibos', 'modulo.agenda_medica', 'modulo.electrodiag', 'modulo.ucqn',
  'modulo.dashboard', 'modulo.usuarios', 'modulo.diagnosticos', 'modulo.gestion_datos',
  'recibos.crear', 'recibos.ver', 'recibos.editar', 'recibos.anular', 'recibos.eliminar',
  'recibos.exportar', 'recibos.gestionar_servicios', 'recibos.resetear',
  'agenda.ver', 'agenda.crear', 'agenda.editar', 'agenda.eliminar', 'agenda.cambiar_estado',
  'agenda.llamar_siguiente', 'agenda.marcar_atendido', 'agenda.aviso_doctor', 'agenda.disponibilidad',
  'agenda.editar_siempre',
  'electro.ver', 'electro.crear', 'electro.editar', 'electro.eliminar', 'electro.cambiar_estado',
  'electro.subir_archivo', 'electro.ver_archivo', 'electro.aviso_doctor',
  'ucqn.ver', 'ucqn.editar_estado',
  'usuarios.ver', 'usuarios.crear', 'usuarios.editar', 'usuarios.cambiar_clave',
  'usuarios.eliminar', 'usuarios.auditoria', 'usuarios.permisos',
  'diagnosticos.ver', 'diagnosticos.crear', 'diagnosticos.editar', 'diagnosticos.eliminar',
  'sistema.backups', 'sistema.exportar_datos', 'sistema.dashboard', 'sistema.reportes'
]);

// ── Listar usuarios ──────────────────────────────────────────────────────────
router.get('/', requireAuth, requireRoleOrPerm(['superadmin', 'admin'], 'usuarios.ver'), async (req, res) => {
  try {
    const usuarios = await db.query(
      'SELECT id, usuario, nombre, rol, activo, numero_consultorio, especialidad, permisos FROM usuarios ORDER BY usuario ASC'
    );
    res.json(usuarios);
  } catch (e) {
    logger.error(e.message, { error: e });
    res.status(500).json({ error: safeError(e) });
  }
});

// ── Crear usuario ────────────────────────────────────────────────────────────
router.post('/', requireAuth, requireRoleOrPerm(['superadmin', 'admin'], 'usuarios.crear'), validateSchema('apiCrearUsuario'), async (req, res) => {
  const { usuario, password, nombre, rol, numero_consultorio, especialidad } = req.body || {};

  if (!usuario || !password || !nombre || !rol) {
    return res.status(400).json({ error: 'usuario, password, nombre y rol son obligatorios' });
  }

  const usernameValidation = validation.validateUsername(usuario);
  if (!usernameValidation.isValid) {
    return res.status(400).json({ error: usernameValidation.messages[0] });
  }

  if (!isValidClientHash(password)) {
    return res.status(400).json({ error: 'Contraseña inválida' });
  }

  if (!ROLES_VALIDOS.includes(rol)) {
    return res.status(400).json({ error: 'Rol inválido.' });
  }

  if (rol === 'superadmin' && req.session.rol !== 'superadmin') {
    return res.status(403).json({ error: 'Solo superadmin puede asignar el rol superadmin' });
  }

  let consultorioFinal = null;
  let especialidadFinal = null;
  if (rol === 'doctor') {
    const numConsultorio = parseInt(numero_consultorio, 10);
    if (isNaN(numConsultorio) || numConsultorio < 1) {
      return res.status(400).json({ error: 'Número de consultorio debe ser un número válido' });
    }
    consultorioFinal = numConsultorio;
    if (!especialidad || especialidad.trim() === '') {
      return res.status(400).json({ error: 'La especialidad es obligatoria para DOCTOR' });
    }
    especialidadFinal = especialidad.trim();
  }

  try {
    const hash = hashForStorage(password);
    const result = await db.execute(
      'INSERT INTO usuarios (usuario, password_hash, nombre, rol, numero_consultorio, especialidad) VALUES (?, ?, ?, ?, ?, ?)',
      [usuario, hash, nombre, rol, consultorioFinal, especialidadFinal]
    );

    await auditLog.registrarAuditoria({
      usuarioId: result.insertId,
      adminId: req.session.usuarioId,
      adminUsuario: req.session.usuario,
      accion: 'CREAR',
      cambios: { usuario, nombre, rol, numero_consultorio: consultorioFinal, especialidad: especialidadFinal },
      ip: req.ip
    });

    emitSocket('usuario:creado', { id: result.insertId });
    res.json({ ok: true, id: result.insertId });
  } catch (e) {
    if (e.message && e.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'El usuario ya existe' });
    }
    logger.error(e.message, { error: e });
    res.status(500).json({ error: safeError(e) });
  }
});

// ── Editar usuario ───────────────────────────────────────────────────────────
router.patch('/:id', requireAuth, requireRoleOrPerm(['superadmin', 'admin'], 'usuarios.editar'), validateSchema('apiActualizarUsuario'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { usuario, password, nombre, rol, activo, numero_consultorio, especialidad } = req.body || {};
  if (!id) return res.status(400).json({ error: 'ID inválido' });

  try {
    const users = await db.query('SELECT id, usuario, nombre, rol, activo, numero_consultorio, especialidad FROM usuarios WHERE id = ?', [id]);
    const user = users.length > 0 ? users[0] : null;
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    const updates = [];
    const params = [];
    const nuevoRol = rol !== undefined ? rol : user.rol;

    if (usuario !== undefined) { updates.push('usuario = ?'); params.push(usuario); }
    if (nombre !== undefined) { updates.push('nombre = ?'); params.push(nombre); }
    if (rol !== undefined) {
      if (!ROLES_VALIDOS.includes(rol)) return res.status(400).json({ error: 'Rol inválido' });
      if (user.rol === 'superadmin' && rol !== 'superadmin') {
        return res.status(403).json({ error: 'No se puede cambiar el rol del Super Administrador' });
      }
      if (rol === 'superadmin' && req.session.rol !== 'superadmin') {
        return res.status(403).json({ error: 'Solo superadmin puede asignar el rol superadmin' });
      }
      updates.push('rol = ?'); params.push(rol);
    }

    if (numero_consultorio !== undefined) {
      let consultorioFinal = null;
      if (numero_consultorio !== null) {
        const num = parseInt(numero_consultorio, 10);
        if (isNaN(num) || num < 1) return res.status(400).json({ error: 'Número de consultorio debe ser un número válido' });
        consultorioFinal = num;
      }
      updates.push('numero_consultorio = ?');
      params.push(consultorioFinal);
    } else if (rol === 'doctor' && user.rol !== 'doctor') {
      return res.status(400).json({ error: 'Número de consultorio es obligatorio para DOCTOR' });
    } else if (rol !== 'doctor' && user.rol === 'doctor') {
      updates.push('numero_consultorio = ?');
      params.push(null);
    }

    if (especialidad !== undefined && (nuevoRol === 'doctor' || rol === 'doctor')) {
      let especialidadFinal = null;
      if (especialidad !== null && especialidad.trim() !== '') especialidadFinal = especialidad.trim();
      if (nuevoRol === 'doctor' && !especialidadFinal) {
        return res.status(400).json({ error: 'La especialidad es obligatoria para DOCTOR' });
      }
      updates.push('especialidad = ?');
      params.push(especialidadFinal);
    } else if (rol !== 'doctor' && user.rol === 'doctor') {
      updates.push('especialidad = ?');
      params.push(null);
    }

    if (activo !== undefined) { updates.push('activo = ?'); params.push(activo ? 1 : 0); }
    if (password && password.trim()) {
      if (!isValidClientHash(password)) {
        return res.status(400).json({ error: 'Contraseña inválida' });
      }
      updates.push('password_hash = ?');
      params.push(hashForStorage(password));
    }

    if (updates.length === 0) return res.status(400).json({ error: 'Nada que actualizar' });
    params.push(id);
    await db.execute(`UPDATE usuarios SET ${updates.join(', ')} WHERE id = ?`, params);

    const cambios = {};
    if (usuario !== undefined && usuario !== user.usuario) cambios.usuario = { antes: user.usuario, despues: usuario };
    if (nombre !== undefined && nombre !== user.nombre) cambios.nombre = { antes: user.nombre, despues: nombre };
    if (rol !== undefined && rol !== user.rol) cambios.rol = { antes: user.rol, despues: rol };
    if (numero_consultorio !== undefined && numero_consultorio !== user.numero_consultorio) cambios.numero_consultorio = { antes: user.numero_consultorio, despues: numero_consultorio };
    if (especialidad !== undefined && especialidad !== user.especialidad) cambios.especialidad = { antes: user.especialidad || '', despues: especialidad || '' };
    if (activo !== undefined && (activo ? 1 : 0) !== user.activo) cambios.activo = { antes: user.activo, despues: activo ? 1 : 0 };
    if (password && password.trim()) cambios.password = { antes: '***', despues: '***' };

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

    emitSocket('usuario:actualizado', { id });
    res.json({ ok: true });
  } catch (e) {
    if (e.message && e.message.includes('UNIQUE')) return res.status(400).json({ error: 'El usuario ya existe' });
    logger.error(e.message, { error: e });
    res.status(500).json({ error: safeError(e) });
  }
});

// ── Permisos granulares ──────────────────────────────────────────────────────
router.get('/:id/permisos', requireAuth, requireRoleOrPerm(['superadmin'], 'usuarios.permisos'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  try {
    const rows = await db.query('SELECT id, usuario, nombre, rol, permisos FROM usuarios WHERE id = ?', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });
    const u = rows[0];
    let permisos = null;
    if (u.permisos) {
      try { permisos = typeof u.permisos === 'string' ? JSON.parse(u.permisos) : u.permisos; } catch (_) {}
    }
    res.json({ id: u.id, usuario: u.usuario, nombre: u.nombre, rol: u.rol, permisos });
  } catch (e) { res.status(500).json({ error: safeError(e) }); }
});

router.put('/:id/permisos', requireAuth, requireRoleOrPerm(['superadmin'], 'usuarios.permisos'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  const { permisos } = req.body;
  if (permisos !== null && !Array.isArray(permisos)) return res.status(400).json({ error: 'permisos debe ser array o null' });
  if (Array.isArray(permisos)) {
    for (const p of permisos) {
      if (typeof p !== 'string') return res.status(400).json({ error: 'permisos debe contener solo cadenas de texto' });
      if (p.length < 2 || p.length > 80 || !/^[a-z0-9._]+$/i.test(p)) {
        return res.status(400).json({ error: 'Formato de clave de permiso no válido' });
      }
      if (!PERMISOS_VALIDOS.has(p)) {
        return res.status(400).json({ error: `Permiso desconocido: "${p}"` });
      }
    }
  }
  try {
    const rows = await db.query('SELECT rol FROM usuarios WHERE id = ?', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (rows[0].rol === 'superadmin') return res.status(403).json({ error: 'No se pueden modificar permisos del superadmin' });
    const value = permisos === null ? null : JSON.stringify(permisos);
    await db.execute('UPDATE usuarios SET permisos = ? WHERE id = ?', [value, id]);
    emitSocket('usuario:permisos-cambiados', { userId: id });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: safeError(e) }); }
});

// ── Eliminar usuario ─────────────────────────────────────────────────────────
router.delete('/:id', requireAuth, requireRoleOrPerm(['superadmin', 'admin'], 'usuarios.eliminar'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  if (id === req.session.usuarioId) return res.status(400).json({ error: 'No puedes eliminar tu propio usuario' });

  try {
    const userBefore = await db.queryOne('SELECT usuario, nombre, rol FROM usuarios WHERE id = ?', [id]);
    if (!userBefore) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (userBefore.rol === 'superadmin') return res.status(403).json({ error: 'El Super Administrador no puede ser eliminado' });

    const result = await db.execute('DELETE FROM usuarios WHERE id = ?', [id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Usuario no encontrado' });

    await auditLog.registrarAuditoria({
      usuarioId: id,
      adminId: req.session.usuarioId,
      adminUsuario: req.session.usuario,
      accion: 'ELIMINAR',
      cambios: { usuario: userBefore.usuario, nombre: userBefore.nombre },
      ip: req.ip
    });

    emitSocket('usuario:eliminado', { id });
    res.json({ ok: true });
  } catch (e) {
    logger.error(e.message, { error: e });
    res.status(500).json({ error: safeError(e) });
  }
});

// ── Toggle activo/inactivo ───────────────────────────────────────────────────
router.patch('/:id/toggle-estado', requireAuth, requireRoleOrPerm(['superadmin', 'admin'], 'usuarios.editar'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  if (id === req.session.usuarioId) return res.status(400).json({ error: 'No puedes cambiar tu propio estado' });

  try {
    const user = await db.queryOne('SELECT id, activo FROM usuarios WHERE id = ?', [id]);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    const nuevoEstado = user.activo ? 0 : 1;
    await db.execute('UPDATE usuarios SET activo = ? WHERE id = ?', [nuevoEstado, id]);

    await auditLog.registrarAuditoria({
      usuarioId: id,
      adminId: req.session.usuarioId,
      adminUsuario: req.session.usuario,
      accion: nuevoEstado ? 'ACTIVAR' : 'DESACTIVAR',
      cambios: { activo: { antes: user.activo, despues: nuevoEstado } },
      ip: req.ip
    });

    emitSocket('usuario:actualizado', { id, activo: nuevoEstado });
    res.json({ ok: true, activo: nuevoEstado });
  } catch (e) {
    logger.error(e.message, { error: e });
    res.status(500).json({ error: safeError(e) });
  }
});

// ── Historial de auditoría de un usuario ─────────────────────────────────────
router.get('/:id/historial', requireAuth, requireRoleOrPerm(['superadmin', 'admin'], 'usuarios.auditoria'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  try {
    const historial = await auditLog.obtenerHistorial(id, 50);
    res.json(historial);
  } catch (e) {
    logger.error(e.message, { error: e });
    res.status(500).json({ error: safeError(e) });
  }
});

// ── Reset password por admin ─────────────────────────────────────────────────
router.patch('/:id/reset-password', requireAuth, requireRoleOrPerm(['superadmin', 'admin'], 'usuarios.cambiar_clave'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  if (id === req.session.usuarioId) return res.status(400).json({ error: 'No puedes resetear tu propia contraseña' });

  try {
    const user = await db.queryOne('SELECT id, usuario, nombre FROM usuarios WHERE id = ?', [id]);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    const passwordTemporal = generarPasswordTemporal();
    const passwordHash = hashTemporalParaAlmacenar(passwordTemporal);
    await db.execute('UPDATE usuarios SET password_hash = ? WHERE id = ?', [passwordHash, id]);

    await auditLog.registrarAuditoria({
      usuarioId: id,
      adminId: req.session.usuarioId,
      adminUsuario: req.session.usuario,
      accion: 'RESET_PASSWORD',
      cambios: { password: { antes: '***', despues: '***' } },
      ip: req.ip
    });

    emitSocket('usuario:actualizado', { id, passwordReset: true });
    res.json({ ok: true, usuario: user.usuario, nombre: user.nombre, passwordTemporal });
  } catch (e) {
    logger.error(e.message, { error: e });
    res.status(500).json({ error: safeError(e) });
  }
});

module.exports = router;
