'use strict';

const { FONDO_PRINT_CSS, buildPageFondoImg } = require('./documento-imprimible');

const COMPROBANTE_SERVICIOS_TITULO =
  'FORMATO DE FIRMA DE PACIENTE COMO COMPROBANTE DE RECIBIDO EL SERVICIO - PACIENTE DE FOMAG';

const COMPROBANTE_SERVICIOS_FOMAG_TEXTO =
  'PACIENTE DE FIDEICOMISO PATRIMONIOS AUTÓNOMOS FIDUCIARIA LA PREVISORA SA. CERTIFICO QUE EL INSTITUTO NEUROCIENCIAS DE NARIÑO IPS SAS ME PRESTÓ EL SERVICIO DE:';

const COMPROBANTE_SERVICIOS_PIE = {
  version: '02',
  codigo: 'FORM-24',
  fecha_elaboracion: 'Julio 1 de 2024',
  fecha_actualizacion: 'Junio 11 de 2026',
  pagina: '1 de 1'
};

/** Posiciones medidas sobre comprobante-servicios-fondo.png (2777×3624 px, A4). */
const COMPROBANTE_LAYOUT = {
  tituloTop: 9,
  tituloLeft: 62,
  tituloRight: 10,
  bodyTop: 41,
  bodySide: 20,
  lineaServicio: 144.57,
  lineaFirmaFondo: 164.56,
  lineaFirma: 169.56,
  lineaFirmaLeft: 29,
  lineaFirmaRight: 29,
  servicioTop: 135,
  /** Orden: sólida → espacio → espacio → etiqueta (izq) → imagen → punteada (fondo). */
  espacioTrasSolido1: 6,
  espacioTrasSolido2: 6,
  /** Tamaño único de la firma en el PDF (cualquier imagen se ajusta a este recuadro). */
  firmaImgAlturaSlot: 36,
  firmaImgAncho: 90,
  margenImagenSobrePunteada: 0.6,
  /** Baja el recuadro hacia la punteada (10 quedaba por debajo; 0 quedaba alto). */
  firmaImgDesplazamientoAbajo: 6,
  zonaInferiorTop: 182,
  tablaTop: 223,
  pieRowFromTop: 277,
  /** Centros de columna medidos en comprobante-servicios-fondo.png */
  pieColCenters: [33.1, 73.6, 96.6, 127.8],
  piePaginaCenter: 176.6,
  contactoBottom: 2.5
};

const MESES_COMP = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
];

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

function formatFechaComprobante(fechaYmd) {
  const dt = parseFechaYmd(fechaYmd);
  if (!dt) return String(fechaYmd || '-');
  const mes = MESES_COMP[dt.getMonth()];
  return `${dt.getDate()} de ${mes} de ${dt.getFullYear()}`;
}

function formatFechaNacimiento(fechaYmd) {
  const dt = parseFechaYmd(fechaYmd);
  if (!dt) return String(fechaYmd || '-');
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function normalizarTipoDocumento(val) {
  const t = String(val || 'CC').trim().toUpperCase();
  if (t === 'TI') return 'TI';
  if (t === 'RC') return 'RC';
  return 'CC';
}

function parseImagenBase64(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const m = /^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=]+)$/i.exec(s);
  if (m) {
    const mime = m[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : m[1].toLowerCase();
    return { mime, base64: m[2] };
  }
  if (/^[A-Za-z0-9+/=]+$/.test(s) && s.length > 40) {
    return { mime: 'image/png', base64: s };
  }
  return null;
}

function tieneBloqueAcudiente(data) {
  return !!(
    String(data.acudiente_nombre || '').trim()
    || String(data.parentesco || '').trim()
    || parseImagenBase64(data.firma_acudiente)
  );
}

function validarPayloadComprobanteServicios(body = {}) {
  const fecha = String(body.fecha || '').trim();
  const pacienteNombre = String(body.paciente_nombre || '').trim();
  const pacienteDocumento = String(body.paciente_documento || '').trim();
  const fechaNacimiento = String(body.fecha_nacimiento || '').trim();
  const direccion = String(body.direccion || '').trim();
  const telefono = String(body.telefono || '').trim();
  const correo = String(body.correo || '').trim();
  const tipoAfiliacion = String(body.tipo_afiliacion || '').trim();
  const servicio = String(body.servicio || '').trim();
  const firmaPaciente = parseImagenBase64(body.firma_paciente);
  const acudienteNombre = String(body.acudiente_nombre || '').trim();
  const parentesco = String(body.parentesco || '').trim();
  const firmaAcudiente = parseImagenBase64(body.firma_acudiente);
  if (!parseFechaYmd(fecha)) return { error: 'Fecha inválida' };
  if (!pacienteNombre) return { error: 'El nombre del paciente (YO) es obligatorio' };
  if (!pacienteDocumento) return { error: 'El número de identificación es obligatorio' };
  if (!parseFechaYmd(fechaNacimiento)) return { error: 'Fecha de nacimiento inválida' };
  if (!direccion) return { error: 'La dirección es obligatoria' };
  if (!telefono) return { error: 'El teléfono es obligatorio' };
  if (!correo) return { error: 'El correo es obligatorio' };
  if (!tipoAfiliacion) return { error: 'El tipo de afiliación es obligatorio' };
  if (!servicio) return { error: 'El servicio prestado es obligatorio' };

  if (!firmaPaciente) {
    return { error: 'La firma del paciente (imagen) es obligatoria' };
  }

  return {
    data: {
      fecha,
      paciente_nombre: pacienteNombre,
      tipo_documento: normalizarTipoDocumento(body.tipo_documento),
      paciente_documento: pacienteDocumento,
      fecha_nacimiento: fechaNacimiento,
      direccion,
      telefono,
      correo,
      tipo_afiliacion: tipoAfiliacion,
      servicio,
      firma_paciente: firmaPaciente,
      firma_acudiente: firmaAcudiente,
      acudiente_nombre: acudienteNombre,
      parentesco
    }
  };
}

function calcularPosicionesFirma(layout = COMPROBANTE_LAYOUT) {
  const firmaLabelTop = layout.lineaServicio
    + layout.espacioTrasSolido1
    + layout.espacioTrasSolido2;
  const firmaImgHeight = layout.firmaImgAlturaSlot;
  const firmaImgWidth = layout.firmaImgAncho;
  const firmaImgTop = layout.lineaFirma
    - layout.margenImagenSobrePunteada
    - firmaImgHeight
    + (layout.firmaImgDesplazamientoAbajo || 0);
  return {
    firmaLabelTop,
    firmaImgTop,
    firmaImgHeight,
    firmaImgWidth
  };
}

function buildComprobanteServiciosHtml(data, fondo = {}) {
  const fondoBase64 = fondo.base64 || '';
  const fondoMime = fondo.mime || 'image/png';
  const conFondo = !!fondoBase64;
  const fondoImgHtml = buildPageFondoImg(fondo);

  const L = COMPROBANTE_LAYOUT;
  const F = calcularPosicionesFirma(L);
  const tipo = normalizarTipoDocumento(data.tipo_documento);
  const ccMark = tipo === 'CC' ? '☒' : '☐';
  const tiMark = tipo === 'TI' ? '☒' : '☐';
  const rcMark = tipo === 'RC' ? '☒' : '☐';

  const fechaTxt = formatFechaComprobante(data.fecha);
  const fechaNacTxt = formatFechaNacimiento(data.fecha_nacimiento);
  const firmaPac = data.firma_paciente;
  const firmaAcud = data.firma_acudiente;
  const mostrarAcudienteDatos = tieneBloqueAcudiente(data);

  const fontFamily = "Arial, 'Helvetica Neue', Helvetica, sans-serif";

  const firmaAcudHtml = firmaAcud
    ? `<img class="cmp-firma-acud-img" src="data:${firmaAcud.mime};base64,${firmaAcud.base64}" alt="Firma acudiente"/>`
    : '';

  const acudienteOcultoClass = mostrarAcudienteDatos ? '' : ' cmp-acudiente--vacio';

  /** Parche de textura del fondo (zona limpia ~5 mm arriba) para tapar la punteada original del PNG. */
  const lineaFirmaParcheMuestra = L.lineaFirmaFondo - 5;
  const lineaFirmaCoverCss = conFondo
    ? `
    .cmp-linea-firma-cover {
      position: absolute;
      left: ${L.lineaFirmaLeft}mm;
      right: ${L.lineaFirmaRight}mm;
      top: ${L.lineaFirmaFondo - 1.2}mm;
      height: 3.8mm;
      background-image: url('data:${fondoMime};base64,${fondoBase64}');
      background-size: 210mm 297mm;
      background-repeat: no-repeat;
      background-position: -${L.lineaFirmaLeft}mm -${lineaFirmaParcheMuestra}mm;
      z-index: 2;
    }`
    : '';
  const lineaFirmaCoverHtml = conFondo
    ? '<div class="cmp-linea-firma-cover" aria-hidden="true"></div>'
    : '';

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8"/>
  <style>
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
      height: 297mm;
      position: relative;
      overflow: hidden;
      background: #fff;
    }
    ${FONDO_PRINT_CSS}
    .cmp-titulo {
      position: absolute;
      z-index: 1;
      top: ${L.tituloTop}mm;
      left: ${L.tituloLeft}mm;
      right: ${L.tituloRight}mm;
      height: 18mm;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      font-size: 8.5pt;
      font-weight: 700;
      letter-spacing: 0.03em;
      line-height: 1.15;
      text-transform: uppercase;
      color: #2b2b2b;
      padding: 0 2mm;
    }
    .cmp-zona-superior {
      position: absolute;
      top: ${L.bodyTop}mm;
      left: ${L.bodySide}mm;
      right: ${L.bodySide}mm;
      z-index: 1;
      font-size: 10.5pt;
      line-height: 1.32;
    }
    .cmp-campo {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 2mm 3mm;
      margin-bottom: 2.4mm;
    }
    .cmp-label {
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.02em;
      white-space: nowrap;
      font-size: 10pt;
    }
    .cmp-valor {
      font-weight: 400;
      flex: 1;
      min-width: 35mm;
      border-bottom: 1px solid #c5c5c5;
      padding-bottom: 0.4mm;
    }
    .cmp-valor--upper { text-transform: uppercase; }
    .cmp-tipo-doc { letter-spacing: 0.08em; font-weight: 600; font-size: 10pt; }
    .cmp-fomag {
      margin: 5.5mm 0 0;
      text-align: center;
      line-height: 1.35;
      font-size: 10pt;
      padding: 0 2mm;
    }
    .cmp-servicio-inline {
      margin: 6mm 0 0;
      text-align: center;
      font-size: 11pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.02em;
      line-height: 1.25;
      color: #1a1a1a;
      padding: 0 4mm;
    }
    .cmp-firma-label {
      position: absolute;
      left: ${L.bodySide}mm;
      top: ${F.firmaLabelTop}mm;
      z-index: 3;
      font-weight: 700;
      text-transform: uppercase;
      font-size: 10pt;
      line-height: 1.2;
    }
    ${lineaFirmaCoverCss}
    .cmp-linea-firma-punteada {
      position: absolute;
      left: ${L.lineaFirmaLeft}mm;
      right: ${L.lineaFirmaRight}mm;
      top: ${L.lineaFirma}mm;
      border-top: 0.35mm dashed #6b6b6b;
      z-index: 3;
      pointer-events: none;
    }
    .cmp-firma-paciente {
      position: absolute;
      left: 50%;
      margin-left: -${F.firmaImgWidth / 2}mm;
      width: ${F.firmaImgWidth}mm;
      top: ${F.firmaImgTop}mm;
      height: ${F.firmaImgHeight}mm;
      z-index: 2;
      display: flex;
      align-items: flex-end;
      justify-content: center;
      overflow: hidden;
    }
    .cmp-firma-paciente img {
      /* Sin width/height fijos ni object-fit: html2canvas los ignora y la firma “flota” arriba. */
      display: block;
      max-width: 100%;
      max-height: 100%;
      width: auto;
      height: auto;
      margin: 0 auto;
      mix-blend-mode: multiply;
    }
    .cmp-acudiente {
      position: absolute;
      top: ${L.zonaInferiorTop}mm;
      left: ${L.bodySide}mm;
      right: ${L.bodySide}mm;
      z-index: 1;
      font-size: 10pt;
      line-height: 1.32;
    }
    .cmp-acudiente--vacio .cmp-valor {
      min-height: 4mm;
    }
    .cmp-acudiente-titulo {
      font-weight: 700;
      text-transform: uppercase;
      margin-bottom: 2.5mm;
      letter-spacing: 0.03em;
    }
    .cmp-campo-firma-acud {
      align-items: flex-end;
      min-height: 10mm;
    }
    .cmp-firma-acud-img {
      max-height: 9mm;
      max-width: 65mm;
      object-fit: contain;
      mix-blend-mode: multiply;
    }
    .cmp-pie-bloque {
      position: absolute;
      top: ${L.tablaTop}mm;
      left: ${L.bodySide}mm;
      right: ${L.bodySide}mm;
      z-index: 1;
    }
    .cmp-firmas-wrap {
      margin: 0;
    }
    .cmp-firmas {
      width: 100%;
      border-collapse: collapse;
      font-size: 8.5pt;
      text-align: center;
    }
    .cmp-firmas th, .cmp-firmas td {
      border: 1px solid #c8ccd0;
      padding: 3px 6px;
      vertical-align: middle;
    }
    .cmp-firmas th {
      font-weight: 700;
      text-transform: uppercase;
      font-size: 8pt;
      letter-spacing: 0.03em;
      color: #333;
    }
    .cmp-firmas td {
      height: 1.35em;
      font-size: 8pt;
      color: #6b7280;
      font-weight: 600;
      text-transform: uppercase;
    }
    .cmp-institucional {
      margin-top: 2.5mm;
      text-align: center;
      font-size: 8pt;
      line-height: 1.38;
      color: #2a2a2a;
    }
    .cmp-institucional strong { font-weight: 700; }
    .cmp-contacto {
      position: absolute;
      left: ${L.bodySide}mm;
      right: ${L.bodySide}mm;
      bottom: ${L.contactoBottom}mm;
      z-index: 1;
      text-align: center;
      font-size: 7.5pt;
      line-height: 1.3;
      color: #2a2a2a;
    }
    .cmp-pie-doc {
      position: absolute;
      left: 0;
      right: 0;
      top: ${L.pieRowFromTop - 2.5}mm;
      z-index: 3;
      height: 7mm;
      pointer-events: none;
    }
    .cmp-pie-col {
      position: absolute;
      top: 0;
      transform: translateX(-50%);
      text-align: center;
      color: #2a2a2a;
      line-height: 1.08;
      white-space: nowrap;
    }
    .cmp-pie-pagina {
      position: absolute;
      top: 1.2mm;
      transform: translateX(-50%);
      font-size: 6.5pt;
      color: #2a2a2a;
      white-space: nowrap;
    }
    .cmp-pie-label {
      display: block;
      font-weight: 700;
      font-size: 5.5pt;
      margin-bottom: 0.2mm;
    }
    .cmp-pie-label--caps { text-transform: uppercase; }
    .cmp-pie-valor {
      display: block;
      font-weight: 400;
      font-size: 6pt;
    }
  </style>
</head>
<body>
  <div class="page">
    ${fondoImgHtml}
    <h1 class="cmp-titulo">${escapeHtml(COMPROBANTE_SERVICIOS_TITULO)}</h1>

    <div class="cmp-zona-superior">
      <div class="cmp-campo">
        <span class="cmp-label">FECHA:</span>
        <span class="cmp-valor">${escapeHtml(fechaTxt)}</span>
      </div>
      <div class="cmp-campo">
        <span class="cmp-label">YO:</span>
        <span class="cmp-valor cmp-valor--upper">${escapeHtml(data.paciente_nombre)}</span>
      </div>
      <div class="cmp-campo">
        <span class="cmp-label">TIPO DE IDENTIFICACIÓN:</span>
        <span class="cmp-tipo-doc">${ccMark} CC:</span>
        <span class="cmp-tipo-doc">${tiMark} TI:</span>
        <span class="cmp-tipo-doc">${rcMark} RC:</span>
      </div>
      <div class="cmp-campo">
        <span class="cmp-label">NÚMERO DE IDENTIFICACIÓN:</span>
        <span class="cmp-valor">${escapeHtml(data.paciente_documento)}</span>
      </div>
      <div class="cmp-campo">
        <span class="cmp-label">FECHA DE NACIMIENTO:</span>
        <span class="cmp-valor">${escapeHtml(fechaNacTxt)}</span>
      </div>
      <div class="cmp-campo">
        <span class="cmp-label">DIRECCIÓN:</span>
        <span class="cmp-valor">${escapeHtml(data.direccion)}</span>
      </div>
      <div class="cmp-campo">
        <span class="cmp-label">NÚMERO DE TELÉFONO:</span>
        <span class="cmp-valor">${escapeHtml(data.telefono)}</span>
      </div>
      <div class="cmp-campo">
        <span class="cmp-label">CORREO:</span>
        <span class="cmp-valor">${escapeHtml(data.correo)}</span>
      </div>
      <div class="cmp-campo">
        <span class="cmp-label">TIPO DE AFILIACIÓN:</span>
        <span class="cmp-valor">${escapeHtml(data.tipo_afiliacion)}</span>
      </div>
      <p class="cmp-fomag">${escapeHtml(COMPROBANTE_SERVICIOS_FOMAG_TEXTO)}</p>
      <p class="cmp-servicio-inline">${escapeHtml(data.servicio)}</p>
    </div>
    <div class="cmp-firma-label">FIRMA DEL PACIENTE:</div>
    ${lineaFirmaCoverHtml}
    <div class="cmp-linea-firma-punteada" aria-hidden="true"></div>
    <div class="cmp-firma-paciente">
      <img src="data:${firmaPac.mime};base64,${firmaPac.base64}" alt="Firma del paciente"/>
    </div>

    <div class="cmp-acudiente${acudienteOcultoClass}">
      <div class="cmp-acudiente-titulo">CASO PACIENTE MENOR O ADULTO MAYOR</div>
      <div class="cmp-campo">
        <span class="cmp-label">NOMBRE DE ACUDIENTE O RESPRESENTANTE:</span>
        <span class="cmp-valor">${escapeHtml(data.acudiente_nombre || '')}</span>
      </div>
      <div class="cmp-campo">
        <span class="cmp-label">PARENTEZCO:</span>
        <span class="cmp-valor">${escapeHtml(data.parentesco || '')}</span>
      </div>
      <div class="cmp-campo cmp-campo-firma-acud">
        <span class="cmp-label">FIRMA:</span>
        ${firmaAcudHtml || '<span class="cmp-valor"></span>'}
      </div>
    </div>

    <div class="cmp-pie-bloque">
      <div class="cmp-firmas-wrap">
        <table class="cmp-firmas">
          <thead>
            <tr>
              <th>Elaborado por:</th>
              <th>Revisado por:</th>
              <th>Aprobado por:</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Auditor Médico</td>
              <td>Gerente</td>
              <td>Representante Legal</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="cmp-institucional">
        <div><strong>INSTITUTO NEUROCIENCIAS DE NARIÑO</strong></div>
        <div>NIT 901164565-1</div>
        <div>CÓDIGO HABILITACIÓN 5200102735-01</div>
      </div>
    </div>

    <div class="cmp-contacto">
      San Juan de Pasto, Carrera 34# 13-80 Barrio San Ignacio<br/>
      Teléfono: 602 7238141 – Celular: 3053560651
    </div>

    <footer class="cmp-pie-doc">
      <div class="cmp-pie-col" style="left:${L.pieColCenters[0]}mm">
        <span class="cmp-pie-label cmp-pie-label--caps">Versión:</span>
        <span class="cmp-pie-valor">${escapeHtml(COMPROBANTE_SERVICIOS_PIE.version)}</span>
      </div>
      <div class="cmp-pie-col" style="left:${L.pieColCenters[1]}mm">
        <span class="cmp-pie-label cmp-pie-label--caps">Código:</span>
        <span class="cmp-pie-valor">${escapeHtml(COMPROBANTE_SERVICIOS_PIE.codigo)}</span>
      </div>
      <div class="cmp-pie-col" style="left:${L.pieColCenters[2]}mm">
        <span class="cmp-pie-label">Fecha de elaboración:</span>
        <span class="cmp-pie-valor">${escapeHtml(COMPROBANTE_SERVICIOS_PIE.fecha_elaboracion)}</span>
      </div>
      <div class="cmp-pie-col" style="left:${L.pieColCenters[3]}mm">
        <span class="cmp-pie-label">Fecha de Actualización:</span>
        <span class="cmp-pie-valor">${escapeHtml(COMPROBANTE_SERVICIOS_PIE.fecha_actualizacion)}</span>
      </div>
      <span class="cmp-pie-pagina" style="left:${L.piePaginaCenter}mm">${escapeHtml(COMPROBANTE_SERVICIOS_PIE.pagina)}</span>
    </footer>
  </div>
</body>
</html>`;
}

module.exports = {
  COMPROBANTE_SERVICIOS_TITULO,
  COMPROBANTE_SERVICIOS_FOMAG_TEXTO,
  COMPROBANTE_SERVICIOS_PIE,
  COMPROBANTE_LAYOUT,
  calcularPosicionesFirma,
  formatFechaComprobante,
  formatFechaNacimiento,
  parseImagenBase64,
  validarPayloadComprobanteServicios,
  buildComprobanteServiciosHtml
};
