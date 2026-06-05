/**
 * Limpia Lista_Personas.csv (columna J) y genera CSV listo para subir al módulo Anexo FIDU.
 *
 * Uso: node scripts/preparar-lista-personas-csv.js [entrada.csv] [salida.csv]
 */
const fs = require('fs');
const path = require('path');
const { parsePersonasCsvContent, PERSONAS_CSV_COLUMNS } = require('../utils/anexo-fidu-personas');

const input = process.argv[2] || 'c:/Users/Usuario/Downloads/Base de Datos - Facturación - Lista_Personas.csv';
const output = process.argv[3] || path.join(__dirname, '..', 'data', 'anexo-fidu', 'lista_personas_limpia.csv');

function csvEscape(val) {
  const s = String(val ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

const content = fs.readFileSync(input, 'utf8');
const { personas, errores } = parsePersonasCsvContent(content);

const header = 'NUMERODOCUMENTO,NOMBRES,,APELLIDOS,,TIPODOCUMENTO,FECHANACIMIENTO,CIUDADDENACIMIENTO,GENERO,DIRECCION,BARRIO,CIUDADDERESIDENCIA,TELEFONO,CORREO,AFILIACION';
const rows = personas.map((p) => [
  p.numero_documento,
  p.nombres_1,
  p.nombres_2,
  p.apellidos_1,
  p.apellidos_2,
  p.tipo_documento,
  p.fecha_nacimiento,
  p.ciudad_nacimiento,
  p.genero,
  p.direccion.includes(' — ') ? p.direccion.split(' — ')[0] : p.direccion,
  p.barrio,
  p.ciudad_residencia,
  p.telefono,
  p.correo,
  p.afiliacion
].map(csvEscape).join(','));

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, [header, ...rows].join('\n'), 'utf8');

console.log(`Entrada: ${input}`);
console.log(`Salida:  ${output}`);
console.log(`Personas: ${personas.length}`);
console.log(`Advertencias: ${errores.length}`);
if (errores.length) {
  console.log(errores.slice(0, 20).join('\n'));
  if (errores.length > 20) console.log(`... y ${errores.length - 20} más`);
}
