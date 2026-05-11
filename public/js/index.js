// public/js/index.js
// Punto de entrada del bundle modular. Los módulos por dominio (auth, recibos,
// agenda, electro, etc.) se importarán aquí progresivamente conforme se
// rescate el código actual de `public/app.js`.
//
// Mientras tanto, este archivo coexiste con `public/app.js` y solo expone
// helpers de bajo nivel a `window.AppHelpers` para que el código legacy pueda
// migrar incrementalmente.

import { State, setCurrentModule, setUser, clearAll } from './state.js';
import { api, apiFetch } from './api.js';
import { escapeHtml, setText, clearChildren, el, $ } from './ui-helpers.js';

window.AppHelpers = {
  State,
  setCurrentModule,
  setUser,
  clearAll,
  api,
  apiFetch,
  escapeHtml,
  setText,
  clearChildren,
  el,
  $
};
