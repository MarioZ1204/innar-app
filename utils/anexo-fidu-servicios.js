/**
 * Catálogo de servicios FOMAG / FIDU — valores por código CUPS según tarifario Innar.
 * Al elegir el servicio se rellenan codigo, nombre, plan, valores y códigos RIPS.
 */

/** Campos que el catálogo CUPS recalcula; el resto se preserva al guardar/editar. */
const CAMPOS_SERVICIO_AUTO = new Set([
  'nit', 'prefijo_fact', 'ciudad', 'nombre_servicio', 'plan', 'valor_unitario',
  'cantidad', 'valor_total_fact', 'condicion_destino_persona', 'prioridad_atencion',
  'tipo_atencion_solicitada', 'grupo_servicio', 'modalidad_tecnologia_salud',
  'codigo_servicio_referencia', 'codigo_servicio'
]);

const ANEXO_FIDU_VALORES_FIJOS = {
  nit: '901164565-1',
  prefijo_fact: 'FE',
  ciudad: 'Pasto',
  ciudad_residencia: 'San Juan de Pasto',
  plan: '25',
  condicion_destino_persona: '05',
  prioridad_atencion: '02',
  tipo_atencion_solicitada: '03',
  grupo_servicio: '02',
  modalidad_tecnologia_salud: '01'
};

/** @type {Array<{codigo:string,nombre:string,valor_unitario:number,cantidad:string,valor_total:number,codigo_servicio_referencia:string}>} */
const ANEXO_FIDU_CATALOGO_SERVICIOS = [
  { codigo: '861411', nombre: 'INYECCION DE MATERIAL MIORELAJANTE (TOXINA BOTULINICA) NO INCLUYE LA TOXINA BOTULINICA', valor_unitario: 439205, cantidad: '1', valor_total: 439205, codigo_servicio_referencia: '327' },
  { codigo: '890202', nombre: 'CONSULTA DE PRIMERA VEZ  POR OTRAS ESPECIALIDADES MEDICAS ', valor_unitario: 150000, cantidad: '1', valor_total: 150000, codigo_servicio_referencia: '356' },
  { codigo: '890208', nombre: 'CONSULTA AMBULATORIA DE PRIMERA VEZ POR PSICOLOGIA', valor_unitario: 23340, cantidad: '1', valor_total: 23340, codigo_servicio_referencia: '344' },
  { codigo: '890211', nombre: 'CONSULTA DE PRIMERA VEZ POR FISIOTERAPIA', valor_unitario: 35119, cantidad: '1', valor_total: 35119, codigo_servicio_referencia: '327' },
  { codigo: '890274', nombre: 'CONSULTA AMBULATORIA DE MEDICINA ESPECIALIZADA NEUROLOGIA PRIMERA VEZ ', valor_unitario: 53365, cantidad: '1', valor_total: 53365, codigo_servicio_referencia: '332' },
  { codigo: '890284', nombre: ' CONSULTA AMBULATORIA DE MEDICINA ESPECIALIZADA DE PSIQUIATRIA PRIMERA VEZ', valor_unitario: 53365, cantidad: '1', valor_total: 53365, codigo_servicio_referencia: '332' },
  { codigo: '890297', nombre: 'CONSULTA DE PRIMERA VEZ  POR OTRAS ESPECIALIDADES DE PSICOLOGIA', valor_unitario: 53365, cantidad: '1', valor_total: 53365, codigo_servicio_referencia: '334' },
  { codigo: '890302', nombre: 'CONSULTA DE CONTROL O DE SEGUIMIENTO  POR OTRAS ESPECIALIDADES MEDICAS ', valor_unitario: 150000, cantidad: '1', valor_total: 150000, codigo_servicio_referencia: '356' },
  { codigo: '890308', nombre: 'CONSULTA AMBULATORIA  DE CONTROL POR PSICOLOGIA', valor_unitario: 23340, cantidad: '1', valor_total: 23340, codigo_servicio_referencia: '344' },
  { codigo: '890374', nombre: 'CONSULTA AMBULATORIA DE MEDICINA ESPECIALIZADA NEUROLOGIA CONTROL', valor_unitario: 53365, cantidad: '1', valor_total: 53365, codigo_servicio_referencia: '332' },
  { codigo: '890384', nombre: ' CONSULTA AMBULATORIA DE MEDICINA ESPECIALIZADA DE PSIQUIATRIA CONTROL', valor_unitario: 53365, cantidad: '1', valor_total: 53365, codigo_servicio_referencia: '332' },
  { codigo: '891401', nombre: 'ELECTROENCEFALOGRAMA  CONVENCIONAL', valor_unitario: 75000, cantidad: '1', valor_total: 75000, codigo_servicio_referencia: '327' },
  { codigo: '891402', nombre: 'ELECTROENCEFALOGRAMA COMPUTARIZADO', valor_unitario: 75000, cantidad: '1', valor_total: 75000, codigo_servicio_referencia: '327' },
  { codigo: '891410', nombre: 'ELECTROENCEFALOGRAMA DIGITAL CON MAPEO CEREBRAL', valor_unitario: 113300, cantidad: '1', valor_total: 113300, codigo_servicio_referencia: '327' },
  { codigo: '891703', nombre: 'POLISOMNOGRAMA EN TITULACION DE DISPOSITIVO MEDICO', valor_unitario: 1950000, cantidad: '1', valor_total: 1950000, codigo_servicio_referencia: '327' },
  { codigo: '891704', nombre: 'ESTUDIO FISIOLOGICO COMPLETO DEL SUEÑO (POLISOMNOGRAFIA BASICA)', valor_unitario: 1564355, cantidad: '1', valor_total: 1564355, codigo_servicio_referencia: '327' },
  { codigo: '891901', nombre: 'MONITORIZACION ELECTROENCEFALOGRAFICA POR VIDEO Y RADIO X HORAS DE EXAMEN', valor_unitario: 218660, cantidad: '1', valor_total: 218660, codigo_servicio_referencia: '327' },
  { codigo: '931001', nombre: 'TERAPIA FISICA INTEGRAL ', valor_unitario: 23748, cantidad: '', valor_total: 0, codigo_servicio_referencia: '739' },
  { codigo: '931002', nombre: 'TERAPIA CON ONDAS DE CHOQUE DEL SISTEMA OSTEOMUSCULAR (CADA SESION)', valor_unitario: 65000, cantidad: '', valor_total: 0, codigo_servicio_referencia: '739' },
  { codigo: '931601', nombre: 'MODALIDADES MECANICAS DE TERAPIA SOD (CADA SESION)', valor_unitario: 28000, cantidad: '', valor_total: 0, codigo_servicio_referencia: '739' },
  { codigo: '933501', nombre: 'TERAPIA FISICA DE REHABILITACION PULMONAR (CADA SESION)', valor_unitario: 57200, cantidad: '', valor_total: 0, codigo_servicio_referencia: '739' },
  { codigo: '934201', nombre: 'TRACCION CUTANEA PARA DESCOMPRESION DE CANAL RAQUIDEO SEGMENTO LUMBAR (CADA SESION)', valor_unitario: 28000, cantidad: '', valor_total: 0, codigo_servicio_referencia: '739' },
  { codigo: '934601', nombre: 'TRACCION CUTANEA DE MIEMBROS (CADA SESION)', valor_unitario: 28000, cantidad: '', valor_total: 0, codigo_servicio_referencia: '739' },
  { codigo: '940701', nombre: 'APLICACION DE PRUEBA NEUROPSICOLOGICA', valor_unitario: 53365, cantidad: '', valor_total: 0, codigo_servicio_referencia: '344' },
  { codigo: '943102', nombre: 'PSICOTERAPIA INDIVIDUAL POR PSICOLOGIA', valor_unitario: 22815, cantidad: '1', valor_total: 22815, codigo_servicio_referencia: '344' },
  { codigo: '944002', nombre: 'PSICOTERAPIA DE PAREJA POR PSICOLOGIA', valor_unitario: 46500, cantidad: '1', valor_total: 46500, codigo_servicio_referencia: '344' },
  { codigo: '944102', nombre: 'PSICOTERAPIA FAMILIAR POR PSICOLOGIA', valor_unitario: 66625, cantidad: '1', valor_total: 66625, codigo_servicio_referencia: '344' },
  { codigo: '053105', nombre: 'BLOQUEO UNION MIONEURAL', valor_unitario: 150000, cantidad: '', valor_total: 0, codigo_servicio_referencia: '327' },
  { codigo: '890502', nombre: 'PRACTICA EN JUNTA MEDICA, POR MEDICINA ESPECIALIZADA Y CASO (PACIENTE)', valor_unitario: 107640, cantidad: '2', valor_total: 215280, codigo_servicio_referencia: '327' },
  { codigo: '931501', nombre: 'MODALIDADES ELECTRICAS O ELECTROMAGNETICAS DE TERAPIA', valor_unitario: 45500, cantidad: '', valor_total: 0, codigo_servicio_referencia: '739' },
  { codigo: '944301', nombre: 'TERAPIAS DE REHABILITACION COGNITIVA ', valor_unitario: 53365, cantidad: '1', valor_total: 53365, codigo_servicio_referencia: '344' },
  { codigo: '940201', nombre: 'ADMINISTRACION (APLICACIÓN) DE PRUEBA DE PERSONALIDAD (CAULQUIER TIPO)(CADA UNA)', valor_unitario: 53362, cantidad: '1', valor_total: 53362, codigo_servicio_referencia: '344' },
  { codigo: '048201', nombre: 'INYECCION DE AGENTE ANESTESICO PARA NERVIO PERIFERICO', valor_unitario: 150000, cantidad: '1', valor_total: 150000, codigo_servicio_referencia: '327' },
  { codigo: '012210', nombre: 'REVISION DE NEUROESTIMULADOR', valor_unitario: 150000, cantidad: '1', valor_total: 150000, codigo_servicio_referencia: '327' },
  { codigo: '890110', nombre: 'ATENCION (VISITA) DOMICILIARIA, POR FONIATRIA Y FONOAUDIOLOGIA', valor_unitario: 53365, cantidad: '1', valor_total: 53365, codigo_servicio_referencia: '332' },
  { codigo: '890111', nombre: 'ATENCION (VISITA) DOMICILIARIA, POR FISIOTERAPIA', valor_unitario: 35119, cantidad: '1', valor_total: 35119, codigo_servicio_referencia: '739' },
  { codigo: '890112', nombre: 'ATENCION (VISITA) DOMICILIARIA, POR TERAPIA RESPIRATORIA', valor_unitario: 35119, cantidad: '1', valor_total: 35119, codigo_servicio_referencia: '739' },
  { codigo: '890113', nombre: 'ATENCION (VISITA) DOMICILIARIA, POR TERAPIA OCUPACIONAL', valor_unitario: 35119, cantidad: '1', valor_total: 35119, codigo_servicio_referencia: '739' },
  { codigo: '890397', nombre: 'CONSULTA DE CONTROL O DE SEGUIMIENTO POR OTRAS ESPECIALIDADES DE PSICOLOGIA', valor_unitario: 53365, cantidad: '1', valor_total: 53365, codigo_servicio_referencia: '334' },
  { codigo: '891801', nombre: 'PRUEBAS DE LATENCIA MULTIPLE DE SUEÑO', valor_unitario: 75000, cantidad: '1', valor_total: 75000, codigo_servicio_referencia: '327' },
  { codigo: '891803', nombre: 'PRUEBA DE MANTENIMIENTO DE LA VIGILIA', valor_unitario: 75000, cantidad: '1', valor_total: 75000, codigo_servicio_referencia: '327' },
  { codigo: '891806', nombre: 'MONITOREO DE ACTIVIDAD SUEÑO VIGILIA [ACTIGRAFIA]', valor_unitario: 75000, cantidad: '1', valor_total: 75000, codigo_servicio_referencia: '327' },
  { codigo: '930102', nombre: 'PRUEBA COGNITIVA (CADA UNA)', valor_unitario: 53365, cantidad: '1', valor_total: 53365, codigo_servicio_referencia: '344' },
  { codigo: '930103', nombre: 'EVALUACION DEL COMPONENTE COGNITIVO', valor_unitario: 53365, cantidad: '1', valor_total: 53365, codigo_servicio_referencia: '344' },
  { codigo: '934501', nombre: 'TRACCION ESQUELETICA DE MIEMBROS', valor_unitario: 28000, cantidad: '', valor_total: 0, codigo_servicio_referencia: '739' },
  { codigo: '936601', nombre: 'TRATAMIENTO MANIPULATIVO OSTEOPATICO BOMBA LINFATICA SOD', valor_unitario: 28000, cantidad: '', valor_total: 0, codigo_servicio_referencia: '739' },
  { codigo: '940101', nombre: 'ADMINISTRACION [APLICACION] DE PRUEBA DE INTELIGENCIA (CUALQUIER TIPO) (CADA UNA)', valor_unitario: 53365, cantidad: '1', valor_total: 53365, codigo_servicio_referencia: '344' },
  { codigo: '940301', nombre: 'EVALUACION EN ALTERACIONES EMOCIONALES (AFECTIVAS) O DE CONDUCTA', valor_unitario: 53365, cantidad: '1', valor_total: 53365, codigo_servicio_referencia: '344' },
  { codigo: '940302', nombre: 'ADMINISTRACION [APLICACION] DE PRUEBA EN ALTERACIONES EMOCIONALES (AFECTIVAS) O DE CONDUCTA', valor_unitario: 53365, cantidad: '1', valor_total: 53365, codigo_servicio_referencia: '344' },
  { codigo: '999102', nombre: 'OTRAS PRESTACIONES EN SALUD', valor_unitario: 0, cantidad: '1', valor_total: 0, codigo_servicio_referencia: '327' }
];

const {
  asegurarCatalogoLocal,
  buscarEnMapa,
  listarCatalogoActivo,
  invalidarCatalogoAnexoFidu,
  recargarCatalogoAnexoFidu,
  usarCatalogoEstatico,
  normCodigoAlmacen
} = require('./anexo-fidu-catalogo');

function normCodigoServicio(codigo) {
  const raw = String(codigo || '').trim().replace(/\D/g, '');
  if (!raw) return '';
  return raw;
}

function formatValorAnexo(num) {
  const n = Math.round(Number(num) || 0);
  const formatted = n.toLocaleString('es-CO');
  return `$ ${formatted}`;
}

/** Convierte "$ 439.205" o "439205" a entero COP. */
function parseValorAnexo(val) {
  const digits = String(val || '').replace(/\D/g, '');
  return parseInt(digits, 10) || 0;
}

function parseCantidadAnexo(val) {
  const s = String(val || '').trim().replace(',', '.');
  if (!s) return 0;
  const n = parseFloat(s);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function calcularValorTotalFact(valorUnitario, cantidad) {
  const total = Math.round(parseValorAnexo(valorUnitario) * parseCantidadAnexo(cantidad));
  return formatValorAnexo(total);
}

function aplicarValorTotalCalculado(row = {}) {
  const out = row;
  if (out.valor_unitario != null && String(out.valor_unitario).trim() !== '') {
    out.valor_total_fact = calcularValorTotalFact(out.valor_unitario, out.cantidad);
  }
  return out;
}

function normalizarCiudadResidencia(val) {
  const v = String(val || '').trim();
  if (!v || v.length < 8 || /^pasto$/i.test(v)) return ANEXO_FIDU_VALORES_FIJOS.ciudad_residencia;
  return v;
}

function buscarServicioPorCodigo(codigo) {
  asegurarCatalogoLocal(ANEXO_FIDU_CATALOGO_SERVICIOS);
  return buscarEnMapa(codigo);
}

function aplicarValoresFijosAnexo(row = {}) {
  const out = row;
  out.nit = out.nit || ANEXO_FIDU_VALORES_FIJOS.nit;
  out.prefijo_fact = out.prefijo_fact || ANEXO_FIDU_VALORES_FIJOS.prefijo_fact;
  out.ciudad = out.ciudad || ANEXO_FIDU_VALORES_FIJOS.ciudad;
  out.ciudad_residencia = normalizarCiudadResidencia(out.ciudad_residencia);
  return out;
}

function aplicarCatalogoServicio(codigo, row = {}) {
  const svc = buscarServicioPorCodigo(codigo);
  if (!svc) return { ok: false, row };
  const out = row;
  out.codigo_servicio = svc.codigo;
  out.nombre_servicio = svc.nombre.trim();
  out.plan = ANEXO_FIDU_VALORES_FIJOS.plan;
  const cantidadImportada = String(out.cantidad || '').trim();
  const valorImportado = String(out.valor_unitario || '').trim();
  if (!valorImportado) out.valor_unitario = formatValorAnexo(svc.valor_unitario);
  if (!cantidadImportada) out.cantidad = svc.cantidad;
  aplicarValorTotalCalculado(out);
  out.condicion_destino_persona = ANEXO_FIDU_VALORES_FIJOS.condicion_destino_persona;
  out.prioridad_atencion = ANEXO_FIDU_VALORES_FIJOS.prioridad_atencion;
  out.tipo_atencion_solicitada = ANEXO_FIDU_VALORES_FIJOS.tipo_atencion_solicitada;
  out.grupo_servicio = ANEXO_FIDU_VALORES_FIJOS.grupo_servicio;
  out.modalidad_tecnologia_salud = ANEXO_FIDU_VALORES_FIJOS.modalidad_tecnologia_salud;
  out.codigo_servicio_referencia = svc.codigo_servicio_referencia;
  aplicarValoresFijosAnexo(out);
  return { ok: true, row: out, servicio: svc };
}

function enriquecerRegistroAnexoFidu(row = {}) {
  const out = { ...row };
  aplicarValoresFijosAnexo(out);
  if (out.codigo_servicio) {
    aplicarCatalogoServicio(out.codigo_servicio, out);
  }
  aplicarValorTotalCalculado(out);
  return out;
}

function listarServiciosCatalogo() {
  asegurarCatalogoLocal(ANEXO_FIDU_CATALOGO_SERVICIOS);
  return listarCatalogoActivo().map((s) => ({
    codigo: s.codigo,
    nombre: s.nombre.trim(),
    valor_unitario: formatValorAnexo(s.valor_unitario),
    cantidad: s.cantidad,
    valor_total: formatValorAnexo(s.valor_total),
    codigo_servicio_referencia: s.codigo_servicio_referencia
  }));
}

module.exports = {
  CAMPOS_SERVICIO_AUTO,
  ANEXO_FIDU_VALORES_FIJOS,
  ANEXO_FIDU_CATALOGO_SERVICIOS,
  normCodigoServicio,
  normCodigoAlmacen,
  formatValorAnexo,
  parseValorAnexo,
  parseCantidadAnexo,
  calcularValorTotalFact,
  aplicarValorTotalCalculado,
  normalizarCiudadResidencia,
  buscarServicioPorCodigo,
  aplicarValoresFijosAnexo,
  aplicarCatalogoServicio,
  enriquecerRegistroAnexoFidu,
  listarServiciosCatalogo,
  invalidarCatalogoAnexoFidu,
  recargarCatalogoAnexoFidu: (dbConn) => recargarCatalogoAnexoFidu(dbConn, ANEXO_FIDU_CATALOGO_SERVICIOS),
  usarCatalogoEstatico: () => usarCatalogoEstatico(ANEXO_FIDU_CATALOGO_SERVICIOS)
};
