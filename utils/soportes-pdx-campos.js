/**
 * Campos mínimos por tipo de carpeta PDX y evaluación flexible del nombre de archivo.
 */
const { detectarTemaCarpeta, inferirEstudioDesdeCarpeta } = require('./soportes-temas');
const { estudioPsgReconocido } = require('./soportes-pdx-parse');

function esTemaEstructurado(tema) {
  return ['ordenes', 'comprobantes', 'consentimientos'].includes(tema);
}

function esTemaReporteClinico(tema) {
  return ['vtm', 'eeg', 'psg', 'actigrafia'].includes(tema);
}

const TIPOS_DOC = ['CC', 'TI', 'CE', 'PA', 'RC', 'NUIP', 'PEP', 'PT'];

function definicionCamposPorTema(tema) {
  const base = [
    { key: 'apellidos', label: 'Apellidos', requerido: true, input: 'text' },
    { key: 'nombres', label: 'Nombres', requerido: true, input: 'text' },
    { key: 'fecha_estudio', label: 'Fecha del estudio', requerido: true, input: 'date' }
  ];
  if (esTemaEstructurado(tema)) {
    return [
      ...base,
      { key: 'tipo_documento', label: 'Tipo de documento', requerido: false, input: 'text', defecto: 'CC' },
      { key: 'paciente_documento', label: 'Número de documento', requerido: true, input: 'text' },
      { key: 'estudio_texto', label: 'Tipo de examen', requerido: true, input: 'estudio' }
    ];
  }
  if (tema === 'psg') {
    return [
      ...base,
      { key: 'paciente_documento', label: 'Documento', requerido: false, input: 'text' },
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
  return {
    apellidos: String(p.apellidos || parcial?.apellidos || '').trim(),
    nombres: String(p.nombres || parcial?.nombres || '').trim(),
    tipo_documento: String(p.tipo_documento || parcial?.tipo_documento || 'CC').trim() || 'CC',
    paciente_documento: String(p.paciente_documento || parcial?.paciente_documento || '').replace(/\s/g, '').trim(),
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
  TIPOS_DOC,
  definicionCamposPorTema,
  mergeDatosNombre,
  evaluarCamposMinimos,
  ayudaCamposPorTema
};
