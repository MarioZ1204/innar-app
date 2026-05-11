// public/js/ui-helpers.js
// Utilidades DOM seguras: nunca usar innerHTML con datos del usuario.

/** Escapa HTML peligroso para inserción segura. */
export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Equivalente seguro de `el.innerHTML = text` para texto plano. */
export function setText(el, value) {
  if (!el) return;
  el.textContent = value === null || value === undefined ? '' : String(value);
}

/** Vacía un nodo. */
export function clearChildren(el) {
  if (!el) return;
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** Crea elemento con clases, atributos y texto. */
export function el(tag, opts = {}, ...children) {
  const node = document.createElement(tag);
  if (opts.className) node.className = opts.className;
  if (opts.id) node.id = opts.id;
  if (opts.text !== undefined) node.textContent = opts.text;
  if (opts.attrs) for (const [k, v] of Object.entries(opts.attrs)) node.setAttribute(k, v);
  if (opts.on) for (const [event, handler] of Object.entries(opts.on)) node.addEventListener(event, handler);
  for (const child of children) {
    if (child === null || child === undefined) continue;
    if (typeof child === 'string') node.appendChild(document.createTextNode(child));
    else node.appendChild(child);
  }
  return node;
}

/** Atajo: `$('id')` → `document.getElementById('id')`. */
export const $ = (id) => document.getElementById(id);
