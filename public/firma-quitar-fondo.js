/**
 * Quita fondo blanco o crema de imágenes de firma en el navegador (PNG transparente)
 * y recorta márgenes vacíos para anclar el trazo al recuadro del comprobante.
 */
(function () {
  'use strict';

  const UMBRAL_LUMINANCIA = 238;
  const MAX_SATURACION_FONDO = 30;
  const ALPHA_MIN = 8;

  function esPixelFondoBlanco(r, g, b) {
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const sat = Math.max(r, g, b) - Math.min(r, g, b);
    return lum >= UMBRAL_LUMINANCIA && sat < MAX_SATURACION_FONDO;
  }

  function bboxTinta(d, width, height) {
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const a = d[(y * width + x) * 4 + 3];
        if (a > ALPHA_MIN) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return null;
    const span = Math.max(maxX - minX + 1, maxY - minY + 1);
    const pad = Math.max(2, Math.round(span * 0.04));
    const left = Math.max(0, minX - pad);
    const top = Math.max(0, minY - pad);
    const right = Math.min(width, maxX + pad + 1);
    const bottom = Math.min(height, maxY + pad + 1);
    return { left, top, width: right - left, height: bottom - top };
  }

  function cargarImagen(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('No se pudo cargar la firma'));
      img.src = src;
    });
  }

  async function quitarFondoDataUrl(dataUrl) {
    if (!dataUrl || typeof dataUrl !== 'string') return dataUrl;
    const img = await cargarImagen(dataUrl);
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) return dataUrl;

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, w, h);
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      if (esPixelFondoBlanco(d[i], d[i + 1], d[i + 2])) d[i + 3] = 0;
    }
    ctx.putImageData(imageData, 0, 0);

    const box = bboxTinta(d, w, h);
    if (!box || (box.width >= w && box.height >= h)) {
      return canvas.toDataURL('image/png');
    }

    const cropped = document.createElement('canvas');
    cropped.width = box.width;
    cropped.height = box.height;
    const cctx = cropped.getContext('2d');
    cctx.drawImage(canvas, box.left, box.top, box.width, box.height, 0, 0, box.width, box.height);
    return cropped.toDataURL('image/png');
  }

  async function procesarFirmasEnRoot(root) {
    if (!root?.querySelectorAll) return;
    const imgs = root.querySelectorAll('.cmp-firma-paciente img, .cmp-firma-acud-img');
    await Promise.all(Array.from(imgs).map(async (img) => {
      if (!img.src) return;
      try {
        img.src = await quitarFondoDataUrl(img.src);
        await new Promise((res) => {
          if (img.complete && img.naturalWidth > 0) res();
          else img.addEventListener('load', res, { once: true });
        });
      } catch (_) { /* ignore */ }
    }));
  }

  async function procesarPayloadComprobante(payload) {
    if (!payload) return payload;
    const out = { ...payload };
    if (out.firma_paciente) {
      out.firma_paciente = await quitarFondoDataUrl(out.firma_paciente);
    }
    if (out.firma_acudiente) {
      out.firma_acudiente = await quitarFondoDataUrl(out.firma_acudiente);
    }
    return out;
  }

  window.innarFirmaFondo = {
    quitarFondoDataUrl,
    procesarFirmasEnRoot,
    procesarPayloadComprobante
  };
})();
