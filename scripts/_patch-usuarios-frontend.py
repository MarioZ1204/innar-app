from pathlib import Path

p = Path(__file__).resolve().parents[1] / "public" / "app.js"
text = p.read_text(encoding="utf-8")

old = """async function cargarUsuarios() {
  const tbody = $('usuariosTableBody');
  showSkeletonRows(tbody, 6, 5);
  try {
    const res = await apiFetch('/api/usuarios');
    if (res.status === 403) { showToast('No tienes permiso', 'error'); return; }
    const usuarios = await res.json();"""

new = """async function cargarUsuarios() {
  const tbody = $('usuariosTableBody');
  showSkeletonRows(tbody, 6, 5);
  try {
    const res = await apiFetch('/api/usuarios');
    if (res.status === 403) { showToast('No tienes permiso', 'error'); return; }
    const usuarios = await res.json().catch(() => null);
    if (!res.ok) {
      showToast((usuarios && usuarios.error) || 'Error cargando usuarios', 'error');
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#b91c1c;padding:16px">No se pudo cargar la lista de usuarios</td></tr>';
      return;
    }
    if (!Array.isArray(usuarios)) {
      showToast('Respuesta inválida del servidor', 'error');
      return;
    }"""

if old not in text:
    raise SystemExit('cargarUsuarios block not found')
text = text.replace(old, new, 1)

old2 = """    const res = await apiFetch('/api/usuarios', { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify(body) 
    });
    const data = await res.json();
    if (data.ok) {"""

new2 = """    const res = await apiFetch('/api/usuarios', { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify(body) 
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showToast(data.error || data.details?.[0]?.message || 'Error al crear usuario', 'error');
      return;
    }
    if (data.ok) {"""

if old2 not in text:
    raise SystemExit('crearUsuario block not found')
text = text.replace(old2, new2, 1)

p.write_text(text, encoding="utf-8")
print("patched usuarios frontend")
