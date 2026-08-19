'use strict';

const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const {
  COMPROBANTE_SERVICIOS_TITULO,
  COMPROBANTE_SERVICIOS_FOMAG_TEXTO,
  COMPROBANTE_SERVICIOS_PIE,
  COMPROBANTE_TABLA_FIRMAS,
  COMPROBANTE_LAYOUT,
  calcularPosicionesFirma,
  formatFechaComprobante,
  formatFechaNacimiento
} = require('./comprobante-servicios');

const MM = 72 / 25.4;
const PAGE_W = 210 * MM;
const PAGE_H = 297 * MM;
const TEXT = rgb(0.1, 0.1, 0.1);
const MUTED = rgb(0.42, 0.42, 0.42);
const LINE = rgb(0.77, 0.77, 0.77);

function mm(n) {
  return Number(n) * MM;
}

function yTop(topMm) {
  return PAGE_H - mm(topMm);
}

function toWinAnsi(value) {
  return String(value || '')
    .replace(/☒/g, 'X')
    .replace(/☐/g, '')
    .replace(/[—]/g, '-')
    .replace(/[“”«»]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\u00a0/g, ' ');
}

function wrapText(text, font, size, maxWidth) {
  const raw = toWinAnsi(text).trim();
  if (!raw) return [''];
  const words = raw.split(/\s+/);
  const lines = [];
  let current = '';
  for (const word of words) {
    const trial = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(trial, size) <= maxWidth) {
      current = trial;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

function campoStep(size) {
  return size * 1.32 + mm(2.8);
}

async function embedDataImage(doc, img) {
  if (!img?.base64) return null;
  const bytes = Buffer.from(String(img.base64), 'base64');
  if (!bytes.length) return null;
  const mime = String(img.mime || 'image/png').toLowerCase();
  try {
    if (mime.includes('jpeg') || mime.includes('jpg')) return await doc.embedJpg(bytes);
    return await doc.embedPng(bytes);
  } catch (_) {
    try {
      const sharp = require('sharp');
      const png = await sharp(bytes).png().toBuffer();
      return await doc.embedPng(png);
    } catch (e2) {
      return null;
    }
  }
}

function drawImageContain(page, img, box) {
  const scale = Math.min(box.width / img.width, box.height / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  page.drawImage(img, {
    x: box.x + (box.width - w) / 2,
    y: box.y,
    width: w,
    height: h
  });
}

function drawCampo(page, { x, y, width, label, value, font, fontBold, size }) {
  const labelTxt = toWinAnsi(label);
  const labelW = fontBold.widthOfTextAtSize(labelTxt, size);
  page.drawText(labelTxt, { x, y, size, font: fontBold, color: TEXT });
  const vx = x + labelW + mm(3);
  const maxW = Math.max(20, width - labelW - mm(3));
  const lines = wrapText(value, font, size, maxW);
  let cy = y;
  lines.forEach((line, idx) => {
    if (line) page.drawText(line, { x: vx, y: cy, size, font, color: TEXT });
    if (idx === lines.length - 1) {
      page.drawLine({
        start: { x: vx, y: cy - 1.2 },
        end: { x: x + width, y: cy - 1.2 },
        thickness: 0.45,
        color: LINE
      });
    }
    cy -= size * 1.32;
  });
  return y - campoStep(size) - Math.max(0, lines.length - 1) * (size * 1.32);
}

function drawBallot(page, x, baseline, checked) {
  const s = 8;
  const y = baseline - 0.35;
  page.drawRectangle({
    x,
    y,
    width: s,
    height: s,
    borderColor: TEXT,
    borderWidth: 0.75
  });
  if (checked) {
    const i = 1.5;
    page.drawLine({
      start: { x: x + i, y: y + i },
      end: { x: x + s - i, y: y + s - i },
      thickness: 0.9,
      color: TEXT
    });
    page.drawLine({
      start: { x: x + s - i, y: y + i },
      end: { x: x + i, y: y + s - i },
      thickness: 0.9,
      color: TEXT
    });
  }
  return s;
}

function drawCentered(page, text, { x, width, y, size, font, color }) {
  const t = toWinAnsi(text);
  const w = font.widthOfTextAtSize(t, size);
  page.drawText(t, {
    x: x + Math.max(0, (width - w) / 2),
    y,
    size,
    font,
    color: color || TEXT
  });
}

async function buildComprobanteServiciosPdf(data, fondo = {}) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const L = COMPROBANTE_LAYOUT;
  const F = calcularPosicionesFirma(L);
  const tipo = String(data.tipo_documento || 'CC').toUpperCase();

  const fondoImg = await embedDataImage(doc, fondo);
  if (fondoImg) {
    page.drawImage(fondoImg, { x: 0, y: 0, width: PAGE_W, height: PAGE_H });
  }

  const titleSize = 8.5;
  const titleMax = mm(210 - L.tituloLeft - L.tituloRight) - mm(4);
  const titleLines = wrapText(COMPROBANTE_SERVICIOS_TITULO, fontBold, titleSize, titleMax);
  if (titleLines.length >= 2 && /-\s*$/.test(titleLines[0])) {
    titleLines[0] = titleLines[0].replace(/\s*-\s*$/, '');
    titleLines[1] = `- ${titleLines[1]}`;
  }
  const titleLeading = titleSize * 1.15;
  let titleY = yTop(L.tituloTop + 10.3);
  titleLines.forEach((line) => {
    drawCentered(page, line, {
      x: mm(L.tituloLeft) + mm(2),
      width: titleMax,
      y: titleY,
      size: titleSize,
      font: fontBold,
      color: rgb(0.17, 0.17, 0.17)
    });
    titleY -= titleLeading;
  });

  const x = mm(L.bodySide);
  const colW = mm(210 - L.bodySide * 2);
  const size = 10.5;
  let y = yTop(L.bodyTop) - size;

  y = drawCampo(page, {
    x, y, width: colW, label: 'FECHA:', value: formatFechaComprobante(data.fecha),
    font, fontBold, size
  });
  y = drawCampo(page, {
    x, y, width: colW, label: 'YO:', value: String(data.paciente_nombre || '').toUpperCase(),
    font, fontBold, size
  });

  page.drawText(toWinAnsi('TIPO DE IDENTIFICACIÓN:'), {
    x, y, size: 10, font: fontBold, color: TEXT
  });
  const marks = [
    { on: tipo === 'CC', label: 'CC:' },
    { on: tipo === 'TI', label: 'TI:' },
    { on: tipo === 'RC', label: 'RC:' }
  ];
  let mx = x + fontBold.widthOfTextAtSize(toWinAnsi('TIPO DE IDENTIFICACIÓN:'), 10) + mm(3);
  marks.forEach((m) => {
    const box = drawBallot(page, mx, y, m.on);
    page.drawText(m.label, {
      x: mx + box + mm(1.4),
      y,
      size: 10,
      font: fontBold,
      color: TEXT
    });
    mx += box + mm(1.4) + fontBold.widthOfTextAtSize(m.label, 10) + mm(4.2);
  });
  y -= campoStep(size);

  y = drawCampo(page, {
    x, y, width: colW, label: 'NÚMERO DE IDENTIFICACIÓN:', value: data.paciente_documento,
    font, fontBold, size
  });
  y = drawCampo(page, {
    x, y, width: colW, label: 'FECHA DE NACIMIENTO:', value: formatFechaNacimiento(data.fecha_nacimiento),
    font, fontBold, size
  });
  y = drawCampo(page, {
    x, y, width: colW, label: 'DIRECCIÓN:', value: data.direccion,
    font, fontBold, size
  });
  y = drawCampo(page, {
    x, y, width: colW, label: 'NÚMERO DE TELÉFONO:', value: data.telefono,
    font, fontBold, size
  });
  y = drawCampo(page, {
    x, y, width: colW, label: 'CORREO:', value: data.correo,
    font, fontBold, size
  });
  y = drawCampo(page, {
    x, y, width: colW, label: 'TIPO DE AFILIACIÓN:', value: data.tipo_afiliacion,
    font, fontBold, size
  });

  y -= mm(5.5);
  const fomagSize = 10;
  const fomagW = colW - mm(4);
  wrapText(COMPROBANTE_SERVICIOS_FOMAG_TEXTO, font, fomagSize, fomagW).forEach((line) => {
    drawCentered(page, line, {
      x: x + mm(2),
      width: fomagW,
      y,
      size: fomagSize,
      font,
      color: TEXT
    });
    y -= fomagSize * 1.35;
  });

  y = Math.min(y - mm(6), yTop(L.servicioTop) - 11);
  const servSize = 11;
  wrapText(String(data.servicio || '').toUpperCase(), fontBold, servSize, colW - mm(8)).forEach((line) => {
    drawCentered(page, line, {
      x: x + mm(4),
      width: colW - mm(8),
      y,
      size: servSize,
      font: fontBold,
      color: TEXT
    });
    y -= servSize * 1.25;
  });

  page.drawText('FIRMA DEL PACIENTE:', {
    x,
    y: yTop(F.firmaLabelTop) - 10 * 0.82,
    size: 10,
    font: fontBold,
    color: TEXT
  });

  page.drawRectangle({
    x: mm(L.lineaFirmaLeft),
    y: yTop(L.lineaFirmaFondo - 1.2) - mm(3.8),
    width: PAGE_W - mm(L.lineaFirmaLeft) - mm(L.lineaFirmaRight),
    height: mm(3.8),
    color: rgb(1, 1, 1)
  });
  page.drawLine({
    start: { x: mm(L.lineaFirmaLeft), y: yTop(L.lineaFirma) },
    end: { x: PAGE_W - mm(L.lineaFirmaRight), y: yTop(L.lineaFirma) },
    thickness: 0.9,
    color: MUTED,
    dashArray: [4, 2.5]
  });

  const firmaImg = await embedDataImage(doc, data.firma_paciente);
  if (firmaImg) {
    drawImageContain(page, firmaImg, {
      x: (PAGE_W - mm(F.firmaImgWidth)) / 2,
      y: yTop(F.firmaImgTop) - mm(F.firmaImgHeight),
      width: mm(F.firmaImgWidth),
      height: mm(F.firmaImgHeight)
    });
  }

  let ay = yTop(L.zonaInferiorTop) - 10;
  page.drawText('CASO PACIENTE MENOR O ADULTO MAYOR', {
    x, y: ay, size: 10, font: fontBold, color: TEXT
  });
  ay -= mm(7);
  ay = drawCampo(page, {
    x, y: ay, width: colW,
    label: 'NOMBRE DE ACUDIENTE O RESPRESENTANTE:',
    value: data.acudiente_nombre || '',
    font, fontBold, size: 10
  });
  ay = drawCampo(page, {
    x, y: ay, width: colW,
    label: 'PARENTEZCO:',
    value: data.parentesco || '',
    font, fontBold, size: 10
  });
  const firmaAcudY = ay - mm(5.8);
  page.drawText('FIRMA:', { x, y: firmaAcudY, size: 10, font: fontBold, color: TEXT });
  const firmaAcud = await embedDataImage(doc, data.firma_acudiente);
  if (firmaAcud) {
    drawImageContain(page, firmaAcud, {
      x: x + mm(22),
      y: firmaAcudY - mm(2),
      width: mm(65),
      height: mm(9)
    });
  } else {
    page.drawLine({
      start: { x: x + mm(18), y: firmaAcudY - 1.2 },
      end: { x: x + colW, y: firmaAcudY - 1.2 },
      thickness: 0.45,
      color: LINE
    });
  }

  const tableTop = yTop(L.tablaTop);
  const tableH = mm(13);
  const col = colW / 3;
  page.drawRectangle({
    x, y: tableTop - tableH, width: colW, height: tableH,
    borderColor: LINE, borderWidth: 0.7, color: rgb(1, 1, 1)
  });
  page.drawLine({ start: { x: x + col, y: tableTop }, end: { x: x + col, y: tableTop - tableH }, thickness: 0.6, color: LINE });
  page.drawLine({ start: { x: x + col * 2, y: tableTop }, end: { x: x + col * 2, y: tableTop - tableH }, thickness: 0.6, color: LINE });
  page.drawLine({ start: { x, y: tableTop - mm(6.2) }, end: { x: x + colW, y: tableTop - mm(6.2) }, thickness: 0.6, color: LINE });
  COMPROBANTE_TABLA_FIRMAS.forEach((row, i) => {
    drawCentered(page, row.header, {
      x: x + col * i,
      width: col,
      y: tableTop - mm(3.7),
      size: 8,
      font: fontBold,
      color: TEXT
    });
    drawCentered(page, row.cargo, {
      x: x + col * i,
      width: col,
      y: tableTop - mm(8.7),
      size: 8,
      font: fontBold,
      color: MUTED
    });
  });

  const instY = tableTop - tableH - mm(2.5);
  const inst = [
    { t: 'INSTITUTO NEUROCIENCIAS DE NARIÑO', bold: true },
    { t: 'NIT 901164565-1', bold: false },
    { t: 'CÓDIGO HABILITACIÓN 5200102735-01', bold: false }
  ];
  inst.forEach((row, i) => {
    drawCentered(page, row.t, {
      x,
      width: colW,
      y: instY - i * (8 * 1.38),
      size: 8,
      font: row.bold ? fontBold : font,
      color: TEXT
    });
  });

  const contactSize = 7.5;
  const contactLeading = contactSize * 1.3;
  const phoneY = mm(L.contactoBottom) + 2.3;
  const addrY = phoneY + contactLeading;
  drawCentered(page, 'San Juan de Pasto, Carrera 34# 13-80 Barrio San Ignacio', {
    x: 0, width: PAGE_W, y: addrY, size: contactSize, font, color: TEXT
  });
  drawCentered(page, 'Teléfono: 602 7238141 – Celular: 3053560651', {
    x: 0, width: PAGE_W, y: phoneY, size: contactSize, font, color: TEXT
  });

  const pieBoxTop = yTop(L.pieRowFromTop - 2.5);
  const pieLabelY = pieBoxTop - 5.5 * 0.8;
  const pieValueY = pieLabelY - 6.8;
  const pies = [
    { c: L.pieColCenters[0], l: COMPROBANTE_SERVICIOS_PIE.label_version, v: COMPROBANTE_SERVICIOS_PIE.version },
    { c: L.pieColCenters[1], l: COMPROBANTE_SERVICIOS_PIE.label_codigo, v: COMPROBANTE_SERVICIOS_PIE.codigo },
    { c: L.pieColCenters[2], l: COMPROBANTE_SERVICIOS_PIE.label_elaboracion, v: COMPROBANTE_SERVICIOS_PIE.fecha_elaboracion },
    { c: L.pieColCenters[3], l: COMPROBANTE_SERVICIOS_PIE.label_actualizacion, v: COMPROBANTE_SERVICIOS_PIE.fecha_actualizacion }
  ];
  pies.forEach((p) => {
    const label = toWinAnsi(p.l);
    const value = toWinAnsi(p.v);
    const lw = fontBold.widthOfTextAtSize(label, 5.5);
    const vw = font.widthOfTextAtSize(value, 6);
    const cx = mm(p.c);
    page.drawText(label, { x: cx - lw / 2, y: pieLabelY, size: 5.5, font: fontBold, color: TEXT });
    page.drawText(value, { x: cx - vw / 2, y: pieValueY, size: 6, font, color: TEXT });
  });
  const pag = toWinAnsi(COMPROBANTE_SERVICIOS_PIE.pagina);
  const pw = font.widthOfTextAtSize(pag, 6.5);
  page.drawText(pag, {
    x: mm(L.piePaginaCenter) - pw / 2,
    y: pieBoxTop - mm(1.2) - 6.5 * 0.8,
    size: 6.5,
    font,
    color: TEXT
  });

  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

module.exports = { buildComprobanteServiciosPdf };
