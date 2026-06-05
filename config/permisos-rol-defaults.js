/**
 * Permisos por defecto por rol (servidor).
 * Debe mantenerse alineado con PERMISOS_ROL_DEFAULTS en public/app.js.
 */
const PERMISOS_ROL_DEFAULTS = {
  superadmin: null,
  admin: null,
  admin_recepcion: [
    'modulo.recibos', 'modulo.agenda_medica', 'modulo.electrodiag', 'modulo.ucqn', 'modulo.dashboard', 'modulo.monitor_equipos',
    'modulo.reportes_pdx', 'modulo.armado_soportes',
    'soportes.pdx.ver', 'soportes.pdx.carpetas.todas', 'soportes.pdx.crear_carpeta', 'soportes.pdx.subir', 'soportes.pdx.editar',
    'soportes.armado.crear_estructura', 'soportes.armado.subir', 'soportes.armado.importar_pdx', 'soportes.descargar_zip',
    'recibos.crear', 'recibos.ver', 'recibos.exportar',
    'agenda.ver', 'agenda.crear', 'agenda.editar', 'agenda.eliminar', 'agenda.cambiar_estado',
    'agenda.llamar_siguiente', 'agenda.marcar_atendido', 'agenda.aviso_doctor', 'agenda.disponibilidad',
    'electro.ver', 'electro.crear', 'electro.editar', 'electro.cambiar_estado', 'electro.subir_archivo', 'electro.ver_archivo', 'electro.aviso_doctor',
    'ucqn.ver', 'ucqn.editar_estado',
    'sistema.dashboard'
  ],
  recepcion: [
    'modulo.recibos', 'modulo.agenda_medica', 'modulo.electrodiag', 'modulo.ucqn', 'modulo.dashboard', 'modulo.monitor_equipos',
    'modulo.reportes_pdx', 'modulo.armado_soportes',
    'soportes.pdx.ver', 'soportes.pdx.carpetas.todas', 'soportes.pdx.crear_carpeta', 'soportes.pdx.subir', 'soportes.pdx.editar',
    'soportes.armado.crear_estructura', 'soportes.armado.subir', 'soportes.armado.importar_pdx', 'soportes.descargar_zip',
    'recibos.crear', 'recibos.ver',
    'agenda.ver', 'agenda.crear', 'agenda.editar', 'agenda.eliminar', 'agenda.cambiar_estado',
    'agenda.llamar_siguiente', 'agenda.marcar_atendido', 'agenda.aviso_doctor',
    'electro.ver', 'electro.crear', 'electro.editar', 'electro.cambiar_estado',
    'ucqn.ver', 'ucqn.editar_estado',
    'sistema.dashboard'
  ],
  auxiliar_recepcion: [
    'modulo.recibos', 'modulo.agenda_medica', 'modulo.electrodiag', 'modulo.reportes_pdx',
    'soportes.pdx.ver', 'soportes.pdx.subir',
    'recibos.crear', 'recibos.ver',
    'agenda.ver', 'agenda.crear', 'agenda.editar', 'agenda.cambiar_estado', 'agenda.aviso_doctor',
    'electro.ver', 'electro.crear'
  ],
  admin_electro: [
    'modulo.electrodiag', 'modulo.ucqn', 'modulo.agenda_medica', 'modulo.dashboard', 'modulo.monitor_equipos',
    'modulo.reportes_pdx', 'modulo.armado_soportes',
    'soportes.pdx.ver', 'soportes.pdx.carpetas.todas', 'soportes.pdx.crear_carpeta', 'soportes.pdx.subir', 'soportes.pdx.editar',
    'soportes.armado.crear_estructura', 'soportes.armado.subir', 'soportes.armado.importar_pdx', 'soportes.descargar_zip',
    'electro.ver', 'electro.crear', 'electro.editar', 'electro.eliminar', 'electro.cambiar_estado', 'electro.subir_archivo', 'electro.ver_archivo', 'electro.aviso_doctor',
    'agenda.ver', 'agenda.editar', 'agenda.aviso_doctor',
    'ucqn.ver', 'ucqn.editar_estado',
    'sistema.dashboard'
  ],
  electro: [
    'modulo.electrodiag', 'modulo.ucqn', 'modulo.agenda_medica', 'modulo.dashboard', 'modulo.monitor_equipos',
    'modulo.reportes_pdx', 'modulo.armado_soportes',
    'soportes.pdx.ver', 'soportes.pdx.carpetas.todas', 'soportes.pdx.crear_carpeta', 'soportes.pdx.subir', 'soportes.pdx.editar',
    'soportes.armado.crear_estructura', 'soportes.armado.subir', 'soportes.armado.importar_pdx', 'soportes.descargar_zip',
    'electro.ver', 'electro.crear', 'electro.editar', 'electro.eliminar', 'electro.cambiar_estado', 'electro.subir_archivo', 'electro.ver_archivo', 'electro.aviso_doctor',
    'agenda.ver', 'agenda.editar', 'agenda.aviso_doctor',
    'ucqn.ver', 'ucqn.editar_estado',
    'sistema.dashboard'
  ],
  tecnico_electro: [
    'modulo.electrodiag', 'modulo.agenda_medica', 'modulo.monitor_equipos',
    'electro.ver', 'electro.crear', 'electro.editar', 'electro.cambiar_estado', 'electro.subir_archivo', 'electro.ver_archivo',
    'agenda.ver', 'agenda.editar', 'agenda.aviso_doctor'
  ],
  contabilidad: [
    'modulo.recibos', 'modulo.ucqn', 'modulo.dashboard',
    'modulo.reportes_pdx', 'modulo.armado_soportes',
    'soportes.pdx.ver', 'soportes.pdx.carpetas.todas', 'soportes.pdx.crear_carpeta', 'soportes.pdx.subir', 'soportes.pdx.editar',
    'soportes.armado.crear_estructura', 'soportes.armado.subir', 'soportes.armado.importar_pdx', 'soportes.descargar_zip', 'soportes.ver_archivo',
    'recibos.ver', 'recibos.exportar',
    'ucqn.ver', 'ucqn.editar_estado',
    'sistema.dashboard', 'sistema.reportes'
  ]
};

module.exports = { PERMISOS_ROL_DEFAULTS };
