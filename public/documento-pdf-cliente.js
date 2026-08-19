/**
 * Generación de PDF en el navegador (html2canvas + jsPDF) y descarga desde el servidor.
 */
(function () {
  'use strict';

  const A4_W = 794;
  const A4_H = 1123;

  const ESTILO_CAPTURA_OCULTA = [
    'position:fixed', 'left:-12000px', 'top:0',
    `width:${A4_W}px`, `height:${A4_H}px`,
    'border:0', 'margin:0', 'padding:0',
    'pointer-events:none', 'overflow:hidden',
    'background:#fff', 'opacity:1', 'visibility:visible', 'z-index:-1'
  ].join(';');

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
    stage.style.cssText = ESTILO_CAPTURA_OCULTA;

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
    frame.style.cssText = ESTILO_CAPTURA_OCULTA;

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

  async function procesarFirmasMontaje(montado) {
    if (window.innarFirmaFondo?.procesarFirmasEnRoot) {
      await window.innarFirmaFondo.procesarFirmasEnRoot(montado.page);
    }
  }

  async function prepararDocumento(html) {
    const limpio = normalizarHtmlString(html);
    const montado = montarStaging(limpio);
    await procesarFirmasMontaje(montado);
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
    await procesarFirmasMontaje(montado);
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
      scale: opts.scale ?? 1.35,
      useCORS: true,
      allowTaint: true,
      logging: false,
      backgroundColor: '#ffffff',
      scrollX: 0,
      scrollY: 0,
      imageTimeout: 8000,
      onclone: (_doc, clonedEl) => prepararClonCaptura(clonedEl)
    };

    return html2canvas(target, { ...base, ...opts });
  }

  async function intentarCaptura(montado, opts = {}) {
    const fast = opts.fast === true;
    const intentos = [];

    if (montado.tipo === 'dom') {
      intentos.push(() => capturarConHtml2Canvas(montado.page, { scale: fast ? 1.15 : 1.35 }));
      if (!fast) {
        intentos.push(() => capturarConHtml2Canvas(montado.stage, { scale: 1.25 }));
      }
    } else {
      intentos.push(() => capturarConHtml2Canvas(montado.page, { window: montado.win, scale: fast ? 1.15 : 1.35 }));
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

  async function rasterizarAPdf(montado, filename, opts = {}) {
    const JsPDF = obtenerJsPdf();
    if (!JsPDF) throw new Error('Generador PDF no disponible (jsPDF)');

    const canvas = await intentarCaptura(montado, opts);
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

  function limpiarBarrasImpresionHtml(html) {
    const raw = String(html || '');
    try {
      const parsed = new DOMParser().parseFromString(raw, 'text/html');
      parsed.querySelectorAll('.doc-print-bar').forEach((el) => el.remove());
      parsed.querySelectorAll('.no-print').forEach((el) => {
        if (el.querySelector('button')) el.remove();
      });
      const doc = parsed.documentElement;
      if (doc) return '<!DOCTYPE html>\n' + doc.outerHTML;
    } catch (_) { /* fallback regex */ }
    return raw
      .replace(/<div[^>]*class="[^"]*doc-print-bar[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '')
      .replace(/<div[^>]*class="[^"]*no-print[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '');
  }

  function iconoSvg(tipo) {
    const icons = {
      doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
      download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
      print: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>',
      close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
      tip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
    };
    return icons[tipo] || '';
  }

  function crearBotonOverlay(clase, label, icono, titulo) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `innar-print-btn ${clase}`;
    btn.title = titulo || label;
    btn.innerHTML = `${iconoSvg(icono)}<span>${label}</span>`;
    return btn;
  }

  function abrirImpresionDocumento(html, opts = {}) {
    document.getElementById('innarPrintOverlay')?.remove();

    const titulo = opts.titulo || 'Documento listo';
    const subtitulo = opts.subtitulo || 'Revise la vista previa antes de guardar o imprimir';

    const overlay = document.createElement('div');
    overlay.id = 'innarPrintOverlay';
    overlay.className = 'innar-print-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', titulo);

    const toolbar = document.createElement('header');
    toolbar.className = 'innar-print-toolbar';

    const info = document.createElement('div');
    info.className = 'innar-print-toolbar__info';
    info.innerHTML = `
      <div class="innar-print-toolbar__icon">${iconoSvg('doc')}</div>
      <div class="innar-print-toolbar__text">
        <h2 class="innar-print-toolbar__title">${titulo}</h2>
        <p class="innar-print-toolbar__subtitle">${subtitulo}</p>
      </div>`;

    const actions = document.createElement('div');
    actions.className = 'innar-print-toolbar__actions';
    const btnPdf = crearBotonOverlay('innar-print-btn--primary', 'Guardar PDF', 'download', 'Guardar como PDF');
    const btnPrint = crearBotonOverlay('innar-print-btn--secondary', 'Imprimir', 'print', 'Imprimir documento');
    const btnClose = crearBotonOverlay('innar-print-btn--ghost', 'Cerrar', 'close', 'Cerrar vista previa');
    actions.append(btnPdf, btnPrint, btnClose);

    toolbar.append(info, actions);

    const tip = document.createElement('p');
    tip.className = 'innar-print-tip';
    tip.innerHTML = `${iconoSvg('tip')}<span>En el diálogo de impresión elija <strong>Guardar como PDF</strong>. En Chrome active <strong>Más opciones → Gráficos de fondo</strong> para incluir el diseño y las firmas.</span>`;

    const preview = document.createElement('main');
    preview.className = 'innar-print-preview';

    const paper = document.createElement('div');
    paper.className = 'innar-print-paper';

    const frame = document.createElement('iframe');
    frame.title = 'Vista previa del documento';
    paper.appendChild(frame);
    preview.appendChild(paper);

    overlay.append(toolbar, tip, preview);
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    frame.srcdoc = limpiarBarrasImpresionHtml(html);

    const imprimir = () => {
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
      } catch (_) { /* ignore */ }
    };

    const cerrar = () => {
      overlay.remove();
      document.body.style.overflow = '';
    };

    btnClose.addEventListener('click', cerrar);
    btnPdf.addEventListener('click', imprimir);
    btnPrint.addEventListener('click', imprimir);

    const onKey = (e) => {
      if (e.key === 'Escape') {
        cerrar();
        document.removeEventListener('keydown', onKey);
      }
    };
    document.addEventListener('keydown', onKey);
  }

  function limpiarMontaje(montado) {
    montado?.stage?.remove();
  }

  async function generarPdfDesdeHtml(html, filename, opts = {}) {
    const name = filename || 'documento.pdf';
    let montado = null;

    try {
      montado = await prepararDocumento(html);
      try {
        await rasterizarAPdf(montado, name, opts);
        return opts.fast ? 'pdf-cliente-rapido' : 'pdf-cliente';
      } catch (e1) {
        if (opts.fast) throw e1;
        limpiarMontaje(montado);
        montado = await prepararDocumentoIframe(html);
        try {
          await rasterizarAPdf(montado, name, opts);
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

  async function generarPdfBlobDesdeHtml(html, opts = {}) {
    const JsPDF = obtenerJsPdf();
    if (!JsPDF) throw new Error('Generador PDF no disponible (jsPDF)');

    let montado = null;
    try {
      montado = await prepararDocumento(html);
      let canvas = await intentarCaptura(montado, opts);
      if (!canvas || !canvasTieneContenido(canvas)) {
        if (opts.fast) throw new Error('BLANK_CANVAS');
        limpiarMontaje(montado);
        montado = await prepararDocumentoIframe(html);
        canvas = await intentarCaptura(montado, opts);
      }
      if (!canvas) throw new Error('No se pudo capturar el documento');

      const imgData = canvas.toDataURL('image/jpeg', 0.92);
      if (!imgData || imgData.length < 5000) throw new Error('BLANK_CANVAS');

      const pdf = new JsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
      const pw = pdf.internal.pageSize.getWidth();
      const ph = pdf.internal.pageSize.getHeight();
      pdf.addImage(imgData, 'JPEG', 0, 0, pw, ph, undefined, 'FAST');
      return pdf.output('blob');
    } finally {
      limpiarMontaje(montado);
      document.getElementById('innarPdfFrame')?.remove();
    }
  }

  async function leerErrorServidor(res) {
    const data = await res.json().catch(() => ({}));
    return data.error || `Error del servidor (${res.status})`;
  }

  function tituloImpresionDesdeFilename(filename) {
    const n = String(filename || '').toLowerCase();
    if (n.includes('comprobante')) {
      return {
        titulo: 'Comprobante de servicios',
        subtitulo: 'Revise los datos FOMAG antes de guardar el PDF'
      };
    }
    if (n.includes('certificado')) {
      return {
        titulo: 'Certificado de asistencia',
        subtitulo: 'Revise el documento antes de guardar el PDF'
      };
    }
    return { titulo: 'Documento listo', subtitulo: 'Vista previa antes de guardar o imprimir' };
  }

  async function generarDocumentoConBlob({ postUrl, previewUrl, payload, filename }) {
    const name = String(filename || 'documento.pdf').endsWith('.pdf')
      ? String(filename || 'documento.pdf')
      : `${filename}.pdf`;

    const res = await apiFetch(postUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const ct = (res.headers.get('content-type') || '').toLowerCase();
    const modoHdr = res.headers.get('X-Documento-Modo');

    if (modoHdr === 'pdf' || ct.includes('application/pdf')) {
      const blob = await res.blob();
      return { blob, modo: 'pdf-servidor', filename: name };
    }

    if (res.status === 408 || res.status >= 500) {
      throw new Error(
        await leerErrorServidor(res).catch(() => '')
        || `El servidor tardó demasiado (${res.status}). Espere unos segundos e intente de nuevo.`
      );
    }

    if (!res.ok) {
      throw new Error(await leerErrorServidor(res));
    }

    if (modoHdr === 'html' || ct.includes('text/html')) {
      const html = await res.text().catch(() => '');
      const meta = tituloImpresionDesdeFilename(name);
      if (previewUrl && html.trim()) {
        abrirImpresionDocumento(html, meta);
        return { blob: null, modo: 'impresion', filename: name };
      }
      if (previewUrl) {
        const preview = await fetchPreviewHtml(previewUrl, payload);
        abrirImpresionDocumento(preview.html, tituloImpresionDesdeFilename(preview.filename || name));
        return { blob: null, modo: 'impresion', filename: preview.filename || name };
      }
    }

    throw new Error('El servidor no generó PDF y no hay vista previa disponible');
  }

  async function generarDocumento(opts) {
    const out = await generarDocumentoConBlob(opts);
    if (out.blob) descargarBlob(out.blob, out.filename || opts.filename || 'documento.pdf');
    return out.modo;
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
        abrirImpresionDocumento(data.html, tituloImpresionDesdeFilename(data.filename || filename));
        return 'impresion';
      }
      throw new Error('Respuesta inválida del servidor');
    }

    const html = await res.text();
    if (!html.trim()) throw new Error('El documento generado está vacío');

    if (options.previewUrl && options.payload) {
      const preview = await fetchPreviewHtml(options.previewUrl, options.payload);
      abrirImpresionDocumento(preview.html, tituloImpresionDesdeFilename(preview.filename || filename));
      return 'impresion';
    }

    abrirImpresionDocumento(html, tituloImpresionDesdeFilename(filename));
    return 'impresion';
  }

  async function generarDesdePreview(url, payload) {
    const data = await fetchPreviewHtml(url, payload);
    return generarPdfDesdeHtml(data.html, data.filename);
  }

  window.innarDocumentoPdf = {
    generarPdfDesdeHtml,
    generarPdfBlobDesdeHtml,
    fetchPreviewHtml,
    descargarBlob,
    procesarRespuestaDocumento,
    generarDesdePreview,
    generarDocumento,
    generarDocumentoConBlob
  };
})();
