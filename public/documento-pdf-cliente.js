/**
 * Generación de PDF en el navegador (html2canvas + jsPDF) y descarga desde el servidor.
 */
(function () {
  'use strict';

  const A4_W = 794;
  const A4_H = 1123;

  function esperarImagenes(root, timeoutMs) {
    return new Promise((resolve) => {
      const doc = root.ownerDocument || document;
      const imgs = (root.querySelectorAll ? root : doc).querySelectorAll('img');
      if (!imgs.length) { resolve(); return; }
      let pendientes = imgs.length;
      const listo = () => { pendientes -= 1; if (pendientes <= 0) resolve(); };
      imgs.forEach((img) => {
        if (img.complete && img.naturalWidth > 0) listo();
        else {
          img.addEventListener('load', listo, { once: true });
          img.addEventListener('error', listo, { once: true });
        }
      });
      setTimeout(resolve, timeoutMs || 10000);
    });
  }

  function esperarLayout(ms) {
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }).then(() => new Promise((r) => setTimeout(r, ms || 500)));
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

  function estilosStagingFix() {
    return [
      '#innarPdfStage,#innarPdfStage .page{box-sizing:border-box;}',
      `#innarPdfStage .page{width:${A4_W}px!important;min-height:${A4_H}px!important;height:${A4_H}px!important;`,
      'position:relative!important;overflow:visible!important;background:#fff!important;margin:0!important;}',
      '#innarPdfStage .page-fondo{width:100%!important;height:100%!important;object-fit:fill!important;display:block!important;}',
      '#innarPdfStage .page-content{position:relative!important;z-index:1!important;}'
    ].join('');
  }

  function montarStaging(html) {
    document.getElementById('innarPdfStage')?.remove();

    const parsed = new DOMParser().parseFromString(String(html || ''), 'text/html');
    limpiarElementosImpresion(parsed);

    const page = parsed.querySelector('.page');
    if (!page) throw new Error('No se encontró el contenido del documento');

    const stage = document.createElement('div');
    stage.id = 'innarPdfStage';
    stage.style.cssText = [
      'position:fixed', 'left:0', 'top:0',
      `width:${A4_W}px`, `height:${A4_H}px`,
      'z-index:2147483646', 'pointer-events:none', 'overflow:hidden',
      'background:#fff', 'opacity:1', 'visibility:visible'
    ].join(';');

    parsed.querySelectorAll('style').forEach((style) => {
      stage.appendChild(style.cloneNode(true));
    });

    const fix = document.createElement('style');
    fix.textContent = estilosStagingFix();
    stage.appendChild(fix);

    const pageClone = page.cloneNode(true);
    stage.appendChild(pageClone);
    document.body.appendChild(stage);

    return { stage, page: pageClone, tipo: 'dom' };
  }

  function montarEnIframe(html) {
    document.getElementById('innarPdfFrame')?.remove();

    const frame = document.createElement('iframe');
    frame.id = 'innarPdfFrame';
    frame.title = 'Generación PDF';
    frame.setAttribute('tabindex', '-1');
    frame.style.cssText = [
      'position:fixed', 'left:0', 'top:0',
      `width:${A4_W}px`, `height:${A4_H}px`,
      'border:0', 'margin:0', 'padding:0', 'opacity:1',
      'pointer-events:none', 'z-index:2147483646',
      'visibility:visible', 'overflow:hidden', 'background:#fff'
    ].join(';');

    document.body.appendChild(frame);

    const doc = frame.contentDocument || frame.contentWindow?.document;
    if (!doc) throw new Error('No se pudo preparar el documento para PDF');

    doc.open();
    doc.write(html);
    doc.close();

    const fix = doc.createElement('style');
    fix.textContent = [
      'html,body{margin:0;padding:0;background:#fff;}',
      `.page{width:${A4_W}px!important;min-height:${A4_H}px!important;height:${A4_H}px!important;`,
      'position:relative!important;overflow:visible!important;background:#fff!important;}',
      '.page-fondo{width:100%!important;height:100%!important;object-fit:fill!important;display:block!important;}'
    ].join('');
    doc.head.appendChild(fix);

    const page = doc.querySelector('.page');
    if (!page) throw new Error('No se encontró el contenido del documento');

    return {
      stage: frame,
      page,
      tipo: 'iframe',
      win: frame.contentWindow,
      doc
    };
  }

  async function prepararDocumento(html) {
    const limpio = normalizarHtmlString(html);
    const montado = montarStaging(limpio);
    await esperarImagenes(montado.page, 10000);
    if (document.fonts?.ready) {
      await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 6000))]);
    }
    await esperarLayout(500);
    return { ...montado, limpio };
  }

  async function prepararDocumentoIframe(html) {
    const limpio = normalizarHtmlString(html);
    const montado = montarEnIframe(limpio);
    await esperarImagenes(montado.doc, 10000);
    if (montado.doc.fonts?.ready) {
      await Promise.race([montado.doc.fonts.ready, new Promise((r) => setTimeout(r, 6000))]);
    }
    await esperarLayout(600);
    return { ...montado, limpio };
  }

  function canvasTieneContenido(canvas) {
    if (!canvas || canvas.width < 10 || canvas.height < 10) return false;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return false;

    const puntos = [0.12, 0.35, 0.5, 0.65, 0.88];
    for (const py of puntos) {
      for (const px of puntos) {
        const x = Math.min(canvas.width - 1, Math.floor(canvas.width * px));
        const y = Math.min(canvas.height - 1, Math.floor(canvas.height * py));
        const d = ctx.getImageData(x, y, 1, 1).data;
        if (d[3] > 8 && (d[0] < 245 || d[1] < 245 || d[2] < 245)) return true;
      }
    }
    return false;
  }

  function obtenerJsPdf() {
    if (window.jspdf?.jsPDF) return window.jspdf.jsPDF;
    if (window.jsPDF) return window.jsPDF;
    return null;
  }

  function prepararClonCaptura(clonedEl) {
    clonedEl.style.width = `${A4_W}px`;
    clonedEl.style.minHeight = `${A4_H}px`;
    clonedEl.style.height = `${A4_H}px`;
    clonedEl.style.background = '#fff';
    clonedEl.style.opacity = '1';
    clonedEl.style.visibility = 'visible';
    clonedEl.style.display = 'block';
    clonedEl.querySelectorAll('img').forEach((img) => {
      img.style.display = 'block';
      img.style.visibility = 'visible';
      img.style.opacity = '1';
    });
  }

  async function capturarConHtml2Canvas(target, opts = {}) {
    const html2canvas = window.html2canvas;
    if (!html2canvas) throw new Error('Generador PDF no disponible (html2canvas)');

    const base = {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      logging: false,
      backgroundColor: '#ffffff',
      scrollX: 0,
      scrollY: 0,
      onclone: (_doc, clonedEl) => prepararClonCaptura(clonedEl)
    };

    return html2canvas(target, { ...base, ...opts });
  }

  async function intentarCaptura(montado) {
    const intentos = [];

    if (montado.tipo === 'dom') {
      intentos.push(
        () => capturarConHtml2Canvas(montado.stage),
        () => capturarConHtml2Canvas(montado.page),
        () => capturarConHtml2Canvas(montado.page, { scale: 1.5 })
      );
    } else {
      intentos.push(
        () => capturarConHtml2Canvas(montado.page, { window: montado.win }),
        () => capturarConHtml2Canvas(montado.page, { window: montado.win, scale: 1.5 })
      );
    }

    let ultimo = null;
    for (const intento of intentos) {
      try {
        const canvas = await intento();
        ultimo = canvas;
        if (canvasTieneContenido(canvas)) return canvas;
      } catch (_) { /* siguiente intento */ }
    }
    return ultimo;
  }

  async function rasterizarAPdf(montado, filename) {
    const JsPDF = obtenerJsPdf();
    if (!JsPDF) throw new Error('Generador PDF no disponible (jsPDF)');

    const canvas = await intentarCaptura(montado);
    if (!canvas) throw new Error('No se pudo capturar el documento');

    const imgData = canvas.toDataURL('image/jpeg', 0.92);
    if (!imgData || imgData.length < 5000) {
      throw new Error('BLANK_CANVAS');
    }

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
    document.getElementById('innarPrintOverlay')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'innarPrintOverlay';
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:2147483647',
      'background:#eef3f2', 'display:flex', 'flex-direction:column'
    ].join(';');

    const bar = document.createElement('div');
    bar.className = 'no-print';
    bar.style.cssText = [
      'flex:0 0 auto', 'padding:12px 16px', 'background:#eef3f2',
      'border-bottom:1px solid #c5d4d1', 'text-align:center', 'font-family:Arial,sans-serif'
    ].join(';');

    const btnPrint = document.createElement('button');
    btnPrint.type = 'button';
    btnPrint.textContent = 'Imprimir / Guardar como PDF';
    btnPrint.style.cssText = [
      'padding:10px 22px', 'margin-right:8px', 'background:#2d4a47', 'color:#fff',
      'border:none', 'border-radius:6px', 'cursor:pointer', 'font-weight:600'
    ].join(';');

    const btnClose = document.createElement('button');
    btnClose.type = 'button';
    btnClose.textContent = 'Cerrar';
    btnClose.style.cssText = [
      'padding:10px 22px', 'background:#fff', 'color:#2d4a47',
      'border:1px solid #c5d4d1', 'border-radius:6px', 'cursor:pointer', 'font-weight:600'
    ].join(';');

    const hint = document.createElement('p');
    hint.textContent = 'Use «Guardar como PDF» en el diálogo. Active «Gráficos de fondo» si el diseño no sale completo.';
    hint.style.cssText = 'font-size:12px;color:#555;margin:8px 0 0';

    bar.append(btnPrint, btnClose, hint);

    const frame = document.createElement('iframe');
    frame.title = 'Vista previa del documento';
    frame.style.cssText = 'flex:1 1 auto;width:100%;border:0;background:#fff';

    overlay.append(bar, frame);
    document.body.appendChild(overlay);

    const htmlImp = htmlParaImpresionManual(html);
    frame.srcdoc = htmlImp;

    const cerrar = () => overlay.remove();
    btnClose.addEventListener('click', cerrar);
    btnPrint.addEventListener('click', () => {
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
      } catch (_) { /* ignore */ }
    });

    frame.addEventListener('load', () => {
      setTimeout(() => {
        try {
          frame.contentWindow?.focus();
          frame.contentWindow?.print();
        } catch (_) { /* ignore */ }
      }, 500);
    }, { once: true });
  }

  function limpiarMontaje(montado) {
    montado?.stage?.remove();
  }

  async function generarPdfDesdeHtml(html, filename) {
    const name = filename || 'documento.pdf';
    let montado = null;

    try {
      montado = await prepararDocumento(html);
      try {
        await rasterizarAPdf(montado, name);
        return 'pdf-cliente';
      } catch (e1) {
        limpiarMontaje(montado);
        montado = await prepararDocumentoIframe(html);
        try {
          await rasterizarAPdf(montado, name);
          return 'pdf-cliente';
        } catch (_e2) {
          abrirImpresionDocumento(montado.limpio || normalizarHtmlString(html));
          return 'impresion';
        }
      }
    } finally {
      limpiarMontaje(montado);
      document.getElementById('innarPdfFrame')?.remove();
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
