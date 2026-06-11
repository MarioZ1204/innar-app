'use strict';

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const BARRA_IMPRESION = `
<div class="doc-print-bar no-print">
  <button type="button" onclick="window.print()">Imprimir / Guardar PDF</button>
  <p class="doc-print-hint">Destino: «Guardar como PDF». En Chrome active «Más opciones» → «Gráficos de fondo» si el diseño no sale completo.</p>
</div>`;

/** CSS compartido: fondo como &lt;img&gt; (imprime mejor que background-image) */
const FONDO_PRINT_CSS = `
    .page-fondo {
      position: absolute;
      top: 0;
      left: 0;
      width: 210mm;
      height: 297mm;
      z-index: 0;
      pointer-events: none;
      object-fit: fill;
    }
    @media print {
      html, body, .page, .page-fondo {
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      .page-fondo {
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
      }
    }`;

function buildPageFondoImg(fondo = {}) {
  const base64 = fondo.base64 || '';
  if (!base64) return '';
  const mime = fondo.mime || 'image/png';
  return `<img class="page-fondo" src="data:${mime};base64,${base64}" alt="" aria-hidden="true"/>`;
}

const ESTILOS_IMPRESION = `
<style id="doc-print-styles">
  .doc-print-bar {
    text-align: center;
    padding: 14px 16px;
    background: #eef3f2;
    border-bottom: 1px solid #c5d4d1;
    font-family: Arial, Helvetica, sans-serif;
  }
  .doc-print-bar button {
    padding: 10px 22px;
    background: #2d4a47;
    color: #fff;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 600;
  }
  .doc-print-bar button:hover { background: #3d5a57; }
  .doc-print-hint {
    font-size: 12px;
    color: #555;
    margin: 8px 0 0;
  }
  @media print {
    .no-print { display: none !important; }
  }
</style>`;

/**
 * Envuelve HTML de certificado/comprobante con barra de impresión (fallback sin Puppeteer).
 */
function wrapHtmlDocumentoImprimible(html, titulo = 'Documento') {
  const safeTitle = escapeHtml(titulo);
  let out = String(html || '');

  if (/<title>[^<]*<\/title>/i.test(out)) {
    out = out.replace(/<title>[^<]*<\/title>/i, `<title>${safeTitle}</title>`);
  } else if (/<head[^>]*>/i.test(out)) {
    out = out.replace(/<head[^>]*>/i, `<head><title>${safeTitle}</title>`);
  }

  if (!/doc-print-styles/i.test(out) && /<\/head>/i.test(out)) {
    out = out.replace(/<\/head>/i, `${ESTILOS_IMPRESION}</head>`);
  } else if (!/doc-print-styles/i.test(out)) {
    out = ESTILOS_IMPRESION + out;
  }

  if (/<body[^>]*>/i.test(out)) {
    out = out.replace(/<body([^>]*)>/i, `<body$1>${BARRA_IMPRESION}`);
  } else {
    out = BARRA_IMPRESION + out;
  }

  return out;
}

module.exports = {
  wrapHtmlDocumentoImprimible,
  FONDO_PRINT_CSS,
  buildPageFondoImg
};
