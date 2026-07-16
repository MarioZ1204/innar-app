/**
 * Campos mínimos por tipo de carpeta PDX y evaluación flexible del nombre de archivo.
 */
const { detectarTemaCarpeta, inferirEstudioDesdeCarpeta, esTemaOrdenHcConsultaMedica } = require('./soportes-temas');
const { estudioPsgReconocido, separarNombreCompletoConsultaMedica } = require('./soportes-pdx-parse');
const {
  normalizarNumeroDocumentoPdx,
  normalizarTipoDocumentoPdx,
  numeroDocumentoValidoPdx
} = require('./soportes-pdx-documento');

function esTemaEstructuradoConDocumento(tema) {
  return ['ordenes', 'comprobantes', 'consentimientos'].includes(tema);
}

function esTemaReporteClinico(tema) {
  return ['vtm', 'eeg', 'psg', 'actigrafia'].includes(tema);
}

function definicionCamposPorTema(tema) {
  if (tema === 'comprobantes_consulta_medica' || esTemaOrdenHcConsultaMedica(tema)) {
    return [
      { key: 'paciente_nombre_completo', label: 'Nombre completo', requerido: true, input: 'nombre_completo' },
      { key: 'fecha_estudio', label: 'Fecha del estudio', requerido: true, input: 'date' },
      { key: 'estudio_texto', label: 'Especialidad', requerido: true, input: 'especialidad' }
    ];
  }
  const base = [
    { key: 'apellidos', label: 'Apellidos', requerido: true, input: 'text' },
    { key: 'nombres', label: 'Nombres', requerido: true, input: 'text' },
    { key: 'fecha_estudio', label: 'Fecha del estudio', requerido: true, input: 'date' }
  ];
  if (esTemaEstructuradoConDocumento(tema)) {
    return [
      ...base,
      { key: 'tipo_documento', label: 'Tipo de documento', requerido: false, input: 'tipo_doc', defecto: 'CC' },
      { key: 'paciente_documento', label: 'Número de documento', requerido: true, input: 'doc_numero' },
      { key: 'estudio_texto', label: 'Tipo de examen', requerido: true, input: 'estudio' }
    ];
  }
  if (tema === 'psg') {
    return [
      ...base,
      { key: 'paciente_documento', label: 'Documento', requerido: false, input: 'doc_numero' },
      { key: 'estudio_texto', label: 'Tipo PSG', requerido: true, input: 'psg_estudio' }
    ];
  }
  if (esTemaReporteClinico(tema) || tema === 'neutral') {
    return [
      ...base,
      {
        key: 'estudio_texto',
        label: 'Estudio',
        requerido: false,
        input: 'inferred',
        nota: 'Se completa automáticamente según la carpeta al descargar'
      }
    ];
  }
  return base;
}

function mergeDatosNombre(parcial, parsed) {
  const p = parsed?.ok ? parsed : {};
  let apellidos = String(p.apellidos || parcial?.apellidos || '').trim();
  let nombres = String(p.nombres || parcial?.nombres || '').trim();
  let nombreCompleto = String(p.paciente_nombre_completo || parcial?.paciente_nombre_completo || '').trim();
  if (!nombreCompleto && apellidos && nombres) {
    nombreCompleto = `${nombres} ${apellidos}`.trim();
  }
  if (nombreCompleto && (!apellidos || !nombres)) {
    const split = separarNombreCompletoConsultaMedica(nombreCompleto);
    if (split.apellidos) apellidos = split.apellidos;
    if (split.nombres) nombres = split.nombres;
  }
  return {
    paciente_nombre_completo: nombreCompleto,
    apellidos,
    nombres,
    tipo_documento: normalizarTipoDocumentoPdx(p.tipo_documento || parcial?.tipo_documento || 'CC'),
    paciente_documento: normalizarNumeroDocumentoPdx(p.paciente_documento || parcial?.paciente_documento || ''),
    fecha_estudio: String(p.fecha_estudio || parcial?.fecha_estudio || '').trim(),
    estudio_texto: String(p.estudio_texto || parcial?.estudio_texto || '').trim()
  };
}

function enriquecerDatosInferidos(datos, tema, carpeta) {
  const out = { ...datos };
  if (['vtm', 'eeg', 'actigrafia'].includes(tema) && !out.estudio_texto) {
    out.estudio_texto = inferirEstudioDesdeCarpeta(carpeta);
  }
  if (tema === 'psg') {
    if (!estudioPsgReconocido(out.estudio_texto)) {
      const inf = inferirEstudioDesdeCarpeta(carpeta);
      if (estudioPsgReconocido(inf)) out.estudio_texto = inf;
    }
  }
  return out;
}

function valorCampoDetectado(def, datos, tema, carpeta) {
  let valor = String(datos[def.key] || def.defecto || '').trim();
  if (def.key === 'estudio_texto' && def.input === 'inferred') {
    valor = valor || inferirEstudioDesdeCarpeta(carpeta);
    return { valor, detectado: !!valor, automatico: true };
  }
  if (def.key === 'estudio_texto' && tema === 'psg') {
    const ok = estudioPsgReconocido(valor);
    return { valor, detectado: ok, automatico: false };
  }
  if (def.key === 'fecha_estudio') {
    const ok = /^\d{4}-\d{2}-\d{2}$/.test(valor);
    return { valor, detectado: ok, automatico: false };
  }
  if (def.key === 'paciente_documento') {
    const num = normalizarNumeroDocumentoPdx(valor);
    const ok = numeroDocumentoValidoPdx(num);
    return { valor: num, detectado: ok, automatico: false };
  }
  if (def.key === 'tipo_documento') {
    const tipo = normalizarTipoDocumentoPdx(valor);
    return { valor: tipo, detectado: !!tipo, automatico: false };
  }
  if (def.key === 'paciente_nombre_completo') {
    const full = valor || `${datos.nombres || ''} ${datos.apellidos || ''}`.trim();
    const tokens = full.split(/\s+/).filter(Boolean);
    const ok = tokens.length >= 2;
    return { valor: full, detectado: ok, automatico: false };
  }
  return { valor, detectado: !!valor, automatico: false };
}

/**
 * Evalúa qué campos se detectaron en el nombre y cuáles faltan (criterio mínimo por carpeta).
 */
function evaluarCamposMinimos(tema, parcial, parsed, carpeta) {
  const defs = definicionCamposPorTema(tema);
  let datos = enriquecerDatosInferidos(mergeDatosNombre(parcial, parsed), tema, carpeta);
  const campos = defs.map((def) => {
    const { valor, detectado, automatico } = valorCampoDetectado(def, datos, tema, carpeta);
    datos = { ...datos, [def.key]: valor };
    let estado = 'falta';
    if (detectado) estado = automatico ? 'auto' : 'ok';
    else if (!def.requerido) estado = 'opcional';
    return {
      ...def,
      valor,
      detectado,
      automatico,
      estado,
      requerido: !!def.requerido
    };
  });
  const faltantes = campos.filter((c) => c.requerido && !c.detectado);
  return {
    campos,
    datos,
    faltantes,
    completo: faltantes.length === 0
  };
}

function ayudaCamposPorTema(tema) {
  const defs = definicionCamposPorTema(tema);
  const obligatorios = defs.filter((d) => d.requerido).map((d) => d.label);
  const opcionales = defs.filter((d) => !d.requerido).map((d) => d.label);
  return { obligatorios, opcionales, defs };
}

module.exports = {
  definicionCamposPorTema,
  mergeDatosNombre,
  evaluarCamposMinimos,
  ayudaCamposPorTema
};
