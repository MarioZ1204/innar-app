const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '../public/index.html');
let html = fs.readFileSync(file, 'utf8');

const marker = `                </table>
              </div>
              <motion id="turnosTableMedicaControls"></div>`;

const replacement = `                </table>
                  </div>
                </div>
                <div class="medica-agenda-block medica-agenda-block-completados">
                  <motion class="medica-agenda-block-header medica-agenda-header-completados">
                    <div class="medica-agenda-block-head-left">
                      <span class="medica-agenda-block-title">Completados</span>
                      <span class="medica-agenda-block-sub">Atendidos y citas cerradas</span>
                    </div>
                    <span class="medica-agenda-block-count" id="medicaCountCompletados">0</span>
                  </div>
                  <div class="table-wrapper">
                    <table id="turnosTableMedicaCompletados" class="modern-table medica-turnos-table">
                      <colgroup>
                        <col class="col-turno">
                        <col class="col-hora col-mobile-hide">
                        <col class="col-paciente">
                        <col class="col-tipo col-mobile-hide">
                        <col class="col-doc col-mobile-hide">
                        <col class="col-entidad col-mobile-hide">
                        <col class="col-notas col-mobile-hide">
                        <col class="col-estado">
                        <col class="col-acciones">
                      </colgroup>
                      <thead>
                        <tr>
                          <th>Turno</th>
                          <th class="col-hora col-mobile-hide">Hora</th>
                          <th>Paciente</th>
                          <th class="col-mobile-hide">Tipo consulta</th>
                          <th class="col-mobile-hide">Documento</th>
                          <th class="col-mobile-hide">Entidad</th>
                          <th class="col-mobile-hide">Notas</th>
                          <th>Estado</th>
                          <th>Acciones</th>
                        </tr>
                      </thead>
                      <tbody id="turnosTableBodyMedicaCompletados">
                        <tr><td colspan="9" style="padding:16px;text-align:center;color:#9ca3af">—</td></tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
              <div id="turnosTableMedicaControls"></div>`;

const fix = (s) => s.replace(/<\/?motion\b/g, (t) => t.replace('motion', 'div'));
const markerOk = fix(marker);
const replacementOk = fix(replacement);

if (!html.includes(markerOk)) {
  console.error('Marker not found');
  process.exit(1);
}
html = html.replace(markerOk, replacementOk);
fs.writeFileSync(file, html);
console.log('Patched index.html medica split');
