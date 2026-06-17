const fs = require('fs');
const path = require('path');
const cssPath = path.join(__dirname, '..', 'public', 'style.css');
let css = fs.readFileSync(cssPath, 'utf8');
const block = `
.electro-cita-card{position:relative;padding-bottom:28px}
.electro-cita-card-fin{position:absolute;right:10px;bottom:8px;left:10px;text-align:right;font-size:.68rem;line-height:1.25;font-weight:600;color:#dc2626}
#turnosTableMedica{table-layout:fixed;width:100%}
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
#turnosTableMedica .col-estado-cell,#turnosTableMedica .col-acciones-cell,#turnosTableMedica .td-acciones{white-space:nowrap}
`;
if (!css.includes('electro-cita-card-fin')) {
  css += block;
  fs.writeFileSync(cssPath, css, 'utf8');
  console.log('CSS ok');
} else {
  console.log('CSS ya existe');
}
