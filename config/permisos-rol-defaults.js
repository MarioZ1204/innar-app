/**
 * Permisos por defecto por rol (servidor).
 * Debe mantenerse alineado con PERMISOS_ROL_DEFAULTS en public/app.js.
 */
const PERMISOS_ROL_DEFAULTS = {
  superadmin: null,
  admin: null,
  admin_recepcion: [
    'modulo.recibos', 'modulo.agenda_medica', 'modulo.electrodiag', 'modulo.dashboard', 'modulo.monitor_equipos',
    'modulo.reportes_pdx', 'modulo.armado_soportes', 'modulo.llamado_pacientes', 'llamado.configurar',
    'soportes.pdx.ver', 'soportes.pdx.carpetas.todas', 'soportes.pdx.crear_carpeta', 'soportes.pdx.subir', 'soportes.pdx.editar',
    'soportes.armado.crear_estructura', 'soportes.armado.subir', 'soportes.armado.importar_pdx', 'soportes.descargar_zip',
    'modulo.reportes_historico',
    'recibos.crear', 'recibos.ver', 'recibos.exportar', 'recibos.pagar', 'recibos.pendiente',
    'agenda.ver', 'agenda.crear', 'agenda.editar', 'agenda.eliminar', 'agenda.cambiar_estado',
    'agenda.llamar_siguiente', 'agenda.marcar_atendido', 'agenda.aviso_doctor', 'agenda.disponibilidad',
    'electro.ver', 'electro.crear', 'electro.editar', 'electro.cambiar_estado', 'electro.subir_archivo', 'electro.ver_archivo', 'electro.aviso_doctor',
    'sistema.dashboard'
  ],
  recepcion: [
    'modulo.recibos', 'modulo.agenda_medica', 'modulo.electrodiag', 'modulo.dashboard', 'modulo.monitor_equipos',
    'modulo.reportes_pdx', 'modulo.armado_soportes', 'modulo.llamado_pacientes', 'llamado.configurar',
    'soportes.pdx.ver', 'soportes.pdx.carpetas.todas', 'soportes.pdx.crear_carpeta', 'soportes.pdx.subir', 'soportes.pdx.editar',
    'soportes.armado.crear_estructura', 'soportes.armado.subir', 'soportes.armado.importar_pdx', 'soportes.descargar_zip',
    'modulo.reportes_historico',
    'recibos.crear', 'recibos.ver', 'recibos.pagar', 'recibos.pendiente',
    'agenda.ver', 'agenda.crear', 'agenda.editar', 'agenda.eliminar', 'agenda.cambiar_estado',
    'agenda.llamar_siguiente', 'agenda.marcar_atendido', 'agenda.aviso_doctor',
    'electro.ver', 'electro.crear', 'electro.editar', 'electro.cambiar_estado',
    'sistema.dashboard'
  ],
  auxiliar_recepcion: [
    'modulo.recibos', 'modulo.agenda_medica', 'modulo.electrodiag', 'modulo.reportes_pdx', 'modulo.llamado_pacientes', 'llamado.configurar',
    'soportes.pdx.ver', 'soportes.pdx.subir',
    'recibos.crear', 'recibos.ver', 'recibos.pagar', 'recibos.pendiente',
    'agenda.ver', 'agenda.crear', 'agenda.editar', 'agenda.cambiar_estado', 'agenda.aviso_doctor',
    'electro.ver', 'electro.crear'
  ],
  admin_electro: [
    'modulo.electrodiag', 'modulo.agenda_medica', 'modulo.dashboard', 'modulo.monitor_equipos',
    'modulo.reportes_pdx', 'modulo.armado_soportes', 'modulo.llamado_pacientes', 'llamado.configurar',
    'soportes.pdx.ver', 'soportes.pdx.carpetas.todas', 'soportes.pdx.crear_carpeta', 'soportes.pdx.subir', 'soportes.pdx.editar',
    'soportes.armado.crear_estructura', 'soportes.armado.subir', 'soportes.armado.importar_pdx', 'soportes.descargar_zip',
    'modulo.reportes_historico',
    'electro.ver', 'electro.crear', 'electro.editar', 'electro.eliminar', 'electro.cambiar_estado', 'electro.subir_archivo', 'electro.ver_archivo', 'electro.aviso_doctor',
    'agenda.ver', 'agenda.editar', 'agenda.aviso_doctor',
    'sistema.dashboard'
  ],
  electro: [
    'modulo.electrodiag', 'modulo.agenda_medica', 'modulo.dashboard', 'modulo.monitor_equipos',
    'modulo.reportes_pdx', 'modulo.armado_soportes', 'modulo.llamado_pacientes', 'llamado.configurar',
    'soportes.pdx.ver', 'soportes.pdx.carpetas.todas', 'soportes.pdx.crear_carpeta', 'soportes.pdx.subir', 'soportes.pdx.editar',
    'soportes.armado.crear_estructura', 'soportes.armado.subir', 'soportes.armado.importar_pdx', 'soportes.descargar_zip',
    'modulo.reportes_historico',
    'electro.ver', 'electro.crear', 'electro.editar', 'electro.eliminar', 'electro.cambiar_estado', 'electro.subir_archivo', 'electro.ver_archivo', 'electro.aviso_doctor',
    'agenda.ver', 'agenda.editar', 'agenda.aviso_doctor',
    'sistema.dashboard'
  ],
  tecnico_electro: [
    'modulo.electrodiag', 'modulo.agenda_medica', 'modulo.monitor_equipos',
    'electro.ver', 'electro.crear', 'electro.editar', 'electro.cambiar_estado', 'electro.subir_archivo', 'electro.ver_archivo',
    'agenda.ver', 'agenda.editar', 'agenda.aviso_doctor'
  ],
  doctor: [
    'modulo.agenda_medica', 'modulo.electrodiag', 'modulo.dashboard',
    'agenda.ver', 'agenda.cambiar_estado', 'agenda.llamar_siguiente', 'agenda.marcar_atendido', 'agenda.disponibilidad',
    'electro.ver', 'electro.cambiar_estado', 'electro.subir_archivo', 'electro.ver_archivo',
    'sistema.dashboard',
    'chat.usar',
  ],
  contabilidad: [
    'modulo.recibos', 'modulo.dashboard',
    'modulo.reportes_pdx', 'modulo.armado_soportes', 'modulo.llamado_pacientes', 'llamado.configurar',
    'soportes.pdx.ver', 'soportes.pdx.carpetas.todas', 'soportes.pdx.crear_carpeta', 'soportes.pdx.subir', 'soportes.pdx.editar',
    'soportes.armado.crear_estructura', 'soportes.armado.subir', 'soportes.armado.importar_pdx', 'soportes.descargar_zip',
    'modulo.reportes_historico',
    'recibos.ver', 'recibos.exportar', 'recibos.pagar', 'recibos.pendiente',
    'sistema.dashboard', 'sistema.reportes'
  ]
};

module.exports = { PERMISOS_ROL_DEFAULTS };
