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
  <p class="doc-print-hint">En el diálogo de impresión elija «Guardar como PDF» o «Microsoft Print to PDF».</p>
</div>`;

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
  wrapHtmlDocumentoImprimible
};
