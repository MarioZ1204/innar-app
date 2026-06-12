/**
 * Generación de PDF en el navegador (html2canvas + jsPDF) y descarga desde el servidor.
 */
(function () {
  'use strict';

  const A4_W = 794;
  const A4_H = 1123;

  function esperarImagenes(root, timeoutMs) {
    return new Promise((resolve) => {
      const imgs = (root.querySelectorAll ? root : document).querySelectorAll('img');
      if (!imgs.length) { resolve(); return; }
      let pendientes = imgs.length;
      const listo = () => { pendientes -= 1; if (pendientes <= 0) resolve(); };
      imgs.forEach((img) => {
        if (img.complete) listo();
        else {
          img.addEventListener('load', listo, { once: true });
          img.addEventListener('error', listo, { once: true });
        }
      });
      setTimeout(resolve, timeoutMs || 8000);
    });
  }

  function esperarLayout() {
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }).then(() => new Promise((r) => setTimeout(r, 350)));
  }

  function limpiarElementosImpresion(doc) {
    doc.querySelectorAll('.no-print, .doc-print-bar').forEach((el) => el.remove());
  }

  function normalizarHtmlString(html) {
    const parsed = new DOMParser().parseFromString(String(html || ''), 'text/html');
    limpiarElementosImpresion(parsed);
    const page = parsed.querySelector('.page');
    if (!page) return String(html || '');

    const styles = Array.from(parsed.querySelectorAll('style'))
      .map((s) => s.outerHTML)
      .join('');
    return `<!DOCTYPE html><html><head><meta charset="utf-8">${styles}</head><body>${page.outerHTML}</body></html>`;
  }

  function montarStaging(html) {
    document.getElementById('innarPdfStage')?.remove();

    const parsed = new DOMParser().parseFromString(String(html || ''), 'text/html');
    limpiarElementosImpresion(parsed);

    const page = parsed.querySelector('.page');
    if (!page) throw new Error('No se encontró el contenido del documento');

    const stage = document.createElement('div');
    stage.id = 'innarPdfStage';
    stage.setAttribute('aria-hidden', 'true');
    stage.style.cssText = [
      'position:fixed', 'left:0', 'top:0',
      `width:${A4_W}px`, `height:${A4_H}px`,
      'z-index:2147483646', 'pointer-events:none', 'overflow:hidden',
      'background:#fff', 'opacity:1'
    ].join(';');

    parsed.querySelectorAll('style').forEach((style) => {
      stage.appendChild(style.cloneNode(true));
    });

    const fix = document.createElement('style');
    fix.textContent = [
      '#innarPdfStage,#innarPdfStage .page{box-sizing:border-box;}',
      `#innarPdfStage .page{width:${A4_W}px!important;min-height:${A4_H}px!important;height:${A4_H}px!important;`,
      'position:relative!important;overflow:visible!important;background:#fff!important;margin:0!important;}',
      '#innarPdfStage .page-fondo{width:100%!important;height:100%!important;object-fit:fill!important;}'
    ].join('');
    stage.appendChild(fix);

    const pageClone = page.cloneNode(true);
    stage.appendChild(pageClone);
    document.body.appendChild(stage);

    return { stage, page: pageClone };
  }

  function canvasTieneContenido(canvas) {
    if (!canvas || canvas.width < 10 || canvas.height < 10) return false;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;

    function regionTieneTinta(x, y, w, h) {
      const data = ctx.getImageData(x, y, w, h).data;
      for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3];
        if (a > 8 && (data[i] < 248 || data[i + 1] < 248 || data[i + 2] < 248)) return true;
      }
      return false;
    }

    if (regionTieneTinta(0, 0, Math.min(100, canvas.width), Math.min(100, canvas.height))) return true;
    const cx = Math.max(0, Math.floor(canvas.width / 2) - 50);
    const cy = Math.max(0, Math.floor(canvas.height / 2) - 50);
    return regionTieneTinta(cx, cy, Math.min(100, canvas.width - cx), Math.min(100, canvas.height - cy));
  }

  function obtenerJsPdf() {
    if (window.jspdf?.jsPDF) return window.jspdf.jsPDF;
    if (window.jsPDF) return window.jsPDF;
    return null;
  }

  async function rasterizarAPdf(pageEl, filename) {
    const html2canvas = window.html2canvas;
    const JsPDF = obtenerJsPdf();
    if (!html2canvas || !JsPDF) {
      throw new Error('Generador PDF no disponible (html2canvas/jsPDF)');
    }

    const canvas = await html2canvas(pageEl, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      logging: false,
      backgroundColor: '#ffffff',
      scrollX: 0,
      scrollY: 0,
      width: A4_W,
      height: A4_H,
      windowWidth: A4_W,
      windowHeight: A4_H,
      onclone: (_doc, clonedEl) => {
        clonedEl.style.width = `${A4_W}px`;
        clonedEl.style.height = `${A4_H}px`;
        clonedEl.style.background = '#fff';
      }
    });

    if (!canvasTieneContenido(canvas)) {
      const err = new Error('BLANK_CANVAS');
      throw err;
    }

    const imgData = canvas.toDataURL('image/jpeg', 0.92);
    const pdf = new JsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const pw = pdf.internal.pageSize.getWidth();
    const ph = pdf.internal.pageSize.getHeight();
    pdf.addImage(imgData, 'JPEG', 0, 0, pw, ph, undefined, 'FAST');
    pdf.save(filename);
  }

  function htmlParaImpresionManual(html) {
    const bar = [
      '<div class="no-print" style="text-align:center;padding:12px;background:#eef3f2;',
      'border-bottom:1px solid #c5d4d1;font-family:Arial,sans-serif">',
      '<button type="button" onclick="window.print()" style="padding:10px 22px;background:#2d4a47;',
      'color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600">',
      'Imprimir / Guardar como PDF</button>',
      '<p style="font-size:12px;color:#555;margin:8px 0 0">En Chrome active «Gráficos de fondo» si el diseño no sale completo.</p>',
      '</div>'
    ].join('');
    const out = String(html || '');
    if (/<body[^>]*>/i.test(out)) return out.replace(/<body([^>]*)>/i, `<body$1>${bar}`);
    return bar + out;
  }

  function abrirImpresionDocumento(html) {
    const w = window.open('', '_blank', 'noopener,noreferrer');
    if (!w) {
      throw new Error('No se pudo abrir la ventana de impresión. Permita ventanas emergentes.');
    }
    w.document.open();
    w.document.write(htmlParaImpresionManual(html));
    w.document.close();
    w.focus();
    setTimeout(() => {
      try { w.print(); } catch (_) { /* ignore */ }
    }, 700);
  }

  async function generarPdfDesdeHtml(html, filename) {
    const name = filename || 'documento.pdf';
    const limpio = normalizarHtmlString(html);
    let stage = null;

    try {
      const montado = montarStaging(limpio);
      stage = montado.stage;
      const { page } = montado;

      await esperarImagenes(page, 8000);
      if (document.fonts?.ready) {
        await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 5000))]);
      }
      await esperarLayout();

      try {
        await rasterizarAPdf(page, name);
        return 'pdf-cliente';
      } catch (e) {
        if (e.message === 'BLANK_CANVAS') {
          abrirImpresionDocumento(limpio);
          return 'impresion';
        }
        throw e;
      }
    } finally {
      stage?.remove();
    }
  }

  function descargarBlob(blob, filename) {
    if (!blob || !blob.size) throw new Error('El documento generado está vacío');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  async function fetchPreviewHtml(previewUrl, payload) {
    const res = await apiFetch(previewUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Error generando el documento');
    if (!data.html) throw new Error('Respuesta inválida del servidor');
    return data;
  }

  async function generarDocumento({ postUrl, previewUrl, payload, filename }) {
    const name = String(filename || 'documento.pdf').endsWith('.pdf')
      ? String(filename || 'documento.pdf')
      : `${filename}.pdf`;

    const res = await apiFetch(postUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const ct = (res.headers.get('content-type') || '').toLowerCase();
    const modo = res.headers.get('X-Documento-Modo');

    if (modo === 'pdf' || ct.includes('application/pdf')) {
      descargarBlob(await res.blob(), name);
      return 'pdf-servidor';
    }

    await res.text().catch(() => '');

    if (previewUrl) {
      const preview = await fetchPreviewHtml(previewUrl, payload);
      return generarPdfDesdeHtml(preview.html, preview.filename || name);
    }

    throw new Error('El servidor no generó PDF y no hay vista previa disponible');
  }

  async function procesarRespuestaDocumento(res, filenameBase, options = {}) {
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    const modo = res.headers.get('X-Documento-Modo');
    const filename = filenameBase.endsWith('.pdf') ? filenameBase : `${filenameBase}.pdf`;

    if (modo === 'pdf' || ct.includes('application/pdf')) {
      descargarBlob(await res.blob(), filename);
      return 'pdf-servidor';
    }

    if (ct.includes('application/json')) {
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (data.html) {
        return generarPdfDesdeHtml(data.html, data.filename || filename);
      }
      throw new Error('Respuesta inválida del servidor');
    }

    const html = await res.text();
    if (!html.trim()) throw new Error('El documento generado está vacío');

    if (options.previewUrl && options.payload) {
      const preview = await fetchPreviewHtml(options.previewUrl, options.payload);
      return generarPdfDesdeHtml(preview.html, preview.filename || filename);
    }

    return generarPdfDesdeHtml(html, filename);
  }

  async function generarDesdePreview(url, payload) {
    const data = await fetchPreviewHtml(url, payload);
    return generarPdfDesdeHtml(data.html, data.filename);
  }

  window.innarDocumentoPdf = {
    generarPdfDesdeHtml,
    procesarRespuestaDocumento,
    generarDesdePreview,
    generarDocumento
  };
})();
