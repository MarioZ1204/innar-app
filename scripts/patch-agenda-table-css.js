const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, '..', 'public', 'style.css');
let css = fs.readFileSync(p, 'utf8');

const old = `#turnosTableMedica{table-layout:fixed;width:100%}
#turnosTableMedica col.col-turno{width:6%}
#turnosTableMedica col.col-hora{width:7%}
#turnosTableMedica col.col-paciente{width:18%}
#turnosTableMedica col.col-tipo{width:12%}
#turnosTableMedica col.col-doc{width:9%}
#turnosTableMedica col.col-entidad{width:10%}
#turnosTableMedica col.col-notas{width:16%}
#turnosTableMedica col.col-estado{width:11%}
#turnosTableMedica col.col-acciones{width:11%}
#turnosTableMedica .col-notas-cell{max-width:0;overflow:hidden}
#turnosTableMedica .turno-notas-cell{display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#turnosTableMedica .col-estado-cell,#turnosTableMedica .col-acciones-cell,#turnosTableMedica .td-acciones{white-space:nowrap}`;

const neu = `#turnosTableMedica{table-layout:fixed;width:100%;border-collapse:separate;border-spacing:0}
#turnosTableMedica col.col-turno{width:5%}
#turnosTableMedica col.col-hora{width:6%}
#turnosTableMedica col.col-paciente{width:15%}
#turnosTableMedica col.col-tipo{width:13%}
#turnosTableMedica col.col-doc{width:11%}
#turnosTableMedica col.col-entidad{width:9%}
#turnosTableMedica col.col-notas{width:20%}
#turnosTableMedica col.col-estado{width:10%}
#turnosTableMedica col.col-acciones{width:11%}
#turnosTableMedica td,#turnosTableMedica th{padding:8px 7px;vertical-align:top;line-height:1.35;font-size:.84rem}
#turnosTableMedica .col-wrap-cell{word-break:break-word;overflow:hidden;line-height:1.35}
#turnosTableMedica .col-notas-cell{vertical-align:top}
#turnosTableMedica .turno-notas-cell{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;white-space:normal;word-break:break-word;line-height:1.35;font-size:.8rem;max-height:2.8em}
#turnosTableMedica .col-estado-cell,#turnosTableMedica .col-acciones-cell,#turnosTableMedica .td-acciones{white-space:nowrap;vertical-align:middle}
#turnosTableMedica .table-actions{flex-wrap:nowrap;justify-content:flex-end}`;

if (css.includes(old)) {
  css = css.replace(old, neu);
  fs.writeFileSync(p, css, 'utf8');
  console.log('CSS agenda actualizado');
} else if (!css.includes('col-wrap-cell')) {
  css += '\n' + neu;
  fs.writeFileSync(p, css, 'utf8');
  console.log('CSS agenda anadido');
} else {
  console.log('CSS agenda ya ok');
}
