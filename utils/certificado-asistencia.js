'use strict';

const fs = require('fs');
const path = require('path');

const CERT_ASISTENCIA_TITULO = 'CERTIFICACION ASISTENCIA A EXAMEN O CONSULTA MEDICA';

const MESES_CERT = [
  'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
  'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'
];

const CERT_ASISTENCIA_TELEFONOS = {
  celular: '3053560651',
  fijo: '6027299737'
};

const CERT_ASISTENCIA_FIRMA_ELABORADO = 'Secretaria';

const CERT_ASISTENCIA_PIE = {
  version: '00',
  codigo: 'DOCU-09',
  fecha_elaboracion: 'Febrero 19 de 2018',
  fecha_actualizacion: 'Junio 11 de 2026',
  pagina: '1 de 1'
};

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseFechaYmd(val) {
  const s = String(val || '').trim().slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10) - 1;
  const d = parseInt(m[3], 10);
  const dt = new Date(y, mo, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo || dt.getDate() !== d) return null;
  return dt;
}

function formatFechaCertificado(fechaYmd) {
  const dt = parseFechaYmd(fechaYmd);
  if (!dt) return String(fechaYmd || '-');
  return `${dt.getDate()}/${MESES_CERT[dt.getMonth()]}/${dt.getFullYear()}`;
}

function parseHoraHm(val) {
  const s = String(val || '').trim();
  const m = /^(\d{1,2}):(\d{2})/.exec(s);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return { h, min };
}

function formatHoraCertificado(horaHm) {
  const p = parseHoraHm(horaHm);
  if (!p) return String(horaHm || '-');
  const esPm = p.h >= 12;
  let h12 = p.h % 12;
  if (h12 === 0) h12 = 12;
  const minStr = String(p.min).padStart(2, '0');
  const suf = esPm ? 'PM' : 'AM';
  return `${h12}:${minStr} ${suf}`;
}

function normalizarTipoDocumento(val) {
  const t = String(val || 'CC').trim().toUpperCase();
  return t === 'TI' ? 'TI' : 'CC';
}

function validarPayloadCertificado(body = {}) {
  const pacienteNombre = String(body.paciente_nombre || '').trim();
  const pacienteDocumento = String(body.paciente_documento || '').trim();
  const motivo = String(body.motivo || '').trim();
  const fechaIngreso = String(body.fecha_ingreso || '').trim();
  const horaIngreso = String(body.hora_ingreso || '').trim();
  const fechaEgreso = String(body.fecha_egreso || '').trim();
  const horaEgreso = String(body.hora_egreso || '').trim();
  const funcionarioNombre = String(body.funcionario_nombre || '').trim();
  const funcionarioCargo = String(body.funcionario_cargo || '').trim();

  if (!pacienteNombre) return { error: 'El nombre del paciente es obligatorio' };
  if (!pacienteDocumento) return { error: 'El documento del paciente es obligatorio' };
  if (!motivo) return { error: 'El motivo o servicio es obligatorio' };
  if (!parseFechaYmd(fechaIngreso)) return { error: 'Fecha de ingreso inválida' };
  if (!parseHoraHm(horaIngreso)) return { error: 'Hora de ingreso inválida' };
  if (!parseFechaYmd(fechaEgreso)) return { error: 'Fecha de egreso inválida' };
  if (!parseHoraHm(horaEgreso)) return { error: 'Hora de egreso inválida' };
  if (!funcionarioNombre) return { error: 'El nombre del funcionario que certifica es obligatorio' };
  if (!funcionarioCargo) return { error: 'El cargo del funcionario es obligatorio' };

  return {
    data: {
      paciente_nombre: pacienteNombre,
      paciente_documento: pacienteDocumento,
      tipo_documento: normalizarTipoDocumento(body.tipo_documento),
      motivo,
      fecha_ingreso: fechaIngreso,
      hora_ingreso: horaIngreso,
      fecha_egreso: fechaEgreso,
      hora_egreso: horaEgreso,
      funcionario_nombre: funcionarioNombre,
      funcionario_cargo: funcionarioCargo,
      firma_elaborado: CERT_ASISTENCIA_FIRMA_ELABORADO
    }
  };
}

function getCertificadoAsistenciaFontCss() {
  const dirs = [
    path.join(__dirname, '..', 'public', 'fonts'),
    path.join(process.execPath, '..', 'public', 'fonts')
  ];
  const archivos = [
    { file: 'Aptos-Narrow.ttf', weight: 400 },
    { file: 'Aptos-Narrow-Bold.ttf', weight: 700 },
    { file: 'AptosNarrow.ttf', weight: 400 },
    { file: 'AptosNarrow-Bold.ttf', weight: 700 }
  ];
  let css = '';
  for (const dir of dirs) {
    for (const ar of archivos) {
      const p = path.join(dir, ar.file);
      if (!fs.existsSync(p)) continue;
      try {
        const b64 = fs.readFileSync(p).toString('base64');
        css += `@font-face{font-family:'Aptos Narrow';font-style:normal;font-weight:${ar.weight};src:url(data:font/ttf;base64,${b64}) format('truetype');}`;
      } catch (_) { /* ignore */ }
    }
  }
  return css;
}

function buildCertificadoAsistenciaHtml(data, fondo = {}) {
  const fondoBase64 = fondo.base64 || '';
  const fondoMime = fondo.mime || 'image/png';
  const tipo = normalizarTipoDocumento(data.tipo_documento);
  const ccMark = tipo === 'CC' ? '☒' : '☐';
  const tiMark = tipo === 'TI' ? '☒' : '☐';
  const fechaIng = formatFechaCertificado(data.fecha_ingreso);
  const fechaEgr = formatFechaCertificado(data.fecha_egreso);
  const horaIng = formatHoraCertificado(data.hora_ingreso);
  const horaEgr = formatHoraCertificado(data.hora_egreso);
  const telTxt = `Celular: ${CERT_ASISTENCIA_TELEFONOS.celular} Teléfono fijo: ${CERT_ASISTENCIA_TELEFONOS.fijo}`;

  const conFondo = !!fondoBase64;
  const fondoStyle = conFondo
    ? `background-image:url('data:${fondoMime};base64,${fondoBase64}');background-size:100% 100%;background-repeat:no-repeat;background-position:center top;`
    : 'background:#fff;';

  const fontFaceCss = getCertificadoAsistenciaFontCss();
  const tieneAptosLocal = fontFaceCss.includes('Aptos Narrow');
  const fontFamily = tieneAptosLocal
    ? "'Aptos Narrow', 'Arial Narrow', sans-serif"
    : "'Arial Narrow', Arial, sans-serif";

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8"/>
  <style>
    ${fontFaceCss}
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 0;
      font-family: ${fontFamily};
      color: #1a1a1a;
      background: #fff;
    }
    .page {
      width: 210mm;
      min-height: 297mm;
      position: relative;
      ${fondoStyle}
    }
    .cert-titulo {
      position: absolute;
      top: ${conFondo ? '9.5mm' : '8mm'};
      left: ${conFondo ? '48mm' : '12mm'};
      right: ${conFondo ? '12mm' : '12mm'};
      height: 16mm;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      font-size: ${conFondo ? '10.5pt' : '11pt'};
      font-weight: 700;
      letter-spacing: 0.04em;
      line-height: 1.2;
      text-transform: uppercase;
      color: #2b2b2b;
      padding: 0 4mm;
    }
    .cert-contenido {
      min-height: 297mm;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      padding: ${conFondo ? '58mm 28mm 52mm 28mm' : '52mm 24mm 20mm 24mm'};
    }
    .cert-cuerpo {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 5mm;
      font-size: 12pt;
      line-height: 1.5;
    }
    .intro {
      font-size: 12pt;
      text-align: left;
      margin: 0;
    }
    .nombre-paciente {
      font-size: 13.5pt;
      font-weight: 700;
      text-transform: uppercase;
      text-align: center;
      margin: 2mm 0 4mm;
      letter-spacing: 0.03em;
    }
    .doc-line {
      margin: 0;
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 2mm 4mm;
    }
    .doc-tipo { letter-spacing: 0.12em; font-weight: 600; }
    .doc-numero { font-weight: 700; }
    .bloque-motivo {
      margin: 2mm 0;
      line-height: 1.45;
    }
    .bloque-motivo strong { font-weight: 700; }
    .fechas-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 4mm 8mm;
      margin: 3mm 0;
    }
    .fecha-item {
      display: flex;
      flex-direction: column;
      gap: 1.5mm;
    }
    .fecha-label {
      font-size: 10.5pt;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #333;
    }
    .fecha-valor {
      font-size: 12pt;
      font-weight: 700;
    }
    .funcionario {
      margin-top: 4mm;
      display: flex;
      flex-direction: column;
      gap: 2.5mm;
      font-size: 11.5pt;
      line-height: 1.45;
    }
    .funcionario strong { font-weight: 700; }
    .cert-firmas-wrap { margin-top: 5mm; }
    .firmas {
      width: 100%;
      border-collapse: collapse;
      font-size: 9.5pt;
      text-align: center;
    }
    .firmas th, .firmas td {
      border: 1px solid #222;
      padding: 2px 5px;
      vertical-align: bottom;
    }
    .firmas th {
      font-weight: 700;
      text-transform: uppercase;
      font-size: 8.5pt;
      letter-spacing: 0.04em;
      padding: 3px 5px 2px;
      vertical-align: middle;
    }
    .firmas td {
      padding: 2px 5px 4px;
      height: 1.6em;
    }
    .firma-cargo {
      font-size: 9pt;
      margin: 0;
      color: #333;
      line-height: 1.2;
    }
    .cert-pie-doc {
      position: absolute;
      left: 0;
      right: 0;
      bottom: ${conFondo ? '34mm' : '0'};
      z-index: 2;
      display: flex;
      justify-content: center;
      align-items: flex-end;
      padding: 0 14mm;
      background: transparent;
    }
    .cert-pie-tabla {
      width: auto;
      border-collapse: collapse;
      color: #2a2a2a;
      margin: 0 auto;
    }
    .cert-pie-tabla td {
      border-right: 1px solid #6e7376;
      text-align: center;
      vertical-align: middle;
      padding: 0 2mm;
      line-height: 1.08;
      white-space: nowrap;
    }
    .cert-pie-tabla td:last-of-type {
      border-right: none;
    }
    .cert-pie-pagina {
      position: absolute;
      right: 14mm;
      bottom: 0;
      font-size: 6.5pt;
      font-weight: 400;
      color: #2a2a2a;
      white-space: nowrap;
    }
    .cert-pie-label {
      display: block;
      font-weight: 700;
      font-size: 5.5pt;
      letter-spacing: 0.01em;
      margin-bottom: 0.2mm;
    }
    .cert-pie-label--caps { text-transform: uppercase; }
    .cert-pie-valor {
      display: block;
      font-weight: 400;
      font-size: 6pt;
    }
  </style>
</head>
<body>
  <div class="page">
    <h1 class="cert-titulo">${escapeHtml(CERT_ASISTENCIA_TITULO)}</h1>
    <div class="cert-contenido">
      <div class="cert-cuerpo">
        <p class="intro">Por medio de la presente se hace constar que:</p>
        <div class="nombre-paciente">${escapeHtml(data.paciente_nombre)}</div>
        <p class="doc-line">
          <span>Identificado(a) con documento:</span>
          <span class="doc-tipo">${ccMark} CC</span>
          <span class="doc-tipo">${tiMark} TI</span>
          <span>No: <span class="doc-numero">${escapeHtml(data.paciente_documento)}</span></span>
        </p>
        <p class="bloque-motivo">Asistió a la entidad para: <strong>${escapeHtml(data.motivo)}</strong></p>
        <div class="fechas-grid">
          <div class="fecha-item">
            <span class="fecha-label">Fecha ingreso</span>
            <span class="fecha-valor">${escapeHtml(fechaIng)} · ${escapeHtml(horaIng)}</span>
          </div>
          <div class="fecha-item">
            <span class="fecha-label">Fecha egreso</span>
            <span class="fecha-valor">${escapeHtml(fechaEgr)} · ${escapeHtml(horaEgr)}</span>
          </div>
        </div>
        <div class="funcionario">
          <div>Nombre de funcionario(a) que certifica: <strong>${escapeHtml(data.funcionario_nombre)}</strong></div>
          <div>Cargo: <strong>${escapeHtml(data.funcionario_cargo)}</strong></div>
          <div>Teléfono Institucional: ${escapeHtml(telTxt)}</div>
        </div>
      </div>
      <div class="cert-firmas-wrap">
        <table class="firmas">
          <thead>
            <tr>
              <th>Elaborado</th>
              <th>Revisado por</th>
              <th>Aprobado por</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><div class="firma-cargo">${escapeHtml(data.firma_elaborado)}</div></td>
              <td><div class="firma-cargo">Auditor Médico</div></td>
              <td><div class="firma-cargo">Gerente</div></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    <footer class="cert-pie-doc">
      <table class="cert-pie-tabla">
        <tr>
          <td>
            <span class="cert-pie-label cert-pie-label--caps">VERSIÓN:</span>
            <span class="cert-pie-valor">${escapeHtml(CERT_ASISTENCIA_PIE.version)}</span>
          </td>
          <td>
            <span class="cert-pie-label cert-pie-label--caps">CODIGO:</span>
            <span class="cert-pie-valor">${escapeHtml(CERT_ASISTENCIA_PIE.codigo)}</span>
          </td>
          <td>
            <span class="cert-pie-label">Fecha de elaboración:</span>
            <span class="cert-pie-valor">${escapeHtml(CERT_ASISTENCIA_PIE.fecha_elaboracion)}</span>
          </td>
          <td>
            <span class="cert-pie-label">Fecha de Actualización:</span>
            <span class="cert-pie-valor">${escapeHtml(CERT_ASISTENCIA_PIE.fecha_actualizacion)}</span>
          </td>
        </tr>
      </table>
      <span class="cert-pie-pagina">${escapeHtml(CERT_ASISTENCIA_PIE.pagina)}</span>
    </footer>
  </div>
</body>
</html>`;
}

module.exports = {
  CERT_ASISTENCIA_TITULO,
  CERT_ASISTENCIA_FIRMA_ELABORADO,
  CERT_ASISTENCIA_PIE,
  CERT_ASISTENCIA_TELEFONOS,
  formatFechaCertificado,
  formatHoraCertificado,
  validarPayloadCertificado,
  getCertificadoAsistenciaFontCss,
  buildCertificadoAsistenciaHtml
};
