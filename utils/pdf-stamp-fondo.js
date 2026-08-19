'use strict';

const { PDFDocument } = require('pdf-lib');

async function bytesFondoParaPdf(fondo) {
  let bytes = Buffer.from(String(fondo.base64 || ''), 'base64');
  if (!bytes.length) throw new Error('Fondo vacío');
  let mime = String(fondo.mime || 'image/png').toLowerCase();
  if (mime.includes('webp')) {
    const sharp = require('sharp');
    bytes = await sharp(bytes).png().toBuffer();
    mime = 'image/png';
  }
  return { bytes, mime };
}

/**
 * Dibuja el membrete detrás de un PDF de texto (p. ej. Puppeteer sin <img> de fondo).
 * Así Chromium no aplana la hoja a una sola imagen y Nitro puede editar el texto.
 */
async function stampFondoDetras(pdfBytes, fondo) {
  if (!fondo?.base64) return pdfBytes;
  const { bytes, mime } = await bytesFondoParaPdf(fondo);
  const out = await PDFDocument.create();
  const img = (mime.includes('jpeg') || mime.includes('jpg'))
    ? await out.embedJpg(bytes)
    : await out.embedPng(bytes);
  const embeddedPages = await out.embedPdf(pdfBytes);
  for (const embedded of embeddedPages) {
    const width = embedded.width;
    const height = embedded.height;
    const page = out.addPage([width, height]);
    page.drawImage(img, { x: 0, y: 0, width, height });
    page.drawPage(embedded, { x: 0, y: 0, width, height });
  }
  return Buffer.from(await out.save());
}

module.exports = { stampFondoDetras };
