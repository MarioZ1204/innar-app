/**
 * Quita fondo blanco o crema de imágenes de firma en el navegador (PNG transparente).
 */
(function () {
  'use strict';

  const UMBRAL_LUMINANCIA = 238;
  const MAX_SATURACION_FONDO = 30;

  function esPixelFondoBlanco(r, g, b) {
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const sat = Math.max(r, g, b) - Math.min(r, g, b);
    return lum >= UMBRAL_LUMINANCIA && sat < MAX_SATURACION_FONDO;
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
    return canvas.toDataURL('image/png');
  }

  async function procesarFirmasEnRoot(root) {
    if (!root?.querySelectorAll) return;
    const imgs = root.querySelectorAll('.cmp-firma-paciente img, .cmp-firma-acud-img');
    await Promise.all(Array.from(imgs).map(async (img) => {
      if (!img.src) return;
      try {
        img.src = await quitarFondoDataUrl(img.src);
        img.style.mixBlendMode = 'multiply';
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
