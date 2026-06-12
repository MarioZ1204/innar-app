/**
 * Generación de PDF en el navegador (html2pdf) y descarga de respuestas del servidor.
 */
(function () {
  'use strict';

  const A4_W = 794;
  const A4_H = 1123;

  function esperarImagenes(root, timeoutMs) {
    return new Promise((resolve) => {
      const imgs = (root.querySelectorAll ? root : root.ownerDocument || document).querySelectorAll('img');
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
    }).then(() => new Promise((r) => setTimeout(r, 400)));
  }

  function getFrame() {
    let frame = document.getElementById('innarPdfFrame');
    if (!frame) {
      frame = document.createElement('iframe');
      frame.id = 'innarPdfFrame';
      frame.title = 'Generación PDF';
      frame.setAttribute('aria-hidden', 'true');
      frame.setAttribute('tabindex', '-1');
      document.body.appendChild(frame);
    }
    return frame;
  }

  function ocultarFrame(frame) {
    frame.style.cssText = [
      'position:fixed', 'left:0', 'top:0',
      `width:${A4_W}px`, `height:${A4_H}px`,
      'border:0', 'margin:0', 'padding:0',
      'opacity:0.01', 'pointer-events:none', 'z-index:1',
      'visibility:visible', 'overflow:hidden', 'background:#fff'
    ].join(';');
  }

  async function prepararPagina(html) {
    const frame = getFrame();
    const prevStyle = frame.getAttribute('style') || '';
    frame.style.cssText = [
      'position:fixed', 'left:0', 'top:0',
      `width:${A4_W}px`, `height:${A4_H}px`,
      'border:0', 'margin:0', 'padding:0',
      'opacity:1', 'pointer-events:none', 'z-index:2147483646',
      'visibility:visible', 'overflow:hidden', 'background:#fff'
    ].join(';');

    const doc = frame.contentDocument || frame.contentWindow?.document;
    if (!doc) throw new Error('No se pudo preparar el documento para PDF');

    doc.open();
    doc.write(html);
    doc.close();

    await esperarImagenes(doc, 8000);
    if (doc.fonts?.ready) {
      await Promise.race([doc.fonts.ready, new Promise((r) => setTimeout(r, 5000))]);
    }

    const fix = doc.createElement('style');
    fix.textContent = [
      'html,body{margin:0;padding:0;background:#fff;}',
      `.page{width:${A4_W}px!important;min-height:${A4_H}px!important;height:${A4_H}px!important;`,
      'position:relative!important;overflow:visible!important;background:#fff!important;}',
      '.page-fondo{width:100%!important;height:100%!important;object-fit:fill!important;}'
    ].join('');
    doc.head.appendChild(fix);

    await esperarLayout();

    const page = doc.querySelector('.page');
    if (!page) throw new Error('No se encontró el contenido del documento');

    return { page, frame, prevStyle };
  }

  async function generarPdfDesdeHtml(html, filename) {
    if (!window.html2pdf) throw new Error('Generador PDF no disponible');
    const { page, frame, prevStyle } = await prepararPagina(html);
    const name = filename || 'documento.pdf';
    try {
      await window.html2pdf().set({
        margin: 0,
        filename: name,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          allowTaint: true,
          logging: false,
          backgroundColor: '#ffffff',
          scrollX: 0,
          scrollY: 0
        },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['avoid-all'] }
      }).from(page).save();
    } finally {
      if (prevStyle) frame.setAttribute('style', prevStyle);
      else ocultarFrame(frame);
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

  async function procesarRespuestaDocumento(res, filenameBase) {
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
        await generarPdfDesdeHtml(data.html, data.filename || filename);
        return 'pdf-cliente';
      }
      throw new Error('Respuesta inválida del servidor');
    }

    const html = await res.text();
    if (!html.trim()) throw new Error('El documento generado está vacío');
    await generarPdfDesdeHtml(html, filename);
    return 'pdf-cliente';
  }

  async function generarDesdePreview(url, payload) {
    const res = await apiFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Error generando el documento');
    await generarPdfDesdeHtml(data.html, data.filename);
  }

  window.innarDocumentoPdf = {
    generarPdfDesdeHtml,
    procesarRespuestaDocumento,
    generarDesdePreview
  };
})();
