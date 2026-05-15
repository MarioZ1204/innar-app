/**
 * Corrige texto UTF-8 mal interpretado (mojibake) en fuentes JS del frontend.
 * Uso: node scripts/fix-mojibake.js
 */
const fs = require('fs');
const path = require('path');

const FILES = [
  path.join(__dirname, '..', 'docs', 'legacy', 'app.pre-minify.js'),
  path.join(__dirname, '..', 'public', 'app.js')
];

const REPLACEMENTS = [
  ['┬í', '¡'],
  ['┬┐', '¿'],
  ['┬½', '«'],
  ['┬╗', '»'],
  ['├ù', '×'],
  ['ÔÇó', '•'],
  ['ÔÇØ', '"'],
  ['ÔÇ£', '"'],
  ['N┬░', 'N°'],
  ['┬░', '°'],
  ['ÔÜá´©Å', '⚠️'],
  ['ÔÜá', '⚠'],
  ['Ô£ô', '✓'],
  ['ÔÅ│', '⏳'],
  ['ÔÇª', '…'],
  ['ÔÇö', '—'],
  ['ÔÇô', '–'],
  ['ÔÇ£', '"'],
  ['ÔÇ¥', '"'],
  ['ÔÇÖ', "'"],
  ['ÔÇÜ', "'"],
  ['ÔåÆ', '→'],
  ['Ôåô', '↓'],
  ['Ôåæ', '↑'],
  ['ÔÇ╣', '‹'],
  ['ÔÇ║', '›'],
  ['┬À', '·'],
  ['├│n', 'ón'],
  ['├®n', 'én'],
  ['├¡n', 'ín'],
  ['├¡a', 'ía'],
  ['├║', 'ú'],
  ['├╝', 'ü'],
  ['├│', 'ó'],
  ['├¡', 'í'],
  ['├®', 'é'],
  ['├í', 'á'],
  ['├▒', 'ñ'],
  ['├æ', 'Ñ'],
  ['├ü', 'Á'],
  ['├ë', 'É'],
  ['├ì', 'Í'],
  ['├ô', 'Ó'],
  ['├Ü', 'Ú'],
  ['├º', 'ç'],
  ['├¡', 'í'],
  ['M├®dica', 'Médica'],
  ['m├®dica', 'médica'],
  ['Electrodiagn├│stico', 'Electrodiagnóstico'],
  ['electrodiagn├│stico', 'electrodiagnóstico'],
  ['duraci├│n', 'duración'],
  ['Duraci├│n', 'Duración'],
  ['validaci├│n', 'validación'],
  ['programaci├│n', 'programación'],
  ['Programaci├│n', 'Programación'],
  ['tel├®fono', 'teléfono'],
  ['Tel├®fono', 'Teléfono'],
  ['d├¡gitos', 'dígitos'],
  ['n├║meros', 'números'],
  ['n├║mero', 'número'],
  ['d├¡a', 'día'],
  ['d├¡as', 'días'],
  ['Ma├▒ana', 'Mañana'],
  ['ma├▒ana', 'mañana'],
  ['despu├®s', 'después'],
  ['├║ltimo', 'último'],
  ['├║ltima', 'última'],
  ['inv├ílida', 'inválida'],
  ['inv├ílido', 'inválido'],
  ['est├í', 'está'],
  ['Est├í', 'Está'],
  ['vac├¡o', 'vacío'],
  ['vac├¡a', 'vacía'],
  ['bot├│n', 'botón'],
  ['opci├│n', 'opción'],
  ['pesta├▒a', 'pestaña'],
  ['pesta├▒as', 'pestañas'],
  ['selecci├│n', 'selección'],
  ['informaci├│n', 'información'],
  ['paginaci├│n', 'paginación'],
  ['Confirmaci├│n', 'Confirmación'],
  ['reprogramaci├│n', 'reprogramación'],
  ['Pr├│x', 'Próx'],
  ['S├¡', 'Sí'],
  ['s├¡', 'sí'],
  ['├║nicamente', 'únicamente'],
  ['espec├¡ficos', 'específicos'],
  ['espec├¡fico', 'específico'],
  ['caracteres', 'caracteres'],
  ['m├│dulo', 'módulo'],
  ['M├│dulo', 'Módulo'],
  ['├¡ndice', 'índice'],
  ['l├¡mite', 'límite'],
  ['tambi├®n', 'también'],
  ['├®xito', 'éxito'],
  ['├®xitos', 'éxitos'],
  ['cr├¡tico', 'crítico'],
  ['autom├íticamente', 'automáticamente'],
  ['coincidia', 'coincidía'],
  ['ingres├│', 'ingresó'],
  ['Ingres├│', 'Ingresó'],
  ['program├│', 'programó'],
  ['edit├│', 'editó'],
  ['cerr├│', 'cerró'],
  ['env├¡o', 'envío'],
  ['env├¡a', 'envía'],
  ['env├¡ar', 'enviar'],
  ['env├¡ado', 'enviado'],
  ['env├¡', 'enví'],
  ['├®l', 'él'],
  ['├®sta', 'ésta'],
  ['est├®', 'esté'],
  ['ser├í', 'será'],
  ['har├í', 'hará'],
  ['podr├í', 'podrá'],
  ['habr├í', 'habrá'],
  ['est├®n', 'estén'],
  ['est├®', 'esté'],
  ['est├ís', 'estás'],
  ['est├ín', 'están'],
  ['├║til', 'útil'],
  ['├║tiles', 'útiles'],
  ['├║nica', 'única'],
  ['├║nico', 'único'],
  ['├║ltimos', 'últimos'],
  ['B├ísica', 'Básica'],
  ['b├ísica', 'básica'],
  ['Monitorizaci├│n', 'Monitorización'],
  ['monitorizaci├│n', 'monitorización'],
  ['Titulaci├│n', 'Titulación'],
  ['titulaci├│n', 'titulación'],
  ['Electroencefalogr├ífica', 'Electroencefalográfica'],
  ['electroencefalogr├ífica', 'electroencefalográfica'],
  ['pol├¡tica', 'política'],
  ['Pol├¡tica', 'Política'],
  ['seg├║n', 'según'],
  ['├¡cono', 'ícono'],
  ['├¡conos', 'íconos'],
  ['├¡ndice', 'índice'],
  ['├¡tems', 'ítems'],
  ['├¡tem', 'ítem'],
  ['├¡', 'í'],
  ['ÔÇö', '—'],
  ['ÔÇö', '—']
].sort((a, b) => b[0].length - a[0].length);

function fixContent(text) {
  let out = text;
  let changed = 0;
  for (const [bad, good] of REPLACEMENTS) {
    if (!out.includes(bad)) continue;
    const parts = out.split(bad);
    const n = parts.length - 1;
    if (n > 0) {
      out = parts.join(good);
      changed += n;
    }
  }
  return { out, changed };
}

for (const file of FILES) {
  if (!fs.existsSync(file)) {
    console.warn('No existe:', file);
    continue;
  }
  const raw = fs.readFileSync(file, 'utf8');
  const { out, changed } = fixContent(raw);
  if (changed > 0) {
    fs.writeFileSync(file, out, 'utf8');
    console.log(`✓ ${path.basename(file)}: ${changed} reemplazos`);
  } else {
    console.log(`- ${path.basename(file)}: sin cambios`);
  }
}
