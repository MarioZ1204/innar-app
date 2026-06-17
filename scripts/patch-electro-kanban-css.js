const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, '..', 'public', 'style.css');
let css = fs.readFileSync(p, 'utf8');
if (css.includes('electro-kanban')) {
  console.log('CSS ya existe');
  process.exit(0);
}
const add = `
/* Electro kanban */
.electro-filtros-bar{display:flex;align-items:center;gap:12px;margin:12px 0 4px;flex-wrap:wrap}
.electro-filtro-label{font-size:.875rem;font-weight:600;color:#374151;white-space:nowrap}
.electro-filtros-bar .ms-wrap{min-width:220px;max-width:420px;flex:1}
.electro-kanban{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin-top:8px}
@media(max-width:1100px){.electro-kanban{grid-template-columns:1fr}}
.electro-kanban-col{background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;display:flex;flex-direction:column;min-height:280px;max-height:min(72vh,720px);overflow:hidden}
.electro-kanban-header{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid #e2e8f0;background:#fff;border-radius:12px 12px 0 0}
.electro-kanban-col-pendientes .electro-kanban-header{border-top:3px solid #f59e0b}
.electro-kanban-col-activos .electro-kanban-header{border-top:3px solid #2563eb}
.electro-kanban-col-completados .electro-kanban-header{border-top:3px solid #16a34a}
.electro-kanban-title{font-weight:700;font-size:.9rem;color:#1e293b}
.electro-kanban-count{font-size:.75rem;font-weight:700;background:#e2e8f0;color:#475569;padding:2px 8px;border-radius:999px}
.electro-kanban-body{flex:1;overflow-y:auto;padding:10px;display:flex;flex-direction:column;gap:8px}
.electro-kanban-empty{text-align:center;color:#94a3b8;font-size:.85rem;padding:24px 12px}
.electro-cita-card{background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:10px 12px;cursor:pointer;transition:box-shadow .15s,border-color .15s}
.electro-cita-card:hover{box-shadow:0 4px 12px rgba(15,23,42,.08);border-color:#cbd5e1}
.electro-cita-card-done{opacity:.6}
.electro-cita-card.estado-en-estudio{border-left:4px solid #2563eb}
.electro-cita-card.estado-pausado{border-left:4px solid #7c3aed}
.electro-cita-card.estado-completado{border-left:4px solid #16a34a}
.electro-cita-card.estado-en-sala{border-left:4px solid #f59e0b}
.electro-cita-card-top{display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:6px}
.electro-cita-card-hora{font-weight:700;font-size:1rem;color:#0f172a}
.electro-cita-card-paciente{font-weight:600;font-size:.9rem;color:#1e293b;line-height:1.3}
.electro-cita-card-meta{font-size:.78rem;color:#64748b;display:flex;flex-wrap:wrap;gap:6px 10px;margin-top:4px}
.electro-cita-card-estudio{font-size:.8rem;color:#475569;margin-top:6px}
`;
fs.writeFileSync(p, css + add, 'utf8');
console.log('OK: CSS kanban');
