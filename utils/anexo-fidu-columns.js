/**
 * Columnas del anexo FIDU/FOMAG (plantilla .xlsm — fila 1 de datos).
 * Total: 46 columnas.
 */

const ANEXO_FIDU_COLUMNAS = [
  { key: 'nit', label: 'NIT', group: 'factura', width: 110 },
  { key: 'numero_orden_fomag', label: 'NUMERODEORDENEMITIDAXFOMAG', group: 'factura', width: 120 },
  { key: 'fecha_autorizacion_hora', label: 'FECHAAUTORIZACIONYHORA', group: 'factura', width: 140 },
  { key: 'prefijo_fact', label: 'prefijofact', group: 'factura', width: 70 },
  { key: 'num_factura', label: 'NumFactura', group: 'factura', width: 90 },
  { key: 'nombres_1', label: 'NOMBRES (1)', group: 'paciente', width: 100 },
  { key: 'nombres_2', label: 'NOMBRES (2)', group: 'paciente', width: 100 },
  { key: 'apellidos_1', label: 'APELLIDOS (1)', group: 'paciente', width: 100 },
  { key: 'apellidos_2', label: 'APELLIDOS (2)', group: 'paciente', width: 100 },
  { key: 'tipo_documento', label: 'TIPODEDOCUMENTO', group: 'paciente', width: 80 },
  { key: 'numero_documento', label: 'NUMERODOCUMENTO', group: 'paciente', width: 110 },
  { key: 'genero', label: 'GENERO', group: 'paciente', width: 90 },
  { key: 'edad', label: 'EDAD', group: 'paciente', width: 55 },
  { key: 'direccion', label: 'DIRECCION', group: 'paciente', width: 160 },
  { key: 'telefono', label: 'TELEFONO', group: 'paciente', width: 100 },
  { key: 'contacto_emergencia_nombre', label: 'NOMBREDELCONTACTODEEMERGENCIA', group: 'paciente', width: 140 },
  { key: 'contacto_emergencia_telefono', label: 'TELEFONODELCONTACTODEEMERGENCIA', group: 'paciente', width: 140 },
  { key: 'correo', label: 'CORREO', group: 'paciente', width: 140 },
  { key: 'causa_atencion', label: 'CAUSAQUEEMOTIVALAATENCION', group: 'paciente', width: 140 },
  { key: 'especiales_excepcion_cotizante', label: 'EspecialesodeExcepción cotizante/Ben', group: 'paciente', width: 160 },
  { key: 'ciudad', label: 'CIUDAD', group: 'paciente', width: 120 },
  { key: 'fecha_nacimiento', label: 'FECHADENACIMIENTO', group: 'paciente', width: 110 },
  { key: 'ciudad_nacimiento', label: 'CIUDADDENACIMIENTO', group: 'paciente', width: 140 },
  { key: 'ciudad_residencia', label: 'CIUDADDERESIDENCIA', group: 'paciente', width: 160 },
  { key: 'codigo_servicio', label: 'codigo.servicio', group: 'servicio', width: 90 },
  { key: 'nombre_servicio', label: 'nombreservicio', group: 'servicio', width: 200 },
  { key: 'plan', label: 'plan', group: 'servicio', width: 60 },
  { key: 'valor_unitario', label: 'valorunitario', group: 'servicio', width: 100 },
  { key: 'cantidad', label: 'cantidad', group: 'servicio', width: 70 },
  { key: 'valor_total_fact', label: 'VALORTOTALDEFACT', group: 'servicio', width: 110 },
  { key: 'codigo_cie10', label: 'CODIGOCIE10DIAGNOSTICO', group: 'diagnostico', width: 90 },
  { key: 'nombre_diagnostico', label: 'NOMBREDIAGNOSTICO', group: 'diagnostico', width: 180 },
  { key: 'fecha_inicio', label: 'FECHAINICIO', group: 'diagnostico', width: 100 },
  { key: 'fecha_final', label: 'FECHAFINAL', group: 'diagnostico', width: 100 },
  { key: 'nombre_medico', label: 'NOMBREMEDICO', group: 'medico', width: 120 },
  { key: 'medico_quien_realiza_atencion', label: 'MEDICOQUEREALIZAATENCIÓN', group: 'medico', width: 160 },
  { key: 'especialidad_remitente', label: 'EspecialidadRemitente', group: 'medico', width: 130 },
  { key: 'medicamento_psiquiatria', label: 'MEDICAMENTOPSIQUIATRIA', group: 'medico', width: 140 },
  { key: 'proximo_control_psiquiatria', label: 'PROXIMOCONTROLPSIQUIATRIA', group: 'medico', width: 150 },
  { key: 'codigo_prestador', label: 'CODIGOPRESTADOR', group: 'rips', width: 110 },
  { key: 'condicion_destino_persona', label: 'CONDICIONYDESTINODELAPERSONA', group: 'rips', width: 80 },
  { key: 'prioridad_atencion', label: 'PRIORIDADDELAATENCION', group: 'rips', width: 80 },
  { key: 'tipo_atencion_solicitada', label: 'TIPODEATENCIONSOLICITADA', group: 'rips', width: 80 },
  { key: 'grupo_servicio', label: 'GRUPODESERVCIO', group: 'rips', width: 80 },
  { key: 'modalidad_tecnologia_salud', label: 'MODALIDADDEREALIZACIONDELATECNOLOGIAENSALUD', group: 'rips', width: 90 },
  { key: 'codigo_servicio_referencia', label: 'CODIGODELSERVICIOPARAELCUALSESOLICITALAREFERENCIA', group: 'rips', width: 90 }
];

const ANEXO_FIDU_COLUMN_KEYS = ANEXO_FIDU_COLUMNAS.map((c) => c.key);

/** Códigos/fechas cortos → VARCHAR(120); textos largos → TEXT (evita límite 65535 de fila MySQL). */
function sqlTypeForAnexoFiduColumn(key) {
  const varcharKeys = new Set([
    'nit', 'numero_orden_fomag', 'fecha_autorizacion_hora', 'prefijo_fact', 'num_factura',
    'tipo_documento', 'numero_documento', 'genero', 'edad', 'telefono',
    'contacto_emergencia_telefono', 'correo', 'ciudad', 'fecha_nacimiento',
    'codigo_servicio', 'plan', 'valor_unitario', 'cantidad', 'valor_total_fact',
    'codigo_cie10', 'fecha_inicio', 'fecha_final', 'codigo_prestador',
    'condicion_destino_persona', 'prioridad_atencion', 'tipo_atencion_solicitada',
    'grupo_servicio', 'modalidad_tecnologia_salud', 'codigo_servicio_referencia'
  ]);
  return varcharKeys.has(key) ? 'VARCHAR(120)' : 'TEXT';
}

function buildAnexoFiduCreateTableSql() {
  const cols = ANEXO_FIDU_COLUMNAS.map(
    (c) => `\`${c.key}\` ${sqlTypeForAnexoFiduColumn(c.key)} NULL`
  ).join(',\n      ');
  return `CREATE TABLE IF NOT EXISTS anexo_fidu_registros (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      ${cols},
      creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_anexo_fidu_documento (numero_documento),
      INDEX idx_anexo_fidu_orden (numero_orden_fomag)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
}

/** Orden por defecto de filas del anexo: orden de inserción (primero añadido arriba). */
const ANEXO_FIDU_REGISTROS_ORDER_SQL = 'id ASC';

module.exports = {
  ANEXO_FIDU_COLUMNAS,
  ANEXO_FIDU_COLUMN_KEYS,
  ANEXO_FIDU_REGISTROS_ORDER_SQL,
  buildAnexoFiduCreateTableSql
};
