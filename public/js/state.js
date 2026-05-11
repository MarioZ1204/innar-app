// public/js/state.js
// Estado compartido entre módulos. NO contiene lógica de negocio.

export const State = {
  currentModule: localStorage.getItem('current_module_v1') || null,
  user: null,
  csrfToken: null,
  socket: null
};

export function setCurrentModule(name) {
  State.currentModule = name;
  try { localStorage.setItem('current_module_v1', name); } catch (_) {}
}

export function setUser(user) {
  State.user = user || null;
}

export function clearAll() {
  State.user = null;
  State.csrfToken = null;
  try { localStorage.removeItem('current_module_v1'); } catch (_) {}
}
